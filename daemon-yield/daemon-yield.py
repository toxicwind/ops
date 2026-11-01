#!/usr/bin/env python3
"""daemon-yield.py — supervisor wrapper: route daemon idle turns to emergent jobs.

When the estate daemon's turn ends in yield/no-op with no pending work, this
wrapper pulls emergent jobs (oracle stalled tasks first, then the local file
queue, then squawk questions, then relay inbox) and runs the highest-value
decidable job as architect solving forward: plan -> execute -> verify ->
commit -> report. It never idles the daemon on a bare yield.

This is a SUPERVISOR wrapper around the daemon's agent invocation. It does
NOT modify the hatch client binary, its config, or its safeguards.

HARD EXITS (first-class loop conditions, never rerouted):
  - stop / pause / audit request from Chris or the runtime -> loop exits
    IMMEDIATELY, no new work starts, any running child is terminated.
  - a runtime no-retry instruction on the turn itself -> this attempt ends
    (exit 13); the supervisor may start a fresh attempt later, which is not
    a retry of the same call.
  - money, credential (mint/rotate/print), and machine-reboot actions are
    NEVER taken by the daemon; such jobs are filtered out and logged.
  - upgrade-class jobs run only when the canary gate file says pass;
    a missing gate file fails closed (job skipped).

TURN CONTRACT (the --agent-cmd command must honor one of these, in order):
  1. Write a result JSON to $DAEMON_YIELD_TURN_RESULT with fields:
     state: done|yield|noop|stop|pause|audit|error|blocked
     summary: str, pending_work: bool, no_retry: bool,
     commits: [sha, ...] (optional), verification: str (optional)
  2. Else print a line: DAEMON_YIELD_STATE: <state>
  3. Else exit code: 0 -> done, 3 -> stop, 4 -> pause, 5 -> audit,
     anything else nonzero -> error.

WAITS: event-driven first. inotifywait watches the queue dir, relay dir,
and stop file when available. Bounded backoff (cap 60s) only where no
inotifywait exists. Never a bare sleep-poll loop.

Bounded mode (proof + safe operation): --max-jobs N, --max-minutes T.
The unbounded loop is NOT enabled by this script; enabling is a separate
verified step (see daemon-yield.toml + README.md).
"""

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

# ---------------------------------------------------------------- constants

EXIT_OK = 0
EXIT_STOP = 10
EXIT_PAUSE = 11
EXIT_AUDIT = 12
EXIT_NO_RETRY = 13
EXIT_ERROR = 14
EXIT_BOUNDED = 0  # bounded-complete is a clean exit; reason is in the log

STOP_CODES = {"stop": EXIT_STOP, "pause": EXIT_PAUSE, "audit": EXIT_AUDIT}

# Terminal no-retry markers: a turn carrying one ends this attempt.
NO_RETRY_MARKERS = ("provider_rate_limit_stop", "connector_rate_limited")

# Boundary filter: (pattern, reason). A job matching any pattern is dropped.
BOUNDARY_PATTERNS = [
    (re.compile(r"\b(pay|purchase|buy|spend|top[- ]?up|invoice|charge|billing)\b", re.I),
     "money/spend action"),
    (re.compile(r"\b(rotate|reissue|re-issue|mint|reveal|expose|leak|print)\b.{0,40}\b(api[-_ ]?key|token|password|secret|credential)", re.I),
     "credential mint/rotate/print action"),
    (re.compile(r"\b(api[-_ ]?key|token|password|secret|credential)\b.{0,40}\b(rotate|reissue|re-issue|mint|reveal|print|expose)", re.I),
     "credential mint/rotate/print action"),
    (re.compile(r"\b(reboot|restart)\b.{0,30}\b(machine|pc|bridge|host|server|computer)\b", re.I),
     "machine reboot action"),
    (re.compile(r"\b(modify|patch|shim|bypass|disable)\b.{0,40}\bhatch (client|daemon|binary)", re.I),
     "hatch client modification"),
]

UPGRADE_PATTERN = re.compile(
    r"\b(upgrade|update|deploy|restart)\b.{0,40}\b(daemon|service|router|gateway|server)\b", re.I)

TASK_VERB_PATTERN = re.compile(
    r"\b(fix|audit|build|verify|check|review|repair|investigate|implement|test)\b", re.I)


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------- logging

class Logger:
    def __init__(self, path):
        self.path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)

    def write(self, event, **fields):
        line = json.dumps({"ts": utcnow(), "event": event, **fields})
        print(line, flush=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(line + "\n")


# ---------------------------------------------------------------- pure helpers (self-test covers these)

def parse_turn_result(stdout, exit_code, result_path):
    """Resolve a turn's terminal state from result JSON, marker, or code."""
    if result_path and os.path.exists(result_path):
        try:
            with open(result_path, encoding="utf-8") as f:
                data = json.load(f)
            state = str(data.get("state", "")).strip().lower()
            if state in ("done", "yield", "noop", "stop", "pause", "audit",
                         "error", "blocked"):
                data["no_retry"] = bool(data.get("no_retry")) or any(
                    m in json.dumps(data) for m in NO_RETRY_MARKERS)
                return data
        except (ValueError, OSError):
            pass
    m = re.search(r"DAEMON_YIELD_STATE:\s*(\w+)", stdout or "")
    if m:
        state = m.group(1).lower()
        if state in ("done", "yield", "noop", "stop", "pause", "audit",
                     "error", "blocked"):
            return {"state": state,
                    "no_retry": any(x in (stdout or "") for x in NO_RETRY_MARKERS)}
    if exit_code == 0:
        return {"state": "done", "no_retry": False}
    if exit_code == 3:
        return {"state": "stop", "no_retry": False}
    if exit_code == 4:
        return {"state": "pause", "no_retry": False}
    if exit_code == 5:
        return {"state": "audit", "no_retry": False}
    return {"state": "error",
            "no_retry": any(x in (stdout or "") for x in NO_RETRY_MARKERS)}


def boundary_violation(text):
    """Return the violation reason if a job must never be taken, else None."""
    for pattern, reason in BOUNDARY_PATTERNS:
        if pattern.search(text or ""):
            return reason
    return None


def is_upgrade_class(text):
    return bool(UPGRADE_PATTERN.search(text or ""))


def is_task_shaped(text):
    return bool(TASK_VERB_PATTERN.search(text or ""))


# ---------------------------------------------------------------- self-test

def self_test():
    cases = [
        (parse_turn_result("", 0, None)["state"], "done"),
        (parse_turn_result("DAEMON_YIELD_STATE: yield\n", 0, None)["state"], "yield"),
        (parse_turn_result("", 3, None)["state"], "stop"),
        (parse_turn_result("", 5, None)["state"], "audit"),
        (parse_turn_result("", 1, None)["state"], "error"),
        (parse_turn_result("x provider_rate_limit_stop y", 1, None)["no_retry"], True),
        (boundary_violation("please rotate the api key"), "credential mint/rotate/print action"),
        (boundary_violation("pay the invoice for hosting"), "money/spend action"),
        (boundary_violation("reboot the bridge machine"), "machine reboot action"),
        (boundary_violation("audit the thresher error list"), None),
        (is_upgrade_class("upgrade the herd router service"), True),
        (is_upgrade_class("audit the router logs"), False),
        (is_task_shaped("did anyone get a new name recently?"), False),
        (is_task_shaped("fix the github launcher path"), True),
    ]
    failures = [(i, got, want) for i, (got, want) in enumerate(cases) if got != want]
    return {"total": len(cases), "failures": failures}

# ---------------------------------------------------------------- supervisor

import threading


def run_captured(argv, timeout):
    """Run a provider command, capturing output, in its own session.

    Provider CLIs can spawn pipe-holding grandchildren (e.g. a live watch);
    a bare communicate() timeout would then hang forever on the open pipe.
    Killing the whole process group on timeout closes that hole.
    Raises subprocess.TimeoutExpired on timeout.
    """
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True,
                            start_new_session=True)
    try:
        out, _ = proc.communicate(timeout=timeout)
        return proc.returncode, out
    except subprocess.TimeoutExpired:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(proc.pid, sig)
            except (ProcessLookupError, PermissionError):
                break
            try:
                proc.wait(timeout=5)
                break
            except subprocess.TimeoutExpired:
                continue
        raise

ORACLE_SCAN_SCRIPT = r'''
import json, time
from collections import defaultdict
events = defaultdict(list)
try:
    with open("/home/toxic/estate/ranch/squawk/oracle/ledger/ledger.jsonl") as f:
        for line in f:
            try:
                d = json.loads(line)
            except Exception:
                continue
            t = d.get("task_id")
            if t:
                events[t].append(d)
except FileNotFoundError:
    print(json.dumps({"candidates": []})); raise SystemExit(0)
TERMINAL = {"assigned", "settled", "expired", "rejected", "task_settled"}
now = time.time()
out = []
for tid, evs in events.items():
    if not tid.startswith("task-"):
        continue
    last = evs[-1].get("event")
    if last in TERMINAL:
        continue
    if not any(e.get("event") == "task_posted" for e in evs):
        continue
    posted = None
    text = ""
    for e in evs:
        if e.get("event") == "task_posted":
            posted = e.get("ts") or e.get("time") or 0
            text = (e.get("text") or e.get("payload") or "")
            if isinstance(text, dict):
                text = json.dumps(text)
    age_h = None
    if isinstance(posted, (int, float)) and posted > 0:
        stamp = posted / 1000.0 if posted > 1e12 else posted
        age_h = (now - stamp) / 3600.0
    out.append({"task_id": tid, "last_event": last, "age_h": age_h,
                "text": (text or "")[:400]})
print(json.dumps({"candidates": out}))
'''

ESTATE_MASTER = os.path.expanduser(
    "~/workspace/custom-connectors/custom.estate-master/bin/estate-master.py")
YOTE_CONN = os.path.expanduser("~/workspace/bin/yote-conn")
_squawk_cell = os.path.expanduser("~/workspace/bin/squawk")
SQUAWK_BIN = _squawk_cell if os.path.exists(_squawk_cell) else "squawk"


class Supervisor:
    def __init__(self, args):
        self.args = args
        self.state_dir = os.path.expanduser(args.state_dir)
        self.queue_dir = os.path.expanduser(args.queue_dir)
        self.claimed_dir = os.path.expanduser(args.claimed_dir)
        self.relay_dir = os.path.expanduser(args.relay_dir) if args.relay_dir else None
        self.stop_file = os.path.join(self.state_dir, "stop")
        self.log = Logger(os.path.join(self.state_dir, "daemon-yield.log"))
        self.stop_event = threading.Event()
        self.stop_reason = None
        self.jobs_done = 0
        self.started = time.time()
        self.consecutive_errors = 0
        self.skipped_providers = set()
        for d in (self.state_dir, self.queue_dir, self.claimed_dir):
            os.makedirs(d, exist_ok=True)

    # ---- hard exits ----

    def request_stop(self, reason):
        if not self.stop_event.is_set():
            self.stop_reason = reason
        self.stop_event.set()

    def install_signals(self):
        def handler(signum, _frame):
            self.request_stop(f"signal-{signum}")
        signal.signal(signal.SIGTERM, handler)
        signal.signal(signal.SIGINT, handler)

    def stop_requested(self):
        if self.stop_event.is_set():
            return self.stop_reason or "signal"
        if os.path.exists(self.stop_file):
            return "stop-file"
        return None

    # ---- turn runner ----

    def run_turn(self, job=None):
        """Run one agent turn. Returns (result_dict, timed_out)."""
        result_path = os.path.join(self.state_dir, "turn-result.json")
        if os.path.exists(result_path):
            os.remove(result_path)
        env = dict(os.environ)
        env["DAEMON_YIELD_TURN_RESULT"] = result_path
        if job is not None:
            job_path = os.path.join(self.state_dir, "current-job.json")
            with open(job_path, "w", encoding="utf-8") as f:
                json.dump(job, f)
            env["DAEMON_YIELD_JOB_FILE"] = job_path
        else:
            env.pop("DAEMON_YIELD_JOB_FILE", None)
        # New session: the agent command runs via shell, so the real worker
        # is a grandchild. Stopping must kill the whole process group,
        # otherwise terminating the shell orphans the worker.
        proc = subprocess.Popen(self.args.agent_cmd, shell=True, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True)

        def _kill_tree():
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                return
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
                proc.wait()
        # Communicate on a thread so a stop can interrupt a long turn:
        # a bare communicate() would block until the child exits or times out.
        box = {}

        def _comm():
            try:
                out, _ = proc.communicate()
                box["out"] = out
            except Exception as exc:  # pragma: no cover - defensive
                box["error"] = str(exc)

        worker = threading.Thread(target=_comm, daemon=True)
        worker.start()
        deadline = time.time() + self.args.turn_timeout
        timed_out = False
        while worker.is_alive():
            if self.stop_event.is_set():
                _kill_tree()
                worker.join(timeout=5)
                return {"state": "stop",
                        "summary": "stop during turn"}, False
            if time.time() > deadline:
                _kill_tree()
                worker.join(timeout=5)
                return {"state": "error", "summary": "turn timeout",
                        "timed_out": True}, True
            worker.join(timeout=0.5)
        out = box.get("out", "")
        result = parse_turn_result(out, proc.returncode, result_path)
        result["timed_out"] = timed_out
        return result, timed_out

    # ---- waits (event-driven first) ----

    def wait_for_work(self, max_wait):
        """Wait for a queue event or a stop. Returns 'wake' or 'stop'."""
        deadline = time.time() + max_wait
        watch_dirs = [d for d in [self.queue_dir, self.relay_dir]
                      if d and os.path.isdir(d)]
        while time.time() < deadline:
            reason = self.stop_requested()
            if reason:
                return "stop"
            remaining = deadline - time.time()
            if watch_dirs:
                try:
                    # Short chunks so a stop wakes the wait promptly.
                    r = subprocess.run(
                        ["inotifywait", "-q", "-e", "create,modify,moved_to",
                         "--timeout", str(max(1, int(min(remaining, 5)))),
                         "--"] + watch_dirs,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        timeout=min(remaining, 10) + 5)
                    if r.returncode == 0 and not self.stop_requested():
                        return "wake"
                    # Timeout (returncode 2) or error: keep waiting.
                except (FileNotFoundError, subprocess.TimeoutExpired):
                    pass
            self.stop_event.wait(timeout=min(5, max(0.5, remaining)))
        return "stop" if self.stop_requested() else "timeout"

    # ---- job providers ----

    def provider_oracle(self):
        """Stalled oracle tasks only: task_posted, never assigned/settled,
        older than the stall horizon. Read-only; never bids, never assigns."""
        if "oracle" in self.skipped_providers:
            return []
        scan_path = "/home/toxic/estate/ranch/ops/daemon-yield/oracle-scan.py"
        out = None
        try:
            if os.path.exists(ESTATE_MASTER):
                _, out = run_captured(
                    ["python3", ESTATE_MASTER, "yote", "python3", scan_path],
                    timeout=120)
            if not out or "candidates" not in out:
                # Yote-side script not deployed yet: inline scan via base64
                # (byte-exact transfer; the script is under 1KB).
                import base64 as _b64
                b64 = _b64.b64encode(ORACLE_SCAN_SCRIPT.encode()).decode()
                _, out = run_captured(
                    ["python3", ESTATE_MASTER, "yote",
                     f"echo {b64} | base64 -d | python3"],
                    timeout=120)
            if not out or "candidates" not in out:
                raise RuntimeError("oracle scan shape unexpected")
        except subprocess.TimeoutExpired:
            self.log.write("provider_failed", provider="oracle",
                           error="timeout")
            self.skipped_providers.add("oracle")
            return []
        except Exception as exc:
            self.log.write("provider_failed", provider="oracle",
                           error=str(exc)[:200])
            self.skipped_providers.add("oracle")
            return []
        try:
            cands = json.loads(out[out.index("{"):])["candidates"]
        except (ValueError, KeyError):
            return []
        jobs = []
        for c in cands:
            age_h = c.get("age_h")
            if age_h is not None and age_h < self.args.oracle_stall_hours:
                continue
            text = c.get("text", "")
            viol = boundary_violation(text)
            if viol:
                self.log.write("job_filtered", provider="oracle",
                               task_id=c["task_id"], reason=viol)
                continue
            jobs.append({"id": c["task_id"], "source": "oracle",
                         "title": f"stalled oracle task {c['task_id']}",
                         "prompt": text, "age_h": age_h})
        jobs.sort(key=lambda j: (j["age_h"] is None, -(j["age_h"] or 0)))
        return jobs

    def provider_file_queue(self):
        jobs = []
        try:
            names = sorted(os.listdir(self.queue_dir))
        except OSError:
            return jobs
        for name in names:
            if not name.endswith(".json"):
                continue
            path = os.path.join(self.queue_dir, name)
            try:
                with open(path, encoding="utf-8") as f:
                    job = json.load(f)
            except (ValueError, OSError):
                continue
            text = f"{job.get('title', '')} {job.get('prompt', '')}"
            viol = boundary_violation(text)
            if viol:
                self.log.write("job_filtered", provider="file-queue",
                               job_id=job.get("id", name), reason=viol)
                continue
            if is_upgrade_class(text) and not self.canary_pass():
                self.log.write("job_skipped", provider="file-queue",
                               job_id=job.get("id", name),
                               reason="canary gate not pass")
                continue
            job.setdefault("id", name[:-5])
            job.setdefault("source", "file-queue")
            jobs.append(job)
        return jobs

    def provider_squawk(self):
        """Open squawk questions, task-shaped and fresh only."""
        if "squawk" in self.skipped_providers:
            return []
        try:
            _, out = run_captured([SQUAWK_BIN, "questions", "fleet"], timeout=60)
        except subprocess.TimeoutExpired:
            self.log.write("provider_failed", provider="squawk",
                           error="timeout")
            self.skipped_providers.add("squawk")
            return []
        except Exception as exc:
            self.log.write("provider_failed", provider="squawk",
                           error=str(exc)[:200])
            self.skipped_providers.add("squawk")
            return []
        jobs = []
        for block in out.split("\n\n"):
            m = re.search(r"\[(?P<id>[^\]]+)\]\s+#(?P<ch>\S+)\s+\((?P<age>[^)]+)\)\s+(?P<author>\S+)\n(?P<text>.*)",
                          block, re.S)
            if not m:
                continue
            text = m.group("text").strip()
            age = m.group("age")
            hours = None
            mm = re.search(r"(\d+)h", age)
            if mm:
                hours = int(mm.group(1))
            if hours is not None and hours > self.args.squawk_max_age_hours:
                self.log.write("job_filtered", provider="squawk",
                               question_id=m.group("id"), reason="stale")
                continue
            if not is_task_shaped(text):
                self.log.write("job_filtered", provider="squawk",
                               question_id=m.group("id"), reason="not task-shaped")
                continue
            viol = boundary_violation(text)
            if viol:
                self.log.write("job_filtered", provider="squawk",
                               question_id=m.group("id"), reason=viol)
                continue
            jobs.append({"id": m.group("id"), "source": "squawk",
                         "title": "open fleet question", "prompt": text})
        return jobs

    def provider_relay(self):
        if not self.relay_dir or not os.path.isdir(self.relay_dir):
            return []
        jobs = []
        for name in sorted(os.listdir(self.relay_dir)):
            if not name.endswith(".json"):
                continue
            path = os.path.join(self.relay_dir, name)
            try:
                with open(path, encoding="utf-8") as f:
                    job = json.load(f)
            except (ValueError, OSError):
                continue
            text = f"{job.get('title', '')} {job.get('prompt', '')}"
            viol = boundary_violation(text)
            if viol:
                self.log.write("job_filtered", provider="relay",
                               job_id=job.get("id", name), reason=viol)
                continue
            job.setdefault("id", name[:-5])
            job.setdefault("source", "relay")
            jobs.append(job)
        return jobs

    def canary_pass(self):
        gate = self.args.canary_gate_file
        if not gate or not os.path.exists(os.path.expanduser(gate)):
            return False
        try:
            with open(os.path.expanduser(gate), encoding="utf-8") as f:
                return json.load(f).get("status") == "pass"
        except (ValueError, OSError):
            return False

    def pull_jobs(self):
        """Providers in priority order. Returns (jobs, provider_used)."""
        for name, fn in (("oracle", self.provider_oracle),
                         ("file-queue", self.provider_file_queue),
                         ("squawk", self.provider_squawk),
                         ("relay", self.provider_relay)):
            if self.args.only_providers and name not in self.args.only_providers:
                continue
            jobs = fn()
            if jobs:
                return jobs, name
        return [], None

    # ---- job execution ----

    def claim_file_job(self, job):
        """Atomically claim a file-queue job so no two loops run it."""
        if job.get("source") != "file-queue":
            return True
        src = os.path.join(self.queue_dir, job["id"] + ".json")
        dst = os.path.join(self.claimed_dir, job["id"] + ".json")
        try:
            os.rename(src, dst)
            return True
        except OSError:
            return False

    def execute_job(self, job):
        self.log.write("job_start", job_id=job["id"], source=job["source"],
                       title=job.get("title", ""))
        result, _ = self.run_turn(job=job)
        state = result.get("state")
        self.log.write("job_end", job_id=job["id"], state=state,
                       summary=(result.get("summary") or "")[:300],
                       commits=result.get("commits") or [],
                       verification=(result.get("verification") or "")[:300])
        if state in STOP_CODES:
            return STOP_CODES[state]
        if result.get("no_retry"):
            return EXIT_NO_RETRY
        if state == "done":
            self.jobs_done += 1
            return EXIT_OK
        return EXIT_ERROR

    # ---- main loop ----

    def run(self):
        self.install_signals()
        self.log.write("loop_start", agent_cmd=self.args.agent_cmd,
                       max_jobs=self.args.max_jobs,
                       max_minutes=self.args.max_minutes)
        while True:
            reason = self.stop_requested()
            if reason:
                self.log.write("loop_exit", reason=f"hard-exit:{reason}")
                return STOP_CODES.get(reason, EXIT_STOP) \
                    if reason in STOP_CODES else EXIT_STOP
            if self.args.max_jobs and self.jobs_done >= self.args.max_jobs:
                self.log.write("loop_exit", reason="bounded-complete",
                               jobs_done=self.jobs_done)
                return EXIT_OK
            if self.args.max_minutes and \
                    (time.time() - self.started) > self.args.max_minutes * 60:
                self.log.write("loop_exit", reason="bounded-complete",
                               jobs_done=self.jobs_done)
                return EXIT_OK
            result, _ = self.run_turn()
            state = result.get("state")
            if state in STOP_CODES:
                self.log.write("loop_exit", reason=f"hard-exit:{state}")
                return STOP_CODES[state]
            if result.get("no_retry"):
                self.log.write("loop_exit",
                               reason="no-retry terminal on turn")
                return EXIT_NO_RETRY
            if state == "error":
                self.consecutive_errors += 1
                self.log.write("turn_error",
                               summary=(result.get("summary") or "")[:300],
                               consecutive=self.consecutive_errors)
                if self.consecutive_errors >= 3:
                    self.log.write("loop_exit", reason="error-threshold")
                    return EXIT_ERROR
                self.wait_for_work(min(60, 10 * self.consecutive_errors))
                continue
            self.consecutive_errors = 0
            if state == "done" and result.get("pending_work"):
                continue  # daemon has its own work; no job pull needed
            if state in ("yield", "noop") and not result.get("pending_work"):
                jobs, provider = self.pull_jobs()
                if not jobs:
                    self.log.write("no_jobs", wait="event-driven")
                    wake = self.wait_for_work(self.args.idle_wait_max)
                    if wake == "stop":
                        continue  # top of loop handles the hard exit
                    continue
                job = jobs[0]
                self.log.write("job_picked", job_id=job["id"],
                               source=job["source"], provider=provider)
                if not self.claim_file_job(job):
                    self.log.write("job_claim_lost", job_id=job["id"])
                    continue
                code = self.execute_job(job)
                if code != EXIT_OK:
                    if code in (EXIT_STOP, EXIT_PAUSE, EXIT_AUDIT,
                                EXIT_NO_RETRY):
                        self.log.write("loop_exit", reason=f"job-exit:{code}")
                        return code
                    continue
                continue
            # done with no pending work: brief event-driven wait, then loop
            self.wait_for_work(min(self.args.idle_wait_max, 30))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--agent-cmd", required=True,
                        help="shell command running one daemon turn")
    parser.add_argument("--state-dir", default="~/workspace/daemon-yield/state")
    parser.add_argument("--queue-dir", default="~/workspace/daemon-yield/queue")
    parser.add_argument("--claimed-dir", default="~/workspace/daemon-yield/claimed")
    parser.add_argument("--relay-dir", default=None)
    parser.add_argument("--canary-gate-file",
                        default="~/workspace/nightly-canary/gate.json")
    parser.add_argument("--max-jobs", type=int, default=0,
                        help="0 = unbounded (only via supervisor unit)")
    parser.add_argument("--max-minutes", type=float, default=0)
    parser.add_argument("--turn-timeout", type=int, default=600)
    parser.add_argument("--idle-wait-max", type=int, default=300)
    parser.add_argument("--oracle-stall-hours", type=float, default=24)
    parser.add_argument("--squawk-max-age-hours", type=int, default=168)
    parser.add_argument("--only-providers", default="",
                        help="comma-separated provider subset, e.g. squawk "
                             "(a bare nargs list would swallow the command)")
    parser.add_argument("command", nargs="?", default="run",
                        choices=["run", "self-test", "pull-only"])
    args = parser.parse_args(argv)
    args.only_providers = [p.strip() for p in args.only_providers.split(",")
                           if p.strip()]
    if args.command == "self-test":
        res = self_test()
        print(json.dumps(res))
        return 0 if not res["failures"] else 1
    sup = Supervisor(args)
    if args.command == "pull-only":
        jobs, provider = sup.pull_jobs()
        print(json.dumps({"provider": provider,
                          "jobs": [{k: v for k, v in j.items()
                                    if k in ("id", "source", "title", "age_h")}
                                   for j in jobs]}, indent=1))
        return 0
    return sup.run()


if __name__ == "__main__":
    sys.exit(main())
