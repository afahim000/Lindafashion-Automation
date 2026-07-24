import {Fragment, useState} from 'react'

const API_BASE = 'http://localhost:2000';

export default function PO(){
    const [csvFiles, setCsvFiles] = useState([]);
    const [currentFile, setCurrentFile] = useState('');
    const [status, setStatus] = useState('IDLE');
    const [error, setError] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [excelFiles, setExcelFiles] = useState([]);
    const [isCreatingCsv, setIsCreatingCsv] = useState(false);
    const [, setConversionResults] = useState(null);

    function addExcelFiles(files)
    {
        const allowedExtensions = ['.xls', '.xlsx'];
        const nextFiles = Array.from(files || [])
            .filter((file)=> allowedExtensions.some((extension)=> file.name.toLowerCase().endsWith(extension)));

        setExcelFiles((currentFiles)=> {
            const seen = new Set(currentFiles.map((file)=> `${file.name}-${file.size}-${file.lastModified}`));
            const uniqueNewFiles = nextFiles.filter((file)=> {
                const key = `${file.name}-${file.size}-${file.lastModified}`;

                if(seen.has(key))
                {
                    return false;
                }

                seen.add(key);
                return true;
            });

            return [...currentFiles, ...uniqueNewFiles];
        });
    }

    async function createCsvFiles()
    {
        if(excelFiles.length === 0)
        {
            return;
        }

        setError('');
        setIsCreatingCsv(true);
        setStatus('CREATING CSV FILES...');

        try
        {
            const formData = new FormData();

            for(const file of excelFiles)
            {
                formData.append('excelFiles', file);
            }

            const response = await fetch(`${API_BASE}/api/create-edi-csv`, {
                method: 'POST',
                body: formData
            });
            const result = await response.json();

            if(!response.ok)
            {
                throw new Error(result.message || 'The Excel files could not be converted.');
            }

            setConversionResults(result);
            setStatus(`CSV CREATED: ${result.successful} SUCCESS, ${result.failed} FAILED`);
            await loadCsvFiles();
        }
        catch(error)
        {
            console.log(error);
            setError(error.message);
            setStatus('ERROR');
        }
        finally
        {
            setIsCreatingCsv(false);
        }
    }

    async function clearCsvFiles()
    {
        setError('');
        setStatus('CLEARING CSV FILES...');

        try
        {
            const response = await fetch(`${API_BASE}/csv-files`, {
                method: 'DELETE'
            });
            const result = await response.json();

            if(!response.ok)
            {
                throw new Error(result.message || 'Could not clear CSV files');
            }

            setExcelFiles([]);
            setCsvFiles([]);
            setConversionResults(null);
            setCurrentFile('');
            setStatus(`CLEARED ${result.deletedCount} CSV FILES`);
        }
        catch(error)
        {
            console.log(error);
            setError(error.message);
            setStatus('ERROR');
        }
    }

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
                    progressMessage: result.message || (result.status === 'flagged' ? 'Flagged: review EDI HTML rows' : 'Finished')
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

    function getFlagRowHtmlList(file)
    {
        if(!file.redFlagDetails)
        {
            return [];
        }

        return Array.from(new Set(file.redFlagDetails.map((flag)=> flag.rowHtml).filter(Boolean)));
    }

    return(
        <>
            {error && <h2 style={{color: 'red'}}>{error}</h2>}
            <div id="form-holder" className="po-page">
                <div className="po-steps">
                    <section className="po-step-card">
                    <p className="po-step-title">Step 1: Excel to CSV</p>
                    <div className="po-actions">
                    <label htmlFor="excelFiles" className="po-file-label" style={{cursor: isCreatingCsv || isUploading ? 'not-allowed' : 'pointer'}}>
                        Add Excel Files
                    </label>
                    <input
                        type="file"
                        id="excelFiles"
                        accept=".xls,.xlsx"
                        multiple
                        onChange={(event)=> addExcelFiles(event.target.files)}
                        disabled={isCreatingCsv || isUploading}
                        style={{display: 'none'}}
                    />
                    <button type="button" onClick={clearCsvFiles} disabled={isCreatingCsv || isUploading}>Clear List</button>
                    <button type="button" onClick={createCsvFiles} disabled={isCreatingCsv || excelFiles.length === 0}>Create CSV</button>
                    </div>

                    <div
                        onDragOver={(event)=> event.preventDefault()}
                        onDrop={(event)=> {
                            event.preventDefault();
                            addExcelFiles(event.dataTransfer.files);
                        }}
                        className="po-drop-zone"
                    >
                        Drop .xls or .xlsx files here
                    </div>

                    {excelFiles.length > 0 && <p className="po-muted">{excelFiles.length} Excel files selected</p>}
                    </section>

                    <section className="po-step-card">
                    <p className="po-step-title">Step 2: CSV Upload Queue</p>
                    <div className="po-actions">
                    <button type="button" onClick={loadCsvFiles} disabled={isUploading}>Load CSV Files</button>
                    <button type="button" onClick={startUploads} disabled={isUploading || csvFiles.length === 0}>Start Upload</button>
                    </div>
                    <div className="po-summary">
                        <span>{csvFiles.length} CSV files loaded</span>
                        <span>{completedCount} completed</span>
                        <span>{flaggedCount} flagged</span>
                    </div>
                    </section>
                </div>

                <div className="po-status-line">
                    <strong>STATUS:</strong>
                    {status === 'IDLE' ? (<span className="po-status-idle">IDLE</span>) :
                    status === 'ERROR' ? (<span className="po-status-error">ERROR</span>) :
                    status === 'DONE' ? (<span className="po-status-done">DONE</span>) :
                    (<span className="po-status-active">{status}</span>)}
                    {currentFile && <span>Current file: {currentFile}</span>}
                </div>

                <table className="po-upload-table">
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
                        {csvFiles.map((file)=> {
                            const flagRows = getFlagRowHtmlList(file);

                            return(
                            <Fragment key={file.fileName}>
                            <tr>
                                <td>{file.status}</td>
                                <td>{file.poNumber}</td>
                                <td>{file.vendor}</td>
                                <td>{file.ediVendor && file.ediVendor !== file.vendor ? file.ediVendor : ''}</td>
                                <td>{file.poDate}</td>
                                <td>{file.xFactorDate}</td>
                                <td>{file.progressMessage || file.uploadStep || ''}</td>
                                <td>
                                    {flagRows.length > 0 ? 'Review flagged table below' : (file.redFlags ? file.redFlags.join(', ') : '')}
                                </td>
                                <td>{file.fileName}</td>
                            </tr>
                            {flagRows.length > 0 && (
                                <tr className="po-flag-row">
                                    <td colSpan="9">
                                        <div className="edi-flag-preview">
                                            <h2>{file.poNumber}</h2>
                                            <div className="edi-flag-legend">
                                                <span>LEGENDS</span>
                                                <strong>RED COLOR UNDER:: PO# = PO Already Exists, VENDOR = FACTORY NOT SETUP, ITEM = EITHER ITEM NOT SETUP OR NOT IN PO</strong>
                                            </div>
                                            <div className="edi-flag-table-wrap">
                                                <table className="edi-flag-table">
                                                    <thead>
                                                        <tr>
                                                            <th>#</th>
                                                            <th>PO #</th>
                                                            <th>PDATE</th>
                                                            <th>VEND</th>
                                                            <th>ITEM#</th>
                                                            <th>PO.QTY</th>
                                                            <th>UNIT</th>
                                                            <th>FOB</th>
                                                            <th>EXT</th>
                                                            <th>X-FACT</th>
                                                            <th>ETA</th>
                                                            <th>SLM</th>
                                                            <th>TYP</th>
                                                            <th>WH</th>
                                                            <th></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody dangerouslySetInnerHTML={{__html: flagRows.join('')}} />
                                                </table>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )}
                            </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </>
    )
}
