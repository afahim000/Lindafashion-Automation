const express = require('express')
//const reader = require('./xlsxReader.js');
const app = express();
const cors = require('cors');
const multer = require('multer')
const ediExplorer = require('./ediExplorer.js')
const finalUpload = require('./finalUpload.js')
const {prepareInvoicePackage, submitInvoiceJson, submitInvoiceJsonAndGenerateDocuments, printInvoiceDocument, buildInvoiceExcel, getInvoiceUclData} = require('./linda_bill_each_order.js')
const {createEdiCsvController} = require('./controllers/createEdiCsvController.js')
const {FedExShipping, contactPhoneFromPurchaseOrder} = require('./services/fedexShipping.js')
const {buildUclQuoteEmail, sendUclQuoteEmail} = require('./services/shippingQuoteEmail.js')
const {googleConnectionStatus, createAuthorizationUrl, completeAuthorization, sendGmailMessage} = require('./services/gmailOAuth.js')
const {EDI_UPLOAD_FOLDER} = require('./config/ediConversionConfig.js')
const fs = require('fs')
const path = require('path')
const os = require('os')
const {spawn, execFile} = require('child_process')
const {promisify} = require('util')
app.use(express.json())
app.use(express.urlencoded({ extended: true }));
const upload = multer()
const excelUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024,
        files: 50,
    },
    fileFilter(req, file, callback)
    {
        const extension = path.extname(file.originalname).toLowerCase();

        if(!['.xls', '.xlsx'].includes(extension))
        {
            return callback(new Error(`Unsupported file type: ${file.originalname}`));
        }

        callback(null, true);
    },
})
app.use(cors());
const config = require('./config');
const PORT = config.PORT;
const ediUploadDirectory = EDI_UPLOAD_FOLDER;
const completedDocsDirectory = path.join(__dirname, 'invoiceWork', 'completed-docs');
const completedDocumentsIndexPath = path.join(completedDocsDirectory, 'completed-documents.json');
const uclFormTemplatePath = process.env.UCL_FORM_TEMPLATE_PATH || 'C:\\Users\\ABRAR\\Downloads\\CK_TRADING_UCL_FORM.pdf';
const uclFormScriptPath = path.join(__dirname, 'scripts', 'create_ucl_form.py');
const uclLabelScriptPath = path.join(__dirname, 'scripts', 'create_ucl_labels.py');
const uclLabelLogoPath = path.join(__dirname, 'assets', 'linda-fashion-logo.jpg');
const quickBooksOptimizerDirectory = process.env.QUICKBOOKS_OPTIMIZER_DIR || 'C:\\Users\\ABRAR\\OneDrive\\Documents\\Quickbooks optimizer';
const quickBooksPurchaseOrderDirectory = path.join(quickBooksOptimizerDirectory, 'data', 'purchase_orders');
const quickBooksPdfUploadDirectory = path.join(quickBooksOptimizerDirectory, 'input', 'purchase_orders');
const quickBooksPhotoUploadDirectory = path.join(quickBooksOptimizerDirectory, 'input', 'purchase_order_photos');
const fedExLabelDirectory = process.env.FEDEX_LABEL_DIR || path.join(quickBooksOptimizerDirectory, 'data', 'shipping_labels');
const bundledPython = process.env.CODEX_PYTHON || 'C:\\Users\\ABRAR\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
const quickBooksPowerShell = process.env.QUICKBOOKS_POWERSHELL || 'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe';
const pdfToPpmPath = process.env.PDFTOPPM_PATH || 'C:\\Users\\ABRAR\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe';
const quickBooksProcessControlScript = path.join(__dirname, 'scripts', 'control_process.ps1');
const activeQuickBooksInvoiceJobs = new Map();
const uploadProgress = {};
const execFileAsync = promisify(execFile);
const quickBooksCompanyFile = process.env.QUICKBOOKS_COMPANY_FILE || '\\\\192.168.1.8\\Tanslin  Able  Hansfull\\QuickBook\\Tanslin 2025\\Tanslin 2025.QBW';
const quickBooksShare = process.env.QUICKBOOKS_NETWORK_SHARE || '\\\\192.168.1.8\\Tanslin  Able  Hansfull';
let latestInvoicePackage = null;
const excludedPoNumbers = new Set(['DEMO_PO_EXCLUDED']);
const poVendorOverrides = {
    
};
let ediSessionCookie = null;
let ediSessionStartedAt = null;

app.post('/shipping-quote/send', async (req, res)=>
{
    try
    {
        const email = buildUclQuoteEmail(req.body);
        const connection = googleConnectionStatus();
        const delivery = connection.connected
            ? await sendGmailMessage({to: process.env.UCL_QUOTE_EMAIL_TO, subject: email.subject, text: email.text})
            : await sendUclQuoteEmail(req.body);
        res.send({status: 'sent', recipient: delivery.recipient, subject: email.subject, messageId: delivery.messageId, boxCount: email.boxCount});
    }
    catch(error)
    {
        console.log(`[shipping-quote] ${error.message}`);
        res.status(error.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 400).json({error: true, message: error.message || 'Could not send quote request'});
    }
})

app.get('/shipping-quote/google/status', (req, res)=> res.send(googleConnectionStatus()))

app.get('/shipping-quote/google/connect', (req, res)=>
{
    try { res.redirect(createAuthorizationUrl()); }
    catch(error) { res.status(503).send(`<h1>Gmail connection is not configured</h1><p>${String(error.message)}</p>`); }
})

app.get('/shipping-quote/google/callback', async (req, res)=>
{
    try
    {
        const authorization = await completeAuthorization(String(req.query.code || ''), String(req.query.state || ''));
        res.type('html').send(`<!doctype html><html><body style="font:18px Arial;padding:30px"><h1>Gmail connected</h1><p>${authorization.email} is ready to send UCL quote requests. You can close this window.</p><script>setTimeout(()=>window.close(),1500)</script></body></html>`);
    }
    catch(error)
    {
        res.status(400).type('html').send(`<!doctype html><html><body style="font:18px Arial;padding:30px"><h1>Could not connect Gmail</h1><p>${String(error.message)}</p></body></html>`);
    }
})

async function quickBooksNetworkStatus()
{
    try
    {
        await fs.promises.access(quickBooksCompanyFile, fs.constants.R_OK);
        return {connected: true, server: '192.168.1.8'};
    }
    catch(error)
    {
        return {connected: false, server: '192.168.1.8'};
    }
}

function ensureDirectory(directoryPath)
{
    if(!fs.existsSync(directoryPath))
    {
        fs.mkdirSync(directoryPath, {recursive: true});
    }
}

function readCompletedDocuments()
{
    try
    {
        ensureDirectory(completedDocsDirectory);
        const parsed = JSON.parse(fs.readFileSync(completedDocumentsIndexPath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    }
    catch(error)
    {
        if(error.code !== 'ENOENT') console.log(`Could not read completed documents index: ${error.message}`);
        return [];
    }
}

function saveCompletedDocument(documentRecord)
{
    ensureDirectory(completedDocsDirectory);
    const current = readCompletedDocuments();
    const withoutDuplicate = current.filter((item)=> item.id !== documentRecord.id);
    const updated = [documentRecord, ...withoutDuplicate].slice(0, 100);
    const temporaryPath = `${completedDocumentsIndexPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(updated, null, 2));
    fs.renameSync(temporaryPath, completedDocumentsIndexPath);
    return documentRecord;
}

function findQuickBooksInvoiceNumber(poNumber, commandOutput = '', createdAfter = 0)
{
    const responseDirectory = path.join(quickBooksOptimizerDirectory, 'data', 'quickbooks_responses');
    const outputPath = String(commandOutput || '').match(/QuickBooks Invoice response saved:\s*(.+?\.xml)\s*$/im)?.[1]?.trim();
    const candidates = [];

    if(outputPath && fs.existsSync(outputPath)) candidates.push(outputPath);
    if(fs.existsSync(responseDirectory))
    {
        const safePo = sanitizeFileStem(poNumber);
        fs.readdirSync(responseDirectory)
            .filter((fileName)=> fileName.toLowerCase().endsWith('-invoice-response.xml') && fileName.toLowerCase().startsWith(safePo.toLowerCase()))
            .map((fileName)=> path.join(responseDirectory, fileName))
            .filter((filePath)=> fs.statSync(filePath).mtimeMs >= createdAfter)
            .sort((a, b)=> fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
            .forEach((filePath)=> candidates.push(filePath));
    }

    for(const responsePath of [...new Set(candidates)])
    {
        const xml = fs.readFileSync(responsePath, 'utf8');
        const match = xml.match(/<InvoiceRet>[\s\S]*?<RefNumber>([^<]+)<\/RefNumber>/i);
        if(match) return {invoiceNumber: match[1].trim(), responsePath};
    }

    return null;
}

function findQuickBooksInvoicePdf(poNumber, createdAfter = 0)
{
    const downloadsDirectory = path.join(os.homedir(), 'Downloads');
    const baseName = `PROFORMA A-Z PO ${formatPoForFileName(poNumber)}`;
    if(!fs.existsSync(downloadsDirectory)) return null;

    const candidates = fs.readdirSync(downloadsDirectory)
        .filter((fileName)=> fileName.toLowerCase().endsWith('.pdf')
            && (fileName === `${baseName}.pdf` || fileName.startsWith(`${baseName} (`)))
        .map((fileName)=> {
            const filePath = path.join(downloadsDirectory, fileName);
            return {fileName, modifiedAt: fs.statSync(filePath).mtimeMs};
        })
        .filter((file)=> file.modifiedAt >= createdAfter)
        .sort((a, b)=> b.modifiedAt - a.modifiedAt);

    if(!candidates.length) return null;
    const fileName = candidates[0].fileName;
    return {
        fileName,
        viewUrl: `/quickbooks-optimizer/invoice-pdf/${encodeURIComponent(fileName)}`,
        downloadUrl: `/quickbooks-optimizer/invoice-pdf/${encodeURIComponent(fileName)}?download=true`,
    };
}

async function createQuickBooksInvoiceForPurchaseOrder(purchaseOrder, jsonPath, jobId)
{
    const importerPath = path.join(quickBooksOptimizerDirectory, 'scripts', 'import_po_to_quickbooks.ps1');
    const quickBooksStartedAt = Date.now() - 2000;
    let quickbooks;

    try
    {
        quickbooks = await runCommand(quickBooksPowerShell, [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', importerPath,
            '-JsonPath', jsonPath, '-SkipSalesOrder', '-CreateInvoice', '-PrintQuickBooksInvoicePdf',
        ], {
            cwd: quickBooksOptimizerDirectory,
            onSpawn: jobId ? (child)=> activeQuickBooksInvoiceJobs.set(jobId, {child, status: 'running'}) : undefined,
        });
    }
    catch(error)
    {
        const recovered = findQuickBooksInvoiceNumber(purchaseOrder.po_number, error.output, quickBooksStartedAt);
        if(!recovered) throw error;
        quickbooks = {code: error.code, output: error.output, partialSuccess: true, warning: 'Invoice was created, but later QuickBooks PDF/printing automation reported an error.'};
    }

    const invoiceRecord = findQuickBooksInvoiceNumber(purchaseOrder.po_number, quickbooks.output, quickBooksStartedAt);
    if(!invoiceRecord) throw new Error('QuickBooks completed without returning an invoice number');
    purchaseOrder.quickbooks_invoice_ref_number = invoiceRecord.invoiceNumber;
    purchaseOrder.quickbooks_invoice_response_path = invoiceRecord.responsePath;
    fs.writeFileSync(jsonPath, JSON.stringify(purchaseOrder, null, 2), 'utf8');
    quickbooks.invoicePdf = findQuickBooksInvoicePdf(purchaseOrder.po_number, quickBooksStartedAt);
    return quickbooks;
}

function setUploadProgress(jobId, progress)
{
    if(!jobId)
    {
        return;
    }

    uploadProgress[jobId] = {
        jobId,
        updatedAt: new Date().toISOString(),
        ...progress
    };

    console.log(`[upload-csv:${jobId}] ${progress.status} - ${progress.message}`);
}

function parseCsvFileName(fileName)
{
    const baseName = path.parse(fileName).name;
    const match = baseName.match(/^(.*?)\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/);

    if(!match)
    {
        return null;
    }

    return {
        fileName,
        vendor: match[1].trim(),
        ediVendor: poVendorOverrides[match[4].trim()] || match[1].trim(),
        poDate: match[2],
        xFactorDate: match[3],
        poNumber: match[4].trim(),
        status: 'pending'
    }
}

async function getEdiSessionCookie(forceRefresh = false)
{
    if(forceRefresh || !ediSessionCookie)
    {
        ediSessionCookie = await ediExplorer.login();
        ediSessionStartedAt = new Date().toISOString();
        console.log(`[edi-session] Started shared EDI session at ${ediSessionStartedAt}`);
    }

    return ediSessionCookie;
}

async function getVendorWithSharedSession(vendor)
{
    try
    {
        const ediCookie = await getEdiSessionCookie();
        return await ediExplorer.run(vendor, vendor, '', ediCookie);
    }
    catch(error)
    {
        console.log(`[edi-session] Shared session failed, refreshing once: ${error.message}`);
        const ediCookie = await getEdiSessionCookie(true);
        return ediExplorer.run(vendor, vendor, '', ediCookie);
    }
}


/*
app.post('/',upload.array('upload', 2),async (req, res) =>
{
    try
   {
    const PO = req.files[0]
    const monitoringForm = req.files[1]
    const textInputs = req.body
    
    const xlsxResponse = await reader.run(PO, monitoringForm, textInputs);
    //const ediResponse = await ediExplorer.run(xlsxResponse.person, xlsxResponse.factory, xlsxResponse,phone)
    //{POnumber: POnumber, purchaseOrderDate: poDate,deliveryDate: deliveryDate, person: value, factory: factory, phone: phone, attachedFile: writeBuffer}
    //{response: response, cookie: data.cookie, agentCode: upperCaseName,atta}
    //const finale = await finalUpload.run(ediResponse.cookie, xlsxResponse.chedFile, xlsxResponse.POnumber, xlsxResponse.POdate, xlsxResponse.deliveryDate, ediResponse.agentCode)
    res.send({POnumber: xlsxResponse.POnumber, poDate: xlsxResponse.purchaseOrderDate, deliveryDate: xlsxResponse.deliveryDate,filePath: xlsxResponse.filePath, person: xlsxResponse.person, factory: xlsxResponse.factory, phone: xlsxResponse.phone});
   }
   catch(error)
   {
    console.log(error);
    res.status(500).json({
        error: true,
        message: 'Something went wrong',
    })

   }

}
   
)
*/
app.post('/edi',async (req, res)=>
{
    console.log(req.body)
    try
    {
        const response = await ediExplorer.run(req.body.person, req.body.factory, req.body.phone);
        res.send(response);
    }
    catch(error)
   {
    console.log(error);
    res.status(500).json({

        error: true,
        message: 'Something went wrong',
    })

   }
    

    
    
})

app.get('/csv-files',(req, res)=>
{
    try
    {
        console.log('[csv-files] Reading CSV upload folder');
        const csvFiles = fs.readdirSync(ediUploadDirectory)
            .filter((fileName)=> path.extname(fileName).toLowerCase() === '.csv')
            .map(parseCsvFileName)
            .filter(Boolean)
            .filter((file)=> !excludedPoNumbers.has(file.poNumber))
            .sort((a, b)=> a.poNumber.localeCompare(b.poNumber, undefined, {numeric: true}));

        console.log(`[csv-files] Returning ${csvFiles.length} CSV files`);
        res.send(csvFiles);
    }
    catch(error)
    {
        console.log(error);
        res.status(500).json({
            error: true,
            message: 'Could not read CSV upload folder',
        })
    }
})

app.delete('/csv-files',(req, res)=>
{
    try
    {
        console.log('[csv-files] Clearing CSV upload folder');
        const resolvedUploadDirectory = path.resolve(ediUploadDirectory);
        const deletedFiles = [];

        fs.readdirSync(resolvedUploadDirectory)
            .filter((fileName)=> path.extname(fileName).toLowerCase() === '.csv')
            .forEach((fileName)=> {
                const filePath = path.resolve(resolvedUploadDirectory, fileName);

                if(!filePath.startsWith(resolvedUploadDirectory + path.sep))
                {
                    return;
                }

                fs.unlinkSync(filePath);
                deletedFiles.push(fileName);
            });

        console.log(`[csv-files] Deleted ${deletedFiles.length} CSV files`);
        res.send({
            ok: true,
            deletedCount: deletedFiles.length,
            deletedFiles,
        });
    }
    catch(error)
    {
        console.log(error);
        res.status(500).json({
            error: true,
            message: 'Could not clear CSV upload folder',
        })
    }
})

app.get('/upload-progress/:jobId',(req, res)=>
{
    res.send(uploadProgress[req.params.jobId] || {
        jobId: req.params.jobId,
        status: 'pending',
        message: 'Waiting for upload to start',
    });
})

app.post('/api/create-edi-csv', excelUpload.array('excelFiles'), createEdiCsvController)

app.post('/quickbooks-optimizer/purchase-order', upload.single('purchaseOrder'), async (req, res)=>
{
    try
    {
        if(!req.file)
        {
            return res.status(400).json({
                error: true,
                message: 'Purchase order PDF is required',
            })
        }

        const originalName = req.file.originalname || 'purchase-order.pdf';
        const extension = path.extname(originalName).toLowerCase();
        const supportedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);

        if(extension !== '.pdf' && !supportedImageExtensions.has(extension))
        {
            return res.status(400).json({
                error: true,
                message: 'Only PDF or image purchase orders are supported',
            })
        }

        ensureDirectory(quickBooksPurchaseOrderDirectory);
        ensureDirectory(quickBooksPdfUploadDirectory);
        ensureDirectory(quickBooksPhotoUploadDirectory);

        const uploadedStem = sanitizeFileStem(path.parse(originalName).name);
        if(supportedImageExtensions.has(extension))
        {
            const photoPath = uniqueFilePath(quickBooksPhotoUploadDirectory, `${Date.now()}-${uploadedStem}${extension}`);
            fs.writeFileSync(photoPath, req.file.buffer);

            return res.status(400).json({
                error: true,
                message: 'Photo upload is available, but automatic photo OCR is not enabled yet. Use a scanned/text PDF for automatic QuickBooks extraction.',
                sourcePhotoPath: photoPath,
            })
        }

        const pdfPath = uniqueFilePath(quickBooksPdfUploadDirectory, `${Date.now()}-${uploadedStem}.pdf`);
        fs.writeFileSync(pdfPath, req.file.buffer);

        const extractorPath = path.join(quickBooksOptimizerDirectory, 'scripts', 'extract_proforma_po.py');
        const tempJsonPath = path.join(quickBooksPurchaseOrderDirectory, `${Date.now()}-${uploadedStem}.json`);

        await runCommand(bundledPython, [
            extractorPath,
            pdfPath,
            tempJsonPath,
        ], {
            cwd: quickBooksOptimizerDirectory,
        });

        const purchaseOrder = JSON.parse(fs.readFileSync(tempJsonPath, 'utf8'));
        purchaseOrder.recipient_phone = contactPhoneFromPurchaseOrder(purchaseOrder);
        const existingInvoiceNumber = String(req.body.existingInvoiceNumber || '').trim();
        if(existingInvoiceNumber)
        {
            purchaseOrder.quickbooks_invoice_ref_number = existingInvoiceNumber;
        }
        const poStem = sanitizeFileStem(purchaseOrder.po_number, uploadedStem);
        const finalJsonPath = uniqueFilePath(quickBooksPurchaseOrderDirectory, `${poStem}.json`);

        if(finalJsonPath !== tempJsonPath)
        {
            fs.renameSync(tempJsonPath, finalJsonPath);
        }

        const expectedPdfFileName = `PROFORMA A-Z PO ${formatPoForFileName(purchaseOrder.po_number || poStem)}.pdf`;
        let quickbooks = null;
        let fedex = null;

        const createQuickBooksInvoice = String(
            req.body.createQuickBooksInvoice || req.body.createSalesOrder || ''
        ).toLowerCase() === 'true';

        if(createQuickBooksInvoice)
        {
            quickbooks = await createQuickBooksInvoiceForPurchaseOrder(purchaseOrder, finalJsonPath);
        }

        const createFedExLabel = String(req.body.createFedExLabel || '').toLowerCase() === 'true';

        if(createFedExLabel)
        {
            if(!purchaseOrder.quickbooks_invoice_ref_number)
            {
                throw new Error('A QuickBooks invoice number is required before creating the FedEx label. Enter the existing invoice number or select Create Invoice in QuickBooks.');
            }
            fedex = await new FedExShipping().createLabel(purchaseOrder, {
                weight: req.body.packageWeight,
                length: req.body.packageLength,
                width: req.body.packageWidth,
                height: req.body.packageHeight,
                packages: req.body.packages,
                recipientPhone: req.body.recipientPhone,
                serviceType: req.body.fedexServiceType || undefined,
            }, fedExLabelDirectory);
            fedex.labels = fedex.labels.map((label)=> ({
                ...label,
                viewUrl: `/quickbooks-optimizer/fedex-document/${encodeURIComponent(label.fileName)}`,
                downloadUrl: `/quickbooks-optimizer/fedex-document/${encodeURIComponent(label.fileName)}?download=true`,
            }));
            fedex.transactionUrl = `/quickbooks-optimizer/fedex-document/${encodeURIComponent(fedex.transactionFileName)}`;
        }

        res.send({
            status: quickbooks && fedex ? 'created-invoice-and-label' : fedex ? 'created-label' : quickbooks ? 'created-invoice' : 'extracted',
            sourcePdfPath: pdfPath,
            jsonPath: finalJsonPath,
            expectedPdfFileName,
            purchaseOrder,
            quickbooks,
            fedex,
        });
    }
    catch(error)
    {
        console.log(error);
        res.status(400).json({
            error: true,
            message: error.message || 'Could not process QuickBooks purchase order',
            output: error.output,
        })
    }
})

app.get('/quickbooks-optimizer/purchase-orders', (req, res)=>
{
    try
    {
        ensureDirectory(quickBooksPurchaseOrderDirectory);
        const purchaseOrders = [];
        const seenPoNumbers = new Set();
        const files = fs.readdirSync(quickBooksPurchaseOrderDirectory)
            .filter((fileName)=> fileName.toLowerCase().endsWith('.json'))
            .map((fileName)=> {
                const jsonPath = path.join(quickBooksPurchaseOrderDirectory, fileName);
                return {jsonPath, modifiedAt: fs.statSync(jsonPath).mtimeMs};
            })
            .sort((a, b)=> b.modifiedAt - a.modifiedAt);

        for(const file of files)
        {
            try
            {
                const purchaseOrder = JSON.parse(fs.readFileSync(file.jsonPath, 'utf8'));
                const poNumber = String(purchaseOrder?.po_number || '').trim();
                if(!poNumber || seenPoNumbers.has(poNumber)) continue;
                seenPoNumbers.add(poNumber);
                purchaseOrders.push({purchaseOrder, jsonPath: file.jsonPath, savedAt: new Date(file.modifiedAt).toISOString()});
                if(purchaseOrders.length >= 50) break;
            }
            catch(error)
            {
                // Ignore malformed historical files and continue loading valid POs.
            }
        }

        res.set('Cache-Control', 'no-store');
        res.json({purchaseOrders});
    }
    catch(error)
    {
        res.status(500).json({message: 'Could not load extracted purchase orders'});
    }
});

app.get('/quickbooks-optimizer/fedex-document/:fileName', (req, res)=>
{
    const fileName = path.basename(req.params.fileName || '');
    const isAllowed = /-fedex-(?:label(?:-\d+-\d+)?\.pdf|transaction\.html)$/i.test(fileName);
    const filePath = path.join(fedExLabelDirectory, fileName);

    if(!isAllowed || !fs.existsSync(filePath))
    {
        return res.status(404).json({error: true, message: 'FedEx document not found'});
    }

    if(String(req.query.download).toLowerCase() === 'true') return res.download(filePath, fileName);
    res.sendFile(filePath);
})

app.get('/quickbooks-optimizer/invoice-pdf/:fileName', (req, res)=>
{
    const fileName = path.basename(req.params.fileName || '');
    const downloadsDirectory = path.join(os.homedir(), 'Downloads');
    const filePath = path.join(downloadsDirectory, fileName);

    if(!/^PROFORMA A-Z PO .+\.pdf$/i.test(fileName) || !fs.existsSync(filePath))
    {
        return res.status(404).send('QuickBooks invoice PDF not found');
    }

    if(String(req.query.download || '').toLowerCase() === 'true') return res.download(filePath, fileName);
    res.type('application/pdf').sendFile(filePath);
})

app.post('/quickbooks-optimizer/shipping-label', async (req, res)=>
{
    try
    {
        const purchaseOrder = JSON.parse(JSON.stringify(req.body.purchaseOrder || {}));
        const invoiceNumber = String(req.body.invoiceNumber || purchaseOrder.quickbooks_invoice_ref_number || '').trim();

        if(!purchaseOrder.po_number || !purchaseOrder.ship_to?.name || !Array.isArray(purchaseOrder.ship_to?.address))
        {
            return res.status(400).json({error: true, message: 'Select a valid saved purchase order'});
        }

        if(!invoiceNumber)
        {
            return res.status(400).json({error: true, message: 'The QuickBooks invoice number is required'});
        }

        purchaseOrder.quickbooks_invoice_ref_number = invoiceNumber;
        const fedex = await new FedExShipping().createLabel(purchaseOrder, {
            weight: req.body.packageWeight,
            length: req.body.packageLength,
            width: req.body.packageWidth,
            height: req.body.packageHeight,
            packages: req.body.packages,
            recipientPhone: req.body.recipientPhone,
            serviceType: req.body.fedexServiceType || undefined,
        }, fedExLabelDirectory);

        fedex.labels = fedex.labels.map((label)=> ({
            ...label,
            viewUrl: `/quickbooks-optimizer/fedex-document/${encodeURIComponent(label.fileName)}`,
            downloadUrl: `/quickbooks-optimizer/fedex-document/${encodeURIComponent(label.fileName)}?download=true`,
        }));
        fedex.transactionUrl = `/quickbooks-optimizer/fedex-document/${encodeURIComponent(fedex.transactionFileName)}`;

        res.send({status: 'created-label', purchaseOrder, fedex});
    }
    catch(error)
    {
        console.log(error);
        res.status(400).json({error: true, message: error.message || 'Could not create FedEx shipping label'});
    }
})

app.post('/quickbooks-optimizer/invoice', async (req, res)=>
{
    const jobId = String(req.body.jobId || '').trim();
    try
    {
        if(!/^[A-Za-z0-9_-]{8,80}$/.test(jobId))
        {
            return res.status(400).json({error: true, message: 'A valid invoice job ID is required'});
        }
        if(activeQuickBooksInvoiceJobs.has(jobId))
        {
            return res.status(409).json({error: true, message: 'This invoice job is already running'});
        }
        const jsonPath = path.resolve(String(req.body.jsonPath || ''));
        const purchaseOrderDirectory = path.resolve(quickBooksPurchaseOrderDirectory);

        if(!jsonPath.startsWith(purchaseOrderDirectory + path.sep) || path.extname(jsonPath).toLowerCase() !== '.json' || !fs.existsSync(jsonPath))
        {
            return res.status(400).json({error: true, message: 'Select a valid saved purchase order'});
        }

        const purchaseOrder = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const previousInvoiceNumber = String(purchaseOrder.quickbooks_invoice_ref_number || '').trim();
        if(previousInvoiceNumber)
        {
            purchaseOrder.quickbooks_invoice_ref_number = '';
            fs.writeFileSync(jsonPath, JSON.stringify(purchaseOrder, null, 2), 'utf8');
        }

        let quickbooks;
        try
        {
            quickbooks = await createQuickBooksInvoiceForPurchaseOrder(purchaseOrder, jsonPath, jobId);
        }
        catch(error)
        {
            if(previousInvoiceNumber)
            {
                purchaseOrder.quickbooks_invoice_ref_number = previousInvoiceNumber;
                fs.writeFileSync(jsonPath, JSON.stringify(purchaseOrder, null, 2), 'utf8');
            }
            throw error;
        }
        res.send({status: 'created-invoice', jsonPath, purchaseOrder, quickbooks});
    }
    catch(error)
    {
        console.log(error);
        res.status(400).json({error: true, message: error.message || 'Could not create QuickBooks invoice', output: error.output});
    }
    finally
    {
        activeQuickBooksInvoiceJobs.delete(jobId);
    }
})

async function controlQuickBooksInvoiceJob(req, res, action)
{
    const jobId = String(req.params.jobId || '').trim();
    const job = activeQuickBooksInvoiceJobs.get(jobId);
    if(!job || !job.child || job.child.exitCode !== null)
    {
        return res.status(404).json({error: true, message: 'The invoice job is no longer running'});
    }

    const targetStatus = action === 'Pause' ? 'paused' : 'running';
    if(job.status === targetStatus)
    {
        return res.json({jobId, status: job.status});
    }

    try
    {
        await execFileAsync(quickBooksPowerShell, [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', quickBooksProcessControlScript,
            '-Action', action, '-ProcessId', String(job.child.pid),
        ], {windowsHide: true, timeout: 15000});
        job.status = targetStatus;
        res.json({jobId, status: job.status});
    }
    catch(error)
    {
        res.status(500).json({error: true, message: `Could not ${action.toLowerCase()} the invoice job: ${error.message}`});
    }
}

app.post('/quickbooks-optimizer/invoice/:jobId/pause', (req, res)=> controlQuickBooksInvoiceJob(req, res, 'Pause'));
app.post('/quickbooks-optimizer/invoice/:jobId/resume', (req, res)=> controlQuickBooksInvoiceJob(req, res, 'Resume'));

app.post('/upload-csv',async (req, res)=>
{
    const jobId = req.body.jobId;

    try
    {
        setUploadProgress(jobId, {
            status: 'starting',
            message: 'Received upload request',
        });

        const fileInfo = req.body;
        const parsedFileInfo = parseCsvFileName(fileInfo.fileName);

        if(!parsedFileInfo)
        {
            setUploadProgress(jobId, {
                status: 'failed',
                message: 'Invalid CSV filename format',
            });

            return res.status(400).json({
                error: true,
                message: 'Invalid CSV filename format',
            })
        }

        if(excludedPoNumbers.has(parsedFileInfo.poNumber))
        {
            setUploadProgress(jobId, {
                status: 'skipped',
                message: `Skipped excluded PO ${parsedFileInfo.poNumber}`,
                fileName: parsedFileInfo.fileName,
                poNumber: parsedFileInfo.poNumber,
                vendor: parsedFileInfo.vendor,
            });

            return res.send({
                ...parsedFileInfo,
                status: 'skipped',
                message: `Skipped excluded PO ${parsedFileInfo.poNumber}`,
            });
        }

        setUploadProgress(jobId, {
            status: 'parsing',
            message: `Parsed ${parsedFileInfo.poNumber} for ${parsedFileInfo.vendor}`,
            fileName: parsedFileInfo.fileName,
            poNumber: parsedFileInfo.poNumber,
            vendor: parsedFileInfo.vendor,
            ediVendor: parsedFileInfo.ediVendor,
        });

        const safeFileName = path.basename(parsedFileInfo.fileName);
        const filePath = path.join(ediUploadDirectory, safeFileName);
        const resolvedPath = path.resolve(filePath);

        const resolvedUploadDirectory = path.resolve(ediUploadDirectory);

        if(parsedFileInfo.fileName !== safeFileName || resolvedPath !== path.join(resolvedUploadDirectory, safeFileName))
        {
            setUploadProgress(jobId, {
                status: 'failed',
                message: 'Invalid CSV file path',
            });

            return res.status(400).json({
                error: true,
                message: 'Invalid CSV file path',
            })
        }

        if(!fs.existsSync(resolvedPath))
        {
            setUploadProgress(jobId, {
                status: 'failed',
                message: 'CSV file not found in backend/ediUpload',
            });

            return res.status(404).json({
                error: true,
                message: 'CSV file not found',
            })
        }

        setUploadProgress(jobId, {
            status: 'checking-vendor',
            message: `Checking or creating vendor ${parsedFileInfo.ediVendor} with shared EDI session`,
            fileName: parsedFileInfo.fileName,
            poNumber: parsedFileInfo.poNumber,
            vendor: parsedFileInfo.vendor,
            ediVendor: parsedFileInfo.ediVendor,
        });

        const ediResponse = await getVendorWithSharedSession(parsedFileInfo.ediVendor);

        setUploadProgress(jobId, {
            status: 'vendor-ready',
            message: `Vendor ready with agent code ${ediResponse.agentCode}`,
            fileName: parsedFileInfo.fileName,
            poNumber: parsedFileInfo.poNumber,
            vendor: parsedFileInfo.vendor,
            ediVendor: parsedFileInfo.ediVendor,
            agentCode: ediResponse.agentCode,
            ediSessionStartedAt,
        });

        setUploadProgress(jobId, {
            status: 'uploading-file',
            message: `Uploading CSV for PO ${parsedFileInfo.poNumber}`,
            fileName: parsedFileInfo.fileName,
            poNumber: parsedFileInfo.poNumber,
            vendor: parsedFileInfo.vendor,
            ediVendor: parsedFileInfo.ediVendor,
            agentCode: ediResponse.agentCode,
        });

        const uploadResponse = await finalUpload.run(
            ediResponse.cookie,
            resolvedPath,
            parsedFileInfo.poNumber,
            parsedFileInfo.poDate,
            parsedFileInfo.xFactorDate,
            ediResponse.agentCode,
            parsedFileInfo.ediVendor
        );

        if(!uploadResponse.ok)
        {
            setUploadProgress(jobId, {
                status: 'failed',
                message: `EDI upload returned HTTP ${uploadResponse.status}`,
                fileName: parsedFileInfo.fileName,
                poNumber: parsedFileInfo.poNumber,
                vendor: parsedFileInfo.vendor,
                ediVendor: parsedFileInfo.ediVendor,
                agentCode: ediResponse.agentCode,
            });

            return res.status(502).json({
                error: true,
                message: `EDI upload returned HTTP ${uploadResponse.status}`,
            })
        }

        if(uploadResponse.flagged)
        {
            const redFlagMessage = `Flagged PO ${parsedFileInfo.poNumber}: review flagged EDI HTML rows`;

            setUploadProgress(jobId, {
                status: 'flagged',
                message: redFlagMessage,
                fileName: parsedFileInfo.fileName,
                poNumber: parsedFileInfo.poNumber,
                vendor: parsedFileInfo.vendor,
                ediVendor: parsedFileInfo.ediVendor,
                agentCode: ediResponse.agentCode,
                redFlags: uploadResponse.redFlags,
                redFlagDetails: uploadResponse.redFlagDetails,
            });

            return res.send({
                ...parsedFileInfo,
                status: 'flagged',
                agentCode: ediResponse.agentCode,
                uploadStatus: uploadResponse.status,
                redFlags: uploadResponse.redFlags,
                redFlagDetails: uploadResponse.redFlagDetails,
                message: redFlagMessage,
            });
        }

        setUploadProgress(jobId, {
            status: 'done',
            message: `Finished PO ${parsedFileInfo.poNumber}`,
            fileName: parsedFileInfo.fileName,
            poNumber: parsedFileInfo.poNumber,
            vendor: parsedFileInfo.vendor,
            ediVendor: parsedFileInfo.ediVendor,
            agentCode: ediResponse.agentCode,
        });

        res.send({
            ...parsedFileInfo,
            status: 'done',
            agentCode: ediResponse.agentCode,
            uploadStatus: uploadResponse.status,
        });
    }
    catch(error)
   {
    console.log(error);
    setUploadProgress(jobId, {
        status: 'failed',
        message: error.message || 'Something went wrong',
    });

    res.status(500).json({

        error: true,
        message: error.message || 'Something went wrong',
    })

   }
})

app.post('/make-invoice/prepare', upload.array('pickTicketImages', 20), async (req, res)=>
{
    try
    {
        if(!req.files || req.files.length === 0)
        {
            return res.status(400).json({
                error: true,
                message: 'At least one invoice photo is required',
            })
        }

        const orderNo = String(req.body.orderNo || '').trim();
        const totalCartons = Number(req.body.totalCartons);
        const rawShippingCost = String(req.body.shippingCost || '').trim();
        const shippingCostNumber = rawShippingCost === '' ? 0 : Number(rawShippingCost);

        if(!orderNo || !Number.isInteger(totalCartons) || totalCartons <= 0 || !Number.isFinite(shippingCostNumber) || shippingCostNumber < 0)
        {
            return res.status(400).json({
                error: true,
                message: 'Order number, a positive total carton count, and a valid non-negative shipping cost are required',
            })
        }

        const shippingCost = shippingCostNumber.toFixed(2);

        const result = await prepareInvoicePackage({
            orderNo,
            totalCartons,
            shippingCost,
            files: req.files,
        });
        latestInvoicePackage = {
            status: 'prepared',
            message: 'ChatGPT package is ready',
            ...result,
            downloadUrl: `/make-invoice/package/${result.jobId}?fileName=${encodeURIComponent(result.fileName)}`,
            preparedAt: new Date().toISOString(),
        };

        res.send(latestInvoicePackage);
    }
    catch(error)
    {
        console.log(error);
        res.status(500).json({
            error: true,
            message: error.message || 'Could not prepare invoice package',
        })
    }
})

app.get('/make-invoice/latest',(req, res)=>
{
    res.send(latestInvoicePackage || {
        status: 'empty',
        message: 'No prepared invoice package yet',
    });
})

app.get('/make-invoice/package/:jobId',(req, res)=>
{
    const safeJobId = path.basename(req.params.jobId || '');
    const requestedName = path.basename(String(req.query.fileName || ''));
    const downloadName = requestedName || `${safeJobId}.zip`;
    const zipPath = path.join(__dirname, 'invoiceWork', `${safeJobId}.zip`);

    if(!safeJobId || !fs.existsSync(zipPath))
    {
        return res.status(404).json({
            error: true,
            message: 'Package not found',
        })
    }

    res.download(zipPath, downloadName);
})

app.get('/make-invoice/completed-doc/:jobId/:fileName',(req, res)=>
{
    const safeJobId = path.basename(req.params.jobId || '');
    const safeFileName = path.basename(req.params.fileName || '');
    const filePath = path.join(completedDocsDirectory, safeJobId, safeFileName);

    if(!safeJobId || !safeFileName || !fs.existsSync(filePath))
    {
        return res.status(404).json({
            error: true,
            message: 'Completed document not found',
        })
    }

    if(String(req.query.inline || '').toLowerCase() === 'true')
    {
        res.type('application/pdf');
        return res.sendFile(filePath);
    }

    res.download(filePath, safeFileName);
})

app.get('/make-invoice/completed', (req, res)=>
{
    res.send({
        status: 'ready',
        documents: readCompletedDocuments(),
    });
})

app.delete('/make-invoice/completed/:documentId', (req, res)=>
{
    const documentId = String(req.params.documentId || '').trim();
    if(!documentId)
    {
        return res.status(400).json({error: true, message: 'Document ID is required'});
    }

    const documents = readCompletedDocuments();
    const documentInfo = documents.find((item)=> item.id === documentId);
    if(!documentInfo)
    {
        return res.send({status: 'deleted', id: documentId, alreadyRemoved: true});
    }

    const updated = documents.filter((item)=> item.id !== documentId);
    ensureDirectory(completedDocsDirectory);
    const temporaryPath = `${completedDocumentsIndexPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(updated, null, 2));
    fs.renameSync(temporaryPath, completedDocumentsIndexPath);

    res.send({
        status: 'deleted',
        id: documentId,
        orderNo: documentInfo.orderNo,
    });
})

app.get('/make-invoice/ucl-download/:documentId/:type', (req, res)=>
{
    const documentInfo = readCompletedDocuments().find((item)=> item.id === String(req.params.documentId || ''));
    const field = req.params.type === 'form' ? 'uclForm' : req.params.type === 'labels' ? 'uclLabels' : '';
    const artifact = field ? documentInfo?.[field] : null;
    const savedPath = artifact?.savedPath ? path.resolve(artifact.savedPath) : '';
    const downloadsDirectory = path.resolve(path.join(os.homedir(), 'Downloads'));

    if(!artifact || !savedPath.startsWith(downloadsDirectory + path.sep) || !fs.existsSync(savedPath))
    {
        return res.status(404).json({error: true, message: 'UCL document not found'});
    }

    if(String(req.query.inline || '').toLowerCase() === 'true')
    {
        res.type('application/pdf');
        return res.sendFile(savedPath);
    }

    res.download(savedPath, artifact.fileName);
})

app.post('/make-invoice/submit', async (req, res)=>
{
    try
    {
        const chatGptJson = String(req.body.chatGptJson || '').trim();
        const parsedJson = JSON.parse(chatGptJson);
        const orderNo = String(parsedJson.requestFields?.ft_ord_no || parsedJson.orderNo || req.body.orderNo || '').trim();
        const totalCartons = Number(parsedJson.requestFields?.sel_ctns || parsedJson.totalCartons || req.body.totalCartons);
        const jsonShippingCost = parsedJson.requestFields?.sel_freight_amt;
        const shippingCostNumber = String(jsonShippingCost ?? req.body.shippingCost ?? '').trim() === '' ? 0 : Number(jsonShippingCost ?? req.body.shippingCost);

        if(!orderNo || !Number.isInteger(totalCartons) || totalCartons <= 0 || !Number.isFinite(shippingCostNumber) || shippingCostNumber < 0 || !chatGptJson)
        {
            return res.status(400).json({
                error: true,
                message: 'Order number, total cartons, and ChatGPT JSON are required',
            })
        }

        const result = await submitInvoiceJson({
            orderNo,
            totalCartons,
            shippingCost: shippingCostNumber.toFixed(2),
            chatGptJson,
        });

        res.send({
            status: 'submitted',
            ...result,
        });
    }
    catch(error)
    {
        console.log(error);
        res.status(400).json({
            error: true,
            message: error.message || 'Could not submit invoice JSON',
        })
    }
})

app.post('/make-invoice/submit-generate', async (req, res)=>
{
    try
    {
        const chatGptJson = String(req.body.chatGptJson || '').trim();
        const parsedJson = JSON.parse(chatGptJson);
        const orderNo = String(parsedJson.requestFields?.ft_ord_no || parsedJson.orderNo || req.body.orderNo || '').trim();
        const totalCartons = Number(parsedJson.requestFields?.sel_ctns || parsedJson.totalCartons || req.body.totalCartons);
        const jsonShippingCost = parsedJson.requestFields?.sel_freight_amt;
        const shippingCostNumber = String(jsonShippingCost ?? req.body.shippingCost ?? '').trim() === '' ? 0 : Number(jsonShippingCost ?? req.body.shippingCost);

        if(!orderNo || !Number.isInteger(totalCartons) || totalCartons <= 0 || !Number.isFinite(shippingCostNumber) || shippingCostNumber < 0 || !chatGptJson)
        {
            return res.status(400).json({
                error: true,
                message: 'Order number, total cartons, and ChatGPT JSON are required',
            })
        }

        const result = await submitInvoiceJsonAndGenerateDocuments({
            orderNo,
            totalCartons,
            shippingCost: shippingCostNumber.toFixed(2),
            chatGptJson,
        });
        const downloadsDir = path.join(os.homedir(), 'Downloads');

        // The legacy billing site sometimes names PDFs with the customer
        // number (for example, "786-DDIG") even though the invoice/Excel data
        // contains the real Sold To name.  Completed artifacts must always use
        // the customer name, never the customer number.
        const artifactCustomerName = String(result.excel.customerName || '')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .replace(/[. ]+$/g, '')
            .trim();
        const invoiceNumber = String(result.invoice.fileName || '').match(/\bINV\s+(.+?)(?:\s+-\s+P)?\.pdf$/i)?.[1]?.trim();
        if(artifactCustomerName && invoiceNumber)
        {
            result.invoice.fileName = `${artifactCustomerName} INV ${invoiceNumber}.pdf`;
            result.packingList.fileName = `${artifactCustomerName} INV ${invoiceNumber} - P.pdf`;
        }

        if(!fs.existsSync(downloadsDir))
        {
            fs.mkdirSync(downloadsDir, {recursive: true});
        }

        const invoicePath = uniqueFilePath(downloadsDir, result.invoice.fileName);
        fs.writeFileSync(invoicePath, result.invoice.pdf);
        const packingListPath = uniqueFilePath(downloadsDir, result.packingList.fileName);
        fs.writeFileSync(packingListPath, result.packingList.pdf);
        const completedJobId = `${orderNo}-${Date.now()}`;
        const completedJobDir = path.join(completedDocsDirectory, completedJobId);
        ensureDirectory(completedJobDir);
        const invoiceFileName = path.basename(invoicePath);
        const packingListFileName = path.basename(packingListPath);
        fs.writeFileSync(path.join(completedJobDir, invoiceFileName), result.invoice.pdf);
        fs.writeFileSync(path.join(completedJobDir, packingListFileName), result.packingList.pdf);

        const completedAt = new Date().toISOString();
        const savedFiles = [
            {
                type: 'invoice',
                fileName: invoiceFileName,
                savedPath: invoicePath,
                downloadUrl: `/make-invoice/completed-doc/${completedJobId}/${encodeURIComponent(invoiceFileName)}`,
            },
            {
                type: 'packing-list',
                fileName: packingListFileName,
                savedPath: packingListPath,
                downloadUrl: `/make-invoice/completed-doc/${completedJobId}/${encodeURIComponent(packingListFileName)}`,
            },
        ];
        const excel = {
            fileName: result.excel.fileName,
            downloadUrl: `/make-invoice/excel/${result.excel.jobId}`,
            orderNo: result.excel.orderNo,
            customerName: result.excel.customerName,
            itemCount: result.excel.itemCount,
            imageCount: result.excel.imageCount,
            missingImageCount: result.excel.missingImages.length,
            missingImages: result.excel.missingImages.slice(0, 20),
        };
        const completedDocument = saveCompletedDocument({
            id: completedJobId,
            name: result.excel.customerName || invoiceFileName.replace(/\.pdf$/i, ''),
            orderNo: String(orderNo),
            totalCartons: String(totalCartons),
            invoice: savedFiles[0],
            packingList: savedFiles[1],
            excel,
            uclData: result.uclData,
            submit: result.submit,
            completedAt,
        });

        res.send({
            status: 'submitted-generated',
            completedJobId,
            submit: result.submit,
            savedFiles,
            excel,
            completedDocument,
        });
    }
    catch(error)
    {
        console.log(error);
        res.status(400).json({
            error: true,
            message: error.message || 'Could not submit and generate documents',
        })
    }
})

app.post('/make-invoice/ucl-form', async (req, res)=>
{
    let temporaryDataPath = '';
    try
    {
        const documentId = String(req.body.id || '').trim();
        const orderNo = String(req.body.orderNo || '').trim();
        const documents = readCompletedDocuments();
        const documentInfo = documents.find((item)=> (documentId && item.id === documentId) || (!documentId && item.orderNo === orderNo));

        if(!documentInfo)
        {
            return res.status(404).json({error: true, message: 'Completed invoice was not found'});
        }

        if(String(req.body.shippingMethod || '').toUpperCase() !== 'UCL')
        {
            return res.status(400).json({error: true, message: 'Select UCL as the shipping method before creating a UCL form'});
        }

        let uclData = documentInfo.uclData;
        if(!uclData || !Array.isArray(uclData.shipTo) || uclData.shipTo.length === 0)
        {
            uclData = await getInvoiceUclData(documentInfo.orderNo, Number(documentInfo.totalCartons));
        }

        const withoutCustomerCode = (lines)=> {
            const result = Array.isArray(lines) ? [...lines] : [];
            // Customer numbers can be letters+digits (DIS008) or mixed codes
            // containing punctuation (786-DDIG).  They must never become the
            // C/O name on UCL forms or labels.  Remove leading code-like lines
            // until the first real Sold To name is reached.
            while(result.length > 0)
            {
                const first = String(result[0] || '').trim();
                const isCustomerNumber = !/\s/.test(first)
                    && /\d/.test(first)
                    && /^[A-Z0-9._-]+$/i.test(first);
                if(!isCustomerNumber) break;
                result.shift();
            }
            return result;
        };
        uclData = {
            ...uclData,
            soldTo: withoutCustomerCode(uclData.soldTo),
            shipTo: withoutCustomerCode(uclData.shipTo),
        };

        if(!fs.existsSync(uclFormTemplatePath))
        {
            throw new Error(`UCL form template not found: ${uclFormTemplatePath}`);
        }

        const totalCartons = Number(uclData.totalCartons || documentInfo.totalCartons);
        const cartons = Array.from({length: totalCartons}, (_, index)=> {
            const boxNo = String(index + 1);
            const dimensions = uclData.dimensions?.[boxNo] || {};
            return {
                box: index + 1,
                actualWeight: Number(uclData.weights?.[boxNo] || 0),
                length: Number(dimensions.length || 0),
                width: Number(dimensions.width || 0),
                height: Number(dimensions.height || 0),
            };
        });
        const payload = {
            orderNo: documentInfo.orderNo,
            totalCartons,
            soldTo: uclData.soldTo || [documentInfo.name],
            shipTo: uclData.shipTo || [],
            cartons,
        };
        ensureDirectory(completedDocsDirectory);
        temporaryDataPath = path.join(completedDocsDirectory, `ucl-${documentInfo.orderNo}-${Date.now()}.json`);
        fs.writeFileSync(temporaryDataPath, JSON.stringify(payload, null, 2));
        const downloadsDir = path.join(os.homedir(), 'Downloads');
        ensureDirectory(downloadsDir);
        const customerName = String(uclData.soldTo?.[0] || documentInfo.name || `ORDER ${documentInfo.orderNo}`)
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .replace(/[. ]+$/g, '')
            .trim() || `ORDER ${documentInfo.orderNo}`;
        const outputPath = path.join(downloadsDir, `UCL FORM ${customerName}.pdf`);
        const {stdout} = await execFileAsync(bundledPython, [
            uclFormScriptPath,
            '--template', uclFormTemplatePath,
            '--data', temporaryDataPath,
            '--output', outputPath,
        ], {timeout: 120000, windowsHide: true});
        const generatorResult = JSON.parse(String(stdout || '{}').trim());
        const updatedDocument = saveCompletedDocument({
            ...documentInfo,
            shippingMethodOverride: 'UCL',
            uclData,
            uclForm: {
                fileName: path.basename(outputPath),
                savedPath: outputPath,
                downloadUrl: `/make-invoice/ucl-download/${encodeURIComponent(documentInfo.id)}/form`,
                totalWeight: generatorResult.totalWeight,
                createdAt: new Date().toISOString(),
            },
        });
        res.send({status: 'created', uclForm: updatedDocument.uclForm});
    }
    catch(error)
    {
        console.log(error);
        res.status(500).json({error: true, message: error.message || 'Could not create UCL form'});
    }
    finally
    {
        if(temporaryDataPath && fs.existsSync(temporaryDataPath)) fs.unlinkSync(temporaryDataPath);
    }
})

app.post('/make-invoice/ucl-labels', async (req, res)=>
{
    let temporaryDataPath = '';
    try
    {
        const documentId = String(req.body.id || '').trim();
        const orderNo = String(req.body.orderNo || '').trim();
        const documents = readCompletedDocuments();
        const documentInfo = documents.find((item)=> (documentId && item.id === documentId) || (!documentId && item.orderNo === orderNo));

        if(!documentInfo)
        {
            return res.status(404).json({error: true, message: 'Completed invoice was not found'});
        }

        if(String(req.body.shippingMethod || '').toUpperCase() !== 'UCL')
        {
            return res.status(400).json({error: true, message: 'Select UCL as the shipping method before creating UCL labels'});
        }

        let uclData = documentInfo.uclData;
        if(!uclData || !Array.isArray(uclData.shipTo) || uclData.shipTo.length === 0)
        {
            uclData = await getInvoiceUclData(documentInfo.orderNo, Number(documentInfo.totalCartons));
        }

        const withoutCustomerCode = (lines)=> {
            const result = Array.isArray(lines) ? [...lines] : [];
            while(result.length > 0)
            {
                const first = String(result[0] || '').trim();
                const isCustomerNumber = !/\s/.test(first)
                    && /\d/.test(first)
                    && /^[A-Z0-9._-]+$/i.test(first);
                if(!isCustomerNumber) break;
                result.shift();
            }
            return result;
        };
        uclData = {
            ...uclData,
            soldTo: withoutCustomerCode(uclData.soldTo),
            shipTo: withoutCustomerCode(uclData.shipTo),
        };

        if(!fs.existsSync(uclLabelLogoPath))
        {
            throw new Error(`LABEL logo not found: ${uclLabelLogoPath}`);
        }

        const payload = {
            orderNo: documentInfo.orderNo,
            soldTo: uclData.soldTo || [documentInfo.name],
            shipTo: uclData.shipTo || [],
        };
        ensureDirectory(completedDocsDirectory);
        temporaryDataPath = path.join(completedDocsDirectory, `label-${documentInfo.orderNo}-${Date.now()}.json`);
        fs.writeFileSync(temporaryDataPath, JSON.stringify(payload, null, 2));
        const downloadsDir = path.join(os.homedir(), 'Downloads');
        ensureDirectory(downloadsDir);
        const customerName = String(uclData.soldTo?.[0] || documentInfo.name || `ORDER ${documentInfo.orderNo}`)
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .replace(/[. ]+$/g, '')
            .trim() || `ORDER ${documentInfo.orderNo}`;
        const outputPath = path.join(downloadsDir, `LABEL ${customerName}.pdf`);
        await execFileAsync(bundledPython, [
            uclLabelScriptPath,
            '--data', temporaryDataPath,
            '--logo', uclLabelLogoPath,
            '--output', outputPath,
        ], {timeout: 120000, windowsHide: true});
        const updatedDocument = saveCompletedDocument({
            ...documentInfo,
            shippingMethodOverride: 'UCL',
            uclData,
            uclLabels: {
                fileName: path.basename(outputPath),
                savedPath: outputPath,
                downloadUrl: `/make-invoice/ucl-download/${encodeURIComponent(documentInfo.id)}/labels`,
                createdAt: new Date().toISOString(),
            },
        });
        res.send({status: 'created', labels: updatedDocument.uclLabels});
    }
    catch(error)
    {
        console.log(error);
        res.status(500).json({error: true, message: error.message || 'Could not create LABEL PDF'});
    }
    finally
    {
        if(temporaryDataPath && fs.existsSync(temporaryDataPath)) fs.unlinkSync(temporaryDataPath);
    }
})

app.get('/make-invoice/print/:type', async (req, res)=>
{
    try
    {
        const type = req.params.type;
        const orderNo = String(req.query.orderNo || '').trim();
        const totalCartons = req.query.totalCartons ? Number(req.query.totalCartons) : null;

        if(!orderNo)
        {
            return res.status(400).json({
                error: true,
                message: 'Order number is required',
            })
        }

        const result = await printInvoiceDocument({
            orderNo,
            totalCartons,
            type,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
        res.send(result.pdf);
    }
    catch(error)
    {
        console.log(error);
        res.status(400).json({
            error: true,
            message: error.message || 'Could not print document',
        })
    }
})

function completedArtifactForPrint(documentId, type)
{
    const documentInfo = readCompletedDocuments().find((item)=> item.id === documentId);
    const artifactField = type === 'packing-list' ? 'packingList'
        : type === 'ucl-form' ? 'uclForm'
        : type === 'ucl-labels' ? 'uclLabels'
        : 'invoice';
    const artifact = documentInfo?.[artifactField];
    const savedPath = artifact?.savedPath ? path.resolve(artifact.savedPath) : '';
    return documentInfo && artifact && savedPath && fs.existsSync(savedPath) ? {documentInfo, artifact, savedPath} : null;
}

async function renderCompletedPdfForPrint(documentId, type)
{
    const completed = completedArtifactForPrint(documentId, type);
    if(!completed) return null;
    const safeDocumentId = path.basename(documentId);
    const cacheDirectory = path.join(__dirname, 'invoiceWork', 'print-cache', safeDocumentId, type);
    ensureDirectory(cacheDirectory);
    const outputPrefix = path.join(cacheDirectory, 'page');
    let pageFiles = fs.readdirSync(cacheDirectory).filter((name)=> /^page-\d+\.png$/i.test(name));

    if(!pageFiles.length)
    {
        await execFileAsync(pdfToPpmPath, ['-png', '-r', '180', completed.savedPath, outputPrefix], {timeout: 120000, windowsHide: true});
        pageFiles = fs.readdirSync(cacheDirectory).filter((name)=> /^page-\d+\.png$/i.test(name));
    }

    pageFiles.sort((left, right)=> Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
    return {
        documentInfo: completed.documentInfo,
        pages: pageFiles.map((fileName)=> `/make-invoice/print-image/${encodeURIComponent(safeDocumentId)}/${encodeURIComponent(type)}/${encodeURIComponent(fileName)}`),
    };
}

app.get('/make-invoice/print-image/:documentId/:type/:fileName', (req, res)=>
{
    const documentId = path.basename(req.params.documentId || '');
    const type = path.basename(req.params.type || '');
    const fileName = path.basename(req.params.fileName || '');
    const filePath = path.join(__dirname, 'invoiceWork', 'print-cache', documentId, type, fileName);
    if(!/^page-\d+\.png$/i.test(fileName) || !fs.existsSync(filePath)) return res.status(404).send('Print page not found');
    res.type('image/png').sendFile(filePath);
})

app.get('/make-invoice/print-page/:type', async (req, res)=>
{
    try
    {
    const type = req.params.type;
    const allowedTypes = ['invoice', 'packing-list', 'ucl-form', 'ucl-labels'];
    let orderNo = String(req.query.orderNo || '').trim();
    const totalCartons = String(req.query.totalCartons || '').trim();
    const documentId = String(req.query.documentId || '').trim();
    let pdfUrl = '';
    let printImages = [];

    if(documentId && allowedTypes.includes(type))
    {
        const rendered = await renderCompletedPdfForPrint(documentId, type);
        if(!rendered || !rendered.pages.length)
        {
            return res.status(404).send('Completed document was not found');
        }
        orderNo = String(rendered.documentInfo.orderNo || '');
        printImages = rendered.pages;
    }

    if(!allowedTypes.includes(type) || !orderNo)
    {
        return res.status(400).send('Order number and a valid print type are required');
    }

    if(!pdfUrl && !printImages.length)
    {
        if(!['invoice', 'packing-list'].includes(type)) return res.status(404).send('Completed UCL document was not found');
        pdfUrl = `/make-invoice/print/${encodeURIComponent(type)}?orderNo=${encodeURIComponent(orderNo)}&totalCartons=${encodeURIComponent(totalCartons)}`;
    }
    const titles = {
        invoice: 'Print Invoice',
        'packing-list': 'Print Packing List',
        'ucl-form': 'Print UCL Form',
        'ucl-labels': 'Print Labels',
    };
    const title = titles[type];
    const pageOrientation = type === 'ucl-labels' ? 'landscape' : 'portrait';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
        html, body { margin: 0; width: 100%; height: 100%; background: #f4f6fb; font-family: Arial, sans-serif; }
        .toolbar { display: flex; gap: 10px; align-items: center; padding: 10px 12px; background: #11235E; color: white; }
        .toolbar button { min-height: 38px; padding: 0 14px; border: 0; border-radius: 6px; background: white; color: #11235E; font-weight: 700; cursor: pointer; }
        .toolbar span { font-weight: 700; }
        iframe { display: block; width: 100%; height: calc(100% - 58px); border: 0; background: white; }
        .print-pages { width: min(100%, 900px); margin: 0 auto; background: white; }
        .print-page { display: block; width: 100%; height: auto; break-after: page; page-break-after: always; }
        .print-page:last-child { break-after: auto; page-break-after: auto; }
        @media print {
            @page { size: ${pageOrientation}; margin: 0; }
            html, body { height: auto; background: white; }
            .toolbar { display: none; }
            iframe { height: 100vh; }
            .print-pages { width: 100%; margin: 0; }
            .print-page { width: 100%; max-height: 100vh; object-fit: contain; }
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button type="button" onclick="window.print()">Print</button>
        <button type="button" onclick="window.close()">Close</button>
        <span>${title} ${orderNo}</span>
    </div>
    ${printImages.length
        ? `<main class="print-pages">${printImages.map((url, index)=> `<img class="print-page" src="${url}" alt="Page ${index + 1}">`).join('')}</main>`
        : `<iframe id="pdfFrame" src="${pdfUrl}"></iframe>`}
    <script>
        const frame = document.getElementById('pdfFrame');
        const images = Array.from(document.querySelectorAll('.print-page'));
        if (frame) frame.addEventListener('load', () => window.setTimeout(() => window.print(), 1200));
        if (images.length) {
            Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
                image.addEventListener('load', resolve, {once: true});
                image.addEventListener('error', resolve, {once: true});
            }))).then(() => window.setTimeout(() => window.print(), 300));
        }
    </script>
</body>
</html>`);
    }
    catch(error)
    {
        console.log(error);
        res.status(500).send('Could not prepare the document for printing');
    }
})

app.post('/make-invoice/save-print/:type', async (req, res)=>
{
    try
    {
        const type = req.params.type;
        const orderNo = String(req.body.orderNo || '').trim();
        const totalCartons = req.body.totalCartons ? Number(req.body.totalCartons) : null;

        if(!orderNo)
        {
            return res.status(400).json({
                error: true,
                message: 'Order number is required',
            })
        }

        const result = await printInvoiceDocument({
            orderNo,
            totalCartons,
            type,
        });
        const downloadsDir = path.join(os.homedir(), 'Downloads');

        if(!fs.existsSync(downloadsDir))
        {
            fs.mkdirSync(downloadsDir, {recursive: true});
        }

        const savedPath = uniqueFilePath(downloadsDir, result.fileName);
        fs.writeFileSync(savedPath, result.pdf);

        res.send({
            status: 'saved',
            fileName: path.basename(savedPath),
            savedPath,
        });
    }
    catch(error)
    {
        console.log(error);
        res.status(400).json({
            error: true,
            message: error.message || 'Could not save document',
        })
    }
})

app.post('/make-invoice/excel', async (req, res)=>
{
    try
    {
        const orderNo = String(req.body.orderNo || '').trim();

        if(!orderNo)
        {
            return res.status(400).json({
                error: true,
                message: 'Order number is required',
            })
        }

        const result = await buildInvoiceExcel({
            orderNo,
        });

        res.send({
            status: 'ready',
            fileName: result.fileName,
            downloadUrl: `/make-invoice/excel/${result.jobId}`,
            orderNo: result.orderNo,
            customerName: result.customerName,
            itemCount: result.itemCount,
            imageCount: result.imageCount,
            missingImageCount: result.missingImages.length,
            missingImages: result.missingImages.slice(0, 20),
        });
    }
    catch(error)
    {
        console.log(error);
        res.status(400).json({
            error: true,
            message: error.message || 'Could not build invoice Excel',
        })
    }
})

app.get('/make-invoice/excel/:jobId', async (req, res)=>
{
    const safeJobId = path.basename(req.params.jobId || '');
    const jobDir = path.join(__dirname, 'invoiceWork', safeJobId);

    if(!safeJobId || !safeJobId.startsWith('excel-') || !fs.existsSync(jobDir))
    {
        return res.status(404).json({
            error: true,
            message: 'Excel file not found',
        })
    }

    const excelFile = fs.readdirSync(jobDir)
        .find((fileName)=> fileName.toLowerCase().endsWith('.xlsx') && fileName !== 'raw_invoice.xlsx');

    if(!excelFile)
    {
        return res.status(404).json({
            error: true,
            message: 'Excel file not found',
        })
    }

    res.download(path.join(jobDir, excelFile), excelFile);
})

function uniqueFilePath(directory, fileName)
{
    const parsed = path.parse(fileName);
    let candidate = path.join(directory, fileName);
    let index = 2;

    while(fs.existsSync(candidate))
    {
        candidate = path.join(directory, `${parsed.name} (${index})${parsed.ext}`);
        index += 1;
    }

    return candidate;
}

function runCommand(command, args, options = {})
{
    return new Promise((resolve, reject)=> {
        const child = spawn(command, args, {
            cwd: options.cwd,
            windowsHide: true,
        });

        if(typeof options.onSpawn === 'function') options.onSpawn(child);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk)=> {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk)=> {
            stderr += chunk.toString();
        });

        child.on('error', reject);
        child.on('close', (code)=> {
            const output = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim();

            if(code !== 0)
            {
                const error = new Error(output || `${command} exited with code ${code}`);
                error.code = code;
                error.output = output;
                reject(error);
                return;
            }

            resolve({
                code,
                stdout,
                stderr,
                output,
            });
        });
    });
}

function sanitizeFileStem(value, fallback = 'purchase-order')
{
    const stem = String(value || fallback)
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return stem || fallback;
}

function formatPoForFileName(value)
{
    const text = String(value || '').trim();
    const match = text.match(/^P(\d.+)$/i);

    return match ? `P ${match[1]}` : text;
}

app.get('/quickbooks-network/status', async (req, res)=>
{
    res.set('Cache-Control', 'no-store');
    res.json(await quickBooksNetworkStatus());
});

app.post('/quickbooks-network/login', async (req, res)=>
{
    res.set('Cache-Control', 'no-store');
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if(!username || !password || /[\r\n]/.test(username))
    {
        return res.status(400).json({connected: false, message: 'Enter the Windows user name and password.'});
    }

    try
    {
        await execFileAsync('net.exe', ['use', quickBooksShare, password, `/user:${username}`, '/persistent:no'], {
            windowsHide: true,
            timeout: 15000,
        });
        const status = await quickBooksNetworkStatus();
        if(!status.connected) throw new Error('The share connected, but the QuickBooks company file is unavailable.');
        res.json(status);
    }
    catch(error)
    {
        // Do not return command output: Windows may include sensitive connection details.
        res.status(401).json({
            connected: false,
            message: 'Windows could not connect. Check the user name and password, and confirm the QuickBooks computer is on.',
        });
    }
});

app.get('/',async (req, res)=>
{
    const value = await ediExplorer.run('MEOWSICLES', 'CHEWEY', '1019382392');
    //console.log(value);
    res.send(value);
})


const server = app.listen(PORT,()=>{
    console.log(`listening on port ${PORT}`)
});

server.on('error', (error)=> {
    if(error && error.code === 'EADDRINUSE')
    {
        console.log(`Backend port ${PORT} is already in use. Leaving the existing server running.`);
        process.exit(0);
    }

    throw error;
});
