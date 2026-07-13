import { logger } from '@main/logging/logger';
import { getDb } from '@main/db/connection';
import { hasSecret } from '@main/auth/secrets';
import { STRIPE_SECRET_KEY } from '@main/stripe/client';
import { NETLIFY_TOKEN_KEY } from '@main/netlify/client';
import { pullStripeOrders, recordStripePullFailure } from '@main/sync/stripe.source';
import { pullNetlifyOrders, recordNetlifyPullFailure } from '@main/sync/netlify.source';
import { autoApplyEligibleOrders, autoReverseRefundedOrders } from '@main/sync/autoApply';
import { dedupeStripeNetlifyOrders } from '@main/sync/dedupe';
import { pullCloudState } from '@main/sync/cloud.source';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let inFlightStripe = false;
let inFlightNetlify = false;
let inFlightCloud = false;
let lastResult: {
  at: string;
  ok: boolean;
  source: 'stripe' | 'netlify' | 'cloud';
  fetched?: number;
  inserted?: number;
  updated?: number;
  error?: string;
} | null = null;

export function getLastSyncResult() {
  return lastResult;
}

export function isSyncing(): boolean {
  return inFlightStripe || inFlightNetlify || inFlightCloud;
}

async function runCloudSync(reason: 'manual' | 'startup' | 'scheduled'): Promise<void> {
  if (inFlightCloud) return;
  inFlightCloud = true;
  try {
    logger.info('Shared cloud sync starting', { reason });
    const result = await pullCloudState();
    lastResult = { at: new Date().toISOString(), ok: true, source: 'cloud', fetched: result.fetched, inserted: result.inserted, updated: result.updated };
    logger.info('Shared cloud sync complete', result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastResult = { at: new Date().toISOString(), ok: false, source: 'cloud', error: message };
    logger.error('Shared cloud sync failed', { reason, error: message });
  } finally {
    inFlightCloud = false;
  }
}

function netlifyConfigured(): boolean {
  if (!hasSecret(NETLIFY_TOKEN_KEY)) return false;
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('netlify.form_id') as { value: string } | undefined;
  return !!row?.value;
}

export async function runStripeSync(reason: 'manual' | 'startup' | 'scheduled'): Promise<void> {
  if (!hasSecret(STRIPE_SECRET_KEY)) {
    logger.debug('Skipping Stripe sync: no API key configured');
    return;
  }
  if (inFlightStripe) {
    logger.debug('Skipping Stripe sync: already in flight');
    return;
  }
  inFlightStripe = true;
  try {
    logger.info('Stripe sync starting', { reason });
    const result = await pullStripeOrders();
    // Merge any Netlify/Stripe twin pairs BEFORE auto-apply so a freshly
    // linked order becomes 'stripe_netlify' and is eligible in the same
    // pass instead of sitting in needs-review until the next sync.
    try {
      const dedupe = dedupeStripeNetlifyOrders();
      if (dedupe.merged.length > 0 || dedupe.skipped.length > 0) {
        logger.info('Order dedupe summary', {
          merged: dedupe.merged.length,
          skipped: dedupe.skipped.length,
        });
      }
    } catch (dedupeErr) {
      logger.warn('Order dedupe pass failed', {
        error: dedupeErr instanceof Error ? dedupeErr.message : String(dedupeErr),
      });
    }
    // After a successful pull, auto-confirm + apply stock for orders that
    // are double-confirmed and have clean recipes. Refunds reverse stock.
    try {
      const auto = autoApplyEligibleOrders();
      if (auto.applied.length > 0 || auto.skipped.length > 0) {
        logger.info('Auto-apply summary', { applied: auto.applied.length, skipped: auto.skipped.length });
      }
      autoReverseRefundedOrders();
    } catch (autoErr) {
      logger.warn('Auto-apply pass failed', {
        error: autoErr instanceof Error ? autoErr.message : String(autoErr),
      });
    }
    lastResult = {
      at: new Date().toISOString(),
      ok: true,
      source: 'stripe',
      fetched: result.fetched,
      inserted: result.inserted,
      updated: result.updated,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Stripe sync failed', { reason, error: msg });
    recordStripePullFailure(msg);
    lastResult = { at: new Date().toISOString(), ok: false, source: 'stripe', error: msg };
  } finally {
    inFlightStripe = false;
  }
}

export async function runNetlifySync(reason: 'manual' | 'startup' | 'scheduled'): Promise<void> {
  if (!netlifyConfigured()) {
    logger.debug('Skipping Netlify sync: not connected or no form selected');
    return;
  }
  if (inFlightNetlify) {
    logger.debug('Skipping Netlify sync: already in flight');
    return;
  }
  inFlightNetlify = true;
  try {
    logger.info('Netlify sync starting', { reason });
    const result = await pullNetlifyOrders();
    // Same twin-merge pass as the Stripe sync — idempotent and cheap, and it
    // covers the case where the Netlify pull lands after Stripe already
    // inserted its half of the pair.
    try {
      dedupeStripeNetlifyOrders();
    } catch (dedupeErr) {
      logger.warn('Order dedupe pass failed', {
        error: dedupeErr instanceof Error ? dedupeErr.message : String(dedupeErr),
      });
    }
    lastResult = {
      at: new Date().toISOString(),
      ok: true,
      source: 'netlify',
      fetched: result.fetched,
      inserted: result.inserted,
      updated: result.updated,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Netlify sync failed', { reason, error: msg });
    recordNetlifyPullFailure(msg);
    lastResult = { at: new Date().toISOString(), ok: false, source: 'netlify', error: msg };
  } finally {
    inFlightNetlify = false;
  }
}

export async function runAllSync(reason: 'manual' | 'startup' | 'scheduled'): Promise<void> {
  if (hasSecret('tsc_web_api_key')) {
    await runCloudSync(reason);
    return;
  }
  // Run Netlify first so structured customisation is in place when Stripe enriches.
  await runNetlifySync(reason);
  await runStripeSync(reason);
}

export function startSyncEngine(): void {
  void runAllSync('startup');
  if (timer) clearInterval(timer);
  timer = setInterval(() => void runAllSync('scheduled'), DEFAULT_INTERVAL_MS);
}

export function stopSyncEngine(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
