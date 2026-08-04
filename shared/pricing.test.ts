import { describe, expect, test } from 'bun:test'
import { costOf, rateFor } from './pricing'

const MTOK = 1_000_000

describe('rateFor', () => {
  test('resolves an exact model id', () => {
    expect(rateFor('claude-fable-5')).toEqual({ input: 10, output: 50 })
  })

  test('resolves a dated snapshot by prefix', () => {
    expect(rateFor('claude-haiku-4-5-20251001')).toEqual({ input: 1, output: 5 })
  })

  test('prefers the longest matching prefix', () => {
    // 'claude-opus-4-8' must not be shadowed by a shorter key
    expect(rateFor('claude-opus-4-8')).toEqual({ input: 5, output: 25 })
    expect(rateFor('claude-opus-4-1')).toEqual({ input: 15, output: 75 })
  })

  test('returns null for unknown models rather than guessing a rate', () => {
    expect(rateFor('some-future-model')).toBeNull()
    expect(rateFor('')).toBeNull()
  })

  test('treats synthetic models as free', () => {
    expect(rateFor('<synthetic>')).toBeNull()
  })
})

describe('costOf', () => {
  test('prices plain input and output', () => {
    const cost = costOf('claude-fable-5', { input_tokens: MTOK, output_tokens: MTOK })
    expect(cost).toBeCloseTo(60, 6) // 10 in + 50 out
  })

  test('cache reads bill at a tenth of input', () => {
    const cost = costOf('claude-fable-5', { cache_read_input_tokens: MTOK })
    expect(cost).toBeCloseTo(1, 6) // 10 * 0.1
  })

  test('5-minute cache writes bill at 1.25x input', () => {
    const cost = costOf('claude-fable-5', {
      cache_creation_input_tokens: MTOK,
      cache_creation: { ephemeral_5m_input_tokens: MTOK, ephemeral_1h_input_tokens: 0 },
    })
    expect(cost).toBeCloseTo(12.5, 6)
  })

  test('1-hour cache writes bill at 2x input', () => {
    const cost = costOf('claude-fable-5', {
      cache_creation_input_tokens: MTOK,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: MTOK },
    })
    expect(cost).toBeCloseTo(20, 6)
  })

  // the ttl split is worth 60% on the dominant token category, so collapsing
  // the two tiers would misreport real usage badly
  test('the two cache-write tiers are priced differently', () => {
    const fiveMin = costOf('claude-fable-5', {
      cache_creation_input_tokens: MTOK,
      cache_creation: { ephemeral_5m_input_tokens: MTOK },
    })
    const oneHour = costOf('claude-fable-5', {
      cache_creation_input_tokens: MTOK,
      cache_creation: { ephemeral_1h_input_tokens: MTOK },
    })
    expect(oneHour).toBeGreaterThan(fiveMin)
  })

  test('falls back to the 5m rate when no ttl breakdown is present', () => {
    const cost = costOf('claude-fable-5', { cache_creation_input_tokens: MTOK })
    expect(cost).toBeCloseTo(12.5, 6)
  })

  test('unknown model costs zero rather than throwing', () => {
    expect(costOf('made-up-model', { input_tokens: MTOK, output_tokens: MTOK })).toBe(0)
  })

  test('empty usage costs nothing', () => {
    expect(costOf('claude-fable-5', {})).toBe(0)
  })

  test('a realistic mixed call prices every bucket', () => {
    // the shape actually seen in a sampled transcript
    const cost = costOf('claude-fable-5', {
      input_tokens: 2,
      output_tokens: 642,
      cache_creation_input_tokens: 19063,
      cache_read_input_tokens: 20162,
      cache_creation: { ephemeral_1h_input_tokens: 19063, ephemeral_5m_input_tokens: 0 },
    })
    const expected =
      (2 * 10) / MTOK +
      (642 * 50) / MTOK +
      (20162 * 10 * 0.1) / MTOK +
      (19063 * 10 * 2) / MTOK
    expect(cost).toBeCloseTo(expected, 10)
  })

  test('sonnet is cheaper than fable for identical usage', () => {
    const usage = { input_tokens: MTOK, output_tokens: MTOK }
    expect(costOf('claude-sonnet-5', usage)).toBeLessThan(costOf('claude-fable-5', usage))
  })
})
