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
    const PO = req.files[0]
    const monitoringForm = req.files[1]
    const textInputs = req.body
    
    const xlsxResponse = await reader.run(PO, monitoringForm, textInputs);
    const ediResponse = await ediExplorer.run(xlsxResponse.person, xlsxResponse.factory, xlsxResponse,phone)

    res.download()
    //{POnumber: POnumber, purchaseOrderDate: poDate,deliveryDate: deliveryDate, person: value, factory: factory, phone: phone, attachedFile: writeBuffer}
    //{response: response, cookie: data.cookie, agentCode: upperCaseName,}
    //const finale = await finalUpload.run(ediResponse.cookie, xlsxResponse.attachedFile, xlsxResponse.POnumber, xlsxResponse.POdate, xlsxResponse.deliveryDate, ediResponse.agentCode)
    res.send({POnumber: xlsxResponse.POnumber, poDate: xlsxResponse.poDate, deliveryDate: xlsxResponse.deliveryDate, person: xlsxResponse.person});

    
}
   
)

app.post('/File',async (req, res)=>
{
    const response = await ediExplorer.run(req.body);
    
})

app.get('/',async()=>
    {
        try{
        const value = fs.readFileSync('./ediUpload/24326 Le Yuyan.csv')
        //cookie, file, POnumber, poDate, deliveryDate
        finalUpload.run('2ohmq5auug90p52d3scvpf7n23', value , '24299', '11/27/2024', '11/27/2024', '11/26/2024', 'D2-4911');
        }catch(error)
        {
            console.log(error)
        }
    })
app.listen(PORT,()=>{
    console.log("listening on port 2000")
});