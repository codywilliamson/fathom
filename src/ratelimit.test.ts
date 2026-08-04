import { describe, expect, test } from 'bun:test'
import {
  captureRateLimitHeaders,
  cooldownRemainingSec,
  normalizeWindows,
  parseRetryAfter,
  parseStoredPayload,
} from './ratelimit'

// captured verbatim from a real /v1/messages response on this account
const REAL_HEADERS: Record<string, string> = {
  'anthropic-ratelimit-unified-status': 'allowed',
  'anthropic-ratelimit-unified-5h-status': 'allowed',
  'anthropic-ratelimit-unified-5h-reset': '1785817800',
  'anthropic-ratelimit-unified-5h-utilization': '0.26',
  'anthropic-ratelimit-unified-7d-status': 'allowed',
  'anthropic-ratelimit-unified-7d-reset': '1786082400',
  'anthropic-ratelimit-unified-7d-utilization': '0.19',
  'anthropic-ratelimit-unified-representative-claim': 'five_hour',
}

describe('captureRateLimitHeaders', () => {
  test('keeps the anthropic-ratelimit-* headers and drops the rest', () => {
    const headers = new Headers({
      'content-type': 'application/json',
      'anthropic-ratelimit-unified-5h-utilization': '0.26',
      'request-id': 'req_123',
    })
    expect(captureRateLimitHeaders(headers)).toEqual({
      'anthropic-ratelimit-unified-5h-utilization': '0.26',
    })
  })

  test('is empty when a response carries none', () => {
    expect(captureRateLimitHeaders(new Headers({ 'content-type': 'text/plain' }))).toEqual({})
  })
})

describe('normalizeWindows', () => {
  test('maps the real headers into 5-hour and weekly windows', () => {
    expect(normalizeWindows(REAL_HEADERS)).toEqual([
      {
        key: 'five_hour',
        label: '5-hour',
        utilization: 0.26,
        resetsAt: new Date(1785817800 * 1000).toISOString(),
      },
      {
        key: 'seven_day',
        label: 'weekly · all models',
        utilization: 0.19,
        resetsAt: new Date(1786082400 * 1000).toISOString(),
      },
    ])
  })

  test('returns [] for junk rather than throwing', () => {
    expect(normalizeWindows(null)).toEqual([])
    expect(normalizeWindows(undefined)).toEqual([])
    expect(normalizeWindows('a string')).toEqual([])
    expect(normalizeWindows(42)).toEqual([])
    expect(normalizeWindows({ unrelated: 'headers' })).toEqual([])
  })

  test('skips a window whose utilization header is missing', () => {
    const partial = { ...REAL_HEADERS }
    delete partial['anthropic-ratelimit-unified-7d-utilization']
    const windows = normalizeWindows(partial)
    expect(windows).toHaveLength(1)
    expect(windows[0].key).toBe('five_hour')
  })

  test('a window with no reset header still reports its utilization', () => {
    expect(normalizeWindows({ 'anthropic-ratelimit-unified-5h-utilization': '0.5' })).toEqual([
      { key: 'five_hour', label: '5-hour', utilization: 0.5, resetsAt: null },
    ])
  })

  test('tolerates a 0..100 percentage and clamps at 1', () => {
    expect(
      normalizeWindows({ 'anthropic-ratelimit-unified-5h-utilization': '42' })[0],
    ).toMatchObject({ utilization: 0.42 })
    expect(
      normalizeWindows({ 'anthropic-ratelimit-unified-5h-utilization': '250' })[0],
    ).toMatchObject({ utilization: 1 })
  })

  test('a fully consumed window reports 1, not empty', () => {
    expect(normalizeWindows({ 'anthropic-ratelimit-unified-5h-utilization': '1' })[0].utilization).toBe(1)
  })
})

describe('stored payload — regression: account metadata survives a failed poll', () => {
  // subscriptionType/rateLimitTier come from a local file read that always
  // works. a failed poll used to persist the previous payload verbatim (null
  // on a cold start), so the tier was permanently null in the ui.
  test('round-trips metadata even when there are no captured headers', () => {
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

  test('round-trips captured headers', () => {
    const stored = JSON.stringify({
      raw: REAL_HEADERS,
      subscriptionType: 'max',
      rateLimitTier: 't',
    })
    expect(normalizeWindows(parseStoredPayload(stored).raw)).toHaveLength(2)
  })

  test('junk payload degrades to empty rather than throwing', () => {
    expect(parseStoredPayload('not json')).toEqual({
      raw: null,
      subscriptionType: null,
      rateLimitTier: null,
    })
  })
})

describe('cooldown — honouring retry-after', () => {
  test('reports no cooldown when nothing has 429d', () => {
    expect(cooldownRemainingSec(Date.now())).toBe(0)
  })

  test('a numeric retry-after parses to an absolute instant', () => {
    const now = Date.parse('2026-08-04T00:00:00.000Z')
    expect(parseRetryAfter('1963', now)).toBe(now + 1963_000)
  })

  test('an http-date retry-after also parses', () => {
    const now = Date.parse('2026-08-04T00:00:00.000Z')
    const when = 'Tue, 04 Aug 2026 00:30:00 GMT'
    expect(parseRetryAfter(when, now)).toBe(Date.parse(when))
  })

  test('a missing or junk retry-after yields null rather than throwing', () => {
    const now = Date.now()
    expect(parseRetryAfter(null, now)).toBeNull()
    expect(parseRetryAfter('soon-ish', now)).toBeNull()
  })
})
