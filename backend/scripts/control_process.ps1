param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Pause", "Resume")]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [int]$ProcessId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not ("LindaFashionProcessControl" -as [type])) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class LindaFashionProcessControl {
    [DllImport("ntdll.dll", SetLastError = true)]
    private static extern int NtSuspendProcess(IntPtr processHandle);

    [DllImport("ntdll.dll", SetLastError = true)]
    private static extern int NtResumeProcess(IntPtr processHandle);

    public static void Pause(int processId) {
        using (var process = System.Diagnostics.Process.GetProcessById(processId)) {
            int status = NtSuspendProcess(process.Handle);
            if (status != 0) throw new InvalidOperationException("NtSuspendProcess failed with status " + status);
        }
    }

    public static void Resume(int processId) {
        using (var process = System.Diagnostics.Process.GetProcessById(processId)) {
            int status = NtResumeProcess(process.Handle);
            if (status != 0) throw new InvalidOperationException("NtResumeProcess failed with status " + status);
        }
    }
}
"@
}

if ($Action -eq "Pause") {
    [LindaFashionProcessControl]::Pause($ProcessId)
}
else {
    [LindaFashionProcessControl]::Resume($ProcessId)
}

