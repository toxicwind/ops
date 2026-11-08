#!/usr/bin/env bun
/**
 * scaffold-floor — measure the tau/kappa context scaffold floor in cache_read terms.
 *
 * F1/F2 (2026-11-08): the tau session's prompt is 99%+ cache_read because the scaffold
 * (system prompt + AGENTS.md chain + config + tool schemas) is stable. This tool turns
 * that fixed ~96k toll into a tracked number and reports its breakdown.
 *
 * Usage: scaffold-floor [--json]
 */
import { readFileSync, existsSync } from "node:fs";

const TOK_CHARS = 4; // rough; good enough for a floor estimate

function tok(path: string): number {
  if (!existsSync(path)) return 0;
  return Math.ceil(readFileSync(path).length / TOK_CHARS);
}

const breakdown: Array<[string, number]> = [
  ["tau system-prompt.ts", tok("/home/toxic/pens/olympus/products/tau/packages/coding-agent/src/system-prompt.ts")],
  ["root AGENTS.md", tok("/home/toxic/AGENTS.md")],
  ["pens AGENTS.md", tok("/home/toxic/pens/AGENTS.md")],
  ["geode AGENTS.md", tok("/home/toxic/pens/geode/AGENTS.md")],
  ["tau AGENTS.md (pointer)", tok("/home/toxic/.tau/AGENTS.md")],
  ["tau agent AGENTS.md", tok("/home/toxic/.tau/agent/AGENTS.md")],
  ["tau config.yml", tok("/home/toxic/.tau/agent/config.yml")],
];

// tool schemas: ~1.5k chars per tool file is a rough average
const toolsRoot = "/home/toxic/pens/olympus/products/tau/packages/coding-agent/src/tools";
let toolFiles = 0;
try {
  const { execSync } = await import("node:child_process");
  const out = execSync(`find ${toolsRoot} -name "*.ts" 2>/dev/null | wc -l`).toString().trim();
  toolFiles = Number(out) || 0;
} catch {}
const toolTok = Math.ceil(toolFiles * 1500 / TOK_CHARS);
breakdown.push([`tools (${toolFiles} files, ~1.5k chars avg)`, toolTok]);

const total = breakdown.reduce((s, [, n]) => s + n, 0);
const observed = 96000; // from tau SSE: cache_read plateau

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ breakdown: Object.fromEntries(breakdown), estimatedFloor: total, observedFloorCacheRead: observed }, null, 2));
} else {
  for (const [name, n] of breakdown) console.log(`  ${name}: ${n.toLocaleString()} tok`);
  console.log(`  ---`);
  console.log(`  ESTIMATED FLOOR: ${total.toLocaleString()} tok`);
  console.log(`  OBSERVED (cache_read plateau, tau SSE): ${observed.toLocaleString()} tok`);
  console.log(`  breakdown: system-prompt ${breakdown[0][1].toLocaleString()} + AGENTS chain ${breakdown.slice(1,7).reduce((s,[,n])=>s+n,0).toLocaleString()} + tools ${toolTok.toLocaleString()}`);
}
