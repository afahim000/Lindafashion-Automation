@echo off
setlocal

set "TASK_NAME=Linda Fashion Automation Watchdog"
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Linda Fashion Automation Watchdog.lnk"

schtasks /End /TN "%TASK_NAME%" >nul 2>nul
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>nul

if exist "%SHORTCUT%" (
    del "%SHORTCUT%"
)

echo Removed watchdog scheduled task/startup shortcut if either existed:
echo %TASK_NAME%
pause
