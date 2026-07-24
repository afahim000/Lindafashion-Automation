import {NavLink} from 'react-router-dom'

const guides = [
  {
    id: 'po-upload',
    title: 'PO Upload',
    summary: 'Converts purchase-order Excel files into the EDI CSV format, then uploads those CSV files into the EDI system.',
    before: 'Have one or more completed .xls or .xlsx purchase-order files ready.',
    steps: [
      'Choose Add Excel Files and select the purchase-order spreadsheets. You may add several files at once.',
      'Review the selected file names, then choose Create CSV. The converted files are saved to the upload queue.',
      'Choose Load CSV Files to refresh the queue and confirm that the new CSV files appear.',
      'Choose Start Upload. Keep this page open while each file moves through the queue.',
      'Check the Status and Details columns. DONE means the file finished. FLAGGED means review the displayed EDI rows before continuing. ERROR means the file needs attention and the message will explain why.'
    ],
    note: 'Use Clear List only to remove files from the screen before conversion; it does not upload them.'
  },
  {
    id: 'make-invoice',
    title: 'Make Invoice',
    summary: 'Prepares order files for ChatGPT, turns the returned JSON into an invoice and packing list, and provides shipping documents for printing or download.',
    before: 'Know the order number, carton count, shipping cost, and shipping method. Have the source order files available.',
    steps: [
      'Enter the order information in Prepare ChatGPT Package and add the source files.',
      'Choose Prepare Package, then download the files the page creates.',
      'Give that package to ChatGPT using the company invoice workflow. Download or copy the JSON result it returns.',
      'In Submit ChatGPT JSON, paste the JSON or select one or more JSON files, then submit them.',
      'Review Completed Documents. Select the correct shipping method for each order before creating shipping paperwork.',
      'Download or print the invoice and packing list. For UCL orders, choose Create UCL Form + Labels first, then download or print those documents.',
      'Use ZIP Packages when you need one downloadable package containing the completed order files.'
    ],
    note: 'Always verify the order number, quantities, addresses, and shipping method on the finished documents before printing.'
  },
  {
    id: 'quickbooks',
    title: 'QuickBooks Optimizer',
    summary: 'Reads a PO PDF, creates its invoice in QuickBooks, and then creates one FedEx label for each shipping box.',
    before: 'QuickBooks must be open and available on the connected QuickBooks computer. Have the PO PDF and final box sizes and weights ready.',
    steps: [
      'In Step 1, select the Purchase Order PDF and choose Extract and Save PO.',
      'Confirm the correct PO appears, then select it in Step 2 and choose Create QuickBooks Invoice. Do not use the mouse or keyboard on the QuickBooks computer while automation is working.',
      'If you must use QuickBooks temporarily, choose Pause Execution; choose Resume Execution when it is safe to continue.',
      'After the invoice succeeds, use Step 3. Enter the number of boxes, weight per box, and outside dimensions in inches.',
      'Use Add another box type when boxes have different weights or dimensions. Identical boxes can share one box type with a larger quantity.',
      'Choose Create Shipping Labels. Open and print every label, and save the tracking number or transaction record.'
    ],
    note: 'Each box gets its own FedEx label. Confirm the recipient, service, billing instructions, box count, and weight before using the labels. Tracking email automation is not enabled yet.'
  },
  {
    id: 'shipping-quote',
    title: 'Get Shipping Quote',
    summary: 'Builds and emails a shipment quote request to the selected carrier using the destination and package details you enter.',
    before: 'Make sure Gmail shows as connected and have the destination plus packed box dimensions and weights.',
    steps: [
      'Select the shipping method or carrier.',
      'Enter the destination city, two-letter state abbreviation, and ZIP code.',
      'Enter the number of boxes, weight per box, and outside length, width, and height in inches.',
      'Add another box type for packages with different dimensions or weights.',
      'Read the Email Preview carefully and correct any information that is wrong.',
      'Choose Send UCL Quote Request once. Wait for the success message before leaving the page.'
    ],
    note: 'The quote request is not a shipping label or a confirmed booking. Wait for the carrier’s reply before choosing the final service.'
  }
]

export default function Help()
{
  return <main className="help-page">
    <header className="help-header">
      <div><p className="help-eyebrow">LINDA FASHION AUTOMATION</p><h1>How to Use the Workflow Tools</h1><p>Choose a process below for a plain-language explanation and step-by-step instructions.</p></div>
      <NavLink to="/">← Home</NavLink>
    </header>

    <nav className="help-jump-links" aria-label="Guide sections">
      {guides.map((guide)=> <a key={guide.id} href={`#${guide.id}`}>{guide.title}</a>)}
    </nav>

    <aside className="help-callout"><strong>Before you begin</strong><span>Connect to the QuickBooks computer when prompted on the Home page. Keep an automation page open until its status says DONE, READY, or shows a success message.</span></aside>

    <div className="help-guides">
      {guides.map((guide, index)=> <section className="help-guide" id={guide.id} key={guide.id}>
        <div className="help-guide-number">{index + 1}</div>
        <div className="help-guide-content">
          <div className="help-guide-title"><div><h2>{guide.title}</h2><p>{guide.summary}</p></div><NavLink to={index === 0 ? '/PO' : index === 1 ? '/make-invoice' : index === 2 ? '/quickbooks-optimizer' : '/shipping-quote'}>Open tool →</NavLink></div>
          <h3>What you need</h3><p>{guide.before}</p>
          <h3>How to use it</h3><ol>{guide.steps.map((step)=> <li key={step}>{step}</li>)}</ol>
          <p className="help-note"><strong>Important:</strong> {guide.note}</p>
        </div>
      </section>)}
    </div>

    <section className="help-status-key"><h2>Status guide</h2><dl><div><dt>IDLE</dt><dd>Nothing is running yet.</dd></div><div><dt>WORKING / CREATING / UPLOADING</dt><dd>The automation is active. Keep the page open.</dd></div><div><dt>DONE / READY</dt><dd>The process finished successfully.</dd></div><div><dt>FLAGGED</dt><dd>The file needs a person to review the displayed details.</dd></div><div><dt>ERROR</dt><dd>The process stopped. Read the on-screen message, correct the issue, and try again.</dd></div></dl></section>
  </main>
}
