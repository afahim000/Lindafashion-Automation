param(
    [Parameter(Mandatory = $true)]
    [string]$JsonPath,

    [string]$CompanyFile = "",
    [string]$QbxmlVersion = "10.0",
    [switch]$CreateInvoice,
    [switch]$SkipSalesOrder,
    [switch]$AllowSalesOrder,
    [string]$SalesOrderTxnId = "",
    [string]$ExistingInvoiceTxnId = "",
    [string]$ExistingInvoicePoNumber = "",
    [switch]$PrintExistingInvoiceOnly,
    [switch]$TestExistingInvoiceTemplateSwitchOnly,
    [switch]$DisplayExistingInvoiceOnly,
    [string]$NetworkUsername = "",
    [string]$QuickBooksPdfOutputDirectory = "",
    [string]$QuickBooksPhysicalPrinterName = "Brother HL-L6200DW series Printer",
    [string]$StoredInvoiceTemplateName = "AP Tanslin Invoice",
    [string]$CustomerSalesOrderTemplateName = "Tanslin Customer Sales Order",
    [string]$OnlyQuickBooksTemplateName = "",
    [int]$TemplateSwitchAttempts = 6,
    [int]$TemplateSwitchRetryDelaySeconds = 5,
    [switch]$NoAutoStartQuickBooks,
    [switch]$PromptNetworkCredential,
    [switch]$UseCompanyFilePathForSdkSession,
    [switch]$CheckCompanyFileOnly,
    [switch]$PrintQuickBooksInvoicePdf,
    [switch]$SkipQuickBooksPhysicalPrint,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$DefaultCompanyFilePath = Join-Path $ProjectRoot "config\tanslin-company-file.txt"
$DefaultNetworkUsernamePath = Join-Path $ProjectRoot "config\tanslin-network-username.txt"
$QuickBooksResponseDirectory = Join-Path $ProjectRoot "data\quickbooks_responses"
$script:TemporaryNetworkDriveName = $null
$FixedUnitPrice = [decimal]"8.79"

if ([string]::IsNullOrWhiteSpace($CompanyFile) -and (Test-Path -LiteralPath $DefaultCompanyFilePath -PathType Leaf)) {
    $CompanyFile = (Get-Content -LiteralPath $DefaultCompanyFilePath -Raw).Trim()
}

if ([string]::IsNullOrWhiteSpace($NetworkUsername) -and (Test-Path -LiteralPath $DefaultNetworkUsernamePath -PathType Leaf)) {
    $NetworkUsername = (Get-Content -LiteralPath $DefaultNetworkUsernamePath -Raw).Trim()
}

if ([string]::IsNullOrWhiteSpace($QuickBooksPdfOutputDirectory)) {
    $QuickBooksPdfOutputDirectory = Join-Path $env:USERPROFILE "Downloads"
}

function Escape-QbXml {
    param([AllowNull()][object]$Value)
    if ($null -eq $Value) { return "" }
    return [System.Security.SecurityElement]::Escape([string]$Value)
}

function Format-QbDate {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return (Get-Date).ToString("yyyy-MM-dd")
    }
    return ([datetime]::Parse($Value)).ToString("yyyy-MM-dd")
}

function Add-DaysToQbDate {
    param(
        [string]$Value,
        [int]$Days
    )
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return (Get-Date).AddDays($Days).ToString("yyyy-MM-dd")
    }
    return ([datetime]::Parse($Value)).AddDays($Days).ToString("yyyy-MM-dd")
}

function Get-PoValue {
    param(
        [object]$Object,
        [string]$Name,
        [string]$Default = ""
    )
    if ($null -ne $Object -and ($Object.PSObject.Properties.Name -contains $Name)) {
        $value = $Object.$Name
        if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value)) {
            return [string]$value
        }
    }
    return $Default
}

function Build-OptionalRef {
    param(
        [string]$ElementName,
        [string]$FullName,
        [int]$Indent = 8
    )
    if ([string]::IsNullOrWhiteSpace($FullName)) {
        return ""
    }
    $spaces = " " * $Indent
    $childSpaces = " " * ($Indent + 2)
    $escaped = Escape-QbXml $FullName
@"
$spaces<$ElementName>
$childSpaces<FullName>$escaped</FullName>
$spaces</$ElementName>
"@
}

function Build-OptionalElement {
    param(
        [string]$ElementName,
        [string]$Value,
        [int]$Indent = 8
    )
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ""
    }
    $spaces = " " * $Indent
    $escaped = Escape-QbXml $Value
    return "$spaces<$ElementName>$escaped</$ElementName>"
}

function Build-AddressXml {
    param(
        [string]$ElementName,
        [object]$Address,
        [int]$Indent = 8
    )
    if ($null -eq $Address -or -not ($Address.PSObject.Properties.Name -contains "name")) {
        return ""
    }

    $lines = @()
    $lines += [string]$Address.name
    if ($Address.PSObject.Properties.Name -contains "address") {
        foreach ($line in $Address.address) {
            if (-not [string]::IsNullOrWhiteSpace([string]$line)) {
                $lines += [string]$line
            }
        }
    }

    if ($lines.Count -eq 0) {
        return ""
    }

    $spaces = " " * $Indent
    $childSpaces = " " * ($Indent + 2)
    $lineXml = for ($i = 0; $i -lt [Math]::Min($lines.Count, 5); $i++) {
        $tag = "Addr" + ($i + 1)
        $escaped = Escape-QbXml $lines[$i]
        "$childSpaces<$tag>$escaped</$tag>"
    }

@"
$spaces<$ElementName>
$($lineXml -join "`n")
$spaces</$ElementName>
"@
}

function Get-UncParts {
    param([string]$Path)
    if ($Path -notmatch "^\\\\([^\\]+)\\([^\\]+)") {
        return $null
    }

    return [pscustomobject]@{
        Server = $Matches[1]
        Share = $Matches[2]
        SharePath = "\\$($Matches[1])\$($Matches[2])"
    }
}

function Connect-NetworkShare {
    param([string]$Path)

    if (-not $PromptNetworkCredential -or [string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    $unc = Get-UncParts -Path $Path
    if (-not $unc) {
        return
    }

    $message = "Enter the password for $($unc.SharePath). The password is used for this run only and is not saved by this script."
    if ([string]::IsNullOrWhiteSpace($NetworkUsername)) {
        $credential = Get-Credential -Message $message
    }
    else {
        $credential = Get-Credential -UserName $NetworkUsername -Message $message
    }

    $driveName = "QB" + ([guid]::NewGuid().ToString("N").Substring(0, 8))
    New-PSDrive -Name $driveName -PSProvider FileSystem -Root $unc.SharePath -Credential $credential -Scope Script | Out-Null
    $script:TemporaryNetworkDriveName = $driveName
    Write-Host "Connected to network share '$($unc.SharePath)' for this run."
}

function Test-CompanyFileReachable {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        Write-Warning "No -CompanyFile was supplied. QuickBooks will use the currently open company file, so this script cannot verify that it is the Tanslin file."
        return
    }

    $resolvedPath = Resolve-CompanyFilePath -Path $Path
    $unc = Get-UncParts -Path $resolvedPath
    if ($unc) {
        Write-Host "Checking network host '$($unc.Server)' and share '$($unc.Share)'..."

        $shareReachable = Test-Path -LiteralPath $unc.SharePath
        if (-not $shareReachable) {
            throw "The network share '$($unc.SharePath)' is not reachable. The computer that stores the Tanslin QuickBooks file may be off, asleep, disconnected, or the share name may have changed."
        }
    }

    $parent = Split-Path -Parent $resolvedPath
    if (-not [string]::IsNullOrWhiteSpace($parent) -and -not (Test-Path -LiteralPath $parent)) {
        throw "The QuickBooks company-file folder '$parent' is not reachable."
    }

    if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
        throw "The QuickBooks company file '$Path' was not found. Confirm the Tanslin .QBW path and make sure the host computer is on."
    }

    $extension = [System.IO.Path]::GetExtension($resolvedPath)
    if ($extension -and $extension.ToLowerInvariant() -ne ".qbw") {
        Write-Warning "Company file path does not end in .QBW: $resolvedPath"
    }

    $script:CompanyFile = $resolvedPath
    Write-Host "Company file is reachable: $resolvedPath"
}

function Test-QuickBooksDesktopRunning {
    $quickBooksProcesses = @(Get-Process -Name "QBW32" -ErrorAction SilentlyContinue)

    if ($quickBooksProcesses.Count -eq 0) {
        throw @"
QuickBooks Desktop is not running.

Open QuickBooks Desktop on this computer first, open the Tanslin company file, and log in as the QuickBooks user. Then press the QuickBooks Optimizer button again.

The script checks the shared .QBW file path, but the SDK transaction must attach to a running QuickBooks Desktop session.
"@
    }

    Write-Host "QuickBooks Desktop appears to be running."
}

function Test-QuickBooksDesktopProcessRunning {
    $quickBooksProcesses = @(Get-Process -Name "QBW32" -ErrorAction SilentlyContinue)
    return ($quickBooksProcesses.Count -gt 0)
}

function Resolve-CompanyFilePath {
    param([string]$Path)

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        return $Path
    }

    if (Test-Path -LiteralPath $Path -PathType Container) {
        $qbwFiles = @(Get-ChildItem -LiteralPath $Path -Filter "*.qbw" -File)
        if ($qbwFiles.Count -eq 1) {
            return $qbwFiles[0].FullName
        }
        if ($qbwFiles.Count -gt 1) {
            $names = ($qbwFiles | ForEach-Object { $_.FullName }) -join "; "
            throw "The folder '$Path' contains multiple .QBW files. Pass the exact company file path. Found: $names"
        }
        throw "The folder '$Path' is reachable, but no .QBW file was found inside it."
    }

    if ([System.IO.Path]::GetExtension($Path) -eq "") {
        $qbwCandidate = "$Path.qbw"
        if (Test-Path -LiteralPath $qbwCandidate -PathType Leaf) {
            return $qbwCandidate
        }
    }

    return $Path
}

function Build-SalesOrderAdd {
    param(
        [object]$Po,
        [switch]$Minimal
    )

    $customerName = Escape-QbXml $Po.quickbooks_customer_full_name
    $txnDate = Format-QbDate $Po.transaction_date
    $refNumber = Escape-QbXml $Po.sales_order_number
    $poNumber = Escape-QbXml (Get-PoValue -Object $Po -Name "po_number" -Default (Get-PoValue -Object $Po -Name "customer_po_number"))
    $shipMethod = Escape-QbXml $Po.ship_method
    $shipDate = Format-QbDate $Po.transaction_date
    $classXml = Build-OptionalRef -ElementName "ClassRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_class_full_name")
    $arAccountXml = Build-OptionalRef -ElementName "ARAccountRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_ar_account_full_name" -Default "Accounts Receivable")
    $templateXml = Build-OptionalRef -ElementName "TemplateRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_invoice_template_full_name" -Default $StoredInvoiceTemplateName)
    $termsXml = Build-OptionalRef -ElementName "TermsRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_terms_full_name")
    $repXml = Build-OptionalRef -ElementName "SalesRepRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_rep_full_name")
    $fobXml = Build-OptionalElement -ElementName "FOB" -Value (Get-PoValue -Object $Po -Name "quickbooks_fob")
    $customerTaxCodeXml = Build-OptionalRef -ElementName "CustomerSalesTaxCodeRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_customer_tax_code_full_name" -Default "Non")
    $shipAddressXml = Build-AddressXml -ElementName "ShipAddress" -Address $Po.ship_to
    $memo = Escape-QbXml ("Source PO {0}; Customer reference: {1}; Shipping account: {2}" -f $Po.po_number, $Po.customer_reference, $Po.shipping_account_number)

    $lineXml = foreach ($line in $Po.lines) {
        $item = Escape-QbXml (Get-PoValue -Object $line -Name "quickbooks_item_full_name" -Default $line.item_name)
        $desc = Escape-QbXml $line.description
        $qty = [decimal]$line.quantity
        $rate = "{0:0.####}" -f $FixedUnitPrice
@"
      <SalesOrderLineAdd>
        <ItemRef>
          <FullName>$item</FullName>
        </ItemRef>
        <Desc>$desc</Desc>
        <Quantity>$qty</Quantity>
        <Rate>$rate</Rate>
        <SalesTaxCodeRef>
          <FullName>Non</FullName>
        </SalesTaxCodeRef>
      </SalesOrderLineAdd>
"@
    }

    if ($Minimal) {
@"
<?xml version="1.0"?>
<?qbxml version="$QbxmlVersion"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <SalesOrderAddRq requestID="sales-order-minimal-$($Po.po_number)">
      <SalesOrderAdd>
        <CustomerRef>
          <FullName>$customerName</FullName>
        </CustomerRef>
        <TxnDate>$txnDate</TxnDate>
        <RefNumber>$refNumber</RefNumber>
        <CustomerSalesTaxCodeRef>
          <FullName>Non</FullName>
        </CustomerSalesTaxCodeRef>
$($lineXml -join "`n")
      </SalesOrderAdd>
    </SalesOrderAddRq>
  </QBXMLMsgsRq>
</QBXML>
"@
        return
    }

@"
<?xml version="1.0"?>
<?qbxml version="$QbxmlVersion"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <SalesOrderAddRq requestID="sales-order-$($Po.po_number)">
      <SalesOrderAdd>
        <CustomerRef>
          <FullName>$customerName</FullName>
        </CustomerRef>
$classXml
        <TxnDate>$txnDate</TxnDate>
        <RefNumber>$refNumber</RefNumber>
        $shipAddressXml
        <PONumber>$poNumber</PONumber>
$termsXml
$repXml
$fobXml
        <ShipDate>$shipDate</ShipDate>
        <ShipMethodRef>
          <FullName>$shipMethod</FullName>
        </ShipMethodRef>
        <Memo>$memo</Memo>
        <IsToBePrinted>true</IsToBePrinted>
        <CustomerSalesTaxCodeRef>
          <FullName>Non</FullName>
        </CustomerSalesTaxCodeRef>
$($lineXml -join "`n")
      </SalesOrderAdd>
    </SalesOrderAddRq>
  </QBXMLMsgsRq>
</QBXML>
"@
}

function Build-InvoiceAdd {
    param([object]$Po)

    $customerName = Escape-QbXml $Po.quickbooks_customer_full_name
    $txnDate = Format-QbDate $Po.transaction_date
    $dueDate = Add-DaysToQbDate -Value $Po.transaction_date -Days 30
    $poNumber = Escape-QbXml (Get-PoValue -Object $Po -Name "po_number" -Default (Get-PoValue -Object $Po -Name "customer_po_number"))
    $shipMethod = Escape-QbXml $Po.ship_method
    $shipDate = Format-QbDate $Po.transaction_date
    $classXml = Build-OptionalRef -ElementName "ClassRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_class_full_name")
    $arAccountXml = Build-OptionalRef -ElementName "ARAccountRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_ar_account_full_name" -Default "Accounts Receivable")
    $templateXml = Build-OptionalRef -ElementName "TemplateRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_invoice_template_full_name" -Default $StoredInvoiceTemplateName)
    $termsXml = Build-OptionalRef -ElementName "TermsRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_terms_full_name")
    $repXml = Build-OptionalRef -ElementName "SalesRepRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_rep_full_name")
    $fobXml = Build-OptionalElement -ElementName "FOB" -Value (Get-PoValue -Object $Po -Name "quickbooks_fob")
    $customerTaxCodeXml = Build-OptionalRef -ElementName "CustomerSalesTaxCodeRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_customer_tax_code_full_name" -Default "Non")
    $shipAddressXml = Build-AddressXml -ElementName "ShipAddress" -Address $Po.ship_to
    $memo = Escape-QbXml ("Invoice for PO {0}; Sales order {1}; Customer reference: {2}" -f $Po.po_number, $Po.sales_order_number, $Po.customer_reference)
    $refNumberXml = ""
    if (-not [string]::IsNullOrWhiteSpace([string]$Po.quickbooks_invoice_ref_number)) {
        $invoiceRef = Escape-QbXml $Po.quickbooks_invoice_ref_number
        $refNumberXml = "        <RefNumber>$invoiceRef</RefNumber>`n"
    }

    $lineXml = foreach ($line in $Po.lines) {
        $item = Escape-QbXml (Get-PoValue -Object $line -Name "quickbooks_item_full_name" -Default $line.item_name)
        $desc = Escape-QbXml $line.description
        $qty = [decimal]$line.quantity
        $rate = "{0:0.####}" -f $FixedUnitPrice
@"
      <InvoiceLineAdd>
        <ItemRef>
          <FullName>$item</FullName>
        </ItemRef>
        <Desc>$desc</Desc>
        <Quantity>$qty</Quantity>
        <Rate>$rate</Rate>
        <SalesTaxCodeRef>
          <FullName>Non</FullName>
        </SalesTaxCodeRef>
      </InvoiceLineAdd>
"@
    }

@"
<?xml version="1.0"?>
<?qbxml version="$QbxmlVersion"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <InvoiceAddRq requestID="invoice-$($Po.po_number)">
      <InvoiceAdd>
        <CustomerRef>
          <FullName>$customerName</FullName>
        </CustomerRef>
$classXml
$arAccountXml
$templateXml
        <TxnDate>$txnDate</TxnDate>
        $shipAddressXml
$refNumberXml        <PONumber>$poNumber</PONumber>
$termsXml
        <DueDate>$dueDate</DueDate>
$repXml
$fobXml
        <ShipDate>$shipDate</ShipDate>
        <ShipMethodRef>
          <FullName>$shipMethod</FullName>
        </ShipMethodRef>
        <Memo>$memo</Memo>
        <IsToBePrinted>true</IsToBePrinted>
$customerTaxCodeXml
$($lineXml -join "`n")
      </InvoiceAdd>
    </InvoiceAddRq>
  </QBXMLMsgsRq>
</QBXML>
"@
}

function Build-InvoiceAddFromSalesOrder {
    param(
        [object]$Po,
        [string]$LinkedTxnId
    )

    $customerName = Escape-QbXml $Po.quickbooks_customer_full_name
    $txnDate = Format-QbDate $Po.transaction_date
    $dueDate = Add-DaysToQbDate -Value $Po.transaction_date -Days 30
    $poNumber = Escape-QbXml (Get-PoValue -Object $Po -Name "po_number" -Default (Get-PoValue -Object $Po -Name "customer_po_number"))
    $arAccountXml = Build-OptionalRef -ElementName "ARAccountRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_ar_account_full_name" -Default "Accounts Receivable")
    $templateXml = Build-OptionalRef -ElementName "TemplateRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_invoice_template_full_name" -Default $StoredInvoiceTemplateName)
    $termsXml = Build-OptionalRef -ElementName "TermsRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_terms_full_name")
    $repXml = Build-OptionalRef -ElementName "SalesRepRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_rep_full_name")
    $fobXml = Build-OptionalElement -ElementName "FOB" -Value (Get-PoValue -Object $Po -Name "quickbooks_fob")
    $customerTaxCodeXml = Build-OptionalRef -ElementName "CustomerSalesTaxCodeRef" -FullName (Get-PoValue -Object $Po -Name "quickbooks_customer_tax_code_full_name" -Default "Non")
    $memo = Escape-QbXml ("Invoice for PO {0}; converted from Sales Order {1}; Customer reference: {2}" -f $Po.po_number, $Po.sales_order_number, $Po.customer_reference)
    $linked = Escape-QbXml $LinkedTxnId
    $refNumberXml = ""
    if (-not [string]::IsNullOrWhiteSpace([string]$Po.quickbooks_invoice_ref_number)) {
        $invoiceRef = Escape-QbXml $Po.quickbooks_invoice_ref_number
        $refNumberXml = "        <RefNumber>$invoiceRef</RefNumber>`n"
    }

@"
<?xml version="1.0"?>
<?qbxml version="$QbxmlVersion"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <InvoiceAddRq requestID="invoice-$($Po.po_number)">
      <InvoiceAdd>
        <CustomerRef>
          <FullName>$customerName</FullName>
        </CustomerRef>
$arAccountXml
$templateXml
        <TxnDate>$txnDate</TxnDate>
$refNumberXml        <PONumber>$poNumber</PONumber>
$termsXml
        <DueDate>$dueDate</DueDate>
$repXml
$fobXml
        <Memo>$memo</Memo>
        <IsToBePrinted>true</IsToBePrinted>
$customerTaxCodeXml
        <LinkToTxnID>$linked</LinkToTxnID>
      </InvoiceAdd>
    </InvoiceAddRq>
  </QBXMLMsgsRq>
</QBXML>
"@
}

function New-QuickBooksRequestProcessor {
    $progIds = @(
        "QBXMLRP2.RequestProcessor",
        "QBXMLRP.RequestProcessor"
    )

    foreach ($progId in $progIds) {
        try {
            $processor = New-Object -ComObject $progId
            if ($null -ne $processor) {
                return [pscustomobject]@{
                    ProgId = $progId
                    Processor = $processor
                }
            }
        }
        catch {
            Write-Warning "Could not create COM object $progId. Error: $($_.Exception.Message)"
        }
    }

    throw @"
QuickBooks Desktop SDK is not registered on this Windows computer.

The company file is reachable, but Windows cannot create either COM object:
QBXMLRP2.RequestProcessor
QBXMLRP.RequestProcessor

Install or repair the QuickBooks Desktop SDK / QBXML Request Processor for this machine, then run this script again. If it is already installed, register/repair the SDK as Administrator.
"@
}

function Open-QuickBooksConnection {
    param(
        [object]$RequestProcessor,
        [string]$ProgId
    )

    try {
        $RequestProcessor.OpenConnection2("", "QuickBooks PO Sales Order Invoice Importer", 1)
        return
    }
    catch {
        Write-Warning "$ProgId OpenConnection2 failed, trying legacy OpenConnection. Original error: $($_.Exception.Message)"
    }

    try {
        $RequestProcessor.OpenConnection("", "QuickBooks PO Sales Order Invoice Importer")
        return
    }
    catch {
        throw @"
QuickBooks SDK COM object '$ProgId' exists, but neither OpenConnection2 nor legacy OpenConnection worked.

This usually means the QuickBooks SDK Request Processor type library is damaged/mismatched on this computer, or the installed SDK version is not registering the request processor correctly for this QuickBooks/Windows combination.

Repair/reinstall the QuickBooks Desktop SDK as Administrator. If the SDK installer includes a separate QBXMLRP2 or Request Processor redistributable, run that repair too.

Original error: $($_.Exception.Message)
"@
    }
}

function Invoke-QuickBooksRequest {
    param([string]$RequestXml)

    if ($DryRun) {
        $RequestXml
        return
    }

    $requestProcessorInfos = @()
    foreach ($progId in @("QBXMLRP2.RequestProcessor", "QBXMLRP.RequestProcessor")) {
        try {
            $processor = New-Object -ComObject $progId
            if ($null -ne $processor) {
                $requestProcessorInfos += [pscustomobject]@{
                    ProgId = $progId
                    Processor = $processor
                }
            }
        }
        catch {
            Write-Warning "Could not create COM object $progId. Error: $($_.Exception.Message)"
        }
    }

    if ($requestProcessorInfos.Count -eq 0) {
        throw @"
QuickBooks Desktop SDK is not registered on this Windows computer.

The company file is reachable, but Windows cannot create either COM object:
QBXMLRP2.RequestProcessor
QBXMLRP.RequestProcessor

Install or repair the QuickBooks Desktop SDK / QBXML Request Processor for this machine, then run this script again. If it is already installed, register/repair the SDK as Administrator.
"@
    }

    $lastConnectionError = $null
    foreach ($requestProcessorInfo in $requestProcessorInfos) {
        try {
            return Invoke-QuickBooksRequestWithProcessor -RequestXml $RequestXml -RequestProcessorInfo $requestProcessorInfo
        }
        catch {
            $lastConnectionError = $_.Exception.Message
            if ($lastConnectionError -like "*QuickBooks rejected the QBXML transaction*") {
                throw $lastConnectionError
            }
            Write-Warning "$($requestProcessorInfo.ProgId) failed. Trying next QuickBooks SDK request processor if available. Error: $lastConnectionError"
        }
    }

    throw @"
All available QuickBooks SDK request processors failed before the transaction could be sent.

Last error: $lastConnectionError

If the last error says "Could not start QuickBooks", open QuickBooks Desktop manually, open the Tanslin company file, log in, then try again.
"@
}

function Invoke-QuickBooksQuery {
    param([string]$RequestXml)
    return Invoke-QuickBooksRequest -RequestXml $RequestXml
}

function Write-ItemAccountPreflight {
    param([object]$Po)

    if ($DryRun) {
        return
    }

    foreach ($line in $Po.lines) {
        $itemName = Get-PoValue -Object $line -Name "quickbooks_item_full_name" -Default $line.item_name
        if ([string]::IsNullOrWhiteSpace($itemName)) {
            continue
        }

        $escapedItem = Escape-QbXml $itemName
        $queryXml = @"
<?xml version="1.0"?>
<?qbxml version="$QbxmlVersion"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <ItemInventoryQueryRq requestID="item-preflight-$($line.line_number)">
      <FullName>$escapedItem</FullName>
    </ItemInventoryQueryRq>
  </QBXMLMsgsRq>
</QBXML>
"@

        try {
            $response = Invoke-QuickBooksQuery -RequestXml $queryXml
            [xml]$itemXml = $response
            $itemNode = $itemXml.SelectSingleNode("//*[local-name()='ItemInventoryRet']")
            if ($null -eq $itemNode) {
                Write-Warning "QuickBooks item preflight did not return item '$itemName'."
                continue
            }

            $income = ""
            $cogs = ""
            $asset = ""
            $taxCode = ""
            $incomeNode = $itemNode.SelectSingleNode("*[local-name()='IncomeAccountRef']/*[local-name()='FullName']")
            $cogsNode = $itemNode.SelectSingleNode("*[local-name()='COGSAccountRef']/*[local-name()='FullName']")
            $assetNode = $itemNode.SelectSingleNode("*[local-name()='AssetAccountRef']/*[local-name()='FullName']")
            $taxCodeNode = $itemNode.SelectSingleNode("*[local-name()='SalesTaxCodeRef']/*[local-name()='FullName']")
            if ($null -ne $incomeNode) { $income = $incomeNode.InnerText }
            if ($null -ne $cogsNode) { $cogs = $cogsNode.InnerText }
            if ($null -ne $assetNode) { $asset = $assetNode.InnerText }
            if ($null -ne $taxCodeNode) { $taxCode = $taxCodeNode.InnerText }
            Write-Host "QuickBooks item preflight for '$itemName': IncomeAccount='$income'; COGSAccount='$cogs'; AssetAccount='$asset'; SalesTaxCode='$taxCode'"
        }
        catch {
            Write-Warning "Could not run QuickBooks item preflight for '$itemName'. Error: $($_.Exception.Message)"
        }
    }
}

function Assert-QbXmlResponseSuccess {
    param(
        [string]$ResponseXml,
        [string]$RequestDescription = "QuickBooks request"
    )

    if ([string]::IsNullOrWhiteSpace($ResponseXml)) {
        throw "$RequestDescription returned an empty response from QuickBooks."
    }

    try {
        [xml]$parsedResponse = $ResponseXml
    }
    catch {
        throw "$RequestDescription returned response XML that could not be parsed. Original error: $($_.Exception.Message)"
    }

    $responseNode = $parsedResponse.SelectSingleNode("//*[@statusCode]")
    if ($null -eq $responseNode) {
        throw "$RequestDescription returned XML with no QuickBooks status code."
    }

    $statusCode = $responseNode.Attributes["statusCode"].Value
    $statusSeverity = ""
    $statusMessage = ""
    if ($null -ne $responseNode.Attributes["statusSeverity"]) {
        $statusSeverity = $responseNode.Attributes["statusSeverity"].Value
    }
    if ($null -ne $responseNode.Attributes["statusMessage"]) {
        $statusMessage = $responseNode.Attributes["statusMessage"].Value
    }

    if ($statusCode -ne "0") {
        $details = "QuickBooks rejected $RequestDescription. statusCode=$statusCode"
        if (-not [string]::IsNullOrWhiteSpace($statusSeverity)) {
            $details += "; severity=$statusSeverity"
        }
        if (-not [string]::IsNullOrWhiteSpace($statusMessage)) {
            $details += "; message=$statusMessage"
        }
        throw $details
    }

    return $parsedResponse
}

function Test-QuickBooksTransactionLockError {
    param([string]$Message)

    if ([string]::IsNullOrWhiteSpace($Message)) {
        return $false
    }

    return ($Message -match "statusCode=3175" -or
        $Message -match "statusCode=3200" -or
        $Message -match "transaction could not be locked" -or
        $Message -match "already in use" -or
        $Message -match "edit sequence.*out-of-date")
}

function Save-QuickBooksResponse {
    param(
        [string]$ResponseXml,
        [string]$PoNumber,
        [string]$Kind
    )

    if ([string]::IsNullOrWhiteSpace($ResponseXml)) {
        return ""
    }

    New-Item -ItemType Directory -Path $QuickBooksResponseDirectory -Force | Out-Null
    $safePoNumber = ([string]$PoNumber) -replace '[^\w.-]', '_'
    if ([string]::IsNullOrWhiteSpace($safePoNumber)) {
        $safePoNumber = "unknown-po"
    }
    $responsePath = Join-Path $QuickBooksResponseDirectory "$safePoNumber-$Kind-response.xml"
    [System.IO.File]::WriteAllText($responsePath, $ResponseXml)
    return $responsePath
}

function Save-QuickBooksPayload {
    param(
        [string]$Xml,
        [string]$Name
    )

    if ([string]::IsNullOrWhiteSpace($Xml)) {
        return ""
    }

    New-Item -ItemType Directory -Path $QuickBooksResponseDirectory -Force | Out-Null
    $safeName = ([string]$Name) -replace '[^\w.-]', '_'
    if ([string]::IsNullOrWhiteSpace($safeName)) {
        $safeName = "quickbooks-payload"
    }
    $path = Join-Path $QuickBooksResponseDirectory $safeName
    [System.IO.File]::WriteAllText($path, $Xml)
    return $path
}

function Format-PoForFileName {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return "UNKNOWN"
    }
    $text = $Value.Trim()
    if ($text -match '^(?i)P(\d.+)$') {
        return "P $($Matches[1])"
    }
    return $text
}

function ConvertTo-SafeFileNamePart {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ""
    }

    $invalidPattern = "[{0}]" -f [System.Text.RegularExpressions.Regex]::Escape((-join [System.IO.Path]::GetInvalidFileNameChars()))
    $safe = [System.Text.RegularExpressions.Regex]::Replace($Value.Trim(), $invalidPattern, "_")
    $safe = [System.Text.RegularExpressions.Regex]::Replace($safe, "\s+", " ")
    return $safe.Trim()
}

function Get-InvoiceInfoFromResponse {
    param([string]$ResponseXml)

    $info = [ordered]@{
        TxnID = ""
        EditSequence = ""
        RefNumber = ""
        TemplateFullName = ""
    }
    if ([string]::IsNullOrWhiteSpace($ResponseXml)) {
        return [pscustomobject]$info
    }

    try {
        [xml]$xml = $ResponseXml
        $txnIdNode = $xml.SelectSingleNode("//*[local-name()='InvoiceRet']/*[local-name()='TxnID']")
        $editSequenceNode = $xml.SelectSingleNode("//*[local-name()='InvoiceRet']/*[local-name()='EditSequence']")
        $refNode = $xml.SelectSingleNode("//*[local-name()='InvoiceRet']/*[local-name()='RefNumber']")
        $templateNode = $xml.SelectSingleNode("//*[local-name()='InvoiceRet']/*[local-name()='TemplateRef']/*[local-name()='FullName']")
        if ($txnIdNode) { $info.TxnID = $txnIdNode.InnerText }
        if ($editSequenceNode) { $info.EditSequence = $editSequenceNode.InnerText }
        if ($refNode) { $info.RefNumber = $refNode.InnerText }
        if ($templateNode) { $info.TemplateFullName = $templateNode.InnerText }
    }
    catch {
        Write-Warning "Could not read invoice details from QuickBooks response: $($_.Exception.Message)"
    }

    return [pscustomobject]$info
}

function Merge-InvoiceInfo {
    param(
        [object]$Current,
        [object]$Updated
    )

    return [pscustomobject]@{
        TxnID = Get-PoValue -Object $Updated -Name "TxnID" -Default (Get-PoValue -Object $Current -Name "TxnID")
        EditSequence = Get-PoValue -Object $Updated -Name "EditSequence" -Default (Get-PoValue -Object $Current -Name "EditSequence")
        RefNumber = Get-PoValue -Object $Updated -Name "RefNumber" -Default (Get-PoValue -Object $Current -Name "RefNumber")
        TemplateFullName = Get-PoValue -Object $Updated -Name "TemplateFullName" -Default (Get-PoValue -Object $Current -Name "TemplateFullName")
    }
}

function Build-InvoiceQuery {
    param([string]$TxnId)

    $escapedTxnId = Escape-QbXml $TxnId
@"
<?xml version="1.0"?>
<?qbxml version="$QbxmlVersion"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <InvoiceQueryRq requestID="invoice-query-$([guid]::NewGuid().ToString("N").Substring(0, 8))">
      <TxnID>$escapedTxnId</TxnID>
    </InvoiceQueryRq>
  </QBXMLMsgsRq>
</QBXML>
"@
}

function Get-QuickBooksInvoiceInfo {
    param([string]$TxnId)

    if ([string]::IsNullOrWhiteSpace($TxnId)) {
        return [pscustomobject]@{
            TxnID = ""
            EditSequence = ""
            RefNumber = ""
            TemplateFullName = ""
        }
    }

    $queryXml = Build-InvoiceQuery -TxnId $TxnId
    $responseXml = Invoke-QuickBooksRequest -RequestXml $queryXml
    return Get-InvoiceInfoFromResponse -ResponseXml $responseXml
}

function Build-TxnDisplayInvoice {
    param([string]$TxnId)

    $escapedTxnId = Escape-QbXml $TxnId
@"
<?xml version="1.0"?>
<?qbxml version="$QbxmlVersion"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <TxnDisplayModRq requestID="display-invoice-$escapedTxnId">
      <TxnDisplayModType>Invoice</TxnDisplayModType>
      <TxnID>$escapedTxnId</TxnID>
    </TxnDisplayModRq>
  </QBXMLMsgsRq>
</QBXML>
"@
}

function Build-InvoiceTemplateMod {
    param(
        [string]$TxnId,
        [string]$EditSequence,
        [string]$TemplateName
    )

    if ([string]::IsNullOrWhiteSpace($TxnId)) {
        throw "Cannot switch the QuickBooks invoice template because the invoice TxnID is blank."
    }
    if ([string]::IsNullOrWhiteSpace($EditSequence)) {
        throw "Cannot switch the QuickBooks invoice template because the invoice EditSequence is blank."
    }
    if ([string]::IsNullOrWhiteSpace($TemplateName)) {
        throw "Cannot switch the QuickBooks invoice template because the target template name is blank."
    }

    $escapedTxnId = Escape-QbXml $TxnId
    $escapedEditSequence = Escape-QbXml $EditSequence
    $templateXml = Build-OptionalRef -ElementName "TemplateRef" -FullName $TemplateName -Indent 8
@"
<?xml version="1.0"?>
<?qbxml version="$QbxmlVersion"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <InvoiceModRq requestID="invoice-template-$([guid]::NewGuid().ToString("N").Substring(0, 8))">
      <InvoiceMod>
        <TxnID>$escapedTxnId</TxnID>
        <EditSequence>$escapedEditSequence</EditSequence>
$templateXml
      </InvoiceMod>
    </InvoiceModRq>
  </QBXMLMsgsRq>
</QBXML>
"@
}

function Set-QuickBooksInvoiceTemplate {
    param(
        [object]$InvoiceInfo,
        [string]$TemplateName
    )

    $txnId = Get-PoValue -Object $InvoiceInfo -Name "TxnID"
    $editSequence = Get-PoValue -Object $InvoiceInfo -Name "EditSequence"
    $currentTemplate = Get-PoValue -Object $InvoiceInfo -Name "TemplateFullName"

    if ([string]::IsNullOrWhiteSpace($txnId)) {
        throw "Cannot switch the QuickBooks invoice template because QuickBooks did not return a TxnID."
    }

    if ([string]::IsNullOrWhiteSpace($editSequence)) {
        Write-Host "Looking up the latest QuickBooks invoice edit sequence."
        $InvoiceInfo = Get-QuickBooksInvoiceInfo -TxnId $txnId
        $editSequence = Get-PoValue -Object $InvoiceInfo -Name "EditSequence"
        $currentTemplate = Get-PoValue -Object $InvoiceInfo -Name "TemplateFullName"
    }

    if ($currentTemplate -ieq $TemplateName) {
        return $InvoiceInfo
    }

    $maxAttempts = [Math]::Max(1, $TemplateSwitchAttempts)
    $retryDelaySeconds = [Math]::Max(1, $TemplateSwitchRetryDelaySeconds)
    $lastError = ""

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        if ($attempt -gt 1) {
            try {
                Write-Host "Refreshing QuickBooks invoice before template retry $attempt of $maxAttempts."
                $freshInfo = Get-QuickBooksInvoiceInfo -TxnId $txnId
                $InvoiceInfo = Merge-InvoiceInfo -Current $InvoiceInfo -Updated $freshInfo
                $editSequence = Get-PoValue -Object $InvoiceInfo -Name "EditSequence"
                $currentTemplate = Get-PoValue -Object $InvoiceInfo -Name "TemplateFullName"
                if ($currentTemplate -ieq $TemplateName) {
                    return $InvoiceInfo
                }
            }
            catch {
                Write-Warning "Could not refresh the invoice before retrying the template switch: $($_.Exception.Message)"
            }
        }

        Write-Host "Switching QuickBooks invoice template to '$TemplateName'."
        try {
            $modXml = Build-InvoiceTemplateMod -TxnId $txnId -EditSequence $editSequence -TemplateName $TemplateName
            $responseXml = Invoke-QuickBooksRequest -RequestXml $modXml
            $updatedInfo = Get-InvoiceInfoFromResponse -ResponseXml $responseXml
            $mergedInfo = Merge-InvoiceInfo -Current $InvoiceInfo -Updated $updatedInfo

            if ([string]::IsNullOrWhiteSpace((Get-PoValue -Object $updatedInfo -Name "EditSequence")) -or
                ((Get-PoValue -Object $mergedInfo -Name "EditSequence") -eq $editSequence)) {
                try {
                    $freshInfo = Get-QuickBooksInvoiceInfo -TxnId $txnId
                    $mergedInfo = Merge-InvoiceInfo -Current $mergedInfo -Updated $freshInfo
                }
                catch {
                    Write-Warning "Could not query the invoice after switching templates: $($_.Exception.Message)"
                }
            }

            $mergedInfo.TemplateFullName = $TemplateName
            return $mergedInfo
        }
        catch {
            $lastError = $_.Exception.Message
            if (-not (Test-QuickBooksTransactionLockError -Message $lastError) -or $attempt -ge $maxAttempts) {
                throw
            }

            Write-Warning "QuickBooks still has the invoice locked after printing/PDF save. Waiting $retryDelaySeconds seconds before retrying template '$TemplateName' ($($attempt + 1) of $maxAttempts)."
            Start-Sleep -Seconds $retryDelaySeconds
        }
    }

    throw $lastError
}

function Get-QuickBooksInvoicePdfOutputPath {
    param([string]$PoNumber)

    $baseName = "PROFORMA A-Z PO $(Format-PoForFileName -Value $PoNumber)"
    return Join-Path $QuickBooksPdfOutputDirectory "$baseName.pdf"
}

function ConvertTo-CmdQuotedArgument {
    param([string]$Value)

    $escaped = ([string]$Value) -replace '"', '\"'
    return '"' + $escaped + '"'
}

function Invoke-InteractivePowerShellScript {
    param(
        [string]$ScriptPath,
        [string[]]$Arguments,
        [string]$TaskLabel,
        [int]$TimeoutSeconds = 120
    )

    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        throw "Interactive print helper script was not found: $ScriptPath"
    }

    $taskId = [guid]::NewGuid().ToString("N").Substring(0, 12)
    $taskName = "CodexQuickBooksPrint_$taskId"
    $runDirectory = Join-Path $env:TEMP "qbprint-$taskId"
    New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null

    $runnerPath = Join-Path $runDirectory "run.cmd"
    $logPath = Join-Path $runDirectory "print-helper.log"
    $exitCodePath = Join-Path $runDirectory "exit-code.txt"
    $argumentLine = (($Arguments | ForEach-Object { ConvertTo-CmdQuotedArgument -Value $_ }) -join " ")

    $runnerLines = @(
        "@echo off",
        "powershell.exe -NoProfile -ExecutionPolicy Bypass -File $(ConvertTo-CmdQuotedArgument -Value $ScriptPath) $argumentLine > $(ConvertTo-CmdQuotedArgument -Value $logPath) 2>&1",
        "echo %ERRORLEVEL% > $(ConvertTo-CmdQuotedArgument -Value $exitCodePath)"
    )
    [System.IO.File]::WriteAllLines($runnerPath, $runnerLines)

    $createdTask = $false
    try {
        $startTime = (Get-Date).AddMinutes(1).ToString("HH:mm")
        $createOutput = & schtasks.exe /Create /TN $taskName /SC ONCE /ST $startTime /TR $runnerPath /F /IT 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Could not create interactive print task. $($createOutput -join "`n")"
        }
        $createdTask = $true

        $runOutput = & schtasks.exe /Run /TN $taskName 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Could not run interactive print task. $($runOutput -join "`n")"
        }

        Write-Host "Started interactive QuickBooks print task '$TaskLabel'."
        $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        while ((Get-Date) -lt $deadline) {
            if (Test-Path -LiteralPath $exitCodePath -PathType Leaf) {
                break
            }
            Start-Sleep -Seconds 1
        }

        if (-not (Test-Path -LiteralPath $exitCodePath -PathType Leaf)) {
            $partialLog = ""
            if (Test-Path -LiteralPath $logPath -PathType Leaf) {
                $partialLog = Get-Content -LiteralPath $logPath -Raw
            }
            throw "Timed out waiting for interactive QuickBooks print task '$TaskLabel'. Log: $partialLog"
        }

        if (Test-Path -LiteralPath $logPath -PathType Leaf) {
            foreach ($line in (Get-Content -LiteralPath $logPath)) {
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    Write-Host $line
                }
            }
        }

        $exitCodeText = (Get-Content -LiteralPath $exitCodePath -Raw).Trim()
        $exitCode = 0
        if (-not [int]::TryParse($exitCodeText, [ref]$exitCode)) {
            throw "Interactive QuickBooks print task '$TaskLabel' wrote an invalid exit code: $exitCodeText"
        }
        if ($exitCode -ne 0) {
            throw "Interactive QuickBooks print task '$TaskLabel' failed with exit code $exitCode."
        }
    }
    finally {
        if ($createdTask) {
            & schtasks.exe /Delete /TN $taskName /F 2>&1 | Out-Null
        }
    }
}

function Invoke-QuickBooksInvoicePdfPrint {
    param(
        [string]$OutputPath
    )

    $printScript = Join-Path $ProjectRoot "scripts\save_quickbooks_current_invoice_pdf.ps1"
    if (-not (Test-Path -LiteralPath $printScript -PathType Leaf)) {
        throw "The QuickBooks print automation script was not found: $printScript"
    }

    Invoke-InteractivePowerShellScript `
        -ScriptPath $printScript `
        -Arguments @("-OutputPath", $OutputPath) `
        -TaskLabel "PDF $([System.IO.Path]::GetFileName($OutputPath))" `
        -TimeoutSeconds 120
}

function Invoke-QuickBooksInvoicePaperPrint {
    param([string]$TemplateName)

    if ($SkipQuickBooksPhysicalPrint) {
        return
    }

    if ([string]::IsNullOrWhiteSpace($QuickBooksPhysicalPrinterName)) {
        throw "The physical QuickBooks printer name is blank."
    }

    $printScript = Join-Path $ProjectRoot "scripts\print_quickbooks_current_invoice.ps1"
    if (-not (Test-Path -LiteralPath $printScript -PathType Leaf)) {
        throw "The QuickBooks paper print automation script was not found: $printScript"
    }

    Write-Host "Printing QuickBooks invoice template '$TemplateName' to '$QuickBooksPhysicalPrinterName'."
    $printArguments = @("-PrinterName", $QuickBooksPhysicalPrinterName, "-KeepDefaultPrinter")
    Invoke-InteractivePowerShellScript `
        -ScriptPath $printScript `
        -Arguments $printArguments `
        -TaskLabel "Printer $TemplateName" `
        -TimeoutSeconds 90
}

function Invoke-QuickBooksInvoiceUiTemplateSwitch {
    param([string]$TemplateName)

    $switchScript = Join-Path $ProjectRoot "scripts\set_quickbooks_current_invoice_template.ps1"
    if (-not (Test-Path -LiteralPath $switchScript -PathType Leaf)) {
        throw "The QuickBooks template-switch automation script was not found: $switchScript"
    }

    Write-Host "Selecting QuickBooks invoice template '$TemplateName' through the invoice screen and recording the change."
    Invoke-InteractivePowerShellScript `
        -ScriptPath $switchScript `
        -Arguments @("-TemplateName", $TemplateName) `
        -TaskLabel "Template $TemplateName" `
        -TimeoutSeconds 60
}

function Invoke-QuickBooksCloseCurrentInvoiceWithoutPrinting {
    $closeScript = Join-Path $ProjectRoot "scripts\print_quickbooks_current_invoice.ps1"
    Invoke-InteractivePowerShellScript `
        -ScriptPath $closeScript `
        -Arguments @("-CloseInvoiceOnly", "-KeepDefaultPrinter") `
        -TaskLabel "Close invoice form" `
        -TimeoutSeconds 45
}

function Save-QuickBooksPrintedInvoicePdf {
    param(
        [object]$InvoiceInfo,
        [string]$PoNumber
    )

    if (-not $PrintQuickBooksInvoicePdf) {
        Write-Host "QuickBooks print automation is not enabled. The invoice is marked To be printed in QuickBooks."
        return
    }

    $txnId = Get-PoValue -Object $InvoiceInfo -Name "TxnID"
    if ([string]::IsNullOrWhiteSpace($TxnId)) {
        Write-Warning "Invoice was created, but QuickBooks did not return a TxnID, so the script cannot open it for PDF printing."
        return
    }

    $templateNames = @()
    $requestedTemplateNames = if ([string]::IsNullOrWhiteSpace($OnlyQuickBooksTemplateName)) {
        @($StoredInvoiceTemplateName, $CustomerSalesOrderTemplateName)
    }
    else {
        @($OnlyQuickBooksTemplateName)
    }
    foreach ($templateName in $requestedTemplateNames) {
        if (-not [string]::IsNullOrWhiteSpace($templateName)) {
            $trimmedTemplateName = $templateName.Trim()
            if ($templateNames -notcontains $trimmedTemplateName) {
                $templateNames += $trimmedTemplateName
            }
        }
    }

    if ($templateNames.Count -eq 0) {
        Write-Warning "Invoice was created, but no QuickBooks print templates were configured."
        return
    }

    $currentInfo = $InvoiceInfo
    $printAutomationError = $null

    try {
        foreach ($templateName in $templateNames) {
            $templateErrors = @()
            Write-Host "Beginning QuickBooks print sequence for template '$TemplateName'."
            try {
            # Printing/closing the QuickBooks form updates IsToBePrinted and can
            # advance EditSequence. Always query immediately before the next
            # template modification so the sales-order pass does not reuse the
            # stale sequence returned when the invoice was created.
            $freshInfo = Get-QuickBooksInvoiceInfo -TxnId $txnId
            $currentInfo = Merge-InvoiceInfo -Current $currentInfo -Updated $freshInfo
            $currentInfo = Set-QuickBooksInvoiceTemplate -InvoiceInfo $currentInfo -TemplateName $templateName

            $displayXml = Build-TxnDisplayInvoice -TxnId $txnId
            Invoke-QuickBooksRequest -RequestXml $displayXml | Out-Null
            Start-Sleep -Seconds 2
            }
            catch {
                $templateErrors += "Template switch/display failed: $($_.Exception.Message)"
                Write-Warning "Could not select QuickBooks template '$TemplateName': $($_.Exception.Message)"
                continue
            }

            $isStoredTemplate = ($templateName -ieq $StoredInvoiceTemplateName)
            if ($isStoredTemplate) {
                $outputPath = Get-QuickBooksInvoicePdfOutputPath -PoNumber $PoNumber
                Write-Host "Printing QuickBooks invoice template '$templateName' to PDF."
                try {
                    Invoke-QuickBooksInvoicePdfPrint -OutputPath $outputPath
                }
                catch {
                    $templateErrors += "PDF print failed: $($_.Exception.Message)"
                    Write-Warning "PDF printing failed for template '$TemplateName', but physical printing and the next template will continue: $($_.Exception.Message)"
                }

                $displayXml = Build-TxnDisplayInvoice -TxnId $txnId
                Invoke-QuickBooksRequest -RequestXml $displayXml | Out-Null
                Start-Sleep -Seconds 2
            }

            try {
                Invoke-QuickBooksInvoicePaperPrint -TemplateName $templateName
                Write-Host "Finished physical print for QuickBooks template '$TemplateName'."
            }
            catch {
                $templateErrors += "Physical print failed: $($_.Exception.Message)"
                Write-Warning "Physical printing failed for template '$TemplateName', but the next template will continue: $($_.Exception.Message)"
            }
            Write-Host "Waiting for QuickBooks to release the invoice after printing."
            Start-Sleep -Seconds 5

            if ($templateErrors.Count -gt 0) {
                $message = "Template '$TemplateName': " + ($templateErrors -join "; ")
                if ([string]::IsNullOrWhiteSpace($printAutomationError)) {
                    $printAutomationError = $message
                }
                else {
                    $printAutomationError += " | $message"
                }
            }
        }
    }
    catch {
        $printAutomationError = $_.Exception.Message
        Write-Warning "Invoice was created, but QuickBooks print/template automation failed: $printAutomationError"
    }

    if (-not [string]::IsNullOrWhiteSpace($printAutomationError)) {
        throw "QuickBooks invoice was created, but PDF/printer automation failed: $printAutomationError"
    }
}

function Invoke-QuickBooksRequestWithProcessor {
    param(
        [string]$RequestXml,
        [object]$RequestProcessorInfo
    )

    $requestProcessor = $RequestProcessorInfo.Processor
    $ticket = $null
    $connectionOpened = $false
    try {
        Open-QuickBooksConnection -RequestProcessor $requestProcessor -ProgId $RequestProcessorInfo.ProgId
        $connectionOpened = $true

        try {
            $sessionCompanyFile = ""
            if ($UseCompanyFilePathForSdkSession) {
                $sessionCompanyFile = $CompanyFile
            }
            $ticket = $requestProcessor.BeginSession($sessionCompanyFile, 2)
        }
        catch {
            throw @"
QuickBooks SDK connection opened, but BeginSession failed.

Make sure QuickBooks Desktop is already open, the Tanslin company file is open, and you are logged in as the QuickBooks user. If QuickBooks shows an app-certificate prompt, approve this app.

By default this script connects to the currently open QuickBooks company file because QuickBooks Pro 2011 often cannot be started automatically by the SDK. Use -UseCompanyFilePathForSdkSession only after app authorization is working.

Original error: $($_.Exception.Message)
"@
        }

        try {
            $response = ""
            $response = $requestProcessor.ProcessRequest($ticket, $RequestXml)
            Assert-QbXmlResponseSuccess -ResponseXml $response -RequestDescription "the QBXML transaction" | Out-Null
        }
        catch {
            $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
            $requestPath = Save-QuickBooksPayload -Xml $RequestXml -Name "failed-$timestamp-request.xml"
            if (-not [string]::IsNullOrWhiteSpace($requestPath)) {
                Write-Warning "Saved failed QuickBooks request XML: $requestPath"
            }
            if (-not [string]::IsNullOrWhiteSpace($response)) {
                $responsePath = Save-QuickBooksPayload -Xml $response -Name "failed-$timestamp-response.xml"
                if (-not [string]::IsNullOrWhiteSpace($responsePath)) {
                    Write-Warning "Saved failed QuickBooks response XML: $responsePath"
                }
            }
            throw @"
QuickBooks accepted the SDK session, but rejected the QBXML request.

This usually means one of the QuickBooks names in the JSON does not exactly match QuickBooks, such as customer, item, terms, rep, ship method, or class.

Original error: $($_.Exception.Message)
"@
        }

        $response
    }
    finally {
        if ($ticket) {
            $requestProcessor.EndSession($ticket) | Out-Null
        }
        if ($connectionOpened) {
            $requestProcessor.CloseConnection() | Out-Null
        }
    }
}

function Build-QuickBooksSessionProbe {
@"
<?xml version="1.0"?>
<?qbxml version="$QbxmlVersion"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <CompanyQueryRq requestID="session-probe-$([guid]::NewGuid().ToString("N").Substring(0, 8))" />
  </QBXMLMsgsRq>
</QBXML>
"@
}

function Test-QuickBooksSdkSessionActive {
    Write-Host "Checking for an active QuickBooks SDK session."
    try {
        $probeXml = Build-QuickBooksSessionProbe
        $responseXml = Invoke-QuickBooksRequest -RequestXml $probeXml
        try {
            [xml]$companyXml = $responseXml
            $companyNameNode = $companyXml.SelectSingleNode("//*[local-name()='CompanyRet']/*[local-name()='CompanyName']")
            $legalNameNode = $companyXml.SelectSingleNode("//*[local-name()='CompanyRet']/*[local-name()='LegalCompanyName']")
            $companyName = ""
            if ($null -ne $companyNameNode) { $companyName = $companyNameNode.InnerText }
            if ([string]::IsNullOrWhiteSpace($companyName) -and $null -ne $legalNameNode) {
                $companyName = $legalNameNode.InnerText
            }

            if (-not [string]::IsNullOrWhiteSpace($companyName)) {
                Write-Host "QuickBooks open company: $companyName"
                if ($companyName -notmatch "TANSLIN|Tanslin") {
                    Write-Warning "QuickBooks is running, but the open company does not look like Tanslin."
                    return $false
                }
            }
        }
        catch {
            Write-Warning "Could not read the open QuickBooks company name from the session probe: $($_.Exception.Message)"
        }
        Write-Host "QuickBooks SDK session is ready."
        return $true
    }
    catch {
        Write-Warning "QuickBooks SDK session is not ready yet: $($_.Exception.Message)"
        return $false
    }
}

function Start-TanslinQuickBooksSession {
    $startupScript = Join-Path $ProjectRoot "scripts\start_quickbooks_tanslin.ps1"
    if (-not (Test-Path -LiteralPath $startupScript -PathType Leaf)) {
        throw "QuickBooks startup/login script was not found: $startupScript"
    }

    Write-Host "Starting or reconnecting the Tanslin QuickBooks desktop session."
    & $startupScript `
        -CompanyFile $CompanyFile `
        -StartupDelaySeconds 0 `
        -CompanyFileWaitSeconds 180 `
        -LoginWaitSeconds 180
}

function Ensure-QuickBooksSessionReady {
    if ($NoAutoStartQuickBooks) {
        Test-QuickBooksDesktopRunning
        return
    }

    if ((Test-QuickBooksDesktopProcessRunning) -and (Test-QuickBooksSdkSessionActive)) {
        return
    }

    Start-TanslinQuickBooksSession
    Start-Sleep -Seconds 3

    if (Test-QuickBooksSdkSessionActive) {
        return
    }

    throw "QuickBooks was opened/logged in, but the SDK session is still not ready. Check QuickBooks for a login window, app permission prompt, or modal dialog, then press Process PO again."
}

$ResolvedJsonPath = (Resolve-Path -LiteralPath $JsonPath).Path
$po = Get-Content -LiteralPath $ResolvedJsonPath -Raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace([string]$po.quickbooks_customer_full_name)) {
    throw "Set quickbooks_customer_full_name in the JSON before importing."
}

if (-not $DryRun) {
    Connect-NetworkShare -Path $CompanyFile
    if ($PrintExistingInvoiceOnly) {
        try {
            Test-CompanyFileReachable -Path $CompanyFile
        }
        catch {
            Write-Warning "The configured company file path is not reachable right now, but this is a print-only run. Continuing with the currently open QuickBooks company file. Original check error: $($_.Exception.Message)"
        }
    }
    else {
        Test-CompanyFileReachable -Path $CompanyFile
    }
}
elseif (-not [string]::IsNullOrWhiteSpace($CompanyFile)) {
    Write-Host "Dry run: skipping live company-file reachability check for '$CompanyFile'"
}

if ($CheckCompanyFileOnly) {
    Write-Host "Company-file check complete. No QuickBooks transaction was created."
    exit 0
}

if (-not $DryRun) {
    Ensure-QuickBooksSessionReady
}

if ($DisplayExistingInvoiceOnly) {
    if ([string]::IsNullOrWhiteSpace($ExistingInvoiceTxnId)) {
        throw "Pass -ExistingInvoiceTxnId when using -DisplayExistingInvoiceOnly."
    }

    Write-Host "Displaying existing QuickBooks Invoice TxnID $ExistingInvoiceTxnId"
    if (-not $DryRun) {
        $displayXml = Build-TxnDisplayInvoice -TxnId $ExistingInvoiceTxnId
        Invoke-QuickBooksRequest -RequestXml $displayXml | Out-Null
        Start-Sleep -Seconds 2
    }
    exit 0
}

if ($PrintExistingInvoiceOnly) {
    if ([string]::IsNullOrWhiteSpace($ExistingInvoiceTxnId)) {
        throw "Pass -ExistingInvoiceTxnId when using -PrintExistingInvoiceOnly."
    }

    $printPoNumber = $ExistingInvoicePoNumber
    if ([string]::IsNullOrWhiteSpace($printPoNumber)) {
        $printPoNumber = Get-PoValue -Object $po -Name "po_number" -Default "UNKNOWN"
    }

    Write-Host "Printing existing QuickBooks Invoice TxnID $ExistingInvoiceTxnId for PO $printPoNumber"
    if ($DryRun) {
        Build-InvoiceQuery -TxnId $ExistingInvoiceTxnId
        Write-Host "Dry run: skipped PDF and physical print automation for existing invoice."
        exit 0
    }

    $invoiceInfo = Get-QuickBooksInvoiceInfo -TxnId $ExistingInvoiceTxnId
    if ([string]::IsNullOrWhiteSpace((Get-PoValue -Object $invoiceInfo -Name "TxnID"))) {
        $invoiceInfo = [pscustomobject]@{
            TxnID = $ExistingInvoiceTxnId
            EditSequence = ""
            RefNumber = ""
            TemplateFullName = ""
        }
    }
    if ($TestExistingInvoiceTemplateSwitchOnly) {
        Write-Host "Testing QuickBooks template switch without printing."
        $invoiceInfo = Set-QuickBooksInvoiceTemplate -InvoiceInfo $invoiceInfo -TemplateName $CustomerSalesOrderTemplateName
        Invoke-QuickBooksRequest -RequestXml (Build-TxnDisplayInvoice -TxnId $ExistingInvoiceTxnId) | Out-Null
        Start-Sleep -Seconds 2
        Invoke-QuickBooksCloseCurrentInvoiceWithoutPrinting
        Start-Sleep -Seconds 2
        $invoiceInfo = Set-QuickBooksInvoiceTemplate -InvoiceInfo $invoiceInfo -TemplateName $StoredInvoiceTemplateName
        Write-Host "No-print template-switch test complete; restored '$StoredInvoiceTemplateName'."
        exit 0
    }
    Save-QuickBooksPrintedInvoicePdf -InvoiceInfo $invoiceInfo -PoNumber $printPoNumber
    exit 0
}

$shouldCreateInvoice = [bool]$CreateInvoice
$shouldSkipSalesOrder = [bool]$SkipSalesOrder

if (-not $AllowSalesOrder -and -not $shouldSkipSalesOrder) {
    Write-Warning "QuickBooks Pro 2011 cannot create Sales Orders through the SDK. Skipping SalesOrderAdd and creating a standalone InvoiceAdd instead. Use -AllowSalesOrder only with QuickBooks Premier/Enterprise."
    $shouldSkipSalesOrder = $true
    $shouldCreateInvoice = $true
}

if (-not $shouldSkipSalesOrder) {
    Write-Host "Creating Sales Order for PO $($po.po_number) as QuickBooks customer '$($po.quickbooks_customer_full_name)'"
    Write-ItemAccountPreflight -Po $po
    $salesOrderXml = Build-SalesOrderAdd -Po $po
    try {
        $salesOrderResponse = Invoke-QuickBooksRequest -RequestXml $salesOrderXml
    }
    catch {
        if ($_.Exception.Message -like "*Missing posting account*") {
            Write-Warning "Full Sales Order was rejected for missing posting account. Retrying once with minimal Sales Order XML to isolate optional fields."
            $salesOrderXml = Build-SalesOrderAdd -Po $po -Minimal
            $salesOrderResponse = Invoke-QuickBooksRequest -RequestXml $salesOrderXml
        }
        else {
            throw
        }
    }
    if (-not $DryRun -and $salesOrderResponse) {
        $responsePath = Save-QuickBooksResponse -ResponseXml $salesOrderResponse -PoNumber $po.po_number -Kind "sales-order"
        if (-not [string]::IsNullOrWhiteSpace($responsePath)) {
            Write-Host "QuickBooks Sales Order response saved: $responsePath"
        }
    }
    if ($DryRun -and $salesOrderResponse) {
        $salesOrderResponse
    }

    if (-not $DryRun -and $salesOrderResponse) {
        try {
            [xml]$responseXml = $salesOrderResponse
            $txnIdNode = $responseXml.SelectSingleNode("//*[local-name()='SalesOrderRet']/*[local-name()='TxnID']")
            $txnId = ""
            if ($null -ne $txnIdNode) {
                $txnId = $txnIdNode.InnerText
            }
            if ($txnId) {
                Write-Host "Sales Order TxnID: $txnId"
                if ([string]::IsNullOrWhiteSpace($SalesOrderTxnId)) {
                    $SalesOrderTxnId = $txnId
                }
            }
            else {
                Write-Warning "QuickBooks did not return a Sales Order TxnID. Check the saved response XML and the QuickBooks UI before creating a linked invoice."
            }
        }
        catch {
            Write-Warning "Could not read Sales Order TxnID from the QuickBooks response. Use the response XML or QuickBooks UI to find it before creating a linked invoice."
        }
    }
}
else {
    Write-Host "Skipping Sales Order creation for PO $($po.po_number)"
}

if ($shouldCreateInvoice) {
    Write-Host "Creating Invoice for PO $($po.po_number)"
    if ([string]::IsNullOrWhiteSpace([string]$po.quickbooks_invoice_ref_number)) {
        Write-Host "Invoice # is blank in the JSON, so QuickBooks will assign the next invoice number."
    }
    $linkedTxnId = $SalesOrderTxnId
    if ([string]::IsNullOrWhiteSpace($linkedTxnId) -and ($po.PSObject.Properties.Name -contains "quickbooks_sales_order_txn_id")) {
        $linkedTxnId = [string]$po.quickbooks_sales_order_txn_id
    }

    if ([string]::IsNullOrWhiteSpace($linkedTxnId)) {
        if ($shouldSkipSalesOrder) {
            Write-Host "Creating a standalone invoice from the PO lines."
        }
        else {
            Write-Warning "No Sales Order TxnID was supplied. Creating a standalone invoice from the PO lines; this will not close the Sales Order."
        }
        $invoiceXml = Build-InvoiceAdd -Po $po
    }
    else {
        Write-Host "Linking invoice to Sales Order TxnID $linkedTxnId"
        $invoiceXml = Build-InvoiceAddFromSalesOrder -Po $po -LinkedTxnId $linkedTxnId
    }
    $invoiceResponse = Invoke-QuickBooksRequest -RequestXml $invoiceXml
    if ($DryRun -and $invoiceResponse) {
        $invoiceResponse
    }
    if (-not $DryRun -and $invoiceResponse) {
        $responsePath = Save-QuickBooksResponse -ResponseXml $invoiceResponse -PoNumber $po.po_number -Kind "invoice"
        if (-not [string]::IsNullOrWhiteSpace($responsePath)) {
            Write-Host "QuickBooks Invoice response saved: $responsePath"
        }
        $invoiceInfo = Get-InvoiceInfoFromResponse -ResponseXml $invoiceResponse
        Save-QuickBooksPrintedInvoicePdf -InvoiceInfo $invoiceInfo -PoNumber $po.po_number
    }
}
else {
    Write-Host "No QuickBooks invoice was created. Add -CreateInvoice, or omit -AllowSalesOrder on QuickBooks Pro to use the direct invoice path."
}

if ($script:TemporaryNetworkDriveName) {
    Remove-PSDrive -Name $script:TemporaryNetworkDriveName -Force
}
