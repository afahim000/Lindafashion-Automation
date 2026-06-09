const express = require('express')
const reader = require('./xlsxReader.js');
const app = express();
const cors = require('cors');
const multer = require('multer')
const ediExplorer = require('./ediExplorer.js')
const finalUpload = require('./finalUpload.js')
const fs = require('fs')
const path = require('path')
app.use(express.json())
app.use(express.urlencoded({ extended: true }));
const upload = multer()
app.use(cors());
const PORT = 2000;
const ediUploadDirectory = path.join(__dirname, 'ediUpload');
const uploadProgress = {};
const excludedPoNumbers = new Set(['S00178']);
const poVendorOverrides = {
    '26007': 'Zhang',
    '26013': 'Zhang',
    '26017': 'Zhang',
    '26018': 'Zhang',
    '26026': 'Zhang',
    '26075': 'Zhang',
    'A0038': 'Zhang',
    'A0049': 'Zhang',
    'S00177': 'Zhang',
    '26027': 'Wang Xinjua',
    '26076': 'Wang Xinjua',
    '26077': 'Wang Xinjua',
    '26046': 'Chen Shaojua',
    '26050': 'Zhang Ziaofe',
    'A0024': 'Huang Taoyin',
    'A0044': 'Huang Taoyin',
    'A0046': 'Huang Taoyin',
    'A0053': 'Huang Taoyin',
    'A00168': 'Huang Taoyin',
};
let ediSessionCookie = null;
let ediSessionStartedAt = null;

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

app.get('/upload-progress/:jobId',(req, res)=>
{
    res.send(uploadProgress[req.params.jobId] || {
        jobId: req.params.jobId,
        status: 'pending',
        message: 'Waiting for upload to start',
    });
})

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
            const redFlagMessage = `Flagged PO ${parsedFileInfo.poNumber}: ${uploadResponse.redFlags.join(', ')}`;

            setUploadProgress(jobId, {
                status: 'flagged',
                message: redFlagMessage,
                fileName: parsedFileInfo.fileName,
                poNumber: parsedFileInfo.poNumber,
                vendor: parsedFileInfo.vendor,
                ediVendor: parsedFileInfo.ediVendor,
                agentCode: ediResponse.agentCode,
                redFlags: uploadResponse.redFlags,
            });

            return res.send({
                ...parsedFileInfo,
                status: 'flagged',
                agentCode: ediResponse.agentCode,
                uploadStatus: uploadResponse.status,
                redFlags: uploadResponse.redFlags,
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

app.get('/',async (req, res)=>
{
    const value = await ediExplorer.run('MEOWSICLES', 'CHEWEY', '1019382392');
    //console.log(value);
    res.send(value);
})


app.listen(PORT,()=>{
    console.log("listening on port 2000")
});
