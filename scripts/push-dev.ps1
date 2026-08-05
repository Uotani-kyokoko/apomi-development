# 開発リポジトリへ push（常に env.dev を適用）
# Usage: powershell -ExecutionPolicy Bypass -File scripts/push-dev.ps1

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
    throw "gas/Code.gs に ENV マーカーが見つかりません"
  }
  $replacement = $srcText.TrimEnd() + "`n"
  $updated = [regex]::Replace($code, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $replacement })
  [System.IO.File]::WriteAllText($codePath, $updated, (New-Object System.Text.UTF8Encoding $false))
}

Write-Host "==> Apply DEV env"
Copy-Item "js\env.dev.js" "js\env.js" -Force
Set-GasEnv "dev"

git remote get-url origin | Out-Null
git add -A
$status = git status --porcelain
if ($status) {
  git commit -m "chore: sync development environment config"
}

Write-Host "==> Push to origin (Uotani-kyokoko/apomi-development)"
git push -u origin HEAD:main
Write-Host "DONE: development push"
