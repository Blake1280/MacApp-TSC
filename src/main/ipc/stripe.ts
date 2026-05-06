import { safeStorage } from 'electron';
import { router, publicProcedure } from '@main/ipc/trpc';
import { getDb } from '@main/db/connection';
import { clearSecret, hasSecret, setSecret } from '@main/auth/secrets';
import { STRIPE_SECRET_KEY, testStripeKey } from '@main/stripe/client';
import { stripeConnectSchema } from '@shared/schema';
import type { StripeConnectionStatus } from '@shared/types';

function readSyncStateRow() {
  return getDb()
    .prepare('SELECT * FROM sync_state WHERE source = ?')
    .get('stripe') as
    | {
        last_run_at: string | null;
        last_success_at: string | null;
        last_error: string | null;
      }
    | undefined;
}

export const stripeRouter = router({
  status: publicProcedure.query((): StripeConnectionStatus => {
    const state = readSyncStateRow();
    return {
      connected: hasSecret(STRIPE_SECRET_KEY),
      last_synced_at: state?.last_success_at ?? null,
      last_error: state?.last_error ?? null,
      encryption_available: safeStorage.isEncryptionAvailable(),
    };
  }),

  connect: publicProcedure.input(stripeConnectSchema).mutation(async ({ input }) => {
    const test = await testStripeKey(input.apiKey);
    if (!test.ok) {
      throw new Error(`Stripe rejected the key: ${test.error}`);
    }
    setSecret(STRIPE_SECRET_KEY, input.apiKey.trim());
    return { ok: true as const };
  }),

  disconnect: publicProcedure.mutation(() => {
    clearSecret(STRIPE_SECRET_KEY);
    return { ok: true as const };
  }),
});
