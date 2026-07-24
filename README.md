<<<<<<< HEAD
# Linda Fashion Automation

Internal Linda Fashion PO/EDI workflow automation.

## Start

Backend:

```powershell
cd backend
npm install
npm start
```

Frontend:

```powershell
cd frontend
npm install
npm start
```

The React app runs on `http://localhost:3000` and the Express backend uses `http://localhost:2000` unless `backend/config.js` overrides the port.

## Excel To EDI CSV

On the PO page:

1. Click `Add Excel Files` / choose `.xls` or `.xlsx` files.
2. Click `Create CSV`.
3. The backend converts the workbooks and saves generated CSV files into the existing EDI upload folder.
4. Click `Load CSV Files` to see the generated CSVs in the existing upload queue.

Backend route:

```text
POST /api/create-edi-csv
multipart field: excelFiles
```

Default EDI upload folder:

```text
backend/ediUpload
```

Override it with:

```powershell
$env:EDI_UPLOAD_FOLDER="C:\path\to\ediUpload"
```

## CSV Format

Generated CSVs use the Linda Fashion EDI format without an index column:

```text
STYLE#, ITEM#, DESC1, DESC2, DESC3, DESC4, CAT, SUBCAT, VEND#, VENDOR PRODUCTION#, RMB.COST, ARB.COST2, FOB, QTY, UM, SELLPRC1, SELLPRC2, SELLPRC3, SELLPRC4, SELLPRC5, SELLPRC6, SEASON, WH, DUTY%, COMM%, MISC%, PC/CTN, GENDER
```

Output filenames use:

```text
<Vendor> <OrderDate> <DeliveryDate> <PO>.csv
```

Example:

```text
Liang Guo 2026-07-12 2026-08-05 A0064.csv
```

## PO Overrides

Add unusual PO rules in:

```text
backend/config/ediConversionConfig.js
```

Use `poOverrides` for vendor/date/item-source/quantity/unit/item-translation rules. Example:

```js
'S00178': {
    vendor: 'E2-5788',
    quantityDivisor: 12,
    forceUnit: 'DZ',
    itemTranslations: {
        '红色': 'RED BOX',
        '蓝色': 'BLUE BOX',
    },
}
```

## FedEx labels from QuickBooks Optimizer

The QuickBooks PO page can create a 4x6 PDF FedEx label and a printable shipment transaction record after extracting the purchase order. Configure these values in `backend/.env` (use `sandbox` until the label has been certified and verified):

```text
FEDEX_ENVIRONMENT=sandbox
FEDEX_SANDBOX_FORCE_SENDER=true
FEDEX_CLIENT_ID=your-project-api-key
FEDEX_CLIENT_SECRET=your-project-secret
FEDEX_ACCOUNT_NUMBER=your-shipper-account
FEDEX_SHIPPER_NAME=Shipping Department
FEDEX_SHIPPER_COMPANY=Tanslin Premium
FEDEX_SHIPPER_PHONE=1234567890
FEDEX_SHIPPER_STREET=2195 Elizabeth Ave 1st Floor
FEDEX_SHIPPER_CITY=Rahway
FEDEX_SHIPPER_STATE=NJ
FEDEX_SHIPPER_POSTAL_CODE=07065
FEDEX_SHIPPER_COUNTRY=US
```

If the PO contains a different FedEx account number, the shipment is billed as `THIRD_PARTY`; otherwise it is billed to `SENDER`. Labels default to `Quickbooks optimizer/data/shipping_labels`. Override that location with `FEDEX_LABEL_DIR`.

FedEx sandbox does not recognize most production third-party customer accounts. `FEDEX_SANDBOX_FORCE_SENDER=true` bills sandbox tests to the test project account only. Remove this override in production so the PO's shipping account instructions are followed.

## Tests

Backend conversion tests:

```powershell
cd backend
npm test
```

Frontend production build:

```powershell
cd frontend
npm run build
```

## Troubleshooting

- If a workbook fails, check the result panel for the per-file error.
- If a CSV does not appear in the upload queue, confirm it was saved into `backend/ediUpload` or the folder set by `EDI_UPLOAD_FOLDER`.
- If dates show `UNKNOWN-DATE`, add a PO override in `backend/config/ediConversionConfig.js`.
- If the wrong vendor is used, add an agent mapping or PO-specific vendor override in `backend/config/ediConversionConfig.js`.
=======
# PO to EDI Automation Workflow

A Node.js/React workflow for converting purchase order data into EDI-ready CSV files and automating parts of the upload process into an EDI system.

## Features
- Parses purchase order data and prepares CSV files for EDI upload
- Lists pending CSV files and tracks upload progress
- Uses environment variables for private EDI credentials
- Handles vendor lookup and upload status checks
- Separates private company-specific spreadsheet logic from the public repo

## Tech Stack
- Node.js
- Express
- React
- Puppeteer
- JavaScript
- dotenv

## Security
Credentials are stored in a local `.env` file and excluded from GitHub.
A `.env.example` file is provided for setup.
>>>>>>> 63afdce6c02aca4c71bc57f1b4567a445a7ec035
