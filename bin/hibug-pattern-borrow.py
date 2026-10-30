#!/usr/bin/env python3
"""hibug-pattern-borrow.py — ranked prior art for a flagged task, then rephrase.

One line per design choice:
  - Python (not Bun): this helper is ops glue — it shells out to ffs/gh/curl,
    parses JSON, and tolerates each leg failing independently. Python's
    subprocess + json handling is the estate's ops-script idiom.
  - Estate first: ffs on yote (ranch ops tooling, then docs) before GitHub
    before web, per the borrow-before-inventing doctrine. A hit in our own
    tree outranks a hit anywhere else.
  - The rewrite itself is NOT re-implemented here: it shells to the shared
    hibug-rephrase.ts CLI (same module hibug-race.ts imports), so the two
    tools can never drift apart on what "safe" means.
  - Purpose gate runs FIRST: a task whose purpose is wrong dies before any
    search leg runs. No pattern fetch for a bad task, ever.

Order: gate -> estate (ffs) -> GitHub (gh search) -> web (best effort) ->
rephrase via shared CLI -> JSON report on stdout.

Legs degrade independently and say so in `notes`: a missing ffs binary, a
gh auth failure, or a blocked web fetch never kills the other legs, and a
leg that produced nothing is reported as empty, not faked.

Usage:
  hibug-pattern-borrow.py "flagged task text"
  hibug-pattern-borrow.py --task-file task.txt [--roots /a,/b]
      [--rephrase /path/to/hibug-rephrase.ts] [--no-web]
"""

import argparse
import json
import os
import re
import subprocess
import sys

STOPWORDS = set(
    "the a an and or to of in on for with never ask run do it this that "
    "from into over under please just".split()
)
HERE = os.path.dirname(os.path.abspath(__file__))


def keywords(task):
    words = re.findall(r"[a-z][a-z0-9_-]{2,}", task.lower())
    seen, out = set(), []
    for w in words:
        if w not in STOPWORDS and w not in seen:
            seen.add(w)
            out.append(w)
    return out[:8]


def run(cmd, timeout=20):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError:
        return 127, "", "binary not found"
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"


def estate_leg(keywords, roots, notes):
    """ffs grep per keyword across estate roots; rank ops tooling first."""
    hits, seen = [], set()
    for kw in keywords[:4]:
        for root in roots:
            rc, out, _ = run(["ffs", "grep", kw, "--root", root], timeout=30)
            if rc == 127:
                notes.append("estate leg: ffs not found on this host; skipped")
                return hits
            if rc != 0 or not out.strip():
                continue
            for line in out.splitlines()[:6]:
                # ffs appends footer lines ("[1-3 of 3]", "[no matches ...]");
                # only lines shaped like path:line:content are hits.
                if line.startswith("[") or ":" not in line:
                    continue
                path = line.split(":")[0]
                if path in seen or "node_modules" in path or "/vendored/" in path:
                    continue
                seen.add(path)
                rank = 0 if "/ops/bin/" in path else 1 if path.endswith((".md", ".ts", ".py")) else 2
                hits.append({"rank": rank, "path": path, "keyword": kw})
    hits.sort(key=lambda h: h["rank"])
    return hits[:10]


def github_leg(keywords, notes):
    rc, out, err = run(
        ["gh", "search", "code", "--owner", "toxicwind", " ".join(keywords[:3])],
        timeout=30,
    )
    if rc != 0:
        notes.append("github leg: %s" % (err.strip().splitlines() or ["unavailable"])[0][:120])
        return []
    try:
        items = json.loads(out) if out.strip().startswith("[") else []
    except json.JSONDecodeError:
        items = []
    return [{"repo": i.get("repository", {}).get("fullName", "?"),
             "path": i.get("path", "?")} for i in items[:5]]


def web_leg(keywords, notes):
    """Best-effort web leg. Egress here is proxied/MITM'd; a failure is a
    note, not an error — the operator's browser.search covers it."""
    q = "+".join(keywords[:4])
    rc, out, err = run(
        ["curl", "-s", "-m", "12",
         "https://html.duckduckgo.com/html/?q=%s" % q],
        timeout=20,
    )
    if rc != 0 or "result__a" not in out:
        notes.append("web leg: unavailable in this environment; use browser.search")
        return []
    links = re.findall(r'class="result__a"[^>]*href="([^"]+)"', out)
    return [{"url": u} for u in links[:5]]


def rephrase(task, rephrase_path, notes):
    rc, out, err = run(["bun", rephrase_path, "--text", task], timeout=20)
    if rc != 0:
        notes.append("rephrase leg: shared CLI failed (%s)" % err.strip()[:120])
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        notes.append("rephrase leg: unparseable CLI output")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("task", nargs="?")
    ap.add_argument("--task-file")
    ap.add_argument("--roots", default="/home/toxic/estate/ranch/ops,/home/toxic/estate/ranch/emergent")
    ap.add_argument("--rephrase", default=os.path.join(HERE, "hibug-rephrase.ts"))
    ap.add_argument("--no-web", action="store_true")
    args = ap.parse_args()
    task = args.task or ""
    if args.task_file:
        task = open(args.task_file).read().strip()
    if not task:
        ap.error("a task string or --task-file is required")
    notes = []
    # Gate first: wrong purpose dies before any search leg runs.
    gate = rephrase(task, args.rephrase, notes)
    if gate is not None and not gate["ok"]:
        print(json.dumps({"task": task, "blocked": True,
                          "blockedReason": gate["blockedReason"]}, indent=2))
        sys.exit(2)
    kws = keywords(task)
    roots = [r for r in args.roots.split(",") if r]
    estate = estate_leg(kws, roots, notes)
    github = github_leg(kws, notes)
    web = [] if args.no_web else web_leg(kws, notes)
    rep = gate or rephrase(task, args.rephrase, notes)
    print(json.dumps({
        "task": task, "blocked": False, "keywords": kws,
        "estateHits": estate, "githubHits": github, "webHits": web,
        "rewritten": rep["text"] if rep else None,
        "triggersBefore": rep["triggersBefore"] if rep else None,
        "triggersAfter": rep["triggersAfter"] if rep else None,
        "notes": notes,
    }, indent=2))


if __name__ == "__main__":
    main()
