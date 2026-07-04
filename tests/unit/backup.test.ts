import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  shell: { openExternal: async () => undefined },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));
vi.mock('../../src/main/logging/logger', () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
}));

import {
  backupDatabase,
  listBackups,
  restoreNewestBackup,
  isCorruptionError,
  backupsDir,
  KEEP_BACKUPS,
} from '../../src/main/db/backup';

describe('database backups', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tsc-backup-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('snapshots an open database and the copy is readable', async () => {
    const db = new Database(join(dir, 'live.db'));
    db.exec('CREATE TABLE t (v TEXT)');
    db.prepare('INSERT INTO t VALUES (?)').run('hello');

    const dest = await backupDatabase(db, dir);
    db.close();

    expect(existsSync(dest)).toBe(true);
    const copy = new Database(dest, { readonly: true });
    expect((copy.prepare('SELECT v FROM t').get() as { v: string }).v).toBe('hello');
    expect(copy.pragma('quick_check(1)')).toEqual([{ quick_check: 'ok' }]);
    copy.close();
  });

  it('prunes to the newest KEEP_BACKUPS copies', async () => {
    // Pre-seed more than the cap with stamped names older than any new one.
    const bdir = backupsDir(dir);
    const db = new Database(join(dir, 'live.db'));
    db.exec('CREATE TABLE t (v TEXT)');
    await backupDatabase(db, dir); // creates dir + one real backup
    for (let i = 0; i < KEEP_BACKUPS + 5; i++) {
      writeFileSync(join(bdir, `inventory-20200101-0000${String(i).padStart(2, '0')}.db`), 'x');
    }
    await backupDatabase(db, dir);
    db.close();

    const remaining = listBackups(bdir);
    expect(remaining.length).toBe(KEEP_BACKUPS);
    // The survivors are the newest — none of the oldest fillers remain.
    expect(remaining.some((f) => f.includes('20200101-000000'))).toBe(false);
  });

  it('restores the newest backup and keeps the corrupt file aside', async () => {
    const dbPath = join(dir, 'live.db');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (v TEXT)');
    db.prepare('INSERT INTO t VALUES (?)').run('good data');
    await backupDatabase(db, dir);
    db.close();

    // Trash the live file.
    writeFileSync(dbPath, 'this is not a sqlite database, sorry');

    const result = restoreNewestBackup(dbPath, dir);
    expect(result.restored).toBe(true);

    const reopened = new Database(dbPath, { readonly: true });
    expect((reopened.prepare('SELECT v FROM t').get() as { v: string }).v).toBe('good data');
    reopened.close();

    // Damaged file kept for forensics, not deleted.
    const kept = readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    expect(kept.length).toBe(1);
  });

  it('reports failure when no backups exist', () => {
    const dbPath = join(dir, 'live.db');
    writeFileSync(dbPath, 'garbage');
    const result = restoreNewestBackup(dbPath, dir);
    expect(result.restored).toBe(false);
    // Original untouched when there is nothing to restore from.
    expect(existsSync(dbPath)).toBe(true);
  });

  it('classifies corruption errors', () => {
    expect(isCorruptionError(new Error('database disk image is malformed'))).toBe(true);
    expect(isCorruptionError(new Error('file is not a database'))).toBe(true);
    expect(isCorruptionError(new Error('UNIQUE constraint failed: orders.id'))).toBe(false);
  });
});
