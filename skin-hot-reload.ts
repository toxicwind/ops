#!/usr/bin/env bun
/**
 * skin-hot-reload — live UX hot-reload for the skin.eternal Kodi skin.
 *
 * Full flow (not a monkey-patch): watches the estate source of truth for
 * skin.eternal, rsyncs the changed file to hestia, then re-renders the live
 * Kodi home window via JSON-RPC. A UX change in the repo shows on the TV
 * within ~150ms of save.
 *
 * Usage:
 *   bun skin-hot-reload.ts
 *   bun skin-hot-reload.ts --host 10.0.0.246 --port 25270
 */
import { watch } from "node:fs"
import { join } from "node:path"
import { hestiaScp } from "./hestia-ssh.ts"

const HOST = process.env.HESTIA_HOST ?? "10.0.0.246"
const PORT = process.env.HESTIA_RPC_PORT ?? "25270"
const RPC = `http://${HOST}:${PORT}/jsonrpc`
const SRC_DIR =
  process.env.SKIN_SRC_DIR ??
  "/home/toxic/pens/estate/devices/coreelec/addons/skin.eternal"
const BOX_DIR = "/storage/.kodi/addons/skin.eternal"

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const body = await res.json().catch(() => ({}))
  return (body as { result?: unknown }).result
}

let debounce: ReturnType<typeof setTimeout> | null = null
function scheduleReload(file: string) {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(async () => {
    const t0 = Date.now()
    const rel = file.replace(SRC_DIR + "/", "")
    console.log(`[skin-hot-reload] change: ${rel}`)
    // Sync the changed file to hestia (the live box) via the canonical helper.
    const src = join(SRC_DIR, rel)
    if (!hestiaScp(src, `${BOX_DIR}/${rel}`)) {
      console.error(`[skin-hot-reload] sync FAILED: ${rel}`)
      return
    }
    // Re-render the active home window live (layout changes apply instantly).
    const r = await rpc("GUI.ActivateWindow", { window: "home" })
    console.log(
      `[skin-hot-reload] synced + home re-rendered (${Date.now() - t0}ms) → ${JSON.stringify(r)}`,
    )
  }, 150)
}

console.log(`[skin-hot-reload] watching ${SRC_DIR} → hestia:${HOST}:${PORT}`)
watch(SRC_DIR, { recursive: true }, (_event, filename) => {
  if (!filename) return
  const f = String(filename)
  if (f.endsWith(".xml") || f.endsWith(".css") || f.endsWith(".json")) {
    scheduleReload(f)
  }
})
setInterval(() => {}, 1 << 30)