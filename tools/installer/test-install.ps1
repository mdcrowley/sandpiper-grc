<#
  End-to-end test of the Windows installer (E42), run as an administrator: on the GitHub runner by
  .github/workflows/windows-installer.yml, and on a test machine by hand. It installs a separate test
  instance (built with build.ps1 -Instance), so it cannot touch a real installation.

    powershell -ExecutionPolicy Bypass -File tools\installer\test-install.ps1 `
      -Installer   <out>\SandpiperGRC-test-Setup-0.2.0.exe `
      -Upgrade     <out>\SandpiperGRC-test-Setup-0.2.1.exe `
      -Broken      <out>\SandpiperGRC-test-Setup-0.2.2.exe   (built with -BrokenMigration) `
      -Instance test -Port 8206 -DataRoot C:\ProgramData\SandpiperGRC-test [-RemoveData]

  Steps: install silently; the service runs as its virtual account and /api/ready answers; the
  management script answers; the setup wizard's API creates the first administrator, who signs in
  and changes a setting; a backup through the management script; the server is killed and the
  service brings it back; upgrade to the newer build (the data and sign-in survive); an older
  installer is refused; an upgrade to the broken build is rolled back (the previous version runs
  with its data); uninstall keeps the data. -RemoveData then deletes the test data folder.
#>
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Upgrade,
  [Parameter(Mandatory = $true)][string]$Broken,
  [string]$Instance = 'test',
  [int]$Port = 8206,
  [string]$DataRoot = "$env:ProgramData\SandpiperGRC-test",
  [string]$InstallDir = "$env:ProgramFiles\Sandpiper GRC test",
  [string]$LogDir = "$env:TEMP\sandpiper-installer-test",
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

Write-Host "== 1. Install $Installer"
$code = Invoke-Setup $Installer 'install' @("/DIR=`"$InstallDir`"", "/PORT=$Port", "/DATADIR=`"$DataRoot`"", '/TASKS=startmenu')
Check ($code -eq 0) 'the installer finished with exit code 0'
$service = Get-CimInstance Win32_Service -Filter "Name='$svc'"
Check ($service -and $service.State -eq 'Running') "the service $svc is running"
Check ($service.StartName -in @("NT SERVICE\$svc", 'NT AUTHORITY\NetworkService')) "it runs as a low-privilege account: $($service.StartName) (Network Service only where a policy refuses virtual accounts the right to log on as a service)"
Check ($service.StartMode -eq 'Auto') 'it starts at boot'
Check (Get-Ready) '/api/ready answers ok'
Check (Test-Path (Join-Path $DataRoot 'config\secret.key')) 'the secret key was created'
$keyAcl = (Get-Acl (Join-Path $DataRoot 'config\secret.key')).Access | ForEach-Object { "$($_.IdentityReference)" }
Check (-not ($keyAcl | Where-Object { $_ -match 'Users|Everyone' })) "only SYSTEM, Administrators and the service can read the key ($($keyAcl -join ', '))"
Check (Test-Path (Join-Path $DataRoot 'logs\service.log')) 'the service writes its log to the logs folder'
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

Write-Host '== 3. Backup, and a crash'
& (Join-Path $InstallDir 'sandpiper.cmd') backup | Out-Host
Check ($LASTEXITCODE -eq 0) 'sandpiper backup took a backup and started the service again'
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
Get-Content (Join-Path $DataRoot 'logs\setup.log') -Tail 15 | Out-Host

Write-Host '== 7. Uninstall keeps the data'
$uninstaller = Join-Path $InstallDir 'unins000.exe'
Start-Process $uninstaller -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$(Join-Path $LogDir 'uninstall.log')`"" -Wait
# The uninstaller runs a copy of itself and returns at once: wait for it to finish.
$deadline = (Get-Date).AddSeconds(180)
while ((Get-Date) -lt $deadline -and ((Test-Path $uninstaller) -or (Get-Service $svc -ErrorAction SilentlyContinue))) { Start-Sleep -Seconds 2 }
Check (-not (Get-Service $svc -ErrorAction SilentlyContinue)) 'the service was removed'
Check (-not (Test-Path (Join-Path $InstallDir 'app'))) 'the program files were removed'
Check (-not (Test-Path "HKLM:\SOFTWARE\Sandpiper GRC\$svc")) 'the registry settings were removed'
Check (Test-Path (Join-Path $DataRoot 'data\pg')) 'the database was kept'
Check (Test-Path (Join-Path $DataRoot 'config\secret.key')) 'the secret key was kept'
Check (-not (Get-NetFirewallRule -Name "SandpiperGRC-$svc" -ErrorAction SilentlyContinue)) 'no firewall rule is left'

if ($RemoveData) {
  Remove-Item $DataRoot -Recurse -Force
  Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Deleted the test data folder $DataRoot."
}
if ($script:failures) { Write-Host "$($script:failures) check(s) FAILED" -ForegroundColor Red; exit 1 }
Write-Host 'All installer checks passed.' -ForegroundColor Green
exit 0
