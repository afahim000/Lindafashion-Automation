const express = require('express')
const reader = require('./xlsxReader.js');
const app = express();
const cors = require('cors');
const multer = require('multer')

const upload = multer()
app.use(cors());
const PORT = 2000;



app.post('/',upload.array('upload'),async (req, res) =>
{

    const PO = req.file[0]
    const monitoringForm = req.file[1]
    const textInputs = req.body
    const response = await reader.run(PO, monitoringForm, textInputs);
    response.then((data)=>{
        res.send(data)
    });
   
})

app.listen(PORT,()=>{
    console.log("listening on port 2000")
});