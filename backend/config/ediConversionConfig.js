const path = require('path');

const EDI_UPLOAD_FOLDER = process.env.EDI_UPLOAD_FOLDER || path.join(__dirname, '..', 'ediUpload');

const poNormalization = {
    '26102': '26102R',
};

const agentVendorMap = {
    '梁过': 'Liang Guo',
    '陈先军': 'Chen Xianjun',
    '黄涛英': 'Huang Taoying',
    '张敬山': 'Zhang Jingshan',
    '吴云中': 'Wu Yunzhong',
    '朱志伟': 'Zhu Zhiwei',
    '龚银花': 'Gong Yinhua',
    '邹永海': 'Zou Yonghai',
    '郭海燕': 'Guo Haiyan',
};

// Approved business-name translations used before the English-only CSV check.
// Keep these explicit so an automatic transliteration cannot create the wrong
// vendor record in EDI.
const vendorEnglishMap = {
    '亿资饰品': 'Yi Zi Jewelry',
};

const poOverrides = {
    '26014': {
        orderDate: '2026-05-09',
        deliveryDate: '2026-06-10',
    },
    '26051': {
        orderDate: '2026-05-09',
        deliveryDate: '2026-06-26',
        itemSource: {
            sheetIndex: 1,
            startRow: 3,
            itemColumn: 1,
            quantityColumn: 8,
            unitColumn: 9,
            stopLabels: ['總計', '总计', 'TOTAL'],
        },
    },
    '26102R': {
        orderDate: '2026-05-23',
        deliveryDate: '2026-06-26',
    },
    'S00178': {
        vendor: 'E2-5788',
        quantityDivisor: 12,
        forceUnit: 'DZ',
        itemTranslations: {
            '红色': 'RED BOX',
            '紅色': 'RED BOX',
            '蓝色': 'BLUE BOX',
            '藍色': 'BLUE BOX',
        },
    },
    'A0066': {
        ignoreDisplayedTotal: true,
    },
};

const CSV_HEADERS = [
    'STYLE#',
    'ITEM#',
    'DESC1',
    'DESC2',
    'DESC3',
    'DESC4',
    'CAT',
    'SUBCAT',
    'VEND#',
    'VENDOR PRODUCTION#',
    'RMB.COST',
    'ARB.COST2',
    'FOB',
    'QTY',
    'UM',
    'SELLPRC1',
    'SELLPRC2',
    'SELLPRC3',
    'SELLPRC4',
    'SELLPRC5',
    'SELLPRC6',
    'SEASON',
    'WH',
    'DUTY%',
    'COMM%',
    'MISC%',
    'PC/CTN',
    'GENDER',
];

module.exports = {
    EDI_UPLOAD_FOLDER,
    poNormalization,
    agentVendorMap,
    vendorEnglishMap,
    poOverrides,
    CSV_HEADERS,
};
