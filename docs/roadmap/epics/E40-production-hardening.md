# E40 Production hardening (wave 19 engineering gap analysis)

**Status:** done (15 of 15 issues done)

## Goal

Close the engineering gaps found by the wave 19 gap analysis before the application runs in
production: safe with more than one server process, migrations that cannot collide or time out, a
record save that is all or nothing, failures that someone hears about, and tests, queries and docs
that hold up at an organization's real size.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E40-01 | Several server processes on one database | done | P1 |
| E40-02 | PostgreSQL migrations: one at a time, no statement timeout | done | P1 |
| E40-03 | A record save is one transaction with its audit event | done | P1 |
| E40-04 | Alerts when background work fails, and operational metrics | done | P1 |
| E40-05 | A test that sweeps every route for permissions, restrictions and switched-off areas | done | P2 |
| E40-06 | The audit log at scale | done | P2 |
| E40-07 | Cleaning up expired sessions and one-time tokens | done | P2 |
| E40-08 | Browser tests on PostgreSQL, and a portal journey | done | P2 |
| E40-09 | Per-row queries and lists without paging | done | P2 |
| E40-10 | One working-day calendar for every deadline | done | P2 |
| E40-11 | Backup and recovery: runbook, targets, PostgreSQL backups, no request timeout | done | P2 |
| E40-12 | Smaller fixes: pool exhaustion, safety alerts once, scoring preview, shared date helpers, web tests, docs | done | P3 |
| E40-13 | Reference checks by module permission, and token scope for background model changes | done | P2 |
| E40-14 | Rotating secrets, and archiving the audit log under a least-privilege role | done | P3 |
| E40-15 | Change-based continuous integration and a template test database | done | P2 |

### E40-01 Several server processes on one database

**Status:** done · **Priority:** P1 · **Type:** debt · **Implemented in:** `server/src/core/resource.ts` (a save locks the record with `select ... for update`, checks `If-Match` against the locked row and puts the version in the `UPDATE` itself; custom values are merged into the `custom` column by the statement, changed keys only), `core/api/conventions.ts` (the in-process lock is gone; `req.recordIfMatch` carries the header to the save), `core/webhooks.ts` (`claim`: `update ... where id = (select ... for update skip locked) returning`, the next attempt moved past the time one send can take), `core/customfields.ts` (definitions trusted for 5 seconds, so a field added in one process reaches the others); test `core/multi-process.test.ts` (two applications on one database). The tests that need two transactions at the same moment (exactly one of two saves with the same `If-Match` wins; different custom values saved at once are all kept; two processes migrating at once) ran on PostgreSQL 17 locally (`GRC_TEST_DATABASE_URL`); the rest also run through the PostgreSQL wire protocol, whose single embedded session cannot keep two transactions apart. Still per process, and safe: the Overview figures cache (at most `GRC_FIGURES_CACHE_SECONDS`, 10 s by default, behind another process's write), the feature switches (5 s), the mail pause (each process pauses on its own failures), and the webhook worker's "already sending" flag (it only stops overlap inside one process). The data-folder lock still refuses two processes on one data folder.

**Acceptance criteria**

- [x] An update with `If-Match` checks the version in the database statement itself, so two processes cannot overwrite each other (custom-field values included)
- [x] The webhook worker claims the deliveries it sends, so a delivery goes out once across processes
- [x] Whatever else is still kept per process (the Overview cache, the mail pause) is either shared or documented as safe; `docs/operations.md` says how to run several processes (text handed to the coordinator)
- [x] A test runs two server instances on one database

### E40-02 PostgreSQL migrations: one at a time, no statement timeout

**Status:** done · **Priority:** P1 · **Type:** debt · **Implemented in:** `server/src/core/migrate.ts` (each migration's transaction runs `set local statement_timeout = 0`, takes `pg_advisory_xact_lock` for the schema and looks again whether the migration is recorded; `watchMigration` reports every `GRC_MIGRATION_REPORT_SECONDS`, 15 by default, with an index build's phase and progress or a wait for a lock on a PostgreSQL server); tests `core/migrate.test.ts`, `core/multi-process.test.ts`. Proven on the embedded database, through the wire protocol and on PostgreSQL 17 locally. The embedded database runs a statement on the server's own thread, so there a long migration is reported only when it ends. No `lock_timeout` is set: a migration waits for the locks of running work.

**Acceptance criteria**

- [x] Migrations take a PostgreSQL advisory lock, so two starting servers do not migrate at once (the second waits, then finds nothing to do)
- [x] Migrations run without the request statement timeout; long index builds are reported as they run
- [x] `docs/operations.md` says what to expect from a long migration on a large installation (text handed to the coordinator)

### E40-03 A record save is one transaction with its audit event

**Status:** done · **Priority:** P1 · **Type:** debt · **Implemented in:** `server/src/core/db.ts` (`Db.atomic`: as in the import check's trial, every query on the shared handle from the work goes into one transaction, which commits; atomic work inside other atomic work or a trial is a savepoint; `afterCommit` runs work after the commit, never after a rollback or in a trial; `inTrial()` is true while the transaction is open), `core/resource.ts` (create, update and delete, with their hooks, reference number, custom values, audit event and inherited restrictions, in one transaction; record-change listeners, so webhooks and watchers, after the commit), `core/webhooks.ts` (sending starts after the commit). Mail and push go through the job queue, whose row is now written in the save's transaction. Tests `core/atomic-save.test.ts` (a hook failing after the row is written, a nested save, an update, a delete whose audit event fails: nothing remains and nobody is told), plus the core tests and the tickets, risks, changes, vendors, inventory, fleet, models, safety, audits, workflows, lifecycles, portal and import tests on the embedded database and through the wire protocol. Left: the job queue starts work queued inside a save at its next poll (up to `GRC_JOBS_POLL_MS`) instead of at once until `core/jobs/queue.ts` uses `afterCommit`; record changes that module routes make outside the generic save are not yet one transaction.

**Acceptance criteria**

- [x] Creating, updating and deleting a record writes the row, its custom fields, its history and its audit event in one transaction; a failure leaves nothing half saved
- [x] Follow-on work that talks to the outside (webhooks, mail, push) is queued after the commit, never inside it
- [x] Tests force a failure after the row is written and prove nothing remains

### E40-04 Alerts when background work fails, and operational metrics

**Status:** done · **Priority:** P1 · **Type:** feature · **Implemented in:** `server/src/core/jobs/alerts.ts`, `watch.ts`, `ops.ts` (job `core.ops_watch`, table `ops_alerts`, migration `core/jobs/migrations/003_ops_alerts.sql`), `core/health.ts`, `core/monitoring.ts` (`GET /api/ops/metrics`, `GRC_METRICS_TOKEN`), `web/src/modules/notifications/JobsPage.tsx` (Problems being watched); tests `core/jobs/ops.test.ts`, `core/health.test.ts`. Proven by unit tests on the embedded database and through the PostgreSQL wire protocol; email is proven as far as queuing the message (no real mail server), and no real Prometheus scrape was run.

**Acceptance criteria**

- [x] A job that gives up, a mail, webhook or log-forwarder delivery that keeps failing, and a stalled job poller notify the administrators (in the application and by email), at most once per problem until it clears
- [x] `/api/ready` reports the job poller and the mail sender, not only the database
- [x] An operational metrics endpoint (Prometheus text format, off by default, behind a token) with request, job, queue and delivery figures; no personal data
- [x] Documented in `docs/operations.md`

### E40-05 A test that sweeps every route for permissions, restrictions and switched-off areas

**Status:** done · **Priority:** P2 · **Type:** test · **Implemented in:** `server/src/core/route-sweep.test.ts` (every registered route, about 1,500: signed out, each one that is not public answers 401; a person with no role is refused with 403 or 404 on the roughly 1,300 that name a permission, generated record routes included, and meets no server error on any route; with every optional area off, the roughly 1,050 routes of the areas answer 404 `switched_off` to an administrator, and no route of the parts always on does), and 22 new `route-behavior.test.ts` files (`core/` and the holds, attachments, safety, condition, projects, tickets, changes, people, continuity, admin (single sign-on), training, governance, secincidents, feeds, frameworks, policies, reports, tags, mcp, audits and funding modules; 74 tests) for the routes no test named. Proven on the embedded database, on UTC and through the PostgreSQL wire protocol. Restricted records are still checked module by module, not by the sweep. The behavior tests found one bug, kept as an `it.fails` test in `core/route-behavior.test.ts`: `DELETE /api/links/:id` checks only the record the link starts from, so someone may remove a link to a restricted record they cannot see.

**Acceptance criteria**

- [x] A test calls every registered route as a person without its permission and expects a refusal, and with every optional area off expects `switched_off` for the area's routes
- [x] The 40 routes no unit test names today each get a behavior test (the security-relevant ones first: legal-hold queries, the attachments purge, safety clocks and report rules, asset-class target approvals, project gate document waivers, ticket approvals, change blackouts, and the people and continuity figures, proven identical for viewers with and without `security.view` and `privacy.view`). The user provisioning (SCIM) and vehicle and asset model routes were left to the work on those areas in the same wave

### E40-06 The audit log at scale

**Status:** done · **Priority:** P2 · **Type:** debt · **Implemented in:** `core/routes.ts` (`GET /api/audit` counts at most 10,000 matching events: `totalCapped`, `hasMore`; `actor_id` compared as a uuid), migration `core/migrations/030_sessions_and_audit_scale.sql` (person and action indexes; the append-only trigger lets only the archive's own transactions delete), `core/audit-archive.ts` (job `core.audit_archive`, `/api/audit/archive`), `web/src/modules/admin/AuditLog.tsx` and `AuditArchive.tsx`; tests `core/audit-scale.test.ts`, `web/src/modules/admin/AuditLog.component.test.ts`. A least-privilege run-time role has no delete on the audit log, so the archive cannot run there; the page says so.

**Acceptance criteria**

- [x] The Audit page does not count the whole table on every page (an estimate or "more than N"), and the person filter uses an index
- [x] Audit events older than a setting can be archived to a file and removed, with the archive itself audited; nothing is removed by default

### E40-07 Cleaning up expired sessions and one-time tokens

**Status:** done · **Priority:** P2 · **Type:** debt · **Implemented in:** `core/jobs/ops.ts` (daily job `core.session_cleanup`), migration `core/migrations/030_sessions_and_audit_scale.sql` (`sessions (user_id, expires_at)`, `sessions (expires_at)`, one-time links by person and by expiry); test `core/jobs/ops.test.ts` (the plan for one person's sessions uses the index). The users list keeps its per-person count, now an index lookup per listed person instead of a read of every session.

**Acceptance criteria**

- [x] A daily job deletes expired sessions and used or expired one-time tokens; `sessions.user_id` is indexed
- [x] The users list no longer scans all sessions

### E40-08 Browser tests on PostgreSQL, and a portal journey

**Status:** done · **Priority:** P2 · **Type:** test · **Implemented in:** `tools/e2e/suites/23-portal.mjs` (a person with only the Requester role, at 390 px light and 1440 px dark: a catalog request, a problem report from the search box, following a request through an agent's question and the person's reply, acknowledging a policy, no agent pages, no other person's requests, no sideways scrolling), `tools/e2e/lib/instance.mjs` (`E2E_DATABASE_URL`: a fresh `grc_e2e_…` database per run, dropped afterward; a `GRC_DATABASE_URL` in the environment never reaches the test instance) and the browser-test job of `.github/workflows/ci.yml` (a PostgreSQL 17 service and a part that runs `01-smoke`, `16-records` and `23-portal` on it). The portal suite passed on the embedded database and through the PostgreSQL wire protocol; the PostgreSQL 17 part is proven only once GitHub runs it.

**Acceptance criteria**

- [x] Continuous integration runs a part of the browser suite against PostgreSQL
- [x] A browser suite covers the self-service portal end to end (ask, report, follow a request, acknowledge a policy)

### E40-09 Per-row queries and lists without paging

**Status:** done · **Priority:** P2 · **Type:** debt · **Implemented in:** `modules/workflows/routes.ts` (`visibleRecords`, `approvalItems`: the records, decisions and stand-in names of the waiting, decided and requested approvals are read once per kind; `mayDecide` reads more only for steps with stand-ins or "a different person per step"), `modules/attachments/index.ts` (`findParents`), `modules/governance/decisions.ts` (a meeting's decisions and the chair's waiting decisions), `modules/continuity/processes.ts` (`dependenciesOf`); `modules/holds/service.ts` (`holdRecords` pages in SQL: `state`, `page`, `pageSize` up to 500; the counts stay whole), `modules/controls/coverage.ts` (`page`, `pageSize`, and the `state` and `type` filters on the server), `modules/fleet/services.ts` (`/api/fleet/impact` lists at most `limit`, 500 by default), `modules/fleet/equipment.ts` (`/api/fleet/coverage` pages), `modules/audits/coverage.ts` (pages the areas, reads only the audits of the years shown, counts `covered` in SQL); page numbers on the legal hold, control coverage, equipment coverage and audit coverage pages, and a note on What is affected. Test `core/per-row-queries.test.ts` counts the statements with few rows and with more (the same) and checks each page and count, on the embedded database and through the PostgreSQL wire protocol. Not timed on a large real installation.

**Acceptance criteria**

- [x] The approvals inbox, expiring evidence, decisions and continuity processes load related rows in one query per kind, not per row
- [x] Legal-hold records, the control coverage matrix, fleet impact and coverage, and audit coverage page or limit their answers

### E40-10 One working-day calendar for every deadline

**Status:** done · **Priority:** P2 · **Type:** feature · **Implemented in:** `shared/working-days.ts` (the arithmetic), `server/src/core/working-days.ts` (`workingCalendar`, `setWorkingCalendarSource`, `toWorkingCalendar`: the service desk's **Business hours** calendar, its open weekdays and its holidays; Monday to Friday when the tickets module is not loaded or the calendar is retired), `modules/tickets/index.ts` (offers it), `modules/records/settings.ts` and `requests.ts` (due dates and extensions; `GET /api/records/settings` names the calendar and its number of holidays), `web/src/modules/records/Requests.tsx`; guide pages 37 (Deadlines) and 02 (Calendars and holidays). Tests `shared/dates.test.ts` and `modules/records/records.test.ts`. Records requests are the only deadline counted in working days today; the calendar can be changed only while the service desk is switched on.

**Acceptance criteria**

- [x] Records-request due dates and every other "working days" deadline use the organization's holiday calendar, the same one the service desk uses
- [x] The guide explains where the calendar is kept

### E40-11 Backup and recovery: runbook, targets, PostgreSQL backups, no request timeout

**Status:** done · **Priority:** P2 · **Type:** docs · **Implemented in:** `docs/operations.md` (Recovery runbook; PostgreSQL server backups), `deploy/postgres/pg-backup.sh`, `server/src/modules/attachments/backups.ts` (job `backups.run_now` in lane `backups`, progress on `backup_runs`, the pg_dump folder check; migration `attachments/004_backup_progress_and_pg_dumps.sql`), `server/src/ops/online-backup.ts` and `ops/export.ts` (progress), `web/src/modules/attachments/BackupSettings.tsx`; tests `modules/attachments/backups.test.ts`, `web/src/modules/attachments/BackupSettings.component.test.ts`. The script was run with stand-in `pg_dump` and `pg_restore` commands, not against a real PostgreSQL server; the recovery targets are suggestions each organization must agree and rehearse.

**Acceptance criteria**

- [x] `docs/operations.md` has a recovery runbook with suggested recovery-point and recovery-time targets for the embedded database and PostgreSQL
- [x] On PostgreSQL, the backups page records and checks `pg_dump` backups made by the documented script, and warns when the last one is too old
- [x] **Back up now** runs as a background job and the page follows its progress

### E40-12 Smaller fixes: pool exhaustion, safety alerts once, scoring preview, shared date helpers, web tests, docs

**Status:** done · **Priority:** P3 · **Type:** debt

**Acceptance criteria**

- [x] Running out of database connections answers 503 with `Retry-After`, and the operations guide gives sizing advice (`core/db.ts` `DatabaseBusyError`, the error handler in `app.ts`, "Database connections" in `docs/operations.md`; test `core/db-busy.test.ts`)
- [x] A safety reporting-deadline alert is marked sent only after it is sent (`modules/safety/reporting.ts`: claimed with a conditional update and taken back when sending fails, so the next sweep sends it; the sweep runs every five minutes instead of 15; test `modules/safety/clock-alerts-once.test.ts`)
- [x] The project scoring preview uses the server's rule from `shared/` (`shared/project-scoring.ts` `scoreProject`, used by `modules/projects/rules.ts` `computeScore` and `web/src/modules/projects/ScoringTab.tsx`: scores clamped to 0 to 5, an empty score not scored; test `shared/project-scoring.test.ts`)
- [x] Date helpers (`addDays`, `addMonths` and the like) live once in `shared/` (`shared/dates.ts`: `addDays`, `addWeeks`, `addMonths`, `addYears`, `daysBetween`, `isYmd`, `weekdayOf`, `monthStartOf`, `monthEndOf`, `addMonthsToInstant`; the copies in the audits, condition, continuity, controls, funding, policies, records, risks, training, vendors, vulnerabilities, feeds and changes modules, and in the web's vendors, changes, projects, risks, attachments and training modules, now import it, module files re-exporting it for their callers; test `shared/dates.test.ts`)
- [x] Component tests for the risks, security incidents, projects and vendors pages (`RiskPages`, `SecurityIncidentPages`, `ProjectPages` and `VendorPages.component.test.ts`, 34 tests: risk scoring, acceptance and the heat map; notification clocks and declaring an incident; gates, document waivers and scoring; vendor assessments, exclusion-list checks and evidence expiry)
- [x] `docs/architecture.md` corrected about browser tests and database extensions

### E40-13 Reference checks by module permission, and token scope for background model changes

**Status:** done · **Priority:** P2 · **Type:** security · **Implemented in:** `server/src/core/resource.ts` (`checkRefsVisible`: a link to a record of an area the person may not view answers "<Type> not found.", like a hidden or missing one; system work is exempt, and so are the routes that link on the person's behalf, the self-service portal and mobile sync, where the record must still be one the person may see), `modules/models/engine.ts` with migration `models/003_change_token.sql` (the token, its name and scopes recorded with a change; the background job works within those scopes, names the token in the audit, and stops when the token was revoked or has expired); tests `core/atomic-save.test.ts`, `modules/models/token-scope.test.ts`. Three default roles link records of areas they cannot view (Asset manager: vendors, contracts, systems; Training coordinator: sites; Continuity manager: policies); their default grants need those view permissions (text handed to the coordinator for `core/services.ts`), which administrators then add with **Sync default grants**.

Left from E18-66.

**Acceptance criteria**

- [x] Linking a record (built-in or custom reference field) also needs view permission on the linked record's module, not only visibility of the record
- [x] A background model change saved with a personal access token runs with that token's scope, not the person's full permissions

### E40-14 Rotating secrets, and archiving the audit log under a least-privilege role

**Status:** done · **Priority:** P3 · **Type:** docs · **Implemented in:** `docs/operations.md` ("Rotating secrets": a table of every secret the application uses, where it is kept and how to change it, with procedures for the database passwords of the run-time and owner accounts, the secret key, the backup key or passphrase, the metrics token, personal API tokens and AI assistant connections, provisioning tokens, and the secrets shared with other systems: webhooks, sign-in providers, email, push, work trackers, log forwarders, the text-message webhook, the object store and the HTTPS certificate; "Audit log archive" for the owner command); `server/src/ops/audit-archive-owner.ts` and `server/src/cli.ts` (`audit-archive [--folder <dir>]`, also `grc audit-archive` in the container: the same archive on a connection as the owner, `GRC_DATABASE_MIGRATE_URL`, with the settings chosen on the page; refused with the reason when the archive is off or the account may not delete), `core/audit-archive.ts` (with a least-privilege role the daily job only watches and tells the administrators once when events wait more than 31 days past the cut-off; the audit event names who ran it), `web/src/modules/admin/AuditArchive.tsx` (the card shows the command and drops **Archive now**); test `ops/audit-archive-owner.test.ts` (the run-time role, taken with `set local role`, may not delete or archive; the owner command archives, checked and audited). Each procedure the criteria name was carried out once on a test installation: the secret key, the backup passphrase, the metrics token, an API token, a provisioning token and a webhook secret on the embedded database with a real server process; the run-time and owner database passwords and the owner's audit archive on PostgreSQL 17 (a local container) with a least-privilege role. Not carried out end to end, only covered by unit tests: sign-in provider, email, push, work-tracker, log forwarder, object store and HTTPS certificate changes, which need the other systems (the table in `docs/operations.md` marks each).

**Acceptance criteria**

- [x] `docs/operations.md` has a written procedure for rotating the database password, the secret key, SCIM and API tokens, the metrics token and the backup passphrase, each tested once
- [x] The audit archive can run where the application's run-time role has no delete privilege (a command run as the owner)

### E40-15 Change-based continuous integration and a template test database

**Status:** done · **Priority:** P2 · **Type:** debt · **Implemented in:** `tools/ci/affected.mjs` (the import graph and the changed files), `tools/ci/areas.mjs` (the area map, generated from the code: files, record types, including those written as constants, API paths, pages and imports of every module), `tools/ci/plan.mjs`, `tools/ci/run.mjs`, `tools/ci/github.mjs`, `tools/e2e/suite-map.mjs`, `tools/e2e/run.mjs` (`--affected`, `--areas`, `--plan`, `--shard`), `server/src/test/global-setup.ts`, `server/src/core/db-template.ts`, `vitest.config.ts`, `grc.ps1`/`grc.sh` (`ci`, `-Full`, `-Plan`), `.github/workflows/ci.yml`, `.github/workflows/windows-installer.yml` (tests `tools/ci/areas.test.ts`, `server/src/core/db-template.test.ts`).

A whole CI run took well over an hour for a change to one page. `.\grc.ps1 ci` now checks what changed
since the merge base with `main` (uncommitted and new files included): the typecheck it needs
(incremental), the unit tests the changed files reach through the import graph, the affected areas'
own tests and the tests marked `// ci: every module`, then the same on UTC, the web build and the
audit only when their inputs changed; it prints what it skipped and why. `-Full` runs everything and
`-Plan` prints the plan. Test databases start from a template migrated once per run (kept in
`node_modules/.cache/grc-test-db`, keyed by every migration, the module list, the PGlite version and
the day) and copied for each `testApp()`; a test migrates an empty database and compares it with the
template. The browser suites are chosen by area (`tools/e2e/suite-map.mjs`; tours visit only the
affected areas' pages and record types) and shared out by minutes. On GitHub a "What changed" job
writes the plan to the run's summary and starts only the jobs the change needs (unit tests in parts on
Linux and Windows, PostgreSQL, install smoke checks, the container, browser shards, accessibility, the
API client, the mobile app); everything runs nightly, on a version tag, on a manual full run and when
the workflow or `tools/ci` changes; the single required check is **CI result**.

**Acceptance criteria**

- [x] `.\grc.ps1 ci` runs only what the changes need and says what it skipped; `-Full` and `-Plan`
- [x] Every module is an area, every product file belongs to an area or core, every suite is mapped (`tools/ci/areas.test.ts`)
- [x] Test databases come from a migrated template, proven equal to a database migrated from empty
- [x] GitHub runs only the jobs a change needs, everything nightly and on tags, with one required check
- [x] `docs/development.md` describes it, including the branch protection change the maintainer makes
