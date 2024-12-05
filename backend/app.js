const express = require('express')
const reader = require('./xlsxReader.js');
const app = express();
const cors = require('cors');
const multer = require('multer')
const ediExplorer = require('./ediExplorer.js')
const finalUpload = require('./finalUpload.js')
const fs = require('fs')
app.use(express.json())
app.use(express.urlencoded({ extended: true }));
const upload = multer()
app.use(cors());
const PORT = 2000;



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

app.post('/file',(req, res)=>{
    console.log(req.body);
    const filePath = req.body.filePath;
    const path = filePath.replace(/\\/g, '/')
    const fileName = path.split('/')
    res.download(`./ediUpload/${fileName[fileName.length -1]}`, (err)=>
    {
        if (err) {
            console.error('Error during download:', err);
            res.status(500).json({
                error: true,
                message: 'Something went wrong',

            })
        }
    })
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