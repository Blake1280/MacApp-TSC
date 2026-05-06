import { logger } from '@main/logging/logger';
import { getDb } from '@main/db/connection';
import { listFormSubmissions, type NetlifyRawSubmission } from '@main/netlify/client';
import { OrdersRepo } from '@main/db/repositories/orders.repo';
import { CatalogueRepo } from '@main/db/repositories/catalogue.repo';
import type { CatalogueEntry } from '@shared/types';

const SOURCE = 'netlify' as const;

function readSettings() {
  const rows = getDb()
    .prepare('SELECT key, value FROM settings WHERE key IN (?, ?)')
    .all('netlify.form_id', 'netlify.site_id') as Array<{ key: string; value: string }>;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { formId: map['netlify.form_id'] ?? null, siteId: map['netlify.site_id'] ?? null };
}

function writeSyncState(input: {
  last_cursor?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
}) {
  getDb()
    .prepare(
      `INSERT INTO sync_state (source, last_run_at, last_success_at, last_cursor, last_error)
       VALUES (@source, datetime('now'), @last_success_at, @last_cursor, @last_error)
       ON CONFLICT(source) DO UPDATE SET
         last_run_at     = excluded.last_run_at,
         last_success_at = COALESCE(excluded.last_success_at, sync_state.last_success_at),
         last_cursor     = COALESCE(excluded.last_cursor, sync_state.last_cursor),
         last_error      = excluded.last_error`,
    )
    .run({
      source: SOURCE,
      last_success_at: input.last_success_at ?? null,
      last_cursor: input.last_cursor ?? null,
      last_error: input.last_error ?? null,
    });
}

function readLastCursor(): string | null {
  const row = getDb()
    .prepare('SELECT last_cursor FROM sync_state WHERE source = ?')
    .get(SOURCE) as { last_cursor: string | null } | undefined;
  return row?.last_cursor ?? null;
}

type CatalogueIndex = {
  designs: Map<string, CatalogueEntry>; // by external_id
  finishes: Map<string, CatalogueEntry>;
  palettes: Map<string, CatalogueEntry>;
  addons: Map<string, CatalogueEntry>;
  finishesByName: Map<string, CatalogueEntry>;
  palettesByName: Map<string, CatalogueEntry>;
  addonsByName: Map<string, CatalogueEntry>;
};

function buildCatalogueIndex(): CatalogueIndex {
  const repo = new CatalogueRepo(getDb());
  const idx: CatalogueIndex = {
    designs: new Map(),
    finishes: new Map(),
    palettes: new Map(),
    addons: new Map(),
    finishesByName: new Map(),
    palettesByName: new Map(),
    addonsByName: new Map(),
  };
  for (const e of repo.list({ kind: 'design', includeArchived: true })) idx.designs.set(e.external_id, e);
  for (const e of repo.list({ kind: 'finish', includeArchived: true })) {
    idx.finishes.set(e.external_id, e);
    idx.finishesByName.set(e.name.toLowerCase(), e);
  }
  for (const e of repo.list({ kind: 'palette', includeArchived: true })) {
    idx.palettes.set(e.external_id, e);
    idx.palettesByName.set(e.name.toLowerCase(), e);
  }
  for (const e of repo.list({ kind: 'addon', includeArchived: true })) {
    idx.addons.set(e.external_id, e);
    idx.addonsByName.set(e.name.toLowerCase(), e);
  }
  return idx;
}

function pickString(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function pickNumber(data: Record<string, unknown>, key: string): number | null {
  const v = data[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Resolve add-on external_ids from a Netlify submission. The form has an
 * `addons_summary` text field built from the add-on names; we tokenise and
 * match against the catalogue.
 */
function resolveAddons(summary: string | null, idx: CatalogueIndex): string[] {
  if (!summary) return [];
  const tokens = summary
    .split(/[·,;|]+|\s+\+\s+|\s+and\s+/i)
    .map((t) => t.trim())
    .filter(Boolean);
  const matched = new Set<string>();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    for (const [name, entry] of idx.addonsByName.entries()) {
      if (name === lower || name.includes(lower) || lower.includes(name)) {
        matched.add(entry.external_id);
        break;
      }
    }
  }
  return [...matched];
}

export type NetlifyPullResult = {
  fetched: number;
  inserted: number;
  updated: number;
  cursor_iso: string;
};

/**
 * Pull recent Netlify Forms submissions for the configured form. Reconciles
 * with Stripe-derived orders by stripe_session_id.
 */
export async function pullNetlifyOrders(): Promise<NetlifyPullResult> {
  const { formId } = readSettings();
  if (!formId) {
    throw new Error('Netlify form not configured. Pick a site + form in Settings.');
  }

  logger.info('Netlify pull starting', { formId });

  const idx = buildCatalogueIndex();
  const orders = new OrdersRepo(getDb());
  const cursor = readLastCursor(); // ISO string of newest submission seen so far

  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let newestSeen: string | null = cursor;

  // Walk pages, oldest stop is when we hit a submission older than cursor.
  for (let page = 1; page <= 20; page++) {
    const submissions = await listFormSubmissions(formId, { page, perPage: 100 });
    if (submissions.length === 0) break;
    fetched += submissions.length;

    let stop = false;
    for (const sub of submissions) {
      if (cursor && sub.created_at <= cursor) {
        stop = true;
        break;
      }
      if (!newestSeen || sub.created_at > newestSeen) newestSeen = sub.created_at;

      const result = upsertFromNetlifySubmission(sub, idx, orders);
      result.created ? inserted++ : updated++;
    }
    if (stop || submissions.length < 100) break;
  }

  writeSyncState({
    last_cursor: newestSeen,
    last_success_at: new Date().toISOString(),
    last_error: null,
  });

  logger.info('Netlify pull done', { fetched, inserted, updated, newestSeen });
  return { fetched, inserted, updated, cursor_iso: newestSeen ?? '' };
}

function upsertFromNetlifySubmission(
  sub: NetlifyRawSubmission,
  idx: CatalogueIndex,
  orders: OrdersRepo,
): { created: boolean } {
  const data = sub.data ?? {};

  const stripeSessionId = pickString(data, 'stripe_session_id');
  const designSlug = pickString(data, 'ordered_design');

  // finish_id may already be a slug (preferred) or fall back to finish_name lookup
  let finishId = pickString(data, 'finish_id');
  if (!finishId) {
    const finishName = pickString(data, 'finish_name');
    if (finishName) {
      finishId = idx.finishesByName.get(finishName.toLowerCase())?.external_id ?? null;
    }
  }

  let paletteId = pickString(data, 'palette_id');
  if (!paletteId) {
    const paletteName = pickString(data, 'palette_name');
    if (paletteName) {
      paletteId = idx.palettesByName.get(paletteName.toLowerCase())?.external_id ?? null;
    }
  }

  // Prefer the explicit comma-separated list when the website sends it
  // (current behaviour). Fall back to substring matching against the
  // human-readable summary for older submissions still in Netlify history.
  const addonIdsCsv = pickString(data, 'addon_ids_csv');
  const addonIds = addonIdsCsv
    ? addonIdsCsv.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : resolveAddons(pickString(data, 'addons_summary'), idx);

  const totalRaw = pickNumber(data, 'total_price');
  const totalCents = totalRaw != null ? Math.round(totalRaw * 100) : 0;

  const customerName = pickString(data, 'name');
  const customerEmail = pickString(data, 'email') ?? sub.email;
  const customerPhone = pickString(data, 'phone');
  const recipient = pickString(data, 'recipient');
  const occasion = pickString(data, 'occasion');
  const dateNeeded = pickString(data, 'date_needed');
  const timeNeeded = pickString(data, 'time_needed');
  const fulfilment = pickString(data, 'fulfilment');
  // Fold all the free-text inputs the customer might have left behind into
  // a single `notes` blob so Jade sees them on the order card without having
  // to inspect raw_netlify_json. Order matters — most-actionable first:
  //   bubble_text         (vinyl text Jade has to cut and apply)
  //   foil_topper_request (foil item Jade has to source)
  //   extras_palette      (latex colour for the +4-balloon cluster, curled/
  //                        satin only — separate from main ribbon palette)
  //   notes               (free-text "anything else")
  //   tag_message         (handwritten card message)
  //   extra_contents      (specifics about the gift items)
  const bubbleText = pickString(data, 'bubble_text');
  const foilTopperRequest = pickString(data, 'foil_topper_request');
  const extrasPaletteName = pickString(data, 'extras_palette_name');
  const extrasPaletteCustom = pickString(data, 'extras_palette_custom');
  const extrasPaletteLine = extrasPaletteName
    ? (extrasPaletteName.toLowerCase().includes('custom') && extrasPaletteCustom
        ? `Cluster palette (custom): ${extrasPaletteCustom}`
        : `Cluster palette: ${extrasPaletteName}`)
    : null;
  // Ribbon / bow colour — single colour pick on curled or satin orders.
  // Foil orders never carry it. Custom branch surfaces the free-text
  // description; preset branch uses the named colour.
  const ribbonColourName = pickString(data, 'ribbon_colour_name');
  const ribbonColourCustom = pickString(data, 'ribbon_colour_custom');
  const ribbonColourLine = ribbonColourName
    ? (ribbonColourName.toLowerCase().includes('custom') && ribbonColourCustom
        ? `Ribbon/bow (custom): ${ribbonColourCustom}`
        : `Ribbon/bow: ${ribbonColourName}`)
    : null;
  const notesText =
    [
      bubbleText ? `Bubble text (vinyl): ${bubbleText}` : null,
      foilTopperRequest ? `Foil topper: ${foilTopperRequest}` : null,
      ribbonColourLine,
      extrasPaletteLine,
      pickString(data, 'notes'),
      pickString(data, 'tag_message') ? `Tag: ${pickString(data, 'tag_message')}` : null,
      pickString(data, 'extra_contents'),
    ]
      .filter(Boolean)
      .join('\n— ') || null;

  // Bundle metadata sent by /bundles.html. flow_type defaults to 'byo' so
  // legacy submissions stay BYO. locked_addons_csv carries the bundle's
  // fixed gift contents — distinct from addon_ids_json which is the trim.
  const flowTypeRaw = pickString(data, 'flow_type');
  const flowType: 'byo' | 'bundle' = flowTypeRaw === 'bundle' ? 'bundle' : 'byo';
  const bundleId = pickString(data, 'bundle_id');
  const bundleName = pickString(data, 'bundle_name');
  const lockedAddonsCsv = pickString(data, 'locked_addons_csv');

  // Custom palette description (free-text shown when palette_id == 'custom')
  // and structured delivery info (zone + suburb + free-text street address).
  const customPalette = pickString(data, 'custom_palette');
  const deliveryZone = pickString(data, 'delivery_zone');
  const deliverySuburb = pickString(data, 'delivery_suburb');
  const address = pickString(data, 'address');

  // Rush-order tier — see equivalent comment in stripe.source.ts. pickString
  // already normalises empty strings to null, so the OrderDetail badge
  // can gate cleanly on rush_order === 'yes'.
  const rushOrder = pickString(data, 'rush_order');
  const rushFee = pickString(data, 'rush_fee');

  return orders.upsertFromNetlify({
    netlify_submission_id: sub.id,
    stripe_session_id: stripeSessionId,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    total_cents: totalCents,
    currency: 'aud',
    paid_at: stripeSessionId ? null : null, // unknown until Stripe confirms or user marks paid
    design_slug: designSlug,
    finish_id: finishId,
    palette_id: paletteId,
    addon_ids_json: addonIds.length > 0 ? JSON.stringify(addonIds) : null,
    flow_type: flowType,
    bundle_id: bundleId,
    bundle_name: bundleName,
    locked_addons_csv: lockedAddonsCsv,
    custom_palette: customPalette,
    delivery_zone: deliveryZone,
    delivery_suburb: deliverySuburb,
    address,
    fulfilment,
    date_needed: dateNeeded,
    time_needed: timeNeeded,
    occasion,
    recipient,
    notes: notesText,
    rush_order: rushOrder,
    rush_fee: rushFee,
    raw_netlify_json: JSON.stringify(sub),
    submitted_at: sub.created_at,
  });
}

export function recordNetlifyPullFailure(message: string): void {
  writeSyncState({ last_error: message });
}
