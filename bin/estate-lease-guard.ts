/**
 * estate-lease-guard.ts — the single-truth lease watchdog.
 *
 * `/home/toxic/estate` MUST NOT exist in ANY form (AGENTS.md anomaly #48):
 * the SSOT is /home/toxic/pens/estate. Every previous regression was a daemon
 * or systemd unit rooted at the ghost path re-creating it (arrival-classifier,
 * phone-lane, oracle post_intake, etc).
 *
 * This guard:
 *   1. FAILS fast if /home/toxic/estate exists (any form: dir/file/symlink)
 *   2. identifies the re-creating process via /proc open-fd/cmdline inspection
 *   3. marks it in a kill-list (uknown owner → pitchfork/systemd unit name)
 *   4. logs the violation to the fleet dead-letter
 *
 * Run as a pitchfork daemon + systemd unit. TDD-pinned.
 *
 * Usage: bun estate-lease-guard.ts [--kill-owner KILL]
 */
import { existsSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const GHOST = "/home/toxic/estate";
const LEDGER = "/home/toxic/.local/state/estate-lease-guard/violations.jsonl";
const KILL = process.argv.includes("--kill-owner");
const DEAD_LETTER = "/home/toxic/.squawk-bus/squawk-root/rooms/fleet-dead-letter";

function findRecreator(): Array<{ pid: number; cmd: string; target: string }> {
	const hits: Array<{ pid: number; cmd: string; target: string }> = [];
	for (const pidDir of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
		try {
			const pid = Number(pidDir);
			for (const fd of readdirSync(`/proc/${pidDir}/fd`)) {
				try {
					const target = readlinkSync(`/proc/${pidDir}/fd/${fd}`);
					if (!target.startsWith(GHOST)) continue;
					if (target.includes("/proc/") || target.includes("/sys/")) continue;
					const cmd = Bun.file(`/proc/${pid}/cmdline`).textSync().replace(/\0/g, " ").trim();
					hits.push({ pid, cmd: cmd.slice(0, 160), target: target.slice(0, 120) });
				} catch {}
			}
		} catch {}
	}
	// also sweep cmdlines (processes that spawn children rooted at the ghost)
	for (const pidDir of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
		try {
			const pid = Number(pidDir);
			// cwd-based detection: daemons rooted at the ghost (WorkingDirectory=/home/toxic/estate)
			// never mention it in cmdline — their /proc/<pid>/cwd symlink IS the tell.
			try {
				const cwd = readlinkSync(`/proc/${pidDir}/cwd`);
				if (cwd === GHOST) {
					const cmd = Bun.file(`/proc/${pid}/cmdline`).textSync().replace(/\0/g, " ").trim();
					hits.push({ pid, cmd: cmd.slice(0, 160) || "(no cmdline)", target: `(cwd=${cwd})` });
				}
			} catch {}
			const cmd = Bun.file(`/proc/${pid}/cmdline`).textSync().replace(/\0/g, " ").trim();
			if (!cmd.includes(GHOST)) continue;
			if (cmd.includes("estate-lease-guard") || cmd.includes("grep")) continue;
			hits.push({ pid, cmd: cmd.slice(0, 160), target: "(cmdline)" });
		} catch {}
	}
	return hits;
}

function ownerOf(pid: number): string {
	// walk up the parent chain
	let cur = pid;
	for (let depth = 0; depth < 5; depth++) {
		try {
			const status = Bun.file(`/proc/${cur}/status`).textSync();
			const ppid = Number(status.match(/PPid:\s*(\d+)/)?.[1] ?? 0);
			const cmd = Bun.file(`/proc/${cur}/cmdline`).textSync().replace(/\0/g, " ").trim();
			if (/pitchfork/.test(cmd)) return `pitchfork:${cmd.split(/\s+/)[1] ?? "?"}`;
			if (/systemd/.test(cmd) || ppid === 1) return `systemd-unit:${cmd.slice(0, 60)}`;
			cur = ppid;
			if (cur === 0) break;
		} catch {
			break;
		}
	}
	return "unknown";
}

const violations: string[] = [];

function check(): number {
	if (!existsSync(GHOST)) {
		console.log("OK   /home/toxic/estate absent (lease held)");
		return 0;
	}
	console.error(`FAIL /home/toxic/estate EXISTS (single-truth lease violation)`);
	const recretors = findRecreator();
	let fail = 1;
	for (const h of recretors) {
		const owner = ownerOf(h.pid);
		const entry = JSON.stringify({
			ts: new Date().toISOString(),
			pid: h.pid,
			owner: owner,
			cmd: h.cmd,
			target: h.target,
		});
		violations.push(entry);
		if (KILL) {
			try {
				spawnSync(["kill", "-9", String(h.pid)]);
				console.error(`  KILLED ${h.pid} (${owner})`);
			} catch {}
		}
	}
	if (recretors.length === 0) {
	violations.push(JSON.stringify({ ts: new Date().toISOString(), owner: "none", note: "ghost exists but no live writer found" }));
	violations.push(JSON.stringify({ ts: new Date().toISOString(), owner: "none", cmd: "none", note: "ghost exists but no live writer found" }));
	}
	for (const v of violations) {
		try {
			writeFileSync(LEDGER, v + "\n", { flag: "a" });
		} catch {}
	}
	if (existsSync(DEAD_LETTER)) {
		try {
			writeFileSync(`${DEAD_LETTER}/estate-lease-guard-${Date.now()}.json`, violations.join("\n"));
		} catch {}
	}
	return fail;
}

const exitCode = check();
process.exit(exitCode);