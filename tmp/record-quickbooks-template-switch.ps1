param(
    [int]$DurationSeconds = 90,
    [int]$IntervalMilliseconds = 750,
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not ("QuickBooksCaptureWin32" -as [type])) {
    Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class QuickBooksCaptureWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $PSScriptRoot ("quickbooks-template-capture-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$logPath = Join-Path $OutputDirectory "capture-log.txt"
$deadline = (Get-Date).AddSeconds($DurationSeconds)
$frame = 0

while ((Get-Date) -lt $deadline) {
    $script:match = $null
    [QuickBooksCaptureWin32]::EnumWindows({
        param($handle, $unused)
        if ([QuickBooksCaptureWin32]::IsWindowVisible($handle)) {
            $builder = New-Object System.Text.StringBuilder 512
            [void][QuickBooksCaptureWin32]::GetWindowText($handle, $builder, $builder.Capacity)
            $title = $builder.ToString()
            if ($title -match "QuickBooks|Print One Invoice|Sales Order|Invoice") {
                $rect = New-Object QuickBooksCaptureWin32+RECT
                if ([QuickBooksCaptureWin32]::GetWindowRect($handle, [ref]$rect) -and $rect.Right -gt $rect.Left -and $rect.Bottom -gt $rect.Top) {
                    $script:match = [pscustomobject]@{ Title=$title; Rect=$rect }
                    return $false
                }
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null

    if ($null -ne $script:match) {
        $rect = $script:match.Rect
        $width = $rect.Right - $rect.Left
        $height = $rect.Bottom - $rect.Top
        $bitmap = New-Object System.Drawing.Bitmap $width, $height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $width, $height))
            $name = "frame-{0:D4}.png" -f $frame
            $bitmap.Save((Join-Path $OutputDirectory $name), [System.Drawing.Imaging.ImageFormat]::Png)
            Add-Content -LiteralPath $logPath -Value ("{0}`t{1}`t{2}" -f $frame, (Get-Date -Format o), $script:match.Title)
            $frame++
        }
        finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
    Start-Sleep -Milliseconds $IntervalMilliseconds
}

Set-Content -LiteralPath (Join-Path $OutputDirectory "complete.txt") -Value "Captured $frame QuickBooks frames."
