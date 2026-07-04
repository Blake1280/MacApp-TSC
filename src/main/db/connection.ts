import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { logger } from '@main/logging/logger';
import { runMigrations } from '@main/db/migrations/runner';
import { migrations } from '@main/db/migrations/index';
import { maybeFirstRunSeed } from '@main/lib/firstRunSeed';
import { restoreNewestBackup, isCorruptionError, type RestoreResult } from '@main/db/backup';

let dbInstance: Database.Database | null = null;

/** Set when getDb() had to fall back to a backup because the live file was
 *  corrupt. index.ts reads this after startup to tell the user what
 *  happened (and what data window may be missing). */
let lastRestore: RestoreResult | null = null;

export function getLastRestoreResult(): RestoreResult | null {
  return lastRestore;
}

function resolveDbPath(): string {
  const override = process.env.TSC_DB_PATH;
  if (override) return override;
  return join(app.getPath('userData'), 'inventory.db');
}

/** Open + verify + migrate. Throws on corruption so getDb can attempt a
 *  backup restore and retry. */
function openAndPrepare(path: string): Database.Database {
  const db = new Database(path);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');

    // Fail fast on a damaged file BEFORE migrations touch it. quick_check
    // is the cheaper cousin of integrity_check — a few ms at this size.
    const check = db.pragma('quick_check(1)') as Array<{ quick_check: string }>;
    const verdict = check[0]?.quick_check ?? 'unknown';
    if (verdict !== 'ok') {
      throw new Error(`database disk image is malformed (quick_check: ${verdict})`);
    }

    if (process.env.TSC_DB_TRACE === '1') {
      db.function('trace', (sql: unknown) => {
        logger.debug('SQL', { sql });
        return 0;
      });
    }

    runMigrations(db, migrations);
    return db;
  } catch (err) {
    try {
      db.close();
    } catch {
      /* already unusable */
    }
    throw err;
  }
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const path = resolveDbPath();
  logger.info('Opening SQLite database', { path });

  let db: Database.Database;
  try {
    db = openAndPrepare(path);
  } catch (err) {
    if (!isCorruptionError(err)) throw err;
    // Corrupt file: move it aside (kept for forensics) and fall back to the
    // newest automatic backup. See backup.ts for why this exists.
    logger.error('Database is corrupt — attempting restore from backup', {
      error: err instanceof Error ? err.message : String(err),
    });
    const restore = restoreNewestBackup(path, app.getPath('userData'));
    lastRestore = restore;
    if (!restore.restored) throw err;
    db = openAndPrepare(path);
  }

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
