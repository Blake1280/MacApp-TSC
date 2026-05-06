-- 007_supplier_url_nullable.sql
-- Two changes:
--   1. The `url` column on inventory_supplier_sources becomes nullable.
--      A NULL url means "this is a known supplier but I haven't found / saved
--      the specific product page yet" — the UI shows "Supplier not linked"
--      with an inline "+ Add link" affordance.
--   2. We clear any URL we'd previously baked in that's just a supplier
--      homepage. Only deep-links to specific product / category / search
--      pages survive — homepage URLs were guess-y and not what Jade asked
--      for. She can fill the rest in over time as she finds them.
--
-- SQLite doesn't support DROP NOT NULL, so we rebuild the table.

CREATE TABLE inventory_supplier_sources_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  supplier_name     TEXT NOT NULL,
  url               TEXT,
  unit_price_cents  INTEGER,
  is_preferred      INTEGER NOT NULL DEFAULT 0 CHECK(is_preferred IN (0,1)),
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO inventory_supplier_sources_new
  (id, inventory_item_id, supplier_name, url, unit_price_cents, is_preferred, notes, created_at, updated_at)
SELECT
  id, inventory_item_id, supplier_name, url, unit_price_cents, is_preferred, notes, created_at, updated_at
FROM inventory_supplier_sources;

DROP TABLE inventory_supplier_sources;
ALTER TABLE inventory_supplier_sources_new RENAME TO inventory_supplier_sources;

CREATE INDEX idx_supplier_sources_item ON inventory_supplier_sources(inventory_item_id);
CREATE INDEX idx_supplier_sources_preferred ON inventory_supplier_sources(inventory_item_id, is_preferred);

-- Clear all the bare-homepage URLs we baked in. The two specific URLs Jade
-- gave us (balloonguy bubble-balloons category, Koch shredded-paper search)
-- stay because they're actual deep-links, not generic landing pages.
UPDATE inventory_supplier_sources SET url = NULL WHERE url IN (
  'https://haydenagencies.com.au/',
  'https://onlinepartysupplies.com.au/',
  'https://www.koch.com.au/',
  'https://discountpartywarehouse.com.au/',
  'https://discountpartysupplies.com.au/',
  'https://cellopacks.com.au/',
  'https://fortheloveofcraftsaustralia.com.au/',
  'https://skatkatz.com.au',
  'https://stylex.com.au/',
  'https://www.balloonguy.com.au/'
);
