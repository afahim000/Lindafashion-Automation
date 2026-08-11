const fs = require('fs');
const path = require('path');
const XLSX = require('./backend/node_modules/xlsx');

const targets = [
  'SPX-CB-7015', 'SPX-CB-7016', 'SPX-CB-7020', 'SPX-CB-7021', 'SPX-CB-7022',
  'SPX-CB-7023', 'SPX-CB-7024', 'SPX-CB-7025', 'SPX-CB-7026', 'SPX-CB-7027',
  'SPX-CB-7030', 'SPX-CB-7031', 'SPX-CB-7032', 'SPX-CB-7033', 'SPX-CB-7034',
  'SPX-CB-7035', 'SPX-CB-7036', 'SPX-CB-7037', 'SPX-CB-7039', 'SPX-CB-7040',
  'SPX-CN-7060', 'SPX-CN-7061', 'SPX-CN-7062', 'SPX-CN-7063', 'SPX-CN-7064',
  'SPX-HOG-7226', 'SPX-HOG-7228', 'SPX-HOG-7233', 'SPX-HOS-7229',
  'SPX-HOS-7234', 'SPX-HOS-7236', 'SPX-PBG-7126', 'T10122',
];

const inputDir = path.resolve('item_search_inputs');
const files = fs.readdirSync(inputDir)
  .filter((name) => /\.(xlsx|xls)$/i.test(name))
  .sort();
const found = new Map(targets.map((item) => [item, []]));
const errors = [];

for (const filename of files) {
  try {
    const workbook = XLSX.readFile(path.join(inputDir, filename), {
      cellDates: true,
      raw: true,
    });
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      for (const [address, cell] of Object.entries(sheet)) {
        if (address.startsWith('!')) continue;
        const text = String(cell.v ?? cell.w ?? '');
        for (const item of targets) {
          if (text.toUpperCase().includes(item.toUpperCase())) {
            found.get(item).push({ filename, sheet: sheetName, cell: address, value: text });
          }
        }
      }
    }
  } catch (error) {
    errors.push({ filename, error: error.message });
  }
}

const matches = [...found.entries()]
  .filter(([, locations]) => locations.length)
  .map(([item, locations]) => ({ item, locations }));
const missing = [...found.entries()]
  .filter(([, locations]) => !locations.length)
  .map(([item]) => item);

console.log(JSON.stringify({
  filesSearched: files.length,
  matchedItems: matches.length,
  missingItems: missing.length,
  matches,
  missing,
  errors,
}, null, 2));
