const { JSDOM } = require('jsdom');
const config = require('../config');
const ediExplorer = require('../ediExplorer');

const ORDER_LIST_PATH = '/edibs/oe/oe_ordhdr_list.php';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function readArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function parseMatchingRows(html, customerQuery) {
  const document = new JSDOM(html).window.document;
  const needle = customerQuery.toLocaleUpperCase();
  const seen = new Set();

  return [...document.querySelectorAll('tr')].flatMap((row) => {
    const cells = [...row.children].filter((cell) => /^(TD|TH)$/.test(cell.tagName));
    if (cells.length < 4) return [];
    const values = cells.map((cell) => clean(cell.textContent));
    if (!values.some((value) => value.toLocaleUpperCase().includes(needle))) return [];

    const links = [...row.querySelectorAll('a[href]')].map((link) => ({
      text: clean(link.textContent),
      href: link.getAttribute('href'),
    }));
    const controls = [...row.querySelectorAll('input, button, select')].map((control) => ({
      tag: control.tagName.toLowerCase(),
      name: control.name || '',
      value: control.value || '',
      type: control.type || '',
    }));
    const signature = JSON.stringify({ values, links, controls });
    if (seen.has(signature)) return [];
    seen.add(signature);
    return [{ values, links, controls }];
  });
}

async function searchOrders() {
  const customerQuery = readArg('customer');
  if (!customerQuery) {
    throw new Error('Usage: node tests/searchEdiOrdersByCustomer.js --customer="CUSTOMER NAME"');
  }

  const sessionCookie = await ediExplorer.login();
  const form = new FormData();
  form.append('order_by_method', 'd');
  form.append('ft_slsrep1', '');
  form.append('filtertext', '');
  form.append('condition', 'code');
  form.append('sel_stage', '0');
  form.append('sel_ord_typ', '');
  form.append('page', '1');
  form.append('sel_max_rows', '1000');

  const listUrl = new URL(ORDER_LIST_PATH, config.EDI_BASE_URL).toString();
  const response = await fetch(listUrl, {
    method: 'POST',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: sessionCookie,
      Host: config.EDI_HOST,
      Origin: config.EDI_BASE_URL,
      Referer: listUrl,
      'User-Agent': 'LindaFashion-Automation EDI order search',
    },
    body: form,
  });
  if (!response.ok) throw new Error(`Order list returned HTTP ${response.status}.`);

  const matches = parseMatchingRows(await response.text(), customerQuery);
  console.log(JSON.stringify({
    ok: true,
    customerQuery,
    maxRows: 1000,
    matchCount: matches.length,
    matches,
  }, null, 2));
}

searchOrders().catch((error) => {
  console.error(`EDI customer search failed: ${error.message}`);
  process.exitCode = 1;
});
