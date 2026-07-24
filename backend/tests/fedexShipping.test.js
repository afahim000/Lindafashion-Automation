const assert = require('assert');
const {FedExShipping, parseUsAddress, serviceType, buildCustomerReferences, ensureCustomerPoOnAddress, contactPhoneFromPurchaseOrder} = require('../services/fedexShipping');

assert.deepStrictEqual(parseUsAddress(['Attn PO#123', '4542 OLD TROUP HWY', 'TYLER, TX 75707']), {
    streetLines: ['Attn PO#123', '4542 OLD TROUP HWY'], city: 'TYLER', stateOrProvinceCode: 'TX', postalCode: '75707', countryCode: 'US',
});
assert.strictEqual(serviceType('FedEx Ground'), 'FEDEX_GROUND');
assert.strictEqual(contactPhoneFromPurchaseOrder({raw_text: 'Contact for this Order\nMichelle Wells Vendor ID#: V21783\nPhone: 972-709-0015 Tanslin Premium\nManufacturer Information'}), '9727090015');
assert.strictEqual(contactPhoneFromPurchaseOrder({raw_text: 'Contact for this Order\nNo phone listed\nManufacturer Information'}), '');
assert.deepStrictEqual(ensureCustomerPoOnAddress({streetLines: ['PO#2595186', '115 Airport Road']}, '2595186').streetLines, ['115 Airport Road', 'PO# 2595186']);
assert.strictEqual(serviceType('FedEx Priority Overnight'), 'PRIORITY_OVERNIGHT');
assert.strictEqual(serviceType('FedEx 2Day A.M.'), 'FEDEX_2_DAY_AM');
assert.throws(()=> serviceType('FedEx unknown speed'), /Unsupported/);

assert.deepStrictEqual(buildCustomerReferences({
    po_number: 'P860014246A', quickbooks_invoice_ref_number: '22480', customer_reference: 'Fans - General Store',
    raw_text: 'Special Shipping Notes:\n· P860014246A in PO Reference Field\n· Fans - General Store in Customer Reference Field',
}), [
    {customerReferenceType: 'P_O_NUMBER', value: 'P860014246A'},
    {customerReferenceType: 'INVOICE_NUMBER', value: '22480'},
    {customerReferenceType: 'CUSTOMER_REFERENCE', value: 'Fans - General Store'},
]);

const env = {
    FEDEX_ENVIRONMENT: 'sandbox', FEDEX_ACCOUNT_NUMBER: '111', FEDEX_SHIPPER_NAME: 'Linda',
    FEDEX_SHIPPER_PHONE: '7325551212', FEDEX_SHIPPER_STREET: '1 Main St', FEDEX_SHIPPER_CITY: 'Rahway',
    FEDEX_SHIPPER_STATE: 'NJ', FEDEX_SHIPPER_POSTAL_CODE: '07065',
};
const request = new FedExShipping({env, fetch: async()=> ({ok: true, json: async()=> ({})})}).buildShipment({
    po_number: 'P1', customer_po_number: '2566987', quickbooks_invoice_ref_number: '22480', customer_reference: 'Fans', ship_method: 'FedEx Ground', shipping_account_number: '222',
    ship_to: {name: 'Store', address: ['10 Broad St', 'TYLER, TX 75707']},
}, {weight: 2.5, length: 10, width: 8, height: 4, recipientPhone: '903-555-1212'});

assert.strictEqual(request.requestedShipment.shippingChargesPayment.paymentType, 'THIRD_PARTY');
assert.strictEqual(request.requestedShipment.requestedPackageLineItems[0].weight.value, 2.5);
assert.strictEqual(request.requestedShipment.totalPackageCount, 1);
assert.strictEqual(request.requestedShipment.recipients[0].address.city, 'TYLER');
assert.deepStrictEqual(request.requestedShipment.recipients[0].address.streetLines, ['10 Broad St', 'PO# 2566987']);
assert.strictEqual(request.requestedShipment.recipients[0].contact.companyName, 'Store');
assert.strictEqual(request.requestedShipment.recipients[0].contact.personName, 'Store');

const multiPackageRequest = new FedExShipping({env, fetch: async()=> ({ok: true, json: async()=> ({})})}).buildShipment({
    po_number: 'P2', customer_po_number: '2566988', quickbooks_invoice_ref_number: '22481', ship_method: 'FedEx Ground',
    ship_to: {name: 'Store', address: ['10 Broad St', 'TYLER, TX 75707']},
}, {recipientPhone: '9035551212', packages: [
    {quantity: 3, weight: 15, length: 24, width: 18, height: 16},
    {quantity: 2, weight: 8, length: 12, width: 10, height: 6},
]});
assert.strictEqual(multiPackageRequest.requestedShipment.totalPackageCount, 5);
assert.strictEqual(multiPackageRequest.requestedShipment.requestedPackageLineItems.length, 2);
assert.strictEqual(multiPackageRequest.requestedShipment.requestedPackageLineItems[0].groupPackageCount, 3);
assert.strictEqual(multiPackageRequest.requestedShipment.requestedPackageLineItems[1].sequenceNumber, 2);
console.log('FedEx shipping tests passed');
