-- 002_failsafe.sql
-- Phase 4 changes:
--   - stripe_session_id becomes nullable (manual orders + Netlify-only orders)
--   - match_status gains 'netlify_only', 'email_only', 'manual'
--   - new column: manually_marked_paid + manual_paid_at
--   - new column: source ('stripe' | 'netlify' | 'manual') showing how the
--     order first entered the system
--
-- SQLite can't change CHECK constraints in place, so we rebuild the table.

CREATE TABLE orders_new (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_session_id        TEXT UNIQUE,
  netlify_submission_id    TEXT UNIQUE,
  graph_message_id         TEXT UNIQUE,
  source                   TEXT NOT NULL DEFAULT 'stripe'
                              CHECK(source IN ('stripe','netlify','manual')),
  customer_name            TEXT,
  customer_email           TEXT,
  customer_phone           TEXT,
  total_cents              INTEGER NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'aud',
  paid_at                  TEXT,
  manually_marked_paid     INTEGER NOT NULL DEFAULT 0,
  manual_paid_at           TEXT,
  design_slug              TEXT,
  finish_id                TEXT,
  palette_id               TEXT,
  addon_ids_json           TEXT,
  fulfilment               TEXT,
  date_needed              TEXT,
  occasion                 TEXT,
  recipient                TEXT,
  notes                    TEXT,
  match_status             TEXT NOT NULL CHECK(match_status IN
                              ('all_three','stripe_netlify','stripe_email','netlify_email',
                               'stripe_only','netlify_only','email_only','manual','needs_review')),
  app_status               TEXT NOT NULL DEFAULT 'new'
                              CHECK(app_status IN ('new','confirmed','fulfilled','cancelled','refunded')),
  stock_applied            INTEGER NOT NULL DEFAULT 0,
  raw_stripe_json          TEXT,
  raw_netlify_json         TEXT,
  raw_graph_json           TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO orders_new (
  id, stripe_session_id, netlify_submission_id, graph_message_id, source,
  customer_name, customer_email, customer_phone, total_cents, currency,
  paid_at, manually_marked_paid, manual_paid_at,
  design_slug, finish_id, palette_id, addon_ids_json,
  fulfilment, date_needed, occasion, recipient, notes,
  match_status, app_status, stock_applied,
  raw_stripe_json, raw_netlify_json, raw_graph_json,
  created_at, updated_at
)
SELECT
  id, stripe_session_id, netlify_submission_id, graph_message_id, 'stripe',
  customer_name, customer_email, customer_phone, total_cents, currency,
  paid_at, 0, NULL,
  design_slug, finish_id, palette_id, addon_ids_json,
  fulfilment, date_needed, occasion, recipient, notes,
  match_status, app_status, stock_applied,
  raw_stripe_json, raw_netlify_json, raw_graph_json,
  created_at, updated_at
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX idx_orders_paid ON orders(paid_at DESC);
CREATE INDEX idx_orders_status ON orders(app_status);
CREATE INDEX idx_orders_match ON orders(match_status);
CREATE INDEX idx_orders_source ON orders(source);
