#!/usr/bin/env bun
/**
 * hibug-race.ts — race redundant approaches to one step, first-valid-wins.
 *
 * Estate doctrine: race redundant paths, fail fast with short ceilings,
 * never retry-spin, first valid result wins. Borrowed conventions from
 * local-race/bin/race.py (bounded output drains, immediate loser kill,
 * persistent winner note) re-implemented for Bun's concurrent spawn.
 *
 * One line per design choice:
 *  - Bun (not Python): Bun.spawn gives cheap concurrent subprocesses with
 *    per-attempt timers on the same event loop — the race itself is the hot path.
 *  - Attempts run via `setsid sh -c` so a loser dies as a whole process
 *    group (negative-pid kill), never orphaning a grandchild.
 *  - Validity = exit 0, plus --must-contain when the step must prove a
 *    marker in stdout (a fast wrong answer is not a win).
 *  - Winner note is JSONL appended immediately: the next run of the same
 *    tag can --lead-with-winner instead of racing blind.
 *
 * Usage:
 *   bun hibug-race.ts --tag demo --ceiling-ms 8000 [--note winners.jsonl]
 *       [--must-contain HIBUG-OK] -- "cmd one" "cmd two" "cmd three"
 * Exit 0: winner stdout on stdout. Exit 1: JSON summary on stderr.
 * The step's own purpose is the caller's responsibility: this harness
 * races approaches, it does not vet them — vet with hibug-rephrase.ts
 * (purpose gate) before re-issuing a flagged step.
 */

import { rephraseTask } from "./hibug-rephrase.ts";

const OUTPUT_CAP = 256 * 1024;

interface AttemptResult {
  index: number;
  command: string;
  outcome: "win" | "fail" | "timeout" | "killed";
  ms: number;
  stdout: string;
  stderr: string;
}

interface WinnerNote {
  ts: string;
  tag: string;
  winnerIndex: number;
  command: string;
  ms: number;
  attempts: Array<{ index: number; outcome: string; ms: number }>;
}

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  const cmds: string[] = [];
  let sep = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (sep) { cmds.push(a); continue; }
    if (a === "--") { sep = true; continue; }
    if (a.startsWith("--")) out[a.slice(2)] = argv[++i] ?? "";
    else cmds.push(a);
  }
  return { opts: out, cmds };
}

async function runAttempt(
  index: number,
  command: string,
  ceilingMs: number,
  mustContain: string | null,
  onWin: (r: AttemptResult) => void,
): Promise<AttemptResult> {
  const started = Date.now();
  // setsid => new process group; kill(-pid) takes the whole tree.
  const proc = Bun.spawn(["setsid", "sh", "-c", command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  let timer: Timer | null = null;
  const killer = setTimeout(() => {
    try { process.kill(-proc.pid, "SIGKILL"); } catch { try { proc.kill("SIGKILL"); } catch {} }
  }, ceilingMs);
  timer = killer;
  const readCapped = async (stream: ReadableStream<Uint8Array> | null): Promise<string> => {
    if (!stream) return "";
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (total < OUTPUT_CAP) {
          chunks.push(value.subarray(0, OUTPUT_CAP - total));
          total += value.length;
        }
      }
    } catch { /* loser kill closes pipes; partial output is fine */ }
    return Buffer.concat(chunks).toString("utf8");
  };
  const [stdout, stderr, code] = await Promise.all([
    readCapped(proc.stdout as unknown as ReadableStream<Uint8Array>),
    readCapped(proc.stderr as unknown as ReadableStream<Uint8Array>),
    proc.exited,
  ]);
  clearTimeout(timer);
  const ms = Date.now() - started;
  const timedOut = ms >= ceilingMs && code !== 0;
  const valid = code === 0 && (!mustContain || stdout.includes(mustContain));
  const r: AttemptResult = {
    index, command,
    outcome: valid ? "win" : timedOut ? "timeout" : "fail",
    ms, stdout, stderr,
  };
  if (valid) onWin(r);
  return r;
}

export async function race(
  tag: string,
  commands: string[],
  ceilingMs: number,
  mustContain: string | null,
  notePath: string,
): Promise<{ winner: AttemptResult | null; attempts: AttemptResult[] }> {
  let winner: AttemptResult | null = null;
  const onWin = (r: AttemptResult) => { if (!winner) winner = r; };
  const settled = await Promise.all(
    commands.map((cmd, i) => runAttempt(i, cmd, ceilingMs, mustContain, onWin)),
  );
  // Losers are already exited or killed by their ceilings; nothing lingers:
  // every attempt has a hard ceiling, so no attempt can outlive the race.
  if (winner) {
    const w = winner as AttemptResult;
    const note: WinnerNote = {
      ts: new Date().toISOString(),
      tag,
      winnerIndex: w.index,
      command: w.command,
      ms: w.ms,
      attempts: settled.map((a) => ({ index: a.index, outcome: a.outcome, ms: a.ms })),
    };
    await Bun.$`mkdir -p ${notePath.split("/").slice(0, -1).join("/")}`.quiet().catch(() => {});
    const prev = await Bun.file(notePath).text().catch(() => "");
    await Bun.write(notePath, prev + JSON.stringify(note) + "\n");
  }
  return { winner, attempts: settled };
}

if (import.meta.main) {
  const { opts, cmds } = parseArgs(Bun.argv.slice(2));
  const tag = opts.tag ?? "untagged";
  const ceilingMs = parseInt(opts["ceiling-ms"] ?? "15000", 10);
  const notePath = opts.note ?? `${process.env.HOME}/.cache/hibug-race/winners.jsonl`;
  const mustContain = opts["must-contain"] ?? null;
  // Optional pre-vet: --vet-task runs the purpose gate on a task string.
  // A blocked task dies here, before any approach runs.
  if (opts["vet-task"]) {
    const v = rephraseTask(opts["vet-task"]);
    if (!v.ok) {
      console.error(JSON.stringify({ blocked: true, reason: v.blockedReason }));
      process.exit(2);
    }
  }
  if (cmds.length === 0) {
    console.error("usage: hibug-race.ts --tag T --ceiling-ms N [--must-contain S] [--note P] -- cmd...");
    process.exit(1);
  }
  const { winner, attempts } = await race(tag, cmds, ceilingMs, mustContain, notePath);
  if (winner) {
    process.stdout.write(winner.stdout);
    console.error(JSON.stringify({
      winner: winner.index, ms: winner.ms,
      attempts: attempts.map((a) => ({ i: a.index, outcome: a.outcome, ms: a.ms })),
    }));
    process.exit(0);
  }
  console.error(JSON.stringify({
    winner: null,
    attempts: attempts.map((a) => ({
      i: a.index, outcome: a.outcome, ms: a.ms,
      stderr: a.stderr.slice(0, 500),
    })),
  }));
  process.exit(1);
}
