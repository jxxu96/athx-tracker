# Registers the estimator as a Scheduled Task that starts at logon, so meal
# estimates work without remembering to launch anything.
#
#   powershell -ExecutionPolicy Bypass -File estimator\install-windows.ps1
#   powershell -ExecutionPolicy Bypass -File estimator\install-windows.ps1 -Uninstall
#
# It runs as you, in your session, because the CLIs authenticate as you.

[CmdletBinding()]
param(
    [string]$TaskName = "ATHX meal estimator",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $here "server.mjs"

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Output "Removed scheduled task: $TaskName"
    } else {
        Write-Output "No scheduled task named $TaskName"
    }
    return
}

if (-not (Test-Path $server)) { throw "server.mjs not found next to this script." }

$envFile = Join-Path $here ".env"
if (-not (Test-Path $envFile)) {
    throw "estimator\.env not found. Copy .env.example to .env and set ESTIMATOR_TOKEN first."
}
if ((Get-Content $envFile -Raw) -match "change-me-to-something-long-and-random") {
    throw "estimator\.env still has the placeholder token. Set a real ESTIMATOR_TOKEN first."
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node was not found on PATH." }

# -WindowStyle Hidden keeps a console from flashing up at every logon.
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$server`"" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Answers meal macro estimates for the ATHX tracker using the locally signed-in Grok and Claude CLIs." | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Output "Registered and started: $TaskName"
Write-Output "Check it with: Get-ScheduledTask -TaskName '$TaskName'"
Write-Output "Stop it with:  Stop-ScheduledTask -TaskName '$TaskName'"
