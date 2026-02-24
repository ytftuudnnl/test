param(
  [Parameter(Mandatory = $true)]
  [string]$Owner,
  [Parameter(Mandatory = $true)]
  [string]$Repo,
  [string]$Branch = "main",
  [string]$CommitMessage = "chore: release-ready update",
  [switch]$SkipChecks,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $PSCommandPath
$workspaceRoot = Split-Path -Parent $scriptDir

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [switch]$IgnoreError
  )

  if ($DryRun) {
    Write-Host "[DRY RUN] $Command"
    return
  }

  Write-Host "[RUN] $Command"
  cmd.exe /c $Command
  if ($LASTEXITCODE -ne 0 -and -not $IgnoreError) {
    throw "Command failed ($LASTEXITCODE): $Command"
  }
}

function Ensure-GitRepo {
  $isRepo = $false
  try {
    git rev-parse --is-inside-work-tree > $null 2>&1
    if ($LASTEXITCODE -eq 0) { $isRepo = $true }
  } catch {
    $isRepo = $false
  }

  if ($isRepo) { return }

  Invoke-Step "git init"
  Invoke-Step "git branch -M $Branch"
}

function Ensure-GitIdentity {
  $name = ""
  $email = ""

  try {
    $name = (git config user.name 2>$null | Out-String).Trim()
  } catch {
    $name = ""
  }

  try {
    $email = (git config user.email 2>$null | Out-String).Trim()
  } catch {
    $email = ""
  }

  if ([string]::IsNullOrWhiteSpace($name)) {
    Invoke-Step "git config user.name ""$Owner"""
  }

  if ([string]::IsNullOrWhiteSpace($email)) {
    Invoke-Step "git config user.email ""$Owner@users.noreply.github.com"""
  }
}

function Ensure-TargetBranch {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BranchName
  )

  $currentBranch = ""
  try {
    $currentBranch = (git rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
  } catch {
    $currentBranch = ""
  }

  if ($currentBranch -eq $BranchName) {
    return
  }

  git show-ref --verify --quiet "refs/heads/$BranchName"
  $exists = ($LASTEXITCODE -eq 0)

  if ($exists) {
    Invoke-Step "git checkout $BranchName"
  } else {
    Invoke-Step "git checkout -b $BranchName"
  }
}

function Push-Branch {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Owner,
    [Parameter(Mandatory = $true)]
    [string]$Repo,
    [Parameter(Mandatory = $true)]
    [string]$Branch
  )

  if ($DryRun) {
    Write-Host "[DRY RUN] git push -u origin $Branch"
    return
  }

  function Sync-RemoteBeforePush {
    param(
      [Parameter(Mandatory = $true)]
      [string]$BranchName
    )

    Write-Host "[RUN] git fetch origin"
    git fetch origin
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed ($LASTEXITCODE): git fetch origin"
    }

    git show-ref --verify --quiet "refs/remotes/origin/$BranchName"
    if ($LASTEXITCODE -ne 0) {
      return
    }

    $countsRaw = (git rev-list --left-right --count "HEAD...origin/$BranchName" | Out-String).Trim()
    $parts = $countsRaw -split "\s+"
    if ($parts.Length -lt 2) {
      return
    }

    $behind = [int]$parts[1]
    if ($behind -le 0) {
      return
    }

    git merge-base HEAD "origin/$BranchName" > $null 2>&1
    $hasCommonBase = ($LASTEXITCODE -eq 0)

    if ($hasCommonBase) {
      Write-Host "[RUN] git rebase origin/$BranchName"
      git rebase "origin/$BranchName"
      if ($LASTEXITCODE -ne 0) {
        throw "Rebase failed. Resolve conflicts and run: git rebase --continue"
      }
      return
    }

    Write-Host "[RUN] git rebase --root --onto origin/$BranchName"
    git rebase --root --onto "origin/$BranchName"
    if ($LASTEXITCODE -ne 0) {
      throw "Root rebase failed. Resolve conflicts and run: git rebase --continue"
    }
  }

  if ([string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
    Sync-RemoteBeforePush -BranchName $Branch
    Invoke-Step "git push -u origin $Branch"
    return
  }

  $originalUrl = ""
  try {
    $originalUrl = (git remote get-url origin | Out-String).Trim()
  } catch {
    $originalUrl = "https://github.com/$Owner/$Repo.git"
  }

  $tokenUrl = "https://x-access-token:{0}@github.com/{1}/{2}.git" -f $env:GITHUB_TOKEN, $Owner, $Repo

  Write-Host "[RUN] git push -u origin $Branch (using GITHUB_TOKEN)"
  git remote set-url origin $tokenUrl > $null 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to set authenticated remote URL."
  }

  try {
    Sync-RemoteBeforePush -BranchName $Branch
    git push -u origin $Branch
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed ($LASTEXITCODE): git push -u origin $Branch"
    }
  } finally {
    git remote set-url origin $originalUrl > $null 2>&1
  }
}

Write-Host "Preparing publish for $Owner/$Repo (branch=$Branch)"

Push-Location $workspaceRoot
try {
  if (-not $SkipChecks) {
    Invoke-Step "npm.cmd run release:check"
  }

  Ensure-GitRepo
  Ensure-GitIdentity
  Ensure-TargetBranch -BranchName $Branch

  $remoteUrl = "https://github.com/$Owner/$Repo.git"

  $remoteExists = $false
  try {
    git remote get-url origin > $null 2>&1
    if ($LASTEXITCODE -eq 0) { $remoteExists = $true }
  } catch {
    $remoteExists = $false
  }

  if ($remoteExists) {
    Invoke-Step "git remote set-url origin $remoteUrl"
  } else {
    Invoke-Step "git remote add origin $remoteUrl"
  }

  Invoke-Step "git add -A"

  $hasChanges = $true
  if (-not $DryRun) {
    $status = git status --porcelain
    $hasChanges = -not [string]::IsNullOrWhiteSpace(($status -join "`n"))
  }

  if ($DryRun) {
    Write-Host "[DRY RUN] git commit -m ""$CommitMessage"""
    Write-Host "[DRY RUN] git push -u origin $Branch"
    exit 0
  }

  if ($hasChanges) {
    Invoke-Step "git commit -m ""$CommitMessage"""
  } else {
    Write-Host "No staged changes to commit."
  }

  Push-Branch -Owner $Owner -Repo $Repo -Branch $Branch

  Write-Host "Publish completed."
} finally {
  Pop-Location
}
