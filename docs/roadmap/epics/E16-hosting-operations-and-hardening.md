# E16 Hosting, operations and hardening

**Status:** in progress

## Goal

Move from a prototype that runs on one machine for evaluation to a service a small team
can rely on: a real database server, encrypted connections, backups that are taken and
can be restored, automated checks on every change, and evidence that it is fast enough
and usable by everyone.

## Scope notes

- Today the application runs under a portable Node.js with an embedded Postgres
  database in the `data/` folder, started by `grc.ps1`. It listens on the local
  loopback address only, over plain HTTP.
- The SQL is real Postgres, so moving to a database server is intended to be a driver
  change in `server/src/core/db.ts`.
- Operations commands (backup, restore, export, import, status) are written in
  TypeScript under `server/src/ops/` and called through `server/src/cli.ts`, so they are
  tested and run on any operating system. `grc.ps1` is a thin Windows wrapper that stops
  and starts the server around them.
- Continuous integration is defined in `tools/ci/github-actions-ci.yml` (switched off; local CI is `.\grc.ps1 ci`) for the repository's
  home on GitHub.
- Hardening of sign-in is in [E02](E02-account-security.md). The licence, contributing
  guide and security policy are tracked in [E17-13](E17-documentation.md).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E16-01 | One-command local operation | done | P1 |
| E16-02 | Embedded database with ordered migrations | done | P1 |
| E16-03 | Manual backup command | done | P1 |
| E16-04 | Health check | done | P2 |
| E16-05 | Run on a PostgreSQL server | open | P1 |
| E16-06 | Container images | open | P2 |
| E16-07 | HTTPS | open | P1 |
| E16-08 | Scheduled backups | in progress | P1 |
| E16-09 | Restore command | done | P1 |
| E16-10 | Upgrade command | done | P2 |
| E16-11 | Export-all and import-all commands | done | P3 |
| E16-12 | Continuous integration | in progress | P1 |
| E16-13 | Dependency scanning | in progress | P2 |
| E16-14 | Load testing | open | P2 |
| E16-15 | Accessibility audit | open | P2 |
| E16-16 | Server logging and log rotation | open | P3 |
| E16-17 | Unattended, off-machine backups with failure alerts | open | P1 |
| E16-18 | Automatic rollback of a failed upgrade | open | P2 |
| E16-19 | Show the installed version in the application | open | P3 |
| E16-20 | Detect a migration edited after release | open | P3 |
| E16-21 | One-command Node.js bootstrap | done | P2 |
| E16-22 | Status and logs commands | done | P2 |
| E16-23 | Repository hygiene for contributors | done | P2 |
| E16-24 | Encrypted backups and exports | open | P2 |
| E16-25 | Start, stop and schedule on Linux and macOS | open | P3 |

---

### E16-01 One-command local operation

**Status:** done · **Priority:** P1 · **Type:** feature

As the person running the prototype, I start, stop and check the application with one
script, with no administrator rights and nothing to install beyond a portable Node.js.

**Acceptance criteria**

- [x] `start`, `stop`, `restart`, `health`, `dev`, `seed`, `test`, `typecheck`, `build`, `backup`, `npm`
- [x] `start` builds the web app when it is out of date and waits until the server is healthy
- [x] `stop` asks for a clean shutdown before forcing one
- [x] `seed` stops and restarts a running server around the load
- [x] The server listens on 127.0.0.1 only
- [x] A command that stops the server for its work starts it again even when its own output is redirected or the work fails
- [x] The data, backup and web build folders and the port can each be moved with an environment variable (`GRC_DATA_DIR`, `GRC_BACKUP_DIR`, `GRC_WEB_DIST`, `GRC_PORT`)

**Implemented in:** `grc.ps1`; `server/src/main.ts`

### E16-02 Embedded database with ordered migrations

**Status:** done · **Priority:** P1 · **Type:** feature

As a developer, the database is created and brought up to date automatically at
start-up, core first and then each module, and each migration runs once.

**Acceptance criteria**

- [x] Migrations are SQL files applied in file-name order and tracked
- [x] Core migrations run before module migrations
- [x] An in-memory database is available for tests
- [x] A `migrate` command brings the database up to date without starting the server, and names the migrations it applied
- [x] No foreign keys across modules

**Implemented in:** `server/src/core/db.ts`, `migrate.ts`, `core/migrations/`; each module's `migrations/`; `server/src/cli.ts`

### E16-03 Manual backup command

**Status:** done · **Priority:** P1 · **Type:** feature

As the person running the prototype, I take a consistent copy of all data with one
command, and I can tell afterwards that the copy is whole.

**Acceptance criteria**

- [x] `backup` stops the server, copies the data folder (database and attached files) to a time-stamped folder, and restarts it
- [x] Logs and the process file are left out
- [x] The backups folder is git-ignored
- [x] Each backup has a manifest: application version, time, reason, applied migrations, and every file with its size and SHA-256
- [x] The copy is read back and compared with the original before the backup is kept; an interrupted backup is never mistaken for a complete one
- [x] Empty folders the database needs are recorded and recreated
- [x] `verify-backup` re-checks a backup at any time; `backups` lists them
- [x] `backup -Prune <n>` keeps the newest n and never deletes a folder it did not make
- [x] Refuses to run while the server has the data folder open
- [ ] Runs on a schedule (see E16-08)
- [x] Can be restored by a command (see E16-09)

**Implemented in:** `server/src/ops/backup.ts`, `files.ts`, `migrations.ts` (tests in `backup.test.ts`); `server/src/cli.ts` (`backup`, `backups`, `verify-backup`); `grc.ps1`

### E16-04 Health check

**Status:** done · **Priority:** P2 · **Type:** feature

As an operator or a monitoring tool, I can ask whether the application is up without
signing in.

**Acceptance criteria**

- [x] `GET /api/health` returns OK without a session
- [x] `grc.ps1 health` reports the result
- [ ] The check also confirms the database answers

**Implemented in:** `GET /api/health` (`server/src/core/auth.ts`); `grc.ps1`

### E16-05 Run on a PostgreSQL server

**Status:** open · **Priority:** P1 · **Type:** feature

As an operator, I point the application at a PostgreSQL server with a connection
setting, so that data is not tied to one process on one machine. Today the only driver
is the embedded database; the server driver has not been written.

**Acceptance criteria**

- [ ] A connection string setting selects a server instead of the embedded database
- [ ] All migrations and the full test suite pass against a server (also in continuous integration, with a database service)
- [ ] Connection pooling and transactions behave the same in both modes
- [ ] The embedded mode remains for local evaluation and tests
- [ ] A documented path moves existing embedded data to a server. `export-all` and `import-all` (E16-11) were written for this and use only standard PostgreSQL functions, but the import has not been run against a server
- [ ] `backup`, `restore` and `status` work in server mode (today they copy and read the embedded database's files)

### E16-06 Container images

**Status:** open · **Priority:** P2 · **Type:** feature

As an operator, I run the application and its database from published container
definitions with one command.

**Acceptance criteria**

- [ ] An image for the application, built in stages, running as a non-root user
- [ ] A compose file with the application, the database and a volume for files
- [ ] Configuration by environment variables only
- [ ] A health check wired to `/api/health`
- [ ] The image is built in continuous integration
- [ ] Depends on E16-05

### E16-07 HTTPS

**Status:** open · **Priority:** P1 · **Type:** feature

As a user on another machine, I reach the application over an encrypted connection.

**Acceptance criteria**

- [ ] The application runs behind a reverse proxy that terminates HTTPS, or serves HTTPS itself with a supplied certificate
- [ ] It trusts forwarded headers only from a configured proxy, so source addresses in the audit log stay correct
- [ ] Strict transport security is sent
- [ ] The session cookie is marked secure ([E02-14](E02-account-security.md))
- [ ] Binding to a non-loopback address without HTTPS is refused

### E16-08 Scheduled backups

**Status:** in progress · **Priority:** P1 · **Type:** feature

As an operator, backups are taken every day without anyone remembering to, and old ones
are pruned.

`grc.ps1 schedule-backup` registers a per-user Windows scheduled task that needs no
administrator rights; `unschedule-backup` removes it. The task's action, trigger and
command line were built and the command line was run by hand against a scratch
installation, but the task was deliberately **not registered** on the development
machine, so the last criterion is open until someone confirms it on a real one.

**Acceptance criteria**

- [x] The time of day and the number of backups to keep are chosen when scheduling (`-At HH:mm`, `-Prune n`)
- [x] Backups include the database and attached files
- [x] The settings in force (`GRC_*`) are written into the task, so it backs up the right folder
- [x] Each run adds a line with its result to `backups\scheduled-backup.log`, and `status` shows the task, its next run and its last result
- [x] The server is restarted after the backup even when the run is unattended
- [ ] Registration, a scheduled run and removal confirmed on a real machine
- [ ] A failed backup is reported to someone (see E16-17)
- [ ] Backups can be written to a second location (see E16-17)
- [ ] An administration page shows the last successful backup (see E16-17)

**Implemented in:** `grc.ps1` (`schedule-backup`, `unschedule-backup`, `backup -Label scheduled`, `status`); `docs/operations.md`

### E16-09 Restore command

**Status:** done · **Priority:** P1 · **Type:** feature

As an operator, I restore a chosen backup with one command, and I have proved that it
works.

**Acceptance criteria**

- [x] `restore <backup>` (a name, a path or `latest`) replaces the current data after taking a safety copy, which is itself a complete, verified backup that can be restored to undo
- [x] The command refuses to run while the server is up; `grc.ps1 restore` stops the server and starts it again afterwards
- [x] It checks the backup is complete before touching current data: every file's size and SHA-256, every folder, and nothing unlisted. A changed, missing or added file is refused
- [x] A backup made by newer code (migrations this code does not have) is refused unless forced
- [x] The restored files are checked against the manifest again; a failure part-way leaves the server stopped and names the safety copy
- [x] It reports what was verified, where the safety copy is, and which migrations will run at the next start
- [x] A restore test is part of the operations runbook
- [x] Tested: backup, change the data, restore, the data is back (a real database on disk); tampered backups are refused

**Implemented in:** `server/src/ops/backup.ts` (`restoreBackup`, `verifyBackup`; tests in `backup.test.ts`); `server/src/cli.ts` (`restore`); `grc.ps1`; `docs/operations.md` (Restore, Restore test)

### E16-10 Upgrade command

**Status:** done · **Priority:** P2 · **Type:** feature

As an operator, I move to a new version with one command that backs up first, applies
migrations and tells me if anything went wrong.

**Acceptance criteria**

- [x] `upgrade` takes a backup, installs dependencies, rebuilds the web app, runs migrations, restarts and checks health
- [x] It stops at the first failed step, leaves the server stopped, says whether the database may have changed, and prints the exact rollback commands naming the backup it took
- [x] `-SkipInstall` for a machine with no network access
- [ ] A failed migration leaves the previous version running from the backup, automatically (see E16-18)
- [ ] The installed version is shown in the application (see E16-19; `grc.ps1 status` shows it today)
- [ ] Migrations are never edited once released (see E16-20)

**Implemented in:** `grc.ps1` (`upgrade`); `server/src/cli.ts` (`migrate`, `backup --label pre-upgrade`); `docs/operations.md` (Upgrading)

### E16-11 Export-all and import-all commands

**Status:** done · **Priority:** P3 · **Type:** feature

As an operator, I export everything to an open, documented format and load it into
another installation, so data is never locked in.

**Acceptance criteria**

- [x] `export-all` writes every database table (records, lookups, settings, users, roles, links, comments, counters and the audit log) as JSON Lines, one file per table, plus the attached files, a manifest and a checksum report
- [x] `import-all` loads them into an empty installation, in one transaction, after verifying the checksums and applying migrations
- [x] A round trip produces identical records (tested table by table, including exact numbers, microsecond times, arrays, nested JSON, a self-reference and a generated column)
- [x] The append-only audit log is carried over by inserts only, keeps its numbering, records the import as a new event, and is still append-only afterwards; how is documented
- [x] Number sequences continue after the highest imported value
- [x] A changed export, a target that already has users, an export from newer code and a table the target lacks are each refused, and a failure loads nothing
- [x] Secrets (password hashes, second-factor keys, recovery codes, sessions, one-time links) can be left out with `-NoSecrets`. They are included by default, because an installation cannot be moved without them: there is no command to set a password from outside the application ([E02-13](E02-account-security.md))
- [ ] Loaded into a PostgreSQL server (see E16-05)

**Implemented in:** `server/src/ops/export.ts` (tests in `export.test.ts`); `server/src/cli.ts` (`export-all`, `import-all`); `grc.ps1`; `docs/operations.md` (Export and import)

### E16-12 Continuous integration

**Status:** in progress · **Priority:** P1 · **Type:** feature

As a maintainer, every push and pull request runs the type check, the tests and a build
automatically, and cannot be merged when they fail.

The workflow is written and has been read through carefully, but it cannot be run
outside GitHub, so it is unconfirmed until its first run there. In particular the Linux
leg has never been executed: imports were checked for exact letter case and the code for
Windows-only path handling, and nothing was found.

**Acceptance criteria**

- [x] A workflow runs install, `typecheck`, `test` and `build` on push and pull request, on Windows and Linux
- [x] The Node.js major version is pinned in one file (`tools/node-version.txt`) shared with the local bootstrap script
- [x] The private seed folder is never needed or read
- [ ] The first run passes on both operating systems
- [ ] The main branch is protected by the checks (a repository setting)
- [ ] A status badge in the README

**Implemented in:** `tools/ci/github-actions-ci.yml` (switched off; local CI is `.\grc.ps1 ci`); `tools/node-version.txt`

### E16-13 Dependency scanning

**Status:** in progress · **Priority:** P2 · **Type:** feature

As a maintainer, I am told when a dependency has a known vulnerability or is out of
date.

**Acceptance criteria**

- [ ] Update proposals are raised automatically (a Dependabot configuration is written but switched off, because it runs on GitHub Actions and the project uses no hosted automation)
- [ ] An audit of dependencies runs in continuous integration
- [ ] The lock file is committed and checked. Today `package-lock.json` is git-ignored, so the workflow falls back from `npm ci` to `npm install` and builds are not reproducible
- [ ] A policy says how quickly each severity must be dealt with

**Kept, switched off, in:** `tools/ci/dependabot.yml`

### E16-14 Load testing

**Status:** open · **Priority:** P2 · **Type:** feature

As an operator, I know how the application behaves with realistic volumes and a
realistic number of people using it at once. No load testing has been done.

**Acceptance criteria**

- [ ] A script generates a realistic volume of invented data
- [ ] List, search, dashboard and save times are measured at that volume
- [ ] Backup, restore, export and import times are measured at that volume (the export and import read whole tables into memory)
- [ ] Targets are written down and the results recorded
- [ ] The slowest queries are indexed or rewritten
- [ ] Run against a PostgreSQL server (E16-05), not only the embedded database

### E16-15 Accessibility audit

**Status:** open · **Priority:** P2 · **Type:** feature

As a user who relies on a keyboard, a screen reader or high contrast, I can use every
screen. No accessibility audit has been done.

**Acceptance criteria**

- [ ] Every screen is checked with an automated accessibility tool; failures are fixed or listed
- [ ] The main journeys are completed with a screen reader
- [ ] Colour contrast is checked in both themes
- [ ] Charts have a text alternative
- [ ] Findings are raised as issues under [E18](E18-quality-and-known-defects.md)

### E16-16 Server logging and log rotation

**Status:** open · **Priority:** P3 · **Type:** debt

As an operator, I have structured request and error logs that rotate, so I can diagnose
a problem without the log file growing without limit. Today the server's request
logging is switched off, and output goes to two files that are overwritten at every
start. `grc.ps1 logs` (E16-22) shows the end of them.

**Acceptance criteria**

- [ ] Structured logs with a request identifier
- [ ] Log level is a setting
- [ ] Logs rotate by size or by day, and the previous run's log survives a restart
- [ ] No passwords, tokens, codes or restricted record content in logs

### E16-17 Unattended, off-machine backups with failure alerts

**Status:** open · **Priority:** P1 · **Type:** feature

As an operator, backups happen whether or not anyone is signed in, a copy leaves the
machine, and I am told when one fails. Today the scheduled task (E16-08) runs only while
its user is signed in to Windows, writes to one folder, and records a failure only in a
log file and in `grc.ps1 status`.

**Acceptance criteria**

- [ ] Backups run when nobody is signed in (a service account, or a scheduler inside the server once it does not need to stop for a backup)
- [ ] Each backup is also copied to a second location and verified there
- [ ] A failed or missed backup raises an alert (depends on notifications, [E14-03](E14-platform-services.md))
- [ ] An administration page shows the last successful backup and its age
- [ ] The schedule and retention count are settings in the application
- [ ] A backup can be taken without stopping the server (needs E16-05, or an online dump of the embedded database)

### E16-18 Automatic rollback of a failed upgrade

**Status:** open · **Priority:** P2 · **Type:** improvement

As an operator, when an upgrade fails I am back on the previous version without typing
anything. Today `upgrade` stops, leaves the server down and prints the rollback
commands, because it does not know how to put the previous code back.

**Acceptance criteria**

- [ ] `upgrade` records the version it is moving from, in a way that does not depend on one version-control tool being installed
- [ ] On a failed migration, start or health check it restores the pre-upgrade backup, puts the previous code and packages back and starts the previous version
- [ ] The outcome is stated plainly either way
- [ ] Tested with a migration that fails on purpose

### E16-19 Show the installed version in the application

**Status:** open · **Priority:** P3 · **Type:** improvement

As a user reporting a problem, or an administrator after an upgrade, I can see which
version is running without access to the server. Today only `grc.ps1 status` shows it.

**Acceptance criteria**

- [ ] The version (and commit, when known) is returned by the API and shown under Administration or Help
- [ ] `/api/health` does not reveal it to people who are not signed in

### E16-20 Detect a migration edited after release

**Status:** open · **Priority:** P3 · **Type:** debt

As a maintainer, I am stopped from changing a migration that installations have already
applied. Today a migration is identified by its file name only, and editing one is
allowed while prototyping.

**Acceptance criteria**

- [ ] A checksum of each migration is recorded when it is applied
- [ ] Start-up (or `status`) warns when an applied migration's file no longer matches
- [ ] Continuous integration fails when a released migration file changes
- [ ] The rule is stated in `docs/development.md` and `CONTRIBUTING.md` once the first release is made

### E16-21 One-command Node.js bootstrap

**Status:** done · **Priority:** P2 · **Type:** feature

As the person installing the prototype, I get the right portable Node.js with one
command instead of downloading, checking and extracting it by hand.

**Acceptance criteria**

- [x] `tools/install-node.ps1` downloads the newest release of the pinned major version for Windows x64 from nodejs.org into `.tools\node`, with no administrator rights
- [x] The zip is checked against the published `SHASUMS256.txt`; a mismatch installs nothing
- [x] The major version is pinned in one place, `tools/node-version.txt`, which continuous integration also reads
- [x] An existing copy is left alone unless `-Force` is given; a copy in use is not half-replaced
- [x] A mirror address can be given for networks that cannot reach nodejs.org
- [ ] The OpenPGP signature of the checksum list is verified (the manual steps in `docs/installation.md` say how)

**Implemented in:** `tools/install-node.ps1`; `tools/node-version.txt`; `docs/installation.md`

### E16-22 Status and logs commands

**Status:** done · **Priority:** P2 · **Type:** feature

As an operator, one command tells me what is installed and whether it is healthy, and
another shows me the logs.

**Acceptance criteria**

- [x] `status` shows version, Node.js version, port, process, health, data folder and its size, the last backup and its age, the number of backups, and pending migrations
- [x] With the server running (the database cannot be opened by a second process) it says so and reports migration files changed since the start
- [x] It shows the scheduled backup task, its next run and its last result
- [x] The same facts are available as JSON (`npm run cli -- status --json`)
- [x] `logs` shows the end of both server logs; `-Lines n` and `-Follow`
- [x] A process file left by a crash is recognised as stale

**Implemented in:** `server/src/ops/status.ts`, `migrations.ts`, `files.ts`; `server/src/cli.ts` (`status`); `grc.ps1` (`status`, `logs`)

### E16-23 Repository hygiene for contributors

**Status:** done · **Priority:** P2 · **Type:** docs

As a contributor, the repository tells me how to set up, what the rules are, how to
report a problem, and it keeps line endings and whitespace consistent whatever machine I
use.

The project is released under the MIT License (`LICENSE`); `CONTRIBUTING.md` says so.

**Acceptance criteria**

- [x] `CONTRIBUTING.md`: set-up, the hard rules in brief, the documentation-and-roadmap rule, how to run the tests, the module pattern, links to `docs/development.md` and `docs/architecture.md`
- [x] `SECURITY.md`: latest version only; private reporting through the repository's security advisories; what to include; no bounty
- [x] Issue templates (feature, bug) that mirror the roadmap's issue format, and a link to private vulnerability reporting
- [x] A pull-request template with the "documentation and roadmap updated" checklist from the hard rules
- [x] `.gitattributes` stores text with LF line endings and checks out PowerShell scripts with CRLF; `.editorconfig` matches
- [x] A licence: MIT (`LICENSE`)
- [ ] Private vulnerability reporting is switched on in the repository's settings, and the labels the templates use exist (repository settings)

**Implemented in:** `CONTRIBUTING.md`; `SECURITY.md`; `.github/ISSUE_TEMPLATE/`; `.github/pull_request_template.md`; `.gitattributes`; `.editorconfig`

### E16-24 Encrypted backups and exports

**Status:** open · **Priority:** P2 · **Type:** feature

As an operator, a backup or export that leaves the machine cannot be read by whoever
finds it. Today both are plain folders containing everything, including password hashes;
with the default key file a backup also contains the key that protects authenticator
keys.

**Acceptance criteria**

- [ ] `backup` and `export-all` can write an encrypted archive, with the key supplied from outside the data folder
- [ ] `restore` and `import-all` read it, and verification still works
- [ ] The manifest is covered by an integrity check that someone who can alter the files cannot recompute
- [ ] Losing the key is documented as losing the backup

### E16-25 Start, stop and schedule on Linux and macOS

**Status:** open · **Priority:** P3 · **Type:** feature

As an operator on Linux or macOS, I have the same one-command operation as on Windows.
Today the application and the operations commands run there (`npm start`,
`npm run cli -- backup` and so on), but starting in the background, stopping, upgrading
and scheduling are done by `grc.ps1`, which is Windows only.

**Acceptance criteria**

- [ ] A shell script, or the command-line tool itself, offers `start`, `stop`, `restart`, `upgrade` and `logs`
- [ ] A documented scheduled backup (a timer or cron entry)
- [ ] Covered by the Linux leg of continuous integration
