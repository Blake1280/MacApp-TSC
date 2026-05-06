import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  shell: { openExternal: async () => undefined },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));
vi.mock('../../src/main/logging/logger', () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
}));

import { freshDbWithAllMigrations, closeTestDb } from './testdb';
import { InventoryRepo } from '../../src/main/db/repositories/inventory.repo';
import { MovementsRepo } from '../../src/main/db/repositories/movements.repo';

describe('InventoryRepo', () => {
  let db: Database.Database;
  let repo: InventoryRepo;
  let movements: MovementsRepo;

  beforeEach(() => {
    db = freshDbWithAllMigrations();
    repo = new InventoryRepo(db);
    movements = new MovementsRepo(db);
  });
  afterEach(() => closeTestDb());

  it('creates an item without starting stock and writes no movement', () => {
    const item = repo.create({
      sku: 'test-ribbon-satin-blush',
      name: 'Satin ribbon — blush',
      unit: 'each',
      on_hand: 0,
      reorder_at: 5,
    });
    expect(item.id).toBeGreaterThan(0);
    expect(item.on_hand).toBe(0);
    expect(movements.list({ inventory_item_id: item.id })).toHaveLength(0);
  });

  it('creates an item with starting stock and writes an opening_balance movement', () => {
    const item = repo.create({
      sku: 'test-balloon-5in-blush',
      name: '5-inch blush balloon',
      unit: 'each',
      on_hand: 200,
      reorder_at: 50,
    });
    expect(item.on_hand).toBe(200);

    const m = movements.list({ inventory_item_id: item.id });
    expect(m).toHaveLength(1);
    expect(m[0].reason).toBe('opening_balance');
    expect(m[0].delta).toBe(200);
  });

  it('adjust() decrements on_hand and writes a stock_movement atomically', () => {
    const item = repo.create({
      sku: 'test-plush-bunny',
      name: 'Plush bunny',
      unit: 'each',
      on_hand: 10,
      reorder_at: 2,
    });

    const updated = repo.adjust({
      inventory_item_id: item.id,
      delta: -3,
      reason: 'off_site_sale',
      note: 'Saturday market',
    });

    expect(updated.on_hand).toBe(7);
    const m = movements.list({ inventory_item_id: item.id });
    expect(m).toHaveLength(2);
    expect(m[0].reason).toBe('off_site_sale');
    expect(m[0].delta).toBe(-3);
    expect(m[0].note).toBe('Saturday market');
  });

  it('list() filters by lowStockOnly', () => {
    const a = repo.create({ sku: 'test-low-a', name: 'A', unit: 'each', on_hand: 100, reorder_at: 10 });
    const b = repo.create({ sku: 'test-low-b', name: 'B', unit: 'each', on_hand: 5, reorder_at: 10 });
    const c = repo.create({ sku: 'test-low-c', name: 'C', unit: 'each', on_hand: 0, reorder_at: 0 });

    const low = repo.list({ includeArchived: false, lowStockOnly: true });
    const lowSkus = low.map((i) => i.sku);
    expect(lowSkus).toContain('test-low-b');
    expect(lowSkus).toContain('test-low-c');
    expect(lowSkus).not.toContain('test-low-a');
    void a; void b; void c;
  });

  it('list() searches by sku and name', () => {
    repo.create({ sku: 'test-search-balloon', name: '5-inch testblush', unit: 'each', on_hand: 0, reorder_at: 0 });
    repo.create({ sku: 'test-search-ribbon', name: 'Test gold ribbon', unit: 'each', on_hand: 0, reorder_at: 0 });

    expect(repo.list({ includeArchived: false, lowStockOnly: false, search: 'testblush' })).toHaveLength(1);
    expect(repo.list({ includeArchived: false, lowStockOnly: false, search: 'Test gold' })).toHaveLength(1);
  });

  it('rejects duplicate SKU', () => {
    repo.create({ sku: 'test-dup-sku', name: 'A', unit: 'each', on_hand: 0, reorder_at: 0 });
    expect(() =>
      repo.create({ sku: 'test-dup-sku', name: 'B', unit: 'each', on_hand: 0, reorder_at: 0 }),
    ).toThrow(/UNIQUE/);
  });
});
