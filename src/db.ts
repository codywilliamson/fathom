import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from './config'

// bun:sqlite open + migrations. nothing else touches sql except store.ts,
// which builds its queries on the handle exported here.

const MIGRATIONS: string[] = [
  `
  CREATE TABLE usage_events (
    message_id TEXT PRIMARY KEY,
    machine TEXT NOT NULL,
    session_id TEXT NOT NULL,
    project TEXT NOT NULL,
    model TEXT NOT NULL,
    ts INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_creation_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL
  );
  CREATE INDEX idx_usage_events_ts ON usage_events (ts);
  CREATE INDEX idx_usage_events_machine_ts ON usage_events (machine, ts);

  -- scanner's byte cursor per transcript file, so a poll only reads new bytes
  CREATE TABLE file_cursors (
    machine TEXT NOT NULL,
    path TEXT NOT NULL,
    offset INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    PRIMARY KEY (machine, path)
  );

  -- single-row cache of the last oauth usage poll. payload/fetched_at are
  -- nullable: null until the first successful poll, and preserved (not
  -- blanked) across later failures — ok/error track the latest attempt.
  CREATE TABLE ratelimit_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT,
    fetched_at INTEGER,
    ok INTEGER NOT NULL,
    error TEXT
  );

  CREATE TABLE machine_heartbeat (
    machine TEXT PRIMARY KEY,
    last_seen INTEGER NOT NULL,
    agent_version TEXT
  );
  `,
]

export function openDb(path: string = config.dbPath): Database {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path, { create: true })
  db.exec('PRAGMA journal_mode = WAL;')
  migrate(db)
  return db
}

function migrate(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const row = db.query('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }
  const current = row?.v ?? 0
  for (let v = current; v < MIGRATIONS.length; v++) {
    const apply = db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(v + 1, Date.now())
    })
    apply()
  }
}

// lazy singleton so tests can open :memory: without touching the real file
let shared: Database | null = null
export function sharedDb(): Database {
  return (shared ??= openDb())
}
