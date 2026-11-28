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
  [switch]$Follow,                 # logs: keep showing new lines
  [string]$Level,                  # logs: only this level and worse (error, warn, info, debug); audit-deps: fail from this severity
  [switch]$NoSecrets,              # export-all: leave out password hashes, second-factor secrets, sessions
  [string]$Out,                    # export-all: destination folder
  [switch]$Force,                  # restore: accept a backup made by newer code
  [switch]$SkipInstall,            # upgrade: do not run npm install (no network)
  [switch]$Encrypt,                # backup, export-all, schedule-backup: write one encrypted file
  [string]$KeyFile,                # encrypted backups and exports: a 32-byte key file (outside the data folder)
  [string]$PassphraseFile,         # encrypted backups and exports: a file holding the passphrase
  [string]$To,                     # move-files: disk | s3
  [string]$From,                   # upgrade: a folder or .zip holding the new release
  [switch]$Pull,                   # upgrade: fetch the new release with git pull --ff-only
  [switch]$NoRollback,             # upgrade: on failure, stop and print the steps instead of rolling back
  [switch]$IncludeSecretKey,       # backup -Encrypt: also carry the secret key file inside the encrypted backup
  [string]$Folder,                 # audit-archive: write this run's archive to another folder
  [switch]$Full,                   # ci: everything, not only what the changes need
  [switch]$Plan,                   # ci: print what would run (unit tests, browser suites, GitHub jobs) and run nothing
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
# The server speaks HTTPS itself when GRC_TLS_CERT (and GRC_TLS_KEY) are set.
$scheme = if ($env:GRC_TLS_CERT) { 'https' } else { 'http' }
$url = "${scheme}://127.0.0.1:$($env:GRC_PORT)"
$node = Join-Path $root '.tools\node\node.exe'
$tsx = Join-Path $root 'node_modules\tsx\dist\cli.mjs'
$taskName = "Sandpiper GRC backup ($(Split-Path $root -Leaf))"
# Key options for encrypted backups and exports, passed on to server/src/cli.ts.
$keyArgs = @()
if ($KeyFile) { $keyArgs += '--key-file', $KeyFile }
if ($PassphraseFile) { $keyArgs += '--passphrase-file', $PassphraseFile }
$codeDir = Join-Path $backupDir 'code'

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
  # The local check accepts a self-signed certificate: it talks to this machine only.
  $saved = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
  if ($scheme -eq 'https') {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
  }
  try { return (Invoke-RestMethod "$url/api/health" -TimeoutSec 3).ok -eq $true } catch { return $false }
  finally { [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $saved }
}

function Stop-Server {
  $p = Get-ServerProcess
  if (-not $p) { Write-Host 'Not running.'; return }
  # Ask for a clean shutdown (flushes the embedded database); force only if that fails. The server
  # allows itself 20 seconds (it finishes requests in progress and waits for a running backup), so
  # this waits 30 before forcing: a slow but clean stop is never cut short (OP-12).
  New-Item -ItemType File -Force (Join-Path $dataDir 'grc.stop') | Out-Null
  if (-not $p.WaitForExit(30000)) { Stop-Process -Id $p.Id -Force; $p.WaitForExit(5000) | Out-Null }
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

  install                             npm install with the portable Node.js (run tools\install-node.ps1 first)
  start | stop | restart | health     run the server on http://127.0.0.1:8080
  status                              version, port, process, data size, last backup, pending migrations
  logs [-Lines n] [-Follow] [-Level warn]   show the end of the server log (data\logs\grc.log)
  version                             the installed version and commit
  seed [-Profile pilot|dev]           load data (idempotent)

  backup [-Prune n] [-Encrypt [-IncludeSecretKey]]  verified copy of the data in backups\<timestamp>; -Prune keeps the newest n
  backups                             list backups (also the archives the server takes itself)
  verify-backup [<backup>]            check a backup against its checksums (default: latest)
  restore <backup|latest|file> [-Force]   replace the data with a backup, keeping a safety copy of the current data
  schedule-backup [-At HH:mm] [-Prune n] [-Encrypt]   daily backup as a per-user Windows scheduled task (no admin rights)
  unschedule-backup                   remove that task
  export-all [-Out dir] [-NoSecrets] [-Encrypt]   every table as JSON Lines, plus files and checksums
  import-all <dir|file>               load an export into an empty installation
  decrypt <file> [-Out file.tar]      turn an encrypted backup or export into a plain tar file
  new-key <file>                      make a key file for encrypted backups (keep it outside the data folder)
  move-files -To disk|s3              move attached files to the other store, checking each one
  upgrade [-From dir|zip | -Pull] [-SkipInstall] [-NoRollback]
                                      backup, new code, npm install, build, migrate, restart, health check;
                                      puts the previous version back by itself if any step fails
  save-code                           keep a copy of the code as it is now, for upgrade to return to
  secret-key show|rotate              where the secret key comes from (fingerprint only); rotate writes a new one

  Encrypted files use -KeyFile <file> or -PassphraseFile <file>, or the environment variables
  GRC_BACKUP_KEY_FILE, GRC_BACKUP_PASSPHRASE_FILE or GRC_BACKUP_PASSPHRASE.

  dev | build | test | typecheck      development
  ci [-Full] [-Plan]                  local CI for what the changes need (typecheck, their tests, again on UTC, build and
                                      audit when needed); -Full everything; -Plan the plan only, with the browser suites
  audit-deps [-Level high]            known vulnerabilities in production packages; fails only when a fix exists
  audit-archive [-Folder dir]         the audit archive as the database owner (least-privilege database role)
  npm <args>                          any npm command with the portable Node.js
'@
}

switch ($Command) {
  'start'   {
    if (-not (Start-Server)) { exit 1 }
    # The first healthy start keeps a copy of the code, so a later upgrade can always come back to it.
    $lastGood = Join-Path $codeDir 'last-good.tar'
    if (-not (Test-Path $lastGood)) {
      & $node (Join-Path $root 'tools\code-snapshot.mjs') save $root $lastGood | Out-Null
      if ($LASTEXITCODE -eq 0) { Write-Host "Kept a copy of this version's code in $lastGood (used if an upgrade has to be rolled back)." }
    }
  }
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
    # Local continuous integration: the checks to run before every commit or push (tools/ci/run.mjs).
    # By default only what the changes need (since the merge base with main, or the last commit on
    # main, plus uncommitted files), saying what it skips and why; -Full runs everything (typecheck,
    # every test, every test again on UTC, web build, dependency audit); -Plan prints the plan only.
    $a = @('tools/ci/run.mjs')
    if ($Full) { $a += '--full' }
    if ($Plan) { $a += '--plan' }
    if ($Rest) { $a += $Rest }
    if (-not $Plan) { Install-Packages }
    & $node @a
    exit $LASTEXITCODE
  }
  'status' {
    Get-ServerProcess | Out-Null   # clears a stale process file first
    $code = Invoke-Cli status
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
      $info = $task | Get-ScheduledTaskInfo
      $result = if ($info.LastRunTime.Year -lt 2000) { 'has not run yet' } elseif ($info.LastTaskResult -eq 0) { "last run $($info.LastRunTime) succeeded" } else { "last run $($info.LastRunTime) FAILED (code $($info.LastTaskResult)); see $backupDir\scheduled-backup.log" }
      Write-Host "Windows task:   backup task '$taskName' is $($task.State); next run $($info.NextRunTime); $result"
    } else {
      Write-Host 'Windows task:   none (the server takes its own daily backups: Administration > Backups)'
    }
    exit $code
  }

  'logs' {
    # Anything printed before the server's own log started (a failed start) is in server.log.err.
    if ((Test-Path "$log.err") -and (Get-Item "$log.err").Length -gt 0) {
      Write-Host "--- $log.err (start-up errors)" -ForegroundColor Cyan
      Get-Content "$log.err" -Tail ([Math]::Min($Lines, 20))
    }
    # The server's own log (datalogsgrc.log, rotated by size), shown readably.
    $a = @('logs', '--lines', $Lines)
    if ($Level) { $a += '--level', $Level }
    if ($Follow) { $a += '--follow' }
    Install-Packages
    & $node $tsx 'server/src/cli.ts' @a
    exit $LASTEXITCODE
  }

  'version'       { exit (Invoke-Cli version) }
  'audit-deps'    { $a = @('audit-deps'); if ($Level) { $a += '--level', $Level }; exit (Invoke-Cli @a) }
  'audit-archive' { $a = @('audit-archive'); if ($Folder) { $a += '--folder', $Folder }; exit (Invoke-Cli @a) }

  'backup' {
    $a = @('backup', '--label', $Label) + $keyArgs
    if ($Prune -gt 0) { $a += '--prune', "$Prune" }
    if ($Encrypt) { $a += '--encrypt' }
    if ($IncludeSecretKey) { $a += '--include-secret-key' }
    $code = Invoke-Offline @a
    if ($Label -eq 'scheduled') {
      # One line per unattended run, so a failure can be found afterwards.
      $line = '{0}  exit {1}  {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $code, (@($script:lastOutput) -join ' | ')
      Add-Content -Path (Join-Path $backupDir 'scheduled-backup.log') -Value $line -Encoding UTF8
    }
    exit $code
  }
  'backups'       { exit (Invoke-Cli backups) }
  'verify-backup' { $ref = if ($Rest) { $Rest[0] } else { 'latest' }; $a = @('verify-backup', $ref) + $keyArgs; exit (Invoke-Cli @a) }
  'restore' {
    if (-not $Rest) { Write-Host 'Say which backup: .\grc.ps1 restore <name|path|latest>   (list them with .\grc.ps1 backups)' -ForegroundColor Red; exit 1 }
    $a = @('restore', $Rest[0]) + $keyArgs
    if ($Force) { $a += '--force' }
    exit (Invoke-Offline @a)
  }

  'export-all' {
    $a = @('export-all') + $keyArgs
    if ($Out) { $a += '--out', $Out }
    if ($NoSecrets) { $a += '--no-secrets' }
    if ($Encrypt) { $a += '--encrypt' }
    exit (Invoke-Offline @a)
  }
  'import-all' {
    if (-not $Rest) { Write-Host 'Say which export: .\grc.ps1 import-all <folder or file>' -ForegroundColor Red; exit 1 }
    $a = @('import-all', $Rest[0]) + $keyArgs
    exit (Invoke-Offline @a)
  }
  'decrypt' {
    if (-not $Rest) { Write-Host 'Say which file: .\grc.ps1 decrypt <file> [-Out file.tar]' -ForegroundColor Red; exit 1 }
    $a = @('decrypt', $Rest[0]) + $keyArgs
    if ($Out) { $a += '--out', $Out }
    exit (Invoke-Cli @a)
  }
  'new-key' {
    if (-not $Rest) { Write-Host 'Say where to write the key: .\grc.ps1 new-key <file outside the data folder>' -ForegroundColor Red; exit 1 }
    exit (Invoke-Cli new-key $Rest[0])
  }
  'move-files' {
    if ($To -ne 'disk' -and $To -ne 's3') { Write-Host 'Say where to: .\grc.ps1 move-files -To s3   (or -To disk)' -ForegroundColor Red; exit 1 }
    exit (Invoke-Offline move-files --to $To)
  }
  'secret-key' {
    # show: where the key comes from (fingerprint only); rotate: a new key, the old one kept as retired.
    $what = if ($Rest -and $Rest[0]) { $Rest[0] } else { 'show' }
    if ($what -notin @('show', 'rotate')) { Write-Host 'Usage: .\grc.ps1 secret-key show | rotate' -ForegroundColor Red; exit 1 }
    Install-Packages
    $keyCli = 'server/src/core/secretkey-cli.ts'
    if ($what -eq 'show') { Invoke-Native $node $tsx $keyCli show; exit $LASTEXITCODE }
    # rotate needs the database to itself: stop the server, rotate, start it again.
    $wasRunning = [bool](Get-ServerProcess)
    if ($wasRunning) { Stop-Server }
    Invoke-Native $node $tsx $keyCli rotate
    $code = $LASTEXITCODE
    if ($wasRunning -and -not (Start-Server -NoBuild) -and $code -eq 0) { $code = 1 }
    exit $code
  }

  'save-code' {
    $file = Join-Path $codeDir 'last-good.tar'
    Invoke-Native $node (Join-Path $root 'tools\code-snapshot.mjs') save $root $file
    if ($LASTEXITCODE -eq 0) { Write-Host "Saved the code as it is now to $file. upgrade returns to it if an upgrade fails." -ForegroundColor Green }
    exit $LASTEXITCODE
  }

  'schedule-backup' {
    # A per-user task: it needs no administrator rights and runs only while this user is signed in.
    $time = [datetime]::ParseExact($At, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
    New-Item -ItemType Directory -Force $backupDir | Out-Null
    $q = { param($s) "'" + ($s -replace "'", "''") + "'" }
    # The task starts with a clean environment, so the settings in use now are written into it.
    $set = ''
    foreach ($name in 'GRC_DATA_DIR', 'GRC_BACKUP_DIR', 'GRC_WEB_DIST', 'GRC_PORT', 'GRC_TIMEZONE', 'GRC_CURRENCY', 'GRC_MODULES', 'GRC_BACKUP_KEY_FILE', 'GRC_BACKUP_PASSPHRASE_FILE') {
      $value = [Environment]::GetEnvironmentVariable($name, 'Process')
      if ($value) { $set += "`$env:$name = $(& $q $value); " }
    }
    $pruneArg = if ($Prune -gt 0) { " -Prune $Prune" } else { '' }
    $encryptArg = ''
    if ($Encrypt) {
      # The task definition is readable by this user: it names a key file, never holds a passphrase.
      $kf = if ($KeyFile) { $KeyFile } else { $env:GRC_BACKUP_KEY_FILE }
      $pf = if ($PassphraseFile) { $PassphraseFile } else { $env:GRC_BACKUP_PASSPHRASE_FILE }
      if (-not $kf -and -not $pf) { Write-Host 'An encrypted scheduled backup needs -KeyFile or -PassphraseFile (a passphrase typed into the task would be stored in it).' -ForegroundColor Red; exit 1 }
      $encryptArg = if ($kf) { " -Encrypt -KeyFile $(& $q (Resolve-Path $kf).Path)" } else { " -Encrypt -PassphraseFile $(& $q (Resolve-Path $pf).Path)" }
    }
    $logFile = Join-Path $backupDir 'scheduled-backup.log'
    $script = "$set& $(& $q (Join-Path $root 'grc.ps1')) backup -Label scheduled$pruneArg$encryptArg; exit `$LASTEXITCODE"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $root `
      -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"$script`""
    $trigger = New-ScheduledTaskTrigger -Daily -At $time
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
      -Description 'Daily backup of the Sandpiper GRC data folder. Created by grc.ps1 schedule-backup.' -Force | Out-Null
    $keep = if ($Prune -gt 0) { "keeping the newest $Prune" } else { 'keeping every backup (add -Prune n to limit them)' }
    if ($Encrypt) { $keep += ', encrypted' }
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
    # Two ways to run it:
    #   upgrade -From <folder or .zip> (or -Pull): upgrade saves the code as it is, then puts the
    #     new release in place itself, so it can always go back.
    #   upgrade on its own, after the new code is already in place (git pull, unpacked release):
    #     going back uses the copy saved at the last successful upgrade (or by save-code / start).
    # If any step fails, the previous code, packages and data are put back and the previous
    # version is started again, unless -NoRollback is given.
    $wasRunning = [bool](Get-ServerProcess)
    $script:backupName = $null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    New-Item -ItemType Directory -Force $codeDir | Out-Null
    # The snapshot tool is copied aside first, so a broken new version cannot block the way back.
    $snapTool = Join-Path $codeDir 'code-snapshot.mjs'
    Copy-Item (Join-Path $root 'tools\code-snapshot.mjs') $snapTool -Force
    function Invoke-Snapshot {
      Invoke-Native $node $snapTool @args
      if ($LASTEXITCODE -ne 0) { return $null }
      return (@($script:lastOutput) | Select-Object -Last 1) | ConvertFrom-Json
    }
    $script:previous = $null
    $script:fromVersion = (Invoke-Snapshot version $root).version

    function Stop-Upgrade([string]$step, [bool]$dataMayHaveChanged) {
      Write-Host ''
      Write-Host "UPGRADE FAILED at: $step" -ForegroundColor Red
      if (Get-ServerProcess) { Stop-Server }
      if ($NoRollback -or -not $script:previous) {
        if (-not $script:previous) { Write-Host 'No copy of the previous code was saved, so it cannot be put back by itself.' -ForegroundColor Yellow }
        Write-Host 'The server is stopped.'
        if ($dataMayHaveChanged) { Write-Host 'The database may have been changed by the new version.' } else { Write-Host 'The database has not been changed.' }
        Write-Host ''
        Write-Host 'To try again: fix the problem above and run  .\grc.ps1 upgrade'
        Write-Host 'To go back to the previous version:'
        if ($script:previous) { Write-Host "  1. node $snapTool restore `"$root`" `"$($script:previous)`"" }
        else { Write-Host '  1. Put the previous code back (for example: git checkout <previous tag or commit>).' }
        if ($script:backupName -and $dataMayHaveChanged) { Write-Host "  2. .\grc.ps1 restore `"$($script:backupName)`"" }
        elseif ($script:backupName) { Write-Host "  2. (Not needed: the data is unchanged. The backup, if you want it, is $($script:backupName).)" }
        else { Write-Host '  2. (There was no data to back up.)' }
        Write-Host '  3. .\grc.ps1 npm install'
        Write-Host '  4. .\grc.ps1 start'
        exit 1
      }

      Write-Host "Rolling back to version $($script:fromVersion)..." -ForegroundColor Yellow
      $failedAt = $null
      $r = Invoke-Snapshot restore $root $script:previous
      if (-not $r) { $failedAt = 'putting the previous code back' }
      else { Write-Host "  Code: version $($r.version) put back ($($r.written) file(s) written, $($r.removed) removed)." }
      if (-not $failedAt -and $r.packagesChanged) {
        if ($SkipInstall) { Write-Host '  Packages: the package list changed, but -SkipInstall was given: run .\grc.ps1 npm install yourself.' -ForegroundColor Yellow }
        else {
          Invoke-Native npm.cmd install --no-fund --no-audit
          if ($LASTEXITCODE -ne 0) { $failedAt = 'reinstalling the previous packages' } else { Write-Host '  Packages: the previous versions were installed again.' }
        }
      }
      if (-not $failedAt -and $dataMayHaveChanged -and $script:backupName) {
        $restoreArgs = @('restore', $script:backupName, '--force') + $keyArgs
        if ((Invoke-Cli @restoreArgs) -ne 0) { $failedAt = 'restoring the pre-upgrade backup' } else { Write-Host '  Data: the pre-upgrade backup was restored.' }
      } elseif (-not $failedAt) {
        Write-Host '  Data: unchanged by the new version, so nothing to restore.'
      }
      if (-not $failedAt) {
        Invoke-Native npm.cmd run build --silent
        if ($LASTEXITCODE -ne 0) { $failedAt = 'building the previous web application' }
      }
      if (-not $failedAt -and -not ((Start-Server -NoBuild) -and (Test-Health))) { $failedAt = 'starting the previous version' }

      Write-Host ''
      if (-not $failedAt) {
        Write-Host "ROLLED BACK: the upgrade failed at '$step', and version $($script:fromVersion) is running again with the data as it was before." -ForegroundColor Yellow
        if ($script:backupName -and $dataMayHaveChanged) { Write-Host "The pre-upgrade backup $($script:backupName) was restored; the new version's data was kept as a pre-restore backup." }
        Write-Host 'Fix the cause shown above, then run the upgrade again.'
        exit 1
      }
      Write-Host "ROLLBACK INCOMPLETE: the upgrade failed at '$step', and going back failed at: $failedAt." -ForegroundColor Red
      Write-Host 'The server is stopped. To finish by hand:'
      Write-Host "  1. node `"$snapTool`" restore `"$root`" `"$($script:previous)`""
      if ($script:backupName -and $dataMayHaveChanged) { Write-Host "  2. .\grc.ps1 restore `"$($script:backupName)`" -Force" }
      Write-Host '  3. .\grc.ps1 npm install'
      Write-Host '  4. .\grc.ps1 start'
      exit 2
    }

    Write-Host '[1/7] Keep the current code' -ForegroundColor Cyan
    $lastGood = Join-Path $codeDir 'last-good.tar'
    if ($From -or $Pull) {
      $snap = Join-Path $codeDir "pre-upgrade-$stamp.tar"
      $saved = Invoke-Snapshot save $root $snap
      if (-not $saved) { Write-Host 'The current code could not be saved, so nothing was upgraded.' -ForegroundColor Red; exit 1 }
      $script:previous = $snap
      Write-Host "Saved version $($saved.version) ($($saved.files) files) to $snap"
    } elseif (Test-Path $lastGood) {
      $script:previous = $lastGood
      $script:fromVersion = (Invoke-Snapshot version $lastGood).version
      Write-Host "The new code is already in place. If the upgrade fails, the copy saved $((Get-Item $lastGood).LastWriteTime) (version $($script:fromVersion)) is put back."
    } else {
      Write-Host 'The new code is already in place and no earlier copy of the code was saved, so a failure cannot be rolled back by itself.' -ForegroundColor Yellow
      Write-Host 'Next time use -From <release> or -Pull, or run .\grc.ps1 save-code before replacing the code.' -ForegroundColor Yellow
    }
    Set-Content -Path (Join-Path $codeDir 'upgrade.json') -Encoding UTF8 -Value (@{ from = $script:fromVersion; startedAt = (Get-Date).ToString('o'); previousCode = $script:previous } | ConvertTo-Json)

    Write-Host '[2/7] Backup' -ForegroundColor Cyan
    if ($wasRunning) { Stop-Server }
    if (Test-Path (Join-Path $dataDir 'pg')) {
      $backupArgs = @('backup', '--label', 'pre-upgrade') + $keyArgs
      if ($Encrypt) { $backupArgs += '--encrypt' }
      if ((Invoke-Cli @backupArgs) -ne 0) {
        Write-Host 'The backup failed, so nothing was upgraded.' -ForegroundColor Red
        if ($wasRunning) { Write-Host 'Start the server again with .\grc.ps1 start once the cause is fixed.' }
        exit 1
      }
      $line = @($script:lastOutput) | Where-Object { $_ -like 'Backed up to *' } | Select-Object -First 1
      $script:backupName = if ($line) { $line.Substring('Backed up to '.Length).Trim() } else { (Get-NewestBackup).FullName }
    } else {
      Write-Host 'No database yet: nothing to back up.'
    }

    Write-Host '[3/7] New code' -ForegroundColor Cyan
    if ($Pull) {
      Invoke-Native git pull --ff-only
      if ($LASTEXITCODE -ne 0) { Stop-Upgrade 'git pull' $false }
    } elseif ($From) {
      $source = (Resolve-Path $From -ErrorAction SilentlyContinue).Path
      if (-not $source) { Stop-Upgrade "finding the new release ($From does not exist)" $false }
      $unpacked = $null
      if ((Get-Item $source).PSIsContainer -eq $false) {
        $unpacked = Join-Path $codeDir "incoming-$stamp"
        Expand-Archive -Path $source -DestinationPath $unpacked -Force
        $source = $unpacked
        $inner = @(Get-ChildItem $unpacked)
        if (-not (Test-Path (Join-Path $source 'package.json')) -and $inner.Count -eq 1 -and $inner[0].PSIsContainer) { $source = $inner[0].FullName }
      }
      $applied = Invoke-Snapshot apply $root $source
      if ($unpacked) { Remove-Item $unpacked -Recurse -Force -ErrorAction SilentlyContinue }
      if (-not $applied) { Stop-Upgrade 'putting the new code in place' $false }
      Write-Host "Version $($applied.version) put in place ($($applied.written) file(s) written, $($applied.removed) removed)."
    } else {
      Write-Host 'Already in place.'
    }
    $toVersion = (Invoke-Snapshot version $root).version
    Write-Host "Upgrading from version $($script:fromVersion) to $toVersion"

    Write-Host '[4/7] Install packages' -ForegroundColor Cyan
    if ($SkipInstall) { Write-Host 'Skipped (-SkipInstall).' }
    else {
      Invoke-Native npm.cmd install --no-fund --no-audit
      if ($LASTEXITCODE -ne 0) { Stop-Upgrade 'npm install' $false }
    }

    Write-Host '[5/7] Build the web application' -ForegroundColor Cyan
    Invoke-Native npm.cmd run build --silent
    if ($LASTEXITCODE -ne 0) { Stop-Upgrade 'build' $false }

    Write-Host '[6/7] Database migrations' -ForegroundColor Cyan
    if ((Invoke-Cli migrate) -ne 0) { Stop-Upgrade 'database migrations (the failed migration was rolled back; earlier new ones stay applied)' $true }

    Write-Host '[7/7] Start and health check' -ForegroundColor Cyan
    if (-not (Start-Server)) { Stop-Upgrade 'start' $true }
    if (-not (Test-Health)) { Stop-Upgrade 'health check' $true }
    Invoke-Cli status | Out-Null
    # This version is now the one to come back to.
    if (Invoke-Snapshot save $root $lastGood) {
      Get-ChildItem $codeDir -Filter 'pre-upgrade-*.tar' | Sort-Object Name -Descending | Select-Object -Skip 3 | Remove-Item -Force
    }
    Write-Host "Upgrade complete: version $($script:fromVersion) to $toVersion." -ForegroundColor Green
    if ($script:backupName) { Write-Host "The data as it was before the upgrade is in backup $($script:backupName)." }
  }

  'install' { Invoke-Native npm.cmd install --no-fund --no-audit; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Write-Host 'Packages installed.' }
  'npm' { & npm.cmd @Rest; exit $LASTEXITCODE }
  { $_ -in 'help', '-h', '--help', '/?' } { Show-Usage }
  default { Show-Usage; Write-Host "Unknown command: $Command" -ForegroundColor Red; exit 1 }
}
