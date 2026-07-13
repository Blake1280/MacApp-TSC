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
import { apiPatch, apiPost } from '@main/lib/tscWebApi';
import type { Order, OrderAppStatus } from '@shared/types';
import { hasSecret } from '@main/auth/secrets';

function cloudOrderId(order: Order): number | null {
  if (!order.raw_stripe_json) return null;
  try { const id = Number((JSON.parse(order.raw_stripe_json) as { id?: unknown }).id); return Number.isInteger(id) && id > 0 ? id : null; } catch { return null; }
}

function cloudWorkflow(status: OrderAppStatus): string {
  return status === 'fulfilled' ? 'completed' : status === 'refunded' ? 'cancelled' : status;
}

async function syncCloudOrder(order: Order, status: OrderAppStatus, inventoryAction?: 'deduct' | 'release'): Promise<void> {
  const orderId = cloudOrderId(order);
  if (!orderId) return;
  await apiPatch('/order-action', { order_id: orderId, workflow_status: cloudWorkflow(status) });
  if (inventoryAction) {
    const lines = previewOrderRecipes(order.id).lines.filter((line) => line.quantity > 0).map((line) => ({ sku: line.inventory_sku, quantity: Math.round(line.quantity) }));
    if (lines.length) await apiPost('/inventory-action', { order_id: orderId, action: inventoryAction, lines });
  }
}

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
    .mutation(async ({ input }) => {
      const order = new OrdersRepo(getDb()).setStatus(input.id, input.app_status);
      await syncCloudOrder(order, input.app_status, input.app_status === 'fulfilled' ? 'deduct' : input.app_status === 'cancelled' ? 'release' : undefined);
      return order;
    }),

  markPaid: publicProcedure
    .input(orderMarkPaidSchema)
    .mutation(({ input }) => new OrdersRepo(getDb()).markPaid(input.id)),

  unmarkPaid: publicProcedure
    .input(orderUnmarkPaidSchema)
    .mutation(({ input }) => new OrdersRepo(getDb()).unmarkPaid(input.id)),

  createManual: publicProcedure.input(manualOrderCreateSchema).mutation(async ({ input }) => {
    const db = getDb();
    const order = new OrdersRepo(db).createManual({
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
    });
    if (hasSecret('tsc_web_api_key')) {
      const result = await apiPost<{ ok: boolean; order: Record<string, unknown> }>('/manual-order', { ...input, amount_cents: input.total_cents });
      db.prepare("UPDATE orders SET raw_stripe_json = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(result.order), order.id);
      return new OrdersRepo(db).byId(order.id)!;
    }
    return order;
  }),

  confirm: publicProcedure.input(orderActionSchema).mutation(async ({ input }) => {
    applyOrderStock(input.id);
    const order = new OrdersRepo(getDb()).setStatus(input.id, 'confirmed');
    await syncCloudOrder(order, 'confirmed', 'deduct');
    return order;
  }),

  // Stocktake can be incomplete without blocking fulfilment. This only moves
  // the order to confirmed; it creates no inventory movements.
  confirmWithoutStock: publicProcedure.input(orderActionSchema).mutation(async ({ input }) => {
    const orders = new OrdersRepo(getDb());
    const order = orders.byId(input.id);
    if (!order) throw new Error(`Order ${input.id} not found`);
    if (!order.paid_at) throw new Error('Only paid orders can be confirmed.');
    const updated = orders.setStatus(input.id, 'confirmed');
    await syncCloudOrder(updated, 'confirmed');
    return updated;
  }),

  reverseStock: publicProcedure.input(orderActionSchema).mutation(async ({ input }) => {
    reverseOrderStock(input.id);
    const order = new OrdersRepo(getDb()).byId(input.id)!;
    await syncCloudOrder(order, order.app_status);
    return order;
  }),

  delete: publicProcedure.input(orderDeleteSchema).mutation(async ({ input }) => {
    const orders = new OrdersRepo(getDb());
    const order = orders.byId(input.id);
    if (order) await syncCloudOrder(order, 'cancelled', 'release');
    orders.delete(input.id);
    return { ok: true as const };
  }),
});
