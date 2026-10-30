# PROOF.md — daemon-yield bounded proof (2026-10-27, cell)

All runs against the final code in this directory. The unbounded loop was
never enabled; every run below is bounded or a stop test.

## 1. Self-test — PASS

`python3 daemon-yield.py --agent-cmd true self-test`
→ `{"total": 14, "failures": []}` — state parsing, exit-code mapping,
no-retry markers, boundary filter, upgrade/task-shape classification.

## 2. Bounded end-to-end: yield picks a real job and executes it — PASS

Three separate bounded runs (`--only-providers file-queue --max-jobs 1
--max-minutes 10`, turn command `tests/test-turn.py`):

| Job | Result |
|---|---|
| proof-job-001 | picked on yield → executed → state done (self-test 14/14) → bounded-complete, jobs_done 1, claimed |
| proof-job-002 | same, after the stop fixes (no regression) |
| proof-job-003 | same, on the final code (after all patches) |

Each run's log shows `loop_start → job_picked → job_start → job_end
(state done, verification note written) → loop_exit bounded-complete`,
and the job file moved `queue/ → claimed/` atomically.

## 3. Stop-file hard exit — PASS

With `state/stop` present, the wrapper exited immediately (0s, no turn
run): exit code **10**, log `loop_exit hard-exit:stop-file`.

## 4. SIGTERM during a long turn — PASS (after fixes)

With `tests/test-long-turn.py` as the turn command, SIGTERM to the
wrapper: exit code **10**, exit latency **177ms**, log `loop_exit
hard-exit:stop`, **no orphan child** (the worker process group was
killed with the wrapper).

## 5. Provider read paths (`pull-only`) — PASS

- **oracle**: scan ran clean (no provider failure logged), zero stalled
  candidates. The 9 possibly-open tasks from a crude ledger scan are
  assigned/in-flight or under the 24h stall horizon, so none is
  pickup-eligible. The scan runs via the estate-master yote route, with
  the embedded base64 scan as fallback until `oracle-scan.py` is deployed
  on yote (this commit deploys it).
- **file-queue**: listed the seeded job with id/source/title.
- **squawk**: found open question `q6ac32ce1-e0c4` and filtered it as
  `stale` (542h old > 168h max) — correctly yielding no job.
- **relay**: inbox absent → skipped (no failure).

## 6. Bugs found by proofing and fixed in this code

Honest record — the proof earned these fixes:

1. **Stop could not interrupt a turn.** `communicate()` blocked until
   the child exited or the 600s timeout. Fix: communicate on a thread;
   the main loop polls the stop flag every 0.5s and terminates the turn.
2. **Shell-wrapped turns orphaned grandchildren.** `shell=True` means
   the real worker is a grandchild; terminating the shell left it
   running. Fix: `start_new_session=True` + whole-process-group kill
   (SIGTERM, 5s grace, SIGKILL) on stop and on turn timeout.
3. **Stop during idle waits took up to 30s.** Fix: `inotifywait` chunks
   cut from 30s to 5s, so a stop wakes the wait promptly.
4. **Provider calls could hang on pipe-holding grandchildren.**
   Fix: `run_captured()` runs providers in their own session and kills
   the group on timeout.
5. **`--only-providers` swallowed the command.** `nargs="*"` greedily
   consumed `pull-only`, so several "hangs" were actually the unbounded
   loop running with the dummy `true` command. Diagnosed via a
   faulthandler stack dump. Fix: comma-separated single value.
6. **`squawk` is not on PATH for subprocesses.** Fix: resolve to
   `~/workspace/bin/squawk` when present.

Two proof-harness mistakes (not wrapper defects): shell `&` precedence
putting the wrapper in the wrong job, and `pkill -f` matching the
test's own shell. Both are recorded here so the next proof run avoids
them: background with `;` separators, match PIDs exactly.

## 7. NOT proven / left for the enabler

- The unbounded loop with the REAL daemon turn command (the unit's
  `turn.sh` does not exist yet — Raccoon writes it at enable time).
- Oracle stalled-task execution (no stalled task existed at proof time;
  the path is implemented and read-proven, not execution-proven).
- Squawk task-shaped execution (the only open question was stale).
- The pitchfork unit is checkpointed only (`boot_start = false`).
  Enable steps are in README.md; Raccoon enables after verifying this
  file.
