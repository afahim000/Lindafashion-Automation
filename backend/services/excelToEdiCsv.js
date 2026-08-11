const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const {pinyin} = require('pinyin-pro');
const {
    EDI_UPLOAD_FOLDER,
    CSV_HEADERS,
    agentVendorMap,
    vendorEnglishMap,
    poNormalization,
    poOverrides,
} = require('../config/ediConversionConfig');

function readWorkbook(buffer)
{
    try
    {
        return XLSX.read(buffer, {
            type: 'buffer',
            cellDates: true,
            raw: true,
        });
    }
    catch(error)
    {
        throw new Error(`Workbook could not be read: ${error.message}`);
    }
}

function normalizeCell(value)
{
    if(value === null || value === undefined)
    {
        return '';
    }

    if(value instanceof Date)
    {
        return value;
    }

    return typeof value === 'string' ? value.trim() : value;
}

function sheetToRows(workbook, sheetName)
{
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: '',
    }).map((row)=> row.map(normalizeCell));
}

function normalizePo(po)
{
    const value = String(po || '').trim().toUpperCase();
    return poNormalization[value] || value;
}

function extractPurchaseOrderNumberFromText(text)
{
    const match = String(text || '').match(/(?:^|[^A-Z0-9])(A\d{4}|S\d{5}|26\d{3}R?)(?:[^A-Z0-9]|$)/i);
    return match ? normalizePo(match[1]) : '';
}

function extractPurchaseOrderNumber(originalFilename, rows)
{
    const filenamePo = extractPurchaseOrderNumberFromText(originalFilename);

    if(filenamePo)
    {
        return filenamePo;
    }

    for(const row of rows.slice(0, 8))
    {
        for(const cell of row)
        {
            const po = extractPurchaseOrderNumberFromText(cell);

            if(po)
            {
                return po;
            }
        }
    }

    throw new Error('Purchase-order number could not be found');
}

function getNextNonEmptyCell(row, startIndex)
{
    for(let index = startIndex + 1; index < row.length; index += 1)
    {
        const value = normalizeCell(row[index]);

        if(value !== '')
        {
            return value;
        }
    }

    return '';
}

function formatDate(value)
{
    if(!value)
    {
        return '';
    }

    let date;

    if(value instanceof Date)
    {
        date = value;
    }
    else if(typeof value === 'number' && value > 20000 && value < 80000)
    {
        const parsed = XLSX.SSF.parse_date_code(value);

        if(!parsed)
        {
            return '';
        }

        date = new Date(parsed.y, parsed.m - 1, parsed.d);
    }
    else
    {
        const match = String(value).match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);

        if(!match)
        {
            return '';
        }

        date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    if(Number.isNaN(date.getTime()))
    {
        return '';
    }

    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function extractMetadata(rows)
{
    const metadata = {
        seller: '',
        sellerCode: '',
        agent: '',
        orderDate: '',
        deliveryDate: '',
    };

    for(const row of rows)
    {
        for(let index = 0; index < row.length; index += 1)
        {
            const label = String(normalizeCell(row[index]) || '').replace(/\s+/g, '');
            const value = getNextNonEmptyCell(row, index);

            if(!value)
            {
                continue;
            }

            if(label.includes('卖方') || label.includes('賣方'))
            {
                if(!metadata.sellerCode && (String(value).startsWith('#') || looksLikeFactoryCode(value)))
                {
                    metadata.sellerCode = String(value).replace(/^#/, '').trim();
                }
                else if(!metadata.seller)
                {
                    metadata.seller = String(value).trim();
                }
            }
            else if(label.includes('经办人') || label.includes('經辦人'))
            {
                const agent = String(value).trim();

                if(agentVendorMap[agent] || !metadata.agent)
                {
                    metadata.agent = agent;
                }
            }
            else if(label.includes('订货日期') || label.includes('訂貨日期'))
            {
                metadata.orderDate = formatDate(value);
            }
            else if(label.includes('交货日期') || label.includes('交貨日期'))
            {
                metadata.deliveryDate = formatDate(value);
            }
        }
    }

    return metadata;
}

function looksLikeFactoryCode(value)
{
    return /^[A-Z]?\d|^[A-Z]\d[-A-Z0-9]*$/i.test(String(value || '').trim());
}

function normalizeHeader(value)
{
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function findHeaderColumn(row, possibleHeaders)
{
    const normalizedHeaders = possibleHeaders.map(normalizeHeader);
    return row.findIndex((cell)=> normalizedHeaders.some((header)=> normalizeHeader(cell).includes(header)));
}

function findUnitColumn(row)
{
    return row.findIndex((cell)=> {
        const header = normalizeHeader(cell);

        if(header.includes('PRICE') || header.includes('单价') || header.includes('單價'))
        {
            return false;
        }

        return ['单位', '單位', 'UM', 'UNIT'].some((possible)=> header === normalizeHeader(possible) || header.includes(normalizeHeader(possible)));
    });
}

function containsStopLabel(row, stopLabels = defaultStopLabels())
{
    const rowText = row.map((cell)=> String(normalizeCell(cell) || '')).join(' ').toUpperCase();
    return stopLabels.some((label)=> rowText.includes(String(label).toUpperCase()));
}

function defaultStopLabels()
{
    return ['总打数', '總打數', '總計', '总计', '合计', 'TOTAL'];
}

function findItemTable(rows)
{
    for(let rowIndex = 0; rowIndex < rows.length; rowIndex += 1)
    {
        const row = rows[rowIndex];
        const itemColumn = findHeaderColumn(row, ['产品型号', '產品型號', '型号', '型號', 'SKU', 'ITEM', 'ITEM#']);
        const quantityColumn = findHeaderColumn(row, ['数量', '數量', 'QTY']);
        const unitColumn = findUnitColumn(row);

        if(itemColumn >= 0 && quantityColumn >= 0)
        {
            return {
                headerRow: rowIndex,
                itemColumn,
                quantityColumn,
                unitColumn: unitColumn >= 0 ? unitColumn : quantityColumn + 1,
                usedFallback: false,
            };
        }

        const normalizedRow = row.map(normalizeHeader).join('|');

        if((normalizedRow.includes('NO') || normalizedRow.includes('SKU')) && normalizedRow.includes('QTY'))
        {
            return {
                headerRow: rowIndex,
                itemColumn: 1,
                quantityColumn: 3,
                unitColumn: 4,
                usedFallback: true,
            };
        }
    }

    throw new Error('Item-table header could not be found');
}

function normalizeUnit(value)
{
    const unit = String(value || '').trim().toUpperCase();
    const unitMap = {
        '打': 'DZ',
        'DZ': 'DZ',
        'DOZ': 'DZ',
        'DOZEN': 'DZ',
        'PCS': 'PCS',
        'PC': 'PC',
        'PIECE': 'PC',
        'PIECES': 'PCS',
    };

    return unitMap[unit] || unit;
}

function normalizeQuantity(value)
{
    const quantity = Number(value);

    if(!Number.isFinite(quantity) || quantity <= 0)
    {
        throw new Error(`Invalid quantity: ${value}`);
    }

    return Number.isInteger(quantity) ? quantity : quantity;
}

function extractDisplayedTotal(rows)
{
    for(const row of rows)
    {
        if(!containsStopLabel(row))
        {
            continue;
        }

        for(const cell of row)
        {
            const value = Number(cell);

            if(Number.isFinite(value) && value > 0)
            {
                return value;
            }
        }
    }

    return null;
}

function extractItemsFromConfiguredSource(allRows, override)
{
    const source = override.itemSource || override;
    const rows = allRows[source.sheetIndex || 0] || [];
    const stopLabels = source.stopLabels || defaultStopLabels();
    const items = [];

    for(let rowIndex = source.startRow; rowIndex < rows.length; rowIndex += 1)
    {
        const row = rows[rowIndex];

        if(containsStopLabel(row, stopLabels))
        {
            break;
        }

        const itemNumber = String(normalizeCell(row[source.itemColumn]) || '').trim();
        const quantityValue = normalizeCell(row[source.quantityColumn]);

        if(!itemNumber || quantityValue === '')
        {
            continue;
        }

        const quantity = normalizeQuantity(quantityValue);
        const unit = normalizeUnit(row[source.unitColumn]);
        items.push({itemNumber, quantity, unit});
    }

    return {
        items,
        warnings: [],
    };
}

function extractItems(rows, allRows, override = {})
{
    if(override.itemSource)
    {
        return extractItemsFromConfiguredSource(allRows, override);
    }

    const table = findItemTable(rows);
    const items = [];
    const warnings = [];

    if(table.usedFallback)
    {
        warnings.push('Fallback Linda Fashion item columns were used.');
    }

    for(let rowIndex = table.headerRow + 1; rowIndex < rows.length; rowIndex += 1)
    {
        const row = rows[rowIndex];

        if(containsStopLabel(row))
        {
            break;
        }

        const itemNumber = String(normalizeCell(row[table.itemColumn]) || '').trim();
        const quantityValue = normalizeCell(row[table.quantityColumn]);

        if(!itemNumber || quantityValue === '')
        {
            continue;
        }

        const quantityNumber = Number(quantityValue);

        if(!Number.isFinite(quantityNumber) || quantityNumber <= 0)
        {
            continue;
        }

        items.push({
            itemNumber,
            quantity: normalizeQuantity(quantityNumber),
            unit: normalizeUnit(row[table.unitColumn]),
        });
    }

    return {
        items,
        warnings,
    };
}

function applyPoOverrides(order, override = {})
{
    if(override.vendor)
    {
        order.vendor = override.vendor;
    }

    if(override.orderDate)
    {
        order.orderDate = override.orderDate;
    }

    if(override.deliveryDate)
    {
        order.deliveryDate = override.deliveryDate;
    }

    order.items = order.items.map((item)=> {
        let itemNumber = item.itemNumber;
        let quantity = item.quantity;
        let unit = item.unit;

        if(override.itemTranslations && override.itemTranslations[itemNumber])
        {
            itemNumber = override.itemTranslations[itemNumber];
        }

        if(override.quantityDivisor)
        {
            quantity = normalizeQuantity(quantity / override.quantityDivisor);
        }

        if(override.forceUnit)
        {
            unit = override.forceUnit;
        }

        return {
            itemNumber,
            quantity,
            unit,
        };
    });

    return order;
}

function resolveVendor(po, metadata)
{
    const override = poOverrides[po];

    if(override && override.vendor)
    {
        return override.vendor;
    }

    if(metadata.agent && agentVendorMap[metadata.agent])
    {
        return agentVendorMap[metadata.agent];
    }

    if(metadata.sellerCode)
    {
        return String(metadata.sellerCode).replace(/^#/, '').trim();
    }

    if(metadata.seller)
    {
        return metadata.seller;
    }

    return 'UNKNOWN';
}

function createCsvRow(item, vendor)
{
    return [
        item.itemNumber,
        item.itemNumber,
        '',
        '',
        '',
        '',
        '',
        '',
        vendor,
        item.itemNumber,
        18,
        '',
        2.4,
        item.quantity,
        item.unit,
        5,
        5,
        5,
        6.5,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
    ];
}

function containsChineseCharacters(value)
{
    return /\p{Script=Han}/u.test(String(value === null || value === undefined ? '' : value));
}

function titleCaseWords(value)
{
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\b[a-z]/g, (letter)=> letter.toUpperCase());
}

function translateChineseText(value)
{
    const text = String(value === null || value === undefined ? '' : value);

    if(!containsChineseCharacters(text))
    {
        return value;
    }

    return pinyin(text, {
        toneType: 'none',
        type: 'array',
        nonZh: 'consecutive',
    }).join(' ').replace(/\s+/g, ' ').trim();
}

function translateVendorName(vendor)
{
    const name = String(vendor || '').trim();

    if(vendorEnglishMap[name])
    {
        return vendorEnglishMap[name];
    }

    if(!containsChineseCharacters(name))
    {
        return name;
    }

    const hasJewelrySuffix = name.endsWith('饰品');
    const baseName = hasJewelrySuffix ? name.slice(0, -2) : name;
    const translated = titleCaseWords(translateChineseText(baseName));
    return `${translated}${hasJewelrySuffix ? ' Jewelry' : ''}`.trim();
}

function validateEnglishVendorName(vendor)
{
    const name = String(vendor || '').trim();

    if(!name || name === 'UNKNOWN')
    {
        throw new Error('Vendor name could not be resolved to English. Add an English vendor mapping before creating the CSV.');
    }

    if(containsChineseCharacters(name) || !/^[A-Za-z0-9 .&'()/_-]+$/.test(name))
    {
        throw new Error(`Vendor name must use English characters only: ${name}`);
    }

    return name;
}

function validateCsvHasNoChineseCharacters(headers, rows)
{
    const offendingCell = [headers, ...rows]
        .flat()
        .find((value)=> containsChineseCharacters(value));

    if(offendingCell !== undefined)
    {
        throw new Error(`CSV contains Chinese characters in value: ${offendingCell}`);
    }
}

function escapeCsvValue(value)
{
    const text = value === null || value === undefined ? '' : String(value);

    if(text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r'))
    {
        return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
}

function createCsvText(headers, rows)
{
    const translatedHeaders = headers.map(translateChineseText);
    const translatedRows = rows.map((row)=> row.map(translateChineseText));
    validateCsvHasNoChineseCharacters(translatedHeaders, translatedRows);

    return [
        translatedHeaders.map(escapeCsvValue).join(','),
        ...translatedRows.map((row)=> row.map(escapeCsvValue).join(',')),
    ].join('\n');
}

function sanitizeFilename(value)
{
    return String(value)
        .replace(/[<>:"/\\|?*]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function createOutputFilename({vendor, orderDate, deliveryDate, po})
{
    return sanitizeFilename(`${vendor} ${orderDate || 'UNKNOWN-DATE'} ${deliveryDate || 'UNKNOWN-DATE'} ${po}.csv`);
}

async function saveCsvToEdiFolder(outputDirectory, outputFilename, csvText)
{
    await fs.promises.mkdir(outputDirectory, {recursive: true});
    const finalPath = path.resolve(outputDirectory, outputFilename);
    const resolvedOutputDirectory = path.resolve(outputDirectory);

    if(!finalPath.startsWith(`${resolvedOutputDirectory}${path.sep}`))
    {
        throw new Error('Invalid CSV output path.');
    }

    const temporaryPath = `${finalPath}.tmp`;
    const replaced = fs.existsSync(finalPath);
    await fs.promises.writeFile(temporaryPath, csvText, 'utf8');

    if(replaced)
    {
        await fs.promises.unlink(finalPath);
    }

    await fs.promises.rename(temporaryPath, finalPath);
    return {
        outputPath: finalPath,
        replaced,
    };
}

function validateExtractedOrder(order)
{
    if(!order.po)
    {
        throw new Error('Purchase-order number could not be found');
    }

    if(!order.items.length)
    {
        throw new Error('No valid item rows were found');
    }

    for(const item of order.items)
    {
        if(!item.itemNumber)
        {
            throw new Error('Every item must have an item number');
        }

        if(!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)
        {
            throw new Error(`Invalid quantity: ${item.quantity}`);
        }
    }
}

function createOrderSignature(order)
{
    const itemSignature = order.items
        .map((item)=> `${item.itemNumber}:${item.quantity}:${item.unit}`)
        .join('|');
    return `${order.po}|${itemSignature}`;
}

async function convertExcelBufferToEdiCsv({buffer, originalFilename, outputDirectory = EDI_UPLOAD_FOLDER})
{
    const extension = path.extname(originalFilename).toLowerCase();

    if(!['.xls', '.xlsx'].includes(extension))
    {
        throw new Error(`Unsupported file type: ${originalFilename}`);
    }

    const workbook = readWorkbook(buffer);

    if(!workbook.SheetNames || workbook.SheetNames.length === 0)
    {
        throw new Error('Workbook contains no worksheets');
    }

    const allRows = workbook.SheetNames.map((sheetName)=> sheetToRows(workbook, sheetName));
    const rows = allRows[0];
    const po = extractPurchaseOrderNumber(originalFilename, rows);
    const override = poOverrides[po] || {};
    const metadata = extractMetadata(rows);
    const extracted = extractItems(rows, allRows, override);
    const displayedTotal = extractDisplayedTotal(rows);
    const warnings = [...extracted.warnings];
    let order = {
        po,
        vendor: resolveVendor(po, metadata),
        orderDate: metadata.orderDate,
        deliveryDate: metadata.deliveryDate,
        items: extracted.items,
    };

    order = applyPoOverrides(order, override);
    validateExtractedOrder(order);
    order.vendor = validateEnglishVendorName(translateVendorName(order.vendor));

    const totalQuantity = order.items.reduce((sum, item)=> sum + Number(item.quantity), 0);

    if(displayedTotal !== null && Math.abs(displayedTotal - totalQuantity) > 0.0001)
    {
        warnings.push(`Displayed total is ${displayedTotal} DZ, but item rows total ${totalQuantity} DZ. The item rows were used.`);
    }

    if(!order.orderDate)
    {
        warnings.push('Order date was not found. UNKNOWN-DATE was used.');
    }

    if(!order.deliveryDate)
    {
        warnings.push('Delivery date was not found. UNKNOWN-DATE was used.');
    }

    const csvRows = order.items.map((item)=> createCsvRow(item, order.vendor));
    const allCsvRows = [CSV_HEADERS, ...csvRows];

    for(const row of allCsvRows)
    {
        if(row.length !== CSV_HEADERS.length)
        {
            throw new Error(`Every CSV row must contain exactly ${CSV_HEADERS.length} columns`);
        }
    }

    const csvText = createCsvText(CSV_HEADERS, csvRows);
    const outputFilename = createOutputFilename({
        vendor: order.vendor,
        orderDate: order.orderDate,
        deliveryDate: order.deliveryDate,
        po: order.po,
    });

    if(!outputFilename.endsWith('.csv'))
    {
        throw new Error('Invalid output filename');
    }

    const saved = await saveCsvToEdiFolder(outputDirectory, outputFilename, csvText);

    if(saved.replaced)
    {
        warnings.push('Existing CSV was replaced.');
    }

    return {
        sourceFile: originalFilename,
        success: true,
        duplicate: false,
        po: order.po,
        vendor: order.vendor,
        orderDate: order.orderDate,
        deliveryDate: order.deliveryDate,
        items: order.items,
        itemCount: order.items.length,
        totalQuantity,
        outputFilename,
        outputPath: saved.outputPath,
        warnings,
        errors: [],
        signature: createOrderSignature(order),
    };
}

module.exports = {
    CSV_HEADERS,
    EDI_UPLOAD_FOLDER,
    readWorkbook,
    normalizeCell,
    extractPurchaseOrderNumber,
    extractPurchaseOrderNumberFromText,
    extractMetadata,
    findItemTable,
    extractItems,
    applyPoOverrides,
    validateExtractedOrder,
    createCsvRow,
    containsChineseCharacters,
    translateChineseText,
    translateVendorName,
    validateEnglishVendorName,
    validateCsvHasNoChineseCharacters,
    escapeCsvValue,
    createCsvText,
    createOutputFilename,
    saveCsvToEdiFolder,
    normalizePo,
    formatDate,
    normalizeUnit,
    convertExcelBufferToEdiCsv,
    createOrderSignature,
};
