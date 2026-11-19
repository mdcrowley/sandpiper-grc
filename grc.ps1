<#
  Sandpiper GRC - one-command operations for the local prototype.
  Usage: .\grc.ps1 help
  If scripts are blocked: powershell -ExecutionPolicy Bypass -File .\grc.ps1 start

  The work of backup, restore, export, import and status is done in TypeScript
  (server/src/ops, called through server/src/cli.ts); this script stops and starts the
  server around it. See docs/operations.md.
#>
param(
  [Parameter(Position = 0)][string]$Command = 'help',
  [string]$Profile = 'pilot',      # seed: pilot | dev
  [int]$Prune = 0,                 # backup, schedule-backup: keep only the newest n backups
  [string]$Label = 'manual',       # backup: recorded in the manifest
  [string]$At = '02:00',           # schedule-backup: time of day, HH:mm
  [int]$Lines = 40,                # logs: how many lines to show
  [switch]$Follow,                 # logs: keep showing new error lines
  [switch]$NoSecrets,              # export-all: leave out password hashes, second-factor secrets, sessions
  [string]$Out,                    # export-all: destination folder
  [switch]$Force,                  # restore: accept a backup made by newer code
  [switch]$SkipInstall,            # upgrade: do not run npm install (no network)
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root
$env:Path = "$root\.tools\node;$env:Path"
if (-not $env:GRC_PORT) { $env:GRC_PORT = '8080' }
$dataDir = if ($env:GRC_DATA_DIR) { $env:GRC_DATA_DIR } else { Join-Path $root 'data' }
$backupDir = if ($env:GRC_BACKUP_DIR) { $env:GRC_BACKUP_DIR } else { Join-Path $root 'backups' }
$webDist = if ($env:GRC_WEB_DIST) { $env:GRC_WEB_DIST } else { Join-Path $root 'dist\web' }
$pidFile = Join-Path $dataDir 'grc.pid'
$log = Join-Path $dataDir 'server.log'
$url = "http://127.0.0.1:$($env:GRC_PORT)"
$node = Join-Path $root '.tools\node\node.exe'
$tsx = Join-Path $root 'node_modules\tsx\dist\cli.mjs'
$taskName = "Sandpiper GRC backup ($(Split-Path $root -Leaf))"

if (-not (Test-Path $node)) {
  Write-Host 'Portable Node.js is missing from .tools\node.' -ForegroundColor Red
  Write-Host 'Run:  powershell -ExecutionPolicy Bypass -File .\tools\install-node.ps1   (see docs\installation.md)'
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

# Runs a program and shows everything it prints, in order. Returns nothing: read $LASTEXITCODE.
# Windows PowerShell turns a program's error output into error records when it is redirected,
# and with the 'Stop' preference the first such line would end this script half-way (for
# example with the server stopped). So the preference is relaxed here, and only here.
function Invoke-Native {
  $ErrorActionPreference = 'Continue'
  $exe = $args[0]
  $rest = @($args | Select-Object -Skip 1)
  & $exe @rest 2>&1 | ForEach-Object { "$_" } | Tee-Object -Variable lines | Out-Host
  $script:lastOutput = $lines
}

function Install-Packages {
  if (-not (Test-Path "$root\node_modules")) {
    Invoke-Native npm.cmd install --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
  }
}

function Build-Web([switch]$IfMissing) {
  $index = Join-Path $webDist 'index.html'
  if ($IfMissing -and (Test-Path $index)) { return }
  $newest = Get-ChildItem (Join-Path $root 'web'), (Join-Path $root 'docs\user') -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not (Test-Path $index) -or ($newest -and $newest.LastWriteTime -gt (Get-Item $index).LastWriteTime)) {
    Write-Host 'Building web app...'
    Invoke-Native npm.cmd run build --silent
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
  }
}

# Starts the server and waits for the health check. Returns $true when it is healthy.
# -NoBuild restarts with the web application as it is (used after backup, restore and the
# like, where nothing has changed and the server must come back).
function Start-Server([switch]$NoBuild) {
  if (Get-ServerProcess) { Write-Host "Already running at $url"; return $true }
  Install-Packages
  Build-Web -IfMissing:$NoBuild
  New-Item -ItemType Directory -Force $dataDir | Out-Null
  Start-Process -FilePath $node -ArgumentList "`"$tsx`"", 'server/src/main.ts' `
    -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err" | Out-Null
  foreach ($i in 1..60) { if (Test-Health) { break }; Start-Sleep -Milliseconds 500 }
  if (Test-Health) { Write-Host "Sandpiper GRC is running at $url" -ForegroundColor Green; return $true }
  Write-Host "Server did not become healthy. See $log.err  (.\grc.ps1 logs)" -ForegroundColor Red
  return $false
}

# Runs a command of server/src/cli.ts and returns its exit code.
function Invoke-Cli {
  Install-Packages
  Invoke-Native $node $tsx 'server/src/cli.ts' @args
  return $LASTEXITCODE
}

# Runs a command that needs the database to itself: stops the server, runs it, and starts
# the server again if it was running. Returns the command's exit code. A code of 2 means
# the data folder was left incomplete, so the server is not started on it.
function Invoke-Offline {
  $wasRunning = [bool](Get-ServerProcess)
  if ($wasRunning) { Stop-Server }
  $code = 1
  try { $code = Invoke-Cli @args } catch { Write-Host "Failed: $_" -ForegroundColor Red }
  if ($code -eq 2) { Write-Host 'The server has NOT been started. Follow the message above.' -ForegroundColor Red }
  elseif ($wasRunning -and -not (Start-Server -NoBuild)) { if ($code -eq 0) { $code = 1 } }
  return $code
}

function Get-NewestBackup {
  if (-not (Test-Path $backupDir)) { return $null }
  Get-ChildItem $backupDir -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'manifest.json') } |
    Sort-Object Name -Descending | Select-Object -First 1
}

function Show-Usage {
  Write-Host @'
Usage: .\grc.ps1 <command>

  start | stop | restart | health     run the server on http://127.0.0.1:8080
  status                              version, port, process, data size, last backup, pending migrations
  logs [-Lines n] [-Follow]           show the end of the server logs
  seed [-Profile pilot|dev]           load data (idempotent)

  backup [-Prune n]                   verified copy of the data in backups\<timestamp>; -Prune keeps the newest n
  backups                             list backups
  verify-backup [<backup>]            check a backup against its checksums (default: latest)
  restore <backup|latest> [-Force]    replace the data with a backup, keeping a safety copy of the current data
  schedule-backup [-At HH:mm] [-Prune n]   daily backup as a per-user Windows scheduled task (no admin rights)
  unschedule-backup                   remove that task
  export-all [-Out dir] [-NoSecrets]  every table as JSON Lines, plus files and checksums
  import-all <dir>                    load an export into an empty installation
  upgrade [-SkipInstall]              backup, npm install, build, migrate, restart, health check

  dev | build | test | typecheck | ci development (ci = typecheck + tests + build)
  npm <args>                          any npm command with the portable Node.js
'@
}

switch ($Command) {
  'start'   { if (-not (Start-Server)) { exit 1 } }
  'stop'    { Stop-Server }
  'restart' { Stop-Server; if (-not (Start-Server)) { exit 1 } }
  'health'  { if (Test-Health) { Write-Host "Healthy: $url" -ForegroundColor Green } else { Write-Host 'Not responding.' -ForegroundColor Red; exit 1 } }
  'build'   { & npm.cmd run build; exit $LASTEXITCODE }
  'dev' {
    Stop-Server
    Write-Host "API on $url, web on http://127.0.0.1:5173 (Ctrl+C stops both)"
    $api = Start-Process -FilePath "$root\.tools\node\npm.cmd" -ArgumentList 'run', 'server' -WorkingDirectory $root -NoNewWindow -PassThru
    try { & npm.cmd run web } finally { if (-not $api.HasExited) { taskkill /PID $api.Id /T /F | Out-Null } }
  }
  'seed'      { exit (Invoke-Offline seed --profile $Profile) }
  'test'      { & npm.cmd test; exit $LASTEXITCODE }
  'typecheck' { & npm.cmd run typecheck; exit $LASTEXITCODE }
  'ci' {
    # Local continuous integration: the checks to run before every commit or push.
    # Tools print warnings on stderr; judge each step by its exit code only.
    $ErrorActionPreference = 'Continue'
    $steps = [ordered]@{ 'Typecheck' = { & npm.cmd run --silent typecheck }; 'Tests' = { & npm.cmd test }; 'Web build' = { & npm.cmd run --silent build } }
    $failed = @()
    foreach ($name in $steps.Keys) {
      Write-Host "== $name" -ForegroundColor Cyan
      & $steps[$name]
      if ($LASTEXITCODE -ne 0) { $failed += $name }
    }
    if ($failed.Count) { Write-Host ("CI FAILED: " + ($failed -join ', ')) -ForegroundColor Red; exit 1 }
    Write-Host 'CI passed: typecheck, tests and web build.' -ForegroundColor Green
  }

  'status' {
    Get-ServerProcess | Out-Null   # clears a stale process file first
    $code = Invoke-Cli status
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
      $info = $task | Get-ScheduledTaskInfo
      $result = if ($info.LastRunTime.Year -lt 2000) { 'has not run yet' } elseif ($info.LastTaskResult -eq 0) { "last run $($info.LastRunTime) succeeded" } else { "last run $($info.LastRunTime) FAILED (code $($info.LastTaskResult)); see $backupDir\scheduled-backup.log" }
      Write-Host "Schedule:    backup task '$taskName' is $($task.State); next run $($info.NextRunTime); $result"
    } else {
      Write-Host 'Schedule:    no scheduled backup (.\grc.ps1 schedule-backup)'
    }
    exit $code
  }

  'logs' {
    if (-not (Test-Path $log) -and -not (Test-Path "$log.err")) { Write-Host "No logs yet in $dataDir (the server has not been started by grc.ps1)."; exit 0 }
    if (Test-Path $log) { Write-Host "--- $log" -ForegroundColor Cyan; Get-Content $log -Tail $Lines }
    Write-Host "--- $log.err (errors)" -ForegroundColor Cyan
    if (-not (Test-Path "$log.err")) { exit 0 }
    if ($Follow) { Get-Content "$log.err" -Tail $Lines -Wait } else { Get-Content "$log.err" -Tail $Lines }
  }

  'backup' {
    $a = @('backup', '--label', $Label)
    if ($Prune -gt 0) { $a += '--prune', "$Prune" }
    $code = Invoke-Offline @a
    if ($Label -eq 'scheduled') {
      # One line per unattended run, so a failure can be found afterwards.
      $line = '{0}  exit {1}  {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $code, (@($script:lastOutput) -join ' | ')
      Add-Content -Path (Join-Path $backupDir 'scheduled-backup.log') -Value $line -Encoding UTF8
    }
    exit $code
  }
  'backups'       { exit (Invoke-Cli backups) }
  'verify-backup' { $ref = if ($Rest) { $Rest[0] } else { 'latest' }; exit (Invoke-Cli verify-backup $ref) }
  'restore' {
    if (-not $Rest) { Write-Host 'Say which backup: .\grc.ps1 restore <name|path|latest>   (list them with .\grc.ps1 backups)' -ForegroundColor Red; exit 1 }
    $a = @('restore', $Rest[0])
    if ($Force) { $a += '--force' }
    exit (Invoke-Offline @a)
  }

  'export-all' {
    $a = @('export-all')
    if ($Out) { $a += '--out', $Out }
    if ($NoSecrets) { $a += '--no-secrets' }
    exit (Invoke-Offline @a)
  }
  'import-all' {
    if (-not $Rest) { Write-Host 'Say which export folder: .\grc.ps1 import-all <dir>' -ForegroundColor Red; exit 1 }
    exit (Invoke-Offline import-all $Rest[0])
  }

  'schedule-backup' {
    # A per-user task: it needs no administrator rights and runs only while this user is signed in.
    $time = [datetime]::ParseExact($At, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
    New-Item -ItemType Directory -Force $backupDir | Out-Null
    $q = { param($s) "'" + ($s -replace "'", "''") + "'" }
    # The task starts with a clean environment, so the settings in use now are written into it.
    $set = ''
    foreach ($name in 'GRC_DATA_DIR', 'GRC_BACKUP_DIR', 'GRC_WEB_DIST', 'GRC_PORT', 'GRC_TIMEZONE', 'GRC_CURRENCY', 'GRC_MODULES') {
      $value = [Environment]::GetEnvironmentVariable($name, 'Process')
      if ($value) { $set += "`$env:$name = $(& $q $value); " }
    }
    $pruneArg = if ($Prune -gt 0) { " -Prune $Prune" } else { '' }
    $logFile = Join-Path $backupDir 'scheduled-backup.log'
    $script = "$set& $(& $q (Join-Path $root 'grc.ps1')) backup -Label scheduled$pruneArg; exit `$LASTEXITCODE"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $root `
      -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"$script`""
    $trigger = New-ScheduledTaskTrigger -Daily -At $time
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
      -Description 'Daily backup of the Sandpiper GRC data folder. Created by grc.ps1 schedule-backup.' -Force | Out-Null
    $keep = if ($Prune -gt 0) { "keeping the newest $Prune" } else { 'keeping every backup (add -Prune n to limit them)' }
    Write-Host "Scheduled '$taskName': every day at $At, $keep." -ForegroundColor Green
    Write-Host "It runs only while you are signed in to Windows; a missed run happens at the next sign-in."
    Write-Host "The server is stopped for a few seconds during each backup. Each run adds a line to $logFile"
    Write-Host 'Check it with .\grc.ps1 status. Remove it with .\grc.ps1 unschedule-backup.'
  }
  'unschedule-backup' {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
      Write-Host "Removed the scheduled task '$taskName'. Existing backups are untouched."
    } else {
      Write-Host "There is no scheduled task '$taskName'."
    }
  }

  'upgrade' {
    # Run this AFTER putting the new code in place (git pull, or unpacking a release).
    $wasRunning = [bool](Get-ServerProcess)
    $script:backupName = $null
    function Stop-Upgrade([string]$step, [bool]$dataMayHaveChanged) {
      Write-Host ''
      Write-Host "UPGRADE FAILED at: $step" -ForegroundColor Red
      Write-Host 'The server is stopped.'
      if ($dataMayHaveChanged) { Write-Host 'The database may have been changed by the new version.' }
      else { Write-Host 'The database has not been changed.' }
      Write-Host ''
      Write-Host 'To try again: fix the problem above and run  .\grc.ps1 upgrade'
      Write-Host 'To go back to the previous version:'
      Write-Host '  1. Put the previous code back (for example: git checkout <previous tag or commit>).'
      if ($script:backupName -and $dataMayHaveChanged) { Write-Host "  2. .\grc.ps1 restore $($script:backupName)" }
      elseif ($script:backupName) { Write-Host "  2. (Not needed: the data is unchanged. The backup, if you want it, is $($script:backupName).)" }
      else { Write-Host '  2. (There was no data to back up.)' }
      Write-Host '  3. .\grc.ps1 npm install'
      Write-Host '  4. .\grc.ps1 start'
      exit 1
    }

    Write-Host '[1/6] Backup' -ForegroundColor Cyan
    if ($wasRunning) { Stop-Server }
    if (Test-Path (Join-Path $dataDir 'pg')) {
      if ((Invoke-Cli backup --label pre-upgrade) -ne 0) {
        Write-Host 'The backup failed, so nothing was upgraded.' -ForegroundColor Red
        if ($wasRunning) { Write-Host 'Start the server again with .\grc.ps1 start once the cause is fixed.' }
        exit 1
      }
      $script:backupName = (Get-NewestBackup).Name
    } else {
      Write-Host 'No database yet: nothing to back up.'
    }

    Write-Host '[2/6] Install packages' -ForegroundColor Cyan
    if ($SkipInstall) { Write-Host 'Skipped (-SkipInstall).' }
    else {
      Invoke-Native npm.cmd install --no-fund --no-audit
      if ($LASTEXITCODE -ne 0) { Stop-Upgrade 'npm install' $false }
    }

    Write-Host '[3/6] Build the web application' -ForegroundColor Cyan
    Invoke-Native npm.cmd run build --silent
    if ($LASTEXITCODE -ne 0) { Stop-Upgrade 'build' $false }

    Write-Host '[4/6] Database migrations' -ForegroundColor Cyan
    if ((Invoke-Cli migrate) -ne 0) { Stop-Upgrade 'database migrations (the failed migration was rolled back; earlier new ones stay applied)' $true }

    Write-Host '[5/6] Start' -ForegroundColor Cyan
    if (-not (Start-Server)) { Stop-Upgrade 'start' $true }

    Write-Host '[6/6] Health check' -ForegroundColor Cyan
    if (-not (Test-Health)) { Stop-Server; Stop-Upgrade 'health check' $true }
    Invoke-Cli status | Out-Null
    Write-Host 'Upgrade complete.' -ForegroundColor Green
    if ($script:backupName) { Write-Host "The data as it was before the upgrade is in backup $($script:backupName)." }
  }

  'npm' { & npm.cmd @Rest; exit $LASTEXITCODE }
  default { Show-Usage }
}
