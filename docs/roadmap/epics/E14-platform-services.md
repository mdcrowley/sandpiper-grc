# E14 Platform services not yet built

**Status:** open (nothing built)

## Goal

Add the shared services that several modules are waiting for: files attached to
records, notifications inside the application and by email, fields and workflows that
an administrator can define, better search, and the small conveniences (tags, watchers,
bulk edit) that make daily use quicker.

## Scope notes

- These belong in `server/src/core/` and `web/src/core/` so that every record type
  gets them at once.
- Many open issues in other epics depend on E14-01 (attachments) and E14-03
  (notifications). Build those two first.
- Email needs an outbound connection, which the local prototype forbids. It must be an
  explicit, per-installation setting and stay off by default.
- Workflow today is per-module code plus configurable lists. That is adequate for a
  pilot; the general engine is a later item.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E14-01 | Attachments on any record | open | P1 |
| E14-02 | Custom fields | open | P3 |
| E14-03 | In-app notifications | open | P1 |
| E14-04 | Email delivery | open | P2 |
| E14-05 | Email setup and reset links | open | P2 |
| E14-06 | Workflow engine with approvals | open | P3 |
| E14-07 | Full-text search | open | P2 |
| E14-08 | Tags | open | P3 |
| E14-09 | Watchers | open | P3 |
| E14-10 | Bulk edit | open | P2 |
| E14-11 | Retention settings and review flags | open | P2 |
| E14-12 | Job queue for background work | open | P2 |

---

### E14-01 Attachments on any record

**Status:** open · **Priority:** P1 · **Type:** feature

As a user, I attach files to any record I can edit, and anyone who can see the record
can download them.

**Acceptance criteria**

- [ ] Upload, list, download and remove on every record page
- [ ] Files follow the record's permissions, including restricted records
- [ ] Size and type limits are settings
- [ ] Files are stored outside the database, under the data folder, and included in backups
- [ ] Upload, download and removal are audited
- [ ] Downloads are served so that the browser cannot run them as pages

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

**Status:** open · **Priority:** P1 · **Type:** feature

As a user, a bell in the top bar shows me what needs my attention: something assigned
to me, a deadline approaching, a reminder falling due.

**Acceptance criteria**

- [ ] Any module can raise a notification for a user or a role through one core service
- [ ] A bell with an unread count and a list that links to the record
- [ ] Mark as read, and mark all as read
- [ ] A notification never reveals a record the recipient cannot see
- [ ] Each person can choose which kinds they receive
- [ ] First users: ticket assignment, contract reminders, incident clocks

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
- [ ] The existing timers are moved onto the queue
