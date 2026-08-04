import { resolve } from 'node:path'
import { config } from './config'
import { store, type Store } from './store'
import { notifyChange } from './stream'
import type { RateLimitWindow } from '../shared/types'

// slow poller for the oauth usage endpoint + the credentials file it reads
// the token from.
//
// this endpoint has a very small budget on a long window — a measured 429 came
// back with `retry-after: 1963` (~33 min). that means any fixed poll interval
// shorter than the window keeps the budget permanently spent and the gauge
// permanently empty, which is exactly what happened before we honoured
// retry-after. so: poll slowly, and when told to wait, actually wait.

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const FETCH_TIMEOUT_MS = 10_000

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
 * THE ONE PLACE TO CHANGE once the real response shape is observed — we've
 * never gotten a 200 from this endpoint (see module comment), so this is a
 * tolerant best-guess mapper, not a verified parser. it looks for an array of
 * window-like objects (or treats the payload itself as a single window),
 * pulls a 0..1 utilization out of whatever plausible field name is present,
 * and a reset timestamp likewise. anything it doesn't recognise is dropped;
 * an unrecognised payload shape returns [] rather than throwing.
 */
export function normalizeWindows(raw: unknown): RateLimitWindow[] {
  if (!raw || typeof raw !== 'object') return []

  const candidates: unknown[] = []
  for (const key of ['windows', 'rate_limits', 'limits', 'usage']) {
    const v = (raw as Record<string, unknown>)[key]
    if (Array.isArray(v)) candidates.push(...v)
  }
  if (!candidates.length) candidates.push(raw)

  const windows: RateLimitWindow[] = []
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue
    const obj = c as Record<string, unknown>

    const utilization = pickFraction(obj)
    if (utilization === null) continue

    const key =
      typeof obj.key === 'string'
        ? obj.key
        : typeof obj.name === 'string'
          ? obj.name
          : `window_${windows.length}`
    const label = typeof obj.label === 'string' ? obj.label : key

    windows.push({ key, label, utilization, resetsAt: pickResetTime(obj) })
  }
  return windows
}

function pickFraction(obj: Record<string, unknown>): number | null {
  for (const key of ['utilization', 'fraction', 'used_fraction', 'usage_fraction']) {
    const v = obj[key]
    if (typeof v === 'number' && v >= 0 && v <= 1) return v
  }
  for (const key of ['percentage', 'percent', 'used_percent', 'utilization_percent']) {
    const v = obj[key]
    if (typeof v === 'number' && v >= 0 && v <= 100) return v / 100
  }
  const used = obj.used ?? obj.used_tokens ?? obj.consumed
  const limit = obj.limit ?? obj.max ?? obj.total
  if (typeof used === 'number' && typeof limit === 'number' && limit > 0) return used / limit
  return null
}

function pickResetTime(obj: Record<string, unknown>): string | null {
  for (const key of ['resetsAt', 'reset_at', 'resets_at', 'reset_time', 'resetTime']) {
    const v = obj[key]
    if (typeof v === 'string') return v
    if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000).toISOString()
  }
  return null
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

  // never blank out good data — a failed poll keeps the last good raw payload
  // and its timestamp. the account metadata is a local file read that doesn't
  // depend on the api, so keep it fresh even when the poll fails: this
  // endpoint is heavily rate limited and may never succeed, and losing
  // "max / default_claude_max_5x" to a 429 would be silly.
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
    const res = await fetch(USAGE_URL, {
      headers: {
        authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
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
    const raw = await res.json().catch(() => null)
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
