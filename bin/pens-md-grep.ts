#!/usr/bin/env bun
// pens-md-grep.ts — fast concurrent grep over all pens md files with the
// estate prune list baked in.
//
// Root-cause history (2026-11-06): naive `grep -r` and naive bun walkers took
// minutes because pens carries ~7M inodes of vendored/archive trees
// (ranch/archive 3.4M, range/examples 991k, nim-repos 1M, hatch 757k).
// This tool prunes those subtrees, skips md >4MB (concat dumps, session logs),
// and searches bytes not utf8 strings. 998 files/11.5s measured.
//
// Usage: bun pens-md-grep.ts <pattern> [outdir]
//   pattern: regex (case-insensitive)
//   outdir:  default /tmp/kilo — writes pens-md-grep-<slug>.md
//
// Prune list lives in PRUNE; extend it when new vendored monsters land.

import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["/home/toxic/pens", "/home/toxic/.tau", "/home/toxic/.kappa"];

const PRUNE = new Set([
	// universal build/vcs junk
	"node_modules", ".git", "target", ".venv", "dist", "build", ".next",
	"bazel-tau", "bazel-out", "bazel-bin", "bazel-genfiles",
	// measured inode monsters (2026-11-06 du --inodes audit)
	"archive", "vendor", "nim-repos", ".ffs",
]);

const MAX_FILE = 4 * 1024 * 1024;

const pattern = process.argv[2];
if (!pattern) {
	console.error("usage: bun pens-md-grep.ts <pattern> [outdir]");
	process.exit(2);
}
const needle = new RegExp(pattern, "i");
const outdir = process.argv[3] ?? "/tmp/kilo";

function* walk(dir: string, depth = 0): Generator<string> {
	if (depth > 14) return;
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const e of entries) {
		if (PRUNE.has(e)) continue;
		const p = join(dir, e);
		let st;
		try {
			st = statSync(p);
		} catch {
			continue;
		}
		if (st.isDirectory()) yield* walk(p, depth + 1);
		else if (e.endsWith(".md")) yield p;
	}
}

type Hit = { file: string; lines: string[] };
const hits: Hit[] = [];
let scanned = 0;
let bigSkipped = 0;

const files: string[] = [];
for (const root of ROOTS) files.push(...walk(root));

let idx = 0;
function worker() {
	while (idx < files.length) {
		const f = files[idx++];
		try {
			if (statSync(f).size > MAX_FILE) {
				bigSkipped++;
				continue;
			}
			const buf = readFileSync(f);
			if (!needle.test(buf.toString("latin1"))) continue;
			const matched: string[] = [];
			for (const [i, line] of buf.toString("utf8").split("\n").entries()) {
				if (needle.test(line)) matched.push(`${f}:${i + 1}: ${line.slice(0, 400)}`);
			}
			if (matched.length > 0) hits.push({ file: f, lines: matched });
			scanned++;
		} catch {
			// unreadable — skip
		}
	}
}

const t0 = performance.now();
await Promise.all(Array.from({ length: 16 }, worker));
const secs = ((performance.now() - t0) / 1000).toFixed(1);

const slug = pattern.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "hits";
const out = `${outdir}/pens-md-grep-${slug}.md`;
let body = `# pens md grep: /${pattern}/i\n\nscanned=${scanned} hitFiles=${hits.length} bigSkipped=${bigSkipped} time=${secs}s\n\n`;
for (const h of hits) body += `## ${h.file}\n${h.lines.join("\n")}\n\n`;
writeFileSync(out, body);
console.log(`scanned=${scanned} hitFiles=${hits.length} bigSkipped=${bigSkipped} time=${secs}s`);
console.log(`out=${out}`);
