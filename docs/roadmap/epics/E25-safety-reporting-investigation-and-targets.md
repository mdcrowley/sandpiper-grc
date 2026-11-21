# E25 Safety reporting, investigation and performance targets (wave 10)

**Status:** done (15 of 15 issues done)

## Goal

Give safety events the depth a safety team needs to report and investigate them (people involved, conditions, timeline, statements, reportability and notification clocks), make safety performance indicators measurable against yearly targets, and ask for a safety assessment on changes that affect safety.

## Scope notes

- No reporting rule of any jurisdiction is shipped: operators define their own reportability rules. The dev sample profile loads two rules labeled "Example (invented)", switched off.
- Drug and alcohol test results are not planned (E25-13); only a "testing required" flag is kept.
- Computed indicators read the metric registry (contract C3, `core/metrics.ts`).
- People involved link to the staff roster (contract C4) only when the `person` type is loaded; corrective action plans (contract C1) show on the event when `risks/CapPanel.tsx` is in the build.
- Issues marked "stretch" in the wave 10 plan carry priority P3.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E25-01 | People involved (restricted) | done | P2 |
| E25-02 | Fatalities, people transported, damage and evacuation | done | P2 |
| E25-03 | Conditions, contributing factors and coordinates | done | P2 |
| E25-04 | Timeline, witness statements and testing-required flag | done | P2 |
| E25-05 | Operator-defined reportability rules | done | P2 |
| E25-06 | Notification clocks on safety events | done | P2 |
| E25-07 | Manual indicators | done | P2 |
| E25-08 | Computed indicators | done | P3 |
| E25-09 | Distance between failures | done | P3 |
| E25-10 | Yearly targets with approval | done | P2 |
| E25-11 | Safety impact on changes | done | P3 |
| E25-12 | Sample data | done | P3 |
| E25-13 | Not planned: drug and alcohol test results | done | P3 |
| E25-14 | Guide | done | P2 |
| E25-15 | Anonymize an event's investigation record at the end of retention | done | P2 |

---

### E25-01 People involved (restricted)

**Status:** done · **Priority:** P2 · **Type:** feature

An investigator wants to record each person involved in an event, their role and injuries, optionally linked to the staff roster.

**Acceptance criteria**

- [x] `safety_event_people` rows with role, injury severity, transported and fatality
- [x] The routes need `security.view` as well as `safety.view`

**Implemented in:** `server/src/modules/safety/event-detail.ts`, migration `safety/002`; `web/src/modules/safety/EventTabs.tsx` (People involved tab); test `safety/event-depth.test.ts`. The audit names the role, never the person; `person_id` is kept only when the staff roster (`person`) is loaded.

### E25-02 Fatalities, people transported, damage and evacuation

**Status:** done · **Priority:** P2 · **Type:** feature

A safety manager wants the event figures used to decide reportability, kept in step with the people involved.

**Acceptance criteria**

- [x] Fields for fatalities, people transported, damage estimate and evacuation
- [x] Counts stay in step with the people-involved rows

**Implemented in:** `server/src/modules/safety/events.ts` (validation; counts follow the people rows once any exist), `event-detail.ts` (`peopleCounts`); `web/src/modules/safety/Events.tsx` (Harm and damage card)

### E25-03 Conditions, contributing factors and coordinates

**Status:** done · **Priority:** P2 · **Type:** feature

An investigator wants weather, lighting, surface, contributing factors and the location of an event.

**Acceptance criteria**

- [x] The fields of migration `safety/002`

**Implemented in:** `server/src/modules/safety/events.ts`, lists `safety_weather`, `safety_lighting`, `safety_surface`, `safety_contributing_factor` (`index.ts`); `web/src/modules/safety/EventTabs.tsx` (Investigation tab)

### E25-04 Timeline, witness statements and testing-required flag

**Status:** done · **Priority:** P2 · **Type:** feature

An investigator wants a timeline, restricted witness statements and a yes or no flag for post-event testing.

**Acceptance criteria**

- [x] Timeline and statement routes
- [x] Statements need `security.view`
- [x] A testing-required flag; results are not recorded (E25-13)

**Implemented in:** `server/src/modules/safety/event-detail.ts` (`/api/safety-events/:id/timeline`, `/statements`); entries the application writes cannot be changed; `web/src/modules/safety/EventTabs.tsx`

### E25-05 Operator-defined reportability rules

**Status:** done · **Priority:** P2 · **Type:** feature

A safety manager wants rules that say when an event must be reported, to whom and how fast, written by the organization.

**Acceptance criteria**

- [x] Administration > Safety reporting rules (`safety.administer`)
- [x] Conditions over the event figures; reportability is worked out on every save
- [x] No rules are shipped; the samples are clearly labeled examples, switched off

**Implemented in:** `server/src/modules/safety/reporting.ts` (`/api/safety/report-rules`, `ruleMatches`, `evaluate`); `web/src/modules/safety/ReportRules.tsx`; seed `safety/seed.ts`

### E25-06 Notification clocks on safety events

**Status:** done · **Priority:** P2 · **Type:** feature

A safety manager wants a clock for each report an event needs, with alerts as the deadline nears.

**Acceptance criteria**

- [x] A rule that newly matches creates a clock, a notification task and an alert
- [x] Job `safety.clocks` every 15 minutes; setting `safety.clock_amber_fraction`
- [x] A clocks tile on the dashboard

**Implemented in:** `server/src/modules/safety/reporting.ts` (table `safety_notifications`, `GET /api/safety-events/:id/clocks`, `GET /api/safety/clocks`, `POST /api/safety-notifications/:id/complete`, sweep), clock arithmetic from `secincidents/clocks.ts`; `web/src/modules/safety/EventTabs.tsx` (Reporting tab), `Dashboard.tsx` (tile). Clocks run from the event's date and time; the summary counts every clock, the list follows the event's restriction.

### E25-07 Manual indicators

**Status:** done · **Priority:** P2 · **Type:** feature

A safety manager wants to enter an indicator's value for each month.

**Acceptance criteria**

- [x] `PUT /api/safety-indicators/:id/values/:period` and an entry grid

**Implemented in:** `server/src/modules/safety/targets.ts`, `indicators.ts` (measure `manual`); `web/src/modules/safety/IndicatorTabs.tsx` (Values tab)

### E25-08 Computed indicators

**Status:** done · **Priority:** P3 · **Type:** feature

A safety manager wants indicators computed from other modules' records, for example overdue corrective actions. A stretch goal if the metric providers are late.

**Acceptance criteria**

- [x] An indicator can name a metric key from `GET /api/metrics`
- [x] Tested with a stand-in metric

**Implemented in:** `server/src/modules/safety/indicators.ts` (measure `computed`, `metric_key`, `metricsAvailable`); `web/src/modules/safety/Indicators.tsx` (Computed from picker); test `safety/indicator-targets.test.ts`

### E25-09 Distance between failures

**Status:** done · **Priority:** P3 · **Type:** feature

A safety manager wants miles between major failures from the exposure figures. A stretch goal.

**Acceptance criteria**

- [x] Exposure gains revenue miles and major failures
- [x] A distance-between indicator works it out

**Implemented in:** migration `safety/003`, `server/src/modules/safety/indicators.ts` (measure `distance_between`); `web/src/modules/safety/Indicators.tsx` (Exposure page, trend table)

### E25-10 Yearly targets with approval

**Status:** done · **Priority:** P2 · **Type:** feature

An accountable executive wants each indicator's yearly target approved, or recorded as decided at a meeting.

**Acceptance criteria**

- [x] `safety_indicator_targets` per year
- [x] Approval kind `safety_targets`

**Implemented in:** `server/src/modules/safety/targets.ts` (`/api/safety-indicators/:id/targets`, `.../targets/:year/approval`, `.../targets/:year/decision` with `safety.approve`, default workflow "Safety performance targets"); `web/src/modules/safety/IndicatorTabs.tsx` (Yearly targets tab). A decision may name a governance `meeting_decision` when that type is loaded.

### E25-11 Safety impact on changes

**Status:** done · **Priority:** P3 · **Type:** feature

A safety manager wants a change that affects safety to need a linked hazard assessment before it is approved or scheduled. A stretch goal.

**Acceptance criteria**

- [x] A questionnaire answer sets `changes.safety_impact`
- [x] While the safety area is on, approving or scheduling such a change needs a hazard linked as `safety_assessment`
- [x] "Create hazard from this change"

**Implemented in:** migration `changes/003`, `server/src/modules/changes/rules.ts` (`meta.safety_impact`, `safetyImpactOf`), `resource.ts`, `workflow.ts` (checked at submission for approval, scheduling and start), `safety-impact.ts` (helper); routes `/api/changes/:id/safety-assessment` in `server/src/modules/safety/change-assessment.ts`, so they follow the safety area; `web/src/modules/changes/SafetyAssessment.tsx`, `QuestionnaireAdmin.tsx`; test `changes/safety-impact.test.ts`. The check is made when the change is submitted, so approval never starts without the assessment.

### E25-12 Sample data

**Status:** done · **Priority:** P3 · **Type:** feature

Someone trying the application wants invented people involved, rules, indicators and targets.

**Acceptance criteria**

- [x] The invented sample set of the wave 10 plan

**Implemented in:** `server/src/modules/safety/seed.ts` (`seedReportingSamples`, loaded once, also on databases seeded before wave 10)

### E25-13 Not planned: drug and alcohol test results

**Status:** done · **Priority:** P3 · **Type:** feature

Not planned: test results belong in a specialist system with its own privacy rules. Only the yes or no "post-event testing required" flag is kept on a safety event (E25-04). Whether the testing program is run as required is covered by obligations (E30) and audits (E24).

**Implemented in:** nothing to build; recorded so that nobody builds it here (gap review GP-20)

### E25-14 Guide

**Status:** done · **Priority:** P2 · **Type:** docs

Users need the new event, reporting and indicator features in the guide.

**Acceptance criteria**

- [x] `docs/user/20-safety-management.md` and `10-change-enablement.md` updated

**Implemented in:** `docs/user/20-safety-management.md` (People involved, Investigation record, Reporting and notification clocks, Safety reporting rules, indicator measures, Yearly targets), `docs/user/10-change-enablement.md` (Safety assessment, the questionnaire's safety question)

### E25-15 Anonymize an event's investigation record at the end of retention

**Status:** done · **Priority:** P2 · **Type:** feature

A records officer wants anonymizing a safety event at the end of its retention period to remove the names, notes and words of its people involved, statements and timeline too. Core anonymizing (`core/retention.ts`) covers a record's own fields, comments and files, not a module's own tables; `anonymizeEventDetails` in `safety/event-detail.ts` does the safety part and is tested, but nothing calls it yet. Removing an event for good already takes these rows with it (foreign keys with `on delete cascade`, migration `safety/002`). Belongs with the retention work of GP-15 (E34).

**Acceptance criteria**

- [x] Core retention lets a record type add its own anonymizing step (for example a `ResourceDef` hook run inside the anonymize transaction)
- [x] Safety events use it to call `anonymizeEventDetails`

**Implemented in:** `core/retention.ts` `onAnonymize(type, hook)`, registered by `safety/index.ts` with `anonymizeEventDetails`; tests `core/retention.test.ts`, `safety/event-depth.test.ts`

