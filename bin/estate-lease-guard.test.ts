/**
 * estate-lease-guard TDD — the ghost must NEVER come back.
 *
 * Success cases (all FAIL until the guard + proof-of-violation exist):
 *   1. guard exits 0 when /home/toxic/estate is absent (lease held)
 *   2. guard exits 1 + identifies the re-creator when the ghost appears
 *   3. guard ledger records the violation with owner attribution
 */
import { describe, expect, it, afterAll } from "bun:test";
import { existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GUARD = "/home/toxic/pens/estate/products/estate-ops/bin/estate-lease-guard.ts";
const GHOST = "/home/toxic/estate";

// save current lease state
const existed = existsSync(GHOST);

describe("estate-lease-guard — single-truth lease watch (success cases)", () => {
	it("exits 0 when /home/toxic/estate is absent", async () => {
		// precondition: lease clean
		expect(existsSync(GHOST)).toBe(false);
		const p = Bun.spawnSync(["bun", GUARD], { stdout: "pipe", stderr: "pipe" });
		expect(p.exitCode).toBe(0);
	});

	it("exits 1 and identifies the re-creator when the ghost appears", async () => {
		// create the ghost (simulate a re-creating daemon)
		mkdirSync(GHOST, { recursive: true });
		// a fake daemon process holding the path (a sleep with cwd at ghost)
		const daemon = Bun.spawn(["bash", "-c", "cd /home/toxic/estate && sleep 30"], {
			stdout: "ignore", stderr: "ignore",
		});
		const p = Bun.spawnSync(["bun", GUARD], { stdout: "pipe", stderr: "pipe" });
		expect(p.exitCode).toBe(1);
		const out = (p.stdout.toString() + p.stderr.toString()).toLowerCase();
		expect(out).toContain("lease violation");
		daemon.kill();
	});

	it("records the violation in the guard ledger with the owner", async () => {
		const ledger = "/home/toxic/.local/state/estate-lease-guard/violations.jsonl";
		// live daemon holding the ghost (the re-creator)
		mkdirSync(GHOST, { recursive: true });
		const daemon = Bun.spawn(["python3", "-c", "import time; time.sleep(30)"], { cwd: GHOST, stdout: "ignore", stderr: "ignore" });
		Bun.spawnSync(["bun", GUARD], { stdout: "pipe", stderr: "pipe" });
		daemon.kill();
		expect(existsSync(ledger)).toBe(true);
		const txt = await Bun.file(ledger).text();
		const last = txt.trim().split("\n").at(-1);
		expect(last).toBeTruthy();
		const entry = JSON.parse(last!);
		expect(entry.owner).toBeDefined();
		expect(entry.cmd).toBeDefined();
	});

	afterAll(() => {
		// restore lease state (remove the ghost we created)
		try {
			rmSync(GHOST, { recursive: true, force: true });
		} catch {}
	});
});