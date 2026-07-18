import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { freshDbWithAllMigrations, closeTestDb } from './testdb';

// Mock electron + logger so the importer can be imported in this Node test
// without dragging in the Electron runtime dependencies.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  shell: { openExternal: async () => undefined },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));
vi.mock('../../src/main/logging/logger', () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
}));

import { applyImport, buildPreview } from '../../src/main/importer/tscDataImporter';

/**
 * Minimal product-data.js fixture. Two finishes, two palettes, three addons,
 * one gallery design, two bundles. One bundle references an addon that
 * doesn't exist (`unknown-thing`) so we can verify the warning path fires.
 */
const FIXTURE_PRODUCT_DATA_JS = `
const TSC_DATA = {
  finishes: [
    { id: 'satin', name: 'Big satin bow', price: 65 },
    { id: 'foil', name: 'Foil topper + cluster', price: 90 },
  ],
  paletteOptions: [
    { id: 'blush', name: 'Blush & rose' },
    { id: 'classic', name: 'Black & gold' },
  ],
  addons: [
    { id: 'candle', name: 'Soy candle', price: 20, group: 'gift' },
    { id: 'wine', name: 'Bottle of wine', price: 35, group: 'gift' },
    { id: 'giftcard', name: 'Gift card', price: 5, group: 'finishing' },
    { id: 'extra-balloons', name: 'Add 4 balloons inside', price: 5, group: 'balloon' },
  ],
  gallery: [
    { slug: 'birthday-classic', title: 'Birthday classic', finishId: 'satin', paletteId: 'blush' },
  ],
  bundles: [
    {
      id: 'for-mum-classic',
      name: 'For Mum — soft & classic',
      category: 'For Her',
      contentsPrice: 20,
      defaultFinish: 'satin',
      defaultPalette: 'blush',
      lockedContents: ['Chocolates (10)', 'Artificial roses x3'],
      trimAddonIds: ['wine'],
    },
    {
      id: 'mystery-box',
      name: 'Mystery box',
      defaultFinish: 'foil',
      defaultPalette: 'classic',
      lockedAddonIds: ['unknown-thing'],
    },
  ],
};
if (typeof module !== 'undefined' && module.exports) module.exports = TSC_DATA;
`;

function writeFixture(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tsc-import-'));
  const path = join(dir, 'product-data.js');
  writeFileSync(path, FIXTURE_PRODUCT_DATA_JS, 'utf8');
  return {
    path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('tscDataImporter — bundles', () => {
  let cleanup: () => void;
  let path: string;
  let db: import('better-sqlite3').Database;

  beforeEach(() => {
    db = freshDbWithAllMigrations();
    const fix = writeFixture();
    cleanup = fix.cleanup;
    path = fix.path;

    // Seed the physical inventory items the finish + palette templates
    // expect — without these, the recipe seeder would skip them with
    // warnings instead of writing components.
    const items = [
      'balloon-bubble-24in',
      'ribbon-satin-roll',
      'ribbon-curled-roll',
      'gift-box-medium',
      'sc-pin',
      'care-guide-card',
      'balloon-latex-5in-pack',
    ];
    for (const sku of items) {
      db.prepare(
        `INSERT INTO inventory_items (sku, name, unit, on_hand, reorder_at)
         VALUES (?, ?, 'each', 100, 0)`,
      ).run(sku, sku);
    }
  });

  afterEach(() => {
    cleanup();
    closeTestDb();
  });

  it('preview surfaces bundles', () => {
    const preview = buildPreview(path);
    expect(preview.bundles).toHaveLength(2);

    const mum = preview.bundles.find((b) => b.external_id === 'for-mum-classic');
    expect(mum).toBeDefined();
    expect(mum!.name).toBe('For Mum — soft & classic');
    expect(mum!.default_finish_id).toBe('satin');
    expect(mum!.default_palette_id).toBe('blush');
    expect(mum!.price_cents).toBe(8500);
    expect(mum!.locked_content_names).toEqual(['Chocolates (10)', 'Artificial roses x3']);
    expect(mum!.locked_addon_ids).toEqual([]);
  });

  it('apply imports bundles as design entries with bundle:<id> external_id', () => {
    const result = applyImport(path, {
      autoCreateAddonInventory: true,
      autoSeedAddonRecipes: true,
      importBundles: true,
      autoSeedBundleRecipes: true,
    });

    expect(result.inserted.bundles).toBe(2);
    expect(result.updated.bundles).toBe(0);
  });

  it('seeds current lockedContents quantities and warns on unknown legacy ids', () => {
    const result = applyImport(path, {
      autoCreateAddonInventory: true,
      autoSeedAddonRecipes: true,
      importBundles: true,
      autoSeedBundleRecipes: true,
    });

    // for-mum-classic has 2 known locked addons → 2 recipe components.
    // mystery-box references an unknown addon → 0 components, 1 warning.
    expect(result.bundleRecipesAutoSeeded).toBe(2);
    expect(result.bundleRecipeWarnings).toHaveLength(1);
    expect(result.bundleRecipeWarnings[0]).toMatch(/Mystery box.*unknown-thing/);

    const bundleId = (db.prepare(
      `SELECT id FROM catalogue_entries WHERE kind='design' AND external_id='bundle:for-mum-classic'`,
    ).get() as { id: number }).id;
    const components = db.prepare(
      `SELECT i.name, r.quantity FROM recipe_components r
       JOIN inventory_items i ON i.id = r.inventory_item_id
       WHERE r.catalogue_id = ? ORDER BY i.name`,
    ).all(bundleId) as Array<{ name: string; quantity: number }>;
    expect(components).toEqual([
      { name: 'Artificial roses', quantity: 3 },
      { name: 'Chocolates', quantity: 10 },
    ]);

    const stored = db.prepare(
      `SELECT price_cents FROM catalogue_entries WHERE id = ?`,
    ).get(bundleId) as { price_cents: number };
    expect(stored.price_cents).toBe(8500);
  });

  it('respects the importBundles=false toggle', () => {
    const result = applyImport(path, {
      autoCreateAddonInventory: true,
      autoSeedAddonRecipes: true,
      importBundles: false,
      autoSeedBundleRecipes: false,
    });

    expect(result.inserted.bundles).toBe(0);
    expect(result.updated.bundles).toBe(0);
    expect(result.bundleRecipesAutoSeeded).toBe(0);
  });

  it('seeds finish recipes — satin gets bubble+ribbon+box+pin+care, foil drops latex (palette handles it)', () => {
    const result = applyImport(path, {
      autoCreateAddonInventory: true,
      autoSeedAddonRecipes: true,
      importBundles: true,
      autoSeedBundleRecipes: true,
      autoSeedFinishRecipes: true,
      autoSeedPaletteRecipes: true,
    });

    // Satin = 5 lines (bubble, ribbon-satin, box, pin, care).
    // Foil  = 4 lines (bubble, box, pin, care). Latex moved to palette
    // recipes (colour-specific), so it doesn't sit on the foil finish
    // any more — the palette's recipe deducts the cluster.
    // Total = 9.
    expect(result.finishRecipesAutoSeeded).toBe(9);

    // Verify the actual rows landed for the satin finish.
    const satinId = (db.prepare(
      `SELECT id FROM catalogue_entries WHERE kind='finish' AND external_id='satin'`,
    ).get() as { id: number }).id;
    const satinComponents = db.prepare(
      `SELECT i.sku, r.quantity FROM recipe_components r
       JOIN inventory_items i ON i.id = r.inventory_item_id
       WHERE r.catalogue_id = ? ORDER BY i.sku`,
    ).all(satinId) as Array<{ sku: string; quantity: number }>;

    expect(satinComponents).toEqual([
      { sku: 'balloon-bubble-24in', quantity: 1 },
      { sku: 'care-guide-card',     quantity: 1 },
      { sku: 'gift-box-medium',     quantity: 1 },
      { sku: 'ribbon-satin-roll',   quantity: 1 },
      { sku: 'sc-pin',              quantity: 1 },
    ]);

    // Verify foil no longer carries the cluster — bubble + box + pin + care only.
    const foilId = (db.prepare(
      `SELECT id FROM catalogue_entries WHERE kind='finish' AND external_id='foil'`,
    ).get() as { id: number }).id;
    const foilComponents = db.prepare(
      `SELECT i.sku, r.quantity FROM recipe_components r
       JOIN inventory_items i ON i.id = r.inventory_item_id
       WHERE r.catalogue_id = ? ORDER BY i.sku`,
    ).all(foilId) as Array<{ sku: string; quantity: number }>;

    expect(foilComponents).toEqual([
      { sku: 'balloon-bubble-24in', quantity: 1 },
      { sku: 'care-guide-card',     quantity: 1 },
      { sku: 'gift-box-medium',     quantity: 1 },
      { sku: 'sc-pin',              quantity: 1 },
    ]);
  });

  it('palette recipes deduct colour-specific balloons (blush → 4× blush, classic → 2× black + 2× chrome)', () => {
    const result = applyImport(path, {
      autoCreateAddonInventory: true,
      autoSeedAddonRecipes: true,
      importBundles: true,
      autoSeedBundleRecipes: true,
      autoSeedFinishRecipes: true,
      autoSeedPaletteRecipes: true,
    });

    // Migration 010 seeded the Stylex catalogue (50 colours) into the test
    // DB, so these palette recipes resolve cleanly:
    //   blush   → 1 component (4× balloon-latex-5in-stylex-blush)
    //   classic → 2 components (2× black + 2× chrome-bronze-gold)
    // Total = 3 components seeded.
    expect(result.paletteRecipesAutoSeeded).toBe(3);

    const blushId = (db.prepare(
      `SELECT id FROM catalogue_entries WHERE kind='palette' AND external_id='blush'`,
    ).get() as { id: number }).id;
    const blushComponents = db.prepare(
      `SELECT i.sku, r.quantity FROM recipe_components r
       JOIN inventory_items i ON i.id = r.inventory_item_id
       WHERE r.catalogue_id = ? ORDER BY i.sku`,
    ).all(blushId) as Array<{ sku: string; quantity: number }>;
    expect(blushComponents).toEqual([
      { sku: 'balloon-latex-5in-stylex-blush', quantity: 4 },
    ]);

    const classicId = (db.prepare(
      `SELECT id FROM catalogue_entries WHERE kind='palette' AND external_id='classic'`,
    ).get() as { id: number }).id;
    const classicComponents = db.prepare(
      `SELECT i.sku, r.quantity FROM recipe_components r
       JOIN inventory_items i ON i.id = r.inventory_item_id
       WHERE r.catalogue_id = ? ORDER BY i.sku`,
    ).all(classicId) as Array<{ sku: string; quantity: number }>;
    expect(classicComponents).toEqual([
      { sku: 'balloon-latex-5in-stylex-black',             quantity: 2 },
      { sku: 'balloon-latex-5in-stylex-chrome-bronze-gold', quantity: 2 },
    ]);
  });

  it('extra-balloons addon recipe is overridden to 4× balloon-latex-5in-pack', () => {
    applyImport(path, {
      autoCreateAddonInventory: true,
      autoSeedAddonRecipes: true,
      importBundles: true,
      autoSeedBundleRecipes: true,
      autoSeedFinishRecipes: true,
      autoSeedPaletteRecipes: true,
    });

    const addonId = (db.prepare(
      `SELECT id FROM catalogue_entries WHERE kind='addon' AND external_id='extra-balloons'`,
    ).get() as { id: number } | undefined)?.id;
    expect(addonId).toBeDefined();

    const components = db.prepare(
      `SELECT i.sku, r.quantity FROM recipe_components r
       JOIN inventory_items i ON i.id = r.inventory_item_id
       WHERE r.catalogue_id = ?`,
    ).all(addonId!) as Array<{ sku: string; quantity: number }>;

    // Override beats the synthetic 1:1 — should land 4× actual latex.
    expect(components).toEqual([
      { sku: 'balloon-latex-5in-pack', quantity: 4 },
    ]);
  });

  it('repairs missing required material SKUs before seeding finish recipes', () => {
    // Drop the bubble inventory row. A website sync must recreate the
    // required material and keep every finish recipe complete.
    db.prepare(`DELETE FROM inventory_items WHERE sku = 'balloon-bubble-24in'`).run();

    const result = applyImport(path, {
      autoCreateAddonInventory: true,
      autoSeedAddonRecipes: true,
      importBundles: true,
      autoSeedBundleRecipes: true,
      autoSeedFinishRecipes: true,
      autoSeedPaletteRecipes: true,
    });

    expect(result.finishRecipesAutoSeeded).toBe(9);
    expect(result.finishRecipeWarnings.some((w) => w.includes('balloon-bubble-24in'))).toBe(false);
    expect(db.prepare(`SELECT 1 FROM inventory_items WHERE sku='balloon-bubble-24in'`).get()).toBeTruthy();
  });

  it('re-imports do not clobber edited bundle recipes', () => {
    // First import seeds recipes
    applyImport(path, {
      autoCreateAddonInventory: true,
      autoSeedAddonRecipes: true,
      importBundles: true,
      autoSeedBundleRecipes: true,
    });

    // Second import: should mark bundles as updated, not insert, and
    // bundleRecipesAutoSeeded should be 0 (recipes already exist).
    const result = applyImport(path, {
      autoCreateAddonInventory: true,
      autoSeedAddonRecipes: true,
      importBundles: true,
      autoSeedBundleRecipes: true,
    });

    expect(result.inserted.bundles).toBe(0);
    expect(result.updated.bundles).toBe(2);
    expect(result.bundleRecipesAutoSeeded).toBe(0);
  });
});
