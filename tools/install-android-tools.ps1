<#
  Sandpiper GRC - download a portable JDK 17 and Android SDK into .tools\ for building the mobile app
  for Android (mobile/, docs/mobile.md). No administrator rights needed; nothing is installed
  system-wide. (iPhone builds need a Mac with Xcode.)

  Usage (from the repository root):
    powershell -ExecutionPolicy Bypass -File .\tools\install-android-tools.ps1
    powershell -ExecutionPolicy Bypass -File .\tools\install-android-tools.ps1 -WithEmulator     # also the emulator and a test phone
    powershell -ExecutionPolicy Bypass -File .\tools\install-android-tools.ps1 -AcceptLicenses   # accept the SDK licenses without asking
    powershell -ExecutionPolicy Bypass -File .\tools\install-android-tools.ps1 -Force            # replace existing copies

  What it does:
    1. JDK 17: asks the Eclipse Adoptium API (api.adoptium.net) for the newest Temurin 17 Windows x64
       zip, downloads it and checks its SHA-256 against the one the API publishes; extracts it to
       .tools\jdk.
    2. Android command-line tools: reads Google's SDK repository list (dl.google.com, the list the
       SDK's own tools use), downloads the "cmdline-tools;latest" Windows zip and checks its SHA-1
       against that list; extracts it to .tools\android-sdk\cmdline-tools\latest.
    3. Shows the SDK licenses (sdkmanager --licenses) for you to accept, or accepts them with -AcceptLicenses.
    4. Installs platform-tools, platforms;android-36 and build-tools;36.0.0 with the Android command-line
       tool, ALWAYS with --no-metrics (it would otherwise send usage data to Google). The SDK's installer
       checks every package's checksum. Gradle downloads anything else it needs (NDK, CMake, a newer
       platform) on the first build.
    5. With -WithEmulator: the emulator, the system image system-images;android-36;google_apis;x86_64 and
       a virtual phone "sandpiper-test" (Pixel 7 profile) in .tools\android-avd.

  Then, in a PowerShell window:
    $env:JAVA_HOME = "$PWD\.tools\jdk"; $env:ANDROID_HOME = "$PWD\.tools\android-sdk"
    $env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
    $env:ANDROID_AVD_HOME = "$PWD\.tools\android-avd"     # for the emulator
    $env:EXPO_NO_TELEMETRY = "1"                          # Expo sends no usage data
#>
param(
  [switch]$Force,
  [switch]$WithEmulator,
  [switch]$AcceptLicenses,
  # Where to put them. The default is what docs/mobile.md uses.
  [string]$Tools = (Join-Path (Split-Path $PSScriptRoot -Parent) '.tools')
)

$ErrorActionPreference = 'Stop'
$env:EXPO_NO_TELEMETRY = '1'   # Expo sends no usage data (set it too in the shell you build from)
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads many times slower in Windows PowerShell
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$jdk = Join-Path $Tools 'jdk'
$sdk = Join-Path $Tools 'android-sdk'
$avdHome = Join-Path $Tools 'android-avd'
$repository = 'https://dl.google.com/android/repository'
$packages = @('platform-tools', 'platforms;android-36', 'build-tools;36.0.0')
$emulatorPackages = @('emulator', 'system-images;android-36;google_apis;x86_64')

$work = Join-Path ([IO.Path]::GetTempPath()) ('grc-android-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $work | Out-Null

function Get-Checked([string]$Url, [string]$File, [string]$Algorithm, [string]$Expected) {
  Write-Host "Downloading $Url"
  Invoke-WebRequest $Url -OutFile $File -UseBasicParsing
  $actual = (Get-FileHash $File -Algorithm $Algorithm).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.ToLowerInvariant()) {
    throw "Checksum mismatch for $Url`n  expected $Expected`n  actual   $actual`nNothing was installed. Try again; if it keeps failing, do not use this download."
  }
  Write-Host "  $Algorithm checksum matches."
}

try {
  # ---------- 1. JDK 17 (Eclipse Temurin) ----------
  if ((Test-Path (Join-Path $jdk 'bin\java.exe')) -and -not $Force) {
    Write-Host "A JDK is already in $jdk (use -Force to replace it)."
  } else {
    $api = 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
    $asset = (Invoke-RestMethod $api -UseBasicParsing) | Where-Object { $_.binary.package.name -like '*.zip' } | Select-Object -First 1
    if (-not $asset) { throw "The Adoptium API listed no Temurin 17 Windows x64 zip." }
    $zip = Join-Path $work $asset.binary.package.name
    Get-Checked $asset.binary.package.link $zip 'SHA256' $asset.binary.package.checksum
    $out = Join-Path $work 'jdk'
    Expand-Archive $zip -DestinationPath $out
    $top = Get-ChildItem $out -Directory | Select-Object -First 1
    if (Test-Path $jdk) { Remove-Item -Recurse -Force $jdk }
    New-Item -ItemType Directory -Force (Split-Path $jdk) | Out-Null
    Move-Item $top.FullName $jdk
    Write-Host "JDK $($asset.release_name) is in $jdk"
  }
  $env:JAVA_HOME = $jdk

  # ---------- 2. Android command-line tools ----------
  $latest = Join-Path $sdk 'cmdline-tools\latest'
  if ((Test-Path (Join-Path $latest 'bin')) -and -not $Force) {
    Write-Host "The Android command-line tools are already in $latest (use -Force to replace them)."
  } else {
    $listFile = Join-Path $work 'repository2-3.xml'
    Invoke-WebRequest "$repository/repository2-3.xml" -OutFile $listFile -UseBasicParsing
    [xml]$list = Get-Content $listFile -Raw
    $pkg = $list.SelectNodes('//remotePackage') | Where-Object { $_.path -eq 'cmdline-tools;latest' } | Select-Object -First 1
    $archive = $pkg.archives.archive | Where-Object { $_.'host-os' -eq 'windows' } | Select-Object -First 1
    if (-not $archive) { throw 'The SDK repository list has no Windows command-line tools.' }
    $zip = Join-Path $work $archive.complete.url
    Get-Checked "$repository/$($archive.complete.url)" $zip 'SHA1' $archive.complete.checksum.'#text'
    $out = Join-Path $work 'cmdline'
    Expand-Archive $zip -DestinationPath $out
    if (Test-Path $latest) { Remove-Item -Recurse -Force $latest }
    New-Item -ItemType Directory -Force (Split-Path $latest) | Out-Null
    Move-Item (Join-Path $out 'cmdline-tools') $latest
    Write-Host "Android command-line tools $($pkg.revision.major).$($pkg.revision.minor) are in $latest"
  }
  $env:ANDROID_HOME = $sdk
  $bin = Join-Path $latest 'bin'

  # ---------- 3. Licenses ----------
  $sdkmanager = Join-Path $bin 'sdkmanager.bat'
  if ($AcceptLicenses) {
    Write-Host 'Accepting the Android SDK licenses (-AcceptLicenses).'
    1..40 | ForEach-Object { 'y' } | & $sdkmanager "--sdk_root=$sdk" --licenses | Out-Null
  } else {
    Write-Host 'Read and accept the Android SDK licenses:'
    & $sdkmanager "--sdk_root=$sdk" --licenses
  }

  # ---------- 4 and 5. Packages (always without metrics) ----------
  $android = Join-Path $bin 'android.exe'
  $wanted = $packages + $(if ($WithEmulator) { $emulatorPackages } else { @() })
  if (Test-Path $android) {
    & $android --no-metrics "--sdk=$sdk" sdk install @wanted
  } else {
    & $sdkmanager "--sdk_root=$sdk" @wanted
  }
  if ($LASTEXITCODE -ne 0) { throw "Installing the SDK packages failed (exit $LASTEXITCODE)." }

  if ($WithEmulator) {
    New-Item -ItemType Directory -Force $avdHome | Out-Null
    $env:ANDROID_AVD_HOME = $avdHome
    $avdmanager = Join-Path $bin 'avdmanager.bat'
    $have = & $avdmanager list avd -c
    if ($have -contains 'sandpiper-test' -and -not $Force) {
      Write-Host "The virtual phone sandpiper-test already exists in $avdHome."
    } else {
      'no' | & $avdmanager create avd --force -n sandpiper-test -k 'system-images;android-36;google_apis;x86_64' -d pixel_7
      Write-Host "Virtual phone sandpiper-test created in $avdHome."
    }
  }

  Write-Host ''
  Write-Host 'Done. In this window, before building (docs/mobile.md):' -ForegroundColor Green
  Write-Host "  `$env:JAVA_HOME = '$jdk'; `$env:ANDROID_HOME = '$sdk'; `$env:EXPO_NO_TELEMETRY = '1'"
  Write-Host "  `$env:PATH = `"`$env:JAVA_HOME\bin;`$env:ANDROID_HOME\platform-tools;`$env:PATH`""
  if ($WithEmulator) { Write-Host "  `$env:ANDROID_AVD_HOME = '$avdHome'" }
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
