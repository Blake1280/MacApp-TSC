import type { Database } from 'better-sqlite3';
import type { SupplierSource } from '@shared/types';

/**
 * CRUD for `inventory_supplier_sources`. Per-item supplier list with
 * optional last-paid prices. The Stock-page Reorder dropdown reads these
 * via `forItem(itemId)`, sorted cheapest-known-first; everything with no
 * price falls through to the bottom (still alphabetised by supplier).
 */
export class SuppliersRepo {
  constructor(private db: Database) {}

  forItem(itemId: number): SupplierSource[] {
    return this.db
      .prepare(
        `SELECT * FROM inventory_supplier_sources
         WHERE inventory_item_id = ?
         ORDER BY
           is_preferred DESC,
           CASE WHEN unit_price_cents IS NULL THEN 1 ELSE 0 END,
           unit_price_cents ASC,
           supplier_name COLLATE NOCASE`,
      )
      .all(itemId) as SupplierSource[];
  }

  /** Bulk-fetch sources for many items at once (used by the Stock list). */
  forItems(itemIds: number[]): Map<number, SupplierSource[]> {
    const out = new Map<number, SupplierSource[]>();
    if (itemIds.length === 0) return out;
    const placeholders = itemIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT * FROM inventory_supplier_sources
         WHERE inventory_item_id IN (${placeholders})
         ORDER BY
           inventory_item_id,
           is_preferred DESC,
           CASE WHEN unit_price_cents IS NULL THEN 1 ELSE 0 END,
           unit_price_cents ASC,
           supplier_name COLLATE NOCASE`,
      )
      .all(...itemIds) as SupplierSource[];
    for (const r of rows) {
      if (!out.has(r.inventory_item_id)) out.set(r.inventory_item_id, []);
      out.get(r.inventory_item_id)!.push(r);
    }
    return out;
  }

  byId(id: number): SupplierSource | null {
    const row = this.db
      .prepare('SELECT * FROM inventory_supplier_sources WHERE id = ?')
      .get(id) as SupplierSource | undefined;
    return row ?? null;
  }

  create(input: {
    inventory_item_id: number;
    supplier_name: string;
    url: string | null;
    unit_price_cents?: number | null;
    is_preferred?: boolean;
    notes?: string | null;
    photo_url?: string | null;
  }): SupplierSource {
    const tx = this.db.transaction(() => {
      // If creating a preferred source, demote any existing preferred for
      // this item — there's only ever one preferred per item.
      if (input.is_preferred) {
        this.db
          .prepare(
            'UPDATE inventory_supplier_sources SET is_preferred = 0 WHERE inventory_item_id = ?',
          )
          .run(input.inventory_item_id);
      }
      const result = this.db
        .prepare(
          `INSERT INTO inventory_supplier_sources
             (inventory_item_id, supplier_name, url, unit_price_cents, is_preferred, notes, photo_url)
           VALUES (@inventory_item_id, @supplier_name, @url, @unit_price_cents, @is_preferred, @notes, @photo_url)`,
        )
        .run({
          inventory_item_id: input.inventory_item_id,
          supplier_name: input.supplier_name.trim(),
          url: input.url ? input.url.trim() : null,
          unit_price_cents: input.unit_price_cents ?? null,
          is_preferred: input.is_preferred ? 1 : 0,
          notes: input.notes ?? null,
          photo_url: input.photo_url ?? null,
        });
      return this.byId(Number(result.lastInsertRowid))!;
    });
    return tx();
  }

  update(input: {
    id: number;
    supplier_name?: string;
    url?: string | null;
    unit_price_cents?: number | null;
    is_preferred?: boolean;
    notes?: string | null;
    photo_url?: string | null;
  }): SupplierSource {
    const existing = this.byId(input.id);
    if (!existing) throw new Error(`Supplier source ${input.id} not found`);

    const tx = this.db.transaction(() => {
      // Same single-preferred rule as create.
      if (input.is_preferred === true) {
        this.db
          .prepare(
            `UPDATE inventory_supplier_sources
             SET is_preferred = 0
             WHERE inventory_item_id = ? AND id != ?`,
          )
          .run(existing.inventory_item_id, input.id);
      }

      const fields: string[] = [];
      const params: Record<string, unknown> = { id: input.id };
      if (input.supplier_name !== undefined) {
        fields.push('supplier_name = :supplier_name');
        params.supplier_name = input.supplier_name.trim();
      }
      if (input.url !== undefined) {
        fields.push('url = :url');
        // Treat empty string as NULL — saves a roundtrip from the form layer.
        params.url = input.url ? input.url.trim() || null : null;
      }
      if (input.unit_price_cents !== undefined) {
        fields.push('unit_price_cents = :unit_price_cents');
        params.unit_price_cents = input.unit_price_cents;
      }
      if (input.is_preferred !== undefined) {
        fields.push('is_preferred = :is_preferred');
        params.is_preferred = input.is_preferred ? 1 : 0;
      }
      if (input.notes !== undefined) {
        fields.push('notes = :notes');
        params.notes = input.notes;
      }
      if (input.photo_url !== undefined) {
        fields.push('photo_url = :photo_url');
        params.photo_url = input.photo_url;
      }
      if (fields.length === 0) return this.byId(input.id)!;
      fields.push("updated_at = datetime('now')");
      this.db
        .prepare(`UPDATE inventory_supplier_sources SET ${fields.join(', ')} WHERE id = :id`)
        .run(params);
      return this.byId(input.id)!;
    });
    return tx();
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM inventory_supplier_sources WHERE id = ?').run(id);
  }
}
