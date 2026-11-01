# File-queue job schema (daemon-yield)

Drop one JSON file per job into `queue/`. The wrapper claims it atomically
(rename into `claimed/`) before executing, so no two loops run it twice.

```json
{
  "id": "job-001",
  "source": "file-queue",
  "title": "Short human-readable title",
  "prompt": "The full job text. Must be decidable work: no money, no credential mint/rotate/print, no machine reboot, no hatch-client modification.",
  "created_at": "2026-10-27T00:00:00Z"
}
```

Jobs failing the boundary filter are logged (job_filtered) and left in
place for a human to inspect — the wrapper never executes them and never
deletes them. Upgrade-class jobs (upgrade/update/restart a daemon or
service) additionally require the canary gate file to say `{"status":
"pass"}`; a missing gate fails closed.
