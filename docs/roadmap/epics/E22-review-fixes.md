# E22 Review fixes (wave 9)

**Status:** done (48 of 48 issues done)

## Goal

Fix what the November 2026 review found: eight independent reviews of security (sign-in, access
control, injection and platform), server and web bugs, documentation accuracy, and operations and
performance. Finding IDs (SA-, AZ-, SP-, BS-, BW-, DOC-, OP-) are those of the review reports.

## Scope notes

- Every fix has a regression test that fails without it.
- Missing features found by the same review are planned as epics E23 to E36.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E22-01 | One spelling of every API path | done | P1 |
| E22-02 | Sign-in limits count simultaneous attempts | done | P1 |
| E22-03 | The passkey step and response times reveal nothing | done | P1 |
| E22-04 | Starting an authenticator app needs a recent password confirmation | done | P1 |
| E22-05 | Programs lose access with the password | done | P1 |
| E22-06 | First-run setup creates one administrator | done | P1 |
| E22-07 | Wrong current passwords are limited and audited | done | P2 |
| E22-08 | Page numbers are whole and capped | done | P3 |
| E22-09 | Private reports and dashboards stay private everywhere | done | P1 |
| E22-10 | "IT agents only" articles are hidden from every reader | done | P1 |
| E22-11 | Webhook addresses are kept out of the audit log | done | P2 |
| E22-12 | Scheduled reports are sent once | done | P2 |
| E22-13 | Approval workflow safeguards | done | P1 |
| E22-14 | Unsaved-changes guard in the remaining hand-written dialogs | done | P3 |
| E22-15 | A different person for each approval step | done | P1 |
| E22-16 | Gate decisions by hand are an administrator override | done | P1 |
| E22-17 | Shared actions follow the lifecycle rules | done | P2 |
| E22-18 | Risk, hazard, reminder and policy-version fixes | done | P2 |
| E22-19 | Blackout repeats keep local time; the Complete dialog offers valid outcomes | done | P2 |
| E22-20 | Hostile email HTML cannot freeze the server | done | P1 |
| E22-21 | Hostile spreadsheets cannot freeze the server | done | P1 |
| E22-22 | PDF exports have limits | done | P1 |
| E22-23 | An unreachable mail server does not hold up other work | done | P1 |
| E22-24 | Cut exports say so; Windows CSV files keep their accents | done | P2 |
| E22-25 | Consistent server backups on PostgreSQL | done | P1 |
| E22-26 | Backups and exports of any size | done | P1 |
| E22-27 | Restoring an older backup applies the newer migrations | done | P1 |
| E22-28 | Server backups do not freeze the embedded database | done | P2 |
| E22-29 | Restore needs the secret key; files are private | done | P1 |
| E22-30 | One server per data folder | done | P1 |
| E22-31 | Retention for webhook deliveries and mail logs | done | P1 |
| E22-32 | Compressed, cached web assets | done | P2 |
| E22-33 | A readiness check that tests the database | done | P2 |
| E22-34 | Compose trusts only the gateway as a proxy | done | P1 |
| E22-35 | The PostgreSQL compose setup uses a least-privilege role | done | P2 |
| E22-36 | Pinned actions and images; aligned stop time-outs | done | P2 |
| E22-37 | Unsaved changes are never lost without asking | done | P1 |
| E22-38 | Switched-off areas leave the dashboards | done | P1 |
| E22-39 | Display and validation fixes | done | P2 |
| E22-40 | American spelling on screens and in sample data | done | P3 |
| E22-41 | Documentation matches the application | done | P2 |
| E22-42 | Incident clock alerts are claimed before sending | done | P3 |
| E22-43 | The single sign-on per-address limit counts simultaneous attempts | done | P3 |
| E22-44 | Exports without secrets leave out token and session tables | done | P3 |
| E22-45 | Webhook addresses encrypted at rest | done | P3 |
| E22-46 | A reference field never names a record the person cannot see | done | P2 |
| E22-47 | Picker highlight contrast and keyboard-reachable scrolling tables | done | P2 |
| E22-48 | Every sideways-scrolling table reachable by keyboard | done | P3 |

---

### E22-01 One spelling of every API path

**Status:** done · **Priority:** P1 · **Type:** bug

Requests to percent-encoded paths (`/%61pi/...`) skipped the sign-in check, the token rule and URL-based module hooks, and `/api/v1` copies of routes skipped path-based guards (private reports, completed regulator notifications, feature switches). Review findings SA-1, SA-2, SA-5, AZ-1, AZ-3.

**Acceptance criteria**

- [x] `/api/v1/x` is routed as `/api/x` before routing; one route per handler
- [x] Paths the router would read differently from how they are written answer `400 bad_path`
- [x] Sign-in, token and feature-switch checks also decide by the matched route
- [x] A test walks every route under both spellings and three encodings

**Implemented in:** `server/src/core/api/versioning.ts`, `core/auth.ts`, `core/tokens.ts`, `core/features.ts`, `app.ts`; tests `core/api/canonical-paths.test.ts`, `core/auth-hardening.test.ts`

### E22-02 Sign-in limits count simultaneous attempts

**Status:** done · **Priority:** P1 · **Type:** bug

Wrong passwords sent at the same moment were all checked and the account never locked (SA-3); directory sign-in had the same pattern.

**Acceptance criteria**

- [x] The per-address limit records the attempt first and gives it back on success
- [x] The account lockout counts in one statement before the password is checked
- [x] Directory sign-in claims its per-user-name attempt first

**Implemented in:** `core/ratelimit.ts` (`take`), `core/auth.ts` (`claimSignInAttempt`), `modules/admin/sso.ts`; tests in `core/auth-hardening.test.ts`, `modules/admin/ldap.test.ts`

### E22-03 The passkey step and response times reveal nothing

**Status:** done · **Priority:** P1 · **Type:** bug

The passkey options step told a right password from a wrong one and did not count failures (SA-4); locked and unknown accounts answered faster (SA-6).

**Acceptance criteria**

- [x] A right password with no key answers like a wrong one, and failures count toward the lockout
- [x] Unknown, inactive and locked accounts are checked against a stand-in hash

**Implemented in:** `core/webauthn/routes.ts`, `core/auth.ts`

### E22-04 Starting an authenticator app needs a recent password confirmation

**Status:** done · **Priority:** P1 · **Type:** bug

A borrowed session could bind its own authenticator app and lock the owner out (SA-7).

**Acceptance criteria**

- [x] `/api/auth/totp/begin` needs a recent confirmation; the web page asks for it

**Implemented in:** `modules/admin/account.ts`, `web/src/modules/admin/AccountSecurity.tsx`

### E22-05 Programs lose access with the password

**Status:** done · **Priority:** P1 · **Type:** improvement

A password change, reset or second-factor reset left API tokens and AI assistant connections working (SA-8).

**Acceptance criteria**

- [x] They are revoked, with the counts in the audit event
- [x] The Change password dialog offers to keep them (`keepProgramAccess`)

**Implemented in:** `modules/admin/account.ts`, `modules/admin/users.ts`, `web/src/modules/admin`

### E22-06 First-run setup creates one administrator

**Status:** done · **Priority:** P1 · **Type:** bug

Parallel setup requests created several administrators (SA-9).

**Acceptance criteria**

- [x] The check and the creation run in one transaction under a lock

**Implemented in:** `core/auth.ts`

### E22-07 Wrong current passwords are limited and audited

**Status:** done · **Priority:** P2 · **Type:** bug

Changing a password allowed unlimited guesses at the current one (SA-10).

**Acceptance criteria**

- [x] Counted against the confirmation limit (8 in 5 minutes) and audited as `password.change_refused`

**Implemented in:** `modules/admin/account.ts`

### E22-08 Page numbers are whole and capped

**Status:** done · **Priority:** P3 · **Type:** bug

`page=1e400` caused a server error (SP-09).

**Acceptance criteria**

- [x] `pageOf()` used by every list

**Implemented in:** `core/api/conventions.ts`, `core/resource.ts`, `core/routes.ts`

### E22-09 Private reports and dashboards stay private everywhere

**Status:** done · **Priority:** P1 · **Type:** bug

Search, lookups, history, comments, links, tags, watchers and the fact sheet ignored report and dashboard sharing (AZ-2).

**Acceptance criteria**

- [x] A per-row rule (`rowRule`) is part of the shared visibility check
- [x] Editing someone else's item is refused on any path

**Implemented in:** `core/module.ts`, `core/resource.ts`, `modules/reports/sharing.ts`; test `reports/sharing.test.ts`

### E22-10 "IT agents only" articles are hidden from every reader

**Status:** done · **Priority:** P1 · **Type:** bug

The report builder, exports, widgets, AI assistant report tools, fact sheet and file downloads returned agent-only knowledge articles (AZ-4).

**Acceptance criteria**

- [x] The audience is the article type's row rule
- [x] Figures group them under "Restricted records"

**Implemented in:** `modules/tickets/audience.ts`, `modules/reports/spec.ts`; test `tickets/service.test.ts`

### E22-11 Webhook addresses are kept out of the audit log

**Status:** done · **Priority:** P2 · **Type:** bug

Webhook URLs, which often carry a secret, were written in full to the audit log (SP-06).

**Acceptance criteria**

- [x] New entries record scheme, host and a fingerprint
- [x] Older entries are redacted when read

**Implemented in:** `core/webhooks.ts`, `core/routes.ts`

### E22-12 Scheduled reports are sent once

**Status:** done · **Priority:** P2 · **Type:** bug

Overlapping runs sent a scheduled report twice (BS-3).

**Acceptance criteria**

- [x] A schedule is claimed in one statement before sending

**Implemented in:** `modules/reports/schedule.ts`; test `reports/delivery.test.ts`

### E22-13 Approval workflow safeguards

**Status:** done · **Priority:** P1 · **Type:** bug

Deleting a record left its workflow running (BS-1); approvers who lost the permission could still decide (BS-2); a deactivated approver left a step stuck (BS-5); concurrent changes to a step's approvers could undo each other (BS-10).

**Acceptance criteria**

- [x] Deleting or purging a record cancels its workflows; the sweep cancels orphans
- [x] The permission is checked again at decision time
- [x] Stuck steps are flagged on Running now
- [x] Approver lists are written with compare-and-set

**Implemented in:** `modules/workflows/service.ts`, `core/resource.ts`; test `workflows/safeguards.test.ts`

### E22-14 Unsaved-changes guard in the remaining hand-written dialogs

**Status:** done · **Priority:** P3 · **Type:** improvement

About 60 dialogs that hold their own state do not yet pass `dirty` to `Modal`, so closing them discards a draft without asking.

**Acceptance criteria**

- [x] Each dialog with typed input passes `dirty` (true while the draft differs from what the dialog opened with), or its form calls `useUnsavedChanges`, so Escape, × and a click outside ask "Discard this draft?" first. Wave 11 went through the 161 dialogs found without `dirty`: each owner fixed those in its own files, the follow-ups work the rest (about 115 in the shared modules)
- [x] Left alone on purpose: dialogs holding a `ResourceForm` (it already tells the dialog), dialogs with no input (confirmations, secrets or links shown once, read-only lists and drawers, keyboard help), and the three dialogs that ask only for a password (second factor, recovery codes, linking a directory account)
- [x] One component test per kind: a form dialog (`admin/Departments.component.test.ts`) and a picker dialog (`changes/SafetyAssessment.component.test.ts`); a browser check (`tools/e2e/suites/20-followups.mjs`)

**Implemented in:** the hand-written dialogs of each module under `web/src/modules`; tests named above

### E22-15 A different person for each approval step

**Status:** done · **Priority:** P1 · **Type:** feature

One person with the approve permission could decide both steps of a risk acceptance (AZ-7).

**Acceptance criteria**

- [x] Per-step option `distinct_approvers`, enforced at start, decision, reassignment, stand-ins and escalation
- [x] On by default for the executive step of risk acceptance (migration `workflows/004`)

**Implemented in:** `modules/workflows/engine.ts`, `service.ts`, `web/src/modules/workflows/WorkflowEditor.tsx`

### E22-16 Gate decisions by hand are an administrator override

**Status:** done · **Priority:** P1 · **Type:** bug

A project manager could record their own gate approval by hand and cancel the workflow (AZ-5).

**Acceptance criteria**

- [x] With a workflow, only administrators may record a decision, with a reason, and never the requester

**Implemented in:** `modules/projects/service.ts`, `web/src/modules/projects/GateTab.tsx`; test `projects/gate-workflow.test.ts`

### E22-17 Shared actions follow the lifecycle rules

**Status:** done · **Priority:** P2 · **Type:** bug

Someone a restricted action was shared with could set any status (AZ-6).

**Acceptance criteria**

- [x] The shared-action route applies the caller's lifecycle rules and approval holds

**Implemented in:** `modules/risks/actions.ts`

### E22-18 Risk, hazard, reminder and policy-version fixes

**Status:** done · **Priority:** P2 · **Type:** bug

Saving the hazard matrix from Risk scales did not re-rate hazards (BS-4); risk acceptance was applied as the approver (BS-6); reminders could be sent twice (BS-7); two new policy versions at once gave a 500 (BS-8).

**Acceptance criteria**

- [x] One shared re-rating function
- [x] Acceptance applied as system work
- [x] Reminders claimed before sending
- [x] A duplicate version answers 409 `version_open`

**Implemented in:** `modules/risks`, `modules/safety`, `modules/inventory`, `modules/policies/versions.ts`

### E22-19 Blackout repeats keep local time; the Complete dialog offers valid outcomes

**Status:** done · **Priority:** P2 · **Type:** bug

Repeating blackouts shifted an hour after daylight saving time and lost the last repeat (OP-07); the Complete-change dialog offered "Canceled", which the server refuses.

**Acceptance criteria**

- [x] Repeats keep wall-clock times; "repeat until" is a local day
- [x] The dialog offers only allowed outcomes

**Implemented in:** `modules/changes`, `web/src/modules/changes/outcomes.ts`

### E22-20 Hostile email HTML cannot freeze the server

**Status:** done · **Priority:** P1 · **Type:** bug

HTML-to-text was quadratic on unclosed tags and a message was marked seen only after reading (SP-01).

**Acceptance criteria**

- [x] Linear conversion of at most 1,000,000 characters
- [x] A message is recorded before reading; one that never finished is not read again (tickets migration 007)

**Implemented in:** `core/mail/mime.ts`, `modules/tickets/email.ts`

### E22-21 Hostile spreadsheets cannot freeze the server

**Status:** done · **Priority:** P1 · **Type:** bug

A 2 KB XLSX file blocked every request for 22 s (SP-02).

**Acceptance criteria**

- [x] Forward-only scanner; 5,000,000-cell cap

**Implemented in:** `core/import/xlsx.ts`; test `core/import/hostile.test.ts`

### E22-22 PDF exports have limits

**Status:** done · **Priority:** P1 · **Type:** bug

A PDF of 10,000 tickets with every column ran the server out of memory (OP-01).

**Acceptance criteria**

- [x] At most 12 columns (422 `too_many_columns`), a short default set, 16,000 cells
- [x] Layout yields to other requests

**Implemented in:** `core/export/pdf.ts`, `core/export/list.ts`

### E22-23 An unreachable mail server does not hold up other work

**Status:** done · **Priority:** P1 · **Type:** bug

Each attempt waited 15 s and the single job queue blocked alerts (OP-09).

**Acceptance criteria**

- [x] Shorter time-outs and a pause after three failures
- [x] Job lanes: `mail.send` runs in its own lane
- [x] `DeferJobError`

**Implemented in:** `core/mail/breaker.ts`, `core/mail/provider.ts`, `core/jobs/queue.ts`

### E22-24 Cut exports say so; Windows CSV files keep their accents

**Status:** done · **Priority:** P2 · **Type:** bug

Exports stopped silently at 50,000 rows (OP-10); CSV files saved by Excel lost accents (BS-9).

**Acceptance criteria**

- [x] The file, the `X-GRC-Export-Truncated` header and the audit say when an export was cut
- [x] Non-UTF-8 CSV is read as Windows-1252, with a warning

**Implemented in:** `core/export/list.ts`, `core/import/read.ts`

### E22-25 Consistent server backups on PostgreSQL

**Status:** done · **Priority:** P1 · **Type:** bug

Backups taken during writes held duplicates and failed to restore (OP-02).

**Acceptance criteria**

- [x] One repeatable-read snapshot; cursors instead of OFFSET
- [x] Same for `export-all`

**Implemented in:** `server/src/ops/export.ts`; test `ops/export-snapshot.test.ts`

### E22-26 Backups and exports of any size

**Status:** done · **Priority:** P1 · **Type:** bug

Backup, export-all and restore held a whole table in one string and would stop working after about a year (OP-03).

**Acceptance criteria**

- [x] Written and read a page at a time; format unchanged

**Implemented in:** `server/src/ops/export.ts`

### E22-27 Restoring an older backup applies the newer migrations

**Status:** done · **Priority:** P1 · **Type:** bug

Restore loaded old rows into the current schema without data migrations (OP-04).

**Acceptance criteria**

- [x] The schema is built with the backup's migrations, rows loaded, then newer migrations applied
- [x] Refused, with a message, into a newer database

**Implemented in:** `server/src/ops/export.ts` (`importStaged`), `core/migrate.ts`; test `ops/staged-import.test.ts`

### E22-28 Server backups do not freeze the embedded database

**Status:** done · **Priority:** P2 · **Type:** bug

The daily backup paused every user for the whole export (OP-05); both backup schedules defaulted to 02:00.

**Acceptance criteria**

- [x] Longest wait about 1 s instead of 6 s at 66,000 rows
- [x] The server backup defaults to 03:30

**Implemented in:** `server/src/ops/online-backup.ts`, `modules/attachments/backups.ts`

### E22-29 Restore needs the secret key; files are private

**Status:** done · **Priority:** P1 · **Type:** bug

Restoring into a new folder made a new secret key, locking out second-factor users (DOC-01); restored keys and folders had permissive modes (SP-07).

**Acceptance criteria**

- [x] Backups record the key fingerprint; restore refuses without the key (`GRC_RESTORE_NEW_SECRET_KEY=1` overrides)
- [x] Key files 0600, folders 0700

**Implemented in:** `server/src/ops/backup.ts`, `ops/secret-key.ts`, `core/db.ts`

### E22-30 One server per data folder

**Status:** done · **Priority:** P1 · **Type:** bug

Nothing stopped a second server opening the same data folder (OP-06).

**Acceptance criteria**

- [x] `grc.lock` taken before migrations, with stale-lock handling

**Implemented in:** `core/datalock.ts`, `main.ts`, `cli.ts`

### E22-31 Retention for webhook deliveries and mail logs

**Status:** done · **Priority:** P1 · **Type:** bug

Webhook deliveries kept full record contents forever and survived anonymizing; mail logs had no retention (OP-08).

**Acceptance criteria**

- [x] Delivered content emptied; settings for 30/180/180 days; anonymize and remove reach deliveries

**Implemented in:** `core/retention.ts`, `core/webhooks.ts`, `modules/admin/settings.ts`

### E22-32 Compressed, cached web assets

**Status:** done · **Priority:** P2 · **Type:** improvement

Web assets went out uncompressed with `max-age=0` (OP-11).

**Acceptance criteria**

- [x] Brotli or gzip, immutable caching for hashed files, `no-cache` for index.html
- [x] Asset record addresses loaded directly still get the application page

**Implemented in:** `core/webassets.ts`

### E22-33 A readiness check that tests the database

**Status:** done · **Priority:** P2 · **Type:** improvement

`/api/health` did not check the database (OP-13).

**Acceptance criteria**

- [x] `GET /api/ready` with a 2-second database check; containers use it

**Implemented in:** `core/health.ts`, `compose.yaml`, `deploy/healthcheck.mjs`

### E22-34 Compose trusts only the gateway as a proxy

**Status:** done · **Priority:** P1 · **Type:** bug

`GRC_TRUST_PROXY=private` let any intranet user forge their address (SP-03).

**Acceptance criteria**

- [x] Default `gateway`, resolved at start

**Implemented in:** `core/gateway.ts`, `compose.yaml`

### E22-35 The PostgreSQL compose setup uses a least-privilege role

**Status:** done · **Priority:** P2 · **Type:** bug

The app connected as the database superuser (SP-05).

**Acceptance criteria**

- [x] A one-off `db-roles` service creates `grc_app`; the app runs as it

**Implemented in:** `compose.postgres.yaml`, `deploy/postgres/app-role.sh`

### E22-36 Pinned actions and images; aligned stop time-outs

**Status:** done · **Priority:** P2 · **Type:** debt

Third-party actions and base images were not pinned (SP-08); `grc.ps1 stop` force-killed before the server finished (OP-12).

**Acceptance criteria**

- [x] Actions pinned to commit SHAs, images by digest
- [x] The scripts wait 30 s

**Implemented in:** `.github/workflows/*.yml`, `Dockerfile`, `grc.ps1`, `grc.sh`

### E22-37 Unsaved changes are never lost without asking

**Status:** done · **Priority:** P1 · **Type:** bug

Leaving a page, closing a dialog or an ended session discarded typed text (BW-01, BW-02, BW-03).

**Acceptance criteria**

- [x] `useUnsavedChanges` on record forms, full-page forms and the New ticket dialog
- [x] An ended session keeps the draft and can resend the request

**Implemented in:** `web/src/core/unsaved.tsx`, `web/src/core/session.ts`

### E22-38 Switched-off areas leave the dashboards

**Status:** done · **Priority:** P1 · **Type:** bug

Standard dashboards of switched-off areas were still listed (BW-04); a search placeholder named them (BW-05).

**Acceptance criteria**

- [x] Off-area dashboards are not listed and their widgets are hidden
- [x] Suite 09 checks it

**Implemented in:** `modules/reports/index.ts` (`/api/dashboards/switched-off-types`), `web/src/modules/reports/offTypes.ts`

### E22-39 Display and validation fixes

**Status:** done · **Priority:** P2 · **Type:** bug

Wrong chart text for screen readers (BW-07), project request shown to everyone (BW-06), raw dates (BW-08), ISO dates read aloud (BW-09), negative costs accepted (BW-10), locale-dependent numbers (BW-11), UTC "review due" (BW-12), unescaped heat-map tooltip (SP-04).

**Acceptance criteria**

- [x] Each fixed with a test

**Implemented in:** `web/src/core/ChartImpl.tsx`, `core/format.ts`, `core/timezone.ts` and the modules named in the findings

### E22-40 American spelling on screens and in sample data

**Status:** done · **Priority:** P3 · **Type:** bug

Screens and sample data used British spellings, and "tick" for "check".

**Acceptance criteria**

- [x] A test checks for them

**Implemented in:** `server/src/core/american-spelling.test.ts`

### E22-41 Documentation matches the application

**Status:** done · **Priority:** P2 · **Type:** docs

The docs review found false or outdated statements in the guides and API reference (DOC-02 to DOC-09).

**Acceptance criteria**

- [x] Each corrected; a test checks the API reference for the sign-in body and confirmations

**Implemented in:** `docs/**`, `server/src/core/apidocs.ts`; test `core/apidocs.test.ts`

### E22-42 Incident clock alerts are claimed before sending

**Status:** done · **Priority:** P3 · **Type:** bug

The security incident clock alert is stamped after it is sent, like the reminders fixed in E22-18, so overlapping runs could send it twice.

**Acceptance criteria**

- [x] The alert is claimed in one statement before sending (`update notification_tasks ... where id = $1 and alerted_red_at is null returning id`, and the amber one only while neither is set); a sweep that loses the claim sends nothing
- [x] Test with overlapping sweeps: each alert is logged, audited and sent once

**Implemented in:** `server/src/modules/secincidents/alerts.ts` (`sweepClocks`); test `secincidents/alerts-claim.test.ts`

### E22-43 The single sign-on per-address limit counts simultaneous attempts

**Status:** done · **Priority:** P3 · **Type:** bug

The per-address bucket on single sign-on routes is checked before an attempt and recorded after it.

**Acceptance criteria**

- [x] Use `take()` like the local sign-in: every public single sign-on route (directory sign-in, passkey step, start, callback, SAML response, single logout, back-channel sign-out) claims the shared per-address slot before the attempt and gives it back when the attempt ends (a failure is recorded once); test `admin/sso-limit.test.ts` with 30 simultaneous attempts

### E22-44 Exports without secrets leave out token and session tables

**Status:** done · **Priority:** P3 · **Type:** improvement

An export made with `-NoSecrets` still holds API token, assistant sign-in and session hashes.

**Acceptance criteria**

- [x] Those tables are left out or emptied (`SECRET_TABLES`: sessions, links, passkeys, single sign-on flows and sessions, logout tokens, assistant sign-in codes and tokens) or their secret blanked where rows are referenced (`SECRET_COLUMNS`: API token, provisioning token, calendar feed and vendor link hashes become unusable values; assistant client secrets; the work-tracker bridge's sealed address and secrets, switched off)
- [x] `ops/export-secrets.test.ts` fails on any new `*_hash` or `token*` column not listed

### E22-45 Webhook addresses encrypted at rest

**Status:** done · **Priority:** P3 · **Type:** improvement

Webhook addresses are stored in clear (administrators only).

**Acceptance criteria**

- [x] Stored with the secret box like other secrets (`url_sealed`, context `webhook-url:<id>`, core migration 027); addresses already stored are sealed at start-up and resealed on a key change; the list shows host and fingerprint; the full address only after a password confirmation (`POST /api/admin/webhooks/:id/reveal`, audited)

### E22-46 A reference field never names a record the person cannot see

**Status:** done · **Priority:** P2 · **Type:** bug

Found while building OT security in wave 11: core checked that a reference field named an existing
record, but not one the caller may see, so a person could link a record to a restricted or hidden
one by its id. Modules had to check this in their own hooks.

**Acceptance criteria**

- [x] Core refuses a ref field naming a record the caller cannot see (restricted, a row rule, removed) with the same validation answer as an unknown one; a value left unchanged on an update is not checked again, and system work is exempt
- [x] Test: an ordinary agent cannot point a record at a restricted one

**Implemented in:** `server/src/core/resource.ts` (`checkRefsVisible`); test `core/core.test.ts` ("keeps restricted records invisible to an ordinary agent everywhere")

### E22-47 Picker highlight contrast and keyboard-reachable scrolling tables

**Status:** done · **Priority:** P2 · **Type:** bug

The accessibility audit found low contrast on the highlighted option of the shared picker in dark mode, its reference text on the highlight in both themes, and scrolling areas keyboard users could not reach (the picker list, and wide tables on the controls dashboard, asset classes and impact analyses).

**Acceptance criteria**

- [x] The highlighted option uses the brand text color; reference text follows it
- [x] The picker list scrolls itself (exempt as a combobox list)
- [x] `TableWrap` makes a table that is wider than its box a named region reachable with Tab
- [x] The audit of every wave 10 and 11 page, light and dark, 1440 and 820, has no serious or critical finding

**Implemented in:** `web/src/core/pickers.tsx`, `base.css`, `records.css`, `ui.tsx` (`TableWrap`), `controls/Dashboard.tsx`, `condition/Classes.tsx`, `continuity/Bia.tsx`

### E22-48 Every sideways-scrolling table reachable by keyboard

**Status:** done · **Priority:** P3 · **Type:** improvement

About 128 files still used a plain `div.table-wrap`. A table with no links that scrolls sideways could not be reached with the keyboard.

**Acceptance criteria**

- [x] Tables use `TableWrap`: all 166 hand-written `table-wrap` boxes, the calendar feeds and API parameter tables; the box takes its name from the table's caption or card title
- [x] `TableWrap` passes other attributes through (`aria-busy`, `key`, `ref`) and also becomes a Tab stop when a table is taller than a box with a height limit (report results)
- [x] Tables in a policy's text sit in their own scroll box, a named Tab stop while it scrolls; the hazard matrix grid becomes a Tab stop when it scrolls on a narrow screen
- [x] A unit test (`web/src/core/tableWrap.test.ts`) fails on a hand-written `table-wrap` box, a Mantine `Table.ScrollContainer`, or a file with a `<table>` and no `TableWrap` that is not on its list of exceptions (with reasons); a component test covers `TableWrap` itself
- [x] The audit of 20 affected pages, light and dark, 1440 and 820, has no finding

**Implemented in:** `web/src/core/ui.tsx` (`TableWrap`), `tableWrap.test.ts`, `TableWrap.component.test.ts`, `ImportWizardParts.tsx`, about 130 page files under `web/src/modules`, `policies/shared.tsx`, `policies/policyTables.ts`, `policies/policies.css`, `safety/shared.tsx`, `help/ApiReference.tsx`, `feeds/FeedsAdmin.tsx`, `reports/ResultView.tsx`
