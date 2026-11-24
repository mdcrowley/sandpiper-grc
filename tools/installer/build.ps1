<#
  Builds the Sandpiper GRC Windows installer (E42): SandpiperGRC-Setup-<version>.exe and SHA256SUMS.txt.

  Usage (from the repository root, Windows PowerShell 5.1; no administrator rights needed):
    powershell -ExecutionPolicy Bypass -File .\tools\installer\build.ps1
        [-OutDir dist\installer] [-Version 0.2.1] [-Iscc <path to ISCC.exe>] [-NodeDir .tools\node]
        [-WebDist <a built web application to use instead of building it>] [-Instance <name>] [-BrokenMigration]

  What goes in (a folder "stage" under -OutDir, then compressed by Inno Setup):
    node\node.exe            the portable Node.js of -NodeDir (tools\node-version.txt; install-node.ps1 puts it in .tools\node)
    app\                     package.json, server\ (without tests), shared\, dist\web\ (the built web application)
                             and production node_modules (npm ci --omit=dev): everything the server needs offline
    SandpiperService.exe     the service host, compiled here from deploy\windows\SandpiperService.cs with the
                             C# compiler of the .NET Framework 4 that every supported Windows has
    grc-windows.ps1          install, upgrade, rollback and removal (deploy\windows)
    sandpiper.cmd, sandpiper.ps1  everyday management: status, start, stop, restart, backup, check-update,
                             logs, open (deploy\windows); the Start menu shortcuts run them
    LICENSE.txt, THIRD-PARTY-NOTICES.txt

  -Version       the version written into the staged package.json and the installer (default: package.json's).
                 The installer tests use it to build a "newer" copy.
  -Instance      a separate test installation (own service name, folders and uninstall entry).
  -BrokenMigration  for the installer tests only: adds a migration that fails, so an upgrade to this
                 build must roll back.
  Inno Setup 6 (free; https://jrsoftware.org/isinfo.php) must be installed, or named with -Iscc.
#>
param(
  [string]$OutDir,
  [string]$Version,
  [string]$Iscc,
  [string]$NodeDir,
  [string]$WebDist,
  [string]$Instance = '',
  [switch]$BrokenMigration
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $OutDir) { $OutDir = Join-Path $root 'dist\installer' }
if (-not $NodeDir) { $NodeDir = Join-Path $root '.tools\node' }
$OutDir = [IO.Path]::GetFullPath($OutDir)
$stage = Join-Path $OutDir 'stage'

function Step([string]$text) { Write-Host "== $text" -ForegroundColor Cyan }
function Invoke-Checked {
  $ErrorActionPreference = 'Continue'
  $exe = $args[0]; $rest = @($args | Select-Object -Skip 1)
  & $exe @rest 2>&1 | ForEach-Object { "$_" } | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "$exe $($rest -join ' ') failed (exit $LASTEXITCODE)." }
}

# ---------- tools ----------
$node = Join-Path $NodeDir 'node.exe'
$npm = Join-Path $NodeDir 'npm.cmd'
if (-not (Test-Path $node)) { throw "Node.js is missing from $NodeDir. Run tools\install-node.ps1 (or give -NodeDir)." }
$major = (Get-Content (Join-Path $root 'tools\node-version.txt') -TotalCount 1).Trim()
$nodeVersion = (& $node --version).Trim()
if ($nodeVersion -notlike "v$major.*") { throw "Node.js $nodeVersion in $NodeDir is not the pinned major version $major (tools\node-version.txt)." }
if (-not $Iscc) {
  $Iscc = @($env:ISCC, "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
    Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $Iscc -or -not (Test-Path $Iscc)) { throw 'Inno Setup 6 was not found. Install it (https://jrsoftware.org/isdl.php) or give -Iscc <path to ISCC.exe>.' }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "The .NET Framework 4 C# compiler was not found at $csc." }

$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $pkg.version }
if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw "Version '$Version' is not a version such as 1.2.3." }
$numeric = ($Version -split '-')[0]

# ---------- stage ----------
Step "Staging Sandpiper GRC $Version in $stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
$app = Join-Path $stage 'app'
New-Item -ItemType Directory -Force $app, (Join-Path $stage 'node') | Out-Null

# package.json with the version being built; the lock file keeps the packages exactly as tested.
$pkgText = Get-Content (Join-Path $root 'package.json') -Raw
$pkgText = [regex]::Replace($pkgText, '"version"\s*:\s*"[^"]*"', "`"version`": `"$Version`"", 1)
[IO.File]::WriteAllText((Join-Path $app 'package.json'), $pkgText, (New-Object Text.UTF8Encoding($false)))
Copy-Item (Join-Path $root 'package-lock.json') $app
# The commit it is built from, shown with the version (GRC_COMMIT, set by the service host).
$commit = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { try { (& git -C $root rev-parse HEAD 2>$null) } catch { '' } }
if ($commit -match '^[0-9a-f]{7,40}$') { Set-Content -Path (Join-Path $app 'COMMIT') -Value $commit -Encoding ASCII }

# Server and shared code, without tests.
& robocopy.exe (Join-Path $root 'server') (Join-Path $app 'server') /E /XF '*.test.ts' /XD node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Copying server\ failed.' }
& robocopy.exe (Join-Path $root 'shared') (Join-Path $app 'shared') /E /XF '*.test.ts' /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Copying shared\ failed.' }
Copy-Item (Join-Path $root 'deploy\healthcheck.mjs') (New-Item -ItemType Directory -Force (Join-Path $app 'deploy')).FullName

if ($BrokenMigration) {
  # Installer tests only: an upgrade to this build fails at its migrations and must roll back.
  $m = Join-Path $app 'server\src\core\migrations\999_installer_test_broken.sql'
  Set-Content -Path $m -Value "-- Installer rollback test (tools\installer\build.ps1 -BrokenMigration): this migration fails on purpose.`nselect 1 / 0;" -Encoding ASCII
  Write-Host "Added the failing migration $m (rollback test build)." -ForegroundColor Yellow
}

# The web application.
$webOut = Join-Path $app 'dist\web'
if ($WebDist) {
  Step "Copying the built web application from $WebDist"
  & robocopy.exe $WebDist $webOut /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Copying the web application failed.' }
} else {
  Step 'Building the web application'
  $env:Path = "$NodeDir;$env:Path"
  $env:GRC_WEB_DIST = $webOut
  Push-Location $root
  try { Invoke-Checked $npm run --silent build } finally { Pop-Location; Remove-Item Env:GRC_WEB_DIST -ErrorAction SilentlyContinue }
}
if (-not (Test-Path (Join-Path $webOut 'index.html'))) { throw "The web application is missing from $webOut." }

Step 'Installing production packages (npm ci --omit=dev)'
$env:Path = "$NodeDir;$env:Path"
Push-Location $app
try { Invoke-Checked $npm ci --omit=dev --no-audit --no-fund } finally { Pop-Location }

Step 'Node.js'
Copy-Item $node (Join-Path $stage 'node\node.exe')
Copy-Item (Join-Path $NodeDir 'LICENSE') (Join-Path $stage 'node\LICENSE') -ErrorAction SilentlyContinue

Step 'Compiling the service host'
Invoke-Checked $csc '-nologo' '-optimize' '-target:exe' "-out:$(Join-Path $stage 'SandpiperService.exe')" '-r:System.ServiceProcess.dll' (Join-Path $root 'deploy\windows\SandpiperService.cs')

Copy-Item (Join-Path $root 'deploy\windows\grc-windows.ps1'), (Join-Path $root 'deploy\windows\sandpiper.ps1'), (Join-Path $root 'deploy\windows\sandpiper.cmd') $stage
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $stage 'LICENSE.txt')
@"
Sandpiper GRC $Version for Windows bundles:
- Node.js $nodeVersion (MIT and others): node\LICENSE
- The npm packages in app\node_modules, each with its own license file in its folder
  (listed with their licenses in app\package-lock.json).
The installer is made with Inno Setup (https://jrsoftware.org/isinfo.php).
"@ | Set-Content -Path (Join-Path $stage 'THIRD-PARTY-NOTICES.txt') -Encoding UTF8

# ---------- compile ----------
Step "Compiling the installer with $Iscc"
$defines = @("/DAppVersion=$Version", "/DNumericVersion=$numeric", "/DStageDir=$stage", "/DOutputDir=$OutDir")
if ($Instance) {
  if ($Instance -notmatch '^[A-Za-z0-9-]{1,30}$') { throw 'An instance name has 1 to 30 letters, digits or dashes.' }
  $defines += "/DInstance=$Instance"
}
Invoke-Checked $Iscc /Q @defines (Join-Path $PSScriptRoot 'sandpiper-grc.iss')

$name = if ($Instance) { "SandpiperGRC-$Instance-Setup-$Version.exe" } else { "SandpiperGRC-Setup-$Version.exe" }
$exe = Join-Path $OutDir $name
if (-not (Test-Path $exe)) { throw "The installer $exe was not made." }
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
# One line per installer, as sha256sum writes them; a release lists every installer it carries.
$sums = Join-Path $OutDir 'SHA256SUMS.txt'
$lines = @()
if (Test-Path $sums) { $lines = @(Get-Content $sums | Where-Object { $_ -and -not $_.EndsWith(" $name") }) }
$lines += "$hash  $name"
Set-Content -Path $sums -Value $lines -Encoding ASCII
$size = '{0:N0} MB' -f ((Get-Item $exe).Length / 1MB)
Write-Host "Built $exe ($size)" -ForegroundColor Green
Write-Host "SHA-256 $hash (in $sums)"
