import { resolve } from 'node:path'
import { config } from './config'
import { store, type Store } from './store'
import { notifyChange } from './stream'
import type { RateLimitWindow } from '../shared/types'

// collects the account's unified rate-limit windows (5-hour and weekly).
//
// SOURCE: the `anthropic-ratelimit-unified-*` response headers on a normal
// /v1/messages call. we send a deliberately minimal probe (cheapest model,
// max_tokens 1) purely to read those headers.
//
// why not /api/oauth/usage: that endpoint has its own tiny budget on a long
// window — a measured 429 came back with `retry-after: 1963` (~33 min), so any
// poll frequent enough to be useful keeps it permanently exhausted. the
// headers ride a normal inference call instead and are always current.
//
// the probe costs a handful of tokens per poll. that is the tradeoff for
// having live quota numbers at all; FATHOM_RATELIMIT_INTERVAL_SEC controls it.

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
// cheapest model, one token — we want the headers, not the answer
const PROBE_MODEL = 'claude-haiku-4-5'
const FETCH_TIMEOUT_MS = 15_000

interface OauthCredentials {
  accessToken?: string
  subscriptionType?: string
  rateLimitTier?: string
}

// read fresh on every poll — claude code rotates this token, and we must
// never refresh it ourselves (racing claude code's own refresh risks
// invalidating the refresh token). never log the token.
async function readCredentials(): Promise<OauthCredentials | null> {
  try {
    const file = Bun.file(resolve(config.claudeDir, '.credentials.json'))
    if (!(await file.exists())) return null
    const data = (await file.json()) as { claudeAiOauth?: OauthCredentials }
    return data.claudeAiOauth ?? null
  } catch {
    return null
  }
}

/**
 * pull just the unified rate-limit headers out of a response. we keep the raw
 * header map (not a parsed shape) so a future header we don't map yet is still
 * captured in the snapshot rather than silently dropped.
 */
export function captureRateLimitHeaders(headers: Headers): Record<string, string> {
  const captured: Record<string, string> = {}
  headers.forEach((value, name) => {
    if (name.toLowerCase().startsWith('anthropic-ratelimit-')) captured[name.toLowerCase()] = value
  })
  return captured
}

/** the header names we read, in display order. */
const WINDOW_SPECS = [
  { key: 'five_hour', label: '5-hour', prefix: 'anthropic-ratelimit-unified-5h' },
  { key: 'seven_day', label: 'weekly', prefix: 'anthropic-ratelimit-unified-7d' },
] as const

/**
 * map the captured `anthropic-ratelimit-unified-*` headers into windows.
 * a header set we don't recognise yields [] rather than throwing, so the ui
 * falls back to rolling token volume instead of showing a fabricated number.
 */
export function normalizeWindows(raw: unknown): RateLimitWindow[] {
  if (!raw || typeof raw !== 'object') return []
  const h = raw as Record<string, unknown>

  const windows: RateLimitWindow[] = []
  for (const spec of WINDOW_SPECS) {
    const utilization = asFraction(h[`${spec.prefix}-utilization`])
    if (utilization === null) continue
    windows.push({
      key: spec.key,
      label: spec.label,
      utilization,
      resetsAt: asIsoTime(h[`${spec.prefix}-reset`]),
    })
  }
  return windows
}

function asFraction(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n) || n < 0) return null
  // documented as a 0..1 fraction; tolerate a 0..100 percentage just in case
  return n > 1 ? Math.min(n / 100, 1) : n
}

/** headers carry unix SECONDS; tolerate ms and iso strings too. */
function asIsoTime(v: unknown): string | null {
  if (typeof v === 'string' && Number.isNaN(Number(v))) {
    const parsed = Date.parse(v)
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
  }
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n > 1e12 ? n : n * 1000).toISOString()
}

// what we persist in ratelimit_snapshot.payload — the raw api body plus the
// account metadata read from the credentials file (the schema has no
// separate columns for those, and they belong with the snapshot they came
// from).
interface StoredPayload {
  raw: unknown
  subscriptionType: string | null
  rateLimitTier: string | null
}

export function parseStoredPayload(payload: string | null): StoredPayload {
  if (!payload) return { raw: null, subscriptionType: null, rateLimitTier: null }
  try {
    const parsed = JSON.parse(payload) as Partial<StoredPayload>
    return {
      raw: parsed.raw ?? null,
      subscriptionType: parsed.subscriptionType ?? null,
      rateLimitTier: parsed.rateLimitTier ?? null,
    }
  } catch {
    return { raw: null, subscriptionType: null, rateLimitTier: null }
  }
}

/**
 * earliest time we're allowed to call the endpoint again, per the last 429's
 * `retry-after`. this matters more than it looks: the endpoint's budget is
 * tiny and its window is long (an observed retry-after was 1963s — ~33min),
 * so a fixed poll interval shorter than that keeps the budget permanently
 * exhausted and the gauge permanently empty. honouring retry-after is both
 * the polite thing to do and the only way this ever returns data.
 */
let nextAllowedAt = 0

/** seconds until the endpoint will talk to us again; 0 when it's ready. */
export function cooldownRemainingSec(nowMs: number = Date.now()): number {
  return Math.max(0, Math.ceil((nextAllowedAt - nowMs) / 1000))
}

export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return nowMs + seconds * 1000
  const asDate = Date.parse(header) // retry-after may also be an http date
  return Number.isNaN(asDate) ? null : asDate
}

export async function pollRateLimit(s: Store = store()): Promise<void> {
  const previous = s.loadRateLimit()
  const fetchedAt = Date.now()

  // still cooling down from a 429 — don't spend the budget we don't have
  if (fetchedAt < nextAllowedAt) return

  const creds = await readCredentials()

  // never blank out good data — a failed poll keeps the last good headers and
  // their timestamp. the account metadata is a local file read that doesn't
  // depend on the api, so keep it fresh even when the probe fails: losing
  // "max / default_claude_max_5x" to a transient network error would be silly.
  const fail = (error: string) => {
    const carried: StoredPayload = {
      raw: parseStoredPayload(previous?.payload ?? null).raw,
      subscriptionType: creds?.subscriptionType ?? null,
      rateLimitTier: creds?.rateLimitTier ?? null,
    }
    s.saveRateLimit(JSON.stringify(carried), previous?.fetchedAt ?? null, false, error)
    notifyChange()
  }

  if (!creds?.accessToken) {
    fail('no access token in ~/.claude/.credentials.json')
    return
  }

  try {
    const res = await fetch(MESSAGES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: PROBE_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: '.' }],
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    // a 429 still carries the rate-limit headers — that IS the interesting
    // state (you're capped), so read them before treating it as a failure.
    const raw = captureRateLimitHeaders(res.headers)
    const hasWindows = normalizeWindows(raw).length > 0

    if (!res.ok && !hasWindows) {
      if (res.status === 429) {
        const until = parseRetryAfter(res.headers.get('retry-after'), fetchedAt)
        if (until) nextAllowedAt = until
        const wait = cooldownRemainingSec(fetchedAt)
        fail(wait ? `http 429 — retrying in ${wait}s` : 'http 429')
        return
      }
      fail(`http ${res.status}`)
      return
    }
    nextAllowedAt = 0
    const payload: StoredPayload = {
      raw,
      subscriptionType: creds.subscriptionType ?? null,
      rateLimitTier: creds.rateLimitTier ?? null,
    }
    s.saveRateLimit(JSON.stringify(payload), fetchedAt, true, null)
    notifyChange()
  } catch (err) {
    fail(String((err as Error).message ?? err).slice(0, 500))
  }
}

export function startRateLimitPoller(): void {
  const tick = async () => {
    try {
      await pollRateLimit()
    } catch (err) {
      console.error('ratelimit: poll failed', err)
    }
    // wait out any server-imposed cooldown, then resume the normal cadence.
    // +1s so we land just after the window opens rather than a hair before.
    const cooldownMs = cooldownRemainingSec() * 1000
    const delay = Math.max(config.rateLimitIntervalSec * 1000, cooldownMs + 1000)
    setTimeout(tick, delay)
  }
  tick()
}
