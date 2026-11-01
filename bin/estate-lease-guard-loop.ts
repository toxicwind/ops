#!/usr/bin/env bun
// estate-lease-guard-loop.ts — pitchfork daemon: single-truth lease watchdog.
// No-sleep doctrine: purely event-driven. fs.watch on /home/toxic raises the
// guard the instant the ghost path arrives; no timers, no sleeps, no cadence.
import { existsSync, watch } from "node:fs";

const GHOST = "/home/toxic/estate";
const GUARD = "/home/toxic/pens/estate/products/estate-ops/bin/estate-lease-guard.ts";
let stopping = false;

process.on("SIGTERM", () => {
	stopping = true;
});
process.on("SIGINT", () => {
	stopping = true;
});

async function runOnce(reason: string): Promise<void> {
	const p = Bun.spawnSync(["bun", GUARD, "--kill-owner"], {
		stdout: "inherit",
		stderr: "inherit",
	});
	console.log(
		`[estate-lease-guard] ${reason} -> exit=${p.exitCode} (${new Date().toISOString()})`,
	);
}

// Initial state check at boot (event, not cadence).
await runOnce("startup");

const watcher = watch("/home/toxic", { persistent: true }, (_event, filename) => {
	// Only the ghost path arriving matters; guard re-checks everything itself.
	if (filename === null || filename === "estate") {
		runOnce(`watch: ${filename ?? "(dir event)"}`);
	}
});
watcher.on("error", (err) => {
	console.error("[estate-lease-guard] watcher error", err);
	// Watcher failure must not leave the lease unguarded: fall back to a
	// supervising restart by exiting; pitchfork retry=true respawns us.
	if (!stopping) process.exit(2);
});

console.log("[estate-lease-guard] event-driven guard armed (no timers)");

// Park the process until a stop signal arrives. The watcher holds the event
// loop alive; this promise is resolved directly by the signal handler —
// no timers, no polling, no spin.
const stopPromise = new Promise<void>((resolve) => {
	process.on("SIGTERM", resolve);
	process.on("SIGINT", resolve);
});
await stopPromise;
watcher.close();
console.log("[estate-lease-guard] loop stopped");
process.exit(0);
