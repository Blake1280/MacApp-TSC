// Verify the per-tab format end-to-end:
//   1. parse the build-script output (the workspace template)
//   2. build a fresh workbook in the same shape (simulating exportStocktake)
//   3. re-parse and confirm every row resolves
import * as XLSX from 'xlsx';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

XLSX.set_fs({ readFileSync });

// 1. Read the workspace template
const inPath = 'C:\\Users\\bsell\\Desktop\\The Sweet Creative\\Stocktake Spreadsheet\\sweet-creative-stocktake.xlsx';
if (!existsSync(inPath)) { console.error('missing input', inPath); process.exit(1); }
const wbIn = XLSX.read(readFileSync(inPath), { type: 'buffer' });
console.log('Tabs in template:', wbIn.SheetNames);

function looksLikeStock(sheet) {
  for (const range of [undefined, 1]) {
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, range, raw: true });
    if (rows.length && 'sku' in rows[0] && 'name' in rows[0]) return true;
  }
  return false;
}
function readRows(sheet) {
  for (const range of [undefined, 1]) {
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, range, raw: true });
    if (rows.length && 'sku' in rows[0]) return rows;
  }
  return [];
}

const dataTabs = wbIn.SheetNames.filter(n => looksLikeStock(wbIn.Sheets[n]));
console.log(`Data tabs (have sku+name): ${dataTabs.length} — ${dataTabs.join(' | ')}`);

const allItems = [];
for (const tab of dataTabs) {
  const rows = readRows(wbIn.Sheets[tab]);
  console.log(`  ${tab}: ${rows.length} rows`);
  for (const r of rows) allItems.push({ ...r, category: tab });
}
console.log(`Total items across all tabs: ${allItems.length}`);

// SKU uniqueness check
const skus = allItems.map(i => i.sku);
const dups = skus.filter((s, i) => skus.indexOf(s) !== i);
if (dups.length) { console.error('FAIL: duplicate SKUs across tabs:', dups); process.exit(1); }
console.log('All SKUs unique across tabs.');

// 2. Simulate exportStocktake — group by category, write per-tab xlsx
const groups = new Map();
for (const it of allItems) {
  if (!groups.has(it.category)) groups.set(it.category, []);
  groups.get(it.category).push(it);
}
const wbOut = XLSX.utils.book_new();
for (const [cat, items] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  const aoa = [
    [`Category: ${cat}.`, '', '', '', ''],
    ['sku', 'name', 'on_hand', 'reorder_at', 'notes'],
    ...items.map(i => [i.sku, i.name, i.on_hand, i.reorder_at, i.notes ?? '']),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wbOut, sheet, cat.slice(0, 31));
}
const tmpPath = path.join(os.tmpdir(), 'tsc-roundtrip.xlsx');
writeFileSync(tmpPath, XLSX.write(wbOut, { type: 'buffer', bookType: 'xlsx' }));

// 3. Re-parse it
const wbBack = XLSX.read(readFileSync(tmpPath), { type: 'buffer' });
const reTabs = wbBack.SheetNames.filter(n => looksLikeStock(wbBack.Sheets[n]));
let reTotal = 0;
for (const tab of reTabs) reTotal += readRows(wbBack.Sheets[tab]).length;
console.log(`Round-trip: ${reTabs.length} tabs, ${reTotal} rows`);
console.log(reTotal === allItems.length ? '✓ row counts match' : `✗ FAIL: ${reTotal} vs ${allItems.length}`);

unlinkSync(tmpPath);
