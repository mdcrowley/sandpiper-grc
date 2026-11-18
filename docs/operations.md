# Operations

The runbook for the local prototype. Everything goes through `grc.ps1`, run from the
repository root in Windows PowerShell. For first-time installation see
[Installation](installation.md).

## Commands

| Command | What it does |
|---|---|
| `.\grc.ps1 start` | Starts the server in the background. Does nothing if it is already running. Runs `npm install` if `node_modules\` is missing, rebuilds the web application if any file under `web\` is newer than the last build, then waits for the health check (about 30 seconds) |
| `.\grc.ps1 stop` | Asks the server to shut down cleanly and waits up to 15 seconds. Only if that fails does it end the process by force |
| `.\grc.ps1 restart` | `stop`, then `start` |
| `.\grc.ps1 health` | Calls `/api/health`. Prints `Healthy` or `Not responding.` (exit code 1) |
| `.\grc.ps1 seed [-Profile pilot\|dev]` | Loads data (default profile `pilot`). Stops a running server first and starts it again afterwards. See [Installation](installation.md#5-load-data) |
| `.\grc.ps1 backup` | Copies the data folder to `backups\<yyyyMMdd-HHmmss>\`. Stops a running server first and starts it again afterwards |
| `.\grc.ps1 dev` | Development mode: stops the background server, then runs the API with file watching on port 8080 and the Vite development server on http://127.0.0.1:5173 (which proxies `/api` to port 8080). Ctrl+C stops both |
| `.\grc.ps1 build` | Builds the web application into `dist\web\` and shows the full build output |
| `.\grc.ps1 test` | Runs the automated tests (Vitest) |
| `.\grc.ps1 typecheck` | Type-checks the server and the web application |
| `.\grc.ps1 npm <args>` | Runs any npm command with the portable Node.js, for example `.\grc.ps1 npm install` |
| `.\grc.ps1` or `.\grc.ps1 help` | Prints the usage line |

Not built: `restore`, `upgrade`, `export-all`, `import-all`, scheduled backup. Restore and
upgrade are done by hand, as described below.

## Where things live

| Path | Contents |
|---|---|
| `data\pg\` | The database (embedded PostgreSQL files). This is all of the application's data |
| `data\grc.pid` | Process id of the running server. Written at start, removed at clean shutdown |
| `data\grc.stop` | Created briefly by `stop` to request a clean shutdown |
| `data\server.log` | Standard output: the start-up line and the list of loaded modules |
| `data\server.log.err` | Errors: start-up failures, failed migrations, and unexpected errors in requests (`[error] METHOD URL`) |
| `backups\` | Backups, one folder per run |
| `dist\web\` | The built web application served by the server |
| `seed\` | Private import files (see Installation) |

Notes:

- Both log files are **overwritten at every start**. Copy them first if you need them.
- There is no request (access) log. The record of who did what is the audit log inside the
  application (Administration, Audit log).
- If `GRC_DATA_DIR` is set, the database, pid file and logs are in that folder instead of
  `data\`. Backups still go to `backups\` in the repository.
- In `dev` mode the API writes to the console, not to the log files.

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
  at a time. The seed command is a second process, so the server must be stopped while it
  runs. `.\grc.ps1 seed` and `.\grc.ps1 backup` handle this for you: they stop the server,
  do the work and start it again. If you run the seed directly with npm, it refuses to
  start while `data\grc.pid` exists.

Windows has no terminate signal for background processes, so `stop` works by creating
`data\grc.stop`. The server checks for that file twice a second and shuts down when it
appears.

Users are interrupted during `seed`, `backup` and `restart`. Their sessions survive (they
are stored in the database), but requests fail while the server is down.

## Backup

```powershell
.\grc.ps1 backup
```

Copies everything in the data folder, except the pid file and the logs, to
`backups\<timestamp>\`. The server is stopped for the copy so that the database files are
consistent.

- There is no schedule. Run it yourself, or create a Windows scheduled task that runs
  `powershell -ExecutionPolicy Bypass -File <path>\grc.ps1 backup`.
- Backups are not encrypted and are never pruned. They contain everything in the
  application, including password hashes and second-factor secrets. Store them accordingly
  and delete old ones by hand.
- `backups\` is on the same disk as the data. Copy backups somewhere else as well.
- The private `seed\` folder is not included.

## Restore (by hand)

There is no restore command yet. To put a backup back:

```powershell
.\grc.ps1 stop
Rename-Item data data.before-restore                      # keep the current data until you are sure
New-Item -ItemType Directory data | Out-Null
Copy-Item backups\20300131-090000\* data -Recurse         # use the backup folder you want
.\grc.ps1 start
```

Check the application, then delete `data.before-restore`.

- Restore a backup into the same version of the code that made it, or a newer one. At
  start, any migrations the backup has not yet had are applied. There are no downward
  migrations, so a backup from newer code will not work with older code.
- Everything recorded since the backup is lost, including audit events.

## Upgrading

```powershell
.\grc.ps1 backup
git pull
.\grc.ps1 npm install
.\grc.ps1 restart
```

- Database migrations run automatically at every start, core first and then each module
  in alphabetical order. Each migration runs in a transaction and is recorded in the
  `schema_migrations` table, so it is applied once.
- If a migration fails the server does not start, and `data\server.log.err` names the
  migration (`Migration <module>/<file> failed: ...`). The failed migration is rolled
  back; earlier ones stay applied. Restore the backup if you need to go back to the old
  code.
- `restart` rebuilds the web application when files under `web\` have changed. To force a
  rebuild, run `.\grc.ps1 build` before starting.

## Troubleshooting

### "Portable Node.js is missing from .tools\node"

`.tools\node\node.exe` does not exist. See [Installation](installation.md#1-put-the-portable-nodejs-in-toolsnode).

### The script is blocked

"Running scripts is disabled on this system." Run it as
`powershell -ExecutionPolicy Bypass -File .\grc.ps1 start`, or see
[Installation](installation.md#if-the-script-is-blocked) for the other options.

### "Server did not become healthy"

Read `data\server.log.err`. The usual causes:

- **Port in use** (the log mentions `EADDRINUSE`). Something else is using port 8080. Find
  it with `Get-NetTCPConnection -LocalPort 8080 -State Listen` (the `OwningProcess` column
  is the process id), or use another port: `$env:GRC_PORT = '8081'; .\grc.ps1 start`.
- **A second process on the data folder.** Make sure no other copy of the server, no
  `dev` session and no seed is running against the same folder.
- **A failed migration.** See Upgrading above.
- **An unknown time zone** in `GRC_TIMEZONE`.
- **A slow first start.** Creating the database can take longer than the wait on a slow
  machine. Run `.\grc.ps1 health` a little later before assuming a failure.

### Stale pid file

After a crash or a forced end, `data\grc.pid` can be left behind. Every `grc.ps1` command
that looks for the server checks whether that process still exists and removes a stale
file by itself, so `.\grc.ps1 start` normally just works.

If `start` says "Already running" but the application does not answer, the process id has
been reused by another Node.js process. Confirm with `.\grc.ps1 health`, then delete
`data\grc.pid` (and `data\grc.stop` if present) and start again.

If you run the seed directly with npm and it says "The server appears to be running",
either stop the server or, when you are sure nothing is running, delete `data\grc.pid`.

### Build failures

`start` builds quietly. To see the full output, run:

```powershell
.\grc.ps1 build
.\grc.ps1 typecheck
```

If packages are missing or damaged, delete `node_modules\` and run `.\grc.ps1 npm install`.

### A page shows "Something went wrong"

The server logged the cause in `data\server.log.err` with the request method and address.

### Locked out

- A locked account unlocks by itself (the lock lasts from 1 to 15 minutes), or another
  administrator can unlock it under Administration, Users.
- A forgotten password needs another administrator to issue a reset link.
- If the only administrator cannot sign in, there is no break-glass account and no reset
  command. In a prototype, restore a backup or reset the database (below).

### Resetting a prototype database

To start again from nothing:

```powershell
.\grc.ps1 stop
Remove-Item data -Recurse -Force      # deletes everything, including users and the audit log
.\grc.ps1 start                       # the setup wizard appears again
```

Take a backup first if there is any chance you will want the data. This is acceptable for
a prototype only.

## Security posture of the prototype

- The server binds to `127.0.0.1` only. It cannot be reached from the network, and this
  is fixed in code, not a setting.
- There is no HTTPS. The session cookie is therefore not marked `Secure`.
- The application makes no outbound calls: no telemetry, no externally hosted fonts or
  scripts, no email. Internet access is needed only to install or upgrade.
- Data at rest is not encrypted by the application. Anyone who can read the `data\` or
  `backups\` folders can read everything. Protect them with Windows file permissions and
  disk encryption.

### What must change before real use

The prototype is for evaluation on one machine. Before it holds real records for a team,
at least these must change:

1. A PostgreSQL server in place of the embedded database.
2. HTTPS, and a deliberate decision about which network may reach it.
3. Scheduled, tested, off-machine backups and a restore procedure.
4. Second factor enforced, not just advised; single sign-on if your organisation uses it.
5. Rate limits that survive a restart and work across more than one process.
6. Monitoring and retained logs.

The full list is in [Known gaps](known-gaps.md). The route there is sketched in
[Architecture](architecture.md#path-to-production), and the current protections are
described in [Security](security.md).
