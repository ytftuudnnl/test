param(
  [string]$WorkspaceRoot = "",
  [int]$Port = 3120
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
  $WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Get-UtcStampDate {
  return (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")
}

function Get-UtcStampDateTime {
  return (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
}

function Get-DirectoryDigest {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    throw "Path not found for digest: $Path"
  }

  $files = Get-ChildItem -Path $Path -File -Recurse | Sort-Object FullName
  $entries = @()
  foreach ($file in $files) {
    $hash = (Get-FileHash -Algorithm SHA256 -Path $file.FullName).Hash.ToLowerInvariant()
    $rel = $file.FullName.Substring($Path.Length).TrimStart('\', '/').Replace('\', '/')
    $entries += "$rel`:$hash"
  }

  $joined = [string]::Join("`n", $entries)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($joined)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $overall = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }

  return @{
    fileCount = $files.Count
    overallSha256 = $overall
    entries = $entries
  }
}

function Wait-ApiReady {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,
    [int]$TimeoutSec = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get -TimeoutSec 2
      if ($health -and $health.data -and $health.data.status -eq "ok") {
        return $true
      }
    } catch {
      # keep polling
    }
    Start-Sleep -Milliseconds 300
  }

  return $false
}

function Invoke-SmokeCheck {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl
  )

  $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get -TimeoutSec 5
  if (-not ($health -and $health.data -and $health.data.status -eq "ok")) {
    throw "Health check failed at $BaseUrl"
  }

  $loginBody = @{
    username = "admin.demo"
    password = "pass-1234"
  } | ConvertTo-Json -Compress

  $login = Invoke-RestMethod -Uri "$BaseUrl/api/auth/login" -Method Post -ContentType "application/json" -Body $loginBody -TimeoutSec 5
  if (-not ($login -and $login.data -and $login.data.token)) {
    throw "Login smoke check failed at $BaseUrl"
  }

  return @{
    healthTimestamp = $health.data.timestamp
    user = @{
      username = $login.data.user.username
      role = $login.data.user.role
    }
  }
}

function Start-ApiProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$WorkingDir,
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $env:PORT = "$Port"
  $env:DATA_DRIVER = "memory"
  return Start-Process -FilePath "node" -ArgumentList @("server.js") -WorkingDirectory $WorkingDir -PassThru -WindowStyle Hidden
}

function Stop-ApiProcess {
  param(
    [Parameter(Mandatory = $false)]
    $Process
  )

  if ($Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  }
}

$apiDist = Join-Path $WorkspaceRoot "services\\api\\dist"
$tmpRoot = Join-Path $WorkspaceRoot ".tmp\\app-rollback-rehearsal"
$stableDir = Join-Path $tmpRoot "stable"
$candidateDir = Join-Path $tmpRoot "candidate"
$deployedDir = Join-Path $tmpRoot "deployed"
$backupRoot = Join-Path $WorkspaceRoot "backups\\checkpoints"
$backupStamp = Get-UtcStampDateTime
$backupCheckpointDir = Join-Path $backupRoot $backupStamp
$backupDistDir = Join-Path $backupCheckpointDir "api-dist"
$evidenceDir = Join-Path $WorkspaceRoot "qa-evidence"
$dateStamp = Get-UtcStampDate
$rollbackEvidencePath = Join-Path $evidenceDir "app-rollback-rehearsal-$dateStamp.json"
$backupEvidencePath = Join-Path $evidenceDir "backup-checkpoint-$dateStamp.json"
$baseUrl = "http://127.0.0.1:$Port"

$apiProc = $null

try {
  Push-Location $WorkspaceRoot
  try {
    & npm.cmd run build:api
    if ($LASTEXITCODE -ne 0) {
      throw "build:api failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }

  if (-not (Test-Path $apiDist)) {
    throw "API dist directory not found: $apiDist"
  }

  if (Test-Path $tmpRoot) {
    Remove-Item -Recurse -Force -Path $tmpRoot -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Force -Path $stableDir | Out-Null
  New-Item -ItemType Directory -Force -Path $candidateDir | Out-Null
  New-Item -ItemType Directory -Force -Path $deployedDir | Out-Null
  New-Item -ItemType Directory -Force -Path $backupDistDir | Out-Null
  New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null

  Copy-Item -Path (Join-Path $apiDist "*") -Destination $stableDir -Recurse -Force
  Copy-Item -Path (Join-Path $stableDir "*") -Destination $backupDistDir -Recurse -Force

  $stableDigest = Get-DirectoryDigest -Path $stableDir
  $backupDigest = Get-DirectoryDigest -Path $backupDistDir

  if ($stableDigest.overallSha256 -ne $backupDigest.overallSha256) {
    throw "Backup checkpoint digest does not match stable snapshot."
  }

  Copy-Item -Path (Join-Path $stableDir "*") -Destination $candidateDir -Recurse -Force
  $markerPath = Join-Path $candidateDir "ROLLBACK_REHEARSAL_MARKER.txt"
  Set-Content -Path $markerPath -Value ("candidate rehearsal marker " + (Get-Date).ToUniversalTime().ToString("o")) -Encoding UTF8
  $candidateDigest = Get-DirectoryDigest -Path $candidateDir

  if ($candidateDigest.overallSha256 -eq $stableDigest.overallSha256) {
    throw "Candidate digest must differ from stable digest for rehearsal."
  }

  Remove-Item -Recurse -Force -Path $deployedDir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $deployedDir | Out-Null
  Copy-Item -Path (Join-Path $candidateDir "*") -Destination $deployedDir -Recurse -Force

  $apiProc = Start-ApiProcess -WorkingDir $deployedDir -Port $Port
  if (-not (Wait-ApiReady -BaseUrl $baseUrl -TimeoutSec 20)) {
    throw "Candidate app did not become ready on $baseUrl"
  }
  $candidateSmoke = Invoke-SmokeCheck -BaseUrl $baseUrl
  Stop-ApiProcess -Process $apiProc
  $apiProc = $null

  Remove-Item -Recurse -Force -Path $deployedDir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $deployedDir | Out-Null
  Copy-Item -Path (Join-Path $stableDir "*") -Destination $deployedDir -Recurse -Force
  $rollbackDigest = Get-DirectoryDigest -Path $deployedDir

  if ($rollbackDigest.overallSha256 -ne $stableDigest.overallSha256) {
    throw "Rollback digest does not match stable digest."
  }

  $apiProc = Start-ApiProcess -WorkingDir $deployedDir -Port $Port
  if (-not (Wait-ApiReady -BaseUrl $baseUrl -TimeoutSec 20)) {
    throw "Rolled-back app did not become ready on $baseUrl"
  }
  $rollbackSmoke = Invoke-SmokeCheck -BaseUrl $baseUrl
  Stop-ApiProcess -Process $apiProc
  $apiProc = $null

  $rollbackEvidence = @{
    ok = $true
    date = (Get-Date).ToUniversalTime().ToString("o")
    baseUrl = $baseUrl
    stableDigest = $stableDigest.overallSha256
    candidateDigest = $candidateDigest.overallSha256
    rollbackDigest = $rollbackDigest.overallSha256
    checks = @{
      candidateSmoke = $candidateSmoke
      rollbackSmoke = $rollbackSmoke
      rollbackMatchesStable = ($rollbackDigest.overallSha256 -eq $stableDigest.overallSha256)
    }
    backupCheckpoint = @{
      path = $backupCheckpointDir
      digest = $backupDigest.overallSha256
      matchesStable = ($backupDigest.overallSha256 -eq $stableDigest.overallSha256)
      fileCount = $backupDigest.fileCount
    }
  }

  $backupEvidence = @{
    ok = $true
    date = (Get-Date).ToUniversalTime().ToString("o")
    checkpointPath = $backupCheckpointDir
    artifact = "services/api/dist"
    digest = $backupDigest.overallSha256
    fileCount = $backupDigest.fileCount
    validation = @{
      matchesStableSnapshot = ($backupDigest.overallSha256 -eq $stableDigest.overallSha256)
      validatedDuringRehearsal = $true
    }
  }

  $rollbackEvidence | ConvertTo-Json -Depth 10 | Set-Content -Path $rollbackEvidencePath -Encoding UTF8
  $backupEvidence | ConvertTo-Json -Depth 10 | Set-Content -Path $backupEvidencePath -Encoding UTF8

  Write-Output "Rollback rehearsal completed."
  Write-Output "Rollback evidence: $rollbackEvidencePath"
  Write-Output "Backup checkpoint evidence: $backupEvidencePath"
  Write-Output "Backup checkpoint dir: $backupCheckpointDir"
} finally {
  Stop-ApiProcess -Process $apiProc
  if (Test-Path $tmpRoot) {
    Remove-Item -Recurse -Force -Path $tmpRoot -ErrorAction SilentlyContinue
  }
}
