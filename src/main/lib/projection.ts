import type { Database } from 'better-sqlite3';
import { getDb } from '@main/db/connection';
import { previewOrderRecipes } from '@main/sync/stockApplier';

export type ProjectionByDate = { date: string; qty: number };

export type ProjectionRow = {
  inventory_item_id: number;
  sku: string;
  name: string;
  unit: string;
  on_hand: number;
  reserved_total: number;
  by_date: ProjectionByDate[];
  /** Lowest projected on_hand within the horizon. Equals on_hand if no demand. */
  lowest_projected: number;
  /** ISO date (YYYY-MM-DD) where lowest_projected occurs. null if no demand. */
  lowest_date: string | null;
  /** Positive number when lowest_projected < 0 — the shortfall on lowest_date. */
  short_by: number;
};

/** Return today's date in local time as YYYY-MM-DD. SQLite's `date('now')`
 * uses UTC, which can drift by a day in Australia. Use the host's local
 * clock — that's what the user thinks of as "today". */
function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Project on_hand forward by walking pending orders' recipes against
 *  date_needed. Pure function over the DB — no writes, no caching. */
export function projectStock(opts: { horizonDays?: number; dbOverride?: Database } = {}): ProjectionRow[] {
  const db = opts.dbOverride ?? getDb();
  const horizon = opts.horizonDays ?? 30;
  const today = todayISO();
  const horizonDate = addDays(today, horizon);

  const orders = db
    .prepare(
      `SELECT id, date_needed
         FROM orders
        WHERE app_status IN ('new', 'confirmed')
          AND stock_applied = 0
          AND date_needed IS NOT NULL
          AND date_needed >= ?
          AND date_needed <= ?`,
    )
    .all(today, horizonDate) as Array<{ id: number; date_needed: string }>;

  // Per-item demand bucketed by date.
  // Map<item_id, Map<date, qty>>
  const demand = new Map<number, Map<string, number>>();

  // Also remember item names so we can hydrate ProjectionRow without a second pass.
  const itemMeta = new Map<number, { sku: string; name: string; unit: string }>();

  for (const o of orders) {
    const { lines } = previewOrderRecipes(o.id);
    for (const line of lines) {
      let byDate = demand.get(line.inventory_item_id);
      if (!byDate) {
        byDate = new Map();
        demand.set(line.inventory_item_id, byDate);
      }
      byDate.set(o.date_needed, (byDate.get(o.date_needed) ?? 0) + line.quantity);
      if (!itemMeta.has(line.inventory_item_id)) {
        itemMeta.set(line.inventory_item_id, {
          sku: line.inventory_sku,
          name: line.inventory_name,
          unit: line.inventory_unit,
        });
      }
    }
  }

  // For each item with demand, find its current on_hand and compute the
  // running balance day-by-day.
  const itemIds = [...demand.keys()];
  if (itemIds.length === 0) return [];

  const placeholders = itemIds.map(() => '?').join(',');
  const items = db
    .prepare(
      `SELECT id, sku, name, unit, on_hand
         FROM inventory_items
        WHERE id IN (${placeholders})`,
    )
    .all(...itemIds) as Array<{
    id: number;
    sku: string;
    name: string;
    unit: string;
    on_hand: number;
  }>;
  const itemsById = new Map(items.map((i) => [i.id, i]));

  const out: ProjectionRow[] = [];
  for (const itemId of itemIds) {
    const item = itemsById.get(itemId);
    if (!item) continue;
    const byDate = demand.get(itemId)!;
    const sortedDates = [...byDate.keys()].sort();
    let running = item.on_hand;
    let lowest = item.on_hand;
    let lowestDate: string | null = null;
    let reservedTotal = 0;
    const by_date: ProjectionByDate[] = [];
    for (const date of sortedDates) {
      const qty = Math.round(byDate.get(date)!);
      reservedTotal += qty;
      running -= qty;
      by_date.push({ date, qty });
      if (running < lowest) {
        lowest = running;
        lowestDate = date;
      }
    }
    out.push({
      inventory_item_id: itemId,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      on_hand: item.on_hand,
      reserved_total: reservedTotal,
      by_date,
      lowest_projected: lowest,
      lowest_date: lowestDate,
      short_by: lowest < 0 ? -lowest : 0,
    });
  }

  // Worst-shortfall first.
  return out.sort((a, b) => a.lowest_projected - b.lowest_projected);
}
