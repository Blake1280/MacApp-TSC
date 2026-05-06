-- 001_initial.sql
-- Full schema for The Sweet Creative inventory app.
-- Designed for: composable recipes (design + finish + palette + add-ons),
-- 3-source order reconciliation keyed by stripe_session_id,
-- auditable stock movements.

CREATE TABLE inventory_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT,
  unit        TEXT NOT NULL DEFAULT 'each',
  on_hand     INTEGER NOT NULL DEFAULT 0,
  reorder_at  INTEGER NOT NULL DEFAULT 0,
  cost_cents  INTEGER,
  notes       TEXT,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_inv_sku ON inventory_items(sku);
CREATE INDEX idx_inv_low ON inventory_items(on_hand, reorder_at) WHERE archived = 0;

CREATE TABLE catalogue_entries (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                TEXT NOT NULL CHECK(kind IN ('design','finish','palette','addon')),
  external_id         TEXT NOT NULL,
  name                TEXT NOT NULL,
  price_cents         INTEGER,
  default_finish_id   TEXT,
  default_palette_id  TEXT,
  archived            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind, external_id)
);

CREATE INDEX idx_cat_kind ON catalogue_entries(kind, archived);

CREATE TABLE recipe_components (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  catalogue_id      INTEGER NOT NULL REFERENCES catalogue_entries(id) ON DELETE CASCADE,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity          REAL NOT NULL CHECK(quantity > 0),
  UNIQUE(catalogue_id, inventory_item_id)
);

CREATE INDEX idx_recipe_catalogue ON recipe_components(catalogue_id);

CREATE TABLE orders (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_session_id        TEXT NOT NULL UNIQUE,
  netlify_submission_id    TEXT UNIQUE,
  graph_message_id         TEXT UNIQUE,
  customer_name            TEXT,
  customer_email           TEXT,
  customer_phone           TEXT,
  total_cents              INTEGER NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'aud',
  paid_at                  TEXT,
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
                              ('all_three','stripe_netlify','stripe_email','stripe_only','needs_review')),
  app_status               TEXT NOT NULL DEFAULT 'new'
                              CHECK(app_status IN ('new','confirmed','fulfilled','cancelled','refunded')),
  stock_applied            INTEGER NOT NULL DEFAULT 0,
  raw_stripe_json          TEXT,
  raw_netlify_json         TEXT,
  raw_graph_json           TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_orders_paid ON orders(paid_at DESC);
CREATE INDEX idx_orders_status ON orders(app_status);
CREATE INDEX idx_orders_match ON orders(match_status);

CREATE TABLE stock_movements (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id  INTEGER NOT NULL REFERENCES inventory_items(id),
  delta              INTEGER NOT NULL,
  reason             TEXT NOT NULL CHECK(reason IN
                       ('order_apply','order_reverse','manual_adjust','opening_balance','correction','off_site_sale','restock')),
  order_id           INTEGER REFERENCES orders(id),
  catalogue_id       INTEGER REFERENCES catalogue_entries(id),
  note               TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_movements_item ON stock_movements(inventory_item_id, created_at DESC);
CREATE INDEX idx_movements_order ON stock_movements(order_id);

CREATE TABLE sync_state (
  source           TEXT PRIMARY KEY CHECK(source IN ('stripe','graph','netlify')),
  last_run_at      TEXT,
  last_success_at  TEXT,
  last_cursor      TEXT,
  last_error       TEXT
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
