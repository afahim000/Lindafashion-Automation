param([string]$InvoiceNumber, [string]$TxnId)
$ErrorActionPreference = 'Stop'
$processor = New-Object -ComObject QBXMLRP2.RequestProcessor
$ticket = $null
try {
    $processor.OpenConnection2('', 'QuickBooks PO Sales Order Invoice Importer', 1)
    $ticket = $processor.BeginSession('', 2)
    $escaped = [System.Security.SecurityElement]::Escape($InvoiceNumber)
    $escapedTxnId = [System.Security.SecurityElement]::Escape($TxnId)
    $filterXml = if ([string]::IsNullOrWhiteSpace($TxnId)) { "<RefNumber>$escaped</RefNumber>" } else { "<TxnID>$escapedTxnId</TxnID>" }
    $request = @"
<?xml version="1.0"?>
<?qbxml version="10.0"?>
<QBXML><QBXMLMsgsRq onError="stopOnError"><InvoiceQueryRq requestID="invoice-lookup">$filterXml</InvoiceQueryRq></QBXMLMsgsRq></QBXML>
"@
    [xml]$response = $processor.ProcessRequest($ticket, $request)
    $result = $response.SelectSingleNode("//*[local-name()='InvoiceRet']")
    if ($null -eq $result) {
        $status = $response.SelectSingleNode("//*[local-name()='InvoiceQueryRs']")
        throw "Invoice $InvoiceNumber lookup returned status $($status.statusCode): $($status.statusMessage)"
    }
    [pscustomobject]@{
        TxnID = $result.TxnID
        EditSequence = $result.EditSequence
        RefNumber = $result.RefNumber
        Template = $result.TemplateRef.FullName
    } | ConvertTo-Json -Compress
}
finally {
    if ($null -ne $ticket) { try { $processor.EndSession($ticket) } catch {} }
    try { $processor.CloseConnection() } catch {}
}
