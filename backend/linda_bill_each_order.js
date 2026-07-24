const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const {JSDOM} = require('jsdom');
const ExcelJS = require('exceljs');
const config = require('./config');
const { setTimeout } = require('timers');

const BILL_EACH_ORDER_URL = '/edibs/oe/oe_bill_ordhdr.php';
const FINAL_POST_PATH = '/edibs/oe/index.php';
const CARTON_RELOAD_CMD = 'ordhdr_bill_ordhdr_wo_piktik_ctn';
const FINAL_CMD = 'ordhdr_bill_ordhdr_wo_piktik';
const FINAL_SUBCMD = 'sav_field';
const WORK_DIR = path.join(__dirname, 'invoiceWork');
const PREPARE_TIMEOUT_MS = 120000;
const SUBMIT_TIMEOUT_MS = 120000;
const PRINT_TIMEOUT_MS = 90000;
const EXCEL_TIMEOUT_MS = 420000;
const SUBMIT_GENERATE_TIMEOUT_MS = 600000;
const PRODUCT_IMAGE_DIR = process.env.PRODUCT_IMAGE_DIR || '\\\\LINDAWEB\\htdocs\\datalinda\\00linda\\pics\\product';

function logStep(jobId, message)
{
    console.log(`[make-invoice:${jobId || 'submit'}] ${message}`);
}

function withTimeout(promise, timeoutMs, message)
{
    return Promise.race([
        promise,
        new Promise((_, reject)=> setTimeout(()=> reject(new Error(message)), timeoutMs)),
    ]);
}

function ensureDirectory(directoryPath)
{
    if(!fs.existsSync(directoryPath))
    {
        fs.mkdirSync(directoryPath, {recursive: true});
    }
}

function safeName(value)
{
    return path.basename(String(value || 'file')).replace(/[^a-zA-Z0-9._-]/g, '-');
}

function requireConfig()
{
    const missing = ['EDI_BASE_URL', 'EDI_COMP_CODE', 'EDI_USERNAME', 'EDI_PASSWORD']
        .filter((key)=> !config[key]);

    if(missing.length > 0)
    {
        throw new Error(`Missing config values: ${missing.join(', ')}`);
    }
}

async function login(page)
{
    await page.goto(`${config.EDI_BASE_URL}/edibs/menu/login.php`, {waitUntil: 'networkidle2'});

    await page.evaluate(({compCode, username, password})=> {
        const setValue = (selectors, value)=> {
            const input = selectors.map((selector)=> document.querySelector(selector)).find(Boolean);

            if(input)
            {
                input.value = value;
                input.dispatchEvent(new Event('input', {bubbles: true}));
                input.dispatchEvent(new Event('change', {bubbles: true}));
            }
        };

        setValue(['input[name="comp_code"]', '#comp_code'], compCode);
        setValue(['input[name="username"]', '#username'], username);
        setValue(['input[name="password"]', '#password'], password);
    }, {
        compCode: config.EDI_COMP_CODE,
        username: config.EDI_USERNAME,
        password: config.EDI_PASSWORD,
    });

    await Promise.all([
        page.waitForNavigation({waitUntil: 'networkidle2', timeout: 45000}).catch(()=> null),
        page.evaluate(()=> {
            const form = document.querySelector('form');

            if(!form)
            {
                throw new Error('Login form not found');
            }

            form.submit();
        }),
    ]);
}

async function openBillEachOrder(page)
{
    await page.goto(`${config.EDI_BASE_URL}${BILL_EACH_ORDER_URL}`, {waitUntil: 'networkidle2'});
}

async function getContentsFrame(page)
{
    const startedAt = Date.now();

    while(Date.now() - startedAt < 30000)
    {
        const frames = page.frames();
        const preferredFrames = [
            ...frames.filter((frame)=> frame.name() === 'contents'),
            page.mainFrame(),
            ...frames,
        ];

        for(const frame of preferredFrames)
        {
            try
            {
                const ready = await frame.evaluate(()=> document.readyState === 'complete' || document.readyState === 'interactive');

                if(ready)
                {
                    return frame;
                }
            }
            catch(error)
            {
                // Frame may be mid-navigation; try again.
            }
        }

        await new Promise((resolve)=> setTimeout(resolve, 250));
    }

    throw new Error('Could not find a ready EDI contents frame');
}

async function applyFilter(page, orderNo)
{
    const frame = await getContentsFrame(page);
    const popupPromise = waitForPossiblePopup(page);

    const didClickBillTo = await frame.evaluate((order)=> {
        const orderInput = document.querySelector('#ft_ord_no, input[name="ft_ord_no"]');

        if(!orderInput)
        {
            return {
                ok: false,
                reason: 'ft_ord_no input not found',
            };
        }

        orderInput.value = String(order);
        orderInput.dispatchEvent(new Event('input', {bubbles: true}));
        orderInput.dispatchEvent(new Event('change', {bubbles: true}));

        /*
            Click the BILL TO panel instead of clicking FILTER.

            Target HTML example:
            <td width="30%" valign="top" class="table_border_r">
                ...
                <td><i>BILL TO:</i></td>
                <input type="hidden" id="allow_footer_chng" name="allow_footer_chng" value="t">
                ...
            </td>
        */

        const allowFooterField = document.querySelector('#allow_footer_chng, input[name="allow_footer_chng"]');

        let billToPanel = allowFooterField ?
            allowFooterField.closest('td.table_border_r') :
            null;

        if(!billToPanel)
        {
            billToPanel = [...document.querySelectorAll('td.table_border_r, td')]
                .find((td)=> /BILL TO:/i.test(td.innerText || td.textContent || ''));
        }

        if(!billToPanel)
        {
            return {
                ok: false,
                reason: 'BILL TO panel / allow_footer_chng area not found',
            };
        }

        billToPanel.scrollIntoView({
            block: 'center',
            inline: 'center',
        });

        billToPanel.dispatchEvent(new MouseEvent('mouseover', {
            bubbles: true,
            cancelable: true,
            view: window,
        }));

        billToPanel.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window,
        }));

        billToPanel.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            view: window,
        }));

        billToPanel.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
        }));

        return {
            ok: true,
            reason: 'Clicked BILL TO panel',
        };
    }, String(orderNo));

    if(!didClickBillTo.ok)
    {
        const debug = await getFilterDebug(page).catch((error)=> ({
            text: `Could not get debug text: ${error.message}`,
        }));

        throw new Error(`Could not click BILL TO area for order ${orderNo}. Reason: ${didClickBillTo.reason}. Page text: ${debug.text}`);
    }

    await waitForPageWork(page).catch(()=> null);

    if(await hasInvoiceItemRows(page))
    {
        return page;
    }

    const popupPage = await popupPromise;

    if(popupPage)
    {
        await popupPage.bringToFront();
        await popupPage.waitForNetworkIdle({idleTime: 1200, timeout: 45000}).catch(()=> null);

        if(await hasInvoiceItemRows(popupPage))
        {
            return popupPage;
        }

        const popupDebug = await getFilterDebug(popupPage).catch((error)=> ({
            text: `Could not get popup debug text: ${error.message}`,
        }));

        throw new Error(`Clicked BILL TO area, but invoice rows were not found in popup for order ${orderNo}. Popup text: ${popupDebug.text}`);
    }

    const debug = await getFilterDebug(page).catch((error)=> ({
        text: `Could not get debug text: ${error.message}`,
    }));

    throw new Error(`Clicked BILL TO area, but Bill Each Order rows were not found for order ${orderNo}. Page text: ${debug.text}`);
}

async function hasInvoiceItemRows(page)
{
    const frame = await getInvoiceFormFrame(page).catch(()=> null);

    if(!frame)
    {
        return false;
    }

    return frame.evaluate(()=> Boolean(
        document.querySelector('form#form1') &&
        document.querySelector('#sel_ctns, input[name="sel_ctns"]') &&
        document.querySelector('[name^="DNUMORDLIN_"]')
    ));
}

async function getInvoiceFormFrame(page, timeoutMs = 30000)
{
    const startedAt = Date.now();

    while(Date.now() - startedAt < timeoutMs)
    {
        const frames = [
            ...page.frames().filter((frame)=> frame.name() === 'contents'),
            ...page.frames(),
        ];

        for(const frame of frames)
        {
            const matches = await frame.evaluate(()=> Boolean(
                document.querySelector('form#form1') &&
                document.querySelector('#ft_ord_no, input[name="ft_ord_no"]') &&
                document.querySelector('[name^="DNUMORDLIN_"]')
            )).catch(()=> false);

            if(matches)
            {
                return frame;
            }
        }

        await new Promise((resolve)=> setTimeout(resolve, 250));
    }

    throw new Error('Could not find loaded invoice form frame');
}

async function reloadSubmittedInvoiceForm(page, orderNo)
{
    await page.goto(`${config.EDI_BASE_URL}${BILL_EACH_ORDER_URL}?ft_ord_no=${encodeURIComponent(orderNo)}&ft_orderby=I`, {
        waitUntil: 'networkidle2',
        timeout: 45000,
    }).catch(()=> null);

    if(await hasInvoiceItemRows(page))
    {
        return page;
    }

    await openBillEachOrder(page);
    return applyFilter(page, orderNo);
}

async function waitForAjaxListUpdate(page, orderNo)
{
    const frame = await getContentsFrame(page);

    await frame.waitForFunction((order)=> {
        const list = document.querySelector('#div_list');

        if(!list)
        {
            return false;
        }

        const text = list.textContent || '';

        const hasRows = Boolean(document.querySelector('[name^="DNUMORDLIN_"]'));
        const hasOrder = text.includes(String(order));
        const loading = /Load ListShow/i.test(text);

        return hasRows || hasOrder || !loading;
    }, {timeout: 45000}, String(orderNo));
}

function waitForPossiblePopup(page)
{
    const browser = page.browser();

    return new Promise((resolve)=> {
        const timeout = setTimeout(()=> {
            browser.off('targetcreated', onTargetCreated);
            resolve(null);
        }, 7000);

        async function onTargetCreated(target)
        {
            if(target.type() !== 'page')
            {
                return;
            }

            clearTimeout(timeout);
            browser.off('targetcreated', onTargetCreated);
            resolve(await target.page());
        }

        browser.on('targetcreated', onTargetCreated);
    });
}

async function clickFilteredOrderResult(page, orderNo)
{
    const frame = await getContentsFrame(page);

    return frame.evaluate((order)=> {
        const resultRoot = document.querySelector('#div_list') || document.body;
        const rows = [...resultRoot.querySelectorAll('tr')];
        const matchingRow = rows.find((row)=> row.textContent.includes(String(order))) ||
            rows.find((row)=> row.querySelector('a, input[type="button"], input[type="submit"], button'));
        const container = matchingRow || resultRoot;

        const clickable = [...container.querySelectorAll('a, input[type="button"], input[type="submit"], button')]
            .find((element)=> {
                const text = (element.textContent.trim() || element.value || '').toUpperCase();
                const href = element.getAttribute('href') || '';
                const onclick = element.getAttribute('onclick') || '';

                return text.includes('SELECT') ||
                    text.includes('BILL') ||
                    text.includes('OPEN') ||
                    href.includes('ordhdr') ||
                    onclick.includes('ordhdr') ||
                    href.includes('ajUpdate') ||
                    onclick.includes('ajUpdate') ||
                    href.startsWith('javascript:') ||
                    Boolean(onclick);
            });

        if(clickable)
        {
            clickable.click();
            return true;
        }

        if(matchingRow)
        {
            matchingRow.click();
            return true;
        }

        return false;
    }, String(orderNo));
}

async function getFilterDebug(page)
{
    const frame = await getContentsFrame(page);

    return frame.evaluate(()=> {
        const list = document.querySelector('#div_list') || document.body;
        return {
            text: (list.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 800),
            html: (list.innerHTML || '').slice(0, 2000),
        };
    });
}

async function setCartonsAndReload(page, orderNo, totalCartons)
{
    const frame = await getContentsFrame(page);
    const didReload = await frame.evaluate(({order, cartons, cartonCmd})=> {
        const cartonInput = document.querySelector('#sel_ctns, input[name="sel_ctns"]');

        if(!cartonInput)
        {
            return false;
        }

        cartonInput.value = String(cartons);
        cartonInput.dispatchEvent(new Event('input', {bubbles: true}));

        const form = cartonInput.form || document.querySelector('form#form1') || document.querySelector('form');

        if(form && !form.Submit99)
        {
            const submitShim = document.createElement('input');
            submitShim.type = 'hidden';
            submitShim.name = 'Submit99';
            submitShim.id = 'Submit99';
            form.appendChild(submitShim);
        }

        if(typeof ValidateIframe === 'function')
        {
            ValidateIframe('validate_hdr_fld', 'ordhdrs_ctns', String(order), String(cartons));
        }

        if(typeof updateCtn === 'function')
        {
            try
            {
                updateCtn();
                return true;
            }
            catch(error)
            {
                console.log(`updateCtn failed, falling back to manual carton POST: ${error.message}`);
            }
        }

        const cmd = form && form.querySelector('[name="cmd"]');

        if(cmd)
        {
            cmd.value = cartonCmd;
        }

        if(form)
        {
            form.action = 'index.php';
            form.method = 'post';
            form.submit();
            return true;
        }

        return false;
    }, {order: orderNo, cartons: totalCartons, cartonCmd: CARTON_RELOAD_CMD});

    if(!didReload)
    {
        throw new Error('Could not find sel_ctns or trigger carton reload');
    }

    await waitForPageWork(page);
    await waitForReloadedInvoiceForm(page, totalCartons);
}

async function waitForPageWork(page)
{
    await Promise.race([
        page.waitForNavigation({waitUntil: 'networkidle2', timeout: 45000}).catch(()=> null),
        page.waitForNetworkIdle({idleTime: 1200, timeout: 45000}).catch(()=> null),
    ]);
}

async function waitForReloadedInvoiceForm(page, totalCartons)
{
    const frame = await getContentsFrame(page);

    const found = await frame.waitForFunction((expectedCartons)=> {
        const form = document.querySelector('form#form1');
        const ordlin = document.querySelector('[name^="DNUMORDLIN_"]');
        const finalWeight = document.querySelector(`[name="DNUMBOXWT_${expectedCartons}"]`);

        return Boolean(form && ordlin && finalWeight);
    }, {timeout: 60000}, totalCartons).then(()=> true).catch(()=> false);

    if(!found)
    {
        const debug = await frame.evaluate((expectedCartons)=> ({
            url: location.href,
            title: document.title,
            hasForm1: Boolean(document.querySelector('form#form1')),
            ordlinCount: document.querySelectorAll('[name^="DNUMORDLIN_"]').length,
            weightCount: document.querySelectorAll('[name^="DNUMBOXWT_"]').length,
            hasExpectedWeight: Boolean(document.querySelector(`[name="DNUMBOXWT_${expectedCartons}"]`)),
            bodyText: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 800),
        }), totalCartons);

        throw new Error(`Carton reload did not produce expected form fields: ${JSON.stringify(debug)}`);
    }
}

async function getLiveHtml(page)
{
    const frame = await getContentsFrame(page);

    return frame.evaluate(()=> document.documentElement.outerHTML);
}

async function setBilledFreight(page, shippingCost)
{
    const frame = await getContentsFrame(page);
    const updated = await frame.evaluate((freight)=> {
        const field = document.querySelector('#sel_freight_amt, input[name="sel_freight_amt"]');

        if(!field)
        {
            return false;
        }

        field.value = freight;
        field.setAttribute('value', freight);
        field.dispatchEvent(new Event('input', {bubbles: true}));

        const bothField = document.querySelector('[name="sel_freight_amt_both"]');
        if(bothField)
        {
            bothField.value = freight;
            bothField.setAttribute('value', freight);
        }

        return true;
    }, shippingCost);

    if(!updated)
    {
        throw new Error('Billed freight field sel_freight_amt was not found after the Bill Each Order page loaded');
    }

}

function extractRowMap(html, orderNo, totalCartons)
{
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const rows = [];
    const ordlinInputs = [...document.querySelectorAll('input[name^="DNUMORDLIN_"]')];

    for(const input of ordlinInputs)
    {
        const suffix = suffixFromName(input.getAttribute('name'));

        if(!suffix)
        {
            continue;
        }

        const rowNode = input.closest('tr');
        const text = rowNode ? rowNode.textContent.replace(/\s+/g, ' ').trim() : '';
        const itemNo = findItemNo(rowNode, suffix);
        const orderedDz = extractOrderedDz(rowNode, itemNo);

        rows.push({
            row: Number(suffix),
            ordlin: valueOf(document, `DNUMORDLIN_${suffix}`),
            itemNo,
            description: extractRowDescription(rowNode, itemNo),
            orderedDz: orderedDz || numericText(valueOf(document, `DNUMQTYORD_${suffix}`)),
            currentBoxStart: valueOf(document, `DNUMBOXNO_${suffix}`),
            currentBoxEnd: valueOf(document, `DNUMBOXNOEND_${suffix}`),
            currentShipDz: valueOf(document, `DNUMQTYSHIP_${suffix}`),
            currentShipPc: valueOf(document, `DNUMQTYSHIPPC_${suffix}`),
            price: valueOf(document, `DNUMPRC_${suffix}`),
        });
    }

    const weightFields = [...document.querySelectorAll('input[name^="DNUMBOXWT_"]')]
        .map((input)=> input.getAttribute('name'))
        .filter(Boolean)
        .sort((a, b)=> Number(suffixFromName(a)) - Number(suffixFromName(b)));

    return {
        orderNo: String(orderNo),
        totalCartons: Number(totalCartons),
        rows,
        weightFields,
        footerFields: {
            sel_tot_weight: valueOf(document, 'sel_tot_weight'),
            sel_tot_qty_to_ship: valueOf(document, 'sel_tot_qty_to_ship'),
            sel_tot_amt_to_ship: valueOf(document, 'sel_tot_amt_to_ship'),
            sel_invc_net_amt: valueOf(document, 'sel_invc_net_amt'),
            sel_freight_amt: valueOf(document, 'sel_freight_amt'),
            sel_shipvia_cod: valueOf(document, 'sel_shipvia_cod'),
            sel_terms_cod: valueOf(document, 'sel_terms_cod'),
            sel_factor_cod: valueOf(document, 'sel_factor_cod'),
            new_invoice_date: valueOf(document, 'new_invoice_date'),
        },
    };
}

function suffixFromName(name)
{
    return String(name || '').match(/_(\d+)$/)?.[1] || '';
}

function valueOf(document, name)
{
    const field = document.querySelector(`[name="${cssEscape(name)}"]`);
    return field ? field.getAttribute('value') || field.value || '' : '';
}

function findItemNo(rowNode, suffix)
{
    if(!rowNode)
    {
        return '';
    }

    const explicit = rowNode.querySelector(`[name="DNUMITEM_${suffix}"], [name="DNUMITM_${suffix}"], [name="DNUMITEMNO_${suffix}"]`);

    if(explicit)
    {
        return explicit.getAttribute('value') || explicit.value || explicit.textContent.trim();
    }

    const candidates = [...new Set((rowNode.textContent || '').match(/\b[A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]*\b/g) || [])];
    return candidates[0] || '';
}

function extractRowDescription(rowNode, itemNo)
{
    if(!rowNode)
    {
        return '';
    }

    const cells = rowCells(rowNode);
    const itemIndex = cells.findIndex((cell)=> cleanCellText(cell.textContent) === itemNo);

    if(itemIndex > 0)
    {
        return cleanCellText(cells[1].textContent).slice(0, 240);
    }

    return cleanCellText(rowNode.textContent).replace(itemNo, '').trim().slice(0, 240);
}

 async function submitInvoiceJsonAndGenerateDocuments({orderNo, totalCartons, shippingCost = '0.00', chatGptJson})
{
    requireConfig();

    return withTimeout(
        submitInvoiceJsonAndGenerateDocumentsInner({orderNo, totalCartons, shippingCost, chatGptJson}),
        SUBMIT_GENERATE_TIMEOUT_MS,
        `Submit and generate timed out after ${SUBMIT_GENERATE_TIMEOUT_MS / 1000} seconds`
    );
}

async function submitInvoiceJsonAndGenerateDocumentsInner({orderNo, totalCartons, shippingCost, chatGptJson})
{
    const parsed = parseChatGptJson(chatGptJson);
    validateChatGptRequest(parsed, orderNo, totalCartons);

    const browser = await puppeteer.launch({headless: true});
    const page = await browser.newPage();
    const jobId = `submit-generate-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    try
    {
        logStep(jobId, 'logging into EDI');
        await login(page);
        logStep(jobId, 'opening Bill Each Order');
        await openBillEachOrder(page);
        logStep(jobId, `filtering order ${orderNo}`);
        const invoicePage = await applyFilter(page, orderNo);
        await setCartonsAndReload(invoicePage, orderNo, totalCartons);
        await ensureInvoiceRowsLoaded(invoicePage, orderNo);
        await setBilledFreight(invoicePage, shippingCost);

        logStep(jobId, 'submitting invoice JSON');
        const requestFields = {...parsed.requestFields, sel_freight_amt: shippingCost};
        const submitResult = await submitRequestFields(invoicePage, requestFields, orderNo, totalCartons);

        logStep(jobId, 'reloading submitted invoice form');
        const submittedInvoicePage = await reloadSubmittedInvoiceForm(invoicePage, orderNo);
        await ensureInvoiceRowsLoaded(submittedInvoicePage, orderNo);

        logStep(jobId, 'saving invoice PDF from submitted form');
        const invoice = await printLoadedInvoicePage(submittedInvoicePage, orderNo, 'invoice');
        await returnFromPrintPreview(submittedInvoicePage, orderNo);
        await ensureInvoiceRowsLoaded(submittedInvoicePage, orderNo);

        logStep(jobId, 'saving packing list PDF from submitted form');
        const packingList = await printLoadedInvoicePage(submittedInvoicePage, orderNo, 'packing-list');
        alignGeneratedDocumentFileNames(invoice, packingList, orderNo);
        await returnFromPrintPreview(submittedInvoicePage, orderNo);
        await ensureInvoiceRowsLoaded(submittedInvoicePage, orderNo);

        logStep(jobId, 'building Excel from submitted form');
        const excel = await buildInvoiceExcelFromLoadedPage(submittedInvoicePage, orderNo, 'excel');
        const uclData = await extractUclDataFromInvoicePage(submittedInvoicePage, parsed, totalCartons);

        return {
            submit: {
                status: submitResult.status,
                ok: submitResult.ok,
                redirectLocation: submitResult.redirectLocation || '',
                patchedFields: Object.keys(requestFields).sort(),
                fieldCount: Object.keys(requestFields).length,
            },
            invoice,
            packingList,
            excel,
            uclData,
        };
    }
    finally
    {
        await browser.close();
    }
}
function extractOrderedDz(rowNode, itemNo)
{
    if(!rowNode || !itemNo)
    {
        return 0;
    }

    const cells = rowCells(rowNode);
    const itemIndex = cells.findIndex((cell)=> cleanCellText(cell.textContent) === itemNo);

    if(itemIndex >= 0 && cells[itemIndex + 1])
    {
        return numericText(cleanCellText(cells[itemIndex + 1].textContent));
    }

    return 0;
}

function rowCells(rowNode)
{
    return [...rowNode.children].filter((child)=> String(child.tagName || '').toUpperCase() === 'TD');
}

function cleanCellText(value)
{
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function numericText(value)
{
    const number = Number(String(value || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(number) ? number : 0;
}

function chatGptInstructions(shippingCost = '0.00')
{
    return [
        'Analyze the pick-ticket pictures, `post_reload_form.html`, and `row_map.json`.',
        '',
        'Your job is to create the final Linda Fashion Bill Each Order invoice update request fields.',
        '',
        'Use `row_map.json` as the source of truth for:',
        '',
        '* row number suffix',
        '* `DNUMORDLIN_#`',
        '* item number',
        '* ordered dozens',
        '* current shipped dozens',
        '* price',
        '* available field names',
        '',
        'Important: `orderedDz` in `row_map.json` is extracted from the EDI Qty Order column, not from the row number. If the pick-ticket image appears to conflict with `orderedDz`, report that conflict in `warnings` or `errors` instead of silently changing the ordered quantity.',
        '',
        'Use the pick-ticket pictures as the source of truth for:',
        '',
        '* highlighted missing or reduced items',
        '* handwritten shipped quantities',
        '* handwritten missing quantities',
        '* start box and end box assignments',
        '* total carton/box count',
        '* box weights',
        '* page-level missing dozen totals written at the bottom of the paper',
        '',
        'Important pick-ticket rules:',
        '',
        '* Missing items or lesser shipped quantities are usually highlighted.',
        '* The total missing dozens are usually written at the bottom of the paper/page.',
        '* For each highlighted item, inspect whether it is fully missing or only partially shipped.',
        '* If an item is crossed out, marked missing, or clearly fully missing, set shipped dozens to `0`.',
        '* If a handwritten shipped quantity is written next to the item, use that as `shipDz`.',
        '* If a handwritten missing quantity is written instead, calculate `shipDz = orderedDz - missingDz`.',
        '* If an item is not highlighted and has no handwritten correction, use the ordered quantity from `row_map.json` as shipped dozens.',
        '* After analyzing a page, add all missing dozens from highlighted/reduced rows and confirm it equals the missing total written at the bottom of that page.',
        '* If the calculated missing total does not match the bottom total, return `submitReady: false`.',
        '',
        'Box rules:',
        '',
        '* `DNUMBOXNO_#` is the item row’s starting box.',
        '* `DNUMBOXNOEND_#` is the ending box only if the item spans multiple boxes.',
        '* If the item is in only one box, `DNUMBOXNOEND_#` should be blank.',
        '* `DNUMBOXWT_#` corresponds to carton/box number, not item row number.',
        '* Example: `DNUMBOXWT_15` means weight of box 15.',
        '',
        'Request field rules:',
        'Return only the fields that should be patched onto the live `FormData`.',
        'Do not include cookies, headers, or multipart boundaries.',
        'Do not include browser headers, fetch code, or any external URL.',
        'The program will build `FormData` from the live logged-in form and patch your returned fields.',
        '',
        'Always include:',
        '',
        '* `cmd = ordhdr_bill_ordhdr_wo_piktik`',
        '* `subcmd = sav_field`',
        '* `ft_ord_no`',
        '* `sel_ctns`',
        '',
        'For each item row, return:',
        '',
        '* `DNUMBOXNO_#`',
        '* `DNUMBOXNOEND_#`',
        '* `DNUMQTYSHIP_#`',
        '* `DNUMQTYSHIPPC_#`',
        '',
        'Usually `DNUMQTYSHIPPC_#` should be blank unless the pick ticket clearly shows pieces.',
        '',
        'For every carton, return:',
        '',
        '* `DNUMBOXWT_#`',
        '* Also return `boxDimensions` keyed by carton number when handwritten dimensions are visible. Each carton value must contain numeric `length`, `width`, and `height` in inches. Omit dimensions that are absent or unclear.',
        '',
        'Also return totals:',
        '',
        '* `sel_tot_weight`',
        '* `sel_tot_qty_to_ship`',
        '* `sel_tot_amt_to_ship`',
        '* `sel_invc_net_amt`',
        `* \`sel_freight_amt = ${shippingCost}\` (this is the billed freight entered by the user; do not recalculate it)`,
        '',
        'Validation:',
        '',
        '* Every item from the picture that is modified must match exactly one item number in `row_map.json`.',
        '* Do not guess if an item number is unclear.',
        '* Final shipped dozens must equal the sum of all final `DNUMQTYSHIP_#` values.',
        '* Total amount must equal shipped dozens times each row’s unit price.',
        '* `sel_invc_net_amt` must equal `sel_tot_amt_to_ship` plus `sel_freight_amt`.',
        '* Total weight must equal the sum of all `DNUMBOXWT_#`.',
        '* `sel_ctns` must equal the number of `DNUMBOXWT_#` fields.',
        '',
        'Return only JSON in this shape:',
        '',
        '{',
        '  "submitReady": true,',
        '  "orderNo": "",',
        '  "totalCartons": 0,',
        '  "requestFields": {},',
        '  "quantityChanges": [',
        '    {',
        '      "itemNo": "",',
        '      "row": 0,',
        '      "ordlin": "",',
        '      "orderedDz": 0,',
        '      "shipDz": 0,',
        '      "missingDz": 0,',
        '      "boxStart": "",',
        '      "boxEnd": "",',
        '      "reason": ""',
        '    }',
        '  ],',
        '  "boxWeights": {},',
        '  "boxDimensions": {',
        '    "1": {"length": 0, "width": 0, "height": 0}',
        '  },',
        '  "validation": {',
        '    "finalDz": 0,',
        '    "expectedTotalAmount": 0,',
        '    "totalWeight": 0,',
        '    "cartonCount": 0',
        '  },',
        '  "warnings": [],',
        '  "errors": []',
        '}',
        '',
        'If anything is unclear, unmatched, or mathematically inconsistent, return:',
        '',
        '{',
        '  "submitReady": false,',
        '  "errors": ["explain exactly what failed"]',
        '}',
    ].join('\n');
}

async function prepareInvoicePackage({orderNo, totalCartons, shippingCost = '0.00', files})
{
    requireConfig();
    ensureDirectory(WORK_DIR);

    const jobId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const jobDir = path.join(WORK_DIR, jobId);
    ensureDirectory(jobDir);

    return withTimeout(prepareInvoicePackageInner({orderNo, totalCartons, shippingCost, files, jobId, jobDir}), PREPARE_TIMEOUT_MS, `Prepare timed out after ${PREPARE_TIMEOUT_MS / 1000} seconds`);
}

async function extractUclDataFromInvoicePage(page, parsed = {}, totalCartons = 0)
{
    const frame = await getContentsFrame(page);
    const pageData = await frame.evaluate(()=> {
        const clean = (value)=> String(value || '').replace(/\s+/g, ' ').trim();
        const labelBlock = (label)=> {
            const labelCell = [...document.querySelectorAll('td')]
                .find((cell)=> clean(cell.textContent).toUpperCase() === label);
            const table = labelCell ? labelCell.closest('table') : null;
            if(!table) return [];
            return [...table.querySelectorAll('tr')]
                .map((row)=> clean(row.textContent))
                .filter((line)=> line && line.toUpperCase() !== label);
        };
        const shipViaField = document.querySelector('[name="sel_shipvia_cod"]');
        const weights = {};
        document.querySelectorAll('[name^="DNUMBOXWT_"]').forEach((field)=> {
            const boxNo = String(field.name || '').replace('DNUMBOXWT_', '');
            weights[boxNo] = clean(field.value || field.getAttribute('value'));
        });
        return {
            soldTo: labelBlock('BILL TO:').length ? labelBlock('BILL TO:') : labelBlock('SOLD TO:'),
            shipTo: labelBlock('SHIP TO:'),
            shipVia: shipViaField ? clean(shipViaField.value) : '',
            weights,
        };
    });

    const withoutCustomerCode = (lines)=> {
        const result = Array.isArray(lines) ? [...lines] : [];
        if(result.length > 0 && /^[A-Z]{2,}\d{2,}$/i.test(result[0])) result.shift();
        return result;
    };

    return {
        ...pageData,
        soldTo: withoutCustomerCode(pageData.soldTo),
        shipTo: withoutCustomerCode(pageData.shipTo),
        totalCartons: Number(totalCartons) || Object.keys(pageData.weights || {}).length,
        dimensions: parsed.boxDimensions && typeof parsed.boxDimensions === 'object' ? parsed.boxDimensions : {},
    };
}

async function getInvoiceUclData(orderNo, totalCartons)
{
    requireConfig();
    const browser = await puppeteer.launch({headless: true});
    const page = await browser.newPage();

    try
    {
        await login(page);
        await openBillEachOrder(page);
        const invoicePage = await applyFilter(page, orderNo);
        await setCartonsAndReload(invoicePage, orderNo, totalCartons);
        await ensureInvoiceRowsLoaded(invoicePage, orderNo);
        return await extractUclDataFromInvoicePage(invoicePage, {}, totalCartons);
    }
    finally
    {
        await browser.close();
    }
}


async function prepareInvoicePackageInner({orderNo, totalCartons, shippingCost, files, jobId, jobDir})
{
    logStep(jobId, `saving ${files.length} image(s)`);

    const imageFiles = files.map((file, index)=> {
        const fileName = `${index + 1}-${safeName(file.originalname)}`;
        const filePath = path.join(jobDir, fileName);
        fs.writeFileSync(filePath, file.buffer);
        return {fileName, filePath};
    });

    const browser = await puppeteer.launch({headless: false});
    const page = await browser.newPage();

    try
    {
        logStep(jobId, 'logging into EDI');
        await login(page);
        logStep(jobId, 'opening Bill Each Order');
        await openBillEachOrder(page);
        logStep(jobId, `filtering order ${orderNo}`);
        const invoicePage = await applyFilter(page, orderNo);
        logStep(jobId, `setting cartons ${totalCartons}`);
        await setCartonsAndReload(invoicePage, orderNo, totalCartons);

        await setBilledFreight(invoicePage, shippingCost);

        logStep(jobId, 'extracting post-reload HTML');
        const html = await getLiveHtml(invoicePage);
        const rowMap = extractRowMap(html, orderNo, totalCartons);
        validatePreparedArtifacts(html, rowMap, totalCartons);

        logStep(jobId, `writing package files with ${rowMap.rows.length} row(s) and ${rowMap.weightFields.length} weight field(s)`);
        fs.writeFileSync(path.join(jobDir, 'post_reload_form.html'), html);
        fs.writeFileSync(path.join(jobDir, 'row_map.json'), JSON.stringify(rowMap, null, 2));
        fs.writeFileSync(path.join(jobDir, 'CHATGPT_INSTRUCTIONS.txt'), chatGptInstructions(shippingCost));

        const downloadFileName = `PO ${orderNo} instructions.zip`;
        const zipPath = path.join(WORK_DIR, `${jobId}.zip`);
        logStep(jobId, 'creating ZIP');
        await createZip(jobDir, zipPath);
        logStep(jobId, 'ZIP ready');

        return {
            jobId,
            zipPath,
            fileName: downloadFileName,
            orderNo: String(orderNo),
            totalCartons: Number(totalCartons),
            shippingCost,
            rowCount: rowMap.rows.length,
            weightFieldCount: rowMap.weightFields.length,
            imageFiles: imageFiles.map((file)=> file.fileName),
        };
    }
    finally
    {
        await browser.close();
    }
}

function validatePreparedArtifacts(html, rowMap, totalCartons)
{
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const errors = [];

    if(!document.querySelector('form#form1'))
    {
        errors.push('post-reload form#form1 was not found');
    }

    if(rowMap.rows.length === 0)
    {
        errors.push('No DNUMORDLIN_# item rows found');
    }

    for(let carton = 1; carton <= Number(totalCartons); carton += 1)
    {
        if(!document.querySelector(`[name="DNUMBOXWT_${carton}"]`))
        {
            errors.push(`Missing DNUMBOXWT_${carton}`);
        }
    }

    if(errors.length > 0)
    {
        throw new Error(errors.join('; '));
    }
}

function createZip(sourceDir, zipPath)
{
    return new Promise((resolve, reject)=> {
        const archiveScript = [
            '$ErrorActionPreference = "Stop"',
            `Compress-Archive -Path "${sourceDir}\\*" -DestinationPath "${zipPath}" -Force`,
        ].join('\n');
        const {spawn} = require('child_process');
        const child = spawn('powershell.exe', ['-NoProfile', '-Command', archiveScript], {stdio: 'pipe'});

        child.on('exit', (code)=> {
            if(code === 0)
            {
                resolve();
            }
            else
            {
                reject(new Error(`Compress-Archive failed with exit code ${code}`));
            }
        });
        child.on('error', reject);
    });
}

async function submitInvoiceJson({orderNo, totalCartons, shippingCost = '0.00', chatGptJson})
{
    requireConfig();

    return withTimeout(submitInvoiceJsonInner({orderNo, totalCartons, shippingCost, chatGptJson}), SUBMIT_TIMEOUT_MS, `Submit timed out after ${SUBMIT_TIMEOUT_MS / 1000} seconds`);
}

async function submitInvoiceJsonInner({orderNo, totalCartons, shippingCost, chatGptJson})
{
    const parsed = parseChatGptJson(chatGptJson);
    validateChatGptRequest(parsed, orderNo, totalCartons);

    const browser = await puppeteer.launch({headless: true});
    const page = await browser.newPage();

    try
    {
        await login(page);
        await openBillEachOrder(page);
        const invoicePage = await applyFilter(page, orderNo);
        await setCartonsAndReload(invoicePage, orderNo, totalCartons);
        await ensureInvoiceRowsLoaded(invoicePage, orderNo);
        await setBilledFreight(invoicePage, shippingCost);

        const requestFields = {...parsed.requestFields, sel_freight_amt: shippingCost};
        const result = await submitRequestFields(invoicePage, requestFields, orderNo, totalCartons);
        return {
            status: result.status,
            ok: result.ok,
            redirectLocation: result.redirectLocation || '',
            patchedFields: Object.keys(requestFields).sort(),
            fieldCount: Object.keys(requestFields).length,
        };
    }
    finally
    {
        await browser.close();
    }
}

async function printInvoiceDocument({orderNo, totalCartons, type})
{
    requireConfig();

    if(!['invoice', 'packing-list'].includes(type))
    {
        throw new Error('Print type must be invoice or packing-list');
    }

    return withTimeout(printInvoiceDocumentInner({orderNo, totalCartons, type}), PRINT_TIMEOUT_MS, `Print timed out after ${PRINT_TIMEOUT_MS / 1000} seconds`);
}

async function printInvoiceDocumentInner({orderNo, totalCartons, type})
{
    const browser = await puppeteer.launch({headless: true});
    const page = await browser.newPage();

    try
    {
        logStep(`print-${type}`, `logging into EDI for order ${orderNo}`);
        await login(page);
        logStep(`print-${type}`, 'opening Bill Each Order');
        await openBillEachOrder(page);
        logStep(`print-${type}`, 'filtering order');
        const invoicePage = await applyFilter(page, orderNo);
        logStep(`print-${type}`, 'triggering EDI print');
        const result = await printLoadedInvoicePage(invoicePage, orderNo, type);
        logStep(`print-${type}`, 'downloaded generated EDI PDF');
        return result;
    }
    finally
    {
        await browser.close();
    }
}

async function printLoadedInvoicePage(page, orderNo, type, options = {})
{
    const titlePartsBeforePrint = await extractOrderPageFileParts(page, orderNo);
    logStep(`print-${type}`, 'using EDI preview iframe download');
    const printPage = await triggerEdiPrint(page, type);
    const pdf = await downloadGeneratedPdf(printPage);
    const titlePartsAfterPrint = await extractOrderPageFileParts(printPage, orderNo).catch(()=> null);
    const titleParts = mergePrintedFileParts(titlePartsBeforePrint, titlePartsAfterPrint, orderNo);

    const suffix = type === 'packing-list' ? ' - P' : '';
    const fileName = `${sanitizeFilePart(titleParts.customerName)} INV ${sanitizeFilePart(titleParts.invoiceNo)}${suffix}.pdf`;

    return {
        pdf,
        fileName,
        customerName: titleParts.customerName,
        invoiceNo: titleParts.invoiceNo,
    };
}

function alignGeneratedDocumentFileNames(invoice, packingList, orderNo)
{
    const fallbackOrder = String(orderNo || '');
    const packingInvoiceNo = String(packingList?.invoiceNo || '');
    const invoiceInvoiceNo = String(invoice?.invoiceNo || '');
    const actualInvoiceNo = packingInvoiceNo && packingInvoiceNo !== fallbackOrder
        ? packingInvoiceNo
        : invoiceInvoiceNo;

    if(!actualInvoiceNo || actualInvoiceNo === fallbackOrder)
    {
        return;
    }

    const customerName = String(packingList?.customerName || invoice?.customerName || 'Customer');
    const fileNameBase = `${sanitizeFilePart(customerName)} INV ${sanitizeFilePart(actualInvoiceNo)}`;
    invoice.fileName = `${fileNameBase}.pdf`;
    packingList.fileName = `${fileNameBase} - P.pdf`;
    invoice.customerName = customerName;
    invoice.invoiceNo = actualInvoiceNo;
    packingList.customerName = customerName;
    packingList.invoiceNo = actualInvoiceNo;
}

function mergePrintedFileParts(beforePrint, afterPrint, orderNo)
{
    const fallbackOrder = String(orderNo || '');
    const beforeInvoiceNo = String(beforePrint?.invoiceNo || '');
    const afterInvoiceNo = String(afterPrint?.invoiceNo || '');
    const invoiceNo = afterInvoiceNo && afterInvoiceNo !== fallbackOrder ? afterInvoiceNo : beforeInvoiceNo;
    const afterCustomerName = String(afterPrint?.customerName || '');
    const beforeCustomerName = String(beforePrint?.customerName || '');
    const useAfterCustomer = afterCustomerName &&
        afterCustomerName !== 'Customer' &&
        !/Customer Service|Customer Customer|Invoices|Receivables|Statements|Reports|Services Customer|A R View|HOME SERVICES/i.test(afterCustomerName);

    return {
        customerName: useAfterCustomer ? afterCustomerName : beforeCustomerName,
        invoiceNo: invoiceNo || fallbackOrder,
    };
}

async function returnFromPrintPreview(page, orderNo)
{
    const frame = await getContentsFrame(page);
    const didGoBack = await frame.evaluate((fallbackOrder)=> {
        if(typeof goBack === 'function')
        {
            goBack();
            return true;
        }

        window.location = `../oe/oe_bill_ordhdr.php?ft_ord_no=${encodeURIComponent(fallbackOrder)}&ft_orderby=I`;
        return true;
    }, String(orderNo)).catch(()=> false);

    if(!didGoBack)
    {
        await openBillEachOrder(page);
        await applyFilter(page, orderNo);
        return;
    }

    await waitForPageWork(page);
}

async function triggerEdiPrintFromSnapshot(page, type)
{
    const printPage = await submitLiveFormSnapshot(page, {
        cmd: 'ordhdr_invc_wo_piktik',
        new_ordhdrs_id: '__FT_ORD_NO__',
        called_from_pgm: 'oe_bill_ordhdr.php',
        called_from_id_name: 'ft_ord_no',
        reprint_flg: type === 'packing-list' ? 't' : 'f',
        reprint_stage: type === 'packing-list' ? '60' : '50',
        prt_packinglist_only: type === 'packing-list' ? 't' : 'f',
    });

    await printPage.waitForNetworkIdle({idleTime: 1200, timeout: 45000}).catch(()=> null);
    return printPage;
}

async function submitLiveFormSnapshot(page, overrides, options = {})
{
    const fields = await getLiveFormFields(page);
    const fieldMap = new Map(fields.map((field)=> [field.name, field.value]));

    for(const [key, value] of Object.entries(overrides))
    {
        fieldMap.set(key, value === '__FT_ORD_NO__' ? (fieldMap.get('ft_ord_no') || '') : value);
    }

    const submitPage = await page.browser().newPage();

    if(options.downloadDir)
    {
        await allowDownloads(submitPage, options.downloadDir);
    }

    await submitPage.setContent('<!doctype html><html><body><form id="snapshot" method="post"></form></body></html>');
    await submitPage.evaluate(({entries, action})=> {
        const form = document.querySelector('#snapshot');
        form.action = action;

        for(const [name, value] of entries)
        {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = value ?? '';
            form.appendChild(input);
        }

        form.submit();
    }, {
        entries: [...fieldMap.entries()],
        action: `${config.EDI_BASE_URL}${FINAL_POST_PATH}`,
    });

    return submitPage;
}

async function getLiveFormFields(page)
{
    const frame = await getContentsFrame(page);

    return frame.evaluate(()=> {
        const form = document.querySelector('form#form1') || document.querySelector('form');

        if(!form)
        {
            throw new Error('Live invoice form was not found');
        }

        return [...form.querySelectorAll('[name]')]
            .map((field)=> ({
                name: field.getAttribute('name'),
                value: field.value ?? field.getAttribute('value') ?? '',
            }))
            .filter((field)=> field.name);
    });
}

async function triggerEdiPrint(page, type, options = {})
{
    const frame = await getInvoiceFormFrame(page);

    const didTrigger = await frame.evaluate(({printType, preservePage})=> {
        window.alert = ()=> {};
        window.confirm = ()=> true;

        const form = document.querySelector('form#form1') || document.querySelector('form');

        if(!form || !form.querySelector('[name="ft_ord_no"], #ft_ord_no'))
        {
            return false;
        }

        if(!preservePage)
        {
            form.target = '_self';
        }

        const links = [...document.querySelectorAll('a[href^="javascript:"]')];
        const printLink = links.find((link)=> {
            const text = (link.textContent || '').replace(/\s+/g, ' ').trim();
            const href = link.getAttribute('href') || '';

            if(printType === 'packing-list')
            {
                return /PACKING LIST/i.test(text) && /ordInvcWithOutPiktik_Piktik/i.test(href);
            }

            return /PRINT INVOICE/i.test(text) && /ordInvcWithOutPiktik\(/i.test(href) && !/Piktik_Piktik/i.test(href);
        });

        if(printLink)
        {
            const href = printLink.getAttribute('href') || '';
            const script = href.replace(/^javascript:/i, '');

            if(script)
            {
                new Function(script).call(window);
                return true;
            }
        }

        if(printType === 'packing-list' && typeof ordInvcWithOutPiktik_Piktik === 'function')
        {
            ordInvcWithOutPiktik_Piktik('t', 60);
            return true;
        }

        if(typeof ordInvcWithOutPiktik === 'function')
        {
            ordInvcWithOutPiktik('f', 50);
            return true;
        }

        const setField = (name, value)=> {
            let field = form.querySelector(`[name="${CSS.escape(name)}"]`);

            if(!field)
            {
                field = document.createElement('input');
                field.type = 'hidden';
                field.name = name;
                form.appendChild(field);
            }

            field.value = value;
        };

        setField('cmd', 'ordhdr_invc_wo_piktik');
        setField('new_ordhdrs_id', form.ft_ord_no ? form.ft_ord_no.value : '');
        setField('called_from_pgm', 'oe_bill_ordhdr.php');
        setField('called_from_id_name', 'ft_ord_no');
        setField('reprint_flg', 'f');
        setField('reprint_stage', '50');
        setField('prt_packinglist_only', printType === 'packing-list' ? 't' : 'f');
        form.method = 'post';
        form.action = '../oe/index.php';

        if(preservePage)
        {
            form.target = `edi_print_${Date.now()}`;
        }
        else
        {
            form.target = '_self';
        }

        form.submit();
        return true;
    }, {
        printType: type,
        preservePage: Boolean(options.preservePage),
    });

    if(!didTrigger)
    {
        throw new Error(`Could not trigger ${type} print`);
    }

    const pdfUrl = await waitForPdfPreview(page, 20000);

    if(!pdfUrl)
    {
        const debug = await getPrintPreviewDebug(page);
        throw new Error(`EDI print preview iframe was not found. Debug saved: ${debug.debugPath}. Frames: ${debug.frameUrls}. Page: ${debug.previewText}`);
    }

    return page;
}

async function getPrintPreviewDebug(page)
{
    const frameUrls = page.frames().map((frame)=> frame.url()).join(', ');
    const snippets = [];
    const debugDir = path.join(WORK_DIR, 'print-debug');
    ensureDirectory(debugDir);
    const debugPath = path.join(debugDir, `print-preview-${Date.now()}.html`);
    const htmlParts = [];

    for(const [index, frame] of page.frames().entries())
    {
        const snippet = await frame.evaluate(()=> {
            const iframeCount = document.querySelectorAll('iframe').length;
            const pdfIframeCount = document.querySelectorAll('iframe[src*=".pdf"]').length;
            const text = document.body ? document.body.innerText : '';
            return `url=${location.href}; iframes=${iframeCount}; pdfIframes=${pdfIframeCount}; text=${String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500)}`;
        }).catch((error)=> `unreadable=${error.message}`);
        snippets.push(snippet);
        const html = await frame.content().catch((error)=> `<!-- unreadable ${error.message} -->`);
        htmlParts.push(`<!-- FRAME ${index}: name=${frame.name()} url=${frame.url()} -->\n${html}`);
    }
    fs.writeFileSync(debugPath, htmlParts.join('\n\n'));

    return {
        frameUrls,
        previewText: snippets.join(' || '),
        debugPath,
    };
}

async function waitForPdfPreview(page, timeoutMs)
{
    const startedAt = Date.now();

    while(Date.now() - startedAt < timeoutMs)
    {
        for(const frame of page.frames())
        {
            if(/\.pdf(?:$|\?)/i.test(frame.url()))
            {
                return frame.url();
            }

            const pdfUrl = await getPdfUrlFromFrame(frame).catch((error)=> {
                if(/detached Frame|Execution context was destroyed|Cannot find context/i.test(error.message || ''))
                {
                    return '';
                }

                throw error;
            });

            if(pdfUrl)
            {
                return pdfUrl;
            }
        }

        await new Promise((resolve)=> setTimeout(resolve, 500));
    }

    return null;
}

async function waitForCapturedPdf(capture, timeoutMs)
{
    return Promise.race([
        capture.promise,
        new Promise((resolve)=> setTimeout(()=> resolve(null), timeoutMs)),
    ]);
}

function capturePdfResponse(page)
{
    let resolveCapture = null;
    const pages = new Set();
    const capture = {
        pdf: null,
        promise: new Promise((resolve)=> {
            resolveCapture = resolve;
        }),
        stop: ()=> {
            for(const watchedPage of pages)
            {
                watchedPage.off('response', onResponse);
            }
        },
    };

    async function onResponse(response)
    {
        try
        {
            const headers = response.headers();
            const contentType = headers['content-type'] || headers['Content-Type'] || '';

            if(!/application\/pdf|pdf/i.test(contentType))
            {
                return;
            }

            const pdf = await response.buffer();

            if(pdf && pdf.slice(0, 5).equals(Buffer.from('%PDF-')))
            {
                capture.pdf = pdf;
                resolveCapture(pdf);
            }
        }
        catch(error)
        {
            // Some navigation responses cannot be buffered; the DOM detector is the fallback.
        }
    }

    function watch(watchedPage)
    {
        if(pages.has(watchedPage))
        {
            return;
        }

        pages.add(watchedPage);
        watchedPage.on('response', onResponse);
    }

    capture.watch = watch;
    watch(page);
    return capture;
}

function attachPdfCapture(capture, page)
{
    if(capture && typeof capture.watch === 'function' && page)
    {
        capture.watch(page);
    }
}

async function downloadGeneratedPdf(page)
{
    const pdfUrl = await waitForGeneratedPdfUrl(page);
    const result = await page.evaluate(async (url)=> {
        const response = await fetch(url, {
            credentials: 'include',
        });
        const buffer = await response.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buffer));

        return {
            ok: response.ok,
            status: response.status,
            contentType: response.headers.get('content-type') || '',
            bytes,
        };
    }, pdfUrl);

    const pdf = Buffer.from(result.bytes);

    if(!result.ok || !pdf.slice(0, 5).equals(Buffer.from('%PDF-')))
    {
        throw new Error(`Could not download generated PDF from ${pdfUrl}. HTTP ${result.status}, content-type ${result.contentType}`);
    }

    return pdf;
}

async function getPdfUrlFromFrame(frame)
{
    return frame.evaluate(()=> {
        const exactIframe = document.querySelector('body > table:nth-child(3) > tbody > tr > td > table > tbody > tr:nth-child(4) > td > iframe');
        const reportIframe = document.querySelector('iframe[src*="/datalinda/00linda/reports/"][src*=".pdf"]');
        const anyPdf = document.querySelector('iframe[src*=".pdf"], embed[src*=".pdf"], object[data*=".pdf"], a[href*=".pdf"]');
        const element = exactIframe || reportIframe || anyPdf;

        if(!element)
        {
            return '';
        }

        return element.getAttribute('src') || element.getAttribute('href') || element.getAttribute('data') || element.src || '';
    }).then((url)=> url ? new URL(url, config.EDI_BASE_URL).href : '');
}

async function buildInvoiceExcel({orderNo})
{
    requireConfig();

    return withTimeout(buildInvoiceExcelInner({orderNo}), EXCEL_TIMEOUT_MS, `Excel build timed out after ${EXCEL_TIMEOUT_MS / 1000} seconds`);
}

async function buildInvoiceExcelInner({orderNo})
{
    const jobId = `excel-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const jobDir = path.join(WORK_DIR, jobId);
    ensureDirectory(jobDir);

    const browser = await puppeteer.launch({headless: true});
    const page = await browser.newPage();

    try
    {
        logStep(jobId, `logging into EDI for order ${orderNo}`);
        await login(page);
        logStep(jobId, 'opening Bill Each Order');
        await openBillEachOrder(page);
        logStep(jobId, 'filtering order');
        const invoicePage = await applyFilter(page, orderNo);
        const titleParts = await extractOrderPageFileParts(invoicePage, orderNo);
        const rawExcelPath = path.join(jobDir, 'raw_invoice.xls');

        logStep(jobId, 'downloading EDI Excel');
        await triggerEdiExcelDownload(invoicePage, rawExcelPath, jobDir);

        logStep(jobId, 'building formatted Excel with product images');
        const excelResult = await formatInvoiceExcel({
            rawExcelPath,
            outputPath: path.join(jobDir, `${sanitizeFilePart(titleParts.customerName)} INV ${sanitizeFilePart(titleParts.invoiceNo)} EXCEL.xlsx`),
            customerName: titleParts.customerName,
            invoiceNo: titleParts.invoiceNo,
        });

        return {
            jobId,
            fileName: path.basename(excelResult.outputPath),
            filePath: excelResult.outputPath,
            orderNo: String(orderNo),
            customerName: excelResult.customerName,
            invoiceNo: excelResult.invoiceNo,
            itemCount: excelResult.itemCount,
            imageCount: excelResult.imageCount,
            missingImages: excelResult.missingImages,
        };
    }
    finally
    {
        await browser.close();
    }
}

async function buildInvoiceExcelFromLoadedPage(page, orderNo, jobIdPrefix = 'excel')
{
    const jobId = `${jobIdPrefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const jobDir = path.join(WORK_DIR, jobId);
    ensureDirectory(jobDir);
    await ensureInvoiceRowsLoaded(page, orderNo);

    const titleParts = await extractOrderPageFileParts(page, orderNo);
    const rawExcelPath = path.join(jobDir, 'raw_invoice.xls');

    await triggerEdiExcelDownload(page, rawExcelPath, jobDir);

    const excelResult = await formatInvoiceExcel({
        rawExcelPath,
        outputPath: path.join(jobDir, `${sanitizeFilePart(titleParts.customerName)} INV ${sanitizeFilePart(titleParts.invoiceNo)} EXCEL.xlsx`),
        customerName: titleParts.customerName,
        invoiceNo: titleParts.invoiceNo,
    });

    return {
        jobId,
        fileName: path.basename(excelResult.outputPath),
        filePath: excelResult.outputPath,
        orderNo: String(orderNo),
        customerName: excelResult.customerName,
        invoiceNo: excelResult.invoiceNo,
        itemCount: excelResult.itemCount,
        imageCount: excelResult.imageCount,
        missingImages: excelResult.missingImages,
    };
}

async function triggerEdiExcelDownload(page, rawExcelPath, downloadDir)
{
    await allowDownloads(page, downloadDir);
    const beforeFiles = new Set(fs.readdirSync(downloadDir));
    const frame = await getContentsFrame(page);

    const didTrigger = await frame.evaluate(()=> {
        window.alert = ()=> {};
        window.confirm = ()=> true;

        const form = document.querySelector('form#form1') || document.querySelector('form');

        if(!form || !form.querySelector('[name="ft_ord_no"], #ft_ord_no'))
        {
            return false;
        }

        const setField = (name, value)=> {
            let field = form.querySelector(`[name="${CSS.escape(name)}"]`);

            if(!field)
            {
                field = document.createElement('input');
                field.type = 'hidden';
                field.name = name;
                form.appendChild(field);
            }

            field.value = value;
        };

        setField('cmd', 'ordhdr_invc_wo_piktik');
        setField('new_ordhdrs_id', form.ft_ord_no ? form.ft_ord_no.value : '');
        setField('called_from_pgm', 'oe_bill_ordhdr.php');
        setField('called_from_id_name', 'ft_ord_no');
        setField('reprint_flg', 't');
        setField('reprint_stage', '60');
        setField('prt_packinglist_only', 'f');
        setField('output', 'xls');
        form.method = 'post';
        form.action = '../oe/index.php';
        form.removeAttribute('target');
        form.submit();
        return true;
    });

    if(!didTrigger)
    {
        throw new Error('Could not trigger EDI Excel download');
    }

    const downloadedPath = await waitForDownloadedFile(downloadDir, beforeFiles, page);

    if(downloadedPath && downloadedPath !== rawExcelPath)
    {
        fs.copyFileSync(downloadedPath, rawExcelPath);
    }

    if(!fs.existsSync(rawExcelPath) || fs.statSync(rawExcelPath).size === 0)
    {
        const html = await page.content().catch(()=> '');

        if(/<html/i.test(html) && /ITEM\s*#/i.test(html))
        {
            fs.writeFileSync(rawExcelPath, html);
        }
    }

    if(!fs.existsSync(rawExcelPath) || fs.statSync(rawExcelPath).size === 0)
    {
        throw new Error('EDI Excel download did not produce a readable file');
    }

    const rawText = fs.readFileSync(rawExcelPath, 'utf8');

    if(!/ITEM\s*#/i.test(rawText) || !/DESCRIPTION-?2/i.test(rawText))
    {
        throw new Error('EDI returned a blank or non-invoice Excel file. The order did not produce Excel rows from Bill Each Order, which usually means the order is no longer loaded in the editable invoice form.');
    }
}

async function ensureInvoiceRowsLoaded(page, orderNo)
{
    const frame = await getInvoiceFormFrame(page).catch(()=> null);
    const rowCount = frame ? await frame.evaluate(()=> document.querySelectorAll('[name^="DNUMORDLIN_"]').length) : 0;

    if(rowCount > 0)
    {
        return;
    }

    const debugFrame = frame || await getContentsFrame(page);
    const debugText = await debugFrame.evaluate(()=> {
        const text = document.body ? document.body.innerText : '';
        return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    });

    throw new Error(`Order ${orderNo} did not load invoice item rows in Bill Each Order, so EDI cannot generate documents from this route. Page text: ${debugText}`);
}

async function allowDownloads(page, downloadDir)
{
    ensureDirectory(downloadDir);

    const pageClient = await page.target().createCDPSession();
    await pageClient.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
    }).catch(()=> null);

    const browserClient = await page.browser().target().createCDPSession();
    await browserClient.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
        eventsEnabled: true,
    }).catch(()=> null);
}

async function waitForDownloadedFile(downloadDir, beforeFiles, page)
{
    const startedAt = Date.now();
    let stableCandidate = null;
    let stableSize = -1;
    let stableSeenAt = 0;

    while(Date.now() - startedAt < 180000)
    {
        const files = fs.readdirSync(downloadDir)
            .filter((fileName)=> !beforeFiles.has(fileName))
            .filter((fileName)=> !/\.crdownload$|\.tmp$/i.test(fileName));
        const candidateName = files.find((fileName)=> /\.(xls|xlsx|html?)$/i.test(fileName)) || files[0];

        if(candidateName)
        {
            const candidatePath = path.join(downloadDir, candidateName);
            const size = fs.statSync(candidatePath).size;

            if(candidatePath === stableCandidate && size === stableSize && size > 0 && Date.now() - stableSeenAt > 1000)
            {
                return candidatePath;
            }

            if(candidatePath !== stableCandidate || size !== stableSize)
            {
                stableCandidate = candidatePath;
                stableSize = size;
                stableSeenAt = Date.now();
            }
        }

        await new Promise((resolve)=> setTimeout(resolve, 500));
    }

    return null;
}

async function formatInvoiceExcel({rawExcelPath, outputPath, customerName, invoiceNo})
{
    const rawHtml = fs.readFileSync(rawExcelPath, 'utf8');
    const parsed = parseEdiInvoiceHtml(rawHtml);
    const finalCustomerName = parsed.customerName || customerName || 'Customer';
    const finalInvoiceNo = invoiceNo || 'Invoice';
    const finalOutputPath = path.join(
        path.dirname(outputPath),
        `${sanitizeFilePart(finalCustomerName)} INV ${sanitizeFilePart(finalInvoiceNo)} EXCEL.xlsx`
    );
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Linda Fashion Automation';
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet(safeWorksheetName(`${finalCustomerName} EXCEL`));

    parsed.rows.forEach((row, rowIndex)=> {
        const excelRow = worksheet.getRow(rowIndex + 1);

        row.forEach((value, columnIndex)=> {
            const cell = excelRow.getCell(columnIndex + 1);
            cell.value = normalizeExcelValue(value);
            cell.alignment = {
                horizontal: 'center',
                vertical: 'middle',
                wrapText: true,
            };
            cell.border = thinBorder();
        });

        excelRow.commit();
    });

    for(const merge of parsed.merges)
    {
        try
        {
            worksheet.mergeCells(merge.startRow, merge.startCol, merge.endRow, merge.endCol);
        }
        catch(error)
        {
            // Ignore overlapping HTML merge artifacts from the EDI export.
        }
    }

    worksheet.eachRow((row)=> {
        row.eachCell({includeEmpty: true}, (cell)=> {
            cell.alignment = {
                horizontal: 'center',
                vertical: 'middle',
                wrapText: true,
            };
        });
    });

    const headerRowNumber = parsed.headerRowIndex + 1;
    const headerRow = worksheet.getRow(headerRowNumber);
    headerRow.font = {bold: true};
    headerRow.eachCell((cell)=> {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {argb: 'FFD9D9D9'},
        };
    });

    setInvoiceColumnWidths(worksheet, parsed.headers);

    const description2Column = parsed.description2ColumnIndex + 1;
    const itemColumn = parsed.itemColumnIndex + 1;
    const missingImages = [];
    let imageCount = 0;

    for(const itemRow of parsed.itemRows)
    {
        const rowNumber = itemRow.rowIndex + 1;
        const itemNo = String(itemRow.values[parsed.itemColumnIndex] || '').trim();
        worksheet.getRow(rowNumber).height = 125;
        const imagePath = findProductImage(itemNo);

        if(!imagePath)
        {
            missingImages.push(itemNo);
            continue;
        }

        const extension = path.extname(imagePath).toLowerCase().includes('png') ? 'png' : 'jpeg';
        const imageId = workbook.addImage({
            filename: imagePath,
            extension,
        });

        worksheet.addImage(imageId, {
            tl: {
                col: description2Column - 1 + 0.08,
                row: rowNumber - 1 + 0.08,
            },
            ext: {
                width: 160,
                height: 150,
            },
            editAs: 'oneCell',
        });
        worksheet.getCell(rowNumber, description2Column).value = null;
        worksheet.getCell(rowNumber, itemColumn).alignment = {
            horizontal: 'center',
            vertical: 'middle',
            wrapText: true,
        };
        imageCount += 1;
    }

    worksheet.views = [{showGridLines: false}];
    worksheet.pageSetup = {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
    };

    ensureDirectory(path.dirname(finalOutputPath));
    await workbook.xlsx.writeFile(finalOutputPath);

    return {
        outputPath: finalOutputPath,
        customerName: finalCustomerName,
        invoiceNo: finalInvoiceNo,
        itemCount: parsed.itemRows.length,
        imageCount,
        missingImages,
    };
}

function parseEdiInvoiceHtml(rawHtml)
{
    const dom = new JSDOM(rawHtml);
    const document = dom.window.document;
    const rowModels = [...document.querySelectorAll('tr')]
        .map((row)=> {
            const cells = [...row.children]
                .filter((cell)=> /^(TD|TH)$/i.test(cell.tagName))
                .map((cell)=> ({
                    text: cleanInvoiceCellText(cell.textContent),
                    nested: Boolean(cell.querySelector('table')),
                    colspan: Math.max(1, Number(cell.getAttribute('colspan') || 1)),
                }));

            if(cells.length === 0 || cells.some((cell)=> cell.nested))
            {
                return null;
            }

            const values = [];
            const merges = [];

            for(const cell of cells)
            {
                const startCol = values.length + 1;
                values.push(cell.text);

                for(let index = 1; index < cell.colspan; index += 1)
                {
                    values.push('');
                }

                if(cell.colspan > 1)
                {
                    merges.push({
                        startCol,
                        endCol: startCol + cell.colspan - 1,
                    });
                }
            }

            return {
                values,
                merges,
            };
        })
        .filter((row)=> row && row.values.some((value)=> value !== ''));
    const rows = rowModels.map((row)=> row.values);
    const merges = rowModels.flatMap((row, rowIndex)=> row.merges.map((merge)=> ({
        startRow: rowIndex + 1,
        endRow: rowIndex + 1,
        startCol: merge.startCol,
        endCol: merge.endCol,
    })));

    const headerRowIndex = rows.findIndex((row)=> row.some((value)=> /^ITEM\s*#$/i.test(value)) &&
        row.some((value)=> /^DESCRIPTION-?2$/i.test(value)));

    if(headerRowIndex < 0)
    {
        throw new Error('Could not find ITEM # / DESCRIPTION-2 header in EDI Excel download');
    }

    const headers = rows[headerRowIndex];
    const itemColumnIndex = headers.findIndex((value)=> /^ITEM\s*#$/i.test(value));
    const description2ColumnIndex = headers.findIndex((value)=> /^DESCRIPTION-?2$/i.test(value));
    const itemRows = rows
        .map((values, rowIndex)=> ({values, rowIndex}))
        .filter(({values, rowIndex})=> rowIndex > headerRowIndex &&
            values.length >= headers.length &&
            /^[A-Z0-9_-]+$/i.test(String(values[itemColumnIndex] || '').trim()));

    return {
        rows,
        headers,
        headerRowIndex,
        itemColumnIndex,
        description2ColumnIndex,
        itemRows,
        merges,
        customerName: extractInvoiceCustomerName(rows),
    };
}

function extractInvoiceCustomerName(rows)
{
    for(let index = 0; index < rows.length; index += 1)
    {
        const row = rows[index];
        const firstCell = cleanInvoiceCellText(row[0] || '');

        if(/^(SOLD TO:|BILL TO:)$/i.test(firstCell))
        {
            const nextRow = rows[index + 1] || [];
            const name = cleanInvoiceCellText(nextRow[0] || '');

            if(isInvoiceCustomerName(name))
            {
                return name;
            }
        }

        const inlineMatch = firstCell.match(/^(?:SOLD TO:|BILL TO:)\s+(.+)$/i);

        if(inlineMatch && isInvoiceCustomerName(inlineMatch[1]))
        {
            return cleanInvoiceCellText(inlineMatch[1]);
        }
    }

    return '';
}

function isInvoiceCustomerName(value)
{
    const text = cleanInvoiceCellText(value);

    return Boolean(
        text &&
        text.length >= 3 &&
        text.length <= 80 &&
        /[A-Z0-9]/i.test(text) &&
        !/^[,.\-/#&'\s]+$/.test(text) &&
        !/^(SOLD TO:|BILL TO:|SHIP TO:|INVOICE|CUST NO|TERMS|STORE NO|FREIGHT TERMS)$/i.test(text)
    );
}

function cleanInvoiceCellText(value)
{
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeExcelValue(value)
{
    const text = cleanInvoiceCellText(value);

    if(text === '')
    {
        return null;
    }

    if(/^'/.test(text))
    {
        return text;
    }

    if(/^-?\d+(?:\.\d+)?$/.test(text))
    {
        return Number(text);
    }

    return text;
}

function setInvoiceColumnWidths(worksheet, headers)
{
    const fallbackWidths = [14, 14, 24, 25, 12, 8, 5, 6, 7, 9, 9, 13];

    headers.forEach((header, index)=> {
        const column = worksheet.getColumn(index + 1);

        if(/^DESCRIPTION-?2$/i.test(header))
        {
            column.width = 25;
        }
        else
        {
            column.width = fallbackWidths[index] || Math.max(10, Math.min(24, String(header || '').length + 4));
        }
    });
}

function findProductImage(itemNo)
{
    const safeItemNo = path.basename(String(itemNo || '').trim());

    if(!safeItemNo)
    {
        return null;
    }

    const candidates = [
        `${safeItemNo}.jpg`,
        `${safeItemNo}.JPG`,
        `${safeItemNo}.jpeg`,
        `${safeItemNo}.JPEG`,
        `${safeItemNo}.png`,
        `${safeItemNo}.PNG`,
    ];

    for(const candidate of candidates)
    {
        const imagePath = path.join(PRODUCT_IMAGE_DIR, candidate);

        try
        {
            if(fs.existsSync(imagePath))
            {
                return imagePath;
            }
        }
        catch(error)
        {
            return null;
        }
    }

    return null;
}

function thinBorder()
{
    return {
        top: {style: 'thin', color: {argb: 'FFB7B7B7'}},
        left: {style: 'thin', color: {argb: 'FFB7B7B7'}},
        bottom: {style: 'thin', color: {argb: 'FFB7B7B7'}},
        right: {style: 'thin', color: {argb: 'FFB7B7B7'}},
    };
}

function safeWorksheetName(value)
{
    return String(value || 'Invoice')
        .replace(/[\\/*?:[\]]+/g, ' ')
        .trim()
        .slice(0, 31) || 'Invoice';
}

async function waitForGeneratedPdfUrl(page, timeoutMs = 20000)
{
    const startedAt = Date.now();

    while(Date.now() - startedAt < timeoutMs)
    {
        for(const frame of page.frames())
        {
            const embeddedPdfUrl = await getPdfUrlFromFrame(frame);

            if(embeddedPdfUrl)
            {
                return embeddedPdfUrl;
            }
        }

        const pdfFrame = page.frames().find((frame)=> /\.pdf(?:$|\?)/i.test(frame.url()));

        if(pdfFrame)
        {
            return pdfFrame.url();
        }

        if(/\.pdf(?:$|\?)/i.test(page.url()))
        {
            return page.url();
        }

        const pdfLink = await page.evaluate(()=> {
            const element = [...document.querySelectorAll('iframe[src], embed[src], object[data], a[href]')]
                .find((node)=> /\.pdf(?:$|\?)/i.test(node.getAttribute('src') || node.getAttribute('data') || node.getAttribute('href') || ''));

            return element ? (element.getAttribute('src') || element.getAttribute('data') || element.getAttribute('href')) : '';
        }).catch(()=> '');

        if(pdfLink)
        {
            return new URL(pdfLink, page.url()).href;
        }

        await new Promise((resolve)=> setTimeout(resolve, 500));
    }

    const frameUrls = page.frames().map((frame)=> frame.url()).join(', ');
    throw new Error(`Generated PDF URL was not found. Frames: ${frameUrls}`);
}

async function extractOrderPageFileParts(page, orderNo)
{
    const frame = await getContentsFrame(page);

    return frame.evaluate((fallbackOrder)=> {
        function cleanText(value)
        {
            return String(value || '').replace(/\s+/g, ' ').trim();
        }

        function isUsableCustomerName(value)
        {
            const textValue = cleanText(value);

            if(!textValue || textValue.length < 3 || textValue.length > 80)
            {
                return false;
            }

            if(!/[A-Z0-9]/i.test(textValue) || /^[,.\-/#&'\s]+$/.test(textValue))
            {
                return false;
            }

            if(/^(BILL TO:|SOLD TO:|SHIP TO:|Sales Rep:|Our Division:|Warehouse:|Order Date:|Ship Date:|Cancel Date:|Cust PO #:)/i.test(textValue))
            {
                return false;
            }

            if(/Customer Service|Customer Customer|Invoices|Receivables|Statements|Reports|Services Customer|A R View|HOME SERVICES/i.test(textValue))
            {
                return false;
            }

            if(/^[A-Z]{2,}\d{2,}$/.test(textValue) || /^\d+\s+[A-Z0-9 ]+/i.test(textValue))
            {
                return false;
            }

            return true;
        }

        function billToName()
        {
            const cells = [...document.querySelectorAll('td, th')];
            const headerCell = cells.find((cell)=> /^(BILL TO:|SOLD TO:)$/i.test(cleanText(cell.textContent))) ||
                cells.find((cell)=> /^BILL TO:|^SOLD TO:/i.test(cleanText(cell.textContent)));

            if(headerCell)
            {
                const values = [];
                let row = headerCell.closest('tr');

                while(row && values.length < 5)
                {
                    row = row.nextElementSibling;

                    if(!row)
                    {
                        break;
                    }

                    const value = cleanText(row.textContent);

                    if(/^SHIP TO:|^Sales Rep:/i.test(value))
                    {
                        break;
                    }

                    if(value)
                    {
                        values.push(value);
                    }
                }

                const name = values.find(isUsableCustomerName);

                if(name)
                {
                    return name;
                }

                const blockText = cleanText(headerCell.textContent);
                const blockMatch = blockText.match(/(?:BILL TO:|SOLD TO:)\s*(?:[A-Z]{2,}\d{2,}\s+)?(.+?)(?:\s+\d{1,6}\s+[A-Z0-9]|\s+SHIP TO:|$)/i);
                const blockName = blockMatch ? cleanText(blockMatch[1]) : '';

                if(isUsableCustomerName(blockName))
                {
                    return blockName;
                }
            }

            const rows = [...document.querySelectorAll('tr')];
            const billToIndex = rows.findIndex((row)=> /^BILL TO:|^SOLD TO:/i.test(cleanText(row.textContent)));

            if(billToIndex >= 0)
            {
                for(let index = billToIndex + 1; index < Math.min(rows.length, billToIndex + 6); index += 1)
                {
                    const name = cleanText(rows[index] ? rows[index].textContent : '');

                    if(isUsableCustomerName(name))
                    {
                        return name;
                    }
                }
            }

            return '';
        }

        const text = document.body ? document.body.innerText.replace(/\s+/g, ' ').trim() : '';

        function fieldValue(names)
        {
            for(const name of names)
            {
                const field = document.querySelector(`[name="${CSS.escape(name)}"]`);

                if(field && (field.value || field.getAttribute('value')))
                {
                    return field.value || field.getAttribute('value');
                }
            }

            return '';
        }

        const invoiceNo = fieldValue([
            'sel_invc_no',
            'new_invc_no',
            'new_ordhdrs_invc_no',
            'ordhdrs_invc_no',
            'sel_ordhdrs_invc_no',
        ]) ||
            (text.match(/Invoice\s*(?:No\.?|#)\s*[:#]?\s*([A-Z0-9-]+)/i) || [])[1] ||
            (text.match(/Inv(?:oice)?\s*#\s*([A-Z0-9-]+)/i) || [])[1] ||
            String(fallbackOrder);

        const fieldCustomerName = fieldValue([
            'sel_cust_name',
            'new_cust_name',
            'sel_billto_name',
            'new_billto_name',
            'sel_shipto_name',
            'new_shipto_name',
            'ordhdrs_cust_name',
        ]);
        const billToTextMatch = text.match(/(?:BILL TO:|SOLD TO:)\s*(?:[A-Z]{2,}\d{2,}\s+)?(.+?)(?:\s+\d{1,6}\s+[A-Z0-9]|\s+SHIP TO:|$)/i);
        const customerTextMatch = text.match(/Customer\s*[:#]\s*([A-Z0-9 .,&'/-]{3,60})/i);
        const customerCandidates = [
            billToName(),
            fieldCustomerName,
            billToTextMatch ? billToTextMatch[1] : '',
            customerTextMatch ? customerTextMatch[1] : '',
        ];
        const customerName = customerCandidates.find(isUsableCustomerName) || 'Customer';

        return {
            customerName,
            invoiceNo,
        };
    }, String(orderNo));
}

function sanitizeFilePart(value)
{
    return String(value || '')
        .replace(/[<>:"/\\|?*]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'Document';
}

function parseChatGptJson(text)
{
    try
    {
        return JSON.parse(text);
    }
    catch(error)
    {
        throw new Error(`Could not parse ChatGPT JSON: ${error.message}`);
    }
}

function validateChatGptRequest(request, orderNo, totalCartons)
{
    const errors = [];

    if(request.submitReady !== true)
    {
        errors.push('submitReady must be true');
    }

    if(!request.requestFields || typeof request.requestFields !== 'object' || Array.isArray(request.requestFields))
    {
        errors.push('requestFields must be an object');
    }
    else
    {
        for(const [field, value] of Object.entries(request.requestFields))
        {
            if(typeof value === 'string' && /^https?:\/\//i.test(value))
            {
                errors.push(`External URL rejected in field ${field}`);
            }
        }
    }

    if(errors.length > 0)
    {
        throw new Error(errors.join('; '));
    }
}

async function submitRequestFields(page, requestFields, orderNo, totalCartons)
{
    const frame = await getContentsFrame(page);

    const readyToUpdate = await frame.evaluate(({fields, finalCmd, finalSubcmd, order, cartons})=> {
        const form = document.querySelector('form#form1');

        if(!form)
        {
            throw new Error('form#form1 not found');
        }

        if(!document.querySelector(`[name="DNUMBOXWT_${cartons}"]`))
        {
            throw new Error(`DNUMBOXWT_${cartons} not found`);
        }

        const liveFieldNames = new Set([...form.querySelectorAll('[name]')].map((field)=> field.getAttribute('name')));

        for(const [key, value] of Object.entries(fields))
        {
            if(!isAllowedLiveField(key, liveFieldNames))
            {
                throw new Error(`Unknown or disallowed field: ${key}`);
            }

            if(!form.querySelector(`[name="${CSS.escape(key)}"]`) && key !== 'cmd' && key !== 'subcmd')
            {
                throw new Error(`Field not present in live form: ${key}`);
            }

            const liveField = form.querySelector(`[name="${CSS.escape(key)}"]`);

            if(liveField)
            {
                liveField.value = value ?? '';
                liveField.dispatchEvent(new Event('input', {bubbles: true}));
            }

        }

        if(form.cmd)
        {
            form.cmd.value = finalCmd;
        }

        if(form.subcmd)
        {
            form.subcmd.value = finalSubcmd;
        }

        if(form.ft_ord_no)
        {
            form.ft_ord_no.value = String(order);
        }

        if(form.sel_ctns)
        {
            form.sel_ctns.value = String(cartons);
        }

        return {
            hasUpdateButton: Boolean(form.querySelector('[name="Submit99"]')),
        };

        function isAllowedLiveField(field, liveNames)
        {
            const exact = new Set([
                'cmd',
                'subcmd',
                'ft_ord_no',
                'sel_ctns',
                'sel_tot_weight',
                'sel_tot_qty_to_ship',
                'sel_tot_amt_to_ship',
                'sel_invc_net_amt',
                'sel_shipvia_cod',
                'sel_terms_cod',
                'sel_factor_cod',
                'new_invoice_date',
            ]);

            const rowField = /^DNUM(?:BOXNO|BOXNOEND|QTYSHIP|QTYSHIPPC|PRC|BOXWT)_\d+$/.test(field);
            const knownFooterField = liveNames.has(field) && /^(sel_|new_|ordhdrs_|allow_|prt_|called_from_)/.test(field);

            return exact.has(field) || rowField || knownFooterField;
        }
    }, {
        fields: requestFields,
        finalCmd: FINAL_CMD,
        finalSubcmd: FINAL_SUBCMD,
        order: orderNo,
        cartons: totalCartons,
    });

    if(!readyToUpdate.hasUpdateButton)
    {
        throw new Error('Invoice Update button Submit99 was not found');
    }

    let confirmationResolved = false;
    let resolveConfirmation;
    const confirmationAccepted = new Promise((resolve)=> {
        resolveConfirmation = resolve;
    });
    const onDialog = async (dialog)=> {
        const isUpdateConfirmation = dialog.type() === 'confirm' && /ARE YOU SURE/i.test(dialog.message());
        await dialog.accept();

        if(isUpdateConfirmation && !confirmationResolved)
        {
            confirmationResolved = true;
            resolveConfirmation(true);
        }
    };

    page.on('dialog', onDialog);

    try
    {
        const updateButton = await frame.$('[name="Submit99"]');

        if(!updateButton)
        {
            throw new Error('Invoice Update button Submit99 disappeared before it could be clicked');
        }

        await updateButton.click();

        const accepted = await Promise.race([
            confirmationAccepted,
            new Promise((resolve)=> setTimeout(()=> resolve(false), 15000)),
        ]);

        if(!accepted)
        {
            throw new Error('The ARE YOU SURE Update confirmation popup did not appear');
        }

        await waitForPageWork(page);

        return {
            ok: true,
            status: 200,
            redirectLocation: '',
        };
    }
    finally
    {
        page.off('dialog', onDialog);
    }
}

function cssEscape(value)
{
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

module.exports = {
    prepareInvoicePackage,
    submitInvoiceJson,
    printInvoiceDocument,
    buildInvoiceExcel,
    login,
    openBillEachOrder,
    getContentsFrame,
    applyFilter,
    setCartonsAndReload,
    extractRowMap,
    validateChatGptRequest,
    submitInvoiceJsonAndGenerateDocuments,
    submitInvoiceJsonAndGenerateDocumentsInner,
    getInvoiceUclData,
};
