import os from 'node:os'
import { resolve } from 'node:path'

// only place env is read — everything else imports `config`
const env = process.env

function num(v: string | undefined, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : fallback
}

const root = resolve(import.meta.dir, '..')

export const config = {
  host: '0.0.0.0', // tailscale is the perimeter, bind wide
  port: Number(process.env.FATHOM_PORT ?? 4950),
  // optional dns-rebinding defense: comma-separated host[:port] allowlist for the Host header
  allowedHosts: (process.env.FATHOM_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),

  // this machine's id, as recorded on every usage event it ingests
  machine: env.FATHOM_MACHINE ?? os.hostname(),
  // where ~/.claude lives on this machine
  claudeDir: env.FATHOM_CLAUDE_DIR ?? resolve(os.homedir(), '.claude'),
  dbPath: env.FATHOM_DB_PATH ?? resolve(root, 'data/fathom.sqlite'),

  scanIntervalSec: num(env.FATHOM_SCAN_INTERVAL_SEC, 20),
  rateLimitIntervalSec: num(env.FATHOM_RATELIMIT_INTERVAL_SEC, 600),
  activeWindowSec: num(env.FATHOM_ACTIVE_WINDOW_SEC, 900),
  staleSec: num(env.FATHOM_STALE_SEC, 300),

  // shared secret the windows agent must send on POST /api/v1/ingest.
  // empty (default) skips the check — defense-in-depth, not the security boundary
  ingestToken: env.FATHOM_INGEST_TOKEN ?? '',
}
