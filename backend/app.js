const express = require('express')
const reader = require('./xlsxReader.js');
const app = express();
const cors = require('cors');
const multer = require('multer')

const upload = multer()
app.use(cors());
const PORT = 2000;



app.post('/',upload.single('upload'),async (req, res) =>
{

    const PO = req.file
    const textInputs = req.body
    await reader.run(PO, textInputs);
   
})

app.listen(PORT,()=>{
    console.log("listening on port 2000")
});