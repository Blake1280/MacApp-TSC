import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { logger } from '@main/logging/logger';
import { getDb } from '@main/db/connection';
import { applyStocktakeImport } from '@main/importer/stocktakeXlsxImporter';

const SEED_FILENAME = 'seed-stocktake.xlsx';

/** Locate the bundled seed workbook. In packaged builds it lives inside the
 *  asar at `<appPath>/resources/<file>`; Electron's fs layer reads it
 *  transparently. In dev (electron-vite) the same relative path resolves to
 *  the project's `resources/` folder. A cwd fallback covers test runs. */
function resolveSeedPath(): string | null {
  const candidates = [
    join(app.getAppPath(), 'resources', SEED_FILENAME),
    join(process.cwd(), 'resources', SEED_FILENAME),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** First-run seed. If the inventory_items table is empty, import everything
 *  from the bundled stocktake workbook so a freshly-installed app ships with
 *  the same 150-item catalogue Jade sees in the spreadsheet. Skipped on every
 *  subsequent boot and any time the user has at least one inventory row. */
export function maybeFirstRunSeed(): void {
  const db = getDb();
  const row = db
    .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM inventory_items')
    .get();
  const count = row?.count ?? 0;

  if (count > 0) {
    logger.info('First-run seed: skipped (inventory already populated)', { count });
    return;
  }

  const seedPath = resolveSeedPath();
  if (!seedPath) {
    logger.warn('First-run seed: bundled seed workbook not found, skipping');
    return;
  }

  logger.info('First-run seed: importing bundled stocktake', { path: seedPath });
  try {
    const result = applyStocktakeImport(seedPath, {
      createMissingInventory: true,
      upsertCatalogue: true,
      upsertRecipes: true,
      // Bundled file may pre-date install by days — there are no movements
      // yet so it'll register as 'fresh' anyway, but acknowledge defensively.
      acknowledgeStale: true,
      archiveMissing: false,
    });
    logger.info('First-run seed: complete', {
      inventoryCreated: result.inventory.created,
      catalogueCreated: result.catalogue.created,
      recipesUpserted: result.recipes.upserted,
      warnings: result.warnings.length,
    });
  } catch (err) {
    logger.error('First-run seed: failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
