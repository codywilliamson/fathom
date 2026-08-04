// only place env is read for the agent — everything else imports the config it builds

import { homedir, hostname } from 'node:os'
import { join } from 'node:path'

export interface AgentConfig {
  server: string
  machine: string
  token: string | undefined
  claudeDir: string
  cursorFile: string
  batchSize: number
  timeoutMs: number
}

const DEFAULT_BATCH_SIZE = 1000
const DEFAULT_TIMEOUT_MS = 10_000

// windows: %LOCALAPPDATA%\fathom\cursors.json. anywhere LOCALAPPDATA isn't
// set (linux/mac dev boxes, ci) falls back to ~/.fathom/cursors.json
function defaultCursorFile(env: Record<string, string | undefined>): string {
  if (env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'fathom', 'cursors.json')
  return join(homedir(), '.fathom', 'cursors.json')
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  const server = env.FATHOM_SERVER
  if (!server) throw new Error('FATHOM_SERVER is required, e.g. http://laptop-hostname:4950')

  return {
    server: server.replace(/\/+$/, ''),
    machine: env.FATHOM_MACHINE || hostname(),
    token: env.FATHOM_INGEST_TOKEN || undefined,
    claudeDir: env.FATHOM_CLAUDE_DIR || join(homedir(), '.claude'),
    cursorFile: env.FATHOM_CURSOR_FILE || defaultCursorFile(env),
    batchSize: DEFAULT_BATCH_SIZE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }
}
