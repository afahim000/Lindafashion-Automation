const { JSDOM } = require('jsdom');
const config = require('../config');
const ediExplorer = require('../ediExplorer');
const {searchOrdersByCustomer} = require('./ediOrderAcknowledgment');

const PDA_ORDER_PATH = '/edibs/oe/oe_pda_order_create.php';
const CREATE_PATH = '/edibs/oe/index.php';
const CUSTOMER_ATTACH_PATH = '/edibs/oe/oe_pda_order_create_iframe.php';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function headers(sessionCookie, referer) {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Cookie: sessionCookie,
    Host: config.EDI_HOST,
    Origin: config.EDI_BASE_URL,
    Referer: referer,
    'User-Agent': 'LindaFashion-Automation PDA order service',
  };
}

function parsePdaPage(html) {
  const document = new JSDOM(html).window.document;
  const showSelect = document.querySelector('select[name="sel_show_cod"]');
  const tradeShows = showSelect ? [...showSelect.options]
    .filter((option) => option.value)
    .map((option) => ({code: option.value, label: clean(option.textContent)})) : [];
  const orders = [...document.querySelectorAll('tr')].map((row) => {
    const checkbox = row.querySelector('input[type="checkbox"][name^="DNUM_"]');
    const cells = [...row.children].filter((cell) => /^(TD|TH)$/.test(cell.tagName));
    if (!checkbox || cells.length < 14) return null;
    const values = cells.map((cell) => clean(cell.textContent));
    return {
      internalName: checkbox.name,
      internalValue: checkbox.value,
      customerNumber: values[2],
      customerName: values[3],
      storeNumber: values[4],
      orderDate: values[5],
      pdaOrderNumber: values[8],
      lines: values[9],
      quantity: values[10],
      amount: values[11],
      userLog: values[12],
    };
  }).filter(Boolean);
  return {tradeShows, orders};
}

async function fetchPdaPage(sessionCookie) {
  const url = new URL(PDA_ORDER_PATH, config.EDI_BASE_URL).toString();
  const response = await fetch(url, {headers: headers(sessionCookie, url)});
  if (!response.ok) throw new Error(`PDA order queue returned HTTP ${response.status}.`);
  return parsePdaPage(await response.text());
}

async function listPdaOrders() {
  const sessionCookie = await ediExplorer.login();
  return fetchPdaPage(sessionCookie);
}

function sameAmount(left, right) {
  return Number(String(left).replace(/[$,]/g, '')) === Number(String(right).replace(/[$,]/g, ''));
}

function attachedCustomerFromHtml(html, internalValue, expectedCode) {
  const nameField = `DNUMCUSTNAME_${internalValue}`;
  const numberField = `DNUMCUSTNO_${internalValue}`;
  const codePattern = new RegExp(`${numberField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.value\\s*=\\s*['"]${expectedCode}['"]`, 'i');
  const namePattern = new RegExp(`${nameField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.value\\s*=\\s*['"]([^'"]+)['"]`, 'i');
  const customerName = html.match(namePattern)?.[1]?.trim() || '';
  if(!codePattern.test(html) || !customerName) throw new Error(`EDI could not attach customer ${expectedCode} to the PDA order.`);
  return {customerCode: expectedCode, customerName, nameField, numberField};
}

async function attachCustomerToPdaOrder(sessionCookie, order, customerCode) {
  const attachUrl = new URL(CUSTOMER_ATTACH_PATH, config.EDI_BASE_URL);
  attachUrl.search = new URLSearchParams({
    vtype: 'cust', val1: customerCode, val2: `DNUMCUSTNAME_${order.internalValue}`,
    val3: order.internalValue, val4: `DNUMCUSTNO_${order.internalValue}`, val5: 'undefined',
  }).toString();
  const response = await fetch(attachUrl, {headers: headers(sessionCookie, new URL(PDA_ORDER_PATH, config.EDI_BASE_URL).toString())});
  if(!response.ok) throw new Error(`EDI customer attachment returned HTTP ${response.status}.`);
  return attachedCustomerFromHtml(await response.text(), order.internalValue, customerCode);
}

async function resolveCreatedOrder(pdaOrder, customerCode = '') {
  const lookupCustomer = clean(customerCode) || pdaOrder.customerNumber || pdaOrder.customerName;
  const matches = await searchOrdersByCustomer(lookupCustomer);
  return matches
    .filter((order) => !clean(customerCode) || order.customerNumber === customerCode)
    .filter((order) => clean(customerCode) || order.customerNumber === pdaOrder.customerNumber)
    .filter((order) => sameAmount(order.orderedAmount, pdaOrder.amount))
    .filter((order) => Number(order.orderedQuantity) === Number(pdaOrder.quantity))
    .sort((left, right) => Number(right.code) - Number(left.code))[0] || null;
}

async function createPdaOrder(pdaOrderNumber, showCode, customerCode = '') {
  if (!clean(pdaOrderNumber)) throw new Error('A PDA order number is required.');
  showCode = clean(showCode) || config.EDI_PDA_TRADE_SHOW;
  const sessionCookie = await ediExplorer.login();
  const before = await fetchPdaPage(sessionCookie);
  if (!before.tradeShows.some((show) => show.code === showCode)) throw new Error('The selected trade show is not available in EDI.');
  const matches = before.orders.filter((order) => order.pdaOrderNumber === pdaOrderNumber);
  if (matches.length !== 1) throw new Error(`Expected one pending ${pdaOrderNumber} order; found ${matches.length}.`);
  const order = matches[0];
  const customerAttachment = clean(customerCode)
    ? await attachCustomerToPdaOrder(sessionCookie, order, clean(customerCode).toUpperCase())
    : null;

  const form = new FormData();
  for (const [name, value] of Object.entries({
    process_this: '', checklist_this: '', cmd: 'pda_order_create', subcmd: '', select_lin_cnt: '1',
    err_show_code_missing: 'false', sel_ord_typ: 'O', sel_div: '01', sel_whse: 'AA',
    sel_show_cod: showCode, sel_create_user: '', sel_inactive_item_flg: 'f', input_local_file_name: '',
    helpbox: '', '$dchkshow': '',
  })) form.append(name, value);
  form.append(order.internalName, order.internalValue);
  if(customerAttachment) {
    form.append(customerAttachment.numberField, customerAttachment.customerCode);
    form.append(customerAttachment.nameField, customerAttachment.customerName);
  }

  const queueUrl = new URL(PDA_ORDER_PATH, config.EDI_BASE_URL).toString();
  const response = await fetch(new URL(CREATE_PATH, config.EDI_BASE_URL), {
    method: 'POST', redirect: 'manual', headers: headers(sessionCookie, queueUrl), body: form,
  });
  const location = response.headers.get('location') || '';
  if (response.status !== 302 || !/1 ORDERS CREATED\./i.test(decodeURIComponent(location))) {
    throw new Error(`EDI did not confirm creation of ${pdaOrderNumber}.`);
  }
  const after = await fetchPdaPage(sessionCookie);
  if (after.orders.some((pending) => pending.pdaOrderNumber === pdaOrderNumber)) {
    throw new Error(`EDI reported success, but ${pdaOrderNumber} remains pending.`);
  }
  const createdOrder = await resolveCreatedOrder(order, clean(customerCode).toUpperCase());
  return {pdaOrder: order, createdOrder, remainingOrders: after.orders};
}

module.exports = {listPdaOrders, createPdaOrder, attachedCustomerFromHtml};
