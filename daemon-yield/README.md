# daemon-yield — supervisor wrapper: idle turns become emergent jobs

**Problem:** the estate daemon goes idle when its turn yields or no-ops.
**Fix (supervisor-level, not a client patch):** this wrapper sits around the
daemon's agent invocation. A turn that ends in yield/no-op with no pending
work triggers a job pull; the highest-value decidable job runs as architect
solving forward (plan → execute → verify → commit → report). The daemon
never idles on a bare yield.

## What this is NOT

- Not a hatch client patch. The hatch binary, its config, and its
  safeguards are never modified.
- Not a stop bypass. Stop, pause, and audit requests terminate the loop
  immediately — they are hard exits, never rerouted, never reframed.
- Not an unbounded loop by default. Bounded mode (`--max-jobs`,
  `--max-minutes`) is how it is proven; the pitchfork unit ships with
  `boot_start = false` and is enabled only after the exits are verified.

## Turn contract

The `--agent-cmd` command reports its terminal state by, in order:
1. Result JSON at `$DAEMON_YIELD_TURN_RESULT`: `state` (done|yield|noop|
   stop|pause|audit|error|blocked), `summary`, `pending_work`, `no_retry`,
   optional `commits`, `verification`.
2. Stdout line `DAEMON_YIELD_STATE: <state>`.
3. Exit code: 0 done, 3 stop, 4 pause, 5 audit, other nonzero error.

A job is handed to the turn via `$DAEMON_YIELD_JOB_FILE` (job JSON path).
A turn carrying a runtime no-retry marker ends this attempt (exit 13);
the supervisor may start a fresh attempt later — that is not a retry of
the same call.

## Job providers (priority order)

1. **oracle** — stalled tasks only: `task_posted` with no later
   assigned/settled/expired/rejected event, older than
   `--oracle-stall-hours` (default 24). Read-only scan of the ledger via
   the estate-master yote route; the wrapper never bids or assigns — a
   stalled task is a bidder-of-last-resort pickup, logged as such.
2. **file-queue** — `queue/*.json`, atomically claimed into `claimed/`.
3. **squawk** — open fleet questions, task-shaped and fresh only
   (default max age 168h; stale or question-shaped items are filtered).
4. **relay** — `relay/*.json` inbox (the main agent feeds chat relays here;
   subagents have no chat namespace).

## Filters (fail closed)

- Boundary filter drops money/spend, credential mint/rotate/print,
  machine-reboot, and hatch-client-modification jobs. Dropped jobs are
  logged, never executed, never deleted.
- Upgrade-class jobs (upgrade/update/restart a daemon or service) run
  only when the canary gate file says `{"status": "pass"}`; a missing gate
  fails closed. Gate default: `~/workspace/nightly-canary/gate.json`.

## Waits

Event-driven first: `inotifywait` on the queue dir, relay dir, and stop
file. Bounded backoff (cap 60s) only where `inotifywait` is absent.
A stop file (`state/stop`) or SIGTERM/SIGINT wakes any wait immediately.

## Routes (master connector)

Built against the estate-master connector
(`custom-connectors/custom.estate-master/`): yote exec with hostname gate
(`awrawr-pc`), thresher status, squawk read/send, gatehouse discovery,
oracle intake, pitchfork status. The wrapper itself handles no keys —
secretsmith is the connector's business, and key values never enter the
wrapper's logs.

## Run it

```bash
# Self-test (pure functions, no turns)
python3 daemon-yield.py --agent-cmd true self-test

# Pull candidates without executing (proves the read paths)
python3 daemon-yield.py --agent-cmd true pull-only
python3 daemon-yield.py --agent-cmd true --only-providers squawk pull-only

# Bounded proof run (see PROOF.md)
python3 daemon-yield.py --agent-cmd "python3 tests/test-turn.py" \
  --state-dir ./state --queue-dir ./queue --claimed-dir ./claimed \
  --only-providers file-queue --max-jobs 1 --max-minutes 10
```

## Enable (Raccoon, after verifying PROOF.md)

1. Copy this directory to `ranch/ops/daemon-yield/` on yote (already the
   commit target) and write the real turn command to `turn.sh`.
2. Set `boot_start = true` and `auto = ["start"]` in `daemon-yield.toml`.
3. Restart via pitchfork, never kill+start. Verify the loop starts, a
   yield pulls a job, and a stop file exits it immediately.

## Files

- `daemon-yield.py` — the wrapper (stdlib only).
- `oracle-scan.py` — yote-side ledger scan (also embedded base64 in the
  wrapper as fallback).
- `daemon-yield.toml` — pitchfork unit, NOT enabled.
- `tests/test-turn.py`, `tests/test-long-turn.py` — proof harnesses.
- `queue/README.md` — job schema. `PROOF.md` — bounded proof results.
