import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from './config'
import { store, type Store } from './store'
import { notifyChange } from './stream'
import { parseLines, splitComplete } from '../shared/jsonl'

// walks ~/.claude/projects/**/*.jsonl, tails each file from its stored byte
// cursor, and inserts the new events. runs on an interval; notifies stream.ts
// whenever anything actually changed.

async function findTranscripts(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent<string>[]
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await findTranscripts(full)))
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full)
  }
  return files
}

/**
 * tail one transcript file from its stored cursor. reads only the new bytes,
 * parses complete lines, inserts events, and advances the cursor to the last
 * complete-line boundary (the trailing partial line waits for next time).
 * a file smaller than its stored cursor was rotated/truncated — reset to 0.
 * returns true if anything new was ingested.
 */
export async function scanFile(s: Store, path: string, machine: string): Promise<boolean> {
  const st = await stat(path).catch(() => null)
  if (!st) return false

  const cursor = s.getCursor(machine, path)
  let offset = cursor?.offset ?? 0
  if (offset > st.size) offset = 0 // shrank — start over

  if (st.size <= offset) return false // nothing new

  const chunk = await Bun.file(path).slice(offset).text()
  const { lines, remainder } = splitComplete(chunk)
  const consumed = chunk.length - remainder.length
  s.setCursor(machine, path, offset + consumed, st.mtimeMs)

  if (!lines.length) return false
  const events = parseLines(lines, machine)
  if (!events.length) return false

  const { accepted } = s.insertEvents(events)
  return accepted > 0
}

export async function scanOnce(s: Store = store()): Promise<void> {
  const projectsDir = join(config.claudeDir, 'projects')
  const files = await findTranscripts(projectsDir)

  let changed = false
  for (const path of files) {
    try {
      if (await scanFile(s, path, config.machine)) changed = true
    } catch (err) {
      console.error('scanner: failed to scan', path, err)
    }
  }

  s.touchMachine(config.machine, Date.now())
  if (changed) notifyChange()
}

export function startScanner(): void {
  const tick = async () => {
    try {
      await scanOnce()
    } catch (err) {
      console.error('scanner: tick failed', err)
    }
    setTimeout(tick, config.scanIntervalSec * 1000)
  }
  tick()
}
