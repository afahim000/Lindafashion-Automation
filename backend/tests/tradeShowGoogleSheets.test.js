const assert = require('assert');
const {orderRow} = require('../services/tradeShowGoogleSheets');

assert.deepStrictEqual(orderRow({code:'16055',customerName:'GRUPO ACCESMODA',amount:'$1,234.50',orderDate:'08/11/2026',repAtShow:'TEMP 1',finalRep:'Gaby',newCustomer:true,paymentMethod:'CC',paymentAmount:'FULLY PAID',notes:'SHIP UPS'}), ['08/11/2026','GRUPO ACCESMODA','16055','',1234.5,'TEMP 1','GABY','YES','CC','FULLY PAID','SHIP UPS']);
assert.throws(()=> orderRow({}), /order number/i);
console.log('Trade-show Google Sheets tests passed.');
