import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { __setDbForTesting } from '../../src/main/db/connection';

/** Build a fresh in-memory SQLite database with every migration applied,
 *  in the same order as the production runner. Use as a per-test fixture:
 *
 *    let db: Database.Database;
 *    beforeEach(() => { db = freshDbWithAllMigrations(); });
 *    afterEach(() => { closeTestDb(); });
 */
export function freshDbWithAllMigrations(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  const dir = join(__dirname, '../../src/main/db/migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    db.exec(sql);
  }

  __setDbForTesting(db);
  return db;
}

export function closeTestDb(): void {
  __setDbForTesting(null);
}
