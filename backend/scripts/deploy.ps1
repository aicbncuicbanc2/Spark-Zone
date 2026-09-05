<#
.SYNOPSIS
  Deploys the Expiry Guardian API to Cloud Run, and schedules the reminder sweep.

.DESCRIPTION
  Idempotent — safe to re-run. Reads secrets from backend/.env, stores them in
  Secret Manager, and never passes them on the command line where they would
  land in shell history.

  Region defaults to asia-northeast1 to match the Supabase project's
  ap-northeast-1. A request makes several database round trips, so the API
  wants to sit next to the database rather than next to the phone.

.EXAMPLE
  .\scripts\deploy.ps1 -ProjectId my-project-id
#>
param(
    [Parameter(Mandatory = $true)][string]$ProjectId,
    [string]$Region = "asia-northeast1",
    [string]$ServiceName = "expiry-guardian-api",
    [switch]$SkipScheduler
)

$ErrorActionPreference = "Stop"

$gcloud = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
if (-not (Test-Path $gcloud)) {
    $found = Get-Command gcloud -ErrorAction SilentlyContinue
    if ($null -eq $found) { throw "gcloud not found. Install the Google Cloud SDK first." }
    $gcloud = $found.Source
}

$backend = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $backend ".env"
if (-not (Test-Path $envFile)) { throw "No .env at $envFile" }

function Read-EnvValue([string]$Name) {
    $line = Select-String -Path $envFile -Pattern "^$Name=" | Select-Object -First 1
    if ($null -eq $line) { return "" }
    return $line.Line.Substring($Name.Length + 1).Trim()
}

Write-Host "`n=== 1. Project ===" -ForegroundColor Cyan
& $gcloud config set project $ProjectId | Out-Null
Write-Host "  project: $ProjectId"
Write-Host "  region : $Region"

Write-Host "`n=== 2. Enabling APIs (slow the first time) ===" -ForegroundColor Cyan
$apis = @(
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "vision.googleapis.com",
    "cloudscheduler.googleapis.com"
)
& $gcloud services enable $apis --project $ProjectId
Write-Host "  enabled: $($apis -join ', ')"

Write-Host "`n=== 3. Secrets ===" -ForegroundColor Cyan
# Secret Manager rather than --set-env-vars: values passed on the command line
# end up in shell history and in the Cloud Run revision description.
$secrets = @{
    "supabase-url"               = "SUPABASE_URL"
    "supabase-anon-key"          = "SUPABASE_ANON_KEY"
    "supabase-service-role-key"  = "SUPABASE_SERVICE_ROLE_KEY"
    "cloudinary-cloud-name"      = "CLOUDINARY_CLOUD_NAME"
    "cloudinary-api-key"         = "CLOUDINARY_API_KEY"
    "cloudinary-api-secret"      = "CLOUDINARY_API_SECRET"
    "internal-sweep-secret"      = "INTERNAL_SWEEP_SECRET"
}

foreach ($name in $secrets.Keys) {
    $value = Read-EnvValue $secrets[$name]
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Host "  skipped $name (not set in .env)" -ForegroundColor Yellow
        continue
    }
    $exists = & $gcloud secrets describe $name --project $ProjectId 2>$null
    if ($null -eq $exists) {
        & $gcloud secrets create $name --replication-policy="automatic" --project $ProjectId | Out-Null
    }
    $tmp = New-TemporaryFile
    [System.IO.File]::WriteAllText($tmp.FullName, $value, [System.Text.UTF8Encoding]::new($false))
    & $gcloud secrets versions add $name --data-file=$tmp.FullName --project $ProjectId | Out-Null
    Remove-Item $tmp.FullName -Force
    Write-Host "  stored $name"
}

Write-Host "`n=== 4. Granting the runtime service account access ===" -ForegroundColor Cyan
$projectNumber = & $gcloud projects describe $ProjectId --format="value(projectNumber)"
$runtimeSa = "$projectNumber-compute@developer.gserviceaccount.com"
foreach ($name in $secrets.Keys) {
    & $gcloud secrets add-iam-policy-binding $name `
        --member="serviceAccount:$runtimeSa" `
        --role="roles/secretmanager.secretAccessor" `
        --project $ProjectId 2>$null | Out-Null
}
Write-Host "  $runtimeSa can read the secrets"

Write-Host "`n=== 5. Deploying (Cloud Build; the OCR layer takes a while) ===" -ForegroundColor Cyan
$secretFlags = ($secrets.Keys | ForEach-Object { "$($secrets[$_])=$($_):latest" }) -join ","

& $gcloud run deploy $ServiceName `
    --source $backend `
    --project $ProjectId `
    --region $Region `
    --allow-unauthenticated `
    --memory 2Gi `
    --cpu 2 `
    --timeout 300 `
    --concurrency 4 `
    --max-instances 3 `
    --set-env-vars "ENVIRONMENT=production,LOG_LEVEL=INFO,CORS_ORIGINS=*" `
    --set-secrets $secretFlags

$url = & $gcloud run services describe $ServiceName --project $ProjectId --region $Region --format="value(status.url)"
Write-Host "`n  URL: $url" -ForegroundColor Green

Write-Host "`n=== 6. Verifying ===" -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod "$url/health" -TimeoutSec 60
    Write-Host "  /health       : $($health.status) (revision $($health.revision))"
    $ready = Invoke-RestMethod "$url/health/ready" -TimeoutSec 60
    Write-Host "  /health/ready : $($ready.status)"
    if ($ready.status -ne "ready") { $ready.checks | ConvertTo-Json -Depth 4 | Write-Host }
} catch {
    Write-Host "  probe failed: $_" -ForegroundColor Yellow
}

if (-not $SkipScheduler) {
    Write-Host "`n=== 7. Scheduling the reminder sweep ===" -ForegroundColor Cyan
    # Cloud Run scales to zero, so an in-process scheduler would never fire.
    $sweepSecret = Read-EnvValue "INTERNAL_SWEEP_SECRET"
    $jobName = "$ServiceName-sweep"
    $existing = & $gcloud scheduler jobs describe $jobName --location $Region --project $ProjectId 2>$null
    $action = if ($null -eq $existing) { "create" } else { "update" }

    & $gcloud scheduler jobs $action http $jobName `
        --location $Region `
        --project $ProjectId `
        --schedule "*/15 * * * *" `
        --time-zone "Asia/Kuala_Lumpur" `
        --uri "$url/v1/internal/reminders/sweep" `
        --http-method POST `
        --headers "X-Internal-Secret=$sweepSecret" `
        --attempt-deadline 300s
    Write-Host "  $jobName runs every 15 minutes"
}

Write-Host "`nDone. Base URL: $url" -ForegroundColor Green
Write-Host "Give that to the frontend developer; it replaces the LAN IP.`n"
