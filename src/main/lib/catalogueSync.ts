import { app } from 'electron';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyImport } from '@main/importer/tscDataImporter';
import type { ImportResult } from '@shared/types';

const WEBSITE_CATALOGUE_URL = 'https://thesweetcreative.com.au/product-data.js';

/** Pull the public website catalogue into the local app without touching
 * existing stock counts or replacing any non-empty, manually edited recipe. */
export async function syncWebsiteCatalogue(): Promise<ImportResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const tempPath = join(app.getPath('temp'), `tsc-product-data-${randomUUID()}.js`);

  try {
    const response = await fetch(`${WEBSITE_CATALOGUE_URL}?sync=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/javascript,text/javascript,*/*;q=0.8' },
    });
    if (!response.ok) {
      throw new Error(`Website catalogue returned HTTP ${response.status}`);
    }
    writeFileSync(tempPath, await response.text(), 'utf8');
    return applyImport(tempPath, {
      autoCreateAddonInventory: true,
      autoSeedAddonRecipes: true,
      importBundles: true,
      autoSeedBundleRecipes: true,
      autoSeedFinishRecipes: true,
      autoSeedPaletteRecipes: true,
    });
  } finally {
    clearTimeout(timeout);
    try {
      unlinkSync(tempPath);
    } catch {
      // The fetch may have failed before the temporary file was written.
    }
  }
}
