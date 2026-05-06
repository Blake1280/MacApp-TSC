import { z } from 'zod';
import { router, publicProcedure } from '@main/ipc/trpc';
import { getDb } from '@main/db/connection';
import type { AuditLogRow } from '@shared/types';

const auditQuerySchema = z.object({
  inventory_item_id: z.number().int().positive().optional(),
  reason: z
    .enum([
      'order_apply',
      'order_reverse',
      'manual_adjust',
      'opening_balance',
      'correction',
      'off_site_sale',
      'restock',
    ])
    .optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export const auditRouter = router({
  list: publicProcedure.input(auditQuerySchema.partial().optional()).query(({ input }) => {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (input?.inventory_item_id) {
      where.push('m.inventory_item_id = :inventory_item_id');
      params.inventory_item_id = input.inventory_item_id;
    }
    if (input?.reason) {
      where.push('m.reason = :reason');
      params.reason = input.reason;
    }
    if (input?.search) {
      where.push(
        '(i.sku LIKE :search OR i.name LIKE :search OR o.customer_name LIKE :search OR o.stripe_session_id LIKE :search OR m.note LIKE :search)',
      );
      params.search = `%${input.search}%`;
    }
    const limit = input?.limit ?? 200;
    const sql = `
      SELECT m.*,
             i.sku  AS inventory_sku,
             i.name AS inventory_name,
             i.unit AS inventory_unit,
             c.kind AS catalogue_kind,
             c.external_id AS catalogue_external_id,
             c.name AS catalogue_name,
             o.stripe_session_id AS order_stripe_session_id,
             o.customer_name AS order_customer_name
      FROM stock_movements m
      LEFT JOIN inventory_items i ON i.id = m.inventory_item_id
      LEFT JOIN catalogue_entries c ON c.id = m.catalogue_id
      LEFT JOIN orders o ON o.id = m.order_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${limit}
    `;
    return getDb().prepare(sql).all(params) as AuditLogRow[];
  }),
});
