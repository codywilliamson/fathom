// model → usd rates, and the cost math for one api call.
// used by the backend and the windows agent, so it lives in shared/.
//
// cody is on a max subscription: these dollars are NOTIONAL — what the same
// tokens would have cost on the api. the ui labels them that way.

/** usd per million tokens. */
export interface ModelRate {
  input: number
  output: number
}

const MTOK = 1_000_000

/** cache reads bill at ~0.1x the input rate. */
const CACHE_READ_MULTIPLIER = 0.1
/** cache writes: 1.25x for the 5-minute ttl, 2x for the 1-hour ttl. */
const CACHE_WRITE_5M_MULTIPLIER = 1.25
const CACHE_WRITE_1H_MULTIPLIER = 2

/**
 * rates as published for the first-party api. keys are matched by longest
 * prefix, so dated snapshots (claude-haiku-4-5-20251001) resolve to their base.
 */
export const RATES: Record<string, ModelRate> = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-mythos-preview': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-opus-4-0': { input: 15, output: 75 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4-0': { input: 3, output: 15 },
  'claude-3-7-sonnet': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
}

/** synthetic models claude code reports that carry no billable cost. */
const FREE_MODELS = new Set(['<synthetic>'])

/**
 * longest-prefix match so dated snapshots and unknown suffixes still resolve.
 * returns null for unknown models — callers treat that as zero cost rather
 * than guessing a rate.
 */
export function rateFor(model: string): ModelRate | null {
  if (!model || FREE_MODELS.has(model)) return null
  if (RATES[model]) return RATES[model]
  let best: string | null = null
  for (const key of Object.keys(RATES)) {
    if (model.startsWith(key) && (best === null || key.length > best.length)) best = key
  }
  return best ? RATES[best] : null
}

/**
 * the usage breakdown as claude code writes it into the transcript. the 5m/1h
 * split matters: cache writes dominate real usage and the two tiers differ by
 * 60%, so collapsing them would misreport cost badly.
 */
export interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
}

/** usd for a single api call. unknown model → 0. */
export function costOf(model: string, usage: RawUsage): number {
  const rate = rateFor(model)
  if (!rate) return 0

  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const totalWrite = usage.cache_creation_input_tokens ?? 0

  // prefer the explicit ttl split; fall back to treating everything as 5m
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const write5mReported = usage.cache_creation?.ephemeral_5m_input_tokens
  const write5m =
    write5mReported !== undefined ? write5mReported : Math.max(0, totalWrite - write1h)

  const perInputToken = rate.input / MTOK
  return (
    input * perInputToken +
    output * (rate.output / MTOK) +
    cacheRead * perInputToken * CACHE_READ_MULTIPLIER +
    write5m * perInputToken * CACHE_WRITE_5M_MULTIPLIER +
    write1h * perInputToken * CACHE_WRITE_1H_MULTIPLIER
  )
}
