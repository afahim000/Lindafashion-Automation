const puppeteer = require('puppeteer')
const fs = require('fs')
const path = require('path')
const {JSDOM} = require('jsdom')
const config = require('./config');
function ediDate(date)
{
   
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if(!match)
    {
        return date;
    }

    return `${match[2]}/${match[3]}/${match[1]}`;
}

const finalUpload = async (cookie, filePath, POnumber, poDate, deliveryDate, agentCode, vendor) =>
{
    const file = fs.readFileSync(filePath);
    const response = await postEdiForm(cookie, createPoFormData({
        file,
        filePath,
        POnumber,
        poDate,
        deliveryDate,
        agentCode,
        vendor,
        cmd: 'upload_csv_file',
        selectBlno: '',
        selectLinCnt: '0',
        checkSelect: '',
    }));

    const html = await response.text();
    const redFlags = findRedFlags(html, POnumber);

    if(redFlags.length > 0)
    {
        return {
            ok: response.ok,
            status: response.status,
            html,
            redFlags,
            flagged: true,
            converted: false
        }
    }

    const convertState = getConvertState(html, POnumber);

    if(convertState.dnums.length === 0)
    {
        return {
            ok: false,
            status: response.status,
            html,
            redFlags: ['No selectable PO lines found for conversion'],
            flagged: true,
            converted: false
        }
    }

    const convertResponse = await postEdiForm(cookie, createPoFormData({
        file,
        filePath,
        POnumber,
        poDate,
        deliveryDate,
        agentCode,
        vendor,
        cmd: 'convert_csv_to_po',
        selectBlno: 'BLS',
        selectLinCnt: convertState.selectLinCnt,
        checkSelect: convertState.dnums[0],
        dnums: convertState.dnums,
    }));
    const convertHtml = await convertResponse.text();
    const convertRedFlags = findRedFlags(convertHtml, POnumber);

    return {
        ok: response.ok && convertResponse.ok,
        status: convertResponse.status,
        html: convertHtml,
        uploadStatus: response.status,
        convertStatus: convertResponse.status,
        redFlags: convertRedFlags,
        flagged: convertRedFlags.length > 0,
        converted: convertResponse.ok,
        convertedLines: convertState.dnums.length
    }
  
}

function createPoFormData({file, filePath, POnumber, poDate, deliveryDate, agentCode, vendor, cmd, selectBlno, selectLinCnt, checkSelect, dnums = []})
{
    const csvFile = new Blob([file], { type: 'text/csv' });
    const formData = new FormData();

     function limitVendorName(vendor)
    {
    return String(vendor || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 12);
    }
    formData.append("nvend_no", limitVendorName(agentCode));
    formData.append("ovend_no", "");
    formData.append("savcode", "");
    formData.append("page", "1");
    formData.append("direction", "");
    formData.append("cursor", "");
    formData.append("new_vend_no", "");
    formData.append("new_factory_hdr_name", limitVendorName(vendor));;
    formData.append("update_all", "");
    formData.append("all_sku_no", "a");
    formData.append("cmd", cmd);
    formData.append("subcmd", "");
    formData.append("po_exist_flg", "N");
    formData.append("po_fnd_flg", "N");
    formData.append("code", limitVendorName(agentCode));
    formData.append("sel_po_no", POnumber);
    formData.append("sel_po_dat", ediDate(poDate));
    formData.append("sel_eta_dat", ediDate(deliveryDate));
    formData.append("sel_xfact_dat", ediDate(deliveryDate));
    formData.append("input_local_file_name", csvFile, path.basename(filePath));
    formData.append("get_pos", "");
    formData.append("ordhdrs_id", "");
    formData.append("po_wrk_id", "");
    formData.append("update_row", "");
    formData.append("select_blno", selectBlno);
    formData.append("select_lin_cnt", selectLinCnt);
    formData.append("helpbox", "");
    formData.append("checkall", "on");
    formData.append("check_select", checkSelect);

    for(const dnum of dnums)
    {
        formData.append(dnum, "f");
    }

    formData.append("checkall", "on");
    formData.append("cartons_pikhdrs", "");
    formData.append("selected_ctns", 0);
    formData.append("check_select", "");

    return formData;
}

function postEdiForm(cookie, formData)
{
    return fetch(`https://${config.EDI_HOST}/edibs/po/po_propose_from_csv_entry.php`,
        {
            method: 'POST',
            headers:
            {
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "accept-encoding": "gzip, deflate, br, zstd",
                "accept-language":"en-US,en;q=0.9",
                "cache-control":"max-age=0",
                "connection":"keep-alive",
                cookie: cookie,
                host: config.EDI_HOST,
                origin: config.EDI_BASE_URL,
                referer: `${config.EDI_BASE_URL}/edibs/po/po_propose_from_csv_entry.php`,
                "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform":"Windows",
                "sec-fetch-dest":"frame",
                "sec-fetch-mode":"navigate",
                "sec-fetch-site":"same-origin",
                "sec-fetch-user":"?1",
                "upgrade-insecure-requests":"1",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            },
            body: formData
        }
    )
}

function findRedFlags(html, POnumber)
{
    const dom = new JSDOM(html);
    const rows = [...dom.window.document.querySelectorAll('tr')];
    const flagReasons = {
        po: 'PO Already Exists',
        vendor: 'FACTORY NOT SETUP',
        item: 'EITHER ITEM NOT SETUP OR NOT IN PO'
    };

    const flags = rows
        .filter((row)=> isPoLineRow(row, POnumber))
        .flatMap((row)=>
        {
            const cells = [...row.querySelectorAll('td')];
            const checks = [
                {type: 'PO#', reason: flagReasons.po, cell: cells[1]},
                {type: 'VENDOR', reason: flagReasons.vendor, cell: cells[3]},
                {type: 'ITEM', reason: flagReasons.item, cell: cells[4]},
            ];

            return checks
                .filter((check)=> check.cell && hasRedFont(check.cell))
                .map((check)=>
                {
                    const value = check.cell.textContent.trim();
                    return `${check.type}${value ? ` ${value}` : ''}: ${check.reason}`;
                });
        });

    return [...new Set(flags)];
}

function getConvertState(html, POnumber)
{
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const dnums = [...document.querySelectorAll('tr')]
        .filter((row)=> isPoLineRow(row, POnumber))
        .map((row)=> row.querySelector('input[name^="DNUM_"]'))
        .filter(Boolean)
        .map((input)=> input.getAttribute('name'))
        .filter(Boolean);
    const selectLinCnt = document.querySelector('input[name="select_lin_cnt"]')?.getAttribute('value') || '0';

    return {
        dnums: [...new Set(dnums)],
        selectLinCnt
    };
}

function isPoLineRow(row, POnumber)
{
    const cells = [...row.querySelectorAll('td')];

    if(cells.length < 5)
    {
        return false;
    }

    return cells[1].textContent.trim() === POnumber;
}

function hasRedFont(cell)
{
    return [...cell.querySelectorAll('font[color]')]
        .some((font)=> font.getAttribute('color').toLowerCase() === 'red');
}



module.exports = {
    run: finalUpload
}
