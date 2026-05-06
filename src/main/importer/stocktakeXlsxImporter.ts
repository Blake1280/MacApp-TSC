import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as XLSX from 'xlsx';

// xlsx ships without auto-fs binding. Wire Node's readFileSync once so the
// library can read .xlsx files from disk.
XLSX.set_fs({ readFileSync } as unknown as Parameters<typeof XLSX.set_fs>[0]);
import { app } from 'electron';
import { logger } from '@main/logging/logger';
import { getDb } from '@main/db/connection';

/**
 * Best-effort current app version. Reads from Electron's app metadata when
 * available (production), falls back to a generic test marker otherwise so
 * the unit tests don't need to mock app.getVersion.
 */
function appVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return 'test';
  }
}
import { CatalogueRepo } from '@main/db/repositories/catalogue.repo';
import { InventoryRepo } from '@main/db/repositories/inventory.repo';
import type {
  StocktakePreview,
  StocktakePreviewRow,
  StocktakeInventoryRow,
  StocktakeCatalogueRow,
  StocktakeRecipeRow,
  StocktakeApplyResult,
  StocktakeFreshness,
} from '@shared/types';

/**
 * Stocktake XLSX importer.
 *
 * Accepts the workbook produced by `sweet-creative-stocktake.xlsx` (or any
 * file with the same three sheet names + column headers). Two-step flow that
 * mirrors tscDataImporter:
 *
 *   1. buildPreview(path)  — parses the file, classifies each row as new /
 *      update / unchanged / error, and reports warnings without touching the
 *      database. Used by the renderer to show a summary before applying.
 *
 *   2. applyImport(path, opts) — re-parses the file and writes everything
 *      inside a single transaction. Existing rows are matched by sku /
 *      (kind, external_id) and updated in place — never duplicated.
 *
 * Sheet contract (1-indexed in this comment, 0-indexed in code):
 *   Inventory_Items: sku, name, category, unit, on_hand, reorder_at,
 *                    cost_cents, notes
 *   Catalogue_Entries: kind, external_id, name, price_cents,
 *                      default_finish_id, default_palette_id, notes
 *   Recipes: catalogue_kind, catalogue_external_id, inventory_sku,
 *            quantity, notes
 *
 * Header rows live on row 1 OR row 2 (the template has a help note above
 * the headers — both shapes are accepted).
 */

const ID_REGEX = /^[a-z0-9-]+$/;

type SheetRow = Record<string, unknown>;

function loadWorkbook(path: string): { wb: XLSX.WorkBook; sourceLabel: string } {
  if (!existsSync(path)) throw new Error(`Path does not exist: ${path}`);
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`Not a file: ${path}`);
  const wb = XLSX.read(readFileSync(path), {
    type: 'buffer',
    cellDates: false,
    cellNF: false,
    cellText: false,
  });
  return { wb, sourceLabel: basename(path) };
}

/**
 * Read a sheet to JSON rows. Tolerates a "header note" merged-cell row above
 * the actual header row by trying both starting offsets.
 */
function readSheetRows(wb: XLSX.WorkBook, sheetName: string, requiredColumns: string[]): SheetRow[] {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Required sheet "${sheetName}" not found in workbook`);

  for (const range of [undefined, 1]) {
    const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, {
      defval: null,
      range,
      raw: true,
    });
    if (rows.length === 0) continue;
    const first = rows[0];
    const has = requiredColumns.every((c) => c in first);
    if (has) return rows;
  }
  throw new Error(
    `Sheet "${sheetName}" missing required columns: ${requiredColumns.join(', ')}`,
  );
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function asNullableString(v: unknown): string | null {
  const s = asString(v);
  return s.length === 0 ? null : s;
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function asInt(v: unknown): number | null {
  const n = asNumber(v);
  if (n === null) return null;
  return Math.round(n);
}

function validateInventoryRow(row: SheetRow, line: number): {
  ok: true; data: StocktakeInventoryRow;
} | { ok: false; reason: string; data: Partial<StocktakeInventoryRow>; } {
  const sku = asString(row.sku).toLowerCase();
  const name = asString(row.name);
  if (!sku) return { ok: false, reason: `row ${line}: missing sku`, data: { sku: '', name } };
  if (!ID_REGEX.test(sku))
    return { ok: false, reason: `row ${line}: sku "${sku}" must be lowercase letters, digits and hyphens only`, data: { sku, name } };
  if (!name) return { ok: false, reason: `row ${line}: missing name`, data: { sku, name: '' } };
  const on_hand = asInt(row.on_hand);
  if (on_hand !== null && on_hand < 0)
    return { ok: false, reason: `row ${line}: on_hand cannot be negative`, data: { sku, name } };
  return {
    ok: true,
    data: {
      sku,
      name,
      category: asNullableString(row.category),
      unit: asString(row.unit) || 'each',
      on_hand,
      reorder_at: asInt(row.reorder_at),
      cost_cents: asInt(row.cost_cents),
      notes: asNullableString(row.notes),
    },
  };
}

const CATALOGUE_KINDS = ['design', 'finish', 'palette', 'addon'] as const;
type CatalogueKind = typeof CATALOGUE_KINDS[number];

function validateCatalogueRow(row: SheetRow, line: number): {
  ok: true; data: StocktakeCatalogueRow;
} | { ok: false; reason: string; data: Partial<StocktakeCatalogueRow>; } {
  const kind = asString(row.kind).toLowerCase() as CatalogueKind;
  const external_id = asString(row.external_id).toLowerCase();
  const name = asString(row.name);
  if (!CATALOGUE_KINDS.includes(kind))
    return { ok: false, reason: `row ${line}: invalid kind "${row.kind}"`, data: { kind: kind, external_id, name } };
  if (!external_id) return { ok: false, reason: `row ${line}: missing external_id`, data: { kind, external_id, name } };
  if (!ID_REGEX.test(external_id))
    return { ok: false, reason: `row ${line}: external_id "${external_id}" must be lowercase letters, digits and hyphens only`, data: { kind, external_id, name } };
  if (!name) return { ok: false, reason: `row ${line}: missing name`, data: { kind, external_id, name } };
  return {
    ok: true,
    data: {
      kind,
      external_id,
      name,
      price_cents: asInt(row.price_cents),
      default_finish_id: asNullableString(row.default_finish_id),
      default_palette_id: asNullableString(row.default_palette_id),
    },
  };
}

function validateRecipeRow(row: SheetRow, line: number): {
  ok: true; data: StocktakeRecipeRow;
} | { ok: false; reason: string; data: Partial<StocktakeRecipeRow>; } {
  const catalogue_kind = asString(row.catalogue_kind).toLowerCase() as CatalogueKind;
  const catalogue_external_id = asString(row.catalogue_external_id).toLowerCase();
  const inventory_sku = asString(row.inventory_sku).toLowerCase();
  const quantity = asNumber(row.quantity);
  if (!CATALOGUE_KINDS.includes(catalogue_kind))
    return { ok: false, reason: `row ${line}: invalid catalogue_kind "${row.catalogue_kind}"`, data: { catalogue_kind, catalogue_external_id, inventory_sku, quantity: quantity ?? 0 } };
  if (!catalogue_external_id)
    return { ok: false, reason: `row ${line}: missing catalogue_external_id`, data: { catalogue_kind, catalogue_external_id, inventory_sku, quantity: quantity ?? 0 } };
  if (!inventory_sku)
    return { ok: false, reason: `row ${line}: missing inventory_sku`, data: { catalogue_kind, catalogue_external_id, inventory_sku, quantity: quantity ?? 0 } };
  if (quantity === null || quantity <= 0)
    return { ok: false, reason: `row ${line}: quantity must be > 0`, data: { catalogue_kind, catalogue_external_id, inventory_sku, quantity: quantity ?? 0 } };
  return { ok: true, data: { catalogue_kind, catalogue_external_id, inventory_sku, quantity } };
}

/** Detect which format the workbook is in. */
function detectFormat(wb: XLSX.WorkBook): 'simple' | 'multi' | 'categorized' {
  // Multi-sheet setup format takes priority — has its own dedicated sheet names.
  if (wb.Sheets['Inventory_Items']) return 'multi';
  // Backwards-compat: single "Stocktake" sheet with a category column on each row.
  if (wb.Sheets['Stocktake']) return 'simple';
  // Categorized: any sheet that has sku+name headers (sheet name = category).
  // README and other documentation sheets are ignored — they don't have those headers.
  for (const name of wb.SheetNames) {
    if (sheetLooksLikeStock(wb.Sheets[name])) return 'categorized';
  }
  throw new Error(
    'Workbook has no recognized sheet. Expected either a "Stocktake" sheet, ' +
      '"Inventory_Items" + "Catalogue_Entries" + "Recipes" sheets, ' +
      'or one or more category sheets each with sku + name columns.',
  );
}

/**
 * True if this sheet has the sku + name headers (allowing for a header-note
 * row above). Used to distinguish data tabs from README/doc tabs in the
 * categorized format.
 */
function sheetLooksLikeStock(sheet: XLSX.WorkSheet): boolean {
  for (const range of [undefined, 1]) {
    const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: null, range, raw: true });
    if (rows.length === 0) continue;
    if ('sku' in rows[0] && 'name' in rows[0]) return true;
  }
  return false;
}

/** Same as readSheetRows but also reports the offset used (for line numbers). */
function readSheetRowsWithOffset(sheet: XLSX.WorkSheet): { rows: SheetRow[]; offset: number } {
  for (const range of [undefined, 1]) {
    const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: null, range, raw: true });
    if (rows.length === 0) continue;
    if ('sku' in rows[0] && 'name' in rows[0]) return { rows, offset: range ?? 0 };
  }
  return { rows: [], offset: 0 };
}

export function buildStocktakePreview(path: string): StocktakePreview {
  const { wb, sourceLabel } = loadWorkbook(path);
  const warnings: string[] = [];
  const format = detectFormat(wb);
  const freshness = checkFreshness(wb);

  // Simple format: one "Stocktake" sheet, just inventory updates.
  // Catalogue + recipes left untouched (managed via the website import).
  if (format === 'simple') {
    const rows = readSheetRows(wb, 'Stocktake', ['sku', 'name']);
    const db = getDb();
    const inventory = new InventoryRepo(db);
    const seenSkus = new Set<string>();
    const inventory_preview: StocktakePreviewRow<StocktakeInventoryRow>[] = rows.map((row, i) => {
      const v = validateInventoryRow(row, i + 2);
      if (!v.ok) {
        return {
          status: 'error',
          reason: v.reason,
          data: {
            sku: v.data.sku ?? '',
            name: v.data.name ?? '',
            category: null,
            unit: 'each',
            on_hand: null,
            reorder_at: null,
            cost_cents: null,
            notes: null,
          },
        };
      }
      if (seenSkus.has(v.data.sku))
        return { status: 'error', reason: `duplicate sku "${v.data.sku}" in sheet`, data: v.data };
      seenSkus.add(v.data.sku);
      const existing = inventory.bySku(v.data.sku);
      if (!existing) return { status: 'new', data: v.data };
      const changed =
        (v.data.on_hand !== null && existing.on_hand !== v.data.on_hand) ||
        (v.data.reorder_at !== null && existing.reorder_at !== v.data.reorder_at) ||
        existing.name !== v.data.name ||
        (existing.category ?? null) !== v.data.category ||
        (existing.notes ?? null) !== v.data.notes;
      return { status: changed ? 'update' : 'unchanged', data: v.data };
    });
    if (rows.length === 0) warnings.push('Stocktake sheet is empty');
    return {
      source_path: sourceLabel,
      inventory: inventory_preview,
      catalogue: [],
      recipes: [],
      warnings,
      freshness,
    };
  }

  // Categorized format: one sheet per category. Sheet name = category.
  // Iterate every sheet that has sku+name headers; ignore README/doc sheets.
  if (format === 'categorized') {
    const db = getDb();
    const inventory = new InventoryRepo(db);
    const seenSkus = new Set<string>();
    const inventory_preview: StocktakePreviewRow<StocktakeInventoryRow>[] = [];

    let totalRows = 0;
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheetLooksLikeStock(sheet)) continue;
      const { rows, offset } = readSheetRowsWithOffset(sheet);
      totalRows += rows.length;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // Override category from sheet name (the row may not have a category column at all)
        row.category = sheetName;
        const v = validateInventoryRow(row, i + 2 + offset); // +1 header, +offset note row, +1 to make 1-indexed
        if (!v.ok) {
          inventory_preview.push({
            status: 'error',
            reason: `[${sheetName}] ${v.reason}`,
            data: {
              sku: v.data.sku ?? '',
              name: v.data.name ?? '',
              category: sheetName,
              unit: 'each',
              on_hand: null,
              reorder_at: null,
              cost_cents: null,
              notes: null,
            },
          });
          continue;
        }
        if (seenSkus.has(v.data.sku)) {
          inventory_preview.push({
            status: 'error',
            reason: `[${sheetName}] duplicate sku "${v.data.sku}" in workbook`,
            data: v.data,
          });
          continue;
        }
        seenSkus.add(v.data.sku);
        const existing = inventory.bySku(v.data.sku);
        if (!existing) {
          inventory_preview.push({ status: 'new', data: v.data });
          continue;
        }
        const changed =
          (v.data.on_hand !== null && existing.on_hand !== v.data.on_hand) ||
          (v.data.reorder_at !== null && existing.reorder_at !== v.data.reorder_at) ||
          existing.name !== v.data.name ||
          (existing.category ?? null) !== sheetName ||
          (existing.notes ?? null) !== v.data.notes;
        inventory_preview.push({ status: changed ? 'update' : 'unchanged', data: v.data });
      }
    }

    if (totalRows === 0) warnings.push('No category sheets contained any rows');
    return {
      source_path: sourceLabel,
      inventory: inventory_preview,
      catalogue: [],
      recipes: [],
      warnings,
      freshness,
    };
  }

  const invRows = readSheetRows(wb, 'Inventory_Items', ['sku', 'name']);
  const catRows = readSheetRows(wb, 'Catalogue_Entries', ['kind', 'external_id', 'name']);
  const recRows = readSheetRows(wb, 'Recipes', ['catalogue_kind', 'catalogue_external_id', 'inventory_sku', 'quantity']);

  const db = getDb();
  const catalogue = new CatalogueRepo(db);
  const inventory = new InventoryRepo(db);

  // ----- Inventory preview -----
  const seenSkus = new Set<string>();
  const inventory_preview: StocktakePreviewRow<StocktakeInventoryRow>[] = invRows.map((row, i) => {
    const v = validateInventoryRow(row, i + 2);
    if (!v.ok) return { status: 'error', reason: v.reason, data: { sku: v.data.sku ?? '', name: v.data.name ?? '', category: null, unit: 'each', on_hand: null, reorder_at: null, cost_cents: null, notes: null } };
    if (seenSkus.has(v.data.sku)) return { status: 'error', reason: `duplicate sku "${v.data.sku}" in sheet`, data: v.data };
    seenSkus.add(v.data.sku);
    const existing = inventory.bySku(v.data.sku);
    if (!existing) return { status: 'new', data: v.data };
    // Determine if there's anything to update
    const changed =
      (v.data.on_hand !== null && existing.on_hand !== v.data.on_hand) ||
      (v.data.cost_cents !== null && existing.cost_cents !== v.data.cost_cents) ||
      (v.data.reorder_at !== null && existing.reorder_at !== v.data.reorder_at) ||
      existing.name !== v.data.name ||
      (existing.category ?? null) !== v.data.category ||
      (existing.notes ?? null) !== v.data.notes;
    return { status: changed ? 'update' : 'unchanged', data: v.data };
  });

  // ----- Catalogue preview -----
  const seenCat = new Set<string>();
  const catalogue_preview: StocktakePreviewRow<StocktakeCatalogueRow>[] = catRows.map((row, i) => {
    const v = validateCatalogueRow(row, i + 2);
    if (!v.ok) return { status: 'error', reason: v.reason, data: { kind: 'addon', external_id: v.data.external_id ?? '', name: v.data.name ?? '', price_cents: null, default_finish_id: null, default_palette_id: null } };
    const key = `${v.data.kind}:${v.data.external_id}`;
    if (seenCat.has(key)) return { status: 'error', reason: `duplicate ${v.data.kind} "${v.data.external_id}" in sheet`, data: v.data };
    seenCat.add(key);
    const existing = catalogue.byKindAndExternalId(v.data.kind, v.data.external_id);
    if (!existing) return { status: 'new', data: v.data };
    const changed =
      existing.name !== v.data.name ||
      (existing.price_cents ?? null) !== v.data.price_cents ||
      (existing.default_finish_id ?? null) !== v.data.default_finish_id ||
      (existing.default_palette_id ?? null) !== v.data.default_palette_id;
    return { status: changed ? 'update' : 'unchanged', data: v.data };
  });

  // ----- Recipes preview (cross-references inventory + catalogue) -----
  // Build lookup sets from the catalogue/inventory PREVIEW so recipes can
  // reference rows that are about to be created in the same import.
  const catalogueIds = new Set<string>();
  for (const r of catalogue_preview) {
    if (r.status !== 'error') catalogueIds.add(`${r.data.kind}:${r.data.external_id}`);
  }
  // Plus existing catalogue entries
  for (const kind of CATALOGUE_KINDS) {
    for (const e of catalogue.list({ kind, includeArchived: true })) {
      catalogueIds.add(`${kind}:${e.external_id}`);
    }
  }
  const inventorySkusSet = new Set<string>();
  for (const r of inventory_preview) {
    if (r.status !== 'error') inventorySkusSet.add(r.data.sku);
  }
  for (const item of inventory.list({ includeArchived: true, lowStockOnly: false })) {
    inventorySkusSet.add(item.sku);
  }

  const recipes_preview: StocktakePreviewRow<StocktakeRecipeRow>[] = recRows.map((row, i) => {
    const v = validateRecipeRow(row, i + 2);
    if (!v.ok)
      return {
        status: 'error',
        reason: v.reason,
        data: {
          catalogue_kind: 'addon',
          catalogue_external_id: v.data.catalogue_external_id ?? '',
          inventory_sku: v.data.inventory_sku ?? '',
          quantity: v.data.quantity ?? 0,
        },
      };
    const catKey = `${v.data.catalogue_kind}:${v.data.catalogue_external_id}`;
    if (!catalogueIds.has(catKey)) {
      return { status: 'error', reason: `row ${i + 2}: catalogue ${catKey} not found (not in DB or in this sheet)`, data: v.data };
    }
    if (!inventorySkusSet.has(v.data.inventory_sku)) {
      return { status: 'error', reason: `row ${i + 2}: inventory sku "${v.data.inventory_sku}" not found`, data: v.data };
    }
    return { status: 'new', data: v.data };
  });

  if (invRows.length === 0) warnings.push('Inventory_Items sheet is empty');
  if (catRows.length === 0) warnings.push('Catalogue_Entries sheet is empty');
  if (recRows.length === 0) warnings.push('Recipes sheet is empty');

  return {
    source_path: sourceLabel,
    inventory: inventory_preview,
    catalogue: catalogue_preview,
    recipes: recipes_preview,
    warnings,
    freshness,
  };
}

export function applyStocktakeImport(
  path: string,
  options: {
    createMissingInventory: boolean;
    upsertCatalogue: boolean;
    upsertRecipes: boolean;
    acknowledgeStale: boolean;
    archiveMissing: boolean;
  },
): StocktakeApplyResult {
  const { wb, sourceLabel } = loadWorkbook(path);
  const format = detectFormat(wb);
  logger.info('Importing stocktake XLSX', { source: sourceLabel, format, options });

  // Refuse to apply a stale or unverifiable workbook unless the caller
  // explicitly acknowledged it. Throws so the renderer surfaces the message
  // — this is a hard guard, not a warning, because applying a month-old
  // sheet would silently overwrite weeks of stock changes.
  const freshness = checkFreshness(wb);
  if (freshness.status !== 'fresh' && !options.acknowledgeStale) {
    if (freshness.status === 'stale') {
      throw new Error(
        `This workbook was exported on ${freshness.generatedAt} but ${freshness.movementsSince} stock movement(s) have been recorded since then. Importing would overwrite those counts. Tick "I know — apply anyway" to proceed.`,
      );
    }
    throw new Error(
      `This workbook has no export timestamp — ${freshness.reason} Tick "I know — apply anyway" to proceed.`,
    );
  }

  const db = getDb();
  const catalogue = new CatalogueRepo(db);
  const inventory = new InventoryRepo(db);

  const result: StocktakeApplyResult = {
    inventory: { created: 0, updated: 0, stockAdjusted: 0, archived: 0 },
    catalogue: { created: 0, updated: 0 },
    recipes: { upserted: 0, skipped: 0 },
    warnings: [],
  };

  // Track every SKU that appears in the workbook. After we apply, anything
  // active in the DB whose SKU isn't here can be archived (when the caller
  // opts in via `archiveMissing`).
  const sheetSkus = new Set<string>();

  // After a successful import, archive any active item whose SKU wasn't in
  // the workbook. Runs in its own transaction so a partial archive failure
  // doesn't roll back the upserts above. Soft-archive only — stock_movements
  // stay so on_hand history is preserved if Jade ever restores the item.
  function applyArchiveMissing(): void {
    if (!options.archiveMissing) return;
    const allActive = inventory.list({ includeArchived: false, lowStockOnly: false });
    const missing = allActive.filter((i) => !sheetSkus.has(i.sku));
    if (missing.length === 0) return;
    const tx = db.transaction(() => {
      for (const item of missing) {
        inventory.update({ id: item.id, archived: 1 });
        result.inventory.archived++;
      }
    });
    tx();
    logger.info('Archived items missing from stocktake', {
      archivedCount: missing.length,
      skus: missing.map((i) => i.sku).slice(0, 20),
    });
  }

  // Simple format: just walk the Stocktake sheet and update inventory.
  if (format === 'simple') {
    const rows = readSheetRows(wb, 'Stocktake', ['sku', 'name']);
    const tx = db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        const v = validateInventoryRow(rows[i], i + 2);
        if (!v.ok) {
          result.warnings.push(`Stocktake: ${v.reason}`);
          continue;
        }
        sheetSkus.add(v.data.sku);
        const existing = inventory.bySku(v.data.sku);
        if (!existing) {
          if (!options.createMissingInventory) continue;
          inventory.create({
            sku: v.data.sku,
            name: v.data.name,
            category: v.data.category,
            unit: v.data.unit,
            on_hand: v.data.on_hand ?? 0,
            reorder_at: v.data.reorder_at ?? 0,
            cost_cents: v.data.cost_cents,
            notes: v.data.notes,
          });
          result.inventory.created++;
        } else {
          inventory.update({
            id: existing.id,
            name: v.data.name,
            category: v.data.category,
            unit: v.data.unit,
            reorder_at: v.data.reorder_at ?? existing.reorder_at,
            cost_cents: v.data.cost_cents,
            notes: v.data.notes,
          });
          result.inventory.updated++;
          if (v.data.on_hand !== null && v.data.on_hand !== existing.on_hand) {
            inventory.adjust({
              inventory_item_id: existing.id,
              delta: v.data.on_hand - existing.on_hand,
              reason: 'correction',
              note: `Stocktake import — count ${existing.on_hand} → ${v.data.on_hand}`,
            });
            result.inventory.stockAdjusted++;
          }
        }
      }
    });
    tx();
    applyArchiveMissing();
    markStocktakeApplied();
    logger.info('Stocktake import complete', result);
    return result;
  }

  // Categorized: walk every sheet that has sku+name; sheet name = category.
  if (format === 'categorized') {
    const tx = db.transaction(() => {
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheetLooksLikeStock(sheet)) continue;
        const { rows, offset } = readSheetRowsWithOffset(sheet);
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          row.category = sheetName;
          const v = validateInventoryRow(row, i + 2 + offset);
          if (!v.ok) {
            result.warnings.push(`[${sheetName}] ${v.reason}`);
            continue;
          }
          sheetSkus.add(v.data.sku);
          const existing = inventory.bySku(v.data.sku);
          if (!existing) {
            if (!options.createMissingInventory) continue;
            inventory.create({
              sku: v.data.sku,
              name: v.data.name,
              category: sheetName,
              unit: v.data.unit,
              on_hand: v.data.on_hand ?? 0,
              reorder_at: v.data.reorder_at ?? 0,
              cost_cents: v.data.cost_cents,
              notes: v.data.notes,
            });
            result.inventory.created++;
          } else {
            inventory.update({
              id: existing.id,
              name: v.data.name,
              category: sheetName,
              unit: v.data.unit,
              reorder_at: v.data.reorder_at ?? existing.reorder_at,
              cost_cents: v.data.cost_cents,
              notes: v.data.notes,
            });
            result.inventory.updated++;
            if (v.data.on_hand !== null && v.data.on_hand !== existing.on_hand) {
              inventory.adjust({
                inventory_item_id: existing.id,
                delta: v.data.on_hand - existing.on_hand,
                reason: 'correction',
                note: `Stocktake import — count ${existing.on_hand} → ${v.data.on_hand}`,
              });
              result.inventory.stockAdjusted++;
            }
          }
        }
      }
    });
    tx();
    applyArchiveMissing();
    markStocktakeApplied();
    logger.info('Stocktake import complete', result);
    return result;
  }

  const invRows = readSheetRows(wb, 'Inventory_Items', ['sku', 'name']);
  const catRows = readSheetRows(wb, 'Catalogue_Entries', ['kind', 'external_id', 'name']);
  const recRows = readSheetRows(wb, 'Recipes', ['catalogue_kind', 'catalogue_external_id', 'inventory_sku', 'quantity']);

  const tx = db.transaction(() => {
    // ---- Inventory ----
    for (let i = 0; i < invRows.length; i++) {
      const v = validateInventoryRow(invRows[i], i + 2);
      if (!v.ok) {
        result.warnings.push(`Inventory: ${v.reason}`);
        continue;
      }
      sheetSkus.add(v.data.sku);
      const existing = inventory.bySku(v.data.sku);
      if (!existing) {
        if (!options.createMissingInventory) continue;
        inventory.create({
          sku: v.data.sku,
          name: v.data.name,
          category: v.data.category,
          unit: v.data.unit,
          on_hand: v.data.on_hand ?? 0,
          reorder_at: v.data.reorder_at ?? 0,
          cost_cents: v.data.cost_cents,
          notes: v.data.notes,
        });
        result.inventory.created++;
      } else {
        // Update fields in place
        inventory.update({
          id: existing.id,
          name: v.data.name,
          category: v.data.category,
          unit: v.data.unit,
          reorder_at: v.data.reorder_at ?? existing.reorder_at,
          cost_cents: v.data.cost_cents,
          notes: v.data.notes,
        });
        result.inventory.updated++;
        // If on_hand differs, write a stock movement (audit-trail-preserving)
        if (v.data.on_hand !== null && v.data.on_hand !== existing.on_hand) {
          const delta = v.data.on_hand - existing.on_hand;
          inventory.adjust({
            inventory_item_id: existing.id,
            delta,
            reason: 'correction',
            note: `Stocktake import — count ${existing.on_hand} → ${v.data.on_hand}`,
          });
          result.inventory.stockAdjusted++;
        }
      }
    }

    // ---- Catalogue ----
    if (options.upsertCatalogue) {
      for (let i = 0; i < catRows.length; i++) {
        const v = validateCatalogueRow(catRows[i], i + 2);
        if (!v.ok) {
          result.warnings.push(`Catalogue: ${v.reason}`);
          continue;
        }
        const { created } = catalogue.upsert({
          kind: v.data.kind,
          external_id: v.data.external_id,
          name: v.data.name,
          price_cents: v.data.price_cents,
          default_finish_id: v.data.default_finish_id,
          default_palette_id: v.data.default_palette_id,
        });
        if (created) result.catalogue.created++;
        else result.catalogue.updated++;
      }
    }

    // ---- Recipes ----
    if (options.upsertRecipes) {
      for (let i = 0; i < recRows.length; i++) {
        const v = validateRecipeRow(recRows[i], i + 2);
        if (!v.ok) {
          result.warnings.push(`Recipes: ${v.reason}`);
          result.recipes.skipped++;
          continue;
        }
        const cat = catalogue.byKindAndExternalId(v.data.catalogue_kind, v.data.catalogue_external_id);
        const inv = inventory.bySku(v.data.inventory_sku);
        if (!cat || !inv) {
          result.warnings.push(
            `Recipes: row ${i + 2} — could not resolve ${v.data.catalogue_kind}:${v.data.catalogue_external_id} → ${v.data.inventory_sku}`,
          );
          result.recipes.skipped++;
          continue;
        }
        catalogue.upsertRecipeComponent({
          catalogue_id: cat.id,
          inventory_item_id: inv.id,
          quantity: v.data.quantity,
        });
        result.recipes.upserted++;
      }
    }
  });
  tx();
  applyArchiveMissing();
  markStocktakeApplied();

  logger.info('Stocktake import complete', result);
  return result;
}

/**
 * Stamp the moment the most recent stocktake was applied. Read by the
 * sidebar to show a "Stocktake N days ago" pill so Jade always sees how
 * fresh her counts are without leaving the dashboard. Stored as ISO 8601
 * in the settings table under `last_stocktake_at`.
 */
function markStocktakeApplied(): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('last_stocktake_at', @now)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run({ now });
}

/**
 * Export the current inventory to an XLSX with one sheet per category.
 * Writes the file at `path` (overwriting if it exists). Use this to refresh
 * Jade's stocktake spreadsheet with the latest counts before she walks the
 * shop.
 *
 * Each sheet:
 *   - Sheet name = category
 *   - Row 1: short help note (ignored on import)
 *   - Row 2: headers — sku, name, on_hand, reorder_at, notes
 *   - Row 3+: data rows
 *
 * Items with no category go into a sheet called "Uncategorised".
 */
// Marker name for the workbook custom property carrying the export timestamp.
// Stored in two places for redundancy: the workbook's CustomProperties (read
// via `wb.Custprops`) AND a visible cell on a "_meta" sheet so anyone opening
// the file can see when it was generated.
const META_SHEET = '_meta';
const META_GENERATED_AT_KEY = 'TSC_Stocktake_GeneratedAt';

export function exportStocktake(path: string): { path: string; count: number; sheets: number; generatedAt: string } {
  const db = getDb();
  const inventory = new InventoryRepo(db);
  const items = inventory.list({ includeArchived: false, lowStockOnly: false });

  // Group by category
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const cat = (item.category && item.category.trim()) || 'Uncategorised';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(item);
  }

  // Sort categories alphabetically, items inside each by name
  const sortedCategories = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const cat of sortedCategories) {
    groups.get(cat)!.sort((a, b) => a.name.localeCompare(b.name));
  }

  const headers = ['sku', 'name', 'on_hand', 'reorder_at', 'notes'] as const;
  const wb = XLSX.utils.book_new();

  // _meta sheet (first tab) — visible record of when this export ran.
  // The importer also reads it on import to enforce the freshness check.
  const generatedAt = new Date().toISOString();
  const metaSheet = XLSX.utils.aoa_to_sheet([
    ['key', 'value'],
    ['generated_at', generatedAt],
    ['app_version', appVersion()],
    ['item_count', items.length],
    ['category_count', sortedCategories.length],
    ['note', 'Do not edit. The app uses generated_at to warn against importing stale stocktakes.'],
  ]);
  metaSheet['!cols'] = [{ wch: 18 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, metaSheet, META_SHEET);
  // Also stash on workbook custom properties for redundancy
  wb.Custprops = { ...(wb.Custprops || {}), [META_GENERATED_AT_KEY]: generatedAt };

  for (const category of sortedCategories) {
    const rows = groups.get(category)!;
    const aoa: (string | number | null)[][] = [
      [`Category: ${category}. on_hand = your count. Save & re-import to apply.`, '', '', '', ''],
      [...headers],
      ...rows.map((i) => [i.sku, i.name, i.on_hand, i.reorder_at, i.notes ?? '']),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    sheet['!cols'] = [{ wch: 28 }, { wch: 50 }, { wch: 11 }, { wch: 12 }, { wch: 46 }];
    sheet['!freeze'] = { xSplit: 1, ySplit: 2 };
    XLSX.utils.book_append_sheet(wb, sheet, _truncateSheetName(category));
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(path, buf);

  logger.info('Stocktake exported', {
    path,
    count: items.length,
    sheets: sortedCategories.length,
    generatedAt,
  });
  return { path, count: items.length, sheets: sortedCategories.length, generatedAt };
}

/**
 * Read the export timestamp the app stamped into a workbook on the way out.
 * Returns ISO string if found in either the _meta sheet or workbook custom
 * properties; null if it can't be determined (manually-typed sheet, file
 * from somewhere else, or an export from before this feature shipped).
 */
function readGeneratedAt(wb: XLSX.WorkBook): string | null {
  // First try the _meta sheet (most readable + survives Excel re-saves)
  const meta = wb.Sheets[META_SHEET];
  if (meta) {
    const rows = XLSX.utils.sheet_to_json<{ key?: unknown; value?: unknown }>(meta, { defval: null });
    for (const row of rows) {
      if (asString(row.key) === 'generated_at') {
        const v = asString(row.value);
        if (v) return v;
      }
    }
  }
  // Fallback to the workbook custom property
  const cp = (wb.Custprops || {}) as Record<string, unknown>;
  const v = cp[META_GENERATED_AT_KEY];
  if (typeof v === 'string' && v) return v;
  return null;
}

/**
 * Compare the workbook's export timestamp against the most recent
 * stock_movements row in the database. Returns a freshness verdict the
 * caller can show in the preview dialog (and gate the Apply button on).
 */

function checkFreshness(wb: XLSX.WorkBook): StocktakeFreshness {
  const generatedAt = readGeneratedAt(wb);
  if (!generatedAt) {
    return {
      status: 'unknown',
      reason:
        'This workbook has no export timestamp — it may have been built by hand, or come from an older app version. We can\'t check whether it\'s current.',
    };
  }
  const db = getDb();
  const row = db
    .prepare('SELECT MAX(created_at) AS last_at FROM stock_movements')
    .get() as { last_at: string | null };
  const lastMovementAt = row?.last_at ?? null;
  if (!lastMovementAt) {
    // Empty database — anything is fresh.
    return { status: 'fresh', generatedAt, lastMovementAt: null };
  }
  if (lastMovementAt > generatedAt) {
    const sinceRow = db
      .prepare('SELECT COUNT(*) AS n FROM stock_movements WHERE created_at > ?')
      .get(generatedAt) as { n: number };
    return {
      status: 'stale',
      generatedAt,
      lastMovementAt,
      movementsSince: sinceRow.n,
    };
  }
  return { status: 'fresh', generatedAt, lastMovementAt };
}

/** Excel sheet names: max 31 chars, can't contain \\ / ? * [ ] : */
function _truncateSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ');
  return cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned;
}
