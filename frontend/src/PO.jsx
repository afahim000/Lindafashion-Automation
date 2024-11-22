import {useState} from 'react'

export default function PO(){
    const [response, setResponse] = useState([])
    async function handleSubmit(e)
    {
        e.preventDefault();
        const formData = new FormData(e.target);

        const response = await fetch("http://localhost:2000",
            {
                method: 'POST',
                body: formData
            }).then(async (response)=>
            {
                await response.json();
                setResponse([response.POnumber, response.PoDate, response.deliveryDate])
                return response.person;
            })

            const value = await fetch("http://localhost:2000/File",
                {
                    method: 'POST',
                    body: response
                }
            )
            

 
                
           
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
                <input type = 'text' inputmode = "decimal" id = "multiplier" name = "multiplier"></input>
                <label for = "category">Category</label>
                <input type = 'text' id = "category" name = "category"></input>
                <label for = "upload">upload the *PURCHASE ORDER* here</label>
                <input type = "file" id = "upload" name = "upload" accept=".xlsx" ></input>
                <label for = "upload">upload the *MONITORING FORM* here</label>
                <input type = "file" id = "upload" name = "upload" accept=".xlsx"></input>
                <button type="submit">Submit</button>

            </form>
            <div>
                <br></br>
                <p style ={{fontSize: "30px"}}>Response Info</p>
                <br></br>
                <p>PO NUMBER: {(<h1>awaiting info </h1>) || response[0]}</p>
                <br></br>
                <p>PO DATE{(<h1>awaiting info </h1>) ||response[1]}</p>
                <br></br>
                <p>DELIVERY DATE{(<h1>awaiting info </h1>) || response[2]}</p>
            </div>
        </div>
        </>
    )
}