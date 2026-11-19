#!/bin/sh
# Sandpiper GRC - download the pinned Node.js LTS into .tools/node (macOS and Linux).
#
# Usage (from the repository root, no root rights needed):
#   ./tools/install-node.sh
#   ./tools/install-node.sh --force                 replace an existing copy (newer patch release)
#   ./tools/install-node.sh --mirror <url>          a copy of https://nodejs.org/dist inside your network
#   ./tools/install-node.sh --destination <folder>  put it somewhere else (default .tools/node)
#
# What it does:
#   1. Reads the Node.js major version from tools/node-version.txt (the one place it is pinned;
#      continuous integration and the Dockerfile follow the same file).
#   2. Works out the platform: darwin or linux, x64 or arm64.
#   3. Downloads SHASUMS256.txt for the newest release of that major version from nodejs.org,
#      then the matching .tar.gz named in it, and checks its SHA-256 against that list.
#   4. Unpacks it so that .tools/node/bin/node exists. grc.sh uses it from there.
#
# Nothing is installed system-wide and nothing else is contacted. Needs curl or wget, tar, and
# sha256sum or shasum. The checksum list is fetched over HTTPS; its OpenPGP signature is not
# checked (see docs/installation.md for how to do that by hand).
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
dest="$root/.tools/node"
mirror="https://nodejs.org/dist"
force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --force | -Force) force=1 ;;
    --mirror | -Mirror) mirror="$2"; shift ;;
    --mirror=*) mirror="${1#*=}" ;;
    --destination | -Destination) dest="$2"; shift ;;
    --destination=*) dest="${1#*=}" ;;
    -h | --help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option $1" >&2; exit 1 ;;
  esac
  shift
done

major="$(head -n 1 "$here/node-version.txt" | tr -d '[:space:]')"
case "$major" in '' | *[!0-9]*) echo "tools/node-version.txt must hold a major version number such as 24; found '$major'." >&2; exit 1 ;; esac

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo "This script is for macOS and Linux. On Windows use tools\\install-node.ps1." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "No Node.js build for this processor ($(uname -m)). Install Node.js $major yourself." >&2; exit 1 ;;
esac

if [ -x "$dest/bin/node" ] && [ $force = 0 ]; then
  have="$("$dest/bin/node" --version)"
  case "$have" in
    "v$major".*) echo "Node.js $have is already in $dest. Use --force to replace it with the newest $major.x release." ;;
    *) echo "Node.js $have is in $dest but version $major is wanted. Run again with --force to replace it." ;;
  esac
  exit 0
fi

if command -v curl >/dev/null 2>&1; then fetch() { curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then fetch() { wget -q -O "$2" "$1"; }
else echo 'Needs curl or wget.' >&2; exit 1; fi
case "$mirror" in http://*) fetch() { if command -v curl >/dev/null 2>&1; then curl -fsSL -o "$2" "$1"; else wget -q -O "$2" "$1"; fi; } ;; esac

if command -v sha256sum >/dev/null 2>&1; then sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else echo 'Needs sha256sum or shasum.' >&2; exit 1; fi

base="$mirror/latest-v$major.x"
work="$(mktemp -d "${TMPDIR:-/tmp}/grc-node-XXXXXX")"
trap 'rm -rf "$work"' EXIT INT TERM

echo "Reading $base/SHASUMS256.txt"
fetch "$base/SHASUMS256.txt" "$work/SHASUMS256.txt"
line="$(grep -E "^[0-9a-f]{64}  node-v$major\.[0-9]+\.[0-9]+-$os-$arch\.tar\.gz\$" "$work/SHASUMS256.txt" | head -n 1 || true)"
if [ -z "$line" ]; then echo "No $os-$arch .tar.gz for Node.js $major is listed in $base/SHASUMS256.txt." >&2; exit 1; fi
expected="${line%% *}"
file="${line##* }"
folder="${file%.tar.gz}"

echo "Downloading $file"
fetch "$base/$file" "$work/$file"
actual="$(sha256 "$work/$file")"
if [ "$actual" != "$expected" ]; then
  echo "Checksum mismatch for $file." >&2
  echo "  expected $expected" >&2
  echo "  actual   $actual" >&2
  echo 'Nothing was installed. Try again; if it keeps failing, do not use this download.' >&2
  exit 1
fi
echo "Checksum verified (SHA-256 $actual)"

echo 'Unpacking...'
mkdir -p "$work/unpacked"
tar -xzf "$work/$file" -C "$work/unpacked"
[ -x "$work/unpacked/$folder/bin/node" ] || { echo "The archive does not contain $folder/bin/node." >&2; exit 1; }

mkdir -p "$(dirname "$dest")"
old=''
if [ -e "$dest" ]; then
  old="$dest.old-$$"
  mv "$dest" "$old"
fi
# Copy rather than move: the temporary folder may be on another file system.
cp -R "$work/unpacked/$folder" "$dest"
[ -n "$old" ] && rm -rf "$old"
echo "Node.js $("$dest/bin/node" --version) is ready in $dest"
echo 'Next:  ./grc.sh install   then   ./grc.sh start'
