// Smoke-test the XLSX parsing layer of stocktakeXlsxImporter without
// touching the SQLite repos. Verifies the sheet shape we ship matches what
// the importer expects.
import * as XLSX from 'xlsx';
import { existsSync, readFileSync } from 'node:fs';

const path = 'C:\\Users\\bsell\\Desktop\\The Sweet Creative\\sweet-creative-stocktake.xlsx';
if (!existsSync(path)) { console.error('XLSX missing:', path); process.exit(1); }

XLSX.set_fs({ readFileSync });
const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
console.log('Sheets:', wb.SheetNames);

function readSheet(name, required) {
  for (const range of [undefined, 1]) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null, range, raw: true });
    if (rows.length && required.every(c => c in rows[0])) {
      console.log(`  ${name}: ${rows.length} rows  range-offset=${range ?? 0}`);
      return rows;
    }
  }
  console.error(`  ${name}: missing required columns ${required.join(', ')}`);
  process.exit(1);
}

const inv = readSheet('Inventory_Items', ['sku', 'name']);
const cat = readSheet('Catalogue_Entries', ['kind', 'external_id', 'name']);
const rec = readSheet('Recipes', ['catalogue_kind', 'catalogue_external_id', 'inventory_sku', 'quantity']);

// Cross-reference: every recipe row's catalogue_external_id should appear in cat sheet,
// and inventory_sku should appear in inv sheet. Catches mistyped ids.
const catKeys = new Set(cat.map(r => `${r.kind}:${r.external_id}`));
const skuKeys = new Set(inv.map(r => r.sku));
let unresolved = 0;
for (const r of rec) {
  const k = `${r.catalogue_kind}:${r.catalogue_external_id}`;
  if (!catKeys.has(k)) { console.error(`  recipe -> missing catalogue: ${k}`); unresolved++; }
  if (!skuKeys.has(r.inventory_sku)) { console.error(`  recipe -> missing inventory sku: ${r.inventory_sku}`); unresolved++; }
}

if (unresolved > 0) { console.error(`FAIL: ${unresolved} unresolved recipe references`); process.exit(1); }

console.log(`\nOK: ${inv.length} inventory + ${cat.length} catalogue + ${rec.length} recipe rows, all references resolved.`);
console.log('  sample inv row:', inv[0]);
console.log('  sample cat row:', cat[0]);
console.log('  sample rec row:', rec[0]);
