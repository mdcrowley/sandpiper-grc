# E09 Security incidents and notification clocks

**Status:** done (25 of 25 issues done)

## Goal

Give the incident lead one workspace for a security incident: what happened, who is
doing what, the checklist for the scenario, a log that cannot be altered, and a clock
for every party that must be told, counting down from the moment of discovery.

## Scope notes

- Covers `server/src/modules/secincidents/` and `web/src/modules/secincidents/`.
- Record types: `security_incident` (restricted) and `notification_task`.
- The whole module is restricted: every route needs `security.view` as well as its own
  permission.
- Notification rules ship as generic, inactive placeholders with no deadline. Who must
  be told and by when depends on each organization's law, regulators, contracts and
  insurer, so each installation sets its own rules, with legal advice.
- The **Affected** tab lists the services and vehicles reached by the systems linked to the
  incident when the fleet module is loaded; that is tracked in
  [E19-11](E19-fleet-and-services.md#e19-11-affected-services-in-the-security-incident-workspace).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E09-01 | Security incident record | done | P1 |
| E09-02 | Declare an incident, with a preview of notifications | done | P1 |
| E09-03 | Notification rules as data | done | P1 |
| E09-04 | Notification tasks with deadlines from discovery | done | P1 |
| E09-05 | Green, amber and red clocks | done | P1 |
| E09-06 | Completion record for each notification | done | P1 |
| E09-07 | Clocks follow changes to the incident | done | P1 |
| E09-08 | Scenario checklists | done | P2 |
| E09-09 | Incident roles and standing contacts | done | P2 |
| E09-10 | Evidence register on an incident | done | P2 |
| E09-11 | Append-only incident log | done | P1 |
| E09-12 | Ransom payment decision gate | done | P2 |
| E09-13 | Lifecycle times and lessons learned | done | P2 |
| E09-14 | Offline incident kit | done | P2 |
| E09-15 | Screen for rules, checklists and contacts | done | P1 |
| E09-16 | Scheduled PDF of the offline kit | done | P2 |
| E09-17 | Alerts as a notification deadline approaches | done | P2 |
| E09-18 | Incident lifecycle statuses as lookup data | done | P2 |
| E09-19 | Notification deadlines across incidents | done | P1 |
| E09-20 | Printable incident report | done | P2 |
| E09-21 | Kinds of data editable on the rules screen | done | P2 |
| E09-22 | Post-incident review workflow | done | P2 |
| E09-23 | Command-center workspace and calm declare flow | done | P1 |
| E09-24 | Transit starter scenarios and kinds of data | done | P2 |
| E09-25 | Alerts by email or text message | done | P3 |

---

### E09-01 Security incident record

**Status:** done · **Priority:** P1 · **Type:** feature

As an incident lead, I record a security incident with its severity, scenario, lead,
what is affected and which kinds of data are involved.

**Acceptance criteria**

- [x] Incidents are numbered automatically
- [x] Severity, status and scenario are configurable lists
- [x] Yes/no answers about the kinds of data involved drive the notification rules
- [x] Discovery time is required and defaults to now
- [x] The module is hidden entirely from people without `security.view`

**Implemented in:** `security_incident` resource (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/IncidentList.tsx`, `Workspace.tsx`

### E09-02 Declare an incident, with a preview of notifications

**Status:** done · **Priority:** P1 · **Type:** feature

As an incident lead, before I declare an incident I answer a few questions and see
which notifications that would require, without anything being saved.

**Acceptance criteria**

- [x] A three-step declare page (what happened, what is involved, review and declare) beside a live preview of the notifications it will require
- [x] The preview lists matching rules with deadlines, and separately those with no deadline configured
- [x] Nothing is written until I confirm
- [x] A reported incident can also be declared later from its workspace

**Implemented in:** `POST /api/security-incidents/notification-preview` (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/DeclareIncident.tsx`

### E09-03 Notification rules as data

**Status:** done · **Priority:** P1 · **Type:** feature

As an administrator, I define who must be told, under what conditions and within how
long. The rules that ship are generic placeholders, switched off, with no deadline.

**Acceptance criteria**

- [x] Rules are rows with a trigger, a recipient and a deadline
- [x] Shipped rules are inactive and carry no deadline
- [x] Rules can be loaded from the organization profile; a rule that could not work is refused
- [x] The profile never overwrites an existing rule
- [x] Setting a deadline switches a rule on, and open incidents pick it up

**Implemented in:** `/api/security-notification-rules` (`server/src/modules/secincidents/index.ts`), `defaults.ts`, `seed.ts`

### E09-04 Notification tasks with deadlines from discovery

**Status:** done · **Priority:** P1 · **Type:** feature

As an incident lead, declaring an incident creates one task for each notification the
rules require, each with a deadline counted from the discovery time.

**Acceptance criteria**

- [x] No tasks exist before the incident is declared
- [x] Exactly one task per matching rule, never duplicated
- [x] Deadlines count from discovery, not from declaration
- [x] Tasks are visible across all incidents and on each incident

**Implemented in:** `notification_task` resource, `syncTasks` (`server/src/modules/secincidents/index.ts`); `GET /api/security-incidents/clocks`, `/:id/clocks`

### E09-05 Green, amber and red clocks

**Status:** done · **Priority:** P1 · **Type:** feature

As an incident lead, each notification shows a live countdown that turns amber as the
deadline nears and red when it has passed.

**Acceptance criteria**

- [x] Each clock reports its state and the seconds remaining
- [x] The share of the window at which a clock turns amber is a setting
- [x] Clocks are shown at the top of the incident workspace and on the overview dashboard

**Implemented in:** clocks routes (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/Clocks.tsx`

### E09-06 Completion record for each notification

**Status:** done · **Priority:** P1 · **Type:** feature

As an incident lead, I can only mark a notification done by recording who was told,
how, when, and any reference they gave.

**Acceptance criteria**

- [x] A task cannot be completed without the completion details
- [x] The completion is written to the incident log
- [x] Completed tasks are never changed by later recalculation

**Implemented in:** `notification_task` hooks (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/Clocks.tsx`

### E09-07 Clocks follow changes to the incident

**Status:** done · **Priority:** P1 · **Type:** feature

As an incident lead, when I correct the discovery time or change what data is involved,
the open notifications are brought up to date.

**Acceptance criteria**

- [x] Changing the discovery time recomputes open deadlines
- [x] Clearing a trigger marks its open task "not required"; setting it again reopens it
- [x] Newly matching rules add tasks without duplicating existing ones

**Implemented in:** `syncTasks` and the `afterUpdate` hook (`server/src/modules/secincidents/index.ts`)

### E09-08 Scenario checklists

**Status:** done · **Priority:** P2 · **Type:** feature

As an incident lead, choosing a scenario copies its containment and recovery checklist
onto the incident, and I check steps off as they are done.

**Acceptance criteria**

- [x] Checklist templates per scenario and phase, held as data
- [x] The template is copied onto the incident when the scenario is set
- [x] Checking a step records who and when
- [x] Checked steps are kept when the scenario changes; unchecked ones are replaced
- [x] Extra steps can be added to one incident

**Implemented in:** `applyChecklist`, `/api/security-incidents/:id/checklist`, `/api/security-checklist-templates` (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/ChecklistTab.tsx`

### E09-09 Incident roles and standing contacts

**Status:** done · **Priority:** P2 · **Type:** feature

As an incident lead, each new incident starts with the standing list of roles and
contacts, which I then adjust for this incident.

**Acceptance criteria**

- [x] A standing contact list maintained by administrators
- [x] The list is copied onto each new incident
- [x] Roles on an incident can be added, changed and removed

**Implemented in:** `copyRoster`, `/api/security-incidents/:id/roles`, `/api/security-incident-contacts` (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/Workspace.tsx`, `EditableTable.tsx`

### E09-10 Evidence register on an incident

**Status:** done · **Priority:** P2 · **Type:** feature

As an incident lead, I list each piece of evidence collected, where it is and who holds
it.

**Acceptance criteria**

- [x] Add, change and remove evidence entries on an incident
- [x] Changes are audited
- [x] Evidence files can be attached (the Attachments tab, as dated evidence)

**Implemented in:** `/api/security-incidents/:id/evidence` (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/Workspace.tsx` (Evidence and Attachments tabs)

### E09-11 Append-only incident log

**Status:** done · **Priority:** P1 · **Type:** feature

As an incident lead, I keep a timed log of decisions and events that nobody, including
me, can edit or delete afterwards.

**Acceptance criteria**

- [x] Entries can be listed and added, nothing else
- [x] Status changes, declaration, scenario changes and completed notifications are logged automatically
- [x] Each entry records who and when

**Implemented in:** `GET/POST /api/security-incidents/:id/log` (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/LogTab.tsx`

### E09-12 Ransom payment decision gate

**Status:** done · **Priority:** P2 · **Type:** feature

As an incident lead, a ransom payment cannot be recorded as approved without a
reference to the governing body's approval, and the decision is audited.

**Acceptance criteria**

- [x] Payment status is a configurable list, default "not applicable"
- [x] "Approved" is blocked without an approval reference
- [x] Every change to the decision is audited and logged on the incident

**Implemented in:** `checkRansom`, `ransomChanged` (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/RansomTab.tsx`

### E09-13 Lifecycle times and lessons learned

**Status:** done · **Priority:** P2 · **Type:** feature

As an incident lead, the incident records when it was declared, contained and closed as
its status moves on, and I write up what happened and what to improve.

**Acceptance criteria**

- [x] Declared, contained and closed times are stamped as the status changes
- [x] A status stepper in the workspace, with a confirmation before each change
- [x] "What happened", "what went well" and "what to improve" sections
- [x] Links to systems, data categories and other records

**Implemented in:** `stampStatus` (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/Workspace.tsx`

### E09-14 Offline incident kit

**Status:** done · **Priority:** P2 · **Type:** feature

As an incident lead, I print a kit to keep on paper for when the network and this
application are down: first-hour steps, who must be told and by when, contacts, the
severity guide and the scenario checklists.

**Acceptance criteria**

- [x] One page bundles rules, contacts, severity guide and checklists
- [x] Prints cleanly from the browser
- [x] Empty states when nothing has been set up
- [x] Produced on a schedule as a PDF (see E09-16)

**Implemented in:** `GET /api/security-incidents/kit` (`server/src/modules/secincidents/kit.ts`); `web/src/modules/secincidents/KitPage.tsx`

### E09-15 Screen for rules, checklists and contacts

**Status:** done · **Priority:** P1 · **Type:** feature

As an administrator, I maintain notification rules, checklist templates and the
standing contact list on one screen. Security leads can read it but not change it.

**Acceptance criteria**

- [x] Tabs for notification rules, checklists by scenario and phase, and contacts
- [x] Inline add, edit and remove
- [x] Editing needs `security.administer`; others see it read-only

**Implemented in:** `web/src/modules/secincidents/RulesPage.tsx`, `EditableTable.tsx`

The horizontal scrolling reported in [E18-02](E18-quality-and-known-defects.md) is gone: the
page was checked at 1440 and 820 wide, light and dark, with no horizontal scroll.

### E09-16 Scheduled PDF of the offline kit

**Status:** done · **Priority:** P2 · **Type:** feature

As an incident lead, a current copy of the kit is produced as a PDF on a schedule and
whenever the rules, contacts or checklists change, so the paper copy never goes stale
unnoticed.

**Acceptance criteria**

- [x] The kit is rendered to PDF on the server, with the core PDF builder; the time it was made is printed at the top of every page with the restricted marking
- [x] A new copy is produced on a schedule (setting `security.kit_every_days`, default 7, 0 = only after changes) and after any change to its contents (a fingerprint of the contents, checked every 15 minutes by the job `secincidents.kit_pdf`), and on request
- [x] The kit shows when it was produced; the screen says whether the latest copy matches the kit and since when paper copies are current, and warns when the kit has changed since the last copy
- [x] Copies are kept in the database (in every backup; newest `security.kit_keep`, default 12); listing needs `security.view`, making and downloading also `security.export`; made and downloaded copies are audited
- [x] Automatic copies are optionally emailed, as an attachment, to people an administrator names (`security.kit_recipients`; changing them needs a recent password confirmation). A recipient must be active and hold `security.view` and `security.export` when each email is sent (the kit holds standing material only, all visible with `security.view`); others are skipped and the copy says so. Nothing is sent while email is off
- [x] Follows the security incidents feature switch: routes answer 404 and the job is skipped while the area is off
- [x] Depends on a job queue ([E14-12](E14-platform-services.md))

**Implemented in:** `server/src/modules/secincidents/kit.ts`, migration `004_kit_copies.sql`; `GET/POST /api/security-incidents/kit/copies`, `GET /api/security-incidents/kit/copies/:copyId/pdf`, `PATCH /api/security-incidents/kit/settings`; `web/src/modules/secincidents/KitCopies.tsx`; tests in `kit.test.ts`

### E09-17 Alerts as a notification deadline approaches

**Status:** done · **Priority:** P2 · **Type:** feature

As an incident lead, I am alerted when a notification clock turns amber and again when
it turns red, rather than relying on someone watching the screen.

**Acceptance criteria**

- [x] The incident lead and everyone else with `security.view` are notified at amber and at red, once each per clock (a task has no separate owner)
- [x] Alerts are logged on the incident and audited
- [x] Declaring an incident notifies the people who can see it; nobody without `security.view` is ever notified
- [x] A moved deadline starts the alerts afresh; a sweep runs every minute (in-process timer) and on every change to the incident
- [x] Uses `app.notify` from the notifications module ([E14-03](E14-platform-services.md)); does nothing when it is not loaded

**Implemented in:** `server/src/modules/secincidents/alerts.ts`, `clocks.ts`, migration `003_alerts_review_lifecycle.sql`; `POST /api/security-incidents/clocks/sweep`; tests in `workflow.test.ts`

### E09-18 Incident lifecycle statuses as lookup data

**Status:** done · **Priority:** P2 · **Type:** feature

As an administrator, I can rename, add, reorder and retire incident statuses; what each
status means is data, not a name in code.

**Acceptance criteria**

- [x] Each status carries a stage (before declaration, declared, contained, closed) in its lookup meta
- [x] Stamping times, starting clocks and closing follow the stage, whatever the status is called
- [x] The lifecycle always keeps a reported, a declared and a closed status; a status in use cannot be retired
- [x] Edited on the Incident statuses tab by people with `security.administer`

**Implemented in:** `lifecycle()` in `defaults.ts`, `lists.ts`, `GET /api/security-incidents/lifecycle`; `web/src/modules/secincidents/RulesPage.tsx`

### E09-19 Notification deadlines across incidents

**Status:** done · **Priority:** P1 · **Type:** feature

As an incident lead, I see every notification on every incident in one place, most
urgent first, and can record one from there.

**Acceptance criteria**

- [x] A page with overdue, due soon, on track and recorded counts and a table most urgent first
- [x] Filter to make, recorded, not required or all; record, stand down and correct from the table
- [x] A register tab with filters, saved views and export
- [x] Restricted: an agent sees nothing

**Implemented in:** `GET /api/security-incidents/clocks?status=`; `web/src/modules/secincidents/NotificationsPage.tsx`

### E09-20 Printable incident report

**Status:** done · **Priority:** P2 · **Type:** feature

As an incident lead, I print a report of the incident for the governing body, the insurer
or the file.

**Acceptance criteria**

- [x] Summary with times after discovery, what was involved, notifications, decisions, the full timeline, response, lessons and follow-up actions
- [x] Prints cleanly black on white in either theme; opening it is audited
- [x] Restricted: an agent sees nothing

**Implemented in:** `server/src/modules/secincidents/report.ts`, `GET /api/security-incidents/:id/report`; `web/src/modules/secincidents/ReportPage.tsx`

### E09-21 Kinds of data editable on the rules screen

**Status:** done · **Priority:** P2 · **Type:** feature

As a security administrator, I maintain the kinds of data that drive the declare
questions and rule triggers without needing full administration rights.

**Acceptance criteria**

- [x] Add, rename, explain, reorder and retire kinds of data on the Kinds of data tab
- [x] A kind that triggers an active rule cannot be retired
- [x] Changes need `security.administer`; the change is audited

**Implemented in:** `server/src/modules/secincidents/lists.ts`; `web/src/modules/secincidents/RulesPage.tsx`

### E09-22 Post-incident review workflow

**Status:** done · **Priority:** P2 · **Type:** feature

As an incident lead, closing an incident starts a review that is planned, held and
completed, with its findings frozen and its follow-up actions tracked.

**Acceptance criteria**

- [x] Review statuses are lookup data (not started, scheduled, findings drafted, completed, not required)
- [x] Closing sets the due date (setting `security.review_due_days`, default 14) and tells the review lead
- [x] Completing needs what happened, root cause and what to improve; it records who and when, logs it and freezes the findings until reopened
- [x] "Not required" needs a reason, which is logged
- [x] Follow-up actions from the shared Actions panel, source `incident`, restricted like the incident

**Implemented in:** `checkReview`, `reviewChanged` (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/ReviewTab.tsx`

### E09-23 Command-center workspace and calm declare flow

**Status:** done · **Priority:** P1 · **Type:** feature

As an incident lead under pressure, the workspace shows what matters most first and the
declare flow is short and reassuring.

**Acceptance criteria**

- [x] Status stepper, key times and severity at the top; clocks rail with a "next deadline" headline, color state, required or recommended, one-click record, done state with who, when and reference, sorted by urgency
- [x] Log as the central timeline with a fast composer (L to write, Ctrl+Enter to add), entry kinds, back-dating and times in the organization time zone
- [x] Checklists with progress per phase; team panel with one-click contact details
- [x] Three-step declare wizard with a live notification preview
- [x] Offline kit as a printed document: cover, contacts, rules table, scenario checklists, notification record sheet and blank log sheets, with an on-screen print preview
- [x] Checked in a browser at 1440 and 820 wide, light and dark, and in print

**Implemented in:** `web/src/modules/secincidents/Workspace.tsx`, `Clocks.tsx`, `LogTab.tsx`, `ChecklistTab.tsx`, `Roles.tsx`, `DeclareIncident.tsx`, `KitPage.tsx`, `secincidents.css`

### E09-24 Transit starter scenarios and kinds of data

**Status:** done · **Priority:** P2 · **Type:** feature

As a transit operator, the starter content covers the incidents I am most likely to face.

**Acceptance criteria**

- [x] Starter scenarios and checklists for a dispatch or CAD/AVL outage, a fare system compromise and an onboard network compromise
- [x] Starter kinds of data for rider account information and operational and safety information
- [x] An operations control liaison in the standing contacts
- [x] Two more placeholder rules (transport safety or oversight authority; funding agencies and partner operators), inactive, with no named agency and no deadline

**Implemented in:** `server/src/modules/secincidents/defaults.ts`; test in `workflow.test.ts`

### E09-25 Alerts by email or text message

**Status:** done · **Priority:** P3 · **Type:** feature

As an incident lead away from the application, I receive clock alerts by email or text.

No paid service is built in: a text goes to the person's email-to-text address (through the
email settings) and/or to an administrator-configured, signed webhook in a documented format, so
an organization can point it at whatever text-message system it already has.

**Acceptance criteria**

- [x] Named responders (and, if chosen, the incident lead) are told by email and by text message
  when an incident is declared and when a notification clock turns amber or red; each event can be
  switched off, and each channel
- [x] Only people holding `security.view` when the message is sent; the messages carry the
  incident's reference and what needs attention, never its title, party or other detail
- [x] Once per clock state (the sweep's stamps), one alert per incident and state however many
  clocks change together
- [x] Text messages: email-to-text addresses, and a generic signed webhook that obeys
  `integrations.outbound_enabled`, the allow-list and the private-address check; no commercial
  vendor built in. The format is documented in `docs/installation.md`
- [x] Each person's mobile number and email-to-text address on Account security, editable by
  them and by administrators on the user's page; personal data, shown to no one else, and the
  audit trail records that they changed, never the values (no `personal` field flag exists for
  them: they are not a record type)
- [x] Settings, contact changes, tests and every alert sent are audited; test text (per person)
  and test alert (to the responders)
- [x] Nothing runs while the security incidents area is switched off (the clock sweep and the
  declare flow belong to it)
- [x] Tests with stand-in SMTP and webhook servers

**Implemented in:** `server/src/modules/secincidents/responders.ts` (setting `security.alerts`;
`GET`/`PATCH /api/security-incidents/alerts/settings`, `POST /api/security-incidents/alerts/test`),
calls from `alerts.ts` (sweep) and `index.ts` (declared); `server/src/core/mail/texts.ts`
(`app.sendText`, job `text.webhook`, `/api/me/alert-contact`, `/api/admin/users/:id/alert-contact`,
`/api/admin/text/settings`), `core/mail/migrations/003_alert_contacts.sql`, template
`text_message`; `web/src/modules/secincidents/AlertResponders.tsx`,
`web/src/modules/admin/AlertContact.tsx`, `web/src/modules/notifications/TextMessageSettings.tsx`;
tests `secincidents/responders.test.ts`, `core/mail/texts.test.ts`
