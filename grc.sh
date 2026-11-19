#!/usr/bin/env bash
# Sandpiper GRC - one-command operations on macOS and Linux (the counterpart of grc.ps1).
# Usage: ./grc.sh help
#
# The work of backup, restore, export, import and status is done in TypeScript
# (server/src/ops, called through server/src/cli.ts); this script stops and starts the
# server around it. See docs/operations.md.
#
# Node.js: the copy in .tools/node when present (tools/install-node.sh puts it there),
# otherwise the `node` on PATH. Its major version must match tools/node-version.txt.
#
# Options may be written --prune 14, --prune=14 or -Prune 14 (as in grc.ps1).

root="$(cd "$(dirname "$0")" && pwd)"
cd "$root" || exit 1

if [ -x "$root/.tools/node/bin/node" ]; then
  PATH="$root/.tools/node/bin:$PATH"
elif [ -x "$root/.tools/node/node" ] || [ -f "$root/.tools/node/node.exe" ]; then
  PATH="$root/.tools/node:$PATH"   # a Windows-layout copy, when this script runs in Git Bash
fi
export PATH

: "${GRC_PORT:=8080}"
export GRC_PORT
data_dir="${GRC_DATA_DIR:-$root/data}"
backup_dir="${GRC_BACKUP_DIR:-$root/backups}"
web_dist="${GRC_WEB_DIST:-$root/dist/web}"
pid_file="$data_dir/grc.pid"
log="$data_dir/server.log"
scheme=http
[ -n "${GRC_TLS_CERT:-}" ] && scheme=https
url="$scheme://127.0.0.1:$GRC_PORT"
tsx="$root/node_modules/tsx/dist/cli.mjs"
code_dir="$backup_dir/code"
want_major="$(head -n 1 "$root/tools/node-version.txt" | tr -d '[:space:]')"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
cyan() { printf '\033[36m%s\033[0m\n' "$*"; }

# --- command and options ------------------------------------------------------------------------
cmd="${1:-help}"
[ $# -gt 0 ] && shift

profile=pilot prune=0 label=manual at=02:00 lines=40 follow=0 no_secrets=0 out='' force=0 level=''
skip_install=0 encrypt=0 key_file='' pass_file='' to='' from='' pull=0 no_rollback=0 include_key=0
rest=()
if [ "$cmd" != npm ]; then
  while [ $# -gt 0 ]; do
    arg="$1"
    case "$arg" in
      --) shift; while [ $# -gt 0 ]; do rest+=("$1"); shift; done; break ;;
      -*)
        name="${arg%%=*}"
        value=''
        has_value=0
        case "$arg" in *=*) value="${arg#*=}"; has_value=1 ;; esac
        name="$(printf '%s' "$name" | sed 's/^-*//' | tr 'A-Z' 'a-z' | tr -d '-')"
        take() { if [ $has_value = 0 ]; then value="$2"; shift_extra=1; fi; }
        shift_extra=0
        case "$name" in
          profile) take "$@"; profile="$value" ;;
          prune) take "$@"; prune="$value" ;;
          label) take "$@"; label="$value" ;;
          at) take "$@"; at="$value" ;;
          lines) take "$@"; lines="$value" ;;
          level) take "$@"; level="$value" ;;
          out) take "$@"; out="$value" ;;
          keyfile) take "$@"; key_file="$value" ;;
          passphrasefile) take "$@"; pass_file="$value" ;;
          to) take "$@"; to="$value" ;;
          from) take "$@"; from="$value" ;;
          follow) follow=1 ;;
          nosecrets) no_secrets=1 ;;
          force) force=1 ;;
          skipinstall) skip_install=1 ;;
          encrypt) encrypt=1 ;;
          pull) pull=1 ;;
          norollback) no_rollback=1 ;;
          includesecretkey) include_key=1 ;;
          *) red "Unknown option $arg (./grc.sh help lists them)."; exit 1 ;;
        esac
        [ $shift_extra = 1 ] && shift
        ;;
      *) rest+=("$arg") ;;
    esac
    shift
  done
fi
first_rest="${rest[0]:-}"

# Key options for encrypted backups and exports, passed on to server/src/cli.ts.
key_args=()
[ -n "$key_file" ] && key_args+=(--key-file "$key_file")
[ -n "$pass_file" ] && key_args+=(--passphrase-file "$pass_file")

# --- Node.js ------------------------------------------------------------------------------------
node_problem() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is not installed (neither in .tools/node nor on PATH)."
    return 0
  fi
  local have
  have="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
  if [ "$have" != "$want_major" ] && [ "${GRC_SKIP_NODE_CHECK:-}" != 1 ]; then
    echo "Node.js $want_major is needed (tools/node-version.txt), but $(command -v node) is version $(node --version)."
    return 0
  fi
  return 1
}
require_node() {
  local problem
  if problem="$(node_problem)"; then
    red "$problem"
    echo 'Run ./tools/install-node.sh to put the right version in .tools/node (no root needed),'
    echo "or install Node.js $want_major yourself (see docs/installation.md)."
    exit 1
  fi
}

# --- server process -----------------------------------------------------------------------------
# Works the same on every platform, including a Windows process id when run from Git Bash.
pid_alive() { node -e 'try { process.kill(Number(process.argv[1]), 0) } catch (e) { process.exit(e.code === "EPERM" ? 0 : 1) }' "$1" 2>/dev/null; }
kill_pid() { node -e 'try { process.kill(Number(process.argv[1]), process.argv[2]) } catch {}' "$1" "$2" 2>/dev/null; }

# Prints the server's process id and succeeds when it is running; clears a stale process file.
server_pid() {
  [ -f "$pid_file" ] || return 1
  local id
  id="$(tr -d '[:space:]' <"$pid_file")"
  if [ -n "$id" ] && pid_alive "$id"; then printf '%s\n' "$id"; return 0; fi
  rm -f "$pid_file"
  return 1
}

health() {
  NODE_TLS_REJECT_UNAUTHORIZED=0 node --no-warnings -e '
    fetch(process.argv[1] + "/api/health", { signal: AbortSignal.timeout(3000) })
      .then((r) => r.json()).then((j) => process.exit(j.ok === true ? 0 : 1), () => process.exit(1));
  ' "$url" 2>/dev/null
}

stop_server() {
  local id
  if ! id="$(server_pid)"; then echo 'Not running.'; return 0; fi
  # Ask for a clean shutdown (flushes the embedded database); force only if that fails.
  : >"$data_dir/grc.stop"
  for _ in $(seq 1 30); do pid_alive "$id" || break; sleep 0.5; done
  if pid_alive "$id"; then
    kill_pid "$id" SIGTERM
    for _ in $(seq 1 10); do pid_alive "$id" || break; sleep 0.5; done
    pid_alive "$id" && kill_pid "$id" SIGKILL
  fi
  rm -f "$data_dir/grc.stop" "$pid_file"
  echo 'Stopped.'
}

install_packages() {
  if [ ! -d "$root/node_modules" ]; then
    npm install --no-fund --no-audit || { red 'npm install failed.'; return 1; }
  fi
}

# Builds the web application when it is missing or (unless "if-missing") older than its sources.
build_web() {
  local index="$web_dist/index.html"
  if [ "$1" = if-missing ] && [ -f "$index" ]; then return 0; fi
  if [ ! -f "$index" ] || [ -n "$(find "$root/web" "$root/docs/user" -type f -newer "$index" 2>/dev/null | head -n 1)" ]; then
    echo 'Building web app...'
    npm run build --silent || { red 'Web build failed.'; return 1; }
  fi
}

# Starts the server and waits for the health check. "no-build" restarts with the web
# application as it is (after backup, restore and the like).
start_server() {
  if server_pid >/dev/null; then echo "Already running at $url"; return 0; fi
  install_packages || return 1
  if [ "$1" = no-build ]; then build_web if-missing || return 1; else build_web || return 1; fi
  mkdir -p "$data_dir"
  if service_installed; then
    # Installed as a service (./grc.sh service install): start it there, so it stays supervised.
    start_service || { red "The service did not start. See ./grc.sh service status"; return 1; }
    for _ in $(seq 1 60); do health && break; sleep 0.5; done
  else
    nohup node "$tsx" server/src/main.ts >"$log" 2>"$log.err" </dev/null &
    local bg=$!
    for _ in $(seq 1 60); do
      health && break
      kill -0 "$bg" 2>/dev/null || break
      sleep 0.5
    done
  fi
  if health; then green "Sandpiper GRC is running at $url"; return 0; fi
  red "Server did not become healthy. See $log.err  (./grc.sh logs)"
  return 1
}

# Runs a command of server/src/cli.ts, showing its output; the output is also kept in $last_output.
last_output=''
run_cli() {
  install_packages || return 1
  local tmp code
  tmp="$(mktemp)"
  node "$tsx" server/src/cli.ts "$@" 2>&1 | tee "$tmp"
  code=${PIPESTATUS[0]}
  last_output="$(cat "$tmp")"
  rm -f "$tmp"
  return "$code"
}

# Runs a command that needs the database to itself: stops the server, runs it, and starts the
# server again if it was running. A code of 2 means the data folder was left incomplete, so the
# server is not started on it.
run_offline() {
  local was_running=0 code
  server_pid >/dev/null && was_running=1
  [ $was_running = 1 ] && stop_server
  run_cli "$@"
  code=$?
  if [ $code = 2 ]; then
    red 'The server has NOT been started. Follow the message above.'
  elif [ $was_running = 1 ] && ! start_server no-build; then
    [ $code = 0 ] && code=1
  fi
  return $code
}

newest_backup() {
  [ -d "$backup_dir" ] || return 1
  local d
  for d in $(ls -1 "$backup_dir" 2>/dev/null | sort -r); do
    if [ -f "$backup_dir/$d/manifest.json" ]; then printf '%s\n' "$backup_dir/$d"; return 0; fi
  done
  return 1
}

json_get() {
  node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { try { const v = JSON.parse(s)[process.argv[1]]; process.stdout.write(v === undefined ? "" : String(v)); } catch {} })' "$1"
}

usage() {
  cat <<'EOF'
Usage: ./grc.sh <command> [options]

  install                             Node.js check (or tools/install-node.sh) and npm install
  start | stop | restart | health     run the server on http://127.0.0.1:8080 (GRC_PORT)
  status                              version, port, process, data size, last backup, pending migrations
  logs [--lines n] [--follow] [--level warn]   show the end of the server log (data/logs/grc.log)
  version                             the installed version and commit
  service install|remove|status|print run the server as a systemd (Linux) or launchd (macOS) user service
  seed [--profile pilot|dev]          load data (idempotent)

  backup [--prune n] [--encrypt [--include-secret-key]]   verified copy of the data in backups/<timestamp>
  backups                             list backups (also the archives the server takes itself)
  verify-backup [<backup>]            check a backup against its checksums (default: latest)
  restore <backup|latest|file> [--force]   replace the data with a backup, keeping a safety copy
  schedule-backup [--at HH:MM] [--prune n] [--encrypt]   print a cron, systemd or launchd schedule
  unschedule-backup                   how to remove that schedule
  export-all [--out dir] [--no-secrets] [--encrypt]   every table as JSON Lines, plus files and checksums
  import-all <dir|file>               load an export into an empty installation
  decrypt <file> [--out file.tar]     turn an encrypted backup or export into a plain tar file
  new-key <file>                      make a key file for encrypted backups (keep it outside the data folder)
  move-files --to disk|s3             move attached files to the other store, checking each one
  upgrade [--from dir|zip|tar.gz | --pull] [--skip-install] [--no-rollback]
                                      backup, new code, npm install, build, migrate, restart, health check;
                                      puts the previous version back by itself if any step fails
  save-code                           keep a copy of the code as it is now, for upgrade to return to
  secret-key show|rotate              where the secret key comes from (fingerprint only); rotate writes a new one

  Encrypted files use --key-file <file> or --passphrase-file <file>, or the environment variables
  GRC_BACKUP_KEY_FILE, GRC_BACKUP_PASSPHRASE_FILE or GRC_BACKUP_PASSPHRASE.

  dev | build | test | typecheck | ci development (ci = typecheck + tests + tests on UTC + build + dependency audit)
  audit-deps [--level high]           known vulnerabilities in production packages; fails only when a fix exists
  npm <args>                          any npm command with this script's Node.js
EOF
}

# --- schedule-backup: print the lines to add (cron, systemd user timer, launchd) -----------------
schedule_backup() {
  case "$at" in [0-2][0-9]:[0-5][0-9]) ;; *) red "--at must be HH:MM, such as 02:30."; exit 1 ;; esac
  local hh="${at%%:*}" mm="${at##*:}" extra='' envs='' name value
  hh=$((10#$hh)); mm=$((10#$mm))
  [ "$prune" -gt 0 ] 2>/dev/null && extra="$extra --prune $prune"
  if [ $encrypt = 1 ]; then
    local kf="${key_file:-${GRC_BACKUP_KEY_FILE:-}}" pf="${pass_file:-${GRC_BACKUP_PASSPHRASE_FILE:-}}"
    if [ -z "$kf" ] && [ -z "$pf" ]; then
      red 'An encrypted scheduled backup needs --key-file or --passphrase-file (never put a passphrase in a schedule).'
      exit 1
    fi
    if [ -n "$kf" ]; then extra="$extra --encrypt --key-file $(cd "$(dirname "$kf")" && pwd)/$(basename "$kf")"
    else extra="$extra --encrypt --passphrase-file $(cd "$(dirname "$pf")" && pwd)/$(basename "$pf")"; fi
  fi
  # Schedulers start with a clean environment, so the settings in use now are written in.
  for name in GRC_DATA_DIR GRC_BACKUP_DIR GRC_WEB_DIST GRC_PORT GRC_TIMEZONE GRC_CURRENCY GRC_MODULES GRC_DATABASE_URL GRC_DATABASE_PASSWORD_FILE GRC_SECRET_KEY_FILE GRC_BACKUP_KEY_FILE GRC_BACKUP_PASSPHRASE_FILE; do
    eval "value=\${$name:-}"
    [ -n "$value" ] && envs="$envs$name=$value "
  done
  local run="$root/grc.sh backup --label scheduled$extra"
  cat <<EOF
This script does not change your system's scheduler. Add ONE of the following, as the user
that runs the server. Each run stops the server for a few seconds, takes a verified backup,
starts it again and adds a line to $backup_dir/scheduled-backup.log.

1. cron (Linux and macOS): run  crontab -e  and add

$mm $hh * * * ${envs}$run >/dev/null 2>&1

2. A systemd user timer (Linux): create ~/.config/systemd/user/grc-backup.service

[Unit]
Description=Sandpiper GRC backup
[Service]
Type=oneshot
WorkingDirectory=$root
EOF
  for name in $envs; do printf 'Environment=%s\n' "$name"; done
  cat <<EOF
ExecStart=$run

and ~/.config/systemd/user/grc-backup.timer

[Unit]
Description=Daily Sandpiper GRC backup
[Timer]
OnCalendar=*-*-* $(printf '%02d:%02d' "$hh" "$mm"):00
Persistent=true
[Install]
WantedBy=timers.target

then: systemctl --user daemon-reload && systemctl --user enable --now grc-backup.timer
(and  loginctl enable-linger $(id -un)  so it runs while you are signed out).
For a server installed as a system service, see deploy/systemd/ and docs/operations.md.

3. launchd (macOS): save as ~/Library/LaunchAgents/org.sandpiper-grc.backup.plist

<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>org.sandpiper-grc.backup</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>${envs}$run</string></array>
  <key>WorkingDirectory</key><string>$root</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$hh</integer><key>Minute</key><integer>$mm</integer></dict>
</dict></plist>

then: launchctl load ~/Library/LaunchAgents/org.sandpiper-grc.backup.plist

Check the result with ./grc.sh status and ./grc.sh backups.
EOF
}

# --- service: run the server under systemd (Linux) or launchd (macOS) as this user -----------------
# A user service needs no root: it starts at sign-in (and, on Linux with  loginctl enable-linger,
# at boot), is restarted if it crashes, and is stopped cleanly by ./grc.sh stop (a clean exit is not
# restarted). For a system-wide service run by its own account, see deploy/systemd and deploy/launchd.
service_name="${GRC_SERVICE_NAME:-sandpiper-grc}"
launchd_label="org.sandpiper-grc.${service_name#sandpiper-grc}"
launchd_label="${launchd_label%.}"
[ "$launchd_label" = org.sandpiper-grc ] && launchd_label=org.sandpiper-grc.server
systemd_unit="$HOME/.config/systemd/user/$service_name.service"
launchd_plist="$HOME/Library/LaunchAgents/$launchd_label.plist"

service_kind() {
  case "$(uname -s)" in
    Linux) echo systemd ;;
    Darwin) echo launchd ;;
    *) echo none ;;
  esac
}
service_file() { if [ "$(service_kind)" = launchd ]; then echo "$launchd_plist"; else echo "$systemd_unit"; fi; }
service_installed() { [ "$(service_kind)" != none ] && [ -f "$(service_file)" ]; }

# The GRC_* settings in force now, one NAME=value per line. Secrets given directly are left out:
# a service file is readable, so pass them as *_FILE settings instead.
service_env() {
  env | LC_ALL=C sort | while IFS= read -r line; do
    case "$line" in
      GRC_SERVICE_NAME=*) ;;
      GRC_*_FILE=*) printf '%s\n' "$line" ;;
      GRC_*PASSWORD*=* | GRC_*PASSPHRASE*=* | GRC_*SECRET*=* | GRC_*TOKEN*=* | GRC_*KEY_ID=* | GRC_DATABASE*URL=*://*:*@*) echo "skipped:${line%%=*}" ;;
      GRC_*=*) printf '%s\n' "$line" ;;
    esac
  done
}

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

service_text() {
  local node_bin line
  node_bin="$(command -v node)"
  if [ "$(service_kind)" = launchd ]; then
    cat <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Sandpiper GRC in $(xml_escape "$root"), written by ./grc.sh service install. -->
<plist version="1.0">
<dict>
  <key>Label</key><string>$launchd_label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$node_bin")</string>
    <string>$(xml_escape "$tsx")</string>
    <string>server/src/main.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$root")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml_escape "$(dirname "$node_bin"):/usr/bin:/bin")</string>
EOF2
    service_env | while IFS= read -r line; do
      case "$line" in skipped:*) continue ;; esac
      printf '    <key>%s</key><string>%s</string>\n' "${line%%=*}" "$(xml_escape "${line#*=}")"
    done
    cat <<EOF2
  </dict>
  <key>RunAtLoad</key><true/>
  <!-- Restarted after a crash, not after a clean stop (./grc.sh stop). -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>StandardOutPath</key><string>$(xml_escape "$log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$log.err")</string>
</dict>
</plist>
EOF2
  else
    cat <<EOF2
# Sandpiper GRC in $root, written by ./grc.sh service install.
[Unit]
Description=Sandpiper GRC ($root)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$root
Environment="PATH=$(dirname "$node_bin"):/usr/bin:/bin"
EOF2
    service_env | while IFS= read -r line; do
      case "$line" in skipped:*) continue ;; esac
      printf 'Environment="%s"\n' "$(printf '%s' "$line" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/%/%%/g')"
    done
    cat <<EOF2
ExecStart="$node_bin" "$tsx" server/src/main.ts
# A terminate signal makes the server finish requests in progress and close the database.
KillSignal=SIGTERM
TimeoutStopSec=30
# Restarted after a crash, not after a clean stop (./grc.sh stop).
Restart=on-failure
RestartSec=5
StandardOutput=append:$log
StandardError=append:$log.err

[Install]
WantedBy=default.target
EOF2
  fi
}

service_cmd() {
  local action="${first_rest:-status}" kind file
  kind="$(service_kind)"
  file="$(service_file)"
  if [ "$kind" = none ]; then red 'service needs systemd (Linux) or launchd (macOS). Use ./grc.sh start, or a scheduler of your own.'; exit 1; fi
  case "$action" in
    print) service_text ;;
    install)
      install_packages || exit 1
      build_web || exit 1
      if server_pid >/dev/null; then echo 'Stopping the server started by hand; the service runs it from now on.'; stop_server; fi
      mkdir -p "$(dirname "$file")" "$data_dir"
      service_text >"$file"
      chmod 600 "$file"
      service_env | grep '^skipped:' | while IFS= read -r line; do
        yellow "Not written into the service file: ${line#skipped:} (a secret). Use ${line#skipped:}_FILE, or a password file, instead."
      done
      if [ "$kind" = launchd ]; then
        launchctl bootout "gui/$(id -u)/$launchd_label" 2>/dev/null
        launchctl bootstrap "gui/$(id -u)" "$file" || { red "launchctl could not load $file"; exit 1; }
      else
        systemctl --user daemon-reload && systemctl --user enable --now "$service_name.service" || { red "systemctl --user could not start $service_name (is there a user session? see docs/operations.md)"; exit 1; }
      fi
      for _ in $(seq 1 60); do health && break; sleep 1; done
      if health; then green "Installed $file; Sandpiper GRC is running at $url and starts when you sign in."; else red "Installed $file, but the server did not answer. See ./grc.sh logs"; exit 1; fi
      [ "$kind" = systemd ] && echo "To start it at boot without signing in:  loginctl enable-linger $(id -un)"
      ;;
    remove | uninstall)
      if [ ! -f "$file" ]; then echo "No service installed ($file)."; exit 0; fi
      if [ "$kind" = launchd ]; then launchctl bootout "gui/$(id -u)/$launchd_label" 2>/dev/null
      else systemctl --user disable --now "$service_name.service" 2>/dev/null; fi
      rm -f "$file"
      [ "$kind" = systemd ] && systemctl --user daemon-reload 2>/dev/null
      server_pid >/dev/null && stop_server
      green "Removed $file. The data is untouched; ./grc.sh start runs the server by hand again."
      ;;
    status)
      if [ ! -f "$file" ]; then echo "No service installed (./grc.sh service install writes $file)."
      elif [ "$kind" = launchd ]; then launchctl print "gui/$(id -u)/$launchd_label" 2>/dev/null | grep -E '^\s*(state|pid|last exit code)' || echo "$launchd_label is installed but not loaded."
      else systemctl --user status "$service_name.service" --no-pager 2>/dev/null | head -n 5 || echo "$service_name is installed."; fi
      ;;
    *) red 'Usage: ./grc.sh service install | remove | status | print'; exit 1 ;;
  esac
}

# Starts the installed service instead of a background process, so it stays under its manager.
start_service() {
  if [ "$(service_kind)" = launchd ]; then launchctl kickstart "gui/$(id -u)/$launchd_label" 2>/dev/null || launchctl bootstrap "gui/$(id -u)" "$launchd_plist"
  else systemctl --user start "$service_name.service"; fi
}

# --- upgrade -----------------------------------------------------------------------------------
# Two ways to run it:
#   upgrade --from <folder, .zip or .tar.gz> (or --pull): saves the code as it is, then puts the new
#     release in place itself, so it can always go back.
#   upgrade on its own, after the new code is already in place (git pull, unpacked release):
#     going back uses the copy saved at the last successful upgrade (or by save-code / start).
# If any step fails, the previous code, packages and data are put back and the previous version
# is started again, unless --no-rollback is given.
snapshot() {
  local out
  out="$(node "$snap_tool" "$@")" || return 1
  printf '%s\n' "$out" | tail -n 1
}
make_executable() { chmod +x "$root/grc.sh" "$root/tools/install-node.sh" 2>/dev/null; return 0; }

stop_upgrade() {
  local step="$1" data_changed="$2" failed_at='' r
  echo
  red "UPGRADE FAILED at: $step"
  server_pid >/dev/null && stop_server
  if [ $no_rollback = 1 ] || [ -z "$previous" ]; then
    [ -z "$previous" ] && yellow 'No copy of the previous code was saved, so it cannot be put back by itself.'
    echo 'The server is stopped.'
    if [ "$data_changed" = 1 ]; then echo 'The database may have been changed by the new version.'; else echo 'The database has not been changed.'; fi
    echo
    echo 'To try again: fix the problem above and run  ./grc.sh upgrade'
    echo 'To go back to the previous version:'
    if [ -n "$previous" ]; then echo "  1. node $snap_tool restore \"$root\" \"$previous\""
    else echo '  1. Put the previous code back (for example: git checkout <previous tag or commit>).'; fi
    if [ -n "$backup_name" ] && [ "$data_changed" = 1 ]; then echo "  2. ./grc.sh restore \"$backup_name\""
    elif [ -n "$backup_name" ]; then echo "  2. (Not needed: the data is unchanged. The backup, if you want it, is $backup_name.)"
    else echo '  2. (There was no data to back up.)'; fi
    echo '  3. ./grc.sh npm install'
    echo '  4. ./grc.sh start'
    exit 1
  fi

  yellow "Rolling back to version $from_version..."
  if ! r="$(snapshot restore "$root" "$previous")"; then failed_at='putting the previous code back'
  else
    make_executable
    echo "  Code: version $(printf '%s' "$r" | json_get version) put back ($(printf '%s' "$r" | json_get written) file(s) written, $(printf '%s' "$r" | json_get removed) removed)."
    if [ "$(printf '%s' "$r" | json_get packagesChanged)" = true ]; then
      if [ $skip_install = 1 ]; then yellow '  Packages: the package list changed, but --skip-install was given: run ./grc.sh npm install yourself.'
      elif npm install --no-fund --no-audit; then echo '  Packages: the previous versions were installed again.'
      else failed_at='reinstalling the previous packages'; fi
    fi
  fi
  if [ -z "$failed_at" ] && [ "$data_changed" = 1 ] && [ -n "$backup_name" ]; then
    if run_cli restore "$backup_name" --force ${key_args[@]+"${key_args[@]}"}; then echo '  Data: the pre-upgrade backup was restored.'
    else failed_at='restoring the pre-upgrade backup'; fi
  elif [ -z "$failed_at" ]; then
    echo '  Data: unchanged by the new version, so nothing to restore.'
  fi
  if [ -z "$failed_at" ] && ! npm run build --silent; then failed_at='building the previous web application'; fi
  if [ -z "$failed_at" ] && ! { start_server no-build && health; }; then failed_at='starting the previous version'; fi

  echo
  if [ -z "$failed_at" ]; then
    yellow "ROLLED BACK: the upgrade failed at '$step', and version $from_version is running again with the data as it was before."
    [ -n "$backup_name" ] && [ "$data_changed" = 1 ] && echo "The pre-upgrade backup $backup_name was restored; the new version's data was kept as a pre-restore backup."
    echo 'Fix the cause shown above, then run the upgrade again.'
    exit 1
  fi
  red "ROLLBACK INCOMPLETE: the upgrade failed at '$step', and going back failed at: $failed_at."
  echo 'The server is stopped. To finish by hand:'
  echo "  1. node \"$snap_tool\" restore \"$root\" \"$previous\""
  [ -n "$backup_name" ] && [ "$data_changed" = 1 ] && echo "  2. ./grc.sh restore \"$backup_name\" --force"
  echo '  3. ./grc.sh npm install'
  echo '  4. ./grc.sh start'
  exit 2
}

upgrade() {
  local was_running=0 stamp saved applied source unpacked last_good to_version line
  server_pid >/dev/null && was_running=1
  stamp="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$code_dir"
  # The snapshot tool is copied aside first, so a broken new version cannot block the way back.
  snap_tool="$code_dir/code-snapshot.mjs"
  cp "$root/tools/code-snapshot.mjs" "$snap_tool"
  previous=''
  backup_name=''
  from_version="$(snapshot version "$root" | json_get version)"
  last_good="$code_dir/last-good.tar"

  cyan '[1/7] Keep the current code'
  if [ -n "$from" ] || [ $pull = 1 ]; then
    local snap="$code_dir/pre-upgrade-$stamp.tar"
    if ! saved="$(snapshot save "$root" "$snap")"; then red 'The current code could not be saved, so nothing was upgraded.'; exit 1; fi
    previous="$snap"
    echo "Saved version $(printf '%s' "$saved" | json_get version) ($(printf '%s' "$saved" | json_get files) files) to $snap"
  elif [ -f "$last_good" ]; then
    previous="$last_good"
    from_version="$(snapshot version "$last_good" | json_get version)"
    echo "The new code is already in place. If the upgrade fails, the saved copy $last_good (version $from_version) is put back."
  else
    yellow 'The new code is already in place and no earlier copy of the code was saved, so a failure cannot be rolled back by itself.'
    yellow 'Next time use --from <release> or --pull, or run ./grc.sh save-code before replacing the code.'
  fi
  printf '{ "from": "%s", "startedAt": "%s", "previousCode": "%s" }\n' "$from_version" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$previous" >"$code_dir/upgrade.json"

  cyan '[2/7] Backup'
  [ $was_running = 1 ] && stop_server
  if [ -d "$data_dir/pg" ]; then
    local backup_args=(backup --label pre-upgrade ${key_args[@]+"${key_args[@]}"})
    [ $encrypt = 1 ] && backup_args+=(--encrypt)
    if ! run_cli "${backup_args[@]}"; then
      red 'The backup failed, so nothing was upgraded.'
      [ $was_running = 1 ] && echo 'Start the server again with ./grc.sh start once the cause is fixed.'
      exit 1
    fi
    line="$(printf '%s\n' "$last_output" | grep '^Backed up to ' | head -n 1)"
    if [ -n "$line" ]; then backup_name="$(printf '%s' "${line#Backed up to }" | sed 's/[[:space:]]*$//')"; else backup_name="$(newest_backup)"; fi
  else
    echo 'No database yet: nothing to back up.'
  fi

  cyan '[3/7] New code'
  if [ $pull = 1 ]; then
    git pull --ff-only || stop_upgrade 'git pull' 0
  elif [ -n "$from" ]; then
    [ -e "$from" ] || stop_upgrade "finding the new release ($from does not exist)" 0
    source="$(cd "$(dirname "$from")" && pwd)/$(basename "$from")"
    unpacked=''
    if [ -f "$source" ]; then
      unpacked="$code_dir/incoming-$stamp"
      mkdir -p "$unpacked"
      case "$source" in
        *.zip) unzip -q "$source" -d "$unpacked" || stop_upgrade "unpacking $from (is unzip installed?)" 0 ;;
        *.tar.gz | *.tgz) tar -xzf "$source" -C "$unpacked" || stop_upgrade "unpacking $from" 0 ;;
        *.tar) tar -xf "$source" -C "$unpacked" || stop_upgrade "unpacking $from" 0 ;;
        *) stop_upgrade "unpacking $from (use a folder, .zip, .tar.gz or .tar)" 0 ;;
      esac
      source="$unpacked"
      if [ ! -f "$source/package.json" ] && [ "$(ls -1 "$unpacked" | wc -l | tr -d ' ')" = 1 ] && [ -d "$unpacked/$(ls -1 "$unpacked")" ]; then
        source="$unpacked/$(ls -1 "$unpacked")"
      fi
    fi
    applied="$(snapshot apply "$root" "$source")"
    local ok=$?
    [ -n "$unpacked" ] && rm -rf "$unpacked"
    [ $ok = 0 ] || stop_upgrade 'putting the new code in place' 0
    make_executable
    echo "Version $(printf '%s' "$applied" | json_get version) put in place ($(printf '%s' "$applied" | json_get written) file(s) written, $(printf '%s' "$applied" | json_get removed) removed)."
  else
    echo 'Already in place.'
  fi
  to_version="$(snapshot version "$root" | json_get version)"
  echo "Upgrading from version $from_version to $to_version"

  cyan '[4/7] Install packages'
  if [ $skip_install = 1 ]; then echo 'Skipped (--skip-install).'
  else npm install --no-fund --no-audit || stop_upgrade 'npm install' 0; fi

  cyan '[5/7] Build the web application'
  npm run build --silent || stop_upgrade 'build' 0

  cyan '[6/7] Database migrations'
  run_cli migrate || stop_upgrade 'database migrations (the failed migration was rolled back; earlier new ones stay applied)' 1

  cyan '[7/7] Start and health check'
  start_server || stop_upgrade 'start' 1
  health || stop_upgrade 'health check' 1
  run_cli status >/dev/null
  # This version is now the one to come back to.
  if snapshot save "$root" "$last_good" >/dev/null; then
    # Keep the three newest pre-upgrade copies (the names sort by time).
    local old=("$code_dir"/pre-upgrade-*.tar) n
    if [ -e "${old[0]}" ]; then
      for ((n = 0; n < ${#old[@]} - 3; n++)); do rm -f "${old[$n]}"; done
    fi
  fi
  green "Upgrade complete: version $from_version to $to_version."
  [ -n "$backup_name" ] && echo "The data as it was before the upgrade is in backup $backup_name."
  return 0
}

# --- commands -----------------------------------------------------------------------------------
case "$cmd" in
  help | -h | --help) usage; exit 0 ;;
  install)
    if node_problem >/dev/null; then
      echo "$(node_problem) Fetching Node.js $want_major into .tools/node..."
      "$root/tools/install-node.sh" || exit 1
      PATH="$root/.tools/node/bin:$PATH"
    fi
    require_node
    npm install --no-fund --no-audit || exit 1
    green "Installed. Next: ./grc.sh start   (or ./grc.sh seed --profile dev for sample data first)"
    exit 0 ;;
esac

require_node

case "$cmd" in
  start)
    start_server || exit 1
    # The first healthy start keeps a copy of the code, so a later upgrade can always come back to it.
    if [ ! -f "$code_dir/last-good.tar" ]; then
      node "$root/tools/code-snapshot.mjs" save "$root" "$code_dir/last-good.tar" >/dev/null 2>&1 &&
        echo "Kept a copy of this version's code in $code_dir/last-good.tar (used if an upgrade has to be rolled back)."
    fi
    ;;
  stop) stop_server ;;
  restart) stop_server; start_server || exit 1 ;;
  health)
    if health; then green "Healthy: $url"; else red 'Not responding.'; exit 1; fi ;;
  build) npm run build; exit $? ;;
  dev)
    stop_server
    echo "API on $url, web on http://127.0.0.1:5173 (Ctrl+C stops both)"
    trap 'trap - EXIT INT TERM; kill 0 2>/dev/null' EXIT INT TERM
    npm run server &
    npm run web
    ;;
  seed) run_offline seed --profile "$profile"; exit $? ;;
  test) npm test; exit $? ;;
  typecheck) npm run typecheck; exit $? ;;
  ci)
    # Local continuous integration: the checks to run before every commit or push.
    failed=''
    cyan '== Typecheck'; npm run --silent typecheck || failed="$failed, Typecheck"
    cyan '== Tests'; npm test || failed="$failed, Tests"
    cyan '== Tests on UTC'; TZ=UTC npm test || failed="$failed, Tests on UTC"
    cyan '== Web build'; npm run --silent build || failed="$failed, Web build"
    cyan '== Dependency audit'
    node "$tsx" server/src/cli.ts audit-deps
    case $? in
      0) ;;
      3) yellow 'Dependency audit skipped: the npm registry could not be reached.' ;;
      *) failed="$failed, Dependency audit" ;;
    esac
    if [ -n "$failed" ]; then red "CI FAILED: ${failed#, }"; exit 1; fi
    green 'CI passed: typecheck, tests, web build and dependency audit.'
    ;;

  status)
    server_pid >/dev/null   # clears a stale process file first
    run_cli status
    code=$?
    if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -F "$root/grc.sh backup" >/dev/null; then
      echo "Scheduler:      a cron entry runs $root/grc.sh backup (crontab -l shows it; results in $backup_dir/scheduled-backup.log)"
    else
      echo 'Scheduler:      no cron entry for this folder (systemd timers and launchd are not checked; the server takes its own daily backups: Administration > Backups)'
    fi
    exit $code ;;

  logs)
    # Anything printed before the server's own log started (a failed start) is in server.log.err.
    if [ -s "$log.err" ]; then cyan "--- $log.err (start-up errors)"; tail -n 20 "$log.err"; fi
    # The server's own log (data/logs/grc.log, rotated by size), shown readably.
    a=(logs --lines "$lines")
    [ -n "$level" ] && a+=(--level "$level")
    [ $follow = 1 ] && a+=(--follow)
    install_packages || exit 1
    node "$tsx" server/src/cli.ts "${a[@]}"; exit $? ;;
  version) run_cli version; exit $? ;;
  audit-deps) a=(audit-deps); [ -n "$level" ] && a+=(--level "$level"); run_cli "${a[@]}"; exit $? ;;
  service) service_cmd ;;

  backup)
    a=(backup --label "$label" ${key_args[@]+"${key_args[@]}"})
    [ "$prune" -gt 0 ] 2>/dev/null && a+=(--prune "$prune")
    [ $encrypt = 1 ] && a+=(--encrypt)
    [ $include_key = 1 ] && a+=(--include-secret-key)
    run_offline "${a[@]}"
    code=$?
    if [ "$label" = scheduled ]; then
      # One line per unattended run, so a failure can be found afterwards.
      mkdir -p "$backup_dir"
      printf '%s  exit %s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$code" "$(printf '%s' "$last_output" | tr '\n' '|' | sed 's/|/ | /g')" >>"$backup_dir/scheduled-backup.log"
    fi
    exit $code ;;
  backups) run_cli backups; exit $? ;;
  verify-backup) run_cli verify-backup "${first_rest:-latest}" ${key_args[@]+"${key_args[@]}"}; exit $? ;;
  restore)
    [ -n "$first_rest" ] || { red 'Say which backup: ./grc.sh restore <name|path|latest>   (list them with ./grc.sh backups)'; exit 1; }
    a=(restore "$first_rest" ${key_args[@]+"${key_args[@]}"})
    [ $force = 1 ] && a+=(--force)
    run_offline "${a[@]}"; exit $? ;;

  export-all)
    a=(export-all ${key_args[@]+"${key_args[@]}"})
    [ -n "$out" ] && a+=(--out "$out")
    [ $no_secrets = 1 ] && a+=(--no-secrets)
    [ $encrypt = 1 ] && a+=(--encrypt)
    run_offline "${a[@]}"; exit $? ;;
  import-all)
    [ -n "$first_rest" ] || { red 'Say which export: ./grc.sh import-all <folder or file>'; exit 1; }
    run_offline import-all "$first_rest" ${key_args[@]+"${key_args[@]}"}; exit $? ;;
  decrypt)
    [ -n "$first_rest" ] || { red 'Say which file: ./grc.sh decrypt <file> [--out file.tar]'; exit 1; }
    a=(decrypt "$first_rest" ${key_args[@]+"${key_args[@]}"})
    [ -n "$out" ] && a+=(--out "$out")
    run_cli "${a[@]}"; exit $? ;;
  new-key)
    [ -n "$first_rest" ] || { red 'Say where to write the key: ./grc.sh new-key <file outside the data folder>'; exit 1; }
    run_cli new-key "$first_rest"; exit $? ;;
  move-files)
    case "$to" in disk | s3) ;; *) red 'Say where to: ./grc.sh move-files --to s3   (or --to disk)'; exit 1 ;; esac
    run_offline move-files --to "$to"; exit $? ;;
  secret-key)
    # show: where the key comes from (fingerprint only); rotate: a new key, the old one kept as retired.
    what="${first_rest:-show}"
    case "$what" in show | rotate) ;; *) red 'Usage: ./grc.sh secret-key show | rotate'; exit 1 ;; esac
    install_packages || exit 1
    if [ "$what" = show ]; then node "$tsx" server/src/core/secretkey-cli.ts show; exit $?; fi
    # rotate needs the database to itself: stop the server, rotate, start it again.
    was_running=0
    server_pid >/dev/null && was_running=1
    [ $was_running = 1 ] && stop_server
    node "$tsx" server/src/core/secretkey-cli.ts rotate
    code=$?
    if [ $was_running = 1 ] && ! start_server no-build; then [ $code = 0 ] && code=1; fi
    exit $code ;;
  save-code)
    mkdir -p "$code_dir"
    if node "$root/tools/code-snapshot.mjs" save "$root" "$code_dir/last-good.tar"; then
      green "Saved the code as it is now to $code_dir/last-good.tar. upgrade returns to it if an upgrade fails."
    else exit 1; fi
    ;;
  schedule-backup) schedule_backup ;;
  unschedule-backup)
    echo 'Remove the schedule you added: the line in  crontab -e, or'
    echo '  systemctl --user disable --now grc-backup.timer  (then delete the two files), or'
    echo '  launchctl unload ~/Library/LaunchAgents/org.sandpiper-grc.backup.plist  (then delete it).'
    echo 'Existing backups are untouched.'
    ;;
  upgrade) upgrade ;;
  npm) npm "$@"; exit $? ;;
  *) usage; [ "$cmd" = help ] || exit 1 ;;
esac
