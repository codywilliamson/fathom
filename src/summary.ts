import { config } from './config'
import type { Store } from './store'
import { normalizeWindows, parseStoredPayload } from './ratelimit'
import type { MachineStatus, RateLimitSnapshot, SummaryResponse, UsageBucket } from '../shared/types'

// builds the whole dashboard payload from the store. pure composition — all
// sql lives in store.ts, all ratelimit shape-mapping lives in ratelimit.ts.

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const DAILY_WINDOW_DAYS = 30

function bucket(s: Store, sinceMs: number, nowMs: number): UsageBucket {
  const { tokens, costUsd, calls } = s.windowTotal(sinceMs, nowMs)
  return { bucket: new Date(nowMs).toISOString(), tokens, costUsd, calls }
}

function rateLimitSnapshot(s: Store): RateLimitSnapshot {
  const row = s.loadRateLimit()
  if (!row) {
    return { windows: [], fetchedAt: null, ok: false, error: null, subscriptionType: null, rateLimitTier: null }
  }
  const { raw, subscriptionType, rateLimitTier } = parseStoredPayload(row.payload)
  return {
    windows: normalizeWindows(raw),
    fetchedAt: row.fetchedAt !== null ? new Date(row.fetchedAt).toISOString() : null,
    ok: row.ok,
    error: row.error,
    subscriptionType,
    rateLimitTier,
  }
}

function machineStatuses(s: Store, nowMs: number): MachineStatus[] {
  const activeCounts = s.activeSessionCounts(nowMs - config.activeWindowSec * 1000)
  return s.machines().map((m) => ({
    machine: m.machine,
    lastSeen: new Date(m.lastSeen).toISOString(),
    online: nowMs - m.lastSeen <= config.staleSec * 1000,
    activeSessions: activeCounts[m.machine] ?? 0,
  }))
}

export function buildSummary(s: Store, nowMs: number): SummaryResponse {
  // breakdowns share the daily window — keeps the payload bounded and
  // relevant to what the sparkline shows, rather than an ever-growing scan
  const dailyStart = nowMs - DAILY_WINDOW_DAYS * DAY_MS

  return {
    generatedAt: new Date(nowMs).toISOString(),
    rateLimit: rateLimitSnapshot(s),
    machines: machineStatuses(s, nowMs),
    activeSessions: s.activeSessions(nowMs - config.activeWindowSec * 1000),
    totals: {
      last5h: bucket(s, nowMs - 5 * HOUR_MS, nowMs),
      last24h: bucket(s, nowMs - DAY_MS, nowMs),
      last7d: bucket(s, nowMs - 7 * DAY_MS, nowMs),
      last30d: bucket(s, nowMs - 30 * DAY_MS, nowMs),
    },
    daily: s.dailyBuckets(dailyStart, nowMs),
    byModel: s.breakdownByModel(dailyStart, nowMs),
    byProject: s.breakdownByProject(dailyStart, nowMs),
    byMachine: s.breakdownByMachine(dailyStart, nowMs),
  }
}
