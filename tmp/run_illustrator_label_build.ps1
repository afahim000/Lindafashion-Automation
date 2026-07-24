$ErrorActionPreference = "Stop"
$progress = "C:\Users\ABRAR\OneDrive\Desktop\Lindafashion-Automation\output\ai\build-progress.txt"
try {
    $app = New-Object -ComObject Illustrator.Application
    $app.DoJavaScriptFile("C:\Users\ABRAR\OneDrive\Desktop\Lindafashion-Automation\tmp\build_ol1000_separate.jsx")
}
catch {
    Add-Content -LiteralPath $progress -Value ("ERROR: " + $_.Exception.Message)
    exit 1
}
