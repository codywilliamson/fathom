import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCursors, resolveCursor, saveCursors } from './cursors'

describe('resolveCursor', () => {
  test('keeps the stored offset when the file only grew', () => {
    expect(resolveCursor(100, 500)).toBe(100)
  })

  test('resets to 0 when the file shrank (rotated/truncated)', () => {
    expect(resolveCursor(500, 100)).toBe(0)
  })

  test('unchanged file keeps its offset', () => {
    expect(resolveCursor(200, 200)).toBe(200)
  })

  test('fresh file with no stored cursor starts at 0', () => {
    expect(resolveCursor(0, 500)).toBe(0)
  })
})

describe('cursor persistence', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fathom-agent-cursors-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('missing cursor file loads as empty', async () => {
    const cursors = await loadCursors(join(dir, 'does-not-exist.json'))
    expect(cursors).toEqual({})
  })

  test('round-trips through save + load', async () => {
    const path = join(dir, 'nested', 'cursors.json')
    await saveCursors(path, { 'a.jsonl': 42, 'b.jsonl': 7 })
    const loaded = await loadCursors(path)
    expect(loaded).toEqual({ 'a.jsonl': 42, 'b.jsonl': 7 })
  })

  test('corrupt json loads as empty rather than throwing', async () => {
    const path = join(dir, 'cursors.json')
    await Bun.write(path, '{ not valid json')
    const cursors = await loadCursors(path)
    expect(cursors).toEqual({})
  })

  test('a json array (wrong shape) loads as empty', async () => {
    const path = join(dir, 'cursors.json')
    await Bun.write(path, '[1, 2, 3]')
    const cursors = await loadCursors(path)
    expect(cursors).toEqual({})
  })
})
