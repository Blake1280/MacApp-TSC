import { logger } from '@main/logging/logger';
import { getDb } from '@main/db/connection';
import { OrdersRepo } from '@main/db/repositories/orders.repo';
import {
  applyOrderStock,
  previewOrderRecipes,
  reverseOrderStock,
} from '@main/sync/stockApplier';

const SETTING_KEY = 'auto_apply_stripe_orders';

/** Setting defaults to ON. The renderer Settings page exposes a toggle. */
function isAutoApplyEnabled(): boolean {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(SETTING_KEY) as { value: string } | undefined;
  if (!row) return true;
  return row.value !== '0';
}

/** Find new, paid, double-confirmed orders that have no unresolved recipes
 *  and auto-confirm them. Skips anything that needs human review. Safe to
 *  call repeatedly — already-applied orders are filtered out by the SQL. */
export function autoApplyEligibleOrders(): {
  applied: number[];
  skipped: Array<{ orderId: number; reason: string }>;
} {
  if (!isAutoApplyEnabled()) {
    return { applied: [], skipped: [] };
  }

  const db = getDb();
  const orders = new OrdersRepo(db);

  // Eligibility: paid + match_status proves both Stripe and Netlify saw
  // the order (or all three sources). stripe_only / netlify_only / needs_review
  // require human review.
  const candidates = db
    .prepare(
      `SELECT id
         FROM orders
        WHERE app_status = 'new'
          AND stock_applied = 0
          AND paid_at IS NOT NULL
          AND match_status IN ('all_three', 'stripe_netlify')`,
    )
    .all() as Array<{ id: number }>;

  const applied: number[] = [];
  const skipped: Array<{ orderId: number; reason: string }> = [];

  for (const { id } of candidates) {
    try {
      const preview = previewOrderRecipes(id);
      if (preview.unresolvedRecipes.length > 0) {
        skipped.push({
          orderId: id,
          reason: `unresolved recipes: ${preview.unresolvedRecipes.map((u) => `${u.kind}/${u.external_id}`).join(', ')}`,
        });
        continue;
      }
      if (preview.lines.length === 0) {
        skipped.push({ orderId: id, reason: 'no recipe lines' });
        continue;
      }

      applyOrderStock(id);
      orders.setStatus(id, 'confirmed');
      applied.push(id);
      logger.info('Order auto-applied via Stripe pull', { orderId: id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push({ orderId: id, reason: `error: ${msg}` });
      logger.warn('Auto-apply skipped order', { orderId: id, error: msg });
    }
  }

  if (applied.length > 0) {
    logger.info('Auto-apply pass complete', { applied: applied.length, skipped: skipped.length });
  }

  return { applied, skipped };
}

/** Reverse stock for any order whose Stripe-derived status flipped to
 *  refunded. Idempotent — orders without applied stock are no-ops. */
export function autoReverseRefundedOrders(): { reversed: number[] } {
  const db = getDb();
  const orders = new OrdersRepo(db);

  const refunded = db
    .prepare(
      `SELECT id FROM orders
        WHERE app_status = 'refunded'
          AND stock_applied = 1`,
    )
    .all() as Array<{ id: number }>;

  const reversed: number[] = [];
  for (const { id } of refunded) {
    try {
      reverseOrderStock(id);
      reversed.push(id);
      logger.info('Refunded order stock reversed', { orderId: id });
    } catch (err) {
      logger.warn('Refund reversal failed', {
        orderId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { reversed };
}
