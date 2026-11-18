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
- The repository has no remote and no continuous integration yet.
- Hardening of sign-in is in [E02](E02-account-security.md).

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
| E16-08 | Scheduled backups | open | P1 |
| E16-09 | Restore command | open | P1 |
| E16-10 | Upgrade command | open | P2 |
| E16-11 | Export-all and import-all commands | open | P3 |
| E16-12 | Continuous integration | open | P1 |
| E16-13 | Dependency scanning | open | P2 |
| E16-14 | Load testing | open | P2 |
| E16-15 | Accessibility audit | open | P2 |
| E16-16 | Server logging and log rotation | open | P3 |

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

**Implemented in:** `grc.ps1`; `server/src/main.ts`

### E16-02 Embedded database with ordered migrations

**Status:** done · **Priority:** P1 · **Type:** feature

As a developer, the database is created and brought up to date automatically at
start-up, core first and then each module, and each migration runs once.

**Acceptance criteria**

- [x] Migrations are SQL files applied in file-name order and tracked
- [x] Core migrations run before module migrations
- [x] An in-memory database is available for tests
- [x] A `migrate` command brings the database up to date without starting the server
- [x] No foreign keys across modules

**Implemented in:** `server/src/core/db.ts`, `migrate.ts`, `core/migrations/`; each module's `migrations/`; `server/src/cli.ts`

### E16-03 Manual backup command

**Status:** done · **Priority:** P1 · **Type:** feature

As the person running the prototype, I take a consistent copy of all data with one
command.

**Acceptance criteria**

- [x] `backup` stops the server, copies the data folder to a time-stamped folder, and restarts it
- [x] Logs and the process file are left out
- [x] The backups folder is git-ignored
- [ ] Runs on a schedule (see E16-08)
- [ ] Can be restored by a command (see E16-09)

**Implemented in:** `grc.ps1` (`backup`)

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
setting, so that data is not tied to one process on one machine.

**Acceptance criteria**

- [ ] A connection string setting selects a server instead of the embedded database
- [ ] All migrations and the full test suite pass against a server
- [ ] Connection pooling and transactions behave the same in both modes
- [ ] The embedded mode remains for local evaluation and tests
- [ ] A documented path moves existing embedded data to a server

### E16-06 Container images

**Status:** open · **Priority:** P2 · **Type:** feature

As an operator, I run the application and its database from published container
definitions with one command.

**Acceptance criteria**

- [ ] An image for the application, built in stages, running as a non-root user
- [ ] A compose file with the application, the database and a volume for files
- [ ] Configuration by environment variables only
- [ ] A health check wired to `/api/health`
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

**Status:** open · **Priority:** P1 · **Type:** feature

As an operator, backups are taken every night without anyone remembering to, old ones
are pruned, and I am told when one fails.

**Acceptance criteria**

- [ ] A schedule and a retention count are settings
- [ ] Backups include the database and attached files
- [ ] A failed backup is reported
- [ ] Backups can be written to a second location
- [ ] An administration page shows the last successful backup

### E16-09 Restore command

**Status:** open · **Priority:** P1 · **Type:** feature

As an operator, I restore a chosen backup with one command, and I have proved that it
works.

**Acceptance criteria**

- [ ] `restore <backup>` replaces the current data after taking a safety copy
- [ ] The command refuses to run while the server is up
- [ ] It checks the backup is complete before touching current data
- [ ] A restore test is part of the operations runbook

### E16-10 Upgrade command

**Status:** open · **Priority:** P2 · **Type:** feature

As an operator, I move to a new version with one command that backs up first, applies
migrations and tells me if anything went wrong.

**Acceptance criteria**

- [ ] `upgrade` takes a backup, installs dependencies, runs migrations, rebuilds the web app and restarts
- [ ] A failed migration leaves the previous version running from the backup
- [ ] The installed version is shown in the application
- [ ] Migrations are never edited once released

### E16-11 Export-all and import-all commands

**Status:** open · **Priority:** P3 · **Type:** feature

As an operator, I export everything to an open, documented format and load it into
another installation, so data is never locked in.

**Acceptance criteria**

- [ ] `export-all` writes every record type, the audit log and settings to files
- [ ] `import-all` loads them into an empty installation
- [ ] A round trip produces identical records
- [ ] Secrets (password hashes, second-factor keys) are left out unless asked for

### E16-12 Continuous integration

**Status:** open · **Priority:** P1 · **Type:** feature

As a maintainer, every push and pull request runs the type check, the tests and a build
automatically, and cannot be merged when they fail.

**Acceptance criteria**

- [ ] A workflow runs install, `typecheck`, `test` and `build`
- [ ] The private seed folder is never needed or read
- [ ] The main branch is protected by the checks
- [ ] A status badge in the README

### E16-13 Dependency scanning

**Status:** open · **Priority:** P2 · **Type:** feature

As a maintainer, I am told when a dependency has a known vulnerability or is out of
date.

**Acceptance criteria**

- [ ] An audit of dependencies runs in continuous integration
- [ ] Update proposals are raised automatically
- [ ] The lock file is committed and checked
- [ ] A policy says how quickly each severity must be dealt with

### E16-14 Load testing

**Status:** open · **Priority:** P2 · **Type:** feature

As an operator, I know how the application behaves with realistic volumes and a
realistic number of people using it at once. No load testing has been done.

**Acceptance criteria**

- [ ] A script generates a realistic volume of invented data
- [ ] List, search, dashboard and save times are measured at that volume
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
logging is switched off and output goes to one file that is never rotated.

**Acceptance criteria**

- [ ] Structured logs with a request identifier
- [ ] Log level is a setting
- [ ] Logs rotate by size or by day
- [ ] No passwords, tokens, codes or restricted record content in logs
