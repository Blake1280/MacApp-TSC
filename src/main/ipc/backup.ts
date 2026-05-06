import { app, dialog } from 'electron';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { router, publicProcedure } from '@main/ipc/trpc';
import { closeDb, getDb } from '@main/db/connection';
import { logger } from '@main/logging/logger';
import { runMigrations } from '@main/db/migrations/runner';
import { migrations } from '@main/db/migrations/index';

function activeDbPath(): string {
  const override = process.env.TSC_DB_PATH;
  if (override) return override;
  return join(app.getPath('userData'), 'inventory.db');
}

export const backupRouter = router({
  exportToFile: publicProcedure.mutation(async () => {
    const result = await dialog.showSaveDialog({
      title: 'Export inventory backup',
      defaultPath: `inventory-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite database', extensions: ['db'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false as const, canceled: true };

    // Use SQLite's online backup so we capture a consistent snapshot even if WAL has uncommitted pages.
    const db = getDb();
    await db.backup(result.filePath);
    logger.info('DB backup written', { path: result.filePath });
    return { ok: true as const, path: result.filePath };
  }),

  resetAllData: publicProcedure
    .input(z.object({ confirm: z.literal('I understand this deletes everything') }))
    .mutation(() => {
      // Easiest reliable reset: drop every table other than schema_migrations + sqlite_*,
      // then re-run migrations.
      const db = getDb();
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as Array<{ name: string }>;

      const tx = db.transaction(() => {
        db.exec('PRAGMA foreign_keys = OFF');
        for (const t of tables) {
          db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
        }
        db.exec('PRAGMA foreign_keys = ON');
      });
      tx();

      runMigrations(db, migrations);
      logger.warn('All data reset by user');
      return { ok: true as const };
    }),

  dbPath: publicProcedure.query(() => activeDbPath()),
});

// Suppress unused warnings for symbols imported defensively.
void existsSync;
void copyFileSync;
void closeDb;
