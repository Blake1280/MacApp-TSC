import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDbWithAllMigrations, closeTestDb } from './testdb';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  shell: { openExternal: async () => undefined },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));
vi.mock('../../src/main/logging/logger', () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
}));

import { computeOrderCogs, marginsByBundle, marginsByOrder } from '../../src/main/lib/cogs';

type Seeded = {
  balloonId: number;
  ribbonId: number;
  designId: number;
  bundleOrderId: number;
  byoOrderId: number;
};

function seedBasic(db: Database.Database): Seeded {
  const balloon = db.prepare(
    `INSERT INTO inventory_items (sku, name, unit, on_hand, reorder_at)
     VALUES ('test-balloon-blush', 'Test Blush balloon', 'each', 100, 10)`,
  ).run();
  const ribbon = db.prepare(
    `INSERT INTO inventory_items (sku, name, unit, on_hand, reorder_at)
     VALUES ('test-ribbon-blush', 'Test Blush ribbon', 'metres', 50, 5)`,
  ).run();
  const balloonId = Number(balloon.lastInsertRowid);
  const ribbonId = Number(ribbon.lastInsertRowid);

  db.prepare(
    `INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, unit_price_cents, is_preferred)
     VALUES (?, 'Stylex', 'https://example.com/balloon', 50, 1),
            (?, 'OPS', 'https://example.com/balloon-ops', 60, 0)`,
  ).run(balloonId, balloonId);
  db.prepare(
    `INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, unit_price_cents, is_preferred)
     VALUES (?, 'Koch', 'https://example.com/ribbon', 30, 1)`,
  ).run(ribbonId);

  const design = db.prepare(
    `INSERT INTO catalogue_entries (kind, external_id, name)
     VALUES ('design', 'test-classic', 'Test Classic stack')`,
  ).run();
  const designId = Number(design.lastInsertRowid);

  db.prepare(
    `INSERT INTO recipe_components (catalogue_id, inventory_item_id, quantity)
     VALUES (?, ?, 5), (?, ?, 2)`,
  ).run(designId, balloonId, designId, ribbonId);

  const bundleOrder = db.prepare(
    `INSERT INTO orders (stripe_session_id, source, total_cents, currency, design_slug, flow_type, bundle_id, bundle_name, match_status, app_status, paid_at)
     VALUES ('cs_bundle_1', 'stripe', 5000, 'aud', 'test-classic', 'bundle', 'test-mums-day', 'Mums Day', 'all_three', 'confirmed', '2026-04-20T10:00:00Z')`,
  ).run();
  const byoOrder = db.prepare(
    `INSERT INTO orders (stripe_session_id, source, total_cents, currency, design_slug, flow_type, match_status, app_status, paid_at)
     VALUES ('cs_byo_1', 'stripe', 4500, 'aud', 'test-classic', 'byo', 'all_three', 'confirmed', '2026-04-21T10:00:00Z')`,
  ).run();

  return {
    balloonId,
    ribbonId,
    designId,
    bundleOrderId: Number(bundleOrder.lastInsertRowid),
    byoOrderId: Number(byoOrder.lastInsertRowid),
  };
}

describe('cogs', () => {
  let db: Database.Database;
  let s: Seeded;
  beforeEach(() => {
    db = freshDbWithAllMigrations();
    s = seedBasic(db);
  });
  afterEach(() => closeTestDb());

  it('computeOrderCogs picks cheapest supplier price per item', () => {
    // 5 balloons @ 50¢ + 2 ribbon @ 30¢ = 250 + 60 = 310¢
    const result = computeOrderCogs(s.bundleOrderId);
    expect(result.cogs_cents).toBe(310);
    expect(result.unknown_items).toEqual([]);
    expect(result.margin_cents).toBe(5000 - 310);
  });

  it('flags items without any priced supplier as unknown and skips them in cogs', () => {
    const mystery = db.prepare(
      `INSERT INTO inventory_items (sku, name, unit, on_hand, reorder_at)
       VALUES ('test-mystery', 'Mystery extra', 'each', 0, 0)`,
    ).run();
    const mysteryId = Number(mystery.lastInsertRowid);
    db.prepare(
      `INSERT INTO recipe_components (catalogue_id, inventory_item_id, quantity)
       VALUES (?, ?, 1)`,
    ).run(s.designId, mysteryId);
    db.prepare(
      `INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url)
       VALUES (?, 'Mystery Co', 'https://example.com/mystery')`,
    ).run(mysteryId);

    const result = computeOrderCogs(s.bundleOrderId);
    expect(result.cogs_cents).toBe(310); // mystery has no price → contributes 0
    expect(result.unknown_items.find((u) => u.sku === 'test-mystery')).toBeTruthy();
  });

  it('falls back to the inventory item cost when no supplier source is priced', () => {
    const material = db.prepare(
      `INSERT INTO inventory_items (sku, name, unit, on_hand, reorder_at, cost_cents)
       VALUES ('test-material', 'Test material', 'each', 20, 2, 125)`,
    ).run();
    db.prepare(
      `INSERT INTO recipe_components (catalogue_id, inventory_item_id, quantity)
       VALUES (?, ?, 2)`,
    ).run(s.designId, Number(material.lastInsertRowid));

    const result = computeOrderCogs(s.byoOrderId);
    expect(result.cogs_cents).toBe(560);
    expect(result.unknown_items.some((item) => item.sku === 'test-material')).toBe(false);
  });

  it('uses the imported bundle recipe for current website orders without locked addon ids', () => {
    const gift = db.prepare(
      `INSERT INTO inventory_items (sku, name, unit, on_hand, reorder_at)
       VALUES ('bundle-test-gift', 'Bundle test gift', 'each', 10, 1)`,
    ).run();
    const giftId = Number(gift.lastInsertRowid);
    db.prepare(
      `INSERT INTO inventory_supplier_sources
         (inventory_item_id, supplier_name, unit_price_cents, is_preferred)
       VALUES (?, 'Test supplier', 400, 1)`,
    ).run(giftId);
    const bundle = db.prepare(
      `INSERT INTO catalogue_entries (kind, external_id, name, price_cents)
       VALUES ('design', 'bundle:test-mums-day', 'Mums Day', 5000)`,
    ).run();
    db.prepare(
      `INSERT INTO recipe_components (catalogue_id, inventory_item_id, quantity)
       VALUES (?, ?, 2)`,
    ).run(Number(bundle.lastInsertRowid), giftId);
    db.prepare('UPDATE orders SET design_slug = NULL, locked_addons_csv = NULL WHERE id = ?')
      .run(s.bundleOrderId);

    const result = computeOrderCogs(s.bundleOrderId);
    expect(result.cogs_cents).toBe(800);
    expect(result.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: 'bundle-test-gift', quantity: 2 }),
    ]));
  });

  it('marginsByBundle aggregates by bundle_id and creates a BYO bucket', () => {
    const rows = marginsByBundle();
    const byo = rows.find((r) => r.flow_type === 'byo');
    const bundle = rows.find((r) => r.bundle_id === 'test-mums-day');
    expect(byo).toBeTruthy();
    expect(bundle).toBeTruthy();
    expect(bundle!.order_count).toBe(1);
    expect(bundle!.avg_cogs_cents).toBe(310);
    expect(bundle!.avg_margin_cents).toBe(5000 - 310);
  });

  it('marginsByOrder sorts worst-margin first', () => {
    db.prepare('UPDATE orders SET total_cents = 100 WHERE id = ?').run(s.byoOrderId);
    const rows = marginsByOrder();
    // Find our two test orders in the result (the migration-seeded data may
    // contribute its own orders — but our two should both appear).
    const testOrders = rows.filter((r) =>
      [s.byoOrderId, s.bundleOrderId].includes(r.order_id),
    );
    expect(testOrders[0].order_id).toBe(s.byoOrderId); // smaller margin first
  });
});
