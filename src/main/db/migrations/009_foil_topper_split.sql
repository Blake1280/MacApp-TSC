-- 009_foil_topper_split.sql
-- Splits the single "Balloons - Foil topper" category into three:
--   - Balloons - Foil letters  (A-Z + a generic pool)
--   - Balloons - Foil numbers  (0-9 + a generic pool)
--   - Balloons - Foil themes   (themed shapes — Jade adds as she stocks them)
--
-- The existing 3 generic SKUs (foil-topper-letter / -number / -shape)
-- stay — they act as "any of this kind" pool entries that recipes still
-- reference. We just rename them to make their pool role explicit and
-- recategorise them into the new three-tab structure.
--
-- Per-letter and per-digit SKUs are inserted with INSERT OR IGNORE so the
-- migration is idempotent (re-running does nothing).

-- 1. Recategorise + rename the three existing pool SKUs.

UPDATE inventory_items
SET name = 'Foil topper — any letter (pool)',
    category = 'Balloons - Foil letters',
    notes = COALESCE(NULLIF(notes, ''), 'Generic pool — used when the specific letter doesn''t need tracking.'),
    updated_at = datetime('now')
WHERE sku = 'foil-topper-letter';

UPDATE inventory_items
SET name = 'Foil topper — any number (pool)',
    category = 'Balloons - Foil numbers',
    notes = COALESCE(NULLIF(notes, ''), 'Generic pool — used when the specific number doesn''t need tracking.'),
    updated_at = datetime('now')
WHERE sku = 'foil-topper-number';

UPDATE inventory_items
SET name = 'Foil topper — themed shape (pool)',
    category = 'Balloons - Foil themes',
    notes = COALESCE(NULLIF(notes, ''), 'Hearts, stars, bunnies, etc. Add specific themed-shape rows as you stock them.'),
    updated_at = datetime('now')
WHERE sku = 'foil-topper-shape';

-- 2. Per-letter SKUs (A-Z). reorder_at = 1 since each specific letter is
--    individually low-volume — Jade restocks the one a customer needs.

INSERT OR IGNORE INTO inventory_items (sku, name, category, unit, on_hand, reorder_at, notes) VALUES
  ('foil-topper-letter-a', 'Foil topper — letter A', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-b', 'Foil topper — letter B', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-c', 'Foil topper — letter C', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-d', 'Foil topper — letter D', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-e', 'Foil topper — letter E', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-f', 'Foil topper — letter F', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-g', 'Foil topper — letter G', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-h', 'Foil topper — letter H', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-i', 'Foil topper — letter I', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-j', 'Foil topper — letter J', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-k', 'Foil topper — letter K', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-l', 'Foil topper — letter L', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-m', 'Foil topper — letter M', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-n', 'Foil topper — letter N', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-o', 'Foil topper — letter O', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-p', 'Foil topper — letter P', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-q', 'Foil topper — letter Q', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-r', 'Foil topper — letter R', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-s', 'Foil topper — letter S', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-t', 'Foil topper — letter T', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-u', 'Foil topper — letter U', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-v', 'Foil topper — letter V', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-w', 'Foil topper — letter W', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-x', 'Foil topper — letter X', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-y', 'Foil topper — letter Y', 'Balloons - Foil letters', 'each', 0, 1, ''),
  ('foil-topper-letter-z', 'Foil topper — letter Z', 'Balloons - Foil letters', 'each', 0, 1, '');

-- 3. Per-digit SKUs (0-9). reorder_at = 2 since milestone numbers (1, 2, 5, 0) repeat often.

INSERT OR IGNORE INTO inventory_items (sku, name, category, unit, on_hand, reorder_at, notes) VALUES
  ('foil-topper-number-0', 'Foil topper — number 0', 'Balloons - Foil numbers', 'each', 0, 2, ''),
  ('foil-topper-number-1', 'Foil topper — number 1', 'Balloons - Foil numbers', 'each', 0, 2, ''),
  ('foil-topper-number-2', 'Foil topper — number 2', 'Balloons - Foil numbers', 'each', 0, 2, ''),
  ('foil-topper-number-3', 'Foil topper — number 3', 'Balloons - Foil numbers', 'each', 0, 2, ''),
  ('foil-topper-number-4', 'Foil topper — number 4', 'Balloons - Foil numbers', 'each', 0, 2, ''),
  ('foil-topper-number-5', 'Foil topper — number 5', 'Balloons - Foil numbers', 'each', 0, 2, ''),
  ('foil-topper-number-6', 'Foil topper — number 6', 'Balloons - Foil numbers', 'each', 0, 2, ''),
  ('foil-topper-number-7', 'Foil topper — number 7', 'Balloons - Foil numbers', 'each', 0, 2, ''),
  ('foil-topper-number-8', 'Foil topper — number 8', 'Balloons - Foil numbers', 'each', 0, 2, ''),
  ('foil-topper-number-9', 'Foil topper — number 9', 'Balloons - Foil numbers', 'each', 0, 2, '');

-- 4. Supplier sources for the 36 new SKUs (Online Party Supplies preferred,
--    Hayden Agencies as backup). URLs are NULL — Jade pastes the specific
--    product URL inline as she finds them. Idempotent via NOT EXISTS.

INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
SELECT id, 'Online Party Supplies', NULL, 1, 'Range of foil shapes, letters and numbers.'
FROM inventory_items
WHERE (sku LIKE 'foil-topper-letter-%' OR sku LIKE 'foil-topper-number-%')
  AND NOT EXISTS (
    SELECT 1 FROM inventory_supplier_sources s
    WHERE s.inventory_item_id = inventory_items.id
      AND s.supplier_name = 'Online Party Supplies'
  );

INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
SELECT id, 'Hayden Agencies', NULL, 0, 'Backup supplier for foils.'
FROM inventory_items
WHERE (sku LIKE 'foil-topper-letter-%' OR sku LIKE 'foil-topper-number-%')
  AND NOT EXISTS (
    SELECT 1 FROM inventory_supplier_sources s
    WHERE s.inventory_item_id = inventory_items.id
      AND s.supplier_name = 'Hayden Agencies'
  );
