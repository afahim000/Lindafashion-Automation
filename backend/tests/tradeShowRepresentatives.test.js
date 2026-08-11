const assert = require('assert');
const {REPRESENTATIVES, REPRESENTATIVE_CODES} = require('../services/tradeShowRepresentatives');
assert.deepStrictEqual(REPRESENTATIVES, ['Katy', 'Gaby', 'Jessa', 'Julie', 'Janet']);
assert.deepStrictEqual(REPRESENTATIVE_CODES, {Katy: '17', Gaby: '85', Jessa: '08', Julie: '89', Janet: '01'});
console.log('Trade-show representative tests passed.');
