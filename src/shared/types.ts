export type InventoryItem = {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  on_hand: number;
  reorder_at: number;
  cost_cents: number | null;
  notes: string | null;
  // Optional thumbnail URL (e.g. supplier swatch image). Surfaced on the
  // Stock-page row when present. NULL means no photo — the row falls back
  // to a plain text-only layout.
  photo_url: string | null;
  // 1 = stock-counted item (on_hand drives website availability + low-stock
  // alerts). 0 = per-order item: Jade orders it as the customer requests it,
  // never pre-stocked. on_hand for these is informational only — pushStock
  // skips them so the website never blacks them out, and the synthetic
  // catalogue-availability calc treats them as effectively infinite.
  // Defaults to 1 for backwards-compat with all pre-migration-018 items.
  stock_tracked: number;
  archived: number;
  created_at: string;
  updated_at: string;
};

export type StockMovementReason =
  | 'order_apply'
  | 'order_reverse'
  | 'manual_adjust'
  | 'opening_balance'
  | 'correction'
  | 'off_site_sale'
  | 'restock';

export type StockMovement = {
  id: number;
  inventory_item_id: number;
  delta: number;
  reason: StockMovementReason;
  order_id: number | null;
  catalogue_id: number | null;
  note: string | null;
  created_at: string;
};

export type CatalogueKind = 'design' | 'finish' | 'palette' | 'addon';

export type CatalogueEntry = {
  id: number;
  kind: CatalogueKind;
  external_id: string;
  name: string;
  price_cents: number | null;
  default_finish_id: string | null;
  default_palette_id: string | null;
  // Customer-facing grouping inherited from the website's product-data.js:
  //   - bundles → bundle.category ("For Her", "For Him", "Birthday", etc.)
  //   - addons  → addon.group ("sweet", "drinks", "pantry", etc.)
  //   - finishes / palettes / one-off designs → typically NULL
  // Used purely for layout in the Catalogue page; not part of stock logic.
  category: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
};

export type OrderMatchStatus =
  | 'all_three'
  | 'stripe_netlify'
  | 'stripe_email'
  | 'netlify_email'
  | 'stripe_only'
  | 'netlify_only'
  | 'email_only'
  | 'manual'
  | 'needs_review';

export type OrderSource = 'stripe' | 'netlify' | 'manual';

export type OrderAppStatus = 'new' | 'confirmed' | 'fulfilled' | 'cancelled' | 'refunded';

export type RecipeComponent = {
  id: number;
  catalogue_id: number;
  inventory_item_id: number;
  quantity: number;
};

export type RecipeComponentWithItem = RecipeComponent & {
  inventory_sku: string;
  inventory_name: string;
  inventory_unit: string;
};

export type CatalogueEntryWithCounts = CatalogueEntry & {
  recipe_component_count: number;
};

export type ImportPreview = {
  source_path: string;
  designs: Array<{ external_id: string; name: string; default_finish_id: string | null; default_palette_id: string | null }>;
  finishes: Array<{ external_id: string; name: string; price_cents: number | null }>;
  palettes: Array<{ external_id: string; name: string }>;
  addons: Array<{ external_id: string; name: string; price_cents: number | null; group: string | null }>;
  // Pre-set bundles — Jade-curated gift kits sold from /bundles.html. Each
  // imports as a catalogue 'design' entry whose recipe is the union of its
  // locked addons. trim/optional addons are tracked at the order level.
  bundles: Array<{
    external_id: string;
    name: string;
    category: string | null;
    default_finish_id: string | null;
    default_palette_id: string | null;
    locked_addon_ids: string[];
  }>;
};

export type Order = {
  id: number;
  stripe_session_id: string | null;
  netlify_submission_id: string | null;
  graph_message_id: string | null;
  source: OrderSource;
  manually_marked_paid: number;
  manual_paid_at: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  total_cents: number;
  currency: string;
  paid_at: string | null;
  design_slug: string | null;
  finish_id: string | null;
  palette_id: string | null;
  addon_ids_json: string | null;
  // Bundle fields (Path B on the website). flow_type is 'byo' for legacy
  // and BYO orders; 'bundle' for orders that came from /bundles.html.
  // bundle_id matches the website's product-data.js bundles[].id.
  // locked_addons_csv is the comma-separated list of addon external_ids
  // that the bundle locks in (the gifts inside) — addon_ids_json holds
  // only the customer's optional trim selections.
  flow_type: 'byo' | 'bundle';
  bundle_id: string | null;
  bundle_name: string | null;
  locked_addons_csv: string | null;
  // The customer's free-text palette description, set when palette_id == 'custom'
  // ("Tell us — custom" option in the BYO flow).
  custom_palette: string | null;
  // Structured delivery info — separate from the human-readable `fulfilment` string.
  // delivery_zone is one of 'bathurst' | 'nearby' | 'elsewhere' | 'pickup'.
  // delivery_suburb is the free-text suburb the customer typed when zone='elsewhere'.
  delivery_zone: string | null;
  delivery_suburb: string | null;
  // Free-text street address. Captured by the website's Netlify form. Used
  // for delivery orders in the bathurst/nearby/elsewhere zones; pickup
  // orders leave this null.
  address: string | null;
  fulfilment: string | null;
  date_needed: string | null;
  // Optional preferred time (HH:MM, 24-hour). Used when the customer needs
  // a specific drop-off / pickup time — e.g. "deliver 10am before the
  // surprise lunch" or "pickup 2pm".
  time_needed: string | null;
  occasion: string | null;
  recipient: string | null;
  notes: string | null;
  // Rush-order tier from the BYO/bundles checkout. The website only emits
  // these when the customer's date_needed is within 7 days of order time
  // and they tick the +$25 rush box. NULL on every other order. rush_fee
  // is GST-inclusive and stored as the website's TEXT representation
  // ('25.00') so we round-trip exactly what came in.
  rush_order: string | null;
  rush_fee: string | null;
  match_status: OrderMatchStatus;
  app_status: OrderAppStatus;
  stock_applied: number;
  raw_stripe_json: string | null;
  raw_netlify_json: string | null;
  raw_graph_json: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderListItem = Order & {
  addon_count: number;
};

export type SyncSource = 'stripe' | 'graph' | 'netlify';

export type SyncState = {
  source: SyncSource;
  last_run_at: string | null;
  last_success_at: string | null;
  last_cursor: string | null;
  last_error: string | null;
};

export type StripeConnectionStatus = {
  connected: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  encryption_available: boolean;
};

export type NetlifyConnectionStatus = {
  connected: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  site_id: string | null;
  site_name: string | null;
  form_id: string | null;
  form_name: string | null;
};

export type NetlifySite = {
  id: string;
  name: string;
  url: string;
};

export type NetlifyForm = {
  id: string;
  name: string;
  submission_count: number;
};

export type RecipePreviewLine = {
  inventory_item_id: number;
  inventory_sku: string;
  inventory_name: string;
  inventory_unit: string;
  quantity: number;
  current_on_hand: number;
  source_kind: CatalogueKind;
  source_external_id: string;
  source_name: string;
};

export type DashboardSummary = {
  today: {
    order_count: number;
    revenue_cents: number;
  };
  pending: {
    new_orders: number;
    needs_review: number;
    awaiting_stock: number; // confirmed orders where stock is somehow not applied (rare)
  };
  low_stock: Array<{
    id: number;
    sku: string;
    name: string;
    category: string | null;
    on_hand: number;
    reorder_at: number;
    unit: string;
  }>;
  /** Forward-looking warnings: items projected to go negative within the
   *  next 30 days based on pending orders' date_needed and recipes. */
  stock_alerts: Array<{
    id: number;
    sku: string;
    name: string;
    on_hand: number;
    reserved_total: number;
    lowest_projected: number;
    lowest_date: string | null;
    short_by: number;
  }>;
  recent_orders: OrderListItem[];
  sync: {
    stripe: { connected: boolean; last_synced_at: string | null; last_error: string | null };
    netlify: { connected: boolean; last_synced_at: string | null; last_error: string | null };
  };
};

/**
 * One reorder source for an inventory item — supplier name, URL Jade clicks
 * to reorder, and (optionally) the last per-unit price she paid there.
 * The Stock-page Reorder dropdown sorts these by price ascending so the
 * cheapest known option always shows first.
 */
export type SupplierSource = {
  id: number;
  inventory_item_id: number;
  supplier_name: string;
  // null when the supplier is known but no specific product/category URL has
  // been recorded yet. The Stock-page Reorder UI shows "Supplier not linked"
  // in this case + an inline option to paste the link.
  url: string | null;
  unit_price_cents: number | null;
  is_preferred: number; // 0 | 1
  notes: string | null;
  // Per-source thumbnail. When set, the Reorder dropdown shows this image
  // alongside the supplier name — useful for picking colour variants. Falls
  // back to the inventory item's main photo_url if not set.
  photo_url: string | null;
  created_at: string;
  updated_at: string;
};

export type AuditLogRow = StockMovement & {
  inventory_sku: string;
  inventory_name: string;
  inventory_unit: string;
  catalogue_kind: CatalogueKind | null;
  catalogue_external_id: string | null;
  catalogue_name: string | null;
  order_stripe_session_id: string | null;
  order_customer_name: string | null;
};

export type ImportResult = {
  inserted: { designs: number; finishes: number; palettes: number; addons: number; bundles: number };
  updated: { designs: number; finishes: number; palettes: number; addons: number; bundles: number };
  inventoryAutoCreated: number;
  recipesAutoSeeded: number;
  // Recipe components seeded onto bundle catalogue entries — one per
  // locked addon found in the bundle's lockedAddonIds list. Skipped
  // when the addon hasn't been imported yet or has no inventory item.
  bundleRecipesAutoSeeded: number;
  // Locked addon ids referenced by bundles that couldn't be resolved to
  // a known catalogue addon. Surfaced as a warning so Jade knows which
  // bundles will undercount on stock-deduction until she fills them in.
  bundleRecipeWarnings: string[];
  // Recipe components seeded onto finish + palette catalogue entries.
  // Finish templates cover the bubble + ribbon + gift box + pin + care
  // guide (one per order). Palette templates cover 5× balloon-latex-5in
  // -pack uniformly. Skipped when the underlying physical inventory SKU
  // hasn't been imported yet (then surfaced via finishRecipeWarnings).
  finishRecipesAutoSeeded: number;
  paletteRecipesAutoSeeded: number;
  finishRecipeWarnings: string[];
};

/**
 * Stocktake XLSX import — preview/result types.
 * Sheets parsed: Inventory_Items, Catalogue_Entries, Recipes (Bundles_Reference is read-only).
 */
export type StocktakePreviewRow<T> = {
  status: 'new' | 'update' | 'unchanged' | 'error';
  reason?: string;
  data: T;
};

export type StocktakeInventoryRow = {
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  on_hand: number | null;
  reorder_at: number | null;
  cost_cents: number | null;
  notes: string | null;
};

export type StocktakeCatalogueRow = {
  kind: 'design' | 'finish' | 'palette' | 'addon';
  external_id: string;
  name: string;
  price_cents: number | null;
  default_finish_id: string | null;
  default_palette_id: string | null;
};

export type StocktakeRecipeRow = {
  catalogue_kind: 'design' | 'finish' | 'palette' | 'addon';
  catalogue_external_id: string;
  inventory_sku: string;
  quantity: number;
};

export type StocktakeFreshness =
  | { status: 'fresh'; generatedAt: string; lastMovementAt: string | null }
  | { status: 'stale'; generatedAt: string; lastMovementAt: string; movementsSince: number }
  | { status: 'unknown'; reason: string };

export type StocktakePreview = {
  source_path: string;
  inventory: StocktakePreviewRow<StocktakeInventoryRow>[];
  catalogue: StocktakePreviewRow<StocktakeCatalogueRow>[];
  recipes: StocktakePreviewRow<StocktakeRecipeRow>[];
  warnings: string[];
  freshness: StocktakeFreshness;
};

export type StocktakeApplyResult = {
  inventory: { created: number; updated: number; stockAdjusted: number; archived: number };
  catalogue: { created: number; updated: number };
  recipes: { upserted: number; skipped: number };
  warnings: string[];
};
