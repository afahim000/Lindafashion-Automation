const { JSDOM } = require('jsdom');
const config = require('../config');
const ediExplorer = require('../ediExplorer');

const PDA_ORDER_PATH = '/edibs/oe/oe_pda_order_create.php';

function requireConfig() {
  const required = [
    'EDI_BASE_URL',
    'EDI_HOST',
    'EDI_COMP_CODE',
    'EDI_USERNAME',
    'EDI_PASSWORD',
    'EDI_USER_COOKIE',
    'EDI_COMP_COOKIE',
  ];
  const missing = required.filter((key) => !config[key]);

  if (missing.length) {
    throw new Error(`Missing required EDI configuration: ${missing.join(', ')}`);
  }
}

async function testPdaOrderAccess() {
  requireConfig();

  const sessionCookie = await ediExplorer.login();
  if (!sessionCookie || !sessionCookie.startsWith('PHPSESSID=')) {
    throw new Error('EDI login did not return a PHP session cookie.');
  }

  const targetUrl = new URL(PDA_ORDER_PATH, config.EDI_BASE_URL).toString();
  const response = await fetch(targetUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: sessionCookie,
      Host: config.EDI_HOST,
      Referer: targetUrl,
      'User-Agent': 'LindaFashion-Automation EDI access test',
    },
  });

  const html = await response.text();
  const document = new JSDOM(html).window.document;
  const normalizedText = document.body?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const title = document.title.trim();
  const hasOrderControls =
    /CREATE ORDER/i.test(normalizedText) &&
    /TRADE SHOW/i.test(normalizedText) &&
    /CUSTOMER|CUST NAME/i.test(normalizedText);
  const looksLikeLogin =
    /login\.php/i.test(response.url) ||
    Boolean(document.querySelector('input[type="password"]'));

  console.log(JSON.stringify({
    ok: response.ok && hasOrderControls && !looksLikeLogin,
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get('content-type'),
    title,
    responseBytes: Buffer.byteLength(html),
    hasOrderControls,
    looksLikeLogin,
    sessionCookieReceived: true,
  }, null, 2));

  if (!response.ok) {
    throw new Error(`PDA order page returned HTTP ${response.status}.`);
  }
  if (looksLikeLogin) {
    throw new Error('The request was sent back to the EDI login page.');
  }
  if (!hasOrderControls) {
    throw new Error('The response did not contain the expected PDA order controls.');
  }
}

testPdaOrderAccess().catch((error) => {
  console.error(`PDA access test failed: ${error.message}`);
  process.exitCode = 1;
});
