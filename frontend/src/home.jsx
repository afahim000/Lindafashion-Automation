import {useEffect, useState} from 'react'
import {NavLink} from 'react-router-dom'

const API_BASE = `${window.location.protocol}//${window.location.hostname}:2000`;

export default function Home()
{
    const [networkStatus, setNetworkStatus] = useState('CHECKING');
    const [username, setUsername] = useState('administrator');
    const [password, setPassword] = useState('');
    const [message, setMessage] = useState('');

    useEffect(()=>
    {
      fetch(`${API_BASE}/quickbooks-network/status`, {cache: 'no-store'})
        .then((response)=> response.json())
        .then((body)=> setNetworkStatus(body.connected ? 'CONNECTED' : 'LOGIN_REQUIRED'))
        .catch(()=> { setNetworkStatus('LOGIN_REQUIRED'); setMessage('The local automation server could not be reached.'); });
    }, []);

    async function connectQuickBooksServer(event)
    {
      event.preventDefault();
      setNetworkStatus('CONNECTING');
      setMessage('');
      try
      {
        const response = await fetch(`${API_BASE}/quickbooks-network/login`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({username, password}),
        });
        const body = await response.json();
        if(!response.ok || !body.connected) throw new Error(body.message || 'Could not connect.');
        setPassword('');
        setNetworkStatus('CONNECTED');
      }
      catch(error)
      {
        setPassword('');
        setNetworkStatus('LOGIN_REQUIRED');
        setMessage(error.message);
      }
    }

    return(
      <main className="home-page">
        <p id="title">Automate Workflow</p>
        {networkStatus === 'CONNECTED' && <p className="quickbooks-network-ready">QuickBooks server connected</p>}
        <nav className="home-actions" aria-label="Automation tools">
          <NavLink className="home-action" to="/PO">PO Upload</NavLink>
          <NavLink className="home-action" to="/make-invoice">Make Invoice</NavLink>
          <NavLink className="home-action" to="/quickbooks-optimizer">QuickBooks Optimizer</NavLink>
          <NavLink className="home-action" to="/shipping-quote">Get Shipping Quote</NavLink>
          <NavLink className="home-action" to="/trade-show-orders">Trade Show Orders</NavLink>
          <NavLink className="home-action home-help-action" to="/help">How to Use / Instructions</NavLink>
        </nav>
        {networkStatus !== 'CONNECTED' && <div className="network-login-backdrop" role="presentation">
          <section className="network-login-dialog" role="dialog" aria-modal="true" aria-labelledby="network-login-title">
            <h2 id="network-login-title">Connect to QuickBooks computer</h2>
            {networkStatus === 'CHECKING'
              ? <p>Checking the connection to 192.168.1.8…</p>
              : <form onSubmit={connectQuickBooksServer}>
                  <p>Enter the Windows network credentials for 192.168.1.8.</p>
                  <label>User name<input autoFocus required autoComplete="username" value={username} onChange={(event)=> setUsername(event.target.value)} /></label>
                  <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={(event)=> setPassword(event.target.value)} /></label>
                  {message && <p className="network-login-error" role="alert">{message}</p>}
                  <button type="submit" disabled={networkStatus === 'CONNECTING'}>{networkStatus === 'CONNECTING' ? 'Connecting…' : 'Connect'}</button>
                </form>}
          </section>
        </div>}
      </main>
    )
}
