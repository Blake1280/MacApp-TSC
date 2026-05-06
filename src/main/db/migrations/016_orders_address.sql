-- 016_orders_address.sql
-- Adds an `address` column to orders.
--
-- The website's Netlify form has been collecting `address` since launch but
-- neither the Stripe nor the Netlify parser stored it — the value was being
-- silently dropped on the floor. After this migration, both parsers thread
-- it through and the Order Detail page renders it next to delivery_zone /
-- delivery_suburb.
--
-- Migration is additive only — existing rows get NULL and the parsers fill
-- it in on the next sync of those orders (Netlify enrichment overwrites
-- where Stripe was the only source).

ALTER TABLE orders ADD COLUMN address TEXT;
