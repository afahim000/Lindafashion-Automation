param(
    [switch]$Once,
    [int]$LoopSeconds = 30
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $Root 'backend'
$FrontendDir = Join-Path $Root 'frontend'
$LogDir = Join-Path $Root 'serverLogs'
$BackendLog = Join-Path $LogDir 'backend-watchdog.log'
$FrontendLog = Join-Path $LogDir 'frontend-watchdog.log'
$WatchdogLog = Join-Path $LogDir 'watchdog.log'

function Ensure-Directory($Path)
{
    if(!(Test-Path -LiteralPath $Path))
    {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Write-WatchdogLog($Message)
{
    Ensure-Directory $LogDir
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $WatchdogLog -Value "[$timestamp] $Message"
}

function Test-PortListening($Port)
{
    try
    {
        return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    }
    catch
    {
        $line = netstat -ano | Select-String ":$Port" | Where-Object { $_.ToString() -match 'LISTENING' } | Select-Object -First 1
        return [bool]$line
    }
}

function Start-Server($Name, $WorkingDirectory, $Command, $LogPath)
{
    Ensure-Directory $LogDir

    $quotedWorkingDirectory = $WorkingDirectory.Replace('"', '\"')
    $quotedLogPath = $LogPath.Replace('"', '\"')
    $cmd = "cd /d `"$quotedWorkingDirectory`" && $Command >> `"$quotedLogPath`" 2>&1"

    Write-WatchdogLog "Starting $Name"
    Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' -ArgumentList @('/c', $cmd) | Out-Null
}

function Ensure-Servers()
{
    if(Test-PortListening 2000)
    {
        Write-WatchdogLog 'Backend already listening on port 2000'
    }
    else
    {
        Start-Server -Name 'backend' -WorkingDirectory $BackendDir -Command 'npm start' -LogPath $BackendLog
    }

    if(Test-PortListening 3000)
    {
        Write-WatchdogLog 'Frontend already listening on port 3000'
    }
    else
    {
        Start-Server -Name 'frontend' -WorkingDirectory $FrontendDir -Command 'set HOST=0.0.0.0&& set PORT=3000&& set BROWSER=none&& npm start' -LogPath $FrontendLog
    }
}

Write-WatchdogLog "Watchdog started. Root=$Root Once=$Once LoopSeconds=$LoopSeconds"

do
{
    try
    {
        Ensure-Servers
    }
    catch
    {
        Write-WatchdogLog "ERROR: $($_.Exception.Message)"
    }

    if($Once)
    {
        break
    }

    Start-Sleep -Seconds $LoopSeconds
}
while($true)

