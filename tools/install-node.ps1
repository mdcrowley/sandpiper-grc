<#
  Sandpiper GRC - download the portable Node.js into .tools\node.

  Usage (from the repository root, no administrator rights needed):
    powershell -ExecutionPolicy Bypass -File .\tools\install-node.ps1
    powershell -ExecutionPolicy Bypass -File .\tools\install-node.ps1 -Force    # replace an existing copy (newer patch release)

  What it does:
    1. Reads the Node.js major version from tools\node-version.txt (the one place it is pinned;
       continuous integration reads the same file).
    2. Downloads SHASUMS256.txt for the newest release of that major version from nodejs.org.
    3. Downloads the Windows x64 zip named in it and checks its SHA-256 against that list.
    4. Extracts it so that .tools\node\node.exe exists.

  Nothing is installed system-wide and nothing else is contacted. The checksum list is
  fetched over HTTPS from nodejs.org; this script does not check its OpenPGP signature
  (see docs\installation.md for how to do that by hand).
#>
param(
  [switch]$Force,
  # Where to put it. The default is what grc.ps1 expects.
  [string]$Destination = (Join-Path (Split-Path $PSScriptRoot -Parent) '.tools\node'),
  # Base address of the Node.js downloads (for a mirror inside your network).
  [string]$Mirror = 'https://nodejs.org/dist'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads many times slower in Windows PowerShell
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$major = (Get-Content (Join-Path $PSScriptRoot 'node-version.txt') -TotalCount 1).Trim()
if ($major -notmatch '^\d+$') { throw "tools\node-version.txt must hold a major version number such as 24; found '$major'." }

$exe = Join-Path $Destination 'node.exe'
if ((Test-Path $exe) -and -not $Force) {
  $have = & $exe --version
  if ($have -like "v$major.*") { Write-Host "Node.js $have is already in $Destination. Use -Force to replace it with the newest $major.x release." }
  else { Write-Host "Node.js $have is in $Destination but version $major is wanted. Run again with -Force to replace it." -ForegroundColor Yellow }
  exit 0
}

$base = "$Mirror/latest-v$major.x"
$work = Join-Path ([IO.Path]::GetTempPath()) ("grc-node-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $work | Out-Null
try {
  Write-Host "Reading $base/SHASUMS256.txt"
  $sumsFile = Join-Path $work 'SHASUMS256.txt'
  Invoke-WebRequest "$base/SHASUMS256.txt" -OutFile $sumsFile -UseBasicParsing
  $line = Get-Content $sumsFile | Where-Object { $_ -match "^[0-9a-f]{64}\s+node-v$major\.\d+\.\d+-win-x64\.zip$" } | Select-Object -First 1
  if (-not $line) { throw "No Windows x64 zip for Node.js $major is listed in $base/SHASUMS256.txt." }
  $expected, $zipName = $line -split '\s+', 2
  $folderName = $zipName -replace '\.zip$', ''

  Write-Host "Downloading $zipName"
  $zip = Join-Path $work $zipName
  Invoke-WebRequest "$base/$zipName" -OutFile $zip -UseBasicParsing

  $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected.ToLowerInvariant()) {
    throw "Checksum mismatch for $zipName.`n  expected $expected`n  actual   $actual`nNothing was installed. Try again; if it keeps failing, do not use this download."
  }
  Write-Host "Checksum verified (SHA-256 $actual)"

  Write-Host 'Extracting...'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $unpacked = Join-Path $work 'unpacked'
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $unpacked)
  $source = Join-Path $unpacked $folderName
  if (-not (Test-Path (Join-Path $source 'node.exe'))) { throw "The zip does not contain $folderName\node.exe." }

  New-Item -ItemType Directory -Force (Split-Path $Destination -Parent) | Out-Null
  $old = $null
  if (Test-Path $Destination) {
    # Renaming fails as a whole, before anything is changed, if the server is still running from it.
    $old = "$Destination.old-" + [guid]::NewGuid().ToString('N').Substring(0, 8)
    try { Rename-Item $Destination $old }
    catch { throw "Could not replace $Destination ($($_.Exception.Message)). Stop the server first (.\grc.ps1 stop) and close anything using it." }
  }
  # Copy rather than move: the temporary folder may be on another drive.
  Copy-Item $source $Destination -Recurse
  if ($old) { Remove-Item $old -Recurse -Force }
  $version = & (Join-Path $Destination 'node.exe') --version
  Write-Host "Node.js $version is ready in $Destination" -ForegroundColor Green
  Write-Host 'Next:  .\grc.ps1 npm install   then   .\grc.ps1 start'
}
finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
