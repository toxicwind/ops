#!/usr/bin/env python3
"""Yote-side oracle scan for daemon-yield.

Reads the oracle ledger and prints stalled task candidates as JSON:
tasks with a task_posted event, no later assigned/settled/expired/rejected
event. The wrapper applies the stall-age horizon and boundary filters.

Deployed to /home/toxic/estate/ranch/ops/daemon-yield/oracle-scan.py on
yote; the wrapper also carries this script inline (base64) as fallback.
"""

import json
import time
from collections import defaultdict

LEDGER = "/home/toxic/estate/ranch/squawk/oracle/ledger/ledger.jsonl"
TERMINAL = {"assigned", "settled", "expired", "rejected", "task_settled"}


def main():
    events = defaultdict(list)
    try:
        with open(LEDGER) as f:
            for line in f:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                t = d.get("task_id")
                if t:
                    events[t].append(d)
    except FileNotFoundError:
        print(json.dumps({"candidates": []}))
        return
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
                text = e.get("text") or e.get("payload") or ""
                if isinstance(text, dict):
                    text = json.dumps(text)
        age_h = None
        if isinstance(posted, (int, float)) and posted > 0:
            stamp = posted / 1000.0 if posted > 1e12 else posted
            age_h = (now - stamp) / 3600.0
        out.append({"task_id": tid, "last_event": last, "age_h": age_h,
                    "text": (text or "")[:400]})
    print(json.dumps({"candidates": out}))


if __name__ == "__main__":
    main()
