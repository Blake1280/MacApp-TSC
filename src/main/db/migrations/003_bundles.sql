-- 003_bundles.sql
-- Adds first-class bundle support to the orders table.
--
-- Why: the website's Bundles flow sends `flow_type`, `bundle_id`,
-- `bundle_name` and `locked_addons_csv` in both Stripe metadata and
-- Netlify form submissions. Without these columns, the sync code drops
-- the data on the floor and the stock applier can't deduct the bundle's
-- locked gift contents — only the customer-selected trim addons end up
-- in `addon_ids_json`, leaving fixed gifts as silent overstock.
--
-- Migration is additive only — existing rows default to flow_type='byo',
-- which preserves their original semantics exactly.

ALTER TABLE orders ADD COLUMN flow_type TEXT NOT NULL DEFAULT 'byo'
  CHECK(flow_type IN ('byo','bundle'));

ALTER TABLE orders ADD COLUMN bundle_id TEXT;
ALTER TABLE orders ADD COLUMN bundle_name TEXT;
ALTER TABLE orders ADD COLUMN locked_addons_csv TEXT;

CREATE INDEX idx_orders_flow_type ON orders(flow_type);
CREATE INDEX idx_orders_bundle_id ON orders(bundle_id);
