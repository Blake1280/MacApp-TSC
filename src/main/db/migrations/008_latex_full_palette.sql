-- 008_latex_full_palette.sql
-- Adds the rest of the standard latex-balloon colour range as inventory items.
-- Migrations 006 baked in 5 colour variants (mixed pack + blush, white,
-- black, gold) — useful for the BYO palettes but a real cluster needs the
-- full standard set. This migration backfills 15 more so each colour has
-- its own row in the Stock page and the regenerated stocktake spreadsheet.
--
-- Each new row also gets supplier sources (Stylex preferred, Hayden's +
-- Online Party Supplies as fallbacks) — same as the original 5.
--
-- Idempotent via INSERT OR IGNORE on a UNIQUE sku constraint, so re-running
-- this migration does nothing on top of existing rows.

INSERT OR IGNORE INTO inventory_items (sku, name, category, unit, on_hand, reorder_at, notes)
VALUES
  ('balloon-latex-5in-baby-blue',   '5-inch latex pack — baby blue',     'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-chrome',      '5-inch latex pack — chrome silver', 'Balloons - Latex', 'pack', 0, 2, 'High-shine chrome finish'),
  ('balloon-latex-5in-cream',       '5-inch latex pack — cream / ivory', 'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-hot-pink',    '5-inch latex pack — hot pink',      'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-lilac',       '5-inch latex pack — lilac',         'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-mint',        '5-inch latex pack — mint',          'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-navy',        '5-inch latex pack — navy blue',     'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-nude',        '5-inch latex pack — nude / sand',   'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-orange',      '5-inch latex pack — orange',        'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-peach',       '5-inch latex pack — peach',         'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-purple',      '5-inch latex pack — purple',        'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-red',         '5-inch latex pack — red',           'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-rose-gold',   '5-inch latex pack — rose gold',     'Balloons - Latex', 'pack', 0, 2, 'Very popular for milestones'),
  ('balloon-latex-5in-sage',        '5-inch latex pack — sage green',    'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-silver',      '5-inch latex pack — silver',        'Balloons - Latex', 'pack', 0, 2, ''),
  ('balloon-latex-5in-yellow',      '5-inch latex pack — yellow',        'Balloons - Latex', 'pack', 0, 2, '');

-- Supplier sources for the new SKUs. Same shape as migration 006's bake-in:
-- Stylex Balloons (preferred — quality + fast shipping), Hayden Agencies
-- (backup), Online Party Supplies (further backup).
-- URL is NULL on these — only specific product pages get baked in. Jade fills
-- per-colour links over time using the inline "+ Add link" affordance.

INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
SELECT id, 'Stylex Balloons', NULL, 1,
  'Great quality + next-day to 2-day shipping. Login: kirstyjablonskis@outlook.com.'
FROM inventory_items
WHERE sku IN (
  'balloon-latex-5in-baby-blue', 'balloon-latex-5in-chrome', 'balloon-latex-5in-cream',
  'balloon-latex-5in-hot-pink', 'balloon-latex-5in-lilac', 'balloon-latex-5in-mint',
  'balloon-latex-5in-navy', 'balloon-latex-5in-nude', 'balloon-latex-5in-orange',
  'balloon-latex-5in-peach', 'balloon-latex-5in-purple', 'balloon-latex-5in-red',
  'balloon-latex-5in-rose-gold', 'balloon-latex-5in-sage', 'balloon-latex-5in-silver',
  'balloon-latex-5in-yellow'
)
AND NOT EXISTS (
  SELECT 1 FROM inventory_supplier_sources s
  WHERE s.inventory_item_id = inventory_items.id
    AND s.supplier_name = 'Stylex Balloons'
);

INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
SELECT id, 'Hayden Agencies', NULL, 0, 'Backup for latex when Stylex is out.'
FROM inventory_items
WHERE sku IN (
  'balloon-latex-5in-baby-blue', 'balloon-latex-5in-chrome', 'balloon-latex-5in-cream',
  'balloon-latex-5in-hot-pink', 'balloon-latex-5in-lilac', 'balloon-latex-5in-mint',
  'balloon-latex-5in-navy', 'balloon-latex-5in-nude', 'balloon-latex-5in-orange',
  'balloon-latex-5in-peach', 'balloon-latex-5in-purple', 'balloon-latex-5in-red',
  'balloon-latex-5in-rose-gold', 'balloon-latex-5in-sage', 'balloon-latex-5in-silver',
  'balloon-latex-5in-yellow'
)
AND NOT EXISTS (
  SELECT 1 FROM inventory_supplier_sources s
  WHERE s.inventory_item_id = inventory_items.id
    AND s.supplier_name = 'Hayden Agencies'
);

INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
SELECT id, 'Online Party Supplies', NULL, 0, 'Different balloons, tassels and Orbz.'
FROM inventory_items
WHERE sku IN (
  'balloon-latex-5in-baby-blue', 'balloon-latex-5in-chrome', 'balloon-latex-5in-cream',
  'balloon-latex-5in-hot-pink', 'balloon-latex-5in-lilac', 'balloon-latex-5in-mint',
  'balloon-latex-5in-navy', 'balloon-latex-5in-nude', 'balloon-latex-5in-orange',
  'balloon-latex-5in-peach', 'balloon-latex-5in-purple', 'balloon-latex-5in-red',
  'balloon-latex-5in-rose-gold', 'balloon-latex-5in-sage', 'balloon-latex-5in-silver',
  'balloon-latex-5in-yellow'
)
AND NOT EXISTS (
  SELECT 1 FROM inventory_supplier_sources s
  WHERE s.inventory_item_id = inventory_items.id
    AND s.supplier_name = 'Online Party Supplies'
);
