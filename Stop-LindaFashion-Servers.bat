@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports = @(2000,3000); foreach ($port in $ports) { $listeners = netstat -ano | Select-String (':' + $port) | Where-Object { $_.ToString() -match 'LISTENING' }; foreach ($line in $listeners) { $pidValue = [int](($line.ToString().Trim() -split '\s+')[-1]); $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue; if ($proc -and $proc.ProcessName -match 'node|cmd|npm') { Write-Host ('Stopping port {0}: PID {1} ({2})' -f $port, $pidValue, $proc.ProcessName); Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue } } }"

echo Done.
pause
