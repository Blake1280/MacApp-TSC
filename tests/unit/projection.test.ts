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

import { projectStock } from '../../src/main/lib/projection';

function dateFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

type Seeded = {
  balloonSku: string;
  balloonId: number;
  designSlug: string;
};

function seed(db: Database.Database): Seeded {
  const balloon = db.prepare(
    `INSERT INTO inventory_items (sku, name, unit, on_hand, reorder_at)
     VALUES ('test-projection-balloon', 'Test projection balloon', 'each', 10, 5)`,
  ).run();
  const balloonId = Number(balloon.lastInsertRowid);
  const design = db.prepare(
    `INSERT INTO catalogue_entries (kind, external_id, name)
     VALUES ('design', 'test-projection-classic', 'Test projection classic')`,
  ).run();
  const designId = Number(design.lastInsertRowid);
  db.prepare(
    `INSERT INTO recipe_components (catalogue_id, inventory_item_id, quantity)
     VALUES (?, ?, 8)`,
  ).run(designId, balloonId);
  return { balloonSku: 'test-projection-balloon', balloonId, designSlug: 'test-projection-classic' };
}

function findRow(rows: ReturnType<typeof projectStock>, sku: string) {
  return rows.find((r) => r.sku === sku);
}

describe('projection', () => {
  let db: Database.Database;
  let s: Seeded;
  beforeEach(() => {
    db = freshDbWithAllMigrations();
    s = seed(db);
  });
  afterEach(() => closeTestDb());

  it('returns no row for our test balloon when no pending orders touch it', () => {
    expect(findRow(projectStock(), s.balloonSku)).toBeUndefined();
  });

  it('reserves stock against pending order date_needed', () => {
    db.prepare(
      `INSERT INTO orders (stripe_session_id, source, total_cents, currency, design_slug, flow_type, match_status, app_status, paid_at, date_needed)
       VALUES ('cs_p1', 'stripe', 5000, 'aud', ?, 'byo', 'all_three', 'new', '2026-04-20T10:00:00Z', ?)`,
    ).run(s.designSlug, dateFromToday(3));
    const row = findRow(projectStock(), s.balloonSku);
    expect(row).toBeTruthy();
    expect(row!.on_hand).toBe(10);
    expect(row!.reserved_total).toBe(8);
    expect(row!.lowest_projected).toBe(2);
    expect(row!.short_by).toBe(0);
  });

  it('flags shortfall when cumulative demand exceeds on_hand', () => {
    db.prepare(
      `INSERT INTO orders (stripe_session_id, source, total_cents, currency, design_slug, flow_type, match_status, app_status, paid_at, date_needed)
       VALUES ('cs_p2', 'stripe', 5000, 'aud', ?, 'byo', 'all_three', 'new', '2026-04-20T10:00:00Z', ?),
              ('cs_p3', 'stripe', 5000, 'aud', ?, 'byo', 'all_three', 'new', '2026-04-21T10:00:00Z', ?)`,
    ).run(s.designSlug, dateFromToday(3), s.designSlug, dateFromToday(5));
    const row = findRow(projectStock(), s.balloonSku);
    expect(row).toBeTruthy();
    expect(row!.reserved_total).toBe(16);
    expect(row!.lowest_projected).toBe(-6);
    expect(row!.short_by).toBe(6);
    expect(row!.lowest_date).toBe(dateFromToday(5));
  });

  it('ignores already-applied orders', () => {
    db.prepare(
      `INSERT INTO orders (stripe_session_id, source, total_cents, currency, design_slug, flow_type, match_status, app_status, paid_at, date_needed, stock_applied)
       VALUES ('cs_p4', 'stripe', 5000, 'aud', ?, 'byo', 'all_three', 'confirmed', '2026-04-20T10:00:00Z', ?, 1)`,
    ).run(s.designSlug, dateFromToday(3));
    expect(findRow(projectStock(), s.balloonSku)).toBeUndefined();
  });

  it('ignores orders past horizon', () => {
    db.prepare(
      `INSERT INTO orders (stripe_session_id, source, total_cents, currency, design_slug, flow_type, match_status, app_status, paid_at, date_needed)
       VALUES ('cs_p5', 'stripe', 5000, 'aud', ?, 'byo', 'all_three', 'new', '2026-04-20T10:00:00Z', ?)`,
    ).run(s.designSlug, dateFromToday(60));
    expect(findRow(projectStock({ horizonDays: 30 }), s.balloonSku)).toBeUndefined();
  });
});
