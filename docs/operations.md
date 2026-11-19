# Operations

The runbook for the prototype. On Windows everything goes through `grc.ps1`, run from the
repository root in Windows PowerShell; on macOS and Linux through `grc.sh`, which has the
same commands ([below](#macos-and-linux-grcsh)); in a container through `docker compose`
and the image's `grc` command ([Docker](#docker)). The examples in this runbook use
`grc.ps1`. For first-time installation see [Installation](installation.md).

## Commands

| Command | What it does |
|---|---|
| `.\grc.ps1 start` | Starts the server in the background. Does nothing if it is already running. Runs `npm install` if `node_modules\` is missing, rebuilds the web application if any file under `web\` or `docs\user\` is newer than the last build, then waits for the health check (about 30 seconds) |
| `.\grc.ps1 stop` | Asks the server to shut down cleanly and waits up to 15 seconds. Only if that fails does it end the process by force |
| `.\grc.ps1 restart` | `stop`, then `start` |
| `.\grc.ps1 health` | Calls `/api/health` (over HTTPS when `GRC_TLS_CERT` is set, accepting a self-signed certificate for this local check). Prints `Healthy` or `Not responding.` (exit code 1) |
| `.\grc.ps1 status` | Version, port, process, size of the data folder, last backup, pending migrations and the backup schedule. See [Status](#status) |
| `.\grc.ps1 logs [-Lines n] [-Follow]` | Shows the end of the server logs (default 40 lines). `-Follow` keeps showing new error lines until Ctrl+C |
| `.\grc.ps1 seed [-Profile pilot\|dev]` | Loads data (default profile `pilot`). See [Installation](installation.md#5-load-data) |
| `.\grc.ps1 backup [-Prune n] [-Encrypt [-IncludeSecretKey]]` | Makes a verified copy of the data in `backups\<yyyyMMdd-HHmmss>\`, or with `-Encrypt` one encrypted file `backups\<yyyyMMdd-HHmmss>.tar.sgrc`. `-Prune n` then deletes all but the newest `n` backups. See [Backup](#backup) |
| `.\grc.ps1 backups` | Lists backups, newest first, with time, size, version, why each was taken and whether it is encrypted |
| `.\grc.ps1 verify-backup [<backup>]` | Checks every file of a backup against its checksums (default: the newest); an encrypted one is decrypted on the way, writing nothing |
| `.\grc.ps1 restore <backup> [-Force]` | Replaces the data with a backup (a folder, an encrypted file, or an archive the server took itself) after verifying it, keeping a safety copy of the current data. See [Restore](#restore) |
| `.\grc.ps1 schedule-backup [-At HH:mm] [-Prune n] [-Encrypt]` | Registers a daily stop-and-copy backup as a per-user Windows scheduled task. See [Scheduled backups](#scheduled-backups) |
| `.\grc.ps1 unschedule-backup` | Removes that task |
| `.\grc.ps1 export-all [-Out dir] [-NoSecrets] [-Encrypt]` | Writes every table as JSON Lines, plus attached files and a checksum report; `-Encrypt` writes one encrypted file instead. See [Export and import](#export-and-import) |
| `.\grc.ps1 import-all <dir or file>` | Loads an export (a folder, or an export file, encrypted or not) into an empty installation |
| `.\grc.ps1 decrypt <file> [-Out file.tar]` | Turns an encrypted backup or export into the plain tar file it holds, checking every part. See [Encrypted backups and exports](#encrypted-backups-and-exports) |
| `.\grc.ps1 new-key <file>` | Writes a new random key file for encrypted backups. Keep it outside the data folder |
| `.\grc.ps1 move-files -To s3` (or `-To disk`) | Moves every attached file to the object store (or back to the disk), checking each copy before deleting the original. Stops and restarts the server |
| `.\grc.ps1 upgrade [-From dir\|zip] [-Pull] [-SkipInstall] [-NoRollback]` | Backup, new code, `npm install`, build, migrations, restart, health check; if any step fails, puts the previous code, packages and data back and starts the previous version. See [Upgrading](#upgrading) |
| `.\grc.ps1 save-code` | Keeps a copy of the code as it is now (`backups\code\last-good.tar`) for `upgrade` to return to. `start` makes one the first time it runs |
| `.\grc.ps1 dev` | Development mode: stops the background server, then runs the API with file watching on port 8080 and the Vite development server on http://127.0.0.1:5173 (which proxies `/api` to port 8080). Ctrl+C stops both |
| `.\grc.ps1 build` | Builds the web application into `dist\web\` and shows the full build output |
| `.\grc.ps1 test` | Runs the automated tests (Vitest) |
| `.\grc.ps1 typecheck` | Type-checks the server and the web application |
| `.\grc.ps1 ci` | Local continuous integration: typecheck, tests and web build, with a pass or fail summary. Run it before every commit and push |
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
| `.\grc.ps1 npm install` | `./grc.sh install` (also fetches Node.js when no suitable one is found) |
| `.\grc.ps1 start`, `stop`, `restart`, `health`, `status` | `./grc.sh start`, `stop`, `restart`, `health`, `status` |
| `.\grc.ps1 logs -Lines 100 -Follow` | `./grc.sh logs --lines 100 --follow` |
| `.\grc.ps1 seed -Profile dev` | `./grc.sh seed --profile dev` |
| `.\grc.ps1 backup -Prune 14 -Encrypt -KeyFile <file>` | `./grc.sh backup --prune 14 --encrypt --key-file <file>` |
| `.\grc.ps1 backups`, `verify-backup`, `restore latest -Force` | `./grc.sh backups`, `verify-backup`, `restore latest --force` |
| `.\grc.ps1 export-all -Out <dir> -NoSecrets`, `import-all <dir>` | `./grc.sh export-all --out <dir> --no-secrets`, `import-all <dir>` |
| `.\grc.ps1 decrypt <file> -Out <tar>`, `new-key <file>`, `move-files -To s3` | `./grc.sh decrypt <file> --out <tar>`, `new-key <file>`, `move-files --to s3` |
| `.\grc.ps1 upgrade -From <zip> -SkipInstall -NoRollback`, `-Pull`, `save-code` | `./grc.sh upgrade --from <folder, .zip or .tar.gz> --skip-install --no-rollback`, `--pull`, `save-code` |
| `.\grc.ps1 schedule-backup -At 02:30 -Prune 14` (a Windows scheduled task) | `./grc.sh schedule-backup --at 02:30 --prune 14` prints a cron line, a systemd user timer and a launchd agent to add; `unschedule-backup` says how to remove them ([Scheduled backups](#scheduled-backups)) |
| `.\grc.ps1 dev`, `build`, `test`, `typecheck`, `ci` | `./grc.sh dev`, `build`, `test`, `typecheck`, `ci` (`ci` includes the pass with the clock on UTC) |
| `.\grc.ps1 npm <args>` | `./grc.sh npm <args>` |

Differences: `start` runs the server in the background with `nohup`, writing the same
`data/server.log` and `data/server.log.err`; `stop` asks for a clean shutdown the same way
and sends a terminate signal if that does not work within 15 seconds; `status` reports a
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
| Logs | `docker compose logs -f app` (the server writes to the container's output, not to files) |
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
| `data\grc.stop` | Created briefly by `stop` to request a clean shutdown |
| `data\server.log` | Standard output: the start-up line and the list of loaded modules |
| `data\server.log.err` | Errors: start-up failures, failed migrations, and unexpected errors in requests (`[error] METHOD URL`) |
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

- Both server log files are **overwritten at every start**. Copy them first if you need
  them. `.\grc.ps1 logs` shows the end of both.
- There is no request (access) log. The record of who did what is the audit log inside the
  application (Administration, Audit log).
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
Server backups: daily at 02:00 (Europe/London), keeping 14 to \\fileserver\backups\grc, encrypted; last good sandpiper-backup-20300131-020000.tar.sgrc, 7 hour(s) ago
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
- **Windows task** shows the scheduled backup task, if there is one, when it runs next and
  whether its last run succeeded.
- `npm run cli -- status --json` prints the same facts as JSON for a monitoring script.

## Health check

```powershell
.\grc.ps1 health
```

Or request `http://127.0.0.1:8080/api/health` directly; a healthy server answers
`{"ok":true}` without sign-in. The check proves the process is up and answering. It does
not test the database.

On a server installation use the address the server listens on (`https://...` when it has
a certificate). The container image checks it every 30 seconds with
`node deploy/healthcheck.mjs`, which follows `GRC_PORT` and `GRC_TLS_CERT`; `docker ps`
shows the result. Behind a reverse proxy, point the proxy's or load balancer's own health
check at `/api/health` as well.

## Clean shutdown, and why it matters

The database is embedded: it runs inside the server process and keeps its files in
`data\pg`. Two consequences follow.

- **Always stop with `.\grc.ps1 stop`.** A clean shutdown closes the database and flushes
  it to disk. Ending the process from Task Manager, or switching the machine off, skips
  that step and risks losing recent changes or damaging the database files.
- **Never run two processes on one data folder.** The embedded database allows one process
  at a time. The command-line tasks are a second process, so the server must be stopped
  while they run. `grc.ps1` handles this for you. If you run them directly with npm, they
  refuse to start while the process named in `data\grc.pid` exists.

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
  written with. To restore on another machine, put the key file beside the restored data
  folder under the same name, or set `GRC_SECRET_KEY` (or `GRC_SECRET_KEY_FILE`) before
  starting.
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

1. At the chosen time (checked every five minutes; a time missed while the server was down
   is caught up when it starts) the server exports every table **inside one transaction**,
   so the copy is consistent. Requests wait meanwhile: about two seconds for the invented
   sample data. Attached files on the local disk are added.
2. The export is packed into one file, `sandpiper-backup-<yyyyMMdd-HHmmss>.tar`, or
   `.tar.sgrc` when **Encrypt each backup** is on (the server must be started with
   `GRC_BACKUP_KEY_FILE`, `GRC_BACKUP_PASSPHRASE_FILE` or `GRC_BACKUP_PASSPHRASE`). It is
   made in `backups\.work-<process>\` and deleted from there afterwards.
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
with the current code's migrations and loads the export into it; the backup must not come
from newer code. Everything else is as described under [Restore](#restore). On a
PostgreSQL server, load it with `import-all <file>` into an empty database instead.

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
  between the embedded database and a server, or between versions.
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
4. **Keeps the current data** as a complete backup of its own, named
   `<timestamp>-pre-restore`, verified like any other.
5. Replaces the contents of the data folder with the backup and checks the result against
   the manifest again.
6. Starts the server again if it was running. Any migrations the backup has not had are
   applied at that start, and the command names them.

It reports what it verified, where the safety copy is, and which backup is now live.

- **To undo a restore**, restore the safety copy: `.\grc.ps1 restore <timestamp>-pre-restore`.
  Straight after a restore, the safety copy is the newest backup, so `restore latest` does
  exactly that.
- Everything recorded after the backup was taken is no longer in the application,
  including audit events. It is still in the safety copy.
- If the restore fails after step 4 (for example the disk fills), the command says so,
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
  working folder in `backups\`, checks it, and deletes the folder afterwards.
- **The secret key.** Unless the backup carried it (`-IncludeSecretKey`), `restore` does
  not touch the secret key and says where it is expected. Restoring onto the same machine
  needs nothing more; on another machine, put the key file in place first (see
  [Backup](#backup)).
- With a PostgreSQL server (`GRC_DATABASE_URL`), `restore` refuses: use `pg_restore`
  ([PostgreSQL server backups](#postgresql-server-backups)).

### Restore test

A backup is only known to be good once it has been restored. Do this after setting up
scheduled backups, and again every few months. It restores the newest backup into a
spare folder and runs the application from it on another port, without touching the live
data:

```powershell
$env:GRC_DATA_DIR = "$env:TEMP\grc-restore-test"; $env:GRC_PORT = '8099'
.\grc.ps1 restore latest        # "There was no existing data to keep."
.\grc.ps1 start                 # http://127.0.0.1:8099
.\grc.ps1 status
```

Sign in at http://127.0.0.1:8099 and check that recent records are there. Then:

```powershell
.\grc.ps1 stop
Remove-Item $env:GRC_DATA_DIR -Recurse -Force
Remove-Item Env:GRC_DATA_DIR, Env:GRC_PORT
```

Record the date of the test. If your backups are copied to another disk, test from that
copy (`.\grc.ps1 restore <path>`), since that is the one you will need.

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
their structure.

**Secrets.** A full export contains password hashes, second-factor secrets, recovery-code
hashes, sessions and one-time links, because an installation cannot be moved without
them. Protect it like a backup, or use `-Encrypt`. `-NoSecrets` leaves the rows of `sessions`,
`one_time_tokens`, `password_history`, `webauthn_credentials` and `webauthn_challenges`
(passkeys) out and blanks `password_hash`, `totp_secret`,
`totp_enabled` and `recovery_codes` on every user; the manifest marks those tables as
redacted. An export does not contain the secret key (`secret.key` or `GRC_SECRET_KEY`):
the second-factor secrets in a full export are encrypted, and the installation that
imports them needs the same key, or those people must have their second factor reset. Use that for handing data to someone for analysis. It is not a way to move a
working installation: after importing it nobody has a password, and there is no reset
command.

**The secret key is not in an export.** Authenticator keys are stored encrypted, and the
export carries them as stored. **Before** running `import-all` somewhere else, give the
target the same key: copy the key file (`data.secret.key`, beside the data folder) beside
the target's data folder under the target's name (`<target data folder>.secret.key`), or
set `GRC_SECRET_KEY` there. Without it the import itself succeeds, but anyone who has a
second factor cannot complete sign-in, because their authenticator key cannot be read.

### Import

```powershell
# On the target: a fresh installation that has never had the setup wizard completed.
.\grc.ps1 import-all D:\handover\grc
.\grc.ps1 start
```

`import-all`:

1. Verifies every file in the export against the manifest; a changed or missing file
   stops it.
2. Creates the database if there is none and applies all migrations (the import loads
   data into the current schema; it does not recreate the schema from the export).
3. Refuses unless the target is **empty**, meaning it has no users. It also refuses if the
   export has had migrations the target's code does not have (import into the same
   version or a newer one, with the same modules), or contains a table the target lacks.
4. In **one transaction**, clears the default rows the empty installation created for
   itself (roles, lookup values, settings), loads every table in dependency order, and
   moves each number sequence on past the highest imported value. If anything fails,
   nothing is loaded.
5. Copies the attached files into `data\files`.

Columns added by newer migrations take their default values. `schema_migrations` is not
imported: the target keeps its own record of what it applied.

**The audit log.** The audit table is append-only: a database trigger refuses any update
or delete of a row. The import respects that. Every exported audit event is inserted
unchanged, with its original number, time, actor, source address and content; nothing is
edited afterwards. Any events the empty target wrote while creating its own defaults are
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

**Moving to a PostgreSQL server later.** The export uses only standard PostgreSQL
(`row_to_json` to write, `json_populate_recordset` to load), so the same files will load
into a server once the application can run on one. That driver does not exist yet (see
[Known gaps](known-gaps.md)).

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
   `schema_migrations` table, so it is applied once; core first, then each module in
   alphabetical order. The command prints the ones it applied.
7. **Start and health check**, then `status`, and the new code is saved as
   `last-good.tar`.

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

### Stale pid file

After a crash or a forced end, `data\grc.pid` can be left behind. Every command checks
whether that process still exists and ignores or removes a stale file by itself, so
`.\grc.ps1 start` normally just works.

If `start` says "Already running" but the application does not answer, the process id has
been reused by another Node.js process. Confirm with `.\grc.ps1 status`, then delete
`data\grc.pid` (and `data\grc.stop` if present) and start again.

### A backup, restore or export says the server is running

The command-line tasks refuse to work while the process named in `data\grc.pid` exists.
Use `grc.ps1`, which stops the server for you, or stop it first.

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

If packages are missing or damaged, delete `node_modules\` and run `.\grc.ps1 npm install`.

### A page shows "Something went wrong"

The server logged the cause in `data\server.log.err` with the request method and address.
`.\grc.ps1 logs -Follow` shows new errors as they happen.

### Locked out

- A locked account unlocks by itself (the lock lasts from 1 to 15 minutes), or another
  administrator can unlock it under Administration, Users.
- A forgotten password needs another administrator to issue a reset link.
- If the only administrator cannot sign in, there is no break-glass account and no reset
  command. In a prototype, restore a backup or reset the database (below).

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
- The application makes no outbound calls: no telemetry, no externally hosted fonts or
  scripts, no email. Internet access is needed only to install or upgrade
  (`tools\install-node.ps1` and `npm install`).
- Data at rest is not encrypted by the application, apart from authenticator keys (whose
  key is `data\secret.key` unless you supply it another way). Anyone who can read the
  `data\` or `backups\` folders, or an export, can read everything else. Protect them with Windows file
  permissions and disk encryption.

### What must change before real use

The prototype is for evaluation on one machine. Before it holds real records for a team,
at least these must change:

1. A PostgreSQL server in place of the embedded database (supported: `GRC_DATABASE_URL`),
   with its own backups.
2. HTTPS (supported: a certificate or a trusted reverse proxy), and a deliberate decision
   about which network may reach it.
3. Backups that run when nobody is signed in, are copied off the machine, are encrypted,
   and raise an alert when one fails. (Verified backups, a daily schedule, pruning and a
   tested restore command exist today.)
4. Second factor switched to **Required** (it ships as a reminder); single sign-on if your organization uses it.
5. Monitoring and retained logs.

The full list is in [Known gaps](known-gaps.md). The route there is sketched in
[Architecture](architecture.md#path-to-production), and the current protections are
described in [Security](security.md).
