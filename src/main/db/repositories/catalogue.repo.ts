import type { Database } from 'better-sqlite3';
import type {
  CatalogueEntry,
  CatalogueEntryWithCounts,
  CatalogueKind,
  RecipeComponentWithItem,
} from '@shared/types';

export class CatalogueRepo {
  constructor(private db: Database) {}

  list(opts: { kind?: CatalogueKind; includeArchived?: boolean } = {}): CatalogueEntryWithCounts[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (opts.kind) {
      conditions.push('c.kind = :kind');
      params.kind = opts.kind;
    }
    if (!opts.includeArchived) conditions.push('c.archived = 0');

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT c.*,
             (SELECT COUNT(*) FROM recipe_components r WHERE r.catalogue_id = c.id)
               AS recipe_component_count
      FROM catalogue_entries c
      ${whereClause}
      ORDER BY c.kind, c.archived, c.name COLLATE NOCASE
    `;
    return this.db.prepare(sql).all(params) as CatalogueEntryWithCounts[];
  }

  byId(id: number): CatalogueEntry | null {
    const row = this.db
      .prepare('SELECT * FROM catalogue_entries WHERE id = ?')
      .get(id) as CatalogueEntry | undefined;
    return row ?? null;
  }

  byKindAndExternalId(kind: CatalogueKind, externalId: string): CatalogueEntry | null {
    const row = this.db
      .prepare('SELECT * FROM catalogue_entries WHERE kind = ? AND external_id = ?')
      .get(kind, externalId) as CatalogueEntry | undefined;
    return row ?? null;
  }

  upsert(input: {
    kind: CatalogueKind;
    external_id: string;
    name: string;
    price_cents: number | null;
    default_finish_id: string | null;
    default_palette_id: string | null;
    // Optional — only the website importer passes this. Manual creates
    // (CreateDialog in the renderer) leave it null and the user can
    // categorise later via the edit dialog if we surface it there.
    category?: string | null;
  }): { entry: CatalogueEntry; created: boolean } {
    const existing = this.byKindAndExternalId(input.kind, input.external_id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE catalogue_entries
             SET name = @name, price_cents = @price_cents,
                 default_finish_id = @default_finish_id,
                 default_palette_id = @default_palette_id,
                 category = COALESCE(@category, category),
                 updated_at = datetime('now')
           WHERE id = @id`,
        )
        .run({ ...input, category: input.category ?? null, id: existing.id });
      return { entry: this.byId(existing.id)!, created: false };
    }

    const result = this.db
      .prepare(
        `INSERT INTO catalogue_entries
           (kind, external_id, name, price_cents, default_finish_id, default_palette_id, category)
         VALUES (@kind, @external_id, @name, @price_cents, @default_finish_id, @default_palette_id, @category)`,
      )
      .run({ ...input, category: input.category ?? null });
    return { entry: this.byId(Number(result.lastInsertRowid))!, created: true };
  }

  create(input: {
    kind: CatalogueKind;
    external_id: string;
    name: string;
    price_cents: number | null;
    default_finish_id: string | null;
    default_palette_id: string | null;
    category?: string | null;
  }): CatalogueEntry {
    const result = this.db
      .prepare(
        `INSERT INTO catalogue_entries
           (kind, external_id, name, price_cents, default_finish_id, default_palette_id, category)
         VALUES (@kind, @external_id, @name, @price_cents, @default_finish_id, @default_palette_id, @category)`,
      )
      .run({ ...input, category: input.category ?? null });
    return this.byId(Number(result.lastInsertRowid))!;
  }

  update(input: {
    id: number;
    external_id?: string;
    name?: string;
    price_cents?: number | null;
    default_finish_id?: string | null;
    default_palette_id?: string | null;
    category?: string | null;
  }): CatalogueEntry {
    const fields: string[] = [];
    const params: Record<string, unknown> = { id: input.id };
    for (const key of [
      'external_id',
      'name',
      'price_cents',
      'default_finish_id',
      'default_palette_id',
      'category',
    ] as const) {
      if (input[key] !== undefined) {
        fields.push(`${key} = :${key}`);
        params[key] = input[key];
      }
    }
    if (fields.length === 0) return this.byId(input.id)!;
    fields.push("updated_at = datetime('now')");
    this.db
      .prepare(`UPDATE catalogue_entries SET ${fields.join(', ')} WHERE id = :id`)
      .run(params);
    return this.byId(input.id)!;
  }

  setArchived(id: number, archived: boolean): CatalogueEntry {
    this.db
      .prepare(
        "UPDATE catalogue_entries SET archived = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(archived ? 1 : 0, id);
    return this.byId(id)!;
  }

  recipeComponents(catalogueId: number): RecipeComponentWithItem[] {
    const sql = `
      SELECT r.id, r.catalogue_id, r.inventory_item_id, r.quantity,
             i.sku  AS inventory_sku,
             i.name AS inventory_name,
             i.unit AS inventory_unit
      FROM recipe_components r
      JOIN inventory_items i ON i.id = r.inventory_item_id
      WHERE r.catalogue_id = ?
      ORDER BY i.name COLLATE NOCASE
    `;
    return this.db.prepare(sql).all(catalogueId) as RecipeComponentWithItem[];
  }

  upsertRecipeComponent(input: {
    catalogue_id: number;
    inventory_item_id: number;
    quantity: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO recipe_components (catalogue_id, inventory_item_id, quantity)
         VALUES (@catalogue_id, @inventory_item_id, @quantity)
         ON CONFLICT(catalogue_id, inventory_item_id)
         DO UPDATE SET quantity = excluded.quantity`,
      )
      .run(input);
  }

  deleteRecipeComponent(id: number): void {
    this.db.prepare('DELETE FROM recipe_components WHERE id = ?').run(id);
  }
}
