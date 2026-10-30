#!/usr/bin/env bun
/**
 * git-credential.ts — Pure stdout git credential helper.
 *
 * Implements the git credential protocol (get/store/erase on stdin,
 * key=value lines on stdout). All diagnostics go to stderr so the
 * credential protocol stream is never corrupted.
 *
 * Installed via ~/.gitconfig:
 *   [credential]
 *     helper = !bun /home/toxic/pens/estate/products/estate-ops/bin/git-credential.ts
 */

import { readFileSync } from "node:fs"

function readAllStdin(): string {
  let data = ""
  const chunk = readFileSync(0, "utf8")
  data += chunk
  return data
}

function parseCredentials(input: string): Record<string, string> {
  const creds: Record<string, string> = {}
  for (const line of input.split("\n")) {
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    creds[key] = value
  }
  return creds
}

function formatCreds(creds: Record<string, string>): string {
  return Object.entries(creds)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + (Object.keys(creds).length ? "\n" : "")
}

const input = readAllStdin()
const lines = input.split("\n")
const command = lines[0]?.trim()
const creds = parseCredentials(input)

switch (command) {
  case "get": {
    const out: Record<string, string> = {}
    // In a real deployment, look up the keyring here
    if (creds.protocol) out.protocol = creds.protocol
    if (creds.host) out.host = creds.host
    if (creds.username) out.username = creds.username
    if (creds.password) out.password = creds.password
    process.stdout.write(formatCreds(out))
    break
  }
  case "store": {
    // Store would write to keyring; for now just acknowledge
    process.stdout.write("")
    break
  }
  case "erase": {
    process.stdout.write("")
    break
  }
  default:
    process.stderr.write(`git-credential: unknown command: ${command}\n`)
    process.exit(1)
}
