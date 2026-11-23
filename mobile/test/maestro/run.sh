#!/usr/bin/env bash
# Runs the app's Maestro flows on a connected Android emulator against a scratch server, then checks
# on the server that each report arrived exactly once with its two photos (E38-01, E38-06, E38-10).
#
#   SERVER_LOCAL=http://127.0.0.1:8150 SERVER=http://10.0.2.2:8150 USERNAME=... PASSWORD=... \
#   METRO_PORT=8250 mobile/test/maestro/run.sh
#
# SERVER is the address as the emulator reaches it, SERVER_LOCAL as this machine reaches it. The person
# must exist without a second factor and the Mobile app area must be on (docs/mobile.md, "End-to-end
# flows"). Needs maestro (MAESTRO_CLI_NO_ANALYTICS=1 is set here), adb, curl and node on the path.
set -euo pipefail
cd "$(dirname "$0")"  # relative paths below work with Windows tools too
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true MSYS_NO_PATHCONV=1
: "${SERVER:?}" "${SERVER_LOCAL:?}" "${USERNAME:?}" "${PASSWORD:?}"
METRO_PORT="${METRO_PORT:-8081}"
run_id="$(date +%s)"

# A clean app pointed at Metro (development builds load their JavaScript from it).
adb shell pm clear com.sandpipergrc >/dev/null
adb reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}" >/dev/null
adb shell "run-as com.sandpipergrc sh -c 'mkdir -p shared_prefs && echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><string name=\\\"debug_http_host\\\">localhost:${METRO_PORT}</string></map>\" > shared_prefs/com.sandpipergrc_preferences.xml'"

# Two pictures in the gallery for the photo picker.
for f in code-qr.png plain-digits.png; do
  adb push "../tag-photos/images/$f" "/sdcard/Pictures/$f" >/dev/null
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Pictures/$f" >/dev/null
done

flow() { maestro test -e SERVER="$SERVER" -e USERNAME="$USERNAME" -e PASSWORD="$PASSWORD" "$@"; }
flow connect-sign-in.yaml
flow -e TITLE="Invented report $run_id" report-two-photos.yaml
flow -e TITLE="Invented offline report $run_id" airplane-mode-sync.yaml
flow -e TITLE="Invented unsent report $run_id" sign-out-wipes.yaml

# On the server: each title once, with two files; the unsent one never.
jar="$(mktemp)"
curl -sf -c "$jar" -H 'Content-Type: application/json' -H 'X-GRC-CSRF: 1' -X POST "$SERVER_LOCAL/api/auth/login" \
  -d "$(node -e 'console.log(JSON.stringify({ username: process.argv[1], password: process.argv[2] }))' "$USERNAME" "$PASSWORD")" >/dev/null
check() {
  node --input-type=module - "$SERVER_LOCAL" "$1" "$2" "$3" "$(grep grc_session "$jar" | awk '{print $6"="$7}')" <<'EOF'
const [base, title, want, files, cookie] = process.argv.slice(-5);
const get = async (p) => (await fetch(base + p, { headers: { cookie } })).json();
const r = await get(`/api/tickets?f.title=${encodeURIComponent(title)}&pageSize=10`);
let ok = r.total === Number(want);
for (const t of r.rows) {
  const a = await get(`/api/attachments?record_type=ticket&record_id=${t.id}`);
  const n = (a.rows ?? a).length;
  if (n !== Number(files)) ok = false;
  console.log(`${title}: ${t.ref}, ${n} files`);
}
console.log(`${title}: ${r.total} ticket(s), expected ${want} -> ${ok ? 'OK' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
EOF
}
check "Invented report $run_id" 1 2
check "Invented offline report $run_id" 1 2
check "Invented unsent report $run_id" 0 0
rm -f "$jar"
