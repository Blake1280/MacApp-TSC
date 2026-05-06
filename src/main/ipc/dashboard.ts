import { router, publicProcedure } from '@main/ipc/trpc';
import { getDb } from '@main/db/connection';
import { hasSecret } from '@main/auth/secrets';
import { STRIPE_SECRET_KEY } from '@main/stripe/client';
import { NETLIFY_TOKEN_KEY } from '@main/netlify/client';
import { projectStock } from '@main/lib/projection';
import type { DashboardSummary, OrderListItem } from '@shared/types';

function readSyncState(source: 'stripe' | 'netlify') {
  return getDb()
    .prepare('SELECT * FROM sync_state WHERE source = ?')
    .get(source) as
    | { last_run_at: string | null; last_success_at: string | null; last_error: string | null }
    | undefined;
}

export const dashboardRouter = router({
  summary: publicProcedure.query((): DashboardSummary => {
    const db = getDb();
    // Australia local-day boundary; SQLite runs in UTC by default. Use ISO date.
    const today = new Date().toISOString().slice(0, 10);

    const todayRow = db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(total_cents), 0) AS r
         FROM orders
         WHERE DATE(COALESCE(paid_at, manual_paid_at, created_at)) = ?
           AND app_status NOT IN ('cancelled')`,
      )
      .get(today) as { c: number; r: number };

    const pendingRow = db
      .prepare(
        `SELECT
           SUM(CASE WHEN app_status = 'new' THEN 1 ELSE 0 END) AS new_orders,
           SUM(CASE WHEN match_status IN ('netlify_only','email_only','needs_review')
                     AND manually_marked_paid = 0
                     AND app_status NOT IN ('cancelled','refunded','fulfilled')
                    THEN 1 ELSE 0 END) AS needs_review,
           SUM(CASE WHEN app_status = 'confirmed' AND stock_applied = 0 THEN 1 ELSE 0 END) AS awaiting_stock
         FROM orders`,
      )
      .get() as { new_orders: number | null; needs_review: number | null; awaiting_stock: number | null };

    const low_stock = db
      .prepare(
        `SELECT id, sku, name, category, on_hand, reorder_at, unit
         FROM inventory_items
         WHERE archived = 0 AND on_hand <= reorder_at AND reorder_at > 0
         ORDER BY (on_hand - reorder_at) ASC, name COLLATE NOCASE
         LIMIT 50`,
      )
      .all() as DashboardSummary['low_stock'];

    const recent_orders = db
      .prepare(
        `SELECT *,
           CASE WHEN addon_ids_json IS NULL OR addon_ids_json = '[]' THEN 0
                ELSE (LENGTH(addon_ids_json) - LENGTH(REPLACE(addon_ids_json, ',', ''))) + 1
           END AS addon_count
         FROM orders
         ORDER BY COALESCE(paid_at, manual_paid_at, created_at) DESC
         LIMIT 6`,
      )
      .all() as OrderListItem[];

    const stripeState = readSyncState('stripe');
    const netlifyState = readSyncState('netlify');

    // Forward-looking stock shortfalls — only surface items that are
    // projected to go negative within 30 days.
    const projection = projectStock({ horizonDays: 30 });
    const stock_alerts = projection
      .filter((p) => p.short_by > 0)
      .slice(0, 8)
      .map((p) => ({
        id: p.inventory_item_id,
        sku: p.sku,
        name: p.name,
        on_hand: p.on_hand,
        reserved_total: p.reserved_total,
        lowest_projected: p.lowest_projected,
        lowest_date: p.lowest_date,
        short_by: p.short_by,
      }));

    return {
      today: { order_count: todayRow.c ?? 0, revenue_cents: todayRow.r ?? 0 },
      pending: {
        new_orders: pendingRow.new_orders ?? 0,
        needs_review: pendingRow.needs_review ?? 0,
        awaiting_stock: pendingRow.awaiting_stock ?? 0,
      },
      low_stock,
      stock_alerts,
      recent_orders,
      sync: {
        stripe: {
          connected: hasSecret(STRIPE_SECRET_KEY),
          last_synced_at: stripeState?.last_success_at ?? null,
          last_error: stripeState?.last_error ?? null,
        },
        netlify: {
          connected: hasSecret(NETLIFY_TOKEN_KEY),
          last_synced_at: netlifyState?.last_success_at ?? null,
          last_error: netlifyState?.last_error ?? null,
        },
      },
    };
  }),
});
