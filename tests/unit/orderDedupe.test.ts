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

import { OrdersRepo } from '../../src/main/db/repositories/orders.repo';
import { dedupeStripeNetlifyOrders } from '../../src/main/sync/dedupe';

const NETLIFY_BASE = {
  stripe_session_id: null,
  customer_name: 'Casey Customer',
  customer_email: 'casey@example.com',
  customer_phone: '0400 000 000',
  total_cents: 12500,
  currency: 'aud',
  paid_at: null,
  design_slug: 'classic-bubble',
  finish_id: 'curled',
  palette_id: 'pastel-pink',
  addon_ids_json: '["plush-bear"]',
  flow_type: 'byo' as const,
  bundle_id: null,
  bundle_name: null,
  locked_addons_csv: null,
  custom_palette: null,
  delivery_zone: 'bathurst',
  delivery_suburb: null,
  address: '1 Test St, Bathurst',
  fulfilment: 'Delivery',
  date_needed: '2026-07-10',
  time_needed: '10:00',
  occasion: 'Birthday',
  recipient: 'Morgan',
  notes: 'Bubble text (vinyl): Happy 30th',
  rush_order: null,
  rush_fee: null,
  raw_netlify_json: '{"id":"sub_1"}',
  submitted_at: '2026-07-01T00:00:00Z',
};

const STRIPE_BASE = {
  customer_name: 'Casey Customer',
  customer_email: 'casey@example.com',
  customer_phone: null,
  total_cents: 12500,
  currency: 'aud',
  paid_at: '2026-07-01T00:05:00Z',
  design_slug: null,
  finish_id: null,
  palette_id: null,
  addon_ids_json: null,
  flow_type: 'byo' as const,
  bundle_id: null,
  bundle_name: null,
  locked_addons_csv: null,
  custom_palette: null,
  delivery_zone: null,
  delivery_suburb: null,
  address: null,
  fulfilment: null,
  date_needed: null,
  time_needed: null,
  occasion: null,
  recipient: null,
  notes: null,
  rush_order: null,
  rush_fee: null,
  raw_stripe_json: '{"id":"cs_1"}',
};

function orderCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM orders').get() as { c: number }).c;
}

describe('Netlify/Stripe twin adoption (prevention)', () => {
  let db: Database.Database;
  let repo: OrdersRepo;
  beforeEach(() => {
    db = freshDbWithAllMigrations();
    repo = new OrdersRepo(db);
  });
  afterEach(() => closeTestDb());

  it('a Stripe pull adopts an unlinked Netlify order instead of inserting a duplicate', () => {
    const first = repo.upsertFromNetlify({ ...NETLIFY_BASE, netlify_submission_id: 'sub_1' });
    expect(first.created).toBe(true);
    expect(first.order.match_status).toBe('netlify_only');

    const second = repo.upsertFromStripe({ ...STRIPE_BASE, stripe_session_id: 'cs_1' });
    expect(second.created).toBe(false);
    expect(second.order.id).toBe(first.order.id);
    expect(orderCount(db)).toBe(1);

    // Fully linked, paid, and keeps the form's rich customisation.
    expect(second.order.stripe_session_id).toBe('cs_1');
    expect(second.order.netlify_submission_id).toBe('sub_1');
    expect(second.order.match_status).toBe('stripe_netlify');
    expect(second.order.paid_at).toBe('2026-07-01T00:05:00Z');
    expect(second.order.design_slug).toBe('classic-bubble');
    expect(second.order.notes).toContain('Happy 30th');
  });

  it('a Netlify pull without a session id merges into the existing Stripe order', () => {
    const first = repo.upsertFromStripe({ ...STRIPE_BASE, stripe_session_id: 'cs_1' });
    expect(first.created).toBe(true);

    const second = repo.upsertFromNetlify({ ...NETLIFY_BASE, netlify_submission_id: 'sub_1' });
    expect(second.created).toBe(false);
    expect(second.order.id).toBe(first.order.id);
    expect(orderCount(db)).toBe(1);
    expect(second.order.match_status).toBe('stripe_netlify');
    expect(second.order.paid_at).toBe('2026-07-01T00:05:00Z'); // payment preserved
    expect(second.order.finish_id).toBe('curled'); // form customisation merged
  });

  it('does not adopt when the email differs', () => {
    repo.upsertFromNetlify({ ...NETLIFY_BASE, netlify_submission_id: 'sub_1' });
    const second = repo.upsertFromStripe({
      ...STRIPE_BASE,
      stripe_session_id: 'cs_1',
      customer_email: 'someone-else@example.com',
    });
    expect(second.created).toBe(true);
    expect(orderCount(db)).toBe(2);
  });

  it('does not adopt when the totals differ (and the form total is known)', () => {
    repo.upsertFromNetlify({ ...NETLIFY_BASE, netlify_submission_id: 'sub_1' });
    const second = repo.upsertFromStripe({
      ...STRIPE_BASE,
      stripe_session_id: 'cs_1',
      total_cents: 9900,
    });
    expect(second.created).toBe(true);
    expect(orderCount(db)).toBe(2);
  });

  it('adopts when the form total is 0 (unknown)', () => {
    repo.upsertFromNetlify({ ...NETLIFY_BASE, netlify_submission_id: 'sub_1', total_cents: 0 });
    const second = repo.upsertFromStripe({ ...STRIPE_BASE, stripe_session_id: 'cs_1' });
    expect(second.created).toBe(false);
    expect(orderCount(db)).toBe(1);
    expect(second.order.total_cents).toBe(12500);
  });

  it('skips adoption when two candidates are ambiguous', () => {
    repo.upsertFromNetlify({ ...NETLIFY_BASE, netlify_submission_id: 'sub_1' });
    repo.upsertFromNetlify({ ...NETLIFY_BASE, netlify_submission_id: 'sub_2' });
    const stripe = repo.upsertFromStripe({ ...STRIPE_BASE, stripe_session_id: 'cs_1' });
    expect(stripe.created).toBe(true); // did not guess between the two
    expect(orderCount(db)).toBe(3);
  });
});

describe('dedupeStripeNetlifyOrders (cleanup of existing pairs)', () => {
  let db: Database.Database;
  let repo: OrdersRepo;
  beforeEach(() => {
    db = freshDbWithAllMigrations();
    repo = new OrdersRepo(db);
  });
  afterEach(() => closeTestDb());

  /** Insert a pre-existing twin pair directly (as older app versions did). */
  function seedPair(): { stripeId: number; netlifyId: number } {
    const n = db
      .prepare(
        `INSERT INTO orders (netlify_submission_id, source, customer_email, customer_name, total_cents, currency, design_slug, finish_id, notes, flow_type, match_status)
         VALUES ('sub_old', 'netlify', 'casey@example.com', 'Casey Customer', 12500, 'aud', 'classic-bubble', 'curled', 'Tag: love you', 'byo', 'netlify_only')`,
      )
      .run();
    const s = db
      .prepare(
        `INSERT INTO orders (stripe_session_id, source, customer_email, total_cents, currency, paid_at, flow_type, match_status)
         VALUES ('cs_old', 'stripe', 'Casey@Example.com', 12500, 'aud', '2026-07-01T00:05:00Z', 'byo', 'stripe_only')`,
      )
      .run();
    return { stripeId: Number(s.lastInsertRowid), netlifyId: Number(n.lastInsertRowid) };
  }

  it('merges an untouched pair into the paid Stripe order and deletes the form twin', () => {
    const { stripeId, netlifyId } = seedPair();
    const result = dedupeStripeNetlifyOrders();

    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]).toEqual({ survivorId: stripeId, deletedId: netlifyId });
    expect(orderCount(db)).toBe(1);

    const survivor = repo.byId(stripeId)!;
    expect(survivor.netlify_submission_id).toBe('sub_old');
    expect(survivor.match_status).toBe('stripe_netlify');
    expect(survivor.paid_at).toBe('2026-07-01T00:05:00Z');
    expect(survivor.design_slug).toBe('classic-bubble'); // form data folded in
    expect(survivor.notes).toBe('Tag: love you');
  });

  it('keeps the worked-on form order and deletes the untouched Stripe twin instead', () => {
    const { stripeId, netlifyId } = seedPair();
    // Jade confirmed the form copy — that's "the current order"; it must survive.
    db.prepare("UPDATE orders SET app_status = 'confirmed' WHERE id = ?").run(netlifyId);

    const result = dedupeStripeNetlifyOrders();
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]).toEqual({ survivorId: netlifyId, deletedId: stripeId });

    const survivor = repo.byId(netlifyId)!;
    expect(survivor.app_status).toBe('confirmed');
    expect(survivor.stripe_session_id).toBe('cs_old'); // payment attached
    expect(survivor.paid_at).toBe('2026-07-01T00:05:00Z');
    expect(survivor.match_status).toBe('stripe_netlify');
    expect(survivor.notes).toBe('Tag: love you'); // nothing lost
  });

  it('never deletes anything when both twins have been worked on', () => {
    const { stripeId, netlifyId } = seedPair();
    db.prepare("UPDATE orders SET app_status = 'confirmed' WHERE id = ?").run(netlifyId);
    db.prepare('UPDATE orders SET manually_marked_paid = 1 WHERE id = ?').run(stripeId);

    const result = dedupeStripeNetlifyOrders();
    expect(result.merged).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(orderCount(db)).toBe(2);
  });

  it('skips ambiguous pairs (two form orders matching one payment)', () => {
    seedPair();
    db.prepare(
      `INSERT INTO orders (netlify_submission_id, source, customer_email, total_cents, currency, flow_type, match_status)
       VALUES ('sub_old_2', 'netlify', 'casey@example.com', 12500, 'aud', 'byo', 'netlify_only')`,
    ).run();

    const result = dedupeStripeNetlifyOrders();
    expect(result.merged).toHaveLength(0);
    expect(orderCount(db)).toBe(3);
  });

  it('ignores unrelated orders (different customers, manual orders)', () => {
    db.prepare(
      `INSERT INTO orders (source, customer_email, total_cents, currency, flow_type, match_status)
       VALUES ('manual', 'casey@example.com', 12500, 'aud', 'byo', 'manual')`,
    ).run();
    db.prepare(
      `INSERT INTO orders (stripe_session_id, source, customer_email, total_cents, currency, paid_at, flow_type, match_status)
       VALUES ('cs_other', 'stripe', 'other@example.com', 5000, 'aud', '2026-07-01T00:00:00Z', 'byo', 'stripe_only')`,
    ).run();

    const result = dedupeStripeNetlifyOrders();
    expect(result.merged).toHaveLength(0);
    expect(orderCount(db)).toBe(2);
  });
});
