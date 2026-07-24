const fs = require('fs');
const path = require('path');

const FEDEX_URLS = {
    sandbox: 'https://apis-sandbox.fedex.com',
    production: 'https://apis.fedex.com',
};

function required(value, name)
{
    if(value === undefined || value === null || String(value).trim() === '')
    {
        throw new Error(`Missing required FedEx setting: ${name}`);
    }

    return String(value).trim();
}

function ascii(value, maxLength)
{
    return String(value || '')
        .normalize('NFKD')
        .replace(/[^\x20-\x7E]/g, '')
        .trim()
        .slice(0, maxLength);
}

function parseUsAddress(addressLines = [])
{
    const lines = addressLines.map((line)=> ascii(line, 35)).filter(Boolean);
    const cityStatePostal = lines.pop() || '';
    const match = cityStatePostal.match(/^(.+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);

    if(!match)
    {
        throw new Error(`Could not read FedEx city, state, and ZIP from ship-to address: ${cityStatePostal}`);
    }

    return {
        streetLines: lines,
        city: ascii(match[1].replace(/,$/, ''), 35),
        stateOrProvinceCode: match[2].toUpperCase(),
        postalCode: match[3],
        countryCode: 'US',
    };
}

function ensureCustomerPoOnAddress(address, customerPoNumber)
{
    const po = ascii(customerPoNumber, 25);
    if(!po) return address;
    const nonPoLines = address.streetLines.filter((line)=> !line.toUpperCase().includes(po.toUpperCase()));
    return {...address, streetLines: [...nonPoLines, `PO# ${po}`].slice(0, 3)};
}

function serviceType(shipMethod)
{
    const normalized = String(shipMethod || '').toUpperCase();

    if(normalized.includes('HOME DELIVERY')) return 'GROUND_HOME_DELIVERY';
    if(normalized.includes('GROUND ECONOMY') || normalized.includes('SMARTPOST')) return 'SMART_POST';
    if(normalized.includes('INTERNATIONAL FIRST')) return 'INTERNATIONAL_FIRST';
    if(normalized.includes('INTERNATIONAL PRIORITY')) return 'INTERNATIONAL_PRIORITY';
    if(normalized.includes('INTERNATIONAL ECONOMY')) return 'INTERNATIONAL_ECONOMY';
    if(normalized.includes('2DAY A.M') || normalized.includes('2 DAY A.M') || normalized.includes('2DAY AM')) return 'FEDEX_2_DAY_AM';
    if(normalized.includes('2DAY') || normalized.includes('2 DAY')) return 'FEDEX_2_DAY';
    if(normalized.includes('STANDARD OVERNIGHT')) return 'STANDARD_OVERNIGHT';
    if(normalized.includes('PRIORITY OVERNIGHT')) return 'PRIORITY_OVERNIGHT';
    if(normalized.includes('FIRST OVERNIGHT')) return 'FIRST_OVERNIGHT';
    if(normalized.includes('EXPRESS SAVER')) return 'FEDEX_EXPRESS_SAVER';
    if(normalized.includes('GROUND')) return 'FEDEX_GROUND';
    throw new Error(`Unsupported or missing FedEx shipping speed: ${shipMethod || 'blank'}`);
}

function buildCustomerReferences(purchaseOrder)
{
    const references = [];
    const add = (customerReferenceType, value)=> {
        const cleanValue = ascii(value, 30);
        if(!cleanValue || references.some((reference)=> reference.value.toUpperCase() === cleanValue.toUpperCase())) return;
        references.push({customerReferenceType, value: cleanValue});
    };

    add('P_O_NUMBER', purchaseOrder.po_number);
    add('INVOICE_NUMBER', purchaseOrder.quickbooks_invoice_ref_number);

    const rawText = String(purchaseOrder.raw_text || '');
    const instructionPattern = /^[\s\u00b7\u2022*-]*(.+?)\s+in\s+(?:the\s+)?(.+?reference field)\s*$/gim;
    let match;
    while((match = instructionPattern.exec(rawText)) !== null)
    {
        const field = match[2].toUpperCase();
        const type = field.includes('PO ') ? 'P_O_NUMBER' : field.includes('INVOICE') ? 'INVOICE_NUMBER' : 'CUSTOMER_REFERENCE';
        add(type, match[1]);
    }

    add('CUSTOMER_REFERENCE', purchaseOrder.customer_reference);
    return references.slice(0, 4);
}

function contactPhoneFromPurchaseOrder(purchaseOrder)
{
    const savedPhone = String(purchaseOrder.recipient_phone || '').replace(/\D/g, '');
    if(savedPhone) return savedPhone;

    const contactSection = String(purchaseOrder.raw_text || '').match(/Contact for this Order([\s\S]{0,350}?)(?:Manufacturer Information|Sales Order Customer)/i)?.[1] || '';
    const match = contactSection.match(/Phone:\s*([+\d(). -]{7,})/i);
    return match ? match[1].replace(/\D/g, '') : '';
}

function positiveNumber(value, name)
{
    const number = Number(value);
    if(!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be greater than zero`);
    return number;
}

function html(value)
{
    return String(value ?? '').replace(/[&<>"']/g, (character)=> ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

class FedExShipping
{
    constructor(options = {})
    {
        this.fetch = options.fetch || global.fetch;
        this.env = options.env || process.env;
        const environment = String(this.env.FEDEX_ENVIRONMENT || 'sandbox').toLowerCase();
        this.baseUrl = options.baseUrl || this.env.FEDEX_BASE_URL || FEDEX_URLS[environment];

        if(!this.baseUrl) throw new Error('FEDEX_ENVIRONMENT must be sandbox or production');
        if(!this.fetch) throw new Error('This Node version does not provide fetch');
    }

    async request(url, options, action)
    {
        const response = await this.fetch(url, options);
        const body = await response.json().catch(()=> ({}));

        if(!response.ok)
        {
            const messages = (body.errors || []).map((error)=> error.message || error.code).filter(Boolean);
            throw new Error(`FedEx ${action} failed (${response.status}): ${messages.join('; ') || 'Unknown response'}`);
        }

        return body;
    }

    async accessToken()
    {
        const form = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: required(this.env.FEDEX_CLIENT_ID, 'FEDEX_CLIENT_ID'),
            client_secret: required(this.env.FEDEX_CLIENT_SECRET, 'FEDEX_CLIENT_SECRET'),
        });
        const body = await this.request(`${this.baseUrl}/oauth/token`, {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: form,
        }, 'authorization');

        return required(body.access_token, 'OAuth access token');
    }

    buildShipment(purchaseOrder, packageDetails)
    {
        const recipientAddress = ensureCustomerPoOnAddress(
            parseUsAddress(purchaseOrder.ship_to?.address),
            purchaseOrder.customer_po_number
        );
        const shipperAccount = required(this.env.FEDEX_ACCOUNT_NUMBER, 'FEDEX_ACCOUNT_NUMBER');
        const forceSandboxSender = String(this.env.FEDEX_ENVIRONMENT || 'sandbox').toLowerCase() === 'sandbox'
            && String(this.env.FEDEX_SANDBOX_FORCE_SENDER || '').toLowerCase() === 'true';
        const billingAccount = forceSandboxSender
            ? shipperAccount
            : String(purchaseOrder.shipping_account_number || shipperAccount).trim();
        const billThirdParty = billingAccount !== shipperAccount;
        const packageGroups = Array.isArray(packageDetails.packages) && packageDetails.packages.length
            ? packageDetails.packages
            : [packageDetails];
        const requestedPackageLineItems = packageGroups.map((packageGroup, index)=> {
            const dimensions = ['length', 'width', 'height'].reduce((result, key)=> {
                result[key] = Math.ceil(positiveNumber(packageGroup[key], `Box type ${index + 1} ${key}`));
                return result;
            }, {});
            const quantity = positiveNumber(packageGroup.quantity || 1, `Box type ${index + 1} quantity`);
            if(!Number.isInteger(quantity)) throw new Error(`Box type ${index + 1} quantity must be a whole number`);
            if(quantity > 40) throw new Error(`Box type ${index + 1} quantity cannot exceed 40`);
            return {
                sequenceNumber: index + 1,
                groupPackageCount: quantity,
                weight: {units: 'LB', value: positiveNumber(packageGroup.weight, `Box type ${index + 1} weight`)},
                dimensions: {...dimensions, units: 'IN'},
                customerReferences: buildCustomerReferences(purchaseOrder),
            };
        });
        const totalPackageCount = requestedPackageLineItems.reduce((total, item)=> total + item.groupPackageCount, 0);
        if(totalPackageCount > 40) throw new Error('A FedEx shipment cannot contain more than 40 boxes');
        const recipientPhone = packageDetails.recipientPhone || contactPhoneFromPurchaseOrder(purchaseOrder);
        const recipientContact = {
            personName: ascii(purchaseOrder.ship_to?.contact_name || purchaseOrder.ship_to?.name, 35),
            companyName: ascii(purchaseOrder.ship_to?.name, 35),
            phoneNumber: required(recipientPhone, 'recipient phone').replace(/\D/g, ''),
        };

        return {
            labelResponseOptions: 'LABEL',
            accountNumber: {value: shipperAccount},
            requestedShipment: {
                shipDatestamp: new Date().toISOString().slice(0, 10),
                serviceType: packageDetails.serviceType || serviceType(purchaseOrder.ship_method),
                packagingType: 'YOUR_PACKAGING',
                pickupType: this.env.FEDEX_PICKUP_TYPE || 'USE_SCHEDULED_PICKUP',
                blockInsightVisibility: false,
                shipper: {
                    contact: {
                        personName: ascii(required(this.env.FEDEX_SHIPPER_NAME, 'FEDEX_SHIPPER_NAME'), 35),
                        companyName: ascii(this.env.FEDEX_SHIPPER_COMPANY || this.env.FEDEX_SHIPPER_NAME, 35),
                        phoneNumber: required(this.env.FEDEX_SHIPPER_PHONE, 'FEDEX_SHIPPER_PHONE').replace(/\D/g, ''),
                    },
                    address: {
                        streetLines: [required(this.env.FEDEX_SHIPPER_STREET, 'FEDEX_SHIPPER_STREET')],
                        city: required(this.env.FEDEX_SHIPPER_CITY, 'FEDEX_SHIPPER_CITY'),
                        stateOrProvinceCode: required(this.env.FEDEX_SHIPPER_STATE, 'FEDEX_SHIPPER_STATE'),
                        postalCode: required(this.env.FEDEX_SHIPPER_POSTAL_CODE, 'FEDEX_SHIPPER_POSTAL_CODE'),
                        countryCode: this.env.FEDEX_SHIPPER_COUNTRY || 'US',
                    },
                },
                recipients: [{
                    contact: recipientContact,
                    address: recipientAddress,
                }],
                shippingChargesPayment: {
                    paymentType: billThirdParty ? 'THIRD_PARTY' : 'SENDER',
                    payor: {responsibleParty: {accountNumber: {value: billingAccount}}},
                },
                labelSpecification: {
                    imageType: 'PDF',
                    labelStockType: this.env.FEDEX_LABEL_STOCK_TYPE || 'PAPER_4X6',
                },
                totalPackageCount,
                requestedPackageLineItems,
            },
        };
    }

    async createLabel(purchaseOrder, packageDetails, outputDirectory)
    {
        const token = await this.accessToken();
        const requestBody = this.buildShipment(purchaseOrder, packageDetails);
        const response = await this.request(`${this.baseUrl}/ship/v1/shipments`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-locale': 'en_US',
            },
            body: JSON.stringify(requestBody),
        }, 'shipment');
        const transaction = response.output?.transactionShipments?.[0];
        const pieces = transaction?.pieceResponses || [];
        fs.mkdirSync(outputDirectory, {recursive: true});
        const safePo = ascii(purchaseOrder.po_number || 'shipment', 40).replace(/[^A-Za-z0-9_-]/g, '_');
        const stamp = Date.now();
        const labels = [];

        pieces.forEach((piece, pieceIndex)=> {
            const documents = (piece.packageDocuments || []).filter((document)=> document.contentType === 'LABEL');
            documents.forEach((document, documentIndex)=> {
                const encodedLabel = document.encodedLabel || document.parts?.[0]?.image;
                if(!encodedLabel) return;
                const suffix = pieces.length > 1 || documents.length > 1 ? `-${pieceIndex + 1}-${documentIndex + 1}` : '';
                const fileName = `${safePo}-${stamp}-fedex-label${suffix}.pdf`;
                fs.writeFileSync(path.join(outputDirectory, fileName), Buffer.from(encodedLabel, 'base64'));
                labels.push({fileName, trackingNumber: piece.trackingNumber});
            });
        });

        if(!labels.length) throw new Error('FedEx created the shipment but did not return an encoded label');

        const trackingNumber = pieces[0]?.trackingNumber || transaction?.masterTrackingNumber;
        const transactionId = response.transactionId || response.output?.transactionId || '';
        const transactionFileName = `${safePo}-${stamp}-fedex-transaction.html`;
        const transactionRecord = `<!doctype html>
<html><head><meta charset="utf-8"><title>FedEx Transaction Record ${html(trackingNumber)}</title>
<style>body{font:16px Arial,sans-serif;max-width:760px;margin:32px auto;color:#172033}h1{color:#4d148c}.row{display:grid;grid-template-columns:190px 1fr;border-bottom:1px solid #ddd;padding:10px 0}.label{font-weight:700}@media print{button{display:none}body{margin:0}}</style></head>
<body><button onclick="window.print()">Print transaction record</button><h1>FedEx Shipment Transaction Record</h1>
<div class="row"><span class="label">FedEx transaction ID</span><span>${html(transactionId || 'Not returned')}</span></div>
<div class="row"><span class="label">Tracking number</span><span>${html(trackingNumber)}</span></div>
<div class="row"><span class="label">Purchase order</span><span>${html(purchaseOrder.po_number)}</span></div>
<div class="row"><span class="label">Customer reference</span><span>${html(purchaseOrder.customer_reference)}</span></div>
<div class="row"><span class="label">Service</span><span>${html(requestBody.requestedShipment.serviceType)}</span></div>
<div class="row"><span class="label">Billing</span><span>${html(requestBody.requestedShipment.shippingChargesPayment.paymentType)}</span></div>
<div class="row"><span class="label">Ship to</span><span>${html(purchaseOrder.ship_to?.name)}<br>${(purchaseOrder.ship_to?.address || []).map(html).join('<br>')}</span></div>
<div class="row"><span class="label">Package</span><span>${html(packageDetails.weight)} lb — ${html(packageDetails.length)} × ${html(packageDetails.width)} × ${html(packageDetails.height)} in</span></div>
<div class="row"><span class="label">Created</span><span>${html(new Date().toLocaleString())}</span></div>
</body></html>`;
        fs.writeFileSync(path.join(outputDirectory, transactionFileName), transactionRecord, 'utf8');

        return {
            trackingNumber,
            labels,
            transactionId,
            transactionFileName,
            serviceType: requestBody.requestedShipment.serviceType,
            billingType: requestBody.requestedShipment.shippingChargesPayment.paymentType,
        };
    }
}

module.exports = {FedExShipping, parseUsAddress, serviceType, buildCustomerReferences, ensureCustomerPoOnAddress, contactPhoneFromPurchaseOrder};
