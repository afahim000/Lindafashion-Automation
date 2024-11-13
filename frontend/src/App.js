
import './App.css';
import {Routes, Route} from 'react-router-dom'
import Home from './home.jsx'
import PO from './PO.jsx'
function App() {
  return (
    <>
    <Routes>
      <Route path="/" element= {<Home />}/>
      <Route path="/PO" element = {<PO/>}  />
    </Routes>
    </>
  );
}

export default App;
