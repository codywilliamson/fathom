// persisted byte-offset-per-file cursor store. json file, keyed by absolute
// transcript path. loading tolerates a missing or corrupt file (first run,
// or someone poking at it) by starting clean rather than crashing.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type CursorStore = Record<string, number>

export async function loadCursors(path: string): Promise<CursorStore> {
  try {
    const text = await readFile(path, 'utf8')
    const data = JSON.parse(text) as unknown
    return isCursorStore(data) ? data : {}
  } catch {
    return {}
  }
}

export async function saveCursors(path: string, cursors: CursorStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(cursors, null, 2))
}

// a file smaller than its stored cursor was rotated or truncated — nothing at
// the old offset can be trusted, so start over from the beginning
export function resolveCursor(storedOffset: number, fileSize: number): number {
  return storedOffset > fileSize ? 0 : storedOffset
}

function isCursorStore(data: unknown): data is CursorStore {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
}
