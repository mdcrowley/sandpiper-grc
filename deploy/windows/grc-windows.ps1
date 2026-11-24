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
    prepare        before the files of a new installation are copied: check and lock the program
                   folder and the data folder (refused if either holds anything another user made)
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

  Everything it does is logged to <data folder>\setup.log, beside the folders, where only SYSTEM
  and Administrators may write (the service may change logs\, so the log of what administrators
  run is not kept there).

  Trust (wave 23 security review, S2 to S4):
    - Before a data folder or program folder that already exists is used, every item in it must
      belong to SYSTEM, Administrators or TrustedInstaller (in data, backups, logs and seed also
      the service's own account), and none may be a junction or symbolic link. Otherwise nothing is
      done: another user may have made it, with settings or a key of their choosing. When the
      check passes, ownership goes to Administrators and every permission below the top folder is
      reset to the inherited ones, so no other entry survives.
    - The program folder gets its own permissions (SYSTEM and Administrators full control, Users
      and the service read and run), not those of its parent, wherever it is.
    - Only GRC_* settings are taken from grc.env (never NODE_OPTIONS, PATH or anything else).
    - Settings, upgrade\state.json and the program files are checked again (owner and
      permissions) before this script, running elevated, reads or runs them.
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
  [string]$ReasonFile,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$RegistryRoot = 'HKLM:\SOFTWARE\Sandpiper GRC'
$script:logFile = $null

# Well-known accounts, by SID so that the names in any Windows language work.
$SidSystem = 'S-1-5-18'
$SidAdmins = 'S-1-5-32-544'
$SidUsers = 'S-1-5-32-545'
$SidNetworkService = 'S-1-5-20'
$SidTrustedInstaller = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$TrustedOwners = @($SidSystem, $SidAdmins, $SidTrustedInstaller)
# The folders of the data folder the service may change.
$WritableFolders = @('data', 'backups', 'logs', 'seed')
# The only settings taken from grc.env: the application's own.
$AllowedSetting = '^GRC_[A-Za-z0-9_]+$'
# The privileges the service keeps (sc.exe privs): no SeImpersonatePrivilege.
$ServicePrivileges = 'SeChangeNotifyPrivilege/SeCreateGlobalPrivilege'

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

# KEY=VALUE lines; # starts a comment. Only GRC_* keys are returned; any other key (NODE_OPTIONS,
# PATH...) is ignored and reported, because these settings reach processes run as administrator.
function Read-EnvFile([string]$file) {
  $values = [ordered]@{}
  if (Test-Path $file) {
    foreach ($raw in Get-Content $file -Encoding UTF8) {
      $line = $raw.Trim()
      if (-not $line -or $line.StartsWith('#')) { continue }
      $eq = $line.IndexOf('=')
      if ($eq -le 0) { continue }
      $key = $line.Substring(0, $eq).Trim()
      if ($key -notmatch $AllowedSetting) { Write-Log "Ignored the setting $key in $file`: only GRC_* settings are read." 'Yellow'; continue }
      $values[$key] = $line.Substring($eq + 1).Trim()
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
    $lines.Add('# Only GRC_* settings are read; any other line is ignored. Restart the service after a change.')
    $lines.Add('# Never put a password or key here directly: use the *_FILE settings.')
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
    SetupLog = Join-Path $root 'setup.log'
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
# It runs elevated, so the settings and the program it runs must be ones only administrators can change.
function Invoke-Cli([string]$dir, [string]$root) {
  $paths = Get-Paths $root
  Assert-AdminOnly @($paths.Root, $paths.Config, $paths.EnvFile, $dir, (Join-Path $dir 'node'), (Join-Path $dir 'node\node.exe'), (Join-Path $dir 'app'))
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

# The SID of NT SERVICE\<name>, worked out from the name (the service need not exist yet).
function Get-ServiceSid([string]$svc) {
  $out = (& sc.exe showsid $svc 2>&1) -join "`n"
  $m = [regex]::Match($out, 'S-1-5-80(-\d+){5}')
  if (-not $m.Success) { throw "Could not work out the service SID of $svc ($out)." }
  return $m.Value
}

function Get-AccountName([string]$sid) {
  try { return (New-Object Security.Principal.SecurityIdentifier $sid).Translate([Security.Principal.NTAccount]).Value } catch { return $sid }
}

function Test-Link($item) { return [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint) }

# Every item of a folder, the folder too, without following links. Returns what may not be trusted:
# an item whose owner is not SYSTEM, Administrators or TrustedInstaller (in the folders named by
# $writable also $writableOwners: the service's own account), a junction or symbolic link, or an
# item that cannot be read. Stops after $max findings.
function Find-UntrustedItems([string]$root, [string[]]$writable = @(), [string[]]$writableOwners = @(), [int]$max = 10) {
  $found = New-Object System.Collections.Generic.List[string]
  $stack = New-Object System.Collections.Generic.Stack[object]
  $stack.Push(@((New-Object IO.DirectoryInfo $root), $false, $true))
  while ($stack.Count -and $found.Count -lt $max) {
    $entry = $stack.Pop()
    $item = $entry[0]; $inWritable = $entry[1]; $isRoot = $entry[2]
    try {
      if (Test-Link $item) { $found.Add("$($item.FullName) (a junction or symbolic link)"); continue }
      $owner = $item.GetAccessControl([Security.AccessControl.AccessControlSections]::Owner).GetOwner([Security.Principal.SecurityIdentifier]).Value
      if (-not ($TrustedOwners -contains $owner -or ($inWritable -and $writableOwners -contains $owner))) {
        $found.Add("$($item.FullName) (owner $(Get-AccountName $owner))")
        continue
      }
      if ($item -is [IO.DirectoryInfo]) {
        foreach ($c in $item.EnumerateFileSystemInfos()) {
          $stack.Push(@($c, ($inWritable -or ($isRoot -and $c -is [IO.DirectoryInfo] -and $writable -contains $c.Name)), $false))
        }
      }
    } catch { $found.Add("$($item.FullName) (cannot be read: $($_.Exception.Message))") }
  }
  return , $found
}

function Format-Refusal([string]$what, [string]$root, $found) {
  return ("The $what $root already exists and holds items that another user may have made or can change:`r`n  " + ($found -join "`r`n  ") + "`r`n" +
    "Nothing was changed. If you did not make this folder yourself, delete it (or choose another folder) and run the installer again. " +
    "If you made it and have checked what is in it, give it to Administrators and run the installer again: " +
    "takeown /F `"$root`" /A /R /D Y  (and delete any junction or link in it). See docs/installation.md, `"A folder that already exists`".")
}

# Rights that let someone change an item (or what it holds): write or append data, delete,
# delete a child, change permissions or owner, and the generic write and all rights.
$ChangeRights = 0x2 -bor 0x4 -bor 0x40 -bor 0x10000 -bor 0x40000 -bor 0x80000 -bor 0x10000000 -bor 0x40000000

# Throws unless each path that exists belongs to SYSTEM, Administrators or TrustedInstaller, is not
# a link, and gives no other account a right to change it. Run before this script, elevated,
# reads settings or state, or runs a program, from a folder.
function Assert-AdminOnly([string[]]$items, [int]$rights = $ChangeRights) {
  foreach ($p in $items) {
    if (-not $p -or -not (Test-Path -LiteralPath $p)) { continue }
    $item = Get-Item -LiteralPath $p -Force
    if (Test-Link $item) { throw "$p is a junction or symbolic link, so it is not used." }
    $acl = $item.GetAccessControl([Security.AccessControl.AccessControlSections]'Owner, Access')
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($TrustedOwners -notcontains $owner) { throw "$p belongs to $(Get-AccountName $owner), not to Administrators, so it is not used. Run the installer again, which checks and resets the permissions." }
    foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
      if ($r.AccessControlType -ne 'Allow' -or ($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) { continue }
      $sid = $r.IdentityReference.Value
      if ($TrustedOwners -contains $sid -or $sid -eq 'S-1-3-0') { continue }
      if ([int]$r.FileSystemRights -band $rights) {
        throw "$(Get-AccountName $sid) may change $p, so it is not used. Run the installer again (an upgrade, or the same version), which resets the permissions."
      }
    }
  }
}

# A folder's own permissions, replacing whatever it had and not inherited from its parent; owner Administrators.
# $rules: @(SID, rights, inherited by its contents).
function Set-FolderAcl([string]$path, $rules) {
  $sec = New-Object Security.AccessControl.DirectorySecurity
  $sec.SetOwner((New-Object Security.Principal.SecurityIdentifier $SidAdmins))
  $sec.SetAccessRuleProtection($true, $false)
  foreach ($r in $rules) { $sec.AddAccessRule((New-Rule $r[0] $r[1] $r[2])) }
  [IO.Directory]::SetAccessControl($path, $sec)
}

function Invoke-Icacls {
  $out = & icacls.exe @args /C /Q 2>&1
  if ($LASTEXITCODE -ne 0) { throw "icacls $($args -join ' ') failed ($LASTEXITCODE): $out" }
}

# Everything below $root: owner Administrators, explicit permissions removed (so only what is
# inherited from $root and its folders applies). The check before has made sure no link is there.
function Reset-Below([string]$root) {
  if (@(Get-ChildItem -LiteralPath $root -Force).Count -eq 0) { return }
  Invoke-Icacls "$root\*" /reset /T
  Invoke-Icacls $root /setowner "*$SidAdmins" /T
}

# Checks a folder that exists (refused if anything in it may come from another user), creates it
# if missing, and gives it its own permissions. The check runs again once it is locked, in case
# something was added in between.
function Protect-Folder([string]$what, [string]$root, $rules, [string[]]$writable = @(), [string[]]$writableOwners = @()) {
  if (Test-Path -LiteralPath $root) {
    $found = Find-UntrustedItems $root $writable $writableOwners
    if ($found.Count) { throw (Format-Refusal $what $root $found) }
  } else { New-Item -ItemType Directory -Force $root | Out-Null }
  Set-FolderAcl $root $rules
  $found = Find-UntrustedItems $root $writable $writableOwners
  if ($found.Count) { throw (Format-Refusal $what $root $found) }
  Reset-Below $root
}

# The program folder, wherever it is: SYSTEM and Administrators full control, Users and the service
# read and run; nothing inherited from its parent (C:\ lets every signed-in user change new folders).
function Protect-ProgramFolder([string]$dir, [string]$svc) {
  $svcSid = Get-ServiceSid $svc
  Protect-Folder 'program folder' $dir @(@($SidSystem, 'FullControl', $true), @($SidAdmins, 'FullControl', $true), @($SidUsers, 'ReadAndExecute', $true), @($svcSid, 'ReadAndExecute', $true))
  Write-Log "Program folder $dir checked and locked: SYSTEM and Administrators full control, Users and the service read and run."
  Write-ParentWarning $dir
}

# Re-applies the program folder's own permissions after files were copied into it (they inherit them).
function Lock-ProgramFolder([string]$dir, [string]$svc) {
  Set-FolderAcl $dir @(@($SidSystem, 'FullControl', $true), @($SidAdmins, 'FullControl', $true), @($SidUsers, 'ReadAndExecute', $true), @((Get-ServiceSid $svc), 'ReadAndExecute', $true))
}

# A folder whose parent others may rename or delete from could be moved away and replaced: say so.
# (Adding files to the parent, as Users may in C:\ProgramData, does not matter.)
$MoveRights = 0x40 -bor 0x10000 -bor 0x40000 -bor 0x80000 -bor 0x10000000
function Write-ParentWarning([string]$dir) {
  $parent = Split-Path $dir -Parent
  while ($parent -and (Split-Path $parent -Parent)) {
    try { Assert-AdminOnly @($parent) $MoveRights } catch {
      Write-Log "Warning: an account other than the administrators may rename or change $parent, so $dir could be moved away and replaced. A folder only administrators can change, such as C:\Program Files or C:\ProgramData, is safer." 'Yellow'
      return
    }
    $parent = Split-Path $parent -Parent
  }
}

# The data folder belongs to SYSTEM and Administrators; the service's own account may change the
# data, backups, logs and seed folders and read the settings and the key; nobody else has access.
# A folder that exists is used only if nothing in it may come from another user (see the top).
function Protect-DataFolder($paths, [string]$svc) {
  $svcSid = Get-ServiceSid $svc
  Protect-Folder 'data folder' $paths.Root @(@($SidSystem, 'FullControl', $true), @($SidAdmins, 'FullControl', $true), @($svcSid, 'ReadAndExecute', $false)) `
    $WritableFolders @($svcSid, $SidNetworkService)
  foreach ($d in $paths.Data, $paths.Backups, $paths.Logs, $paths.Seed, $paths.Config, $paths.Upgrade) { New-Item -ItemType Directory -Force $d | Out-Null }
  foreach ($d in $paths.Data, $paths.Backups, $paths.Logs, $paths.Seed) { Grant-Folder $d $svcSid 'Modify' }
  Grant-Folder $paths.Config $svcSid 'ReadAndExecute'
  if (Test-Path -LiteralPath $paths.KeyFile) { Lock-SecretKey $paths.KeyFile $svcSid }
  $script:logFile = $paths.SetupLog
  Write-Log "Data folder $($paths.Root) checked and locked: SYSTEM and Administrators full control; NT SERVICE\$svc may change data, backups, logs and seed, and read config; no other entry is left."
  Write-ParentWarning $paths.Root
}

# Permissions are set with .NET and SIDs, not icacls: icacls refuses NT SERVICE\<name> before the
# service exists, which is the case when a new installation is prepared.
function New-Rule([string]$sid, [string]$rights, [bool]$inherit) {
  $flags = if ($inherit) { [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
  return New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier $sid),
    [Security.AccessControl.FileSystemRights]$rights, $flags, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
}

# Gives $sid these rights on a folder and everything in it, replacing any it had there.
function Grant-Folder([string]$path, [string]$sid, [string]$rights) {
  $sec = [IO.Directory]::GetAccessControl($path)
  $sec.SetAccessRule((New-Rule $sid $rights $true))
  [IO.Directory]::SetAccessControl($path, $sec)
}

function Lock-SecretKey([string]$file, [string]$svcSid) {
  $sec = New-Object Security.AccessControl.FileSecurity
  $sec.SetOwner((New-Object Security.Principal.SecurityIdentifier $SidAdmins))
  $sec.SetAccessRuleProtection($true, $false)
  foreach ($r in @(@($SidSystem, 'FullControl'), @($SidAdmins, 'FullControl'), @($svcSid, 'Read'))) { $sec.AddAccessRule((New-Rule $r[0] $r[1] $false)) }
  [IO.File]::SetAccessControl($file, $sec)
}

# 32 random bytes as hex, readable by SYSTEM, Administrators and the service only. A key that is
# there already was checked with its folder (Protect-DataFolder) and is kept.
function New-SecretKey([string]$file, [string]$svc) {
  if (Test-Path $file) { Write-Log "Keeping the existing secret key $file."; return }
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  [IO.File]::WriteAllText($file, "$hex`n", (New-Object Text.UTF8Encoding($false)))
  Lock-SecretKey $file (Get-ServiceSid $svc)
  Write-Log "Created the secret key $file (readable by SYSTEM, Administrators and the service only). Keep a copy somewhere safe, apart from the backups."
}

# Deletes a folder and everything in it without following links: a junction or symbolic link in it
# is removed as a link and what it points to is left alone (Remove-Item in Windows PowerShell 5.1
# would delete the target's contents).
function Remove-TreeSafely([string]$path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return }
  $top = Get-Item -LiteralPath $path -Force
  $links = New-Object System.Collections.Generic.List[object]
  if (Test-Link $top) { $links.Add($top) } else {
    $stack = New-Object System.Collections.Generic.Stack[IO.DirectoryInfo]
    $stack.Push($top)
    while ($stack.Count) {
      foreach ($c in $stack.Pop().EnumerateFileSystemInfos()) {
        if (Test-Link $c) { $links.Add($c) } elseif ($c -is [IO.DirectoryInfo]) { $stack.Push($c) }
      }
    }
  }
  foreach ($l in $links) {
    Write-Log "  Removing the link $($l.FullName) (not what it points to)."
    if ($l -is [IO.DirectoryInfo]) { & cmd.exe /d /c rmdir "$($l.FullName)" } else { & cmd.exe /d /c del /f /q /a "$($l.FullName)" }
    if (Test-Path -LiteralPath $l.FullName) { throw "Could not remove the link $($l.FullName); nothing more was deleted." }
  }
  if (-not (Test-Link $top)) { Remove-Item -LiteralPath $path -Recurse -Force }
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

# Only the privileges the server needs. Without this the account keeps the default service
# privileges, among them SeImpersonatePrivilege, with which code running in the server could
# make itself SYSTEM. Applies from the next start.
function Set-ServicePrivileges([string]$svc) {
  Invoke-Sc privs $svc $ServicePrivileges
  Write-Log "The service keeps only $($ServicePrivileges -replace '/', ' and ') (no SeImpersonatePrivilege)."
}

# Before the installer copies the files of a new installation: the program folder and the data
# folder are checked and locked first, so nothing can be put into either while it copies.
function Invoke-Prepare {
  foreach ($n in 'InstallDir', 'DataRoot') { if (-not (Get-Variable $n -ValueOnly)) { throw "prepare needs -$n." } }
  Protect-DataFolder (Get-Paths $DataRoot) $ServiceName
  Protect-ProgramFolder $InstallDir $ServiceName
  Write-Log "== Prepared a new installation of Sandpiper GRC $Version (program $InstallDir, data $DataRoot)."
  return 0
}

function Install-Grc {
  foreach ($n in 'InstallDir', 'DataRoot', 'Version') { if (-not (Get-Variable $n -ValueOnly)) { throw "install needs -$n." } }
  $paths = Get-Paths $DataRoot
  $tls = [bool]$TlsCert
  if ($tls -and -not $TlsKey) { throw 'An HTTPS certificate needs its private key file too (-TlsKey).' }
  foreach ($f in @($TlsCert, $TlsKey) | Where-Object { $_ }) { if (-not (Test-Path $f -PathType Leaf)) { throw "File not found: $f" } }

  # A service of this name (a reinstallation) is stopped first, so nothing changes the folders while they are checked.
  $replace = [bool](Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
  if ($replace) { Stop-GrcService $ServiceName }
  # Nothing is read from or written to the folders before they are checked and locked.
  Protect-DataFolder $paths $ServiceName
  Protect-ProgramFolder $InstallDir $ServiceName
  Write-Log "== Installing Sandpiper GRC $Version as the service $ServiceName (program $InstallDir, data $DataRoot, port $Port)"

  # The service, under its own virtual account (NT SERVICE\<name>): no password, no rights elsewhere.
  if ($replace) {
    Write-Log "A service named $ServiceName exists already; replacing its definition."
    Invoke-Sc delete $ServiceName
    Start-Sleep -Seconds 2
  }
  $bin = "`"$(Join-Path $InstallDir 'SandpiperService.exe')`" --name $ServiceName --config `"$($paths.EnvFile)`""
  New-Service -Name $ServiceName -BinaryPathName $bin -DisplayName $(if ($ServiceName -eq 'SandpiperGRC') { 'Sandpiper GRC' } else { "Sandpiper GRC ($ServiceName)" }) `
    -StartupType Automatic -Description 'Sandpiper GRC: governance, risk and compliance. Its logs are in the logs folder of its data folder.' | Out-Null
  Invoke-Sc config $ServiceName 'obj=' "NT SERVICE\$ServiceName"
  Invoke-Sc sidtype $ServiceName unrestricted
  Set-ServicePrivileges $ServiceName
  # Restart after a failure: 5 seconds, then 10, then a minute; the count resets after a day.
  Invoke-Sc failure $ServiceName 'reset=' 86400 'actions=' 'restart/5000/restart/10000/restart/60000'
  Invoke-Sc failureflag $ServiceName 1
  Write-Log "Service $ServiceName created (starts at boot, runs as NT SERVICE\$ServiceName, restarts after a failure)."

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
# upgrade\state.json drives copies and a restore as administrator, so it is used only when only
# administrators can have written it, and only with this installation's own folders in it.
function Read-State($paths, $i) {
  if (-not (Test-Path $paths.State)) { return $null }
  Assert-AdminOnly @($paths.Root, $paths.Upgrade, $paths.State)
  $state = Get-Content $paths.State -Raw | ConvertFrom-Json
  $same = { param($a, $b) [IO.Path]::GetFullPath([string]$a).TrimEnd('\') -eq [IO.Path]::GetFullPath([string]$b).TrimEnd('\') }
  if (-not (& $same $state.previous $paths.Previous) -or -not (& $same $state.installDir $i.InstallDir)) {
    throw "upgrade\state.json names other folders than this installation's ($($state.previous), $($state.installDir)), so it is not used."
  }
  if ($state.backup -and -not [IO.Path]::GetFullPath([string]$state.backup).StartsWith($paths.Backups.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "upgrade\state.json names a backup outside $($paths.Backups) ($($state.backup)), so it is not used."
  }
  return $state
}

function Copy-Tree([string]$from, [string]$to) {
  & robocopy.exe $from $to /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying $from to $to failed (robocopy $LASTEXITCODE)." }
}

function Invoke-PreUpgrade {
  $i = Read-Installation $ServiceName
  if (-not $i) { throw "No installation named $ServiceName is recorded in the registry." }
  $paths = Get-Paths $i.DataRoot
  $wasRunning = (Get-ServiceState $ServiceName) -eq 'Running'
  # Stopped first, so nothing changes the folders while they are checked.
  Stop-GrcService $ServiceName
  try {
    # The same check as a new installation: an installation made before it (or a folder made in
    # advance by another user) is checked, and its permissions are reset, before anything is read.
    Protect-DataFolder $paths $ServiceName
    Protect-ProgramFolder $i.InstallDir $ServiceName
  } catch {
    $why = $_.Exception.Message
    if ($wasRunning) { Start-GrcService $i | Out-Null }
    throw "$why Nothing was upgraded."
  }
  Write-Log "== Upgrading Sandpiper GRC $($i.Version) to $Version (service $ServiceName)"
  # A copy of this script stays beside the data, for an administrator who must finish a rollback by
  # hand. The installer itself runs its own copy (in its temporary folder), never this one.
  Copy-Item $PSCommandPath (Join-Path $paths.Upgrade 'grc-windows.ps1') -Force

  Write-Log '[1/6] Stop the service (stopped)'

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
  $script:logFile = $paths.SetupLog
  $state = Read-State $paths $i
  if (-not $state) { throw 'No upgrade is in progress (upgrade\state.json is missing).' }
  Write-Log '[4/6] Program files replaced by the installer'
  Lock-ProgramFolder $i.InstallDir $ServiceName
  Set-ServicePrivileges $ServiceName
  $state.stage = 'migrate'; Save-State $paths $state

  Write-Log '[5/6] Database migrations'
  if ((Invoke-Cli $i.InstallDir $i.DataRoot migrate) -ne 0) { return (Invoke-Rollback 'database migrations' $true) }

  Write-Log '[6/6] Start the service and check its health'
  $state.stage = 'start'; Save-State $paths $state
  if (-not (Start-GrcService $i)) { return (Invoke-Rollback 'start and health check' $true) }

  $i.Version = $Version
  Save-Installation $i
  try { Remove-TreeSafely $paths.Previous } catch { Write-Log "Could not remove $($paths.Previous): $_" 'Yellow' }
  Remove-Item $paths.State -Force
  Write-Log "Upgrade complete: $($state.fromVersion) to $Version." 'Green'
  if ($state.backup) { Write-Log "The data as it was before the upgrade is in the backup $($state.backup)." }
  return 0
}

function Invoke-Rollback([string]$step, [bool]$dataMayHaveChanged) {
  $i = Read-Installation $ServiceName
  $paths = Get-Paths $i.DataRoot
  if (-not $script:logFile) { $script:logFile = $paths.SetupLog }
  $state = Read-State $paths $i
  if (-not $state) { Write-Log 'No upgrade is in progress: nothing to roll back.'; return 0 }
  Write-Log "UPGRADE FAILED at: $step. Rolling back to version $($state.fromVersion)..." 'Yellow'
  $failedAt = $null
  try { Stop-GrcService $ServiceName } catch { Write-Log "Stopping: $_" }
  try {
    Copy-Tree $state.previous $state.installDir
    Lock-ProgramFolder $state.installDir $ServiceName
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
  $script:logFile = $paths.SetupLog
  $state = Read-State $paths $i
  if (-not $state) { return 0 }
  if ($state.stage -eq 'files') { return (Invoke-Rollback 'replacing the program files (the installer did not finish)' $false) }
  return (Invoke-Rollback "an interrupted upgrade (stage $($state.stage))" $true)
}

function Uninstall-Grc {
  $i = Read-Installation $ServiceName
  if ($i) { try { Assert-AdminOnly @($i.DataRoot); $script:logFile = (Get-Paths $i.DataRoot).SetupLog } catch { Write-Host "$_" } }
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
    try { Remove-TreeSafely (Get-Paths $i.DataRoot).Previous } catch { Write-Log "Could not remove the copy of the previous program files: $_" 'Yellow' }
    if ($RemoveData) {
      $script:logFile = $null
      # Links in it (the service could make some in the folders it may change) are removed as links:
      # what they point to is never deleted.
      Remove-TreeSafely $i.DataRoot
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
    'prepare' { $code = Invoke-Prepare }
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
      Assert-AdminOnly @($i.DataRoot)
      $script:logFile = (Get-Paths $i.DataRoot).SetupLog
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
    default { Get-Help $PSCommandPath | Out-Host; Write-Host 'Actions: prepare, install, pre-upgrade, post-upgrade, rollback, recover, uninstall, start, stop, restart, backup, cli, status' }
  }
} catch {
  Write-Log "FAILED: $_" 'Red'
  # The installer shows this reason (it cannot see this window).
  if ($ReasonFile) { try { [IO.File]::WriteAllText($ReasonFile, "$_", (New-Object Text.UTF8Encoding($false))) } catch { } }
  $code = 1
}
# A function's stray output must not hide its exit code: the last value is the code.
exit ([int](@($code) | Select-Object -Last 1))
