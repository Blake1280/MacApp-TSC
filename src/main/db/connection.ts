import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { logger } from '@main/logging/logger';
import { runMigrations } from '@main/db/migrations/runner';
import { migrations } from '@main/db/migrations/index';
import { maybeFirstRunSeed } from '@main/lib/firstRunSeed';

let dbInstance: Database.Database | null = null;

function resolveDbPath(): string {
  const override = process.env.TSC_DB_PATH;
  if (override) return override;
  return join(app.getPath('userData'), 'inventory.db');
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const path = resolveDbPath();
  logger.info('Opening SQLite database', { path });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  if (process.env.TSC_DB_TRACE === '1') {
    db.function('trace', (sql: unknown) => {
      logger.debug('SQL', { sql });
      return 0;
    });
  }

  runMigrations(db, migrations);

  // Set the cached instance before seeding so the importer's nested getDb()
  // calls resolve to this connection rather than recursing into bootstrap.
  dbInstance = db;

  // First-run seed: if inventory is empty (fresh install), import the bundled
  // stocktake workbook so Jade sees all 150 items on launch instead of just
  // whatever the SQL migrations hard-coded. Idempotent — no-op once populated.
  try {
    maybeFirstRunSeed();
  } catch (err) {
    logger.error('First-run seed: bootstrap error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/** Test-only override. Lets tests inject an in-memory DB without depending
 *  on Electron's `app.getPath('userData')`. Pass null to reset. */
export function __setDbForTesting(db: Database.Database | null): void {
  dbInstance = db;
}
