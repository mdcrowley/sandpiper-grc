# E11 Projects and portfolio

**Status:** in progress

## Goal

Take a project from a request through tiering, stage gates and delivery, with regular
status reports, and give managers a portfolio view of everything in flight: what stage
it is at, how it is going, what it costs and whether too much is running at once.

## Scope notes

- Covers `server/src/modules/projects/` and `web/src/modules/projects/`.
- Record type: `project`. Gates, status reports, items (risks, issues, decisions,
  change requests) and milestones are child tables with hand-written routes.
- Tier thresholds, scoring criteria, the work-in-progress limit and gate templates are
  settings that a project administrator edits.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E11-01 | Project request (intake) | done | P1 |
| E11-02 | Tiers from budget thresholds, with override | done | P1 |
| E11-03 | Stage gates with checklists | done | P1 |
| E11-04 | Gate decisions | done | P1 |
| E11-05 | Gate templates | done | P2 |
| E11-06 | Gate documents | done | P2 |
| E11-07 | Status reports and trend | done | P1 |
| E11-08 | Risks, issues, decisions and change requests | done | P2 |
| E11-09 | Escalate a project risk to the risk register | done | P2 |
| E11-10 | Milestones | done | P2 |
| E11-11 | Priority scoring | done | P2 |
| E11-12 | Portfolio views | done | P1 |
| E11-13 | Project settings screen | done | P2 |
| E11-14 | Required documents block a gate | done | P2 |
| E11-15 | Move a project back a stage | done | P2 |
| E11-16 | Let anyone submit a project request | done | P2 |
| E11-17 | Attach documents to gates | done | P3 |
| E11-18 | Complete a project automatically at Close | done | P2 |
| E11-19 | Edit a status report | done | P2 |
| E11-20 | Systems affected | done | P2 |
| E11-21 | Link the go-live gate to a change record | done | P3 |
| E11-22 | Notifications for gates, reports and red projects | done | P2 |
| E11-23 | Redesign on the Mantine foundation | done | P1 |
| E11-24 | Reminders for overdue milestones and register items | open | P3 |

---

### E11-01 Project request (intake)

**Status:** done · **Priority:** P1 · **Type:** feature

As a member of staff with permission, I submit a request saying what is needed and why,
the expected benefits, a budget estimate and what the project touches.

**Acceptance criteria**

- [x] A request form separate from the full project form
- [x] A new request starts at the "idea" stage and opens its first gate
- [x] Projects are numbered automatically
- [x] Yes/no answers for payment, personal data and operational systems
- [x] Sponsor, project manager, department, vendor and contract

**Implemented in:** `project` resource (`server/src/modules/projects/resource.ts`); `web/src/modules/projects/IntakeForm.tsx`

### E11-02 Tiers from budget thresholds, with override

**Status:** done · **Priority:** P1 · **Type:** feature

As a project manager, each project is placed in a tier by its budget, which decides how
much governance it gets. I can override the tier with a reason.

**Acceptance criteria**

- [x] Thresholds are settings; boundaries are handled consistently
- [x] The tier is recomputed on every save
- [x] An override needs a reason and is audited
- [x] Changing the thresholds re-tiers existing projects

**Implemented in:** `server/src/modules/projects/rules.ts`, `derive` in `service.ts`; `auditOverride` in `resource.ts`

### E11-03 Stage gates with checklists

**Status:** done · **Priority:** P1 · **Type:** feature

As a project manager, each stage ends in a gate with a checklist copied from a
template, and I check items off as they are met.

**Acceptance criteria**

- [x] A gate is opened for the project's current stage
- [x] The checklist is copied from the template for that gate and tier
- [x] Checking an item records who and when
- [x] A stepper shows the stages and where the project is

**Implemented in:** `openGate`, `setChecklistItem` (`server/src/modules/projects/service.ts`); `GET /api/projects/:id/gates`, `PATCH .../gates/:gateId/items/:itemId` (`routes.ts`); `web/src/modules/projects/GateTab.tsx`, `GateChecklist.tsx`, `GateStepper.tsx`

### E11-04 Gate decisions

**Status:** done · **Priority:** P1 · **Type:** feature

As an approver, I approve or reject a gate. A gate cannot be approved while any
checklist item is unchecked, and approval moves the project to the next stage.

**Acceptance criteria**

- [x] Deciding needs `projects.approve`
- [x] Approval is blocked while an item is unchecked
- [x] Approval advances the stage and opens the next gate
- [x] The decision, the decider and any comment are recorded and audited

**Implemented in:** `POST /api/projects/:id/gates/:gateId/decide` (`server/src/modules/projects/routes.ts`), `decideGate` (`service.ts`); `web/src/modules/projects/GateDecisionDialog.tsx`

### E11-05 Gate templates

**Status:** done · **Priority:** P2 · **Type:** feature

As a project administrator, I edit the checklist and required documents for each gate.
New gates use the edited template; gates already open keep what they had.

**Acceptance criteria**

- [x] Templates are data, seeded once and never overwritten
- [x] Editing needs `projects.administer`
- [x] New gates use the current template

**Implemented in:** `GET /api/projects/gate-definitions`, `PUT/PATCH /api/projects/gate-definitions/:key` (`server/src/modules/projects/routes.ts`), `defaults.ts`; `web/src/modules/projects/GateTemplates.tsx`

### E11-06 Gate documents

**Status:** done · **Priority:** P2 · **Type:** feature

As a project manager, each gate lists the documents it expects and I record whether
each is in place and where it is.

**Acceptance criteria**

- [x] The expected documents are copied from the gate template
- [x] Each can be marked as provided with a note or location
- [x] A missing required document blocks the gate (see E11-14)

**Implemented in:** `PATCH /api/projects/:id/gates/:gateId/documents/:index` (`server/src/modules/projects/routes.ts`); `web/src/modules/projects/GateDocuments.tsx`

### E11-07 Status reports and trend

**Status:** done · **Priority:** P1 · **Type:** feature

As a project manager, I file a regular status report with red, amber or green ratings
for overall, schedule, budget and risk, and the project shows its latest ratings and
which way they are heading.

**Acceptance criteria**

- [x] Add, change (on screen, see E11-19) and remove status reports
- [x] The latest ratings and the report date are copied onto the project
- [x] The trend between the last two reports is worked out
- [x] A trend chart on the project page

**Implemented in:** `/api/projects/:id/status-reports`, `/api/projects/:id/status-trend` (`server/src/modules/projects/routes.ts`); `web/src/modules/projects/StatusReportsTab.tsx`, `StatusTrend.tsx`

### E11-08 Risks, issues, decisions and change requests

**Status:** done · **Priority:** P2 · **Type:** feature

As a project manager, I keep the project's own log of risks, issues, decisions and
change requests.

**Acceptance criteria**

- [x] One list per kind, with add, edit and remove
- [x] Owner, status and due date where they apply
- [x] Changes are audited against the project

**Implemented in:** `/api/projects/:id/items` (`server/src/modules/projects/routes.ts`); `web/src/modules/projects/ItemsTab.tsx`, `ItemDialog.tsx`

### E11-09 Escalate a project risk to the risk register

**Status:** done · **Priority:** P2 · **Type:** feature

As a project manager, I can escalate a project risk so that it also appears in the
organization's risk register.

**Acceptance criteria**

- [x] Escalation creates a risk through the shared registry, if the risk module is loaded
- [x] The project item records that it was escalated
- [x] The two modules share no code

**Implemented in:** `POST /api/projects/:id/items/:itemId/escalate` (`server/src/modules/projects/routes.ts`), `service.ts`; `web/src/modules/projects/ItemsTab.tsx`

### E11-10 Milestones

**Status:** done · **Priority:** P2 · **Type:** feature

As a project manager, I list the project's milestones with planned and actual dates,
and they appear on the portfolio timeline.

**Acceptance criteria**

- [x] Add, change, complete and remove milestones
- [x] Milestones feed the timeline view

**Implemented in:** `/api/projects/:id/milestones` (`server/src/modules/projects/routes.ts`); `web/src/modules/projects/MilestonesTab.tsx`

### E11-11 Priority scoring

**Status:** done · **Priority:** P2 · **Type:** feature

As a portfolio manager, I score each project against weighted criteria and get one
priority score to rank requests by.

**Acceptance criteria**

- [x] Criteria and weights are settings
- [x] Each criterion is scored on a fixed range
- [x] The weighted score is computed and stored on the project

**Implemented in:** `server/src/modules/projects/rules.ts`; `web/src/modules/projects/ScoringTab.tsx`

### E11-12 Portfolio views

**Status:** done · **Priority:** P1 · **Type:** feature

As a manager, I see all projects as a register, a board by stage, a timeline and a
budget view, with a funnel of how many are at each stage and a warning when too many
are in delivery at once.

**Acceptance criteria**

- [x] Register (table) view
- [x] Board by stage
- [x] Timeline with milestones
- [x] Budget and spend view
- [x] Funnel by stage
- [x] Work-in-progress warning against a configurable limit

**Implemented in:** `GET /api/projects/portfolio` (`server/src/modules/projects/routes.ts`); `web/src/modules/projects/PortfolioPage.tsx`, `portfolioFilters.ts`, `PortfolioTable.tsx`, `PortfolioBoard.tsx`, `PortfolioTimeline.tsx`, `PortfolioBudget.tsx`

### E11-13 Project settings screen

**Status:** done · **Priority:** P2 · **Type:** feature

As a project administrator, I change tier thresholds, scoring criteria, the
work-in-progress limit and gate templates on one screen.

**Acceptance criteria**

- [x] Settings are read by anyone who can view projects
- [x] Changing them needs `projects.administer`
- [x] Changes are validated and audited

**Implemented in:** `GET /api/projects/settings`, `PUT/PATCH /api/projects/settings` (`server/src/modules/projects/routes.ts`); `web/src/modules/projects/SettingsPage.tsx`

### E11-14 Required documents block a gate

**Status:** done · **Priority:** P2 · **Type:** improvement

As an approver, I cannot approve a gate while a document its template marks as required
is missing.

**Acceptance criteria**

- [x] Templates mark each document as required or optional (migration `002` turns the old list of names into `{ name, required }`; documents on gates already open became optional so nothing in flight was blocked)
- [x] Approval is refused, with a clear message, while a required document is missing (`gate_blocked`, naming each document); the gate lists its blockers and the decision dialog shows them
- [x] An approver can waive a document with a recorded reason, and withdraw the waiver
- [x] Tests cover blocked, waived and allowed approvals

**Implemented in:** `templateDocuments`, `missingDocuments`, `approvalBlockers` (`server/src/modules/projects/rules.ts`); `POST /api/projects/:id/gates/:gateId/documents/:index/waive` (`routes.ts`), `waiveGateDocument` (`service.ts`); `web/src/modules/projects/GateDocuments.tsx`, `GateDecisionDialog.tsx`, `GateParts.tsx`, `GateTemplates.tsx`; tests in `features.test.ts`

### E11-15 Move a project back a stage

**Status:** done · **Priority:** P2 · **Type:** feature

As an approver, I can send a project back to an earlier stage when a gate decision
turns out to be premature.

**Acceptance criteria**

- [x] Rollback needs `projects.approve` and a reason
- [x] The earlier gate is reopened with its checklist as it was
- [x] The move is audited (`project.stage_rollback`) and shown in the gate's decisions as "Reopened"

**Implemented in:** `POST /api/projects/:id/rollback` (`server/src/modules/projects/routes.ts`), `rollbackStage` (`service.ts`); `web/src/modules/projects/RollbackDialog.tsx`, the More actions menu in `ProjectDetail.tsx`

### E11-16 Let anyone submit a project request

**Status:** done · **Priority:** P2 · **Type:** improvement

As a member of staff outside IT, I can submit a project request without being given
permission to create and edit projects.

**Acceptance criteria**

- [x] A setting (`intakeOpenTo`: people who can create projects, everyone who can view projects, or everyone who can sign in) allows submitting a request only
- [x] The requester can see the progress of their own request (`requested_by`; "Your requests" on the request page)
- [x] The requester cannot edit the project after submission
- [x] Only the request fields are taken from the requester; stage, tier override and money fields are ignored

**Implemented in:** `GET /api/projects/intake`, `POST /api/projects/requests` (`server/src/modules/projects/routes.ts`), `mayRequest`, `createRequest`, `myRequests` (`service.ts`); `web/src/modules/projects/IntakeForm.tsx`, `SettingsPage.tsx`

### E11-17 Attach documents to gates

**Status:** done · **Priority:** P3 · **Type:** feature

As a project manager, I attach the business case, plan or sign-off to the gate that
asks for it, instead of noting where it is kept.

**Acceptance criteria**

- [x] A file can be attached to each gate document (stored on the project by the attachments module; the document keeps its `attachment_id` and is marked received)
- [x] Works without the attachments module: the button is simply not shown

**Implemented in:** `setGateDocument` (`server/src/modules/projects/service.ts`); `web/src/modules/projects/GateDocuments.tsx`

### E11-18 Complete a project automatically at Close

**Status:** done · **Priority:** P2 · **Type:** improvement

As a portfolio manager, a project whose go-live gate is approved is marked completed
without anyone having to remember to change its status.

**Acceptance criteria**

- [x] Approving the last gate sets the status to Completed
- [x] Moving the project back from Close makes it Active again

**Implemented in:** `decideGate`, `rollbackStage` (`server/src/modules/projects/service.ts`); test in `features.test.ts`

### E11-19 Edit a status report

**Status:** done · **Priority:** P2 · **Type:** improvement

As a project manager, I correct a status report instead of deleting and re-adding it.

**Acceptance criteria**

- [x] `PATCH /api/projects/:id/status-reports/:reportId` validates the ratings and dates
- [x] The project's latest ratings and trend are recalculated and the change is audited
- [x] Edit from the report's menu on the reports timeline

**Implemented in:** `updateReport` (`server/src/modules/projects/service.ts`); `web/src/modules/projects/StatusReportsTab.tsx`, `StatusTrend.tsx`

### E11-20 Systems affected

**Status:** done · **Priority:** P2 · **Type:** feature

As a project manager, I name the systems in the inventory that a project changes,
replaces or depends on.

**Acceptance criteria**

- [x] `systems_affected` is a list of `system` ids, validated against the inventory when it is loaded and refused when it is not
- [x] Systems the viewer may not see are counted but not named
- [x] Chosen on the request form and on the project's Overview tab

**Implemented in:** migration `002_gates_requests_systems.sql`; `GET /api/projects/:id/systems` (`server/src/modules/projects/routes.ts`), `systemsFor` (`service.ts`); `web/src/modules/projects/SystemsCard.tsx`, `IntakeForm.tsx`

### E11-21 Link the go-live gate to a change record

**Status:** done · **Priority:** P3 · **Type:** feature

As a change manager, the go-live approval and the change that carries it point at each
other.

**Acceptance criteria**

- [x] A gate template can ask for a change record (go-live does by default)
- [x] `PATCH /api/projects/:id/gates/:gateId` with `change_id` links or unlinks a change; refused when change records are not loaded
- [x] The link is audited (`project.gate_change`) and shown on the gate and in the gate's record

**Implemented in:** `setGateChange` (`server/src/modules/projects/service.ts`); `web/src/modules/projects/GateTab.tsx`, `GateRecordDrawer.tsx`

### E11-22 Notifications for gates, reports and red projects

**Status:** done · **Priority:** P2 · **Type:** feature

As a project manager or approver, I am told when something needs me.

**Acceptance criteria**

- [x] Gate ready for a decision: approvers (`approval`) and the manager (`due`)
- [x] Status report due after the configured number of days (`reportIntervalDays`, default 30): the manager (`reminder`)
- [x] Project turned red: the manager and approvers, once
- [x] Sent through `app.notify` only when the notifications module is loaded; a daily sweep (also `POST /api/projects/reminders/run`) repeats due items at most once a day

**Implemented in:** `notifyGateReady`, `notifyTurnedRed`, `runReminders` (`server/src/modules/projects/service.ts`), timer in `index.ts`; tests in `features.test.ts`

### E11-23 Redesign on the Mantine foundation

**Status:** done · **Priority:** P1 · **Type:** improvement

As any user, the projects screens look and behave like the rest of the rebuilt application.

**Acceptance criteria**

- [x] Portfolio: summary strip (count, rating split, spend against budget, gate decisions due, work in progress), clickable stage boxes, view switcher (table, board, timeline, budget) with view and filters in the address
- [x] Board cards with tier, rating and trend, manager, next gate and budget bar
- [x] Milestone-level timeline colored by stage, with a today line, quarter and year zoom and sticky names, legible in both themes
- [x] Budget versus actual chart in the organization's currency
- [x] Project page with the gate stepper as centerpiece, a gate record drawer, the checklist with progress, required documents and a decision dialog that lists exactly what blocks approval
- [x] Status reports as a timeline with a four-line trend chart; one register for risks, issues, decisions and change requests; scoring explained; Actions tab (source `project`)
- [x] Short request form; most of the bespoke stylesheet replaced by core and Mantine components
- [x] Checked in a browser, light and dark, 1440 and 820 wide; transit-flavored invented samples

**Implemented in:** `web/src/modules/projects/*`; samples in `server/src/modules/projects/seed.ts`

### E11-24 Reminders for overdue milestones and register items

**Status:** open · **Priority:** P3 · **Type:** feature

As a project manager, I am reminded when a milestone or a register item passes its due
date. Today only status reports and gates send reminders.

**Acceptance criteria**

- [ ] The daily sweep notifies the owner (or the manager) of an overdue milestone or item, once
- [ ] Tests cover with and without the notifications module