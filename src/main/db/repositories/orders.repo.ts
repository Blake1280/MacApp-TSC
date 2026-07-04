import type { Database } from 'better-sqlite3';
import type {
  Order,
  OrderAppStatus,
  OrderListItem,
  OrderMatchStatus,
  OrderSource,
} from '@shared/types';

export type OrderUpsertFromStripeInput = {
  stripe_session_id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  total_cents: number;
  currency: string;
  paid_at: string | null;
  design_slug: string | null;
  finish_id: string | null;
  palette_id: string | null;
  addon_ids_json: string | null;
  flow_type: 'byo' | 'bundle';
  bundle_id: string | null;
  bundle_name: string | null;
  locked_addons_csv: string | null;
  custom_palette: string | null;
  delivery_zone: string | null;
  delivery_suburb: string | null;
  address: string | null;
  fulfilment: string | null;
  date_needed: string | null;
  time_needed: string | null;
  occasion: string | null;
  recipient: string | null;
  notes: string | null;
  rush_order: string | null;
  rush_fee: string | null;
  raw_stripe_json: string | null;
};

export type OrderUpsertFromNetlifyInput = {
  netlify_submission_id: string;
  stripe_session_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  total_cents: number;
  currency: string;
  paid_at: string | null;
  design_slug: string | null;
  finish_id: string | null;
  palette_id: string | null;
  addon_ids_json: string | null;
  flow_type: 'byo' | 'bundle';
  bundle_id: string | null;
  bundle_name: string | null;
  locked_addons_csv: string | null;
  custom_palette: string | null;
  delivery_zone: string | null;
  delivery_suburb: string | null;
  address: string | null;
  fulfilment: string | null;
  date_needed: string | null;
  time_needed: string | null;
  occasion: string | null;
  recipient: string | null;
  notes: string | null;
  rush_order: string | null;
  rush_fee: string | null;
  raw_netlify_json: string | null;
  submitted_at: string;
};

export type OrderListQuery = {
  app_status?: OrderAppStatus;
  search?: string;
  needs_review_only?: boolean;
  source?: OrderSource;
  limit?: number;
};

function deriveMatchStatus(o: {
  stripe_session_id: string | null;
  netlify_submission_id: string | null;
  graph_message_id: string | null;
  source: OrderSource;
}): OrderMatchStatus {
  if (o.source === 'manual') return 'manual';
  const s = !!o.stripe_session_id;
  const n = !!o.netlify_submission_id;
  const e = !!o.graph_message_id;
  if (s && n && e) return 'all_three';
  if (s && n) return 'stripe_netlify';
  if (s && e) return 'stripe_email';
  if (n && e) return 'netlify_email';
  if (s) return 'stripe_only';
  if (n) return 'netlify_only';
  if (e) return 'email_only';
  return 'needs_review';
}

export class OrdersRepo {
  constructor(private db: Database) {}

  byId(id: number): Order | null {
    const row = this.db
      .prepare('SELECT * FROM orders WHERE id = ?')
      .get(id) as Order | undefined;
    return row ?? null;
  }

  bySessionId(sessionId: string): Order | null {
    const row = this.db
      .prepare('SELECT * FROM orders WHERE stripe_session_id = ?')
      .get(sessionId) as Order | undefined;
    return row ?? null;
  }

  byNetlifySubmissionId(submissionId: string): Order | null {
    const row = this.db
      .prepare('SELECT * FROM orders WHERE netlify_submission_id = ?')
      .get(submissionId) as Order | undefined;
    return row ?? null;
  }

  /**
   * Find the unlinked "twin" of an incoming order from the other source.
   *
   * The website submits the order form to Netlify and then redirects to
   * Stripe Checkout. When the form payload carries the stripe_session_id the
   * two pulls merge into one order — but when it doesn't (session created
   * after submit, older form version, metadata dropped), each source used to
   * insert its own row and Jade saw the order twice.
   *
   * Twin heuristic: same customer email (case-insensitive), same total (or
   * the form total is 0 / unknown), created within `windowDays` of now, and
   * still missing the incoming source's id. Deliberately strict about
   * ambiguity: if MORE than one candidate matches (e.g. the customer really
   * did place two identical orders), we return null and let both rows stand
   * rather than guess — needs_review will surface them.
   */
  findUnlinkedTwin(input: {
    incoming: 'stripe' | 'netlify';
    customer_email: string | null;
    total_cents: number;
    windowDays?: number;
  }): Order | null {
    if (!input.customer_email || !input.customer_email.trim()) return null;
    const twinSource = input.incoming === 'stripe' ? 'netlify' : 'stripe';
    const missingIdCol =
      input.incoming === 'stripe' ? 'stripe_session_id' : 'netlify_submission_id';
    const rows = this.db
      .prepare(
        `SELECT * FROM orders
          WHERE source = @twinSource
            AND ${missingIdCol} IS NULL
            AND customer_email IS NOT NULL
            AND lower(customer_email) = lower(@email)
            AND (total_cents = @total_cents OR total_cents = 0 OR @total_cents = 0)
            AND abs(julianday(created_at) - julianday('now')) <= @windowDays`,
      )
      .all({
        twinSource,
        email: input.customer_email.trim(),
        total_cents: input.total_cents,
        windowDays: input.windowDays ?? 30,
      }) as Order[];
    return rows.length === 1 ? rows[0]! : null;
  }

  list(query: OrderListQuery): OrderListItem[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (query.app_status) {
      where.push('app_status = :app_status');
      params.app_status = query.app_status;
    }
    if (query.source) {
      where.push('source = :source');
      params.source = query.source;
    }
    if (query.needs_review_only) {
      where.push("match_status IN ('netlify_only','email_only','needs_review')");
      where.push('manually_marked_paid = 0');
      where.push("app_status NOT IN ('cancelled','refunded','fulfilled')");
    }
    if (query.search) {
      where.push(
        '(customer_name LIKE :search OR customer_email LIKE :search OR stripe_session_id LIKE :search OR recipient LIKE :search)',
      );
      params.search = `%${query.search}%`;
    }
    const limit = query.limit ?? 200;
    const sql = `
      SELECT *,
        CASE WHEN addon_ids_json IS NULL OR addon_ids_json = '[]' THEN 0
             ELSE (LENGTH(addon_ids_json) - LENGTH(REPLACE(addon_ids_json, ',', ''))) + 1
        END AS addon_count
      FROM orders
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY COALESCE(paid_at, manual_paid_at, created_at) DESC
      LIMIT ${limit}
    `;
    return this.db.prepare(sql).all(params) as OrderListItem[];
  }

  upsertFromStripe(input: OrderUpsertFromStripeInput): { order: Order; created: boolean } {
    let existing = this.bySessionId(input.stripe_session_id);
    // No session match — before inserting a brand-new row, check whether the
    // same purchase already arrived as a form submission that never carried
    // the session id. Adopting it here (instead of inserting) is what stops
    // the Netlify/Stripe double-up at the source.
    if (!existing) {
      existing = this.findUnlinkedTwin({
        incoming: 'stripe',
        customer_email: input.customer_email,
        total_cents: input.total_cents,
      });
    }
    if (!existing) {
      const matchStatus = deriveMatchStatus({
        stripe_session_id: input.stripe_session_id,
        netlify_submission_id: null,
        graph_message_id: null,
        source: 'stripe',
      });
      const result = this.db
        .prepare(
          `INSERT INTO orders (
             stripe_session_id, source,
             customer_name, customer_email, customer_phone,
             total_cents, currency, paid_at,
             design_slug, finish_id, palette_id, addon_ids_json,
             flow_type, bundle_id, bundle_name, locked_addons_csv,
             custom_palette, delivery_zone, delivery_suburb, address,
             fulfilment, date_needed, time_needed, occasion, recipient, notes,
             rush_order, rush_fee,
             match_status, raw_stripe_json
           ) VALUES (
             @stripe_session_id, 'stripe',
             @customer_name, @customer_email, @customer_phone,
             @total_cents, @currency, @paid_at,
             @design_slug, @finish_id, @palette_id, @addon_ids_json,
             @flow_type, @bundle_id, @bundle_name, @locked_addons_csv,
             @custom_palette, @delivery_zone, @delivery_suburb, @address,
             @fulfilment, @date_needed, @time_needed, @occasion, @recipient, @notes,
             @rush_order, @rush_fee,
             @match_status, @raw_stripe_json
           )`,
        )
        .run({ ...input, match_status: matchStatus });
      return { order: this.byId(Number(result.lastInsertRowid))!, created: true };
    }

    // Existing order: enrich with Stripe data without clobbering richer Netlify-derived fields.
    // stripe_session_id is set here too so an adopted form-only twin becomes
    // fully linked (no-op when the order was found by session id already).
    this.db
      .prepare(
        `UPDATE orders SET
           stripe_session_id = COALESCE(stripe_session_id, @stripe_session_id),
           customer_name = COALESCE(customer_name, @customer_name),
           customer_email = COALESCE(customer_email, @customer_email),
           customer_phone = COALESCE(customer_phone, @customer_phone),
           total_cents = @total_cents,
           currency = @currency,
           paid_at = COALESCE(paid_at, @paid_at),
           finish_id = COALESCE(finish_id, @finish_id),
           palette_id = COALESCE(palette_id, @palette_id),
           addon_ids_json = COALESCE(addon_ids_json, @addon_ids_json),
           design_slug = COALESCE(design_slug, @design_slug),
           flow_type = CASE WHEN flow_type = 'byo' AND @flow_type = 'bundle' THEN @flow_type ELSE flow_type END,
           bundle_id = COALESCE(bundle_id, @bundle_id),
           bundle_name = COALESCE(bundle_name, @bundle_name),
           locked_addons_csv = COALESCE(locked_addons_csv, @locked_addons_csv),
           custom_palette = COALESCE(custom_palette, @custom_palette),
           delivery_zone = COALESCE(delivery_zone, @delivery_zone),
           delivery_suburb = COALESCE(delivery_suburb, @delivery_suburb),
           address = COALESCE(address, @address),
           fulfilment = COALESCE(fulfilment, @fulfilment),
           date_needed = COALESCE(date_needed, @date_needed),
           time_needed = COALESCE(time_needed, @time_needed),
           occasion = COALESCE(occasion, @occasion),
           recipient = COALESCE(recipient, @recipient),
           rush_order = COALESCE(rush_order, @rush_order),
           rush_fee = COALESCE(rush_fee, @rush_fee),
           -- Defensive null-skip: only overwrite raw_stripe_json when the
           -- pull actually carried a payload. Stripe pulls always do, so
           -- this is mostly belt-and-braces against a future code path
           -- that calls upsertFromStripe with raw=null (e.g. a webhook
           -- arrival that only updates a status flag). Without this guard
           -- a null call would wipe the last-known-good payload Jade
           -- might want to inspect for a customer dispute.
           raw_stripe_json = COALESCE(@raw_stripe_json, raw_stripe_json),
           updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ ...input, id: existing.id });

    this.recomputeMatchStatus(existing.id);
    return { order: this.byId(existing.id)!, created: false };
  }

  upsertFromNetlify(input: OrderUpsertFromNetlifyInput): { order: Order; created: boolean } {
    // Try to find an existing order to merge into:
    //   1. by netlify_submission_id (we've seen this exact submission before)
    //   2. by stripe_session_id (Stripe pulled it first; now Netlify confirms)
    let existing = this.byNetlifySubmissionId(input.netlify_submission_id);
    if (!existing && input.stripe_session_id) {
      existing = this.bySessionId(input.stripe_session_id);
    }
    // Mirror of the twin-adoption in upsertFromStripe: if Stripe pulled this
    // purchase first (form arrived without a session id), merge into that
    // order instead of inserting a duplicate.
    if (!existing) {
      existing = this.findUnlinkedTwin({
        incoming: 'netlify',
        customer_email: input.customer_email,
        total_cents: input.total_cents,
      });
    }

    if (!existing) {
      const matchStatus = deriveMatchStatus({
        stripe_session_id: input.stripe_session_id,
        netlify_submission_id: input.netlify_submission_id,
        graph_message_id: null,
        source: 'netlify',
      });
      const result = this.db
        .prepare(
          `INSERT INTO orders (
             stripe_session_id, netlify_submission_id, source,
             customer_name, customer_email, customer_phone,
             total_cents, currency, paid_at,
             design_slug, finish_id, palette_id, addon_ids_json,
             flow_type, bundle_id, bundle_name, locked_addons_csv,
             custom_palette, delivery_zone, delivery_suburb, address,
             fulfilment, date_needed, time_needed, occasion, recipient, notes,
             rush_order, rush_fee,
             match_status, raw_netlify_json
           ) VALUES (
             @stripe_session_id, @netlify_submission_id, 'netlify',
             @customer_name, @customer_email, @customer_phone,
             @total_cents, @currency, @paid_at,
             @design_slug, @finish_id, @palette_id, @addon_ids_json,
             @flow_type, @bundle_id, @bundle_name, @locked_addons_csv,
             @custom_palette, @delivery_zone, @delivery_suburb, @address,
             @fulfilment, @date_needed, @time_needed, @occasion, @recipient, @notes,
             @rush_order, @rush_fee,
             @match_status, @raw_netlify_json
           )`,
        )
        .run({ ...input, match_status: matchStatus });
      return { order: this.byId(Number(result.lastInsertRowid))!, created: true };
    }

    // Netlify is canonical for structured customisation — overwrite design/finish/palette/addons.
    this.db
      .prepare(
        `UPDATE orders SET
           netlify_submission_id = COALESCE(netlify_submission_id, @netlify_submission_id),
           stripe_session_id = COALESCE(stripe_session_id, @stripe_session_id),
           customer_name = COALESCE(@customer_name, customer_name),
           customer_email = COALESCE(@customer_email, customer_email),
           customer_phone = COALESCE(@customer_phone, customer_phone),
           total_cents = CASE WHEN total_cents IS NULL OR total_cents = 0 THEN @total_cents ELSE total_cents END,
           design_slug = COALESCE(@design_slug, design_slug),
           finish_id = COALESCE(@finish_id, finish_id),
           palette_id = COALESCE(@palette_id, palette_id),
           addon_ids_json = COALESCE(@addon_ids_json, addon_ids_json),
           flow_type = CASE WHEN flow_type = 'byo' AND @flow_type = 'bundle' THEN @flow_type ELSE flow_type END,
           bundle_id = COALESCE(@bundle_id, bundle_id),
           bundle_name = COALESCE(@bundle_name, bundle_name),
           locked_addons_csv = COALESCE(@locked_addons_csv, locked_addons_csv),
           custom_palette = COALESCE(@custom_palette, custom_palette),
           delivery_zone = COALESCE(@delivery_zone, delivery_zone),
           delivery_suburb = COALESCE(@delivery_suburb, delivery_suburb),
           address = COALESCE(@address, address),
           fulfilment = COALESCE(@fulfilment, fulfilment),
           date_needed = COALESCE(@date_needed, date_needed),
           time_needed = COALESCE(@time_needed, time_needed),
           occasion = COALESCE(@occasion, occasion),
           recipient = COALESCE(@recipient, recipient),
           notes = COALESCE(@notes, notes),
           rush_order = COALESCE(@rush_order, rush_order),
           rush_fee = COALESCE(@rush_fee, rush_fee),
           -- Defensive null-skip: see equivalent comment in upsertFromStripe
           -- above. Preserves the last-known-good Netlify payload across
           -- any future call site that might pass raw=null.
           raw_netlify_json = COALESCE(@raw_netlify_json, raw_netlify_json),
           updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ ...input, id: existing.id });

    this.recomputeMatchStatus(existing.id);
    return { order: this.byId(existing.id)!, created: false };
  }

  createManual(input: {
    customer_name: string | null;
    customer_email: string | null;
    customer_phone: string | null;
    recipient: string | null;
    occasion: string | null;
    date_needed: string | null;
    fulfilment: string | null;
    notes: string | null;
    total_cents: number;
    design_slug: string | null;
    finish_id: string | null;
    palette_id: string | null;
    addon_ids: string[];
    mark_paid: boolean;
  }): Order {
    const result = this.db
      .prepare(
        `INSERT INTO orders (
           source, customer_name, customer_email, customer_phone,
           recipient, occasion, date_needed, fulfilment, notes,
           total_cents, currency,
           design_slug, finish_id, palette_id, addon_ids_json,
           paid_at, manually_marked_paid, manual_paid_at,
           match_status
         ) VALUES (
           'manual', @customer_name, @customer_email, @customer_phone,
           @recipient, @occasion, @date_needed, @fulfilment, @notes,
           @total_cents, 'aud',
           @design_slug, @finish_id, @palette_id, @addon_ids_json,
           @paid_at, @manually_marked_paid, @manual_paid_at,
           'manual'
         )`,
      )
      .run({
        customer_name: input.customer_name,
        customer_email: input.customer_email,
        customer_phone: input.customer_phone,
        recipient: input.recipient,
        occasion: input.occasion,
        date_needed: input.date_needed,
        fulfilment: input.fulfilment,
        notes: input.notes,
        total_cents: input.total_cents,
        design_slug: input.design_slug,
        finish_id: input.finish_id,
        palette_id: input.palette_id,
        addon_ids_json: input.addon_ids.length ? JSON.stringify(input.addon_ids) : null,
        paid_at: input.mark_paid ? new Date().toISOString() : null,
        manually_marked_paid: input.mark_paid ? 1 : 0,
        manual_paid_at: input.mark_paid ? new Date().toISOString() : null,
      });
    return this.byId(Number(result.lastInsertRowid))!;
  }

  markPaid(id: number): Order {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE orders
           SET manually_marked_paid = 1,
               manual_paid_at = @now,
               paid_at = COALESCE(paid_at, @now),
               updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ id, now });
    return this.byId(id)!;
  }

  unmarkPaid(id: number): Order {
    this.db
      .prepare(
        `UPDATE orders
           SET manually_marked_paid = 0,
               manual_paid_at = NULL,
               updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ id });
    return this.byId(id)!;
  }

  updateCustomisation(input: {
    id: number;
    design_slug?: string | null;
    finish_id?: string | null;
    palette_id?: string | null;
    addon_ids?: string[] | null;
    notes?: string | null;
  }): Order {
    const fields: string[] = [];
    const params: Record<string, unknown> = { id: input.id };
    if (input.design_slug !== undefined) {
      fields.push('design_slug = :design_slug');
      params.design_slug = input.design_slug;
    }
    if (input.finish_id !== undefined) {
      fields.push('finish_id = :finish_id');
      params.finish_id = input.finish_id;
    }
    if (input.palette_id !== undefined) {
      fields.push('palette_id = :palette_id');
      params.palette_id = input.palette_id;
    }
    if (input.addon_ids !== undefined) {
      fields.push('addon_ids_json = :addon_ids_json');
      params.addon_ids_json = input.addon_ids === null ? null : JSON.stringify(input.addon_ids);
    }
    if (input.notes !== undefined) {
      fields.push('notes = :notes');
      params.notes = input.notes;
    }
    if (fields.length === 0) return this.byId(input.id)!;
    fields.push("updated_at = datetime('now')");
    this.db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = :id`).run(params);
    return this.byId(input.id)!;
  }

  setStatus(id: number, app_status: OrderAppStatus): Order {
    this.db
      .prepare(
        "UPDATE orders SET app_status = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(app_status, id);
    return this.byId(id)!;
  }

  /**
   * Delete an order and its stock_movements. If stock was applied, restores
   * on_hand for each affected inventory item before deleting (so totals stay
   * consistent). Atomic.
   */
  delete(id: number): void {
    const tx = this.db.transaction(() => {
      const order = this.byId(id);
      if (!order) throw new Error(`Order ${id} not found`);

      if (order.stock_applied === 1) {
        const applied = this.db
          .prepare(
            `SELECT inventory_item_id, delta FROM stock_movements
             WHERE order_id = ? AND reason = 'order_apply'`,
          )
          .all(id) as Array<{ inventory_item_id: number; delta: number }>;
        for (const m of applied) {
          // delta is negative for deductions; subtracting it restores on_hand.
          this.db
            .prepare(
              "UPDATE inventory_items SET on_hand = on_hand - ?, updated_at = datetime('now') WHERE id = ?",
            )
            .run(m.delta, m.inventory_item_id);
        }
      }

      this.db.prepare('DELETE FROM stock_movements WHERE order_id = ?').run(id);
      this.db.prepare('DELETE FROM orders WHERE id = ?').run(id);
    });
    tx();
  }

  setStockApplied(id: number, applied: boolean): void {
    this.db
      .prepare("UPDATE orders SET stock_applied = ?, updated_at = datetime('now') WHERE id = ?")
      .run(applied ? 1 : 0, id);
  }

  recomputeMatchStatus(id: number): void {
    const o = this.byId(id);
    if (!o) return;
    const next = deriveMatchStatus({
      stripe_session_id: o.stripe_session_id,
      netlify_submission_id: o.netlify_submission_id,
      graph_message_id: o.graph_message_id,
      source: o.source,
    });
    if (next !== o.match_status) {
      this.db
        .prepare("UPDATE orders SET match_status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(next, id);
    }
  }
}
