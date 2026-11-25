<#
  End-to-end test of the Windows installer (E42), run as an administrator: on the GitHub runner by
  .github/workflows/windows-installer.yml, and on a test machine by hand. It installs a separate test
  instance (built with build.ps1 -Instance), so it cannot touch a real installation.

    powershell -ExecutionPolicy Bypass -File tools\installer\test-install.ps1 `
      -Installer   <out>\SandpiperGRC-test-Setup-0.3.0.exe `
      -Upgrade     <out>\SandpiperGRC-test-Setup-0.2.1.exe `
      -Broken      <out>\SandpiperGRC-test-Setup-0.2.2.exe   (built with -BrokenMigration) `
      -Instance test -Port 8206 -DataRoot C:\ProgramData\SandpiperGRC-test `
      [-InstallDir C:\SandpiperGRC-test] [-ReinstallDir "C:\Program Files\Sandpiper GRC test"] [-Preplanted]

  Steps:
    0. Folders made in advance by someone else are refused (wave 23 review, S2 and S3): a data
       folder holding a grc.env with NODE_OPTIONS and a known secret key, then a program folder
       with an extra file, each owned by another account; the installer must stop before copying
       anything (exit code 7) and leave no service. By default this script makes them, owned by
       BUILTIN\Users; with -Preplanted the caller has made both already, without administrator
       rights (as a person signed in without them would).
    1. Install silently into -InstallDir (outside Program Files in the workflow); the service runs
       as its virtual account with only the privileges it needs, and /api/ready answers; the
       program and data folders have their own permissions (no inherited ones, owner
       Administrators, nobody else may change them); setup.log is outside the service's reach.
    2. The setup wizard's API creates the first administrator, who signs in and changes a setting.
       A NODE_OPTIONS line added to grc.env is ignored by the service and by grc-windows.ps1.
    3. A backup through the management script; the server is killed and the service brings it back.
    4. Upgrade to the newer build (the data and sign-in survive; the permissions stay).
    5. An older installer is refused.
    6. An upgrade to the broken build is rolled back (the previous version runs with its data).
    7. Uninstall keeps the data.
    8. Reinstalling over the kept data folder is refused while it holds a junction, then works
       without it (into -ReinstallDir, under Program Files); uninstalling with /REMOVEDATA=1
       deletes the data folder but not what a junction in it points to.
#>
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Upgrade,
  [Parameter(Mandatory = $true)][string]$Broken,
  [string]$Instance = 'test',
  [int]$Port = 8206,
  [string]$DataRoot = "$env:ProgramData\SandpiperGRC-test",
  [string]$InstallDir = "$env:ProgramFiles\Sandpiper GRC test",
  [string]$ReinstallDir = "$env:ProgramFiles\Sandpiper GRC test",
  [string]$LogDir = "$env:TEMP\sandpiper-installer-test",
  [switch]$Preplanted,
  [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$svc = "SandpiperGRC-$Instance"
$base = "http://127.0.0.1:$Port"
$script:failures = 0
New-Item -ItemType Directory -Force $LogDir | Out-Null

function Pass([string]$t) { Write-Host "PASS  $t" -ForegroundColor Green }
function Fail([string]$t) { Write-Host "FAIL  $t" -ForegroundColor Red; $script:failures++ }
function Check([bool]$ok, [string]$t) { if ($ok) { Pass $t } else { Fail $t } }

function Invoke-Setup([string]$exe, [string]$name, [string[]]$extra = @()) {
  $log = Join-Path $LogDir "$name.log"
  $a = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$log`"") + $extra
  $p = Start-Process $exe -ArgumentList $a -Wait -PassThru
  Write-Host "  $name exit code $($p.ExitCode) (log $log)"
  return $p.ExitCode
}

function Get-Ready {
  try { $r = Invoke-WebRequest "$base/api/ready" -UseBasicParsing -TimeoutSec 5; return $r.Content -match '"ok"\s*:\s*true' } catch { return $false }
}
function Wait-Ready([int]$seconds = 180) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) { if (Get-Ready) { return $true }; Start-Sleep -Seconds 2 }
  return $false
}

$headers = @{ 'x-grc-csrf' = '1' }
$user = @{ username = 'installer-admin'; email = 'installer-admin@example.test'; displayName = 'Installer Test Admin'; password = 'Correct-Horse-Battery-Staple-42'; secondFactor = 'notice' }
function Sign-In {
  $s = $null
  $body = @{ username = $user.username; password = $user.password } | ConvertTo-Json
  try {
    Invoke-WebRequest "$base/api/auth/login" -Method Post -Body $body -ContentType 'application/json' -Headers $headers -UseBasicParsing -SessionVariable s | Out-Null
    return $s
  } catch { Write-Host "  sign-in failed: $($_.Exception.Message)"; return $null }
}
function Get-Json([string]$path, $session) {
  return Invoke-RestMethod "$base$path" -WebSession $session -Headers $headers -UseBasicParsing
}
function Get-Installed { return (Get-ItemProperty "HKLM:\SOFTWARE\Sandpiper GRC\$svc" -ErrorAction SilentlyContinue).Version }

# Rights that let an account change an item: write or append, delete (a child), permissions, owner, generic write or all.
$changeRights = 0x2 -bor 0x4 -bor 0x40 -bor 0x10000 -bor 0x40000 -bor 0x80000 -bor 0x10000000 -bor 0x40000000
$admins = 'S-1-5-32-544'
# The accounts other than SYSTEM, Administrators and TrustedInstaller (and $allowed) that may change $path.
function Get-OtherWriters([string]$path, [string[]]$allowed = @()) {
  $acl = Get-Acl -LiteralPath $path
  $ok = @('S-1-5-18', $admins, 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464', 'S-1-3-0') + $allowed
  return @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object {
      $_.AccessControlType -eq 'Allow' -and -not ($_.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and
      $ok -notcontains $_.IdentityReference.Value -and ([int]$_.FileSystemRights -band $changeRights) } | ForEach-Object { $_.IdentityReference.Value })
}
function Get-OwnerSid([string]$path) { return (Get-Acl -LiteralPath $path).GetOwner([Security.Principal.SecurityIdentifier]).Value }
function Get-ServiceSid { return [regex]::Match(((& sc.exe showsid $svc) -join ' '), 'S-1-5-80(-\d+){5}').Value }
function Test-LockedFolder([string]$path, [string]$what, [string[]]$allowed = @(), [switch]$Inherits) {
  $acl = Get-Acl -LiteralPath $path
  if (-not $Inherits) { Check $acl.AreAccessRulesProtected "the $what does not inherit its parent's permissions" }
  Check ((Get-OwnerSid $path) -eq $admins) "the $what belongs to Administrators"
  $w = Get-OtherWriters $path $allowed
  Check ($w.Count -eq 0) "nobody else may change the $what$(if ($w.Count) { " (found: $($w -join ', '))" })"
}
function Wait-Uninstalled([string]$dir) {
  # The uninstaller runs a copy of itself and returns at once: wait for it to finish.
  $deadline = (Get-Date).AddSeconds(180)
  while ((Get-Date) -lt $deadline -and ((Test-Path (Join-Path $dir 'unins000.exe')) -or (Get-Service $svc -ErrorAction SilentlyContinue))) { Start-Sleep -Seconds 2 }
}
# Makes $path and everything in it belong to $sid, with Everyone allowed to change it, as a user
# without administrator rights could have done before the installation.
function Set-PlantedOwner([string]$path, [string]$sid) {
  & icacls.exe $path /grant '*S-1-1-0:(OI)(CI)F' /T /C /Q | Out-Null
  & icacls.exe $path /setowner "*$sid" /T /C /Q | Out-Null
}

Write-Host '== 0. Folders made in advance by another user are refused'
if (-not $Preplanted) {
  if ((Test-Path $DataRoot) -or (Test-Path $InstallDir)) { throw "$DataRoot or $InstallDir exists already: remove what an earlier test left first." }
  New-Item -ItemType Directory -Force (Join-Path $DataRoot 'config'), (Join-Path $DataRoot 'upgrade') | Out-Null
  Set-Content (Join-Path $DataRoot 'config\grc.env') 'NODE_OPTIONS=--require C:\Users\Public\planted.js' -Encoding ASCII
  Set-Content (Join-Path $DataRoot 'config\secret.key') ('ab' * 32) -Encoding ASCII
  Set-PlantedOwner $DataRoot 'S-1-5-32-545'
  New-Item -ItemType Directory -Force (Join-Path $InstallDir 'node') | Out-Null
  Set-Content (Join-Path $InstallDir 'node\planted.dll') 'not a real library' -Encoding ASCII
  Set-PlantedOwner $InstallDir 'S-1-5-32-545'
}
Check ((Get-OwnerSid $DataRoot) -ne $admins -and (Get-OwnerSid $InstallDir) -ne $admins) "the planted folders belong to $(Get-OwnerSid $DataRoot), not to Administrators"
$plantedEnv = Get-Content (Join-Path $DataRoot 'config\grc.env') -Raw
$code = Invoke-Setup $Installer 'planted-data' @("/DIR=`"$InstallDir`"", "/PORT=$Port", "/DATADIR=`"$DataRoot`"")
Check ($code -eq 7) "an installation into the planted data folder stopped before copying anything (exit code $code, expected 7)"
Check (-not (Get-Service $svc -ErrorAction SilentlyContinue)) 'no service was created'
Check (-not (Test-Path (Join-Path $InstallDir 'app'))) 'no program files were copied'
Check ((Get-Content (Join-Path $DataRoot 'config\grc.env') -Raw) -eq $plantedEnv) 'the planted settings were not used or added to'
Check ([bool](Select-String -Path (Join-Path $LogDir 'planted-data.log') -Pattern 'already exists and holds items' -Quiet)) 'the installer log gives the reason'
Remove-Item $DataRoot -Recurse -Force
$code = Invoke-Setup $Installer 'planted-program' @("/DIR=`"$InstallDir`"", "/PORT=$Port", "/DATADIR=`"$DataRoot`"")
Check ($code -eq 7) "an installation into the planted program folder stopped before copying anything (exit code $code, expected 7)"
Check (-not (Get-Service $svc -ErrorAction SilentlyContinue)) 'no service was created'
Check ([bool](Select-String -Path (Join-Path $LogDir 'planted-program.log') -Pattern 'program folder .* already exists' -Quiet)) 'the installer log names the program folder'
Remove-Item $InstallDir -Recurse -Force
# The refused run made the data folder (empty and locked) before it checked the program folder.
if (Test-Path $DataRoot) { Remove-Item $DataRoot -Recurse -Force }

Write-Host "== 1. Install $Installer into $InstallDir"
$code = Invoke-Setup $Installer 'install' @("/DIR=`"$InstallDir`"", "/PORT=$Port", "/DATADIR=`"$DataRoot`"", '/TASKS=startmenu')
Check ($code -eq 0) 'the installer finished with exit code 0'
if ($code -ne 0) {
  Select-String -Path (Join-Path $LogDir 'install.log') -Pattern 'Refused|grc-windows' | ForEach-Object { Write-Host "  $($_.Line)" }
  Write-Host 'The installation failed, so the remaining steps are skipped.' -ForegroundColor Red
  exit 1
}
$service = Get-CimInstance Win32_Service -Filter "Name='$svc'"
Check ($service -and $service.State -eq 'Running') "the service $svc is running"
Check ($service.StartName -in @("NT SERVICE\$svc", 'NT AUTHORITY\NetworkService')) "it runs as a low-privilege account: $($service.StartName) (Network Service only where a policy refuses virtual accounts the right to log on as a service)"
Check ($service.StartMode -eq 'Auto') 'it starts at boot'
Check (Get-Ready) '/api/ready answers ok'
Check (Test-Path (Join-Path $DataRoot 'config\secret.key')) 'the secret key was created'
$keyAcl = (Get-Acl (Join-Path $DataRoot 'config\secret.key')).Access | ForEach-Object { "$($_.IdentityReference)" }
Check (-not ($keyAcl | Where-Object { $_ -match 'Users|Everyone' })) "only SYSTEM, Administrators and the service can read the key ($($keyAcl -join ', '))"
Check (Test-Path (Join-Path $DataRoot 'logs\service.log')) 'the service writes its log to the logs folder'
$svcSid = Get-ServiceSid
Test-LockedFolder $InstallDir 'program folder'
$nodeWriters = Get-OtherWriters (Join-Path $InstallDir 'node\node.exe')
Check ($nodeWriters.Count -eq 0) "nobody else may change node\node.exe$(if ($nodeWriters.Count) { " ($($nodeWriters -join ', '))" })"
Test-LockedFolder $DataRoot 'data folder'
Test-LockedFolder (Join-Path $DataRoot 'config') 'config folder' -Inherits
$envWriters = Get-OtherWriters (Join-Path $DataRoot 'config\grc.env')
Check ($envWriters.Count -eq 0) "nobody else may change grc.env$(if ($envWriters.Count) { " ($($envWriters -join ', '))" })"
Check ((Get-OtherWriters (Join-Path $DataRoot 'data') @($svcSid)).Count -eq 0) 'only the service (besides SYSTEM and Administrators) may change the data'
Check (Test-Path (Join-Path $DataRoot 'setup.log')) 'setup.log is in the data folder itself, which the service may not change'
Check (-not (Test-Path (Join-Path $DataRoot 'logs\setup.log'))) 'no setup.log in the logs folder'
$privs = (& sc.exe qprivs $svc) -join ' '
Check ($privs -match 'SeChangeNotifyPrivilege' -and $privs -notmatch 'SeImpersonatePrivilege') "the service keeps only the privileges it needs, not SeImpersonatePrivilege ($(([regex]::Matches($privs, 'Se\w+Privilege') | ForEach-Object Value) -join ', '))"
$sc = Get-Item "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Sandpiper GRC ($Instance)\Server status.lnk" -ErrorAction SilentlyContinue
Check ([bool]$sc) 'the Start menu shortcuts exist'
& (Join-Path $InstallDir 'sandpiper.cmd') status | Out-Host
Check ($LASTEXITCODE -eq 0) 'sandpiper status says running and ready'

Write-Host '== 2. First administrator and sign-in'
$setup = Invoke-WebRequest "$base/api/setup" -Method Post -Body ($user | ConvertTo-Json) -ContentType 'application/json' -Headers $headers -UseBasicParsing
Check ($setup.StatusCode -eq 200) 'the setup wizard created the first administrator'
$session = Sign-In
Check ([bool]$session) 'the administrator signs in'
$marker = "Installer test $(Get-Date -Format 'HHmmss')"
Invoke-RestMethod "$base/api/admin/settings" -Method Patch -Body (@{ 'app.name' = $marker } | ConvertTo-Json) -ContentType 'application/json' -WebSession $session -Headers $headers -UseBasicParsing | Out-Null
Check ((Get-Json '/api/version' $session).version -eq (Get-Installed)) "the server reports the installed version ($(Get-Installed))"
$about = Get-Json '/api/admin/about' $session
Check ($about.updateCheck.blockedBy -eq 'outbound_off') 'the update check asks nothing while outbound connections are off'
# A NODE_OPTIONS line would make node.exe load the named file first; a file that does not exist
# would stop it. The service and grc-windows.ps1 (backup, upgrade) must both ignore it.
Add-Content (Join-Path $DataRoot 'config\grc.env') 'NODE_OPTIONS=--require C:\sandpiper-test-missing\planted.js' -Encoding ASCII
& (Join-Path $InstallDir 'sandpiper.cmd') restart | Out-Host
Check (Wait-Ready 120) 'with NODE_OPTIONS in grc.env the service still starts (the line is ignored)'
Check ([bool](Select-String -Path (Join-Path $DataRoot 'logs\service.log') -Pattern 'Ignored settings.*NODE_OPTIONS' -Quiet)) 'service.log names the ignored setting'

Write-Host '== 3. Backup, and a crash'
& (Join-Path $InstallDir 'sandpiper.cmd') backup | Out-Host
Check ($LASTEXITCODE -eq 0) 'sandpiper backup took a backup and started the service again (NODE_OPTIONS in grc.env ignored)'
Check ([bool](Select-String -Path (Join-Path $DataRoot 'setup.log') -Pattern 'Ignored the setting NODE_OPTIONS' -Quiet)) 'setup.log names the ignored setting'
Check (@(Get-ChildItem (Join-Path $DataRoot 'backups') -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'manifest.json') }).Count -ge 1) 'the backup is in the backups folder'
Check (Get-Ready) 'ready after the backup'
$nodePid = (Get-Content (Join-Path $DataRoot 'data\grc.pid') -ErrorAction SilentlyContinue)
if ($nodePid) { Stop-Process -Id ([int]$nodePid) -Force }
Start-Sleep -Seconds 3
Check (Wait-Ready 120) 'after the server process was killed, the service started it again'

Write-Host "== 4. Upgrade to $Upgrade"
$from = Get-Installed
$code = Invoke-Setup $Upgrade 'upgrade'
Check ($code -eq 0) 'the upgrade finished with exit code 0'
$to = Get-Installed
Check ($to -ne $from) "the recorded version moved from $from to $to"
Check (Get-Ready) 'ready after the upgrade'
$session = Sign-In
Check ([bool]$session) 'the administrator still signs in'
Check ((Get-Json '/api/version' $session).version -eq $to) "the server reports version $to"
Check ((Get-Json '/api/admin/settings' $session).values.'app.name' -eq $marker) 'the data survived the upgrade'
Check (@(Get-ChildItem (Join-Path $DataRoot 'backups') -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'manifest.json') }).Count -ge 2) 'the upgrade took a pre-upgrade backup'
Check (-not (Test-Path (Join-Path $DataRoot 'upgrade\previous'))) 'the copy of the old program files was removed after success'
Test-LockedFolder $InstallDir 'program folder (after the upgrade)'
Check ((Get-OtherWriters (Join-Path $InstallDir 'app\server\src\main.ts')).Count -eq 0) 'nobody else may change the new program files'
Test-LockedFolder $DataRoot 'data folder (after the upgrade)'

& (Join-Path $InstallDir 'sandpiper.cmd') check-update | Out-Host
Check ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 1) 'sandpiper check-update ran (it needs GitHub; 1 means it could not be reached)'

Write-Host '== 5. An older installer is refused'
$code = Invoke-Setup $Installer 'downgrade'
Check ($code -ne 0) "the older installer stopped (exit code $code)"
Check ((Get-Installed) -eq $to) "version $to is still recorded"
Check (Get-Ready) 'still ready'

Write-Host "== 6. A failed upgrade rolls back ($Broken)"
$code = Invoke-Setup $Broken 'broken-upgrade'
Check ($code -eq 12) "the installer reported a rolled-back upgrade (exit code $code, expected 12)"
Check ((Get-Installed) -eq $to) "version $to is recorded again"
Check (Wait-Ready 60) 'ready after the rollback'
$session = Sign-In
Check ([bool]$session) 'the administrator signs in after the rollback'
Check ((Get-Json '/api/version' $session).version -eq $to) "the server reports version $to again"
Check ((Get-Json '/api/admin/settings' $session).values.'app.name' -eq $marker) 'the data is as it was before the failed upgrade'
Check (-not (Test-Path (Join-Path $InstallDir 'app\server\src\core\migrations\999_installer_test_broken.sql'))) 'the broken version''s files are gone'
$display = (Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' | Where-Object { $_.PSChildName -eq "${svc}_is1" } | Get-ItemProperty).DisplayVersion
Check ($display -eq $to) "Settings > Apps shows version $display"
Get-Content (Join-Path $DataRoot 'setup.log') -Tail 15 | Out-Host

Write-Host '== 7. Uninstall keeps the data'
Start-Process (Join-Path $InstallDir 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$(Join-Path $LogDir 'uninstall.log')`"" -Wait
Wait-Uninstalled $InstallDir
Check (-not (Get-Service $svc -ErrorAction SilentlyContinue)) 'the service was removed'
Check (-not (Test-Path (Join-Path $InstallDir 'app'))) 'the program files were removed'
Check (-not (Test-Path "HKLM:\SOFTWARE\Sandpiper GRC\$svc")) 'the registry settings were removed'
Check (Test-Path (Join-Path $DataRoot 'data\pg')) 'the database was kept'
Check (Test-Path (Join-Path $DataRoot 'config\secret.key')) 'the secret key was kept'
Check (-not (Get-NetFirewallRule -Name "SandpiperGRC-$svc" -ErrorAction SilentlyContinue)) 'no firewall rule is left'
if ((Test-Path $InstallDir) -and $InstallDir -ne $ReinstallDir) { Remove-Item $InstallDir -Recurse -Force }

Write-Host "== 8. Reinstall over the kept data folder into $ReinstallDir, then uninstall with /REMOVEDATA=1"
# A junction in the data folder (as code running in the service could make in the folders it may change).
$outside = Join-Path $LogDir 'junction-target'
New-Item -ItemType Directory -Force $outside | Out-Null
Set-Content (Join-Path $outside 'canary.txt') 'must survive' -Encoding ASCII
$link = Join-Path $DataRoot 'logs\link-out'
& cmd.exe /d /c mklink /J "$link" "$outside" | Out-Null
$code = Invoke-Setup $Upgrade 'reinstall-with-junction' @("/DIR=`"$ReinstallDir`"", "/PORT=$Port", "/DATADIR=`"$DataRoot`"")
Check ($code -eq 7) "a reinstallation over a data folder holding a junction stopped (exit code $code, expected 7)"
& cmd.exe /d /c rmdir "$link"
$code = Invoke-Setup $Upgrade 'reinstall' @("/DIR=`"$ReinstallDir`"", "/PORT=$Port", "/DATADIR=`"$DataRoot`"")
Check ($code -eq 0) 'the reinstallation over the kept data folder finished with exit code 0'
Check (Get-Ready) 'ready after the reinstallation'
$session = Sign-In
Check ([bool]$session) 'the administrator signs in with the kept data'
Check ((Get-Json '/api/admin/settings' $session).values.'app.name' -eq $marker) 'the kept data is used'
Test-LockedFolder $ReinstallDir 'program folder of the reinstallation'
& cmd.exe /d /c mklink /J "$(Join-Path $DataRoot 'data\link-out')" "$outside" | Out-Null
Check (Test-Path (Join-Path $DataRoot 'data\link-out\canary.txt')) 'a junction to a folder outside was made in the data folder'
Start-Process (Join-Path $ReinstallDir 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/REMOVEDATA=1', "/LOG=`"$(Join-Path $LogDir 'uninstall-removedata.log')`"" -Wait
Wait-Uninstalled $ReinstallDir
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline -and (Test-Path $DataRoot)) { Start-Sleep -Seconds 2 }
Check (-not (Get-Service $svc -ErrorAction SilentlyContinue)) 'the service was removed'
Check (-not (Test-Path $DataRoot)) 'the data folder was deleted'
Check (Test-Path (Join-Path $outside 'canary.txt')) 'what the junction pointed to was not deleted'
Remove-Item $outside -Recurse -Force -ErrorAction SilentlyContinue

if ($RemoveData) {
  foreach ($d in $DataRoot, $InstallDir, $ReinstallDir) { if (Test-Path $d) { Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue } }
  Write-Host 'Removed whatever the test left.'
}
if ($script:failures) { Write-Host "$($script:failures) check(s) FAILED" -ForegroundColor Red; exit 1 }
Write-Host 'All installer checks passed.' -ForegroundColor Green
exit 0
