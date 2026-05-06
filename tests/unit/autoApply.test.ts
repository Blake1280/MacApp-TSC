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

import { autoApplyEligibleOrders } from '../../src/main/sync/autoApply';

type Seeded = {
  balloonId: number;
  designSlug: string;
  initialOnHand: number;
};

function seed(db: Database.Database): Seeded {
  const balloon = db.prepare(
    `INSERT INTO inventory_items (sku, name, unit, on_hand, reorder_at)
     VALUES ('test-auto-balloon', 'Test auto balloon', 'each', 100, 10)`,
  ).run();
  const balloonId = Number(balloon.lastInsertRowid);
  const design = db.prepare(
    `INSERT INTO catalogue_entries (kind, external_id, name)
     VALUES ('design', 'test-auto-classic', 'Test auto classic')`,
  ).run();
  const designId = Number(design.lastInsertRowid);
  db.prepare(
    `INSERT INTO recipe_components (catalogue_id, inventory_item_id, quantity)
     VALUES (?, ?, 5)`,
  ).run(designId, balloonId);
  return { balloonId, designSlug: 'test-auto-classic', initialOnHand: 100 };
}

function insertOrder(db: Database.Database, fields: {
  stripe_session_id?: string;
  netlify_submission_id?: string;
  design_slug: string;
  match_status: string;
  app_status?: string;
  paid_at?: string | null;
}): number {
  const r = db.prepare(
    `INSERT INTO orders (stripe_session_id, netlify_submission_id, source, total_cents, currency, design_slug, flow_type, match_status, app_status, paid_at)
     VALUES (?, ?, 'stripe', 5000, 'aud', ?, 'byo', ?, ?, ?)`,
  ).run(
    fields.stripe_session_id ?? null,
    fields.netlify_submission_id ?? null,
    fields.design_slug,
    fields.match_status,
    fields.app_status ?? 'new',
    fields.paid_at ?? null,
  );
  return Number(r.lastInsertRowid);
}

describe('autoApplyEligibleOrders', () => {
  let db: Database.Database;
  let s: Seeded;
  beforeEach(() => {
    db = freshDbWithAllMigrations();
    s = seed(db);
  });
  afterEach(() => closeTestDb());

  it('applies stock for paid all_three orders with clean recipes', () => {
    const id = insertOrder(db, {
      stripe_session_id: 'cs_a1',
      netlify_submission_id: 'sub_a1',
      design_slug: s.designSlug,
      match_status: 'all_three',
      paid_at: '2026-04-20T10:00:00Z',
    });

    const result = autoApplyEligibleOrders();
    expect(result.applied).toContain(id);
    const order = db.prepare('SELECT app_status, stock_applied FROM orders WHERE id = ?').get(id) as {
      app_status: string;
      stock_applied: number;
    };
    expect(order.app_status).toBe('confirmed');
    expect(order.stock_applied).toBe(1);
    const item = db.prepare('SELECT on_hand FROM inventory_items WHERE id = ?').get(s.balloonId) as {
      on_hand: number;
    };
    expect(item.on_hand).toBe(s.initialOnHand - 5);
  });

  it('skips orders with stripe_only match (single-source)', () => {
    const id = insertOrder(db, {
      stripe_session_id: 'cs_a2',
      design_slug: s.designSlug,
      match_status: 'stripe_only',
      paid_at: '2026-04-20T10:00:00Z',
    });
    const result = autoApplyEligibleOrders();
    expect(result.applied).not.toContain(id);
  });

  it('skips orders without paid_at', () => {
    const id = insertOrder(db, {
      stripe_session_id: 'cs_a3',
      netlify_submission_id: 'sub_a3',
      design_slug: s.designSlug,
      match_status: 'all_three',
      paid_at: null,
    });
    const result = autoApplyEligibleOrders();
    expect(result.applied).not.toContain(id);
  });

  it('skips orders with unresolved recipes', () => {
    const id = insertOrder(db, {
      stripe_session_id: 'cs_a4',
      netlify_submission_id: 'sub_a4',
      design_slug: 'this-design-does-not-exist',
      match_status: 'all_three',
      paid_at: '2026-04-20T10:00:00Z',
    });
    const result = autoApplyEligibleOrders();
    expect(result.applied).not.toContain(id);
    const skip = result.skipped.find((s) => s.orderId === id);
    expect(skip?.reason).toMatch(/unresolved recipes|no recipe lines/);
  });

  it('respects the auto_apply_stripe_orders=0 setting', () => {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('auto_apply_stripe_orders', '0')`,
    ).run();
    const id = insertOrder(db, {
      stripe_session_id: 'cs_a5',
      netlify_submission_id: 'sub_a5',
      design_slug: s.designSlug,
      match_status: 'all_three',
      paid_at: '2026-04-20T10:00:00Z',
    });
    const result = autoApplyEligibleOrders();
    expect(result.applied).not.toContain(id);
  });
});
