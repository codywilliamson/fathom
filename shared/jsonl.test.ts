import { describe, expect, test } from 'bun:test'
import { addTokens, parseTranscript, projectOf, splitComplete, ZERO_TOKENS } from './jsonl'

// shaped like a real claude code assistant line, trimmed to the fields we read
function assistantLine(opts: {
  id: string
  model?: string
  ts?: string
  cwd?: string
  sessionId?: string
  input?: number
  output?: number
  cacheCreation?: number
  cacheRead?: number
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: opts.ts ?? '2026-07-15T21:23:39.201Z',
    sessionId: opts.sessionId ?? 'sess-1',
    cwd: opts.cwd ?? '/home/shockbirds/dev/career',
    message: {
      id: opts.id,
      model: opts.model ?? 'claude-fable-5',
      usage: {
        input_tokens: opts.input ?? 2,
        output_tokens: opts.output ?? 642,
        cache_creation_input_tokens: opts.cacheCreation ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
      },
    },
  })
}

describe('projectOf', () => {
  test('takes the last path segment', () => {
    expect(projectOf('/home/shockbirds/dev/career')).toBe('career')
  })

  test('handles windows separators — the agent runs there', () => {
    expect(projectOf('C:\\Users\\cody\\dev\\gridiron')).toBe('gridiron')
  })

  test('tolerates a trailing slash', () => {
    expect(projectOf('/home/shockbirds/dev/career/')).toBe('career')
  })

  test('falls back rather than throwing', () => {
    expect(projectOf(undefined)).toBe('unknown')
    expect(projectOf('')).toBe('unknown')
  })
})

describe('splitComplete', () => {
  test('holds back a trailing partial line', () => {
    const { lines, remainder } = splitComplete('{"a":1}\n{"b":2}\n{"c":')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
    expect(remainder).toBe('{"c":')
  })

  test('a buffer with no newline is all remainder', () => {
    const { lines, remainder } = splitComplete('{"partial"')
    expect(lines).toEqual([])
    expect(remainder).toBe('{"partial"')
  })

  test('a clean trailing newline leaves nothing held back', () => {
    const { lines, remainder } = splitComplete('{"a":1}\n')
    expect(lines).toEqual(['{"a":1}'])
    expect(remainder).toBe('')
  })
})

describe('parseTranscript', () => {
  // this is the whole reason the module exists — claude code rewrites the same
  // assistant line while streaming, so summing raw lines over-counts ~3x
  test('dedups repeated streaming writes of the same message id', () => {
    const text = [
      assistantLine({ id: 'msg_1', output: 100 }),
      assistantLine({ id: 'msg_1', output: 400 }),
      assistantLine({ id: 'msg_1', output: 642 }),
      assistantLine({ id: 'msg_2', output: 50 }),
    ].join('\n')

    const events = parseTranscript(text, 'laptop')
    expect(events).toHaveLength(2)
    // last write wins — the final line carries the complete totals
    expect(events.find((e) => e.messageId === 'msg_1')?.tokens.output).toBe(642)
  })

  test('ignores non-assistant lines', () => {
    const text = [
      JSON.stringify({ type: 'user', message: { id: 'nope' } }),
      JSON.stringify({ type: 'system', subtype: 'turn_duration' }),
      assistantLine({ id: 'msg_1' }),
    ].join('\n')

    expect(parseTranscript(text, 'laptop')).toHaveLength(1)
  })

  test('skips malformed lines instead of throwing — half-written lines are normal', () => {
    const text = ['not json at all', '{"type":"assistant"', assistantLine({ id: 'msg_1' })].join(
      '\n',
    )
    expect(parseTranscript(text, 'laptop')).toHaveLength(1)
  })

  test('drops assistant lines with no message id — undedupable means untrustworthy', () => {
    const text = JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-fable-5', usage: { output_tokens: 10 } },
    })
    expect(parseTranscript(text, 'laptop')).toHaveLength(0)
  })

  test('carries machine, project, session and model through', () => {
    const [event] = parseTranscript(
      assistantLine({ id: 'msg_1', cwd: '/home/x/dev/fathom', sessionId: 'abc' }),
      'desktop',
    )
    expect(event.machine).toBe('desktop')
    expect(event.project).toBe('fathom')
    expect(event.sessionId).toBe('abc')
    expect(event.model).toBe('claude-fable-5')
  })

  test('records all four token buckets', () => {
    const [event] = parseTranscript(
      assistantLine({ id: 'msg_1', input: 2, output: 642, cacheCreation: 19063, cacheRead: 20162 }),
      'laptop',
    )
    expect(event.tokens).toEqual({
      input: 2,
      output: 642,
      cacheCreation: 19063,
      cacheRead: 20162,
    })
  })

  test('attaches a nonzero cost for a known model', () => {
    const [event] = parseTranscript(assistantLine({ id: 'msg_1' }), 'laptop')
    expect(event.costUsd).toBeGreaterThan(0)
  })

  test('empty input yields no events', () => {
    expect(parseTranscript('', 'laptop')).toHaveLength(0)
  })
})

describe('addTokens', () => {
  test('sums each bucket', () => {
    const a = { input: 1, output: 2, cacheCreation: 3, cacheRead: 4 }
    expect(addTokens(a, a)).toEqual({ input: 2, output: 4, cacheCreation: 6, cacheRead: 8 })
  })

  test('zero is an identity', () => {
    const a = { input: 1, output: 2, cacheCreation: 3, cacheRead: 4 }
    expect(addTokens(a, ZERO_TOKENS)).toEqual(a)
  })
})
