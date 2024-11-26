import {useState} from 'react'

export default function PO(){
    const [response, setResponse] = useState([])
    const [agent,setAgent] = useState(null);
    const [filePath, setFilePath] = useState(null)
    const [noError, setNoError] = useState(true)
        async function handleSubmit(e)
    {
        e.preventDefault();
        const formData = new FormData(e.target);
        try{
        const response = await fetch("http://localhost:2000",
            {
                method: 'POST',
                body: formData
            })
            .then(async (answer) =>
            {
                const data = await answer.json();
                setResponse([data.POnumber, data.PoDate, data.deliveryDate, data.filePath, data.person, data.factory, data.phone])
                setFilePath(data.filePath);
                return ({person: data.person, factory: data.factory, phone: data.phone})
            })
            .then(async(data)=>
            {
                console.log(data.person)
                return await fetch("http://localhost:2000/edi",
                    {
                    method:'POST',
                    header:
                    {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                            person: data.person,
                            factory: data.factory,
                            phone: data.phone
                        })
                    }
                )
            })
            .then(async(data)=>
            {
                const answer = data.json();
                setAgent(answer.agentCode);
                
            })
            .then()
            {
                const result = await fetch('http://localhost:2000/file',
                    {
                        method: "GET",
                        body: filePath
                    }
                )

                if(result)
                    setNoError(true);

            }
        }
        catch(error){
            setNoError(false)
            console.log(error);
        }


            

 
                
           
    }
    return(
        <>
         {noError || (<h2 style = {{color: 'red'}}>SOMETHING WENT WRONG. YOU CAN REFRESH THE PAGE TO REMOVE THIS MESSAGE</h2>)}
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
                <br></br>
                <p>AGENT CODE{(<h1>awaiting info </h1>) || agent}</p>
            </div>
        </div>
        </>
    )
}