import {useEffect, useRef, useState} from 'react'

const API_BASE = `${window.location.protocol}//${window.location.hostname}:2000`;
const COMPLETED_STORAGE_KEY = 'lindaFashionCompletedInvoices';
const ZIP_STORAGE_KEY = 'lindaFashionPreparedZips';

export default function MakeInvoice()
{
    const [orderNo, setOrderNo] = useState('');
    const [totalCartons, setTotalCartons] = useState('');
    const [shippingCost, setShippingCost] = useState('');
    const [pickTicketImages, setPickTicketImages] = useState([]);
    const [previewUrls, setPreviewUrls] = useState([]);
    const [prepareStatus, setPrepareStatus] = useState('IDLE');
    const [submitStatus, setSubmitStatus] = useState('IDLE');
    const [error, setError] = useState('');
    const [packageInfo, setPackageInfo] = useState(null);
    const [latestPackage, setLatestPackage] = useState(null);
    const [chatGptJson, setChatGptJson] = useState('');
    const [jsonFiles, setJsonFiles] = useState([]);
    const [jsonBatchStatus, setJsonBatchStatus] = useState([]);
    const [submitResult, setSubmitResult] = useState(null);
    const [saveStatus, setSaveStatus] = useState('');
    const [savedFiles, setSavedFiles] = useState([]);
    const [excelStatus, setExcelStatus] = useState('');
    const [excelPackage, setExcelPackage] = useState(null);
    const [uclFormStatus, setUclFormStatus] = useState({});
    const [labelStatus, setLabelStatus] = useState({});
    const [deletingDocuments, setDeletingDocuments] = useState({});
    const [shippingMethods, setShippingMethods] = useState({});
    const deletedDocumentIds = useRef(new Set());
    const [zipPackages, setZipPackages] = useState(()=> {
        try
        {
            return JSON.parse(window.localStorage.getItem(ZIP_STORAGE_KEY) || '[]');
        }
        catch(error)
        {
            console.log(error);
            return [];
        }
    });
    const [zipSectionExpanded, setZipSectionExpanded] = useState(false);
    const [completedDocuments, setCompletedDocuments] = useState(()=> {
        try
        {
            return JSON.parse(window.localStorage.getItem(COMPLETED_STORAGE_KEY) || '[]');
        }
        catch(error)
        {
            console.log(error);
            return [];
        }
    });

    useEffect(()=> {
        if(pickTicketImages.length === 0)
        {
            setPreviewUrls([]);
            return;
        }

        const objectUrls = pickTicketImages.map((photo)=> URL.createObjectURL(photo));
        setPreviewUrls(objectUrls);

        return ()=> objectUrls.forEach((objectUrl)=> URL.revokeObjectURL(objectUrl));
    }, [pickTicketImages]);

    useEffect(()=> {
        let cancelled = false;

        async function loadLatestPackage()
        {
            try
            {
                const response = await fetch(`${API_BASE}/make-invoice/latest`);
                const result = await response.json();

                if(!cancelled && result.status === 'prepared')
                {
                    setLatestPackage(result);
                    addZipPackage(result);
                    setOrderNo((current)=> current || result.orderNo || '');
                    setTotalCartons((current)=> current || String(result.totalCartons || ''));
                    setShippingCost((current)=> current || String(result.shippingCost || ''));
                }
            }
            catch(error)
            {
                console.log(error);
            }
        }

        loadLatestPackage();
        const timer = window.setInterval(loadLatestPackage, 5000);

        return ()=> {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);

    useEffect(()=> {
        window.localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(completedDocuments.slice(0, 30)));
    }, [completedDocuments]);

    useEffect(()=> {
        let cancelled = false;

        async function syncCompletedDocuments()
        {
            try
            {
                const response = await fetch(`${API_BASE}/make-invoice/completed`);
                const result = await response.json();

                if(!cancelled && response.ok && Array.isArray(result.documents))
                {
                    mergeCompletedDocuments(result.documents);
                }
            }
            catch(error)
            {
                console.log(error);
            }
        }

        syncCompletedDocuments();
        const timer = window.setInterval(syncCompletedDocuments, 5000);

        return ()=> {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);

    useEffect(()=> {
        window.localStorage.setItem(ZIP_STORAGE_KEY, JSON.stringify(zipPackages.slice(0, 30)));
    }, [zipPackages]);

    function handleImageChange(event)
    {
        setError('');
        const selectedPhotos = [...event.target.files].slice(0, 20);
        setPickTicketImages(selectedPhotos);

        if(event.target.files.length > 20)
        {
            setError('Only the first 20 photos will be uploaded');
        }
    }

    async function preparePackage(event)
    {
        event.preventDefault();

        if(!orderNo || !totalCartons || pickTicketImages.length === 0)
        {
            setError('Order number, total cartons, and at least one image are required');
            return;
        }

        setError('');
        setPackageInfo(null);
        setPrepareStatus('PREPARING');

        const formData = new FormData();
        formData.append('orderNo', orderNo);
        formData.append('totalCartons', totalCartons);
        formData.append('shippingCost', shippingCost);
        pickTicketImages.forEach((photo)=> {
            formData.append('pickTicketImages', photo);
        });

        try
        {
            const controller = new AbortController();
            const timeout = window.setTimeout(()=> controller.abort(), 130000);
            const response = await fetch(`${API_BASE}/make-invoice/prepare`, {
                method: 'POST',
                body: formData,
                signal: controller.signal,
            });
            window.clearTimeout(timeout);

            if(!response.ok)
            {
                const errorBody = await response.json().catch(()=> ({}));
                throw new Error(errorBody.message || 'Could not prepare package');
            }

            const result = await response.json();
            setPackageInfo(result);
            setLatestPackage(result);
            addZipPackage(result);
            setOrderNo(result.orderNo || orderNo);
            setTotalCartons(String(result.totalCartons || totalCartons));
            setShippingCost(String(result.shippingCost || '0.00'));
            setPrepareStatus('READY');
        }
        catch(error)
        {
            console.log(error);
            setError(error.name === 'AbortError' ? 'Prepare timed out after 130 seconds' : error.message);
            setPrepareStatus('ERROR');
        }
    }

    async function submitAndGenerate()
    {
        await submitJsonRequest(true);
    }

    function handleJsonFileChange(event)
    {
        setError('');
        const selectedFiles = [...event.target.files].filter((file)=> file.name.toLowerCase().endsWith('.json'));

        if(selectedFiles.length !== event.target.files.length)
        {
            setError('Only JSON files can be attached');
        }

        setJsonFiles((current)=> {
            const filesByIdentity = new Map(current.map((file)=> [`${file.name}:${file.size}:${file.lastModified}`, file]));
            selectedFiles.forEach((file)=> filesByIdentity.set(`${file.name}:${file.size}:${file.lastModified}`, file));
            return [...filesByIdentity.values()];
        });
        event.target.value = '';
    }

    function removeJsonFile(fileToRemove)
    {
        setJsonFiles((current)=> current.filter((file)=> file !== fileToRemove));
        setJsonBatchStatus([]);
    }

    async function submitAttachedJsonFiles()
    {
        if(jsonFiles.length === 0)
        {
            setError('Attach at least one JSON file');
            return;
        }

        setError('');
        setJsonBatchStatus(jsonFiles.map((file)=> ({name: file.name, status: 'WAITING'})));
        setSubmitStatus('GENERATING');

        for(let index = 0; index < jsonFiles.length; index += 1)
        {
            const file = jsonFiles[index];
            setJsonBatchStatus((current)=> current.map((item, itemIndex)=> (
                itemIndex === index ? {...item, status: 'READING'} : item
            )));

            try
            {
                const jsonText = await file.text();
                JSON.parse(jsonText);
                setJsonBatchStatus((current)=> current.map((item, itemIndex)=> (
                    itemIndex === index ? {...item, status: 'UPLOADING'} : item
                )));
                await submitJsonRequest(true, jsonText, {manageStatus: false});
                setJsonBatchStatus((current)=> current.map((item, itemIndex)=> (
                    itemIndex === index ? {...item, status: 'DONE'} : item
                )));
            }
            catch(error)
            {
                console.log(error);
                setJsonBatchStatus((current)=> current.map((item, itemIndex)=> (
                    itemIndex === index ? {...item, status: 'ERROR', message: error.message} : item
                )));
            }
        }

        setSubmitStatus('DONE');
    }

    async function submitJsonRequest(generateDocuments, jsonText = chatGptJson, options = {})
    {

        if(!jsonText.trim())
        {
            setError('ChatGPT JSON is required');
            return;
        }

        let parsedJson = null;

        try
        {
            parsedJson = JSON.parse(jsonText);
        }
        catch(error)
        {
            setError(`Could not parse ChatGPT JSON: ${error.message}`);
            return;
        }

        const jsonOrderNo = parsedJson.requestFields?.ft_ord_no || parsedJson.orderNo || '';
        const jsonTotalCartons = parsedJson.requestFields?.sel_ctns || parsedJson.totalCartons || '';
        const jsonShippingCost = parsedJson.requestFields?.sel_freight_amt ?? '0.00';
        const submitOrderNo = jsonOrderNo;
        const submitTotalCartons = jsonTotalCartons;

        if(!submitOrderNo || !submitTotalCartons)
        {
            const message = 'Order number and total cartons must be present in the JSON';
            if(options.manageStatus === false)
            {
                throw new Error(message);
            }
            setError(message);
            return;
        }

        setError('');
        setSubmitResult(null);
        setSavedFiles([]);
        setSaveStatus('');
        setExcelPackage(null);
        setExcelStatus('');
        if(options.manageStatus !== false)
        {
            setSubmitStatus(generateDocuments ? 'GENERATING' : 'SUBMITTING');
        }
        setOrderNo(String(submitOrderNo));
        setTotalCartons(String(submitTotalCartons));
        setShippingCost(String(jsonShippingCost));

        try
        {
            const controller = new AbortController();
            const timeout = generateDocuments ? window.setTimeout(()=> controller.abort(), 610000) : null;
            let response;

            try
            {
                response = await fetch(`${API_BASE}${generateDocuments ? '/make-invoice/submit-generate' : '/make-invoice/submit'}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        orderNo: String(submitOrderNo),
                        totalCartons: String(submitTotalCartons),
                        shippingCost: String(jsonShippingCost || '0.00'),
                        chatGptJson: jsonText,
                    }),
                    signal: controller.signal,
                });
            }
            finally
            {
                if(timeout)
                {
                    window.clearTimeout(timeout);
                }
            }

            const result = await response.json().catch(()=> ({}));

            if(!response.ok)
            {
                throw new Error(result.message || (generateDocuments ? 'Could not submit and generate documents' : 'Could not submit invoice JSON'));
            }

            setSubmitResult(generateDocuments ? result.submit : result);

            if(generateDocuments)
            {
                const resultSavedFiles = result.savedFiles || [];
                const resultExcel = result.excel || null;

                setSavedFiles(resultSavedFiles);
                setSaveStatus('Saved');
                setExcelPackage(resultExcel);
                setExcelStatus(resultExcel ? 'Ready' : '');
                addCompletedDocument({
                    completedJobId: result.completedJobId,
                    orderNo: String(submitOrderNo),
                    totalCartons: String(submitTotalCartons),
                    savedFiles: resultSavedFiles,
                    excel: resultExcel,
                    submit: result.submit,
                    completedAt: new Date().toISOString(),
                });
            }

            if(options.manageStatus !== false)
            {
                setSubmitStatus('DONE');
            }

            return result;
        }
        catch(error)
        {
            console.log(error);
            const message = error.name === 'AbortError' ? 'Submit and generate timed out after 10 minutes' : error.message;
            if(options.manageStatus !== false)
            {
                setError(message);
                setSubmitStatus('ERROR');
                return null;
            }
            throw new Error(message);
        }
    }

    function addZipPackage(packageResult)
    {
        if(!packageResult?.downloadUrl || !packageResult?.fileName)
        {
            return;
        }

        setZipPackages((current)=> {
            const packageId = packageResult.jobId || packageResult.downloadUrl;
            const withoutDuplicate = current.filter((item)=> item.id !== packageId && item.downloadUrl !== packageResult.downloadUrl);

            return [
                {
                    id: packageId,
                    fileName: packageResult.fileName,
                    downloadUrl: packageResult.downloadUrl,
                    orderNo: packageResult.orderNo,
                    totalCartons: packageResult.totalCartons,
                    rowCount: packageResult.rowCount,
                    weightFieldCount: packageResult.weightFieldCount,
                    preparedAt: packageResult.preparedAt || new Date().toISOString(),
                },
                ...withoutDuplicate,
            ].slice(0, 30);
        });
    }

    function addCompletedDocument(documentInfo)
    {
        const invoiceFile = documentInfo.savedFiles.find((file)=> file.type === 'invoice');
        const packingFile = documentInfo.savedFiles.find((file)=> file.type === 'packing-list');
        const displayName = documentInfo.excel?.customerName ||
            invoiceFile?.fileName?.replace(/\.pdf$/i, '') ||
            `Order ${documentInfo.orderNo}`;

        setCompletedDocuments((current)=> [
            {
                id: documentInfo.completedJobId || `${documentInfo.orderNo}-${Date.now()}`,
                name: displayName,
                orderNo: documentInfo.orderNo,
                totalCartons: documentInfo.totalCartons,
                invoice: invoiceFile || null,
                packingList: packingFile || null,
                excel: documentInfo.excel,
                submit: documentInfo.submit,
                completedAt: documentInfo.completedAt,
            },
            ...current,
        ].slice(0, 30));
    }

    function mergeCompletedDocuments(serverDocuments)
    {
        setCompletedDocuments((current)=> {
            const visibleServerDocuments = serverDocuments.filter((document)=> !deletedDocumentIds.current.has(document.id));
            const merged = [...visibleServerDocuments];
            const serverIds = new Set(visibleServerDocuments.map((document)=> document.id));
            const serverInvoiceUrls = new Set(visibleServerDocuments.map((document)=> document.invoice?.downloadUrl).filter(Boolean));

            current.forEach((document)=> {
                if(!deletedDocumentIds.current.has(document.id) && !serverIds.has(document.id) && !serverInvoiceUrls.has(document.invoice?.downloadUrl))
                {
                    merged.push(document);
                }
            });

            return merged
                .sort((a, b)=> new Date(b.completedAt || 0) - new Date(a.completedAt || 0))
                .slice(0, 30);
        });
    }

    async function savePrintDocument(type)
    {
        setError('');
        setSaveStatus(`Saving ${type === 'invoice' ? 'invoice' : 'packing list'}...`);

        try
        {
            const controller = new AbortController();
            const timeout = window.setTimeout(()=> controller.abort(), 130000);
            const response = await fetch(`${API_BASE}/make-invoice/save-print/${type}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    orderNo,
                    totalCartons,
                }),
                signal: controller.signal,
            });
            window.clearTimeout(timeout);
            const result = await response.json().catch(()=> ({}));

            if(!response.ok)
            {
                throw new Error(result.message || 'Could not save document');
            }

            setSavedFiles([result]);
            setSaveStatus('Saved');
        }
        catch(error)
        {
            console.log(error);
            setError(error.name === 'AbortError' ? 'Save timed out after 130 seconds' : error.message);
            setSaveStatus('ERROR');
        }
    }

    function clearCompletedDocuments()
    {
        setCompletedDocuments([]);
    }

    function clearZipPackages()
    {
        setZipPackages([]);
    }

    async function deleteCompletedDocument(documentInfo)
    {
        const confirmed = window.confirm(`Delete order ${documentInfo.orderNo || documentInfo.name} from this list?`);
        if(!confirmed) return;

        setError('');
        deletedDocumentIds.current.add(documentInfo.id);
        setCompletedDocuments((current)=> current.filter((document)=> document.id !== documentInfo.id));
        setDeletingDocuments((current)=> ({...current, [documentInfo.id]: true}));
        try
        {
            const response = await fetch(`${API_BASE}/make-invoice/completed/${encodeURIComponent(documentInfo.id)}`, {
                method: 'DELETE',
            });
            const result = await response.json().catch(()=> ({}));
            if(!response.ok) throw new Error(result.message || 'Could not delete order');

            setShippingMethods((current)=> {
                const updated = {...current};
                delete updated[documentInfo.id];
                return updated;
            });
        }
        catch(error)
        {
            console.log(error);
            deletedDocumentIds.current.delete(documentInfo.id);
            setCompletedDocuments((current)=> [documentInfo, ...current.filter((document)=> document.id !== documentInfo.id)]);
            setError(error.message);
        }
        finally
        {
            setDeletingDocuments((current)=> {
                const updated = {...current};
                delete updated[documentInfo.id];
                return updated;
            });
        }
    }

    async function createUclForm(documentInfo)
    {
        setError('');
        setUclFormStatus((current)=> ({...current, [documentInfo.id]: 'CREATING'}));
        try
        {
            const response = await fetch(`${API_BASE}/make-invoice/ucl-form`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({id: documentInfo.id, orderNo: documentInfo.orderNo, shippingMethod: shippingMethodFor(documentInfo)}),
            });
            const result = await response.json().catch(()=> ({}));
            if(!response.ok) throw new Error(result.message || 'Could not create UCL form');
            setUclFormStatus((current)=> ({
                ...current,
                [documentInfo.id]: `Saved to Downloads: ${result.uclForm.fileName} (${result.uclForm.totalWeight} lb)`,
            }));
            const completedResponse = await fetch(`${API_BASE}/make-invoice/completed`);
            const completedResult = await completedResponse.json().catch(()=> ({}));
            if(completedResponse.ok && Array.isArray(completedResult.documents)) mergeCompletedDocuments(completedResult.documents);
        }
        catch(error)
        {
            console.log(error);
            setError(error.message);
            setUclFormStatus((current)=> ({...current, [documentInfo.id]: 'ERROR'}));
        }
    }

    async function createLabels(documentInfo)
    {
        setError('');
        setLabelStatus((current)=> ({...current, [documentInfo.id]: 'CREATING'}));
        try
        {
            const response = await fetch(`${API_BASE}/make-invoice/ucl-labels`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({id: documentInfo.id, orderNo: documentInfo.orderNo, shippingMethod: shippingMethodFor(documentInfo)}),
            });
            const result = await response.json().catch(()=> ({}));
            if(!response.ok) throw new Error(result.message || 'Could not create LABEL PDF');
            setLabelStatus((current)=> ({
                ...current,
                [documentInfo.id]: `Saved to Downloads: ${result.labels.fileName}`,
            }));
            const completedResponse = await fetch(`${API_BASE}/make-invoice/completed`);
            const completedResult = await completedResponse.json().catch(()=> ({}));
            if(completedResponse.ok && Array.isArray(completedResult.documents)) mergeCompletedDocuments(completedResult.documents);
        }
        catch(error)
        {
            console.log(error);
            setError(error.message);
            setLabelStatus((current)=> ({...current, [documentInfo.id]: 'ERROR'}));
        }
    }

    function shippingMethodFor(documentInfo)
    {
        if(shippingMethods[documentInfo.id]) return shippingMethods[documentInfo.id];
        if(documentInfo.shippingMethodOverride) return documentInfo.shippingMethodOverride;
        const sourceMethod = String(documentInfo.uclData?.shipVia || '').toUpperCase();
        if(sourceMethod === 'UCL' || sourceMethod === 'UCLC') return 'UCL';
        if(sourceMethod.startsWith('UPS')) return 'UPS';
        return 'ANOTHER';
    }

    function printCompletedDocument(documentInfo, type)
    {
        const url = `${API_BASE}/make-invoice/print-page/${encodeURIComponent(type)}?documentId=${encodeURIComponent(documentInfo.id)}`;
        const printWindow = window.open(url, '_blank');
        if(!printWindow) setError('The browser blocked the print window. Allow pop-ups for this page and try again.');
    }

    async function createUclDocuments(documentInfo)
    {
        await createUclForm(documentInfo);
        await createLabels(documentInfo);
    }

    function downloadUclDocuments(documentInfo)
    {
        [documentInfo.uclForm, documentInfo.uclLabels].forEach((artifact)=> {
            if(!artifact?.downloadUrl) return;
            const link = document.createElement('a');
            link.href = `${API_BASE}${artifact.downloadUrl}`;
            link.download = artifact.fileName || '';
            document.body.appendChild(link);
            link.click();
            link.remove();
        });
    }

    return(
        <main className="invoice-page">
            <p id="title">Make Invoice</p>

            {error && <p className="invoice-error">{error}</p>}

            <div className="invoice-workspace">
                <section className="invoice-section">
                    <h2>Prepare ChatGPT Package</h2>
                    <form className="invoice-form" onSubmit={preparePackage}>
                        <label>
                            Order Number
                            <input
                                type="text"
                                value={orderNo}
                                onChange={(event)=> setOrderNo(event.target.value)}
                                placeholder="Order number"
                            />
                        </label>

                        <label>
                            Total Cartons
                            <input
                                type="number"
                                min="1"
                                value={totalCartons}
                                onChange={(event)=> setTotalCartons(event.target.value)}
                                placeholder="Total cartons"
                            />
                        </label>

                        <label>
                            Shipping Cost (Billed Freight)
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={shippingCost}
                                onChange={(event)=> setShippingCost(event.target.value)}
                                placeholder="0.00"
                            />
                            <span className="invoice-field-note">
                                Leave blank to use 0.00.
                            </span>
                        </label>

                        <label>
                            Pick-Ticket Images
                            <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handleImageChange}
                            />
                            <span className="invoice-field-note">
                                Select up to 20 images. On phone, choose Photo Library or Files for multi-select.
                            </span>
                        </label>

                        {pickTicketImages.length > 0 && (
                            <p className="invoice-field-note">
                                {pickTicketImages.length} image{pickTicketImages.length === 1 ? '' : 's'} selected
                            </p>
                        )}

                        {previewUrls.length > 0 && (
                            <div className="invoice-preview-grid">
                                {previewUrls.map((previewUrl, index)=> (
                                    <img
                                        className="invoice-preview"
                                        src={previewUrl}
                                        alt={`Pick-ticket preview ${index + 1}`}
                                        key={previewUrl}
                                    />
                                ))}
                            </div>
                        )}

                        <button type="submit" disabled={prepareStatus === 'PREPARING'}>
                            {prepareStatus === 'PREPARING' ? 'Preparing...' : 'Prepare ZIP'}
                        </button>

                        <p className={`invoice-status invoice-status-${prepareStatus.toLowerCase()}`}>
                            PREPARE: {prepareStatus}
                        </p>

                        {(packageInfo || latestPackage) && (
                            <div className="invoice-download">
                                <h3>Download Files</h3>
                                <a href={`${API_BASE}${(packageInfo || latestPackage).downloadUrl}`} download={(packageInfo || latestPackage).fileName}>
                                    {(packageInfo || latestPackage).fileName}
                                </a>
                                <p>Order: {(packageInfo || latestPackage).orderNo}</p>
                                <p>Rows: {(packageInfo || latestPackage).rowCount}</p>
                                <p>Weight fields: {(packageInfo || latestPackage).weightFieldCount}</p>
                                {(packageInfo || latestPackage).preparedAt && (
                                    <p>Prepared: {new Date((packageInfo || latestPackage).preparedAt).toLocaleString()}</p>
                                )}
                            </div>
                        )}
                    </form>
                </section>

                <section className="invoice-section">
                    <h2>Submit ChatGPT JSON</h2>
                    <form className="invoice-form">
                        <div className="invoice-submit-context">
                            <p>Order number, carton count, billed freight, box information, and all other submission values are read from the JSON.</p>
                            <p>The Prepare ChatGPT Package fields do not control this submission.</p>
                        </div>

                        <label>
                            ChatGPT JSON
                            <textarea
                                value={chatGptJson}
                                onChange={(event)=> setChatGptJson(event.target.value)}
                                placeholder="Paste ChatGPT JSON here"
                                rows="12"
                            />
                        </label>

                        <label>
                            Attach JSON files
                            <input
                                type="file"
                                accept="application/json,.json"
                                multiple
                                onChange={handleJsonFileChange}
                            />
                            <span className="invoice-field-note">
                                Select any number of JSON files. You can choose more files again to add them to the list.
                            </span>
                        </label>

                        {jsonFiles.length > 0 && (
                            <div className="invoice-json-files">
                                {jsonFiles.map((file, fileIndex)=> {
                                    const fileStatus = jsonBatchStatus[fileIndex];
                                    return (
                                        <div className="invoice-json-file" key={`${file.name}:${file.size}:${file.lastModified}`}>
                                            <span>{file.name} {fileStatus ? `— ${fileStatus.status}${fileStatus.message ? `: ${fileStatus.message}` : ''}` : ''}</span>
                                            <button type="button" disabled={submitStatus === 'GENERATING'} onClick={()=> removeJsonFile(file)}>
                                                Remove
                                            </button>
                                        </div>
                                    );
                                })}
                                <button
                                    type="button"
                                    disabled={submitStatus === 'SUBMITTING' || submitStatus === 'GENERATING'}
                                    onClick={submitAttachedJsonFiles}
                                >
                                    {submitStatus === 'GENERATING' ? 'Uploading JSON files...' : `Upload ${jsonFiles.length} JSON file${jsonFiles.length === 1 ? '' : 's'} + Generate Docs`}
                                </button>
                            </div>
                        )}

                        <button
                            type="button"
                            disabled={submitStatus === 'SUBMITTING' || submitStatus === 'GENERATING'}
                            onClick={submitAndGenerate}
                        >
                            {submitStatus === 'GENERATING' ? 'Submitting and generating...' : 'Submit + Generate Docs'}
                        </button>

                        <p className={`invoice-status invoice-status-${submitStatus.toLowerCase()}`}>
                            SUBMIT: {submitStatus}
                        </p>

                        {submitResult && (
                            <div className="invoice-result">
                                <p>HTTP status: {submitResult.status}</p>
                                <p>Redirect: {submitResult.redirectLocation || 'None'}</p>
                                <p>Patched fields: {submitResult.fieldCount}</p>
                                <div className="invoice-print-actions">
                                    <button
                                        type="button"
                                        onClick={()=> savePrintDocument('invoice')}
                                    >
                                        Save Invoice
                                    </button>
                                    <button
                                        type="button"
                                        onClick={()=> savePrintDocument('packing-list')}
                                    >
                                        Save Packing List
                                    </button>
                                </div>
                                {saveStatus && <p>Save status: {saveStatus}</p>}
                                {savedFiles.map((file)=> (
                                    <p key={file.savedPath}>Saved: {file.savedPath}</p>
                                ))}
                                {excelStatus && <p>Excel status: {excelStatus}</p>}
                                {excelPackage && (
                                    <div className="invoice-download">
                                        <h3>Excel Download</h3>
                                        <a href={`${API_BASE}${excelPackage.downloadUrl}`} download={excelPackage.fileName}>
                                            {excelPackage.fileName}
                                        </a>
                                        <p>Items: {excelPackage.itemCount}</p>
                                        <p>Images: {excelPackage.imageCount}</p>
                                        <p>Missing images: {excelPackage.missingImageCount}</p>
                                        {excelPackage.missingImages && excelPackage.missingImages.length > 0 && (
                                            <p>Missing sample: {excelPackage.missingImages.join(', ')}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </form>
                </section>
            </div>

            <section className="invoice-section invoice-completed-section">
                <div className="invoice-section-header">
                    <h2>Completed Documents</h2>
                    {completedDocuments.length > 0 && (
                        <button type="button" onClick={clearCompletedDocuments}>
                            Clear List
                        </button>
                    )}
                </div>

                {completedDocuments.length === 0 ? (
                    <p className="invoice-field-note">Completed invoices will appear here after Submit + Generate Docs finishes.</p>
                ) : (
                    <div className="invoice-completed-list">
                        {completedDocuments.map((document)=> (
                            <article className="invoice-completed-card" key={document.id}>
                                <div className="invoice-completed-title">
                                    <h3>{document.name}</h3>
                                    <p>Order {document.orderNo}</p>
                                    <label className="invoice-shipping-method">
                                        Shipping Method
                                        <select value={shippingMethodFor(document)} onChange={(event)=> setShippingMethods((current)=> ({...current, [document.id]: event.target.value}))}>
                                            <option value="UCL">UCL</option>
                                            <option value="UPS">UPS</option>
                                            <option value="ANOTHER">Another</option>
                                        </select>
                                    </label>
                                    <button
                                        className="invoice-delete-order"
                                        type="button"
                                        disabled={Boolean(deletingDocuments[document.id])}
                                        onClick={()=> deleteCompletedDocument(document)}
                                    >
                                        {deletingDocuments[document.id] ? 'Deleting...' : 'Delete Order'}
                                    </button>
                                </div>

                                <div className="invoice-completed-actions">
                                    <div className="invoice-completed-action-group invoice-completed-downloads">
                                        <h4>Download</h4>
                                        <div>
                                            {document.invoice?.downloadUrl && <a href={`${API_BASE}${document.invoice.downloadUrl}`} download={document.invoice.fileName}>Invoice</a>}
                                            {document.packingList?.downloadUrl && <a href={`${API_BASE}${document.packingList.downloadUrl}`} download={document.packingList.fileName}>Packing List</a>}
                                            {document.excel?.downloadUrl && <a href={`${API_BASE}${document.excel.downloadUrl}`} download={document.excel.fileName}>Excel</a>}
                                            {shippingMethodFor(document) === 'UCL' && <>
                                                {document.uclForm?.downloadUrl && document.uclLabels?.downloadUrl
                                                    ? <button type="button" onClick={()=> downloadUclDocuments(document)}>Download UCL Form + Labels</button>
                                                    : <button
                                                        type="button"
                                                        disabled={uclFormStatus[document.id] === 'CREATING' || labelStatus[document.id] === 'CREATING'}
                                                        onClick={()=> createUclDocuments(document)}
                                                    >
                                                        {uclFormStatus[document.id] === 'CREATING' || labelStatus[document.id] === 'CREATING' ? 'Creating UCL Documents...' : 'Create UCL Form + Labels'}
                                                    </button>}
                                            </>}
                                        </div>
                                    </div>
                                    <div className="invoice-completed-action-group invoice-completed-prints">
                                        <h4>Print</h4>
                                        <div>
                                            {document.invoice?.downloadUrl && <button type="button" onClick={()=> printCompletedDocument(document, 'invoice')}>Print Invoice</button>}
                                            {document.packingList?.downloadUrl && <button type="button" onClick={()=> printCompletedDocument(document, 'packing-list')}>Print Packing List</button>}
                                            {shippingMethodFor(document) === 'UCL' && document.uclForm?.downloadUrl && <button type="button" onClick={()=> printCompletedDocument(document, 'ucl-form')}>Print UCL Form</button>}
                                            {shippingMethodFor(document) === 'UCL' && document.uclLabels?.downloadUrl && <button type="button" onClick={()=> printCompletedDocument(document, 'ucl-labels')}>Print Labels</button>}
                                        </div>
                                    </div>
                                </div>

                                {uclFormStatus[document.id] && uclFormStatus[document.id] !== 'CREATING' && (
                                    <p className="invoice-field-note">{uclFormStatus[document.id]}</p>
                                )}
                                {labelStatus[document.id] && labelStatus[document.id] !== 'CREATING' && (
                                    <p className="invoice-field-note">{labelStatus[document.id]}</p>
                                )}

                                <p className="invoice-field-note">
                                    {new Date(document.completedAt).toLocaleString()}
                                </p>
                            </article>
                        ))}
                    </div>
                )}
            </section>

            <section className="invoice-section invoice-completed-section">
                <div className="invoice-section-header">
                    <h2>ZIP Packages <span className="invoice-section-count">({zipPackages.length})</span></h2>
                    <div className="invoice-section-header-actions">
                        {zipSectionExpanded && zipPackages.length > 0 && (
                            <button type="button" onClick={clearZipPackages}>
                                Clear List
                            </button>
                        )}
                        <button type="button" onClick={()=> setZipSectionExpanded((current)=> !current)}>
                            {zipSectionExpanded ? 'Collapse' : 'Expand'}
                        </button>
                    </div>
                </div>

                {zipSectionExpanded && (
                    zipPackages.length === 0 ? (
                        <p className="invoice-field-note">Prepared ZIP files will appear here after Prepare ZIP finishes.</p>
                    ) : (
                        <div className="invoice-completed-list">
                            {zipPackages.map((zipPackage)=> (
                                <article className="invoice-completed-card invoice-zip-card" key={zipPackage.id}>
                                    <div className="invoice-completed-title">
                                        <h3>{zipPackage.fileName}</h3>
                                        <p>Order {zipPackage.orderNo || 'Unknown'}</p>
                                    </div>

                                    <div className="invoice-completed-actions invoice-zip-actions">
                                        <a href={`${API_BASE}${zipPackage.downloadUrl}`} download={zipPackage.fileName}>
                                            Download ZIP
                                        </a>
                                    </div>

                                    <p className="invoice-field-note">
                                        {zipPackage.rowCount ? `${zipPackage.rowCount} rows` : 'Rows unknown'}
                                        {zipPackage.weightFieldCount ? `, ${zipPackage.weightFieldCount} weight fields` : ''}
                                        <br />
                                        {new Date(zipPackage.preparedAt).toLocaleString()}
                                    </p>
                                </article>
                            ))}
                        </div>
                    )
                )}
            </section>
        </main>
    )
}
