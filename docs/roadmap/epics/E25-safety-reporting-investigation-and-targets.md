# E25 Safety reporting, investigation and performance targets (wave 10)

**Status:** open (1 of 14 issues done: E25-13 is a "Not planned" entry)

## Goal

Give safety events the depth a safety team needs to report and investigate them (people involved, conditions, timeline, statements, reportability and notification clocks), make safety performance indicators measurable against yearly targets, and ask for a safety assessment on changes that affect safety.

## Scope notes

- No reporting rule of any jurisdiction is shipped: operators define their own reportability rules.
- Drug and alcohol test results are not planned (E25-13); only a "testing required" flag is kept.
- Computed indicators read the metric registry (contract C3).
- Issues marked "stretch" in the wave 10 plan carry priority P3; an unfinished one stays open for wave 11.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E25-01 | People involved (restricted) | open | P2 |
| E25-02 | Fatalities, people transported, damage and evacuation | open | P2 |
| E25-03 | Conditions, contributing factors and coordinates | open | P2 |
| E25-04 | Timeline, witness statements and testing-required flag | open | P2 |
| E25-05 | Operator-defined reportability rules | open | P2 |
| E25-06 | Notification clocks on safety events | open | P2 |
| E25-07 | Manual indicators | open | P2 |
| E25-08 | Computed indicators | open | P3 |
| E25-09 | Distance between failures | open | P3 |
| E25-10 | Yearly targets with approval | open | P2 |
| E25-11 | Safety impact on changes | open | P3 |
| E25-12 | Sample data | open | P3 |
| E25-13 | Not planned: drug and alcohol test results | done | P3 |
| E25-14 | Guide | open | P2 |

---

### E25-01 People involved (restricted)

**Status:** open · **Priority:** P2 · **Type:** feature

An investigator wants to record each person involved in an event, their role and injuries, optionally linked to the staff roster.

**Acceptance criteria**

- [ ] `safety_event_people` rows with role, injury severity, transported and fatality
- [ ] The routes need `security.view` as well as `safety.view`

### E25-02 Fatalities, people transported, damage and evacuation

**Status:** open · **Priority:** P2 · **Type:** feature

A safety manager wants the event figures used to decide reportability, kept in step with the people involved.

**Acceptance criteria**

- [ ] Fields for fatalities, people transported, damage estimate and evacuation
- [ ] Counts stay in step with the people-involved rows

### E25-03 Conditions, contributing factors and coordinates

**Status:** open · **Priority:** P2 · **Type:** feature

An investigator wants weather, lighting, surface, contributing factors and the location of an event.

**Acceptance criteria**

- [ ] The fields of migration `safety/002`

### E25-04 Timeline, witness statements and testing-required flag

**Status:** open · **Priority:** P2 · **Type:** feature

An investigator wants a timeline, restricted witness statements and a yes or no flag for post-event testing.

**Acceptance criteria**

- [ ] Timeline and statement routes
- [ ] Statements need `security.view`
- [ ] A testing-required flag; results are not recorded (E25-13)

### E25-05 Operator-defined reportability rules

**Status:** open · **Priority:** P2 · **Type:** feature

A safety manager wants rules that say when an event must be reported, to whom and how fast, written by the organization.

**Acceptance criteria**

- [ ] Administration > Safety reporting rules (`safety.administer`)
- [ ] Conditions over the event figures; reportability is worked out on every save
- [ ] No rules are shipped; the samples are clearly labeled examples, switched off

### E25-06 Notification clocks on safety events

**Status:** open · **Priority:** P2 · **Type:** feature

A safety manager wants a clock for each report an event needs, with alerts as the deadline nears.

**Acceptance criteria**

- [ ] A rule that newly matches creates a clock, a notification task and an alert
- [ ] Job `safety.clocks` every 15 minutes; setting `safety.clock_amber_fraction`
- [ ] A clocks tile on the dashboard

### E25-07 Manual indicators

**Status:** open · **Priority:** P2 · **Type:** feature

A safety manager wants to enter an indicator's value for each month.

**Acceptance criteria**

- [ ] `PUT /api/safety-indicators/:id/values/:period` and an entry grid

### E25-08 Computed indicators

**Status:** open · **Priority:** P3 · **Type:** feature

A safety manager wants indicators computed from other modules' records, for example overdue corrective actions. A stretch goal if the metric providers are late.

**Acceptance criteria**

- [ ] An indicator can name a metric key from `GET /api/metrics`
- [ ] Tested with a stand-in metric

### E25-09 Distance between failures

**Status:** open · **Priority:** P3 · **Type:** feature

A safety manager wants miles between major failures from the exposure figures. A stretch goal.

**Acceptance criteria**

- [ ] Exposure gains revenue miles and major failures
- [ ] A distance-between indicator works it out

### E25-10 Yearly targets with approval

**Status:** open · **Priority:** P2 · **Type:** feature

An accountable executive wants each indicator's yearly target approved, or recorded as decided at a meeting.

**Acceptance criteria**

- [ ] `safety_indicator_targets` per year
- [ ] Approval kind `safety_targets`

### E25-11 Safety impact on changes

**Status:** open · **Priority:** P3 · **Type:** feature

A safety manager wants a change that affects safety to need a linked hazard assessment before it is approved or scheduled. A stretch goal.

**Acceptance criteria**

- [ ] A questionnaire answer sets `changes.safety_impact`
- [ ] While the safety area is on, approving or scheduling such a change needs a hazard linked as `safety_assessment`
- [ ] "Create hazard from this change"

### E25-12 Sample data

**Status:** open · **Priority:** P3 · **Type:** feature

Someone trying the application wants invented people involved, rules, indicators and targets.

**Acceptance criteria**

- [ ] The invented sample set of the wave 10 plan

### E25-13 Not planned: drug and alcohol test results

**Status:** done · **Priority:** P3 · **Type:** feature

Not planned: test results belong in a specialist system with its own privacy rules. Only the yes or no "post-event testing required" flag is kept on a safety event (E25-04). Whether the testing program is run as required is covered by obligations (E30) and audits (E24).

**Implemented in:** nothing to build; recorded so that nobody builds it here (gap review GP-20)

### E25-14 Guide

**Status:** open · **Priority:** P2 · **Type:** docs

Users need the new event, reporting and indicator features in the guide.

**Acceptance criteria**

- [ ] `docs/user/20-safety-management.md` and `10-change-enablement.md` updated
