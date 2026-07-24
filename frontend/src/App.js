
import './App.css';
import {Routes, Route, NavLink} from 'react-router-dom'
import Home from './home.jsx'
import PO from './PO.jsx'
import MakeInvoice from './MakeInvoice.jsx'
import QuickBooksOptimizer from './QuickBooksOptimizer.jsx'
import ShippingQuote from './ShippingQuote.jsx'
import Help from './Help.jsx'
function App() {
  return (
    <>
    <NavLink className="global-help-link" to="/help" aria-label="Open instructions">? Help</NavLink>
    <Routes>
      <Route path="/" element= {<Home />}/>
      <Route path="/PO" element = {<PO/>}  />
      <Route path="/make-invoice" element={<MakeInvoice />} />
      <Route path="/quickbooks-optimizer" element={<QuickBooksOptimizer />} />
      <Route path="/shipping-quote" element={<ShippingQuote />} />
      <Route path="/help" element={<Help />} />
    </Routes>
    </>
  );
}

export default App;
