param(
  [string]$MongoExe = "C:\Users\xds\tools\mongodb-win32-x86_64-windows-8.0.6\bin\mongod.exe",
  [int]$Port = 27018,
  [string]$WorkspaceRoot = "",
  [switch]$SkipIntegration,
  [switch]$SkipEvidence
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
  $WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Wait-MongoPort {
  param(
    [string]$TargetHost,
    [int]$Port,
    [int]$TimeoutMs = 15000
  )

  $started = Get-Date
  while (((Get-Date) - $started).TotalMilliseconds -lt $TimeoutMs) {
    $client = $null
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $async = $client.BeginConnect($TargetHost, $Port, $null, $null)
      if ($async.AsyncWaitHandle.WaitOne(250)) {
        $client.EndConnect($async)
        $client.Close()
        return $true
      }
    } catch {
      # keep polling
    } finally {
      if ($client) { $client.Close() }
    }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

if (-not (Test-Path $MongoExe)) {
  throw "mongod executable not found: $MongoExe"
}

$tmpDir = Join-Path $WorkspaceRoot ".tmp"
$dbPath = Join-Path $tmpDir "mongo-local-checks-db"
$logPath = Join-Path $tmpDir "mongo-local-checks.log"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
New-Item -ItemType Directory -Force -Path $dbPath | Out-Null
if (Test-Path $logPath) { Remove-Item -Force $logPath }

$mongod = Start-Process -FilePath $MongoExe -ArgumentList @(
  "--dbpath", $dbPath,
  "--bind_ip", "127.0.0.1",
  "--port", "$Port",
  "--logpath", $logPath,
  "--logappend"
) -PassThru

try {
  if (-not (Wait-MongoPort -TargetHost "127.0.0.1" -Port $Port -TimeoutMs 20000)) {
    $tail = if (Test-Path $logPath) { (Get-Content $logPath -Tail 80 | Out-String) } else { "no log yet" }
    throw "mongod failed to open 127.0.0.1:$Port`n$tail"
  }

  $env:MONGODB_URI = "mongodb://127.0.0.1:$Port"
  $env:MONGODB_DB = "cbsp_local_checks_$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"

  Push-Location $WorkspaceRoot
  try {
    if (-not $SkipIntegration) {
      & npm.cmd run test:api:integration:mongo
      if ($LASTEXITCODE -ne 0) {
        throw "test:api:integration:mongo failed with exit code $LASTEXITCODE"
      }
    }

    if (-not $SkipEvidence) {
      & npm.cmd run qa:e2e:evidence:mongo
      if ($LASTEXITCODE -ne 0) {
        throw "qa:e2e:evidence:mongo failed with exit code $LASTEXITCODE"
      }
    }
  } finally {
    Pop-Location
  }

  Write-Output "Mongo local checks completed."
  Write-Output "MONGODB_URI=$env:MONGODB_URI"
  $utcStamp = [DateTime]::UtcNow.ToString("yyyy-MM-dd")
  Write-Output "Evidence file: $WorkspaceRoot\\qa-evidence\\qa-e2e-mongo-$utcStamp.json"
} finally {
  if ($mongod -and -not $mongod.HasExited) {
    Stop-Process -Id $mongod.Id -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $dbPath) {
    Remove-Item -Recurse -Force -Path $dbPath -ErrorAction SilentlyContinue
  }
  if (Test-Path $logPath) {
    Remove-Item -Force -Path $logPath -ErrorAction SilentlyContinue
  }
}
