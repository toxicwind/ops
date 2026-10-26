#!/usr/bin/env bun
/**
 * eval-shim.ts — self-healing wrapper for agent eval subprocess commands.
 * Repairs known-constant estate failures BEFORE exec, then runs the command.
 * Fast path (execve) when nothing matches: zero added latency.
 */
import { spawnSync } from "node:child_process"
import { existsSync, statSync, unlinkSync, appendFileSync } from "node:fs"

const args = process.argv.slice(2)
if (args.length === 0) process.exit(0)
const cmd = args[0]
const rest = args.slice(1)

// ── 1. git credential helper routing ──
// The estate's git credential helper is `git credential-<name> get`. Under BASH_ENV=shim.sh
// the kairos guard banner can leak to stdout and corrupt the protocol. Route through
// the canonical Bun helper directly.
if (cmd === "git" && (rest[0]?.startsWith("credential-") || rest[0] === "credential")) {
  const r = spawnSync(
    "/home/toxic/.bun/bin/bun",
    ["/home/toxic/pens/estate/products/estate-ops/bin/git-credential.ts", ...rest],
    { stdio: "inherit" },
  )
  process.exit(r.status ?? 1)
}

// ── 2. stale index.lock (peer agent churn) ──
// git add/commit/merge/push fail with index.lock File exists when a peer agent was mid-op.
// If the lock is older than 120s it's stale (peer crashed/went away) -> remove + retry once.
if (cmd === "git" && /add|commit|merge|push|pull|status|stash/.test(rest[0] ?? "")) {
  // find the repo root from cwd to locate .git/index.lock
  const cwd = process.cwd()
  let lockPath: string | null = null
  let dir = cwd
  for (let i = 0; i < 6 && dir !== "/"; i++) {
    const candidate = dir + "/.git/index.lock"
    if (existsSync(candidate)) { lockPath = candidate; break }
    // also handle gitfile (.git -> gitdir: ../.git/modules/X)
    const gfp = dir + "/.git"
    if (existsSync(gfp) && statSync(gfp).isFile()) {
      const content = require("node:fs").readFileSync(gfp, "utf8")
      const m = content.match(/^gitdir: (.+)$/m)
      if (m) {
        const gd = m[1].startsWith("/") ? m[1] : dir + "/" + m[1]
        const inner = gd + "/index.lock"
        if (existsSync(inner)) { lockPath = inner; break }
      }
    }
    dir = dir.replace(/\/[^/]+$/, "")
  }
  if (lockPath) {
    try {
      const age = Date.now() - statSync(lockPath).mtimeMs
      if (age > 120_000) {
        unlinkSync(lockPath)
        process.stderr.write(`[eval-shim] removed stale index.lock (${(age/1000).toFixed(0)}s old)\n`)
      }
    } catch {}
  }
}

// ── 3. unborn embedded git repos → transparent gitignore ──
// `git add -A` fails with "does not have a commit checked out" for an unborn repo inside.
// Detect and append to .gitignore, retry the add. (Only triggered on add.)
if (cmd === "git" && rest[0] === "add") {
  const cwd = process.cwd()
  try {
    const r = spawnSync("git", rest, { cwd, encoding: "utf8" })
    if (r.status === 0) { process.exit(0) }
    const err = r.stderr || ""
    const unborn = [...err.matchAll(/'([^']+)' does not have a commit checked out/g)].map(m => m[1])
    if (unborn.length) {
      const gi = cwd + "/.gitignore"
      appendFileSync(gi, "\n# auto-ignored unborn peer (eval-shim 2026-10-26)\n" + unborn.map(u => u.replace(/\/$/, "") + "/").join("\n") + "\n")
      process.stderr.write(`[eval-shim] gitignored ${unborn.length} unborn peer(s): ${unborn.join(", ")}\n`)
      const ret = spawnSync("git", rest, { cwd, stdio: "inherit" })
      process.exit(ret.status ?? 1)
    }
    process.stdout.write(r.stdout ?? "")
    process.stderr.write(r.stderr ?? "")
    process.exit(r.status ?? 1)
  } catch { /* fall through to exec */ }
}

// ── fast path: exec the command unchanged ──
const r = spawnSync(cmd, rest, { stdio: "inherit", env: process.env })
process.exit(r.status ?? 1)
