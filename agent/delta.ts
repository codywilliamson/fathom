// pure "what's new in this chunk of a file" logic — reused by the agent's
// main loop, kept separate so it's testable without touching the filesystem.

import { parseLines, splitComplete } from '../shared/jsonl'
import type { MachineId, UsageEvent } from '../shared/types'

export interface FileDelta {
  events: UsageEvent[]
  /** byte offset to persist — only ever a complete-line boundary */
  newOffset: number
}

const encoder = new TextEncoder()

/**
 * `chunkText` is everything read from `offset` onward. the cursor only ever
 * advances to the last complete line — a half-written line is normal (claude
 * code is still streaming it) and gets picked up whole on the next run.
 */
export function computeDelta(offset: number, chunkText: string, machine: MachineId): FileDelta {
  const { lines, remainder } = splitComplete(chunkText)
  const events = parseLines(lines, machine)
  const consumedBytes = encoder.encode(chunkText).length - encoder.encode(remainder).length
  return { events, newOffset: offset + consumedBytes }
}
