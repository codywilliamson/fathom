import { describe, expect, test } from 'bun:test'
import { openDb } from './db'
import { Store } from './store'
import { buildSummary } from './summary'
import type { UsageEvent } from '../shared/types'

function mem(): Store {
  return new Store(openDb(':memory:'))
}

function ev(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    messageId: 'm1',
    machine: 'laptop',
    sessionId: 's1',
    project: 'fathom',
    model: 'claude-sonnet-5',
    ts: '2026-08-03T11:00:00.000Z',
    tokens: { input: 10, output: 5, cacheCreation: 0, cacheRead: 0 },
    costUsd: 0.5,
    ...overrides,
  }
}

describe('buildSummary', () => {
  test('assembles rollups, breakdowns, active sessions, and machine status', () => {
    const s = mem()
    const now = Date.parse('2026-08-03T12:00:00.000Z')
    s.insertEvents([ev({ messageId: 'm1', ts: new Date(now - 60_000).toISOString() })])
    s.touchMachine('laptop', now - 10_000)

    const summary = buildSummary(s, now)

    expect(summary.totals.last5h.calls).toBe(1)
    expect(summary.totals.last24h.calls).toBe(1)
    expect(summary.byModel).toHaveLength(1)
    expect(summary.byProject[0].key).toBe('fathom')
    expect(summary.byMachine[0].key).toBe('laptop')
    expect(summary.activeSessions).toHaveLength(1)
    expect(summary.machines).toEqual([{ machine: 'laptop', lastSeen: new Date(now - 10_000).toISOString(), online: true, activeSessions: 1 }])
  })

  test('a machine goes offline once its heartbeat is older than the stale window', () => {
    const s = mem()
    const now = Date.parse('2026-08-03T12:00:00.000Z')
    s.touchMachine('desktop', now - 3_600_000) // an hour old, default stale window is 300s
    const summary = buildSummary(s, now)
    expect(summary.machines[0].online).toBe(false)
  })

  test('no ratelimit snapshot yet renders as not-ok with empty windows, not a throw', () => {
    const s = mem()
    const summary = buildSummary(s, Date.now())
    expect(summary.rateLimit).toEqual({
      windows: [],
      fetchedAt: null,
      ok: false,
      error: null,
      subscriptionType: null,
      rateLimitTier: null,
    })
  })
})
