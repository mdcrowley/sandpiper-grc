# E14 Platform services not yet built

**Status:** in progress (attachments, in-app notifications, email delivery, the job queue and
full-text search built; custom fields, tags, watchers and retention built on the server, their
screens open)

## Goal

Add the shared services that several modules are waiting for: files attached to
records, notifications inside the application and by email, fields and workflows that
an administrator can define, better search, and the small conveniences (tags, watchers,
bulk edit) that make daily use quicker.

## Scope notes

- Attachments and notifications are built as ordinary modules (`attachments`,
  `notifications`) that work for every record type through the resource registry. Core
  only mounts their two components: the **Attachments** tab in `RecordPage` and the bell
  in the top bar. The remaining services may belong in `server/src/core/` and
  `web/src/core/`.
- Many open issues in other epics depended on E14-01 (attachments) and E14-03
  (notifications). Both are now built; those issues can embed `AttachmentsPanel` and
  call `app.notify` (see E14-16).
- Email needs an outbound connection. It is an explicit, per-installation setting
  (Administration > Email) and stays off by default; the application works fully without it.
- The job queue and email are core services (`server/src/core/jobs`, `server/src/core/mail`).
  Until `app.ts` starts them itself, the notifications module starts both in its
  `seedDefaults`, so they exist before any module's `register` runs.
- Workflow today is per-module code plus configurable lists. That is adequate for a
  pilot; the general engine is a later item.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E14-01 | Attachments on any record | done | P1 |
| E14-02 | Custom fields | in progress | P3 |
| E14-03 | In-app notifications | done | P1 |
| E14-04 | Email delivery | done | P2 |
| E14-05 | Email setup and reset links | in progress | P2 |
| E14-06 | Workflow engine with approvals | open | P3 |
| E14-07 | Full-text search | done | P2 |
| E14-08 | Tags | in progress | P3 |
| E14-09 | Watchers | in progress | P3 |
| E14-10 | Bulk edit | done | P2 |
| E14-11 | Retention settings and review flags | in progress | P2 |
| E14-12 | Job queue for background work | done | P2 |
| E14-13 | Object-storage driver for attachments | done | P2 |
| E14-14 | Malware scanner for attachments | done | P1 |
| E14-15 | Purge and retention of removed files | done | P2 |
| E14-16 | Notifications from the other modules | done | P1 |
| E14-17 | Notification housekeeping | open | P3 |
| E14-18 | Evidence files on evidence-bearing records | open | P2 |
| E14-19 | Anonymize a record at the end of its retention period | open | P3 |
| E14-20 | Retention review counts follow row-level restriction | open | P3 |
| E14-21 | Comment search follows the search language setting | open | P3 |
| E14-22 | Move the other modules' timers onto the job queue | open | P2 |
| E14-23 | Start the job queue and email from core | open | P3 |
| E14-24 | "Forgot your password?" link and help for the new pages | open | P2 |
| E14-25 | Another mail provider (a mail service's web interface) | open | P3 |
| E14-26 | Other modules' tests stand in for `notify` and `sendMail` safely | open | P3 |
| E14-27 | File housekeeping, rescans and moves as background jobs | open | P3 |

---

### E14-01 Attachments on any record

**Status:** done · **Priority:** P1 · **Type:** feature

As a user, I attach files to any record I can edit, and anyone who can see the record
can download them.

**Acceptance criteria**

- [x] Upload, list, download and remove on every record page (the `AttachmentsPanel`
  component, with drag and drop, progress, edit and confirmation; core mounts it as the
  **Attachments** tab of `RecordPage`)
- [x] Files follow the record's permissions, including restricted records: no listing,
  download or sign of existence without access to the record
- [x] Size and type limits are settings (`attachments.max_bytes`, default 25 MB;
  `attachments.allowed_extensions`), edited on the **File settings** page
- [x] Files are stored outside the database, under the data folder (`data/files`), behind
  a storage interface, and included in backups (`grc.ps1 backup` copies the data folder)
- [x] Upload, refusal, change of details, removal, and download from a restricted record
  are audited against the record
- [x] Downloads are served so that the browser cannot run them as pages (always an
  attachment, `nosniff`, a sandboxing content security policy, no HTML or SVG type)
- [x] The extension must be allowed and the content must match it; programs and scripts
  are always refused
- [x] A SHA-256 checksum is stored and verified on every download
- [x] Evidence files carry a collection date and an optional expiry date, with a page of
  evidence files that are expiring across all records the reader may see
- [x] A malware-scanning hook is called before a file is accepted (no scanner is
  supplied: see E14-14)

**Implemented in:** `server/src/modules/attachments/` (`index.ts` routes under
`/api/attachments`, `storage.ts`, `filetypes.ts`, `scanner.ts`, `service.ts`,
`migrations/001_attachments.sql`, `attachments.test.ts`); `web/src/modules/attachments/`
(`AttachmentsPanel.tsx`, `AttachmentEditDialog.tsx`, `ExpiringEvidenceFiles.tsx`,
`FileSettings.tsx`, `upload.ts`); user guide `docs/user/14-attachments-and-notifications.md`

### E14-02 Custom fields

**Status:** in progress (server done; screens open) · **Priority:** P3 · **Type:** feature

As an administrator, I add my own fields to a record type without a code change, and
they appear on forms, lists, filters and exports.

**Acceptance criteria**

- [x] Fields are defined per record type with a label, type (text, long text, number,
  currency, date, checkbox, single choice, multiple choice, user, record link), options or
  an existing list, required, section, help, position and active
- [x] In rows and in `/api/meta` as `cf_<key>` in the shape of built-in fields, marked
  `custom: true` (multiple choice: `type: 'lookup'` with `multiple: true`), so the generic
  pages can show them; in CSV export; filterable, sortable and groupable (multiple choice:
  filter only); text fields are searched
- [x] Validated like built-in fields ("required" applies to people, not to system work)
  and included in the audit trail field by field, and in webhook payloads
- [x] Removing a field hides it without deleting its data; switching it back on restores it
- [ ] Generic form, record page, list columns and filters render `custom: true` fields,
  including `multiple`, `help` and `section` (web core)
- [x] A **Custom fields** administration page (web admin):
  `web/src/modules/admin/CustomFields.tsx` (`/admin/custom-fields`)

**Implemented in:** `server/src/core/customfields.ts`, `server/src/core/customfield-routes.ts`,
`server/src/core/resource.ts` (validation, storage in the `custom` column, filters,
sorting, export, audit); tests in `server/src/core/platform.test.ts` ("custom fields").
Routes: `GET /api/admin/custom-fields?record_type=`, `POST /api/admin/custom-fields`,
`PATCH/DELETE /api/admin/custom-fields/:id` (DELETE switches the field off).

### E14-03 In-app notifications

**Status:** done · **Priority:** P1 · **Type:** feature

As a user, a bell in the top bar shows me what needs my attention: something assigned
to me, a deadline approaching, a reminder falling due.

**Acceptance criteria**

- [x] Any module can raise a notification for named users or for everyone holding a
  permission through one service, `app.notify(...)`, without importing this module
  (callers guard with `app.hasDecorator('notify')`)
- [x] A bell with an unread count and a list that links to the record (the
  `NotificationBell` component, which core mounts in the top bar), and a full
  **Notifications** page
- [x] Mark as read, and mark all as read
- [x] A notification never reveals a record the recipient cannot see: checked when it is
  sent and again each time the list is read
- [x] Each person can choose which kinds they receive; kinds are the configurable list
  `notification_kind`
- [x] First users, raised by a daily digest inside this module: owners of actions that
  are overdue or due within three days, and assignees of tickets within four hours of
  their resolution target; at most one per record, kind and day
- [x] The unread count is polled once a minute, and not while the tab is hidden or the
  person has been idle for five minutes (so polling cannot defeat the idle time-out)

Ticket assignment, contract reminders and incident clocks are one-line calls in the
modules that own those records: see E14-16.

**Implemented in:** `server/src/modules/notifications/` (`service.ts` `app.notify`,
`index.ts` routes under `/api/notifications`, `digest.ts`, `email.ts` daily email summary
(E14-04), `migrations/001_notifications.sql`, `notifications.test.ts`);
`web/src/modules/notifications/` (`NotificationBell.tsx`, `NotificationsPage.tsx`,
`Preferences.tsx`, `data.ts`); user guide `docs/user/14-attachments-and-notifications.md`

### E14-04 Email delivery

**Status:** done · **Priority:** P2 · **Type:** feature

As a user, I can choose to receive my notifications by email as well as in the
application.

**Acceptance criteria**

- [x] Mail server details (host, port, TLS mode none/STARTTLS/TLS, user name, password kept
  encrypted, from, reply-to, application address) are settings on **Administration > Email**;
  delivery is off until an administrator switches it on; changes need a recent password
  confirmation and are audited without the password
- [x] Messages contain a link and a short summary, never restricted detail: a restricted record
  gets the content-free "You have a new security notification — open the application to view
  it", access is checked again when each message is sent, and an outside address never
  receives anything about a restricted record
- [x] Failed deliveries are retried through the job queue (5 attempts, 1-2-4-8 minutes; a 5xx
  reply or a refused sign-in is not retried) and logged (**Delivery log**)
- [x] A **Send test email** button for administrators (works before email is switched on)
- [x] Documented as a deliberate outbound connection that is off by default (user guide;
  text for `docs/security.md` and the developer guide given to their owners)
- [x] Per person and per kind: bell, email, both or off (`notification_preferences.channels`);
  "email" falls back to the bell while email is off or the person has no address
- [x] The daily-digest choice sends one summary a day (from `notifications.digest_hour`,
  default 7, organization time zone) instead of a message per notification
- [x] Templates are data (`mail_templates`): subject, plain text and simple HTML with
  placeholders, validated (allowed tags and links only, values escaped), with preview and
  "put back the default"
- [x] `app.sendMail(...)` for other modules (guarded with `app.hasDecorator('sendMail')`), and a
  provider interface (`registerMailProvider`) so another provider needs no change elsewhere
- [x] Tested against an in-process SMTP sink (`server/src/core/mail/smtp-sink.ts`): delivery,
  plain connection, sign-in, refusals and retries, preferences, digest, restricted records

**Implemented in:** `server/src/core/mail/` (`index.ts` `ensureMail`, `service.ts` `sendMail`
and the `mail.send` job, `provider.ts` SMTP through nodemailer and the provider registry,
`templates.ts`, `routes.ts` routes under `/api/admin/mail`, `links.ts`, `smtp-sink.ts`,
`migrations/001_mail.sql`, `mail.test.ts`); `server/src/modules/notifications/` (`service.ts`
channels, `email.ts` daily summary, `migrations/002_email.sql`, `email.test.ts`);
`web/src/modules/notifications/` (`EmailSettings.tsx`, `MailTemplates.tsx`, `MailLog.tsx`,
`Preferences.tsx`, `reauth.tsx`); user guide `docs/user/14-attachments-and-notifications.md`

### E14-05 Email setup and reset links

**Status:** in progress (the sign-in page link is E14-24) · **Priority:** P2 · **Type:** improvement

As a new user, I receive my setup link by email. As a user who has forgotten my
password, I request a reset link myself. Today an administrator is shown the link and
must pass it on.

**Acceptance criteria**

- [x] Creating a user, and issuing a set-up or reset link, also emails it to the person when
  email is on (the response gains `emailedTo`); the link is kept encrypted in the queued job
- [x] A **Forgot your password?** page (`/forgot-password`, public) sends a reset link (a
  set-up link for an account still pending); it expires after `auth.reset_link_minutes`
  (default 60) and replaces the person's earlier self-service link, never one an
  administrator issued
- [ ] A link to that page on the sign-in screen (core: E14-24)
- [x] The response is the same whether or not the username or address is known
- [x] Requests are rate-limited (5 in 15 minutes from one address, then 429; 3 links an hour
  for one account, silently) and audited (`password.reset_request`)
- [x] Depends on E14-04; the current hand-over method remains when email is off (the page
  then says to ask an administrator)

**Implemented in:** `server/src/core/mail/links.ts` (`GET/POST /api/auth/forgot-password`, and an
`onSend` hook on the admin module's three link routes); `web/src/modules/notifications/ForgotPassword.tsx`;
tests in `server/src/core/mail/mail.test.ts` ("forgotten password")

### E14-06 Workflow engine with approvals

**Status:** open · **Priority:** P3 · **Type:** feature

As an administrator, I define for a record type which status changes are allowed, who
may make them, and which need approval, instead of this being written in each module.

**Acceptance criteria**

- [ ] Transitions, conditions and required fields are data per record type
- [ ] An approval step routes to a person, a role or the record's owner
- [ ] Approvers see a list of what is waiting for them
- [ ] Existing per-module rules keep working until moved across
- [ ] First users: asset disposal, change approval, risk acceptance

### E14-07 Full-text search

**Status:** done · **Priority:** P2 · **Type:** improvement

As a user, search understands whole words, word endings and several words at once, and
ranks the best matches first. Before, search was plain substring matching.

**Acceptance criteria**

- [x] The database's full-text search is used (verified on PGlite): one `search_index`
  row per record, kept by a trigger generated per record type, GIN-indexed; language from
  `GRC_SEARCH_LANGUAGE` (default `english`) plus `simple`
- [x] Results are ranked (title and reference weighted highest) and carry a snippet with
  the match marked: `snippet` (plain text) and `snippetParts: [{ text, match }]`, plus
  `rank` and `matched` (`record`, `comment` or `attachment`); the old fields are unchanged
- [x] The last word is matched as a prefix ("rout" finds "router")
- [x] Comments and attachment file names are searched too, under the record's own rules
- [x] Reference numbers still match exactly, and an exact reference is boosted to the top
- [x] Queries under three characters fall back to substring matching, as does a single
  word inside a longer one (codes, serial numbers)
- [x] Permissions and restricted-record rules are unchanged; list `q` uses the same index
  and orders by rank when no sort is chosen; `/api/meta` says `search: 'fulltext'`
- [ ] Global search box shows the snippet with matches marked (web core; additive)

**Implemented in:** `server/src/core/search.ts`, `server/src/core/resource.ts` (list `q`),
`GET /api/search` in `server/src/core/routes.ts`,
`server/src/core/migrations/003_platform_services.sql`; tests in
`server/src/core/platform.test.ts` ("full-text search")

### E14-08 Tags

**Status:** in progress (server done; screens open) · **Priority:** P3 · **Type:** feature

As a user, I add free-form tags to any record and filter lists by them.

**Acceptance criteria**

- [x] Add and remove tags on any record the caller may edit (normalized to lower case,
  at most 30 per record, audited as `tag.change`); reading needs view on the record
- [x] Existing tags are suggested as I type, counted only over records the caller may see
- [x] Lists can be filtered by tag: `f.tags=a,b` (any), `f.tags.all=a,b`,
  `f.tags.null=true`; rows carry `_tags`
- [x] Administrators can rename and merge tags (audited)
- [ ] Tag editor on the record page, tag column and filter on generic lists (web core)

**Implemented in:** `server/src/core/tags.ts`, `server/src/core/resource.ts` (filter and
`_tags`); tests in `server/src/core/platform.test.ts` ("tags and watchers"). Routes:
`GET /api/tags?record_type=&record_id=`, `PUT /api/tags` (`{ record_type, record_id, tags }`
replaces), `POST /api/tags` (adds one), `DELETE /api/tags?record_type=&record_id=&tag=`,
`GET /api/tags/options?record_type=&q=` (`[{ tag, count }]`), `POST /api/admin/tags/rename`
(`{ record_type, from, to }`; merges when `to` exists).

### E14-09 Watchers

**Status:** in progress (server done; screens open) · **Priority:** P3 · **Type:** feature

As a user, I follow a record and am notified when it changes.

**Acceptance criteria**

- [x] Watch and stop watching on any record (audited); a list of what I watch, leaving
  out what I can no longer see
- [x] Watchers are notified of status changes and comments (not the person who made
  them), through `app.notify` when the notifications module is loaded; kind `watch` when
  that list has it, otherwise `general`
- [x] Only people who can see the record can watch it, and `app.notify` skips anyone who
  has since lost access
- [x] Depends on E14-03
- [ ] **Watch** button on the record page and a **Watching** list (web core)
- [x] A `watch` value ("Records I watch") in `notification_kind`, so people can switch these
  off or have them emailed (notifications module)

**Implemented in:** `server/src/core/tags.ts`, comment hook in `server/src/core/routes.ts`;
tests in `server/src/core/platform.test.ts` ("tags and watchers"). Routes:
`GET /api/watchers?record_type=&record_id=` (`{ watching, count, watchers }`),
`POST /api/watchers` (`{ record_type, record_id }`), `DELETE /api/watchers?record_type=&record_id=`,
`GET /api/me/watching`.

### E14-10 Bulk edit

**Status:** done · **Priority:** P2 · **Type:** feature

As a user, I select several rows in a list and change one field on all of them at once
(for example assignee or status).

**Acceptance criteria**

- [x] Row selection on every generic list, including "all matching the filter"
- [x] One field at a time, chosen from the editable fields
- [x] Each record is validated, run through its hooks and audited individually
- [x] A summary shows how many changed and which failed, and why

**Done:** row selection and bulk edit in the core list (ListBulk.tsx), per-row PATCH with progress and export of the selection.

### E14-11 Retention settings and review flags

**Status:** done · **Priority:** P2 · **Type:** feature

As an administrator, I set how long each kind of record is kept, and records past that
age are flagged for review rather than deleted silently.

**Acceptance criteria**

- [x] A retention period per record type, held as data (`retention_policies`: months,
  counted from last update or creation, schedule category from the list
  `retention_category`, notes, active), audited
- [x] Records past their period are flagged by a daily check (and on demand) and listed
  for review; an extension that runs out flags the record again
- [x] A reviewer can extend (to a date or by months) or remove each one, with a reason;
  removal needs confirmation and a recent password confirmation, is refused while files
  are attached, and is the only hard delete in the application (anonymizing: E14-19)
- [x] Nothing is removed automatically
- [x] The audit log has its own, longer period (`retention.audit_months`, default 84),
  recorded only: audit events are never deleted
- [x] **Retention** administration page with the review list (web admin):
  `web/src/modules/admin/Retention.tsx` (`/admin/retention`); `retention.audit_months` in the
  **Retention** group of `web/src/modules/admin/Settings.tsx`

**Implemented in:** `server/src/core/retention.ts`, `purge` in `server/src/core/resource.ts`;
tests in `server/src/core/platform.test.ts` ("retention"). Routes: `GET /api/admin/retention`,
`PUT /api/admin/retention/:type` (`{ periodMonths, basis, category, active, notes }`),
`POST /api/admin/retention/sweep`, `GET /api/admin/retention/reviews?status=&record_type=&page=`,
`POST /api/admin/retention/reviews/:id/extend` (`{ reason, until | months }`),
`POST /api/admin/retention/reviews/:id/delete` (`{ reason, confirm: true }`).

### E14-12 Job queue for background work

**Status:** done (other modules' timers: E14-22) · **Priority:** P2 · **Type:** debt

As an administrator, I want scheduled work (the service-level sweep, contract
reminders, and later notifications and scheduled reports) to run from a durable queue
that survives restarts and shows me what ran. Today these are timers inside the server
process.

Webhook deliveries (E13-06) already use a table-backed queue (`webhook_deliveries`) with
retries; it can be the model, or be moved onto the general queue.

**Acceptance criteria**

- [x] Scheduled and one-off jobs are stored in the database (`jobs`, `job_schedules`): type,
  payload, run-at, attempts, back-off, lease, result, error
- [x] A job runs once even with more than one server process: claims are conditional updates
  with a lease (`locked_until`), so a crashed process's job is taken over when the lease runs
  out; a schedule is queued by whichever poller moves its next run time on; `key` de-duplicates
- [x] Failures are retried with a doubling wait and go "dead" after `max_attempts` (or at once on
  `PermanentJobError`); **Administration > Background jobs** lists recent, failed and dead jobs
  with **Try again now**, and the schedules with **Run now** (both audited)
- [x] Modules use it through `app.jobs` / `ensureJobs(ctx)`: `register(type, handler, opts)`,
  `enqueue(type, payload, opts)`, `schedule(name, { type, every })`, `runDue()`
- [x] The notification digest and the daily email summary are on the queue
  (`notifications.reminders`, `notifications.email_digest`); the other modules' timers are E14-22

**Implemented in:** `server/src/core/jobs/` (`queue.ts`, `index.ts` with the routes under
`/api/admin/jobs`, `migrations/001_jobs.sql`, `jobs.test.ts`); `web/src/modules/notifications/JobsPage.tsx`
(`/admin/jobs`). The poller starts when the server starts listening (every 10 s,
`GRC_JOBS_POLL_MS`; `GRC_JOBS=off` stops it), never in tests or commands.

### E14-13 Object-storage driver for attachments

**Status:** done · **Priority:** P2 · **Type:** feature

As an administrator of a hosted installation, I keep attached files in an S3-compatible
object store instead of on the server's disk.

**Acceptance criteria**

- [x] A driver implementing `FileStorage` (`put`, `get`, `delete`, `stat`, and `list` for the
  integrity check) for an S3-compatible store, speaking the S3 API directly with AWS
  Signature Version 4 computed with `node:crypto` (no SDK); path-style and virtual-hosted
  addresses, region, endpoint, optional server-side encryption (`AES256` or `aws:kms` with a
  key ID); checked against the published signing example and a fake store that verifies
  every signature
- [x] The driver is chosen by an administrator (File settings > Storage). Credentials come
  from the server's environment (`GRC_S3_ACCESS_KEY_ID`, `GRC_S3_SECRET_ACCESS_KEY`), a
  credentials file on the server, or the settings, where the secret is encrypted with the
  application's secret key and never returned to the browser. (Changed from "never from the
  database": the encrypted setting is the same protection the email password has.)
- [x] Uploads and downloads stream; uploads go in 8 MB parts (multipart upload above that),
  so at most one part is held in memory
- [x] Each attachment's `storage_driver` is honored, so files stored on disk before the
  change stay readable; `grc.ps1 move-files -To s3|disk` moves them across, checking each
  copy's SHA-256 before deleting the original
- [x] Documented as an outbound connection that is off by default; settings are tested
  before they are saved and need a recent password confirmation
- [x] Backup and restore instructions cover the store (it is not in backups; use its
  versioning, or move files back first) — `docs/operations.md`

**Implemented in:** `server/src/modules/attachments/` (`s3.ts`, `stores.ts`, `config.ts`,
`admin.ts`, `housekeeping.ts` `moveFiles`, `storage.ts` `list`, `fakes.ts`,
`s3-clamd.test.ts`, `storage-admin.test.ts`); `server/src/cli.ts` (`move-files`); `grc.ps1`
(`move-files`); `web/src/modules/attachments/StorageSettings.tsx`

### E14-14 Malware scanner for attachments

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, every attached file is checked for malware before it is accepted.

**Acceptance criteria**

- [x] A scanner that registers with `app.fileScanner.use(...)`: a ClamAV daemon reached
  over TCP (`INSTREAM`, chunked, with a time limit and a size limit), switched on by an
  administrator and off by default; run on the same machine or one the organization controls
- [x] An infected file is refused, its bytes removed, and the refusal audited (tested with a
  fake `clamd` that answers clean, infected and errors)
- [x] A setting decides whether uploads are refused or accepted as "Not scanned" (with a
  warning to the uploader and an audit event) when the engine cannot give a verdict;
  the default is accept
- [x] Files attached before the scanner was switched on can be scanned in batches from the
  File settings page; an infected one is removed at once (bytes deleted, row marked
  `infected`), audited as `attachment.quarantine` and reported to administrators
- [x] The engine's version and signature date are shown on the **File settings** page
  (**Test connection**)

**Implemented in:** `server/src/modules/attachments/clamd.ts`, `config.ts`, `index.ts`
(policy), `housekeeping.ts` (`rescanNotScanned`), `admin.ts`, `fakes.ts`;
`web/src/modules/attachments/ScannerSettings.tsx`

### E14-15 Purge and retention of removed files

**Status:** done · **Priority:** P2 · **Type:** feature

As an administrator, removed files are deleted from storage after a set period, and I can
restore one before then.

**Acceptance criteria**

- [x] A list of removed files for administrators, with restore (restricted records' files
  are listed only for holders of `security.view`)
- [x] A retention period (a setting, 30 days to begin with, 0 keeps them); files removed
  for longer are purged from storage by a daily job (or **Purge now**), and each purge is
  audited
- [x] Files whose record has been deleted for good (by the retention review) are marked
  removed and follow the same rule; files of soft-deleted records are kept for the
  review; records are never deleted by this
- [x] A check that reports stored files with no row and rows with no stored file, on both
  stores
- [x] Storage usage is shown on the File settings page
- [ ] The daily job runs on an in-process timer, not yet on the job queue (E14-27)

**Implemented in:** `server/src/modules/attachments/housekeeping.ts`, `admin.ts`,
`migrations/002_storage_scanning_purge_backups.sql`, `index.ts` (daily timer);
`web/src/modules/attachments/RemovedFiles.tsx`, `FileSettings.tsx`

### E14-16 Notifications from the other modules

**Status:** done · **Priority:** P1 · **Type:** improvement

As a user, I am told when something is assigned to me or needs my decision, not only by
the daily digest. Each of these is one guarded call to `app.notify` in the module that
owns the record (usage is documented at the top of
`server/src/modules/notifications/service.ts`).

**Acceptance criteria**

- [x] Ticket assigned or reassigned: the new assignee (`assignment`)
- [x] Approval requested (change, project gate, risk acceptance, exception): the
  approvers (`approval`)
- [x] Project gate decision due: the project's sponsor or manager (`due`)
- [x] Contract reminder fired: the contract's owner (`reminder`)
- [x] Policy or training acknowledgment requested: each person asked (`acknowledgement`)
- [x] Incident notification clock turns amber or red: the incident lead and everyone
  holding `security.edit` (`clock`)
- [x] Each call is covered by a test in its own module, with the notifications module
  both loaded and not loaded

**Done:** tickets, inventory, vendors, frameworks, risks, security incidents, projects, changes, policies, training, vulnerabilities and reports now call app.notify for their key events.

### E14-17 Notification housekeeping

**Status:** open · **Priority:** P3 · **Type:** improvement

As a user, my notification list does not grow for ever. Today notifications are never
deleted, there is no way to dismiss one, and marking as read is not audited (by design:
read state is a personal view setting).

**Acceptance criteria**

- [ ] A person can delete one notification or all read ones
- [ ] Read notifications older than a set period are removed by a scheduled job
- [ ] An administrator can add kinds to `notification_kind` and they appear in everyone's
  preferences (works today through **Lists**; needs a test and a line in the guide)
- [ ] The digest thresholds (`notifications.action_due_days`,
  `notifications.ticket_breach_hours`, `notifications.action_closed_statuses`) are
  editable on a settings page

### E14-18 Evidence files on evidence-bearing records

**Status:** open · **Priority:** P2 · **Type:** improvement

As a compliance lead, I attach the evidence itself where I record that it exists. The
panel has an evidence mode (`<AttachmentsPanel evidence />`), but no record page uses it
yet: every page gets the plain **Attachments** tab.

**Acceptance criteria**

- [ ] Vendor evidence items, framework outcomes, policy acknowledgments, exercises and
  risk treatments show the panel in evidence mode
- [ ] The vendor **Expiring evidence** page and the **Expiring evidence files** page link
  to each other, or are merged
- [ ] An expiring evidence file raises a `reminder` notification to the record's owner
- [ ] Closes E06-17, E07-12 and E11-17 where they only waited for attachments

### E14-19 Anonymize a record at the end of its retention period

**Status:** open · **Priority:** P3 · **Type:** feature

As an administrator, I keep a record's shape and figures but remove the personal details
in it, as a third choice in the retention review beside extending and removing. Split
from E14-11.

**Acceptance criteria**

- [ ] Each record type declares which fields are personal (people, names, free text)
- [ ] Anonymizing blanks or replaces those fields and the record's comments, and is audited
- [ ] The review entry records the decision and reason

### E14-20 Retention review counts follow row-level restriction

**Status:** open · **Priority:** P3 · **Type:** defect

The retention review list (`GET /api/admin/retention/reviews`) and the pending counts on
`GET /api/admin/retention` count flagged records of every type the reviewer may view,
including individual rows flagged restricted (for example a restricted action) that the
reviewer cannot see. Their labels are hidden, but the counts are not. Low impact: the
routes need `admin.administer`.

**Acceptance criteria**

- [ ] Counts and rows leave out records the reviewer cannot see (`visibleWhere`)
- [ ] A test with an administrator role that lacks `security.view`

### E14-21 Comment search follows the search language setting

**Status:** open · **Priority:** P3 · **Type:** defect

Record search uses `GRC_SEARCH_LANGUAGE`, but the comments trigger in
`server/src/core/migrations/003_platform_services.sql` always uses `english`, so with
another language comment word-ending matches are weaker.

**Acceptance criteria**

- [ ] The comments trigger is (re)built at start-up from the configured language, like the
  record triggers
- [ ] A test with a non-default language

### E14-22 Move the other modules' timers onto the job queue

**Status:** open · **Priority:** P2 · **Type:** debt

As an administrator, all scheduled work shows on **Background jobs** and runs once however
many server processes there are. Split from E14-12: the notifications module's timers are
moved; these still use `setInterval` in their own module: tickets (SLA sweep), changes,
frameworks, inventory reminders, policies, projects, reports (schedules), risks
(lifecycle), security incidents (clocks), training, vendors, vulnerabilities (reminders and
snapshot), core retention sweep and webhook deliveries.

**Acceptance criteria**

- [ ] Each owner replaces its timer with, in `register`:
  `const jobs = await ensureJobs(ctx); jobs.register('<module>.<work>', () => run(), { maxAttempts: 3 });`
  `await jobs.schedule('<module>.<work>', { type: '<module>.<work>', every: <ms>, firstRunInMs: <ms> });`
  and removes the timer and its `onClose` hook (the queue is stopped on close)
- [ ] Its test drives the work with `app.jobs.runDue({ types: ['<module>.<work>'] })` or the
  existing "run now" route, and checks the schedule exists
- [ ] Work that must run at a time of day keeps its own "is it time yet" check inside the
  handler (the schedule only says how often to look), as `notifications.email_digest` does

### E14-23 Start the job queue and email from core

**Status:** open · **Priority:** P3 · **Type:** debt

Today the notifications module starts `app.jobs` and `app.sendMail` in its `seedDefaults`
(they are core services in `server/src/core/jobs` and `server/src/core/mail`), so a server
built with `GRC_MODULES` that leaves notifications out has neither.

**Acceptance criteria**

- [ ] `server/src/app.ts` calls `await ensureJobs(ctx); await ensureMail(ctx);` after `ctx` is
  built and before the `seedDefaults` loop (both are idempotent, so the notifications module's
  calls become no-ops); the migration scopes `core.jobs` and `core.mail` stay as they are
- [ ] A test with `GRC_MODULES=none` sees `/api/admin/jobs` and `/api/admin/mail/settings`

### E14-24 "Forgot your password?" link and help for the new pages

**Status:** open · **Priority:** P2 · **Type:** improvement

The `/forgot-password` page exists (E14-05) but nothing links to it.

**Acceptance criteria**

- [ ] The sign-in screen (`web/src/core/AuthPages.tsx`) shows a **Forgot your password?** link
  under the password box, to `/forgot-password`, shown only when
  `GET /api/auth/forgot-password` says `available: true`
- [ ] The Help route map (`web/src/modules/help/routeMap.ts`) sends `/admin/email`,
  `/admin/jobs` and `/forgot-password` to `14-attachments-and-notifications` (sections
  `email-settings`, `background-jobs`, `forgot-your-password`)

### E14-25 Another mail provider (a mail service's web interface)

**Status:** open · **Priority:** P3 · **Type:** feature

As an administrator whose mail service offers only a web interface, I send through it. The
provider interface is in place (`MailProvider` and `registerMailProvider` in
`server/src/core/mail/provider.ts`); nothing else needs to change.

**Acceptance criteria**

- [ ] A provider file registering itself, reusing the stored settings (host as the endpoint,
  user name as the key id, the encrypted password as the secret)
- [ ] Only to the configured host; no redirects; a time-out; 4xx-like answers retried, others not
- [ ] A test with a stand-in HTTP server on port 0

### E14-26 Other modules' tests stand in for `notify` and `sendMail` safely

**Status:** open · **Priority:** P3 · **Type:** defect

Some tests add their own `notify` or `sendMail` decorator to record calls. With every module
loaded the real service is already there: `reports/files.test.ts` fails ("The decorator
'sendMail' has already been added"). (`attachments/backups.test.ts` and
`attachments/storage-admin.test.ts` had the same problem; they now wrap whichever `notify` is
present, and pass alone and with every module.)

**Acceptance criteria**

- [ ] Stand-ins are added only when missing (`if (!ctx.app.hasDecorator('sendMail'))`), and the
  assertions read what the real service stored when it is present (the `notifications` table,
  or `mail_log` for email), so the tests pass alone and with every module

### E14-27 File housekeeping, rescans and moves as background jobs

**Status:** open · **Priority:** P3 · **Type:** improvement

The attachments module's daily purge, the server's own backup schedule (E16-17) and the batch
malware rescan run on in-process timers or inside one request, and moving files between the
disk and the object store is a command run with the server stopped.

**Acceptance criteria**

- [ ] The daily purge and the backup schedule run as job-queue schedules (E14-12), visible on
  Administration > Background jobs
- [ ] **Scan files attached earlier** and moving files to the other store can be started from
  File settings and run as jobs, with progress, while the application keeps running
