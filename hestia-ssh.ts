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

const HOST = process.env.HESTIA_HOST ?? "10.0.0.246"
const PASS = process.env.HESTIA_PASS ?? "coreelec"
const USER = process.env.HESTIA_USER ?? "root"

function sshArgs(cmd: string): string[] {
  return [
    "-p", PASS,
    "ssh", "-T", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=8",
    `${USER}@${HOST}`, cmd,
  ]
}

/** Run a command on hestia, return { status, stdout, stderr }. */
export function hestiaExec(cmd: string): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("sshpass", sshArgs(cmd), { encoding: "utf8" })
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
}

/** Read a remote file, capped at maxBytes (token-friendly for LLM context). */
export function hestiaRead(path: string, maxBytes = 60_000): string {
  const res = hestiaExec(`cat ${path}`)
  if (res.status !== 0) return ""
  return res.stdout.slice(0, maxBytes)
}

/** Copy a local file to a remote path on hestia. */
export function hestiaScp(local: string, remote: string): boolean {
  const res = spawnSync(
    "sshpass",
    ["-p", PASS, "scp", "-o", "StrictHostKeyChecking=no", local, `${USER}@${HOST}:${remote}`],
    { encoding: "utf8" },
  )
  return res.status === 0
}

/** Pull a file FROM hestia to a local path (box -> PC). */
export function hestiaPull(remote: string, local: string): boolean {
  const res = spawnSync(
    "sshpass",
    ["-p", PASS, "scp", "-o", "StrictHostKeyChecking=no", `${USER}@${HOST}:${remote}`, local],
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