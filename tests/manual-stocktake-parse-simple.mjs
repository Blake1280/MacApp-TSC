// Verify the simple single-sheet format parses correctly with the same
// row-detection logic the importer uses.
import * as XLSX from 'xlsx';
import { existsSync, readFileSync } from 'node:fs';

const path = 'C:\\Users\\bsell\\Desktop\\The Sweet Creative\\Stocktake Spreadsheet\\sweet-creative-stocktake.xlsx';
if (!existsSync(path)) { console.error('XLSX missing:', path); process.exit(1); }

XLSX.set_fs({ readFileSync });
const wb = XLSX.read(readFileSync(path), { type: 'buffer' });

console.log('Sheets:', wb.SheetNames);
console.log('Has Stocktake:', !!wb.Sheets['Stocktake']);
console.log('Has Inventory_Items (multi):', !!wb.Sheets['Inventory_Items']);

const required = ['sku', 'name'];
let rows;
for (const range of [undefined, 1]) {
  const r = XLSX.utils.sheet_to_json(wb.Sheets['Stocktake'], { defval: null, range, raw: true });
  if (r.length && required.every(c => c in r[0])) {
    rows = r;
    console.log(`Stocktake: ${rows.length} rows  range-offset=${range ?? 0}`);
    break;
  }
}
if (!rows) { console.error('FAIL: could not detect headers'); process.exit(1); }

// Verify shape
const required_cols = ['sku', 'name', 'category', 'on_hand', 'reorder_at', 'notes'];
for (const c of required_cols) {
  if (!(c in rows[0])) { console.error(`FAIL: missing column "${c}"`); process.exit(1); }
}

console.log('\nFirst row:', rows[0]);
console.log('Last row :', rows[rows.length - 1]);
console.log(`\nOK: ${rows.length} stocktake rows.`);
