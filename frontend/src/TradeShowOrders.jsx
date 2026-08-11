import {useEffect, useMemo, useState} from 'react';
import {NavLink} from 'react-router-dom';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:2000`;

function isNewCustomer(order)
{
  return String(order.customerName || '').trim().toUpperCase() === '*NEW CUSTOMER*';
}

function LockedButton({children, reason})
{
  return <span className="locked-step" title={reason}><button type="button" disabled>{children}</button></span>;
}

export default function TradeShowOrders()
{
  const [orders, setOrders] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [status, setStatus] = useState('Loading Espresso orders…');
  const [workingOrder, setWorkingOrder] = useState('');
  const [profileOrder, setProfileOrder] = useState(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [customerNumberResult, setCustomerNumberResult] = useState(null);
  const [customerNumberStatus, setCustomerNumberStatus] = useState('');
  const [representativeOptions, setRepresentativeOptions] = useState(['Katy', 'Gaby', 'Jessa', 'Julie', 'Janet']);
  const [representatives, setRepresentatives] = useState({});
  const [profileFields, setProfileFields] = useState({address1:'', address2:'', city:'', state:'', zip:'', country:'US', phone:'', email:'', deferAddress:false});
  const [createdProfiles, setCreatedProfiles] = useState({});
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [googleConnection, setGoogleConnection] = useState({configured:false, connected:false, email:''});
  const [recordedOrders, setRecordedOrders] = useState({});
  const [sheetOrder, setSheetOrder] = useState(null);
  const [sheetFields, setSheetFields] = useState({repAtShow:'',paymentMethod:'',paymentAmount:'',notes:''});
  const [showHelp, setShowHelp] = useState(false);

  async function loadOrders()
  {
    try
    {
      const [response, representativeResponse] = await Promise.all([
        fetch(`${API_BASE}/edi-pda-orders`, {cache: 'no-store'}),
        fetch(`${API_BASE}/trade-show-representatives`, {cache: 'no-store'}),
      ]);
      const body = await response.json();
      if(!response.ok) throw new Error(body.message || 'Could not load Espresso orders.');
      const representativeBody = await representativeResponse.json();
      if(!representativeResponse.ok) throw new Error(representativeBody.message || 'Could not load representatives.');
      setOrders(body.orders || []);
      setRepresentativeOptions(representativeBody.options || []);
      setRepresentatives(Object.fromEntries(Object.entries(representativeBody.selections || {}).map(([number, value])=> [number, value.representative])));
      setCreatedProfiles(Object.fromEntries(Object.entries(representativeBody.selections || {}).filter(([, value])=> value.customerProfile?.code).map(([number, value])=> [number, value.customerProfile])));
      setStatus(body.orders?.length ? `${body.orders.length} incoming Espresso order${body.orders.length === 1 ? '' : 's'}.` : 'No incoming Espresso orders.');
    }
    catch(error) { setStatus(error.message); }
  }

  async function selectRepresentative(order, representative)
  {
    setRepresentatives((current)=> ({...current, [order.pdaOrderNumber]: representative}));
    setStatus(`Saving ${representative} as the representative for this customer…`);
    try
    {
      const response = await fetch(`${API_BASE}/trade-show-representatives/${encodeURIComponent(order.pdaOrderNumber)}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({representative}),
      });
      const body = await response.json();
      if(!response.ok) throw new Error(body.message || 'Could not save the representative.');
      setStatus(`${body.representative} saved as the representative for this new customer.`);
    }
    catch(error)
    {
      setRepresentatives((current)=> ({...current, [order.pdaOrderNumber]: ''}));
      setStatus(error.message);
    }
  }

  useEffect(()=> { loadOrders(); }, []);
  useEffect(()=>
  {
    let active = true;
    const check = ()=> fetch(`${API_BASE}/shipping-quote/google/status`, {cache:'no-store'}).then((response)=> response.json()).then((body)=> {if(active) setGoogleConnection(body)}).catch(()=> {});
    check();
    const timer = window.setInterval(check, 3000);
    return ()=> {active=false;window.clearInterval(timer)};
  }, []);

  const displayRows = useMemo(()=>
  {
    const pendingNumbers = new Set(orders.map((order)=> order.pdaOrderNumber));
    return [...orders.map((order)=> ({...order, createdOrder: null})), ...completed.filter((item)=> !pendingNumbers.has(item.pdaOrder.pdaOrderNumber)).map((item)=> ({...item.pdaOrder, createdOrder: item.createdOrder}))];
  }, [orders, completed]);

  async function createOrder(order)
  {
    setWorkingOrder(order.pdaOrderNumber);
    setStatus(`Creating ${order.customerName} in EDI…`);
    try
    {
      const response = await fetch(`${API_BASE}/edi-pda-orders/${encodeURIComponent(order.pdaOrderNumber)}/create`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({customerCode: createdProfiles[order.pdaOrderNumber]?.code || ''}),
      });
      const body = await response.json();
      if(!response.ok) throw new Error(body.message || 'Could not create the order.');
      setCompleted((current)=> [body, ...current.filter((item)=> item.pdaOrder.pdaOrderNumber !== order.pdaOrderNumber)]);
      setStatus(body.createdOrder ? `EDI order ${body.createdOrder.code} created successfully.` : 'Order created, but its permanent EDI number could not be resolved.');
      await loadOrders();
    }
    catch(error) { setStatus(error.message); }
    finally { setWorkingOrder(''); }
  }

  async function printAcknowledgment(order)
  {
    const printWindow = window.open('', '_blank');
    setStatus(`Preparing acknowledgment for order ${order.code}…`);
    try
    {
      const response = await fetch(`${API_BASE}/edi-orders/${encodeURIComponent(order.code)}/acknowledgment/prepare`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({}),
      });
      const body = await response.json();
      if(!response.ok) throw new Error(body.message || 'Could not prepare acknowledgment.');
      printWindow.location = `${API_BASE}${body.printPageUrl}`;
      setStatus(`Acknowledgment for order ${order.code} is ready. Choose copies in the print dialog.`);
    }
    catch(error)
    {
      if(printWindow) printWindow.close();
      setStatus(error.message);
    }
  }

  function openSheetEntry(order)
  {
    setSheetOrder(order);
    setSheetFields({repAtShow:'',paymentMethod:'',paymentAmount:'',notes:''});
  }

  async function recordToExcel(event)
  {
    event.preventDefault();
    const order = sheetOrder;
    const createdOrder = order.createdOrder;
    setWorkingOrder(order.pdaOrderNumber);
    setStatus(`Recording order ${createdOrder.code} to Google Sheets…`);
    try
    {
      const response = await fetch(`${API_BASE}/edi-orders/${encodeURIComponent(createdOrder.code)}/trade-show-sheet`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
          customerName: createdOrder.customerName || createdProfiles[order.pdaOrderNumber]?.customerName || order.customerName,
          orderDate: order.orderDate,
          amount: createdOrder.orderedAmount || order.amount,
          finalRep: representatives[order.pdaOrderNumber] || '',
          newCustomer: isNewCustomer(order),
          ...sheetFields,
        }),
      });
      const body = await response.json();
      if(!response.ok) throw new Error(body.message || 'Could not record the order to Google Sheets.');
      setRecordedOrders((current)=> ({...current,[createdOrder.code]:body.row}));
      setStatus(body.status === 'already-recorded' ? `Order ${createdOrder.code} was already recorded on row ${body.row}.` : `Order ${createdOrder.code} recorded on ${body.sheetName} row ${body.row}.`);
      setSheetOrder(null);
    }
    catch(error) {setStatus(error.message)}
    finally {setWorkingOrder('')}
  }

  function openCustomerProfile(order)
  {
    setProfileOrder(order);
    setNewCustomerName('');
    setCustomerNumberResult(null);
    setCustomerNumberStatus('Enter the customer name to find the next available number.');
    setProfileFields({address1:'', address2:'', city:'', state:'', zip:'', country:'US', phone:'', email:'', deferAddress:false});
  }

  async function createProfile(event)
  {
    event.preventDefault();
    if(!representatives[profileOrder.pdaOrderNumber]) { setCustomerNumberStatus('Select a representative in the Rep column first.'); return; }
    if(!profileFields.phone.trim() && !profileFields.email.trim()) { setCustomerNumberStatus('Enter at least a phone number or an email address.'); return; }
    setCreatingProfile(true);
    setCustomerNumberStatus('Creating the EDI customer and assigning the representative…');
    try
    {
      const response = await fetch(`${API_BASE}/edi-pda-orders/${encodeURIComponent(profileOrder.pdaOrderNumber)}/customer-profile`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name:newCustomerName, ...profileFields}),
      });
      const body = await response.json();
      if(!response.ok) throw new Error(body.message || 'Could not create the customer profile.');
      setCreatedProfiles((current)=> ({...current, [profileOrder.pdaOrderNumber]: body.customer}));
      setStatus(`Customer ${body.customer.code} created and assigned to ${body.representative}.`);
      setProfileOrder(null);
    }
    catch(error) { setCustomerNumberStatus(error.message); }
    finally { setCreatingProfile(false); }
  }

  async function findNextCustomerNumber(event)
  {
    event.preventDefault();
    setCustomerNumberResult(null);
    setCustomerNumberStatus('Searching existing EDI customers…');
    try
    {
      const response = await fetch(`${API_BASE}/edi-customers/next-number?name=${encodeURIComponent(newCustomerName)}`, {cache: 'no-store'});
      const body = await response.json();
      if(!response.ok) throw new Error(body.message || 'Could not determine the customer number.');
      setCustomerNumberResult(body);
      setCustomerNumberStatus(body.highestNumber ? `Highest existing ${body.prefix} number: ${body.existingCodes.at(-1)}.` : `No existing ${body.prefix} customer number was found.`);
    }
    catch(error) { setCustomerNumberStatus(error.message); }
  }

  return <main className="trade-show-orders-page workflow-page">
    <header className="trade-show-orders-header">
      <div><h1>Trade Show Orders</h1><p>Complete each order from left to right.</p></div>
      <NavLink to="/">Home</NavLink>
    </header>
    <section className="order-workflow-panel">
      <div className="workflow-toolbar"><div><h2>Order Workflow</h2><p>Espresso orders appear automatically.</p></div><div className="workflow-toolbar-actions"><button type="button" className="how-to-use-button" onClick={()=> setShowHelp(true)}>How to Use</button><button type="button" onClick={loadOrders}>Refresh</button></div></div>
      <div className="workflow-google-status"><span>{googleConnection.connected ? `Google Sheets connected: ${googleConnection.email}` : googleConnection.configured ? 'Connect Google to record completed orders.' : 'Google OAuth is not configured.'}</span>{!googleConnection.connected && googleConnection.configured && <a href={`${API_BASE}/shipping-quote/google/connect`} target="_blank" rel="noreferrer">Connect Google</a>}</div>
      {status && <p className="edi-order-status" role="status">{status}</p>}
      <div className="workflow-table-wrap"><table className="workflow-table"><thead><tr><th>Order Type</th><th>Customer</th><th>Rep</th><th>Date</th><th>Qty</th><th>Amount</th><th>Step 1</th><th>Step 2</th><th>Step 3</th><th>Step 4</th></tr></thead>
      <tbody>{displayRows.map((order)=>
      {
        const newCustomer = isNewCustomer(order);
        const createdOrder = order.createdOrder;
        const isWorking = workingOrder === order.pdaOrderNumber;
        return <tr key={order.pdaOrderNumber} className={createdOrder ? 'workflow-complete-row' : ''}>
          <td><span className="order-type-badge">ESPRESSO</span></td>
          <td><strong>{order.customerName}</strong><small>{order.customerNumber}</small></td>
          <td>{newCustomer ? <select className="representative-select" value={representatives[order.pdaOrderNumber] || ''} disabled={Boolean(createdProfiles[order.pdaOrderNumber])} title={createdProfiles[order.pdaOrderNumber] ? 'Representative already applied to the EDI customer profile' : ''} onChange={(event)=> selectRepresentative(order, event.target.value)}><option value="" disabled>Select representative</option>{representativeOptions.map((name)=> <option key={name} value={name}>{name}</option>)}</select> : <span className="not-required">—</span>}</td>
          <td>{order.orderDate}</td><td>{order.quantity}</td><td>${order.amount}</td>
          {newCustomer
            ? <>
                <td>{createdProfiles[order.pdaOrderNumber] ? <span className="step-done">{createdProfiles[order.pdaOrderNumber].code} ✓</span> : <button type="button" className="step-button profile-step" onClick={()=> openCustomerProfile(order)}>Create Profile</button>}</td>
                <td>{createdProfiles[order.pdaOrderNumber] ? <button type="button" className="step-button" disabled={isWorking} onClick={()=> createOrder(order)}>{isWorking ? 'Creating…' : 'Create Order'}</button> : <LockedButton reason="Create customer profile first">Create Order</LockedButton>}</td>
                <td><LockedButton reason="Create customer profile and order first">Print Ack</LockedButton></td>
                <td><LockedButton reason="Create customer profile and order first">Record to Excel</LockedButton></td>
              </>
            : <>
                <td>{createdOrder ? <span className="step-done">Created ✓</span> : <button type="button" className="step-button" disabled={isWorking} onClick={()=> createOrder(order)}>{isWorking ? 'Creating…' : 'Create Order'}</button>}</td>
                <td>{createdOrder ? <button type="button" className="step-button" onClick={()=> printAcknowledgment(createdOrder)}>Print Ack</button> : <LockedButton reason="Create order first">Print Ack</LockedButton>}</td>
                <td>{createdOrder ? recordedOrders[createdOrder.code] ? <span className="step-done">Row {recordedOrders[createdOrder.code]} ✓</span> : <button type="button" className="step-button excel-step" disabled={isWorking || !googleConnection.connected} title={!googleConnection.connected ? 'Connect Google first' : ''} onClick={()=> openSheetEntry(order)}>Record to Sheet</button> : <LockedButton reason="Create order first">Record to Sheet</LockedButton>}</td>
                <td><span className="not-required">—</span></td>
              </>}
        </tr>;
      })}{!displayRows.length && <tr><td colSpan="10" className="empty-order-list">No incoming Espresso orders.</td></tr>}</tbody></table></div>
    </section>
    {profileOrder && <div className="profile-modal-backdrop" role="presentation" onMouseDown={()=> setProfileOrder(null)}><section className="profile-modal profile-modal-wide" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title" onMouseDown={(event)=> event.stopPropagation()}><h2 id="profile-modal-title">Create Customer Profile</h2><p>Rep: <strong>{representatives[profileOrder.pdaOrderNumber] || 'Not selected'}</strong></p><form className="customer-profile-form" onSubmit={createProfile}><label>Customer name<input value={newCustomerName} onChange={(event)=> {setNewCustomerName(event.target.value);setCustomerNumberResult(null)}} required autoFocus/></label><div className="defer-address-control"><button type="button" onClick={()=> setProfileFields({...profileFields,deferAddress:!profileFields.deferAddress})}>{profileFields.deferAddress ? 'Require address now' : 'Defer address info for later input'}</button>{profileFields.deferAddress && <span>Address will be completed later.</span>}</div><label>Address<input value={profileFields.address1} onChange={(event)=> setProfileFields({...profileFields,address1:event.target.value})} required={!profileFields.deferAddress} disabled={profileFields.deferAddress}/></label><label>Address 2<input value={profileFields.address2} onChange={(event)=> setProfileFields({...profileFields,address2:event.target.value})} disabled={profileFields.deferAddress}/></label><label>City<input value={profileFields.city} onChange={(event)=> setProfileFields({...profileFields,city:event.target.value})} required={!profileFields.deferAddress} disabled={profileFields.deferAddress}/></label><label>State<input value={profileFields.state} onChange={(event)=> setProfileFields({...profileFields,state:event.target.value.toUpperCase().slice(0,2)})} maxLength="2" required={!profileFields.deferAddress} disabled={profileFields.deferAddress}/></label><label>ZIP code<input value={profileFields.zip} onChange={(event)=> setProfileFields({...profileFields,zip:event.target.value})} required={!profileFields.deferAddress} disabled={profileFields.deferAddress}/></label><label>Country<input value={profileFields.country} onChange={(event)=> setProfileFields({...profileFields,country:event.target.value.toUpperCase().slice(0,2)})} maxLength="2" required/></label><label>Phone <small>Phone or email required</small><input type="tel" value={profileFields.phone} onChange={(event)=> setProfileFields({...profileFields,phone:event.target.value})}/></label><label className="profile-email-field">Email <small>Phone or email required</small><input type="email" value={profileFields.email} onChange={(event)=> setProfileFields({...profileFields,email:event.target.value})}/></label><div className="profile-number-actions"><button type="button" onClick={findNextCustomerNumber}>Preview Number</button>{customerNumberResult && <strong>{customerNumberResult.code}</strong>}</div><p className="customer-number-status" role="status">{customerNumberStatus}</p><div className="profile-modal-actions"><button type="button" className="profile-close-button" onClick={()=> setProfileOrder(null)}>Cancel</button><button type="submit" disabled={creatingProfile}>{creatingProfile ? 'Creating…' : 'Create Profile'}</button></div></form></section></div>}
    {sheetOrder && <div className="profile-modal-backdrop" role="presentation" onMouseDown={()=> setSheetOrder(null)}><section className="profile-modal profile-modal-wide" role="dialog" aria-modal="true" aria-labelledby="sheet-entry-title" onMouseDown={(event)=> event.stopPropagation()}><h2 id="sheet-entry-title">Record Order to Google Sheets</h2><div className="sheet-entry-summary"><span><small>Date</small>{sheetOrder.orderDate}</span><span><small>Customer</small>{sheetOrder.createdOrder.customerName || sheetOrder.customerName}</span><span><small>Sales Order #</small>{sheetOrder.createdOrder.code}</span><span><small>Amount</small>${sheetOrder.createdOrder.orderedAmount || sheetOrder.amount}</span><span><small>Final Rep</small>{representatives[sheetOrder.pdaOrderNumber] || '—'}</span><span><small>New Customer?</small>{isNewCustomer(sheetOrder) ? 'YES' : 'NO'}</span></div><form className="customer-profile-form sheet-entry-form" onSubmit={recordToExcel}><label>Rep at Show<input value={sheetFields.repAtShow} onChange={(event)=> setSheetFields({...sheetFields,repAtShow:event.target.value})}/></label><label>Payment Method<input value={sheetFields.paymentMethod} onChange={(event)=> setSheetFields({...sheetFields,paymentMethod:event.target.value})}/></label><label>Payment Amount<input value={sheetFields.paymentAmount} onChange={(event)=> setSheetFields({...sheetFields,paymentAmount:event.target.value})}/></label><label className="sheet-notes-field">Notes<textarea value={sheetFields.notes} onChange={(event)=> setSheetFields({...sheetFields,notes:event.target.value})}/></label><div className="profile-modal-actions"><button type="button" className="profile-close-button" onClick={()=> setSheetOrder(null)}>Cancel</button><button type="submit" disabled={workingOrder === sheetOrder.pdaOrderNumber}>{workingOrder === sheetOrder.pdaOrderNumber ? 'Recording…' : 'Record to Sheet'}</button></div></form></section></div>}
    {showHelp && <div className="profile-modal-backdrop" role="presentation" onMouseDown={()=> setShowHelp(false)}><section className="profile-modal workflow-help-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-help-title" onMouseDown={(event)=> event.stopPropagation()}><div className="workflow-help-heading"><div><h2 id="workflow-help-title">How to Use Trade Show Orders</h2><p>Complete each order from left to right.</p></div><button type="button" aria-label="Close instructions" onClick={()=> setShowHelp(false)}>×</button></div><div className="workflow-help-content"><section><h3>Start and refresh</h3><p>Incoming Espresso orders appear automatically. Click <strong>Refresh</strong> whenever you need to check for newly submitted PDA orders.</p></section><section><h3>Existing customers</h3><ol><li>Click <strong>Create Order</strong>.</li><li>After EDI creates the permanent order, click <strong>Print Ack</strong>. Choose the number of copies in the browser print dialog.</li><li>Click <strong>Record to Sheet</strong>, review the automatic information, enter any show and payment details, then submit.</li></ol></section><section><h3>New customers</h3><ol><li>Select the customer's final representative in the <strong>Rep</strong> dropdown.</li><li>Click <strong>Create Profile</strong> and enter the customer information.</li><li>Enter at least a phone number or an email address. If the address is unavailable, click <strong>Defer address info for later input</strong>.</li><li>The system finds the next customer number, creates the EDI profile, and assigns the selected rep.</li><li>Continue with <strong>Create Order</strong>, <strong>Print Ack</strong>, and <strong>Record to Sheet</strong>.</li></ol></section><section><h3>Google Sheets connection</h3><p>If the page says <strong>Connect Google</strong>, click it and sign in with the Google account that can edit the show spreadsheet. This is normally a one-time connection. Return to this page when Google confirms the connection.</p></section><section><h3>Record to Sheet</h3><p>The system fills Date, Customer, Sales Order/Pickticket Number, Total Order Amount, Final Rep, and New Customer status. The popup lets you enter Rep at Show, Payment Method, Payment Amount, and Notes. EDI Order # remains blank. Duplicate Sales Order numbers will not be added twice.</p></section><section><h3>If something fails</h3><p>Read the status message above the order table. Do not repeatedly click a completed step. Refresh the page first and confirm whether EDI or Google Sheets already completed the action.</p></section></div><div className="profile-modal-actions"><button type="button" onClick={()=> setShowHelp(false)}>Close</button></div></section></div>}
  </main>;
}
