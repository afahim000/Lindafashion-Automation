const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const {
    CSV_HEADERS,
    createCsvRow,
    createCsvText,
    escapeCsvValue,
    extractPurchaseOrderNumberFromText,
    normalizePo,
    formatDate,
    normalizeUnit,
    convertExcelBufferToEdiCsv,
} = require('../services/excelToEdiCsv');

function workbookBuffer(sheets)
{
    const workbook = XLSX.utils.book_new();

    for(const [name, rows] of sheets)
    {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
    }

    return XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
    });
}

function standardRows({po = 'A0064', agent = '梁过', orderDate = '2026/07/12', deliveryDate = '2026/08/05', items = [['SPX-GSEG-6950', 120, 'DZ']] } = {})
{
    return [
        [`美国 LINDA FASHION 进出口贸易有限公司订货单`, '', '', '', '', '', '', '', '', '', po],
        ['NO', '产品型号（SKU)', 'UPC号码', '数量  Qty', '', '单价 UNIT PRICE ￥'],
        ...items.map((item, index)=> [index + 1, item[0], '', item[1], item[2], 1.2]),
        ['', '总打数', '', items.reduce((sum, item)=> sum + item[1], 0), 'DZ'],
        ['买方:', '美国 Linda Fashion', '', '', '', '', '', '卖方:', 'D2-4912', '辉煌饰品'],
        ['经办人:', '刘梦英', '', '', '', '', '', '经办人:', agent],
        ['订货日期:', orderDate, '', '', '', '', '', '交货日期', deliveryDate],
    ];
}

async function convertFixture(filename, rows, sheets = [['訂單', rows]])
{
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'linda-edi-'));
    const result = await convertExcelBufferToEdiCsv({
        buffer: workbookBuffer(sheets),
        originalFilename: filename,
        outputDirectory,
    });

    return {
        result,
        csv: fs.readFileSync(result.outputPath, 'utf8'),
        outputDirectory,
    };
}

test('CSV header has no index column', () => {
    assert.equal(CSV_HEADERS.length, 28);
    assert.equal(CSV_HEADERS[0], 'STYLE#');
    assert.equal(CSV_HEADERS[27], 'GENDER');
});

test('every output row has 28 columns', () => {
    assert.equal(createCsvRow({itemNumber: '00123', quantity: 12, unit: 'DZ'}, 'Vendor').length, 28);
});

test('PO extraction from filename works', () => {
    assert.equal(extractPurchaseOrderNumberFromText('A0064 辉煌饰品 EAR.xls'), 'A0064');
    assert.equal(extractPurchaseOrderNumberFromText('Liang 26115R.xls'), '26115R');
});

test('filename PO overrides internal workbook PO', async () => {
    const {result} = await convertFixture('A0064 file.xlsx', standardRows({po: 'A0060'}));
    assert.equal(result.po, 'A0064');
});

test('26102 normalizes to 26102R', () => {
    assert.equal(normalizePo('26102'), '26102R');
});

test('Chinese agent names map to English vendor names', async () => {
    const {result} = await convertFixture('A0064 file.xlsx', standardRows({agent: '梁过'}));
    assert.equal(result.vendor, 'Liang Guo');
});

test('Excel and string dates become YYYY-MM-DD', () => {
    assert.equal(formatDate('2026/07/14'), '2026-07-14');
    assert.equal(formatDate('2026.07.14'), '2026-07-14');
    assert.equal(formatDate(new Date(2026, 6, 14)), '2026-07-14');
});

test('item rows are extracted correctly', async () => {
    const {result} = await convertFixture('A0064 file.xlsx', standardRows({items: [['A', 1, 'DZ'], ['B', 2, 'DZ']]}));
    assert.equal(result.itemCount, 2);
    assert.equal(result.totalQuantity, 3);
});

test('打 becomes DZ', () => {
    assert.equal(normalizeUnit('打'), 'DZ');
});

test('whole quantities do not include .0', async () => {
    const {csv} = await convertFixture('A0064 file.xlsx', standardRows({items: [['A', 120, 'DZ']]}));
    assert.match(csv, /,120,DZ,/);
    assert.doesNotMatch(csv, /120\.0/);
});

test('item numbers with leading zeroes remain text', async () => {
    const {csv} = await convertFixture('A0064 file.xlsx', standardRows({items: [['00123', 12, 'DZ']]}));
    assert.match(csv, /00123,00123/);
});

test('CSV commas and quotes are escaped correctly', () => {
    assert.equal(escapeCsvValue('A,"B"'), '"A,""B"""');
});

test('A0066 displayed-total mismatch produces a warning', async () => {
    const rows = standardRows({po: 'A0066', items: [['A', 1080, 'DZ']]});
    rows[3] = ['', '总打数', '', 120, 'DZ'];
    const {result} = await convertFixture('A0066 file.xlsx', rows);
    assert.equal(result.warnings.some((warning)=> warning.includes('Displayed total')), true);
});

test('26051 reads the delivery worksheet', async () => {
    const first = standardRows({po: '26051', items: [['OLD', 1600, 'DZ']]});
    const second = [
        ['x'],
        ['x'],
        ['x'],
        [1, 'DELIVERED', '', '', '', '', '', '', 1000, 'DZ'],
        ['', '總計', '', '', '', '', '', '', 1000, 'DZ'],
    ];
    const {result} = await convertFixture('26051 file.xlsx', first, [['訂單', first], ['驗貨單', second]]);
    assert.equal(result.items[0].itemNumber, 'DELIVERED');
    assert.equal(result.totalQuantity, 1000);
});

test('S00178 divides quantities by 12', async () => {
    const {result} = await convertFixture('S00178 file.xlsx', standardRows({po: 'S00178', items: [['红色', 5400, 'PCS']]}));
    assert.equal(result.totalQuantity, 450);
    assert.equal(result.items[0].unit, 'DZ');
});

test('S00178 translates red and blue box descriptions', async () => {
    const {result} = await convertFixture('S00178 file.xlsx', standardRows({po: 'S00178', items: [['红色', 12, 'PCS'], ['蓝色', 12, 'PCS']]}));
    assert.equal(result.items[0].itemNumber, 'RED BOX');
    assert.equal(result.items[1].itemNumber, 'BLUE BOX');
});

test('duplicate xls and xlsx signatures are equal', async () => {
    const first = await convertFixture('A0064 file.xls', standardRows());
    const second = await convertFixture('A0064 file.xlsx', standardRows());
    assert.equal(first.result.signature, second.result.signature);
});

test('CSV is saved into the requested EDI upload folder', async () => {
    const {result, outputDirectory} = await convertFixture('A0064 file.xlsx', standardRows());
    assert.equal(path.dirname(result.outputPath), outputDirectory);
});

test('one invalid workbook error is clear', async () => {
    await assert.rejects(
        convertExcelBufferToEdiCsv({
            buffer: Buffer.from('not a workbook'),
            originalFilename: 'bad.xlsx',
            outputDirectory: os.tmpdir(),
        }),
        /Workbook could not be read|Workbook contains no worksheets|Purchase-order number/
    );
});

test('Windows-invalid filename characters are removed', async () => {
    const {result} = await convertFixture('A0064 file.xlsx', standardRows({agent: '', items: [['A', 1, 'DZ']]}));
    assert.doesNotMatch(result.outputFilename, /[<>:"/\\|?*]/);
});
