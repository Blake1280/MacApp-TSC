import { getDb } from '@main/db/connection';
import { logger } from '@main/logging/logger';

/** Marker SKU used to identify demo orders. Keep stable so the "clear demo
 *  data" pass can find them. */
const DEMO_PREFIX = 'DEMO-';

/** Insert a handful of fake orders dated this/next week so Jade can see what
 *  Margins / Reorder / projection look like with real-shaped data. Idempotent
 *  — re-running with the same prefix is a no-op. Uses the existing catalogue
 *  if present so recipes resolve cleanly.
 *
 *  Returns the count of orders that were created vs. already present. */
export function seedDemoOrders(): {
  created: number;
  alreadyPresent: number;
  warnings: string[];
} {
  const db = getDb();
  const warnings: string[] = [];
  let created = 0;
  let alreadyPresent = 0;

  // Find a real design slug to use so previewOrderRecipes resolves it.
  const design = db
    .prepare(
      `SELECT external_id FROM catalogue_entries
        WHERE kind = 'design' AND archived = 0
        ORDER BY id ASC LIMIT 1`,
    )
    .get() as { external_id: string } | undefined;

  if (!design) {
    warnings.push("No design catalogue entries yet — demo orders won't resolve recipes.");
  }

  const palette = db
    .prepare(
      `SELECT external_id FROM catalogue_entries
        WHERE kind = 'palette' AND archived = 0
        ORDER BY id ASC LIMIT 1`,
    )
    .get() as { external_id: string } | undefined;
  const finish = db
    .prepare(
      `SELECT external_id FROM catalogue_entries
        WHERE kind = 'finish' AND archived = 0
        ORDER BY id ASC LIMIT 1`,
    )
    .get() as { external_id: string } | undefined;

  function dateOffset(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  const orders: Array<{
    sessionId: string;
    submissionId: string;
    customer: string;
    recipient: string;
    occasion: string;
    total: number;
    flow: 'byo' | 'bundle';
    bundleId: string | null;
    bundleName: string | null;
    dateNeeded: string;
    paidAt: string;
  }> = [
    {
      sessionId: `${DEMO_PREFIX}cs_demo_1`,
      submissionId: `${DEMO_PREFIX}sub_demo_1`,
      customer: 'Sample · Mia Davis',
      recipient: 'Mum',
      occasion: "Mother's Day",
      total: 8500,
      flow: 'bundle',
      bundleId: 'mothers-day-blush',
      bundleName: "Mother's Day blush bundle",
      dateNeeded: dateOffset(2),
      paidAt: new Date().toISOString(),
    },
    {
      sessionId: `${DEMO_PREFIX}cs_demo_2`,
      submissionId: `${DEMO_PREFIX}sub_demo_2`,
      customer: 'Sample · Liam Walsh',
      recipient: 'Sophie',
      occasion: '21st birthday',
      total: 12500,
      flow: 'byo',
      bundleId: null,
      bundleName: null,
      dateNeeded: dateOffset(4),
      paidAt: new Date().toISOString(),
    },
    {
      sessionId: `${DEMO_PREFIX}cs_demo_3`,
      submissionId: `${DEMO_PREFIX}sub_demo_3`,
      customer: 'Sample · Ava Patel',
      recipient: 'Dad',
      occasion: 'Birthday',
      total: 6500,
      flow: 'byo',
      bundleId: null,
      bundleName: null,
      dateNeeded: dateOffset(6),
      paidAt: new Date().toISOString(),
    },
    {
      sessionId: `${DEMO_PREFIX}cs_demo_4`,
      submissionId: `${DEMO_PREFIX}sub_demo_4`,
      customer: 'Sample · Noah Chen',
      recipient: 'Emma',
      occasion: 'Gender reveal',
      total: 9500,
      flow: 'bundle',
      bundleId: 'gender-reveal-classic',
      bundleName: 'Gender reveal classic',
      dateNeeded: dateOffset(9),
      paidAt: new Date().toISOString(),
    },
  ];

  const insert = db.prepare(
    `INSERT INTO orders
       (stripe_session_id, netlify_submission_id, source,
        customer_name, customer_email, recipient, occasion,
        total_cents, currency, paid_at,
        design_slug, finish_id, palette_id,
        flow_type, bundle_id, bundle_name,
        date_needed, fulfilment,
        match_status, app_status)
     VALUES (@sid, @subid, 'stripe',
             @customer, 'demo@example.com', @recipient, @occasion,
             @total, 'aud', @paid,
             @design, @finish, @palette,
             @flow, @bundle, @bundleName,
             @dateNeeded, 'pickup',
             'stripe_netlify', 'new')`,
  );

  for (const o of orders) {
    const exists = db
      .prepare('SELECT 1 FROM orders WHERE stripe_session_id = ?')
      .get(o.sessionId);
    if (exists) {
      alreadyPresent += 1;
      continue;
    }
    try {
      insert.run({
        sid: o.sessionId,
        subid: o.submissionId,
        customer: o.customer,
        recipient: o.recipient,
        occasion: o.occasion,
        total: o.total,
        paid: o.paidAt,
        design: design?.external_id ?? null,
        finish: finish?.external_id ?? null,
        palette: palette?.external_id ?? null,
        flow: o.flow,
        bundle: o.bundleId,
        bundleName: o.bundleName,
        dateNeeded: o.dateNeeded,
      });
      created += 1;
    } catch (err) {
      warnings.push(`Could not insert ${o.sessionId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logger.info('Demo seed complete', { created, alreadyPresent });
  return { created, alreadyPresent, warnings };
}

/** Remove every order whose stripe_session_id starts with the demo prefix.
 *  Reverses any stock moves the orders made via OrdersRepo.delete(). */
export function clearDemoOrders(): { removed: number } {
  const db = getDb();
  const ids = db
    .prepare(`SELECT id FROM orders WHERE stripe_session_id LIKE ?`)
    .all(`${DEMO_PREFIX}%`) as Array<{ id: number }>;
  for (const { id } of ids) {
    // Manually unwind via the repo so stock_movements are restored if applied.
    // Avoid importing here to dodge a circular dep — small inline tx is fine.
    const tx = db.transaction(() => {
      const order = db.prepare('SELECT stock_applied FROM orders WHERE id = ?').get(id) as
        | { stock_applied: number }
        | undefined;
      if (order?.stock_applied === 1) {
        const applied = db
          .prepare(
            `SELECT inventory_item_id, delta FROM stock_movements
              WHERE order_id = ? AND reason = 'order_apply'`,
          )
          .all(id) as Array<{ inventory_item_id: number; delta: number }>;
        for (const m of applied) {
          db.prepare(
            "UPDATE inventory_items SET on_hand = on_hand - ?, updated_at = datetime('now') WHERE id = ?",
          ).run(m.delta, m.inventory_item_id);
        }
      }
      db.prepare('DELETE FROM stock_movements WHERE order_id = ?').run(id);
      db.prepare('DELETE FROM orders WHERE id = ?').run(id);
    });
    tx();
  }
  logger.info('Demo orders cleared', { removed: ids.length });
  return { removed: ids.length };
}
