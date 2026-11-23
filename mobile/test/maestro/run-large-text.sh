#!/usr/bin/env bash
# Runs large-text.yaml (E38-15) at Android's largest text size (font scale 2.0) in the dark theme, then
# puts the emulator's text size and theme back. The app must be signed in already (connect-sign-in.yaml)
# and run-fieldwork.sh's set-up done (INSPECTION is an inspection reference assigned to the person).
#
#   INSPECTION=INS-00036 METRO_PORT=8260 mobile/test/maestro/run-large-text.sh
set -euo pipefail
cd "$(dirname "$0")"
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true MSYS_NO_PATHCONV=1
: "${INSPECTION:?}"
METRO_PORT="${METRO_PORT:-8081}"
adb reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}" >/dev/null
restore() { adb shell settings put system font_scale 1.0; adb shell cmd uimode night no >/dev/null; }
trap restore EXIT
adb shell settings put system font_scale 2.0
adb shell cmd uimode night yes >/dev/null
maestro test -e INSPECTION="$INSPECTION" large-text.yaml
