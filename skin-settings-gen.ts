#!/usr/bin/env bun
/**
 * skin-settings-gen — generative settings for skin.eternal.
 *
 * The skin's live settings.xml is GENERATED from a schema (below), not
 * hand-edited. Re-run to regenerate: additive-only (existing values preserved,
 * new schema entries added, removed entries dropped). This is the
 * "settings should be generative" doctrine — a schema is the source of truth.
 *
 * Usage:
 *   bun skin-settings-gen.ts [--host 10.0.0.246] [--out <path>]
 *   bun skin-settings-gen.ts --schema my-schema.json   # custom schema
 */
import { hestiaExec, hestiaRead, hestiaScp } from "./hestia-ssh.ts"

const HOST = process.env.HESTIA_HOST ?? "10.0.0.246"
const BOX_SETTINGS = "/storage/.kodi/userdata/addon_data/skin.eternal/settings.xml"

// Schema: the source of truth for the skin's settings. Each entry is
// { id, type, default }. Add here, regenerate, done.
const SCHEMA: { id: string; type: string; default: string }[] = [
  { id: "firsttimerun", type: "bool", default: "true" },
  { id: "osdautoclose", type: "bool", default: "false" },
  { id: "touchmode", type: "bool", default: "false" },
  { id: "trailerplaying", type: "bool", default: "false" },
  { id: "no_slide_animations", type: "bool", default: "false" },
  { id: "no_fanart", type: "bool", default: "false" },
  { id: "autoscroll", type: "bool", default: "false" },
  { id: "homeaddonsnovideoaddons", type: "bool", default: "false" },
  { id: "homeaddonsnoprogramaddons", type: "bool", default: "false" },
  { id: "circle_rating", type: "bool", default: "false" },
  { id: "circle_userrating", type: "bool", default: "false" },
  { id: "homemenunomoviesbutton", type: "bool", default: "false" },
  { id: "homemenunotvshowsbutton", type: "bool", default: "false" },
  { id: "homemenunocustom1button", type: "bool", default: "false" },
  { id: "homemenunocustom2button", type: "bool", default: "false" },
  { id: "homemenunocustom3button", type: "bool", default: "false" },
  { id: "homemenunocustom4button", type: "bool", default: "false" },
  { id: "homemenunocustom5button", type: "bool", default: "false" },
  { id: "homemenunocustom6button", type: "bool", default: "false" },
  { id: "home_no_categories_widget", type: "bool", default: "false" },
]

// Read the current live settings (preserve existing values, additive).
function readExisting(host: string): Map<string, string> {
  const map = new Map<string, string>()
  const content = hestiaRead(BOX_SETTINGS)
  if (!content) return map
  for (const m of content.matchAll(/<setting id="([^"]+)"[^>]*>([^<]*)</g)) {
    map.set(m[1], m[2])
  }
  return map
}

function generate(host: string) {
  const existing = readExisting(host)
  // UNION: preserve ALL existing settings (never drop a live setting), then
  // apply schema defaults for any missing ones. This is non-destructive — the
  // schema is additive, existing values always win.
  const merged = new Map<string, { type: string; value: string }>()
  for (const [id, val] of existing) {
    merged.set(id, { type: "bool", value: val })
  }
  for (const s of SCHEMA) {
    if (!merged.has(s.id)) merged.set(s.id, { type: s.type, value: s.default })
  }
  const lines = ["<settings>"]
  for (const [id, { type, value }] of merged) {
    lines.push(`    <setting id="${id}" type="${type}">${value}</setting>`)
  }
  lines.push("</settings>")
  return lines.join("\n")
}

// Write the generated settings back to the box.
async function writeToBox(host: string, content: string) {
  const tmp = "/tmp/skin-settings-gen.xml"
  await Bun.write(tmp, content)
  if (!hestiaScp(tmp, BOX_SETTINGS)) {
    console.error(`[skin-settings-gen] write FAILED`)
    process.exit(1)
  }
  console.log(`[skin-settings-gen] wrote ${SCHEMA.length} settings to ${BOX_SETTINGS}`)
}

const host = HOST
const generated = generate(host)
console.log(generated)
await writeToBox(host, generated)