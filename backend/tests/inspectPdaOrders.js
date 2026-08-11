const { JSDOM } = require('jsdom');
const config = require('../config');
const ediExplorer = require('../ediExplorer');

const PDA_ORDER_PATH = '/edibs/oe/oe_pda_order_create.php';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function inspectPdaOrders() {
  const sessionCookie = await ediExplorer.login();
  const targetUrl = new URL(PDA_ORDER_PATH, config.EDI_BASE_URL).toString();
  const response = await fetch(targetUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: sessionCookie,
      Host: config.EDI_HOST,
      Referer: targetUrl,
      'User-Agent': 'LindaFashion-Automation PDA order inspector',
    },
  });
  const html = await response.text();
  const document = new JSDOM(html).window.document;

  const selects = [...document.querySelectorAll('select')].map((select) => ({
    name: select.name || select.id || '(unnamed)',
    selected: clean(select.selectedOptions?.[0]?.textContent),
    options: [...select.options].map((option) => ({
      value: option.value,
      label: clean(option.textContent),
      selected: option.selected,
    })),
  }));

  const tables = [...document.querySelectorAll('table')].map((table, tableIndex) => {
    const rows = [...table.querySelectorAll('tr')].map((row) =>
      [...row.querySelectorAll(':scope > th, :scope > td')].map((cell) => clean(cell.textContent)),
    ).filter((row) => row.some(Boolean));
    return { tableIndex, rows };
  }).filter((table) => table.rows.length);

  const orderTable = tables.find((table) => {
    const text = table.rows.flat().join(' ').toUpperCase();
    return text.includes('CUST #') && text.includes('ORD#') && text.includes('$ AMOUNT');
  });

  const orderRows = orderTable?.rows.filter((row) => {
    const text = row.join(' ').toUpperCase();
    return row.length >= 8 &&
      !text.includes('CUST #') &&
      !text.includes('TOTAL') &&
      row.some((cell) => cell && cell !== '#');
  }) || [];

  const populatedRows = [...document.querySelectorAll('tr')].map((row) => {
    const cells = [...row.children].filter((cell) => /^(TD|TH)$/.test(cell.tagName));
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox || cells.length < 10) return null;

    return {
      checkbox: { name: checkbox.name, value: checkbox.value },
      cells: cells.map((cell) => {
      const select = cell.querySelector('select');
      if (select) {
        const selected = select.selectedOptions?.[0];
        return clean(selected?.textContent || selected?.value);
      }
      const input = cell.querySelector('input:not([type="checkbox"]):not([type="hidden"])');
      if (input) return clean(input.value);
      return clean(cell.textContent);
      }),
    };
  }).filter(Boolean).filter((row) => row.cells.some((cell) => cell));

  console.log(JSON.stringify({
    status: response.status,
    title: document.title,
    selects,
    orderTableFound: Boolean(orderTable),
    orderRowCount: orderRows.length,
    orderRows,
    populatedRows,
  }, null, 2));
}

inspectPdaOrders().catch((error) => {
  console.error(`PDA order inspection failed: ${error.message}`);
  process.exitCode = 1;
});
