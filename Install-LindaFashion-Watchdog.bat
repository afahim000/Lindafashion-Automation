@echo off
setlocal

set "ROOT=%~dp0"
set "WATCHDOG=%ROOT%Start-LindaFashion-Watchdog.ps1"
set "TASK_NAME=Linda Fashion Automation Watchdog"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\Linda Fashion Automation Watchdog.lnk"

if not exist "%WATCHDOG%" (
    echo Could not find:
    echo %WATCHDOG%
    pause
    exit /b 1
)

schtasks /Create /TN "%TASK_NAME%" /SC ONLOGON /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%WATCHDOG%\"" /RL LIMITED /F >nul 2>nul
if errorlevel 1 (
    echo Task Scheduler install was not allowed. Installing Startup shortcut instead.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%SHORTCUT%'); $shortcut.TargetPath = 'powershell.exe'; $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"\"%WATCHDOG%\"\"'; $shortcut.WorkingDirectory = '%ROOT%'; $shortcut.WindowStyle = 7; $shortcut.Description = 'Keep Linda Fashion frontend and backend running'; $shortcut.Save()"
    if errorlevel 1 (
        echo Failed to create Startup shortcut.
        pause
        exit /b 1
    )
) else (
    echo Installed scheduled task:
    echo %TASK_NAME%
)

start "Linda Fashion Watchdog" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%WATCHDOG%"

echo Installed and started Linda Fashion Automation Watchdog.
echo.
echo It will keep the backend on port 2000 and frontend on port 3000 running while you are logged into Windows.
echo Logs are saved in:
echo %ROOT%serverLogs
pause
