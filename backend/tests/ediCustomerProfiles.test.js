const assert = require('assert');
const {validateProfile, controlsFromHtml} = require('../services/ediCustomerProfiles');

assert.doesNotThrow(()=> validateProfile({name:'Acme',address1:'1 Main',city:'Miami',state:'FL',zip:'33101',country:'US',phone:'3055551212',email:'a@b.com'}));
assert.throws(()=> validateProfile({}), /Customer name is required/);
assert.throws(()=> validateProfile({name:'Acme',address1:'1 Main',city:'Miami',state:'Florida',zip:'33101',country:'US',phone:'1',email:'a@b.com'}), /two-letter/);
assert.doesNotThrow(()=> validateProfile({name:'Acme',country:'US',phone:'3055551212',email:'',deferAddress:true}));
assert.doesNotThrow(()=> validateProfile({name:'Acme',country:'US',phone:'',email:'a@b.com',deferAddress:true}));
assert.throws(()=> validateProfile({name:'Acme',country:'US',deferAddress:true}), /at least a phone number or an email/i);
const controls = controlsFromHtml(`<input name="code" value="ABC001"><input type="checkbox" name="yes" value="t" checked><input type="checkbox" name="no" value="t"><select name="rep"><option value="17">Katy</option><option value="85" selected>Gaby</option></select>`);
assert.strictEqual(controls.get('code'), 'ABC001');
assert.strictEqual(controls.get('yes'), 't');
assert.strictEqual(controls.has('no'), false);
assert.strictEqual(controls.get('rep'), '85');
console.log('EDI customer profile tests passed.');
