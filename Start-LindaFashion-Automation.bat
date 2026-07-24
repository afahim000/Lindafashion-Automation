@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

echo Starting Linda Fashion Automation...
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found in PATH.
    echo Install Node.js or open this from a terminal where node is available.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo npm was not found in PATH.
    echo Install Node.js or open this from a terminal where npm is available.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort 2000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$backend = '%BACKEND%'; Start-Process -WindowStyle Minimized -FilePath 'cmd.exe' -ArgumentList @('/k', ('cd /d \"{0}\" && npm start' -f $backend))"
) else (
    echo Backend already appears to be running on port 2000.
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$frontend = '%FRONTEND%'; Start-Process -WindowStyle Minimized -FilePath 'cmd.exe' -ArgumentList @('/k', ('cd /d \"{0}\" && set HOST=0.0.0.0&& set PORT=3000&& set BROWSER=none&& npm start' -f $frontend))"
) else (
    echo Frontend already appears to be running on port 3000.
)

echo.
echo Local computer URL:
echo   http://localhost:3000
echo.
echo Phone URL:
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    for /f "tokens=* delims= " %%B in ("%%A") do echo   http://%%B:3000
)
echo.
echo You can close this launcher window. The server windows stay open minimized.
