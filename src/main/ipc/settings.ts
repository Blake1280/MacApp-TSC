import { z } from 'zod';
import { router, publicProcedure } from '@main/ipc/trpc';
import { getDb } from '@main/db/connection';
import { settingsSetSchema } from '@shared/schema';
import { seedDemoOrders, clearDemoOrders } from '@main/lib/demoSeed';

export const settingsRouter = router({
  get: publicProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(({ input }) => {
      const row = getDb()
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get(input.key) as { value: string } | undefined;
      return row?.value ?? null;
    }),

  set: publicProcedure.input(settingsSetSchema).mutation(({ input }) => {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (@key, @value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(input);
    return { ok: true as const };
  }),

  all: publicProcedure.query(() => {
    return getDb().prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;
  }),

  seedDemoOrders: publicProcedure.mutation(() => seedDemoOrders()),

  clearDemoOrders: publicProcedure.mutation(() => clearDemoOrders()),
});
