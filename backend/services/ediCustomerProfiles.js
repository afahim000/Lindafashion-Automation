const {JSDOM} = require('jsdom');
const config = require('../config');
const ediExplorer = require('../ediExplorer');
const {suggestCustomerNumber} = require('./ediCustomerNumbers');

const CUSTOMER_PAGE = '/edibs/ar/ar_customer.php';
const CUSTOMER_AJAX = '/edibs/ar/ar_customer_aj.php';
const CUSTOMER_ACTION = '/edibs/ar/index.php';

function text(value) { return String(value || '').trim(); }

function validateProfile(profile)
{
    const required = {name: 'Customer name', country: 'Country'};
    if(!profile.deferAddress) Object.assign(required, {address1: 'Address', city: 'City', state: 'State', zip: 'ZIP code'});
    for(const [field, label] of Object.entries(required)) if(!text(profile[field])) throw new Error(`${label} is required.`);
    if(!text(profile.phone) && !text(profile.email)) throw new Error('Enter at least a phone number or an email address.');
    if(text(profile.state) && !/^[A-Z]{2}$/i.test(text(profile.state))) throw new Error('State must be a two-letter code.');
    if(!/^[A-Z]{2}$/i.test(text(profile.country))) throw new Error('Country must be a two-letter code.');
    if(text(profile.email) && !/^\S+@\S+\.\S+$/.test(text(profile.email))) throw new Error('Enter a valid email address.');
}

function requestHeaders(sessionCookie, referer)
{
    return {
        Accept: 'text/javascript, text/html, application/xml, text/xml, */*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: sessionCookie,
        Host: config.EDI_HOST, Origin: config.EDI_BASE_URL, Referer: referer,
        'X-Requested-With': 'XMLHttpRequest', 'X-Prototype-Version': '1.7.2',
        'User-Agent': 'LindaFashion-Automation customer profile service',
    };
}

function controlsFromHtml(html)
{
    const document = new JSDOM(html).window.document;
    const params = new URLSearchParams();
    for(const control of document.querySelectorAll('input[name], select[name], textarea[name]'))
    {
        if(control.disabled || ['button', 'submit', 'reset', 'file'].includes(String(control.type).toLowerCase())) continue;
        if(['checkbox', 'radio'].includes(String(control.type).toLowerCase()) && !control.checked) continue;
        params.append(control.name, control.value || '');
    }
    return params;
}

function setFields(params, fields)
{
    for(const [name, value] of Object.entries(fields)) params.set(name, String(value ?? ''));
    return params;
}

async function loadCustomerForm(sessionCookie, code = '')
{
    const pageUrl = new URL(CUSTOMER_PAGE, config.EDI_BASE_URL);
    if(code) pageUrl.searchParams.set('code', code);
    const pageResponse = await fetch(pageUrl, {headers: requestHeaders(sessionCookie, pageUrl.toString())});
    if(!pageResponse.ok) throw new Error(`EDI customer page returned HTTP ${pageResponse.status}.`);
    const base = new URLSearchParams({
        oname: '', cmd: code ? 'customer' : '', subcmd: '', direction: '', entd_year: '', validate_type: '',
        validate_value: '', validate_value2: '', mainlen: '4', sublen: '3', cconfig_multi_warehse_flg: 'N',
        code, ajcmd: 'ajcmd_form_body',
    });
    const response = await fetch(new URL(CUSTOMER_AJAX, config.EDI_BASE_URL), {
        method: 'POST', headers: requestHeaders(sessionCookie, pageUrl.toString()), body: base.toString(),
    });
    if(!response.ok) throw new Error(`EDI customer form returned HTTP ${response.status}.`);
    return controlsFromHtml(await response.text());
}

async function submitCustomer(sessionCookie, params)
{
    const pageUrl = new URL(CUSTOMER_PAGE, config.EDI_BASE_URL).toString();
    const response = await fetch(new URL(CUSTOMER_ACTION, config.EDI_BASE_URL), {
        method: 'POST', headers: requestHeaders(sessionCookie, pageUrl), body: params.toString(),
    });
    if(!response.ok) throw new Error(`EDI customer update returned HTTP ${response.status}.`);
    return response.text();
}

async function createCustomerProfile(profile, representativeCode)
{
    validateProfile(profile);
    if(!/^\d{2}$/.test(text(representativeCode))) throw new Error('A valid representative is required.');
    const suggestion = await suggestCustomerNumber(profile.name);
    const code = suggestion.code;
    const sessionCookie = await ediExplorer.login();
    const insert = await loadCustomerForm(sessionCookie);
    setFields(insert, {
        oname: '', cmd: 'customer', subcmd: '', direction: '', entd_year: '', validate_type: '',
        validate_value: '', validate_value2: '', mainlen: '4', sublen: '3', cconfig_multi_warehse_flg: 'N',
        code, new_customer_name: text(profile.name), new_customer_st1: text(profile.address1),
        new_customer_st2: text(profile.address2), new_customer_city: text(profile.city),
        new_customer_state: text(profile.state).toUpperCase(), new_customer_zip_cod: text(profile.zip),
        called_pgm: 'ar_customer', new_customer_country: text(profile.country).toUpperCase(),
        new_customer_phone_no1: text(profile.phone), new_customer_email_no1: text(profile.email),
        new_customer_active_flg: 't', active_flg_dsply: 'Yes', new_customer_backord_flg: 't',
        backord_flg_dsply: 'Yes', new_customer_part_ship_flg: 't', part_ship_flg_dsply: 'Yes',
        new_customer_ar_main_acct_no: '1100', new_customer_ar_sub_acct_no: '000',
        new_customer_ar_pft_ctr1: '00000000', new_customer_ar_pft_ctr2: '00000000',
        aracct_desc: 'ACCOUNTS RECEIVABLE', new_customer_bal_meth: 'O', new_customer_term_cod: 'COD',
        new_customer_frt_term_cod: 'A', new_customer_tax_cod: 'NT', new_customer_prc_cod: '1',
        new_customer_cr_limit: '0', new_customer_stmnt_cycl: 'M', new_customer_factor_cod: 'H',
        factors_desc: 'HOUSE', new_customer_charg_freight_flg: 't', charg_freight_flg_dsply: 'Yes',
        new_customer_use_po_flg: 't', use_po_flg_dsply: 'Yes', button_Update: 'INSERT', delete_row: '',
    });
    const insertResponse = await submitCustomer(sessionCookie, insert);
    if(!new RegExp(`ajForm_Body\\('div_body','${code}'\\)`, 'i').test(insertResponse)) {
        throw new Error(`EDI did not confirm creation of customer ${code}.`);
    }

    const update = await loadCustomerForm(sessionCookie, code);
    if(!update.get('new_customer_id')) throw new Error(`Customer ${code} was created, but EDI did not return its profile for the representative update.`);
    update.set('cmd', 'customer');
    update.set('code', code);
    update.set('new_customer_sls_rep', representativeCode);
    update.set('button_Update', 'UPDATE');
    const updateResponse = await submitCustomer(sessionCookie, update);
    if(!new RegExp(`ajForm_Body\\('div_body','${code}'\\)`, 'i').test(updateResponse)) {
        throw new Error(`Customer ${code} was created, but EDI did not confirm representative ${representativeCode}.`);
    }
    const verified = await loadCustomerForm(sessionCookie, code);
    if(verified.get('new_customer_sls_rep') !== representativeCode) {
        throw new Error(`Customer ${code} was created, but its representative could not be verified.`);
    }
    return {code, customerName: text(profile.name).toUpperCase(), representativeCode};
}

module.exports = {validateProfile, controlsFromHtml, createCustomerProfile};
