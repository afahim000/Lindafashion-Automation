
const {JSDOM} = require('jsdom')
const ediExplore = async(person, factory, phone)=>
{
   
    const edi = await fetch('https://edilindafashion.com/edibs/menu/login.php',
        {
            //Get request to attain the PHPSSID cookie
            headers: 
            {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'max-age=0',
                'Connection': 'keep-alive',
                'Cookie': 'usercookie=ABRAR; compcookie=00LINDA',
                'Host': 'edilindafashion.com',
                'Sec-CH-UA': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                'Sec-CH-UA-Mobile': '?0',
                'Sec-CH-UA-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            },
            method: 'GET',

        }
        
    )
    .then((data)=>
        {
            //Extract cookie value
            const cookieString = data.headers.get('set-cookie');
            const sessionId = cookieString.split(';')[0];
            return sessionId;
        })
        .then(async (data)=>
        {
            //Authenticate
            const response = await fetch('https://edilindafashion.com/edibs/menu/login.php',
                {
                    headers:
                    {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'Accept-Encoding': 'gzip, deflate, br, zstd',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Cache-Control': 'max-age=0',
                        'Connection': 'keep-alive',
                        'Content-Length': '50',
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cookie': `usercookie=ABRAR; compcookie=00LINDA; ${data}`,
                        'Host': 'edilindafashion.com',
                        'Origin': 'https://edilindafashion.com',
                        'Referer': 'https://edilindafashion.com/edibs/menu/login.php',
                        'Sec-CH-UA': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                        'Sec-CH-UA-Mobile': '?0',
                        'Sec-CH-UA-Platform': '"Windows"',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'same-origin',
                        'Sec-Fetch-User': '?1',
                        'Upgrade-Insecure-Requests': '1',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                    },
                    method: 'POST',
                    body: 'comp_code=00LINDA&username=ABRAR&password=06032024'
                    
                }
            )
            return data;
        })
        .then(async (data)=>
            {
                //Go To factory agent header

                const page = await fetch("https://edilindafashion.com/edibs/admin/d1menu.php?sel_menu_id=223",
                    {
                        method: 'POST',
                        headers: 
                        {
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                            'Accept-Encoding': 'gzip, deflate, br, zstd',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Cache-Control': 'max-age=0',
                            'Connection': 'keep-alive',
                            'Content-Length': '333',
                            'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundaryABLG4MgjPInU2tdm',
                            'Cookie': `${data}`,
                            'Host': 'edilindafashion.com',
                            'Origin': 'https://edilindafashion.com',
                            'Referer': 'https://edilindafashion.com/edibs/sy/edibs_weekly_list.php',
                            'Sec-CH-UA': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                            'Sec-CH-UA-Mobile': '?0',
                            'Sec-CH-UA-Platform': '"Windows"',
                            'Sec-Fetch-Dest': 'frame',
                            'Sec-Fetch-Mode': 'navigate',
                            'Sec-Fetch-Site': 'same-origin',
                            'Sec-Fetch-User': '?1',
                            'Upgrade-Insecure-Requests': '1',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                        },
                        body: `------WebKitFormBoundaryABLG4MgjPInU2tdm\r\nContent-Disposition: form-data; name="page"\r\n\r\n1\r\n------WebKitFormBoundaryABLG4MgjPInU2tdm\r\nContent-Disposition: form-data; name="filtertext"\r\n\r\n\r\n------WebKitFormBoundaryABLG4MgjPInU2tdm\r\nContent-Disposition: form-data; name="condition"\r\n\r\ncode\r\n------WebKitFormBoundaryABLG4MgjPInU2tdm--\r\n`
                    }
                );
                return data;
            })
        .then(async (data)=>
        {
            const response = await fetch('https://edilindafashion.com/edibs/po/po_factory_hdr_aj.php', 
                {
                    headers:
                    {
                        "accept": "text/javascript, text/html, application/xml, text/xml, */*",
                        "accept-encoding": "gzip, deflate, br, zstd",
                        "accept-language": "en-US,en;q=0.9",
                        "connection": "keep-alive",
                        "content-length": "101",
                        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "cookie": `${data}`,
                        "host": "edilindafashion.com",
                        "origin": "https://edilindafashion.com",
                        "referer": "https://edilindafashion.com/edibs/po/po_factory_hdr.php",
                        "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                        "sec-ch-ua-mobile": "?0",
                        "sec-ch-ua-platform": '"Windows"',
                        "sec-fetch-dest": "empty",
                        "sec-fetch-mode": "cors",
                         "sec-fetch-site": "same-origin",
                        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                        "x-prototype-version": "1.7.2",
                        "x-requested-with": "XMLHttpRequest"
                    },
                    method: 'POST',
                    body: 'ajcmd=ajcmd_show_list&new_factory_hdr_id=&sort_meth=asc&sort_col=factory_hdr&sav_sort_col=factory_hdr'

                }
            )

            return {
                response: response,
                cookie: data,
                    }
        })
        .then(async(data)=>
        {
            const html = await data.response.text()
            const loadDom = new JSDOM(html);
            const dom = loadDom.window.document
            const rows = dom.querySelectorAll("tr.tlist");
            let found;
            rows.forEach((item)=>
            {
                const cells = item.childNodes
                
                if(cells.length > 1)
                {
                    if(cells[2].innerHTML.includes(person))
                    {
                        found = cells[1].querySelector("a").innerHTML;
                    }
                }
                

            })

 
            if(found)
                return {response: response, agentCode: found, cookie: data.cookie}
            else
                return {agentCode: false, cookie: data.cookie}

        })
        .then(async (data)=>
            {
                if(data.agentCode)
                {
                    return {
                        response: data.response,
                        cookie: data.cookie,
                        agentCode: data.agentCode,
                            }
                }
                else
                {

                    const response = await fetch('https://edilindafashion.com/edibs/po/index_po_master_tables.php',
                        {
                            headers:
                            {
                                "Accept": "text/javascript, text/html, application/xml, text/xml, */*",
                                "Accept-Encoding": "gzip, deflate, br, zstd",
                                "Accept-Language": "en-US,en;q=0.9",
                                "Connection": "keep-alive",
                                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                                "Cookie": `${data.cookie}`,
                                "Host": "edilindafashion.com",
                                "Origin": "https://edilindafashion.com",
                                "Referer": "https://edilindafashion.com/edibs/po/po_factory_hdr.php",
                                "Sec-CH-UA": "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"",
                                "Sec-CH-UA-Mobile": "?0",
                                "Sec-CH-UA-Platform": "\"Windows\"",
                                "Sec-Fetch-Dest": "empty",
                                "Sec-Fetch-Mode": "cors",
                                "Sec-Fetch-Site": "same-origin",
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                                "X-Prototype-Version": "1.7.2",
                                "X-Requested-With": "XMLHttpRequest"
                            },
                            body:{
                                "cmd": "po_factory_master",
                                "subcmd": "",
                                "direction": "",
                                "savcode": "",
                                "show_list": "t",
                                "show_product_list": "f",
                                "sort_meth": "asc",
                                "sort_col": "factory_hdr",
                                "sav_sort_col": "factory_hdr",
                                "new_factory_hdr_id": "",
                                "old_factory_hdr_log_user": "",
                                "new_factory_hdr_log_user": "ABRAR",
                                "new_factory_hdr_agency_no": `${name}`,
                                "old_factory_hdr_agency_no": "",
                                "new_factory_hdr_agency_name": `${name}`,
                                "old_factory_hdr_agency_name": "",
                                "new_factory_hdr_agency_adrs1": "",
                                "old_factory_hdr_agency_adrs1": "",
                                "new_factory_hdr_agency_adrs2": "",
                                "old_factory_hdr_agency_adrs2": "",
                                "new_factory_hdr_agency_adrs3": "",
                                "old_factory_hdr_agency_adrs3": "",
                                "new_factory_hdr_agency_city": "",
                                "new_factory_hdr_agency_state": "",
                                "new_factory_hdr_agency_zip": "",
                                "new_factory_hdr_agency_country": "",
                                "old_factory_hdr_agency_city": "",
                                "old_factory_hdr_agency_state": "",
                                "old_factory_hdr_agency_zip": "",
                                "old_factory_hdr_agency_country": "",
                                "new_factory_hdr_term_cod": "",
                                "old_factory_hdr_term_cod": "",
                                "new_factory_hdr_name": `${factory}`,
                                "old_factory_hdr_name": "",
                                "new_factory_hdr_adrs1": "",
                                "old_factory_hdr_adrs1": "",
                                "new_factory_hdr_adrs2": "",
                                "old_factory_hdr_adrs2": "",
                                "new_factory_hdr_adrs3": "",
                                "old_factory_hdr_adrs3": "",
                                "new_factory_hdr_city": "",
                                "new_factory_hdr_state": "",
                                "new_factory_hdr_zip": "",
                                "new_factory_hdr_country": "",
                                "old_factory_hdr_city": "",
                                "old_factory_hdr_state": "",
                                "old_factory_hdr_zip": "",
                                "old_factory_hdr_country": "",
                                "new_factory_hdr_comm_pct": 0.000,
                                "old_factory_hdr_comm_pct": "",
                                "new_factory_hdr_booth_no": "",
                                "old_factory_hdr_booth_no": "",
                                "new_factory_hdr_contact1": "",
                                "old_factory_hdr_contact1": "",
                                "new_factory_hdr_phone1": `${phone}`,
                                "old_factory_hdr_phone1": "",
                                "new_factory_hdr_email1": "",
                                "old_factory_hdr_email1": "",
                                "new_factory_hdr_contact2": "",
                                "old_factory_hdr_contact2": "",
                                "new_factory_hdr_phone2": "",
                                "old_factory_hdr_phone2": "",
                                "new_factory_hdr_email2": "",
                                "old_factory_hdr_email2": "",
                                "new_factory_hdr_ownership": "",
                                "old_factory_hdr_ownership": "",
                                "new_factory_hdr_opn_dat": "//",
                                "old_factory_hdr_opn_dat": "//",
                                "new_factory_hdr_group": "",
                                "old_factory_hdr_group": "",
                                "new_factory_hdr_active_flg": "",
                                "old_factory_hdr_active_flg": "",
                                "new_factory_hdr_po_no_prefix": "",
                                "old_factory_hdr_po_no_prefix": "",
                                "new_factory_hdr_file_seq": "",
                                "old_factory_hdr_file_seq": "",
                                "new_factory_hdr_cnt_ptd": "",
                                "old_factory_hdr_cnt_ptd": "",
                                "new_factory_hdr_cnt_ytd": "",
                                "old_factory_hdr_cnt_ytd": "",
                                "new_factory_hdr_1_days": "",
                                "old_factory_hdr_1_days": "",
                                "new_factory_hdr_2_days": "",
                                "old_factory_hdr_2_days": "",
                                "new_factory_hdr_3_days": "",
                                "old_factory_hdr_3_days": "",
                                "new_factory_hdr_4_days": "",
                                "old_factory_hdr_4_days": "",
                                "new_factory_hdr_5_days": "",
                                "old_factory_hdr_5_days": "",
                                "new_factory_hdr_6_days": "",
                                "old_factory_hdr_6_days": "",
                                "new_factory_hdr_7_days": "",
                                "old_factory_hdr_7_days": "",
                                "new_factory_hdr_8_days": "",
                                "old_factory_hdr_8_days": "",
                                "new_factory_hdr_9_days": "",
                                "old_factory_hdr_9_days": "",
                                "new_factory_hdr_10_days": "",
                                "old_factory_hdr_10_days": "",
                                "button_Update": "INSERT",
                                "button_NewCode": "NEW CODE",
                                "button_Reset": "Reset",
                                "button_Toggle": "Show/Hide List",
                                "button_Product": "Show/Hide Production",
                                "Submit3": "Add Production",
                                "delete_row": "",
                                "helpbox": ""
                            },
                            method: 'POST',
                        }
                    )
                    const agentCode = name.toUpperCase()
                    return {
                        response: response,
                        cookie: data.cookie,
                        agentCode: agentCode,
                            };
                }
            })

        

  
    return edi;
}

module.exports = 
{
    run: ediExplore
}