#!/usr/bin/env bash
# Runs the field work flows (wave 15, E38-11 and E38-12) on a connected Android emulator against a
# scratch server: an inspection completed in airplane mode, and an inventory count done in airplane
# mode, each sent when the network is back; then checks on the server that the inspection is complete
# once, signed, and that the count merged the finds.
#
#   SERVER_LOCAL=http://127.0.0.1:8160 SERVER=http://10.0.2.2:8160 USERNAME=... PASSWORD=... \
#   METRO_PORT=8260 mobile/test/maestro/run-fieldwork.sh
#
# Same set-up as run.sh (docs/mobile.md, "End-to-end flows"); the person needs audits, assets, sites and
# tags permissions (an administrator will do). SKIP_SIGN_IN=1 keeps an app that is already signed in.
set -euo pipefail
cd "$(dirname "$0")"
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true MSYS_NO_PATHCONV=1
: "${SERVER:?}" "${SERVER_LOCAL:?}" "${USERNAME:?}" "${PASSWORD:?}"
METRO_PORT="${METRO_PORT:-8081}"

# Development builds load their JavaScript from Metro on this machine.
adb reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}" >/dev/null
if [ "${SKIP_SIGN_IN:-}" != "1" ]; then
  adb shell pm clear com.sandpipergrc >/dev/null
  adb shell "run-as com.sandpipergrc sh -c 'mkdir -p shared_prefs && echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><string name=\\\"debug_http_host\\\">localhost:${METRO_PORT}</string></map>\" > shared_prefs/com.sandpipergrc_preferences.xml'"
fi

# Invented records for this run: an inspection assigned to the person, an open count of two assets.
eval "$(node fieldwork.mjs setup "$SERVER_LOCAL" "$USERNAME" "$PASSWORD" | sed 's/^/export /')"
echo "Inspection $INSPECTION, count $COUNT ($TAG1, $TAG2; elsewhere $STRAY)"

flow() { maestro test -e SERVER="$SERVER" -e USERNAME="$USERNAME" -e PASSWORD="$PASSWORD" "$@"; }
[ "${SKIP_SIGN_IN:-}" = "1" ] || flow connect-sign-in.yaml
flow -e INSPECTION="$INSPECTION" inspection-offline.yaml
flow -e COUNT="$COUNT" -e TAG1="$TAG1" -e TAG2="$TAG2" -e STRAY="$STRAY" count-offline.yaml

node fieldwork.mjs check "$SERVER_LOCAL" "$USERNAME" "$PASSWORD" "$INSPECTION_ID" "$COUNT_ID"
