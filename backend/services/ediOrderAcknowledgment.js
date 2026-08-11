const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const config = require('../config');
const ediExplorer = require('../ediExplorer');

const ORDER_LIST_PATH = '/edibs/oe/oe_ordhdr_list.php';
const ORDER_HEADER_PATH = '/edibs/oe/oe_ordhdr.php';
const EDI_INDEX_PATH = '/edibs/oe/index.php';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function requestHeaders(sessionCookie, referer) {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Cookie: sessionCookie,
    Host: config.EDI_HOST,
    Origin: config.EDI_BASE_URL,
    Referer: referer,
    'User-Agent': 'LindaFashion-Automation EDI acknowledgment service',
  };
}

function parseOrderRows(html, customerQuery) {
  const document = new JSDOM(html).window.document;
  const needle = clean(customerQuery).toLocaleUpperCase();
  const matches = [];
  const seenCodes = new Set();

  for (const row of document.querySelectorAll('tr')) {
    const cells = [...row.children].filter((cell) => /^(TD|TH)$/.test(cell.tagName));
    if (cells.length < 20) continue;
    const values = cells.map((cell) => clean(cell.textContent));
    if (!values.some((value) => value.toLocaleUpperCase().includes(needle))) continue;
    const orderLink = [...row.querySelectorAll('a[href*="oe_ordhdr.php?code="]')][0];
    const code = orderLink?.href.match(/[?&]code=(\d+)/)?.[1];
    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);
    matches.push({
      code,
      orderNumber: values[1],
      customerNumber: values[5],
      customerName: values[6],
      orderedQuantity: values[7],
      orderedAmount: values[8],
      openQuantity: values[10],
      openAmount: values[11],
      city: values[13],
      state: values[14],
      orderDate: values[16],
      division: values[18],
      warehouse: values[19],
      user: values[20] || '',
    });
  }
  return matches;
}

async function searchOrdersByCustomer(customerQuery) {
  if (!clean(customerQuery)) throw new Error('Customer name is required.');
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
    headers: requestHeaders(sessionCookie, listUrl),
    body: form,
  });
  if (!response.ok) throw new Error(`EDI order list returned HTTP ${response.status}.`);
  return parseOrderRows(await response.text(), customerQuery);
}

function appendSuccessfulControls(formData, formElement) {
  for (const control of formElement.querySelectorAll('input, select, textarea')) {
    if (!control.name || control.disabled) continue;
    const type = String(control.type || '').toLowerCase();
    if (['button', 'submit', 'reset', 'image', 'file'].includes(type)) continue;
    if (['checkbox', 'radio'].includes(type) && !control.checked) continue;
    if (control.tagName === 'SELECT' && control.multiple) {
      for (const option of control.selectedOptions) formData.append(control.name, option.value);
    } else {
      formData.append(control.name, control.value || '');
    }
  }
}

async function createAcknowledgmentPdf(orderCode, outputDirectory) {
  if (!/^\d+$/.test(String(orderCode))) throw new Error('A valid EDI order code is required.');
  const sessionCookie = await ediExplorer.login();
  const orderUrl = new URL(`${ORDER_HEADER_PATH}?code=${orderCode}`, config.EDI_BASE_URL).toString();
  const orderResponse = await fetch(orderUrl, {headers: requestHeaders(sessionCookie, orderUrl)});
  if (!orderResponse.ok) throw new Error(`EDI order page returned HTTP ${orderResponse.status}.`);
  const document = new JSDOM(await orderResponse.text()).window.document;
  const orderForm = [...document.querySelectorAll('form')].find((form) =>
    form.querySelector('[name="ordhdrs_id"], [name="new_ordhdrs_id"]'),
  );
  if (!orderForm) throw new Error('The EDI order form could not be found.');

  const form = new FormData();
  appendSuccessfulControls(form, orderForm);
  form.set('code', String(orderCode));
  form.set('cmd', 'ordack_print_batch');
  form.set('subcmd', 'ordhdr');
  form.set('ordhdrs_id', String(orderCode));
  form.set('new_ordhdrs_id', String(orderCode));
  form.set('direction', '0');
  form.set('its_popup', 't');
  form.set('reprint_flg', 'f');
  form.set('sel_ack_typ', 'ACK');

  const indexUrl = new URL(EDI_INDEX_PATH, config.EDI_BASE_URL).toString();
  const printResponse = await fetch(indexUrl, {
    method: 'POST',
    headers: requestHeaders(sessionCookie, orderUrl),
    body: form,
  });
  if (!printResponse.ok) throw new Error(`EDI acknowledgment request returned HTTP ${printResponse.status}.`);
  const printDocument = new JSDOM(await printResponse.text()).window.document;
  const iframeSource = printDocument.querySelector('iframe[src$=".pdf"]')?.getAttribute('src');
  if (!iframeSource) throw new Error('EDI did not return an acknowledgment PDF.');

  const pdfUrl = new URL(iframeSource, config.EDI_BASE_URL).toString();
  const pdfResponse = await fetch(pdfUrl, {headers: requestHeaders(sessionCookie, orderUrl)});
  if (!pdfResponse.ok) throw new Error(`EDI acknowledgment PDF returned HTTP ${pdfResponse.status}.`);
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  if (pdf.subarray(0, 4).toString() !== '%PDF') throw new Error('EDI acknowledgment response was not a PDF.');

  fs.mkdirSync(outputDirectory, {recursive: true});
  const artifactId = `${orderCode}-${Date.now()}`;
  const savedPath = path.join(outputDirectory, `${artifactId}.pdf`);
  fs.writeFileSync(savedPath, pdf);
  return {artifactId, orderCode: String(orderCode), savedPath, pdfUrl};
}

module.exports = {searchOrdersByCustomer, createAcknowledgmentPdf};
