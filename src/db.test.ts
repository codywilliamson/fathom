import { describe, expect, test } from 'bun:test'
import { openDb } from './db'

describe('openDb', () => {
  test('migrates a fresh :memory: db and is idempotent to reopen', () => {
    const db = openDb(':memory:')
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(['usage_events', 'file_cursors', 'ratelimit_snapshot', 'machine_heartbeat', 'schema_migrations']),
    )
  })

  test('usage_events.message_id is the primary key', () => {
    const db = openDb(':memory:')
    db.query(
      `INSERT INTO usage_events
         (message_id, machine, session_id, project, model, ts, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd)
       VALUES ('m1', 'laptop', 's1', 'p', 'model', 0, 1, 1, 0, 0, 0)`,
    ).run()
    expect(() =>
      db
        .query(
          `INSERT INTO usage_events
             (message_id, machine, session_id, project, model, ts, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd)
           VALUES ('m1', 'laptop', 's1', 'p', 'model', 0, 1, 1, 0, 0, 0)`,
        )
        .run(),
    ).toThrow()
  })
})
