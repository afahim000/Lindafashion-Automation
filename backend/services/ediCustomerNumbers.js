const {JSDOM} = require('jsdom');
const config = require('../config');
const ediExplorer = require('../ediExplorer');

const CUSTOMER_LIST_PATH = '/edibs/ar/ar_customer_list_aj.php';

function customerPrefix(customerName)
{
    const firstThree = String(customerName || '').trim().toUpperCase().slice(0, 3);
    if(firstThree.length < 3) throw new Error('Customer name must contain at least three characters.');
    return [...firstThree].map((character)=> /[A-Z]/.test(character) ? character : 'X').join('');
}

function customerCodesFromHtml(html, prefix)
{
    const document = new JSDOM(html).window.document;
    const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');
    return [...document.querySelectorAll('a[href*="ar_customer.php?code="]')].map((link)=>
    {
        const href = link.getAttribute('href') || '';
        const encodedCode = href.match(/[?&]code=([^&]+)/i)?.[1] || '';
        const code = decodeURIComponent(encodedCode).trim().toUpperCase();
        const match = code.match(pattern);
        return match ? {code, number: Number(match[1])} : null;
    }).filter(Boolean);
}

function nextCustomerNumber(customerName, existingCodes)
{
    const prefix = customerPrefix(customerName);
    const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');
    const highest = existingCodes.reduce((maximum, value)=>
    {
        const match = String(value || '').trim().match(pattern);
        return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0);
    const next = highest + 1;
    return {prefix, highestNumber: highest, code: `${prefix}${String(next).padStart(3, '0')}`};
}

async function suggestCustomerNumber(customerName)
{
    const prefix = customerPrefix(customerName);
    const sessionCookie = await ediExplorer.login();
    const body = new URLSearchParams({
        called_as_popup: '', called_from: '', pass_returnObj: '', sort_meth: 'asc', sort_col: 'cust_no',
        sav_sort_col: '', alt_bgcolor: '#D2E2E4', output: '', condition: 'contact1', filter: 'FILTER',
        filtertext: prefix, ft_srch_for_text: '', ft_slsrep1: '', ft_state: '', show_ar: 'n',
        sel_active: 'a', sel_max_rows: '1000', goto_cust: 'New customer', helpbox: '', ajcmd: 'ajcmd_show_list',
    });
    const listUrl = new URL(CUSTOMER_LIST_PATH, config.EDI_BASE_URL).toString();
    const response = await fetch(listUrl, {
        method: 'POST',
        headers: {
            Accept: 'text/javascript, text/html, application/xml, text/xml, */*',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: sessionCookie,
            Host: config.EDI_HOST, Origin: config.EDI_BASE_URL,
            Referer: new URL('/edibs/ar/ar_customer_list.php', config.EDI_BASE_URL).toString(),
            'X-Requested-With': 'XMLHttpRequest', 'X-Prototype-Version': '1.7.2',
            'User-Agent': 'LindaFashion-Automation customer number service',
        },
        body: body.toString(),
    });
    if(!response.ok) throw new Error(`EDI customer search returned HTTP ${response.status}.`);
    const matches = customerCodesFromHtml(await response.text(), prefix);
    const suggestion = nextCustomerNumber(customerName, matches.map((match)=> match.code));
    return {...suggestion, existingCodes: matches.sort((a, b)=> a.number - b.number).map((match)=> match.code)};
}

module.exports = {customerPrefix, customerCodesFromHtml, nextCustomerNumber, suggestCustomerNumber};
