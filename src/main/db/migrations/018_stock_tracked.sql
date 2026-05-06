-- 018_stock_tracked.sql
-- Adds a `stock_tracked` flag to inventory_items.
--
-- The website's get-stock-levels API reads stock_levels from Supabase and
-- the front-end blacks out any addon / finish whose linked SKU has
-- on_hand = 0 (or whose recipe has any zero-stock component). For items
-- Jade orders per-order rather than keeping in the boutique (wine, candles,
-- some addons), on_hand = 0 is the steady-state — she's not "out of stock",
-- she just doesn't pre-stock them. With a strict on-hand check, those
-- tiles permanently grey out on the website even though the customer can
-- absolutely order one.
--
-- This flag separates "stock-tracked" (counted regularly, real on_hand
-- matters for availability) from "always available" (per-order; on_hand
-- is informational only, never used to gate website availability).
--
--   stock_tracked = 1 → counted item; on_hand drives website availability
--   stock_tracked = 0 → per-order; on_hand ignored by pushStock + recipes
--
-- Defaults to 1 so existing items keep their current behaviour. Jade
-- toggles per-order items off via the Stock page UI.

ALTER TABLE inventory_items
  ADD COLUMN stock_tracked INTEGER NOT NULL DEFAULT 1
    CHECK(stock_tracked IN (0, 1));

CREATE INDEX idx_inv_tracked ON inventory_items(stock_tracked, archived);
