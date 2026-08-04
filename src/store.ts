import type { Database } from 'bun:sqlite'
import { sharedDb } from './db'
import type {
  ActiveSession,
  Breakdown,
  MachineId,
  TokenCounts,
  UsageBucket,
  UsageEvent,
} from '../shared/types'

// typed read/write over db. all sql lives here — nothing else touches it.

export interface InsertResult {
  accepted: number
  duplicates: number
}

export interface RateLimitRow {
  payload: string | null
  fetchedAt: number | null
  ok: boolean
  error: string | null
}

export interface MachineHeartbeatRow {
  machine: MachineId
  lastSeen: number
  agentVersion: string | null
}

interface AggregateRow {
  input: number
  output: number
  cacheCreation: number
  cacheRead: number
  costUsd: number
  calls: number
}

function tokensOf(r: AggregateRow): TokenCounts {
  return { input: r.input, output: r.output, cacheCreation: r.cacheCreation, cacheRead: r.cacheRead }
}

const AGG_COLUMNS = `
  COALESCE(SUM(input_tokens), 0) AS input,
  COALESCE(SUM(output_tokens), 0) AS output,
  COALESCE(SUM(cache_creation_tokens), 0) AS cacheCreation,
  COALESCE(SUM(cache_read_tokens), 0) AS cacheRead,
  COALESCE(SUM(cost_usd), 0) AS costUsd,
  COUNT(*) AS calls
`

export class Store {
  constructor(private db: Database) {}

  // --- usage events ---

  // INSERT OR IGNORE keyed on message_id — re-ingesting the same event is a no-op
  insertEvents(events: UsageEvent[]): InsertResult {
    const insert = this.db.query(
      `INSERT OR IGNORE INTO usage_events
         (message_id, machine, session_id, project, model, ts, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    let accepted = 0
    const tx = this.db.transaction(() => {
      for (const e of events) {
        const result = insert.run(
          e.messageId,
          e.machine,
          e.sessionId,
          e.project,
          e.model,
          Date.parse(e.ts),
          e.tokens.input,
          e.tokens.output,
          e.tokens.cacheCreation,
          e.tokens.cacheRead,
          e.costUsd,
        )
        accepted += result.changes
      }
    })
    tx()
    return { accepted, duplicates: events.length - accepted }
  }

  // --- file cursors (scanner's incremental tail) ---

  getCursor(machine: MachineId, path: string): { offset: number; mtime: number } | null {
    return this.db
      .query('SELECT offset, mtime FROM file_cursors WHERE machine = ? AND path = ?')
      .get(machine, path) as { offset: number; mtime: number } | null
  }

  setCursor(machine: MachineId, path: string, offset: number, mtime: number): void {
    this.db
      .query(
        `INSERT INTO file_cursors (machine, path, offset, mtime) VALUES (?, ?, ?, ?)
         ON CONFLICT(machine, path) DO UPDATE SET offset = excluded.offset, mtime = excluded.mtime`,
      )
      .run(machine, path, offset, mtime)
  }

  // --- ratelimit snapshot (single row) ---

  // caller decides what payload/fetchedAt to pass — on a failed poll it
  // re-supplies the previous values so good data is never blanked out
  saveRateLimit(payload: string | null, fetchedAt: number | null, ok: boolean, error: string | null): void {
    this.db
      .query(
        `INSERT INTO ratelimit_snapshot (id, payload, fetched_at, ok, error) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload = excluded.payload, fetched_at = excluded.fetched_at, ok = excluded.ok, error = excluded.error`,
      )
      .run(payload, fetchedAt, ok ? 1 : 0, error)
  }

  loadRateLimit(): RateLimitRow | null {
    const row = this.db
      .query('SELECT payload, fetched_at, ok, error FROM ratelimit_snapshot WHERE id = 1')
      .get() as { payload: string | null; fetched_at: number | null; ok: number; error: string | null } | null
    if (!row) return null
    return { payload: row.payload, fetchedAt: row.fetched_at, ok: row.ok === 1, error: row.error }
  }

  // --- machine heartbeat ---

  touchMachine(machine: MachineId, lastSeen: number, agentVersion?: string | null): void {
    this.db
      .query(
        `INSERT INTO machine_heartbeat (machine, last_seen, agent_version) VALUES (?, ?, ?)
         ON CONFLICT(machine) DO UPDATE SET
           last_seen = excluded.last_seen,
           agent_version = COALESCE(excluded.agent_version, machine_heartbeat.agent_version)`,
      )
      .run(machine, lastSeen, agentVersion ?? null)
  }

  machines(): MachineHeartbeatRow[] {
    const rows = this.db
      .query('SELECT machine, last_seen, agent_version FROM machine_heartbeat ORDER BY machine')
      .all() as { machine: string; last_seen: number; agent_version: string | null }[]
    return rows.map((r) => ({ machine: r.machine, lastSeen: r.last_seen, agentVersion: r.agent_version }))
  }

  // --- aggregates (summary.ts composes these into SummaryResponse) ---

  // total tokens/cost/calls for events with ts in [sinceMs, untilMs)
  windowTotal(sinceMs: number, untilMs: number): { tokens: TokenCounts; costUsd: number; calls: number } {
    const row = this.db
      .query(`SELECT ${AGG_COLUMNS} FROM usage_events WHERE ts >= ? AND ts < ?`)
      .get(sinceMs, untilMs) as AggregateRow
    return { tokens: tokensOf(row), costUsd: row.costUsd, calls: row.calls }
  }

  // one bucket per UTC day in [sinceMs, untilMs)
  dailyBuckets(sinceMs: number, untilMs: number): UsageBucket[] {
    const rows = this.db
      .query(
        `SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS day, ${AGG_COLUMNS}
         FROM usage_events WHERE ts >= ? AND ts < ?
         GROUP BY day ORDER BY day`,
      )
      .all(sinceMs, untilMs) as (AggregateRow & { day: string })[]
    return rows.map((r) => ({ bucket: r.day, tokens: tokensOf(r), costUsd: r.costUsd, calls: r.calls }))
  }

  private breakdown(column: 'model' | 'project' | 'machine', sinceMs: number, untilMs: number): Breakdown[] {
    const rows = this.db
      .query(
        `SELECT ${column} AS key, ${AGG_COLUMNS}
         FROM usage_events WHERE ts >= ? AND ts < ?
         GROUP BY ${column} ORDER BY costUsd DESC`,
      )
      .all(sinceMs, untilMs) as (AggregateRow & { key: string })[]
    return rows.map((r) => ({ key: r.key, tokens: tokensOf(r), costUsd: r.costUsd, calls: r.calls }))
  }

  breakdownByModel(sinceMs: number, untilMs: number): Breakdown[] {
    return this.breakdown('model', sinceMs, untilMs)
  }

  breakdownByProject(sinceMs: number, untilMs: number): Breakdown[] {
    return this.breakdown('project', sinceMs, untilMs)
  }

  breakdownByMachine(sinceMs: number, untilMs: number): Breakdown[] {
    return this.breakdown('machine', sinceMs, untilMs)
  }

  // sessions that had an event at or after sinceMs. totals are over the
  // session's whole history, not clipped to the window — only "is it live"
  // is time-boxed.
  activeSessions(sinceMs: number): ActiveSession[] {
    // group by session_id ALONE. grouping by project too would split one
    // session across every directory it ever touched (claude code carries a
    // session across a cd), emitting stale rows that outlive the window and
    // disagreeing with activeSessionCounts. the bare machine/project/model
    // columns pair with MAX(ts) — sqlite guarantees they come from the row
    // that supplied the max, which is exactly the "most recent" we want.
    const rows = this.db
      .query(
        `SELECT session_id, machine, project, model, MAX(ts) AS lastSeen, ${AGG_COLUMNS}
         FROM usage_events
         GROUP BY session_id
         HAVING lastSeen >= ?
         ORDER BY lastSeen DESC`,
      )
      .all(sinceMs) as (AggregateRow & {
      session_id: string
      machine: string
      project: string
      model: string
      lastSeen: number
    })[]

    return rows.map((r) => ({
      sessionId: r.session_id,
      machine: r.machine,
      project: r.project,
      model: r.model,
      lastSeen: new Date(r.lastSeen).toISOString(),
      calls: r.calls,
      tokens: tokensOf(r),
      costUsd: r.costUsd,
    }))
  }

  // distinct active session count per machine, for MachineStatus
  activeSessionCounts(sinceMs: number): Record<string, number> {
    const rows = this.db
      .query('SELECT machine, COUNT(DISTINCT session_id) AS n FROM usage_events WHERE ts >= ? GROUP BY machine')
      .all(sinceMs) as { machine: string; n: number }[]
    return Object.fromEntries(rows.map((r) => [r.machine, r.n]))
  }
}

// lazy singleton so tests can inject :memory: without touching the real file
let sharedStore: Store | null = null
export function store(): Store {
  return (sharedStore ??= new Store(sharedDb()))
}
