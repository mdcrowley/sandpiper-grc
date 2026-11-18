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
| E11-14 | Required documents block a gate | open | P2 |
| E11-15 | Move a project back a stage | open | P2 |
| E11-16 | Let anyone submit a project request | open | P2 |
| E11-17 | Attach documents to gates | open | P3 |

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
template, and I tick items off as they are met.

**Acceptance criteria**

- [x] A gate is opened for the project's current stage
- [x] The checklist is copied from the template for that gate and tier
- [x] Ticking an item records who and when
- [x] A stepper shows the stages and where the project is

**Implemented in:** `openGate`, `setChecklistItem` (`server/src/modules/projects/service.ts`); `GET /api/projects/:id/gates`, `PATCH .../gates/:gateId/items/:itemId` (`routes.ts`); `web/src/modules/projects/GateTab.tsx`, `GateChecklist.tsx`, `GateStepper.tsx`

### E11-04 Gate decisions

**Status:** done · **Priority:** P1 · **Type:** feature

As an approver, I approve or reject a gate. A gate cannot be approved while any
checklist item is unticked, and approval moves the project to the next stage.

**Acceptance criteria**

- [x] Deciding needs `projects.approve`
- [x] Approval is blocked while an item is unticked
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
- [ ] A missing required document blocks the gate (see E11-14)

**Implemented in:** `PATCH /api/projects/:id/gates/:gateId/documents/:index` (`server/src/modules/projects/routes.ts`); `web/src/modules/projects/GateTab.tsx`

### E11-07 Status reports and trend

**Status:** done · **Priority:** P1 · **Type:** feature

As a project manager, I file a regular status report with red, amber or green ratings
for overall, schedule, budget and risk, and the project shows its latest ratings and
which way they are heading.

**Acceptance criteria**

- [x] Add, change and remove status reports
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
organisation's risk register.

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

**Implemented in:** `GET /api/projects/portfolio` (`server/src/modules/projects/routes.ts`); `web/src/modules/projects/PortfolioPage.tsx`, `PortfolioTable.tsx`, `PortfolioKanban.tsx`, `PortfolioTimeline.tsx`, `PortfolioBudget.tsx`

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

**Status:** open · **Priority:** P2 · **Type:** improvement

As an approver, I cannot approve a gate while a document its template marks as required
is missing. Today only the checklist blocks approval.

**Acceptance criteria**

- [ ] Templates mark each document as required or optional
- [ ] Approval is refused, with a clear message, while a required document is missing
- [ ] An approver can waive a document with a recorded reason
- [ ] Tests cover blocked, waived and allowed approvals

### E11-15 Move a project back a stage

**Status:** open · **Priority:** P2 · **Type:** feature

As an approver, I can send a project back to an earlier stage when a gate decision
turns out to be premature. Today a project can only move forward.

**Acceptance criteria**

- [ ] Rollback needs `projects.approve` and a reason
- [ ] The earlier gate is reopened with its checklist as it was
- [ ] The move is audited and shown in the project's gate history

### E11-16 Let anyone submit a project request

**Status:** open · **Priority:** P2 · **Type:** improvement

As a member of staff outside IT, I can submit a project request without being given
permission to create and edit projects. Today intake needs `projects.create`.

**Acceptance criteria**

- [ ] A separate permission (or the portal) allows submitting a request only
- [ ] The requester can see the progress of their own request
- [ ] The requester cannot edit the project after submission

### E11-17 Attach documents to gates

**Status:** open · **Priority:** P3 · **Type:** feature

As a project manager, I attach the business case, plan or sign-off to the gate that
asks for it, instead of noting where it is kept.

**Acceptance criteria**

- [ ] A file can be attached to each gate document
- [ ] Depends on [E14-01](E14-platform-services.md)
