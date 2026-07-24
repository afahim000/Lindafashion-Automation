@echo off
setlocal

set "ROOT=%~dp0"
set "LAUNCHER=%ROOT%Start-LindaFashion-Automation.bat"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\Linda Fashion Automation.lnk"

if not exist "%LAUNCHER%" (
    echo Could not find:
    echo %LAUNCHER%
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%SHORTCUT%'); $shortcut.TargetPath = '%LAUNCHER%'; $shortcut.WorkingDirectory = '%ROOT%'; $shortcut.WindowStyle = 7; $shortcut.Description = 'Start Linda Fashion frontend and backend servers'; $shortcut.Save()"

if errorlevel 1 (
    echo Failed to create startup shortcut.
    pause
    exit /b 1
)

echo Installed startup shortcut:
echo %SHORTCUT%
echo.
echo Linda Fashion Automation will start automatically when you log into Windows.
echo Run Start-LindaFashion-Automation.bat now if you want to start it immediately.
pause

