#!/usr/bin/env sh
# Sandpiper GRC - download a portable JDK 17 and Android SDK into .tools/ for building the mobile app
# for Android on macOS or Linux (mobile/, docs/mobile.md). No administrator rights needed; nothing is
# installed system-wide. The same steps as tools/install-android-tools.ps1:
#
#   ./tools/install-android-tools.sh [--with-emulator] [--accept-licenses] [--force]
#
#   1. JDK 17: the newest Eclipse Temurin 17 for this machine from the Adoptium API (api.adoptium.net),
#      its SHA-256 checked against the one the API publishes; extracted to .tools/jdk.
#   2. Android command-line tools: "cmdline-tools;latest" from Google's SDK repository list
#      (dl.google.com, the list the SDK's own tools use), its SHA-1 checked against that list;
#      extracted to .tools/android-sdk/cmdline-tools/latest.
#   3. The SDK licenses (sdkmanager --licenses), shown for you to accept, or accepted with --accept-licenses.
#   4. platform-tools, platforms;android-36 and build-tools;36.0.0 through the Android command-line tool,
#      ALWAYS with --no-metrics. The SDK's installer checks every package's checksum.
#   5. With --with-emulator: the emulator, system-images;android-36;google_apis;<arch> and a virtual
#      phone "sandpiper-test" (Pixel 7 profile) in .tools/android-avd.
#
# Needs curl, unzip, tar and shasum or sha256sum/sha1sum.
set -eu
export EXPO_NO_TELEMETRY=1   # Expo sends no usage data (set it too in the shell you build from)

FORCE=0
EMULATOR=0
ACCEPT=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --with-emulator) EMULATOR=1 ;;
    --accept-licenses) ACCEPT=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TOOLS="$ROOT/.tools"
JDK="$TOOLS/jdk"
SDK="$TOOLS/android-sdk"
AVD_HOME="$TOOLS/android-avd"
REPOSITORY=https://dl.google.com/android/repository
WORK=$(mktemp -d "${TMPDIR:-/tmp}/grc-android-XXXXXX")
trap 'rm -rf "$WORK"' EXIT

case "$(uname -s)" in
  Darwin) OS=mac; SDK_OS=macosx ;;
  Linux) OS=linux; SDK_OS=linux ;;
  *) echo "Use tools/install-android-tools.ps1 on Windows." >&2; exit 2 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64; SDK_ARCH=x64; IMAGE_ARCH=x86_64 ;;
  arm64|aarch64) ARCH=aarch64; SDK_ARCH=aarch64; IMAGE_ARCH=arm64-v8a ;;
  *) echo "Unsupported processor: $(uname -m)" >&2; exit 2 ;;
esac

digest() { # algorithm file
  if command -v shasum >/dev/null 2>&1; then shasum -a "$1" "$2" | cut -d' ' -f1
  else "sha${1}sum" "$2" | cut -d' ' -f1; fi
}

fetch_checked() { # url file algorithm expected
  echo "Downloading $1"
  curl -fsSL "$1" -o "$2"
  actual=$(digest "$3" "$2")
  if [ "$actual" != "$(echo "$4" | tr 'A-F' 'a-f')" ]; then
    echo "Checksum mismatch for $1" >&2
    echo "  expected $4" >&2
    echo "  actual   $actual" >&2
    echo "Nothing was installed. Try again; if it keeps failing, do not use this download." >&2
    exit 1
  fi
  echo "  SHA-$3 checksum matches."
}

# ---------- 1. JDK 17 ----------
if [ -x "$JDK/bin/java" ] && [ "$FORCE" = 0 ]; then
  echo "A JDK is already in $JDK (use --force to replace it)."
else
  curl -fsSL "https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=$ARCH&image_type=jdk&os=$OS&vendor=eclipse" -o "$WORK/jdk.json"
  # The first asset's archive (a .tar.gz): its link and SHA-256, read without jq.
  LINK=$(tr -d '\n ' < "$WORK/jdk.json" | sed -n 's/.*"package":{"checksum":"\([0-9a-f]*\)"[^}]*"link":"\([^"]*\.tar\.gz\)".*/\2/p')
  SUM=$(tr -d '\n ' < "$WORK/jdk.json" | sed -n 's/.*"package":{"checksum":"\([0-9a-f]*\)"[^}]*"link":"\([^"]*\.tar\.gz\)".*/\1/p')
  [ -n "$LINK" ] && [ -n "$SUM" ] || { echo "The Adoptium API listed no Temurin 17 archive for $OS $ARCH." >&2; exit 1; }
  fetch_checked "$LINK" "$WORK/jdk.tar.gz" 256 "$SUM"
  mkdir -p "$WORK/jdk"
  tar -xzf "$WORK/jdk.tar.gz" -C "$WORK/jdk"
  TOP=$(find "$WORK/jdk" -mindepth 1 -maxdepth 1 -type d | head -n 1)
  [ -d "$TOP/Contents/Home" ] && TOP="$TOP/Contents/Home"   # macOS bundles
  rm -rf "$JDK"; mkdir -p "$TOOLS"; mv "$TOP" "$JDK"
  echo "JDK 17 is in $JDK"
fi
export JAVA_HOME="$JDK"

# ---------- 2. Android command-line tools ----------
LATEST="$SDK/cmdline-tools/latest"
if [ -d "$LATEST/bin" ] && [ "$FORCE" = 0 ]; then
  echo "The Android command-line tools are already in $LATEST (use --force to replace them)."
else
  curl -fsSL "$REPOSITORY/repository2-3.xml" -o "$WORK/repository.xml"
  # The cmdline-tools;latest archive for this machine: <checksum type="sha1"> and <url> before <host-os>.
  awk -v os="$SDK_OS" -v arch="$SDK_ARCH" '
    /<remotePackage path="cmdline-tools;latest">/ { inside = 1 }
    inside && /<\/remotePackage>/ { exit }
    inside && /<checksum/ { gsub(/.*<checksum[^>]*>|<\/checksum>.*/, ""); sum = $0 }
    inside && /<url>/ { gsub(/.*<url>|<\/url>.*/, ""); url = $0 }
    inside && /<host-os>/ { gsub(/.*<host-os>|<\/host-os>.*/, ""); hos = $0; harch = "" }
    inside && /<host-arch>/ { gsub(/.*<host-arch>|<\/host-arch>.*/, ""); harch = $0 }
    inside && /<\/archive>/ { if (hos == os && (harch == "" || harch == arch)) { print sum " " url; exit } }
  ' "$WORK/repository.xml" > "$WORK/cmdline.txt"
  read -r SUM URL < "$WORK/cmdline.txt" || true
  [ -n "${URL:-}" ] || { echo "The SDK repository list has no command-line tools for $SDK_OS." >&2; exit 1; }
  fetch_checked "$REPOSITORY/$URL" "$WORK/cmdline.zip" 1 "$SUM"
  unzip -q "$WORK/cmdline.zip" -d "$WORK/cmdline"
  rm -rf "$LATEST"; mkdir -p "$SDK/cmdline-tools"; mv "$WORK/cmdline/cmdline-tools" "$LATEST"
  echo "Android command-line tools are in $LATEST"
fi
export ANDROID_HOME="$SDK"
BIN="$LATEST/bin"

# ---------- 3. Licenses ----------
if [ "$ACCEPT" = 1 ]; then
  echo "Accepting the Android SDK licenses (--accept-licenses)."
  yes | "$BIN/sdkmanager" --sdk_root="$SDK" --licenses >/dev/null || true
else
  echo "Read and accept the Android SDK licenses:"
  "$BIN/sdkmanager" --sdk_root="$SDK" --licenses
fi

# ---------- 4 and 5. Packages (always without metrics) ----------
set -- platform-tools "platforms;android-36" "build-tools;36.0.0"
[ "$EMULATOR" = 1 ] && set -- "$@" emulator "system-images;android-36;google_apis;$IMAGE_ARCH"
if [ -x "$BIN/android" ]; then
  "$BIN/android" --no-metrics --sdk="$SDK" sdk install "$@"
else
  "$BIN/sdkmanager" --sdk_root="$SDK" "$@"
fi

if [ "$EMULATOR" = 1 ]; then
  mkdir -p "$AVD_HOME"
  export ANDROID_AVD_HOME="$AVD_HOME"
  if "$BIN/avdmanager" list avd -c | grep -qx sandpiper-test && [ "$FORCE" = 0 ]; then
    echo "The virtual phone sandpiper-test already exists in $AVD_HOME."
  else
    echo no | "$BIN/avdmanager" create avd --force -n sandpiper-test -k "system-images;android-36;google_apis;$IMAGE_ARCH" -d pixel_7
    echo "Virtual phone sandpiper-test created in $AVD_HOME."
  fi
fi

echo
echo "Done. Before building (docs/mobile.md):"
echo "  export JAVA_HOME=\"$JDK\" ANDROID_HOME=\"$SDK\" EXPO_NO_TELEMETRY=1"
echo "  export PATH=\"\$JAVA_HOME/bin:\$ANDROID_HOME/platform-tools:\$PATH\""
[ "$EMULATOR" = 1 ] && echo "  export ANDROID_AVD_HOME=\"$AVD_HOME\""
exit 0
