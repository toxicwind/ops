#!/usr/bin/env bun
/**
 * hestia-forensics-web — serve hestia hardware dump (parquet) over HTTP.
 *
 * Reads the nested parquet written by the forensics pipeline and renders it
 * as a browsable HTML page (or raw JSON). Low-latency local web view.
 *
 * Usage:
 *   bun hestia-forensics-web.ts serve --port 25281
 *   curl http://127.0.0.1:25281/           -> HTML table view
 *   curl http://127.0.0.1:25281/json        -> raw JSON
 *   curl http://127.0.0.1:25281/refresh     -> re-read parquet from disk
 */
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const PORT = Number(process.env.HESTIA_FORENSICS_PORT ?? "25281")
const DATA_DIR =
  process.env.HESTIA_FORENSICS_DIR ??
  "/home/toxic/pens/estate/forensics/hestia"

function loadParquet(path: string): any[] {
  // Read flat parquet via python3 + fastparquet (handles flat/struct columns).
  const { spawnSync } = require("node:child_process")
  const script = `import fastparquet as fp, json, sys, datetime\n` +
    `df=fp.ParquetFile(${JSON.stringify(path)}).to_pandas()\n` +
    `# Convert timestamps to iso strings for JSON\n` +
    `for c in df.columns:\n` +
    `  if hasattr(df[c], 'dt') and df[c].dt.tz is not None:\n` +
    `    df[c] = df[c].dt.tz_localize(None).dt.strftime('%Y-%m-%dT%H:%M:%S')\n` +
    `  elif hasattr(df[c], 'dt'):\n` +
    `    df[c] = df[c].dt.strftime('%Y-%m-%dT%H:%M:%S')\n` +
    `print(json.dumps(df.to_dict(orient="records")))`
  const r = spawnSync("python3", ["-c", script], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.status !== 0) return []
  try {
    return JSON.parse(r.stdout)
  } catch {
    return []
  }
}

function listParquet(): string[] {
  if (!existsSync(DATA_DIR)) return []
  return readdirSync(DATA_DIR).filter((f) => f.endsWith(".parquet"))
}

function htmlPage(rows: any[]): string {
  const flat = rows.length ? rows[0] : {}
  const keys = Object.keys(flat)
  const render = (v: any): string => {
    if (v === null || v === undefined) return "<td>-</td>"
    if (typeof v === "object") return `<td><pre>${JSON.stringify(v, null, 1)}</pre></td>`
    return `<td>${String(v)}</td>`
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>hestia hardware</title>
<style>body{font-family:monospace;background:#111;color:#eee;padding:20px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6px;text-align:left;vertical-align:top}
pre{margin:0;white-space:pre-wrap;font-size:11px}th{background:#222}</style></head>
<body><h1>hestia hardware dump</h1><p>files: ${listParquet().join(", ")}</p>
<table><tr>${keys.map((k) => `<th>${k}</th>`).join("")}</tr>
${rows.map((r) => `<tr>${keys.map((k) => render(r[k])).join("")}</tr>`).join("")}
</table></body></html>`
}

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname
    if (path === "/json") {
      const rows = listParquet().flatMap((f) => loadParquet(join(DATA_DIR, f)))
      return new Response(JSON.stringify(rows, null, 2), {
        headers: { "content-type": "application/json" },
      })
    }
    if (path === "/refresh") {
      return new Response("refreshed", { status: 200 })
    }
    const rows = listParquet().flatMap((f) => loadParquet(join(DATA_DIR, f)))
    return new Response(htmlPage(rows), { headers: { "content-type": "text/html" } })
  },
})
console.error(`[hestia-forensics-web] http://127.0.0.1:${PORT}`)
Bun.sleep(Number.MAX_SAFE_INTEGER)