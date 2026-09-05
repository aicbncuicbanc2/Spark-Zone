<#
.SYNOPSIS
  Runs the API on a public URL via Cloudflare Tunnel, and drives the reminder
  sweep on a timer.

.DESCRIPTION
  Stands in for Cloud Run while the project has no GCP billing account. Starts
  three things and keeps them together:

    1. uvicorn on localhost:8080
    2. a Cloudflare quick tunnel, giving a public https URL
    3. a loop that calls the reminder sweep every 15 minutes, which is the job
       Cloud Scheduler would otherwise do — Cloud Run scales to zero, and this
       laptop does not, but either way the sweep has to be triggered from
       outside the app

  The URL is written to scripts/PUBLIC_URL.txt so it can be copied without
  scrolling back through logs.

  Caveats worth knowing: a quick tunnel gets a new random URL every restart, and
  everything stops when this window closes or the laptop sleeps.

.EXAMPLE
  .\scripts\serve-public.ps1
#>
param(
    [int]$Port = 8080,
    [int]$SweepMinutes = 15,
    [switch]$NoSweep
)

$ErrorActionPreference = "Stop"

$backend = Split-Path -Parent $PSScriptRoot
$python = Join-Path $backend "venv\Scripts\python.exe"
$urlFile = Join-Path $PSScriptRoot "PUBLIC_URL.txt"

if (-not (Test-Path $python)) { throw "No virtualenv at $python. Run: python -m venv venv" }

$cloudflared = @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $cloudflared) {
    $c = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($null -eq $c) { throw "cloudflared not found. Install: winget install Cloudflare.cloudflared" }
    $cloudflared = $c.Source
}

function Read-EnvValue([string]$Name) {
    $envFile = Join-Path $backend ".env"
    $line = Select-String -Path $envFile -Pattern "^$Name=" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $line) { return "" }
    return $line.Line.Substring($Name.Length + 1).Trim()
}

$jobs = @()

try {
    Write-Host "`n=== 1. Starting the API on port $Port ===" -ForegroundColor Cyan
    $api = Start-Process -FilePath $python `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "$Port" `
        -WorkingDirectory $backend -PassThru -WindowStyle Hidden
    Write-Host "  pid $($api.Id)"

    # Wait for it to answer before exposing it.
    $ready = $false
    foreach ($attempt in 1..30) {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 3
            Write-Host "  /health: $($health.status)" -ForegroundColor Green
            $ready = $true
            break
        } catch { }
    }
    if (-not $ready) { throw "The API did not come up on port $Port." }

    Write-Host "`n=== 2. Opening the Cloudflare tunnel ===" -ForegroundColor Cyan
    $log = Join-Path $env:TEMP "cloudflared-$Port.log"
    Remove-Item $log -ErrorAction SilentlyContinue
    $tunnel = Start-Process -FilePath $cloudflared `
        -ArgumentList "tunnel", "--url", "http://localhost:$Port", "--no-autoupdate" `
        -PassThru -WindowStyle Hidden -RedirectStandardError $log -RedirectStandardOutput "$log.out"
    Write-Host "  pid $($tunnel.Id)"

    $publicUrl = $null
    foreach ($attempt in 1..40) {
        Start-Sleep -Seconds 1
        if (Test-Path $log) {
            $match = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" |
                     Select-Object -First 1
            if ($match) {
                $publicUrl = $match.Matches[0].Value
                break
            }
        }
    }
    if (-not $publicUrl) { throw "The tunnel did not report a URL. See $log" }

    Set-Content -Path $urlFile -Value $publicUrl -Encoding utf8

    Write-Host "`n=== 3. Verifying from the public internet ===" -ForegroundColor Cyan
    Start-Sleep -Seconds 4
    try {
        $probe = Invoke-RestMethod "$publicUrl/health" -TimeoutSec 30
        Write-Host "  $publicUrl/health -> $($probe.status)" -ForegroundColor Green
    } catch {
        Write-Host "  probe failed (the tunnel may still be propagating): $_" -ForegroundColor Yellow
    }

    if (-not $NoSweep) {
        Write-Host "`n=== 4. Reminder sweep every $SweepMinutes min ===" -ForegroundColor Cyan
        $secret = Read-EnvValue "INTERNAL_SWEEP_SECRET"
        if ([string]::IsNullOrWhiteSpace($secret)) {
            Write-Host "  skipped: INTERNAL_SWEEP_SECRET is not set in .env" -ForegroundColor Yellow
        } else {
            $jobs += Start-Job -ScriptBlock {
                param($url, $secret, $minutes)
                while ($true) {
                    try {
                        Invoke-RestMethod "$url/v1/internal/reminders/sweep" -Method Post `
                            -Headers @{ "X-Internal-Secret" = $secret } -TimeoutSec 120 | Out-Null
                    } catch { }
                    Start-Sleep -Seconds ($minutes * 60)
                }
            } -ArgumentList "http://127.0.0.1:$Port", $secret, $SweepMinutes
            Write-Host "  running (job $($jobs[-1].Id)), calling localhost so it works even if the tunnel drops"
        }
    }

    Write-Host "`n$('=' * 66)" -ForegroundColor Green
    Write-Host "  PUBLIC URL:  $publicUrl" -ForegroundColor Green
    Write-Host "$('=' * 66)" -ForegroundColor Green
    Write-Host "  Saved to scripts\PUBLIC_URL.txt"
    Write-Host "  Send it to the frontend developer; it replaces the LAN IP."
    Write-Host "  A new URL is issued each restart, so re-send after restarting."
    Write-Host "`n  Ctrl-C to stop everything.`n"

    while ($true) {
        Start-Sleep -Seconds 30
        if ($api.HasExited) { Write-Host "The API exited." -ForegroundColor Red; break }
        if ($tunnel.HasExited) { Write-Host "The tunnel exited." -ForegroundColor Red; break }
    }
}
finally {
    Write-Host "`nShutting down..." -ForegroundColor Yellow
    foreach ($job in $jobs) { Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue }
    foreach ($proc in @($tunnel, $api)) {
        if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    }
    Remove-Item $urlFile -ErrorAction SilentlyContinue
    Write-Host "Stopped.`n"
}
