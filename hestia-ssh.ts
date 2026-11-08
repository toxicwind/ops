#!/usr/bin/env bun
/**
 * hestia-ssh — canonical sshpass+ssh helper for the CoreELEC box (hestia).
 *
 * The estate's tools hit hestia over sshpass constantly (fluxling, skin
 * hot-reload, settings-gen, kodi tooling). This is the ONE modular helper they
 * all use — no more copy-pasted `sshpass -p coreelec ssh -T ...` inline.
 *
 * - `-T` always (no "stdin is not a terminal" over non-TTY)
 * - token-friendly: `read` caps output, `exec` is one-shot
 * - entrypoint: `bun hestia-ssh.ts <cmd>` or import { hestiaExec, hestiaRead }
 *
 * Usage:
 *   bun hestia-ssh.ts exec "cat /path"          # run a command, print stdout
 *   bun hestia-ssh.ts read /path --max 60000    # read a file, capped (token-friendly)
 *   bun hestia-ssh.ts scp <local> <remote>      # copy a file to the box
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const HOST = process.env.HESTIA_HOST ?? "10.0.0.246"
const PASS = process.env.HESTIA_PASS ?? "coreelec"
const USER = process.env.HESTIA_USER ?? "root"

// SSH ControlMaster socket: one persistent multiplexed connection so every
// hestiaExec reuses the open session instead of a fresh SSH handshake
// (~100-300ms saved per call). This is the low-latency lane for shell exec.
const CTRL_DIR = process.env.HESTIA_SSH_CTRL_DIR ?? join(tmpdir(), "hestia-ssh")
const CTRL_SOCK = join(CTRL_DIR, `hestia-${USER}@${HOST}`)

function ensureCtrlDir(): void {
  if (!existsSync(CTRL_DIR)) mkdirSync(CTRL_DIR, { recursive: true, mode: 0o700 })
}

const COMMON = [
  "-o", "StrictHostKeyChecking=no",
  "-o", "ConnectTimeout=8",
  "-o", "ControlMaster=auto",
  "-o", `ControlPath=${CTRL_SOCK}`,
  "-o", "ControlPersist=10m",
]

function sshArgs(cmd: string): string[] {
  return ["-p", PASS, "ssh", "-T", ...COMMON, `${USER}@${HOST}`, cmd]
}

/** Run a command on hestia via the multiplexed SSH session (low latency). */
export function hestiaExec(cmd: string): { status: number; stdout: string; stderr: string } {
  ensureCtrlDir()
  const res = spawnSync("sshpass", sshArgs(cmd), { encoding: "utf8" })
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
}

/** Open the persistent ControlMaster connection (warm it up). */
export function hestiaConnect(): boolean {
  ensureCtrlDir()
  const res = spawnSync("sshpass", ["-p", PASS, "ssh", "-T", ...COMMON, "-O", "check", `${USER}@${HOST}`], { encoding: "utf8" })
  if (res.status === 0) return true
  // not open yet — open it
  const open = spawnSync("sshpass", ["-p", PASS, "ssh", "-T", ...COMMON, "-N", `${USER}@${HOST}`], { encoding: "utf8", timeout: 8000 })
  return open.status === 0
}

/** Close the persistent ControlMaster connection. */
export function hestiaDisconnect(): boolean {
  const res = spawnSync("sshpass", ["-p", PASS, "ssh", "-T", ...COMMON, "-O", "exit", `${USER}@${HOST}`], { encoding: "utf8" })
  return res.status === 0
}

/** Read a remote file, capped at maxBytes (token-friendly for LLM context). */
export function hestiaRead(path: string, maxBytes = 60_000): string {
  const res = hestiaExec(`cat ${path}`)
  if (res.status !== 0) return ""
  return res.stdout.slice(0, maxBytes)
}

/** Copy a local file to a remote path on hestia (reuses ControlMaster). */
export function hestiaScp(local: string, remote: string): boolean {
  ensureCtrlDir()
  const res = spawnSync(
    "sshpass",
    ["-p", PASS, "scp", ...COMMON, local, `${USER}@${HOST}:${remote}`],
    { encoding: "utf8" },
  )
  return res.status === 0
}

/** Pull a file FROM hestia to a local path (box -> PC, reuses ControlMaster). */
export function hestiaPull(remote: string, local: string): boolean {
  ensureCtrlDir()
  const res = spawnSync(
    "sshpass",
    ["-p", PASS, "scp", ...COMMON, `${USER}@${HOST}:${remote}`, local],
    { encoding: "utf8" },
  )
  return res.status === 0
}

// CLI entrypoint (only when run directly, not when imported).
if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === "exec") {
    const r = hestiaExec(rest.join(" "))
    process.stdout.write(r.stdout)
    if (r.stderr) process.stderr.write(r.stderr)
    process.exit(r.status)
  } else if (cmd === "read") {
    const path = rest[0]
    const maxIdx = rest.indexOf("--max")
    const max = maxIdx >= 0 ? Number(rest[maxIdx + 1] ?? 60_000) : 60_000
    process.stdout.write(hestiaRead(path, max))
  } else if (cmd === "scp") {
    process.exit(hestiaScp(rest[0], rest[1]) ? 0 : 1)
  } else {
    console.error("hestia-ssh: usage: exec <cmd> | read <path> [--max N] | scp <local> <remote>")
    process.exit(1)
  }
}