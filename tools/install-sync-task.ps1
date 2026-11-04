<#
    install-sync-task.ps1 — make the Supabase sync run by itself on this PC.

    Installs a Windows Task Scheduler task that runs sync-to-supabase.ps1
    silently when you log on and once a day at 21:00.

        powershell -ExecutionPolicy Bypass -File install-sync-task.ps1
        powershell -ExecutionPolicy Bypass -File install-sync-task.ps1 -Time 22:30
        powershell -ExecutionPolicy Bypass -File install-sync-task.ps1 -Remove

    Runs as your user account, no admin prompt, and never shows a window.
    Needs the key stored first:  sync-to-supabase.ps1 -SetKey
#>
[CmdletBinding()]
param(
    [switch]$Remove,
    [string]$Time = '21:00',
    [string]$TaskName = 'APEX Monster Tracker Sync'
)

$ErrorActionPreference = 'Stop'
$sync = Join-Path $PSScriptRoot 'sync-to-supabase.ps1'

if (-not (Test-Path $sync)) {
    Write-Host "Cannot find sync-to-supabase.ps1 next to this script ($sync)." -ForegroundColor Red
    exit 1
}

if ($Remove) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $existing) { Write-Host "No task called '$TaskName' is installed." -ForegroundColor Yellow; exit 0 }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed the scheduled task '$TaskName'. Local data and the cloud copy are untouched." -ForegroundColor Green
    exit 0
}

# the key must exist, or every scheduled run would fail silently at 9pm
$keyFile = Join-Path $env:LOCALAPPDATA 'ApexMonsterTracker\supabase.key'
if (-not (Test-Path $keyFile)) {
    Write-Host 'No Supabase key stored yet.' -ForegroundColor Red
    Write-Host 'Run this first, once:' -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File `"$sync`" -SetKey" -ForegroundColor Yellow
    exit 1
}

if ($Time -notmatch '^\d{1,2}:\d{2}$') {
    Write-Host "Time must look like 21:00 — got '$Time'." -ForegroundColor Red
    exit 1
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Quiet' -f $sync)

$atLogOn = New-ScheduledTaskTrigger -AtLogOn
$daily   = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

$description = 'Copies the APEX Monster Sales Tracker data to Supabase. Installed by install-sync-task.ps1.'

try {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atLogOn, $daily) `
        -Settings $settings -Description $description -Force | Out-Null
} catch {
    Write-Host "Could not register the task: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'If it mentions permissions, open PowerShell as your own user (not admin) and retry.' -ForegroundColor Yellow
    exit 1
}

Write-Host ''
Write-Host "Installed task '$TaskName'." -ForegroundColor Green
Write-Host "  runs at logon and every day at $Time" -ForegroundColor Gray
Write-Host "  script: $sync" -ForegroundColor Gray
Write-Host ''
Write-Host 'Test it right now without waiting:' -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName `"$TaskName`"" -ForegroundColor Cyan
Write-Host 'Then check the log:' -ForegroundColor Cyan
Write-Host ('  notepad "{0}"' -f (Join-Path $env:LOCALAPPDATA 'ApexMonsterTracker\sync.log')) -ForegroundColor Cyan
Write-Host ''
Write-Host "Undo with:  install-sync-task.ps1 -Remove" -ForegroundColor Gray
exit 0
