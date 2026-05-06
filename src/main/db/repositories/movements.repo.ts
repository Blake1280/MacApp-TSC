import type { Database } from 'better-sqlite3';
import type { StockMovement } from '@shared/types';

export type MovementListQuery = {
  inventory_item_id?: number;
  order_id?: number;
  limit?: number;
};

export class MovementsRepo {
  constructor(private db: Database) {}

  list(query: MovementListQuery = {}): StockMovement[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.inventory_item_id) {
      where.push('inventory_item_id = :inventory_item_id');
      params.inventory_item_id = query.inventory_item_id;
    }
    if (query.order_id) {
      where.push('order_id = :order_id');
      params.order_id = query.order_id;
    }

    const limit = query.limit ?? 200;
    const sql = `
      SELECT * FROM stock_movements
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `;
    return this.db.prepare(sql).all(params) as StockMovement[];
  }
}
