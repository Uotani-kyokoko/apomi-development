# 本番リポジトリへだけ push（一時的に prod 設定 → push → ローカルを dev に戻す）
# Usage: powershell -ExecutionPolicy Bypass -File scripts/push-prod.ps1
# 必要なら環境変数 PROD_GITHUB_TOKEN に write 可能な token を入れて実行

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

$ProdRemote = "prod"
$ProdUrl = "https://github.com/fortunatunabiz/Apomy.git"
$remotes = git remote
if ($remotes -notcontains $ProdRemote) {
  git remote add $ProdRemote $ProdUrl
} else {
  git remote set-url $ProdRemote $ProdUrl
}

# 作業ツリーが汚いときは中断（誤った本番反映を防ぐ）
$dirty = git status --porcelain
if ($dirty) {
  throw "未コミットの変更があります。先に commit / push-dev してから実行してください。"
}

Write-Host "==> Switch to PROD env (temporary commit)"
Copy-Item "js\env.prod.js" "js\env.js" -Force
Set-GasEnv "prod"
git add js/env.js gas/Code.gs
git commit -m "chore: temporary prod env for customer release"

try {
  Write-Host "==> Push to prod remote (fortunatunabiz/Apomy)"
  if ($env:PROD_GITHUB_TOKEN) {
    $pushUrl = "https://x-access-token:$($env:PROD_GITHUB_TOKEN)@github.com/fortunatunabiz/Apomy.git"
    git push $pushUrl HEAD:main
  } else {
    git push $ProdRemote HEAD:main
  }
  Write-Host "DONE: production push"
}
finally {
  Write-Host "==> Restore DEV env on local main"
  git reset --hard HEAD~1
  Copy-Item "js\env.dev.js" "js\env.js" -Force
  Set-GasEnv "dev"
  Write-Host "Local tree restored to development config"
}
