-- 005_time_needed.sql
-- Adds a structured "preferred time" alongside `date_needed`. Some pickups
-- and deliveries need a specific time (e.g. "pickup 2pm" or "delivery 10am
-- before the surprise lunch"). Stored as a free-form HH:MM string — kept
-- separate from date_needed so date-only orders stay clean.
--
-- Additive migration. Existing rows get NULL.

ALTER TABLE orders ADD COLUMN time_needed TEXT;
