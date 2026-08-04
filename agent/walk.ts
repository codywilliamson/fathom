// recursively find every *.jsonl under root. mirrors what claude code lays
// down at ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl, but doesn't
// assume that shape — just walks and filters by extension.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function walkJsonl(root: string): Promise<string[]> {
  const out: string[] = []

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // missing/unreadable dir isn't fatal — a fresh machine may not have
      // ~/.claude/projects yet
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full)
    }
  }

  await walk(root)
  return out
}
