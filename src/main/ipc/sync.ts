import { router, publicProcedure } from '@main/ipc/trpc';
import { getDb } from '@main/db/connection';
import {
  getLastSyncResult,
  isSyncing,
  runAllSync,
  runNetlifySync,
  runStripeSync,
} from '@main/sync/engine';
import type { SyncState } from '@shared/types';

export const syncRouter = router({
  state: publicProcedure.query(() => {
    const rows = getDb().prepare('SELECT * FROM sync_state').all() as SyncState[];
    return {
      sources: rows,
      lastResult: getLastSyncResult(),
      inFlight: isSyncing(),
    };
  }),

  runStripe: publicProcedure.mutation(async () => {
    await runStripeSync('manual');
    return getLastSyncResult();
  }),

  runNetlify: publicProcedure.mutation(async () => {
    await runNetlifySync('manual');
    return getLastSyncResult();
  }),

  runAll: publicProcedure.mutation(async () => {
    await runAllSync('manual');
    return getLastSyncResult();
  }),
});
