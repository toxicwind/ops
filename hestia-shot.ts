#!/usr/bin/env bun
/**
 * hestia-shot — autonomous screenshot of the CoreELEC box (hestia) TV display.
 *
 * Captures the box's framebuffer (/dev/fb0), converts it to a PNG, and
 * (optionally) feeds it to vision-kit for a measured verdict. Built on the
 * 5-times rule (modular, entrypoint'd, token-friendly).
 *
 * Usage:
 *   bun hestia-shot.ts                       # capture -> /tmp/hestia-shot.png
 *   bun hestia-shot.ts --out /tmp/tv.png     # capture to a path
 *   bun hestia-shot.ts --vision "describe the Netflix autoplay on screen"
 *                                          # capture + vision-kit verdict
 */
import { spawnSync } from "node:child_process"
import { hestiaExec, hestiaPull } from "./hestia-ssh.ts"

const W = 1920
const H = 2160
const BPP = 32
const RAW = "/tmp/fb0.raw"

async function captureBox(): Promise<boolean> {
  // Capture the framebuffer and COMPRESS it on the box (busybox gzip — the
// box's busybox xz rejects -9). A 79MB raw framebuffer becomes a few MB.
  const cap = hestiaExec("cat /dev/fb0 | gzip -1 > /tmp/fb0.raw.gz")
  if (cap.status !== 0) return false
  if (!hestiaPull("/tmp/fb0.raw.gz", "/tmp/hestia-fb0.raw.gz")) return false
  // Decompress locally (binary — must NOT use utf8 encoding).
  const dec = spawnSync("gzip", ["-d", "-f", "-c", "/tmp/hestia-fb0.raw.gz"], { encoding: "buffer" })
  if (dec.status === 0 && dec.stdout && dec.stdout.length > 1000) {
    const { writeFileSync } = await import("node:fs")
    writeFileSync("/tmp/hestia-fb0.raw", dec.stdout)
    return true
  }
  console.error(`[hestia-shot] decompress FAILED (status ${dec.status}, ${dec.stdout?.length ?? 0} bytes)`)
  return false
}

/** Convert the raw framebuffer (BGRA) to a PNG. Needs ffmpeg or a raw->png tool. */
async function rawToPng(rawPath: string, outPath: string): Promise<boolean> {
  // The framebuffer is BGRA 32bpp. Convert via ffmpeg if available, else
  // write a PPM (trivial, no deps).
  const ffmpeg = spawnSync("which", ["ffmpeg"], { encoding: "utf8" })
  if (ffmpeg.status === 0) {
    const res = spawnSync(
      "ffmpeg",
      ["-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${W}x${H}`, "-i", rawPath, "-frames:v", "1", outPath],
      { encoding: "utf8" },
    )
    return res.status === 0
  }
  // Fallback: write a PPM (P6, RGB — drop the alpha byte).
  const buf = await Bun.file(rawPath).arrayBuffer()
  const bytes = new Uint8Array(buf)
  const rgb = new Uint8Array(W * H * 3)
  for (let i = 0, j = 0; i < bytes.length && j < rgb.length; i += 4, j += 3) {
    rgb[j] = bytes[i + 2] // BGR -> RGB
    rgb[j + 1] = bytes[i + 1]
    rgb[j + 2] = bytes[i]
  }
  const ppm = `P6\n${W} ${H}\n255\n`
  await Bun.write(outPath.replace(/\.png$/, ".ppm"), Buffer.concat([Buffer.from(ppm), Buffer.from(rgb)]))
  return true
}

async function main() {
  const args = process.argv.slice(2)
  const outIdx = args.indexOf("--out")
  const out = outIdx >= 0 ? args[outIdx + 1] : "/tmp/hestia-shot.png"
  const visionIdx = args.indexOf("--vision")
  const visionQ = visionIdx >= 0 ? args.slice(visionIdx + 1).join(" ") : ""

  console.error("[hestia-shot] capturing box framebuffer...")
  if (!captureBox()) {
    console.error("[hestia-shot] capture FAILED")
    process.exit(1)
  }
  console.error("[hestia-shot] converting to image...")
  const ok = rawToPng("/tmp/hestia-fb0.raw", out)
  if (!ok) {
    console.error("[hestia-shot] convert FAILED")
    process.exit(1)
  }
  console.error(`[hestia-shot] saved ${out}`)

  if (visionQ) {
    console.error("[hestia-shot] running vision-kit...")
    const visionKit = "/home/toxic/pens/ranch/products/vision-kit"
    const res = spawnSync(
      "bun",
      [join(visionKit, "agent-loop.mjs"), out, visionQ],
      { encoding: "utf8" },
    )
    process.stdout.write(res.stdout ?? "")
    if (res.stderr) process.stderr.write(res.stderr)
  }
}

import { join } from "node:path"
await main()