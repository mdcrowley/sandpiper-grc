<#
  Sandpiper GRC on Windows: everyday management of the installed server (E42-05).

  Installed in the program folder with sandpiper.cmd, which runs this script; the Start menu
  shortcuts in the "Sandpiper GRC" folder run sandpiper.cmd. From a command prompt:

    sandpiper status         the service's state and the answer of /api/ready
    sandpiper start          start the service (asks for administrator rights when needed)
    sandpiper stop           stop the service (likewise)
    sandpiper restart        stop and start it (likewise)
    sandpiper backup         stop the service, back up the data, start it again (likewise)
    sandpiper check-update   the installed version and the newest release; offers to open the download page
    sandpiper logs           open the logs folder
    sandpiper open           open the application in the browser

  Add --pause to wait for a key before the window closes (the Start menu shortcuts do).

  Starting, stopping, restarting and backing up are done by grc-windows.ps1 in the same folder.
  When this window lacks administrator rights, Windows asks for them (UAC) and the work runs in a
  second, visible window. check-update reads the project's public release list on GitHub; it never
  downloads or runs anything. Nothing here runs hidden or at sign-in.
#>
param(
  [Parameter(Position = 0)][string]$Command = 'help',
  [switch]$Pause,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$here = $PSScriptRoot
$ReleasesApi = 'https://api.github.com/repos/mdcrowley/sandpiper-grc/releases/latest'
$ReleasesPage = 'https://github.com/mdcrowley/sandpiper-grc/releases'

# --pause as written in a shortcut (cmd passes it as text).
if (@($Rest) -contains '--pause') { $Pause = $true }

function Wait-Key {
  if ($Pause) { Write-Host ''; Read-Host 'Press Enter to close this window' | Out-Null }
}

# The installation in this program folder, from the settings the installer wrote to the registry.
function Get-Installation {
  $root = 'HKLM:\SOFTWARE\Sandpiper GRC'
  if (-not (Test-Path $root)) { return $null }
  $mine = $here.TrimEnd('\')
  foreach ($k in Get-ChildItem $root) {
    $p = Get-ItemProperty $k.PSPath
    if ($p.InstallDir -and $p.InstallDir.TrimEnd('\') -eq $mine) {
      return [pscustomobject]@{
        ServiceName = $k.PSChildName; Version = $p.Version; DataRoot = $p.DataRoot; Port = [int]$p.Port; Scheme = $p.Scheme
        LocalUrl = "$($p.Scheme)://127.0.0.1:$($p.Port)"; BrowserUrl = "$($p.Scheme)://localhost:$($p.Port)/"
      }
    }
  }
  return $null
}

function Test-Administrator {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# -1, 0 or 1. "v1.2.3" and "1.2.3-rc.1" are understood; a pre-release sorts before its release.
function Compare-Version([string]$a, [string]$b) {
  $re = '^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?'
  $x = [regex]::Match("$a".Trim(), $re); $y = [regex]::Match("$b".Trim(), $re)
  if (-not $x.Success -or -not $y.Success) { return 0 }
  for ($i = 1; $i -le 3; $i++) {
    $p = [long]$x.Groups[$i].Value; $q = [long]$y.Groups[$i].Value
    if ($p -ne $q) { if ($p -lt $q) { return -1 } else { return 1 } }
  }
  $pa = if ($x.Groups[4].Success) { $x.Groups[4].Value } else { $null }
  $pb = if ($y.Groups[4].Success) { $y.Groups[4].Value } else { $null }
  if ($pa -eq $pb) { return 0 }
  if ($null -eq $pa) { return 1 }
  if ($null -eq $pb) { return -1 }
  if ([string]::CompareOrdinal($pa, $pb) -lt 0) { return -1 } else { return 1 }
}

function Get-Ready([string]$url) {
  $saved = [Net.ServicePointManager]::ServerCertificateValidationCallback
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    # This asks this very machine, whose certificate may be self-signed.
    if ($url.StartsWith('https')) { [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true } }
    $r = Invoke-WebRequest "$url/api/ready" -UseBasicParsing -TimeoutSec 5
    return @($true, $r.Content)
  } catch {
    $body = $null
    if ($_.Exception.Response) {
      try { $body = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch { }
      return @($false, "HTTP $([int]$_.Exception.Response.StatusCode) $body")
    }
    return @($false, "no answer ($($_.Exception.Message))")
  } finally { [Net.ServicePointManager]::ServerCertificateValidationCallback = $saved }
}

function Show-Status($inst) {
  $svc = Get-Service -Name $inst.ServiceName -ErrorAction SilentlyContinue
  $state = if ($svc) { [string]$svc.Status } else { 'not installed' }
  Write-Host "Sandpiper GRC $($inst.Version)"
  Write-Host "  Service:   $($inst.ServiceName) is $state"
  $ready = $false
  if ($state -eq 'Running') {
    $r = Get-Ready $inst.LocalUrl
    $ready = $r[0] -and ($r[1] -match '"ok"\s*:\s*true')
    Write-Host "  Ready:     $(if ($ready) { 'yes' } else { 'no' })  ($($inst.LocalUrl)/api/ready answered: $($r[1]))" -ForegroundColor $(if ($ready) { 'Green' } else { 'Yellow' })
  }
  Write-Host "  Address:   $($inst.BrowserUrl)"
  Write-Host "  Data:      $($inst.DataRoot)"
  Write-Host "  Logs:      $(Join-Path $inst.DataRoot 'logs')"
  return $ready
}

# start, stop, restart and backup: grc-windows.ps1, in this window when it has administrator
# rights, otherwise in a new window after the Windows prompt.
function Invoke-Admin($inst, [string]$action) {
  $script = Join-Path $here 'grc-windows.ps1'
  if (Test-Administrator) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script $action -ServiceName $inst.ServiceName
    return $LASTEXITCODE
  }
  Write-Host "Administrator rights are needed to $action the service; Windows will ask for them."
  $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" $action -ServiceName `"$($inst.ServiceName)`""
  try {
    $p = Start-Process powershell.exe -Verb RunAs -ArgumentList $argList -Wait -PassThru
    if ($p.ExitCode -eq 0) { Write-Host 'Done.' -ForegroundColor Green } else { Write-Host "It did not finish (exit code $($p.ExitCode)). The details are in $(Join-Path $inst.DataRoot 'setup.log')." -ForegroundColor Red }
    return $p.ExitCode
  } catch {
    Write-Host 'Nothing was done: administrator rights were not given.' -ForegroundColor Yellow
    return 1
  }
}

function Invoke-CheckUpdate($inst) {
  Write-Host "Installed: Sandpiper GRC $($inst.Version)"
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $r = Invoke-RestMethod $ReleasesApi -UseBasicParsing -TimeoutSec 15 -Headers @{ 'User-Agent' = 'sandpiper-grc-check-update'; Accept = 'application/vnd.github+json' }
  } catch {
    Write-Host "Could not reach GitHub: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "The releases are listed at $ReleasesPage"
    return 1
  }
  $latest = "$($r.tag_name)" -replace '^v', ''
  $page = if ("$($r.html_url)".StartsWith('https://github.com/')) { $r.html_url } else { $ReleasesPage }
  Write-Host "Newest release: $latest$(if ($r.published_at) { " (published $(([datetime]$r.published_at).ToString('yyyy-MM-dd')))" })"
  if ((Compare-Version $latest $inst.Version) -le 0) {
    Write-Host 'This server has the newest version.' -ForegroundColor Green
    return 0
  }
  Write-Host "A newer version is available: $page" -ForegroundColor Cyan
  Write-Host 'To upgrade: download SandpiperGRC-Setup-<version>.exe from that page, check its SHA-256 against SHA256SUMS.txt'
  Write-Host 'on the same page (Get-FileHash <file>), then run it on this server. It backs up the data first and puts this'
  Write-Host 'version back by itself if the upgrade fails.'
  if ([Console]::IsInputRedirected) { return 0 }   # run by a script: nothing to ask
  $answer = Read-Host 'Open the download page in the browser? [y/N]'
  if ($answer -match '^(y|yes)$') { Start-Process $page }
  return 0
}

$code = 0
$inst = Get-Installation
if ($Command -in @('help', '-h', '--help', '/?')) {
  Get-Help $PSCommandPath | Out-Host
  Write-Host 'Commands: status, start, stop, restart, backup, check-update, logs, open'
  exit 0
}
if (-not $inst) {
  Write-Host "No Sandpiper GRC installation in $here is recorded on this computer." -ForegroundColor Red
  Wait-Key
  exit 1
}
switch ($Command) {
  'status' { $code = if (Show-Status $inst) { 0 } else { 1 } }
  { $_ -in 'start', 'stop', 'restart', 'backup' } { $code = Invoke-Admin $inst $Command; Write-Host ''; Show-Status $inst | Out-Null }
  'check-update' { $code = Invoke-CheckUpdate $inst }
  'logs' { Start-Process explorer.exe -ArgumentList "`"$(Join-Path $inst.DataRoot 'logs')`"" }
  'open' { Start-Process $inst.BrowserUrl }
  default { Write-Host "Unknown command: $Command. Commands: status, start, stop, restart, backup, check-update, logs, open" -ForegroundColor Red; $code = 1 }
}
Wait-Key
exit $code
