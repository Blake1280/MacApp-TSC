import type Stripe from 'stripe';
import { logger } from '@main/logging/logger';
import { getDb } from '@main/db/connection';
import { getStripeClient } from '@main/stripe/client';
import { CatalogueRepo } from '@main/db/repositories/catalogue.repo';
import { OrdersRepo } from '@main/db/repositories/orders.repo';
import type { CatalogueEntry } from '@shared/types';

type ChargeWithRefunds = {
  refunded?: boolean;
  amount_refunded?: number;
};

function isRefunded(session: Stripe.Checkout.Session): boolean {
  const pi = session.payment_intent;
  if (!pi || typeof pi === 'string') return false;
  const charge = (pi as { latest_charge?: string | ChargeWithRefunds }).latest_charge;
  if (!charge || typeof charge === 'string') return false;
  if (charge.refunded === true) return true;
  if ((charge.amount_refunded ?? 0) >= (session.amount_total ?? 0) && (session.amount_total ?? 0) > 0) {
    return true;
  }
  return false;
}

const SOURCE = 'stripe' as const;
const BACKFILL_DAYS = 30;

type CatalogueIndexes = {
  finishes: Map<string, CatalogueEntry>; // lowercased name -> entry
  palettes: Map<string, CatalogueEntry>;
  addons: Map<string, CatalogueEntry>; // lowercased name -> entry
  addonsByExtId: Map<string, CatalogueEntry>;
};

function buildCatalogueIndex(): CatalogueIndexes {
  const repo = new CatalogueRepo(getDb());
  const finishes = new Map<string, CatalogueEntry>();
  const palettes = new Map<string, CatalogueEntry>();
  const addons = new Map<string, CatalogueEntry>();
  const addonsByExtId = new Map<string, CatalogueEntry>();

  for (const e of repo.list({ kind: 'finish', includeArchived: true })) {
    finishes.set(e.name.toLowerCase(), e);
  }
  for (const e of repo.list({ kind: 'palette', includeArchived: true })) {
    palettes.set(e.name.toLowerCase(), e);
  }
  for (const e of repo.list({ kind: 'addon', includeArchived: true })) {
    addons.set(e.name.toLowerCase(), e);
    addonsByExtId.set(e.external_id, e);
  }
  return { finishes, palettes, addons, addonsByExtId };
}

/**
 * Parse the free-text addons_summary that the website builds (e.g.
 * "Soft toy plush · Lindt chocolates" or "Plush, Wine"). Best-effort: split
 * on common separators, then for each token try to match a catalogue addon
 * by name (case-insensitive substring).
 */
function resolveAddons(summary: string | undefined, idx: CatalogueIndexes): string[] {
  if (!summary || !summary.trim()) return [];
  const tokens = summary
    .split(/[·,;|]+|\s+\+\s+|\s+and\s+/i)
    .map((t) => t.trim())
    .filter(Boolean);
  const matched = new Set<string>();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    let bestMatch: CatalogueEntry | null = null;
    for (const [name, entry] of idx.addons.entries()) {
      if (name === lower || name.includes(lower) || lower.includes(name)) {
        bestMatch = entry;
        break;
      }
    }
    if (bestMatch) matched.add(bestMatch.external_id);
  }
  return [...matched];
}

function readSyncState() {
  return getDb()
    .prepare('SELECT * FROM sync_state WHERE source = ?')
    .get(SOURCE) as
    | {
        source: string;
        last_run_at: string | null;
        last_success_at: string | null;
        last_cursor: string | null;
        last_error: string | null;
      }
    | undefined;
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

export type StripePullResult = {
  fetched: number;
  inserted: number;
  updated: number;
  cursor_unix: number;
};

/**
 * Pull paid Stripe Checkout Sessions newer than the stored cursor (or last
 * BACKFILL_DAYS on first run), normalize them, and upsert into orders.
 */
export async function pullStripeOrders(): Promise<StripePullResult> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('Stripe is not connected. Add an API key in Settings.');
  }

  const state = readSyncState();
  const nowUnix = Math.floor(Date.now() / 1000);
  const defaultCursor = nowUnix - BACKFILL_DAYS * 86400;
  const cursor = state?.last_cursor ? parseInt(state.last_cursor, 10) : defaultCursor;

  logger.info('Stripe pull starting', { cursor, isoSince: new Date(cursor * 1000).toISOString() });

  const idx = buildCatalogueIndex();
  const orders = new OrdersRepo(getDb());

  let inserted = 0;
  let updated = 0;
  let fetched = 0;
  let maxCreated = cursor;

  let startingAfter: string | undefined;
  // Paginate through Stripe up to a sensible cap to avoid runaway sessions.
  for (let page = 0; page < 20; page++) {
    const list: Stripe.ApiList<Stripe.Checkout.Session> = await stripe.checkout.sessions.list({
      created: { gte: cursor },
      limit: 100,
      starting_after: startingAfter,
      expand: ['data.payment_intent.latest_charge'],
    });
    fetched += list.data.length;

    for (const session of list.data) {
      if (session.created > maxCreated) maxCreated = session.created;
      if (session.payment_status !== 'paid') continue;

      const md = session.metadata ?? {};

      // Prefer the explicit ids the website now sends. Fall back to the
      // human-readable name fields for orders placed before the website
      // started carrying ids (audit found this gap on 2026-04-29).
      const finishName = (md.finish_name ?? '').toLowerCase();
      const paletteName = (md.palette_name ?? '').toLowerCase();
      const finishIdFromName = finishName ? idx.finishes.get(finishName)?.external_id ?? null : null;
      const paletteIdFromName = paletteName ? idx.palettes.get(paletteName)?.external_id ?? null : null;
      const finishId = (md.finish_id || '').trim() || finishIdFromName;
      const paletteId = (md.palette_id || '').trim() || paletteIdFromName;
      const designSlug = (md.design_slug || md.ordered_design || '').trim() || null;

      // Same preference for addons: clean CSV first, fall back to substring
      // matching against the human-readable summary.
      const addonExtIds = md.addon_ids_csv
        ? md.addon_ids_csv.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
        : resolveAddons(md.addons_summary, idx);

      const refunded = isRefunded(session);

      // Bundle metadata — the website sends these for orders that came from
      // /bundles.html. Defaults to BYO so legacy orders still work unchanged.
      const flowType: 'byo' | 'bundle' = md.flow_type === 'bundle' ? 'bundle' : 'byo';
      const bundleId = md.bundle_id || null;
      const bundleName = md.bundle_name || null;
      const lockedAddonsCsv = md.locked_addons_csv || null;

      // Custom palette + structured delivery info. The website sends all of
      // these in metadata; preserved here so the order can drive a fulfilment
      // quote later without re-parsing the human-readable `fulfilment` string.
      const customPalette = md.custom_palette || null;
      const deliveryZone = md.delivery_zone || null;
      const deliverySuburb = md.delivery_suburb || null;
      const address = md.address || null;

      // Rush-order tier from the BYO/bundles checkout. Website only emits
      // 'yes' / '25.00' when the customer ticked the +$25 rush box on a
      // date_needed within 7 days. Empty strings normalised to null so the
      // OrderDetail badge gates cleanly on rush_order === 'yes'.
      const rushOrder = md.rush_order && md.rush_order !== '' ? md.rush_order : null;
      const rushFee = md.rush_fee && md.rush_fee !== '' ? md.rush_fee : null;

      // Bubble vinyl + foil topper request — only sent when the customer
      // ticked 'personalised-text' or chose the foil finish. Folded into
      // notes so Jade sees them on the order card without inspecting the
      // raw Stripe metadata.
      // extras_palette_* — present only when finish is curled/satin AND
      // the customer added the extra-balloons addon. Tells Jade what
      // colour the latex cluster should be (vs the main palette which
      // is the ribbon/bow colour for those finishes).
      const bubbleText = md.bubble_text || null;
      const foilTopperRequest = md.foil_topper_request || null;
      const extrasPaletteName = md.extras_palette_name || null;
      const extrasPaletteCustom = md.extras_palette_custom || null;
      const extrasPaletteLine = extrasPaletteName
        ? (extrasPaletteName.toLowerCase().includes('custom') && extrasPaletteCustom
            ? `Cluster palette (custom): ${extrasPaletteCustom}`
            : `Cluster palette: ${extrasPaletteName}`)
        : null;
      // Ribbon / bow colour — same custom-vs-preset split as extras palette.
      const ribbonColourName = md.ribbon_colour_name || null;
      const ribbonColourCustom = md.ribbon_colour_custom || null;
      const ribbonColourLine = ribbonColourName
        ? (ribbonColourName.toLowerCase().includes('custom') && ribbonColourCustom
            ? `Ribbon/bow (custom): ${ribbonColourCustom}`
            : `Ribbon/bow: ${ribbonColourName}`)
        : null;
      const composedNotes =
        [
          bubbleText ? `Bubble text (vinyl): ${bubbleText}` : null,
          foilTopperRequest ? `Foil topper: ${foilTopperRequest}` : null,
          ribbonColourLine,
          extrasPaletteLine,
          md.notes || null,
        ]
          .filter(Boolean)
          .join('\n— ') || null;

      const result = orders.upsertFromStripe({
        stripe_session_id: session.id,
        customer_name: md.customer_name || session.customer_details?.name || null,
        customer_email: md.customer_email || session.customer_details?.email || null,
        customer_phone: md.customer_phone || session.customer_details?.phone || null,
        total_cents: session.amount_total ?? 0,
        currency: (session.currency ?? 'aud').toLowerCase(),
        paid_at: new Date(session.created * 1000).toISOString(),
        design_slug: designSlug,
        finish_id: finishId,
        palette_id: paletteId,
        addon_ids_json: addonExtIds.length > 0 ? JSON.stringify(addonExtIds) : null,
        flow_type: flowType,
        bundle_id: bundleId,
        bundle_name: bundleName,
        locked_addons_csv: lockedAddonsCsv,
        custom_palette: customPalette,
        delivery_zone: deliveryZone,
        delivery_suburb: deliverySuburb,
        address,
        fulfilment: md.fulfilment || null,
        date_needed: md.date_needed || null,
        time_needed: md.time_needed || null,
        occasion: md.occasion || null,
        recipient: md.recipient || null,
        notes: composedNotes,
        rush_order: rushOrder,
        rush_fee: rushFee,
        raw_stripe_json: JSON.stringify(session),
      });
      result.created ? inserted++ : updated++;

      // If Stripe says this session is refunded and our local order isn't already
      // marked refunded, flip its status. Stock reversal is left to the user via
      // the order detail page so they don't get surprised mid-fulfilment.
      if (refunded && result.order.app_status !== 'refunded') {
        orders.setStatus(result.order.id, 'refunded');
        logger.info('Order auto-marked refunded from Stripe', {
          orderId: result.order.id,
          sessionId: session.id,
        });
      }
    }

    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1]?.id;
  }

  // Subtract 1 second so we re-pull boundary records and don't miss anything.
  const newCursor = Math.max(cursor, maxCreated - 1);
  writeSyncState({
    last_cursor: String(newCursor),
    last_success_at: new Date().toISOString(),
    last_error: null,
  });

  logger.info('Stripe pull done', { fetched, inserted, updated, newCursor });
  return { fetched, inserted, updated, cursor_unix: newCursor };
}

export function recordStripePullFailure(message: string): void {
  writeSyncState({ last_error: message });
}
