import {NavLink} from 'react-router-dom'

export default function Home()
{
    return(
    <>
      <p id = "title">Automate workflow</p>
        <NavLink to="/PO">
           PO Upload 
        </NavLink>
    </>
    )
}