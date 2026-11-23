# E16 Hosting, operations and hardening

**Status:** in progress (35 of 39 issues done)

## Goal

Move from a prototype that runs on one machine for evaluation to a service a small team
can rely on: a real database server, encrypted connections, backups that are taken and
can be restored, automated checks on every change, and evidence that it is fast enough
and usable by everyone.

## Scope notes

- Today the application runs under a portable Node.js with an embedded Postgres
  database in the `data/` folder, started by `grc.ps1`. By default it listens on the local
  loopback address only, over plain HTTP. A PostgreSQL server (E16-05), HTTPS and trusted
  proxies (E16-07) and containers (E16-06) are each switched on by environment variables;
  see `docs/installation.md`, "Server installation".
- The SQL is real Postgres; both database drivers sit behind `server/src/core/db.ts`.
- Operations commands (backup, restore, export, import, status) are written in
  TypeScript under `server/src/ops/` and called through `server/src/cli.ts`, so they are
  tested and run on any operating system. `grc.ps1` is a thin Windows wrapper that stops
  and starts the server around them.
- Continuous integration is defined in `.github/workflows/ci.yml` (and locally `.\grc.ps1 ci`) for the repository's
  home on GitHub. Every job passed on `main` on 2026-11-19 (run 44472809393), including the
  tests on PostgreSQL 17 and the image publish.
- Hardening of sign-in is in [E02](E02-account-security.md). The license, contributing
  guide and security policy are tracked in [E17-13](E17-documentation.md).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E16-01 | One-command local operation | done | P1 |
| E16-02 | Embedded database with ordered migrations | done | P1 |
| E16-03 | Manual backup command | done | P1 |
| E16-04 | Health check | done | P2 |
| E16-05 | Run on a PostgreSQL server | done | P1 |
| E16-06 | Container images | done | P2 |
| E16-07 | HTTPS | done | P1 |
| E16-08 | Scheduled backups | done | P1 |
| E16-09 | Restore command | done | P1 |
| E16-10 | Upgrade command | done | P2 |
| E16-11 | Export-all and import-all commands | done | P3 |
| E16-12 | Continuous integration | done | P1 |
| E16-13 | Dependency scanning | done | P2 |
| E16-14 | Load testing | done | P2 |
| E16-15 | Accessibility audit | in progress | P2 |
| E16-16 | Server logging and log rotation | done | P3 |
| E16-17 | Unattended, off-machine backups with failure alerts | done | P1 |
| E16-18 | Automatic rollback of a failed upgrade | done | P2 |
| E16-19 | Show the installed version in the application | done | P3 |
| E16-20 | Detect a migration edited after release | done | P3 |
| E16-21 | One-command Node.js bootstrap | done | P2 |
| E16-22 | Status and logs commands | done | P2 |
| E16-23 | Repository hygiene for contributors | done | P2 |
| E16-24 | Encrypted backups and exports | done | P2 |
| E16-25 | Start, stop and schedule on Linux and macOS | done | P3 |
| E16-30 | Backup, restore and status commands that know about a database server | done | P1 |
| E16-31 | A least-privilege database role for the application | done | P2 |
| E16-32 | Publish the container image | done | P3 |
| E16-33 | Reload the TLS certificate without a restart | done | P3 |
| E16-34 | macOS and Linux scripts | done | P1 |
| E16-35 | Confirm the user services on a real systemd and launchd | done | P3 |
| E16-36 | Load test on a PostgreSQL server, and tune the slowest queries | done | P2 |
| E16-37 | Schema changes at run time without the owner account | done | P3 |
| E16-38 | Embedded database under load: Overview and global search, and scale 4 | done | P3 |
| E16-39 | Start-up work within the time limit at volume | done | P3 |
| E16-40 | Independent security review or penetration test | open | P2 |
| E16-41 | Load test with the database server on its own machine | in progress | P3 |
| E16-42 | User services across a restart of the machine, and the system examples, on real machines | in progress | P3 |
| E16-43 | Per-token request counts shared by every server process | done | P3 |

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
- [x] Runs on a schedule (`grc.ps1 schedule-backup`, E16-08; the server's own daily backups, E16-17)
- [x] Can be restored by a command (see E16-09)

**Implemented in:** `server/src/ops/backup.ts`, `files.ts`, `migrations.ts` (tests in `backup.test.ts`); `server/src/cli.ts` (`backup`, `backups`, `verify-backup`); `grc.ps1`

### E16-04 Health check

**Status:** done · **Priority:** P2 · **Type:** feature

As an operator or a monitoring tool, I can ask whether the application is up without
signing in.

**Acceptance criteria**

- [x] `GET /api/health` returns OK without a session
- [x] `grc.ps1 health` reports the result
- [x] The check also confirms the database answers (built in E22-33: `GET /api/ready`, a 2-second database check; `/api/health` stays a cheap liveness check)

**Implemented in:** `GET /api/health` (`server/src/core/auth.ts`); `grc.ps1`

### E16-05 Run on a PostgreSQL server

**Status:** done · **Priority:** P1 · **Type:** feature

As an operator, I point the application at a PostgreSQL server with a connection
setting, so that data is not tied to one process on one machine.

The whole test suite gives identical results through the server driver, locally with
`GRC_TEST_DATABASE=pg` (an embedded PostgreSQL 18 served over the wire protocol) and in
continuous integration against a separately running PostgreSQL 17 server: the job "Tests on
a database server (postgres-17)" passed on `main` on 2026-11-19 (run 44472809393), so its
`continue-on-error` was removed. The compose variant with PostgreSQL 17 also passes in CI.

**Acceptance criteria**

- [x] A connection string setting selects a server instead of the embedded database (`GRC_DATABASE_URL` or `_FILE`; password, TLS, schema, pool size and timeouts as separate settings)
- [x] All migrations and the full test suite pass through the server driver over the wire protocol (`GRC_TEST_DATABASE=pg`, locally and in continuous integration)
- [x] The same against a real PostgreSQL server in continuous integration (`GRC_TEST_DATABASE_URL`, job "Tests on a database server (postgres-17)"): first run green on 2026-11-19, now required
- [x] Connection pooling and transactions behave the same in both modes: same values (dates, numbers, json, arrays, intervals), one connection per transaction, rollback on error, the time zone on every connection; tested side by side in `db.test.ts`. One documented difference: outside a transaction, other queries are not held back while one runs
- [x] The embedded mode remains for local evaluation and tests (the default; an in-memory database never uses the configured server)
- [x] A documented path moves existing embedded data to a server (`export-all`, then `import-all` against the server; the export round-trip tests pass through the server driver)
- [x] Migrations and module SQL checked for embedded-only assumptions: none found (no extensions; `gen_random_uuid`, text search configurations, triggers and generated columns are standard). PostgreSQL 15 or later
- [x] `backup`, `restore` and `status` work in server mode (E16-30)
- [x] Performance on a server measured (E16-36)

**Implemented in:** `server/src/core/db.ts` (tests in `db.test.ts`); `.github/workflows/ci.yml` (job `database-server`); `docs/installation.md` (PostgreSQL server); `docs/operations.md` (PostgreSQL server backups); `docs/architecture.md` (Hosting)

### E16-06 Container images

**Status:** done · **Priority:** P2 · **Type:** feature

As an operator, I run the application and its database from published container
definitions with one command.

Verified on 2026-11-19 with Docker Desktop: the image builds, `docker compose up -d` starts the
quick start, setup, sample data and `grc backup` work inside the container, and the PostgreSQL
variant (`compose.postgres.yaml`) works including `pg_dump`. Earlier, before Docker was
available, the definitions were checked by reading only. The run commands the image uses were tried directly: the server starts under
plain Node.js 24 with `--experimental-transform-types` (no `tsx`) and answers its health
check, and `deploy/healthcheck.mjs` was exercised. The CI job builds the image, checks no
private files are in it, starts it with a read-only root filesystem and waits for it to
report healthy; it proves the rest on its first run.

**Acceptance criteria**

- [x] An image for the application, built in stages (web build, production packages, runtime), running as the non-root `node` user, all state under one volume, read-only root filesystem
- [x] A compose file with the application, the database and a volume for files: profiles `embedded` and `server`, secrets from files, published on 127.0.0.1 only
- [x] Configuration by environment variables only (secrets by `_FILE` variables)
- [x] A health check wired to `/api/health` (follows `GRC_PORT` and HTTPS)
- [x] `.dockerignore` never sends `seed/`, `data/`, `.tools/`, secrets or internal documents; CI checks the image
- [x] The image is built and started in continuous integration (job "Container image", passing)
- [x] Depends on E16-05
- [x] Published to a registry: tracked separately in E16-32

**Implemented in:** `Dockerfile`; `.dockerignore`; `compose.yaml`; `deploy/healthcheck.mjs`; `deploy/secrets/README.md`; `.github/workflows/ci.yml` (job `container`); `docs/installation.md` (Containers)

### E16-07 HTTPS

**Status:** done · **Priority:** P1 · **Type:** feature

As a user on another machine, I reach the application over an encrypted connection.

Run live with a self-signed certificate: health, setup (cookie marked `Secure`) and pages
in headless Edge over HTTPS (`tools/browse.mjs --insecure-tls`); plain HTTP on `0.0.0.0`
refused at start.

**Acceptance criteria**

- [x] The application runs behind a reverse proxy that terminates HTTPS (`GRC_TRUST_PROXY`, `GRC_ALLOW_INSECURE`), or serves HTTPS itself with a supplied certificate (`GRC_TLS_CERT`, `GRC_TLS_KEY`)
- [x] It trusts forwarded headers only from a configured proxy (addresses, ranges, keywords, or a hop count), so source addresses in the audit log, sessions and rate limits stay correct
- [x] Strict transport security is sent on HTTPS responses (`GRC_HSTS_MAX_AGE`, `GRC_HSTS_INCLUDE_SUBDOMAINS`)
- [x] The session cookie is marked secure ([E02-14](E02-account-security.md)): `auto` by default on HTTPS or behind a trusted proxy
- [x] Binding to a non-loopback address without HTTPS is refused, unless `GRC_ALLOW_INSECURE=1` declares a TLS proxy in front
- [x] A self-signed certificate for local testing, made without OpenSSL (`server/src/core/tls-selfsigned.ts`), documented as untrusted
- [x] Tested: listen decisions, trust lists, HSTS, forwarded headers from trusted and untrusted peers, and a real HTTPS listener

**Implemented in:** `server/src/core/http.ts`, `tls-selfsigned.ts` (tests in `http.test.ts`); `server/src/app.ts`; `server/src/main.ts`; `tools/browse.mjs` (`--insecure-tls`); `docs/installation.md` (HTTPS, Reverse proxy)

### E16-08 Scheduled backups

**Status:** done · **Priority:** P1 · **Type:** feature

As an operator, backups are taken every day without anyone remembering to, and old ones
are pruned.

`grc.ps1 schedule-backup` registers a per-user Windows scheduled task that needs no
administrator rights; `unschedule-backup` removes it. The task's action, trigger and
command line were built and the command line was run by hand against a scratch
installation, but the task was deliberately **not registered** on the development
machine, so the last criterion is open until someone confirms it on a real one. Reviewed
again on 2026-11-19: nothing else is missing. Confirming it needs a Windows machine where a
per-user scheduled task may be registered: run `.\grc.ps1 schedule-backup -At <in two
minutes>`, wait, check `status` and `backups\scheduled-backup.log`, then
`unschedule-backup`. The server's own daily backups (E16-17) need no scheduler meanwhile.

**Acceptance criteria**

- [x] The time of day and the number of backups to keep are chosen when scheduling (`-At HH:mm`, `-Prune n`)
- [x] Backups include the database and attached files
- [x] The settings in force (`GRC_*`) are written into the task, so it backs up the right folder
- [x] Each run adds a line with its result to `backups\scheduled-backup.log`, and `status` shows the task, its next run and its last result
- [x] The server is restarted after the backup even when the run is unattended
- [x] Registration, a scheduled run and removal confirmed on a real machine: on Windows 11 on 22 Nov 2026 (`schedule-backup -At <in two minutes> -Prune 3` on a separate installation; Task Scheduler ran it on time, it stopped the server, took a verified backup, started the server again and logged `exit 0`; `status` showed the task, its next run and the successful last run; `unschedule-backup` removed it). On macOS and Linux `schedule-backup` only prints the lines to add (cron, systemd timer, launchd); the systemd timer is covered by E16-42
- [x] A failed backup is reported to someone (the server's own daily backups, E16-17)
- [x] Backups can be written to a second location (E16-17)
- [x] An administration page shows the last successful backup (E16-17)
- [x] The task can encrypt (`schedule-backup -Encrypt -KeyFile`), and a cron entry and a systemd timer for Linux are documented

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
- [x] A failed migration leaves the previous version running from the backup, automatically (E16-18)
- [x] The installed version is shown in the application (built in E16-19: the Help page, `web/src/modules/help/HelpHome.tsx`, from `GET /api/version`)
- [x] Migrations are never edited once released: checksums at start and in `status`, and a CI check against the last release (E16-20)

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
- [x] Loaded into a PostgreSQL server (built in E16-05: `import-all` against `GRC_DATABASE_URL`; the round-trip tests in `export.test.ts` also run on PostgreSQL 17 in continuous integration)

**Implemented in:** `server/src/ops/export.ts` (tests in `export.test.ts`); `server/src/cli.ts` (`export-all`, `import-all`); `grc.ps1`; `docs/operations.md` (Export and import)

### E16-12 Continuous integration

**Status:** done · **Priority:** P1 · **Type:** feature

As a maintainer, every push and pull request runs the type check, the tests and a build
automatically, and cannot be merged when they fail.

Every job of the workflow passed on `main` on 2026-11-19 (run 44472809393): the checks on
Windows and Linux, the tests through the wire protocol and on PostgreSQL 17, installation
with `grc.sh` on Linux and macOS, the container image and compose, the browser suite, and the
image publish. What is left is a repository setting: on 2026-11-19 the GitHub API reported
`main` as not protected.

**Acceptance criteria**

- [x] A workflow runs install, `typecheck`, `test` and `build` on push and pull request, on Windows and Linux
- [x] The Node.js major version is pinned in one file (`tools/node-version.txt`) shared with the local bootstrap script
- [x] The private seed folder is never needed or read
- [x] The first run passes on both operating systems (and every other job), confirmed 2026-11-19
- [x] The main branch is protected by the checks (set on 2026-11-21: `Check (ubuntu-latest)`, `Check (windows-latest)`, `Released migrations unchanged` and `Tests on a database server (pglite-socket)` are required; force pushes and deletion are refused; the owner may still push past them)
- [x] A status badge in the README

**Implemented in:** `.github/workflows/ci.yml` (and locally `.\grc.ps1 ci`); `tools/node-version.txt`

### E16-13 Dependency scanning

**Status:** done · **Priority:** P2 · **Type:** feature

As a maintainer, I am told when a dependency has a known vulnerability or is out of
date.

**Acceptance criteria**

- [x] Update proposals are raised automatically: weekly, grouped, for npm packages and for the workflow's actions
- [x] An audit of dependencies runs in continuous integration and in local CI (`grc.ps1 ci`, `grc.sh ci`): `audit-deps` fails on a high or critical vulnerability in a production package when a fixed version exists, and lists without failing one nobody can fix yet; without a network it warns
- [x] The lock file is committed and checked: `package-lock.json` is in the repository and every CI job installs with `npm ci`
- [x] A policy says how quickly each severity must be dealt with (`docs/operations.md`, "Dependency vulnerabilities")

**Implemented in:** `server/src/ops/dependency-audit.ts` (tests in `dependency-audit.test.ts`); `server/src/cli.ts` (`audit-deps`); `grc.ps1`, `grc.sh` (`ci`, `audit-deps`); `.github/workflows/ci.yml` (step "Audit dependencies"); `.github/dependabot.yml`; `docs/operations.md`

### E16-14 Load testing

**Status:** done · **Priority:** P2 · **Type:** feature

As an operator, I know how the application behaves with realistic volumes and a
realistic number of people using it at once.

`tools/load/run.mjs` (Node.js built-ins only) starts a throw-away instance, creates an
invented volume through the API (at scale 1 about 22,000 records), measures the scenarios
below with several simulated people at once, and with `--ops` times the operations
commands. Results, targets and their limits are in `docs/operations.md`, "Performance and
load testing".

**Acceptance criteria**

- [x] A script generates a realistic volume of invented data (`tools/load/run.mjs`, `--scale`)
- [x] List, search, dashboard and save times are measured at that volume (50th, 95th and 99th percentile, with concurrency)
- [x] Backup, restore, export and import times are measured at that volume (`--ops`)
- [x] Targets are written down and the results recorded (`docs/operations.md`; first run at scale 0.5, about 10,500 records: several scenarios miss their targets, E16-36)
- [x] The slowest queries are indexed or rewritten (E16-36)
- [x] Run against a PostgreSQL server (E16-05), not only the embedded database (E16-36)

**Implemented in:** `tools/load/run.mjs`, `tools/load/README.md`; `docs/operations.md` (Performance and load testing)

### E16-15 Accessibility audit

**Status:** in progress · **Priority:** P2 · **Type:** feature

As a user who relies on a keyboard, a screen reader or high contrast, I can use every
screen.

Status in short: every automated part is done. The main journeys have been completed with a real
screen reader (NVDA) driven by a script, by keyboard only, which proves what is announced, where
the focus goes and that the keyboard is enough; it does not replace a walkthrough by a screen
reader user, which still needs a person.

**Acceptance criteria**

- [x] Every screen is checked with an automated accessibility tool; failures are fixed or listed (axe-core, WCAG 2.1 A and AA, every route plus each New dialog and the search window, light and dark at 1440 and 820; the last findings, E18-39, are fixed and the 19 Nov 2026 run found no violation)
- [x] The main journeys are completed with a screen reader, by an automated run (22 Nov 2026): `tools/sr/journeys.mjs` drives Edge by keyboard only with NVDA 2026.3 (portable, through Guidepup; nothing installed, no registry change) listening, as an administrator and as a service desk agent: sign-in with a second factor, a portal request, working a ticket, creating and scoring a risk, a safety event, the tag card, an inventory count, approving a workflow step, reading a dashboard (NVDA's heading and graphic keys) and changing a setting. Nine journeys completed; approving a workflow step is not proven (no step was waiting for the run's account; the journey now makes one but has not been re-run). It is a manual check, never part of the tests or CI; what NVDA said and where the focus went are in [Accessibility](../../accessibility.md#screen-reader-run). Fixed from it: focus and announcement on every change of page, focus kept when a button goes away or is busy, "Note added" and the comment box, the portal's choice groups and refused fields, risk scoring focus, ambiguous "Edit" buttons
- [ ] A screen reader user walks through the same journeys (NVDA or JAWS on Windows, VoiceOver on a Mac or iPhone) and their findings are raised; needs a person, not a script
- [x] Color contrast is checked in both themes (axe on every screen, and `tools/contrast.mjs` on the tokens)
- [x] Charts have a text alternative (each chart is labeled and ECharts writes a plain-English summary of its series and values)
- [x] Findings are raised as issues under [E18](E18-quality-and-known-defects.md) (E18-37 to E18-39; keyboard findings in E18-06)

- [x] The audit can fail the build: a serious or critical finding fails the run unless it is
  listed, with its issue, in `tools/a11y/known.json` (empty since E18-39 was fixed); entries
  that no longer match are reported as stale, so the list shrinks to empty as issues are fixed
  and the CI step needs no `--no-fail`

**Implemented in:** `tools/a11y/audit.mjs` (`npm run test:a11y`; report in
`tools/a11y/out/report.md`, git-ignored), `tools/a11y/known.json`, shared browser code in
`tools/e2e/lib/`. Screen reader run: `tools/sr/` (its own `package.json`, not part of the root
install, typecheck or tests; transcript in `tools/sr/out/`, git-ignored); focus after a change of
page and focus rescue in `web/src/core/routeFocus.ts`. Statement:
[`docs/accessibility.md`](../../accessibility.md).

### E16-16 Server logging and log rotation

**Status:** done · **Priority:** P3 · **Type:** debt

As an operator, I have structured request and error logs that rotate, so I can diagnose
a problem without the log file growing without limit.

**Acceptance criteria**

- [x] Structured logs with a request identifier: one JSON line per entry in `data/logs/grc.log`; one line per API request with the `X-Request-Id` the server sends back (also on audit events as `request_id`), method, path, status, duration and client address; everything written with `console.*` goes through the same log
- [x] Log level is a setting (`GRC_LOG_LEVEL`; also `GRC_LOG_DIR`, `GRC_LOG_CONSOLE` text, json or off, `GRC_LOG_REQUESTS`)
- [x] Logs rotate by size (`GRC_LOG_MAX_MB`, `GRC_LOG_FILES`), and the previous run's log survives a restart (`grc.log.1`)
- [x] No passwords, tokens, codes or restricted record content in logs: no query strings or bodies, secret field names masked, tokens, bearer values and connection-string passwords removed from text (tested)
- [x] `logs` shows the log readably (`grc.ps1`, `grc.sh`, `grc` in the container; `--level`, `--follow`); the container writes JSON to its output; the logs folder is left out of backups

**Implemented in:** `server/src/ops/logging.ts` (tests in `logging.test.ts`); `server/src/main.ts`; `server/src/cli.ts` (`logs`); `server/src/ops/backup.ts` (`isRuntimeFile`); `grc.ps1`, `grc.sh` (`logs`); `Dockerfile` (`GRC_LOG_CONSOLE=json`); `docs/operations.md` (Logs)

### E16-17 Unattended, off-machine backups with failure alerts

**Status:** done · **Priority:** P1 · **Type:** feature

As an operator, backups happen whether or not anyone is signed in, a copy leaves the
machine, and I am told when one fails.

**Acceptance criteria**

- [x] Backups run when nobody is signed in: a scheduler inside the server takes a daily
  backup at the time an administrator chooses (checked every five minutes; a missed time is
  caught up at start)
- [x] Each backup is written to a second location (a folder or network share, or the
  S3-compatible object store), read back from there and verified, and old ones there are
  pruned to the number to keep
- [x] A failed backup, and no good backup for two days, notify administrators through
  `app.notify` when the notifications module is loaded; both are audited
- [x] Administration > Backups shows the last successful backup and its age, the schedule,
  destination, encryption and the last 20 runs, with **Back up now**; `grc.ps1 status`
  shows the last result (from `data/backup-status.json`)
- [x] The schedule, destination, retention count and encryption are settings in the
  application (changing them needs a recent password confirmation)
- [x] A backup is taken without stopping the server: a logical export of every table inside
  one transaction (requests wait about two seconds for the sample data), packed into one
  archive, encrypted when a key is set; `restore` loads it into a new database
- [x] The schedule runs on the job queue rather than an in-process timer (built in E14-27: schedule `backups.schedule`)

**Implemented in:** `server/src/ops/online-backup.ts`, `export.ts` (catalog read once),
`backup.ts` (archive restore), `status.ts`; `server/src/modules/attachments/backups.ts`,
`migrations/002_storage_scanning_purge_backups.sql` (`backup_runs`), `backups.test.ts`;
`web/src/modules/attachments/BackupSettings.tsx`; `docs/operations.md` (Backups taken by the
server)

### E16-18 Automatic rollback of a failed upgrade

**Status:** done · **Priority:** P2 · **Type:** improvement

As an operator, when an upgrade fails I am back on the previous version without typing
anything.

**Acceptance criteria**

- [x] `upgrade` records the version it is moving from (`package.json`, in
  `backups/code/upgrade.json`) and keeps a copy of the code as a tar file
  (`tools/code-snapshot.mjs`, Node.js only), not depending on a version-control tool.
  `upgrade -From <folder|zip>` and `-Pull` put the new code in place themselves after
  saving the old; without them the copy saved by `start`, `save-code` or the last
  successful upgrade is used
- [x] On a failure from the new code onwards (including a failed migration, start or health
  check) it puts the previous code back (removing files the new version added under
  `server/src` and `web/src`), reinstalls packages if the package list changed, restores
  the pre-upgrade backup when the database may have changed, rebuilds and starts the
  previous version
- [x] The outcome is stated plainly either way (`ROLLED BACK` / `ROLLBACK INCOMPLETE` with
  the commands to finish by hand); `-NoRollback` keeps the old behavior
- [x] Tested with a migration that fails on purpose: rehearsed on a copy of the application
  (release with a broken migration: rolled back, previous version healthy);
  `server/src/ops/code-snapshot.test.ts` covers save, apply and restore
- [ ] A rollback after a package change works without network access. Not built, a deliberate
  limit: the rollback runs `npm install` for the previous version (or `-SkipInstall` and a
  manual install); keeping the previous `node_modules` aside would avoid it

**Implemented in:** `grc.ps1` (`upgrade`, `save-code`, `start`); `tools/code-snapshot.mjs`;
`server/src/ops/code-snapshot.test.ts`; `docs/operations.md` (Upgrading)

### E16-19 Show the installed version in the application

**Status:** done · **Priority:** P3 · **Type:** improvement

As a user reporting a problem, or an administrator after an upgrade, I can see which
version is running without access to the server.

The server side is built: `GET /api/version` and `grc version`. Left: showing it in the
web application (Help > About, or the user menu).

**Acceptance criteria**

- [x] The version (and commit, when known: `GRC_COMMIT`, built into the container image by CI, or read from the git checkout without running git) is returned by the API to everyone signed in; administrators also get the Node.js version, the kind of database and the start time
- [x] Shown under Help or Administration in the web application
- [x] `/api/health` does not reveal it to people who are not signed in (`/api/version` answers 401 without a session; tested)
- [x] The start-up line in the log names the version and commit; `grc version` prints them

**Implemented in:** `server/src/ops/version.ts` (`registerVersion`, tests in `version.test.ts`); `server/src/cli.ts` (`version`); `server/src/main.ts`; `Dockerfile` (`GRC_COMMIT`)

### E16-20 Detect a migration edited after release

**Status:** done · **Priority:** P3 · **Type:** debt

As a maintainer, I am stopped from changing a migration that installations have already
applied.

**Acceptance criteria**

- [x] A checksum of each migration is recorded when it is applied (SHA-256 of the text, line endings and byte-order mark ignored; filled in for migrations applied before checksums were kept)
- [x] Start-up and `status` warn when an applied migration's file no longer matches; the edit is never run
- [x] Continuous integration fails when a released migration file changes (job "Released migrations unchanged": compared with the newest `v*` tag; before the first release there is nothing to compare. Tried in a scratch clone with a tag: an edited migration is reported, a new one is not)
- [x] The rule is stated in `docs/development.md` and `CONTRIBUTING.md` once the first release is made (stated before v0.2.0; releases v0.1.0 and v0.1.1 exist)

**Implemented in:** `server/src/core/migrate.ts` (`migrationChecksum`, `changedMigrations`; tests in `migrate.test.ts`); `server/src/ops/migrations.ts` (`migrationFiles`, `readMigrationState`), `status.ts`; `.github/workflows/ci.yml` (job `released-migrations`); `docs/operations.md` (Status, Upgrading)

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
- [ ] The OpenPGP signature of the checksum list is verified. Not built, a deliberate limit: the list is fetched over HTTPS from nodejs.org and the scripts do not check its signature; the manual steps in `docs/installation.md` say how

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
- [x] A process file left by a crash is recognized as stale

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
- [x] A license: MIT (`LICENSE`)
- [x] Private vulnerability reporting is switched on in the repository's settings, and the labels the templates use exist (repository settings; switched on, and `type:bug` and `type:feature` created, 22 Nov 2026)

**Implemented in:** `CONTRIBUTING.md`; `SECURITY.md`; `.github/ISSUE_TEMPLATE/`; `.github/pull_request_template.md`; `.gitattributes`; `.editorconfig`

### E16-24 Encrypted backups and exports

**Status:** done · **Priority:** P2 · **Type:** feature

As an operator, a backup or export that leaves the machine cannot be read by whoever
finds it.

**Acceptance criteria**

- [x] `backup -Encrypt` and `export-all -Encrypt` (and the server's own backups) write one
  encrypted archive: a tar stream sealed with AES-256-GCM in 64 KiB chunks, streamed, with
  a documented format; the key is a 32-byte key file (`new-key`) or a passphrase (scrypt),
  from `-KeyFile`/`-PassphraseFile` or `GRC_BACKUP_KEY_FILE`/`GRC_BACKUP_PASSPHRASE(_FILE)`;
  a key file inside the data folder is refused
- [x] `restore`, `verify-backup` and `import-all` read it (verification decrypts and checks
  without writing); `decrypt` turns it into the plain tar file
- [x] Every chunk, the header and the order are authenticated with the key, so the manifest
  cannot be altered and re-signed without it; a wrong key, an altered byte and a cut-off
  file are refused (tested)
- [x] Losing the key is documented as losing the backup
- [x] The secret key (kept beside the data folder) is not in backups; it can be carried
  inside an encrypted backup only (`-IncludeSecretKey`, or the Backups page), and a restore
  puts it in place or adds it as a retired key

**Implemented in:** `server/src/ops/archive.ts`, `backup.ts`, `export.ts`
(`exportToArchive`, `unpackExport`), `secret-key.ts`, `archive.test.ts`; `server/src/cli.ts`
(`--encrypt`, `--include-secret-key`, `decrypt`, `new-key`); `grc.ps1`;
`docs/operations.md` (Encrypted backups and exports)

### E16-25 Start, stop and schedule on Linux and macOS

**Status:** done · **Priority:** P3 · **Type:** feature

As an operator on Linux or macOS, I have the same one-command operation as on Windows.

**Acceptance criteria**

- [x] A shell script offers `start`, `stop`, `restart`, `upgrade` and `logs` (`grc.sh`, E16-34)
- [x] A documented scheduled backup (`grc.sh schedule-backup` prints a cron entry, a systemd timer and a launchd agent; `deploy/systemd/` and `deploy/launchd/` have system examples; the server's own daily backup needs no scheduler)
- [x] Starting at boot or sign-in and after a crash: `./grc.sh service install|remove|status|print` writes a systemd user unit (Linux) or a launchd agent (macOS) with the settings in force (never a secret given directly); `start`, `stop` and the commands that stop the server keep working with it. System examples: `deploy/systemd/sandpiper-grc.service` (with `ExecReload` for a renewed certificate) and `deploy/launchd/org.sandpiper-grc.server.plist`
- [x] Covered by the Linux and macOS legs of continuous integration (start, health, seed, backup, status, version, logs, stop; the service files checked with `systemd-analyze verify` and `plutil -lint`)
- [x] Installing the user services on a real systemd session and launchd (E16-35)

**Implemented in:** `grc.sh` (`service`, `start_service`); `deploy/systemd/`; `deploy/launchd/`; `.github/workflows/ci.yml` (job `unix-install`); `docs/operations.md` (Running as a service on Linux and macOS); `docs/installation.md` (macOS service, Linux)

### E16-30 Backup, restore and status commands that know about a database server

**Status:** done · **Priority:** P1 · **Type:** feature

As an operator on a database server, the operations commands either do the right thing or
tell me what to do instead.

**Acceptance criteria**

- [x] `backup` in server mode refuses with the documented alternative (`pg_dump`; the
  server's own daily backups and `export-all` work in this mode)
- [x] `restore` in server mode refuses (`pg_restore`, or `import-all` into an empty database)
- [x] `status` names the database server (password hidden) and reports pending migrations
  by asking it, also while the application runs
- [x] `databaseUrl()` in `server/src/core/db.ts` is the switch used (`refuseServerDatabase`
  in `server/src/ops/backup.ts`; tested in `archive.test.ts`)

**Implemented in:** `server/src/ops/backup.ts`, `status.ts`, `migrations.ts`;
`docs/operations.md` (PostgreSQL server backups, Restore)

### E16-31 A least-privilege database role for the application

**Status:** done · **Priority:** P2 · **Type:** improvement

As a security lead, the application's database account cannot remove the audit log's
append-only trigger.

**Acceptance criteria**

- [x] Migrations can run as an owner role separate from the role the server uses at run time (`GRC_DATABASE_MIGRATE_URL` and `GRC_DATABASE_MIGRATE_PASSWORD(_FILE)`: at start, or with `migrate` from an administrator's session; `import-all` too)
- [x] The run-time role has only the privileges it needs, and cannot alter or drop triggers: after migrating, the owner grants it read and write on every table and sequence, no update, delete or truncate on the audit log, and reading only on the migration list (`grant-runtime-role` repeats it). Tested on the real PostgreSQL engine (embedded, with `set role`): rows can be written; the trigger, a table and the audit log cannot be changed; start-up with nothing pending works; a pending migration stops with a message naming the owner setting
- [x] Documented in `docs/installation.md` ("A least-privilege database role")
- [x] The same end to end on PostgreSQL 17 in continuous integration (step "Least-privilege database role" of the postgres-17 leg: green, and its `continue-on-error` removed in wave 12)
- [x] New custom fields need no owner at run time, and a changed search definition is queued for the owner's next run instead of failing (built in E16-37)

**Implemented in:** `server/src/ops/db-roles.ts` (tests in `db-roles.test.ts`); `server/src/core/migrate.ts` (tests in `migrate.test.ts`); `server/src/main.ts`; `server/src/cli.ts` (`migrate`, `grant-runtime-role`, `import-all`); `.github/workflows/ci.yml`; `docs/installation.md`

### E16-32 Publish the container image

**Status:** done · **Priority:** P3 · **Type:** feature

As an operator, I pull a versioned image rather than building one. A CI job publishes multi-arch images (amd64, arm64) to `ghcr.io/mdcrowley/sandpiper-grc`: `edge` from main; `x.y.z`, `x.y` and `latest` from `v*` tags.

Confirmed on 2026-11-19: the publish job passed on `main` (run 44472809393), the package is
public (an anonymous pull token is issued and the `edge` index lists linux/amd64 and
linux/arm64). No version tag has been pushed yet, so only `edge` exists and `compose.yaml`'s
default (`latest`) falls back to building from source.

**Acceptance criteria**

- [x] A release workflow builds for amd64 and arm64 and pushes to a registry (`edge` confirmed; the version tags follow the first `v*` tag)
- [x] The image is signed and has a software bill of materials: `sbom: true`, `provenance: mode=max` and `actions/attest-build-provenance` are in the publish job, and the job with its "Sign the build provenance" step passed on `main` on 2026-11-20 (run 44804003454) for `edge`; to be confirmed on the first version tag
- [x] `compose.yaml` can use the published image: works with `GRC_IMAGE=ghcr.io/mdcrowley/sandpiper-grc:edge`; the default `latest` needs the first release

**Implemented in:** `.github/workflows/ci.yml` (`publish`); release v0.1.0 on 2026-11-21 published `ghcr.io/mdcrowley/sandpiper-grc` as `0.1.0`, `0.1` and `latest` for amd64 and arm64 with provenance and a software bill of materials

### E16-33 Reload the TLS certificate without a restart

**Status:** done · **Priority:** P3 · **Type:** improvement

As an operator with short-lived certificates, a renewed certificate is used without
restarting the server.

**Acceptance criteria**

- [x] The server notices a changed certificate file (every `GRC_TLS_RELOAD_SECONDS`, default 60) or a signal (`SIGHUP` on Linux and macOS: `systemctl reload`, `docker kill -s HUP`) and uses it for new connections; open connections carry on
- [x] A broken new certificate is reported and the old one stays in use (not PEM, or a key that does not match, as when a renewal writes the two files one after the other; tried again when either file changes; a missing file is reported once)
- [x] Tested with a real HTTPS listener (`tls-reload.test.ts`) and run live: a renewed pair was served within the interval, a mismatched one refused with the old one kept

**Implemented in:** `server/src/core/http.ts` (`watchTlsFiles`, `tlsReloadSeconds`; tests in `tls-reload.test.ts`); `server/src/main.ts`; `deploy/systemd/sandpiper-grc.service` (`ExecReload`); `docs/installation.md` (HTTPS)

### E16-34 macOS and Linux scripts

**Status:** done · **Priority:** P1 · **Type:** feature

`grc.sh` mirrors `grc.ps1` on macOS and Linux, and `tools/install-node.sh` installs the pinned Node.js for the detected OS and CPU.

**Acceptance criteria**

- [x] Every applicable `grc.ps1` command exists in `grc.sh`
- [x] Tested in Git Bash and in a Linux container (x64 and arm64)
- [x] CI runs `grc.sh` on Ubuntu and macOS

### E16-35 Confirm the user services on a real systemd and launchd

**Status:** done · **Priority:** P3 · **Type:** feature

As an operator on Linux or macOS, I know `./grc.sh service install` works where I run it.
The unit and agent it writes, and the system examples in `deploy/`, were checked in continuous
integration with `systemd-analyze verify` and `plutil -lint` only, never installed and run: the
development machine is Windows. GitHub's runners can run them: the Linux runner's user systemd
manager is started with `loginctl enable-linger` (the runner has no sign-in session), and the
macOS runner has a signed-in launchd session.

**Acceptance criteria**

- [x] On Linux (GitHub's runner, systemd user manager started by lingering): `service install`, the health check, `restart`, `backup` (stops and starts the service), `status` and `service status`, a crash restarted by systemd, `stop` not restarted, and `service remove`
- [x] On macOS (GitHub's runner, launchd agent): the same
- [x] `status` reports the service; the step runs on every push that is not documentation only, in a few minutes
- A restart of the machine with lingering, and the system examples in `deploy/`, cannot run on a hosted runner: moved to E16-42

**Implemented in:** `.github/workflows/ci.yml` (job `unix-install`, step "User service on a real systemd or launchd"); `docs/operations.md` (Running as a service on Linux and macOS)

**Found by the first run (2026-11-21).** On macOS, `./grc.sh service install` worked but exited with an error: its last line was `[ "$kind" = systemd ] && echo …`, false under launchd. It is an `if` now (also in `service remove`), and `service status` uses `[[:space:]]` rather than `s` for the BSD grep on macOS. The Linux run passed every step.

### E16-36 Load test on a PostgreSQL server, and tune the slowest queries

**Status:** done · **Priority:** P2 · **Type:** improvement

As an operator, I know how the application behaves on the database a production
installation would use, and the slowest screens are made faster. The first measurements
(E16-14) are from the embedded database on one laptop.

Measured on 2026-11-19 (`docs/operations.md`, "Performance and load testing"). On a
PostgreSQL 17 server every scenario meets the server targets at scale 0.5 and 1 (lists
about 100 ms, full-text lists 126 ms, global search 312 ms, the Overview 593 ms, saves
81 to 129 ms at the 95th percentile, scale 0.5). On the embedded database lists, filtered
and sorted lists, full-text lists and saves now meet the embedded targets; the Overview and
global search under load do not, and are split into E16-38. The server ran in a container
on the same laptop rather than on its own machine; a run on separate machines is part of
E16-41 (split from E16-38).

**Acceptance criteria**

- [x] `tools/load/run.mjs` run against a PostgreSQL server (`GRC_DATABASE_URL`), results recorded beside the embedded ones (a PostgreSQL 17 container on the same machine; on its own machine: E16-41)
- [x] The slowest scenarios looked at with `explain analyze`, a CPU profile and the new slow statement log, and indexed or rewritten: planner statistics for the embedded database (it never ran `analyze`), list pages found on ids with the total from the same statement, full-text matches found once through the index, substring text in the search index with a trigram index (migration 009), global search reading only each type's matching index rows, value labels read only for the lists a type uses, service desk figures in one pass
- [x] Targets set realistically, separately for a PostgreSQL server and the embedded database
- [x] The run repeated at scale 1 (embedded with `--ops`, and on the server); it completed without a lost connection. The load tool retries a dropped request once, counts it, and reports an instance that stopped by itself. Scale 4: E16-38
- [x] Behavior unchanged: the same matches, order, totals and restrictions (tests in `core/platform.test.ts`, "full-text search"; `core/db.test.ts`, "performance aids"; the service desk figures tests)

**Implemented in:** `server/src/core/resource.ts` (list paging, full-text match, labels), `search.ts` (`bodySql`, trigger), `routes.ts` (`GET /api/search`), `db.ts` (`pg_trgm`, `makeAutoAnalyze`, `GRC_SLOW_QUERY_MS`), `core/migrations/009_search_performance.sql`; `server/src/modules/tickets/metrics.ts`; `tools/load/run.mjs`, `tools/load/README.md`; `docs/operations.md`

### E16-37 Schema changes at run time without the owner account

**Status:** done · **Priority:** P3 · **Type:** debt

As a security lead using a least-privilege database role (E16-31), adding a custom field
or upgrading to a version that searches different fields works without the owner account.
Today two things change the schema while the server runs: a new custom field adds a column
(`core/resource.ts`, `ensureCustomColumn`), and a changed search definition rebuilds a
trigger (`core/search.ts`). With the run-time role these fail (the field is refused; the
type falls back to plain matching) until `migrate` is run as the owner.

**Acceptance criteria**

- [x] Custom field values stored without a schema change, or the change run through the owner connection:
  the owner's run (`migrateAsOwner`) gives every record table the `custom` column up front
  (`addCustomColumns`), so a new custom field needs no schema change
- [x] Search triggers built only by migrations (or the owner), and the run-time role never attempts DDL:
  without the right to change a table (`maySchemaChange`: owner of the table and create on the
  schema) the server records the change in `schema_requests` (core migration 014) and logs it,
  keeps the earlier trigger (search keeps working), and the owner's next run rebuilds it from the
  application's definitions and clears the request; nothing stored is ever run. A SECURITY
  DEFINER function was considered and not used: it would give the run-time role a standing way
  to change the schema, and the trigger text it would need is built by the application
- [x] `ensureCustomColumn` checks that the column exists before `alter table`, so a restart logs no error (it looks in `information_schema.columns` first; test in `core/platform.test.ts`, "custom fields")

Note (E16-36): this release changes every search trigger once (substring text in `search_index.body`), so with the run-time role run `migrate` as the owner after upgrading, as for any change of search definition.

**Implemented in:** `server/src/core/resource.ts` (`ensureCustomColumn`), `core/search.ts`
(`maySchemaChange`, `requestSchemaChange`, `schemaChangeDone`, `ensureSearchIndex`,
`ensureCommentSearch`), `core/migrations/014_schema_requests.sql`, `server/src/ops/db-roles.ts`
(`addCustomColumns`, `pendingSchemaRequests`, `migrateAsOwner`); tests
`server/src/ops/db-roles-runtime.test.ts` (the run-time role taken inside `db.trial`: no DDL sent,
requests recorded; embedded, wire protocol and PostgreSQL 17), and checked by hand on PostgreSQL 17
with separate owner and run-time accounts (server as `grc_app`, a custom field added and used,
then `migrate` as the owner cleared the request and indexed the field)

### E16-38 Embedded database under load: Overview and global search, and scale 4

**Status:** done · **Priority:** P3 · **Type:** improvement

As an evaluator using the embedded database, the Overview and global search stay usable
when several people use the application at once. Split from E16-36: after tuning, each costs
little on its own (the Overview's calls about 120 ms together, global search about 95 ms at
scale 1), but with 8 people at once on the embedded database, which answers one statement
at a time, they took 2.3 s and 1.8 s at the 95th percentile at scale 0.5 (targets 2.5 s and
2 s were met in some runs and missed in others on a busy machine) and 3.7 s and 4.3 s at
scale 1.

**Acceptance criteria**

- [x] Fewer statements per request: the session and user lookup on every request (four statements today, `core/auth.ts`) made one, and settings read once per request
- [x] The Overview's figures cached for a short time or computed together, with figures still identical for every viewer
- [x] Global search with real text (a load-test vocabulary closer to real use than a hundred random words)
- [x] Scale 4 measured on the embedded database and on a PostgreSQL server (in a container on the same machine; on its own machine: E16-41)
- [x] The vulnerability type searched through the index (its records are a view, so it is matched by substring today)

**Outcome.** Measured before and after on copies of the same records (median of four runs of
each version at scale 0.5 on the embedded database, 8 people at once, 95th percentile): the
Overview 3.5 s to 0.7 s (with a ticket saved every second meanwhile, 2.6 s to 1.1 s), global
search 2.6 s to 1.3 s. At scale 1: global search 0.9 s, Overview 0.4 s; at scale 4 (about
82,000 records): global search 1.2 s, Overview 0.2 s, full-text list query 0.8 s, every list
under 0.5 s. On PostgreSQL at scale 1 the Overview went from 465 to 144 ms and global search
from 257 to 197 ms. Full table in `docs/operations.md`, "Performance and load testing".

Review fixes in this wave: a figure kept for one person was given to that person's API token
even when the token lacked the permission (a kept answer is given before the route checks
permissions; every key now holds the caller's permissions, also for "mine" figures); a
malformed query on a statistics route is not kept; global search failed ("could not determine
data type of parameter") when no searchable type had a reference number, as with only a few
modules loaded (the parameter is now added only when used); writes inside an import check
(`Db.trial`, always rolled back) are counted, so nothing read meanwhile is kept. The load
tool gained an Overview scenario with a save every second (the figures then are mostly
recomputed), `--seed-concurrency`, and unique names where a type requires them.

**Implemented in:** `server/src/core/auth.ts` (`sessionUser`), `core/routes.ts`
(`registerFiguresCache`, `FIGURE_ROUTES`, `GET /api/search`), `core/db.ts` (`Db.generation`,
`makeWriteCounter`), `core/search.ts` (`indexedTable`); tests `server/src/core/performance.test.ts`;
`tools/load/run.mjs`, `tools/load/README.md`; `docs/operations.md`, `docs/installation.md`
(`GRC_FIGURES_CACHE_SECONDS`)

### E16-39 Start-up work within the time limit at volume

**Status:** done · **Priority:** P3 · **Type:** defect

As an operator, the server starts on a large installation even when the machine is busy.
Once, at scale 1 on a busy machine, a start stopped with "A callback for 'onReady' hook
timed out": some start-up work took longer than Fastify's 10-second limit. Later starts of
the same folder took a few seconds.

**Acceptance criteria**

- [x] The start-up hook that ran long identified (time each `onReady` hook)
- [x] Long start-up work moved out of `onReady` (to the job queue or after listening), or the limit raised with a reason
- [x] A start of a scale-4 installation measured

**Outcome.** Every start-up step is timed and named after where it was added, together with
the parts before them (opening the database, migrations, modules and routes); the start is
logged when it, or one part, takes longer than `GRC_STARTUP_WARN_MS` (default 2,000). The
step that grows with the data is the search index (`core/resource.ts`), rebuilt at start
after an upgrade that changes how a type is searched: with every definition changed, a
scale-4 embedded installation (40,000 tickets) took 18.7 s for it. That work must finish
before search is right, so the limit per step was raised rather than the work moved: ten
minutes (`GRC_STARTUP_TIMEOUT_SECONDS`, default 600) instead of Fastify's 10 seconds. A
normal start of the scale-4 installation answered in 2.6 s. The embedded database's first
`analyze` waits until the start is over.

**Implemented in:** `server/src/app.ts` (`timeStartupSteps`, `startupTimeoutMs`, the start's
phases), `core/db.ts` (`makeAutoAnalyze` `waitForStart`); tests `server/src/core/performance.test.ts`
("start-up timing", "start-up time limit"); `docs/operations.md`, `docs/installation.md`

### E16-40 Independent security review or penetration test

**Status:** open · **Priority:** P2 · **Type:** feature

The application has had code reviews by its developers and automated checks (dependency
audit, the accessibility audit, tests of refusal paths), but no review by someone independent
of the code, and no penetration test of a running installation. An organization should have
one before it relies on the application for sensitive records.

**Acceptance criteria**

- [ ] A review or test by someone independent, against a running installation set up as for production
- [ ] Findings raised as issues, and the outcome summarized in `docs/security.md`

### E16-41 Load test with the database server on its own machine

**Status:** in progress · **Priority:** P3 · **Type:** improvement

Split from E16-38. Every PostgreSQL figure so far came from a server in a container on the
same laptop as the application and the load generator, so they shared its processors. A
pilot runs the database on its own machine (or a managed service).

**Wave 14 (2026-11-22), a stand-in on one laptop.** PostgreSQL 17 in a container limited to 2
processors and 2 GB as the "database machine", the application as its own process and the load
generator as a third, at scale 1 and 4, with the Overview opened by people in seven roles
(`run.mjs --roles 6`, new) and with `GRC_FIGURES_CACHE_SECONDS=0`. At scale 1 lists, saves and
the Overview meet the server targets with seven roles (Overview 268 ms at the 95th percentile);
global search (0.8 to 1.1 s) and sometimes the full-text list do not. At scale 4 two processors
were saturated about half the time and sorted and full-text lists, global search and the
Overview took 0.8 to 4.3 s. With the cache off the Overview roughly tripled at scale 1. Seeding
scale 4 with 16 writers at once had 30 of about 82,000 requests fail on the pool's 10-second
wait for a connection. Table and reading: `docs/operations.md`, "Performance and load testing".
**Still needed:** a database on a separate machine (or a managed service) with the application
and the load generator on others; that needs the machines, which a development laptop is not.

**Wave 15 (2026-11-23), search on the small database.** The statements behind global search and
the full-text list were read with `EXPLAIN ANALYZE` on the same stand-in at scale 1 and 4. Causes:
every search read the whole search index, because a part-of-a-word match was written `body ILIKE`,
which lowercases every row's text and which the planner expects to match far more rows than it
does, so the trigram index was not used even for a rare word (150 ms at scale 4 for a word in 2,000
records); global search kept one shared list of matches and read it again for each of some sixty
record types; a search of several words read every record table in full; and the full-text list
read the whole ticket table (for its exact-reference condition) and looked each matching index row
up again to rank it. Now migration 029 keeps a lowercased copy of the text (`search_index.body_lc`,
generated) with the trigram index on it, matched with `LIKE` (the same rows); global search groups
the matches into one row per type, counts them first so the database joins large types to their
tables in one pass, and finds several words through the index too; the full-text list joins the
matching index rows (ranked once each) to the records. Results, order, totals, restriction and
row rules are unchanged (`server/src/core/search-results.test.ts` compares them with the earlier
statements for both kinds of person). At the 95th percentile, scale 1: full-text list 240 to 266
ms before, 122 to 135 after; global search 588 to 727 before, 310 to 395 after (both server targets
now met). Scale 4: full-text list 1.2 to 1.4 s before, 0.41 after; global search 2.0 s before, 0.8
to 0.9 s after (still over the targets on two processors). Embedded database at scale 0.5: 0.35 to
0.42 s and 0.84 to 0.86 s before, 0.18 to 0.19 s and 0.36 to 0.38 s after. Figures:
`docs/operations.md`, "Search on the two-processor database".

**Acceptance criteria**

- [x] Global search and the full-text list read with `EXPLAIN ANALYZE` on the two-processor stand-in at scale 1 and 4 and tuned, results unchanged, the embedded database not slower (wave 15)
- [ ] `tools/load/run.mjs` at scale 1 and 4 with the database on a separate machine (or a managed PostgreSQL service), the application and the load generator on others (done with the database in a container limited to 2 processors and 2 GB on the same laptop; a separate machine still to do)
- [x] People with different roles in the Overview scenario (each set of permissions computes its own figures), and a run with `GRC_FIGURES_CACHE_SECONDS=0` (`--roles n` in `tools/load/run.mjs`)
- [x] Results recorded in `docs/operations.md` beside the others (for the stand-in; the separate-machine figures go beside them when measured)

**Implemented in:** `tools/load/run.mjs` (`--roles`), `tools/load/README.md`; `docs/operations.md`;
wave 15: `server/src/core/search-global.ts` (global search, moved out of `core/routes.ts`),
`server/src/core/resource.ts` (full-text list), `server/src/core/search.ts` (`bodyLike`),
`server/src/core/migrations/029_search_lowercase.sql`, `server/src/core/search-results.test.ts`

### E16-42 User services across a restart of the machine, and the system examples, on real machines

**Status:** in progress · **Priority:** P3 · **Type:** feature

Split from E16-35, which proves the user services on GitHub's runners. A hosted runner cannot be
restarted, and the system examples need their own account and folders.

**Linux, in a stand-in (2026-11-22).** A container from the official `debian:12` image with
Debian's `systemd` as process 1 was set up as `docs/installation.md` "Linux" says, with the
system service from `deploy/systemd/` and its backup timer, and an ordinary account with
`loginctl enable-linger` and `./grc.sh service install`; then the container was restarted and
nobody signed in. Both services came back and answered their health checks with no sign-in
session; the backup service, started by hand and by its timer (moved to the next minute by a
drop-in), stopped the server, took a verified backup labeled `scheduled` and started it again.
Nothing in `deploy/systemd/` or the documented steps needed changing. Details:
`docs/operations.md`, "Running as a service on Linux and macOS". **Still needed:** a real
Linux machine (a container restart does not boot a kernel, firmware or disks), and everything on
macOS (`deploy/launchd/` and the agent at sign-in after a restart). Those need a person with the
machines.

**Acceptance criteria**

- [ ] On a Linux machine: the user service with `loginctl enable-linger` starts after a restart of the machine with nobody signed in (shown in a systemd container across a container restart; a real machine still to do)
- [ ] On macOS: the launchd agent starts at sign-in after a restart
- [ ] The system examples `deploy/systemd/` and `deploy/launchd/` (with their daily backups) installed and run as documented (`deploy/systemd/` with its timer: done in the stand-in above; `deploy/launchd/`: not yet)

### E16-43 Per-token request counts shared by every server process

**Status:** done · **Priority:** P3 · **Type:** debt

As an operator running more than one application process against one PostgreSQL server, an
API token's request limit holds across all of them. Found while checking E02-18: the counts
behind `tokens.rate_per_minute` (`core/tokens.ts`), the `RateLimit` headers on token answers
(`core/api/conventions.ts`) and `mcp.rate_per_minute` (`modules/mcp/http.ts`) are kept in
process memory. A restart only resets the current minute, which is harmless; with several
processes each counts on its own, so a token can make that many requests a minute per process.
Wrong-token attempts by address and the provisioning (SCIM) token's limit are already kept in
the database (`core/ratelimit.ts`). The `If-Match` lock and the webhook worker, listed beside
it under "More than one process" in `docs/architecture.md`, are not part of this issue.

**Acceptance criteria**

- [x] The per-token counts are kept where every process sees them: table `request_counts`
  (core migration 028, unlogged: the counts are worth nothing after a crash), one row per bucket,
  token and clock minute of the database's clock, counted with one upsert per request
  (`countRequest` in `core/ratelimit.ts`). The same statement reads `tokens.rate_per_minute`,
  which was a query of its own before, so a token request makes no more round trips to the
  database than it did. Measured with a benchmark of 2,000 calls on the embedded database (not
  with `tools/load/run.mjs`, whose scenarios sign in with sessions and use no tokens): the
  statement takes about 0.7 to 1.1 ms against 0.2 to 0.4 ms for the settings read it replaces,
  so a token request costs roughly half a millisecond more, against 4 to 7 ms for the whole request
- [x] Passed minutes are removed by the recurring job `core.request_counts` (every 10 minutes,
  registered by `core/tokens.ts` once the application is ready)
- [x] The limit, the `RateLimit` headers and the MCP limit read the same count: the token check
  keeps the count it made on the request (`setTokenRate`/`tokenRateOf`) and the headers report
  it, so they no longer count a second time; a 429 from the limit reports `Remaining: 0` and
  `Retry-After` equal to `Reset`. The MCP limit counts `/mcp` requests in bucket `mcp` the same
  way, and its 429 now gives the seconds left in the minute as `Retry-After` (was always 60)
- [x] A test with two application instances on one database shows the limit holding across them
  (`server/src/core/request-counts.test.ts`: two `buildApp` instances on one database over the
  PostgreSQL wire protocol, a PGlite behind a socket, or a fresh database on the server named by
  `GRC_TEST_DATABASE_URL` on the PostgreSQL 17 leg; the token limit, the headers and the MCP limit)
- [x] `docs/security.md`, `docs/mcp.md` and `docs/architecture.md` no longer call the count per process
- Looked at the other counters named beside it: wrong-token attempts by address (`core/tokens.ts`)
  and failed mobile and connector token requests (`modules/mcp/oauth.ts`, used by
  `modules/mobile/signin.ts`) were already kept in the database (`makeDbLimiter`). Still per
  process (the policy kiosk's count moved to the database in E18-60): the `If-Match` lock (`core/api/conventions.ts`), which holds a record's check and write
  together in one process and needs a database lock held across the whole request to move

**Implemented in:** `server/src/core/ratelimit.ts` (`countRequest`, `pruneRequestCounts`,
`setTokenRate`, `tokenRateOf`), `server/src/core/migrations/028_request_counts.sql`,
`server/src/core/tokens.ts`, `server/src/core/api/conventions.ts`,
`server/src/modules/mcp/http.ts`; tests `server/src/core/request-counts.test.ts`,
`server/src/core/jobs/core-start.test.ts`
