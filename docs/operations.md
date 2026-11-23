# Operations

The runbook for the prototype: start and stop ([Commands](#commands)), [health](#health-check),
[logs](#logs) and [where things live](#where-things-live), [backup](#backup) (also
[scheduled](#scheduled-backups) and [taken by the server](#backups-taken-by-the-server)),
[restore](#restore), [upgrade](#upgrading), and [what to do when the server will not
start](#the-server-will-not-start). On Windows everything goes through `grc.ps1`, run from the
repository root in Windows PowerShell; on macOS and Linux through `grc.sh`, which has the
same commands ([below](#macos-and-linux-grcsh)); in a container through `docker compose`
and the image's `grc` command ([Docker](#docker)). The examples in this runbook use
`grc.ps1`. For first-time installation see [Installation](installation.md).

## Commands

| Command | What it does |
|---|---|
| `.\grc.ps1 start` | Starts the server in the background. Does nothing if it is already running. Runs `npm install` if `node_modules\` is missing, rebuilds the web application if any file under `web\` or `docs\user\` is newer than the last build, then waits for the health check (about 30 seconds) |
| `.\grc.ps1 stop` | Asks the server to shut down cleanly and waits up to 30 seconds (the server itself gives up after 20, including the wait for a backup it is taking). Only if that fails does it end the process by force |
| `.\grc.ps1 restart` | `stop`, then `start` |
| `.\grc.ps1 health` | Calls `/api/health` (over HTTPS when `GRC_TLS_CERT` is set, accepting a self-signed certificate for this local check). Prints `Healthy` or `Not responding.` (exit code 1) |
| `.\grc.ps1 status` | Version, port, process, size of the data folder, last backup, pending migrations and the backup schedule. See [Status](#status) |
| `.\grc.ps1 logs [-Lines n] [-Follow] [-Level warn]` | Shows the end of the server log, readably (default 40 lines; `-Level` hides lines below that level). `-Follow` keeps showing new lines until Ctrl+C. See [Logs](#logs) |
| `.\grc.ps1 version` | The installed version and the commit it was built from |
| `.\grc.ps1 seed [-Profile pilot\|dev]` | Loads data (default profile `pilot`). See [Installation](installation.md#5-load-data) |
| `.\grc.ps1 backup [-Prune n] [-Label text] [-Encrypt [-IncludeSecretKey]]` | Makes a verified copy of the data in `backups\<yyyyMMdd-HHmmss>\`, or with `-Encrypt` one encrypted file `backups\<yyyyMMdd-HHmmss>.tar.sgrc`. `-Prune n` then deletes all but the newest `n` backups. `-Label` is recorded in the manifest as the reason (default `manual`). See [Backup](#backup) |
| `.\grc.ps1 backups` | Lists backups, newest first, with time, size, version, why each was taken and whether it is encrypted |
| `.\grc.ps1 verify-backup [<backup>]` | Checks every file of a backup against its checksums (default: the newest); an encrypted one is decrypted on the way, writing nothing |
| `.\grc.ps1 restore <backup> [-Force]` | Replaces the data with a backup (a folder, an encrypted file, or an archive the server took itself) after verifying it, keeping a safety copy of the current data. See [Restore](#restore) |
| `.\grc.ps1 schedule-backup [-At HH:mm] [-Prune n] [-Encrypt]` | Registers a daily stop-and-copy backup as a per-user Windows scheduled task. See [Scheduled backups](#scheduled-backups) |
| `.\grc.ps1 unschedule-backup` | Removes that task |
| `.\grc.ps1 export-all [-Out dir] [-NoSecrets] [-Encrypt]` | Writes every table as JSON Lines, plus attached files and a checksum report; `-Encrypt` writes one encrypted file instead. See [Export and import](#export-and-import) |
| `.\grc.ps1 import-all <dir or file>` | Loads an export (a folder, or an export file, encrypted or not) into an empty installation |
| `.\grc.ps1 decrypt <file> [-Out file.tar]` | Turns an encrypted backup or export into the plain tar file it holds, checking every part. See [Encrypted backups and exports](#encrypted-backups-and-exports) |
| `.\grc.ps1 new-key <file>` | Writes a new random key file for encrypted backups. Keep it outside the data folder |
| `.\grc.ps1 move-files -To s3` (or `-To disk`) | Moves every attached file to the object store (or back to the disk), checking each copy before deleting the original. Stops and restarts the server. An administrator can do the same while the application runs, as a background job, from File settings > Storage > **Move stored files** |
| `.\grc.ps1 upgrade [-From dir\|zip] [-Pull] [-SkipInstall] [-NoRollback]` | Backup, new code, `npm install`, build, migrations, restart, health check; if any step fails, puts the previous code, packages and data back and starts the previous version. See [Upgrading](#upgrading) |
| `.\grc.ps1 secret-key show` (or `rotate`) | Says where the secret key comes from (with a fingerprint, never the key) and whether retired keys are still needed; `rotate`, which stops the server first, writes a new key and keeps the old one as a retired key. Runs `server/src/core/secretkey-cli.ts`; see [Security](security.md) |
| `.\grc.ps1 save-code` | Keeps a copy of the code as it is now (`backups\code\last-good.tar`) for `upgrade` to return to. `start` makes one the first time it runs |
| `.\grc.ps1 dev` | Development mode: stops the background server, then runs the API with file watching on port 8080 and the Vite development server on http://127.0.0.1:5173 (which proxies `/api` to port 8080). Ctrl+C stops both |
| `.\grc.ps1 build` | Builds the web application into `dist\web\` and shows the full build output |
| `.\grc.ps1 test` | Runs the automated tests (Vitest) |
| `.\grc.ps1 typecheck` | Type-checks the server and the web application |
| `.\grc.ps1 ci` | Local continuous integration: typecheck, tests, tests with the clock on UTC, web build and the dependency audit, with a pass or fail summary. Run it before every commit and push |
| `.\grc.ps1 audit-deps [-Level high]` | Known vulnerabilities in the production packages (`npm audit`); fails only when a fixed version exists. See [Dependency vulnerabilities](#dependency-vulnerabilities) |
| `.\grc.ps1 npm <args>` | Runs any npm command with the portable Node.js, for example `.\grc.ps1 npm install` |
| `.\grc.ps1` or `.\grc.ps1 help` | Prints the list of commands |

`seed`, `backup`, `restore`, `export-all` and `import-all` need the database to
themselves. Each one stops a running server, does its work and starts the server again
(without rebuilding the web application). If the server was not running it is left
stopped.

The work of `status`, `backup`, `restore`, `export-all` and `import-all` is done by
`server/src/cli.ts` (the code is in `server/src/ops/`); `grc.ps1` and `grc.sh` only stop
and start the server around it. With the server stopped, the same commands also run
directly: `npm run cli -- status`, `npm run cli -- backup --prune 14`, and `npm run cli`
for the list.

### macOS and Linux: `grc.sh`

`./grc.sh` has every command of `grc.ps1` that makes sense off Windows, with the same
behavior. Options are written in either style: `--prune 14`, `--prune=14` or `-Prune 14`.
It uses Node.js from `.tools/node` (put there by `./tools/install-node.sh`) when present,
otherwise the `node` on `PATH`, and refuses a major version other than the one in
`tools/node-version.txt` (set `GRC_SKIP_NODE_CHECK=1` to try another anyway).

| Windows | macOS and Linux |
|---|---|
| `powershell -ExecutionPolicy Bypass -File .\tools\install-node.ps1` | `./tools/install-node.sh` |
| `.\grc.ps1 install` | `./grc.sh install` (also fetches Node.js when no suitable one is found) |
| `.\grc.ps1 start`, `stop`, `restart`, `health`, `status` | `./grc.sh start`, `stop`, `restart`, `health`, `status` |
| `.\grc.ps1 logs -Lines 100 -Follow -Level warn`, `version`, `audit-deps` | `./grc.sh logs --lines 100 --follow --level warn`, `version`, `audit-deps` |
| (a Windows service is not provided) | `./grc.sh service install`, `remove`, `status`, `print`: run the server as a systemd (Linux) or launchd (macOS) user service ([Running as a service](#running-as-a-service-on-linux-and-macos)) |
| `.\grc.ps1 seed -Profile dev` | `./grc.sh seed --profile dev` |
| `.\grc.ps1 backup -Prune 14 -Encrypt -KeyFile <file>` | `./grc.sh backup --prune 14 --encrypt --key-file <file>` |
| `.\grc.ps1 backups`, `verify-backup`, `restore latest -Force` | `./grc.sh backups`, `verify-backup`, `restore latest --force` |
| `.\grc.ps1 export-all -Out <dir> -NoSecrets`, `import-all <dir>` | `./grc.sh export-all --out <dir> --no-secrets`, `import-all <dir>` |
| `.\grc.ps1 decrypt <file> -Out <tar>`, `new-key <file>`, `move-files -To s3` | `./grc.sh decrypt <file> --out <tar>`, `new-key <file>`, `move-files --to s3` |
| `.\grc.ps1 secret-key show`, `secret-key rotate` | `./grc.sh secret-key show`, `secret-key rotate` |
| `.\grc.ps1 upgrade -From <zip> -SkipInstall -NoRollback`, `-Pull`, `save-code` | `./grc.sh upgrade --from <folder, .zip or .tar.gz> --skip-install --no-rollback`, `--pull`, `save-code` |
| `.\grc.ps1 schedule-backup -At 02:30 -Prune 14` (a Windows scheduled task) | `./grc.sh schedule-backup --at 02:30 --prune 14` prints a cron line, a systemd user timer and a launchd agent to add; `unschedule-backup` says how to remove them ([Scheduled backups](#scheduled-backups)) |
| `.\grc.ps1 dev`, `build`, `test`, `typecheck`, `ci` | `./grc.sh dev`, `build`, `test`, `typecheck`, `ci` (`ci` includes the pass with the clock on UTC) |
| `.\grc.ps1 npm <args>` | `./grc.sh npm <args>` |

Differences: `start` runs the server in the background with `nohup` (or, once `service
install` has been run, starts the service), with its start-up output in
`data/server.log` and `data/server.log.err`; `stop` asks for a clean shutdown the same way
and sends a terminate signal if that does not work within 30 seconds; `status` reports a
cron entry for this folder (it does not look at systemd or launchd); and `upgrade --from`
also takes a `.tar.gz`. On a server run by systemd (`deploy/systemd/`), use `systemctl
start|stop|status sandpiper-grc` and `journalctl -u sandpiper-grc` instead of `start`, `stop`
and `logs`, and stop the service before `seed`, `backup`, `restore` or `import-all` (they then
leave it stopped, and you start it again with `systemctl`).

### Docker

In a container, `docker compose` replaces `start`, `stop` and `logs`, and the image's `grc`
command runs the operations commands of `server/src/cli.ts`. Commands that need the database
to itself run in a one-off container with the application stopped. Full details in
[Docker](docker.md).

| Task | Command |
|---|---|
| Start, stop, restart | `docker compose up -d`, `docker compose stop`, `docker compose restart app` |
| Health and status | `docker compose ps` (health), `docker compose exec app grc status` |
| Logs | `docker compose logs -f app` (one JSON line per entry), or `docker compose exec app grc logs --lines 100` (the rotating file in the data volume, shown readably) |
| Version | `docker compose exec app grc version` |
| Renewed TLS certificate | Picked up by itself within `GRC_TLS_RELOAD_SECONDS`, or at once with `docker compose kill -s HUP app` |
| Sample data | `docker compose stop app && docker compose run --rm app grc seed --profile dev && docker compose start app` |
| Backup | `docker compose stop app && docker compose run --rm app grc backup --prune 14 && docker compose start app` |
| List, verify, restore | `docker compose exec app grc backups`; `... run --rm app grc verify-backup`; `... run --rm app grc restore latest` (stopped) |
| Copy backups or the key off the host | `docker compose cp app:/var/lib/sandpiper/backups ./grc-backups`, `docker compose cp app:/var/lib/sandpiper-key/secret.key ./sandpiper-secret.key` |
| Export and import | `docker compose run --rm app grc export-all --out /var/lib/sandpiper/backups/export`, `... grc import-all <path in the volume>` (stopped) |
| Upgrade | `docker compose pull && docker compose up -d` (take a backup first) |
| Secret key | `docker compose exec app grc secret-key show`; `rotate` with the application stopped |

## Where things live

| Path | Contents |
|---|---|
| `data\pg\` | The database (embedded PostgreSQL files) |
| `data\files\` | Files attached to records |
| `data\grc.pid` | Process id of the running server. Written at start, removed at clean shutdown |
| `data\grc.lock` | Held by the one process using the data folder (the server, or a command such as `seed` or `restore`): its process id, machine name and start time. Taken before the database is opened, removed when the process ends, never copied into a backup |
| `data\grc.stop` | Created briefly by `stop` to request a clean shutdown |
| `data\logs\grc.log` | The server's own log: one JSON line per entry (requests, warnings, errors), rotated by size into `grc.log.1` ... `grc.log.5`. See [Logs](#logs) |
| `data\server.log` | Console output of a server started by `grc.ps1`/`grc.sh`: the start-up line |
| `data\server.log.err` | Console errors: anything printed before the log file is open (a refused start) and every warning and error |
| `backups\<timestamp>\` | One backup: `manifest.json` and a `data\` folder holding the copy |
| `backups\<timestamp>-pre-restore\` | The safety copy `restore` takes of the data it is about to replace |
| `backups\export-<timestamp>\` | Where `export-all` writes when no `-Out` folder is given |
| `backups\scheduled-backup.log` | One line per scheduled backup run |
| `backups\<timestamp>.tar.sgrc` | An encrypted backup (one file) |
| `backups\code\` | Copies of the code for `upgrade` to return to (`last-good.tar`, `pre-upgrade-<timestamp>.tar`) and the copy of `code-snapshot.mjs` it runs |
| `data\backup-status.json` | What the server last recorded about its own daily backups, for `status` |
| `data.secret.key` (beside `data\`) | The secret key; not in backups |
| `dist\web\` | The built web application served by the server |
| `seed\` | Private import files (see Installation) |

Notes:

- `server.log` and `server.log.err` are **overwritten at every start**; the server's own
  log in `data\logs\` is not: the previous run's log is kept as `grc.log.1`.
- The request log says which address asked for what and how it went; the record of who did
  what is the audit log inside the application (Administration, Audit log). The two are
  joined by the request identifier.
- `data\logs\` is left out of backups and restores.
- `GRC_DATA_DIR` moves the database, files, pid file and logs to another folder.
  `GRC_BACKUP_DIR` moves the backups, for example to another disk. Set them the same way
  for every command (see [Installation](installation.md#environment-variables)).
- In `dev` mode the API writes to the console, not to the log files.

## Status

```powershell
.\grc.ps1 status
```

```
Version:        0.1.0 (Node.js v24.11.0)
Server:         running and healthy (process 5124)
Address:        http://127.0.0.1:8080 (port 8080)
Data folder:    C:\grc\data (61.0 MB)
Database:       embedded, in C:\grc\data\pg
Secret key:     C:\grc\data.secret.key (outside the data folder, not in backups: back it up separately)
Last backup:    20300131-020000, 7 hour(s) ago, 61.0 MB (scheduled), encrypted
Backups:        14 in C:\grc\backups
Server backups: daily at 03:30 (Europe/London), keeping 14 to \\fileserver\backups\grc, encrypted; last good sandpiper-backup-20300131-033000.tar.sgrc, 7 hour(s) ago
Migrations:     18 in the code; applied when the server started; none changed since
Windows task:   none (the server takes its own daily backups: Administration > Backups)
```

- **Server backups** is what the server recorded about its own daily backups
  ([Backups taken by the server](#backups-taken-by-the-server)): the schedule, the
  destination, the last good one, `OVERDUE` when that is more than two days old, and
  `LAST RUN FAILED` with the reason. The server writes it to `data\backup-status.json`, so
  it is shown even while the database is in use.
- **Database** says `embedded` or names the PostgreSQL server (without its password).
- **Secret key** says where the key that protects authenticator keys and webhook secrets
  is, and reminds you that backups do not contain it.

- **Server** is `stopped`, `running and healthy`, or `running but NOT answering the health
  check` (the process exists but the address does not respond: look at the logs).
- **Migrations**. While the server is stopped the database is opened and compared with the
  migration files in the code: `none pending`, or the names that will run at the next
  start. While the server is running the database cannot be opened by a second process;
  the server applied everything when it started, so the line reports only whether any
  migration file has changed since then (which means: restart, or better, `upgrade`).
  A checksum of every migration is recorded when it is applied. When an applied
  migration's file no longer matches (someone edited a migration after it ran), `status`
  adds `WARNING: ... applied migration file(s) EDITED since they were applied` and the
  server writes the same warning to its log at start. The edit is never applied: put the
  change in a new migration ([Developer guide](development.md#migrations)).
- **Windows task** shows the scheduled backup task, if there is one, when it runs next and
  whether its last run succeeded.
- `npm run cli -- status --json` prints the same facts as JSON for a monitoring script.

## Integrations at run time

These run inside the server as background jobs (Administration > Background jobs); each is off
until an administrator switches its connection on.

| Job | When | What it does |
|---|---|---|
| `integrations.audit_forward` | Every minute (its own lane, `integrations`) | Sends new audit events to each active log forwarder, in batches of up to 500; backs off when the collector cannot be reached |
| `integrations.housekeeping` | Daily | Removes forwarders' delivery log rows older than `retention.audit_forward_log_days` (30) |
| `feeds.tracker_push` | Every minute, and at once when a record is sent | Sends queued records to the outside work tracker |
| `attachments.evidence_reminders` | Daily | Evidence expiry reminders, and reminders to check linked documents (`attachments.link_check_days`) |
| `tags.lookup_housekeeping` | Daily | Removes asset tag lookups (the "Last seen" log) older than `retention.tag_lookups_days` (90); runs only while Asset tags is on |

Audit events already forwarded are not recalled at the end of a retention period or when a
record is anonymized: agree the collector's own retention with whoever runs it.

## Health check

```powershell
.\grc.ps1 health
```

Or request `http://127.0.0.1:8080/api/health` directly; a healthy server answers
`{"ok":true}` without sign-in. That is **liveness**: the process is up and answering. It
does not touch the database, so it stays cheap for frequent checks.

`/api/ready` is **readiness**: it also asks the database for one row and answers
`{"ok":true,"database":"ok"}`, or **503** with `"database":"timeout"` (no answer within 2
seconds: a PostgreSQL server that is down or unreachable, or the embedded database held by
one long piece of work) or `"database":"error"`. The cause goes to the server log
(`[ready] the database is not ready: ...`, once per change), never into the answer. Neither
needs sign-in, and neither is written to the log when it succeeds.

On a server installation use the address the server listens on (`https://...` when it has
a certificate). The container image checks `/api/ready` every 30 seconds with
`node deploy/healthcheck.mjs`, which follows `GRC_PORT` and `GRC_TLS_CERT`; `docker ps`
shows the result, so a container whose database is gone turns **unhealthy**. Behind a load
balancer, use `/api/ready` to decide where to send people and `/api/health` to decide
whether to restart the process. During a long online backup on the embedded database,
`/api/ready` can answer 503 for a while; that is expected and passes.

## Logs

The server keeps its own log, `data\logs\grc.log` (or the folder in `GRC_LOG_DIR`):
one JSON object per line, so it can be searched or sent to a log collector.

```powershell
.\grc.ps1 logs                      # the last 40 entries, readably
.\grc.ps1 logs -Lines 200 -Level warn
.\grc.ps1 logs -Follow              # keep showing new entries (Ctrl+C stops)
```

```
2030-01-31T09:12:44.120Z  INFO  Sandpiper GRC 0.1.0 (3f2a9c1d0b7e) running at http://127.0.0.1:8080  (embedded database; ...)
2030-01-31T09:12:51.903Z  200  GET    /api/tickets  18.4 ms  127.0.0.1  id 6c1f0e7a-...
2030-01-31T09:13:02.551Z  500  POST   /api/changes  41.2 ms  127.0.0.1  id 0b9d2e44-...
2030-01-31T09:13:02.552Z  ERROR [error] POST /api/changes: ...
```

- **One line per request** to the API: time, status, method, path, duration, the client's
  address (the real one behind a trusted proxy) and the **request identifier**. The same
  identifier is sent back to the browser as `X-Request-Id` and recorded on audit events as
  `request_id`, so a complaint ("it failed at 09:13"), its log line and its audit event can
  be matched. Pages and scripts of the web application and the health check are not logged
  unless they fail (or `GRC_LOG_LEVEL=debug`).
- **Nothing secret is written.** A request line has the path only, never the query string
  (which can hold search words or one-time codes) or the body, and the path itself loses any
  secret it carries: the token of a vendor response link (`/vendor-response/***`) and any
  other segment of 32 or more letters and digits that is not a record id. A path in an error
  message is treated the same way, with the values of its query string masked. Every message passes through
  a filter that masks passwords, tokens, `Bearer` and `grc_pat_` values, codes, cookies
  and the password in a connection string. Restricted record content is never logged: the
  server logs addresses and identifiers, not records.
- **Rotation.** At every start the previous run's file becomes `grc.log.1`; while running,
  the file is rotated when it passes `GRC_LOG_MAX_MB` (default 10). `GRC_LOG_FILES`
  (default 5) old files are kept, so the log never takes more than about 60 MB.
- **Settings** (environment): `GRC_LOG_LEVEL` (`error`, `warn`, `info` (default),
  `debug`), `GRC_LOG_DIR` (`off` writes no file), `GRC_LOG_MAX_MB`, `GRC_LOG_FILES`,
  `GRC_LOG_REQUESTS=off` (no request lines), and `GRC_LOG_CONSOLE`: `text` (default:
  the start-up line, warnings and errors on the console), `json` (every entry on the
  console as JSON; the container image uses it, so `docker logs` has everything) or `off`.
- `data\server.log.err` still matters when the server **does not start** at all (a
  setting it refuses, a port in use): `logs` shows its end first when it is not empty.

## Fonts for PDF exports

PDF exports and fact sheets print Western European text with the standard PDF fonts. For
anything else (Greek, Cyrillic, Hebrew, Arabic, Chinese, Japanese, Korean, Indic scripts,
symbols) the server embeds a font the machine already has, only the characters used. When
`GRC_PDF_FONTS` is not set it looks for well-known system fonts: Noto and DejaVu (Linux),
Arial Unicode (macOS), and Segoe UI, Arial, Microsoft YaHei, Yu Gothic, Malgun Gothic and
Nirmala UI (Windows). The container image installs Noto (`fonts-noto-core` and
`fonts-noto-cjk`), so it prints every common script.

`GRC_PDF_FONTS` names the font files to use instead, in order of preference, separated by
`;` on Windows and `:` elsewhere. A collection (`.ttc`) picks one font with `#` and its
PostScript name, for example `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc#NotoSansCJKjp-Regular`.
`GRC_PDF_FONTS=none` switches embedding off (characters outside Western European are then
left out). A file that cannot be read is skipped with a warning in the log.

Text that mixes scripts is printed piece by piece, each piece in the first listed font that
has it, so it helps to list one broad font first and fonts for particular scripts (Chinese,
Japanese, Korean, Arabic, Hebrew, Indic) after it. Right-to-left text is put in reading
order by the server itself (the essentials of the Unicode bidirectional algorithm, in
`server/src/core/export/fonts.ts`); no extra package or setting is needed.

## Running as a service on Linux and macOS

`./grc.sh service install` runs the server as a **user service** of the account you are
signed in as, with no administrator rights: a systemd user unit on Linux
(`~/.config/systemd/user/sandpiper-grc.service`) or a launchd agent on macOS
(`~/Library/LaunchAgents/org.sandpiper-grc.server.plist`). It writes the `GRC_*` settings
in force at that moment into the file (never a password, passphrase or key given directly:
it says which it left out; use the `*_FILE` settings for those), starts the service and
waits for the health check.

- The service starts at sign-in and is restarted after a crash. On Linux,
  `loginctl enable-linger <you>` makes it start at boot without anyone signed in.
- `./grc.sh start`, `stop`, `restart` and the commands that stop the server around their
  work (`backup`, `seed`, `restore`, `upgrade`) keep working: `stop` asks for a clean
  shutdown, which the service manager does not undo, and `start` starts the service
  rather than a second copy.
- `./grc.sh service status` shows its state; `service print` shows the file without
  installing anything; `service remove` stops it and deletes the file (the data is
  untouched). `GRC_SERVICE_NAME` installs a second copy under another name.
- For a server run by its own system account, use the system examples instead:
  `deploy/systemd/sandpiper-grc.service` (Linux; `systemctl reload sandpiper-grc` loads a
  renewed certificate) and `deploy/launchd/org.sandpiper-grc.server.plist` (macOS), each
  with a daily backup (`sandpiper-grc-backup.timer`, `org.sandpiper-grc.backup.plist`). See
  [Installation](installation.md#server-installation).

Continuous integration checks the unit with `systemd-analyze verify` and the property
lists with `plutil -lint`, and then runs the user service for real on GitHub's Linux runner
(systemd, after `loginctl enable-linger`, since the runner has no sign-in session) and macOS
runner (launchd): `service install` and the health check, `./grc.sh restart` (a new process
through the service manager), `backup` and `status` under the service, a crash (the server
process is killed and the service manager starts it again), `./grc.sh stop` (not restarted)
and `service remove` (E16-35). A restart of the machine, and the system examples in `deploy/`,
are not part of that run (E16-42).

**Checked across a restart (E16-42, 2026-11-22), in a stand-in for a Linux server.** A
container built from the official `debian:12` image with Debian's own `systemd` package as
process 1 (2 processors, 3 GB) was set up exactly as [Installation, "Linux"](installation.md#linux)
says, with both ways installed at once: the system service from `deploy/systemd/` (the
application in `/opt/sandpiper-grc` owned by root, `install-node.sh`, `grc.sh install` and
`build` as root, the `sandpiper` system account, `/etc/sandpiper-grc/env`, the two units and
the timer copied and enabled) and, for an ordinary account, `loginctl enable-linger` and
`./grc.sh service install` on another port. The container was then restarted and nobody
signed in. Afterwards: no sign-in session existed (`loginctl list-sessions` was empty), the
account was `lingering`, and its user service was active and answered its health check; the
system service was active and healthy and the backup timer was waiting for 02:30.
`systemctl start sandpiper-grc-backup.service` stopped the service, took a verified backup
labeled `scheduled` into `/var/lib/sandpiper-grc/backups`, wrote `scheduled-backup.log` and
started the service again (a new process, healthy); with a drop-in moving the timer to the next
minute the timer itself ran the backup service, which finished with `success` and left the
server healthy; `grc.sh verify-backup` and `grc.sh status` as the `sandpiper` account, and
`grc.sh logs` through `sudo -u sandpiper`, worked as the comments in the unit say. Nothing in
`deploy/systemd/` or these steps needed changing. What this does **not** prove: a container
restart is not a restart of a machine (the kernel, firmware, disks and network coming up are
not exercised), and macOS (`deploy/launchd/`, and the launchd agent at sign-in after a
restart) has not been run on a real Mac beyond the user agent in continuous integration.

On a Linux machine with no sign-in session of your own (a
server reached only over SSH, for example), run `loginctl enable-linger <you>` before
`service install`, or use the system examples above.

## Clean shutdown, and why it matters

The database is embedded: it runs inside the server process and keeps its files in
`data\pg`. Two consequences follow.

- **Always stop with `.\grc.ps1 stop`.** A clean shutdown closes the database and flushes
  it to disk. Ending the process from Task Manager, or switching the machine off, skips
  that step and risks losing recent changes or damaging the database files.
- **Never run two processes on one data folder.** The embedded database allows one process
  at a time. The command-line tasks are a second process, so the server must be stopped
  while they run. `grc.ps1` handles this for you. Whatever starts them, the server and the
  commands that open the database take `data\grc.lock` first, before the database is
  opened or migrated, and a second one stops at once with `A server (process ...) is using
  this data folder`. That covers a second server started by hand beside a service, and a
  `docker compose run` beside the running container (the lock works across containers that
  share the volume).

Windows has no terminate signal for background processes, so `stop` works by creating
`data\grc.stop`. The server checks for that file twice a second and shuts down when it
appears.

Users are interrupted during `seed`, `backup`, `restore`, `export-all`, `upgrade` and
`restart`. Their sessions survive (they are stored in the database), but requests fail
while the server is down. A backup of a few tens of megabytes takes a few seconds.

## Backup

```powershell
.\grc.ps1 backup              # keep every backup
.\grc.ps1 backup -Prune 14    # then delete all but the newest 14
```

A backup is a folder, `backups\<yyyyMMdd-HHmmss>\`, holding:

- `data\`: a copy of everything in the data folder (the database in `pg\` and attached
  files in `files\`) except the pid file and the logs.
- `manifest.json`: the application version, the time, why the backup was taken (`manual`,
  `scheduled`, `pre-upgrade` or `pre-restore`), the list of database migrations that had
  been applied, every folder, and every file with its size and SHA-256 checksum.

How it is made trustworthy:

- The server is stopped for the copy, so the database files are consistent.
- After copying, every file in the copy is read back and compared with the checksum taken
  from the original. A copy that does not match is deleted and the command fails.
- The backup is written under a temporary name (`<timestamp>.partial`) and renamed only
  when complete and verified. A folder with a plain timestamp name is always a whole
  backup; a `.partial` folder is the remains of an interrupted run and can be deleted.
- `.\grc.ps1 verify-backup <backup>` repeats the check at any time, for example after
  copying a backup to another disk and back.

Things to know:

- `-Prune n` counts every complete backup, including safety copies and pre-upgrade
  backups, and deletes the oldest beyond `n`. It never touches a folder that has no
  `manifest.json` (exports, copies made by hand, backups made by an older version of this
  script).
- A plain backup is **not encrypted**. It contains everything in the application,
  including password hashes and second-factor secrets. Use `-Encrypt` for anything that
  leaves the machine ([Encrypted backups and exports](#encrypted-backups-and-exports)).
- **The secret key is not in backups.** Authenticator keys and webhook secrets are
  encrypted in the database with the secret key, which is kept **beside** the data folder
  (`data.secret.key` next to `data\`), or comes from `GRC_SECRET_KEY` /
  `GRC_SECRET_KEY_FILE` (see [Security](security.md)). `backup`, `restore` and `status`
  say where it is. Keep your own copy of that file somewhere safe and separate: a restored
  database cannot use second-factor sign-in or webhook secrets without the key it was
  written with. To restore on another machine or into a differently named folder, put the key file
  beside the restored data folder under that folder's name (`<data folder>.secret.key`), or
  set `GRC_SECRET_KEY` (or `GRC_SECRET_KEY_FILE`); `restore` refuses until the key the
  backup was made with is there ([Restore](#restore)). The data folder, backups and exports
  are created readable by their owner only (`0700` folders, `0600` files on macOS and Linux).
- If you would rather the key traveled with the data, `-Encrypt -IncludeSecretKey`
  puts it **inside the encrypted file** (never in a plain backup). A restore then puts it in
  place: where there is no key file yet it is written there; where a different key is in
  use it is added to `<key file>.previous`, so values written with it are re-encrypted with
  the current key at the next start.
- By default `backups\` is on the same disk as the data. Set `GRC_BACKUP_DIR` to a folder
  on another disk, or copy backups elsewhere as well, and run `verify-backup` on a copy
  now and then.
- The checksums detect damage and incomplete copies. They are not a defense against
  someone who can rewrite both the files and the manifest.
- The private `seed\` folder is not included.
- Files kept in an S3-compatible object store (Administration > File settings > Storage)
  are not in any backup: only files on the local disk are. Protect the bucket with the
  store's own versioning or replication, or move the files back with
  `.\grc.ps1 move-files -To disk` before a backup you need to be complete.

### Encrypted backups and exports

```powershell
.\grc.ps1 new-key D:\keys\grc-backup.key          # once; keep a copy somewhere safe
$env:GRC_BACKUP_KEY_FILE = 'D:\keys\grc-backup.key'
.\grc.ps1 backup -Encrypt                         # backups\<timestamp>.tar.sgrc
.\grc.ps1 export-all -Encrypt                     # backups\export-<timestamp>.tar.sgrc
.\grc.ps1 verify-backup latest                    # decrypts and checks, writes nothing
.\grc.ps1 restore latest
.\grc.ps1 decrypt backups\20300131-020000.tar.sgrc   # the plain tar file, for any tar tool
```

The key is a file of 32 random bytes (`new-key` writes one as 64 hex characters), or a
passphrase of at least 12 characters. Give it with `-KeyFile <file>` or
`-PassphraseFile <file>`, or in the environment as `GRC_BACKUP_KEY_FILE`,
`GRC_BACKUP_PASSPHRASE_FILE` or `GRC_BACKUP_PASSPHRASE`. A key file inside the data folder
is refused, because it would be copied with the data it protects. **Without the key an
encrypted backup cannot be read by anyone, including you**: keep a copy of it apart from
the backups.

- An encrypted backup is written straight from the data folder into one file; nothing
  unencrypted is written on the way, and the file is decrypted and checked against the
  manifest before the command reports success. (An encrypted export is written to a
  working folder beside the output first, then packed and the folder deleted.)
- `restore`, `verify-backup` and `import-all` recognize an encrypted file and ask for the
  key; the safety copy `restore` keeps is encrypted with the same key.
- `backups` lists encrypted backups (their name, time, size and version are readable
  without the key) and `-Prune` counts them.
- `schedule-backup -Encrypt -KeyFile <file>` (or `-PassphraseFile`) makes the Windows task
  encrypt too. A passphrase typed into the environment is not copied into the task.

**The file format** (also in `server/src/ops/archive.ts`). An encrypted file is a POSIX
"ustar" tar stream (the same content as a backup folder or export folder, with an extra
first entry `archive.json` that says what it is) sealed with AES-256-GCM in chunks:

| Bytes | Content |
|---|---|
| 0-7 | `SGRCENC1` |
| 8-11 | Length H of the header, unsigned 32-bit big-endian |
| next H | Header, UTF-8 JSON: `kdf` (`scrypt` for a passphrase, `key` for a key file), `salt` (16 bytes, base64), `N`, `r`, `p` (scrypt cost; 32768, 8, 1), `nonce` (7 random bytes, base64), `chunkSize` (65536) and `info` (name, kind, time, version, size: readable without the key) |
| then, repeated | Ciphertext length L (32-bit big-endian), L bytes of ciphertext, 16-byte GCM tag |

The 256-bit key is scrypt(passphrase, salt) or HKDF-SHA256(key file, salt,
"sandpiper-grc archive v1"). Chunk *i* (from 0) is sealed with the nonce
`<7-byte prefix><i, 32-bit big-endian><1 for the last chunk, else 0>`, and the magic, length
and header bytes are authenticated with every chunk. Every chunk is checked before its
content is used, so a wrong key, an altered byte, a changed header, reordered chunks and a
file cut short (its last chunk missing) are all refused.

### Backups taken by the server

The server can take its own backup every day, while it keeps running, and write it to a
second location: another folder (another disk, or a network share such as
`\\fileserver\backups\grc`) or the S3-compatible object store. An administrator sets it up
under **Administration > Backups** (schedule, destination, how many to keep, encryption);
see the user guide's *Backups* section. It is off until switched on, and needs nobody to be
signed in to Windows.

How it works:

1. At the chosen time (default 03:30, an hour and a half after the stop-and-copy task's
   default, so the two do not meet; checked every five minutes; a time missed while the
   server was down is caught up when it starts) the server exports every table from **one
   snapshot** of the database, so the copy is consistent even while people keep saving: no
   row twice or missing, and every table as of the same moment. On a PostgreSQL server the
   export is one `repeatable read, read only` transaction, which nobody waits for. The
   embedded database runs one transaction at a time, so there the snapshot is taken in a
   short transaction and the rows are then read a page at a time, with requests answered in
   between. Requests wait only while the snapshot is taken: measured at scale 1 (about
   66,000 rows, a 287 MB data folder) on a laptop, the longest wait was 0.7 to 1.0
   seconds in a backup of 5.7 to 6.6 seconds (before this change the whole export was one
   transaction, and requests waited up to 5.7 to 6.0 seconds of a 7.0 to 7.3 second backup;
   on a busy machine 13.7 of 16 seconds). The wait grows with the number of rows: expect
   roughly a second per 65,000 rows, more on a busy machine. Each table file is written as its rows
   arrive, so the size of a table is not limited by memory. Attached files on the local disk
   are copied afterward, outside the snapshot.
2. The export is packed into one file, `sandpiper-backup-<yyyyMMdd-HHmmss>.tar`, or
   `.tar.sgrc` when **Encrypt each backup** is on (the server must be started with
   `GRC_BACKUP_KEY_FILE`, `GRC_BACKUP_PASSPHRASE_FILE` or `GRC_BACKUP_PASSPHRASE`). It is
   made in `backups\.work-<process>\` and deleted from there afterward.
3. It is written to the destination, **read back from there**, decrypted if need be, and
   every table and file is checked against the manifest inside it. A copy that does not
   match is deleted and the run fails.
4. Older `sandpiper-backup-*` files at the destination beyond the number to keep are
   deleted. Nothing else there is touched.

Each run is recorded (Administration > Backups shows the last 20) and audited
(`backup.run`, `backup.failed`). A failed run, and no good backup for two days, notify
every administrator (when the notifications module is loaded). `grc.ps1 status` shows the
last result from `data\backup-status.json`.

Restore one with `.\grc.ps1 restore <file>` (download it from the object store first, for
example with the provider's command-line tool). It is a logical backup, so the restore
keeps a safety copy of the current data, empties the data folder, creates a new database
with **the migrations the backup was made with** (its manifest lists them), loads the export
into it, and only then applies the migrations that are newer than the backup, so a migration
that changes existing data also runs on the restored rows (the command names them). The
backup must not come from newer code. Everything else is as described under
[Restore](#restore). On a PostgreSQL server, load it with `import-all <file>` into an empty
database instead.

**On macOS, Linux and in containers** the server's own daily backup works the same. For a
stop-and-copy backup on a schedule, see [Scheduled backups](#scheduled-backups).

### Scheduled backups

```powershell
.\grc.ps1 schedule-backup -At 02:00 -Prune 14
.\grc.ps1 status                 # shows the task, its next run and its last result
.\grc.ps1 unschedule-backup
```

`schedule-backup` registers a Windows scheduled task named
`Sandpiper GRC backup (<repository folder name>)` for the current user. It needs no
administrator rights.

- It runs `grc.ps1 backup -Label scheduled` (with `-Prune n` if you gave one) every day at
  the time given (24-hour clock, default `02:00`). Without `-Prune` every backup is kept.
  It stops the server for the copy, so keep it apart from the server's own daily backup
  (default 03:30): a stop during a server backup cuts that backup short.
- It runs **only while you are signed in to Windows** (a task that runs when nobody is
  signed in needs a stored password or administrator rights). If the machine was off or
  you were signed out at the time, it runs at the next opportunity.
- The server is stopped for a few seconds during the backup and started again.
- The `GRC_*` environment variables set in the window where you run `schedule-backup` are
  written into the task, so it uses the same data folder, backup folder and port. If you
  change them, or move the repository, run `schedule-backup` again (it replaces the task).
- Each run appends one line to `backups\scheduled-backup.log`: the time, the exit code
  (`0` is success) and what the backup reported. Nothing alerts you when a run of this
  task fails: look at `.\grc.ps1 status`, which shows the last result and the age of the
  last backup. The server's own backups ([above](#backups-taken-by-the-server)) do alert
  administrators, and need nobody signed in; the task remains useful for a full
  stop-and-copy of the database files.
- Continuous integration registers the task on a clean Windows runner, runs it once with
  `Start-ScheduledTask`, checks for the backup labeled `scheduled`, the `exit 0` line in
  `scheduled-backup.log` and a healthy server afterwards, and removes it (job "Install and run
  with grc.ps1").

**macOS and Linux.** `./grc.sh schedule-backup --at 02:30 --prune 14` changes nothing on the
system: it prints, with this folder's paths and the `GRC_*` settings in force written in,
a cron line, a systemd user service and timer (Linux) and a launchd agent (macOS). Add one
of them as the user that runs the server. Each run calls `grc.sh backup --label scheduled`,
which stops the server for a few seconds, takes a verified backup, starts the server again
and adds a line to `backups/scheduled-backup.log`; `./grc.sh status` reports a cron entry
for this folder. For example, with cron:

```
30 2 * * * /opt/sandpiper-grc/grc.sh backup --label scheduled --prune 14 >/dev/null 2>&1
```

With `--encrypt` it needs `--key-file` or `--passphrase-file` (a passphrase is never written
into a schedule). For the systemd service in `deploy/systemd/`, use
`sandpiper-grc-backup.service` and `.timer` from the same folder instead: they stop the
service with `systemctl`, run the backup as the service's user and start it again;
`systemctl list-timers` and `journalctl -u sandpiper-grc-backup` show when it ran and what
it said.

**Docker.** Schedule the three commands on the host, for example with cron:

```
30 2 * * * cd /opt/sandpiper-grc && docker compose stop app && docker compose run --rm app grc backup --label scheduled --prune 14; docker compose start app
```

and copy `/var/lib/sandpiper/backups` off the machine ([Docker](docker.md#volumes-and-backups)).

### PostgreSQL server backups

With `GRC_DATABASE_URL` set ([Installation](installation.md#postgresql-server)) the records
live on the database server, not in the data folder. `backup` and `restore` copy the
embedded database only, so in this mode they **refuse** with a message pointing here, and
`status` names the database server and reads its migrations while the application runs.
The server's own daily backups ([Backups taken by the server](#backups-taken-by-the-server))
and `export-all` do work against a server. For a full copy, back up the two parts with
their own tools, at the same time:

```sh
# The database: a consistent snapshot while the application keeps running
pg_dump --format=custom --no-owner --file=grc-$(date +%Y%m%d-%H%M%S).dump "postgres://grc@db.example.internal/grc"
# The files: the data folder (or the container volume), with the server running or stopped
tar -czf grc-files-$(date +%Y%m%d-%H%M%S).tar.gz -C /var/lib/sandpiper data
```

- `pg_dump` takes a consistent copy without stopping anyone; its major version must be the
  server's or newer. Run it from cron or a systemd timer, keep several days, and copy the
  files to another machine.
- Files are added rather than changed, so a copy taken a little after the dump holds every
  file the dump refers to. A file attached between the two is in the copy but not in the
  database, which is harmless.
- **Restore**: stop the application, restore the files, then load the dump into an empty
  database owned by the application's role, and start:

  ```sh
  dropdb grc && createdb --owner=grc --template=template0 grc
  pg_restore --no-owner --role=grc --dbname=grc grc-20260101-020000.dump
  ```

  The append-only audit log has a trigger that refuses updates and deletes; `pg_restore`
  only inserts, so it is not affected.
- In the container setup: `docker compose exec db pg_dump -U grc --format=custom grc > grc.dump`,
  and the files with `docker run --rm -v sandpiper-grc_grc-data:/v:ro -v "$PWD":/out busybox tar -czf /out/grc-files.tar.gz -C /v .`
  ([Docker](docker.md#postgresql-variant)).
- `export-all` and `import-all` also work against a server, and remain the way to move
  between the embedded database and a server, or between versions. `export-all` reads every
  table from one snapshot (a `repeatable read, read only` transaction), so an export taken
  while the application runs is consistent.
- A managed database service's own scheduled snapshots and point-in-time recovery are a
  good addition, not a replacement for a copy you hold.

## Restore

```powershell
.\grc.ps1 backups                      # choose one
.\grc.ps1 restore 20300131-020000      # by name
.\grc.ps1 restore latest               # the newest backup
.\grc.ps1 restore D:\offsite\20300131-020000   # by path
```

In order, `restore`:

1. Stops the server if it is running. (Run directly with npm, it refuses while the
   server is up.)
2. **Verifies the backup**: every file and folder in the manifest must be present with the
   right size and checksum, and nothing may be there that the manifest does not list. If
   anything is wrong it stops here, lists the problems, and the current data is untouched.
3. Checks the backup was not made by **newer code**: if it has had migrations this copy of
   the code does not contain, it stops (there are no downward migrations). `-Force`
   overrides this.
4. Checks that the **secret key** the backup's stored secrets were encrypted with will be
   available (see below). If not, it stops and says where to put the key; the current
   data is untouched.
5. **Keeps the current data** as a complete backup of its own, named
   `<timestamp>-pre-restore`, verified like any other.
6. Replaces the contents of the data folder with the backup and checks the result against
   the manifest again.
7. Starts the server again if it was running. Any migrations the backup has not had are
   applied at that start, and the command names them.

It reports what it verified, where the safety copy is, and which backup is now live.

- **To undo a restore**, restore the safety copy: `.\grc.ps1 restore <timestamp>-pre-restore`.
  Straight after a restore, the safety copy is the newest backup, so `restore latest` does
  exactly that.
- Everything recorded after the backup was taken is no longer in the application,
  including audit events. It is still in the safety copy.
- If the restore fails after step 5 (for example the disk fills), the command says so,
  exits with code 2 and does **not** start the server on the half-written folder. Restore
  the safety copy it names.
- Backups made by the earlier version of this script (a plain copy with no
  `manifest.json`) are refused. Put one back by hand: stop the server, move the contents
  of `data\` aside, copy the backup's contents into `data\`, start.
- **Single-file backups.** `restore` also takes an encrypted backup
  (`<timestamp>.tar.sgrc`, with its key: see
  [Encrypted backups and exports](#encrypted-backups-and-exports)) and a file the server
  took itself (`sandpiper-backup-*.tar` or `.tar.sgrc`, see
  [Backups taken by the server](#backups-taken-by-the-server)). It unpacks it into a hidden
  working folder in `backups\`, checks it, and deletes the folder afterward.
- **The secret key.** The secret key is not in backups, but every backup and export
  records its **fingerprint** (never the key). Authenticator keys, webhook, sign-in provider
  and mail secrets in the restored database can only be read with that key, and the key is
  looked up beside the data folder **under the data folder's name** (`<data folder>.secret.key`),
  so restoring into a folder with another name or on another machine finds no key, or a
  different one. `restore` therefore checks before it changes anything: the backup's key
  must be in `GRC_SECRET_KEY`, in the key file for the data folder (or `GRC_SECRET_KEY_FILE`),
  among its retired keys, or carried in an encrypted backup (`-IncludeSecretKey`, which
  restore puts in place, or adds as a retired key where a different key is in use; then
  `secret-key show` says when retired keys can be deleted). If it is not, restore stops,
  names the fingerprint and where to put the key file. A backup made before fingerprints
  were recorded is refused only when there is no key at all. Restoring into the same data
  folder needs nothing more. To restore without the key anyway, set
  `$env:GRC_RESTORE_NEW_SECRET_KEY = '1'` (or pass `--new-secret-key` to `cli.ts restore`):
  a new key is made at the next start, everyone who uses an authenticator app must set it
  up again (an administrator resets their second factor), and webhook, sign-in provider
  and mail secrets must be entered again.
- What restore unpacks and creates (the working folder, the data folder, the key file it
  puts in place) is readable by the account running it only (folders `0700`, files `0600`,
  on macOS and Linux; on Windows the folder's permissions apply).
- With a PostgreSQL server (`GRC_DATABASE_URL`), `restore` refuses: use `pg_restore`
  ([PostgreSQL server backups](#postgresql-server-backups)).

### Restore test

A backup is only known to be good once it has been restored. Do this after setting up
scheduled backups, and again every few months. It restores the newest backup into a
spare folder and runs the application from it on another port, without touching the live
data:

```powershell
$env:GRC_DATA_DIR = "$env:TEMP\grc-restore-test"; $env:GRC_PORT = '8099'
# The restored data needs the live secret key, looked up under the spare folder's name.
Copy-Item .\data.secret.key "$env:TEMP\grc-restore-test.secret.key"
.\grc.ps1 restore latest        # "There was no existing data to keep."
.\grc.ps1 start                 # http://127.0.0.1:8099
.\grc.ps1 status
```

(If the key comes from `GRC_SECRET_KEY` or `GRC_SECRET_KEY_FILE`, the test uses it as well
and nothing needs copying. Without the key, `restore` stops and says so.)

Sign in at http://127.0.0.1:8099, with your second factor if you have one, and check that
recent records are there. Then:

```powershell
.\grc.ps1 stop
Remove-Item $env:GRC_DATA_DIR -Recurse -Force
Remove-Item "$env:TEMP\grc-restore-test.secret.key*"
Remove-Item Env:GRC_DATA_DIR, Env:GRC_PORT
```

Record the date of the test. If your backups are copied to another disk, test from that
copy (`.\grc.ps1 restore <path>`), since that is the one you will need.

What is tested for you: the test suite backs up a real embedded database with attached
files, changes it, restores the backup and checks that the data and files are as they were,
then restores the safety copy (`server/src/ops/backup.test.ts`); it also restores an
encrypted backup, with and without the secret key inside it (`server/src/ops/archive.test.ts`),
refuses a restore into a folder without the backup's key (`backup.test.ts`), restores a
server backup from an older version through a migration that changes data
(`staged-import.test.ts`), and takes an export while rows are being saved and checks that
nothing is doubled or missing (`export-snapshot.test.ts`, also run against PostgreSQL).
The load tool's `--ops` run times a restore at volume
([Performance and load testing](#performance-and-load-testing)). None of these replaces your
own test on your own machine and backups.

## Export and import

`backup` copies the database's own files: fast and exact, but only readable by the same
database engine. `export-all` writes a **logical** copy in an open format, for moving to
another installation or, later, another database engine, and so that the data is never
locked in.

```powershell
.\grc.ps1 export-all                       # into backups\export-<timestamp>\
.\grc.ps1 export-all -Out D:\handover\grc
.\grc.ps1 export-all -NoSecrets            # see below
.\grc.ps1 export-all -Encrypt              # one encrypted file, backups\export-<timestamp>.tar.sgrc
```

With `-Encrypt` the same content is written as one encrypted file (see
[Encrypted backups and exports](#encrypted-backups-and-exports)); `import-all` reads it
with the key, and `decrypt` turns it into a plain tar file.

An export is a folder:

| Path | Contents |
|---|---|
| `manifest.json` | Application version, time, database version, the migrations applied, and for every table its file, row count, column names and SHA-256 |
| `tables\<table>.jsonl` | One file per database table: one JSON object per line (JSON Lines), in primary-key order. Every table is included: records, lookups, settings, users and roles, links, comments, counters and the audit log |
| `files\` | The attached files, as they are in `data\files` |
| `checksums.sha256` | One line per file, `<sha256>  <path>`: the format `sha256sum -c` and similar tools read |

Values are written by the database itself, so nothing is rounded or reformatted: times
keep their microseconds and their offset, numbers their full precision, JSON columns
their structure. Every table is read from one snapshot of the database, and each table file is
written as its rows arrive, so no table is ever held in memory whole (the audit log, which
is never pruned, grows without limit). The manifest also records the fingerprint of the
secret key in use (never the key itself).

**Secrets.** A full export contains password hashes, second-factor secrets, recovery-code
hashes, sessions and one-time links, because an installation cannot be moved without
them. Protect it like a backup, or use `-Encrypt`. `-NoSecrets` leaves the rows of `sessions`,
`one_time_tokens`, `password_history`, `webauthn_credentials` and `webauthn_challenges`
(passkeys) out and blanks `password_hash`, `totp_secret`,
`totp_enabled` and `recovery_codes` on every user; the manifest marks those tables as
redacted. It also leaves out or empties the other token and session tables (sign-in links,
single sign-on flows and sessions, logout tokens, assistant sign-in codes and tokens) and
blanks the secrets of rows that others refer to: API token, provisioning token, calendar feed
and vendor link hashes become unusable values, assistant client secrets are emptied, and
work-tracker connections lose their sealed address and secrets and are switched off. Use
`-NoSecrets` for handing data to someone for analysis. It is not a way to move a working
installation: after importing it nobody has a password, and there is no reset command. It still
holds the sign-in provider, webhook, forwarder and mail secrets, encrypted with the secret key.
Treat it as confidential too.

An export does not contain the secret key (`secret.key` or `GRC_SECRET_KEY`): the
second-factor secrets in a full export are encrypted, and the installation that imports
them needs the same key, or those people must have their second factor reset.

**The secret key is not in an export.** Authenticator keys are stored encrypted, and the
export carries them as stored. **Before** running `import-all` somewhere else, give the
target the same key: copy the key file (`data.secret.key`, beside the data folder) beside
the target's data folder under the target's name (`<target data folder>.secret.key`), or
set `GRC_SECRET_KEY` there. Without it anyone who has a second factor cannot complete
sign-in, because their authenticator key cannot be read, so `import-all` refuses an export
that records its key's fingerprint until that key is in place, and says where to put it
(`$env:GRC_RESTORE_NEW_SECRET_KEY = '1'` imports it anyway). Exports made by earlier
versions record no fingerprint and are not checked.

### Import

```powershell
# On the target: a fresh installation that has never had the setup wizard completed.
.\grc.ps1 import-all D:\handover\grc
.\grc.ps1 start
```

`import-all`:

1. Verifies every file in the export against the manifest; a changed or missing file
   stops it.
2. Creates the database if there is none, with **the migrations the export was made with**
   (listed in its manifest): the rows are loaded into the schema they came from. After
   step 5 it applies the migrations that are newer than the export, so one that changes
   existing data runs on the imported rows too, and names them. Into a database that
   already has newer migrations (one that was started once) it refuses an export from an
   older version: start again from an empty data folder, or a new empty database on a
   PostgreSQL server. An export from the same version loads as before.
3. Refuses unless the target is **empty**, meaning it has no users. It also refuses if the
   export has had migrations the target's code does not have (import into the same
   version or a newer one, with the same modules), or contains a table the target lacks.
4. In **one transaction**, clears the default rows the empty installation created for
   itself (roles, lookup values, settings), loads every table in dependency order, and
   moves each number sequence on past the highest imported value. If anything fails,
   nothing is loaded.
5. Copies the attached files into `data\files`.

`schema_migrations` is not imported: the target keeps its own record of what it applied.
Table files are read line by line and loaded in batches, so a table of any size loads.

**The audit log.** The audit table is append-only: a database trigger refuses any update
or delete of a row. The import respects that. Every exported audit event is inserted
unchanged, with its original number, time, actor, source address and content; nothing is
edited afterward. Any events the empty target wrote while creating its own defaults are
cleared first, with the rest of the default rows. That uses a whole-table clear
(`TRUNCATE`), which the row-level trigger does not cover; the import does it only at this
point and only after confirming the installation has no users. Numbering then continues from the highest imported event, and
the import records itself as one new event (`import`, by "System") saying how many rows
were loaded and from which export. The trigger is in force again as soon as the import
finishes, and the test suite checks that.

A round trip (export, import into an empty database, export again) produces identical
table files apart from that one extra audit event and the target's own migration dates.
This is tested on every run of the test suite. One thing to expect in practice: some
modules refresh their own derived rows each time the application starts (this week's
vulnerability trend snapshot, for example), so an export taken after a start can differ
in those rows.

**Moving to a PostgreSQL server.** The export uses only standard PostgreSQL
(`row_to_json` to write, `json_populate_recordset` to load), so the same files load into a
PostgreSQL server: run `import-all` with `GRC_DATABASE_URL` pointing at an empty database,
before the setup wizard ([Installation](installation.md#postgresql-server)).

## Upgrading

```powershell
.\grc.ps1 upgrade -From D:\downloads\sandpiper-grc-0.2.0.zip   # a release folder or .zip
.\grc.ps1 upgrade -Pull                                        # or: git pull --ff-only, done by upgrade
.\grc.ps1 upgrade                                              # or: the new code is already in place
```

`upgrade` runs seven steps. If any of them fails it **rolls back by itself** and starts the
previous version again:

1. **Keep the current code.** With `-From` or `-Pull`, the code as it is now is saved to
   `backups\code\pre-upgrade-<timestamp>.tar` before anything changes (the newest three are
   kept). Without them, the new code is already in place, so the copy used for going back
   is `backups\code\last-good.tar`: written by `start` the first time it runs, by
   `save-code`, and at the end of every successful upgrade. If there is none, `upgrade`
   says so and cannot roll back the code by itself. Either way the version it is moving
   from is read from `package.json` and recorded in `backups\code\upgrade.json`; no
   version-control tool is needed.
2. **Backup** (`pre-upgrade`), stopping the server first (encrypted with `-Encrypt`). If
   the backup fails, nothing else happens.
3. **New code**: `git pull --ff-only` (`-Pull`), or the release copied into place
   (`-From`: files that are not in the release are removed from `server\src` and `web\src`
   only, nothing else is deleted). Without either: nothing to do.
4. **`npm install`** with the portable Node.js. `-SkipInstall` skips this on a machine with
   no network access, when the packages are already in place.
5. **Build** the web application.
6. **Migrations.** Each migration runs in a transaction and is recorded in the
   `schema_migrations` table with a checksum, so it is applied once; core first, then each
   module in alphabetical order. The command prints the ones it applied. A migration that
   was already applied and has been edited since is not run again; it is reported
   ([Status](#status)).
7. **Start and health check**, then `status`, and the new code is saved as
   `last-good.tar`. Everyone signed in can then see the new version under Help > About
   (`GET /api/version`), and the start-up line in the log names it.

**Automatic rollback.** When a step from 3 on fails, `upgrade`:

- stops the server;
- puts the saved code back (`tools\code-snapshot.mjs restore`, run from a copy kept in
  `backups\code\`, so a broken new version cannot block it), removing files the new
  version added under `server\src` and `web\src` (a new migration among them);
- runs `npm install` again if `package.json` or `package-lock.json` changed (with
  `-SkipInstall` it says so instead);
- restores the pre-upgrade backup if the database may have been changed (from step 6 on;
  there are no downward migrations), keeping the new version's data as a safety copy;
- builds the web application and starts the previous version, and checks its health.

It then says plainly either `ROLLED BACK: the upgrade failed at '<step>', and version
<previous> is running again with the data as it was before.` (exit code 1), or
`ROLLBACK INCOMPLETE` with the step that failed and the commands to finish by hand (exit
code 2, server stopped). `-NoRollback` keeps the old behavior: stop, leave the server
stopped and print those commands. `data\server.log.err` (or `.\grc.ps1 logs`) names a
migration that failed at start (`Migration <module>/<file> failed: ...`).

This was rehearsed on a copy of the application with a release holding a broken
migration: the migration failed, the code and the data were put back and the previous
version started healthy.

To move to a newer Node.js patch release within the same major version, stop the server
and run `powershell -ExecutionPolicy Bypass -File .\tools\install-node.ps1 -Force`
(`./tools/install-node.sh --force` on macOS and Linux). A container gets it with the next
image.

The mobile app is released separately; its release checklist, and how a server tells the app which
versions it accepts, are in [Mobile app](mobile.md#release-checklist).

### Upgrading a server or container installation

`grc.ps1 upgrade` and `grc.sh upgrade` back up the embedded database only. With a database
server or containers, do the same steps by hand:

1. **Back up** the database with `pg_dump` and the files
   ([PostgreSQL server backups](#postgresql-server-backups)), or, with the embedded
   database in a container, `docker compose stop app && docker compose run --rm app grc backup`.
2. **Replace the code**: `git pull` then `npm ci && npm run build` (for the systemd
   service: `sudo systemctl stop sandpiper-grc`, then `git pull`, `./grc.sh install`,
   `./grc.sh build`), or `docker compose pull` for the published image (`docker compose
   build` for one built from source).
3. **Restart**: `docker compose up -d` replaces the container. Migrations run at start-up;
   a failure stops the server with `Migration <module>/<file> failed: ...` in its output
   (`docker compose logs app`), and the container restarts and fails again until fixed.
4. **Check** `/api/health` and the start-up line.

To roll back: stop, put the previous code or image back, restore the dump into an empty
database and the files, and start. There are no downward migrations, so the database must
go back together with the code.

**Upgrading to the version with faster search (migration 009).** The first start rebuilds
every search index once, which can take a minute or two on a large installation. An embedded
database upgraded to it cannot be opened by an older version: to go back, restore the backup
`upgrade` took first.

## Dependency vulnerabilities

`.\grc.ps1 audit-deps` (`./grc.sh audit-deps`, part of `ci`, and a step of every GitHub
Actions run) asks `npm audit` about the production packages and applies one rule: **it fails
when a high or critical vulnerability has a fixed version** (an update, or a new major
version to plan), and **lists without failing** one that nobody can fix yet, so the build is
not blocked by something no one can change. `-Level moderate` is stricter; `npm run cli --
audit-deps --all` includes the development packages. It needs the npm registry; without a
network it says so and `ci` carries on. Dependabot proposes updates every Monday
(`.github/dependabot.yml`).

How quickly a vulnerability in a dependency is dealt with, counted from the day it is
reported here:

| Severity | Fix available | No fix yet |
|---|---|---|
| Critical | Update within 2 days, and publish a release | Within 2 days decide whether the vulnerable code is reachable; if it is, remove or replace the package, or switch the feature off and say so in the release notes |
| High | Update within 7 days | Review within 7 days, as above; check again at every weekly audit |
| Moderate | With the next weekly update | Reviewed at the next release |
| Low | With the next routine update | Reviewed at the next release |

## Performance and load testing

`node tools/load/run.mjs` measures the application at a realistic volume. It needs no
packages beyond the application's own and contacts nothing outside the machine. It starts a
throw-away instance in a temporary folder, creates invented records through the API (at
scale 1: 10,000 tickets, 3,000 assets, 2,000 actions, 1,500 changes and 1,500
vulnerabilities, and some hundreds of each other type), then has a number of simulated
people (`--concurrency`, default 8) repeat each scenario for `--duration` seconds: list
pages, sorted and filtered lists, full-text queries, statistics, global search, one record,
the whole Overview dashboard (every call it makes, timed until the last answer), and
creating and updating a ticket. `--ops` also times backup, export, verification, restore
and import at that volume. Results are written as JSON and Markdown to `tools/load/out/`
(git-ignored). See [`tools/load/README.md`](../tools/load/README.md) for every option.

**Targets** for a pilot (one organization, up to about 50 people at once), with 8 people
at once and no errors:

| | PostgreSQL server (what a pilot should run) | Embedded database (evaluation on one machine) |
|---|---|---|
| Lists, filtered and sorted lists, one record | 95th percentile within **300 ms** at scale 1 | within **500 ms** at scale 0.5 |
| Full-text list query | within **300 ms** | within **1 s** |
| Global search | within **500 ms** | within **2 s** |
| Overview dashboard (all its calls) | within **1 s** | within **2.5 s** |
| Save (create or update) | within **300 ms** | within **500 ms** |
| Backup, export, restore, import at scale 1 | under a minute | under a minute |

The embedded database answers one statement at a time inside the server process, so with
8 people at once each of them waits for the others' statements too: its targets are looser,
and it is meant for evaluation, not for a pilot ([What must change before real
use](#what-must-change-before-real-use)).

**Current results (E16-38, E16-39).** Same laptop, load generator on the same machine, 8
people at once, 15 seconds per scenario. Records were made once per scale with the load
tool's Zipf vocabulary (below) and kept (`--keep`); the version before these changes (wave 4)
and this one were then measured on copies of the same records (`--reuse`), alternately, so
both met the same machine. Other development work kept the machine between about half and
fully busy and moved single runs by a factor of two or more, so the scale-0.5 figures for
global search and the Overview are the median of four runs of each version (the others are
single runs). 95th percentile, and 50th in brackets, in milliseconds:

| Scenario | Embedded 0.5, before | Embedded 0.5, after | Embedded 1, after | Embedded 4, after | PostgreSQL 1, before | PostgreSQL 1, after | PostgreSQL 4, after |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ticket list, first page | 239 (140) | 136 (90) | 983 (348) | 281 (254) | 71 (48) | 67 (43) | 119 (90) |
| Ticket list, random page, sorted | 479 (348) | 464 (155) | 427 (215) | 471 (426) | 99 (80) | 100 (81) | 225 (201) |
| Ticket list, filtered by status | 250 (154) | 307 (90) | 87 (74) | 119 (102) | 61 (49) | 57 (46) | 70 (55) |
| Ticket list, full-text query | 540 (298) | 326 (216) | 334 (255) | 777 (632) | 114 (58) | 105 (86) | 370 (146) |
| Ticket statistics by status | 214 (151) | 35 (24) | 24 (12) | 12 (8) | 22 (19) | 7 (6) | 7 (6) |
| First page of any list | 290 (190) | 132 (55) | 205 (99) | 101 (58) | 50 (37) | 45 (32) | 86 (34) |
| Global search | 2,642 (1,896) | 1,335 (857) | 874 (494) | 1,162 (789) | 257 (177) | 197 (149) | 356 (120) |
| One record | 217 (79) | 143 (49) | 41 (30) | 26 (18) | 32 (24) | 22 (18) | 20 (17) |
| Overview dashboard (12 calls together) | 3,460 (2,008) | 704 (456) | 369 (220) | 179 (159) | 465 (427) | 144 (122) | 146 (127) |
| Overview, a ticket saved every second meanwhile | 2,632 (979) | 1,056 (549) | 408 (185) | 502 (173) | 493 (421) | 213 (139) | 989 (138) |
| Save: create a ticket | 379 (133) | 281 (141) | 336 (165) | 88 (65) | 91 (82) | 91 (76) | 86 (74) |
| Save: update a ticket | 109 (69) | 122 (83) | 244 (115) | 58 (46) | 66 (56) | 57 (50) | 59 (49) |

Scale 1 is about 21,000 records and scale 4 about 82,000 (40,000 tickets, 12,000 assets,
8,000 actions, 6,000 changes and 6,000 vulnerabilities and the rest); the PostgreSQL server
was PostgreSQL 17 in a container on the same laptop. A scale-1 run of the earlier version on
the embedded database in the same session met a fully busy machine (global search 5.1 s,
Overview 5.8 s, full-text 7.0 s) and is left out of the table; its recorded figures from
before (global search 4.3 s, Overview 3.7 s) are the fairer comparison. Every embedded
target is met at scale 0.5 in the medians, and the same figures held at scale 4 on a
quieter machine; single runs on a fully busy machine still went over for global search (3.0
and 4.0 s) and came close for the Overview (2.6 s). Every server target is met at scale 1;
at scale 4, with the server sharing the laptop, all but the full-text list query (370 ms
against 300 ms) are met, the Overview with saves meanwhile only just (989 ms).

What made the difference:

- **The Overview's figures are kept for a few seconds** while nothing is written
  (`GRC_FIGURES_CACHE_SECONDS`, default 10, `0` switches it off), and people asking at the same
  moment wait for one computation instead of each running it. A kept answer is shared only by
  callers holding exactly the same permissions (and the same switched-off areas), and, for
  figures that hold the caller's own counts ("mine", a statistic filtered on "me"), only by
  the same person with the same permissions; the route's permission check, the feature
  switches and the restriction rules decide what is computed, so the figures stay the same
  for everyone who sees them. Any change written through the server empties it at once (a
  write counter on the database handle, which also counts the end of every transaction,
  rolled back or not). Changes made by another server process on the same PostgreSQL
  database are not seen until the few seconds are over. With 8 people at once and nothing
  written, the Overview went from about 3.5 s to 0.7 s at scale 0.5; with a ticket saved
  every second, so that the figures are mostly recomputed, from about 2.6 s to 1.1 s. With
  the cache off (`0`) the same run gave 1.2 s and 2.4 s: the rest of the gain is the
  statements saved on every request (next point).
- **One statement per signed-in request** for the session, the person, their roles and
  permissions and the settings every request needs, instead of four.
- **Global search in one statement** over the search index for every record type, instead
  of one per type. One search at a time on scale-1 data went from about 380 ms to 140 ms on
  a busy machine (60 ms on a quiet one); with 8 people at once on the embedded database it
  is mostly waiting in line (it answers one statement at a time). About a fifth of its cost
  is the highlighted snippets.
- **Vulnerabilities are searched through the index** of the table behind their view.

**Start-up at volume (E16-39).** Starts of the embedded database answered in 2 to 10 s at
scale 1 and 2.6 s at scale 4 (more on a busy machine, up to about 24 s once for the earlier
version). The server now times the parts of its start and logs them when the whole, or one
part, takes longer than `GRC_STARTUP_WARN_MS` (default 2,000), for example:
`[start] start-up took 4585 ms: opening the database 261 ms, migrations 681 ms, modules and
routes 1560 ms, start-up steps 2083 ms; the longest steps: core/resource.ts:110 1963 ms, ...`.
The one step that grows with the data is the search index: after an upgrade that changes how
a type is searched it is rebuilt at start. With every type's search definition changed, a
scale-4 embedded installation took 18.7 s for that step (20 s for the whole start), over
Fastify's 10-second limit per step; the limit is now ten minutes
(`GRC_STARTUP_TIMEOUT_SECONDS`, default 600). The embedded database's first `analyze` waits
until the start is over. At scale 4 with `--ops`: backup with verification 4.7 s, `export-all`
50.6 s (259,443 rows), `verify-backup` 1.9 s, `restore` 9.9 s, `import-all` into an empty
installation 38.4 s; the data folder was 921 MB. Seeding scale 4 through the API took about
ten minutes on the embedded database (130 tickets a second) and about twelve on the PostgreSQL
server (105 a second, `--seed-concurrency 16`, sharing the laptop); a start of the scale-4
installation on the server answered in 2.6 s.

**The database with its own limited share of the machine, and people in different roles
(E16-41, 2026-11-22).** The aim of E16-41 is a database on its own machine. That was not
available, so this is the nearest stand-in on one laptop, and it is **not** a separate machine:
PostgreSQL 17 ran in a container limited to **2 processors and 2 GB of memory** (`--cpus 2
--memory 2g`, default PostgreSQL settings) as the "database machine"; the application ran as
its own process outside the container (the load tool's throw-away instance, reaching the
database over TCP) and the load generator as a third process. All three shared the same 14-core
laptop, which five other development sessions kept busy (about half its processors in use
at a moment it was checked between runs), and the application and load generator were not limited. Records were
seeded once per scale (with `--roles 6`) and each column measured a copy of the same records
(`--reuse`), 8 people at once, 15 seconds per scenario. "7 roles" means the simulated people
opened the Overview in turn as the administrator and as six people each holding one other role
(service desk agent, asset manager, audit lead, compliance officer, continuity manager, project
manager), each asking only for the Overview calls their role may see (4 to 9 of the 12), so the
kept figures are computed once per set of permissions (`tools/load/run.mjs --roles`). 95th
percentile, and 50th in brackets, in milliseconds:

| Scenario | Scale 1, administrator | Scale 1, 7 roles | Scale 1, 7 roles, cache off | (again) | Scale 4, administrator | Scale 4, 7 roles | Scale 4, 7 roles, cache off |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ticket list, first page | 94 (63) | 138 (68) | 110 (79) | 157 (86) | 747 (486) | 345 (272) | 679 (408) |
| Ticket list, random page, sorted | 213 (134) | 285 (182) | 381 (223) | 386 (274) | 1,826 (795) | 795 (590) | 1,460 (896) |
| Ticket list, filtered by status | 72 (56) | 94 (61) | 74 (61) | 131 (73) | 117 (86) | 152 (91) | 107 (85) |
| Ticket list, full-text query | 371 (203) | 288 (113) | 312 (123) | 506 (305) | 1,684 (478) | 1,709 (500) | 4,342 (914) |
| Ticket statistics by status | 10 (8) | 9 (7) | 79 (37) | 94 (72) | 21 (12) | 21 (11) | 175 (100) |
| First page of any list | 68 (50) | 90 (53) | 1,154 (180) | 65 (41) | 235 (86) | 138 (57) | 204 (68) |
| Global search | 799 (501) | 1,101 (417) | 3,682 (981) | 886 (565) | 1,916 (573) | 2,111 (657) | 2,004 (602) |
| One record | 45 (33) | 51 (32) | 230 (74) | 41 (31) | 58 (34) | 46 (36) | 45 (35) |
| Overview dashboard (all its calls) | 356 (187) | 268 (106) | 725 (520) | 778 (470) | 3,496 (263) | 1,176 (157) | 2,098 (1,092) |
| Overview, a ticket saved every second meanwhile | 420 (169) | 421 (100) | 770 (520) | 756 (403) | 3,692 (1,742) | 1,799 (719) | 2,367 (1,234) |
| Save: create a ticket | 203 (111) | 105 (94) | 160 (108) | 124 (97) | 208 (133) | 148 (116) | 176 (122) |
| Save: update a ticket | 96 (72) | 75 (63) | 180 (80) | 117 (72) | 92 (75) | 163 (85) | 129 (91) |

Every run completed with no errors and no request left unanswered. What they show:

- **At scale 1 the two-processor database holds the pilot targets for lists, one record,
  saves and the Overview**, also with seven sets of permissions (Overview 268 ms; 421 ms with a
  save every second). Global search (0.8 to 1.1 s) and, in some runs, the full-text list query
  (288 to 506 ms) do not meet the server targets of 500 and 300 ms. On an unlimited container
  they did (197 and 105 ms, above): those two are what a small database machine feels first.
- **The cache matters more with roles than without.** With it off, seven roles took the
  Overview from 268 to about 750 ms at scale 1 and from 1.2 to 2.1 s at scale 4; ticket
  statistics went from 9 to about 90 ms. With it on, seven roles cost no more than one at scale
  1: each set of permissions computes once and then shares its kept answers. The first
  cache-off run at scale 1 also met a busy moment of the laptop (first page of any list 1.2 s,
  global search 3.7 s, where the repeat gave 65 ms and 0.9 s); read the repeat.
- **At scale 4 (about 82,000 records) two processors are not enough** for these 8 people:
  the container sat at its limit of 200 % for about half of the samples taken every few
  seconds (`docker stats`), sorted and full-text ticket lists took 0.8 to 4.3 s, global search
  about 2 s and the Overview 1.2 to 3.7 s. Saves, filtered lists and single records stayed
  fast. A pilot at that volume needs more processors for the database than two, or the
  slow statements tuned further; the unlimited container (above) met all but one target.
- **Seeding scale 4 met a full connection pool.** With 16 records created at once on this
  database, 30 of about 82,000 requests failed with a server error, logged as "timeout exceeded
  when trying to connect": a request waits at most `GRC_DATABASE_CONNECT_TIMEOUT` (10 s) for
  one of the pool's `GRC_DATABASE_POOL_MAX` (10) connections, and the busy database did not
  free one in time. People see "Something went wrong" and can try again; nothing half-written
  is kept. On a small database machine expect this under bursts of writes, and raise the pool
  or the timeout, or give the database more processors. None of the measured runs had it.
- Starting the application against the scale-4 database took 8 to 31 s (the slowest while
  the laptop was busiest); ticket creation while seeding ran at about 28 a second at scale 4
  (105 a second on the unlimited container) and about 78 at scale 1.

Still to do for E16-41: the same runs with the database on its own machine (or a managed
PostgreSQL service) and the application and load generator on others, so that the network
between them is real and nothing else shares the processors.

**Earlier results (E16-36).** All on the same 14-core laptop (31 GB, Windows 11), the load generator on the
same machine, 8 people at once, 15 seconds per scenario, version 0.1.0. Scale 0.5 is about
10,500 records (5,000 tickets, 1,500 assets, 1,000 actions, 750 changes, 750
vulnerabilities and the rest). Other heavy work (test suites and browsers of other
development sessions) ran beside every run and varied from minute to minute, which moves
single figures by a factor of two either way; read the table for its pattern, not its
digits. 95th percentile, and 50th in brackets, in milliseconds, at scale 0.5:

| Scenario | Embedded, first run (morning) | Embedded, before tuning (same afternoon) | Embedded, after tuning | PostgreSQL server, after tuning |
|---|---:|---:|---:|---:|
| Ticket list, first page | 297 | 524 (431) | 372 (321) | 98 (76) |
| Ticket list, random page, sorted by title | 1,550 | 2,084 (1,155) | 377 (308) | 110 (86) |
| Ticket list, filtered by status | 2,083 | 380 (321) | 284 (246) | 86 (67) |
| Ticket list, full-text query | 6,740 | 1,736 (1,496) | 780 (658) | 126 (104) |
| Ticket statistics by status | 241 | 147 (126) | 139 (119) | 28 (23) |
| First page of any list | 967 | 315 (238) | 187 (145) | 71 (54) |
| Global search | 4,812 | 2,078 (614) | 1,781 (1,665) | 312 (257) |
| One record | 177 | 82 (50) | 98 (81) | 40 (30) |
| Overview dashboard (12 calls together) | 2,162 | 942 (859) | 2,256 (2,002) | 593 (500) |
| Save: create a ticket | 1,353 | 340 (105) | 301 (270) | 129 (98) |
| Save: update a ticket | 1,497 | 311 (252) | 227 (207) | 81 (67) |

The PostgreSQL server was PostgreSQL 17 in a container on the same laptop (so it shared
the processors with the application and the load generator), reached with
`GRC_DATABASE_URL`, default settings and the default pool of 10 connections. It meets every
server target with room to spare. At scale 1 (about 22,000 records) on the same server, 95th
percentiles: ticket list pages 136 to 187 ms, filtered 82 ms, full-text 164 ms, first page of
any list 66 ms, global search 351 ms, one record 34 ms, Overview 814 ms, saves 71 to 124 ms,
with no errors: every server target is met at scale 1 as well.

Scale 1 (about 22,000 records) on the embedded database, after tuning, 95th percentiles:
lists 745 to 898 ms, filtered 502 ms, full-text 1,546 ms, global search 4,316 ms, one
record 298 ms, Overview 3,678 ms, saves 275 to 902 ms. The run completed without errors.
With `--ops`: backup with verification 8.3 s, `export-all` 26.4 s (65,219 rows),
`verify-backup` 2.7 s, `restore` 17.7 s, `import-all` into an empty installation 55.8 s, all
within the one-minute target. Seeding ran at about 23 tickets a second on the embedded
database and about 80 a second on the PostgreSQL server.

Measured one request at a time on the same scale-1 data (what a request costs with nobody
else waiting), after tuning: a ticket list page 30 to 60 ms, a full-text list query 100 to
130 ms, global search about 95 ms, all the Overview's calls about 120 ms together, one
record under 10 ms. The embedded figures under load are therefore mostly waiting in line:
with 8 people at once a request takes roughly 8 times its own cost, and more when the
machine is busy.

**What was tuned** (E16-36), found with `explain analyze` on the generated statements, a CPU
profile of the server (over 85 % of its busy time is inside the database engine) and the
slow statement log (below):

- **Planner statistics on the embedded database.** It runs no autovacuum, so its tables were
  never analyzed and the planner guessed 21 rows for a table of 6,000, choosing its plans
  accordingly. The server now runs `analyze` a few seconds after opening it and again after
  every 2,000 writes (`GRC_ANALYZE_AFTER_WRITES`, `0` switches it off), at most every ten
  minutes. A PostgreSQL server does this itself.
- **Lists** find the page on record ids alone and then read those records in full, so a sort
  never carries whole rows, and the exact total comes from the same statement. Totals stay
  exact and the same for everyone who sees the same rows.
- **Full-text list queries** find the matching index rows once, through the index, instead
  of testing the index again for every record.
- **Substring matching** (a single word still matches inside words, codes and serial
  numbers) no longer reads every record's text fields: the search index keeps those fields
  as one text (`search_index.body`), with a trigram index (`pg_trgm`, migration 009). The
  embedded database loads `pg_trgm` itself; on a PostgreSQL server the migration creates the
  extension where the owner may (it is a trusted extension) and otherwise works without the
  index.
- **Global search** reads, for each record type, only that type's matching index rows and
  ranks only those; the record table is then read by id, and only the best few are read in
  full for their snippet. Types are searched four at a time, which a PostgreSQL server
  answers side by side.
- **Labels in lists** read only the value lists the type uses, instead of every value list
  for each page.
- **Service desk figures** (part of the Overview) count every breakdown in one pass over the
  tickets and count the backlog by age in the database, instead of ten passes and reading
  every open ticket.

On the embedded database the Overview and global search did not get faster under load in
these runs (the differences were within the noise of the busy machine); E16-38 then did
(**Current results**, above).

**Upgrading to this version** rebuilds every record type's search index once at the first
start (about 4 seconds for 6,000 tickets on the embedded database). With a least-privilege
run-time account, run `migrate` as the owner first, as for any change of search definition
(E16-37). The search index grows by the text it now keeps (about the size of the searchable
fields once more). An embedded database upgraded to this version cannot be opened by an
earlier version (it needs `pg_trgm`); go back by restoring a backup taken before.

**Slow statements.** `GRC_SLOW_QUERY_MS=200` (any number of milliseconds) writes every
statement that takes that long to the error log with its time and text, never its values.
On the embedded database the time includes waiting behind other statements.

**The scale-1 run that lost its connection** in the first measurements (while creating
tickets) did not happen again: two scale-1 runs completed, one of them with `--ops`, with no
request left unanswered. The cause was not established. The load tool now tries a request
that gets no answer once more, counts such requests in its results, and, when the instance
stops by itself, reports its exit code and last output instead of only "fetch failed". One
start of a restored scale-1 folder stopped with "A callback for 'onReady' hook timed out"
(start-up work over Fastify's 10-second limit) while the machine was very busy; the next
starts took a few seconds and logged no statement over 40 ms. Fixed in E16-39 (**Start-up at volume**, above).

**Limits of these figures**, stated plainly:

- One development laptop, busy with other work, with the load generator and (for the server
  figures) the database on the same machine. A PostgreSQL server on its own machine should
  do better than the server column.
- The earlier results drew words from a list of about a hundred, so every word was in
  roughly a fifth of all records. The current ones use a Zipf vocabulary of about 500 words
  (a few words in thousands of records, most in a handful), closer to real text.
- In the E16-36 and E16-38 results every simulated person signs in as the same administrator,
  so they all share one kept answer for each Overview figure. The E16-41 runs (above) add people
  in seven different roles, and runs with the cache off.
- The database has not yet run on a machine of its own (E16-41): the nearest so far is a
  container limited to 2 processors and 2 GB on the same laptop (above).

## Emergency access (break-glass)

The break-glass account is the one local administrator kept for when single sign-on is
unavailable ([Administration](user/09-administration.md)). Every sign-in with it is
recorded as a `signin.break_glass` audit event and announced to every administrator. When
it is needed:

1. Take the sealed password and the hardware security key from where they are kept, and
   note who took them and when.
2. On the sign-in page open **Emergency access with a password**, and sign in with the
   break-glass account's user name, the password and the security key. A red notice stays
   at the top of every page for the whole session.
3. Deal with the emergency, and nothing else: for example fix or switch on the sign-in
   provider, or switch password sign-in back on.
4. Record what was done, and why, in a ticket or the incident record.
5. Sign out.
6. Change the break-glass password (a new one, sealed again with the security key), and
   review the `signin.break_glass` audit event and everything recorded during that
   session (Administration > Audit log).

## Troubleshooting

### "Portable Node.js is missing from .tools\node"

`.tools\node\node.exe` does not exist. Run
`powershell -ExecutionPolicy Bypass -File .\tools\install-node.ps1`; see
[Installation](installation.md#1-put-the-portable-nodejs-in-toolsnode).

### "Node.js 24 is needed" or "Node.js is not installed" (grc.sh)

`grc.sh` found no `node`, or one of another major version. Run `./tools/install-node.sh`
(the pinned version in `.tools/node`, used ahead of any other), or install Node.js 24 and
open a new terminal ([Installation](installation.md#macos)). "Permission denied" on
`./grc.sh` means the files lost their executable mark (a downloaded zip):
`chmod +x grc.sh tools/install-node.sh`.

### The script is blocked

"Running scripts is disabled on this system." Run it as
`powershell -ExecutionPolicy Bypass -File .\grc.ps1 start`, or see
[Installation](installation.md#if-the-script-is-blocked) for the other options.

### The server will not start

Where to read why, by how it is run:

| Run by | Where the reason is |
|---|---|
| `grc.ps1` or `grc.sh` | `.\grc.ps1 logs` (`./grc.sh logs`): it shows the end of `data\server.log.err` first when that is not empty, then the server's log |
| A `grc.sh service install` user service | `./grc.sh logs` (the service appends to `data/server.log` and `data/server.log.err`); `./grc.sh service status` for its state |
| The systemd service in `deploy/systemd/` | `journalctl -u sandpiper-grc -n 100` |
| A container | `docker compose logs app` (see also [Docker](docker.md#troubleshooting)) |

The server checks its settings before it listens and stops with a message rather than
starting half-configured. The messages, and what to do:

| Message | What to do |
|---|---|
| `EADDRINUSE` | Another program has the port: see "Server did not become healthy" below |
| `GRC_TIMEZONE "..." is not a known time zone` | Use an IANA name such as `America/Chicago` |
| `Refusing to serve plain HTTP on ...` | Set `GRC_TLS_CERT` and `GRC_TLS_KEY`, or, behind a proxy that terminates HTTPS, `GRC_ALLOW_INSECURE=1` ([Server installation](installation.md#server-installation)) |
| `The secret key must be 32 bytes ...` | `GRC_SECRET_KEY` or the key file holds something else: put the right key back ([Security](security.md)) |
| `Could not connect to the database at ...` | The PostgreSQL server named in `GRC_DATABASE_URL` cannot be reached, or refused the account or password; the message says which |
| `GRC_DATABASE_SSL must be off, require or verify`, `... must be a whole number ...` | Correct the setting it names |
| `Migration <module>/<file> failed: ...` | A migration failed; nothing of that migration was applied. Restore the previous version ([Upgrading](#upgrading)) or fix the cause the message gives |
| `... may not change the schema: run the migrations as the owner role` | Run `migrate` as the owner account ([Installation](installation.md#a-least-privilege-database-role)) |
| `A server (process ...) is using this data folder`, `The command "..." (process ...) is using this data folder` | Another process has the data folder: stop it first ("Stale pid file or lock" below) |
| Nothing that explains it | See the causes under "Server did not become healthy" below, a second process on the data folder in particular |

Change one thing at a time and start again. If you cannot find the cause, start the last
good backup in a spare folder ([Restore test](#restore-test)) to rule out damaged data.

### "Server did not become healthy"

Run `.\grc.ps1 logs`. The usual causes:

- **Port in use** (the log mentions `EADDRINUSE`). Something else is using port 8080. Find
  it with `Get-NetTCPConnection -LocalPort 8080 -State Listen` (the `OwningProcess` column
  is the process id), or use another port: `$env:GRC_PORT = '8081'; .\grc.ps1 start`.
  On macOS and Linux: `lsof -nP -iTCP:8080 -sTCP:LISTEN`, or `GRC_PORT=8081 ./grc.sh start`.
- **A second process on the data folder.** Make sure no other copy of the server, no
  `dev` session and no command-line task is running against the same folder.
- **A failed migration.** See Upgrading above.
- **An unknown time zone** in `GRC_TIMEZONE`.
- **A slow first start.** Creating the database can take longer than the wait on a slow
  machine. Run `.\grc.ps1 health` a little later before assuming a failure.

### Stale pid file or lock

After a crash or a forced end, `data\grc.lock` can be left behind. A lock whose process has
ended is taken over at the next start by itself. One written on another machine or in
another container (a shared volume) is taken over once it has not been touched for a minute:
the process holding it touches it every 10 seconds, so a container restarted after a crash
may refuse to start for up to a minute and then starts. A message such as `The command
"seed" (process 4242, started ...) is using this data folder` means that process is really
running: stop it, or let it finish. Delete `data\grc.lock` by hand only when you are sure
nothing uses the folder.

`data\grc.pid` can be left behind too. Every command checks
whether that process still exists and ignores or removes a stale file by itself, so
`.\grc.ps1 start` normally just works.

If `start` says "Already running" but the application does not answer, the process id has
been reused by another Node.js process. Confirm with `.\grc.ps1 status`, then delete
`data\grc.pid` (and `data\grc.stop` if present) and start again.

### A backup, restore or export says the server is running

The command-line tasks refuse to work while the process named in `data\grc.pid` exists, or
while another process holds `data\grc.lock`. Use `grc.ps1`, which stops the server for you,
or stop it first.

### "The backup failed verification and was not restored"

The backup folder does not match its manifest: the lines that follow name each file that
is missing, changed or unexpected. The current data has not been touched. Use another
backup (`.\grc.ps1 backups`, then `.\grc.ps1 verify-backup <name>` to check one before
relying on it). If the backup was copied from another disk, copy it again.

### The scheduled backup did not run

`.\grc.ps1 status` shows the task and its last result; `backups\scheduled-backup.log` has
a line per run. The task runs only while you are signed in to Windows. If the repository
was moved or the `GRC_*` settings changed, run `.\grc.ps1 schedule-backup` again.

### Build failures

`start` builds quietly. To see the full output, run:

```powershell
.\grc.ps1 build
.\grc.ps1 typecheck
```

If packages are missing or damaged, delete `node_modules\` and run `.\grc.ps1 install`.

### A page shows "Something went wrong"

The server logged the cause in its log (`data\logs\grc.log`, and `data\server.log.err`)
with the request method, address and request identifier. `.\grc.ps1 logs -Level error`
shows them; `.\grc.ps1 logs -Follow` shows new errors as they happen.

### Locked out

- A locked account unlocks by itself (the lock lasts from 1 to 15 minutes), or another
  administrator can unlock it under Administration, Users.
- A forgotten password needs another administrator to issue a reset link.
- If single sign-on is down or misconfigured, use the break-glass account
  ([Emergency access](#emergency-access-break-glass)).
- If the only administrator cannot sign in and there is no break-glass account, there is no
  reset command. In a prototype, restore a backup or reset the database (below).

### Resetting a prototype database

To start again from nothing:

```powershell
.\grc.ps1 backup                      # if there is any chance you will want the data
.\grc.ps1 stop
Remove-Item data -Recurse -Force      # deletes everything, including users and the audit log
.\grc.ps1 start                       # the setup wizard appears again
```

This is acceptable for a prototype only.

## Security posture of the prototype

- The server binds to `127.0.0.1` by default and cannot then be reached from the network.
  `GRC_HOST` changes that, and the server refuses plain HTTP on any other address unless
  it has a certificate (`GRC_TLS_CERT`, `GRC_TLS_KEY`) or `GRC_ALLOW_INSECURE=1` says a
  proxy terminates HTTPS in front of it; see [Server installation](installation.md#server-installation).
- On HTTPS (direct, or through a proxy named in `GRC_TRUST_PROXY`) the session cookie is
  marked `Secure` and `Strict-Transport-Security` is sent. On plain `http://127.0.0.1`
  neither applies.
- The application makes no outbound calls until an administrator switches one on: no
  telemetry and no externally hosted fonts or scripts. Email, webhooks, text messages,
  sign-in providers, an object store and backups to another location each connect out only
  once they are set up. Internet access is otherwise needed only to install or upgrade
  (`tools\install-node.ps1` and `npm install`).
- Data at rest is not encrypted by the application, apart from stored secrets such as
  authenticator keys, webhook secrets and mail credentials (whose key is `data.secret.key`,
  beside the data folder, unless you supply it another way), and encrypted backups and
  exports. Anyone who can read the `data\` or `backups\` folders, or a plain export, can read
  everything else. Protect them with file permissions and disk encryption.

### What must change before real use

The prototype is for evaluation on one machine. Before it holds real records for a team,
at least these must change:

1. A PostgreSQL server in place of the embedded database (supported: `GRC_DATABASE_URL`),
   with its own backups.
2. HTTPS (supported: a certificate or a trusted reverse proxy), and a deliberate decision
   about which network may reach it.
3. Backups that run when nobody is signed in, are copied off the machine, are encrypted,
   and raise an alert when one fails. All of this is built: switch on the server's own
   daily backups ([Backups taken by the server](#backups-taken-by-the-server)), or use the
   systemd timer, and carry out the [restore test](#restore-test).
4. Second factor **Required** (the setup wizard sets it unless you chose a reminder);
   single sign-on if your organization uses it.
5. Your own incident notification rules, service-level targets and risk scales
   ([Installation](installation.md#settings-that-must-be-yours-before-a-pilot)).
6. Monitoring and retained logs.

The full list is in [Known gaps](known-gaps.md). The route there is sketched in
[Architecture](architecture.md#path-to-production), and the current protections are
described in [Security](security.md).
