# Operations

The runbook for the local prototype. Everything goes through `grc.ps1`, run from the
repository root in Windows PowerShell. For first-time installation see
[Installation](installation.md).

## Commands

| Command | What it does |
|---|---|
| `.\grc.ps1 start` | Starts the server in the background. Does nothing if it is already running. Runs `npm install` if `node_modules\` is missing, rebuilds the web application if any file under `web\` or `docs\user\` is newer than the last build, then waits for the health check (about 30 seconds) |
| `.\grc.ps1 stop` | Asks the server to shut down cleanly and waits up to 15 seconds. Only if that fails does it end the process by force |
| `.\grc.ps1 restart` | `stop`, then `start` |
| `.\grc.ps1 health` | Calls `/api/health`. Prints `Healthy` or `Not responding.` (exit code 1) |
| `.\grc.ps1 status` | Version, port, process, size of the data folder, last backup, pending migrations and the backup schedule. See [Status](#status) |
| `.\grc.ps1 logs [-Lines n] [-Follow]` | Shows the end of the server logs (default 40 lines). `-Follow` keeps showing new error lines until Ctrl+C |
| `.\grc.ps1 seed [-Profile pilot\|dev]` | Loads data (default profile `pilot`). See [Installation](installation.md#5-load-data) |
| `.\grc.ps1 backup [-Prune n]` | Makes a verified copy of the data in `backups\<yyyyMMdd-HHmmss>\`. `-Prune n` then deletes all but the newest `n` backups. See [Backup](#backup) |
| `.\grc.ps1 backups` | Lists backups, newest first, with time, size, version and why each was taken |
| `.\grc.ps1 verify-backup [<backup>]` | Checks every file of a backup against its checksums (default: the newest) |
| `.\grc.ps1 restore <backup> [-Force]` | Replaces the data with a backup after verifying it, keeping a safety copy of the current data. See [Restore](#restore) |
| `.\grc.ps1 schedule-backup [-At HH:mm] [-Prune n]` | Registers a daily backup as a per-user Windows scheduled task. See [Scheduled backups](#scheduled-backups) |
| `.\grc.ps1 unschedule-backup` | Removes that task |
| `.\grc.ps1 export-all [-Out dir] [-NoSecrets]` | Writes every table as JSON Lines, plus attached files and a checksum report. See [Export and import](#export-and-import) |
| `.\grc.ps1 import-all <dir>` | Loads an export into an empty installation |
| `.\grc.ps1 upgrade [-SkipInstall]` | After new code is in place: backup, `npm install`, build, migrations, restart, health check. See [Upgrading](#upgrading) |
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
`server/src/cli.ts` (the code is in `server/src/ops/`); `grc.ps1` only stops and starts
the server around it. On a machine without PowerShell, stop the server yourself and run
the same commands directly:

```
npm run cli -- status
npm run cli -- backup --prune 14
npm run cli -- restore latest
npm run cli -- export-all --out /some/folder
npm run cli                      # lists every command
```

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
Version:     0.1.0 (Node.js v24.11.0)
Server:      running and healthy (process 5124)
Address:     http://127.0.0.1:8080 (port 8080)
Data folder: C:\grc\data (61.0 MB)
Last backup: 20300131-020000, 7 hour(s) ago, 61.0 MB (scheduled)
Backups:     14 in C:\grc\backups
Migrations:  18 in the code; applied when the server started; none changed since
Schedule:    backup task 'Sandpiper GRC backup (grc)' is Ready; next run 02/01/2030 02:00:00; last run 01/31/2030 02:00:03 succeeded
```

- **Server** is `stopped`, `running and healthy`, or `running but NOT answering the health
  check` (the process exists but the address does not respond: look at the logs).
- **Migrations**. While the server is stopped the database is opened and compared with the
  migration files in the code: `none pending`, or the names that will run at the next
  start. While the server is running the database cannot be opened by a second process;
  the server applied everything when it started, so the line reports only whether any
  migration file has changed since then (which means: restart, or better, `upgrade`).
- **Schedule** shows the scheduled backup task, when it runs next and whether its last
  run succeeded.
- `npm run cli -- status --json` prints the same facts as JSON for a monitoring script.

## Health check

```powershell
.\grc.ps1 health
```

Or request `http://127.0.0.1:8080/api/health` directly; a healthy server answers
`{"ok":true}` without sign-in. The check proves the process is up and answering. It does
not test the database.

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
- Backups are **not encrypted**. They contain everything in the application, including
  password hashes and second-factor secrets. Store them accordingly.
- Authenticator (second-factor) keys are encrypted in the database, but by default the
  key that opens them, `data\secret.key`, is in the data folder and so is copied into
  every backup beside the database. To keep backups free of usable authenticator keys,
  supply the key with `GRC_SECRET_KEY`, or set `GRC_SECRET_KEY_FILE` to a path outside
  the data and backup folders, and keep your own copy of that key somewhere safe: a
  restore needs the key the backup was made with. See [Installation](installation.md)
  and [Security](security.md).
- The key that encrypts authenticator keys is `data\secret.key` by default, so it is in
  the backup too, and a restore brings back the key that matches the data. If you keep
  the key somewhere else (`GRC_SECRET_KEY` or `GRC_SECRET_KEY_FILE`, see
  [Security](security.md)), it is **not** in the backup: keep your own copy of it, because
  a restored database is no use for second-factor sign-in without the key it was written
  with.
- By default `backups\` is on the same disk as the data. Set `GRC_BACKUP_DIR` to a folder
  on another disk, or copy backups elsewhere as well, and run `verify-backup` on a copy
  now and then.
- The checksums detect damage and incomplete copies. They are not a defence against
  someone who can rewrite both the files and the manifest.
- The private `seed\` folder is not included.

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
  (`0` is success) and what the backup reported. Nothing alerts you when a run fails:
  look at `.\grc.ps1 status`, which shows the last result and the age of the last backup.

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
```

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
them. Protect it like a backup. `-NoSecrets` leaves the rows of `sessions`,
`one_time_tokens` and `password_history` out and blanks `password_hash`, `totp_secret`,
`totp_enabled` and `recovery_codes` on every user; the manifest marks those tables as
redacted. An export does not contain the secret key (`secret.key` or `GRC_SECRET_KEY`):
the second-factor secrets in a full export are encrypted, and the installation that
imports them needs the same key, or those people must have their second factor reset. Use that for handing data to someone for analysis. It is not a way to move a
working installation: after importing it nobody has a password, and there is no reset
command.

**The secret key is not in an export.** Authenticator keys are stored encrypted, and the
export carries them as stored. **Before** running `import-all` somewhere else, give the
target the same key: copy `data\secret.key` into the target's (empty) data folder, or set
`GRC_SECRET_KEY` there. Without it the import itself succeeds, but anyone who has a
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
git pull                 # or put the new version's files in place
.\grc.ps1 upgrade
```

`upgrade` runs six steps and stops at the first failure:

1. **Backup** (`pre-upgrade`), stopping the server first. If the backup fails, nothing
   else happens.
2. **`npm install`** with the portable Node.js. `-SkipInstall` skips this on a machine with
   no network access, when the packages are already in place.
3. **Build** the web application.
4. **Migrations.** Each migration runs in a transaction and is recorded in the
   `schema_migrations` table, so it is applied once; core first, then each module in
   alphabetical order. The command prints the ones it applied.
5. **Start.**
6. **Health check**, then `status`.

If a step fails, the server is left **stopped** and the command prints what to do. It
says whether the database may have been changed (a failure in steps 2 or 3 cannot have
changed it; from step 4 on it may have) and gives the rollback:

```
To go back to the previous version:
  1. Put the previous code back (for example: git checkout <previous tag or commit>).
  2. .\grc.ps1 restore 20300131-101500        <- the backup this upgrade took
  3. .\grc.ps1 npm install
  4. .\grc.ps1 start
```

Step 2 of the rollback matters because there are no downward migrations: once a new
migration has run, the old code may not work with the database, so the data must go back
to the backup as well. A failed migration is itself rolled back; earlier new ones stay
applied. `data\server.log.err` (or `.\grc.ps1 logs`) names a migration that failed at
start (`Migration <module>/<file> failed: ...`).

To move to a newer Node.js patch release within the same major version, stop the server
and run `powershell -ExecutionPolicy Bypass -File .\tools\install-node.ps1 -Force`.

## Troubleshooting

### "Portable Node.js is missing from .tools\node"

`.tools\node\node.exe` does not exist. Run
`powershell -ExecutionPolicy Bypass -File .\tools\install-node.ps1`; see
[Installation](installation.md#1-put-the-portable-nodejs-in-toolsnode).

### The script is blocked

"Running scripts is disabled on this system." Run it as
`powershell -ExecutionPolicy Bypass -File .\grc.ps1 start`, or see
[Installation](installation.md#if-the-script-is-blocked) for the other options.

### "Server did not become healthy"

Run `.\grc.ps1 logs`. The usual causes:

- **Port in use** (the log mentions `EADDRINUSE`). Something else is using port 8080. Find
  it with `Get-NetTCPConnection -LocalPort 8080 -State Listen` (the `OwningProcess` column
  is the process id), or use another port: `$env:GRC_PORT = '8081'; .\grc.ps1 start`.
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

- The server binds to `127.0.0.1` only. It cannot be reached from the network, and this
  is fixed in code, not a setting.
- There is no HTTPS. The session cookie is therefore not marked `Secure` unless `GRC_COOKIE_SECURE` is set, which is only for running behind an HTTPS proxy (with `GRC_TRUST_PROXY`); see [Installation](installation.md).
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

1. A PostgreSQL server in place of the embedded database.
2. HTTPS, and a deliberate decision about which network may reach it.
3. Backups that run when nobody is signed in, are copied off the machine, are encrypted,
   and raise an alert when one fails. (Verified backups, a daily schedule, pruning and a
   tested restore command exist today.)
4. Second factor switched to **Required** (it ships as a reminder); single sign-on if your organisation uses it.
5. Monitoring and retained logs.

The full list is in [Known gaps](known-gaps.md). The route there is sketched in
[Architecture](architecture.md#path-to-production), and the current protections are
described in [Security](security.md).
