# E31 Business continuity and emergency management

**Status:** in progress (9 of 10 issues done)

## Goal

Analyze the impact of losing each business process, keep continuity and emergency plans as reviewed and approved records, check recovery times against what the business can tolerate, and run a non-cyber emergency with an activation log. Gap review GP-09.

## Scope notes

- Built in wave 11 as the module `continuity` (permission key and feature area `continuity`). Builds on the services, systems and sites dependency map already in place.
- No mass notification to the public and no paging through outside services: a call tree is a list to print and call.
- Security incidents keep their own restricted workspace; activations share no tables with it.
- The impact area stored as `safety` is labeled **Harm to people**, so the impact grid names no switched-off area whatever is on; stored ratings are unchanged. The empty dependency list names only the kinds that can be added.
- E31-10 (impact analysis sign-off through an approval workflow) was a wave 11 stretch and stays open for wave 12; sign-off is a direct action of a `continuity.approve` holder meanwhile.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E31-01 | Business processes linked to services, systems, sites and vendors | done | P2 |
| E31-02 | Business impact analysis with maximum tolerable downtime | done | P2 |
| E31-03 | Continuity and emergency plans with review and approval | done | P2 |
| E31-04 | Call trees | done | P3 |
| E31-05 | Gap report: tolerable downtime against system recovery time | done | P2 |
| E31-06 | Emergency activation log for non-cyber events | done | P2 |
| E31-07 | Area, permission key and Continuity manager role | done | P2 |
| E31-08 | Dashboard, metrics and calendar | done | P2 |
| E31-09 | Sample data and guide | done | P2 |
| E31-10 | Impact analysis sign-off through an approval workflow | open | P3 |

---

### E31-01 Business processes linked to services, systems, sites and vendors

**Status:** done · **Priority:** P2 · **Type:** feature

An emergency manager wants each business process (dispatch, fare collection, scheduling, payroll) with what it depends on.

**Acceptance criteria**

- [x] A business process record (`business_process`, `BPR-`) linked to systems, services, sites, vendors, other processes and positions (`process_dependencies`, critical or not)
- [x] Mirrored as record links (relation `depends_on`), so the Related panel shows them on both records
- [x] Dependencies of a switched-off type, and records the editor may not see, are hidden and kept
- [x] System and site pages list the processes that depend on them (a system also through its services)

**Implemented in:** `server/src/modules/continuity/processes.ts`; `web/src/modules/continuity/Processes.tsx`, `InventoryPanel.tsx`

### E31-02 Business impact analysis with maximum tolerable downtime

**Status:** done · **Priority:** P2 · **Type:** feature

An emergency manager wants each process's tolerable downtime, peak periods and recovery needs.

**Acceptance criteria**

- [x] An impact analysis per process (`bia`, `BIA-`) with impacts by time band and area (1 to 5), tolerable downtime, recovery time and point targets, and the organization's own questions (list `bia_question`)
- [x] A suggested tolerable downtime from the ratings
- [x] Sign-off (`continuity.approve`) copies the downtime and targets onto the process and sets the next analysis due date (`continuity.bia_every_months`)

**Implemented in:** `server/src/modules/continuity/bia.ts`; `web/src/modules/continuity/Bia.tsx`

### E31-03 Continuity and emergency plans with review and approval

**Status:** done · **Priority:** P2 · **Type:** feature

An emergency manager wants plans as records with owners, review dates, recovery strategies and approval.

**Acceptance criteria**

- [x] Plan records (`continuity_plan`, `CPL-`) with a review cycle, the processes covered and a checklist by phase
- [x] Approval kind `continuity_plan` (one step, `continuity.approve`): approval sets the next review date, rejection returns to draft
- [x] Exercises link to a plan (relation `exercised_by`); the plan shows its last exercise date

**Implemented in:** `server/src/modules/continuity/plans.ts`; `web/src/modules/continuity/Plans.tsx`

### E31-04 Call trees

**Status:** done · **Priority:** P3 · **Type:** feature

An emergency manager wants call trees built from the people and contacts already recorded.

**Acceptance criteria**

- [x] A call tree per plan, from roster people, accounts or typed names (names and phones read from the person or account)
- [x] Printable: `GET /api/continuity-plans/:id/call-tree.pdf` (`continuity.export`), with the organization's branding

**Implemented in:** `server/src/modules/continuity/plans.ts`; `web/src/modules/continuity/Plans.tsx`

### E31-05 Gap report: tolerable downtime against system recovery time

**Status:** done · **Priority:** P2 · **Type:** feature

An IT recovery lead wants every process whose tolerable downtime is shorter than its systems' recovery time listed.

**Acceptance criteria**

- [x] A gap report comparing active processes with the recovery time objective of the systems they critically depend on, directly or through a service
- [x] Recovery targets shorter than a system's recovery time and systems with no recovery time are flagged too
- [x] A system the reader may not see is not named; figures count every process

**Implemented in:** `server/src/modules/continuity/gaps.ts`; `web/src/modules/continuity/Gaps.tsx`

### E31-06 Emergency activation log for non-cyber events

**Status:** done · **Priority:** P2 · **Type:** feature

An emergency manager wants to declare and run a severe-weather, power or service-disruption event with a log, roles and checklists.

**Acceptance criteria**

- [x] An activation record (`emergency_activation`, `EMA-`) with an append-only log, roles and the plans' checklists copied in, without the cyber fields
- [x] Standing down needs a summary; closing needs an after-action summary; after-action findings raise corrective action plans (source `continuity`)
- [x] Anonymizing clears the log text, typed names and checklist notes

**Implemented in:** `server/src/modules/continuity/activations.ts`; `web/src/modules/continuity/Activations.tsx`

### E31-07 Area, permission key and Continuity manager role

**Status:** done · **Priority:** P2 · **Type:** feature

An administrator wants business continuity to be an optional part with its own permission and a ready-made role. Wave 11 (coordinator step 0 declared the `continuity` area and key and the Continuity manager role; this issue closes when the module follows them.)

**Acceptance criteria**

- [x] The `continuity` area hides every page, field, list value, notification kind, calendar source and assistant tool while off
- [x] Permission key `continuity`; the Continuity manager role holds it

**Implemented in:** `server/src/modules/continuity/index.ts`; `web/src/modules/continuity/index.tsx`

### E31-08 Dashboard, metrics and calendar

**Status:** done · **Priority:** P2 · **Type:** feature

An emergency manager wants a continuity dashboard, the continuity figures available to indicators, and plan reviews on their calendar.

**Acceptance criteria**

- [x] A `/continuity` dashboard: processes by criticality, gaps, plans due for review, active activations
- [x] Metrics `continuity.processes_with_gap` and `continuity.plans_review_overdue`
- [x] Calendar sources `continuity.reviews` and `continuity.exercises`
- [x] Daily reminders (`continuity.reminders`) for plan reviews and impact analyses due, each claimed before sending; `GET /api/continuity/summary` for assistant tools

**Implemented in:** `server/src/modules/continuity/gaps.ts`, `reminders.ts`; `web/src/modules/continuity/Dashboard.tsx`

### E31-09 Sample data and guide

**Status:** done · **Priority:** P2 · **Type:** documentation

An evaluator wants invented sample processes, plans and an activation, and a guide page.

**Acceptance criteria**

- [x] Invented samples, labeled "(sample)"
- [x] Guide page `30-business-continuity.md`

**Implemented in:** `server/src/modules/continuity/seed.ts`; `docs/user/30-business-continuity.md`

### E31-10 Impact analysis sign-off through an approval workflow

**Status:** open · **Priority:** P3 · **Type:** feature

A continuity manager wants the process owner to sign off an impact analysis through the approval workflows (approval kind `bia_signoff`), with the history of who decided. Wave 11 stretch, not built: a holder of `continuity.approve` signs off directly.

**Acceptance criteria**

- [ ] Approval kind `bia_signoff` (one step: the process owner); approval signs the analysis off as "Sign off" does today
