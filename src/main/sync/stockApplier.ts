import { logger } from '@main/logging/logger';
import { getDb } from '@main/db/connection';
import { CatalogueRepo } from '@main/db/repositories/catalogue.repo';
import { InventoryRepo } from '@main/db/repositories/inventory.repo';
import { OrdersRepo } from '@main/db/repositories/orders.repo';
import type { CatalogueEntry, RecipePreviewLine } from '@shared/types';

/**
 * Parse the comma-separated locked-addon list a bundle order carries
 * (e.g. "candle,hand-cream,giftcard"). Trims whitespace, drops blanks.
 */
function parseLockedAddons(csv: string | null): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * All addon external_ids the order should deduct stock for.
 * - BYO orders: just the customer's selections from `addon_ids_json`.
 * - Bundle orders: the bundle's `locked_addons_csv` (fixed gift contents)
 *   PLUS any optional trim addons in `addon_ids_json` (customer extras).
 * De-duped — if a website glitch put the same id in both lists, we still
 * only deduct it once.
 */
function addonExternalIdsForOrder(order: { flow_type: string; addon_ids_json: string | null; locked_addons_csv: string | null }, orderId: number): string[] {
  const ids = new Set<string>();

  if (order.addon_ids_json) {
    try {
      for (const extId of JSON.parse(order.addon_ids_json) as string[]) {
        if (typeof extId === 'string' && extId) ids.add(extId.toLowerCase());
      }
    } catch {
      logger.warn('Bad addon_ids_json on order', { orderId, value: order.addon_ids_json });
    }
  }

  if (order.flow_type === 'bundle') {
    for (const extId of parseLockedAddons(order.locked_addons_csv)) {
      ids.add(extId);
    }
  }

  return [...ids];
}

/**
 * Whether the order should fire the palette recipe (which deducts the
 * colour-specific 4-balloon cluster).
 *
 * Foil orders: yes — every foil ships with a 4-balloon cluster underneath
 * the topper, in the palette's colours. Palette recipe is what tracks
 * that colour-specific deduction.
 *
 * Curled / satin: no — these finishes don't ship a balloon cluster by
 * default. The customer picks a palette purely as ribbon-colour intent
 * (or sometimes as cluster-colour intent if they also tick extra-balloons,
 * but extras have their own generic-pack deduction). Firing the palette
 * recipe here would ghost-deduct 4 balloons that never left the shop.
 *
 * Custom palette ('custom'): never fires (its recipe is empty by design,
 * Jade hand-picks colours from the customer's free-text description on
 * the day so we don't pre-commit a specific SKU).
 */
function shouldFirePaletteRecipe(finishId: string | null): boolean {
  return finishId === 'foil';
}

/** Current website bundles send display-oriented lockedContents instead of
 * legacy locked addon ids. In that format the imported bundle recipe is the
 * authoritative fixed-content recipe. Legacy orders keep using their addon
 * ids so historical deductions remain unchanged. */
function shouldUseBundleRecipe(order: {
  flow_type: string;
  bundle_id: string | null;
  locked_addons_csv: string | null;
}): boolean {
  return order.flow_type === 'bundle'
    && Boolean(order.bundle_id)
    && parseLockedAddons(order.locked_addons_csv).length === 0;
}

/**
 * Resolve all catalogue entries that an order depends on:
 * design + finish + palette + each add-on (locked + trim for bundles).
 * Each entry is keyed by (kind, external_id).
 *
 * NOTE: bundle orders deliberately don't pull the bundle's *own* catalogue
 * entry (kind='design', external_id='bundle:<id>') even though the importer
 * creates one. Stock deduction happens via each locked addon individually
 * — pulling the bundle's recipe too would double-deduct since the bundle's
 * components mirror the locked addons. The bundle catalogue entry exists
 * for reporting (Catalogue page, Margins) only.
 *
 * Palette is conditionally included via shouldFirePaletteRecipe() — only
 * foil orders deduct the colour cluster, since curled/satin clusters
 * are zero by default (extras handle their own generic deduction).
 */
function catalogueEntriesForOrder(orderId: number): CatalogueEntry[] {
  const orders = new OrdersRepo(getDb());
  const catalogue = new CatalogueRepo(getDb());
  const order = orders.byId(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const out: CatalogueEntry[] = [];

  if (order.design_slug) {
    const e = catalogue.byKindAndExternalId('design', order.design_slug);
    if (e) out.push(e);
  }
  if (shouldUseBundleRecipe(order)) {
    const externalId = `bundle:${order.bundle_id}`;
    if (order.design_slug !== externalId) {
      const e = catalogue.byKindAndExternalId('design', externalId);
      if (e) out.push(e);
    }
  }
  if (order.finish_id) {
    const e = catalogue.byKindAndExternalId('finish', order.finish_id);
    if (e) out.push(e);
  }
  if (order.palette_id && shouldFirePaletteRecipe(order.finish_id)) {
    const e = catalogue.byKindAndExternalId('palette', order.palette_id);
    if (e) out.push(e);
  }
  for (const extId of addonExternalIdsForOrder(order, orderId)) {
    const e = catalogue.byKindAndExternalId('addon', extId);
    if (e) out.push(e);
  }
  return out;
}

/**
 * Compute the set of stock deductions that *would* happen if this order's
 * stock were applied. Doesn't write anything. Aggregates duplicate inventory
 * items across multiple recipes (e.g. design + palette both deducting the
 * same balloon).
 */
export function previewOrderRecipes(orderId: number): {
  lines: RecipePreviewLine[];
  unresolvedRecipes: Array<{ kind: string; external_id: string; reason: string }>;
} {
  const catalogue = new CatalogueRepo(getDb());
  const inventory = new InventoryRepo(getDb());
  const orders = new OrdersRepo(getDb());
  const order = orders.byId(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const entries = catalogueEntriesForOrder(orderId);
  const linesByItem = new Map<number, RecipePreviewLine>();

  // Track which expected recipes weren't found at all.
  const unresolved: Array<{ kind: string; external_id: string; reason: string }> = [];
  const expected: Array<{ kind: 'design' | 'finish' | 'palette' | 'addon'; ext: string }> = [];
  if (order.design_slug) expected.push({ kind: 'design', ext: order.design_slug });
  if (shouldUseBundleRecipe(order)) {
    const ext = `bundle:${order.bundle_id}`;
    if (order.design_slug !== ext) expected.push({ kind: 'design', ext });
  }
  if (order.finish_id) expected.push({ kind: 'finish', ext: order.finish_id });
  // Palette is only "expected" for foil orders — see shouldFirePaletteRecipe.
  if (order.palette_id && shouldFirePaletteRecipe(order.finish_id)) {
    expected.push({ kind: 'palette', ext: order.palette_id });
  }
  for (const a of addonExternalIdsForOrder(order, orderId)) {
    expected.push({ kind: 'addon', ext: a });
  }
  for (const exp of expected) {
    const found = entries.find((e) => e.kind === exp.kind && e.external_id === exp.ext);
    if (!found) {
      unresolved.push({
        kind: exp.kind,
        external_id: exp.ext,
        reason: `No catalogue entry found for ${exp.kind} '${exp.ext}'`,
      });
    }
  }

  for (const entry of entries) {
    const components = catalogue.recipeComponents(entry.id);
    if (components.length === 0) {
      unresolved.push({
        kind: entry.kind,
        external_id: entry.external_id,
        reason: `Catalogue entry has no recipe components`,
      });
      continue;
    }
    for (const c of components) {
      const item = inventory.byId(c.inventory_item_id);
      if (!item) continue;
      const existing = linesByItem.get(c.inventory_item_id);
      if (existing) {
        existing.quantity += c.quantity;
      } else {
        linesByItem.set(c.inventory_item_id, {
          inventory_item_id: item.id,
          inventory_sku: item.sku,
          inventory_name: item.name,
          inventory_unit: item.unit,
          quantity: c.quantity,
          current_on_hand: item.on_hand,
          source_kind: entry.kind,
          source_external_id: entry.external_id,
          source_name: entry.name,
        });
      }
    }
  }

  return {
    lines: [...linesByItem.values()].sort((a, b) =>
      a.inventory_name.localeCompare(b.inventory_name),
    ),
    unresolvedRecipes: unresolved,
  };
}

/**
 * Apply this order's recipe stack to inventory: writes one stock_movements row
 * per (inventory_item, source_recipe) pair and decrements on_hand atomically.
 * Marks the order stock_applied = 1.
 */
export function applyOrderStock(orderId: number): void {
  const db = getDb();
  const orders = new OrdersRepo(db);
  const inventory = new InventoryRepo(db);
  const catalogue = new CatalogueRepo(db);

  const order = orders.byId(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (order.stock_applied === 1) {
    logger.warn('applyOrderStock called on already-applied order', { orderId });
    return;
  }

  const entries = catalogueEntriesForOrder(orderId);

  const tx = db.transaction(() => {
    for (const entry of entries) {
      const components = catalogue.recipeComponents(entry.id);
      for (const c of components) {
        inventory.adjust({
          inventory_item_id: c.inventory_item_id,
          delta: -Math.round(c.quantity),
          reason: 'order_apply',
          order_id: orderId,
          catalogue_id: entry.id,
          note: `${entry.kind} '${entry.external_id}' for order #${orderId}`,
        });
      }
    }
    orders.setStockApplied(orderId, true);
  });
  tx();

  logger.info('Order stock applied', { orderId });
}

/**
 * Reverse a previously applied order: writes mirrored positive movements
 * tagged 'order_reverse' for every prior 'order_apply' on this order, then
 * marks stock_applied = 0.
 */
export function reverseOrderStock(orderId: number): void {
  const db = getDb();
  const orders = new OrdersRepo(db);
  const inventory = new InventoryRepo(db);

  const order = orders.byId(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (order.stock_applied === 0) {
    logger.warn('reverseOrderStock called on order with no applied stock', { orderId });
    return;
  }

  const priorMovements = db
    .prepare(
      `SELECT inventory_item_id, delta, catalogue_id
       FROM stock_movements
       WHERE order_id = ? AND reason = 'order_apply'`,
    )
    .all(orderId) as Array<{ inventory_item_id: number; delta: number; catalogue_id: number | null }>;

  const tx = db.transaction(() => {
    for (const m of priorMovements) {
      inventory.adjust({
        inventory_item_id: m.inventory_item_id,
        delta: -m.delta, // reverse sign
        reason: 'order_reverse',
        order_id: orderId,
        catalogue_id: m.catalogue_id,
        note: `Reversal for order #${orderId}`,
      });
    }
    orders.setStockApplied(orderId, false);
  });
  tx();

  logger.info('Order stock reversed', { orderId });
}
