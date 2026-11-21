# E31 Business continuity and emergency management

**Status:** open (0 of 9 issues done)

## Goal

Analyze the impact of losing each business process, keep continuity and emergency plans as reviewed and approved records, check recovery times against what the business can tolerate, and run a non-cyber emergency with an activation log. Gap review GP-09.

## Scope notes

- Planned for wave 11. Builds on the services, systems and sites dependency map already in place.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E31-01 | Business processes linked to services, systems, sites and vendors | open | P2 |
| E31-02 | Business impact analysis with maximum tolerable downtime | open | P2 |
| E31-03 | Continuity and emergency plans with review and approval | open | P2 |
| E31-04 | Call trees | open | P3 |
| E31-05 | Gap report: tolerable downtime against system recovery time | open | P2 |
| E31-06 | Emergency activation log for non-cyber events | open | P2 |
| E31-07 | Area, permission key and Continuity manager role | open | P2 |
| E31-08 | Dashboard, metrics and calendar | open | P2 |
| E31-09 | Sample data and guide | open | P2 |

---

### E31-01 Business processes linked to services, systems, sites and vendors

**Status:** open · **Priority:** P2 · **Type:** feature

An emergency manager wants each business process (dispatch, fare collection, scheduling, payroll) with what it depends on.

**Acceptance criteria**

- [ ] A business process record linked to services, systems, sites and vendors

### E31-02 Business impact analysis with maximum tolerable downtime

**Status:** open · **Priority:** P2 · **Type:** feature

An emergency manager wants each process's tolerable downtime, peak periods and recovery needs.

**Acceptance criteria**

- [ ] An impact analysis per process with tolerable downtime and recovery objectives

### E31-03 Continuity and emergency plans with review and approval

**Status:** open · **Priority:** P2 · **Type:** feature

An emergency manager wants plans as records with owners, review dates, recovery strategies and approval.

**Acceptance criteria**

- [ ] Plan records with a review cycle and an approval workflow

### E31-04 Call trees

**Status:** open · **Priority:** P3 · **Type:** feature

An emergency manager wants call trees built from the people and contacts already recorded.

**Acceptance criteria**

- [ ] A call tree per plan, printable

### E31-05 Gap report: tolerable downtime against system recovery time

**Status:** open · **Priority:** P2 · **Type:** feature

An IT recovery lead wants every process whose tolerable downtime is shorter than its systems' recovery time listed.

**Acceptance criteria**

- [ ] A gap report comparing processes with system recovery time objectives

### E31-06 Emergency activation log for non-cyber events

**Status:** open · **Priority:** P2 · **Type:** feature

An emergency manager wants to declare and run a severe-weather, power or service-disruption event with a log, roles and checklists.

**Acceptance criteria**

- [ ] An activation record with a log, roles and checklists, without the cyber fields

### E31-07 Area, permission key and Continuity manager role

**Status:** open · **Priority:** P2 · **Type:** feature

An administrator wants business continuity to be an optional part with its own permission and a ready-made role. Wave 11 (coordinator step 0 declared the `continuity` area and key and the Continuity manager role; this issue closes when the module follows them.)

**Acceptance criteria**

- [ ] The `continuity` area hides every page, field, list value, notification kind, calendar source and assistant tool while off
- [ ] Permission key `continuity`; the Continuity manager role holds it

### E31-08 Dashboard, metrics and calendar

**Status:** open · **Priority:** P2 · **Type:** feature

An emergency manager wants a continuity dashboard, the continuity figures available to indicators, and plan reviews on their calendar.

**Acceptance criteria**

- [ ] A `/continuity` dashboard: processes by criticality, gaps, plans due for review, active activations
- [ ] Metrics `continuity.processes_with_gap` and `continuity.plans_review_overdue`
- [ ] Calendar sources `continuity.reviews` and `continuity.exercises`

### E31-09 Sample data and guide

**Status:** open · **Priority:** P2 · **Type:** documentation

An evaluator wants invented sample processes, plans and an activation, and a guide page.

**Acceptance criteria**

- [ ] Invented samples, labeled "(sample)"
- [ ] Guide page `30-business-continuity.md`
