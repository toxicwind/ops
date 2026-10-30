/**
 * ffs-js.ts — JavaScript shim for the ffs (Unified code search/read tool) binary.
 *
 * Exposes ffs commands as async functions that shell out to the compiled
 * ffs binary at /home/toxic/pens/estate/products/estate-ops/ffs.
 *
 * Usage:
 *   import { grep, glob, find, read, symbol, callers, callees, refs } from "./ffs-js"
 *   const results = await grep("pattern", { root: "/home/toxic/pens" })
 */

const FFS_BIN = "/home/toxic/pens/estate/products/estate-ops/ffs"

interface FfsOptions {
  root?: string
  limit?: number
  offset?: number
  caseSensitive?: boolean
  ignoreCase?: boolean
  regex?: boolean
  fixedStrings?: boolean
  wordRegexp?: boolean
  invertMatch?: boolean
  maxCount?: number
  filesWithMatches?: boolean
  filesWithoutMatch?: boolean
  hidden?: boolean
  noIgnore?: boolean
  text?: boolean
  glob?: string | string[]
  onlyMatching?: boolean
  group?: boolean
  compact?: boolean
  afterContext?: number
  beforeContext?: number
  context?: number
}

interface FfsResult {
  stdout: string
  stderr: string
  code: number
}

function runFfs(command: string[], options: FfsOptions = {}): Promise<FfsResult> {
  return new Promise((resolve) => {
    const args = [command]
    if (options.root) args.push("--root", options.root)
    if (options.limit !== undefined) args.push("--limit", String(options.limit))
    if (options.offset !== undefined) args.push("--offset", String(options.offset))
    if (options.caseSensitive) args.push("--case-sensitive")
    if (options.ignoreCase) args.push("-i")
    if (options.regex) args.push("-r")
    if (options.fixedStrings) args.push("-F")
    if (options.wordRegexp) args.push("-w")
    if (options.invertMatch) args.push("-v")
    if (options.maxCount !== undefined) args.push("--max-count", String(options.maxCount))
    if (options.filesWithMatches) args.push("-l")
    if (options.filesWithoutMatch) args.push("--files-without-match")
    if (options.hidden) args.push("--hidden")
    if (options.noIgnore) args.push("--no-ignore")
    if (options.text) args.push("-a")
    if (options.glob) {
      const globs = Array.isArray(options.glob) ? options.glob : [options.glob]
      for (const g of globs) args.push("-g", g)
    }
    if (options.onlyMatching) args.push("-o")
    if (options.group) args.push("--group")
    if (options.compact) args.push("--compact")
    if (options.afterContext !== undefined) args.push("--after-context", String(options.afterContext))
    if (options.beforeContext !== undefined) args.push("--before-context", String(options.beforeContext))
    if (options.context !== undefined) args.push("-C", String(options.context))

    const proc = require("child_process").spawnSync(FFS_BIN, args, {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    })

    resolve({
      stdout: proc.stdout || "",
      stderr: proc.stderr || "",
      code: proc.status || 0,
    })
  })
}

/** Grep file contents. */
export function grep(pattern: string, options: FfsOptions = {}): Promise<FfsResult> {
  return runFfs(["grep", pattern], options)
}

/** Find files by name. */
export function find(pattern: string, options: FfsOptions = {}): Promise<FfsResult> {
  return runFfs(["find", pattern], options)
}

/** Glob files by pattern. */
export function glob(pattern: string, options: FfsOptions = {}): Promise<FfsResult> {
  return runFfs(["glob", pattern], options)
}

/** Read a file. */
export function read(path: string, options: FfsOptions = {}): Promise<FfsResult> {
  return runFfs(["read", path], options)
}

/** Look up symbol definitions (tree-sitter AST powered). */
export function symbol(pattern: string, options: FfsOptions = {}): Promise<FfsResult> {
  return runFfs(["symbol", pattern], options)
}

/** List callers of a symbol. */
export function callers(pattern: string, options: FfsOptions = {}): Promise<FfsResult> {
  return runFfs(["callers", pattern], options)
}

/** List callees referenced inside a symbol body. */
export function callees(pattern: string, options: FfsOptions = {}): Promise<FfsResult> {
  return runFfs(["callees", pattern], options)
}

/** List definitions and usages of a symbol in one shot. */
export function refs(pattern: string, options: FfsOptions = {}): Promise<FfsResult> {
  return runFfs(["refs", pattern], options)
}

/** Drill-down envelope per definition. */
export function flow(pattern: string, options: FfsOptions = {}): Promise<FfsResult> {
  return runFfs(["flow", pattern], options)
}

/** List sibling symbols. */
export function siblings(pattern: string, options: FfsOptions = {}): Promise<FfsResult> {
  return runFfs(["siblings", pattern], options)
}

/** List dependencies. */
export function deps(pattern: string, options: FfsOptions = {}): Promise<FfsResult> {
  return runFfs(["deps", pattern], options)
}
