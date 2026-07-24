import {useEffect, useMemo, useState} from 'react'
import {NavLink} from 'react-router-dom'

const API_BASE = `${window.location.protocol}//${window.location.hostname}:2000`;
const emptyPackage = ()=> ({quantity: '1', weight: '', length: '', width: '', height: ''});

export default function ShippingQuote()
{
    const [shippingMethod, setShippingMethod] = useState('UCL');
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [zip, setZip] = useState('');
    const [packages, setPackages] = useState([emptyPackage()]);
    const [status, setStatus] = useState('IDLE');
    const [message, setMessage] = useState('');
    const [sentResult, setSentResult] = useState(null);
    const [gmail, setGmail] = useState({configured: false, connected: false, email: ''});

    useEffect(()=> {
        let active = true;
        const check = ()=> fetch(`${API_BASE}/shipping-quote/google/status`, {cache: 'no-store'}).then((response)=> response.json()).then((body)=> { if(active) setGmail(body); }).catch(()=> {});
        check();
        const timer = window.setInterval(check, 3000);
        return ()=> { active = false; window.clearInterval(timer); };
    }, []);

    const expandedBoxes = useMemo(()=> packages.flatMap((box)=>
        Array.from({length: Number(box.quantity) || 0}, ()=> box)
    ), [packages]);

    function updatePackage(index, field, value)
    {
        setPackages((current)=> current.map((box, boxIndex)=> boxIndex === index ? {...box, [field]: value} : box));
    }

    function emailPreview()
    {
        const destination = [city, state && state.toUpperCase(), zip].filter(Boolean).join(state ? state.length ? ', ' : ' ' : ' ')
            .replace(`, ${zip}`, ` ${zip}`);
        const count = expandedBoxes.length;
        return [
            'Dear UCL team,', '',
            `Please Provide me a shipping quote for ${count || ''} ${count === 1 ? 'box' : 'boxes'} with the following dimensions going to ${destination}:`, '',
            ...expandedBoxes.map((box)=> `${box.weight || '?'}lbs ${box.length || '?'} x ${box.width || '?'} x ${box.height || '?'}`),
            '', 'Thank you.', '', 'Best,', 'Abrar.',
        ].join('\n');
    }

    async function submit(event)
    {
        event.preventDefault();
        setStatus('SENDING'); setMessage(''); setSentResult(null);
        try
        {
            const response = await fetch(`${API_BASE}/shipping-quote/send`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({shippingMethod, city, state, zip, packages}),
            });
            const body = await response.json().catch(()=> ({}));
            if(!response.ok) throw new Error(body.message || 'Could not send quote request');
            setSentResult(body); setStatus('SENT'); setMessage(`Quote request sent to ${body.recipient}`);
        }
        catch(error)
        {
            setStatus('ERROR'); setMessage(error.message);
        }
    }

    return <main className="shipping-quote-page">
        <div className="shipping-quote-header"><div><h1>Get Shipping Quote</h1><p>Email a shipment quote request to the selected carrier.</p></div><NavLink to="/">Home</NavLink></div>
        <section className="invoice-section">
            <form className="invoice-form" onSubmit={submit}>
                <div className="gmail-connection">
                    <div><strong>Sending account</strong><p>{gmail.connected ? `Connected: ${gmail.email}` : gmail.configured ? 'Gmail is ready to connect' : 'Google OAuth setup is required'}</p></div>
                    {!gmail.connected && <a href={`${API_BASE}/shipping-quote/google/connect`} target="_blank" rel="noreferrer">Connect Gmail</a>}
                </div>
                <label>Shipping Method
                    <select value={shippingMethod} onChange={(event)=> setShippingMethod(event.target.value)}>
                        <option value="UCL">UCL</option>
                        <option value="UPS" disabled>UPS — coming soon</option>
                    </select>
                </label>
                <div className="shipping-destination-fields">
                    <label>City<input required value={city} onChange={(event)=> setCity(event.target.value)} /></label>
                    <label>State<input required maxLength="2" placeholder="FL" value={state} onChange={(event)=> setState(event.target.value.toUpperCase())} /></label>
                    <label>ZIP<input required inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" value={zip} onChange={(event)=> setZip(event.target.value)} /></label>
                </div>
                <div className="quickbooks-box-groups">
                    {packages.map((box, index)=> <fieldset className="quickbooks-box-group" key={index}>
                        <div className="quickbooks-box-group-heading"><legend>Box type {index + 1}</legend>{packages.length > 1 && <button type="button" className="quickbooks-remove-box" onClick={()=> setPackages((current)=> current.filter((_, boxIndex)=> boxIndex !== index))}>Remove</button>}</div>
                        <div className="quickbooks-package-fields">
                            <label>Number of boxes<input required type="number" min="1" max="40" step="1" value={box.quantity} onChange={(event)=> updatePackage(index, 'quantity', event.target.value)} /></label>
                            <label>Weight per box (lb)<input required type="number" min="0.1" step="0.1" value={box.weight} onChange={(event)=> updatePackage(index, 'weight', event.target.value)} /></label>
                            <label>Length (in)<input required type="number" min="1" step="0.1" value={box.length} onChange={(event)=> updatePackage(index, 'length', event.target.value)} /></label>
                            <label>Width (in)<input required type="number" min="1" step="0.1" value={box.width} onChange={(event)=> updatePackage(index, 'width', event.target.value)} /></label>
                            <label>Height (in)<input required type="number" min="1" step="0.1" value={box.height} onChange={(event)=> updatePackage(index, 'height', event.target.value)} /></label>
                        </div>
                    </fieldset>)}
                </div>
                <button type="button" className="quickbooks-add-box" onClick={()=> setPackages((current)=> [...current, emptyPackage()])}>+ Add another box type</button>
                <div className="shipping-email-preview"><h2>Email Preview</h2><pre>{emailPreview()}</pre></div>
                {message && <p className={status === 'ERROR' ? 'invoice-error' : 'invoice-detected'}>{message}</p>}
                <button type="submit" disabled={status === 'SENDING' || !gmail.connected}>{status === 'SENDING' ? 'Sending...' : 'Send UCL Quote Request'}</button>
                {sentResult?.subject && <p className="invoice-field-note">Subject: {sentResult.subject}</p>}
            </form>
        </section>
    </main>
}
