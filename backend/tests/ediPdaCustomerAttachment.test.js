const assert = require('assert');
const {attachedCustomerFromHtml} = require('../services/ediPdaOrders');

const result = attachedCustomerFromHtml(`<script>pfrm1.DNUMCUSTNAME_2122.value ='ABRAR FAHIM'; pfrm1.DNUMCUSTNO_2122.value ='GRU999';</script>`, '2122', 'GRU999');
assert.deepStrictEqual(result, {customerCode:'GRU999',customerName:'ABRAR FAHIM',nameField:'DNUMCUSTNAME_2122',numberField:'DNUMCUSTNO_2122'});
assert.throws(()=> attachedCustomerFromHtml('<html></html>', '2122', 'GRU999'), /could not attach/i);
console.log('EDI PDA customer attachment tests passed.');
