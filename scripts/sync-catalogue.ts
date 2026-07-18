import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const dbPath = argument('--db');
const sourcePath = argument('--source');
if (!dbPath || !sourcePath) {
  throw new Error('Usage: sync-catalogue --db <inventory.db> --source <product-data.js>');
}

const resolvedDb = resolve(dbPath);
const resolvedSource = resolve(sourcePath);
const backupDir = resolve(dirname(resolvedDb), 'backups');
mkdirSync(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = resolve(backupDir, `inventory-before-catalogue-${timestamp}.db`);
copyFileSync(resolvedDb, backupPath);

async function main(): Promise<void> {
  process.env.TSC_DB_PATH = resolvedDb;
  process.env.TSC_CLI = '1';
  const [{ applyImport }, { closeDb }] = await Promise.all([
    import('../src/main/importer/tscDataImporter'),
    import('../src/main/db/connection'),
  ]);

  try {
    const result = applyImport(resolvedSource, {
      autoCreateAddonInventory: true,
      autoSeedAddonRecipes: true,
      importBundles: true,
      autoSeedBundleRecipes: true,
      autoSeedFinishRecipes: true,
      autoSeedPaletteRecipes: true,
    });
    process.stdout.write(`${JSON.stringify({ backupPath, result }, null, 2)}\n`);
  } finally {
    closeDb();
  }
}

void main();
