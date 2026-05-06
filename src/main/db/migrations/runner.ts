import type { Database } from 'better-sqlite3';
import { logger } from '@main/logging/logger';
import type { Migration } from '@main/db/migrations/index';

/**
 * Apply pending SQL migrations in order, tracked by filename in the
 * `schema_migrations` table.
 *
 * IMPORTANT — non-idempotent SQL is fine. The `applied` set guarantees a
 * given migration only runs once per database. That's load-bearing for
 * the SQLite-incompatible operations we use:
 *
 *   - SQLite has no `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (only the
 *     plain `ADD COLUMN`). Migrations 003, 004, 005, 010, 012, 016, 017,
 *     and 018 all `ALTER TABLE … ADD COLUMN`; re-running any of them would
 *     fail with "duplicate column name".
 *   - SQLite's `CREATE INDEX IF NOT EXISTS` is fine and we use it where
 *     appropriate — but we don't rely on that as the safety net.
 *
 * Don't try to make migrations themselves idempotent — it'd hide the real
 * invariant (the tracking table). Instead: if you need to consolidate or
 * squash migrations, also drop/rebuild `schema_migrations` rows in the
 * same change so the sequence stays consistent.
 *
 * Each migration runs inside a transaction so a failure mid-DDL rolls back
 * cleanly and the tracking row is never written for a partial apply.
 */
export function runMigrations(db: Database, migrations: Migration[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db
      .prepare<[], { version: string }>('SELECT version FROM schema_migrations')
      .all()
      .map((r) => r.version),
  );

  for (const m of migrations) {
    if (applied.has(m.version)) continue;

    logger.info('Applying migration', { version: m.version });

    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
    });
    tx();
  }
}
