param(
  [string]$MongoExe = "C:\Users\xds\tools\mongodb-win32-x86_64-windows-8.0.6\bin\mongod.exe",
  [int]$Port = 27019,
  [string]$WorkspaceRoot = ""
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
$dbPath = Join-Path $tmpDir "migration-drill-db"
$logPath = Join-Path $tmpDir "migration-drill.log"
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
  $env:MONGODB_DB = "cbsp_migration_drill_$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"

  Push-Location $WorkspaceRoot
  try {
    & npm.cmd run qa:migration:drill
    if ($LASTEXITCODE -ne 0) {
      throw "qa:migration:drill failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
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
