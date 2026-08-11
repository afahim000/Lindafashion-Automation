const { JSDOM } = require('jsdom');
const config = require('../config');
const ediExplorer = require('../ediExplorer');

const PDA_ORDER_PATH = '/edibs/oe/oe_pda_order_create.php';
const CREATE_PATH = '/edibs/oe/index.php';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function readArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function parsePendingOrders(html) {
  const document = new JSDOM(html).window.document;
  return [...document.querySelectorAll('tr')].map((row) => {
    const checkbox = row.querySelector('input[type="checkbox"][name^="DNUM_"]');
    const cells = [...row.children].filter((cell) => /^(TD|TH)$/.test(cell.tagName));
    if (!checkbox || cells.length < 14) return null;
    const values = cells.map((cell) => clean(cell.textContent));
    return {
      checkboxName: checkbox.name,
      checkboxValue: checkbox.value,
      customerNumber: values[2],
      customerName: values[3],
      orderDate: values[5],
      pdaOrderNumber: values[8],
      lines: values[9],
      quantity: values[10],
      amount: values[11],
      userLog: values[12],
    };
  }).filter(Boolean);
}

async function fetchQueue(sessionCookie) {
  const url = new URL(PDA_ORDER_PATH, config.EDI_BASE_URL).toString();
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: sessionCookie,
      Host: config.EDI_HOST,
      Referer: url,
      'User-Agent': 'LindaFashion-Automation PDA order creator',
    },
  });
  if (!response.ok) throw new Error(`Queue request returned HTTP ${response.status}.`);
  return parsePendingOrders(await response.text());
}

async function createOrder() {
  const expectedOrder = readArg('order');
  const showCode = readArg('show');
  const confirmed = process.argv.includes('--confirm');
  if (!expectedOrder || !showCode || !confirmed) {
    throw new Error('Usage: node tests/createPdaOrder.js --order=ORDER --show=SHOW --confirm');
  }

  const sessionCookie = await ediExplorer.login();
  const before = await fetchQueue(sessionCookie);
  const matches = before.filter((order) => order.pdaOrderNumber === expectedOrder);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one pending ${expectedOrder} order; found ${matches.length}.`);
  }
  const order = matches[0];

  const form = new FormData();
  form.append('process_this', '');
  form.append('checklist_this', '');
  form.append('cmd', 'pda_order_create');
  form.append('subcmd', '');
  form.append('select_lin_cnt', '1');
  form.append('err_show_code_missing', 'false');
  form.append('sel_ord_typ', 'O');
  form.append('sel_div', '01');
  form.append('sel_whse', 'AA');
  form.append('sel_show_cod', showCode);
  form.append('sel_create_user', '');
  form.append('sel_inactive_item_flg', 'f');
  form.append('input_local_file_name', '');
  form.append('helpbox', '');
  form.append(order.checkboxName, order.checkboxValue);
  form.append('$dchkshow', '');

  const createUrl = new URL(CREATE_PATH, config.EDI_BASE_URL).toString();
  const response = await fetch(createUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: sessionCookie,
      Host: config.EDI_HOST,
      Origin: config.EDI_BASE_URL,
      Referer: new URL(PDA_ORDER_PATH, config.EDI_BASE_URL).toString(),
      'User-Agent': 'LindaFashion-Automation PDA order creator',
    },
    body: form,
  });

  const location = response.headers.get('location') || '';
  if (response.status !== 302 || !/1 ORDERS CREATED\./i.test(decodeURIComponent(location))) {
    throw new Error(`EDI did not confirm one created order (HTTP ${response.status}).`);
  }

  const after = await fetchQueue(sessionCookie);
  if (after.some((pending) => pending.pdaOrderNumber === expectedOrder)) {
    throw new Error(`EDI reported success, but ${expectedOrder} is still pending.`);
  }

  console.log(JSON.stringify({
    ok: true,
    createdOrder: expectedOrder,
    showCode,
    customerNumber: order.customerNumber,
    customerName: order.customerName,
    quantity: order.quantity,
    amount: order.amount,
    confirmation: '1 ORDERS CREATED.',
    pendingOrdersAfter: after.length,
  }, null, 2));
}

createOrder().catch((error) => {
  console.error(`PDA order creation failed: ${error.message}`);
  process.exitCode = 1;
});
