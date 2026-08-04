import { describe, expect, test } from 'bun:test'
import { openDb } from './db'
import { Store } from './store'
import type { UsageEvent } from '../shared/types'

function mem(): Store {
  return new Store(openDb(':memory:'))
}

function ev(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    messageId: 'msg-1',
    machine: 'laptop',
    sessionId: 'sess-1',
    project: 'fathom',
    model: 'claude-sonnet-5',
    ts: '2026-08-01T00:00:00.000Z',
    tokens: { input: 100, output: 50, cacheCreation: 0, cacheRead: 0 },
    costUsd: 0.01,
    ...overrides,
  }
}

describe('insertEvents', () => {
  test('is idempotent on messageId', () => {
    const s = mem()
    const r1 = s.insertEvents([ev()])
    expect(r1).toEqual({ accepted: 1, duplicates: 0 })
    const r2 = s.insertEvents([ev()])
    expect(r2).toEqual({ accepted: 0, duplicates: 1 })

    const total = s.windowTotal(0, Date.now() + 1)
    expect(total.calls).toBe(1)
  })

  test('mixed batch reports accepted and duplicate counts separately', () => {
    const s = mem()
    s.insertEvents([ev({ messageId: 'a' })])
    const result = s.insertEvents([ev({ messageId: 'a' }), ev({ messageId: 'b' })])
    expect(result).toEqual({ accepted: 1, duplicates: 1 })
  })
})

describe('rolling windows and daily buckets', () => {
  test('windowTotal sums only events inside [since, until)', () => {
    const s = mem()
    const now = Date.parse('2026-08-03T12:00:00.000Z')
    s.insertEvents([
      ev({ messageId: '1', ts: new Date(now - 1000).toISOString(), tokens: { input: 10, output: 0, cacheCreation: 0, cacheRead: 0 }, costUsd: 1 }),
      ev({ messageId: '2', ts: new Date(now - 6 * 3_600_000).toISOString(), tokens: { input: 20, output: 0, cacheCreation: 0, cacheRead: 0 }, costUsd: 2 }),
      ev({ messageId: '3', ts: new Date(now - 40 * 86_400_000).toISOString(), tokens: { input: 30, output: 0, cacheCreation: 0, cacheRead: 0 }, costUsd: 3 }),
    ])

    const last5h = s.windowTotal(now - 5 * 3_600_000, now)
    expect(last5h.calls).toBe(1)
    expect(last5h.tokens.input).toBe(10)
    expect(last5h.costUsd).toBe(1)

    const last24h = s.windowTotal(now - 86_400_000, now)
    expect(last24h.calls).toBe(2)
    expect(last24h.tokens.input).toBe(30)

    const last30d = s.windowTotal(now - 30 * 86_400_000, now)
    expect(last30d.calls).toBe(2) // the 40-day-old event falls outside
  })

  test('dailyBuckets groups by UTC day', () => {
    const s = mem()
    s.insertEvents([
      ev({ messageId: '1', ts: '2026-08-01T01:00:00.000Z', tokens: { input: 5, output: 0, cacheCreation: 0, cacheRead: 0 }, costUsd: 0.5 }),
      ev({ messageId: '2', ts: '2026-08-01T23:00:00.000Z', tokens: { input: 5, output: 0, cacheCreation: 0, cacheRead: 0 }, costUsd: 0.5 }),
      ev({ messageId: '3', ts: '2026-08-02T00:00:00.000Z', tokens: { input: 7, output: 0, cacheCreation: 0, cacheRead: 0 }, costUsd: 0.7 }),
    ])
    const buckets = s.dailyBuckets(Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-08-03T00:00:00Z'))
    expect(buckets).toHaveLength(2)
    expect(buckets[0]).toMatchObject({ bucket: '2026-08-01', calls: 2 })
    expect(buckets[0].tokens.input).toBe(10)
    expect(buckets[1]).toMatchObject({ bucket: '2026-08-02', calls: 1 })
  })
})

describe('breakdowns', () => {
  test('group by model/project/machine', () => {
    const s = mem()
    s.insertEvents([
      ev({ messageId: '1', model: 'claude-sonnet-5', project: 'fathom', machine: 'laptop', costUsd: 1 }),
      ev({ messageId: '2', model: 'claude-opus-5', project: 'fathom', machine: 'laptop', costUsd: 2 }),
      ev({ messageId: '3', model: 'claude-sonnet-5', project: 'bouy', machine: 'desktop', costUsd: 3 }),
    ])
    const byModel = s.breakdownByModel(0, Date.now() + 1)
    expect(byModel.map((b) => b.key).sort()).toEqual(['claude-opus-5', 'claude-sonnet-5'])

    const byProject = s.breakdownByProject(0, Date.now() + 1)
    expect(byProject.map((b) => b.key).sort()).toEqual(['bouy', 'fathom'])

    const byMachine = s.breakdownByMachine(0, Date.now() + 1)
    expect(byMachine.map((b) => b.key).sort()).toEqual(['desktop', 'laptop'])
  })
})

describe('active sessions', () => {
  test('only sessions with a recent event are returned, totals cover the whole session', () => {
    const s = mem()
    const now = Date.now()
    s.insertEvents([
      ev({ messageId: '1', sessionId: 'live', ts: new Date(now - 60_000).toISOString(), costUsd: 1 }),
      ev({ messageId: '2', sessionId: 'live', ts: new Date(now - 30 * 60_000).toISOString(), costUsd: 1 }),
      ev({ messageId: '3', sessionId: 'stale', ts: new Date(now - 2 * 3_600_000).toISOString(), costUsd: 5 }),
    ])
    const active = s.activeSessions(now - 15 * 60_000)
    expect(active).toHaveLength(1)
    expect(active[0].sessionId).toBe('live')
    expect(active[0].calls).toBe(2) // both events in the session count, not just the recent one
    expect(active[0].costUsd).toBe(2)
  })
})

describe('file cursors', () => {
  test('round-trips offset and mtime, per machine+path', () => {
    const s = mem()
    expect(s.getCursor('laptop', '/a.jsonl')).toBeNull()
    s.setCursor('laptop', '/a.jsonl', 100, 12345)
    expect(s.getCursor('laptop', '/a.jsonl')).toEqual({ offset: 100, mtime: 12345 })
    s.setCursor('laptop', '/a.jsonl', 200, 12399)
    expect(s.getCursor('laptop', '/a.jsonl')).toEqual({ offset: 200, mtime: 12399 })
    expect(s.getCursor('desktop', '/a.jsonl')).toBeNull()
  })
})

describe('ratelimit snapshot', () => {
  test('round-trips, and a failed save can keep the previous payload', () => {
    const s = mem()
    expect(s.loadRateLimit()).toBeNull()

    s.saveRateLimit('{"ok":true}', 1000, true, null)
    expect(s.loadRateLimit()).toEqual({ payload: '{"ok":true}', fetchedAt: 1000, ok: true, error: null })

    // caller re-supplies the previous payload/fetchedAt on failure
    const prev = s.loadRateLimit()!
    s.saveRateLimit(prev.payload, prev.fetchedAt, false, 'http 429')
    expect(s.loadRateLimit()).toEqual({ payload: '{"ok":true}', fetchedAt: 1000, ok: false, error: 'http 429' })
  })
})

describe('machine heartbeat', () => {
  test('touchMachine upserts, agentVersion sticks when a later touch omits it', () => {
    const s = mem()
    s.touchMachine('laptop', 1000, 'v1')
    s.touchMachine('laptop', 2000)
    const machines = s.machines()
    expect(machines).toEqual([{ machine: 'laptop', lastSeen: 2000, agentVersion: 'v1' }])
  })
})

describe('activeSessions — regression: one session spanning several projects', () => {
  const NOW = Date.parse('2026-08-01T12:00:00.000Z')
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

  // claude code carries one session across a `cd`, so the same session_id shows
  // up under several projects. grouping by (session_id, project) split that into
  // one row per project — stale rows outlived the window and the list disagreed
  // with the per-machine count.
  test('collapses to one row using the most recent project, not one per project', () => {
    const s = mem()
    s.insertEvents([
      ev({ messageId: 'm1', sessionId: 'sess-x', project: 'shipwright', ts: iso(40 * 60_000) }),
      ev({ messageId: 'm2', sessionId: 'sess-x', project: 'dev', ts: iso(20 * 60_000) }),
      ev({ messageId: 'm3', sessionId: 'sess-x', project: 'fathom', ts: iso(60_000) }),
    ])

    const sessions = s.activeSessions(NOW - 15 * 60_000)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].project).toBe('fathom')
    // totals still cover the session's whole history, not just the window
    expect(sessions[0].calls).toBe(3)
  })

  test('agrees with activeSessionCounts', () => {
    const s = mem()
    s.insertEvents([
      ev({ messageId: 'm1', sessionId: 'sess-x', project: 'a', ts: iso(40 * 60_000) }),
      ev({ messageId: 'm2', sessionId: 'sess-x', project: 'b', ts: iso(60_000) }),
    ])
    const cutoff = NOW - 15 * 60_000
    expect(s.activeSessions(cutoff)).toHaveLength(s.activeSessionCounts(cutoff).laptop)
  })

  test('excludes a session whose latest event predates the window', () => {
    const s = mem()
    s.insertEvents([ev({ messageId: 'm1', sessionId: 'old', ts: iso(60 * 60_000) })])
    expect(s.activeSessions(NOW - 15 * 60_000)).toHaveLength(0)
  })
})
