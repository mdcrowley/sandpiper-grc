<#
  Sandpiper GRC - one-command operations for the local prototype.
  Usage: .\grc.ps1 <start|stop|restart|health|dev|seed|test|typecheck|build|backup|npm> [args]
  If scripts are blocked: powershell -ExecutionPolicy Bypass -File .\grc.ps1 start
#>
param(
  [Parameter(Position = 0)][string]$Command = 'help',
  [string]$Profile = 'pilot',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root
$env:Path = "$root\.tools\node;$env:Path"
if (-not $env:GRC_PORT) { $env:GRC_PORT = '8080' }
$dataDir = if ($env:GRC_DATA_DIR) { $env:GRC_DATA_DIR } else { Join-Path $root 'data' }
$pidFile = Join-Path $dataDir 'grc.pid'
$url = "http://127.0.0.1:$($env:GRC_PORT)"

if (-not (Test-Path "$root\.tools\node\node.exe")) {
  Write-Host "Portable Node.js is missing from .tools\node. See CLAUDE.md (Install on a new machine)." -ForegroundColor Red
  exit 1
}

function Get-ServerProcess {
  if (-not (Test-Path $pidFile)) { return $null }
  $id = [int](Get-Content $pidFile -Raw)
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'node') { return $p }
  Remove-Item $pidFile -Force   # stale
  return $null
}

function Test-Health {
  try { return (Invoke-RestMethod "$url/api/health" -TimeoutSec 3).ok -eq $true } catch { return $false }
}

function Stop-Server {
  $p = Get-ServerProcess
  if (-not $p) { Write-Host 'Not running.'; return }
  # Ask for a clean shutdown (flushes the embedded database); force only if that fails.
  New-Item -ItemType File -Force (Join-Path $dataDir 'grc.stop') | Out-Null
  if (-not $p.WaitForExit(15000)) { Stop-Process -Id $p.Id -Force; $p.WaitForExit(5000) | Out-Null }
  Remove-Item (Join-Path $dataDir 'grc.stop') -Force -ErrorAction SilentlyContinue
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host 'Stopped.'
}

function Build-Web {
  $index = Join-Path $root 'dist\web\index.html'
  $newest = Get-ChildItem (Join-Path $root 'web') -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not (Test-Path $index) -or ($newest -and $newest.LastWriteTime -gt (Get-Item $index).LastWriteTime)) {
    Write-Host 'Building web app...'
    & npm.cmd run build --silent
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
  }
}

function Start-Server {
  if (Get-ServerProcess) { Write-Host "Already running at $url"; return }
  if (-not (Test-Path "$root\node_modules")) { & npm.cmd install --no-fund --no-audit }
  Build-Web
  New-Item -ItemType Directory -Force $dataDir | Out-Null
  $log = Join-Path $dataDir 'server.log'
  $tsx = Join-Path $root 'node_modules\tsx\dist\cli.mjs'
  Start-Process -FilePath "$root\.tools\node\node.exe" -ArgumentList "`"$tsx`"", 'server/src/main.ts' `
    -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err" | Out-Null
  foreach ($i in 1..60) { if (Test-Health) { break }; Start-Sleep -Milliseconds 500 }
  if (Test-Health) { Write-Host "Sandpiper GRC is running at $url" -ForegroundColor Green }
  else { Write-Host "Server did not become healthy. See $log.err" -ForegroundColor Red; exit 1 }
}

switch ($Command) {
  'start'   { Start-Server }
  'stop'    { Stop-Server }
  'restart' { Stop-Server; Start-Server }
  'health'  { if (Test-Health) { Write-Host "Healthy: $url" -ForegroundColor Green } else { Write-Host 'Not responding.' -ForegroundColor Red; exit 1 } }
  'build'   { & npm.cmd run build }
  'dev' {
    Stop-Server
    Write-Host "API on $url, web on http://127.0.0.1:5173 (Ctrl+C stops both)"
    $api = Start-Process -FilePath "$root\.tools\node\npm.cmd" -ArgumentList 'run', 'server' -WorkingDirectory $root -NoNewWindow -PassThru
    try { & npm.cmd run web } finally { if (-not $api.HasExited) { taskkill /PID $api.Id /T /F | Out-Null } }
  }
  'seed' {
    $wasRunning = [bool](Get-ServerProcess)
    if ($wasRunning) { Stop-Server }
    & npm.cmd run --silent seed -- --profile $Profile
    $code = $LASTEXITCODE
    if ($wasRunning) { Start-Server }
    exit $code
  }
  'test'      { & npm.cmd test; exit $LASTEXITCODE }
  'typecheck' { & npm.cmd run typecheck; exit $LASTEXITCODE }
  'backup' {
    $wasRunning = [bool](Get-ServerProcess)
    if ($wasRunning) { Stop-Server }   # the embedded database must be closed for a consistent copy
    $dest = Join-Path $root ("backups\" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force $dest | Out-Null
    Copy-Item (Join-Path $dataDir '*') $dest -Recurse -Exclude 'grc.pid', 'server.log*'
    Write-Host "Backed up to $dest"
    if ($wasRunning) { Start-Server }
  }
  'npm' { & npm.cmd @Rest; exit $LASTEXITCODE }
  default {
    Write-Host 'Usage: .\grc.ps1 <start|stop|restart|health|dev|seed [-Profile pilot|dev]|test|typecheck|build|backup|npm ...>'
  }
}
