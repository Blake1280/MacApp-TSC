import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import AdmZip from 'adm-zip';
import { logger } from '@main/logging/logger';
import { getDb } from '@main/db/connection';
import { CatalogueRepo } from '@main/db/repositories/catalogue.repo';
import { InventoryRepo } from '@main/db/repositories/inventory.repo';
import type { ImportPreview, ImportResult } from '@shared/types';

type RawTSC = {
  finishes: Array<{ id: string; name: string; price?: number }>;
  paletteOptions: Array<{ id: string; name: string }>;
  addons: Array<{ id: string; name: string; price?: number; group?: string }>;
  // Customer-facing labels for the addon group keys. When present, the
  // importer prefers the label string over the raw key for the catalogue
  // entry's `category` column so the renderer displays the same heading
  // the customer sees on the website ("Sweet things" vs raw "sweet").
  addonGroups?: Record<string, { label?: string }>;
  gallery: Array<{
    slug: string;
    title: string;
    finishId?: string;
    paletteId?: string;
  }>;
  // Pre-set bundles (Path B on the website). Each is a Jade-curated gift
  // kit — name, default finish/palette, and a list of locked addon ids
  // that make up the gift contents. Import them as catalogue 'design'
  // entries so bundle orders have a canonical record + recipe.
  bundles?: Array<{
    id: string;
    name: string;
    category?: string;
    contentsPrice?: number;
    defaultFinish?: string;
    defaultPalette?: string;
    lockedContents?: string[];
    lockedAddonIds?: string[];
    trimAddonIds?: string[];
  }>;
};

/**
 * Locate product-data.js given a user-supplied path. Accepts:
 *   - The .js file directly
 *   - A directory (searches root and subdirs for product-data.js)
 *   - A .zip file (reads product-data.js from inside)
 * Returns { code, sourceLabel } or throws.
 */
function loadProductDataSource(path: string): { code: string; sourceLabel: string } {
  if (!existsSync(path)) throw new Error(`Path does not exist: ${path}`);

  const stat = statSync(path);

  if (stat.isFile() && path.toLowerCase().endsWith('.zip')) {
    const zip = new AdmZip(path);
    const entry =
      zip.getEntry('product-data.js') ??
      zip.getEntries().find((e) => basename(e.entryName) === 'product-data.js');
    if (!entry) throw new Error('product-data.js not found inside ZIP');
    return { code: entry.getData().toString('utf8'), sourceLabel: `${basename(path)}/${entry.entryName}` };
  }

  if (stat.isFile() && path.toLowerCase().endsWith('.js')) {
    return { code: readFileSync(path, 'utf8'), sourceLabel: path };
  }

  if (stat.isDirectory()) {
    const direct = join(path, 'product-data.js');
    if (existsSync(direct)) return { code: readFileSync(direct, 'utf8'), sourceLabel: direct };

    // Shallow walk one level deep
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);
      if (statSync(child).isDirectory()) {
        const candidate = join(child, 'product-data.js');
        if (existsSync(candidate)) {
          return { code: readFileSync(candidate, 'utf8'), sourceLabel: candidate };
        }
      }
    }
    throw new Error(`product-data.js not found in directory: ${path}`);
  }

  throw new Error(`Unsupported path type: ${path}`);
}

function evaluateTSCData(code: string): RawTSC {
  // The file ends with `if (typeof module !== 'undefined' && module.exports) module.exports = TSC_DATA;`
  // Run in a sandbox that supplies module + window so either export path captures the data.
  const sandbox: Record<string, unknown> = {
    module: { exports: {} as unknown },
    window: {} as Record<string, unknown>,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 1000 });

  const fromModule = (sandbox.module as { exports: unknown }).exports;
  const fromWindow = (sandbox.window as Record<string, unknown>).TSC_DATA;
  const data = (fromModule && Object.keys(fromModule as object).length > 0
    ? fromModule
    : fromWindow) as RawTSC | undefined;

  if (!data || !Array.isArray(data.finishes) || !Array.isArray(data.gallery)) {
    throw new Error('Loaded file is not a valid product-data.js (missing finishes/gallery)');
  }
  return data;
}

export function buildPreview(path: string): ImportPreview {
  const { code, sourceLabel } = loadProductDataSource(path);
  const data = evaluateTSCData(code);

  return {
    source_path: sourceLabel,
    designs: data.gallery.map((g) => ({
      external_id: g.slug,
      name: g.title,
      default_finish_id: g.finishId ?? null,
      default_palette_id: g.paletteId ?? null,
    })),
    finishes: data.finishes.map((f) => ({
      external_id: f.id,
      name: f.name,
      price_cents: typeof f.price === 'number' ? Math.round(f.price * 100) : null,
    })),
    palettes: data.paletteOptions.map((p) => ({ external_id: p.id, name: p.name })),
    addons: data.addons.map((a) => ({
      external_id: a.id,
      name: a.name,
      price_cents: typeof a.price === 'number' ? Math.round(a.price * 100) : null,
      group: a.group ?? null,
    })),
    bundles: (data.bundles ?? []).map((b) => ({
      external_id: b.id,
      name: b.name,
      category: b.category ?? null,
      price_cents: bundlePriceCents(data, b),
      default_finish_id: b.defaultFinish ?? null,
      default_palette_id: b.defaultPalette ?? null,
      locked_content_names: Array.isArray(b.lockedContents) ? b.lockedContents : [],
      locked_addon_ids: Array.isArray(b.lockedAddonIds) ? b.lockedAddonIds : [],
    })),
  };
}

const ADDON_INVENTORY_CATEGORY = 'addon';

const REQUIRED_RECIPE_INVENTORY: Record<string, { name: string; cost_cents: number | null }> = {
  'balloon-bubble-24in': { name: '24-inch clear bubble balloon', cost_cents: 299 },
  'ribbon-curled-roll': { name: 'Curling ribbon roll', cost_cents: 80 },
  'ribbon-satin-roll': { name: 'Satin ribbon spool', cost_cents: 699 },
  'gift-box-medium': { name: 'Medium gift box', cost_cents: 700 },
  'sc-pin': { name: 'Balloon care safety pin', cost_cents: null },
  'care-guide-card': { name: 'Balloon care guide card', cost_cents: null },
  'balloon-latex-5in-pack': { name: '5-inch latex balloon', cost_cents: null },
};

function inventorySkuForAddon(addonId: string): string {
  return `addon-${addonId}`;
}

type RawBundle = NonNullable<RawTSC['bundles']>[number];

function bundlePriceCents(data: RawTSC, bundle: RawBundle): number | null {
  if (typeof bundle.contentsPrice !== 'number') return null;
  const finishPrice = data.finishes.find((finish) => finish.id === bundle.defaultFinish)?.price ?? 0;
  return Math.round((bundle.contentsPrice + finishPrice) * 100);
}

type BundleContentLine = { sku: string; name: string; quantity: number; source: string };

/** Convert website display strings into stable inventory rows and quantities. */
function bundleContentLine(source: string): BundleContentLine {
  let name = source.trim();
  let quantity = 1;

  const parenthetical = name.match(/\s*\((\d+)\)\s*$/);
  const trailing = name.match(/\s+[x×]\s*(\d+)\s*$/i);
  const leadingTimes = name.match(/^(\d+)\s*[x×]\s*(.+)$/i);
  const leadingCount = name.match(/^(\d+)\s+(.+)$/);

  if (parenthetical) {
    quantity = Number(parenthetical[1]);
    name = name.slice(0, parenthetical.index).trim();
  } else if (trailing) {
    quantity = Number(trailing[1]);
    name = name.slice(0, trailing.index).trim();
  } else if (leadingTimes) {
    quantity = Number(leadingTimes[1]);
    name = leadingTimes[2].trim();
  } else if (leadingCount) {
    quantity = Number(leadingCount[1]);
    name = leadingCount[2].trim();
  }

  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
  const hash = createHash('sha1').update(name.toLowerCase()).digest('hex').slice(0, 8);

  return {
    sku: `bundle-${slug.slice(0, 38)}-${hash}`,
    name,
    quantity: Math.max(1, quantity),
    source,
  };
}

/* ----------------------------------------------------------------------
 * Finish + palette + addon-override recipe templates.
 *
 * Per-order kit varies by finish (Blake confirmed 2026-05-04):
 *   - Foil:    bubble + box + pin + care + 4× latex (palette colour-specific)
 *   - Curled:  bubble + ribbon-curled + box + pin + care (NO latex)
 *   - Satin:   bubble + ribbon-satin  + box + pin + care (NO latex)
 *
 * Foil clusters now deduct via the PALETTE recipe (colour-specific SKUs)
 * rather than the foil finish (which used to deduct a generic 4× pack).
 * That puts the colour visibility where Jade looks for it — on each
 * palette's recipe in the catalogue — and keeps the finish recipe pure
 * (bubble + packaging + care, no balloon colour entanglement).
 *
 * The stockApplier guards against double-deduction by skipping palette
 * recipes for non-foil orders: curled/satin pick a palette purely as a
 * ribbon-colour intent, so firing the colour balloon deduction would
 * be incorrect (no cluster ships with curled/satin).
 *
 * extra-balloons addon: 4× generic balloon-latex-5in-pack. Jade picks
 * the colours on the day for the extras since they may or may not
 * match the palette exactly (e.g. customer says "matched but a few
 * accent colours OK").
 * -------------------------------------------------------------------- */

type RecipeTemplateLine = { sku: string; quantity: number };

const FINISH_RECIPE_TEMPLATES: Record<string, RecipeTemplateLine[]> = {
  satin: [
    { sku: 'balloon-bubble-24in', quantity: 1 },
    { sku: 'ribbon-satin-roll',   quantity: 1 },
    { sku: 'gift-box-medium',     quantity: 1 },
    { sku: 'sc-pin',              quantity: 1 },
    { sku: 'care-guide-card',     quantity: 1 },
  ],
  curled: [
    { sku: 'balloon-bubble-24in', quantity: 1 },
    { sku: 'ribbon-curled-roll',  quantity: 1 },
    { sku: 'gift-box-medium',     quantity: 1 },
    { sku: 'sc-pin',              quantity: 1 },
    { sku: 'care-guide-card',     quantity: 1 },
  ],
  foil: [
    // No ribbon line — Jade picks a foil-topper-letter / number / shape pool
    // manually based on the customer's foil_topper_request. Tracking it here
    // would deduct from the wrong pool 2/3 of the time.
    // No latex line here either — the palette recipe handles the
    // colour-specific 4-balloon cluster.
    { sku: 'balloon-bubble-24in', quantity: 1 },
    { sku: 'gift-box-medium',     quantity: 1 },
    { sku: 'sc-pin',              quantity: 1 },
    { sku: 'care-guide-card',     quantity: 1 },
  ],
};

/* ----------------------------------------------------------------------
 * Palette → balloon colour SKU map.
 *
 * Each palette is the actual colour cluster Jade ties for that look.
 * Quantities split across the colours add up to 4 (the foil cluster size)
 * — for single-colour palettes, that's 4 of one SKU; for multi-colour
 * palettes (pastel rainbow, gender reveal, etc.) it splits the cluster.
 *
 * SKUs reference the active Stylex catalogue (migration 010 archived
 * the old hand-rolled colour rows and replaced them with `stylex-*`
 * variants). When a palette references a colour Stylex doesn't carry
 * exactly (e.g. `classic` → black + gold + cream), we map to the
 * closest active SKU. Re-import after Jade adds a missing colour as
 * an inventory item and the warning resolves itself.
 *
 * NOTE: the syncer only fires palette recipes for foil orders (see
 * stockApplier.ts). Curled / satin orders that pick a palette use it
 * as ribbon-colour intent only, so this mapping is for visibility +
 * foil cluster deduction only.
 * -------------------------------------------------------------------- */

const PALETTE_BALLOON_RECIPES: Record<string, RecipeTemplateLine[]> = {
  // ----- Warm / pink-leaning -----
  blush:     [{ sku: 'balloon-latex-5in-stylex-blush',                quantity: 4 }],
  'rose-gold': [{ sku: 'balloon-latex-5in-stylex-chrome-rose-gold',   quantity: 4 }],
  red:       [{ sku: 'balloon-latex-5in-stylex-fashion-red',          quantity: 4 }],
  'hot-pink': [
    { sku: 'balloon-latex-5in-stylex-rose-pink',                      quantity: 2 },
    { sku: 'balloon-latex-5in-stylex-chrome-bronze-gold',             quantity: 2 },
  ],

  // ----- Soft pastels -----
  peach: [
    { sku: 'balloon-latex-5in-stylex-pastel-dusk-rose',               quantity: 2 },
    { sku: 'balloon-latex-5in-stylex-pastel-dusk-cream',              quantity: 2 },
  ],
  pastel: [
    // True pastel rainbow — three pastels equally weighted, fourth
    // balloon falls to whichever's most in stock on the day (we
    // double the pink to keep the cluster balanced).
    { sku: 'balloon-latex-5in-stylex-pastel-pink',                    quantity: 2 },
    { sku: 'balloon-latex-5in-stylex-pastel-green',                   quantity: 1 },
    { sku: 'balloon-latex-5in-stylex-pastel-lilac',                   quantity: 1 },
  ],
  lilac: [
    { sku: 'balloon-latex-5in-stylex-pastel-lilac',                   quantity: 2 },
    { sku: 'balloon-latex-5in-stylex-chrome-silver',                  quantity: 2 },
  ],
  mint: [
    { sku: 'balloon-latex-5in-stylex-mint-green',                     quantity: 4 },
  ],

  // ----- Bold / vibrant -----
  purple: [
    { sku: 'balloon-latex-5in-stylex-hot-purple',                     quantity: 2 },
    { sku: 'balloon-latex-5in-stylex-chrome-bronze-gold',             quantity: 2 },
  ],
  orange: [
    { sku: 'balloon-latex-5in-stylex-orange',                         quantity: 4 },
  ],
  yellow: [
    { sku: 'balloon-latex-5in-stylex-pastel-yellow',                  quantity: 4 },
  ],
  sunset: [
    { sku: 'balloon-latex-5in-stylex-burnt-orange',                   quantity: 2 },
    { sku: 'balloon-latex-5in-stylex-rose-pink',                      quantity: 1 },
    { sku: 'balloon-latex-5in-stylex-pastel-dusk-rose',               quantity: 1 },
  ],

  // ----- Cool / masculine -----
  gendrev: [
    // Pink + blue reveal — half pink half blue, classic 50/50 reveal split.
    { sku: 'balloon-latex-5in-stylex-baby-pink',                      quantity: 2 },
    { sku: 'balloon-latex-5in-stylex-baby-blue',                      quantity: 2 },
  ],
  boy: [
    { sku: 'balloon-latex-5in-stylex-baby-blue',                      quantity: 2 },
    { sku: 'balloon-latex-5in-stylex-pearl-white',                    quantity: 2 },
  ],
  navy: [
    { sku: 'balloon-latex-5in-stylex-navy',                           quantity: 2 },
    { sku: 'balloon-latex-5in-stylex-chrome-bronze-gold',             quantity: 2 },
  ],

  // ----- Dark / sophisticated -----
  classic: [
    { sku: 'balloon-latex-5in-stylex-black',                          quantity: 2 },
    { sku: 'balloon-latex-5in-stylex-chrome-bronze-gold',             quantity: 2 },
  ],

  // ----- Neutrals -----
  natural: [
    { sku: 'balloon-latex-5in-stylex-pastel-dusk-cream',              quantity: 2 },
    { sku: 'balloon-latex-5in-stylex-white-sand',                     quantity: 2 },
  ],
  white: [
    { sku: 'balloon-latex-5in-stylex-white',                          quantity: 4 },
  ],

  // 'custom' has no recipe — Jade hand-picks balloon colours from the
  // free-text description on the day. Recipe stays empty so the order
  // doesn't ghost-deduct from a colour the customer didn't actually get.
};

function paletteRecipeFor(paletteId: string): RecipeTemplateLine[] {
  return PALETTE_BALLOON_RECIPES[paletteId] ?? [];
}

/** Per-addon recipe overrides. By default each addon auto-seeds a 1:1
 *  link to its synthetic `addon-<id>` inventory item (qty 1). For addons
 *  that should deduct from a specific physical SKU at a non-1 quantity,
 *  list them here and the override wins.
 *
 *  extra-balloons → 4× balloon-latex-5in-pack: the addon represents an
 *  extra 4-balloon cluster, not a generic "+1 of some bag of balloons".
 */
const ADDON_RECIPE_OVERRIDES: Record<string, RecipeTemplateLine[]> = {
  'extra-balloons': [
    { sku: 'balloon-latex-5in-pack', quantity: 4 },
  ],
};

export function applyImport(
  path: string,
  options: {
    autoCreateAddonInventory: boolean;
    autoSeedAddonRecipes: boolean;
    importBundles?: boolean;
    autoSeedBundleRecipes?: boolean;
    autoSeedFinishRecipes?: boolean;
    autoSeedPaletteRecipes?: boolean;
  },
): ImportResult {
  const { code, sourceLabel } = loadProductDataSource(path);
  const data = evaluateTSCData(code);
  logger.info('Importing TSC_DATA', { source: sourceLabel });

  const db = getDb();
  const catalogue = new CatalogueRepo(db);
  const inventory = new InventoryRepo(db);

  const result: ImportResult = {
    inserted: { designs: 0, finishes: 0, palettes: 0, addons: 0, bundles: 0 },
    updated: { designs: 0, finishes: 0, palettes: 0, addons: 0, bundles: 0 },
    inventoryAutoCreated: 0,
    recipesAutoSeeded: 0,
    bundleRecipesAutoSeeded: 0,
    bundleRecipeWarnings: [],
    finishRecipesAutoSeeded: 0,
    paletteRecipesAutoSeeded: 0,
    finishRecipeWarnings: [],
  };

  /** Apply a recipe template to a catalogue entry. Looks each line's SKU up
   *  in the inventory; when found, upserts the recipe component at the given
   *  quantity. When missing, pushes a warning so Jade knows what didn't wire.
   *  No-op if the catalogue entry already has any recipe components — that's
   *  what makes re-imports safe (manual edits stick). Returns the count of
   *  components actually written. */
  function applyRecipeTemplate(
    catalogueEntryId: number,
    templateName: string,
    template: RecipeTemplateLine[],
  ): number {
    const existing = catalogue.recipeComponents(catalogueEntryId);
    if (existing.length > 0) return 0;

    let written = 0;
    for (const line of template) {
      const inv = inventory.bySku(line.sku);
      if (!inv) {
        result.finishRecipeWarnings.push(
          `${templateName}: inventory SKU '${line.sku}' not found — recipe component skipped.`,
        );
        continue;
      }
      catalogue.upsertRecipeComponent({
        catalogue_id: catalogueEntryId,
        inventory_item_id: inv.id,
        quantity: line.quantity,
      });
      written++;
    }
    return written;
  }

  // Track each addon's auto-created inventory item id so bundles can build
  // their recipes against the same inventory rows in a second pass.
  const addonInventoryByExtId = new Map<string, number>();

  const tx = db.transaction(() => {
    if (options.autoCreateAddonInventory) {
      for (const [sku, definition] of Object.entries(REQUIRED_RECIPE_INVENTORY)) {
        if (inventory.bySku(sku)) continue;
        inventory.create({
          sku,
          name: definition.name,
          category: 'Materials',
          unit: 'each',
          on_hand: 0,
          reorder_at: 0,
          cost_cents: definition.cost_cents,
          notes: 'Required by the website finish/add-on recipes. Confirm the unit cost and opening stock count.',
        });
        result.inventoryAutoCreated++;
      }
    }

    for (const f of data.finishes) {
      const { entry, created } = catalogue.upsert({
        kind: 'finish',
        external_id: f.id,
        name: f.name,
        price_cents: typeof f.price === 'number' ? Math.round(f.price * 100) : null,
        default_finish_id: null,
        default_palette_id: null,
      });
      created ? result.inserted.finishes++ : result.updated.finishes++;

      // Auto-seed the finish recipe — bubble + ribbon + gift box + pin +
      // care guide. Only on first creation; re-imports leave the existing
      // recipe alone so manual edits to component quantities stick.
      if ((options.autoSeedFinishRecipes ?? true) && catalogue.recipeComponents(entry.id).length === 0) {
        const template = FINISH_RECIPE_TEMPLATES[f.id];
        if (template) {
          const written = applyRecipeTemplate(entry.id, `Finish '${f.name}'`, template);
          result.finishRecipesAutoSeeded += written;
        }
      }
    }

    for (const p of data.paletteOptions) {
      const { entry, created } = catalogue.upsert({
        kind: 'palette',
        external_id: p.id,
        name: p.name,
        price_cents: null,
        default_finish_id: null,
        default_palette_id: null,
      });
      created ? result.inserted.palettes++ : result.updated.palettes++;

      // Each palette deducts the colour-specific 4-balloon cluster
      // (matches the foil cluster size baked into website pricing).
      // The stockApplier guards palette firing to foil-only orders so
      // curled/satin orders that pick a palette as ribbon-colour intent
      // don't ghost-deduct from a cluster that wasn't actually shipped.
      if ((options.autoSeedPaletteRecipes ?? true) && catalogue.recipeComponents(entry.id).length === 0) {
        const template = paletteRecipeFor(p.id);
        const written = applyRecipeTemplate(entry.id, `Palette '${p.name}'`, template);
        result.paletteRecipesAutoSeeded += written;
      }
    }

    for (const g of data.gallery) {
      const { created } = catalogue.upsert({
        kind: 'design',
        external_id: g.slug,
        name: g.title,
        price_cents: null,
        default_finish_id: g.finishId ?? null,
        default_palette_id: g.paletteId ?? null,
      });
      created ? result.inserted.designs++ : result.updated.designs++;
    }

    // Resolve addon group keys ('sweet', 'drinks', etc.) to customer-facing
    // labels ('Sweet things', 'Drinks') using the website's addonGroups
    // config. Falls back to a Title-Cased version of the raw key when the
    // group is missing — keeps re-imports of older product-data.js files
    // (without addonGroups) working.
    const addonGroupLabel = (key: string | null | undefined): string | null => {
      if (!key) return null;
      const fromConfig = data.addonGroups?.[key]?.label;
      if (fromConfig) return fromConfig;
      return key.charAt(0).toUpperCase() + key.slice(1);
    };

    for (const a of data.addons) {
      const { entry, created } = catalogue.upsert({
        kind: 'addon',
        external_id: a.id,
        name: a.name,
        price_cents: typeof a.price === 'number' ? Math.round(a.price * 100) : null,
        default_finish_id: null,
        default_palette_id: null,
        category: addonGroupLabel(a.group ?? null),
      });
      created ? result.inserted.addons++ : result.updated.addons++;

      if (options.autoCreateAddonInventory) {
        const sku = inventorySkuForAddon(a.id);
        const existing = inventory.bySku(sku);
        let invItemId: number;
        if (!existing) {
          const item = inventory.create({
            sku,
            name: a.name,
            category: ADDON_INVENTORY_CATEGORY,
            unit: 'each',
            on_hand: 0,
            reorder_at: 0,
            cost_cents: null,
            notes: `Auto-created from add-on '${a.id}'. Edit freely.`,
          });
          invItemId = item.id;
          result.inventoryAutoCreated++;
        } else {
          invItemId = existing.id;
        }
        addonInventoryByExtId.set(a.id, invItemId);

        if (options.autoSeedAddonRecipes) {
          const components = catalogue.recipeComponents(entry.id);
          if (components.length === 0) {
            // Override path: some addons should deduct from a specific
            // physical SKU at a non-1 quantity (e.g. extra-balloons →
            // 4× balloon-latex-5in-pack) instead of the generic 1:1
            // synthetic addon-* mapping.
            const override = ADDON_RECIPE_OVERRIDES[a.id];
            if (override) {
              const written = applyRecipeTemplate(entry.id, `Add-on '${a.name}'`, override);
              result.recipesAutoSeeded += written;
            } else {
              catalogue.upsertRecipeComponent({
                catalogue_id: entry.id,
                inventory_item_id: invItemId,
                quantity: 1,
              });
              result.recipesAutoSeeded++;
            }
          }
        }
      } else {
        // Even when not auto-creating inventory, still record any existing
        // inventory link so bundle recipe seeding can find it later.
        const existing = inventory.bySku(inventorySkuForAddon(a.id));
        if (existing) addonInventoryByExtId.set(a.id, existing.id);
      }
    }

    // ---- Bundles ----
    // Imported as 'design' entries. A bundle is conceptually a productized
    // design — has a name, a default finish, a default palette, and the
    // contents are the union of its locked addons. Trim (optional) addons
    // are recorded at the order level via addon_ids_json and apply on top.
    if (options.importBundles ?? true) {
      for (const b of data.bundles ?? []) {
        // Use a 'bundle:' prefix on the external_id so bundle 'design'
        // entries don't collide with one-off gallery designs that happen
        // to share a slug. The website's order metadata sends the bare
        // bundle.id; the order syncer can reconstruct the prefix when
        // looking the catalogue entry up.
        const externalId = `bundle:${b.id}`;
        const { entry, created } = catalogue.upsert({
          kind: 'design',
          external_id: externalId,
          name: b.name,
          price_cents: bundlePriceCents(data, b),
          default_finish_id: b.defaultFinish ?? null,
          default_palette_id: b.defaultPalette ?? null,
          category: b.category ?? null,
        });
        created ? result.inserted.bundles++ : result.updated.bundles++;

        // Recipe seeding — only on first creation, so re-imports don't
        // clobber Jade's manual edits to the bundle's recipe. If she
        // wants to re-seed she can clear the recipe components first.
        const lockedIds = Array.isArray(b.lockedAddonIds) ? b.lockedAddonIds : [];
        const lockedContents = Array.isArray(b.lockedContents) ? b.lockedContents : [];
        if ((options.autoSeedBundleRecipes ?? true) && catalogue.recipeComponents(entry.id).length === 0) {
          if (lockedContents.length > 0) {
            for (const rawContent of lockedContents) {
              const line = bundleContentLine(rawContent);
              let item = inventory.bySku(line.sku);
              if (!item && options.autoCreateAddonInventory) {
                item = inventory.create({
                  sku: line.sku,
                  name: line.name,
                  category: 'Bundle contents',
                  unit: 'each',
                  on_hand: 0,
                  reorder_at: 0,
                  cost_cents: null,
                  notes: `Auto-created from website bundle content '${line.source}'. Add the real supplier cost and stock count.`,
                });
                result.inventoryAutoCreated++;
              }
              if (!item) {
                result.bundleRecipeWarnings.push(
                  `Bundle '${b.name}' content '${line.source}' has no inventory item - recipe component skipped.`,
                );
                continue;
              }
              catalogue.upsertRecipeComponent({
                catalogue_id: entry.id,
                inventory_item_id: item.id,
                quantity: line.quantity,
              });
              result.bundleRecipesAutoSeeded++;
            }
          } else {
            for (const addonId of lockedIds) {
              const invItemId = addonInventoryByExtId.get(addonId);
              if (!invItemId) {
                result.bundleRecipeWarnings.push(
                  `Bundle '${b.name}' references unknown locked addon '${addonId}' — recipe component skipped.`,
                );
                continue;
              }
              catalogue.upsertRecipeComponent({
                catalogue_id: entry.id,
                inventory_item_id: invItemId,
                quantity: 1,
              });
              result.bundleRecipesAutoSeeded++;
            }
          }
        }
      }
    }
  });
  tx();

  logger.info('Import complete', result);
  return result;
}
