<#
  Sandpiper GRC on Windows: the service, upgrades and their rollback (E42).

  Installed beside the program as "<program folder>\grc-windows.ps1". The Windows installer runs it
  to set up, upgrade and remove the service; sandpiper.cmd (the Start menu shortcuts) runs it, with
  administrator rights, to start, stop and restart the service and take a backup. An administrator can run it too, in an
  elevated Windows PowerShell:

    & "C:\Program Files\Sandpiper GRC\grc-windows.ps1" status
    & "C:\Program Files\Sandpiper GRC\grc-windows.ps1" restart
    & "C:\Program Files\Sandpiper GRC\grc-windows.ps1" backup [-Label text]
    & "C:\Program Files\Sandpiper GRC\grc-windows.ps1" cli <command> [args]   (any server/src/cli.ts command: status, backups, verify-backup, restore, export-all, seed, ...)

  Actions run by the installer (see tools\installer\sandpiper-grc.iss):
    install        a new installation: folders and their permissions, the secret key, settings,
                   the service under its own virtual account, the firewall rule, start, wait for /api/ready
    pre-upgrade    before the new program files are copied: stop the service, back up the data with
                   the installed version, keep a copy of the installed program files
    post-upgrade   after they are copied: migrations, start, wait for /api/ready; if anything fails,
                   put the previous program files and data back and start the previous version
    rollback       that putting back, on its own (also run if the installer stopped half-way)
    recover        run when the installer ends: rolls back an upgrade that never reached post-upgrade
    uninstall      stop and remove the service, the firewall rule and the settings in the registry;
                   the data folder stays unless -RemoveData is given

  Exit codes: 0 done; 1 failed, nothing changed (the service is running again if it was); 2 the
  upgrade failed and the previous version is running again with its data; 3 the rollback did not
  finish (the service is stopped; the steps to finish by hand are printed and logged).

  Everything it does is logged to <data folder>\logs\setup.log.
#>
param(
  [Parameter(Position = 0)][string]$Action = 'help',
  [string]$ServiceName = 'SandpiperGRC',
  [string]$InstallDir,
  [string]$DataRoot,
  [int]$Port = 8080,
  [string]$TlsCert,
  [string]$TlsKey,
  [switch]$OpenFirewall,
  [string]$Version,
  [switch]$RemoveData,
  [string]$Label = 'manual',
  [int]$ReadyTimeout = 300,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$RegistryRoot = 'HKLM:\SOFTWARE\Sandpiper GRC'
$script:logFile = $null

function Write-Log([string]$text, [string]$color = '') {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
  if ($color) { Write-Host $text -ForegroundColor $color } else { Write-Host $text }
  if ($script:logFile) { try { Add-Content -Path $script:logFile -Value $line -Encoding UTF8 } catch { } }
}

function Test-Administrator {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---------- settings ----------

function Get-RegistryKey([string]$name) { return Join-Path $RegistryRoot $name }

function Read-Installation([string]$name) {
  $key = Get-RegistryKey $name
  if (-not (Test-Path $key)) { return $null }
  $p = Get-ItemProperty $key
  return [pscustomobject]@{
    ServiceName = $name; InstallDir = $p.InstallDir; DataRoot = $p.DataRoot; Version = $p.Version
    Port = [int]$p.Port; Scheme = $p.Scheme
  }
}

function Save-Installation($i) {
  $key = Get-RegistryKey $i.ServiceName
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  foreach ($n in 'InstallDir', 'DataRoot', 'Version', 'Scheme') { Set-ItemProperty -Path $key -Name $n -Value ([string]$i.$n) }
  Set-ItemProperty -Path $key -Name 'Port' -Value ([string]$i.Port)
}

# The Inno Setup uninstall entry shows the version in Settings > Apps; a rollback puts it back too.
function Set-UninstallVersion([string]$dir, [string]$ver) {
  $want = $dir.TrimEnd('\') + '\'
  foreach ($k in Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue) {
    $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
    if ($p.InstallLocation -and ($p.InstallLocation.TrimEnd('\') + '\') -eq $want -and $p.PSChildName -like '*_is1') {
      Set-ItemProperty -Path $k.PSPath -Name 'DisplayVersion' -Value $ver
    }
  }
}

# KEY=VALUE lines; # starts a comment.
function Read-EnvFile([string]$file) {
  $values = [ordered]@{}
  if (Test-Path $file) {
    foreach ($raw in Get-Content $file -Encoding UTF8) {
      $line = $raw.Trim()
      if (-not $line -or $line.StartsWith('#')) { continue }
      $eq = $line.IndexOf('=')
      if ($eq -gt 0) { $values[$line.Substring(0, $eq).Trim()] = $line.Substring($eq + 1).Trim() }
    }
  }
  return $values
}

# Sets the keys given (an empty value removes the key) and keeps every other line as it was.
function Set-EnvValues([string]$file, $values) {
  $lines = New-Object System.Collections.Generic.List[string]
  if (Test-Path $file) { foreach ($l in Get-Content $file -Encoding UTF8) { $lines.Add($l) } }
  else {
    $lines.Add('# Sandpiper GRC settings, read by the service at every start (KEY=VALUE; see docs/installation.md, "Environment variables").')
    $lines.Add('# Restart the service after a change. Never put a password or key here directly: use the *_FILE settings.')
  }
  foreach ($k in $values.Keys) {
    $v = [string]$values[$k]
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match "^\s*$([regex]::Escape($k))\s*=") {
        if ($v) { $lines[$i] = "$k=$v" } else { $lines.RemoveAt($i); $i-- }
        $found = $true
      }
    }
    if (-not $found -and $v) { $lines.Add("$k=$v") }
  }
  $text = ($lines -join "`r`n") + "`r`n"
  [IO.File]::WriteAllText($file, $text, (New-Object Text.UTF8Encoding($false)))
}

function Get-Paths([string]$root) {
  return [pscustomobject]@{
    Root = $root
    Data = Join-Path $root 'data'; Backups = Join-Path $root 'backups'; Logs = Join-Path $root 'logs'
    Seed = Join-Path $root 'seed'; Config = Join-Path $root 'config'; Upgrade = Join-Path $root 'upgrade'
    EnvFile = Join-Path $root 'config\grc.env'; KeyFile = Join-Path $root 'config\secret.key'
    State = Join-Path $root 'upgrade\state.json'; Previous = Join-Path $root 'upgrade\previous'
  }
}

# ---------- running things ----------

# Runs a program and shows (and logs) everything it prints. Read $LASTEXITCODE afterward.
function Invoke-Native {
  $ErrorActionPreference = 'Continue'
  $exe = $args[0]
  $rest = @($args | Select-Object -Skip 1)
  $script:lastOutput = @()
  & $exe @rest 2>&1 | ForEach-Object {
    $line = "$_"
    $script:lastOutput += $line
    Write-Log "    $line"
  }
}

# Runs a command of server/src/cli.ts with the program files in $dir and the settings in grc.env.
function Invoke-Cli([string]$dir, [string]$root) {
  $paths = Get-Paths $root
  foreach ($kv in (Read-EnvFile $paths.EnvFile).GetEnumerator()) { [Environment]::SetEnvironmentVariable($kv.Key, $kv.Value, 'Process') }
  $env:NODE_ENV = 'production'
  $env:GRC_WEB_DIST = Join-Path $dir 'app\dist\web'
  $commit = Join-Path $dir 'app\COMMIT'
  if ((Test-Path $commit) -and -not $env:GRC_COMMIT) { $env:GRC_COMMIT = (Get-Content $commit -Raw).Trim() }
  $node = Join-Path $dir 'node\node.exe'
  $cliArgs = @($args)
  Push-Location (Join-Path $dir 'app')
  try {
    Invoke-Native $node '--experimental-transform-types' '--disable-warning=ExperimentalWarning' 'server\src\cli.ts' @cliArgs
    return $LASTEXITCODE
  } finally { Pop-Location }
}

function Get-ServiceState([string]$name) {
  $s = Get-Service -Name $name -ErrorAction SilentlyContinue
  if (-not $s) { return 'Missing' }
  return [string]$s.Status
}

function Stop-GrcService([string]$name) {
  $s = Get-Service -Name $name -ErrorAction SilentlyContinue
  if (-not $s -or $s.Status -eq 'Stopped') { return }
  Write-Log "Stopping the service $name..."
  Stop-Service -Name $name -Force -WarningAction SilentlyContinue
  $s.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(90))
  Write-Log 'Stopped.'
}

function Test-Ready([string]$url) {
  $saved = [Net.ServicePointManager]::ServerCertificateValidationCallback
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    # This asks this very machine, whose certificate may be self-signed.
    if ($url.StartsWith('https')) { [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true } }
    $r = Invoke-WebRequest "$url/api/ready" -UseBasicParsing -TimeoutSec 5
    return ($r.StatusCode -eq 200 -and $r.Content -match '"ok"\s*:\s*true')
  } catch { return $false }
  finally { [Net.ServicePointManager]::ServerCertificateValidationCallback = $saved }
}

function Start-GrcService($i) {
  Write-Log "Starting the service $($i.ServiceName)..."
  Start-Service -Name $i.ServiceName
  $url = "$($i.Scheme)://127.0.0.1:$($i.Port)"
  $deadline = (Get-Date).AddSeconds($ReadyTimeout)
  while ((Get-Date) -lt $deadline) {
    if (Test-Ready $url) { Write-Log "Ready: $url/api/ready answers." 'Green'; return $true }
    if ((Get-ServiceState $i.ServiceName) -eq 'Stopped') { break }
    Start-Sleep -Seconds 2
  }
  Write-Log "The service did not become ready within $ReadyTimeout seconds. See $(Join-Path $i.DataRoot 'logs\service.log')." 'Red'
  return $false
}

function Invoke-Sc {
  $out = & sc.exe @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "sc.exe $($args -join ' ') failed: $out" }
}

# ---------- folders and permissions ----------

# The data folder belongs to SYSTEM and Administrators; the service's own account may change the
# data, backups, logs and seed folders and read the settings and the key; nobody else has access.
function Set-Permissions($paths, [string]$svc) {
  $acct = "NT SERVICE\$svc"
  foreach ($d in $paths.Root, $paths.Data, $paths.Backups, $paths.Logs, $paths.Seed, $paths.Config, $paths.Upgrade) {
    New-Item -ItemType Directory -Force $d | Out-Null
  }
  $grant = { param($target, [string[]]$rules) & icacls.exe $target @rules /Q | Out-Null; if ($LASTEXITCODE -ne 0) { throw "icacls $target failed ($LASTEXITCODE)." } }
  & $grant $paths.Root @('/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', "${acct}:(RX)")
  foreach ($d in $paths.Data, $paths.Backups, $paths.Logs, $paths.Seed) { & $grant $d @('/grant:r', "${acct}:(OI)(CI)M") }
  & $grant $paths.Config @('/grant:r', "${acct}:(OI)(CI)RX")
  Write-Log "Permissions set on $($paths.Root): SYSTEM and Administrators full control; $acct may change data, backups, logs and seed, and read config."
}

# 32 random bytes as hex, readable by SYSTEM, Administrators and the service only.
function New-SecretKey([string]$file, [string]$svc) {
  if (Test-Path $file) { Write-Log "Keeping the existing secret key $file."; return }
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  [IO.File]::WriteAllText($file, "$hex`n", (New-Object Text.UTF8Encoding($false)))
  & icacls.exe $file /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' "NT SERVICE\${svc}:R" /Q | Out-Null
  Write-Log "Created the secret key $file (readable by SYSTEM, Administrators and the service only). Keep a copy somewhere safe, apart from the backups."
}

# ---------- actions ----------

# The service's own virtual account needs the right to log on as a service. Windows gives it to
# every virtual account by default ("NT SERVICE\ALL SERVICES"), but a domain policy that sets
# "Log on as a service" itself may leave it out. Then the service runs as Network Service instead:
# still a low-privilege account, and the folder permissions given to NT SERVICE\<name> still apply,
# because the service keeps its own service SID (sidtype unrestricted).
function Confirm-ServiceLogon([string]$svc) {
  & sc.exe start $svc | Out-Null
  if ($LASTEXITCODE -ne 1069) { return }
  Write-Log "Windows refused NT SERVICE\$svc the right to log on as a service (a policy of this computer or its domain sets that right). Using NT AUTHORITY\NetworkService instead; the permissions of NT SERVICE\$svc still apply." 'Yellow'
  Invoke-Sc config $svc 'obj=' 'NT AUTHORITY\NetworkService' 'password=' '""'
}
function Install-Grc {
  foreach ($n in 'InstallDir', 'DataRoot', 'Version') { if (-not (Get-Variable $n -ValueOnly)) { throw "install needs -$n." } }
  $paths = Get-Paths $DataRoot
  New-Item -ItemType Directory -Force $paths.Logs | Out-Null
  $script:logFile = Join-Path $paths.Logs 'setup.log'
  Write-Log "== Installing Sandpiper GRC $Version as the service $ServiceName (program $InstallDir, data $DataRoot, port $Port)"
  $tls = [bool]$TlsCert
  if ($tls -and -not $TlsKey) { throw 'An HTTPS certificate needs its private key file too (-TlsKey).' }
  foreach ($f in @($TlsCert, $TlsKey) | Where-Object { $_ }) { if (-not (Test-Path $f -PathType Leaf)) { throw "File not found: $f" } }

  # The service, under its own virtual account (NT SERVICE\<name>): no password, no rights elsewhere.
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Log "A service named $ServiceName exists already; replacing its definition."
    Stop-GrcService $ServiceName
    Invoke-Sc delete $ServiceName
    Start-Sleep -Seconds 2
  }
  $bin = "`"$(Join-Path $InstallDir 'SandpiperService.exe')`" --name $ServiceName --config `"$($paths.EnvFile)`""
  New-Service -Name $ServiceName -BinaryPathName $bin -DisplayName $(if ($ServiceName -eq 'SandpiperGRC') { 'Sandpiper GRC' } else { "Sandpiper GRC ($ServiceName)" }) `
    -StartupType Automatic -Description 'Sandpiper GRC: governance, risk and compliance. Its logs are in the logs folder of its data folder.' | Out-Null
  Invoke-Sc config $ServiceName 'obj=' "NT SERVICE\$ServiceName"
  Invoke-Sc sidtype $ServiceName unrestricted
  # Restart after a failure: 5 seconds, then 10, then a minute; the count resets after a day.
  Invoke-Sc failure $ServiceName 'reset=' 86400 'actions=' 'restart/5000/restart/10000/restart/60000'
  Invoke-Sc failureflag $ServiceName 1
  Write-Log "Service $ServiceName created (starts at boot, runs as NT SERVICE\$ServiceName, restarts after a failure)."

  Set-Permissions $paths $ServiceName
  New-SecretKey $paths.KeyFile $ServiceName
  if ($tls) {
    foreach ($f in $TlsCert, $TlsKey) { & icacls.exe $f /grant "NT SERVICE\${ServiceName}:R" /Q | Out-Null }
    Write-Log "The service may read $TlsCert and $TlsKey."
  }
  Set-EnvValues $paths.EnvFile ([ordered]@{
    GRC_PORT = $Port
    GRC_HOST = $(if ($tls) { '0.0.0.0' } else { '127.0.0.1' })
    GRC_TLS_CERT = $TlsCert; GRC_TLS_KEY = $TlsKey
    GRC_DATA_DIR = $paths.Data; GRC_BACKUP_DIR = $paths.Backups; GRC_SEED_DIR = $paths.Seed; GRC_LOG_DIR = $paths.Logs
    GRC_SECRET_KEY_FILE = $paths.KeyFile
  })
  Write-Log "Settings written to $($paths.EnvFile)."

  $rule = "SandpiperGRC-$ServiceName"
  Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  if ($OpenFirewall -and $tls) {
    New-NetFirewallRule -Name $rule -DisplayName "Sandpiper GRC ($ServiceName)" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain, Private | Out-Null
    Write-Log "Firewall: inbound TCP $Port allowed on domain and private networks (rule $rule)."
  } elseif ($OpenFirewall) {
    Write-Log 'Firewall: not opened, because without an HTTPS certificate the server listens on this computer only (127.0.0.1).' 'Yellow'
  }

  $i = [pscustomobject]@{ ServiceName = $ServiceName; InstallDir = $InstallDir; DataRoot = $DataRoot; Version = $Version; Port = $Port; Scheme = $(if ($tls) { 'https' } else { 'http' }) }
  Save-Installation $i
  Confirm-ServiceLogon $ServiceName
  if (-not (Start-GrcService $i)) { return 1 }
  Write-Log "Sandpiper GRC $Version is running. Open $($i.Scheme)://localhost:$Port/ and complete the setup wizard to create the first administrator." 'Green'
  return 0
}

function Save-State($paths, $state) {
  [IO.File]::WriteAllText($paths.State, ($state | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}
function Read-State($paths) {
  if (-not (Test-Path $paths.State)) { return $null }
  return Get-Content $paths.State -Raw | ConvertFrom-Json
}

function Copy-Tree([string]$from, [string]$to) {
  & robocopy.exe $from $to /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying $from to $to failed (robocopy $LASTEXITCODE)." }
}

function Invoke-PreUpgrade {
  $i = Read-Installation $ServiceName
  if (-not $i) { throw "No installation named $ServiceName is recorded in the registry." }
  $paths = Get-Paths $i.DataRoot
  New-Item -ItemType Directory -Force $paths.Upgrade | Out-Null
  $script:logFile = Join-Path $paths.Logs 'setup.log'
  Write-Log "== Upgrading Sandpiper GRC $($i.Version) to $Version (service $ServiceName)"
  # This script stays beside the data, so a rollback can run whatever state the program folder is in.
  Copy-Item $PSCommandPath (Join-Path $paths.Upgrade 'grc-windows.ps1') -Force
  $wasRunning = (Get-ServiceState $ServiceName) -eq 'Running'

  Write-Log '[1/6] Stop the service'
  Stop-GrcService $ServiceName

  Write-Log '[2/6] Back up the data (with the installed version)'
  $backup = $null
  if (Test-Path (Join-Path $paths.Data 'pg')) {
    $code = Invoke-Cli $i.InstallDir $i.DataRoot backup --label pre-upgrade
    $line = @($script:lastOutput) | Where-Object { $_ -like 'Backed up to *' } | Select-Object -First 1
    if ($code -ne 0 -or -not $line) {
      Write-Log 'The backup failed, so nothing was upgraded.' 'Red'
      if ($wasRunning) { Start-GrcService $i | Out-Null }
      return 1
    }
    $backup = $line.Substring('Backed up to '.Length).Trim()
    Write-Log "Backup: $backup"
  } else { Write-Log 'No database yet: nothing to back up.' }

  Write-Log '[3/6] Keep a copy of the installed program files'
  try { Copy-Tree $i.InstallDir $paths.Previous }
  catch {
    Write-Log "$_ Nothing was upgraded." 'Red'
    if ($wasRunning) { Start-GrcService $i | Out-Null }
    return 1
  }
  Save-State $paths ([ordered]@{
    stage = 'files'; fromVersion = $i.Version; toVersion = $Version; backup = $backup; previous = $paths.Previous
    installDir = $i.InstallDir; startedAt = (Get-Date).ToString('o')
  })
  Write-Log "Kept $($i.InstallDir) in $($paths.Previous). The installer now replaces the program files."
  return 0
}

function Invoke-PostUpgrade {
  $i = Read-Installation $ServiceName
  $paths = Get-Paths $i.DataRoot
  $script:logFile = Join-Path $paths.Logs 'setup.log'
  $state = Read-State $paths
  if (-not $state) { throw 'No upgrade is in progress (upgrade\state.json is missing).' }
  Write-Log '[4/6] Program files replaced by the installer'
  $state.stage = 'migrate'; Save-State $paths $state

  Write-Log '[5/6] Database migrations'
  if ((Invoke-Cli $i.InstallDir $i.DataRoot migrate) -ne 0) { return (Invoke-Rollback 'database migrations' $true) }

  Write-Log '[6/6] Start the service and check its health'
  $state.stage = 'start'; Save-State $paths $state
  if (-not (Start-GrcService $i)) { return (Invoke-Rollback 'start and health check' $true) }

  $i.Version = $Version
  Save-Installation $i
  Remove-Item $paths.Previous -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $paths.State -Force
  Write-Log "Upgrade complete: $($state.fromVersion) to $Version." 'Green'
  if ($state.backup) { Write-Log "The data as it was before the upgrade is in the backup $($state.backup)." }
  return 0
}

function Invoke-Rollback([string]$step, [bool]$dataMayHaveChanged) {
  $i = Read-Installation $ServiceName
  $paths = Get-Paths $i.DataRoot
  if (-not $script:logFile) { $script:logFile = Join-Path $paths.Logs 'setup.log' }
  $state = Read-State $paths
  if (-not $state) { Write-Log 'No upgrade is in progress: nothing to roll back.'; return 0 }
  Write-Log "UPGRADE FAILED at: $step. Rolling back to version $($state.fromVersion)..." 'Yellow'
  $failedAt = $null
  try { Stop-GrcService $ServiceName } catch { Write-Log "Stopping: $_" }
  try {
    Copy-Tree $state.previous $state.installDir
    Write-Log "  Program files: version $($state.fromVersion) put back."
  } catch { $failedAt = "putting the previous program files back ($_)" }
  if (-not $failedAt -and $dataMayHaveChanged -and $state.backup) {
    if ((Invoke-Cli $state.installDir $i.DataRoot restore $state.backup --force) -ne 0) { $failedAt = 'restoring the pre-upgrade backup' }
    else { Write-Log '  Data: the pre-upgrade backup was restored (the data as the new version left it is kept as a pre-restore backup).' }
  } elseif (-not $failedAt) { Write-Log '  Data: not changed by the new version, so nothing to restore.' }
  $i.Version = $state.fromVersion
  Save-Installation $i
  Set-UninstallVersion $state.installDir $state.fromVersion
  if (-not $failedAt -and -not (Start-GrcService $i)) { $failedAt = 'starting the previous version' }
  if (-not $failedAt) {
    Remove-Item $paths.State -Force
    Write-Log "ROLLED BACK: the upgrade failed at '$step', and version $($state.fromVersion) is running again with the data as it was before. See $($script:logFile)." 'Yellow'
    return 2
  }
  Write-Log "ROLLBACK INCOMPLETE: the upgrade failed at '$step', and going back failed at: $failedAt." 'Red'
  Write-Log 'The service is stopped. To finish by hand, in an elevated Windows PowerShell:'
  Write-Log "  robocopy `"$($state.previous)`" `"$($state.installDir)`" /MIR"
  if ($state.backup) { Write-Log "  & `"$($state.installDir)\grc-windows.ps1`" cli restore `"$($state.backup)`" --force" }
  Write-Log "  Start-Service $ServiceName"
  return 3
}

# The installer ended: an upgrade that stopped after the program files were being replaced but
# before post-upgrade ran (the installer failed or was canceled half-way) is rolled back.
function Invoke-Recover {
  $i = Read-Installation $ServiceName
  if (-not $i) { return 0 }
  $paths = Get-Paths $i.DataRoot
  $state = Read-State $paths
  if (-not $state) { return 0 }
  $script:logFile = Join-Path $paths.Logs 'setup.log'
  if ($state.stage -eq 'files') { return (Invoke-Rollback 'replacing the program files (the installer did not finish)' $false) }
  return (Invoke-Rollback "an interrupted upgrade (stage $($state.stage))" $true)
}

function Uninstall-Grc {
  $i = Read-Installation $ServiceName
  if ($i) { $script:logFile = Join-Path $i.DataRoot 'logs\setup.log' }
  Write-Log "== Removing the service $ServiceName"
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-GrcService $ServiceName
    Invoke-Sc delete $ServiceName
    Write-Log 'Service removed.'
  }
  Get-NetFirewallRule -Name "SandpiperGRC-$ServiceName" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Remove-Item (Get-RegistryKey $ServiceName) -Recurse -Force -ErrorAction SilentlyContinue
  if ((Test-Path $RegistryRoot) -and -not (Get-ChildItem $RegistryRoot)) { Remove-Item $RegistryRoot -Force }
  if ($i) {
    Remove-Item (Get-Paths $i.DataRoot).Previous -Recurse -Force -ErrorAction SilentlyContinue
    if ($RemoveData) {
      $script:logFile = $null
      Remove-Item $i.DataRoot -Recurse -Force
      Write-Host "Deleted the data folder $($i.DataRoot)."
    } else {
      Write-Log "The data folder $($i.DataRoot) was kept: the database, attached files, backups, settings and the secret key. Installing again with the same data folder uses it."
    }
  }
  return 0
}

# ---------- main ----------

$needsAdmin = $Action -notin @('help', 'status')
if ($needsAdmin -and -not (Test-Administrator)) {
  Write-Host "'$Action' needs administrator rights: run it from an elevated Windows PowerShell." -ForegroundColor Red
  exit 1
}

$code = 0
try {
  switch ($Action) {
    'install' { $code = Install-Grc }
    'pre-upgrade' { $code = Invoke-PreUpgrade }
    'post-upgrade' { $code = Invoke-PostUpgrade }
    'rollback' { $code = Invoke-Rollback 'a rollback asked for by hand' $true }
    'recover' { $code = Invoke-Recover }
    'uninstall' { $code = Uninstall-Grc }
    'start' { $i = Read-Installation $ServiceName; $code = $(if (Start-GrcService $i) { 0 } else { 1 }) }
    'stop' { Stop-GrcService $ServiceName }
    'restart' { $i = Read-Installation $ServiceName; Stop-GrcService $ServiceName; $code = $(if (Start-GrcService $i) { 0 } else { 1 }) }
    'backup' {
      $i = Read-Installation $ServiceName
      $script:logFile = Join-Path $i.DataRoot 'logs\setup.log'
      $was = (Get-ServiceState $ServiceName) -eq 'Running'
      Stop-GrcService $ServiceName
      $code = Invoke-Cli $i.InstallDir $i.DataRoot backup --label $Label
      if ($code -eq 0) { Write-Log 'Backup taken.' 'Green' } else { Write-Log 'The backup failed; see above.' 'Red' }
      if ($was -and -not (Start-GrcService $i)) { $code = 1 }
    }
    'cli' {
      $i = Read-Installation $ServiceName
      $code = Invoke-Cli $i.InstallDir $i.DataRoot @Rest
    }
    'status' {
      $i = Read-Installation $ServiceName
      if (-not $i) { Write-Host "No installation named $ServiceName."; $code = 1; break }
      $state = Get-ServiceState $ServiceName
      $ready = Test-Ready "$($i.Scheme)://127.0.0.1:$($i.Port)"
      Write-Host "Sandpiper GRC $($i.Version), service $ServiceName`: $state; /api/ready: $(if ($ready) { 'ready' } else { 'not ready' })"
      Write-Host "Program: $($i.InstallDir)  Data: $($i.DataRoot)  Address: $($i.Scheme)://localhost:$($i.Port)/"
      $code = $(if ($state -eq 'Running' -and $ready) { 0 } else { 1 })
    }
    default { Get-Help $PSCommandPath | Out-Host; Write-Host 'Actions: install, pre-upgrade, post-upgrade, rollback, recover, uninstall, start, stop, restart, backup, cli, status' }
  }
} catch {
  Write-Log "FAILED: $_" 'Red'
  $code = 1
}
# A function's stray output must not hide its exit code: the last value is the code.
exit ([int](@($code) | Select-Object -Last 1))
