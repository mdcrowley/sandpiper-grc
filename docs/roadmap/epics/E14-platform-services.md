# E14 Platform services not yet built

**Status:** in progress (attachments and in-app notifications built)

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
- Email needs an outbound connection, which the local prototype forbids. It must be an
  explicit, per-installation setting and stay off by default.
- Workflow today is per-module code plus configurable lists. That is adequate for a
  pilot; the general engine is a later item.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E14-01 | Attachments on any record | done | P1 |
| E14-02 | Custom fields | open | P3 |
| E14-03 | In-app notifications | done | P1 |
| E14-04 | Email delivery | open | P2 |
| E14-05 | Email setup and reset links | open | P2 |
| E14-06 | Workflow engine with approvals | open | P3 |
| E14-07 | Full-text search | open | P2 |
| E14-08 | Tags | open | P3 |
| E14-09 | Watchers | open | P3 |
| E14-10 | Bulk edit | open | P2 |
| E14-11 | Retention settings and review flags | open | P2 |
| E14-12 | Job queue for background work | open | P2 |
| E14-13 | Object-storage driver for attachments | open | P2 |
| E14-14 | Malware scanner for attachments | open | P1 |
| E14-15 | Purge and retention of removed files | open | P2 |
| E14-16 | Notifications from the other modules | open | P1 |
| E14-17 | Notification housekeeping | open | P3 |
| E14-18 | Evidence files on evidence-bearing records | open | P2 |

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

**Status:** open · **Priority:** P3 · **Type:** feature

As an administrator, I add my own fields to a record type without a code change, and
they appear on forms, lists, filters and exports.

**Acceptance criteria**

- [ ] Fields are defined per record type with a label, type and optional list
- [ ] Shown on the form, the detail page, list columns, filters and CSV export
- [ ] Validated like built-in fields and included in the audit trail
- [ ] Removing a field hides it without deleting its data

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
`index.ts` routes under `/api/notifications`, `digest.ts`, `email.ts` provider contract
only, `migrations/001_notifications.sql`, `notifications.test.ts`);
`web/src/modules/notifications/` (`NotificationBell.tsx`, `NotificationsPage.tsx`,
`Preferences.tsx`, `data.ts`); user guide `docs/user/14-attachments-and-notifications.md`

### E14-04 Email delivery

**Status:** open · **Priority:** P2 · **Type:** feature

As a user, I can choose to receive my notifications by email as well as in the
application.

**Acceptance criteria**

- [ ] Mail server details are settings; delivery is off until configured
- [ ] Messages contain a link and a short summary, never restricted detail
- [ ] Failed deliveries are retried and logged
- [ ] A test-message button for administrators
- [ ] Documented as the one deliberate exception to "no outbound connections"
- [ ] The daily-digest choice each person can already store
  (`notification_preferences.daily_digest`) sends one summary a day instead of a message
  per notification

Groundwork in place: the provider contract (`EmailProvider`, `EmailMessage`,
`EmailResult`) is written down in `server/src/modules/notifications/email.ts`. Nothing
calls it and nothing is sent.

### E14-05 Email setup and reset links

**Status:** open · **Priority:** P2 · **Type:** improvement

As a new user, I receive my setup link by email. As a user who has forgotten my
password, I request a reset link myself. Today an administrator is shown the link and
must pass it on.

**Acceptance criteria**

- [ ] Creating a user can send the setup link by email
- [ ] "Forgotten password" on the sign-in page sends a reset link
- [ ] The response is the same whether or not the address is known
- [ ] Requests are rate-limited
- [ ] Depends on E14-04; the current hand-over method remains when email is off

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

**Status:** open · **Priority:** P2 · **Type:** improvement

As a user, search understands whole words, word endings and several words at once, and
ranks the best matches first. Today search is plain substring matching.

**Acceptance criteria**

- [ ] The database's full-text search is used, with an index per record type
- [ ] Results are ranked and show a snippet with the match highlighted
- [ ] Comments are searched too
- [ ] Reference numbers still match exactly
- [ ] Permissions and restricted-record rules are unchanged

### E14-08 Tags

**Status:** open · **Priority:** P3 · **Type:** feature

As a user, I add free-form tags to any record and filter lists by them.

**Acceptance criteria**

- [ ] Add and remove tags on any record
- [ ] Existing tags are suggested as I type
- [ ] Lists can be filtered by tag
- [ ] Administrators can rename and merge tags

### E14-09 Watchers

**Status:** open · **Priority:** P3 · **Type:** feature

As a user, I follow a record and am notified when it changes.

**Acceptance criteria**

- [ ] "Watch" and "stop watching" on any record
- [ ] Watchers are notified of changes and comments
- [ ] Only people who can see the record can watch it
- [ ] Depends on E14-03

### E14-10 Bulk edit

**Status:** open · **Priority:** P2 · **Type:** feature

As a user, I select several rows in a list and change one field on all of them at once
(for example assignee or status).

**Acceptance criteria**

- [ ] Row selection on every generic list, including "all matching the filter"
- [ ] One field at a time, chosen from the editable fields
- [ ] Each record is validated, run through its hooks and audited individually
- [ ] A summary shows how many changed and which failed, and why

### E14-11 Retention settings and review flags

**Status:** open · **Priority:** P2 · **Type:** feature

As an administrator, I set how long each kind of record is kept, and records past that
age are flagged for review rather than deleted silently.

**Acceptance criteria**

- [ ] A retention period per record type, held as a setting
- [ ] Records past their period are flagged and listed for review
- [ ] A reviewer can extend, anonymise or remove each one, with a reason
- [ ] Nothing is removed automatically
- [ ] The audit log has its own, longer period

### E14-12 Job queue for background work

**Status:** open · **Priority:** P2 · **Type:** debt

As an administrator, I want scheduled work (the service-level sweep, contract
reminders, and later notifications and scheduled reports) to run from a durable queue
that survives restarts and shows me what ran. Today these are timers inside the server
process.

**Acceptance criteria**

- [ ] Scheduled and one-off jobs are stored in the database
- [ ] A job runs once even with more than one server process
- [ ] Failures are retried and visible on an administration page
- [ ] The existing timers are moved onto the queue, including the notification digest
  (`server/src/modules/notifications/index.ts`)

### E14-13 Object-storage driver for attachments

**Status:** open · **Priority:** P2 · **Type:** feature

As an administrator of a hosted installation, I keep attached files in an S3-compatible
object store instead of on the server's disk. Today the only drivers are local disk and
memory (for tests).

**Acceptance criteria**

- [ ] A driver implementing `FileStorage` (`put`, `get`, `delete`, `stat`) in
  `server/src/modules/attachments/storage.ts` for an S3-compatible store
- [ ] The driver is chosen by configuration; credentials come from the environment, never
  from the database or the repository
- [ ] Uploads and downloads stream; nothing is buffered whole in memory
- [ ] Each attachment's `storage_driver` is honoured, so files stored on disk before the
  change stay readable, and a command moves them across
- [ ] Documented as an outbound connection that is off by default
- [ ] Backup and restore instructions cover the store

### E14-14 Malware scanner for attachments

**Status:** open · **Priority:** P1 · **Type:** feature

As a security lead, every attached file is checked for malware before it is accepted.
Today the hook exists (`app.fileScanner`, `server/src/modules/attachments/scanner.ts`)
but no scanner is supplied, and files are marked "Not scanned".

**Acceptance criteria**

- [ ] A scanner module that registers with `app.fileScanner.use(...)` and calls an engine
  running on the same machine (no outside service)
- [ ] An infected file is refused, its bytes removed, and the refusal audited (already
  the behaviour of the hook; covered by a test with a fake scanner)
- [ ] A setting decides whether uploads are refused or accepted as "Not scanned" when the
  engine is unavailable (today: refused whenever a scanner is installed)
- [ ] Files attached before the scanner was installed can be scanned in a batch, and an
  infected one is quarantined and reported
- [ ] The engine's signature date is shown on the **File settings** page

### E14-15 Purge and retention of removed files

**Status:** open · **Priority:** P2 · **Type:** feature

As an administrator, removed files are deleted from storage after a set period, and I can
restore one before then. Today removing a file marks its row and keeps the bytes in
`data/files` indefinitely; there is no restore screen and no purge.

**Acceptance criteria**

- [ ] A list of removed files for administrators, with restore
- [ ] A retention period (a setting); files removed for longer are purged from storage by
  a scheduled job, and the purge is audited
- [ ] Files whose record has been deleted follow the same rule
- [ ] A check that reports stored files with no row and rows with no stored file
- [ ] Depends on E14-11 for the retention settings and E14-12 for the job

### E14-16 Notifications from the other modules

**Status:** open · **Priority:** P1 · **Type:** improvement

As a user, I am told when something is assigned to me or needs my decision, not only by
the daily digest. Each of these is one guarded call to `app.notify` in the module that
owns the record (usage is documented at the top of
`server/src/modules/notifications/service.ts`).

**Acceptance criteria**

- [ ] Ticket assigned or reassigned: the new assignee (`assignment`)
- [ ] Approval requested (change, project gate, risk acceptance, exception): the
  approvers (`approval`)
- [ ] Project gate decision due: the project's sponsor or manager (`due`)
- [ ] Contract reminder fired: the contract's owner (`reminder`)
- [ ] Policy or training acknowledgement requested: each person asked (`acknowledgement`)
- [ ] Incident notification clock turns amber or red: the incident lead and everyone
  holding `security.edit` (`clock`)
- [ ] Each call is covered by a test in its own module, with the notifications module
  both loaded and not loaded

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

- [ ] Vendor evidence items, framework outcomes, policy acknowledgements, exercises and
  risk treatments show the panel in evidence mode
- [ ] The vendor **Expiring evidence** page and the **Expiring evidence files** page link
  to each other, or are merged
- [ ] An expiring evidence file raises a `reminder` notification to the record's owner
- [ ] Closes E06-17, E07-12 and E11-17 where they only waited for attachments
