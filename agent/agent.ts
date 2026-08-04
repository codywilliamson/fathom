// standalone windows push agent. one run = one sync pass:
//   walk ~/.claude/projects -> read new bytes per file -> parse -> POST to
//   the laptop -> advance cursors only for what the server confirmed.
//
// at-least-once, never exactly-once: message.id dedup on the server means
// re-sending is always safe. so on any failure we just leave the cursor
// where it was and exit non-zero — the next scheduled run retries. the
// laptop being asleep is the normal case, not an exception.
//
// run directly: `bun agent/agent.ts`. see docs/windows-setup.md for the
// full windows install + task scheduler setup.

import { join } from 'node:path'
import { chunkEvents } from './batch'
import { type AgentConfig, loadConfig } from './config'
import { type CursorStore, loadCursors, resolveCursor, saveCursors } from './cursors'
import { computeDelta } from './delta'
import { walkJsonl } from './walk'
import type { IngestRequest, IngestResponse, UsageEvent } from '../shared/types'
import pkg from '../package.json'

const AGENT_VERSION: string = pkg.version

interface RunStats {
  found: number
  sent: number
  accepted: number
  duplicates: number
  filesFailed: number
}

async function postBatch(config: AgentConfig, events: UsageEvent[]): Promise<IngestResponse> {
  const body: IngestRequest = { machine: config.machine, agentVersion: AGENT_VERSION, events }
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.token) headers['x-fathom-token'] = config.token

  const res = await fetch(`${config.server}/api/v1/ingest`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    // a sleeping laptop must fail fast, not hang the scheduled task forever
    signal: AbortSignal.timeout(config.timeoutMs),
  })
  if (!res.ok) throw new Error(`ingest ${res.status} ${res.statusText}`)
  return (await res.json()) as IngestResponse
}

// read + parse one file's new bytes. local i/o errors (file vanished, etc)
// are not fatal to the run — skip the file, try again next time.
async function readDelta(
  file: string,
  cursors: CursorStore,
  machine: string,
): Promise<{ events: UsageEvent[]; newOffset: number } | null> {
  const bunFile = Bun.file(file)
  const size = bunFile.size
  const offset = resolveCursor(cursors[file] ?? 0, size)
  if (offset === size) return { events: [], newOffset: offset }

  try {
    const chunkText = await bunFile.slice(offset).text()
    return computeDelta(offset, chunkText, machine)
  } catch (err) {
    console.error(`fathom-agent: could not read ${file}: ${(err as Error).message}`)
    return null
  }
}

async function run(config: AgentConfig): Promise<RunStats> {
  const projectsDir = join(config.claudeDir, 'projects')
  const files = await walkJsonl(projectsDir)
  const cursors = await loadCursors(config.cursorFile)

  const stats: RunStats = { found: 0, sent: 0, accepted: 0, duplicates: 0, filesFailed: 0 }
  let stopEarly = false

  for (const file of files) {
    if (stopEarly) break

    const delta = await readDelta(file, cursors, config.machine)
    if (!delta) continue // read failure, already logged, keep old cursor

    if (delta.events.length === 0) {
      // no complete new lines (or only blank/non-assistant ones) — safe to
      // persist even without a network round trip
      cursors[file] = delta.newOffset
      continue
    }

    stats.found += delta.events.length
    const batches = chunkEvents(delta.events, config.batchSize)
    let fileOk = true

    for (const batch of batches) {
      try {
        const result = await postBatch(config, batch)
        stats.sent += batch.length
        stats.accepted += result.accepted
        stats.duplicates += result.duplicates
      } catch (err) {
        fileOk = false
        console.error(`fathom-agent: failed to post ${file}: ${(err as Error).message}`)
        // further posts will likely fail too (server unreachable) — stop
        // instead of burning the timeout on every remaining file
        stopEarly = true
        break
      }
    }

    if (fileOk) cursors[file] = delta.newOffset
    else stats.filesFailed++
  }

  await saveCursors(config.cursorFile, cursors)
  return stats
}

async function main(): Promise<number> {
  let config: AgentConfig
  try {
    config = loadConfig()
  } catch (err) {
    console.error(`fathom-agent: ${(err as Error).message}`)
    return 1
  }

  const stats = await run(config)
  const ok = stats.filesFailed === 0
  console.log(
    `fathom-agent: found=${stats.found} sent=${stats.sent} accepted=${stats.accepted} ` +
      `duplicates=${stats.duplicates} errors=${stats.filesFailed} ${ok ? 'ok' : 'FAILED'}`,
  )
  return ok ? 0 : 1
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('fathom-agent: fatal', err)
      process.exit(1)
    })
}

export { main, run }
