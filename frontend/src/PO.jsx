import {useState} from 'react'

export default function PO(){
    const [response, setResponse] = useState([])
    const [agent,setAgent] = useState(null);
    const [filePath, setFilePath] = useState(null)
    const [noError, setNoError] = useState(true)
    const [status, setStatus] = useState("IDLE");
        async function handleSubmit(e)
    {   
        setStatus("PENDING DATA...")
        e.preventDefault();
        let formData = new FormData(e.target);
        try{
            //formData = await Munde(formData);
        const getFile = await fetch("http://localhost:2000",
            {
                method: 'POST',
                body: formData
            })
            .then(async (answer) =>
            {
                const data = await answer.json();
                console.log(data);
                setResponse([data.POnumber, data.poDate, data.deliveryDate, data.filePath, data.person, data.factory, data.phone])
                setFilePath(data.filePath);
                return ({person: data.person, factory: data.factory, phone: data.phone})
            })
            .then(async(data)=>
            {
                console.log(data.person)
                return await fetch("http://localhost:2000/edi",
                    {
                    method:'POST',
                    headers:
                    {
                        "Content-Type": "application/json"
                    },
                    body:   JSON.stringify({ person: data.person,
                            factory: data.factory,
                            phone: data.phone})

                    }
                )
            })
            .then(async(data)=>
            {
                const answer = await data.json();
                setAgent(answer.agentCode);
                return;
                
            })
            .then(async (data)=>{
                const result = await fetch('http://localhost:2000/file',
                    {
                        method: "POST",
                        headers:
                    {
                        "Content-Type": "application/json"
                    },
                        body: JSON.stringify({filePath})
                    }
                )

                if(result)
                    setNoError(true);

                return result;




            })

            if(getFile)
            {
                setStatus("DONE!")
                const blob = await getFile.blob();
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', 'UPLOAD_THIS_CSV_FILE_ONTO_EDI.csv');
                document.body.appendChild(link);
                link.click();
                link.remove();
            }
           
        }
        catch(error){
            setNoError(false)
            setStatus("ERROR")
            console.log(error);
        }


            

 
                
           
    }
    return(
        <>
         {noError || (<h2 style = {{color: 'red'}}>SOMETHING WENT WRONG. YOU CAN REFRESH THE PAGE TO REMOVE THIS MESSAGE</h2>)}
        <div id ="form-holder" >
            <form onSubmit = {handleSubmit} enctype="multipart/form-data" style = {{paddingTop: "9px"}}>
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
            <div >
                <div><h1 style = {{display: "inline-block"}}>STATUS:&nbsp;</h1>
                {status === "IDLE" ? (<h1 style = {{color: 'gray', display: "inline-block"}}>IDLE</h1>) :
                status === "ERROR" ? (<h1 style = {{color: 'red', display: "inline-block"}}>ERROR</h1>) :
                status === "DONE!" ? (<h1 style = {{color: 'green', display: "inline-block"}}>DONE!</h1>) :
                status === "PENDING..." ? (<h1 style = {{color: 'blue', display: "inline-block"}}>PENDING...</h1>) :
                (<h1>WELCOME TO THE LAND OF IMPOSSIBLE WHERE LOGIC NO LONGER APPLIES</h1>)}</div>
                
                <br></br>
                <p style ={{fontSize: "30px"}}>Response Info:</p>
                <br></br>
                <p>PO NUMBER:{ response[0] ? (<h1>{response[0]}</h1>) : false || (<h1>awaiting info </h1>)}</p>
                <br></br>
                <p>PO DATE:{response[1] ? (<h1>{response[1]}</h1>) : false || (<h1>awaiting info </h1>)}</p>
                <br></br>
                <p>DELIVERY DATE:{response[2] ? (<h1>{response[2]}</h1>) : false || (<h1>awaiting info </h1>)}</p>
                <br></br>
                <p>AGENT CODE:{agent ? (<h1>{agent}</h1>) : false || (<h1>awaiting info </h1>)}</p>
            </div>
        </div>
        </>
    )
}

export const Munde = async (formData) =>
{
    const response1 = await fetch("frontend\public\copy of copy of copy of 24272 B2-3619 温岭饰品  KHC.xlsx");
    const fileBlob = await response1.blob();
    const file = new File([fileBlob], "sample.txt", { type: fileBlob.type });
    formData.append("upload", file);


    const response2 = await fetch("frontend\public\LF PO MONITORING 11.25.24.xlsx");
    const fileBlob2 = await response2.blob();
    const file2 = new File([fileBlob2], "sample.txt", { type: fileBlob2.type });
    formData.append("upload", file2);

    return formData;
}