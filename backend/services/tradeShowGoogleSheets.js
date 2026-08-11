const {google} = require('googleapis');
const {authorizedGoogleClient} = require('./gmailOAuth');

const DEFAULT_SPREADSHEET_ID = '1APzsFpz3LpfcaK759D5BFvMJ39ND7lXOXkFHWGPjPdg';
const DEFAULT_SHEET_NAME = 'MAR2026';

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }

function orderRow(order)
{
    const code = clean(order.code);
    const customerName = clean(order.customerName);
    const amount = Number(String(order.amount || order.orderedAmount || '').replace(/[$,]/g, ''));
    if(!code) throw new Error('The permanent EDI order number is required.');
    if(!customerName) throw new Error('The customer name is required.');
    if(!Number.isFinite(amount)) throw new Error('The order amount is invalid.');
    return [
        clean(order.orderDate), customerName, code, '', amount, clean(order.repAtShow),
        clean(order.finalRep).toUpperCase(), order.newCustomer ? 'YES' : 'NO',
        clean(order.paymentMethod), clean(order.paymentAmount), clean(order.notes),
    ];
}

async function recordTradeShowOrder(order, env = process.env)
{
    const spreadsheetId = env.TRADE_SHOW_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
    const sheetName = env.TRADE_SHOW_SHEET_NAME || DEFAULT_SHEET_NAME;
    const auth = authorizedGoogleClient(env);
    const sheets = google.sheets({version: 'v4', auth});
    const existing = await sheets.spreadsheets.values.get({spreadsheetId, range: `'${sheetName.replace(/'/g, "''")}'!A13:K`});
    const rows = existing.data.values || [];
    const code = clean(order.code);
    const duplicateIndex = rows.findIndex((row)=> clean(row[2]) === code);
    if(duplicateIndex >= 0) return {status: 'already-recorded', row: duplicateIndex + 13, spreadsheetId, sheetName};
    const firstEmptyIndex = rows.findIndex((row)=> !clean(row[1]));
    const rowNumber = (firstEmptyIndex >= 0 ? firstEmptyIndex : rows.length) + 13;
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName.replace(/'/g, "''")}'!A${rowNumber}:K${rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {values: [orderRow(order)]},
    });
    const verify = await sheets.spreadsheets.values.get({spreadsheetId, range: `'${sheetName.replace(/'/g, "''")}'!A${rowNumber}:K${rowNumber}`});
    if(clean(verify.data.values?.[0]?.[2]) !== code) throw new Error('Google Sheets did not verify the recorded sales order number.');
    return {status: 'recorded', row: rowNumber, spreadsheetId, sheetName};
}

module.exports = {orderRow, recordTradeShowOrder};
