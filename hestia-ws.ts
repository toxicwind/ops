#!/usr/bin/env bun
/**
 * hestia-ws — low-latency WebSocket exec lane for hestia (CoreELEC box 246).
 *
 * Why: `hestia-ssh` opens a fresh SSH handshake per command (~100-300ms).
 * This server keeps ONE persistent SSH ControlMaster session to hestia and
 * exposes a WebSocket API so tools/agents hit it with sub-ms routing and the
 * SSH session stays warm. Custom protocol — deeper than the stdio helper.
 *
 * Protocol (JSON over WS):
 *   { "id":1, "op":"exec", "cmd":"cat /path" }        -> { "id":1, "ok":true, "stdout":"", "stderr":"", "status":0 }
 *   { "id":2, "op":"read", "path":"/p", "max":60000 } -> { "id":2, "ok":true, "data":"..." }
 *   { "id":3, "op":"ping" }                            -> { "id":3, "ok":true, "pong":true }
 *   { "id":4, "op":"status" }                          -> { "id":4, "ok":true, "hpd":1, "kodi":4323, ... }
 *
 * Usage:
 *   bun hestia-ws.ts serve --port 25280        # run the WS server (PC side)
 *   bun hestia-ws.ts ping                       # one-shot client test
 *   bun hestia-ws.ts exec "cat /path"           # one-shot client exec via WS
 *   bun hestia-ws.ts status                     # one-shot status via WS
 *
 * The server bridges to hestia over SSH ControlMaster (see hestia-ssh.ts).
 * Port default 25280 (HESTIA_WS_PORT). Bind 0.0.0.0 so fleet/agents reach it.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const HOST = process.env.HESTIA_HOST ?? "10.0.0.246"
const PASS = process.env.HESTIA_PASS ?? "coreelec"
const USER = process.env.HESTIA_USER ?? "root"
const PORT = Number(process.env.HESTIA_WS_PORT ?? "25280")

const CTRL_DIR = process.env.HESTIA_SSH_CTRL_DIR ?? join(tmpdir(), "hestia-ssh")
const CTRL_SOCK = join(CTRL_DIR, `hestia-${USER}@${HOST}`)
if (!existsSync(CTRL_DIR)) mkdirSync(CTRL_DIR, { recursive: true, mode: 0o700 })

const COMMON = [
  "-o", "StrictHostKeyChecking=no",
  "-o", "ConnectTimeout=8",
  "-o", "ControlMaster=auto",
  "-o", `ControlPath=${CTRL_SOCK}`,
  "-o", "ControlPersist=30m",
]

/** Run a command over the persistent SSH ControlMaster session. */
function sshExec(cmd: string): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("sshpass", ["-p", PASS, "ssh", "-T", ...COMMON, `${USER}@${HOST}`, cmd])
    let out = ""
    let err = ""
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (err += d))
    child.on("close", (code) => resolve({ status: code ?? 1, stdout: out, stderr: err }))
    child.on("error", (e) => resolve({ status: 1, stdout: "", stderr: String(e) }))
  })
}

/** Warm the ControlMaster so the first real call is already fast. */
async function warmConnection(): Promise<boolean> {
  const r = await sshExec("echo warm")
  return r.status === 0
}

/** Gather a compact status snapshot from hestia for the status op. */
async function statusSnapshot(): Promise<Record<string, unknown>> {
  const r = await sshExec(
    "echo -n hpd=$(cat /sys/class/amhdmitx/amhdmitx0/hpd_state 2>/dev/null); " +
    "echo -n \" kodi=$(pgrep -c kodi.bin 2>/dev/null)\"; " +
    "echo -n \" phy=$(grep phy_addr /sys/kernel/debug/aocec/cec_status 2>/dev/null | tr -d ' ')\"; " +
    "echo -n \" log=$(grep log_addr /sys/kernel/debug/aocec/cec_status 2>/dev/null | tr -d ' ')\"; " +
    "echo -n \" watcher=$(pgrep -c cec-watcher 2>/dev/null)\"; " +
    "echo -n \" hdidle=$(pgrep -c hd-idle 2>/dev/null)\"; echo",
  )
  const s: Record<string, unknown> = { host: HOST, ts: Date.now() }
  if (r.status === 0) {
    for (const kv of r.stdout.trim().split(" ")) {
      const [k, v] = kv.split("=")
      if (k) s[k] = v
    }
  }
  s.ssh_status = r.status
  return s
}

async function handleOp(msg: any): Promise<Record<string, unknown>> {
  const id = msg?.id ?? null
  const op = msg?.op
  switch (op) {
    case "ping":
      return { id, ok: true, pong: true }
    case "exec": {
      const r = await sshExec(String(msg.cmd ?? ""))
      return { id, ok: r.status === 0, stdout: r.stdout, stderr: r.stderr, status: r.status }
    }
    case "read": {
      const path = String(msg.path ?? "")
      const max = Number(msg.max ?? 60_000)
      const r = await sshExec(`cat ${path}`)
      return { id, ok: r.status === 0, data: r.stdout.slice(0, max), status: r.status }
    }
    case "status":
      return { id, ok: true, ...(await statusSnapshot()) }
    default:
      return { id, ok: false, error: `unknown op: ${op}` }
  }
}

async function serve(): Promise<void> {
  await warmConnection()
  console.error(`[hestia-ws] ControlMaster warm for ${USER}@${HOST} (${CTRL_SOCK})`)
  const server = Bun.serve({
    port: PORT,
    fetch(req, server) {
      if (server.upgrade(req)) return undefined
      return new Response("hestia-ws: WebSocket only", { status: 426 })
    },
    websocket: {
      async message(ws, raw) {
        let msg: any
        try {
          msg = JSON.parse(String(raw))
        } catch {
          ws.send(JSON.stringify({ id: null, ok: false, error: "bad JSON" }))
          return
        }
        try {
          const res = await handleOp(msg)
          ws.send(JSON.stringify(res))
        } catch (e) {
          ws.send(JSON.stringify({ id: msg?.id ?? null, ok: false, error: String(e) }))
        }
      },
    },
  })
  console.error(`[hestia-ws] listening on ws://0.0.0.0:${PORT}`)
  // keep alive
  Bun.sleep(Number.MAX_SAFE_INTEGER)
}

/** Minimal WS client for one-shot CLI use. */
function clientCall(op: string, payload: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
    const id = Date.now()
    const to = setTimeout(() => { ws.close(); reject(new Error("timeout")) }, 10_000)
    ws.onopen = () => ws.send(JSON.stringify({ id, op, ...payload }))
    ws.onmessage = (ev) => { clearTimeout(to); resolve(JSON.parse(String(ev.data))); ws.close() }
    ws.onerror = (e) => { clearTimeout(to); reject(e) }
  })
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === "serve") {
    serve()
  } else if (cmd === "ping") {
    clientCall("ping").then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(e); process.exit(1) })
  } else if (cmd === "status") {
    clientCall("status").then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(e); process.exit(1) })
  } else if (cmd === "exec") {
    clientCall("exec", { cmd: rest.join(" ") }).then((r) => { process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? ""); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(e); process.exit(1) })
  } else if (cmd === "read") {
    clientCall("read", { path: rest[0] ?? "", max: Number(rest[1] ?? 60_000) }).then((r) => { process.stdout.write(r.data ?? ""); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(e); process.exit(1) })
  } else {
    console.error("hestia-ws: usage: serve [--port N] | ping | status | exec <cmd> | read <path> [max]")
    process.exit(1)
  }
}