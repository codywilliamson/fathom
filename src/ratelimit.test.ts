import { describe, expect, test } from 'bun:test'
import {
  cooldownRemainingSec,
  normalizeWindows,
  parseRetryAfter as parseRetryAfterForTest,
  parseStoredPayload,
} from './ratelimit'

describe('normalizeWindows', () => {
  test('returns [] for null/non-object/unrecognised payloads', () => {
    expect(normalizeWindows(null)).toEqual([])
    expect(normalizeWindows(undefined)).toEqual([])
    expect(normalizeWindows('a string')).toEqual([])
    expect(normalizeWindows(42)).toEqual([])
    expect(normalizeWindows({ some: 'unrelated', shape: true })).toEqual([])
  })

  test('maps an array under a plausible key, with a fraction field', () => {
    const raw = {
      windows: [
        { key: 'five_hour', label: '5-hour', utilization: 0.42, resetsAt: '2026-08-03T18:00:00Z' },
        { key: 'weekly', utilization: 0.1, resetsAt: null },
      ],
    }
    const windows = normalizeWindows(raw)
    expect(windows).toHaveLength(2)
    expect(windows[0]).toEqual({ key: 'five_hour', label: '5-hour', utilization: 0.42, resetsAt: '2026-08-03T18:00:00Z' })
    expect(windows[1]).toMatchObject({ key: 'weekly', label: 'weekly', utilization: 0.1, resetsAt: null })
  })

  test('tolerates a percentage field instead of a fraction', () => {
    const windows = normalizeWindows({ windows: [{ name: 'five_hour', percentage: 42 }] })
    expect(windows[0].utilization).toBeCloseTo(0.42)
  })

  test('tolerates a used/limit ratio', () => {
    const windows = normalizeWindows({ limits: [{ key: 'weekly', used: 50, limit: 200 }] })
    expect(windows[0].utilization).toBeCloseTo(0.25)
  })

  test('treats the payload itself as a single window when no array key is found', () => {
    const windows = normalizeWindows({ key: 'five_hour', fraction: 0.9 })
    expect(windows).toHaveLength(1)
    expect(windows[0].utilization).toBe(0.9)
  })

  test('drops entries with no recognisable fraction field', () => {
    const windows = normalizeWindows({ windows: [{ key: 'weird', foo: 'bar' }] })
    expect(windows).toEqual([])
  })
})

describe('parseStoredPayload', () => {
  test('round-trips a wrapped payload', () => {
    const wrapped = JSON.stringify({ raw: { windows: [] }, subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' })
    expect(parseStoredPayload(wrapped)).toEqual({
      raw: { windows: [] },
      subscriptionType: 'max',
      rateLimitTier: 'default_claude_max_5x',
    })
  })

  test('null/garbage payload degrades to empty, not a throw', () => {
    expect(parseStoredPayload(null)).toEqual({ raw: null, subscriptionType: null, rateLimitTier: null })
    expect(parseStoredPayload('not json')).toEqual({ raw: null, subscriptionType: null, rateLimitTier: null })
  })
})

describe('stored payload — regression: account metadata survives a failed poll', () => {
  // the usage endpoint is heavily rate limited and may never return 200, but
  // subscriptionType/rateLimitTier come from a local file read that always
  // works. a failed poll used to persist the previous payload verbatim (null
  // on a cold start), so the tier was permanently null in the ui.
  test('round-trips metadata even when there is no raw api body', () => {
    const carried = JSON.stringify({
      raw: null,
      subscriptionType: 'max',
      rateLimitTier: 'default_claude_max_5x',
    })
    expect(parseStoredPayload(carried)).toEqual({
      raw: null,
      subscriptionType: 'max',
      rateLimitTier: 'default_claude_max_5x',
    })
  })

  test('a payload carrying metadata still yields no windows', () => {
    const carried = JSON.stringify({ raw: null, subscriptionType: 'max', rateLimitTier: 't' })
    expect(normalizeWindows(parseStoredPayload(carried).raw)).toEqual([])
  })
})

describe('cooldown — honouring retry-after', () => {
  // the endpoint's budget is tiny and its window long (an observed retry-after
  // was 1963s). polling faster than that keeps it permanently exhausted, which
  // is exactly why the gauge stayed empty before this existed.
  test('reports no cooldown when nothing has 429d', () => {
    expect(cooldownRemainingSec(Date.now())).toBe(0)
  })

  test('a numeric retry-after parses to an absolute instant', () => {
    const now = Date.parse('2026-08-04T00:00:00.000Z')
    expect(parseRetryAfterForTest('1963', now)).toBe(now + 1963_000)
  })

  test('an http-date retry-after also parses', () => {
    const now = Date.parse('2026-08-04T00:00:00.000Z')
    const when = 'Tue, 04 Aug 2026 00:30:00 GMT'
    expect(parseRetryAfterForTest(when, now)).toBe(Date.parse(when))
  })

  test('a missing or junk retry-after yields null rather than throwing', () => {
    const now = Date.now()
    expect(parseRetryAfterForTest(null, now)).toBeNull()
    expect(parseRetryAfterForTest('soon-ish', now)).toBeNull()
  })
})
