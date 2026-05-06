-- 019_orders_rush.sql
-- Adds `rush_order` and `rush_fee` columns to orders.
--
-- The website's BYO/bundles checkout shipped a $25 rush-order tier — when
-- a customer picks a date_needed within 7 days of today, a checkbox lets
-- them add a flat $25 surcharge for 24–48 hour turnaround. The flag rides
-- through both Stripe Checkout Session metadata AND the Netlify Forms
-- payload. Without these columns, both parsers silently drop the fields
-- and Jade has no way to spot a rush order in the inventory app.
--
--   rush_order = 'yes' when the customer ticked the rush box, otherwise NULL
--   rush_fee   = '25.00' (string, GST-inclusive) when ticked, otherwise NULL
--
-- Stored as TEXT so the values round-trip cleanly with what the website
-- already sends — no parsing on the way in. Existing rows backfill as
-- NULL (no rush) and the OrderDetail page renders a badge only when
-- rush_order = 'yes'.

ALTER TABLE orders ADD COLUMN rush_order TEXT;
ALTER TABLE orders ADD COLUMN rush_fee TEXT;
