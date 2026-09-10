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

# Not "Stop": gcloud writes routine status to stderr even on pure success
# (e.g. "Updated IAM policy..."), and under Stop that becomes a terminating
# NativeCommandError the moment stderr is redirected anywhere - so real
# failures are instead caught explicitly via $LASTEXITCODE where it matters.
$ErrorActionPreference = "Continue"

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
    # A native command's stderr, once redirected, becomes a terminating error
    # under $ErrorActionPreference = "Stop" even though "not found" is the
    # expected, normal outcome here on a first run - so this probe runs with
    # errors relaxed, then strict mode resumes for everything after it.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $exists = & $gcloud secrets describe $name --project $ProjectId 2>$null
    $ErrorActionPreference = $prevEAP
    if ($null -eq $exists) {
        & $gcloud secrets create $name --replication-policy="automatic" --project $ProjectId | Out-Null
    }
    $tmp = New-TemporaryFile
    [System.IO.File]::WriteAllText($tmp.FullName, $value, [System.Text.UTF8Encoding]::new($false))
    # "--data-file=$tmp.FullName" (unquoted) does not expand the property -
    # PowerShell appends the literal text ".FullName" to $tmp's own string
    # form instead, pointing gcloud at a path that never existed.
    & $gcloud secrets versions add $name "--data-file=$($tmp.FullName)" --project $ProjectId | Out-Null
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

# On projects created after Google tightened default service account grants,
# the compute default SA has no storage access at all - "gcloud run deploy
# --source" fails with a 403 reading its own just-uploaded source zip back
# out of the run-sources-* bucket without this.
& $gcloud projects add-iam-policy-binding $ProjectId `
    --member="serviceAccount:$runtimeSa" `
    --role="roles/storage.objectViewer" 2>$null | Out-Null
Write-Host "  $runtimeSa can read Cloud Build's source bucket"

# Same era of tightened default grants: without Logs Writer, Cloud Build
# marks the whole build FAILURE for being unable to persist its own logs -
# independent of whether the actual build steps would have succeeded.
& $gcloud projects add-iam-policy-binding $ProjectId `
    --member="serviceAccount:$runtimeSa" `
    --role="roles/logging.logWriter" 2>$null | Out-Null
Write-Host "  $runtimeSa can write build logs"

# Same gap again: without this the build itself completes fine but the final
# push of the finished image to Artifact Registry is denied.
& $gcloud projects add-iam-policy-binding $ProjectId `
    --member="serviceAccount:$runtimeSa" `
    --role="roles/artifactregistry.writer" 2>$null | Out-Null
Write-Host "  $runtimeSa can push images to Artifact Registry"

Write-Host "`n=== 5. Deploying (Cloud Build; the OCR layer takes a while) ===" -ForegroundColor Cyan
$secretFlags = ($secrets.Keys | ForEach-Object { "$($secrets[$_])=$($_):latest" }) -join ","

# --no-cpu-throttling is required, not optional: Cloud Run freezes a
# container's CPU the instant its HTTP response is sent unless this is set,
# and this API deliberately returns 202 immediately then does the real OCR
# work in a FastAPI background task afterward - verified live that without
# this flag, a real scan just sits at status=processing forever, with
# engines_attempted staying empty because the background task never gets
# CPU to actually run. Costs more (billed for idle time, not just active
# request time), but there is no working alternative given this app's async
# scan architecture.
#
# --memory 4Gi / --concurrency 1 (was 2Gi / 4): a real scan under the old
# settings got OOM-killed mid-request ("Memory limit of 2048 MiB exceeded
# with 2177 MiB used") when the accurate PaddleOCR tier loaded alongside
# whatever else the same container was juggling - confirmed fixed by
# rerunning the same kind of scan afterward with zero memory errors.
#
# --min-instances 1: without this, Cloud Run scales to zero when idle and
# a judge's first request after any idle period pays a cold start plus
# (before the Dockerfile baked the models in) a HuggingFace model download
# mid-request. Costs a small always-on fee for the judging window, worth it
# so "try it fresh" is never the slow path.
& $gcloud run deploy $ServiceName `
    --source $backend `
    --project $ProjectId `
    --region $Region `
    --quiet `
    --allow-unauthenticated `
    --memory 4Gi `
    --cpu 2 `
    --no-cpu-throttling `
    --timeout 300 `
    --concurrency 1 `
    --min-instances 1 `
    --max-instances 3 `
    --set-env-vars "ENVIRONMENT=production,LOG_LEVEL=INFO,CORS_ORIGINS=*,OCR_PRIMARY_ENGINE=google_vision" `
    --set-secrets $secretFlags

if ($LASTEXITCODE -ne 0) {
    throw "gcloud run deploy failed (exit $LASTEXITCODE) - see output above."
}

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
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $existing = & $gcloud scheduler jobs describe $jobName --location $Region --project $ProjectId 2>$null
    $ErrorActionPreference = $prevEAP
    $action = if ($null -eq $existing) { "create" } else { "update" }
    # `create http` takes --headers; `update http` dropped that in favor of
    # --update-headers (a real gcloud version difference that broke a
    # deploy - --headers on `update` now errors as an unrecognized argument
    # instead of silently doing nothing).
    $headerFlag = if ($action -eq "create") { "--headers" } else { "--update-headers" }

    & $gcloud scheduler jobs $action http $jobName `
        --location $Region `
        --project $ProjectId `
        --schedule "*/15 * * * *" `
        --time-zone "Asia/Kuala_Lumpur" `
        --uri "$url/v1/internal/reminders/sweep" `
        --http-method POST `
        $headerFlag "X-Internal-Secret=$sweepSecret" `
        --attempt-deadline 300s
    Write-Host "  $jobName runs every 15 minutes"
}

Write-Host "`nDone. Base URL: $url" -ForegroundColor Green
Write-Host "Give that to the frontend developer; it replaces the LAN IP.`n"
