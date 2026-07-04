import type { Database } from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, renameSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@main/logging/logger';

/**
 * Automatic database backups + corruption auto-recovery.
 *
 * Motivated by the July 2026 double-corruption: the live inventory.db went
 * "database disk image is malformed" twice in 24 hours and each time the
 * only way back was manual byte-level salvage. With this in place:
 *
 *  - every app launch snapshots a healthy database into
 *    <userData>/backups/inventory-<stamp>.db (online backup API — safe
 *    while the db is open), keeping the newest KEEP_BACKUPS copies;
 *  - launches first run PRAGMA quick_check, and a corrupt database is
 *    moved aside (never deleted) and replaced by the newest backup
 *    automatically. Worst case Jade loses minutes, not orders.
 */

export const KEEP_BACKUPS = 14;

export function backupsDir(userDataPath: string): string {
  return join(userDataPath, 'backups');
}

function stamp(): string {
  // 20260704-213045 — sortable, filename-safe
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** List backup files, newest first (name-sorted — stamps are sortable). */
export function listBackups(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^inventory-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse()
    .map((f) => join(dir, f));
}

/** Snapshot the open database into the backups folder and prune old copies.
 *  Uses better-sqlite3's online backup API, so it is safe (and consistent)
 *  while the app is using the connection. */
export async function backupDatabase(db: Database, userDataPath: string): Promise<string> {
  const dir = backupsDir(userDataPath);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `inventory-${stamp()}.db`);
  await db.backup(dest);

  for (const old of listBackups(dir).slice(KEEP_BACKUPS)) {
    try {
      rmSync(old);
    } catch {
      /* pruning is best-effort */
    }
  }
  logger.info('Database backup written', { dest, sizeKb: Math.round(statSync(dest).size / 1024) });
  return dest;
}

export type RestoreResult = {
  restored: boolean;
  backupUsed?: string;
  corruptKeptAt?: string;
};

/**
 * Called when opening/verifying the database failed with corruption.
 * Moves the damaged files aside (timestamped, never deleted) and copies the
 * newest backup into place. Returns what happened so the caller can retry
 * the open and tell the user.
 */
export function restoreNewestBackup(dbPath: string, userDataPath: string): RestoreResult {
  const backups = listBackups(backupsDir(userDataPath));
  if (backups.length === 0) {
    logger.error('Database corrupt and no backups exist — cannot auto-restore');
    return { restored: false };
  }

  const suffix = `.corrupt-${stamp()}`;
  const corruptKeptAt = dbPath + suffix;
  for (const ext of ['', '-wal', '-shm']) {
    const src = dbPath + ext;
    if (existsSync(src)) {
      try {
        renameSync(src, dbPath + ext + suffix);
      } catch (err) {
        logger.error('Could not move corrupt database aside', { src, error: String(err) });
        return { restored: false };
      }
    }
  }

  const backup = backups[0]!;
  copyFileSync(backup, dbPath);
  logger.warn('Database restored from backup', { backup, corruptKeptAt });
  return { restored: true, backupUsed: backup, corruptKeptAt };
}

/** True when the error smells like file-level corruption. */
export function isCorruptionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /malformed|not a database|database corruption|SQLITE_CORRUPT/i.test(msg);
}
