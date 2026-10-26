#!/usr/bin/env bun
/**
 * git-credential.ts — canonical git credential helper (Bun/TS).
 * Replaces _secrets_auto_git bash shim. PURE credential protocol on stdout:
 * the ONLY bytes on stdout are `key=value` lines for git. All diagnostics to stderr,
 * so no banner can ever corrupt the credential stream.
 *
 * Modes:
 *  - credential helper: `git credential-<name> get` -> answer from secretsmith keyring
 *  - git wrapper: inject GITHUB_TOKEN into child env, then exec real git
 */
import { spawnSync } from "node:child_process"

function keyringEnv(): Record<string, string> {
  const r = spawnSync(
    "/home/toxic/.local/bin/secretsmith",
    ["env", "--env", "GH_TOKEN=xdg:schema=org.freedesktop.Secret.Generic"],
    { encoding: "utf8" },
  )
  if (r.status !== 0) return {}
  const out: Record<string, string> = {}
  for (const line of (r.stdout ?? "").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^'+|'+$/g, "")
  }
  return out
}

function token(): string | undefined {
  const env = keyringEnv()
  return env["GH_TOKEN"] ?? env["GITHUB_TOKEN"]
}

const args = process.argv.slice(2)
const first = args[0] ?? ""

// credential helper mode
if (first.startsWith("credential-") || first === "credential") {
  if (args.includes("get")) {
    const tok = token()
    if (tok) {
      process.stdout.write(`protocol=https\nhost=github.com\nusername=x-access-token\npassword=${tok}\n`)
      process.exit(0)
    }
  }
  process.exit(1)
}

// git wrapper mode
const REAL_GIT = "/usr/bin/git"
const env = { ...process.env }
const tok = token()
if (tok && !env.GITHUB_TOKEN) env.GITHUB_TOKEN = tok
const res = spawnSync(REAL_GIT, args, { stdio: "inherit", env })
process.exit(res.status ?? 1)
