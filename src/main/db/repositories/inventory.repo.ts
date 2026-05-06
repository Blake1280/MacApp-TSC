import type { Database } from 'better-sqlite3';
import type { InventoryItem } from '@shared/types';
import type {
  InventoryItemCreate,
  InventoryItemUpdate,
  InventoryListQuery,
} from '@shared/schema';

export class InventoryRepo {
  constructor(private db: Database) {}

  list(query: InventoryListQuery): InventoryItem[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (!query.includeArchived) where.push('archived = 0');
    if (query.search) {
      where.push('(sku LIKE :search OR name LIKE :search)');
      params.search = `%${query.search}%`;
    }
    if (query.category) {
      where.push('category = :category');
      params.category = query.category;
    }
    if (query.lowStockOnly) {
      where.push('on_hand <= reorder_at');
    }

    const sql = `
      SELECT * FROM inventory_items
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY name COLLATE NOCASE
    `;
    return this.db.prepare(sql).all(params) as InventoryItem[];
  }

  byId(id: number): InventoryItem | null {
    const row = this.db
      .prepare('SELECT * FROM inventory_items WHERE id = ?')
      .get(id) as InventoryItem | undefined;
    return row ?? null;
  }

  bySku(sku: string): InventoryItem | null {
    const row = this.db
      .prepare('SELECT * FROM inventory_items WHERE sku = ?')
      .get(sku) as InventoryItem | undefined;
    return row ?? null;
  }

  create(input: InventoryItemCreate): InventoryItem {
    const tx = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO inventory_items (sku, name, category, unit, on_hand, reorder_at, cost_cents, notes, photo_url)
           VALUES (@sku, @name, @category, @unit, @on_hand, @reorder_at, @cost_cents, @notes, @photo_url)`,
        )
        .run({
          sku: input.sku,
          name: input.name,
          category: input.category ?? null,
          unit: input.unit ?? 'each',
          on_hand: input.on_hand ?? 0,
          reorder_at: input.reorder_at ?? 0,
          cost_cents: input.cost_cents ?? null,
          notes: input.notes ?? null,
          photo_url: input.photo_url ?? null,
        });

      const id = Number(result.lastInsertRowid);

      if ((input.on_hand ?? 0) > 0) {
        this.db
          .prepare(
            `INSERT INTO stock_movements (inventory_item_id, delta, reason, note)
             VALUES (?, ?, 'opening_balance', 'Initial count when item created')`,
          )
          .run(id, input.on_hand ?? 0);
      }

      return this.byId(id)!;
    });
    return tx();
  }

  update(input: InventoryItemUpdate): InventoryItem {
    const fields: string[] = [];
    const params: Record<string, unknown> = { id: input.id };

    for (const key of [
      'sku',
      'name',
      'category',
      'unit',
      'reorder_at',
      'cost_cents',
      'notes',
      'photo_url',
      'archived',
      'stock_tracked',
    ] as const) {
      if (input[key] !== undefined) {
        fields.push(`${key} = :${key}`);
        params[key] = input[key];
      }
    }

    if (fields.length === 0) return this.byId(input.id)!;

    fields.push("updated_at = datetime('now')");
    this.db
      .prepare(`UPDATE inventory_items SET ${fields.join(', ')} WHERE id = :id`)
      .run(params);
    return this.byId(input.id)!;
  }

  /**
   * Adjust on_hand by delta and write a stock_movements row, atomically.
   * Returns the updated item.
   */
  adjust(args: {
    inventory_item_id: number;
    delta: number;
    reason: import('@shared/types').StockMovementReason;
    order_id?: number | null;
    catalogue_id?: number | null;
    note?: string | null;
  }): InventoryItem {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE inventory_items
           SET on_hand = on_hand + ?, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(args.delta, args.inventory_item_id);

      this.db
        .prepare(
          `INSERT INTO stock_movements
             (inventory_item_id, delta, reason, order_id, catalogue_id, note)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          args.inventory_item_id,
          args.delta,
          args.reason,
          args.order_id ?? null,
          args.catalogue_id ?? null,
          args.note ?? null,
        );

      return this.byId(args.inventory_item_id)!;
    });
    return tx();
  }

  categories(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT category FROM inventory_items
         WHERE category IS NOT NULL AND category != ''
         ORDER BY category COLLATE NOCASE`,
      )
      .all() as Array<{ category: string }>;
    return rows.map((r) => r.category);
  }
}
