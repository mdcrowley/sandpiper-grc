# E09 Security incidents and notification clocks

**Status:** in progress

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
  be told and by when depends on each organisation's law, regulators, contracts and
  insurer, so each installation sets its own rules, with legal advice.

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
| E09-16 | Scheduled PDF of the offline kit | open | P2 |
| E09-17 | Alerts as a notification deadline approaches | open | P2 |

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

- [x] A two-step declare page: what we know, then the notifications it will require
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
- [x] Rules can be loaded from the organisation profile; a rule that could not work is refused
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
onto the incident, and I tick steps off as they are done.

**Acceptance criteria**

- [x] Checklist templates per scenario and phase, held as data
- [x] The template is copied onto the incident when the scenario is set
- [x] Ticking a step records who and when
- [x] Ticked steps are kept when the scenario changes; unticked ones are replaced
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
- [ ] Evidence files can be attached (depends on [E14-01](E14-platform-services.md))

**Implemented in:** `/api/security-incidents/:id/evidence` (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/Workspace.tsx`

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
- [ ] Produced on a schedule as a PDF (see E09-16)

**Implemented in:** `GET /api/security-incidents/kit` (`server/src/modules/secincidents/index.ts`); `web/src/modules/secincidents/KitPage.tsx`

### E09-15 Screen for rules, checklists and contacts

**Status:** done · **Priority:** P1 · **Type:** feature

As an administrator, I maintain notification rules, checklist templates and the
standing contact list on one screen. Security leads can read it but not change it.

**Acceptance criteria**

- [x] Tabs for notification rules, checklists by scenario and phase, and contacts
- [x] Inline add, edit and remove
- [x] Editing needs `security.administer`; others see it read-only

**Implemented in:** `web/src/modules/secincidents/RulesPage.tsx`, `EditableTable.tsx`

Known defect: the page scrolls horizontally at 1440px, see
[E18-02](E18-quality-and-known-defects.md).

### E09-16 Scheduled PDF of the offline kit

**Status:** open · **Priority:** P2 · **Type:** feature

As an incident lead, a current copy of the kit is produced as a PDF on a schedule and
whenever the rules, contacts or checklists change, so the paper copy never goes stale
unnoticed.

**Acceptance criteria**

- [ ] The kit is rendered to PDF on the server
- [ ] A new copy is produced on a schedule and after any change to its contents
- [ ] The kit shows when it was produced; the screen warns when the printed copy is out of date
- [ ] Depends on a job queue ([E14-12](E14-platform-services.md))

### E09-17 Alerts as a notification deadline approaches

**Status:** open · **Priority:** P2 · **Type:** feature

As an incident lead, I am alerted when a notification clock turns amber and again when
it turns red, rather than relying on someone watching the screen.

**Acceptance criteria**

- [ ] The incident lead and the task owner are notified at amber and at red
- [ ] Alerts are logged on the incident
- [ ] Depends on [E14-03](E14-platform-services.md)
