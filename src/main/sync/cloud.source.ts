import { getDb } from '@main/db/connection';
import { OrdersRepo } from '@main/db/repositories/orders.repo';
import { InventoryRepo } from '@main/db/repositories/inventory.repo';
import { apiGet, apiPost } from '@main/lib/tscWebApi';
import { previewOrderRecipes } from '@main/sync/stockApplier';
import { logger } from '@main/logging/logger';

type CloudOrder = {
  id: number; stripe_session_id: string | null; payment_status: string; paid_at: string | null;
  amount_cents: number; currency: string; flow_type: 'byo' | 'bundle'; bundle_id: string | null;
  bundle_name: string | null; finish_id: string | null; palette_id: string | null;
  custom_palette: string | null; addon_ids_csv: string | null; locked_addons_csv: string | null;
  customer_name: string | null; customer_email: string | null; customer_phone: string | null;
  delivery_zone: string | null; delivery_suburb: string | null; address: string | null;
  fulfilment: string | null; date_needed: string | null; time_needed: string | null;
  occasion: string | null; recipient: string | null; notes: string | null;
  workflow_status: string; order_details: Record<string, string> | null;
};

type CloudStock = { sku: string; name: string | null; category: string | null; on_hand: number; reorder_at: number | null; archived: boolean; updated_at: string };

const splitCsv = (value: string | null): string[] => value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];

export async function pullCloudState(): Promise<{ fetched: number; inserted: number; updated: number; reserved: number }> {
  const db = getDb();
  const inventory = new InventoryRepo(db);
  const orders = new OrdersRepo(db);
  const stock = await apiGet<{ ok: boolean; items: CloudStock[] }>('/inventory-sync');
  if (stock.items.length) {
    inventory.applyCloudSnapshot(stock.items.filter((item) => !item.sku.startsWith('web:')));
  } else {
    const localItems = inventory.list({ includeArchived: true, lowStockOnly: false })
      .filter((item) => item.stock_tracked !== 0)
      .map((item) => ({ sku: item.sku, name: item.name, category: item.category, on_hand: item.on_hand, reorder_at: item.reorder_at, archived: !!item.archived, updated_at: item.updated_at }));
    if (localItems.length) await apiPost('/inventory-sync', { items: localItems });
  }

  const response = await apiGet<{ ok: boolean; orders: CloudOrder[] }>('/orders-list?limit=1000');
  let inserted = 0;
  let updated = 0;
  let reserved = 0;
  for (const cloud of response.orders) {
    if (!cloud.stripe_session_id) continue;
    const meta = cloud.order_details || {};
    const result = orders.upsertFromStripe({
      stripe_session_id: cloud.stripe_session_id,
      customer_name: cloud.customer_name, customer_email: cloud.customer_email, customer_phone: cloud.customer_phone,
      total_cents: cloud.amount_cents || 0, currency: cloud.currency || 'aud',
      paid_at: ['paid', 'refunded'].includes(cloud.payment_status) ? cloud.paid_at : null,
      design_slug: meta.design_slug || null, finish_id: cloud.finish_id, palette_id: cloud.palette_id,
      addon_ids_json: JSON.stringify(splitCsv(cloud.addon_ids_csv)), flow_type: cloud.flow_type || 'byo',
      bundle_id: cloud.bundle_id, bundle_name: cloud.bundle_name, locked_addons_csv: cloud.locked_addons_csv,
      custom_palette: cloud.custom_palette, delivery_zone: cloud.delivery_zone, delivery_suburb: cloud.delivery_suburb,
      address: cloud.address, fulfilment: cloud.fulfilment, date_needed: cloud.date_needed,
      time_needed: cloud.time_needed, occasion: cloud.occasion, recipient: cloud.recipient, notes: cloud.notes,
      rush_order: meta.rush_order || null, rush_fee: meta.rush_fee || null, raw_stripe_json: JSON.stringify(cloud),
    });
    if (result.created) inserted++; else updated++;
    db.prepare(`UPDATE orders SET customer_name=?,customer_email=?,customer_phone=?,delivery_zone=?,delivery_suburb=?,address=?,fulfilment=?,date_needed=?,time_needed=?,occasion=?,recipient=?,notes=?,match_status='stripe_netlify',raw_stripe_json=?,updated_at=datetime('now') WHERE id=?`)
      .run(cloud.customer_name, cloud.customer_email, cloud.customer_phone, cloud.delivery_zone, cloud.delivery_suburb, cloud.address, cloud.fulfilment, cloud.date_needed, cloud.time_needed, cloud.occasion, cloud.recipient, cloud.notes, JSON.stringify(cloud), result.order.id);
    if (cloud.payment_status === 'refunded') orders.setStatus(result.order.id, 'refunded');
    else if (cloud.workflow_status === 'completed') orders.setStatus(result.order.id, 'fulfilled');
    else if (cloud.workflow_status === 'cancelled') orders.setStatus(result.order.id, 'cancelled');
    else if (cloud.workflow_status !== 'new') orders.setStatus(result.order.id, 'confirmed');

    if (cloud.payment_status === 'paid' && !['completed', 'cancelled'].includes(cloud.workflow_status)) {
      try {
        const preview = previewOrderRecipes(result.order.id);
        const lines = preview.lines.filter((line) => line.quantity > 0).map((line) => ({ sku: line.inventory_sku, quantity: Math.round(line.quantity) }));
        if (!preview.unresolvedRecipes.length && lines.length) {
          await apiPost('/inventory-action', { order_id: cloud.id, action: 'reserve', lines });
          reserved++;
        }
      } catch (error) {
        logger.warn('Cloud stock reservation skipped', { orderId: cloud.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  const now = new Date().toISOString();
  for (const source of ['stripe', 'netlify']) {
    db.prepare(`INSERT INTO sync_state(source,last_run_at,last_success_at,last_error) VALUES(?,?,?,NULL) ON CONFLICT(source) DO UPDATE SET last_run_at=excluded.last_run_at,last_success_at=excluded.last_success_at,last_error=NULL`).run(source, now, now);
  }
  return { fetched: response.orders.length, inserted, updated, reserved };
}
