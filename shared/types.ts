// api contract between backend, frontend, and the windows agent — single source of truth.
// versioned: everything here is served under /api/v1. extend, don't break.
// import it, never redefine.

// ── primitives ───────────────────────────────────────────────────────────────

/** which machine a usage record came from. free-form, set per collector/agent. */
export type MachineId = string

/** token counts as claude code writes them into the jsonl transcript. */
export interface TokenCounts {
  input: number
  output: number
  cacheCreation: number
  cacheRead: number
}

/**
 * one deduped assistant api call. claude code rewrites the same assistant line
 * repeatedly while streaming, so `messageId` is the dedup key — without it
 * tokens over-count roughly 3x.
 */
export interface UsageEvent {
  messageId: string
  machine: MachineId
  sessionId: string
  /** basename of cwd, e.g. "career" — what the dashboard groups by */
  project: string
  model: string
  /** iso 8601 */
  ts: string
  tokens: TokenCounts
  /** usd, derived from the model pricing table at parse time */
  costUsd: number
}

// ── rate limit windows ───────────────────────────────────────────────────────

/**
 * a quota window as reported by the oauth usage endpoint. that endpoint is
 * undocumented and itself rate-limited, so treat every field as best-effort:
 * `windows` may be empty while the ui still shows the last good snapshot.
 */
export interface RateLimitWindow {
  /** stable key passed through from the api, e.g. "five_hour" */
  key: string
  /** human label for the gauge, e.g. "5-hour" */
  label: string
  /** 0..1 fraction of the window consumed */
  utilization: number
  /** iso 8601, or null when the api doesn't say */
  resetsAt: string | null
}

export interface RateLimitSnapshot {
  windows: RateLimitWindow[]
  /** iso 8601 of the last successful poll, null if we've never had one */
  fetchedAt: string | null
  /** false when the last poll failed (429 / expired token / offline) — ui shows stale */
  ok: boolean
  /** last error string, for the diagnostics row */
  error: string | null
  /** account metadata read from ~/.claude/.credentials.json */
  subscriptionType: string | null
  rateLimitTier: string | null
}

// ── activity ─────────────────────────────────────────────────────────────────

/** a session considered live: had an assistant message within the idle window. */
export interface ActiveSession {
  sessionId: string
  machine: MachineId
  project: string
  model: string
  /** iso 8601 of the most recent assistant message */
  lastSeen: string
  /** deduped api calls in this session */
  calls: number
  tokens: TokenCounts
  costUsd: number
}

export interface MachineStatus {
  machine: MachineId
  /** iso 8601 of the last usage event or heartbeat from this machine */
  lastSeen: string | null
  /** true when lastSeen is within the staleness window */
  online: boolean
  activeSessions: number
}

// ── rollups ──────────────────────────────────────────────────────────────────

/** one bucket of a time series. */
export interface UsageBucket {
  /** YYYY-MM-DD for daily buckets, full iso 8601 for rolling windows */
  bucket: string
  tokens: TokenCounts
  costUsd: number
  calls: number
}

export interface Breakdown {
  key: string
  tokens: TokenCounts
  costUsd: number
  calls: number
}

// ── the dashboard payload ────────────────────────────────────────────────────

/** GET /api/v1/summary — everything the kiosk renders, in one shot. */
export interface SummaryResponse {
  generatedAt: string
  rateLimit: RateLimitSnapshot
  machines: MachineStatus[]
  activeSessions: ActiveSession[]
  /** rolling windows for the headline tiles */
  totals: {
    last5h: UsageBucket
    last24h: UsageBucket
    last7d: UsageBucket
    last30d: UsageBucket
  }
  /** oldest → newest, one entry per day */
  daily: UsageBucket[]
  byModel: Breakdown[]
  byProject: Breakdown[]
  byMachine: Breakdown[]
}

// ── ingest (windows agent → laptop) ──────────────────────────────────────────

/**
 * POST /api/v1/ingest — the push agent sends events it deduped locally.
 * idempotent: re-posting the same messageIds is a no-op, so the agent can
 * retry freely after the laptop was asleep.
 */
export interface IngestRequest {
  machine: MachineId
  /** agent version, for the diagnostics row */
  agentVersion: string
  events: UsageEvent[]
}

export interface IngestResponse {
  ok: boolean
  /** rows that were new (the rest were duplicates) */
  accepted: number
  duplicates: number
  error?: string
}

// ── sse ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/stream — server pushes a full summary whenever anything changes.
 * one event type keeps the client dumb: replace state, re-render.
 */
export interface StreamEvent {
  type: 'summary'
  data: SummaryResponse
}

// ── health ───────────────────────────────────────────────────────────────────

// GET /api/v1/health
export interface HealthResponse {
  ok: boolean
  name: string
  version: string
  uptimeSec: number
}
