#!/usr/bin/env bun
/**
 * device-shot — autonomous screenshot for the estate's media devices.
 *
 * Unified capture for hestia (CoreELEC box), the LG TV (webOS), and the
 * Marantz AVR (via the box framebuffer — the AVR is the HDMI sink). Routes to
 * the right capture method per device, converts to an image, and (optionally)
 * feeds it to vision-kit for a measured verdict.
 *
 * Usage:
 *   bun device-shot.ts hestia [--out /tmp/x.png]
 *   bun device-shot.ts lg      [--out /tmp/tv.png]
 *   bun device-shot.ts marantz [--out /tmp/avr.png]
 *   bun device-shot.ts all     # capture all three
 *   bun device-shot.ts hestia --vision "describe the Netflix autoplay"
 */
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { hestiaExec, hestiaPull } from "./hestia-ssh.ts"

const W = 1920
const H = 2160

/** Capture hestia's framebuffer (compressed on-box, gzip busybox-safe). */
async function shotHestia(outPath: string): Promise<boolean> {
  const cap = hestiaExec("cat /dev/fb0 | gzip -1 > /tmp/fb0.raw.gz")
  if (cap.status !== 0) return false
  if (!hestiaPull("/tmp/fb0.raw.gz", "/tmp/hestia-fb0.raw.gz")) return false
  // Decompress via shell redirect (the reliable path — spawnSync buffer status
  // is null for large binary output).
  const dec = spawnSync("bash", ["-c", "gzip -d -f -c /tmp/hestia-fb0.raw.gz > /tmp/hestia-fb0.raw"], { encoding: "utf8" })
  if (dec.status !== 0) return false
  const raw = await Bun.file("/tmp/hestia-fb0.raw").arrayBuffer()
  if (raw.byteLength < 1000) return false
  // Convert BGRA raw -> PPM (RGB).
  const buf = new Uint8Array(raw)
  const rgb = new Uint8Array(W * H * 3)
  for (let i = 0, j = 0; i < buf.length && j < rgb.length; i += 4, j += 3) {
    rgb[j] = buf[i + 2]
    rgb[j + 1] = buf[i + 1]
    rgb[j + 2] = buf[i]
  }
  const ppm = `P6\n${W} ${H}\n255\n`
  writeFileSync(outPath, Buffer.concat([Buffer.from(ppm), Buffer.from(rgb)]))
  return true
}

/** Capture the LG TV via CDP (Page.captureScreenshot). */
function shotLg(outPath: string): boolean {
  const res = spawnSync(
    "bun",
    ["/home/toxic/pens/fleet/devices/lg-fleet/bin/lg-audit.ts", "shot", "--out", outPath],
    { encoding: "utf8" },
  )
  return res.status === 0
}

/** Capture the Marantz AVR (the box framebuffer — the AVR is the HDMI sink). */
async function shotMarantz(outPath: string): Promise<boolean> {
  // The Marantz is the HDMI sink for hestia, so its display = the box's
  // framebuffer. Same capture path as hestia.
  return shotHestia(outPath)
}

async function main() {
  const args = process.argv.slice(2)
  const device = args[0]
  const outIdx = args.indexOf("--out")
  const out = outIdx >= 0 ? args[outIdx + 1] : `/tmp/${device}-shot.ppm`
  const visionIdx = args.indexOf("--vision")
  const visionQ = visionIdx >= 0 ? args.slice(visionIdx + 1).join(" ") : ""

  const targets: { name: string; fn: () => Promise<boolean> }[] = []
  if (device === "hestia" || device === "all") targets.push({ name: "hestia", fn: () => shotHestia(out) })
  if (device === "lg" || device === "all") targets.push({ name: "lg", fn: () => shotLg(out) })
  if (device === "marantz" || device === "all") targets.push({ name: "marantz", fn: () => shotMarantz(out) })

  for (const t of targets) {
    console.error(`[device-shot] capturing ${t.name}...`)
    const ok = await t.fn()
    console.error(`[device-shot] ${t.name}: ${ok ? `saved ${out}` : "FAILED"}`)
    if (visionQ && ok) {
      console.error(`[device-shot] ${t.name}: running vision-kit...`)
      const res = spawnSync(
        "bun",
        ["/home/toxic/pens/ranch/products/vision-kit/agent-loop.mjs", "--before", out],
        { encoding: "utf8", env: { ...process.env, FREEINFERENCE_API_KEY: process.env.FREEINFERENCE_API_KEY ?? "" } },
      )
      process.stdout.write(res.stdout ?? "")
      if (res.stderr) process.stderr.write(res.stderr)
    }
  }
}

await main()