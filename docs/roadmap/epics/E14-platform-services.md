# E14 Platform services

**Status:** done (39 of 39 issues done)
full-text search built; custom fields, tags and watchers built with their screens; retention
built on the server and screens, with anonymizing; evidence files on record pages built, with expiry reminders;
feature switches for optional areas built; approval workflows built)

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
- Approval workflows (E14-06) are the `workflows` module: ordered approval steps any record
  type can use, defined by an administrator. Modules hand their own approvals to it as approval
  kinds (`core/approval-kinds.ts`): change approval (E05-13), catalog request approval (E03-22),
  project gates (E11-25), asset disposal (E04-24) and risk acceptance (E08-23). The module starts
  the workflow and is called back on each decision and at the end, so it keeps its own rules;
  each kind installs once (its ready-made workflows, and the approvals waiting at the upgrade). Allowed status changes, required
  fields and who may set a status are data per record type (E14-31, Administration > Lifecycles);
  modules' own lifecycle rules stay in code and the data can only restrict them.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E14-01 | Attachments on any record | done | P1 |
| E14-02 | Custom fields | done | P3 |
| E14-03 | In-app notifications | done | P1 |
| E14-04 | Email delivery | done | P2 |
| E14-05 | Email setup and reset links | done | P2 |
| E14-06 | Workflow engine with approvals | done | P3 |
| E14-07 | Full-text search | done | P2 |
| E14-08 | Tags | done | P3 |
| E14-09 | Watchers | done | P3 |
| E14-10 | Bulk edit | done | P2 |
| E14-11 | Retention settings and review flags | done | P2 |
| E14-12 | Job queue for background work | done | P2 |
| E14-13 | Object-storage driver for attachments | done | P2 |
| E14-14 | Malware scanner for attachments | done | P1 |
| E14-15 | Purge and retention of removed files | done | P2 |
| E14-16 | Notifications from the other modules | done | P1 |
| E14-17 | Notification housekeeping | done | P3 |
| E14-18 | Evidence files on evidence-bearing records | done | P2 |
| E14-19 | Anonymize a record at the end of its retention period | done | P3 |
| E14-20 | Retention review counts follow row-level restriction | done | P3 |
| E14-21 | Comment search follows the search language setting | done | P3 |
| E14-22 | Move the other modules' timers onto the job queue | done | P2 |
| E14-23 | Start the job queue and email from core | done | P3 |
| E14-24 | "Forgot your password?" link and help for the new pages | done | P2 |
| E14-25 | Another mail provider (a mail service's web interface) | done | P3 |
| E14-26 | Other modules' tests stand in for `notify` and `sendMail` safely | done | P3 |
| E14-27 | File housekeeping, rescans and moves as background jobs | done | P3 |
| E14-28 | Switch optional parts of the application on and off | done | P2 |
| E14-29 | Larger messages through Microsoft Graph | done | P3 |
| E14-30 | Wait as long as a throttled mail service asks | done | P3 |
| E14-31 | Allowed status changes and required fields as data per record type | done | P3 |
| E14-32 | Approval workflows that branch, run steps side by side or delegate | done | P3 |
| E14-33 | Retention decisions raise webhook events | done | P3 |
| E14-34 | A switched-off part is shown nowhere but its switch | done | P2 |
| E14-35 | Organization settings: details, logo and accessible brand colors | done | P2 |
| E14-36 | Branding in the remaining places: email logo, HTML report documents, WebP logos in PDFs | done | P3 |
| E14-37 | A status change that needs approval waits for an approval workflow | done | P3 |
| E14-38 | The daily email summary leaves out switched-off parts | done | P3 |
| E14-39 | A metric registry for computed indicators | done | P2 |

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

**Status:** done · **Priority:** P3 · **Type:** feature

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
- [x] Generic form, record page, list columns and filters render `custom: true` fields,
  including `multiple`, `help` and `section` (web core: `ResourceForm`, `EditableSummary`,
  `CustomFieldsCard`, `RecordPage`, `ResourceList`, `FieldValue`); hand-written forms use
  `useCustomFieldInputs` (E18-34)
- [x] A **Custom fields** administration page (web admin):
  `web/src/modules/admin/CustomFields.tsx` (`/admin/custom-fields`), with moving fields up and
  down; a choice field's options are edited under Lists, where its list is named after the field

**Implemented in:** `server/src/core/customfields.ts`, `server/src/core/customfield-routes.ts`,
`server/src/core/resource.ts` (validation, storage in the `custom` column, filters,
sorting, export, audit); `web/src/core/FieldControl.tsx`, `web/src/core/CustomFieldInputs.tsx`,
`web/src/core/ResourceForm.tsx`, `web/src/core/RecordPage.tsx`, `web/src/core/ResourceList.tsx`,
`web/src/modules/admin/CustomFields.tsx`; tests in `server/src/core/platform.test.ts`
("custom fields"). Routes: `GET /api/admin/custom-fields?record_type=`,
`POST /api/admin/custom-fields`, `PATCH/DELETE /api/admin/custom-fields/:id` (DELETE switches
the field off).

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

**Status:** done · **Priority:** P2 · **Type:** improvement

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
- [x] A link to that page on the sign-in screen (E14-24)
- [x] The response is the same whether or not the username or address is known
- [x] Requests are rate-limited (5 in 15 minutes from one address, then 429; 3 links an hour
  for one account, silently) and audited (`password.reset_request`)
- [x] Depends on E14-04; the current hand-over method remains when email is off (the page
  then says to ask an administrator)

**Implemented in:** `server/src/core/mail/links.ts` (`GET/POST /api/auth/forgot-password`, and an
`onSend` hook on the admin module's three link routes); `web/src/modules/notifications/ForgotPassword.tsx`;
tests in `server/src/core/mail/mail.test.ts` ("forgotten password")

### E14-06 Workflow engine with approvals

**Status:** done · **Priority:** P3 · **Type:** feature

As an administrator, I define for a record type which changes need approval, who approves
them and what happens at the end, instead of this being written in each module.

**Acceptance criteria**

- [x] Transitions, conditions and required fields are data per record type: conditions are built
  here, on starting a workflow and on each step; allowed status changes and required fields were
  built in E14-31
- [x] Per record type, workflows with ordered steps; each step approved by named people, a role,
  a person field of the record (owner, manager) or a department head (of the requester's
  department or the one a field names; heads set on the Department heads tab), with a quorum
  (any one, all, or a number), optional conditions on the record's fields (lists, numbers,
  amounts, dates, text, people, yes/no) that skip the step when they do not hold, and a due time
  with escalation through the job queue and notifications
- [x] Started on create, when a list field changes to a value, or by hand from the record page
  (anyone who may edit the record), with conditions on which records; one running copy per
  record; running workflows keep the version they started with
- [x] At the end, fields are set on approval and on rejection (with "today", "the last approver"
  and "the requester"); a refused outcome is recorded and shown, never lost
- [x] Approvers act from a notification, the **Approvals** page (waiting for me, decided by me,
  my requests) and the record's approval panel; nobody approves their own request; a rejection
  needs a reason; each person decides once
- [x] Every start, decision, escalation, cancelation and outcome is an audit event on the
  record; restricted records go only to approvers who may see them; a switched-off area's
  workflows do nothing and leave every list until it is back on
- [x] Webhook events `workflow.decided` and `workflow.finished`; MCP tools `my_approvals` and
  `decide_approval`
- [x] Administration > Approval workflows: workflows by record type with a picture of their
  steps, an editor with the flow drawn beside it, running workflows (with cancel) and
  department heads
- [x] Existing per-module rules keep working until moved across
- [x] First users: moving change approval, asset disposal and risk acceptance (and catalog request
  approvals and project gates) across is raised per module: E05-13, E04-24, E08-23, E03-22, E11-25
  (all five done in wave 7, through approval kinds: `server/src/core/approval-kinds.ts`)

**Implemented in:** `server/src/modules/workflows/` (`engine.ts` rules, `service.ts`,
`routes.ts`, `index.ts`, `migrations/001_workflows.sql`), `WEBHOOK_EVENTS` in
`server/src/core/webhooks.ts`, `server/src/modules/mcp/tools-approvals.ts`; web
`web/src/modules/workflows/` (`ApprovalsPage.tsx`, `WorkflowsAdmin.tsx`, `WorkflowEditor.tsx`,
`FlowDiagram.tsx`, `WorkflowPanel.tsx`), the panel's slot in `web/src/core/RecordPage.tsx`;
routes `/api/workflows/options`, `/definitions`, `/department-heads/:id`, `/running`,
`/approvals`, `/approvals/count`, `/records/:type/:id` (and `/start`), `/steps/:id/decision`,
`/instances/:id/cancel`; tests `engine.test.ts`, `workflows.test.ts`, `mcp-approvals.test.ts`;
user guide [Approval workflows](../../user/22-approval-workflows.md); module adoption in
[the developer guide](../../development.md#approval-workflows-shared-engine)

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
- [x] Global search box shows the snippet with matches marked (`web/src/core/CommandPalette.tsx`: `snippetParts` drawn with `<mark>`)

**Implemented in:** `server/src/core/search.ts`, `server/src/core/resource.ts` (list `q`),
`GET /api/search` in `server/src/core/routes.ts`,
`server/src/core/migrations/003_platform_services.sql`; tests in
`server/src/core/platform.test.ts` ("full-text search")

### E14-08 Tags

**Status:** done · **Priority:** P3 · **Type:** feature

As a user, I add free-form tags to any record and filter lists by them.

**Acceptance criteria**

- [x] Add and remove tags on any record the caller may edit (normalized to lower case,
  at most 30 per record, audited as `tag.change`); reading needs view on the record
- [x] Existing tags are suggested as I type, counted only over records the caller may see
- [x] Lists can be filtered by tag: `f.tags=a,b` (any), `f.tags.all=a,b`,
  `f.tags.null=true`; rows carry `_tags`
- [x] Administrators can rename and merge tags (audited), on the **Tags** tab of
  Administration > Lists, which lists each record type's tags with how many records carry them
- [x] Tag editor on the record page, tag column and filter on generic lists (web core:
  `RecordTags`, `TagChips`, `TagsFilter` in `web/src/core/tags.tsx`)

**Implemented in:** `server/src/core/tags.ts`, `server/src/core/resource.ts` (filter and
`_tags`), `web/src/core/tags.tsx`, `web/src/core/RecordPage.tsx`, `web/src/core/ResourceList.tsx`,
`web/src/modules/admin/Lists.tsx` (Tags tab); tests in `server/src/core/platform.test.ts`
("tags and watchers"). Routes: `GET /api/tags?record_type=&record_id=`, `PUT /api/tags`
(`{ record_type, record_id, tags }` replaces), `POST /api/tags` (adds one),
`DELETE /api/tags?record_type=&record_id=&tag=`, `GET /api/tags/options?record_type=&q=`
(`[{ tag, count }]`), `POST /api/admin/tags/rename` (`{ record_type, from, to }`; merges when
`to` exists).

### E14-09 Watchers

**Status:** done · **Priority:** P3 · **Type:** feature

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
- [x] **Watch** button on the record page (with who watches on hover) and a **Watching** list
  on the Overview (web: `WatchButton` in `web/src/core/tags.tsx`, placed by `RecordPage`;
  `web/src/modules/home/widgetsMyWork.tsx`)
- [x] A `watch` value ("Records I watch") in `notification_kind`, so people can switch these
  off or have them emailed (notifications module)

**Implemented in:** `server/src/core/tags.ts`, comment hook in `server/src/core/routes.ts`,
`web/src/core/tags.tsx`, `web/src/core/RecordPage.tsx`; tests in
`server/src/core/platform.test.ts` ("tags and watchers"). Routes:
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
  are attached, and is the only hard delete in the application (anonymizing: E14-19, done)
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
- [x] The daily job runs on the job queue (built in E14-27: schedule `attachments.housekeeping`)

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

**Status:** done · **Priority:** P3 · **Type:** improvement

As a user, my notification list does not grow for ever. Today notifications are never
deleted, there is no way to dismiss one, and marking as read is not audited (by design:
read state is a personal view setting).

**Acceptance criteria**

- [x] A person can delete one notification or all read ones (hidden at once, removed for good
  by housekeeping two days later, so "once a day" reminders still see them)
- [x] Read notifications older than a set period (`notifications.keep_read_days`, 90) are
  removed by a scheduled job; unread ones and those waiting for a daily email are kept
- [x] An administrator can add kinds to `notification_kind` and they appear in everyone's
  preferences (tested; a line in the guide)
- [x] The digest thresholds (`notifications.action_due_days`,
  `notifications.ticket_breach_hours`, `notifications.action_closed_statuses`) and the
  digest hour are editable on Administration > Reminders, audited

**Implemented in:** `server/src/modules/notifications/` (`index.ts` `DELETE
/api/notifications/:id`, `POST /api/notifications/delete-read`; `housekeeping.ts` job
`notifications.housekeeping`; `reminder-settings.ts` `GET/PATCH
/api/notifications/reminder-settings`; migration `003_housekeeping.sql`: `dismissed_at`,
`notification_once`), `web/src/modules/notifications/` (`NotificationsPage.tsx`,
`NotificationItem.tsx`, `ReminderSettings.tsx` at `/admin/reminders`); tests
`notifications/housekeeping.test.ts`. Also: `app.notify({ once })` sends to each person at
most once per occasion, and `oncePerDay` now counts the organization's day, not the
database's.

### E14-18 Evidence files on evidence-bearing records

**Status:** done · **Priority:** P2 · **Type:** improvement

As a compliance lead, I attach the evidence itself where I record that it exists.

**Acceptance criteria**

- [x] Vendor evidence items, framework outcomes, policy acknowledgments, exercises and
  risk treatments show the panel in evidence mode: `/api/meta` marks evidence-bearing types
  (`evidence: true`; `ResourceDef.evidence`, else core's `EVIDENCE_TYPES`: evidence items,
  framework outcomes, obligations, policies, exercises and risks), and `RecordPage` then names
  its files tab **Evidence files** and opens the panel with `evidence` (prop `evidence` overrides).
  Pages with an Evidence tab of their own (framework outcomes, obligations, security incidents,
  vendor evidence items) keep it
- [x] The vendor **Expiring evidence** page and the **Expiring evidence files** page link
  to each other (kept apart: one lists vendor evidence items by their own date, the other
  evidence files on any record): **Expiring evidence files on any record** and **Expiring
  vendor evidence** (shown when vendors are on and the person can view them)
- [x] An expiring evidence file raises a `reminder` notification to the record's owner
  (attachments module, daily job `attachments.evidence_reminders`): 30 and 7 days before and
  on the day, each once per file and date (the nearest step only when several are due); the
  owner is the record's `owner_id` (or first owner-like person field), else the person who
  attached the file; files on vendor evidence items are left out (the item's own reminders)
- [x] Closes E06-17, E07-12 and E11-17 where they only waited for attachments (all three
  were already done)

**Implemented in:** `server/src/core/module.ts` (`evidence`), `server/src/core/resource.ts`
(`EVIDENCE_TYPES`, `evidenceFor`), `server/src/core/routes.ts` (`/api/meta`),
`web/src/core/RecordPage.tsx`, `web/src/core/meta.tsx`; test in
`server/src/core/records-platform.test.ts` ("evidence files in metadata").
Reminders: `server/src/modules/attachments/evidenceReminders.ts` (scheduled in `index.ts`),
test `evidenceReminders.test.ts`. Links between the pages:
`web/src/modules/attachments/ExpiringEvidenceFiles.tsx`, `EvidenceExpiring` in
`web/src/modules/vendors/EvidencePages.tsx`.

### E14-19 Anonymize a record at the end of its retention period

**Status:** done · **Priority:** P3 · **Type:** feature

As an administrator, I keep a record's shape and figures but remove the personal details
in it, as a third choice in the retention review beside extending and removing. Split
from E14-11.

**Acceptance criteria**

- [x] Each record type declares which fields are personal (people, names, free text):
  `FieldDef.personal`, defaulting to person and long-text fields and text fields named like
  an email address, phone number or person's name (`isPersonal` in `core/retention.ts`)
- [x] Per record type an administrator chooses what the review may do
  (`retention_policies.disposal`: keep, anonymize or delete; core migration 013)
- [x] Anonymizing replaces those fields (and long-text and person custom fields,
  `created_by`, `updated_by`), the record's comments (text and author), the contents and names
  of its files, the titles of notifications about it, and drops its watchers; the search
  index follows by its triggers. The row, its figures, tags and links stay, so counts are
  identical for everyone
- [x] Needs a reason, an explicit confirmation and a recent identity confirmation; cannot be
  undone (the confirmation says so); audited (`retention.anonymize`, without the removed values)
- [x] The audit log is append-only and not changed (it keeps who changed what, by design);
  `retention.audit_months` is recorded, not enforced
- [x] The review entry records the decision and reason (status `anonymized`)
- [x] **Anonymize…** on the review list and the choice in the period dialog

**Implemented in:** `server/src/core/retention.ts` (`anonymize`, `personalFields`),
`server/src/core/module.ts` (`FieldDef.personal`),
`server/src/core/migrations/013_retention_anonymize.sql`, `web/src/modules/admin/Retention.tsx`;
test `server/src/core/retention.test.ts`. Routes: `PUT /api/admin/retention/:type` takes
`disposal`; `POST /api/admin/retention/reviews/:id/anonymize` (`{ reason, confirm: true }`).

### E14-20 Retention review counts follow row-level restriction

**Status:** done · **Priority:** P3 · **Type:** defect

The retention review list (`GET /api/admin/retention/reviews`) listed flagged records of every
type the reviewer may view, including individual rows flagged restricted (for example a
restricted action) that the reviewer cannot see, as "Record no longer exists", and let the
reviewer decide them. Low impact: the routes need `admin.administer`.

Resolved under the rule that figures are the same for everyone (see
[Security](../../security.md)): the **pending counts** on `GET /api/admin/retention` are figures
and keep counting every flagged record, restricted or not, for every administrator; the
**review list** is a drill-down and shows only what the reviewer may see.

**Acceptance criteria**

- [x] The review list, and its total, leave out rows the reviewer cannot see (`visibleWhere` per
  record type with restricted rows); a record that no longer exists stays listed
- [x] Extending or removing a review of a row the reviewer cannot see answers 404, like a
  missing review
- [x] The pending counts are identical for every administrator
- [x] A test with an administrator role that lacks `security.view`

**Implemented in:** `server/src/core/retention.ts`; test in
`server/src/core/records-platform.test.ts` ("retention reviews under row-level restriction").

### E14-21 Comment search follows the search language setting

**Status:** done · **Priority:** P3 · **Type:** defect

Record search uses `GRC_SEARCH_LANGUAGE`, but the comments trigger in
`server/src/core/migrations/003_platform_services.sql` always used `english`, so with
another language comment word-ending matches were weaker.

**Acceptance criteria**

- [x] The comments trigger is (re)built at start-up from the configured language, like the
  record triggers, and every comment's vector is recomputed once when the language changes
  (remembered in `search_index_state` under `__comments`); an unknown configuration leaves
  the trigger as it was
- [x] A test with a non-default language (`french`)

**Implemented in:** `server/src/core/search.ts` (`ensureCommentSearch`), called from
`server/src/core/resource.ts` at start-up; test in `server/src/core/records-platform.test.ts`
("comment search language").

### E14-22 Move the other modules' timers onto the job queue

**Status:** done · **Priority:** P2 · **Type:** debt

As an administrator, all scheduled work shows on **Background jobs** and runs once however
many server processes there are. Split from E14-12: the notifications module's timers are
moved; these still use `setInterval` in their own module: tickets (SLA sweep), changes,
frameworks, inventory reminders, policies, projects, reports (schedules), risks
(lifecycle), security incidents (clocks), training, vendors, vulnerabilities (reminders and
snapshot), core retention sweep and webhook deliveries.

**Acceptance criteria**

- [x] Each owner replaces its timer with one call in `register`:
  `await scheduleWork(ctx, '<module>.<work>', () => run(), { every: <ms>, firstRunInMs: <ms> })`
  (`core/jobs/index.ts`: registers the handler and a schedule of the same name) and removes
  the timer and its `onClose` hook. Done for tickets (`tickets.sla_sweep`), changes
  (`changes.starting_soon`), frameworks (`frameworks.review_reminders`), inventory
  (`inventory.reminders`), policies (`policies.daily_checks`), projects
  (`projects.reminders`), reports (`reports.deliver`, by the reports work), risks
  (`risks.lifecycle`), security incidents (`secincidents.clock_sweep`), safety
  (`safety.reminders`), training (`training.daily`), vendors (`vendors.contract_reminders`,
  `vendors.evidence_reminders`), vulnerabilities (`vulnerabilities.overdue_sweep`,
  `vulnerabilities.snapshot`) and attachments (E14-27). Core's own retention sweep and
  webhook deliveries move with E14-23, which changes `app.ts`
- [x] Tests check the schedules exist and drive the work through the queue or the existing
  "run now" routes (`core/jobs/jobs.test.ts` covers `scheduleWork`)
- [x] Work that must run at a time of day keeps its own "is it time yet" check inside the
  handler (the backup schedule, report schedules)

**Implemented in:** `server/src/core/jobs/index.ts` (`scheduleWork`; finished runs of a
schedule are cleaned up after two days), `queue.ts` (`JobInfo.progress`), and the timer
code of each module listed above.

### E14-23 Start the job queue and email from core

**Status:** done · **Priority:** P3 · **Type:** debt

Today the notifications module starts `app.jobs` and `app.sendMail` in its `seedDefaults`
(they are core services in `server/src/core/jobs` and `server/src/core/mail`), so a server
built with `GRC_MODULES` that leaves notifications out has neither.

**Acceptance criteria**

- [x] `server/src/app.ts` calls `await ensureJobs(ctx); await ensureMail(ctx);` after `ctx` is
  built and before the `seedDefaults` loop (both are idempotent, so the notifications module's
  calls become no-ops); the migration scopes `core.jobs` and `core.mail` stay as they are
- [x] Core's retention sweep (`core/retention.ts`) and webhook deliveries
  (`core/webhooks.ts`) drop their timers and run as the schedules `core.retention_sweep` and
  `core.webhook_deliveries` registered there (moved from E14-22)
- [x] A test with `GRC_MODULES=none` sees `/api/admin/jobs` and `/api/admin/mail/settings`
  and the two core schedules

**Implemented in:** `server/src/app.ts` (ensureJobs, ensureMail, schedules `core.webhook_deliveries` every minute and `core.retention_sweep` daily), `server/src/core/retention.ts` and `server/src/core/webhooks.ts` (timers removed; a new delivery is still tried at once), `server/src/core/jobs/core-start.test.ts`.

### E14-24 "Forgot your password?" link and help for the new pages

**Status:** done · **Priority:** P2 · **Type:** improvement

The `/forgot-password` page exists (E14-05) but nothing links to it.

**Acceptance criteria**

- [x] The sign-in screen (`web/src/core/AuthPages.tsx`) shows a **Forgot your password?** link
  under the password box, to `/forgot-password`, shown only when
  `GET /api/auth/forgot-password` says `available: true` (and not at the code step, nor while passwords are switched off)
- [x] The Help route map (`web/src/modules/help/routeMap.ts`) sends `/admin/email`,
  `/admin/jobs` and `/forgot-password` to `14-attachments-and-notifications` (sections
  `email-settings`, `background-jobs`, `forgot-your-password`) (`/admin/email` and `/admin/jobs` are
  done; `/forgot-password` still goes to `01-getting-started`: the change was handed to the Help owner in wave 4)

**Implemented in:** `web/src/core/AuthPages.tsx` (the link), `web/src/modules/help/routeMap.ts`.

### E14-25 Another mail provider (a mail service's web interface)

**Status:** done · **Priority:** P3 · **Type:** feature

As an administrator whose mail service has switched off SMTP sign-in with a password, I send
through the service's web interface instead: Microsoft Graph (Microsoft 365, Exchange Online)
or the Gmail API (Google Workspace). Email to ticket can read its mailbox the same way.

**Acceptance criteria**

- [x] Two providers registering themselves beside SMTP (`registerMailProvider`), chosen under
  Administration > Email (**Send through**); `app.sendMail` and every caller unchanged
- [x] Microsoft Graph: an app registration signs in as itself (client credentials) with a client
  secret or, recommended, a certificate (a signed client assertion; the certificate and key are
  checked on save, the thumbprint and expiry shown), and sends as one named mailbox (default:
  the from address) with `sendMail`; worldwide, GCC High and DoD clouds
- [x] Gmail API: a service account with domain-wide delegation (chosen over a person's OAuth
  refresh token: no browser sign-in, tied to no one person, granted and withdrawn scope by scope
  by the Workspace administrator), acting as one named mailbox with the `gmail.send` scope; the
  `token_uri` inside the key file is never used
- [x] The message goes as MIME (built with nodemailer's stream transport, no new package), so
  every header the application sets reaches the recipient (threading, `Auto-Submitted`,
  `X-GRC-Mail`)
- [x] Secrets encrypted with the secret key like the SMTP password (context `mail:<provider>`),
  never returned, never in the audit trail; each provider's credential is kept when another is
  chosen
- [x] Only to the provider's published addresses (fixed in code, not settings); HTTPS only; no
  redirects; a time-out; answer size limit; access tokens cached until shortly before expiry, a
  refused token replaced once
- [x] Plain errors: wrong tenant, client ID, secret or expired secret, certificate not uploaded,
  consent or permission missing, delegation missing (naming the client ID and scope), wrong
  mailbox, send-as refused, message too large; throttling (429, 503, 504, rate-limit reasons) and
  server errors retried through the mail queue with its back-off, the rest not retried
- [x] **Send a test message** works for every provider; settings changes and tests are audited,
  naming the provider
- [x] Email to ticket reads a mailbox through Microsoft Graph (`Mail.ReadWrite`) or the Gmail API
  (`gmail.modify`) as well as POP3, with the sign-in saved under Email: unread inbox messages;
  done with, each moves to Deleted Items or Trash, or is marked read when left in the mailbox
  (`InboundMailbox` in `core/mail/mailbox.ts` is the seam)
- [x] Tests against stand-in Microsoft and Google services on port 0 (no network): sending,
  certificate sign-in, token reuse and refresh, throttling and retry, every error above, reading
  and tidying mailboxes, and email to ticket end to end

**Implemented in:** `server/src/core/mail/cloud.ts` (fixed addresses, HTTPS calls, token cache,
RS256 signing, certificate and key-file checks, MIME), `graph.ts`, `gmail.ts`, `accounts.ts`
(stored credentials, `openServiceMailbox`), `mailbox.ts` (`InboundMailbox`, `pop3Mailbox`),
`service.ts` (the provider's credential), `routes.ts` (settings and test),
`migrations/002_providers.sql` (`provider_settings`, `provider_secrets`); tests `providers.test.ts`
with `cloud-fake.ts`; `server/src/modules/tickets/email.ts` (sources `graph` and `gmail`) and
`email-services.test.ts`; web `modules/notifications/EmailSettings.tsx`,
`modules/tickets/SettingsEmail.tsx`. Larger messages through Graph (E14-29) and waiting as long
as a throttled service asks (E14-30) are separate issues.

### E14-29 Larger messages through Microsoft Graph

**Status:** done · **Priority:** P3 · **Type:** feature

Microsoft Graph takes one `sendMail` request of at most 4 MB, so a message larger than about
3 MB with its files was refused when sending through Graph; SMTP and the Gmail API take up to
10 MB of files. Graph accepts larger messages by creating a draft and uploading each large file in
an upload session, but a draft cannot carry `Auto-Submitted` or `References` (only up to five `X-`
headers), which the loop guards and threading need.

**Acceptance criteria**

- [x] Messages up to the 10 MB attachment limit go through Graph: a message over one request is
  created as a draft, files over 3 MB are uploaded through an upload session in 3,200 KiB chunks
  (the upload address must be a Microsoft one; no access token is sent to it), smaller ones added
  directly, then the draft is sent; a draft left by a failed attempt is deleted
- [x] Equivalents for the headers: the Message-ID is kept (`internetMessageId`), `References` and
  `In-Reply-To` are set through the MAPI properties Exchange writes them from (0x1039, 0x1042),
  `X-Auto-Response-Suppress: All` (honored by Exchange and Outlook in place of `Auto-Submitted`)
  and `X-GRC-Mail` (the application's own loop guard) stay headers, the loop guards first
- [x] A test with the stand-in Graph service (draft, attachments, chunked upload session with
  Content-Range checks, send, the 4 MB and five-header limits, the draft removed after a failure)

**Implemented in:** `server/src/core/mail/graph.ts` (`sendLarge`, `graphDraft`),
`server/src/core/mail/cloud-fake.ts` (drafts, `/graph-upload/`); tests in `providers.test.ts`

### E14-30 Wait as long as a throttled mail service asks

**Status:** done · **Priority:** P3 · **Type:** feature

A throttled message (Graph or Gmail answering 429 or 503 with `Retry-After`, or an SMTP 4xx reply
such as "try again in 5 minutes") waits as long as the service asked before the next attempt, at
most an hour, instead of the mail queue's usual back-off (1, 2, 4 and 8 minutes).

**Acceptance criteria**

- [x] A job handler can ask for its next attempt no sooner than a given time (`core/jobs`):
  `RetryLaterError(message, seconds | date)`, or any error with `retryAt` / `retryAfterSeconds`;
  at least one second, at most six hours; the attempt still counts toward `maxAttempts`
- [x] The mail providers pass the service's `Retry-After` (seconds or an HTTP date) through it,
  and SMTP's "try again in N seconds/minutes/hours" (`smtpRetryAfter`); the mail job bounds the
  wait to an hour
- [x] Tests (queue, Graph seconds and date, SMTP reply text)

**Implemented in:** `server/src/core/jobs/queue.ts` (`RetryLaterError`, `requestedWait`),
`server/src/core/mail/cloud.ts` (`throttledError`), `provider.ts` (`retryAfterSeconds`,
`smtpRetryAfter`), `service.ts` (`MAX_MAIL_WAIT_SECONDS`); tests in `core/jobs/jobs.test.ts`,
`core/mail/providers.test.ts`, `core/mail/mail.test.ts`

### E14-26 Other modules' tests stand in for `notify` and `sendMail` safely

**Status:** done · **Priority:** P3 · **Type:** defect

Some tests add their own `notify` or `sendMail` decorator to record calls. With every module
loaded the real service is already there: `reports/files.test.ts` fails ("The decorator
'sendMail' has already been added"). (`attachments/backups.test.ts` and
`attachments/storage-admin.test.ts` had the same problem; they now wrap whichever `notify` is
present, and pass alone and with every module.)

**Acceptance criteria**

- [x] Stand-ins are added only when missing (`if (!ctx.app.hasDecorator('sendMail'))`), or
  replace the real service for the test, so the tests pass alone and with every module.
  Verified: every `decorate('notify' | 'sendMail')` in a test is guarded
  (`core/platform.test.ts`, `admin/sso.test.ts`, `attachments/backups.test.ts`,
  `attachments/storage-admin.test.ts`, `tickets/service.test.ts`, `reports/files.test.ts`),
  and those files pass with the notifications module loaded

**Implemented in:** the test files above (`reports/files.test.ts` by the reports work).

### E14-27 File housekeeping, rescans and moves as background jobs

**Status:** done · **Priority:** P3 · **Type:** improvement

The attachments module's daily purge, the server's own backup schedule (E16-17) and the batch
malware rescan run on in-process timers or inside one request, and moving files between the
disk and the object store is a command run with the server stopped.

**Acceptance criteria**

- [x] The daily purge and the backup schedule run as job-queue schedules (E14-12), visible on
  Administration > Background jobs (`attachments.housekeeping`, daily; `backups.schedule`,
  every five minutes with the time-of-day check inside, an hour's lease)
- [x] **Scan files attached earlier** and moving files to the other store can be started from
  File settings and run as jobs, with progress, while the application keeps running
  (`attachments.rescan`, `attachments.move`; one of each at a time; the move needs a recent
  password confirmation; both audited when started)

**Implemented in:** `server/src/modules/attachments/` (`index.ts`, `backups.ts`,
`background.ts`: `GET /api/attachments/admin/background`, `POST
/api/attachments/admin/rescan/start`, `POST /api/attachments/admin/storage/move`;
`housekeeping.ts` `moveFiles` reports progress), `web/src/modules/attachments/`
(`BackgroundWork.tsx`, used by `ScannerSettings.tsx` and `StorageSettings.tsx`); tests
`attachments/background.test.ts`. The `move-files` command still works with the server stopped.

### E14-28 Switch optional parts of the application on and off

**Status:** done · **Priority:** P2 · **Type:** feature

An organization that does not run vehicles or a safety program here (or does not use the service
desk, projects and so on) needs those parts gone for everyone, not just hidden from a menu, and
back whole when it changes its mind.

**Acceptance criteria**

- [x] Administration > Features: one switch per optional area (service desk, self-service portal,
  change enablement, vendors and contracts, framework outcomes, risks and obligations, security
  incidents, policies and exceptions, training and exercises, vulnerabilities, projects, dashboards
  and reports, fleet and services, safety management) with a one-line description, what it needs
  and what needs it, a confirmation that says data is kept, a recent identity confirmation, and an
  audit event (`features.change`). AI assistant access is shown with a link to its own page.
  Inventory, the action tracker, notifications, files, administration, the Overview and Help are
  always on
- [x] Existing installations keep everything on (an area missing from the `features` setting takes
  its default); the portal keeps its own setting and its off default
- [x] Inconsistent combinations are refused (the portal needs the service desk), on the Features
  page, the general settings route and the portal's own switch; the page offers to switch the
  dependent area too
- [x] Enforced centrally (`server/src/core/features.ts`): permissions of an off area are held by
  nobody, `*` and tokens included; its record types leave the resource registry (metadata, search,
  links, relationship map, report catalog, imports, custom fields, retention, webhooks, OpenAPI,
  MCP tools); its module's routes, its types' generated routes and core routes asked about its
  types answer 404 `switched_off`; its background jobs are skipped; sample data is not seeded. The
  state is cached briefly and refreshed when the setting is written: no restart
- [x] Web: menu, Create menu, command palette, pages ("switched off" page), Overview widgets,
  impact panels (services and vehicles on system pages and the incident Affected tab), portal
  safety reporting, role editor (areas marked switched off) and Help (pages left out of the list and
  search, marked when opened) follow the switches
- [x] Tests for an administrator and a token: routes, search, metadata, report catalog, MCP tools,
  OpenAPI paths and scheduled reminders disappear and come back; dependencies, audit and identity
  confirmation

**Implemented in:** `server/src/core/features.ts` (areas, cached state, route and registry gate),
`core/services.ts` (`can`), `core/auth.ts` (`loadUser` `off`, `/api/auth/state` `features` and
`areasOff`), `core/openapi.ts`, `core/jobs/queue.ts`, `app.ts`, `cli.ts` (seed),
`modules/admin/features.ts` (`GET/PATCH /api/admin/features`) and `settings.ts`,
`modules/portal/settings.ts`; web `core/auth.tsx` (`areaOn`, `switchedOff`), `core/module.ts`
(`MODULE_AREA`), `core/Shell.tsx`, `App.tsx`, `core/pages.tsx` (`SwitchedOff`),
`modules/admin/Features.tsx`, `RoleDetail.tsx`, `Settings.tsx`, `modules/home/OverviewPage.tsx`,
`modules/help/areas.ts`; tests `modules/admin/features.test.ts`. What was still shown of a
switched-off area (links, fields, list values, notifications, the portal's settings) was removed in
E14-34.

### E14-31 Allowed status changes and required fields as data per record type

**Status:** done · **Priority:** P3 · **Type:** feature

As an administrator, I say for a record type which status changes are allowed, who may make
them and which fields must be filled in first, instead of this being written in each module.
Split from E14-06, which built the approval workflows.

**Acceptance criteria**

- [x] Allowed moves between the values of a status field, per record type, kept as data (table
  `lifecycle_rules`, core migration 015), including the statuses a new record may start with.
  Stored as the moves that are *not* allowed, so the shipped defaults (no row) allow every move and
  require nothing, exactly as before: an upgrade changes nothing (a table-driven test over every
  record type)
- [x] Fields required before a status (built-in fields a person fills in, and custom fields), and who
  may move a record to it (a permission or one of some roles)
- [x] Enforced in the resource engine on every save a person makes (forms, bulk edit, the API,
  imports and their dry run, MCP tools), with the usual 400 `validation` field errors; system work
  (seeding, automation) is not checked. The web form offers only the allowed next statuses and marks
  the fields the chosen status needs (`lifecycle` per type in `/api/meta`)
- [x] Administration > Lifecycles: a diagram of the moves (drawn like the workflow diagram), a table
  of allowed changes, required fields and who may set each status, Save, Discard and Restore
  defaults; every change audited (`lifecycle.update`, `lifecycle.restore`); types of switched-off
  areas are not listed
- [x] Modules with their own lifecycle rules keep them in code: the data runs before the module's
  hooks and can only restrict. The page lists each module's rules as "Set by the application"; types
  whose status only the application sets (changes, policies) are shown read-only (409
  `set_by_application` on a change)
- [x] A status added to the list is reachable to and from every status until the rules say otherwise
  (the page marks it as new); a retired status breaks no record (records holding it may move
  anywhere; rules naming it are ignored)
- [x] A move that needs approval starts an approval workflow (E14-06) and waits for it (built in
  E14-37: **Changes that wait for approval** on the Lifecycles page)

**Implemented in:** `server/src/core/lifecycle.ts` (rules, defaults, check, `/api/meta` part,
`APPLICATION_RULES`), `core/resource.ts` (`checkLifecycle` in `create` and `update`),
`core/migrations/015_lifecycle_rules.sql`, `core/routes.ts` (`lifecycle` in `/api/meta`),
`server/src/modules/lifecycles/` (the `/api/admin/lifecycles` routes),
`web/src/core/lifecycle.ts` and `ResourceForm.tsx` (status picker and required marks),
`web/src/modules/lifecycles/` (the page), `docs/user/23-lifecycles.md`; tests in
`core/lifecycle.test.ts`, `web/src/core/lifecycle.component.test.ts`,
`web/src/modules/lifecycles/data.test.ts` and the browser suite `10-lifecycles`.

### E14-32 Approval workflows that branch, run steps side by side or delegate

**Status:** done · **Priority:** P3 · **Type:** feature

As an administrator, some approvals need two groups at once (finance and safety together), a
different route for different records, or someone to stand in while an approver is away. E14-06
built ordered steps only.

**Acceptance criteria**

- [x] Steps that run side by side and all must finish (a step with 2 to 5 **groups**, each with its
  own approvers, quorum, due time, escalation and optional conditions; every group that applies must
  approve, one rejection rejects and stops the others; the Approvals page, notifications, escalation,
  stand-ins, reassignment, the record panel, MCP tools and module approval kinds handle each group)
- [x] A choice of route by condition, beyond skipping a step (**routes** after a step: the first whose
  conditions hold sends the workflow to a later step or to the end, otherwise the next step; only
  forward, so no loops; steps passed over are recorded as skipped). Shown in the editor and the flow
  picture in plain words ("If Cost is more than 10,000, go to Director")
- [x] Definitions saved before keep working unchanged: the stored shape is additive (`branches` and
  `routes` are optional on a step); step rows gain `branch` and `group_name` (migration
  `workflows/003_branches_and_moves.sql`), tested with a definition written in the old shape
- [x] Stand-ins can also be named from the person's own **Account security** page (card
  **Stand-in for approvals**, the same periods as Approvals > Stand-ins)
- [x] An approver names a stand-in for a period; their approvals go to the stand-in and are recorded as such
  (from the Approvals page; administrators for anyone. While it runs, steps also go to the stand-in
  and either may decide, once between them; recorded "X on behalf of Y" in history, audit and webhook.
  Never their own request, no chains, restricted records only to stand-ins who may see them, the
  kind's approve permission applies; periods starting later join waiting steps from the sweep)
- [x] Reassign a waiting step to someone else (administrators), audited
  (**Reassign** on the approval panel, `POST /api/workflows/steps/:id/reassign`, `workflow.reassign`)

Stand-ins and reassignment are in `server/src/modules/workflows/standins.ts`, `service.ts` and
`engine.ts` (`slotFor`), migration `workflows/002_kinds_and_standins.sql`, the **Stand-ins** tab of
`web/src/modules/workflows/ApprovalsPage.tsx` (`Standins.tsx`) and `WorkflowPanel.tsx`; tests
`server/src/modules/workflows/kinds.test.ts`.

**Implemented in:** `server/src/modules/workflows/engine.ts` (`ApprovalUnit`, `Route`, `isGroup`,
`applicableBranches`, `routeAfter`, `groupStatus`, `unitAt`, `checkDefinition`), `service.ts` (groups in
`advance`, `proceed` for routes, branch completion under a lock in `decide`, escalation, the kinds'
`decide` and `progress`), `routes.ts` (`CURRENT_STEP`, branches on the record view, "Step: Group" in
the approvals list), migration `workflows/003_branches_and_moves.sql`; web
`web/src/modules/workflows/WorkflowEditor.tsx` (`UnitFields`, `RouteRows`), `FlowDiagram.tsx`,
`describe.ts`, `WorkflowPanel.tsx`, `StandinCard.tsx` (shown by `web/src/modules/admin/AccountSecurity.tsx`);
guide `docs/user/22-approval-workflows.md`; tests `server/src/modules/workflows/branches.test.ts`,
`engine.test.ts`, `web/src/modules/workflows/describe.test.ts`.

### E14-33 Retention decisions raise webhook events

**Status:** done · **Priority:** P3 · **Type:** improvement

Anonymizing or removing a record from the retention review (E14-11, E14-19) writes the record
directly rather than through the resource engine, so it is audited but raises no webhook event and
runs no after-save hooks. A system that mirrors records through webhooks therefore keeps the
personal data it was sent earlier.

**Acceptance criteria**

- [x] Anonymizing raises a record-updated event (`<type>.update` with the replaced fields only, `changes: { fields, after }`) and removing raises a record-deleted event (`<type>.delete`, `purged: true`, no fields); the catalog (`WEBHOOK_EVENTS`) lists `retention.anonymized` and `retention.deleted` for webhooks that want them by name
- [x] The events carry no personal values from before the change (a removed record is named by type, id and reference only); restricted records follow the usual rule; nothing is sent while outbound connections are off
- [x] Tested, and listed in the webhook guide and the integration guide (`docs/api.md`, "Retention decisions")

After-save hooks of the record type still do not run for these two decisions (they are not edits).

**Implemented in:** `webhookRetentionChange` and the two catalog entries in `server/src/core/webhooks.ts`, called from the anonymize and delete routes in `server/src/core/retention.ts`; test `server/src/core/retention-webhooks.test.ts`

### E14-34 A switched-off part is shown nowhere but its switch

**Status:** done · **Priority:** P2 · **Type:** improvement

An administrator who switches a part off (the self-service portal, fleet, safety) still saw it: a
sidebar link to the portal, a system's vendor and contract fields, "Risk" and "Safety" as action
sources, notification kinds and notifications about it, its AI assistant tools, background jobs,
lists, retention category and API routes, and text naming it on pages that stay. A part that is off
must be shown nowhere except Administration > Features, and come back whole when switched on.

**Acceptance criteria**

- [x] The portal is an area like the others: while off nobody holds its permissions, its routes
  (its settings included) answer 404 `switched_off`, and its sidebar entry, settings tab, catalog
  field, ticket notes and shared files, role-editor area and guide page are hidden; a Requester role
  keeps its grants
- [x] Fields of types that stay on that refer to an off type, or that an area lists as its own
  (`fields`), are hidden like an option's fields; values are kept and come back
- [x] Values of shared lists that belong to an off area (`lookupValues`: action sources,
  notification kinds, the retention category) and the area's own lists are left out of `/api/meta`,
  `/api/lookups`, notification preferences and the retention page; saving preferences keeps the
  choices for hidden kinds
- [x] Notifications about an off area's records, or leading to its pages, are neither listed nor
  counted while it is off
- [x] AI assistant tools, background jobs and schedules, reminder groups, the role editor and the
  permissions offered to new API tokens leave out an off area; the relationship map has no vendors
  lane while vendors are off; text-message alerts are hidden while security incidents are off
- [x] Text on pages that stay (settings, webhooks, email, the AI assistant pages and tool
  descriptions, the map, the Overview, API route summaries) no longer names a part that may be off,
  or is written from the switches
- [x] Browser suite `09-features-off`: every area off, then the portal, fleet and safety off; every
  page an administrator can open, with its New form, drop-down lists, the Create menu and search, and
  the server answers behind them (metadata, search, OpenAPI, notification preferences, MCP, report
  catalog, retention, custom fields, imports, workflows); everything is checked to be back after
  switching on. Server tests in `modules/admin/features-hidden.test.ts`
- [x] What deliberately stays (the organization's own text: role names and descriptions, record
  names, incident playbooks, risk scales, guide prose on pages that stay; search snippets of hidden
  fields) is listed in the user guide and Known gaps

**Implemented in:** `server/src/core/features.ts` (`lookupValues`, `fields`, `lists` per area,
`visibleValues`, `listOff`, ref fields to off types hidden with the options, `switchedOffTypes` and
`switchedOffPaths`), `core/routes.ts` (metadata and lists), `core/retention.ts`, `core/jobs/index.ts`,
`core/openapi.ts`, `core/api/docs/inventory.ts`, `app.ts`; `modules/notifications` (list, count,
preferences, reminder groups), `modules/mcp` (`installedTools`, neutral descriptions),
`modules/inventory/relations.ts`, `modules/tickets/shared-files.ts`; web `App.tsx` (portal pages),
`core/module.ts` (`MODULE_AREA` portal, route owners for the suite), `modules/admin` (`RoleDetail`,
`ApiTokens`, `AlertContact`, `Settings`, `Webhooks`), `modules/notifications` (`EmailSettings`,
`JobsPage`), `modules/tickets` (`Settings`, `Catalog`, `TicketDetail`, `TicketActions`),
`modules/inventory` (`SystemMap`, `SystemFacts`, `Sites`), `modules/home` (`OverviewPage`,
`widgetsSummary`), `modules/mcp/ConnectPage.tsx`, `modules/help` (`areas.ts`, `ApiReference.tsx`);
tests `tools/e2e/suites/09-features-off.mjs`, `modules/admin/features-hidden.test.ts`, and the
portal, features, safety intake and OpenAPI tests updated.

**Follow-up (wave 7).** The permission chips of an API token (Account security and Administration > API tokens) left out nothing: with Service desk off, a token holding `tickets.view` still read "Tickets: view only". `ScopeChips` in `web/src/modules/admin/ApiTokens.tsx` now hides permissions of switched-off parts (the token keeps them). Found by the browser suite on GitHub, where the token test runs before the features-off suite.

### E14-35 Organization settings: details, logo and accessible brand colors

**Status:** done · **Priority:** P2 · **Type:** feature

The organization's details lived only in `seed/organization.json`, read once by the seed, and the
only branding was the application name. Administrators need one page to keep the organization's
names, address and contacts, and to give the application its logo and colors, with every change
audited and nothing that makes text unreadable.

Acceptance criteria:

- [x] Administration > Organization, always on (not a feature area), for administrators: application
  name (moved from Settings, which now links here), organization, legal and short names; address
  (up to three street lines, city, state or region, postal code, country, all free text with no
  country assumed); main phone, general email, website; optional security contact phone and email.
  Saved through `PATCH /api/admin/settings` like every setting, each change audited
- [x] Validation with field messages: lengths, phone, email and web address forms, control
  characters, at most three street lines
- [x] Logos for the light and dark themes (dark falls back to light): PNG, JPEG or WebP recognized
  by content (magic bytes and header dimensions read without a library), at most 512 KB and 16 to
  2048 pixels, SVG refused; stored as settings so they are in every backup and survive an upgrade;
  audited without the picture; Remove brings back the standard mark
- [x] Public, cacheable routes `GET /api/branding` and `GET /api/branding/logo/:variant` (hash in
  the address: cached for a year; ETag and 304); `branding` in `/api/auth/state`; never the address,
  contacts or security contact before sign-in
- [x] Brand and accent colors with a color square and hex text, Reset to default, and a live
  preview of header, buttons and a link in both themes. The server derives a shade per theme so
  text on the brand color, links on every surface, the brand tint, the sidebar text (4.5:1) and the
  accent and focus outline (3:1) meet WCAG 2.2 AA, shows every check and says what was adjusted
- [x] Applied everywhere the application shows identity: shell header and sidebar (tinted to the
  brand hue), browser tab title and icon, sign-in and second-factor pages, portal, vendor response
  page, OAuth consent (inside the shell), emails (name above; legal name, address, contacts below;
  new template placeholders; not on text messages), PDF exports, fact sheets, report documents and
  packs, and the incident kit (name, logo, address, footer, brand-colored rules; the kit's contacts
  sheet lists the organization's numbers and security contact)
- [x] `grc seed --profile pilot` imports the profile's details (names, address, contacts, colors,
  logo files in the seed folder) only where nothing is stored; `dev` sets an invented example
- [x] Tests: `core/organization.test.ts` (picture sniffing and limits, contrast derivation for
  extreme colors, validation, audit, the public and private split, logo routes and caching, email
  frame and PDF footer, profile import), `web/src/core/branding.test.ts`

**Implemented in:** `server/src/core/organization.ts`, `core/branding-colors.ts`,
`core/image-info.ts`, `core/profile.ts`, `core/auth.ts` (state), `app.ts`, `cli.ts` (seed),
`core/mail/templates.ts`, `core/mail/service.ts`, `core/mail/routes.ts`, `core/export/pdf.ts`,
`core/export/list.ts`, `core/export/routes.ts`, `core/apidocs.ts`, `modules/admin/organization.ts`,
`modules/admin/settings.ts`, `modules/admin/docs.ts`, `modules/reports` (`documents.ts`,
`files.ts`, `render.ts`), `modules/secincidents/kit.ts`, `modules/vendors` (`responseEmail.ts`,
`responseLinks.ts`); web `core/branding.ts`, `core/Logo.tsx`, `core/auth.tsx`, `core/ui.tsx`,
`core/Shell.tsx`, `core/shell.css`, `core/tokens.css`, `modules/admin/Organization.tsx`,
`Settings.tsx`, `admin.css`, `modules/vendors/VendorResponse.tsx`, `modules/secincidents/KitPage.tsx`.

### E14-36 Branding in the remaining places: email logo, HTML report documents, WebP logos in PDFs

**Status:** done · **Priority:** P3 · **Type:** improvement

Left out of E14-35: emails carry the organization's name but not its logo (it would need an
absolute address or an inline attachment, and many mail programs block remote pictures); the HTML
form of report documents and packs (download and on-screen preview) shows the application name
only; a WebP logo cannot be embedded in a PDF, so PDFs show none when only a WebP logo is set; the
favicon is the logo as uploaded rather than a square icon made from it; and Mantine's numbered brand
scale (used by a few components outside the design tokens) keeps the standard hues.

Acceptance criteria:

- [x] The logo in emails, as an inline attachment, with a setting to leave it out: the light-theme
  logo (PNG or JPEG, or a WebP logo's PNG copy, up to 200 KB) above the HTML body as
  `<img src="cid:…">`, shown at most 40 × 200 pixels with the organization's name as its text, sent
  as an inline part of a `multipart/related` body (Content-ID, `Content-Disposition: inline`); the
  text part is unchanged and text messages carry none. SMTP and the Gmail API send the MIME message;
  Microsoft Graph sends it as MIME too, and a larger message's draft gets the logo as an inline file
  attachment (`isInline`, `contentId`; the stand-in checks both). **Show the logo in emails**
  (`branding.email_logo`, on by default) leaves it out. The template preview shows it from a data:
  address
- [x] The organization's name, address and logo in HTML report documents and pack previews: the
  print-ready document (reports, dashboards, packs, produced copies) shows the logo (as a data:
  address, so it still loads nothing from outside) or the name at the top, uses the brand color for
  its rules and ends with the name, legal name, address and contacts, as the PDF does; the on-screen
  pack preview shows the theme's logo on the cover and the same footer
- [x] WebP logos converted for PDFs: no WebP decoder on the server and no new dependency. The
  browser that uploads a WebP logo draws it on a canvas and sends a PNG copy (at most 1024 × 512)
  with it; the server checks it is a PNG of the logo's shape (within 3 percent) and up to 1 MB and
  stores it beside the logo. PDFs and emails use it. A WebP logo without a copy (imported by the
  organization profile, or from a browser that could not draw it) shows a note on the Organization
  page with **Make printable copy** (`POST /api/admin/organization/logo/:variant/print`, audited)
- [x] A square favicon made from the logo: the browser draws a 32-pixel icon (see-through around
  the logo) and a 180-pixel home-screen icon on white, keeps them in local storage until the logo
  changes, and falls back to the logo as uploaded where it cannot draw
- [x] Mantine's brand scale generated from the brand color: ten shades shaped like the standard
  scale, with index 7 the light theme's accessible brand shade (`brandScale` in
  `web/src/core/branding.ts`, applied by `UiProvider`)
- [x] Tests: `server/src/core/branding-places.test.ts` (email markup, Content-ID and inline part
  through SMTP, Microsoft Graph (MIME and draft) and the Gmail API, the switch, HTML document
  branding and refusals, the PNG copy's checks, routes and audit), `web/src/core/branding.test.ts`
  (square fit, brand scale); browser check of the Organization page, the pack preview and the
  print-ready document

**Implemented in:** `server/src/core/organization.ts` (`printableLogo`, `checkPrintCopy`,
`savePrintCopy`, `mailBranding` logo, `printBranding.logoDataUri`, `branding.email_logo`),
`core/mail/templates.ts`, `core/mail/provider.ts` (`cid`), `core/mail/cloud.ts`, `core/mail/graph.ts`,
`core/mail/cloud-fake.ts`, `core/mail/service.ts`, `core/mail/routes.ts` (preview),
`modules/admin/organization.ts`, `modules/admin/docs.ts`, `modules/reports/render.ts`,
`modules/reports/index.ts` (pack preview); web `core/branding.ts`, `core/mantine.tsx`,
`modules/admin/Organization.tsx`, `modules/reports/PackPages.tsx`, `reports-dash.css`.

### E14-37 A status change that needs approval waits for an approval workflow

**Status:** done · **Priority:** P3 · **Type:** feature

Split from E14-31. A lifecycle (Administration > Lifecycles) says which status changes are allowed
and who may make them, and an approval workflow can start when a status changes, but a move cannot
yet be held until a workflow approves it: the record stays in its status, shows the pending move,
and takes it when the workflow is approved (or stays when it is rejected).

**Acceptance criteria**

- [x] A lifecycle move can name an approval workflow it waits for (**Changes that wait for approval**
  on the Lifecycles page: from, to and an active workflow of the type that is not a module's approval
  kind; stored as `approvals` [from, to, workflow id] in `lifecycle_rules`, core migration 018; a move
  since blocked waits for nothing; a new record never waits)
- [x] The record shows the pending move; approval makes it, rejection leaves the record as it was (the
  other fields of the save are kept and the status stays; the approval panel says "Waiting for approval
  to move to …"; approval makes the move as system work through the resource engine, so hooks, audit
  and webhooks run and module rules are checked then; a status changed meanwhile is not overwritten;
  rejection and cancel leave it). While a move waits, other fields stay editable and another status
  change is refused (400 on the status field) until the approval ends. A workflow whose own conditions
  do not hold lets the move through at once; an inactive or removed workflow refuses the move
- [x] Works on every save path (forms, API, imports and their check, bulk edit, MCP), audited
  (`lifecycle.move_held`, `.move_approved`, `.move_rejected`, `.move_canceled`, `.move_failed`), and
  respects feature switches (types of switched-off areas are neither listed nor saved)

Status menus in modules and bulk edit offer only the statuses the lifecycle allows (follow-up of
E14-31): `web/src/core/lifecycleMenus.ts` (`allowedForAll`, `canMoveTo`, `moveBlockedReason`), used by
`web/src/core/ListBulk.tsx` and the hand-written status controls of actions, framework outcomes,
safety events, security incidents and notification tasks, vulnerabilities, assets, tickets and
policy exceptions; tests `web/src/core/lifecycleMenus.test.ts`, `ListBulk.component.test.ts`.

**Implemented in:** `server/src/core/lifecycle.ts` (`approvals`, `MoveHolder`, `held`, `hold`, the
pending check in `check`, `approvals` in `/api/meta`), `core/resource.ts` (`update` holds the move,
`holdMove` answers `_pending_move`), `core/migrations/018_lifecycle_approvals.sql`,
`server/src/modules/workflows/service.ts` (`holder`, `settleMove`), `routes.ts` (`pending_move`,
`moves` on a definition), `server/src/modules/lifecycles/index.ts` (`approvals`, `workflows`),
`server/src/modules/mcp/tools-records.ts` (says the move waits); web `web/src/core/lifecycle.ts`
(`waitsForApproval`), `ResourceForm.tsx` (hint), `api.ts` (`grc:move-held`),
`web/src/modules/lifecycles/LifecyclesPage.tsx` (`ApprovalMoves`), `WorkflowPanel.tsx`; guides
`docs/user/23-lifecycles.md`, `22-approval-workflows.md`; tests
`server/src/modules/workflows/branches.test.ts`, `core/lifecycle.test.ts`, browser suite `10-lifecycles`.

### E14-38 The daily email summary leaves out switched-off parts

**Status:** done · **Priority:** P3 · **Type:** bug

Found after E14-34. The bell and the notification list leave out notifications about a
switched-off part of the application (its record types, or links to its pages), but the daily
email summary still listed those that lead there by a link only, and dropped the others for good.

**Acceptance criteria**

- [x] The summary applies the same filter as the notification list (`shownSql` and `switchedOffParams` in `modules/notifications/service.ts`, shared by both)
- [x] Those notifications are kept waiting, not dropped: they are in the first summary after the part is switched on again; a person with nothing else waiting gets no message
- [x] Unit test

**Implemented in:** `server/src/modules/notifications/email.ts`, `service.ts`, `index.ts`; test `email.test.ts`; [user guide](../../user/14-attachments-and-notifications.md#notifications-by-email)

### E14-39 A metric registry for computed indicators

**Status:** done · **Priority:** P2 · **Type:** feature

Wave 10 step 0 (contract C3 of the wave 10 plan). Safety performance indicators (E25-08) and key
risk indicators (E30-07) need figures from other modules, such as overdue corrective actions or
inspections done on time, without knowing those modules' tables. Modules now offer named monthly
figures, and readers list and compute them in one place.

**Acceptance criteria**

- [x] `defineMetric(app, { key, label, unit, description, recordType?, compute(ctx, monthStart) })` in a module's `register`; a malformed or duplicate key fails at start-up
- [x] `metricsAvailable(app, resources)` leaves out metrics whose record type is not loaded or is switched off
- [x] `GET /api/metrics` (signed in) lists the metrics the caller may read (view on the record type's module), with values for `month=YYYY-MM`; a failing metric gives null and the rest still answer
- [x] Figures count every record, restricted or not, and are the same for everyone
- [x] Unit test

**Implemented in:** `server/src/core/metrics.ts`, `app.ts`; test `core/metrics.test.ts`; [developer guide](../../development.md#metrics-shared-registry)
