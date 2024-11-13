import {useState} from 'react'

export default function PO(){
    const [singleFile, setSingleFile] = useState(true)
    async function handleSubmit(e)
    {
        e.preventDefault();
        const formData = new FormData(e.target);
        

        const response = await fetch("http://localhost:2000",
            {
                method: 'POST',
                body: formData
            }).catch(error => console.log(error)).then(data => console.log(data))
    }
    return(
        <>
        <div id ="form-holder">
            <form onSubmit = {handleSubmit} enctype="multipart/form-data" >
                <p style = {{fontSize : "30px", }}>Upload files below for automation</p>
                <label for = "rep">Representative</label>
                <input type = 'text' id = "rep" name = "rep"></input>
                <label for = "container">Container</label>
                <input type = 'text' id = "container" name = "container"></input>
                <label for = "description">Description</label>
                <input type = 'text' id = "description" name = "description"></input>
                <label for = "multiplier">Multiplier</label>
                <input type = 'number' id = "multiplier" name = "multiplier"></input>
                <label for = "category">Category</label>
                <input type = 'text' id = "category" name = "category"></input>
                <label for = "upload">upload XLSX file for PO Upload</label>
                <input type = "file" id = "upload" name = "upload" accept=".xlsx" ></input>
                <label for = "PO">Input file name</label>
                <input type = "text" id = "POmonitoring" name = "poMonitoring"></input>
                <button type="submit">Submit</button>

            </form>
            </div>
        </>
    )
}