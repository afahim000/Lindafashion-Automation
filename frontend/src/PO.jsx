import {useState} from 'react'

const API_BASE = 'http://localhost:2000';

export default function PO(){
    const [csvFiles, setCsvFiles] = useState([]);
    const [currentFile, setCurrentFile] = useState('');
    const [status, setStatus] = useState('IDLE');
    const [error, setError] = useState('');
    const [isUploading, setIsUploading] = useState(false);

    async function loadCsvFiles()
    {
        setError('');
        setStatus('LOADING CSV FILES...');

        try
        {
            const response = await fetch(`${API_BASE}/csv-files`);

            if(!response.ok)
            {
                throw new Error('Could not load CSV files');
            }

            const files = await response.json();
            setCsvFiles(files);
            setStatus(`READY: ${files.length} CSV FILES`);
        }
        catch(error)
        {
            console.log(error);
            setError(error.message);
            setStatus('ERROR');
        }
    }

    async function uploadOneFile(file)
    {
        const jobId = `${Date.now()}-${file.poNumber}`;
        const progressTimer = window.setInterval(async ()=> {
            try
            {
                const progressResponse = await fetch(`${API_BASE}/upload-progress/${jobId}`);
                const progress = await progressResponse.json();

                setStatus(progress.message);
                setCsvFiles((files)=> files.map((item)=> item.fileName === file.fileName ? {
                    ...item,
                    uploadStep: progress.status,
                    progressMessage: progress.message,
                    agentCode: progress.agentCode || item.agentCode
                } : item));
            }
            catch(error)
            {
                console.log(error);
            }
        }, 1000);

        const response = await fetch(`${API_BASE}/upload-csv`,
            {
                method: 'POST',
                headers:
                {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({...file, jobId})
            }
        );

        try
        {
            if(!response.ok)
            {
                const errorBody = await response.json().catch(()=> ({}));
                throw new Error(errorBody.message || `Upload failed for ${file.fileName}`);
            }

            return response.json();
        }
        finally
        {
            window.clearInterval(progressTimer);
        }
    }

    async function startUploads()
    {
        const pendingFiles = csvFiles.filter((file)=> file.status !== 'done' && file.status !== 'flagged');

        if(pendingFiles.length === 0)
        {
            setStatus('DONE');
            return;
        }

        setError('');
        setIsUploading(true);

        for(const file of pendingFiles)
        {
            setCurrentFile(file.fileName);
            setStatus(`UPLOADING ${file.poNumber}`);
            setCsvFiles((files)=> files.map((item)=> item.fileName === file.fileName ? {...item, status: 'uploading', uploadStep: 'starting', progressMessage: 'Starting upload'} : item));

            try
            {
                const result = await uploadOneFile(file);
                setCsvFiles((files)=> files.map((item)=> item.fileName === file.fileName ? {
                    ...item,
                    ...result,
                    status: result.status,
                    uploadStep: result.status,
                    progressMessage: result.message || (result.status === 'flagged' ? `Flagged: ${result.redFlags.join(', ')}` : 'Finished')
                } : item));
            }
            catch(error)
            {
                console.log(error);
                setError(error.message);
                setStatus('ERROR');
                setCsvFiles((files)=> files.map((item)=> item.fileName === file.fileName ? {...item, status: 'failed', uploadStep: 'failed', progressMessage: error.message, error: error.message} : item));
                setIsUploading(false);
                return;
            }
        }

        setCurrentFile('');
        setStatus('DONE');
        setIsUploading(false);
    }

    const completedCount = csvFiles.filter((file)=> file.status === 'done').length;
    const flaggedCount = csvFiles.filter((file)=> file.status === 'flagged').length;

    return(
        <>
            {error && <h2 style={{color: 'red'}}>{error}</h2>}
            <div id="form-holder">
                <div style={{paddingTop: '9px'}}>
                    <p style={{fontSize : '30px'}}>CSV upload queue</p>
                    <button type="button" onClick={loadCsvFiles} disabled={isUploading}>Load CSV Files</button>
                    <button type="button" onClick={startUploads} disabled={isUploading || csvFiles.length === 0}>Start Upload</button>
                </div>

                <div>
                    <h1 style={{display: 'inline-block'}}>STATUS:&nbsp;</h1>
                    {status === 'IDLE' ? (<h1 style={{color: 'gray', display: 'inline-block'}}>IDLE</h1>) :
                    status === 'ERROR' ? (<h1 style={{color: 'red', display: 'inline-block'}}>ERROR</h1>) :
                    status === 'DONE' ? (<h1 style={{color: 'green', display: 'inline-block'}}>DONE</h1>) :
                    (<h1 style={{color: 'blue', display: 'inline-block'}}>{status}</h1>)}
                </div>

                <p style={{fontSize: '24px'}}>Completed: {completedCount} / {csvFiles.length}</p>
                <p style={{fontSize: '24px'}}>Flagged: {flaggedCount}</p>
                {currentFile && <p>Current file: {currentFile}</p>}

                <table style={{width: '100%', borderCollapse: 'collapse'}}>
                    <thead>
                        <tr>
                            <th style={{textAlign: 'left', borderBottom: '1px solid #ccc'}}>Status</th>
                            <th style={{textAlign: 'left', borderBottom: '1px solid #ccc'}}>PO</th>
                            <th style={{textAlign: 'left', borderBottom: '1px solid #ccc'}}>Vendor</th>
                            <th style={{textAlign: 'left', borderBottom: '1px solid #ccc'}}>EDI Vendor</th>
                            <th style={{textAlign: 'left', borderBottom: '1px solid #ccc'}}>PO Date</th>
                            <th style={{textAlign: 'left', borderBottom: '1px solid #ccc'}}>X Factor Date</th>
                            <th style={{textAlign: 'left', borderBottom: '1px solid #ccc'}}>Progress</th>
                            <th style={{textAlign: 'left', borderBottom: '1px solid #ccc'}}>Flags</th>
                            <th style={{textAlign: 'left', borderBottom: '1px solid #ccc'}}>File</th>
                        </tr>
                    </thead>
                    <tbody>
                        {csvFiles.map((file)=> (
                            <tr key={file.fileName}>
                                <td>{file.status}</td>
                                <td>{file.poNumber}</td>
                                <td>{file.vendor}</td>
                                <td>{file.ediVendor && file.ediVendor !== file.vendor ? file.ediVendor : ''}</td>
                                <td>{file.poDate}</td>
                                <td>{file.xFactorDate}</td>
                                <td>{file.progressMessage || file.uploadStep || ''}</td>
                                <td>{file.redFlags ? file.redFlags.join(', ') : ''}</td>
                                <td>{file.fileName}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    )
}
