# E46 Wave 26: new areas and the remaining gaps

**Status:** done (74 of 74 issues done)

## Goal

Add the parts of the work a transit organization still kept elsewhere: procurement and budgets,
insurance, civil rights programs, and the strategic plan with its measures and operating statistics.
Make safety, inspections, fleet retirement and continuity plans work the way operations staff work
(defects from inspections, missed inspections followed up, governed vehicle retirement, plan
templates). Give each default role what its job needs, land people on the page they use, and let
anyone report a problem. Wave 26 built E46-01 to E46-52; wave 27 built the follow-ups found while building them (E46-53
to E46-74).

## Scope notes

- Nothing names a real organization, place, vendor or person; no single jurisdiction's law is a
  built-in default (procurement method limits, complaint time limits and reporting cycles are the
  organization's own settings); samples are invented and loaded only by the dev seed.
- Restriction hides detail, never counts: offers before an award, confidential civil rights
  complaints and restricted insurance claims are counted for everyone but shown only to the people
  allowed to see them.
- Each new area can be switched off and then shows nowhere except Administration > Features.
  **Civil rights** starts off (it holds confidential complaints); procurement, insurance and strategy
  start on.
- Every new record type works in data load mode (past dates, statuses, references and the named
  person).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E46-01 | Procurement area and feature switch | done | P2 |
| E46-02 | Solicitations | done | P2 |
| E46-03 | Offers and evaluation | done | P2 |
| E46-04 | Award and the resulting contract | done | P2 |
| E46-05 | Purchase orders | done | P2 |
| E46-06 | Budgets | done | P2 |
| E46-07 | Procurement in My work, calendars, metrics and the Overview | done | P2 |
| E46-08 | Procurement in data load mode | done | P2 |
| E46-09 | Insurance area and policies | done | P2 |
| E46-10 | Policy conditions tracked by controls | done | P2 |
| E46-11 | Records a policy covers | done | P2 |
| E46-12 | Insurance renewals | done | P2 |
| E46-13 | Certificates of insurance against contract requirements | done | P2 |
| E46-14 | Insurance claims | done | P2 |
| E46-15 | Insurance figures, metrics and data load | done | P2 |
| E46-16 | Register templates | done | P3 |
| E46-17 | Civil rights area and programs | done | P2 |
| E46-18 | Civil rights monitoring reports | done | P2 |
| E46-19 | Civil rights complaints | done | P2 |
| E46-20 | Confidential complaints | done | P2 |
| E46-21 | Business participation goals | done | P2 |
| E46-22 | Civil rights figures | done | P2 |
| E46-23 | Civil rights in data load mode | done | P2 |
| E46-24 | Strategic plan register | done | P2 |
| E46-25 | Strategic measures | done | P2 |
| E46-26 | Quarterly status updates and the action-item matrix | done | P2 |
| E46-27 | Plan scorecard and board PDF | done | P2 |
| E46-28 | Measures in dashboards and report packs | done | P2 |
| E46-29 | Operating statistics | done | P2 |
| E46-30 | Statistical submissions log | done | P2 |
| E46-31 | Strategy area and role | done | P2 |
| E46-32 | Safety indicator list shows where each stands | done | P2 |
| E46-33 | Hazard log flags | done | P3 |
| E46-34 | Safety plan tab | done | P2 |
| E46-35 | Inspection and defect tiles on the safety dashboard | done | P3 |
| E46-36 | Defects | done | P2 |
| E46-37 | Inspections and defects on vehicle, site and asset pages | done | P2 |
| E46-38 | Missed inspection follow-up | done | P2 |
| E46-39 | The inspection list opens on due and overdue | done | P3 |
| E46-40 | Governed vehicle retirement | done | P2 |
| E46-41 | The vehicle list shows condition, end of useful life and odometer | done | P3 |
| E46-42 | The certification list is sorted by expiry with days left | done | P3 |
| E46-43 | The "No asset class" tile opens the unclassed assets | done | P3 |
| E46-44 | Continuity plan templates | done | P2 |
| E46-45 | Continuity plan sections | done | P3 |
| E46-46 | Continuity samples before setup | done | P3 |
| E46-47 | Default roles that do their job | done | P2 |
| E46-48 | A usable Executive viewer | done | P2 |
| E46-49 | An organization-wide Board summary | done | P2 |
| E46-50 | Report a problem for everyone | done | P2 |
| E46-51 | Links attached in a data load are undone with the load | done | P3 |
| E46-52 | Feature switches apply at once to work outside a request | done | P2 |
| E46-53 | Risk appetite change through an approval workflow | done | P3 |
| E46-54 | The standard report gauge "Change success rate" counts caused incidents | done | P3 |
| E46-55 | Funder review readiness counts earlier deficiencies and overdue award obligations | done | P3 |
| E46-56 | OCR languages chosen in Administration | done | P3 |
| E46-57 | A copy number printed on an issued paper copy | done | P3 |
| E46-58 | Fiscal-year quarters for measures, statistics and the matrix | done | P3 |
| E46-59 | Measures from statistics series | done | P3 |
| E46-60 | A dashboard widget for one measure | done | P3 |
| E46-61 | Complaint time limits in working days and several bases per complaint | done | P3 |
| E46-62 | Insurance claim payments one by one | done | P3 |
| E46-63 | A contract page shows its insurance requirements | done | P3 |
| E46-64 | Premium allocation and a property schedule of values | done | P3 |
| E46-65 | Asking vendors for certificates of insurance by email | done | P3 |
| E46-66 | Invoices and payments against purchase orders | done | P3 |
| E46-67 | Budget amendments kept as versions | done | P3 |
| E46-68 | Safety indicators on the Board summary | done | P3 |
| E46-69 | A warning when a switched-off role is assigned | done | P3 |
| E46-70 | My certifications for employees | done | P3 |
| E46-71 | Planned maintenance intervals and mileage history | done | P3 |
| E46-72 | Filter certifications by position or department | done | P3 |
| E46-73 | Sample defects and sample vendor names follow the sample-data rules | done | P3 |
| E46-74 | Reminder settings of a switched-off area are not shown | done | P2 |

## Procurement and budgets

### E46-01 Procurement area and feature switch

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/procurement/index.ts`, `server/src/core/features.ts` (area `procurement`), `server/src/core/services.ts`, `server/src/modules/admin/shared.ts`, `web/src/modules/procurement/index.tsx`.

Area **Procurement and budgets** (on by default, independent of vendors), permission module
`procurement`, a default role **Procurement officer** (off as installed) and read grants for the
Approver (with `procurement.approve`), Auditor, Compliance officer, Project manager, Asset manager and
Executive viewer. One menu entry, Vendors > Procurement, with Purchase orders, Budgets and Settings tabs.

### E46-02 Solicitations

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/procurement/solicitations.ts`, `lists.ts`, `work.ts` (clause set `procurement_clauses`), `web/src/modules/procurement/Solicitations.tsx`.

A solicitation (`PRC-`) has a method from an administrator list (the organization's own limit per method,
evaluation by score or price, written justification), an estimate and independent cost estimate, the
funding award, requesting department, buyer, schedule, solicitation document, addenda, the required
clauses checklist (clause engine, administrator template) and a protests log.

### E46-03 Offers and evaluation

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/procurement/evaluation.ts`, `solicitations.ts`, `web/src/modules/procurement/Evaluate.tsx` (tests `procurement/procurement.test.ts`).

Offers from vendors or plain names, weighted criteria (a standard template in settings), an evaluation
committee with conflict-of-interest declarations, each member scoring from their own page
(`/api/procurement/my-evaluations*`) without a procurement role, and a ranked result. Until the award,
offers and scores are readable only by `procurement.edit` holders and the committee (row rule); counts
stay the same for everyone.

### E46-04 Award and the resulting contract

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/procurement/evaluation.ts`.

The award records who decided, when, why and the amount; the other offers are marked not selected; a
draft contract is made or an existing one linked, both ways (`resulted_in`).

### E46-05 Purchase orders

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/procurement/orders.ts`, `web/src/modules/procurement/Orders.tsx` (test `procurement/orders.test.ts`).

Purchase orders (`PO-`) with lines on budget lines and assets, a total, a status the application sets
(draft, awaiting approval, approved, issued, partly received, received, closed, canceled), approval
through the approval kind `purchase_order_approval` or by a holder of `procurement.approve` (never the
requester), issue, receiving with who received, close, cancel and a budget check.

### E46-06 Budgets

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/procurement/budgets.ts`, `web/src/modules/procurement/Budgets.tsx`.

Budgets (`BUD-`) by fiscal year with operating and capital lines (`BL-`: department, account, amount,
project for capital lines, funding award); committed and spent come from purchase orders, with what
remains and the share used.

### E46-07 Procurement in My work, calendars, metrics and the Overview

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/procurement/work.ts`, `web/src/modules/procurement/HomeWidget.tsx`, `web/src/modules/home/registry.ts`.

Calendar sources `procurement.offers_due`, `procurement.evaluations` (named: committee members need no
procurement role) and `procurement.order_approvals`; metrics `procurement.open_solicitations`,
`procurement.orders_awaiting_approval` and `procurement.budget_used_pct`; the Overview panel **Procurement**.

### E46-08 Procurement in data load mode

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/procurement/` (tests in `procurement.test.ts`, `orders.test.ts`).

Past solicitations, offers, scores and declarations in the evaluator's name, awards and purchase orders
load with their dates, statuses, references and received quantities.

## Insurance

### E46-09 Insurance area and policies

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/insurance/index.ts`, `policies.ts`, `lists.ts`, `server/src/core/features.ts` (area `insurance`), `server/src/core/services.ts`, `web/src/modules/insurance/`.

Insurance policies (line, carrier or pool as a vendor or a name, number, term, premium, limits,
deductible, retention, sublimits, named insureds, owner, department) under Risk and compliance >
Insurance with tabs Policies, Certificates, Claims, Renewals, Contract requirements and Settings; a role
**Risk and insurance coordinator** (off as installed).

### E46-10 Policy conditions tracked by controls

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/insurance/policies.ts`.

A policy's conditions (`insurance_condition`) link to controls; the policy shows each control's latest
rating or "Test overdue", and conditions due appear in My work.

### E46-11 Records a policy covers

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/insurance/policies.ts`, `web/src/modules/insurance/InventoryPanel.tsx`.

Assets, vehicles, sites and systems a policy covers; an Insurance panel on those records
(`GET /api/insurance/covering`).

### E46-12 Insurance renewals

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/insurance/policies.ts`, `reminders.ts`, `settings.ts`.

Renewal status and the application due date; **Renew** starts the next term (copying conditions and
covered records), and the old term becomes Renewed when the new one is in force; reminders at 90, 60 and
30 days and at 14, 3 and 0 days (Administration > Reminders); a renewal calendar.

### E46-13 Certificates of insurance against contract requirements

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/insurance/certificates.ts`, `reminders.ts`.

Requirements per contract and line (minimums, additional insured, waiver); each certificate is checked
(meets, short with reasons, expired, none) and each requirement (met, shortfall, certificate expired, no
certificate); a newer certificate supersedes an older one; expiry reminders and a daily recheck
(job `insurance.daily`).

### E46-14 Insurance claims

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/insurance/claims.ts`.

Claims are restricted per claim (personal kinds and claims about security incidents start restricted;
only a holder of `security.view` lifts it), with reserves, paid and recovered amounts, links to a safety
event, security incident, asset, vehicle or site, and the date closed.

### E46-15 Insurance figures, metrics and data load

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/insurance/figures.ts` (test `insurance/insurance.test.ts`).

Summary tiles the same for everyone; metrics `insurance.policies_expiring`, `insurance.certificates_expired`,
`insurance.open_claims` and `insurance.open_reserves`; past policies, claims and certificates load with
their dates and statuses, nothing worked out from today.

### E46-16 Register templates

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/registers/templates.ts` (test `registers/templates.test.ts`), `web/src/modules/registers/Templates.tsx`, `Admin.tsx`.

Administration > Registers > **Start from a template**: "Labor agreements" (`LA-`) and "Real property"
(`RP-`) with their fields; created only on request, a second one under other names; the dev seed makes
both with sample records. The dialog is not yet covered by a browser test.

## Civil rights

### E46-17 Civil rights area and programs

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/civilrights/programs.ts`, `children.ts`, `lists.ts`, `server/src/core/features.ts` (area `civilrights`, off by default), `web/src/modules/civilrights/Programs.tsx`.

Programs (owner, program document, board decision, update cycle, next update due) made from templates
(elements and reports copied in), required elements with evidence from the library (evidence part
`element`), public notice locations and language assistance items; a role **Civil rights officer** (off
as installed). The area starts off: an organization chooses to keep confidential complaints here.

### E46-18 Civil rights monitoring reports

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/civilrights/programs.ts`, `summary.ts`, `web/src/modules/civilrights/Reports.tsx`.

Reports with due dates, repeating reports, a submission log with who sent each one, owner reminders and
My work (calendar source `civilrights.reports`).

### E46-19 Civil rights complaints

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/civilrights/complaints.ts`, `settings.ts`, `web/src/modules/civilrights/Complaints.tsx` (test `civilrights/civilrights.test.ts`).

Intake (channel, complainant or anonymous, basis, program, route or service, vehicle, site, employee),
acknowledgment, investigation and appeal time limits set by the organization with the next due date and
overdue state, steps and letters, findings, outcome and appeal; the investigator's My work, calendar and
reminders; personal fields are anonymized by retention.

### E46-20 Confidential complaints

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/civilrights/complaints.ts`.

A confidential complaint is readable only by the named complaint handlers (naming one needs a recent
password), its investigator and its creator; counts stay the same for everyone; only handlers and
administrators change confidentiality.

### E46-21 Business participation goals

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/civilrights/participation.ts`, `web/src/modules/civilrights/Participation.tsx`.

A goal per period, awards with participating firms (a vendor or a name, certified, amount), attainment
and shortfall, good-faith notes and a periodic report as CSV (formula guard); metric
`civilrights.goal_attainment_pct`.

### E46-22 Civil rights figures

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/civilrights/summary.ts`, `web/src/modules/civilrights/widgets.tsx`, `web/src/modules/home/registry.ts`.

A summary route, metrics `civilrights.complaints_open`, `civilrights.complaints_overdue` and
`civilrights.goal_attainment_pct`, and the Overview panel **Civil rights**.

### E46-23 Civil rights in data load mode

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/civilrights/` (test `civilrights/actors-load.test.ts`).

Past complaints load with their dates, statuses, references and named people; steps, letters and
submissions record `actorOf(req)`; template copying is skipped in a load.

## Strategy and performance

### E46-24 Strategic plan register

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/strategy/records.ts`, migration `001_strategy.sql`, `web/src/modules/strategy/Plans.tsx`.

Plans (`SP-`; period, adoption with the board decision and the controlled document), goals, objectives
(`OBJ-`) and initiatives (`INI-`) linked to projects, budget lines and actions; every part is a record
type (reports, dashboards, imports, MCP, data load).

### E46-25 Strategic measures

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/strategy/service.ts`, `periods.ts`, `reminders.ts`, `web/src/modules/strategy/Measures.tsx`.

Measures (`KPI-`) with unit, direction, tolerance, frequency, baseline, and targets and actuals per
period with who and when, compared with the target; values entered by hand, from a metric or from a
figure over time, pulled daily (`strategy.measure_pull`) or on demand.

### E46-26 Quarterly status updates and the action-item matrix

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/strategy/service.ts`, `web/src/modules/strategy/Matrix.tsx`, `UpdateDialog.tsx`.

On track, at risk or off track with a narrative, by whom and when, per objective and initiative; the
objective by quarter matrix with "+" to report a missing quarter; the subject's status follows the
latest update.

### E46-27 Plan scorecard and board PDF

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/strategy/pdf.ts`, `routes.ts`, `web/src/modules/strategy/Scorecard.tsx`.

The scorecard page and `GET /api/strategy/plans/:id/scorecard.pdf` (PdfBuilder, PDF/UA, branding, audited).

### E46-28 Measures in dashboards and report packs

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/strategy/seed.ts`, `metrics.ts`, `web/src/modules/strategy/HomeWidget.tsx`.

The standard report "Strategic plan measures" and the dashboard "Strategy and performance" in every
profile; metrics `strategy.objectives_off_track`, `strategy.objectives_at_risk`,
`strategy.submissions_overdue` and `strategy.measures_met_pct`; the Overview panel **Strategy and performance**.

### E46-29 Operating statistics

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/strategy/records.ts`, `web/src/modules/strategy/Statistics.tsx`.

Series an administrator defines (unit, frequency, breakdowns), values per period and breakdown with who
and when, CSV and Excel import through the core importer, and charts.

### E46-30 Statistical submissions log

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/strategy/reminders.ts`, `settings.ts`, `web/src/modules/strategy/Submissions.tsx`.

Report, recipient, period, due date, preparer, status, submitted on and by, confirmation and files
(evidence); reminders (`strategy.submission_reminder_days`) and the calendar source `strategy.submissions`.

### E46-31 Strategy area and role

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/core/features.ts` (area `strategy`), `server/src/core/services.ts` (tests `strategy/access.test.ts`).

Area **Strategy and performance**, role **Strategy and performance analyst** (off as installed), and the
Executive viewer reads it.

## Safety, inspections, fleet and continuity

### E46-32 Safety indicator list shows where each stands

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/safety/indicators.ts`, `web/src/modules/safety/Indicators.tsx`.

Latest (latest complete month), against target, a 12-month sparkline and trend word, and off and on
target tiles (`GET /api/safety/indicator-status`).

### E46-33 Hazard log flags

**Status:** done · **Priority:** P3 · **Implemented in:** `web/src/modules/safety/Hazards.tsx`.

Owner and review columns flag "No owner", "No review date" and overdue reviews; quick views Past review
and No owner; the rating stays on narrow screens.

### E46-34 Safety plan tab

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/safety/plan.ts` (test `safety/plan-status.test.ts`), `web/src/modules/safety/Plan.tsx`.

The plan or plans chosen as the safety plan (setting `safety.plan_ids`, `GET/PUT /api/safety/plans`), with
the version, next annual review, last review outcome, running review progress and element map counts.

### E46-35 Inspection and defect tiles on the safety dashboard

**Status:** done · **Priority:** P3 · **Implemented in:** `web/src/modules/safety/Dashboard.tsx`, `server/src/modules/audits/missed.ts`.

Overdue and missed inspections, schedules behind, open defects and vehicles out of service
(`GET /api/inspections/attention`).

### E46-36 Defects

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/audits/defects.ts`, migration `004_defects_missed_inspections.sql` (test `audits/defects.test.ts`), `web/src/modules/audits/Defects.tsx`.

Record type `defect` (`DEF-`) on vehicles, sites and assets, raised from the checks not met when an
inspection completes; open, deferred or repair ordered, repaired, verified by another person; an
out-of-service defect cannot be deferred and marks the vehicle out of service; My work for the owner
(calendar source `audits.defects`).

### E46-37 Inspections and defects on vehicle, site and asset pages

**Status:** done · **Priority:** P2 · **Implemented in:** `web/src/modules/audits/InventoryPanel.tsx`, `server/src/modules/audits/defects.ts`.

A panel with the out-of-service state, open defects, New defect and the inspections
(`GET /api/inspection-history/:type/:id`). The fleet guide no longer says vehicle pages lack inspections.

### E46-38 Missed inspection follow-up

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/audits/missed.ts`, `resources.ts`, `web/src/modules/audits/Inspections.tsx`.

Record why an inspection was missed, reschedule it as a new inspection (the missed one is kept for
on-time figures) or raise a follow-up action; missed inspections not followed up are in My work
(calendar source `audits.missed_inspections`).

### E46-39 The inspection list opens on due and overdue

**Status:** done · **Priority:** P3 · **Implemented in:** `web/src/modules/audits/Inspections.tsx`.

Soonest first, with Overdue, Missed and All views and a follow-up notice.

### E46-40 Governed vehicle retirement

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/fleet/retirement.ts`, migration `005_vehicle_retirement.sql` (test `fleet/retirement.test.ts`), `web/src/modules/fleet/Retirement.tsx`, `server/src/core/features.ts` (option `funder_interest`).

**Retire** asks for approval (approval kind `vehicle_retirement`, with a funder step), the Retirement tab,
and **Mark as retired** with date, method, proceeds and the funder's reference (hidden with the funder
interest option); a person cannot set Retired any other way (409 `retirement_not_approved`); a data load may.

### E46-41 The vehicle list shows condition, end of useful life and odometer

**Status:** done · **Priority:** P3 · **Implemented in:** `web/src/modules/fleet/Vehicles.tsx`.

### E46-42 The certification list is sorted by expiry with days left

**Status:** done · **Priority:** P3 · **Implemented in:** `web/src/modules/training/Qualifications.tsx`.

Person, certification, expiry with days left (red when expired, amber within 60 days) and status,
soonest expiry first.

### E46-43 The "No asset class" tile opens the unclassed assets

**Status:** done · **Priority:** P3 · **Implemented in:** `web/src/modules/condition/Dashboard.tsx`.

### E46-44 Continuity plan templates

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/continuity/templates.ts`, migration `006_plan_templates.sql` (test `continuity/templates.test.ts`), `web/src/modules/continuity/Plans.tsx`.

Four generic templates; a new plan starts from one (`template_key`) with sections and a starter checklist.

### E46-45 Continuity plan sections

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/continuity/plans.ts`, `web/src/modules/continuity/Plans.tsx`.

A plan `body` and a **Plan sections** tab.

### E46-46 Continuity samples before setup

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/continuity/seed.ts`.

The dev seed loads the continuity samples before the first administrator exists.

## Roles, home pages and reporting

### E46-47 Default roles that do their job

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/core/services.ts`.

Continuity managers run exercises (`exercises.*`); asset managers open and run inspections and see safety
events; safety managers record certifications and training and run emergency activations; audit leads,
compliance officers, training coordinators and project managers get the read access their work needs.
Existing installations take them with "Sync default grants".

### E46-48 A usable Executive viewer

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/core/services.ts`, `web/src/modules/home/widgetsAreaLeads.tsx`.

Read access to safety, fleet, asset condition, inspections, continuity, risks, funding, projects,
strategy, procurement and actions (still off as installed); a description that names only the areas
that are on; the Overview shows the Board summary and area widgets first.

### E46-49 An organization-wide Board summary

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/reports/standard.ts`, `seed.ts` (test `reports/board-summary.test.ts`).

Safety first, then operations, then service, risk and technology; an unedited earlier board is upgraded
at start (audited).

### E46-50 Report a problem for everyone

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/work/report.ts`, `server/src/modules/safety/portal-intake.ts`, `web/src/modules/mywork/ReportProblem.tsx`.

My work > **Report a problem**: a safety hazard or concern (the portal's intake and confidential rules)
or a request for help (a ticket), even with the portal off and with no role; **My reports** lists them.

### E46-51 Links attached in a data load are undone with the load

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/attachments/links.ts`, `server/src/modules/mcp/tools-files.ts`.

Links attached in a load are listed with the load's files in `data_load_records` and keep `created_at`;
`attach_link` takes `created_at` in a load (left open by E45-52).

### E46-52 Feature switches apply at once to work outside a request

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/core/features.ts` (`onFeatureState`, `refreshFeatures`), `server/src/core/services.ts` (test `core/features-refresh.test.ts`).

After an area was switched on, the fields of record types that refer to it were rebuilt only by the next
API request, so background work and system saves before it (a seed run, a job) still dropped those
fields. Writing the `features` or `feature_options` setting now reads the state again at once and
rebuilds the record types before the write returns.

## Done in wave 27

Wave 27 finished every issue that was open here; none is left.

### E46-53 Risk appetite change through an approval workflow

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/risks/appetite-requests.ts`, `server/src/modules/risks/enterprise.ts`, migration `risks/011_appetite_change_requests.sql`, `web/src/modules/risks/Appetite.tsx`, `web/src/modules/risks/AppetiteChange.tsx` (test `risks/appetite-workflow.test.ts`).

A change of a category's appetite can be sent for approval (record type `risk_appetite_change`, `RAC-`;
approval kind and default "Risk appetite change" workflow, one step, `risks.approve`, never the person
who asked). Approval records the next version with the approver, the date, the workflow as body and the
request as reference; reject or withdraw keep the appetite; a version recorded directly supersedes a
waiting request; an approval given elsewhere can still be recorded directly. Data load takes past
requests with their outcome. The status is set by the application (`core/lifecycle.ts`).

### E46-54 The standard report gauge "Change success rate" counts caused incidents

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/reports/widget-sources.ts`, `server/src/modules/reports/standard.ts`, `server/src/modules/reports/seed.ts` (test `reports/widget-sources.test.ts`).

The IT leadership overview's gauge reads the changes module's success rate (the dashboard's dates, or 90
days), the same figure as the Overview widget; an unedited earlier gauge is upgraded at start (audited).

### E46-55 Funder review readiness counts earlier deficiencies and overdue award obligations

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/funding/package.ts`, `web/src/modules/funding/Readiness.tsx` (test `funding/package.test.ts`).

Readiness counts the previous review's open deficiencies (per area, plus one check for areas the new
review lacks) and the obligations of the awards under review (one check each, unmet while overdue). The
previous review is the one it was carried forward from, else the latest earlier review of the same
funder. The package index PDF lists both.

### E46-56 OCR languages chosen in Administration

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/attachments/ocr.ts`, `server/src/modules/attachments/ocr-admin.ts`, `server/src/modules/attachments/text.ts`, `server/src/modules/attachments/tessdata/spa.traineddata.gz`, `web/src/modules/attachments/OcrSettings.tsx` (test `attachments/ocr.test.ts`).

Administration > File settings > Reading scans chooses up to four languages from the language files
present (English and Spanish bundled from tessdata_fast, Apache-2.0; others through `GRC_OCR_LANG_DIR`;
nothing is downloaded). The setting `attachments.ocr_languages` (audited) applies from the reader's next
run; saving puts unread scans back in the queue and, on request, the scans already read by OCR (audited
`attachments.ocr_requeue`). `GRC_OCR_LANGS` applies until a choice is saved.

### E46-57 A copy number printed on an issued paper copy

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/policies/print.ts`, `server/src/core/export/pdf.ts` (`pageLine`), `web/src/modules/policies/documents/Copies.tsx` (tests `policies/copies.test.ts`, `policies/convert/convert.test.ts`).

**Print** on a copy in the register gives `GET /api/policies/:id/copies/:cid/pdf`: the copy's version with
"Controlled copy N · holder (place)" on every page and "Controlled copy N, issued to ... on ..." in the
control block instead of "Uncontrolled when printed"; a PDF original is stamped with them;
`policies.edit`; audited `policy.copy_print`; 409 for a recalled copy or one of a version no longer in
force.

### E46-58 Fiscal-year quarters for measures, statistics and the matrix

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/strategy/periods.ts`, `settings.ts`, `service.ts`, `records.ts`, migration `strategy/002_fiscal_and_series.sql`, `web/src/modules/strategy/Settings.tsx`, `Matrix.tsx` (test `strategy/fiscal.test.ts`).

Strategy > Settings > Fiscal year sets the month the year starts and whether it is named after the year
it ends or starts in. Quarters and years of measure values, statistics, status updates, the matrix and
the board PDF follow it (`FY2027-Q1` and `FY2027` keys and labels, the months shown under each column);
calendar periods entered before keep their meaning and show in the fiscal column their quarter ends in;
the same days under either kind of year are one period; the setting cannot change while fiscal periods
are in use.

### E46-59 Measures from statistics series

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/strategy/service.ts` (`seriesFigure`, `followSeries`), `records.ts`, `routes.ts`, `web/src/modules/strategy/Plans.tsx` (test `strategy/fiscal.test.ts`).

Data source "Statistics series": the series (same or finer frequency), a breakdown or the total (the
total row, else the breakdowns added up) and the aggregation (sum, average, latest, lowest, highest).
Every period with series values is filled on save and the actual follows each value entered, changed or
deleted; on demand and by the daily job, like metrics.

### E46-60 A dashboard widget for one measure

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/strategy/widget.ts`, `web/src/modules/strategy/MeasureWidget.tsx`, `server/src/modules/reports/widgets.ts`, `reports/documents.ts`, `web/src/modules/reports/Widget.tsx`, `WidgetEditor.tsx`, `offTypes.ts`.

Widget kind `measure` ("Strategic measure"): the measure and 4 to 12 periods; the latest actual against
that period's target and how it compares, with a chart of targets and actuals. Worked out as the viewer
(without `strategy.view`: "Your role does not include this information"); not offered, and left out of
dashboards, while the area is off; a table and a one-line summary in print, PDF and deliveries.

### E46-61 Complaint time limits in working days and several bases per complaint

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/civilrights/settings.ts`, `complaints.ts`, migration `civilrights/002_complaint_bases.sql`, `web/src/modules/civilrights/Settings.tsx`, `Complaints.tsx`, `server/src/core/resource.ts` (list filter on a built-in field with several values) (test `civilrights/limits-bases.test.ts`).

Each limit (acknowledge, investigate, appeal) counts calendar or working days on the organization's
working calendar (core `dueAfter`, the calendar records requests use: open weekdays less holidays); the
settings page names the calendar; the clock shows working days left. A complaint has `bases` (several,
your own list), with `basis` kept as the first for grouping and older clients; the migration fills
`bases`; the list's **Bases** filter finds a complaint by any of them.

### E46-62 Insurance claim payments one by one

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/insurance/payments.ts`, `claims.ts`, migration `insurance/002_payments_allocation_schedule_requests.sql`, `web/src/modules/insurance/Payments.tsx` (test `insurance/wave27.test.ts`).

Record type `insurance_claim_payment` (date, kind from `insurance_payment_kind`, whose values say
whether money comes back, payee, amount, reference, note, recorded by the person or the one a load
names), restricted with its claim. A claim's Paid to date and Recovered are worked out (read-only) and
shown with the net cost on its Payments tab; existing totals and totals given in a load become opening
rows.

### E46-63 A contract page shows its insurance requirements

**Status:** done · **Priority:** P3 · **Implemented in:** `web/src/modules/insurance/ContractInsurance.tsx`, `web/src/modules/vendors/ContractPages.tsx`, `server/src/modules/insurance/certificates.ts` (test `insurance/wave27.test.ts`).

An **Insurance** tab on the contract (insurance on and `insurance.view`): requirements with their state,
certificates with their check, requests to the vendor, and Add requirement, Add certificate and Ask for
certificates.

### E46-64 Premium allocation and a property schedule of values

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/insurance/allocation.ts`, `schedule.ts`, `web/src/modules/insurance/Allocation.tsx`, `Schedule.tsx` (test `insurance/wave27.test.ts`).

Premium shares per department, site, asset or vehicle, split equally, by a measure, by insured value or
by hand, in cents adding up to the premium, recomputed on any change and copied on Renew; a Premium
allocation page (by department, site, asset or vehicle and line, CSV, the same for everyone). The
schedule of values (`SOV-`) with values, total insured value, valuation basis and date, summary tiles
with valuation due, list export and "Add covered records".

### E46-65 Asking vendors for certificates of insurance by email

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/insurance/requests.ts`, `web/src/modules/insurance/Requests.tsx`, `CertificateUpload.tsx`, `server/src/modules/notifications/reminder-settings.ts` (test `insurance/wave27.test.ts`).

Certificate requests (`CIR-`) are emailed through the configured mail server with a personal upload link
(the secret in the address fragment, sent in a header; a hash kept, the secret sealed for reminders);
reminders before the link expires carry the same link (setting `insurance.certificate_request_reminder_days`,
7 and 2 days, also under Administration > Reminders); Send again, Send a reminder and Cancel; the
vendor's public page (`/certificate-upload`) sends each certificate's file and details, which land as
"Sent by the vendor, to review" with the file as evidence and the owner told. Switched off as installed
(switching on needs a recent password), rate limited, nothing sent in data load mode.

### E46-66 Invoices and payments against purchase orders

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/procurement/invoices.ts`, `budgets.ts`, `orders.ts`, `work.ts`, `settings.ts`, migration `procurement/002_invoices_and_budget_versions.sql`, `web/src/modules/procurement/Invoices.tsx`, `server/src/core/lifecycle.ts`, `server/src/modules/evidence/links.ts` (tests `procurement/invoices.test.ts`, `orders.test.ts`).

Vendor invoices (`INV-`) against issued orders, with lines (a quantity at the order price, or an amount)
against order lines; a duplicate invoice number per vendor is refused; a three-way match with the order
price and what was received (other submitted invoices counted, a tolerance setting, matched again on
receipts); approval (workflow kind `purchase_invoice_approval`, or `procurement.approve`, never the
person who entered it; a written reason to approve one that does not match); payment (date, reference,
method, who recorded it); void. Spent on budgets is paid invoices, committed is committing orders not yet
paid. An Overview tile, My work, the calendar source "Invoices due for payment", the Evidence tab, and a
data load of past invoices.

### E46-67 Budget amendments kept as versions

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/procurement/versions.ts`, `budgets.ts`, `web/src/modules/procurement/Budgets.tsx` (test `procurement/versions.test.ts`).

Record type `budget_version`: the adoption (version 0) and each amendment with dates, approval or board
decision (optionally a committee decision), document, reason and line changes (new amounts, changes, new
lines). Lines always hold the latest version and are locked after adoption; a Versions tab shows every
line in every version; a version's page shows before and after; only the latest can be removed, which
restores the lines; data load takes past adoptions and amendments (undo restores).

### E46-68 Safety indicators on the Board summary

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/reports/widget-sources.ts`, `standard.ts`, `seed.ts`, `server/src/modules/safety/indicators.ts` (`safetyIndicatorStatus`) (tests `reports/widget-sources.test.ts`, `reports/board-summary.test.ts`).

A number ("N safety performance indicators missed their target in the latest complete month") and a
table with a line per active indicator shown on the safety dashboard; hidden while safety is off; needs
`safety.view`; unedited wave 26 boards are upgraded.

### E46-69 A warning when a switched-off role is assigned

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/admin/users.ts`, `providers.ts`, `server/src/modules/integrations/scim-admin.ts`, `web/src/modules/admin/UserDetail.tsx`, `Users.tsx`, `ProviderEditor.tsx`, `web/src/modules/integrations/Provisioning.tsx` (tests `admin/disabled-role.test.ts`, `integrations/scim.test.ts`).

Creating or changing a user, saving a sign-in provider's role mapping and mapping a provisioned group to
roles answer `warnings` naming roles that give no access (switched off under Roles, or of a switched-off
area); the user's Roles card, the mapping rules and the group mapping dialog say so.

### E46-70 My certifications for employees

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/training/qualifications.ts`, `due.ts`, `index.ts`, `web/src/modules/training/MyTraining.tsx`, `web/src/modules/home/widgetsMyWork.tsx`, `web/src/modules/mywork/MyWorkPage.tsx` (test `training/my-certifications.test.ts`).

Every employee on the roster sees their own certifications, their state (in date, expiring within 30
days, expired, renewed, not active), expiry and days left, and the certifications their position still
needs, on My work > Training and on a "My certifications" card of My work and the Overview (not counted
as waiting). Renewals due are in My due work for people without training permissions too (named
calendar source `training.my_certifications`), and so in the mobile app. A certification renewed by a
later one no longer stays in My work and the calendar.

### E46-71 Planned maintenance intervals and mileage history

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/fleet/maintenance.ts`, migration `fleet/006_maintenance.sql`, `seed-maintenance.ts`, `web/src/modules/fleet/Maintenance.tsx` (test `fleet/maintenance.test.ts`).

Intervals (`maintenance_interval`, `PMI-`) by miles, engine hours and/or days per vehicle model or asset
class, with a planner and due-soon warnings; readings (`vehicle_reading`, `RDG-`: odometer and hours,
never backwards, the vehicle's odometer is the latest, an odometer changed on the vehicle adds one);
services done (`maintenance_record`, `PMR-`, with a work order number; their odometer and hours are a
reading). Next due from the latest service (or from zero and the in-service date), the first of miles,
hours or days reached, and an expected date from the rate over the last year; Fleet > Planned
maintenance (Due, Intervals, Services done, Readings), the vehicle's Maintenance tab, the model's
Maintenance intervals tab, My work and the calendar (`fleet.maintenance`). All three work in data load
mode and import. Out of scope (stated in the guide): work orders, labor and parts; planned maintenance of
assets and facilities (E32-06).

### E46-72 Filter certifications by position or department

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/training/qualifications.ts`, migration `training/006_certification_roster.sql`, `web/src/modules/training/Qualifications.tsx` (test `training/my-certifications.test.ts`).

Certifications carry the holder's position and department (read-only, copied from the roster, following
the person); the certification list filters, groups, exports and shows them; the Expiring view filters
by position or department and shows the department.

### E46-73 Sample defects and sample vendor names follow the sample-data rules

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/audits/seed.ts` (test `audits/seed.test.ts`), `server/src/modules/vendors/seed.ts`, `seed-lifecycle.ts`, `server/src/modules/continuity/seed.ts`.

Defects raised by the dev seed's failed inspections took the checklist prompt as title without the
"[Sample]" mark; they now carry it. Sample vendor names use American spelling ("Harbor").

### E46-74 Reminder settings of a switched-off area are not shown

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/notifications/reminder-settings.ts` (test `notifications/reminder-settings.test.ts`), `tools/e2e/suites/09-features-off.mjs`.

Administration > Reminders listed the settings of every loaded module, including areas switched off
under Features. It now lists, and accepts, only those whose record type's area is on. The features-off
browser suite reads that answer too, and knows the wave 27 words and references (planned maintenance,
schedule of values, certificate requests, budget versions, `RAC-`, `CIR-`, `SOV-`, `PMI-`, `RDG-`, `PMR-`). It found, and wave 27 fixed, insurance field help and route descriptions that named vehicles while
fleet was off (now neutral), and the Planned maintenance page asking for the sites list from a role without
`sites.view` (the depot filter is shown only with it).
