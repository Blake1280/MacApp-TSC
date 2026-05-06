-- 006_supplier_sources.sql
-- Multi-supplier reorder sources per inventory item.
--
-- Why a separate table (not a single reorder_url column on inventory_items):
-- many items have more than one viable supplier (e.g. bubble balloons can
-- come from Hayden Agencies as primary OR Jay Jay the Balloon Guy when
-- Hayden's is out of stock). Storing the suppliers separately lets Jade
-- record per-supplier prices over time — and the Reorder UI can then
-- always show the cheapest known option at the top of the list.
--
-- `unit_price_cents` is what she paid last time at this supplier (NULL
-- until she records one). `is_preferred` flags the supplier she usually
-- buys from when prices are equal — only one preferred row per item.

CREATE TABLE inventory_supplier_sources (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  supplier_name     TEXT NOT NULL,
  url               TEXT NOT NULL,
  unit_price_cents  INTEGER,
  is_preferred      INTEGER NOT NULL DEFAULT 0 CHECK(is_preferred IN (0,1)),
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_supplier_sources_item ON inventory_supplier_sources(inventory_item_id);
CREATE INDEX idx_supplier_sources_preferred ON inventory_supplier_sources(inventory_item_id, is_preferred);

-- ------------------------------------------------------------------
-- Bake-in: known supplier URLs per SKU. Sourced from the supplier guide
-- PDF Jade provided. Each block is `INSERT … SELECT FROM inventory_items
-- WHERE sku = ?` so missing SKUs are silently skipped (won't break the
-- migration if Jade hasn't seeded those items yet).
-- ------------------------------------------------------------------

-- Bubble balloons
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Hayden Agencies', 'https://haydenagencies.com.au/', 1,
    'For literally everything balloon + party. Login: jadepayne1998@gmail.com.'
  FROM inventory_items WHERE sku = 'balloon-bubble-24in';
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Jay Jay the Balloon Guy', 'https://www.balloonguy.com.au/product-category/bubble-balloons', 0,
    'Backup for stuffing balloons when Hayden''s is out of stock.'
  FROM inventory_items WHERE sku = 'balloon-bubble-24in';

-- Latex balloons (mixed pack + per-colour)
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Stylex Balloons', 'https://stylex.com.au/', 1,
    'Great quality + next-day to 2-day shipping. Login: kirstyjablonskis@outlook.com.'
  FROM inventory_items WHERE sku IN
    ('balloon-latex-5in-pack', 'balloon-latex-5in-blush', 'balloon-latex-5in-white',
     'balloon-latex-5in-black', 'balloon-latex-5in-gold');
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Hayden Agencies', 'https://haydenagencies.com.au/', 0,
    'Backup for latex when Stylex is out.'
  FROM inventory_items WHERE sku IN
    ('balloon-latex-5in-pack', 'balloon-latex-5in-blush', 'balloon-latex-5in-white',
     'balloon-latex-5in-black', 'balloon-latex-5in-gold');
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Online Party Supplies', 'https://onlinepartysupplies.com.au/', 0,
    'Different balloons, tassels and Orbz.'
  FROM inventory_items WHERE sku IN
    ('balloon-latex-5in-pack', 'balloon-latex-5in-blush', 'balloon-latex-5in-white',
     'balloon-latex-5in-black', 'balloon-latex-5in-gold');

-- Foil toppers
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Online Party Supplies', 'https://onlinepartysupplies.com.au/', 1,
    'Range of foil shapes, letters and numbers.'
  FROM inventory_items WHERE sku IN ('foil-topper-letter', 'foil-topper-number', 'foil-topper-shape');
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Hayden Agencies', 'https://haydenagencies.com.au/', 0, NULL
  FROM inventory_items WHERE sku IN ('foil-topper-letter', 'foil-topper-number', 'foil-topper-shape');

-- Ribbons (curled + satin)
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Koch and Co', 'https://www.koch.com.au/', 1,
    'Cello paper + shredded paper + ribbon. Wholesale.'
  FROM inventory_items WHERE sku IN ('ribbon-curled-roll', 'ribbon-satin-roll');

-- Shredded paper (silver / gold / white / black)
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Koch and Co', 'https://www.koch.com.au/search?options%5Bprefix%5D=last&q=shredded+paper', 1, NULL
  FROM inventory_items WHERE sku IN
    ('shredded-paper-silver', 'shredded-paper-gold', 'shredded-paper-white', 'shredded-paper-black');

-- Gift box (medium) — the PDF mentions $7/box (Discount Party Supplies) vs $10/box (Discount Party Warehouse)
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, unit_price_cents, is_preferred, notes)
  SELECT id, 'Discount Party Supplies', 'https://discountpartysupplies.com.au/', 700, 1,
    'Cheapest at $7 a box per Jade''s notes. URL is the homepage — search for stackable / fillable balloon boxes.'
  FROM inventory_items WHERE sku = 'gift-box-medium';
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, unit_price_cents, is_preferred, notes)
  SELECT id, 'Discount Party Warehouse', 'https://discountpartywarehouse.com.au/', 1000, 0,
    '$10 a box per Jade''s notes. Good for elf return + stackable / fillable boxes.'
  FROM inventory_items WHERE sku = 'gift-box-medium';
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Cello Packs', 'https://cellopacks.com.au/', 0,
    'Peel-and-seal bags option.'
  FROM inventory_items WHERE sku = 'gift-box-medium';
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Jay Jay the Balloon Guy', 'https://www.balloonguy.com.au/', 0,
    'Also stocks balloon boxes.'
  FROM inventory_items WHERE sku = 'gift-box-medium';

-- Vinyl letter sheets
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Skat Katz', 'https://skatkatz.com.au', 1,
    'Their specialty.'
  FROM inventory_items WHERE sku = 'vinyl-letter-sheet';

-- Cake sparklers, confetti popper, gender-reveal popper, fairy lights
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Online Party Supplies', 'https://onlinepartysupplies.com.au/', 1, NULL
  FROM inventory_items WHERE sku IN
    ('cake-sparkler-pack', 'confetti-pop-handpull', 'gender-reveal-popper', 'fairy-lights-string');
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Hayden Agencies', 'https://haydenagencies.com.au/', 0, NULL
  FROM inventory_items WHERE sku IN
    ('cake-sparkler-pack', 'confetti-pop-handpull', 'gender-reveal-popper', 'fairy-lights-string');

-- Plush, baby muslin, milestone cards (themed crafts)
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'For the Love of Craft', 'https://fortheloveofcraftsaustralia.com.au/', 1,
    'Crafting blanks + themed products.'
  FROM inventory_items WHERE sku IN
    ('plush-bunny', 'plush-bear', 'plush-elephant', 'baby-muslin-wrap', 'milestone-cards-pack');
INSERT INTO inventory_supplier_sources (inventory_item_id, supplier_name, url, is_preferred, notes)
  SELECT id, 'Hayden Agencies', 'https://haydenagencies.com.au/', 0,
    'Backup for plush.'
  FROM inventory_items WHERE sku IN ('plush-bunny', 'plush-bear', 'plush-elephant');
