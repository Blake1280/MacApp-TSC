-- 017_catalogue_category.sql
-- Adds a `category` column to catalogue_entries.
--
-- Why: the Catalogue page in the renderer needs to mirror the website's
-- bundle / addon grouping so Jade can scan tens of bundles by category
-- ("For Her", "For Him", "Birthday", "Baby", "Gender Reveal", "Spoil",
-- "Treats") and tens of addons by group ("Sweet things", "Drinks",
-- "Pantry & food", "Homewares", "Gift items", "Finishing touches").
--
-- The website's product-data.js carries category for bundles and `group`
-- for addons. Before this migration the importer was dropping both on
-- the floor — bundles all stacked under "Designs" with no separator,
-- and addons sat as one long undifferentiated list.
--
-- After this migration the importer writes the website's category /
-- group string into this column on every upsert. The renderer groups
-- on it. NULL = no category (one-off addon added by hand, etc.).
-- Migration is additive — existing rows get NULL until next sync.

ALTER TABLE catalogue_entries ADD COLUMN category TEXT;

CREATE INDEX idx_cat_category ON catalogue_entries(kind, category, archived);
