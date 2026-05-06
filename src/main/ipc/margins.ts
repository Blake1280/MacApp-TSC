import { z } from 'zod';
import { router, publicProcedure } from '@main/ipc/trpc';
import { computeOrderCogs, marginsByBundle, marginsByOrder } from '@main/lib/cogs';

const rangeSchema = z.object({
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const marginsRouter = router({
  byBundle: publicProcedure
    .input(rangeSchema.optional())
    .query(({ input }) => marginsByBundle(input ?? {})),

  byOrder: publicProcedure
    .input(rangeSchema.extend({ limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(({ input }) => marginsByOrder(input ?? {})),

  forOrder: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => computeOrderCogs(input.id)),
});
