import type { Database } from 'better-sqlite3';
import { getDb } from '@main/db/connection';
import { OrdersRepo } from '@main/db/repositories/orders.repo';
import { previewOrderRecipes } from '@main/sync/stockApplier';

export type OrderCogsLine = {
  inventory_item_id: number;
  sku: string;
  name: string;
  quantity: number;
  unit_cost_cents: number | null;
  line_cost_cents: number;
};

export type OrderCogs = {
  order_id: number;
  cogs_cents: number;
  total_cents: number;
  margin_cents: number;
  unknown_items: Array<{ inventory_item_id: number; sku: string; name: string }>;
  lines: OrderCogsLine[];
};

export type BundleMarginRow = {
  bundle_id: string | null;
  bundle_name: string | null;
  flow_type: 'byo' | 'bundle';
  order_count: number;
  total_revenue_cents: number;
  total_cogs_cents: number;
  total_margin_cents: number;
  avg_revenue_cents: number;
  avg_cogs_cents: number;
  avg_margin_cents: number;
  unknown_items_count: number;
};

export type OrderMarginRow = {
  order_id: number;
  paid_at: string | null;
  customer_name: string | null;
  flow_type: 'byo' | 'bundle';
  bundle_name: string | null;
  total_cents: number;
  cogs_cents: number;
  margin_cents: number;
  unknown_items_count: number;
};

export type MarginsRange = { from?: string; to?: string };

/** Cheapest known supplier price across all sources for an inventory item.
 * Returns null when no source has a recorded price. */
function cheapestPriceFor(db: Database, itemId: number): number | null {
  const row = db
    .prepare(
      `SELECT MIN(unit_price_cents) AS min_price
         FROM inventory_supplier_sources
        WHERE inventory_item_id = ? AND unit_price_cents IS NOT NULL`,
    )
    .get(itemId) as { min_price: number | null } | undefined;
  return row?.min_price ?? null;
}

export function computeOrderCogs(orderId: number, dbOverride?: Database): OrderCogs {
  const db = dbOverride ?? getDb();
  const orders = new OrdersRepo(db);
  const order = orders.byId(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const { lines: previewLines } = previewOrderRecipes(orderId);

  let cogs_cents = 0;
  const unknown_items: OrderCogs['unknown_items'] = [];
  const lines: OrderCogsLine[] = [];

  for (const line of previewLines) {
    const unit = cheapestPriceFor(db, line.inventory_item_id);
    if (unit === null) {
      unknown_items.push({
        inventory_item_id: line.inventory_item_id,
        sku: line.inventory_sku,
        name: line.inventory_name,
      });
    }
    const lineCost = unit !== null ? Math.round(unit * line.quantity) : 0;
    cogs_cents += lineCost;
    lines.push({
      inventory_item_id: line.inventory_item_id,
      sku: line.inventory_sku,
      name: line.inventory_name,
      quantity: line.quantity,
      unit_cost_cents: unit,
      line_cost_cents: lineCost,
    });
  }

  return {
    order_id: orderId,
    cogs_cents,
    total_cents: order.total_cents,
    margin_cents: order.total_cents - cogs_cents,
    unknown_items,
    lines,
  };
}

function rangeWhere(range: MarginsRange): { sql: string; params: Record<string, unknown> } {
  const where: string[] = ["app_status NOT IN ('cancelled')"];
  const params: Record<string, unknown> = {};
  if (range.from) {
    where.push("DATE(COALESCE(paid_at, manual_paid_at, created_at)) >= :from");
    params.from = range.from;
  }
  if (range.to) {
    where.push("DATE(COALESCE(paid_at, manual_paid_at, created_at)) <= :to");
    params.to = range.to;
  }
  return { sql: where.join(' AND '), params };
}

export function marginsByBundle(range: MarginsRange = {}): BundleMarginRow[] {
  const db = getDb();
  const w = rangeWhere(range);
  const rows = db
    .prepare(
      `SELECT id, flow_type, bundle_id, bundle_name
         FROM orders
        WHERE ${w.sql}`,
    )
    .all(w.params) as Array<{
    id: number;
    flow_type: 'byo' | 'bundle';
    bundle_id: string | null;
    bundle_name: string | null;
  }>;

  const buckets = new Map<string, BundleMarginRow>();
  for (const r of rows) {
    const cogs = computeOrderCogs(r.id, db);
    const isBundle = r.flow_type === 'bundle' && !!r.bundle_id;
    const key = isBundle ? `bundle:${r.bundle_id}` : 'byo';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        bundle_id: isBundle ? r.bundle_id : null,
        bundle_name: isBundle ? r.bundle_name : null,
        flow_type: isBundle ? 'bundle' : 'byo',
        order_count: 0,
        total_revenue_cents: 0,
        total_cogs_cents: 0,
        total_margin_cents: 0,
        avg_revenue_cents: 0,
        avg_cogs_cents: 0,
        avg_margin_cents: 0,
        unknown_items_count: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.order_count += 1;
    bucket.total_revenue_cents += cogs.total_cents;
    bucket.total_cogs_cents += cogs.cogs_cents;
    bucket.total_margin_cents += cogs.margin_cents;
    bucket.unknown_items_count += cogs.unknown_items.length;
  }

  for (const b of buckets.values()) {
    if (b.order_count > 0) {
      b.avg_revenue_cents = Math.round(b.total_revenue_cents / b.order_count);
      b.avg_cogs_cents = Math.round(b.total_cogs_cents / b.order_count);
      b.avg_margin_cents = Math.round(b.total_margin_cents / b.order_count);
    }
  }

  // Worst margin first — surfaces loss-makers immediately.
  return [...buckets.values()].sort((a, b) => a.avg_margin_cents - b.avg_margin_cents);
}

export function marginsByOrder(range: MarginsRange & { limit?: number } = {}): OrderMarginRow[] {
  const db = getDb();
  const limit = range.limit ?? 100;
  const w = rangeWhere(range);
  const rows = db
    .prepare(
      `SELECT id, paid_at, manual_paid_at, customer_name, flow_type, bundle_name, total_cents
         FROM orders
        WHERE ${w.sql}
        ORDER BY COALESCE(paid_at, manual_paid_at, created_at) DESC
        LIMIT ${limit}`,
    )
    .all(w.params) as Array<{
    id: number;
    paid_at: string | null;
    manual_paid_at: string | null;
    customer_name: string | null;
    flow_type: 'byo' | 'bundle';
    bundle_name: string | null;
    total_cents: number;
  }>;

  const out: OrderMarginRow[] = [];
  for (const r of rows) {
    const cogs = computeOrderCogs(r.id, db);
    out.push({
      order_id: r.id,
      paid_at: r.paid_at ?? r.manual_paid_at ?? null,
      customer_name: r.customer_name,
      flow_type: r.flow_type,
      bundle_name: r.bundle_name,
      total_cents: r.total_cents,
      cogs_cents: cogs.cogs_cents,
      margin_cents: cogs.margin_cents,
      unknown_items_count: cogs.unknown_items.length,
    });
  }

  return out.sort((a, b) => a.margin_cents - b.margin_cents);
}
