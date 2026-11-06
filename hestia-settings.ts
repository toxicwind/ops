#!/usr/bin/env bun
/**
 * hestia-settings — real-DB settings tool for the CoreELEC box (hestia).
 *
 * JSON-RPC `Settings.GetSettingValue` lies for many ids (Invalid params /
 * cached values). The REAL ground truth is the XML DB on the box:
 *   - guisettings: /storage/.kodi/userdata/guisettings.xml
 *   - addon:       /storage/.kodi/userdata/addon_data/<addon>/settings.xml
 *
 * All reads are cat-based via hestia-ssh (dir ops over ssh hang — never use
 * ls/grep/wc remotely). Writes are surgical single-line edits with a
 * timestamped backup pushed to the box first, then a best-effort
 * `Settings.SetSettingValue` RPC nudge for live-apply (some ids are XML-only;
 * full apply may need a Kodi restart).
 *
 * Usage:
 *   bun hestia-settings.ts get <id> [--addon <addon>]
 *   bun hestia-settings.ts set <id> <value> [--addon <addon>]
 *   bun hestia-settings.ts list [--grep <pattern>] [--addon <addon>]
 *   bun hestia-settings.ts pull [--addon <addon>] [--out <path>]
 *   bun hestia-settings.ts push <local> [--addon <addon>]
 */
import { hestiaExec, hestiaRead, hestiaScp, hestiaPull } from "./hestia-ssh.ts"

const RPC = "http://10.0.0.246:25270/jsonrpc"
const GUISETTINGS = "/storage/.kodi/userdata/guisettings.xml"
const addonPath = (addon: string) =>
  `/storage/.kodi/userdata/addon_data/${addon}/settings.xml`

export function settingsPath(addon?: string): string {
  return addon ? addonPath(addon) : GUISETTINGS
}

export interface HestiaSetting {
  id: string
  value: string
  isDefault: boolean
  attrs: string
}

/** Parse all `<setting id="...">` entries from guisettings-style XML. */
export function parseSettings(xml: string): HestiaSetting[] {
  const out: HestiaSetting[] = []
  for (const m of xml.matchAll(/[ \t]*<setting id="([^"]+)"([^>]*)>([^<]*)</g)) {
    out.push({
      id: m[1],
      attrs: m[2],
      value: m[3],
      isDefault: /default="true"/.test(m[2]),
    })
  }
  return out
}

/** Cat-read the settings XML from the box (never dir ops over ssh). */
export function hestiaSettingsLoad(addon?: string): string {
  return hestiaRead(settingsPath(addon), 400_000)
}

/** get: print `id = value` (+ default marker). */
export function hestiaSettingsGet(id: string, addon?: string): HestiaSetting | undefined {
  const xml = hestiaSettingsLoad(addon)
  const found = parseSettings(xml).filter((s) => s.id === id)
  for (const s of found) {
    console.log(`${s.id} = ${s.value}${s.isDefault ? "  [default]" : ""}`)
  }
  return found[0]
}

/** list: cat + local filter, capped output (token-friendly). */
export function hestiaSettingsList(
  grep?: string,
  addon?: string,
  maxLines = 200,
): HestiaSetting[] {
  const xml = hestiaSettingsLoad(addon)
  const all = parseSettings(xml)
  const re = grep ? new RegExp(grep, "i") : null
  const hits = re ? all.filter((s) => re.test(s.id) || re.test(s.value)) : all
  for (const s of hits.slice(0, maxLines)) {
    console.log(`${s.id} = ${s.value}${s.isDefault ? "  [default]" : ""}`)
  }
  if (hits.length > maxLines) console.log(`... (${hits.length - maxLines} more)`)
  return hits
}

/** Best-effort live-apply nudge via JSON-RPC. Returns false if RPC rejects. */
export function hestiaSettingsRpcApply(
  id: string,
  value: string,
): { ok: boolean; detail: string } {
  const v = value === "true" ? true : value === "false" ? false : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "Settings.SetSettingValue",
    params: { setting: id, value: v },
  })
  const proc = Bun.spawnSync(
    ["curl", "-s", "-m", "5", "-H", "Content-Type: application/json", "-d", body, RPC],
    { encoding: "utf8" },
  )
  const out = proc.stdout.toString()
  if (out.includes('"error"')) return { ok: false, detail: out.slice(0, 200) }
  if (out.includes('"result"')) return { ok: true, detail: out.slice(0, 200) }
  return { ok: false, detail: `no result: ${out.slice(0, 200)}` }
}

/** set: backup, surgical single-line edit, scp back, RPC nudge. */
export function hestiaSettingsSet(id: string, value: string, addon?: string): boolean {
  const path = settingsPath(addon)
  const xml = hestiaSettingsLoad(addon)
  if (!xml) {
    console.error(`[hestia-settings] could not read ${path}`)
    return false
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const bakLocal = `/tmp/kilo/hestia-settings-bak-${ts}.xml`
  Bun.write(bakLocal, xml)
  if (!hestiaScp(bakLocal, `${path}.bak-${ts}`)) {
    console.error(`[hestia-settings] backup push FAILED — aborting set`)
    return false
  }
  console.log(`[hestia-settings] backup: ${path}.bak-${ts}`)

  const lineRe = new RegExp(`^([ \\t]*)<setting id="${id}"([^>]*)>([^<]*)</setting>`, "m")
  const m = xml.match(lineRe)
  if (!m) {
    console.error(`[hestia-settings] id not found in ${path}: ${id}`)
    return false
  }
  // Strip default="true" — a written value is no longer default.
  const attrs = m[2].replace(/\s*default="true"/g, "")
  const indent = m[1]
  const newLine = `${indent}<setting id="${id}"${attrs}>${value}</setting>`
  const updated = xml.replace(lineRe, newLine)
  const tmpLocal = `/tmp/kilo/hestia-settings-set-${ts}.xml`
  Bun.write(tmpLocal, updated)
  if (!hestiaScp(tmpLocal, path)) {
    console.error(`[hestia-settings] scp push FAILED`)
    return false
  }
  console.log(`[hestia-settings] XML: ${id} = ${value} written to ${path}`)

  const rpc = hestiaSettingsRpcApply(id, value)
  if (rpc.ok) {
    console.log(`[hestia-settings] RPC live-apply OK`)
  } else {
    console.log(`[hestia-settings] RPC live-apply failed (XML-only id?) — full apply may need Kodi restart: ${rpc.detail}`)
  }
  return true
}

/** pull: copy the settings XML from box to a local path. */
export function hestiaSettingsPull(out?: string, addon?: string): string {
  const local = out ?? `/tmp/kilo/hestia-settings-pull-${addon ?? "gui"}.xml`
  if (!hestiaPull(settingsPath(addon), local)) {
    console.error(`[hestia-settings] pull FAILED`)
    process.exit(1)
  }
  console.log(local)
  return local
}

/** push: copy a local XML to the box settings path (with backup). */
export function hestiaSettingsPush(local: string, addon?: string): boolean {
  const path = settingsPath(addon)
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const cur = hestiaSettingsLoad(addon)
  if (cur) {
    const bakLocal = `/tmp/kilo/hestia-settings-push-bak-${ts}.xml`
    Bun.write(bakLocal, cur)
    hestiaScp(bakLocal, `${path}.bak-${ts}`)
  }
  return hestiaScp(local, path)
}

// CLI entrypoint
if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2)
  const addonIdx = rest.indexOf("--addon")
  const addon = addonIdx >= 0 ? rest[addonIdx + 1] : undefined
  const skip = new Set<number>()
  if (addonIdx >= 0) { skip.add(addonIdx); skip.add(addonIdx + 1) }
  const args = rest.filter((a, i) => !skip.has(i))
  const grepIdx = rest.indexOf("--grep")
  const grep = grepIdx >= 0 ? rest[grepIdx + 1] : undefined

  if (cmd === "get" && args[0]) {
    hestiaSettingsGet(args[0], addon)
  } else if (cmd === "set" && args.length >= 2) {
    process.exit(hestiaSettingsSet(args[0], args[1], addon) ? 0 : 1)
  } else if (cmd === "list") {
    hestiaSettingsList(grep, addon)
  } else if (cmd === "pull") {
    const outIdx = rest.indexOf("--out")
    hestiaSettingsPull(outIdx >= 0 ? rest[outIdx + 1] : undefined, addon)
  } else if (cmd === "push" && args[0]) {
    process.exit(hestiaSettingsPush(args[0], addon) ? 0 : 1)
  } else {
    console.error(
      "hestia-settings: usage: get <id> | set <id> <value> | list [--grep pat] | pull | push <local>  [--addon <addon>]",
    )
    process.exit(1)
  }
}
