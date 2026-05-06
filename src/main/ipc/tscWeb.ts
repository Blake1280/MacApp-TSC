/* tRPC router for the TSC website's HTTPS API.
 *
 * Bridges the Electron app to two Netlify functions:
 *   - /orders-list — read web orders + authoritative payment status
 *   - /push-stock  — upload stocktake snapshot for the website's badges
 *
 * Both calls go through src/main/lib/tscWebApi.ts which handles auth and
 * error wrapping uniformly.
 */

import { z } from 'zod';
import { router, publicProcedure } from '@main/ipc/trpc';
import { getDb } from '@main/db/connection';
import { InventoryRepo } from '@main/db/repositories/inventory.repo';
import { CatalogueRepo } from '@main/db/repositories/catalogue.repo';
import { logger } from '@main/logging/logger';
import { apiGet, apiPost } from '@main/lib/tscWebApi';
import { app } from 'electron';

type WebOrder = {
  id: number;
  created_at: string;
  updated_at: string;
  stripe_session_id: string | null;
  stripe_mode: 'test' | 'live';
  payment_status: 'awaiting_redirect' | 'paid' | 'failed' | 'expired' | 'refunded';
  paid_at: string | null;
  amount_cents: number;
  currency: string;
  payment_method_type: string | null;
  flow_type: 'byo' | 'bundle';
  bundle_id: string | null;
  bundle_name: string | null;
  finish_id: string | null;
  finish_name: string | null;
  palette_id: string | null;
  palette_name: string | null;
  custom_palette: string | null;
  addon_ids_csv: string | null;
  addons_summary: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  fulfilment: string | null;
  delivery_zone: string | null;
  delivery_suburb: string | null;
  address: string | null;
  date_needed: string | null;
  time_needed: string | null;
  occasion: string | null;
  recipient: string | null;
  notes: string | null;
};

const listOrdersInput = z
  .object({
    since: z.string().datetime().optional(),
    status: z
      .array(z.enum(['awaiting_redirect', 'paid', 'failed', 'expired', 'refunded']))
      .optional(),
    limit: z.number().int().min(1).max(1000).default(200),
  })
  .partial()
  .optional();

export const tscWebRouter = router({
  /** Fetch the website's order log. Returns rows ordered most-recent-first. */
  listOrders: publicProcedure.input(listOrdersInput).query(async ({ input }) => {
    const params = new URLSearchParams();
    if (input?.limit) params.set('limit', String(input.limit));
    if (input?.since) params.set('since', input.since);
    if (input?.status?.length) params.set('status', input.status.join(','));
    const qs = params.toString();
    const path = `/orders-list${qs ? `?${qs}` : ''}`;
    const res = await apiGet<{ ok: boolean; count: number; orders: WebOrder[] }>(path);
    return { count: res.count, orders: res.orders };
  }),

  /** Push the current inventory snapshot up to the website. The website
   *  upserts each sku into stock_levels and archives any sku missing from
   *  the payload. Returns the count actually upserted.
   *
   *  Also pushes a derived "catalogue availability" map: for each non-
   *  archived catalogue entry (addon, finish, etc.), we compute the minimum
   *  fulfillable count across its recipe components and push it as a
   *  synthetic stock row with sku = `web:${kind}:${external_id}`. This lets
   *  the website black out tiles by the entry's external_id (which matches
   *  the website's addon/finish id) without caring about the underlying
   *  inventory SKU naming — so renaming SKUs in the app doesn't break the
   *  website's out-of-stock display.
   *
   *  Items flagged stock_tracked=0 (per-order — Jade orders as customers
   *  request them) are EXCLUDED from both maps:
   *    - their own SKU is omitted from realItems so the website's stock-map
   *      lookup falls open and the tile shows as available
   *    - they're treated as having infinite stock when computing minFulfillable
   *      for catalogue entries, so a recipe component being per-order doesn't
   *      black out the parent addon tile
   *  This is the key mechanism that lets pre-order items stay sellable on
   *  the website even when their on_hand sits at 0.
   */
  pushStock: publicProcedure.mutation(async () => {
    const db = getDb();
    const inventoryRepo = new InventoryRepo(db);
    const catalogueRepo = new CatalogueRepo(db);

    const items = inventoryRepo.list({ includeArchived: true, lowStockOnly: false });
    const itemById = new Map(items.map((i) => [i.id, i]));
    const isTracked = (item: { stock_tracked: number } | undefined): boolean =>
      !!item && item.stock_tracked !== 0;

    // Build synthetic catalogue-availability rows from recipes.
    const catalogueEntries = catalogueRepo.list({ includeArchived: false });
    const synthetic: Array<{
      sku: string;
      name: string;
      category: string;
      on_hand: number;
      reorder_at: number | null;
      archived: boolean;
    }> = [];
    for (const entry of catalogueEntries) {
      const components = catalogueRepo.recipeComponents(entry.id);
      if (components.length === 0) continue; // no recipe = not stock-tracked
      let minFulfillable = Number.POSITIVE_INFINITY;
      for (const c of components) {
        const item = itemById.get(c.inventory_item_id);
        // Per-order components don't constrain the parent's availability —
        // Jade can always order one in for the customer, so the tile should
        // stay sellable on the website regardless of on_hand.
        if (item && !isTracked(item)) continue;
        const onHand = item && !item.archived ? Math.max(0, item.on_hand) : 0;
        const qty = Math.max(1, c.quantity || 1);
        minFulfillable = Math.min(minFulfillable, Math.floor(onHand / qty));
      }
      const finalOnHand = Number.isFinite(minFulfillable) ? minFulfillable : 0;
      synthetic.push({
        sku: `web:${entry.kind}:${entry.external_id}`,
        name: entry.name,
        category: `web-${entry.kind}`,
        on_hand: finalOnHand,
        reorder_at: null,
        archived: false,
      });
    }

    // Drop per-order items entirely — the website's stock-map lookup falls
    // open when a SKU is missing, which is what we want (always available).
    const realItems = items
      .filter((i) => isTracked(i))
      .map((i) => ({
        sku: i.sku,
        name: i.name,
        category: i.category,
        on_hand: i.on_hand,
        reorder_at: i.reorder_at,
        archived: !!i.archived,
      }));
    const skipped = items.length - realItems.length;

    const payload = {
      items: [...realItems, ...synthetic],
      source: `electron-app v${app.getVersion()}`,
      notes: `pushed ${new Date().toISOString()} — ${realItems.length} inventory + ${synthetic.length} catalogue-derived (${skipped} per-order skipped)`,
    };

    logger.info('Pushing stocktake to website', {
      inventoryCount: realItems.length,
      catalogueCount: synthetic.length,
      perOrderSkipped: skipped,
    });
    const res = await apiPost<{ ok: boolean; itemsUpserted: number }>(
      '/push-stock',
      payload,
    );
    return {
      itemsUpserted: res.itemsUpserted,
      inventoryItems: realItems.length,
      catalogueItems: synthetic.length,
      perOrderSkipped: skipped,
    };
  }),
});
