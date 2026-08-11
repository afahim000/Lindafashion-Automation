const fs = require('fs');
const path = require('path');

const REPRESENTATIVE_CODES = Object.freeze({Katy: '17', Gaby: '85', Jessa: '08', Julie: '89', Janet: '01'});
const REPRESENTATIVES = Object.keys(REPRESENTATIVE_CODES);
const STORE_PATH = path.join(__dirname, '..', 'data', 'trade-show-representatives.json');

function readStore()
{
    if(!fs.existsSync(STORE_PATH)) return {};
    try
    {
        const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
        return Object.fromEntries(Object.entries(store).map(([orderNumber, selection])=> [orderNumber, {
            ...selection,
            representativeCode: REPRESENTATIVE_CODES[selection.representative] || selection.representativeCode || '',
        }]));
    }
    catch(error) { throw new Error(`Could not read saved trade-show representatives: ${error.message}`); }
}

function saveRepresentative(pdaOrderNumber, representative)
{
    const orderNumber = String(pdaOrderNumber || '').trim();
    const selected = REPRESENTATIVES.find((name)=> name.toLowerCase() === String(representative || '').trim().toLowerCase());
    if(!orderNumber) throw new Error('A PDA order number is required.');
    if(!selected) throw new Error('Select a valid representative.');
    const store = readStore();
    store[orderNumber] = {
        ...(store[orderNumber] || {}),
        representative: selected,
        representativeCode: REPRESENTATIVE_CODES[selected],
        savedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(STORE_PATH), {recursive: true});
    fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    return store[orderNumber];
}

function saveCustomerProfile(pdaOrderNumber, customerProfile)
{
    const orderNumber = String(pdaOrderNumber || '').trim();
    if(!orderNumber) throw new Error('A PDA order number is required.');
    if(!customerProfile?.code) throw new Error('A created customer code is required.');
    const store = readStore();
    if(!store[orderNumber]) throw new Error('Select a representative before saving the customer profile.');
    store[orderNumber] = {...store[orderNumber], customerProfile, profileSavedAt: new Date().toISOString()};
    fs.mkdirSync(path.dirname(STORE_PATH), {recursive: true});
    fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    return store[orderNumber];
}

module.exports = {REPRESENTATIVES, REPRESENTATIVE_CODES, readStore, saveRepresentative, saveCustomerProfile};
