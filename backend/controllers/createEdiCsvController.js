const {convertExcelBufferToEdiCsv} = require('../services/excelToEdiCsv');
const {EDI_UPLOAD_FOLDER} = require('../config/ediConversionConfig');

async function createEdiCsvController(req, res)
{
    const files = req.files || [];

    if(files.length === 0)
    {
        return res.status(400).json({
            success: false,
            message: 'No Excel files were selected.',
        });
    }

    const results = [];
    const seenSignatures = new Map();

    for(const file of files)
    {
        try
        {
            const conversion = await convertExcelBufferToEdiCsv({
                buffer: file.buffer,
                originalFilename: file.originalname,
                outputDirectory: EDI_UPLOAD_FOLDER,
            });
            const existingSource = seenSignatures.get(conversion.signature);

            if(existingSource)
            {
                results.push({
                    sourceFile: file.originalname,
                    success: true,
                    duplicate: true,
                    generated: false,
                    message: `Duplicate of ${existingSource}. No second CSV was created.`,
                });
                continue;
            }

            seenSignatures.set(conversion.signature, file.originalname);
            results.push({
                sourceFile: file.originalname,
                success: true,
                duplicate: false,
                generated: true,
                po: conversion.po,
                vendor: conversion.vendor,
                orderDate: conversion.orderDate,
                deliveryDate: conversion.deliveryDate,
                itemCount: conversion.itemCount,
                totalQuantity: conversion.totalQuantity,
                outputFilename: conversion.outputFilename,
                outputPath: conversion.outputPath,
                warnings: conversion.warnings,
            });
        }
        catch(error)
        {
            console.log(error);
            results.push({
                sourceFile: file.originalname,
                success: false,
                duplicate: false,
                generated: false,
                error: error.message,
            });
        }
    }

    const successful = results.filter((result)=> result.success).length;
    const failed = results.filter((result)=> !result.success).length;

    return res.json({
        success: failed === 0,
        outputDirectory: EDI_UPLOAD_FOLDER,
        successful,
        failed,
        results,
    });
}

module.exports = {
    createEdiCsvController,
};
