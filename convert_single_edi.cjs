const fs = require('fs');
const path = require('path');
const {convertExcelBufferToEdiCsv} = require('./backend/services/excelToEdiCsv');

async function main()
{
    const source = path.resolve('csv_conversion_inputs', 'S00181 梦娜饰品 BR.xls');
    const outputDirectory = path.resolve('single_edi_output');
    const result = await convertExcelBufferToEdiCsv({
        buffer: fs.readFileSync(source),
        originalFilename: path.basename(source),
        outputDirectory,
    });
    console.log(JSON.stringify(result, null, 2));
}

main().catch((error)=> {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
