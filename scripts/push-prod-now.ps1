# Push to production (force-with-lease). Run after prod temp commit exists.
# Usage:
#   $env:PROD_GITHUB_TOKEN = 'ghp_...'
#   powershell -ExecutionPolicy Bypass -File scripts/push-prod-now.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Set-GasEnv([string]$EnvName) {
  $src = Join-Path $Root "gas\env.$EnvName.gs"
  $codePath = Join-Path $Root "gas\Code.gs"
  $srcText = Get-Content -Raw -Encoding UTF8 $src
  $code = Get-Content -Raw -Encoding UTF8 $codePath
  $pattern = '(?s)// === BEGIN ENV.*?// === END ENV ==='
  if ($code -notmatch $pattern) {
    throw "ENV marker not found in gas/Code.gs"
  }
  $replacement = $srcText.TrimEnd() + "`n"
  $updated = [regex]::Replace($code, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $replacement })
  [System.IO.File]::WriteAllText($codePath, $updated, (New-Object System.Text.UTF8Encoding $false))
}

if (-not $env:PROD_GITHUB_TOKEN) {
  throw "PROD_GITHUB_TOKEN is not set"
}

# NOTE: "@github" breaks PowerShell double-quoted strings; build URL safely.
$pushUrl = ('https://x-access-token:{0}@github.com/fortunatunabiz/Apomy.git' -f $env:PROD_GITHUB_TOKEN)

Write-Host "==> Fetch prod/main"
git fetch $pushUrl main:refs/remotes/prod/main

$sha = (git rev-parse prod/main).Trim()
Write-Host "==> Remote main: $sha"
Write-Host "==> Local HEAD:  $((git rev-parse HEAD).Trim())"

Write-Host "==> Push with force-with-lease"
git push --force-with-lease=main:$sha $pushUrl HEAD:main

Write-Host "==> Restore DEV env on local main"
git reset --hard HEAD~1
Copy-Item "js\env.dev.js" "js\env.js" -Force
Set-GasEnv "dev"
Write-Host "DONE: production push complete, local restored to dev"
