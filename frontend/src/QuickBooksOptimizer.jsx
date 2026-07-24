import {useEffect, useMemo, useState} from 'react'

const API_BASE = `${window.location.protocol}//${window.location.hostname}:2000`;
const SAVED_PO_KEY = 'quickbooksOptimizer.purchaseOrders';

function readSavedPurchaseOrders()
{
    try
    {
        const saved = JSON.parse(window.localStorage.getItem(SAVED_PO_KEY) || '[]');
        return Array.isArray(saved) ? saved.filter((entry)=> entry?.purchaseOrder?.po_number && entry?.jsonPath) : [];
    }
    catch(error)
    {
        console.warn('Could not read saved QuickBooks purchase orders', error);
        return [];
    }
}

function contactPhoneFromPurchaseOrder(purchaseOrder)
{
    if(purchaseOrder?.recipient_phone) return String(purchaseOrder.recipient_phone).replace(/\D/g, '');
    const section = String(purchaseOrder?.raw_text || '').match(/Contact for this Order([\s\S]{0,350}?)(?:Manufacturer Information|Sales Order Customer)/i)?.[1] || '';
    return (section.match(/Phone:\s*([+\d(). -]{7,})/i)?.[1] || '').replace(/\D/g, '');
}

export default function QuickBooksOptimizer()
{
    const [purchaseOrderFile, setPurchaseOrderFile] = useState(null);
    const [savedPurchaseOrders, setSavedPurchaseOrders] = useState(readSavedPurchaseOrders);
    const [selectedPoNumber, setSelectedPoNumber] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [packageDetails, setPackageDetails] = useState({recipientPhone: ''});
    const [packageGroups, setPackageGroups] = useState([{quantity: '1', weight: '', length: '', width: '', height: ''}]);
    const [extractionStatus, setExtractionStatus] = useState('IDLE');
    const [invoiceStatus, setInvoiceStatus] = useState('IDLE');
    const [labelStatus, setLabelStatus] = useState('IDLE');
    const [extractionError, setExtractionError] = useState('');
    const [invoiceError, setInvoiceError] = useState('');
    const [labelError, setLabelError] = useState('');
    const [extractionResult, setExtractionResult] = useState(null);
    const [invoiceResult, setInvoiceResult] = useState(null);
    const [invoiceJobId, setInvoiceJobId] = useState('');
    const [labelResult, setLabelResult] = useState(null);

    const selectedSavedPo = useMemo(
        ()=> savedPurchaseOrders.find((entry)=> entry.purchaseOrder.po_number === selectedPoNumber) || null,
        [savedPurchaseOrders, selectedPoNumber]
    );

    useEffect(()=>
    {
        fetch(`${API_BASE}/quickbooks-optimizer/purchase-orders`, {cache: 'no-store'})
            .then((response)=> response.ok ? response.json() : Promise.reject(new Error('Could not load saved POs')))
            .then((body)=>
            {
                const serverEntries = Array.isArray(body.purchaseOrders) ? body.purchaseOrders : [];
                setSavedPurchaseOrders((browserEntries)=>
                {
                    const merged = [...serverEntries, ...browserEntries]
                        .filter((entry, index, entries)=> entry?.purchaseOrder?.po_number && entry?.jsonPath
                            && entries.findIndex((candidate)=> candidate?.purchaseOrder?.po_number === entry.purchaseOrder.po_number) === index)
                        .slice(0, 50);
                    window.localStorage.setItem(SAVED_PO_KEY, JSON.stringify(merged));
                    return merged;
                });
            })
            .catch((error)=> console.warn('Could not synchronize extracted purchase orders', error));
    }, []);

    useEffect(()=> {
        if(!selectedSavedPo) return;
        setInvoiceNumber(selectedSavedPo.purchaseOrder.quickbooks_invoice_ref_number || '');
        setPackageDetails((current)=> ({...current, recipientPhone: contactPhoneFromPurchaseOrder(selectedSavedPo.purchaseOrder)}));
    }, [selectedSavedPo]);

    function persistSavedPurchaseOrders(updated)
    {
        window.localStorage.setItem(SAVED_PO_KEY, JSON.stringify(updated));
        setSavedPurchaseOrders(updated);
    }

    function saveExtractedPurchaseOrder(result)
    {
        const poNumber = result.purchaseOrder?.po_number;
        if(!poNumber) return;
        const entry = {purchaseOrder: result.purchaseOrder, jsonPath: result.jsonPath, savedAt: new Date().toISOString()};
        persistSavedPurchaseOrders([entry, ...savedPurchaseOrders.filter((saved)=> saved.purchaseOrder.po_number !== poNumber)].slice(0, 50));
        setSelectedPoNumber(poNumber);
    }

    function updateSavedPurchaseOrder(result)
    {
        const updated = savedPurchaseOrders.map((entry)=> entry.purchaseOrder.po_number === result.purchaseOrder.po_number
            ? {...entry, purchaseOrder: result.purchaseOrder, jsonPath: result.jsonPath || entry.jsonPath, savedAt: new Date().toISOString()}
            : entry);
        persistSavedPurchaseOrders(updated);
    }

    function updatePackageGroup(index, field, value)
    {
        setPackageGroups((groups)=> groups.map((group, groupIndex)=> groupIndex === index ? {...group, [field]: value} : group));
    }

    function addPackageGroup()
    {
        setPackageGroups((groups)=> [...groups, {quantity: '1', weight: '', length: '', width: '', height: ''}]);
    }

    function removePackageGroup(index)
    {
        setPackageGroups((groups)=> groups.filter((group, groupIndex)=> groupIndex !== index));
    }

    async function extractPurchaseOrder(event)
    {
        event.preventDefault();
        if(!purchaseOrderFile) return setExtractionError('Purchase order PDF is required');
        setExtractionError(''); setExtractionResult(null); setExtractionStatus('EXTRACTING');

        const formData = new FormData();
        formData.append('purchaseOrder', purchaseOrderFile);
        formData.append('createQuickBooksInvoice', 'false');
        formData.append('createFedExLabel', 'false');

        try
        {
            const response = await fetch(`${API_BASE}/quickbooks-optimizer/purchase-order`, {method: 'POST', body: formData});
            const body = await response.json().catch(()=> ({}));
            if(!response.ok) throw new Error(body.message || 'Could not extract purchase order');
            setExtractionResult(body); saveExtractedPurchaseOrder(body); setExtractionStatus('DONE');
        }
        catch(error)
        {
            setExtractionError(error.message); setExtractionStatus('ERROR');
        }
    }

    async function createInvoice(event)
    {
        event.preventDefault();
        if(!selectedSavedPo) return setInvoiceError('Select a saved purchase order');
        const jobId = `invoice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        setInvoiceJobId(jobId);
        setInvoiceError(''); setInvoiceResult(null); setInvoiceStatus('CREATING');

        try
        {
            const response = await fetch(`${API_BASE}/quickbooks-optimizer/invoice`, {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({jsonPath: selectedSavedPo.jsonPath, jobId}),
            });
            const body = await response.json().catch(()=> ({}));
            if(!response.ok) throw new Error(body.message || 'Could not create QuickBooks invoice');
            updateSavedPurchaseOrder(body); setInvoiceResult(body); setInvoiceStatus('DONE');
        }
        catch(error)
        {
            setInvoiceError(error.message); setInvoiceStatus('ERROR');
        }
    }

    async function toggleInvoicePause()
    {
        if(!invoiceJobId || !['CREATING', 'PAUSED'].includes(invoiceStatus)) return;
        const action = invoiceStatus === 'PAUSED' ? 'resume' : 'pause';
        setInvoiceError('');
        try
        {
            const response = await fetch(`${API_BASE}/quickbooks-optimizer/invoice/${encodeURIComponent(invoiceJobId)}/${action}`, {method: 'POST'});
            const body = await response.json().catch(()=> ({}));
            if(!response.ok) throw new Error(body.message || `Could not ${action} invoice creation`);
            setInvoiceStatus(action === 'pause' ? 'PAUSED' : 'CREATING');
        }
        catch(error)
        {
            setInvoiceError(error.message);
        }
    }

    async function createShippingLabel(event)
    {
        event.preventDefault();
        if(!selectedSavedPo) return setLabelError('Select a saved purchase order');
        setLabelError(''); setLabelResult(null); setLabelStatus('CREATING');

        try
        {
            const response = await fetch(`${API_BASE}/quickbooks-optimizer/shipping-label`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({purchaseOrder: selectedSavedPo.purchaseOrder, invoiceNumber, packages: packageGroups, recipientPhone: packageDetails.recipientPhone}),
            });
            const body = await response.json().catch(()=> ({}));
            if(!response.ok) throw new Error(body.message || 'Could not create shipping label');
            setLabelResult(body); setLabelStatus('DONE');
        }
        catch(error)
        {
            setLabelError(error.message); setLabelStatus('ERROR');
        }
    }

    const poOptions = <><option value="">Select a PO...</option>{savedPurchaseOrders.map((entry)=> <option key={entry.purchaseOrder.po_number} value={entry.purchaseOrder.po_number}>{entry.purchaseOrder.po_number} - {entry.purchaseOrder.ship_to?.name || 'Unknown destination'}</option>)}</>;
    const selectedSummary = selectedSavedPo && <div className="quickbooks-po-summary"><p>Customer PO: {selectedSavedPo.purchaseOrder.customer_po_number || 'Unknown'}</p><p>Ship To: {selectedSavedPo.purchaseOrder.ship_to?.name || 'Unknown'}</p><p>Service: {selectedSavedPo.purchaseOrder.ship_method || 'Unknown'}</p></div>;

    return <main className="invoice-page quickbooks-page">
        <p id="title">QuickBooks Optimizer</p>
        <div className="quickbooks-steps">
            <div className="invoice-section quickbooks-step">
                <div className="quickbooks-step-heading"><span>1</span><div><h2>Extract Purchase Order</h2><p>Read the PO PDF and save it in this browser for the next steps.</p></div></div>
                {extractionError && <p className="invoice-error">{extractionError}</p>}
                <form className="invoice-form" onSubmit={extractPurchaseOrder}>
                    <label>Purchase Order PDF<input type="file" accept="application/pdf,.pdf" onChange={(event)=> setPurchaseOrderFile(event.target.files?.[0] || null)} /></label>
                    {purchaseOrderFile && <p className="invoice-field-note">Selected: {purchaseOrderFile.name}</p>}
                    <button type="submit" disabled={extractionStatus === 'EXTRACTING'}>{extractionStatus === 'EXTRACTING' ? 'Extracting PO...' : 'Extract and Save PO'}</button>
                    <p className={`invoice-status invoice-status-${extractionStatus.toLowerCase()}`}>STATUS: {extractionStatus}</p>
                </form>
                {extractionResult && <div className="invoice-result"><p>PO: {extractionResult.purchaseOrder?.po_number}</p><p>Customer PO: {extractionResult.purchaseOrder?.customer_po_number}</p><p>Saved in this browser</p></div>}
            </div>

            <div className="invoice-section quickbooks-step">
                <div className="quickbooks-step-heading"><span>2</span><div><h2>Create Invoice</h2><p>Select an extracted PO and create its QuickBooks invoice.</p></div></div>
                {invoiceError && <p className="invoice-error">{invoiceError}</p>}
                <form className="invoice-form" onSubmit={createInvoice}>
                    <label>Saved PO Number<select required value={selectedPoNumber} onChange={(event)=> setSelectedPoNumber(event.target.value)}>{poOptions}</select></label>
                    {!savedPurchaseOrders.length && <p className="invoice-field-note">No saved POs yet. Complete Step 1 first.</p>}
                    {selectedSummary}
                    {selectedSavedPo?.purchaseOrder.quickbooks_invoice_ref_number && <p className="invoice-detected">Latest invoice: #{selectedSavedPo.purchaseOrder.quickbooks_invoice_ref_number}</p>}
                    <div className="quickbooks-invoice-controls">
                        <button type="submit" disabled={!selectedSavedPo || ['CREATING', 'PAUSED'].includes(invoiceStatus)}>{['CREATING', 'PAUSED'].includes(invoiceStatus) ? 'Creating Invoice...' : selectedSavedPo?.purchaseOrder.quickbooks_invoice_ref_number ? 'Create Another QuickBooks Invoice' : 'Create QuickBooks Invoice'}</button>
                        {['CREATING', 'PAUSED'].includes(invoiceStatus) && <button type="button" className="quickbooks-pause-button" onClick={toggleInvoicePause}>{invoiceStatus === 'PAUSED' ? 'Resume Execution' : 'Pause Execution'}</button>}
                    </div>
                    <p className={`invoice-status invoice-status-${invoiceStatus.toLowerCase()}`}>STATUS: {invoiceStatus}</p>
                </form>
                {invoiceResult && <div className="invoice-result"><p>Created invoice #{invoiceResult.purchaseOrder.quickbooks_invoice_ref_number}</p>{invoiceResult.quickbooks?.warning && <p>{invoiceResult.quickbooks.warning}</p>}{invoiceResult.quickbooks?.invoicePdf
                    ? <div className="fedex-print-actions"><a href={`${API_BASE}${invoiceResult.quickbooks.invoicePdf.viewUrl}`} target="_blank" rel="noreferrer">View / Print Invoice PDF</a><a href={`${API_BASE}${invoiceResult.quickbooks.invoicePdf.downloadUrl}`}>Download Invoice PDF</a></div>
                    : <p className="invoice-field-note">The invoice was created, but a new PDF was not found in Downloads.</p>}</div>}
            </div>

            <div className="invoice-section quickbooks-step">
                <div className="quickbooks-step-heading"><span>3</span><div><h2>Create Shipping Label</h2><p>Create a FedEx label for an invoiced PO.</p></div></div>
                {labelError && <p className="invoice-error">{labelError}</p>}
                <form className="invoice-form" onSubmit={createShippingLabel}>
                    <label>Saved PO Number<select required value={selectedPoNumber} onChange={(event)=> setSelectedPoNumber(event.target.value)}>{poOptions}</select></label>
                    {selectedSummary}
                    {invoiceNumber
                        ? <p className="invoice-detected">QuickBooks invoice #{invoiceNumber}</p>
                        : <p className="invoice-field-note">Complete Step 2 before creating shipping labels.</p>}
                    <div className="quickbooks-box-groups">
                        {packageGroups.map((group, index)=> <fieldset className="quickbooks-box-group" key={index}>
                            <div className="quickbooks-box-group-heading"><legend>Box type {index + 1}</legend>{packageGroups.length > 1 && <button type="button" className="quickbooks-remove-box" onClick={()=> removePackageGroup(index)}>Remove</button>}</div>
                            <div className="quickbooks-package-fields">
                                <label>Number of boxes<input type="number" min="1" max="40" step="1" required value={group.quantity} onChange={(event)=> updatePackageGroup(index, 'quantity', event.target.value)} /></label>
                                <label>Weight per box (lb)<input type="number" min="0.1" step="0.1" required value={group.weight} onChange={(event)=> updatePackageGroup(index, 'weight', event.target.value)} /></label>
                                <label>Length (in)<input type="number" min="1" step="1" required value={group.length} onChange={(event)=> updatePackageGroup(index, 'length', event.target.value)} /></label>
                                <label>Width (in)<input type="number" min="1" step="1" required value={group.width} onChange={(event)=> updatePackageGroup(index, 'width', event.target.value)} /></label>
                                <label>Height (in)<input type="number" min="1" step="1" required value={group.height} onChange={(event)=> updatePackageGroup(index, 'height', event.target.value)} /></label>
                            </div>
                        </fieldset>)}
                    </div>
                    <button type="button" className="quickbooks-add-box" onClick={addPackageGroup}>+ Add another box type</button>
                    <p className="invoice-field-note">Each box receives its own FedEx label. Use one box type for boxes with identical weight and dimensions.</p>
                    <button type="submit" disabled={!selectedSavedPo || !invoiceNumber || labelStatus === 'CREATING'}>{labelStatus === 'CREATING' ? 'Creating Labels...' : `Create ${packageGroups.reduce((total, group)=> total + (Number(group.quantity) || 0), 0) || ''} Shipping Label${packageGroups.reduce((total, group)=> total + (Number(group.quantity) || 0), 0) === 1 ? '' : 's'}`}</button>
                    <p className={`invoice-status invoice-status-${labelStatus.toLowerCase()}`}>STATUS: {labelStatus}</p>
                </form>
                {labelResult?.fedex && <div className="invoice-result"><p>Tracking: {labelResult.fedex.trackingNumber}</p><div className="fedex-print-actions">{labelResult.fedex.labels.map((label, index)=> <span key={label.fileName}><a href={`${API_BASE}${label.viewUrl}`} target="_blank" rel="noreferrer">View / Print Label {index + 1}</a><a href={`${API_BASE}${label.downloadUrl}`}>Download Label {index + 1}</a></span>)}<a href={`${API_BASE}${labelResult.fedex.transactionUrl}`} target="_blank" rel="noreferrer">View Transaction Record</a></div></div>}
            </div>

            <div className="invoice-section quickbooks-step quickbooks-step-disabled">
                <div className="quickbooks-step-heading"><span>4</span><div><h2>Email Tracking Number</h2><p>Automatically email the FedEx tracking number to the customer.</p></div></div>
                <div className="quickbooks-coming-soon"><strong>Coming later</strong><p>Email automation is not enabled yet.</p><button type="button" disabled>Send Tracking Email</button></div>
            </div>
        </div>
    </main>
}
