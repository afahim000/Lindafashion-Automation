const fs = require('fs');
const path = require('path');
const {FedExShipping} = require('../services/fedexShipping');

async function main()
{
    const outputDirectory = path.join(__dirname, '..', 'validation-labels', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(outputDirectory, {recursive: true});
    const fakeEnv = {
        FEDEX_ENVIRONMENT: 'sandbox',
        FEDEX_BASE_URL: 'https://apis-sandbox.fedex.com',
        FEDEX_CLIENT_ID: process.env.FEDEX_VALIDATION_CLIENT_ID,
        FEDEX_CLIENT_SECRET: process.env.FEDEX_VALIDATION_CLIENT_SECRET,
        FEDEX_ACCOUNT_NUMBER: process.env.FEDEX_VALIDATION_ACCOUNT_NUMBER,
        FEDEX_SANDBOX_FORCE_SENDER: 'true',
        FEDEX_SHIPPER_NAME: 'Validation Shipper',
        FEDEX_SHIPPER_COMPANY: 'Validation Test Company',
        FEDEX_SHIPPER_PHONE: '9015550100',
        FEDEX_SHIPPER_STREET: '3610 Hacks Cross Road',
        FEDEX_SHIPPER_CITY: 'Memphis',
        FEDEX_SHIPPER_STATE: 'TN',
        FEDEX_SHIPPER_POSTAL_CODE: '38125',
        FEDEX_SHIPPER_COUNTRY: 'US',
        FEDEX_PICKUP_TYPE: 'DROPOFF_AT_FEDEX_LOCATION',
        FEDEX_LABEL_STOCK_TYPE: 'PAPER_4X6',
    };
    const fedex = new FedExShipping({env: fakeEnv});
    const basePurchaseOrder = {
        customer_po_number: 'VALIDATION-PO-1001',
        quickbooks_invoice_ref_number: 'VALIDATION-INV-1001',
        customer_reference: 'FEDEX LABEL VALIDATION',
        ship_to: {name: 'Validation Recipient', contact_name: 'Test Recipient', address: ['10 FedEx Parkway', 'COLLIERVILLE, TN 38017']},
    };
    const scenarios = [
        {name: 'ground', serviceType: 'FEDEX_GROUND', packages: [{quantity: 1, weight: 15, length: 24, width: 18, height: 16}]},
        {name: 'priority-overnight', serviceType: 'PRIORITY_OVERNIGHT', packages: [{quantity: 1, weight: 5, length: 12, width: 10, height: 6}]},
        {name: 'fedex-2day', serviceType: 'FEDEX_2_DAY', packages: [{quantity: 1, weight: 8, length: 14, width: 12, height: 8}]},
        {name: 'ground-multi-box', serviceType: 'FEDEX_GROUND', packages: [
            {quantity: 2, weight: 15, length: 24, width: 18, height: 16},
            {quantity: 1, weight: 8, length: 14, width: 12, height: 8},
        ]},
    ];
    const manifest = [];
    for(const [index, scenario] of scenarios.entries())
    {
        const purchaseOrder = {...basePurchaseOrder, po_number: `VALIDATION-${index + 1}-${scenario.name.toUpperCase()}`, ship_method: scenario.serviceType};
        const result = await fedex.createLabel(purchaseOrder, {serviceType: scenario.serviceType, recipientPhone: '9015550199', packages: scenario.packages}, outputDirectory);
        manifest.push({scenario: scenario.name, serviceType: scenario.serviceType, ...result});
        console.log(`${scenario.name}: ${result.labels.length} label(s), tracking ${result.trackingNumber}`);
    }
    fs.writeFileSync(path.join(outputDirectory, 'validation-manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`OUTPUT_DIRECTORY=${outputDirectory}`);
}

main().catch((error)=> { console.error(error.message); process.exitCode = 1; });
