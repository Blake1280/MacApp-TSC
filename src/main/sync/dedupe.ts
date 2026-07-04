import { logger } from '@main/logging/logger';
import { getDb } from '@main/db/connection';
import { OrdersRepo } from '@main/db/repositories/orders.repo';
import type { Order } from '@shared/types';

/**
 * Merge duplicate order pairs left behind by the Netlify/Stripe double-up.
 *
 * Before OrdersRepo.findUnlinkedTwin() existed, a form submission that
 * arrived without a stripe_session_id produced TWO rows for one purchase:
 * an unpaid `netlify_only` order (rich customisation) and a paid
 * `stripe_only` order. This pass reconciles pairs that are already in the
 * database: the surviving order keeps all data from both rows, and the
 * redundant row is deleted.
 *
 * Safety rules (the whole point — never lose an order Jade is working on):
 *  - Pair matching is conservative: same email (case-insensitive), same
 *    total (or the form total is 0), created within 30 days of each other.
 *  - Ambiguous candidates (an order matching more than one twin) are
 *    skipped entirely.
 *  - An order counts as "worked" when stock was applied, its status moved
 *    past `new`, or it was manually marked paid. A worked order is never
 *    deleted; when BOTH sides of a pair are worked, the pair is skipped
 *    and left for a human.
 *  - Everything runs in a transaction per pair.
 */
export function dedupeStripeNetlifyOrders(): {
  merged: Array<{ survivorId: number; deletedId: number }>;
  skipped: Array<{ stripeId: number; netlifyId: number; reason: string }>;
} {
  const db = getDb();
  const orders = new OrdersRepo(db);

  const pairs = db
    .prepare(
      `SELECT s.id AS stripe_id, n.id AS netlify_id
         FROM orders s
         JOIN orders n
           ON n.customer_email IS NOT NULL
          AND s.customer_email IS NOT NULL
          AND lower(n.customer_email) = lower(s.customer_email)
        WHERE s.source = 'stripe'
          AND s.stripe_session_id IS NOT NULL
          AND s.netlify_submission_id IS NULL
          AND n.source = 'netlify'
          AND n.netlify_submission_id IS NOT NULL
          AND n.stripe_session_id IS NULL
          AND (n.total_cents = s.total_cents OR n.total_cents = 0)
          AND abs(julianday(s.created_at) - julianday(n.created_at)) <= 30`,
    )
    .all() as Array<{ stripe_id: number; netlify_id: number }>;

  if (pairs.length === 0) return { merged: [], skipped: [] };

  // Drop any order that appears in more than one pair — ambiguous, e.g. a
  // customer who genuinely placed two identical orders. Guessing wrong here
  // would merge two real orders into one, so we don't guess.
  const stripeCounts = new Map<number, number>();
  const netlifyCounts = new Map<number, number>();
  for (const p of pairs) {
    stripeCounts.set(p.stripe_id, (stripeCounts.get(p.stripe_id) ?? 0) + 1);
    netlifyCounts.set(p.netlify_id, (netlifyCounts.get(p.netlify_id) ?? 0) + 1);
  }

  const merged: Array<{ survivorId: number; deletedId: number }> = [];
  const skipped: Array<{ stripeId: number; netlifyId: number; reason: string }> = [];

  for (const p of pairs) {
    if ((stripeCounts.get(p.stripe_id) ?? 0) > 1 || (netlifyCounts.get(p.netlify_id) ?? 0) > 1) {
      skipped.push({ stripeId: p.stripe_id, netlifyId: p.netlify_id, reason: 'ambiguous match' });
      continue;
    }

    const s = orders.byId(p.stripe_id);
    const n = orders.byId(p.netlify_id);
    if (!s || !n) continue; // deleted by an earlier pair in this run

    const worked = (o: Order) =>
      o.stock_applied === 1 || o.app_status !== 'new' || o.manually_marked_paid === 1;

    if (worked(s) && worked(n)) {
      skipped.push({
        stripeId: s.id,
        netlifyId: n.id,
        reason: 'both orders have been worked on — needs a human decision',
      });
      logger.warn('Order dedupe skipped: both twins worked on', { stripeId: s.id, netlifyId: n.id });
      continue;
    }

    // Keep the worked copy; when neither is worked, keep the paid Stripe row
    // (payment is the harder fact) and fold the form data into it.
    const survivor = worked(n) ? n : s;
    const loser = survivor.id === n.id ? s : n;

    const tx = db.transaction(() => {
      // Delete the redundant row FIRST — stripe_session_id and
      // netlify_submission_id are UNIQUE, so the survivor can't claim the
      // loser's id while the loser still holds it. OrdersRepo.delete also
      // cleans stock movements; the loser is always unworked here so there
      // are none, but reuse the safe path anyway. All inside one
      // transaction, so a failed merge rolls the delete back too.
      orders.delete(loser.id);

      if (survivor.id === s.id) {
        // Fold the form submission into the paid Stripe order. Netlify is
        // canonical for customisation, so its non-null fields win.
        db.prepare(
          `UPDATE orders SET
             netlify_submission_id = @netlify_submission_id,
             customer_name   = COALESCE(@customer_name, customer_name),
             customer_phone  = COALESCE(@customer_phone, customer_phone),
             design_slug     = COALESCE(@design_slug, design_slug),
             finish_id       = COALESCE(@finish_id, finish_id),
             palette_id      = COALESCE(@palette_id, palette_id),
             addon_ids_json  = COALESCE(@addon_ids_json, addon_ids_json),
             flow_type       = CASE WHEN flow_type = 'byo' AND @flow_type = 'bundle' THEN @flow_type ELSE flow_type END,
             bundle_id       = COALESCE(@bundle_id, bundle_id),
             bundle_name     = COALESCE(@bundle_name, bundle_name),
             locked_addons_csv = COALESCE(@locked_addons_csv, locked_addons_csv),
             custom_palette  = COALESCE(@custom_palette, custom_palette),
             delivery_zone   = COALESCE(@delivery_zone, delivery_zone),
             delivery_suburb = COALESCE(@delivery_suburb, delivery_suburb),
             address         = COALESCE(@address, address),
             fulfilment      = COALESCE(@fulfilment, fulfilment),
             date_needed     = COALESCE(@date_needed, date_needed),
             time_needed     = COALESCE(@time_needed, time_needed),
             occasion        = COALESCE(@occasion, occasion),
             recipient       = COALESCE(@recipient, recipient),
             notes           = COALESCE(@notes, notes),
             rush_order      = COALESCE(@rush_order, rush_order),
             rush_fee        = COALESCE(@rush_fee, rush_fee),
             raw_netlify_json = COALESCE(@raw_netlify_json, raw_netlify_json),
             updated_at      = datetime('now')
           WHERE id = @survivor_id`,
        ).run({
          survivor_id: s.id,
          netlify_submission_id: n.netlify_submission_id,
          customer_name: n.customer_name,
          customer_phone: n.customer_phone,
          design_slug: n.design_slug,
          finish_id: n.finish_id,
          palette_id: n.palette_id,
          addon_ids_json: n.addon_ids_json,
          flow_type: n.flow_type,
          bundle_id: n.bundle_id,
          bundle_name: n.bundle_name,
          locked_addons_csv: n.locked_addons_csv,
          custom_palette: n.custom_palette,
          delivery_zone: n.delivery_zone,
          delivery_suburb: n.delivery_suburb,
          address: n.address,
          fulfilment: n.fulfilment,
          date_needed: n.date_needed,
          time_needed: n.time_needed,
          occasion: n.occasion,
          recipient: n.recipient,
          notes: n.notes,
          rush_order: n.rush_order,
          rush_fee: n.rush_fee,
          raw_netlify_json: n.raw_netlify_json,
        });
      } else {
        // Jade worked on the form copy — keep it, attach the payment facts
        // from the redundant Stripe row.
        db.prepare(
          `UPDATE orders SET
             stripe_session_id = @stripe_session_id,
             paid_at         = COALESCE(paid_at, @paid_at),
             total_cents     = CASE WHEN total_cents IS NULL OR total_cents = 0 THEN @total_cents ELSE total_cents END,
             currency        = @currency,
             customer_name   = COALESCE(customer_name, @customer_name),
             customer_phone  = COALESCE(customer_phone, @customer_phone),
             raw_stripe_json = COALESCE(@raw_stripe_json, raw_stripe_json),
             updated_at      = datetime('now')
           WHERE id = @survivor_id`,
        ).run({
          survivor_id: n.id,
          stripe_session_id: s.stripe_session_id,
          paid_at: s.paid_at,
          total_cents: s.total_cents,
          currency: s.currency,
          customer_name: s.customer_name,
          customer_phone: s.customer_phone,
          raw_stripe_json: s.raw_stripe_json,
        });
      }

      orders.recomputeMatchStatus(survivor.id);
    });

    try {
      tx();
      merged.push({ survivorId: survivor.id, deletedId: loser.id });
      logger.info('Order dedupe merged twin pair', {
        survivorId: survivor.id,
        deletedId: loser.id,
        stripeId: s.id,
        netlifyId: n.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push({ stripeId: s.id, netlifyId: n.id, reason: `merge failed: ${msg}` });
      logger.warn('Order dedupe pair failed', { stripeId: s.id, netlifyId: n.id, error: msg });
    }
  }

  if (merged.length > 0) {
    logger.info('Order dedupe pass complete', { merged: merged.length, skipped: skipped.length });
  }
  return { merged, skipped };
}
