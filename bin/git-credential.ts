#!/usr/bin/env bun
/**
 * git-credential.ts — canonical git credential helper (Bun/TS).
 * Pure functions + thin CLI (testable via bun:test).
 * stdout is ONLY credential lines; all diagnostics to stderr.
 */
import { spawnSync } from "node:child_process";

export interface Credential {
  protocol: string;
  host: string;
  username: string;
  password: string;
}

/** Parse `secretsmith env` output (KEY=value lines) into a record. */
export function parseKeyringEnv(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^'+|'+$/g, "");
  }
  return out;
}

/** Resolve the GitHub token from a keyring env map. */
export function tokenFrom(env: Record<string, string>): string | undefined {
  return env["GH_TOKEN"] ?? env["GITHUB_TOKEN"];
}

/** Build the credential payload bytes (pure). */
export function credentialPayload(tok: string): string {
  return `protocol=https\nhost=github.com\nusername=x-access-token\npassword=${tok}\n`;
}

/** Resolve the token by shelling out to the secretsmith keyring. */
export function keyringToken(): string | undefined {
  const r = spawnSync(
    "/home/toxic/.local/bin/secretsmith",
    ["env", "--env", "GH_TOKEN=xdg:schema=org.freedesktop.Secret.Generic"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return undefined;
  return tokenFrom(parseKeyringEnv(r.stdout ?? ""));
}

/** Run as the git credential helper: read argv, answer `get` with the token. */
export function cli(
  argv: string[],
  stdout = process.stdout,
  keyring = keyringToken,
): number {
  const args = argv.slice(2);
  const first = args[0] ?? "";
  // git credential-helper protocol comes FIRST: a `!` helper is invoked as
  // `<cmd> get|store|erase` (action = argv[2], query on stdin). Dispatching
  // wrapper-mode before this made `get` fall through and execute `git get`
  // ("git: 'get' is not a git command") and pushes died on
  // "could not read Username".
  if (first === "get" || first === "store" || first === "erase") {
    if (first === "get") {
      const tok = keyring();
      if (tok) {
        stdout.write(credentialPayload(tok));
        return 0;
      }
      return 1;
    }
    // store/erase: the secretsmith keyring owns storage; credential-pure no-op.
    return 0;
  }
  if (first.startsWith("credential-") || first === "credential") {
    // `git credential get|store|erase` invocation form.
    if (args.includes("get")) {
      const tok = keyring();
      if (tok) {
        stdout.write(credentialPayload(tok));
        return 0;
      }
    }
    return 0;
  }
  // git wrapper mode
  const tok = keyring();
  const env = { ...process.env };
  if (tok && !env.GITHUB_TOKEN) env.GITHUB_TOKEN = tok;
  const res = spawnSync("/usr/bin/git", args, { stdio: "inherit", env });
  return res.status ?? 1;
}

if (import.meta.main) process.exit(cli(process.argv));
