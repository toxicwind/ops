#!/usr/bin/env bash
# tmp-reaper LOOP — long-running foreground process (pitchfork tracks as running).
# Runs the reap pass every 1h; never exits so the supervisor sees a live daemon.
set -uo pipefail
INTERVAL="${1:-3600}"
while true; do
  /home/toxic/estate/bin/tmp-reaper/reap.sh 24
  sleep "$INTERVAL"
done
