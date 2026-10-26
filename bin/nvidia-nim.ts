#!/usr/bin/env bun
/**
 * nvidia-nim.ts — canonical NVIDIA NIM response classification + reply extraction.
 * Pure, dependency-free. Single source of truth for the fleet's NIM quirks:
 *
 *  1. nvapi-* direct keys: 200 on /v1/models (looks alive) but 403 "Authorization failed"
 *     on /chat/completions when the NGC account lacks the Public API Endpoints entitlement.
 *     → classify as GONE (unusable) so the racer skips this key instead of "bad" (retry same key forever).
 *  2. npk_ proxy keys: 401 "Invalid JWT" on direct NVCF calls but work THROUGH rhodochrosite proxy.
 *  3. 429 governor: NVIDIA returns 429 "Too Many Requests... ~60 seconds" + "governor" -> LIMIT (back off).
 *  4. finish_reason=length: 200 + choices but reasoning consumed the whole budget -> still a valid turn
 *     (content may be empty because the model was still thinking) -> OK, not BAD.
 *  5. reasoning_content vs content: NIM returns reasoning_content on a separate field; a model that only
 *     reasoned (no content yet) is still mid-generation -> OK with empty reply, score 0 at caller.
 */

export type NIMVerdict = 'limit' | 'gone' | 'bad' | 'ok'

const LIMIT_RE =
  /rate.?limit|too many requests|governor|exceeded.*(limit|quota)|busy|try again later|concurrency_limit/i
const GONE_RE =
  /not found|not provisioned|does not exist|unknown model|authorization failed|invalid jwt|entitlement/i

/** Classify an NVIDIA NIM HTTP status + body into a race verdict. */
export function classifyNim(body: string, code: string): NIMVerdict {
  const low = body.toLowerCase()
  if (code === '429' || LIMIT_RE.test(low)) return 'limit'
  if (code === '410') return 'gone'
  // 403 "Authorization failed" / 401 "Invalid JWT" = key lacks entitlement (or wrong type) => unusable => gone
  if ((code === '403' || code === '401') && GONE_RE.test(low)) return 'gone'
  if (code === '404' || GONE_RE.test(low)) return 'gone'
  if (code !== '200' || (!low.includes('choices') && low.includes('error'))) return 'bad'
  return low.includes('choices') ? 'ok' : 'bad'
}

/** Extract a reply from a NIM chat.completions body (content, else reasoning_content, else raw). */
export function replyOfNim(body: string): string {
  try {
    const d = JSON.parse(body)
    const msg = d?.choices?.[0]?.message
    if (!msg) return JSON.stringify(d).slice(0, 300)
    if (typeof msg.content === 'string' && msg.content.trim()) return msg.content.trim()
    if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim())
      return `[reasoning] ${msg.reasoning_content.trim().slice(0, 280)}`
    return JSON.stringify(d).slice(0, 300)
  } catch {
    return body.slice(0, 300)
  }
}

/** Whether a 200 body actually generated usable content (not empty-after-reasoning). */
export function hasContent(body: string): boolean {
  try {
    const d = JSON.parse(body)
    const msg = d?.choices?.[0]?.message
    return typeof msg?.content === 'string' && msg.content.trim().length > 0
  } catch { return false }
}

if (import.meta.main) {
  const body = process.argv[2] ?? ''
  const code = process.argv[3] ?? ''
  console.log(JSON.stringify({ verdict: classifyNim(body, code), reply: replyOfNim(body), hasContent: hasContent(body) }))
}
