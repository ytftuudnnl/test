param(
  [Parameter(Mandatory = $true)]
  [string]$Owner,
  [Parameter(Mandatory = $true)]
  [string]$Repo,
  [string]$Branch = "main",
  [string[]]$RequiredChecks = @("api"),
  [int]$RequiredApprovals = 1,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if ($RequiredApprovals -lt 1 -or $RequiredApprovals -gt 6) {
  throw "RequiredApprovals must be between 1 and 6."
}

$apiUrl = "https://api.github.com/repos/$Owner/$Repo/branches/$Branch/protection"

$payload = @{
  required_status_checks = @{
    strict = $true
    contexts = $RequiredChecks
  }
  enforce_admins = $true
  required_pull_request_reviews = @{
    dismiss_stale_reviews = $true
    require_code_owner_reviews = $false
    required_approving_review_count = $RequiredApprovals
    require_last_push_approval = $false
  }
  restrictions = $null
  required_conversation_resolution = $true
  allow_force_pushes = $false
  allow_deletions = $false
  required_linear_history = $true
}

$json = $payload | ConvertTo-Json -Depth 10

if ($DryRun) {
  Write-Host "[DRY RUN] PUT $apiUrl"
  Write-Host $json
  exit 0
}

if ([string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
  throw "GITHUB_TOKEN is required. Set it before running this script."
}

$headers = @{
  Accept = "application/vnd.github+json"
  Authorization = "Bearer $($env:GITHUB_TOKEN)"
  "X-GitHub-Api-Version" = "2022-11-28"
}

Write-Host ("Applying branch protection to {0}/{1}:{2} ..." -f $Owner, $Repo, $Branch)
$response = Invoke-RestMethod -Method Put -Uri $apiUrl -Headers $headers -Body $json -ContentType "application/json"

$result = [ordered]@{
  ok = $true
  owner = $Owner
  repo = $Repo
  branch = $Branch
  requiredChecks = $RequiredChecks
  requiredApprovals = $RequiredApprovals
  url = $response.url
}

$result | ConvertTo-Json -Depth 6
