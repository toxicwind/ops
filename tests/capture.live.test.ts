import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// LIVE test (2026-11-08, Thread 7): hits the real bin/capture binary. No mock.
// Contract: full output survives in raw files; the redacted copy is
// shape-preserving (same line count) with zero secrets; exit code preserved.
const CAPTURE = join(import.meta.dir, "../bin/capture");

describe("bin/capture", () => {
	test("redacts shape-preservingly; full raw output survives; exit code preserved", () => {
		const dir = "/tmp/capture-test-" + Date.now();
		// 5000-line fixture, one secret on the LAST line (the old bug: the
		// redactor missed a secret past a truncation boundary).
		const lines: string[] = [];
		for (let i = 0; i < 5000; i++) lines.push(`line ${i}`);
		lines[4999] = "token=github_pat_11AAOYJYI09ZJZEGSqVhxG_dead";
		const fixture = lines.join("\n");

		const r = spawnSync(CAPTURE, ["bash", "-c", `printf '%s\\n' '${fixture}'`], {
			env: { ...process.env, CAPTURE_DIR: dir },
			encoding: "utf-8",
		});
		expect(r.status).toBe(0);

		const files = readdirSync(dir);
		const raw = files.find((f) => f.startsWith("stdout_"))!;
		const red = files.find((f) => f.startsWith("redacted_"))!;
		expect(raw).toBeTruthy();
		expect(red).toBeTruthy();

		const rawText = readFileSync(join(dir, raw), "utf8");
		const redText = readFileSync(join(dir, red), "utf8");

		// Full artifact intact: the secret is present in the raw capture.
		expect(rawText).toContain("github_pat_11AAOYJYI09ZJZEGSqVhxG");
		// Redacted copy has zero secrets.
		expect(redText).not.toContain("github_pat_11AAOYJYI09ZJZEGSqVhxG");
		// Shape-preserving: same line count.
		expect(redText.split("\n").length).toBe(rawText.split("\n").length);
	});

	test("propagates the command's exit code", () => {
		const dir = "/tmp/capture-test-exit-" + Date.now();
		const r = spawnSync(CAPTURE, ["bash", "-c", "echo hi; echo err >&2; exit 3"], {
			env: { ...process.env, CAPTURE_DIR: dir },
			encoding: "utf-8",
		});
		expect(r.status).toBe(3);
		expect(r.stdout).toContain("exit_code:  3");
	});
});