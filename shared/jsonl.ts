// parse claude code transcripts into usage events. pure — no i/o, no dates,
// no config — so both the server scanner and the windows agent use it and the
// tests are trivial.
//
// THE ONE THING THAT MATTERS: claude code rewrites the same assistant line
// repeatedly while a response streams. a sampled transcript held 299 assistant
// lines carrying only 107 distinct message ids. summing without deduping on
// `message.id` over-counts tokens ~2.8x.

import type { MachineId, TokenCounts, UsageEvent } from './types'
import { costOf, type RawUsage } from './pricing'

/** the subset of a transcript line we care about. everything is optional — these files are written by a different program and we tolerate whatever shows up. */
interface TranscriptLine {
  type?: string
  timestamp?: string
  sessionId?: string
  cwd?: string
  message?: {
    id?: string
    model?: string
    usage?: RawUsage
  }
}

/** last path segment of a cwd, with windows separators handled. */
export function projectOf(cwd: string | undefined): string {
  if (!cwd) return 'unknown'
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || 'unknown'
}

function tokensOf(usage: RawUsage): TokenCounts {
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheCreation: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
  }
}

/**
 * split a buffer into complete lines plus the trailing partial.
 * tailing a file that's being appended to will land mid-line; the caller
 * advances its cursor by `consumed` and keeps the remainder for next time.
 */
export function splitComplete(text: string): { lines: string[]; remainder: string } {
  const lastNewline = text.lastIndexOf('\n')
  if (lastNewline === -1) return { lines: [], remainder: text }
  return {
    lines: text.slice(0, lastNewline).split('\n'),
    remainder: text.slice(lastNewline + 1),
  }
}

/**
 * parse complete transcript lines into deduped usage events.
 * malformed lines are skipped silently — a half-written line is normal, not an
 * error worth failing the whole scan over.
 */
export function parseLines(lines: string[], machine: MachineId): UsageEvent[] {
  const byMessageId = new Map<string, UsageEvent>()

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let parsed: TranscriptLine
    try {
      parsed = JSON.parse(trimmed) as TranscriptLine
    } catch {
      continue
    }

    if (parsed.type !== 'assistant') continue

    const message = parsed.message
    const messageId = message?.id
    const usage = message?.usage
    // no id means we can't dedup it, so we can't trust it — drop it
    if (!messageId || !usage) continue

    const model = message.model ?? 'unknown'
    const tokens = tokensOf(usage)

    // later lines for the same id carry the final totals, so last write wins
    byMessageId.set(messageId, {
      messageId,
      machine,
      sessionId: parsed.sessionId ?? 'unknown',
      project: projectOf(parsed.cwd),
      model,
      ts: parsed.timestamp ?? new Date(0).toISOString(),
      tokens,
      costUsd: costOf(model, usage),
    })
  }

  return [...byMessageId.values()]
}

/** convenience for whole-file parsing (tests, first read of a file). */
export function parseTranscript(text: string, machine: MachineId): UsageEvent[] {
  return parseLines(text.split('\n'), machine)
}

/** sum token counts — used by rollups on both sides. */
export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    cacheRead: a.cacheRead + b.cacheRead,
  }
}

export const ZERO_TOKENS: TokenCounts = {
  input: 0,
  output: 0,
  cacheCreation: 0,
  cacheRead: 0,
}
