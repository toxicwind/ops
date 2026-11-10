#!/usr/bin/env python3
"""Test turn for daemon-yield proofs. Implements the turn contract.

No job file -> writes state "yield" (an idle daemon turn, no pending work).
With a job file -> executes the job: runs the wrapper self-test and writes a
verification note, then reports state "done" with verification evidence.

This script executes ONLY the job it is handed. It is a proof harness, not
a general agent: real daemon turns use the real agent invocation.
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WRAPPER = os.path.join(HERE, "..", "daemon-yield.py")


def write_result(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def main():
    result_path = os.environ.get("DAEMON_YIELD_TURN_RESULT")
    job_path = os.environ.get("DAEMON_YIELD_JOB_FILE")
    if not result_path:
        print("DAEMON_YIELD_TURN_RESULT not set", file=sys.stderr)
        return 2
    if not job_path or not os.path.exists(job_path):
        write_result(result_path, {
            "state": "yield",
            "summary": "idle turn, no pending work",
            "pending_work": False,
        })
        return 0
    with open(job_path, encoding="utf-8") as f:
        job = json.load(f)
    # Execute: self-test + verification note (the proof job's real work).
    r = subprocess.run(["python3", WRAPPER, "--agent-cmd", "true", "self-test"],
                       capture_output=True, text=True, timeout=120)
    try:
        res = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        res = {"total": 0, "failures": ["unparseable self-test output"]}
    state_dir = os.path.dirname(result_path)
    note_path = os.path.join(state_dir, f"verification-note-{job.get('id', 'job')}.md")
    with open(note_path, "w", encoding="utf-8") as f:
        f.write(f"# Verification note: {job.get('title', job.get('id'))}\n\n")
        f.write(f"Job: {job.get('id')} (source: {job.get('source')})\n\n")
        f.write(f"Self-test: {res.get('total')} checks, "
                f"failures: {res.get('failures')}\n")
    done = not res.get("failures")
    write_result(result_path, {
        "state": "done" if done else "error",
        "summary": f"executed job {job.get('id')}: self-test "
                   f"{res.get('total')} checks, failures {res.get('failures')}",
        "pending_work": False,
        "verification": f"note at {note_path}; self-test failures "
                        f"{res.get('failures')}",
        "commits": [],
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
