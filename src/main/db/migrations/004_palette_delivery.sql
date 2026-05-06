-- 004_palette_delivery.sql
-- Capture two more pieces of structured order data the website already sends
-- but the app was previously dropping:
--   - custom_palette: free-text palette description from the BYO custom-palette
--                     option ("Tell us — custom"). Sent in Stripe metadata and
--                     as a Netlify form field.
--   - delivery_zone:  one of 'bathurst' | 'nearby' | 'elsewhere' | 'pickup'.
--                     Drives the shipping fee. Currently only the human-
--                     readable `fulfilment` string is preserved.
--   - delivery_suburb: free-text suburb when zone is 'elsewhere' (used to
--                     produce a manual quote).
--
-- Additive migration. Existing rows get NULL for all three.

ALTER TABLE orders ADD COLUMN custom_palette  TEXT;
ALTER TABLE orders ADD COLUMN delivery_zone   TEXT;
ALTER TABLE orders ADD COLUMN delivery_suburb TEXT;

CREATE INDEX idx_orders_delivery_zone ON orders(delivery_zone);
