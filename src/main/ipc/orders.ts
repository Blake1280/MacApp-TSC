import { z } from 'zod';
import { router, publicProcedure } from '@main/ipc/trpc';
import { getDb } from '@main/db/connection';
import { OrdersRepo } from '@main/db/repositories/orders.repo';
import {
  manualOrderCreateSchema,
  orderActionSchema,
  orderDeleteSchema,
  orderListQuerySchema,
  orderMarkPaidSchema,
  orderSetStatusSchema,
  orderUnmarkPaidSchema,
  orderUpdateCustomisationSchema,
} from '@shared/schema';
import {
  applyOrderStock,
  previewOrderRecipes,
  reverseOrderStock,
} from '@main/sync/stockApplier';

export const ordersRouter = router({
  list: publicProcedure
    .input(
      orderListQuerySchema
        .partial()
        .extend({
          needs_review_only: z.boolean().optional(),
          source: z.enum(['stripe', 'netlify', 'manual']).optional(),
        })
        .optional(),
    )
    .query(({ input }) =>
      new OrdersRepo(getDb()).list({
        app_status: input?.app_status,
        search: input?.search,
        limit: input?.limit,
        needs_review_only: input?.needs_review_only,
        source: input?.source,
      }),
    ),

  byId: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => new OrdersRepo(getDb()).byId(input.id)),

  recipePreview: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => previewOrderRecipes(input.id)),

  updateCustomisation: publicProcedure
    .input(orderUpdateCustomisationSchema)
    .mutation(({ input }) =>
      new OrdersRepo(getDb()).updateCustomisation({
        id: input.id,
        design_slug: input.design_slug ?? undefined,
        finish_id: input.finish_id ?? undefined,
        palette_id: input.palette_id ?? undefined,
        addon_ids: input.addon_ids ?? undefined,
        notes: input.notes ?? undefined,
      }),
    ),

  setStatus: publicProcedure
    .input(orderSetStatusSchema)
    .mutation(({ input }) => new OrdersRepo(getDb()).setStatus(input.id, input.app_status)),

  markPaid: publicProcedure
    .input(orderMarkPaidSchema)
    .mutation(({ input }) => new OrdersRepo(getDb()).markPaid(input.id)),

  unmarkPaid: publicProcedure
    .input(orderUnmarkPaidSchema)
    .mutation(({ input }) => new OrdersRepo(getDb()).unmarkPaid(input.id)),

  createManual: publicProcedure.input(manualOrderCreateSchema).mutation(({ input }) =>
    new OrdersRepo(getDb()).createManual({
      customer_name: input.customer_name ?? null,
      customer_email: input.customer_email ?? null,
      customer_phone: input.customer_phone ?? null,
      recipient: input.recipient ?? null,
      occasion: input.occasion ?? null,
      date_needed: input.date_needed ?? null,
      fulfilment: input.fulfilment ?? null,
      notes: input.notes ?? null,
      total_cents: input.total_cents,
      design_slug: input.design_slug ?? null,
      finish_id: input.finish_id ?? null,
      palette_id: input.palette_id ?? null,
      addon_ids: input.addon_ids,
      mark_paid: input.mark_paid,
    }),
  ),

  confirm: publicProcedure.input(orderActionSchema).mutation(({ input }) => {
    applyOrderStock(input.id);
    return new OrdersRepo(getDb()).setStatus(input.id, 'confirmed');
  }),

  reverseStock: publicProcedure.input(orderActionSchema).mutation(({ input }) => {
    reverseOrderStock(input.id);
    return new OrdersRepo(getDb()).byId(input.id);
  }),

  delete: publicProcedure.input(orderDeleteSchema).mutation(({ input }) => {
    new OrdersRepo(getDb()).delete(input.id);
    return { ok: true as const };
  }),
});
