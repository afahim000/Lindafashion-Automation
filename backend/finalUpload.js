const puppeteer = require('puppeteer')

const finalUpload = async (cookie, file, POnumber, poDate, deliveryDate, agentCode) =>
{
    const blob = new Blob([file], { type: 'text/csv' }); // You can specify the MIME type of the file

// Create a File object from the Blob
const done = new File([blob], 'example.txt', { type: 'text/csv' });
    const formData = new FormData();
formData.append("nvend_no", agentCode);
formData.append("ovend_no", "");
formData.append("savcode", "");
formData.append("page", "1");
formData.append("direction", "");
formData.append("cursor", "");
formData.append("new_vend_no", "");
formData.append("new_factory_hdr_name", "ZOU YONGHAI");
formData.append("update_all", "");
formData.append("all_sku_no", "a");
formData.append("cmd", "upload_csv_file");
formData.append("subcmd", "");
formData.append("po_exist_flg", "N");
formData.append("po_fnd_flg", "N");
formData.append("code", agentCode);
formData.append("sel_po_no", POnumber);
formData.append("sel_po_dat", poDate);
formData.append("sel_eta_dat", "11/21/2024");
formData.append("sel_xfact_dat", deliveryDate);
formData.append("input_local_file_name", done);
formData.append("get_pos", "");
formData.append("ordhdrs_id", "");
formData.append("po_wrk_id", "");
formData.append("update_row", "");
formData.append("select_blno", "");
formData.append("select_lin_cnt", '0');
formData.append("helpbox", "");
formData.append("checkall", 'on');
formData.append("cartons_pikhdrs", "");
formData.append("selected_ctns", 0);
formData.append("check_select", "");
    const response = await fetch('https://edilindafashion.com/edibs/po/po_propose_from_csv_entry.php', 
        {
            method: 'POST',
            headers: 
            {
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "accept-encoding": "gzip, deflate, br, zstd",
                "accept-language":"en-US,en;q=0.9",
                "cache-control":"max-age=0",
                "connection":"keep-alive",
                "content-type": "multipart/form-data; boundary=----WebKitFormBoundaryWARbGjnhGstwLYV9",
                cookie:`PHPSESSID=${cookie}`,
                host: "edilindafashion.com",
                origin: "https://edilindafashion.com",
                referer: "https://edilindafashion.com/edibs/po/po_propose_from_csv_entry.php",
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

    const browser = await puppeteer.launch({headless: false});
    const page = await browser.newPage();
    await page.setContent(await response.text())
    //console.log(response)
  
}



module.exports = {
    run: finalUpload
}