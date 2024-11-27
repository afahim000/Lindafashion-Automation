/* Logic of reading xlsx
create array of objects
create lineCounter set equal to 0 and then increment.
start from fourth line
create item counter set equal to 1 
if the item counter matches the number on the first cell then extract the contents: item number(column B), item quantity(column D), dzn/pcs(column E)
increment the counter if it matches the next row column A cell then extract contents like above
repeat the steps for subsequent rows until the item counter number does not match any column A row number
*/

const ediExplorer = require('./ediExplorer.js');
const puppeteer = require('puppeteer');
const xlsxPopulate = require('xlsx-populate')
const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')
const exceljs = require('exceljs');
const test =  async (PO, monitoringForm, formFields) =>{
    var workbook = new exceljs.Workbook();
    await workbook.xlsx.load(PO.buffer);
    var worksheet = workbook.getWorksheet(1) || workbook.getWorksheet(2)
    const POnumber = (worksheet.getCell('K1')).value;
    let rowCounter = 1;
    const column = worksheet.getColumn(1);
    const column1= column.values;
    const data = []
    let poDate;
    let deliveryDate;
    for(let i = 4; i < column1.length; i++)
    {
        if(column1[i]=== rowCounter)
        {
            rowCounter++;
            const row = worksheet.getRow(i).values
            
            data.push(
                {
                    itemNumber: row[2],
                    qty: row[4],
                    dzn: row[5]
                }
            )
        }
        else if(column1[i] === '订货日期:')
        {   
                poDate = worksheet.getCell(i, 2).value
                deliveryDate = worksheet.getCell(i, 9).value
                break;
        }     
    }


    const totalQty = worksheet.getCell(rowCounter + 3, 4).value.result
    const totalCost = worksheet.getCell(rowCounter + 6, 8).value.result

    var infoColumn = worksheet.getColumn(8);
    let person;
    let factory;
    let phone;

    infoColumn.eachCell((cell, rowNumber)=>
    {
  
    if(cell.value === '经办人:')
        {          
           person = worksheet.getCell(cell.row , cell.col + 1).value
        }
    else if(cell.value === '卖方:')
        {
            factory = worksheet.getCell(cell.row , cell.col + 1).value
        }
    else if(cell.value === '联系电话:')
        {
           phone = worksheet.getCell(cell.row , cell.col + 1).value || ""
        }
    else{

        }
    })

    const browser = await puppeteer.launch({headless: false});
    const page = await browser.newPage();
    await page.goto('https://www.google.com/search?q=google+translate&rlz=1C1VDKB_enUS1113US1113&oq=google+translate&gs_lcrp=EgZjaHJvbWUqDggAEEUYJxg7GIAEGIoFMg4IABBFGCcYOxiABBiKBTIKCAEQABixAxiABDINCAIQABiDARixAxiABDIPCAMQABgUGIcCGLEDGIAEMgcIBBAAGIAEMgYIBRBFGD0yBggGEEUYPDIGCAcQRRhB0gEIMjEyOGowajeoAgCwAgA&sourceid=chrome&ie=UTF-8')

    await page.locator("#tw-source-text-ta").fill(person);
    //await page.waitForTimeout(2000)
    const value = await page.evaluate(async ()=>{
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // Initialize the translated text and loop until it changes
        let translation = '';
        for (let i = 0; i < 10; i++) { // Retry up to 10 times
            const element = document.querySelector("#tw-target-text > span.Y2IQFc");
            if (element && element.innerText !== 'Translation' && element.innerText !== 'Translating') { // Adjust 'Translation' if it's different
                translation = element.innerText;
                break;
            }
            await delay(500); // Wait 500ms before checking again
        }
        return translation;
    })
    await page.goto('https://www.google.com/search?q=google+translate&rlz=1C1VDKB_enUS1113US1113&oq=google+translate&gs_lcrp=EgZjaHJvbWUqDggAEEUYJxg7GIAEGIoFMg4IABBFGCcYOxiABBiKBTIKCAEQABixAxiABDINCAIQABiDARixAxiABDIPCAMQABgUGIcCGLEDGIAEMgcIBBAAGIAEMgYIBRBFGD0yBggGEEUYPDIGCAcQRRhB0gEIMjEyOGowajeoAgCwAgA&sourceid=chrome&ie=UTF-8')
    await page.locator("#tw-source-text-ta").fill(factory);

    const factoryValue = await page.evaluate(async ()=>{
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        //Initialize the translated text and loop until it changes
        let translation = '';
        for (let i = 0; i < 10; i++) { // Retry up to 10 times
            const element = document.querySelector("#tw-target-text > span.Y2IQFc");
            if (element && element.innerText !== 'Translation' && element.innerText !== 'Translating') { // Adjust 'Translation' if it's different
                translation = element.innerText;
                break;
            }
            await delay(500); // Wait 500ms before checking again
        }
        return translation;
    })

    await browser.close();

    var writeTo = new exceljs.Workbook();
    writeTo.addWorksheet('My sheet')
    const writeToSheet = writeTo.getWorksheet(1);
    writeToSheet.getRow(1).values = ['STYLE#','ITEM#','DESC1','DESC2','DESC3','DESC4','CAT','SUBCAT','VEND#','VENDOR PRODUCTION#','RMB.COST','ARB.COST2','FOB','QTY','UM','SELLPRC1','SELLPRC2','SELLPRC3','SELLPRC4','SELLPRC5','SELLPRC6','SEASON','WH','DUTY%','COMM%','MISC%','PC/CTN', 'GENDER']
    for (let items of data)
    {
        writeToSheet.addRow([items.itemNumber, items.itemNumber,"","","","","","",value,items.itemNumber, 18, "", 2.4, items.qty, items.dzn, 5, 5, 5, 6.5])
    }

    const writeBuffer = await writeTo.csv.writeBuffer();
    const directory = path.join(`${__dirname}/ediUpload`, `${POnumber} ${value}.csv`);
    fs.writeFile(directory,writeBuffer,(error)=>{ error ? console.log(error): console.log('file saved')});
    //write to a workbook file
    await xlsxPopulate.fromFileAsync(`//HOST/network/Lindafashion/JESSA -LINDA FASHION FILES/Purchasing/PO MONITORING FORM/${monitoringForm.originalname}`).then((workbook)=>
    {
        const worksheet = workbook.sheet("PO DATA");
        const finalRow = worksheet.usedRange()._maxRowNumber
        const dataRange = worksheet.range(7,1,finalRow,16).value();
        worksheet.range(7+1,1,finalRow+1,16).value(dataRange)
        worksheet.range("A7:P7").value([[formFields.rep, "", POnumber, formFields.description, formFields.category,  poDate, deliveryDate, formFields.container, rowCounter -1, totalQty, totalCost,]])
        worksheet.cell("L7").formula(`(J7/50)*${formFields.multiplier}`);
        return workbook.toFileAsync(`//HOST/network/Lindafashion/JESSA -LINDA FASHION FILES/Purchasing/PO MONITORING FORM/${monitoringForm.originalname}`);    
    })
    .then(data => {console.log('done')})
    console.log(poDate);
    const finale = {POnumber: POnumber, purchaseOrderDate: poDate,deliveryDate: deliveryDate, person: value, factory: factoryValue, phone: phone, filePath: directory}
    return finale;

}




module.exports = 
{
    run: test

}