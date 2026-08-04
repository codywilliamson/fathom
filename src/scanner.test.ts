import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db'
import { Store } from './store'
import { scanFile } from './scanner'

function mem(): Store {
  return new Store(openDb(':memory:'))
}

function line(id: string, ts = '2026-08-01T00:00:00.000Z'): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    sessionId: 'sess-1',
    cwd: '/home/user/proj',
    message: { id, model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 5 } },
  })
}

function tmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fathom-scanner-'))
  return join(dir, 'transcript.jsonl')
}

describe('scanFile', () => {
  test('ingests complete lines and advances the cursor to end of file', async () => {
    const s = mem()
    const path = tmpFile()
    writeFileSync(path, line('a') + '\n' + line('b') + '\n')

    const changed = await scanFile(s, path, 'laptop')
    expect(changed).toBe(true)
    expect(s.windowTotal(0, Date.now() + 1).calls).toBe(2)

    const cursor = s.getCursor('laptop', path)
    expect(cursor?.offset).toBe(Buffer.byteLength(line('a') + '\n' + line('b') + '\n'))
  })

  test('does not consume a trailing partial line, and picks it up next scan', async () => {
    const s = mem()
    const path = tmpFile()
    const complete = line('a') + '\n'
    const partial = '{"type":"assistant","message":{"id":"b"' // deliberately truncated
    writeFileSync(path, complete + partial)

    await scanFile(s, path, 'laptop')
    expect(s.windowTotal(0, Date.now() + 1).calls).toBe(1)
    const cursor = s.getCursor('laptop', path)
    // cursor stops at the last newline — the partial line is never consumed
    expect(cursor?.offset).toBe(Buffer.byteLength(complete))

    // completing the line on the next append gets picked up
    appendFileSync(path, ',"model":"m","usage":{"input_tokens":1,"output_tokens":1}}}\n')
    const changed = await scanFile(s, path, 'laptop')
    expect(changed).toBe(true)
    expect(s.windowTotal(0, Date.now() + 1).calls).toBe(2)
  })

  test('a second scan with no new bytes is a no-op', async () => {
    const s = mem()
    const path = tmpFile()
    writeFileSync(path, line('a') + '\n')
    await scanFile(s, path, 'laptop')
    const changed = await scanFile(s, path, 'laptop')
    expect(changed).toBe(false)
    expect(s.windowTotal(0, Date.now() + 1).calls).toBe(1)
  })

  test('resets the cursor to 0 when the file shrinks (rotated/truncated)', async () => {
    const s = mem()
    const path = tmpFile()
    writeFileSync(path, line('a') + '\n' + line('b') + '\n' + line('c') + '\n')
    await scanFile(s, path, 'laptop')
    expect(s.windowTotal(0, Date.now() + 1).calls).toBe(3)

    // file got rotated: much shorter, brand new content, same name
    writeFileSync(path, line('d') + '\n')
    const changed = await scanFile(s, path, 'laptop')
    expect(changed).toBe(true)
    expect(s.windowTotal(0, Date.now() + 1).calls).toBe(4) // 3 old (still in db) + 1 new
    const cursor = s.getCursor('laptop', path)
    expect(cursor?.offset).toBe(Buffer.byteLength(line('d') + '\n'))
  })

  test('missing file is a no-op, not a throw', async () => {
    const s = mem()
    const changed = await scanFile(s, '/nonexistent/path/does-not-exist.jsonl', 'laptop')
    expect(changed).toBe(false)
  })
})
