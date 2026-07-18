const Database = require('better-sqlite3');

const dbPath = process.argv[2];
if (!dbPath) throw new Error('Usage: verify-catalogue <inventory.db>');

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const report = {
    integrity: db.pragma('integrity_check'),
    counts: db.prepare(
      `SELECT kind, COUNT(*) AS count
         FROM catalogue_entries
        WHERE archived = 0
        GROUP BY kind ORDER BY kind`,
    ).all(),
    bundles: db.prepare(
      `SELECT name, price_cents,
              (SELECT COUNT(*) FROM recipe_components r WHERE r.catalogue_id = c.id) AS recipe_lines
         FROM catalogue_entries c
        WHERE external_id LIKE 'bundle:%'
        ORDER BY name`,
    ).all(),
    inventory: db.prepare(
      `SELECT category, COUNT(*) AS count
         FROM inventory_items
        WHERE archived = 0
        GROUP BY category ORDER BY category`,
    ).all(),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  db.close();
}
