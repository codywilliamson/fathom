import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { walkJsonl } from './walk'

describe('walkJsonl', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fathom-agent-walk-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('finds .jsonl files nested under project dirs', async () => {
    await mkdir(join(dir, 'proj-a'), { recursive: true })
    await mkdir(join(dir, 'proj-b'), { recursive: true })
    await Bun.write(join(dir, 'proj-a', 'session-1.jsonl'), '')
    await Bun.write(join(dir, 'proj-b', 'session-2.jsonl'), '')
    await Bun.write(join(dir, 'proj-b', 'notes.txt'), '') // non-jsonl, must be ignored

    const found = (await walkJsonl(dir)).sort()
    expect(found).toEqual(
      [join(dir, 'proj-a', 'session-1.jsonl'), join(dir, 'proj-b', 'session-2.jsonl')].sort(),
    )
  })

  test('a missing root returns an empty list instead of throwing', async () => {
    const found = await walkJsonl(join(dir, 'does-not-exist'))
    expect(found).toEqual([])
  })

  test('an empty root returns an empty list', async () => {
    const found = await walkJsonl(dir)
    expect(found).toEqual([])
  })
})
