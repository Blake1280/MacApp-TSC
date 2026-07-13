import { z } from 'zod';
import { router, publicProcedure } from '@main/ipc/trpc';
import { getDb } from '@main/db/connection';
import { InventoryRepo } from '@main/db/repositories/inventory.repo';
import { MovementsRepo } from '@main/db/repositories/movements.repo';
import { projectStock } from '@main/lib/projection';
import {
  inventoryItemCreateSchema,
  inventoryItemUpdateSchema,
  inventoryListQuerySchema,
  stockAdjustSchema,
} from '@shared/schema';
import { apiPost } from '@main/lib/tscWebApi';
import { hasSecret } from '@main/auth/secrets';

async function publishInventory(repo: InventoryRepo): Promise<void> {
  if (!hasSecret('tsc_web_api_key')) return;
  const items = repo.list({ includeArchived: true, lowStockOnly: false })
    .filter((item) => item.stock_tracked !== 0)
    .map((item) => ({ sku: item.sku, name: item.name, category: item.category, on_hand: item.on_hand, reorder_at: item.reorder_at, archived: !!item.archived, updated_at: item.updated_at }));
  await apiPost('/inventory-sync', { items });
}

type ReorderItem = {
  inventory_item_id: number;
  sku: string;
  name: string;
  unit: string;
  on_hand: number;
  reorder_at: number;
  shortfall: number;
  supplier_id: number;
  supplier_name: string;
  supplier_url: string | null;
  unit_price_cents: number | null;
  photo_url: string | null;
  is_preferred: number;
};

/** Group key = everything before " — " on the supplier name (matches the
 *  groupSuppliers convention used on the Stock page). Falls back to the
 *  full name for sources with no separator. */
function primarySupplier(name: string): string {
  const idx = name.indexOf(' — ');
  return idx > 0 ? name.slice(0, idx).trim() : name.trim();
}

export const inventoryRouter = router({
  list: publicProcedure
    .input(inventoryListQuerySchema.partial().optional())
    .query(({ input }) => {
      const repo = new InventoryRepo(getDb());
      return repo.list({
        search: input?.search,
        category: input?.category,
        includeArchived: input?.includeArchived ?? false,
        lowStockOnly: input?.lowStockOnly ?? false,
      });
    }),

  byId: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => new InventoryRepo(getDb()).byId(input.id)),

  create: publicProcedure
    .input(inventoryItemCreateSchema)
    .mutation(async ({ input }) => { const repo = new InventoryRepo(getDb()); const item = repo.create(input); await publishInventory(repo); return item; }),

  update: publicProcedure
    .input(inventoryItemUpdateSchema)
    .mutation(async ({ input }) => { const repo = new InventoryRepo(getDb()); const item = repo.update(input); await publishInventory(repo); return item; }),

  adjust: publicProcedure
    .input(stockAdjustSchema)
    .mutation(async ({ input }) => {
      const repo = new InventoryRepo(getDb());
      const item = repo.adjust({
        inventory_item_id: input.inventory_item_id,
        delta: input.delta,
        reason: input.reason,
        note: input.note ?? null,
      });
      await publishInventory(repo);
      return item;
    }),

  categories: publicProcedure.query(() => new InventoryRepo(getDb()).categories()),

  movements: publicProcedure
    .input(
      z.object({
        inventory_item_id: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      }),
    )
    .query(({ input }) =>
      new MovementsRepo(getDb()).list({
        inventory_item_id: input.inventory_item_id,
        limit: input.limit,
      }),
    ),

  reorderList: publicProcedure.query(() => {
    const db = getDb();
    // For each low-stock item, pick the best source (preferred first, then
    // cheapest priced). Ties broken alphabetically by supplier name.
    const rows = db
      .prepare(
        `SELECT
           i.id            AS inventory_item_id,
           i.sku           AS sku,
           i.name          AS name,
           i.unit          AS unit,
           i.on_hand       AS on_hand,
           i.reorder_at    AS reorder_at,
           s.id            AS supplier_id,
           s.supplier_name AS supplier_name,
           s.url           AS supplier_url,
           s.unit_price_cents AS unit_price_cents,
           s.photo_url     AS photo_url,
           s.is_preferred  AS is_preferred
         FROM inventory_items i
         LEFT JOIN inventory_supplier_sources s
           ON s.id = (
             SELECT id FROM inventory_supplier_sources s2
             WHERE s2.inventory_item_id = i.id
             ORDER BY
               s2.is_preferred DESC,
               CASE WHEN s2.unit_price_cents IS NULL THEN 1 ELSE 0 END,
               s2.unit_price_cents ASC,
               s2.supplier_name COLLATE NOCASE
             LIMIT 1
           )
         WHERE i.archived = 0
           AND i.reorder_at > 0
           AND i.on_hand <= i.reorder_at
         ORDER BY (i.on_hand - i.reorder_at) ASC, i.name COLLATE NOCASE`,
      )
      .all() as Array<ReorderItem>;

    type Group = { supplier_group: string; items: ReorderItem[] };
    const groups = new Map<string, Group>();
    for (const r of rows) {
      // Top-up to 2× threshold so Jade's not back at the reorder line
      // a week later. Floor of `reorder_at` so a never-ordered item
      // (on_hand 0, threshold 5) buys at least 10.
      const target = Math.max(r.reorder_at * 2, r.reorder_at + 1);
      const item: ReorderItem = {
        ...r,
        shortfall: Math.max(1, target - r.on_hand),
      };
      const groupKey = r.supplier_name ? primarySupplier(r.supplier_name) : '— No supplier linked —';
      let g = groups.get(groupKey);
      if (!g) {
        g = { supplier_group: groupKey, items: [] };
        groups.set(groupKey, g);
      }
      g.items.push(item);
    }
    // Groups with linked suppliers first; "no supplier" bucket last.
    return [...groups.values()].sort((a, b) => {
      const aBlank = a.supplier_group.startsWith('—') ? 1 : 0;
      const bBlank = b.supplier_group.startsWith('—') ? 1 : 0;
      if (aBlank !== bBlank) return aBlank - bBlank;
      return a.supplier_group.localeCompare(b.supplier_group);
    });
  }),

  projection: publicProcedure
    .input(z.object({ horizon_days: z.number().int().min(1).max(365).optional() }).optional())
    .query(({ input }) => projectStock({ horizonDays: input?.horizon_days })),

  /** "Setup health" — counts of catalogue/inventory rows that would degrade
   *  Margins / Reorder / projection numbers if left unfilled. Surfaced as a
   *  banner on the affected pages with deep-links into the editor. */
  dataHealth: publicProcedure.query(() => {
    const db = getDb();
    const addonsMissingRecipes = db
      .prepare(
        `SELECT c.id, c.external_id, c.name
           FROM catalogue_entries c
          WHERE c.archived = 0
            AND c.kind = 'addon'
            AND NOT EXISTS (
              SELECT 1 FROM recipe_components r WHERE r.catalogue_id = c.id
            )
          ORDER BY c.name COLLATE NOCASE`,
      )
      .all() as Array<{ id: number; external_id: string; name: string }>;

    const itemsMissingPrices = db
      .prepare(
        `SELECT i.id, i.sku, i.name
           FROM inventory_items i
          WHERE i.archived = 0
            AND NOT EXISTS (
              SELECT 1 FROM inventory_supplier_sources s
               WHERE s.inventory_item_id = i.id AND s.unit_price_cents IS NOT NULL
            )
          ORDER BY i.name COLLATE NOCASE`,
      )
      .all() as Array<{ id: number; sku: string; name: string }>;

    const itemsUsedInRecipes = db
      .prepare(
        `SELECT DISTINCT inventory_item_id FROM recipe_components`,
      )
      .all() as Array<{ inventory_item_id: number }>;
    const usedIds = new Set(itemsUsedInRecipes.map((r) => r.inventory_item_id));
    // Items that are in recipes but missing prices — these directly skew COGS.
    const cogsAffectingItems = itemsMissingPrices.filter((i) => usedIds.has(i.id));

    return {
      addonsMissingRecipes,
      itemsMissingPrices, // all unpriced items (including never-used)
      cogsAffectingItems, // unpriced items currently in a recipe
    };
  }),
});
