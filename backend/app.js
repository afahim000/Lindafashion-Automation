const express = require('express')
const reader = require('./xlsxReader.js');
const app = express();
const cors = require('cors');
const multer = require('multer')
const ediExplorer = require('./ediExplorer.js')
const finalUpload = require('./finalUpload.js')
const fs = require('fs')
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
    res.send({POnumber: xlsxResponse.POnumber, poDate: xlsxResponse.poDate, deliveryDate: xlsxResponse.deliveryDate,filePath: xlsxResponse.filePath, person: xlsxResponse.person, factory: xlsxResponse.factory, phone: xlsxResponse.phone});
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
    console.log(req.params)
    try
    {
        const response = await ediExplorer.run(req.body.person, req.body.factory. req.body.phone);
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

app.get('/file',(req, res)=>{
    console.log(req.body);
    res.download(req.body, (err)=>
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


app.listen(PORT,()=>{
    console.log("listening on port 2000")
});