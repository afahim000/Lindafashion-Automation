const assert = require('assert');
const {customerPrefix, customerCodesFromHtml, nextCustomerNumber} = require('../services/ediCustomerNumbers');

assert.strictEqual(customerPrefix('Grupo Accesmoda'), 'GRU');
assert.strictEqual(customerPrefix('A & B Company'), 'AXX');
assert.strictEqual(customerPrefix('12 Moda'), 'XXX');
assert.strictEqual(customerPrefix("O'Neill"), 'OXN');
assert.throws(()=> customerPrefix('AB'), /three characters/i);
const html = `<a href="ar_customer.php?code=GRU001&show_list=t">GRU001</a>
<a href="ar_customer.php?code=GRU099&show_list=t">GRU099</a>
<a href="ar_customer.php?code=GRU1000&show_list=t">GRU1000</a>
<a href="ar_customer.php?code=GRA999&show_list=t">GRA999</a>`;
assert.deepStrictEqual(customerCodesFromHtml(html, 'GRU').map((item)=> item.code), ['GRU001', 'GRU099', 'GRU1000']);
assert.deepStrictEqual(nextCustomerNumber('Grupo', ['GRU001', 'GRU006']), {prefix: 'GRU', highestNumber: 6, code: 'GRU007'});
assert.deepStrictEqual(nextCustomerNumber('Grupo', ['GRU999']), {prefix: 'GRU', highestNumber: 999, code: 'GRU1000'});
assert.deepStrictEqual(nextCustomerNumber('Novelty', []), {prefix: 'NOV', highestNumber: 0, code: 'NOV001'});
console.log('EDI customer number tests passed.');
