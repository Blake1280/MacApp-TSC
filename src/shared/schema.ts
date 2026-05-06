import { z } from 'zod';

export const stockMovementReasonSchema = z.enum([
  'order_apply',
  'order_reverse',
  'manual_adjust',
  'opening_balance',
  'correction',
  'off_site_sale',
  'restock',
]);

// photo_url is optional and nullable — http(s) URL or omitted/null. The
// form layer is responsible for converting empty inputs to null before
// sending so the schema can validate URL shape strictly.
const photoUrlField = z
  .string()
  .trim()
  .max(1000)
  .url('Photo URL must look like https://example.com/...')
  .nullish();

export const inventoryItemCreateSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required').max(64),
  name: z.string().trim().min(1, 'Name is required').max(200),
  category: z.string().trim().max(64).nullish(),
  unit: z.string().trim().min(1).max(16).default('each'),
  on_hand: z.number().int().nonnegative().default(0),
  reorder_at: z.number().int().nonnegative().default(0),
  cost_cents: z.number().int().nonnegative().nullish(),
  notes: z.string().max(2000).nullish(),
  photo_url: photoUrlField,
});

export const inventoryItemUpdateSchema = z.object({
  id: z.number().int().positive(),
  sku: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(64).nullish(),
  unit: z.string().trim().min(1).max(16).optional(),
  reorder_at: z.number().int().nonnegative().optional(),
  cost_cents: z.number().int().nonnegative().nullish(),
  notes: z.string().max(2000).nullish(),
  photo_url: photoUrlField,
  archived: z.number().int().min(0).max(1).optional(),
  // 1 = stock-counted (default for legacy + manually-added items),
  // 0 = per-order (skipped from website push, treated as available).
  stock_tracked: z.number().int().min(0).max(1).optional(),
});

export const stockAdjustSchema = z.object({
  inventory_item_id: z.number().int().positive(),
  delta: z.number().int(),
  reason: stockMovementReasonSchema,
  note: z.string().max(500).nullish(),
});

export const inventoryListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(64).optional(),
  includeArchived: z.boolean().default(false),
  lowStockOnly: z.boolean().default(false),
});

export const settingsSetSchema = z.object({
  key: z.string().trim().min(1).max(64),
  value: z.string().max(2000),
});

export const catalogueKindSchema = z.enum(['design', 'finish', 'palette', 'addon']);

export const catalogueEntryCreateSchema = z.object({
  kind: catalogueKindSchema,
  external_id: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and dashes only'),
  name: z.string().trim().min(1).max(200),
  price_cents: z.number().int().nonnegative().nullish(),
  default_finish_id: z.string().trim().max(64).nullish(),
  default_palette_id: z.string().trim().max(64).nullish(),
  autoCreateInventoryItem: z.boolean().default(false),
});

export const catalogueEntryUpdateSchema = z.object({
  id: z.number().int().positive(),
  external_id: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  price_cents: z.number().int().nonnegative().nullish(),
  default_finish_id: z.string().trim().max(64).nullish(),
  default_palette_id: z.string().trim().max(64).nullish(),
});

export const catalogueEntryArchiveSchema = z.object({
  id: z.number().int().positive(),
  archived: z.boolean(),
});

export const recipeComponentUpsertSchema = z.object({
  catalogue_id: z.number().int().positive(),
  inventory_item_id: z.number().int().positive(),
  quantity: z.number().positive(),
});

export const recipeComponentDeleteSchema = z.object({
  id: z.number().int().positive(),
});

export const importPreviewSchema = z.object({
  path: z.string().trim().min(1),
});

export const importApplySchema = z.object({
  path: z.string().trim().min(1),
  autoCreateAddonInventory: z.boolean().default(true),
  autoSeedAddonRecipes: z.boolean().default(true),
  // Bundles import as 'design' catalogue entries. When enabled, also
  // auto-seed each bundle's recipe by walking its lockedAddonIds and
  // upserting one recipe component per locked addon's inventory item.
  // Off by default for stocktake-spreadsheet imports (which don't carry
  // bundles); on by default for product-data.js imports.
  importBundles: z.boolean().default(true),
  autoSeedBundleRecipes: z.boolean().default(true),
  // Finish + palette recipe templates. Without these, bundle/BYO orders
  // deduct only the addons — no bubble, no ribbon, no latex cluster, no
  // gift box. Templates per finish + uniform 5×latex per palette match
  // Jade's actual per-order kit (verified Apr 2026). Seed only on first
  // creation so manual edits stick on re-import.
  autoSeedFinishRecipes: z.boolean().default(true),
  autoSeedPaletteRecipes: z.boolean().default(true),
});

// URL on a supplier source is optional — a known supplier may not have a
// recorded URL yet ("Supplier not linked" in the UI). When provided, it must
// be http(s). Empty strings are accepted from the form layer and converted
// to null so the DB sees a clean NULL.
const supplierUrlField = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v && v.length > 0 ? v : null))
  .refine(
    (v) => v === null || /^https?:\/\/.+/.test(v),
    { message: 'URL must look like https://example.com/...' },
  );

export const supplierSourceCreateSchema = z.object({
  inventory_item_id: z.number().int().positive(),
  supplier_name: z.string().trim().min(1).max(120),
  url: supplierUrlField,
  unit_price_cents: z.number().int().nonnegative().nullish(),
  is_preferred: z.boolean().default(false),
  notes: z.string().max(500).nullish(),
  photo_url: z.string().trim().max(1000).url().nullish(),
});

export const supplierSourceUpdateSchema = z.object({
  id: z.number().int().positive(),
  supplier_name: z.string().trim().min(1).max(120).optional(),
  url: supplierUrlField,
  unit_price_cents: z.number().int().nonnegative().nullish(),
  is_preferred: z.boolean().optional(),
  notes: z.string().max(500).nullish(),
  photo_url: z.string().trim().max(1000).url().nullish(),
});

export const supplierSourceDeleteSchema = z.object({
  id: z.number().int().positive(),
});

export const stocktakePreviewSchema = z.object({
  path: z.string().trim().min(1),
});

export const stocktakeApplySchema = z.object({
  path: z.string().trim().min(1),
  // When true, missing inventory items found in the XLSX are created.
  // When false, only existing items get their counts updated; new rows skipped.
  createMissingInventory: z.boolean().default(true),
  // When true, catalogue entries from the XLSX are upserted (matches the
  // existing TSC importer behaviour). When false, catalogue rows are skipped
  // — useful if you only want to update on-hand counts.
  upsertCatalogue: z.boolean().default(true),
  // When true, recipes are upserted into recipe_components. When false,
  // recipe sheet rows are previewed but not written.
  upsertRecipes: z.boolean().default(true),
  // Required acknowledgement when the workbook's generated_at is older than
  // the newest stock_movement (or when generated_at can't be determined).
  // The renderer surfaces a warning + checkbox; without the tick, this stays
  // false and apply throws before writing anything. Default false enforces
  // the safer behaviour for callers that forget to set it.
  acknowledgeStale: z.boolean().default(false),
  // When true, any active inventory items in the database whose SKU does NOT
  // appear in the imported workbook are archived (not hard-deleted — their
  // stock_movements stay intact). Off by default — the safer behaviour is
  // "spreadsheet only adds and updates, never removes". Tick this when doing
  // a complete-shop stocktake where you want missing rows to disappear.
  archiveMissing: z.boolean().default(false),
});

export const stripeConnectSchema = z.object({
  apiKey: z.string().trim().min(8).max(200),
});

export const netlifyConnectSchema = z.object({
  token: z.string().trim().min(8).max(200),
});

export const netlifySetTargetSchema = z.object({
  site_id: z.string().trim().min(1).max(64),
  site_name: z.string().trim().min(1).max(200),
  form_id: z.string().trim().min(1).max(64),
  form_name: z.string().trim().min(1).max(200),
});

export const orderMarkPaidSchema = z.object({
  id: z.number().int().positive(),
});

export const orderUnmarkPaidSchema = z.object({
  id: z.number().int().positive(),
});

export const orderDeleteSchema = z.object({
  id: z.number().int().positive(),
});

export const manualOrderCreateSchema = z.object({
  customer_name: z.string().trim().max(200).nullish(),
  customer_email: z.string().trim().max(200).nullish(),
  customer_phone: z.string().trim().max(50).nullish(),
  recipient: z.string().trim().max(200).nullish(),
  occasion: z.string().trim().max(100).nullish(),
  date_needed: z.string().trim().max(20).nullish(),
  fulfilment: z.string().trim().max(100).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  total_cents: z.number().int().nonnegative(),
  design_slug: z.string().trim().max(64).nullish(),
  finish_id: z.string().trim().max(64).nullish(),
  palette_id: z.string().trim().max(64).nullish(),
  addon_ids: z.array(z.string().trim().max(64)).default([]),
  mark_paid: z.boolean().default(true),
});

export const orderListQuerySchema = z.object({
  app_status: z.enum(['new', 'confirmed', 'fulfilled', 'cancelled', 'refunded']).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const orderUpdateCustomisationSchema = z.object({
  id: z.number().int().positive(),
  finish_id: z.string().trim().max(64).nullish(),
  palette_id: z.string().trim().max(64).nullish(),
  design_slug: z.string().trim().max(64).nullish(),
  addon_ids: z.array(z.string().trim().max(64)).nullish(),
  notes: z.string().max(2000).nullish(),
});

export const orderActionSchema = z.object({
  id: z.number().int().positive(),
});

export const orderSetStatusSchema = z.object({
  id: z.number().int().positive(),
  app_status: z.enum(['new', 'confirmed', 'fulfilled', 'cancelled', 'refunded']),
});

export type InventoryItemCreate = z.infer<typeof inventoryItemCreateSchema>;
export type InventoryItemUpdate = z.infer<typeof inventoryItemUpdateSchema>;
export type StockAdjust = z.infer<typeof stockAdjustSchema>;
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
