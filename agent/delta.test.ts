import { describe, expect, test } from 'bun:test'
import { computeDelta } from './delta'

function assistantLine(id: string, tokens = 10): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 'sess-1',
    cwd: '/home/cody/dev/fathom',
    timestamp: '2026-08-03T12:00:00.000Z',
    message: {
      id,
      model: 'claude-sonnet-5',
      usage: { input_tokens: tokens, output_tokens: tokens },
    },
  })
}

describe('computeDelta', () => {
  test('advances the offset only to the last complete line', () => {
    const complete = assistantLine('msg-1') + '\n' + assistantLine('msg-2') + '\n'
    const partial = '{"type":"assistant","message":{"id":"msg-3"'
    const chunk = complete + partial

    const { events, newOffset } = computeDelta(0, chunk, 'desktop')

    expect(events.map((e) => e.messageId).sort()).toEqual(['msg-1', 'msg-2'])
    // offset should land exactly at the start of the partial line, not
    // include it
    expect(newOffset).toBe(new TextEncoder().encode(complete).length)
  })

  test('no trailing newline at all means no advance and no events', () => {
    const chunk = '{"type":"assistant","message":{"id":"msg-1"'
    const { events, newOffset } = computeDelta(50, chunk, 'desktop')
    expect(events).toEqual([])
    expect(newOffset).toBe(50)
  })

  test('offset is additive across repeated calls (simulated tail)', () => {
    const first = assistantLine('msg-1') + '\n'
    const r1 = computeDelta(0, first, 'desktop')
    expect(r1.newOffset).toBe(new TextEncoder().encode(first).length)

    const second = assistantLine('msg-2') + '\n'
    const r2 = computeDelta(r1.newOffset, second, 'desktop')
    expect(r2.events.map((e) => e.messageId)).toEqual(['msg-2'])
    expect(r2.newOffset).toBe(r1.newOffset + new TextEncoder().encode(second).length)
  })

  test('dedupes rewritten streaming lines within the same chunk', () => {
    // claude code rewrites the same message.id repeatedly while streaming
    const chunk =
      assistantLine('msg-1', 5) + '\n' + assistantLine('msg-1', 50) + '\n' + assistantLine('msg-1', 500) + '\n'
    const { events } = computeDelta(0, chunk, 'desktop')
    expect(events).toHaveLength(1)
    expect(events[0].tokens.input).toBe(500)
  })

  test('handles multi-byte utf8 without misplacing the offset', () => {
    const line = JSON.stringify({
      type: 'assistant',
      sessionId: 's',
      cwd: '/proj/日本語',
      timestamp: '2026-08-03T00:00:00.000Z',
      message: { id: 'msg-utf8', model: 'claude-sonnet-5', usage: { input_tokens: 1, output_tokens: 1 } },
    })
    const chunk = line + '\n'
    const { newOffset } = computeDelta(0, chunk, 'desktop')
    expect(newOffset).toBe(new TextEncoder().encode(chunk).length)
  })
})
