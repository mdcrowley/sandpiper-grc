# E45 Product gaps found in the wave 24 review

**Status:** done (67 of 67 issues done)

## Goal

Close the gaps that the wave 24 persona reviews (IT, governance, risk and compliance, operations)
found when the application was used the way a transit organization's staff work. Enterprise risk
stands on its own beside cybersecurity. Evidence is filed once and reused. Funder reviews connect to
the awards, controls and evidence they cover. Internal audit has a risk-ranked plan, workpapers and
verification of fixes. Committees get a board book, structured minutes and motions with votes. The
service desk, vulnerability, framework, system and vendor screens join up the IT workflows. An AI
assistant can build complete records. Wave 25 built most of the issues marked done; wave 26 built E45-53 to
E45-60 and E45-62 to E45-67, and wave 27 E45-61.

## Scope notes

- Nothing names a real organization, place, vendor or person; no single jurisdiction's law is a
  built-in default; samples are invented and loaded only by the dev seed.
- Restriction hides detail, never counts: figures stay the same for everyone (restricted risks and
  evidence, and closed-session decisions, are counted but not named).
- A switched-off area (for example the new **Evidence library**) shows nowhere except
  Administration > Features.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E45-01 | Enterprise risk apart from security incidents | done | P1 |
| E45-02 | Enterprise risk scale and fields by category | done | P2 |
| E45-03 | Target risk | done | P2 |
| E45-04 | Versioned risk appetite | done | P2 |
| E45-05 | Heat map, tiles and report agree | done | P2 |
| E45-06 | Evidence library | done | P1 |
| E45-07 | Evidence expiry | done | P2 |
| E45-08 | Evidence tab on every evidence-bearing record | done | P2 |
| E45-09 | Funders as records | done | P2 |
| E45-10 | Connected funder reviews | done | P2 |
| E45-11 | Carry a funder review forward | done | P2 |
| E45-12 | Review area templates | done | P2 |
| E45-13 | Risk-ranked audit plan | done | P2 |
| E45-14 | Approved annual audit plan | done | P2 |
| E45-15 | Workpapers | done | P2 |
| E45-16 | Finding closure needs the auditor's verification | done | P1 |
| E45-17 | Control tests in an audit | done | P2 |
| E45-18 | A corrective action plan from an audit finding closes only after the finding's verification | done | P2 |
| E45-19 | Locked workpaper steps keep their evidence links | done | P2 |
| E45-20 | Agenda items with papers, presenters, time and sessions | done | P2 |
| E45-21 | Closed-session items for members only | done | P2 |
| E45-22 | Structured minutes per agenda item | done | P2 |
| E45-23 | Motions, votes and resolution numbers | done | P2 |
| E45-24 | Minutes approved at the next meeting and published | done | P2 |
| E45-25 | Board book PDF | done | P2 |
| E45-26 | Member reading view | done | P2 |
| E45-27 | Load past meetings, minutes, motions and votes | done | P2 |
| E45-28 | Raise a security incident from a ticket | done | P2 |
| E45-29 | Raise a change from a ticket | done | P2 |
| E45-30 | Link a ticket to a problem or create the problem from it | done | P2 |
| E45-31 | Mark a ticket as a duplicate | done | P2 |
| E45-32 | Link tickets from the problem | done | P2 |
| E45-33 | Starter questions and fulfillment tasks on the built-in catalog | done | P2 |
| E45-34 | Security incident next-stage button | done | P2 |
| E45-35 | Access reviews start from the import | done | P2 |
| E45-36 | Findings grouped by identifier | done | P2 |
| E45-37 | Raise a change from findings | done | P2 |
| E45-38 | Urgency order and exposure | done | P2 |
| E45-39 | Known-exploited catalog from a file | done | P2 |
| E45-40 | Vulnerabilities by age widget | done | P2 |
| E45-41 | Send outcomes that need work to owners | done | P2 |
| E45-42 | System version, end of support and annual cost | done | P2 |
| E45-43 | Spend on contract and vendor lists | done | P2 |
| E45-44 | Change success rate | done | P2 |
| E45-45 | IT leadership widgets on home and the IT leadership overview tiles | done | P2 |
| E45-46 | MCP values resolved by reference, name, email and label | done | P2 |
| E45-47 | Files and links on any record through MCP | done | P2 |
| E45-48 | Related types and field help in list_record_types | done | P2 |
| E45-49 | Completeness hints after a save | done | P2 |
| E45-50 | Completeness guidance and prompt | done | P2 |
| E45-51 | A chunked upload attached as someone records the named person | done | P2 |
| E45-52 | Attachments added in data load mode keep their date and are undone with the load | done | P2 |
| E45-53 | Audits: inspection inspector and finding owner defaults follow the named person | done | P3 |
| E45-54 | Evidence `created_by` follows the named person | done | P3 |
| E45-55 | Loaded times for checklist ticks | done | P3 |
| E45-56 | Appetite change through an approval workflow or committee decision | done | P3 |
| E45-57 | Risk restriction per category form and further risk fields | done | P3 |
| E45-58 | Funder review readiness view and package export | done | P3 |
| E45-59 | Outside reviewer sees library evidence linked to the review | done | P3 |
| E45-60 | Recused votes and conflict-of-interest declarations | done | P3 |
| E45-61 | Merge the structure of tagged PDF papers into the board book | done | P3 |
| E45-62 | Agenda posting deadline per committee and annual work plan | done | P3 |
| E45-63 | Workpaper reference numbering and time budget | done | P3 |
| E45-64 | Audit plan approval through a committee decision | done | P3 |
| E45-65 | MCP tool to link evidence | done | P3 |
| E45-66 | Change-to-incident link so "caused an incident" counts against change success | done | P3 |
| E45-67 | Members' committee meetings in calendar feeds | done | P3 |

## Enterprise risk

### E45-01 Enterprise risk apart from security incidents

**Status:** done · **Priority:** P1 · **Implemented in:** `server/src/modules/risks/index.ts`, `masking.ts`, migration `009_enterprise_risk_standalone.sql`, `server/src/core/services.ts`, `core/features.ts`, `web/src/modules/risks/*`, `home/widgetsSummary.tsx`, `projects/CertDialogs.tsx`, `projects/ItemsTab.tsx`.

Risks need `risks.view` only; restriction is per risk (`restricted`, set from the category: cybersecurity
by default), and only `security.view` sets or lifts it or sees restricted risks. Figures (heat maps,
summary, report, roll-up) show a restricted risk as "Restricted risk", so counts are the same for
everyone; lists leave it out. Key risk indicators follow their risk. The Executive viewer reads the risk
register; a new switched-off **Risk manager** role manages risks without access to security incidents.

### E45-02 Enterprise risk scale and fields by category

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/risks/scales.ts`, `index.ts`, `web/src/modules/risks/scales.tsx`.

A new "Enterprise risk (5 by 5)" scale for enterprise, third-party and compliance risk (on upgrade a copy
of the existing 5 by 5, so nothing is re-rated); the cyber scale is renamed "Cybersecurity risk (5 by 5)"
while unedited. The category's `fields` meta shows "Affected systems and data" for cybersecurity only.

### E45-03 Target risk

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/risks/index.ts`, `common-heatmap.ts`, `lifecycle.ts`, `web/src/modules/risks/ScoringPanel.tsx`, `RiskRegister.tsx`, `HeatMap.tsx`, `RiskDetail.tsx`, `RiskReport.tsx`.

Target likelihood, impact, rating and date. Inherent, residual and target on the register (column,
ranked list, Target heat-map basis with residual-to-target movement), the risk page (assessment, T on the
matrix) and the report (Target column, Above target tile); the summary gives `with_target` and `above_target`.

### E45-04 Versioned risk appetite

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/risks/enterprise.ts`, `web/src/modules/risks/Appetite.tsx`.

Each change is a version with approved by, approved on, approving body, reference and reason, recorded
by the person (`actorOf`); earlier versions are kept and listed (`GET /api/risks/appetite/versions`).
Changing needs `risks.administer`; everyone with `risks.view` reads it.

### E45-05 Heat map, tiles and report agree

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/risks/common-heatmap.ts`, `web/src/modules/risks/HeatMap.tsx`, `RiskReport.tsx`.

The residual heat-map legend says how many risks have an inherent score only (counted at that level in
tiles and report); the wording is "No residual score" and "No target".

## Evidence library and funder reviews

### E45-06 Evidence library

**Status:** done · **Priority:** P1 · **Implemented in:** `server/src/modules/evidence/` (`records.ts`, `links.ts`, `parts.ts`, `routes.ts`, `files.ts`), `web/src/modules/evidence/`, `core/features.ts` (area **Evidence library**), `core/services.ts` (default grants).

Evidence records (EVD-: owner, department, period covered, collected, valid until, source file, link or
document, restricted) are filed once and linked with a relation to many records and parts of records
(review areas, document requests, obligation periods, workpaper steps). Reuse instead of re-upload;
**Used by** on each record; figures the same for everyone; restriction and department scope apply.

### E45-07 Evidence expiry

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/evidence/reminders.ts`, `settings.ts`, `notifications/reminder-settings.ts`, `web/src/modules/evidence/Library.tsx`.

The owner is reminded 30, 7 and 0 days before evidence lapses (setting `evidence.reminder_days`), once per
step; an Evidence to renew view, My work and the calendar show what is due.

### E45-08 Evidence tab on every evidence-bearing record

**Status:** done · **Priority:** P2 · **Implemented in:** `web/src/core/RecordPage.tsx`, `web/src/modules/evidence/EvidencePanel.tsx`.

Controls, control tests, obligations, audits, requests and findings, corrective action plans, actions,
framework outcomes, documents, risks, vendor evidence, awards and certifications get an **Evidence** tab
in the shared record page, shown only while the evidence area is on and the person holds `evidence.view`.

### E45-09 Funders as records

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/funding/funders.ts`, migration `003_funders_and_review_links.sql`, `web/src/modules/funding/Funders.tsx`.

Funders (FDR-) are records shared by awards, certifications and reviews; typed funder names were migrated
to funder records, and a rename follows everywhere.

### E45-10 Connected funder reviews

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/funding/review-links.ts`, `reviews.ts`, `web/src/modules/funding/Reviews.tsx`.

A review lists the awards it covers; each area relies on controls, obligations and documents (with
control ratings), carries evidence per area and per document request, suggests evidence, and lets the
request's assignee upload files straight into the library.

### E45-11 Carry a funder review forward

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/funding/review-links.ts`, `web/src/modules/funding/Reviews.tsx`.

The next review starts from the last one: areas with draft answers, related records, the same evidence,
requests reopened and the awards; the previous review's deficiencies are listed.

### E45-12 Review area templates

**Status:** done · **Priority:** P2 · **Implemented in:** `web/src/modules/funding/ReviewAreas.tsx`, `server/src/modules/funding/seed.ts`.

The sample review areas are only downloaded as a starting template; only the dev seed loads them.

## Internal audit

### E45-13 Risk-ranked audit plan

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/audits/plan.ts`, migration `003_plan_workpapers_verification.sql`, `web/src/modules/audits/Plan.tsx`.

Audit areas get a risk score from linked risks' residual rating, time since the last audit, the last
opinion, change and significance (weights, capacity and threshold set by `audits.administer`). Audits >
Audit plan ranks and proposes areas; the stored score sorts the universe; daily job `audits.risk_scores`.

### E45-14 Approved annual audit plan

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/audits/plan.ts`, `web/src/modules/audits/Plan.tsx`.

Versions of a year's plan with the ranking they came from, approved by someone other than the preparer
(`audits.approve`); earlier approvals are superseded and never changed; the planned audits are created
from it; a data load may name the approver and date.

### E45-15 Workpapers

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/audits/workpapers.ts`, `checklists.ts`, `report.ts`, `web/src/modules/audits/Workpapers.tsx`.

Procedure, sample, result (list `workpaper_result`), files and evidence library records per program step;
preparer and reviewer sign-off by different people; review notes the preparer clears (My work "Workpaper
review notes"); reviewed steps are locked; an audit closes only when worked steps are reviewed and notes
cleared; a data load names the preparer and reviewer.

### E45-16 Finding closure needs the auditor's verification

**Status:** done · **Priority:** P1 · **Implemented in:** `server/src/modules/audits/findings.ts`, `resources.ts`, `due.ts`, `jobs.ts`, `metrics.ts`, `coverage.ts`, `web/src/modules/audits/Findings.tsx`, `Dashboard.tsx`.

Ready for verification (or the plan reaching Verifying or Closed) sets a verification due date
(`audits.verification_days`, 30); Verify and close records date, note and evidence by someone who does
not own the fix. My work "Finding verifications", overdue reminders, a dashboard tile, an audit warning
and the metric `audits.verifications_overdue`.

### E45-17 Control tests in an audit

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/controls/tests.ts`, migration `controls/003_audit_tests.sql`, `web/src/modules/controls/Tests.tsx`, `web/src/modules/audits/Engagements.tsx`.

`control_tests.audit_id` and the audit's Control tests tab; the reviewer must not be the tester and must
hold `audits.edit`; the audit closes only when they are reviewed; the reviewer can be named in a data load.

### E45-18 A corrective action plan from an audit finding closes only after the finding's verification

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/risks/caps.ts` (with a test).

A plan raised from an audit finding cannot be closed until an auditor has verified that finding (Audit
findings > Verify and close); data loads are exempt.

### E45-19 Locked workpaper steps keep their evidence links

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/evidence/parts.ts`, `routes.ts`, `server/src/modules/audits/workpapers.ts`.

An evidence part may give a `mayChange` hook that is checked on link and on unlink, so an evidence link
can no longer be removed from a reviewed (locked) workpaper step.

## Committees and meetings

### E45-20 Agenda items with papers, presenters, time and sessions

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/governance/agenda.ts`, `papers.ts`, migration `003_board_book.sql`, `web/src/modules/governance/Board.tsx`.

Items carry files of the meeting, controlled documents and other records as papers, a presenter (account
or name), time allotted, open or closed session and the consent agenda.

### E45-21 Closed-session items for members only

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/governance/agenda.ts`, `decisions.ts`, `committees.ts`.

Titles, papers, minutes and decisions of closed-session items are read only by members, chair, secretary
and `governance.edit`; others see "Closed session item"; counts are unchanged.

### E45-22 Structured minutes per agenda item

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/governance/agenda.ts`, `meetings.ts`, `book.ts`, `web/src/modules/governance/Board.tsx`.

Discussion per item, attendance and quorum, and general minutes; a minutes PDF.

### E45-23 Motions, votes and resolution numbers

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/governance/motions.ts`, `decisions.ts`, `web/src/modules/governance/Board.tsx`, `Decisions.tsx`.

Mover and seconder (members or named people), per-member votes or counts, a simple-majority default and
resolution numbers per committee and year (`<prefix><year>-NN`), shown on the decisions register.

### E45-24 Minutes approved at the next meeting and published

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/governance/minutes.ts`.

The approval is recorded with the approving meeting's date and motion; the minutes are then published
to members.

### E45-25 Board book PDF

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/governance/book.ts`, `book-sandbox.ts`, `book-reader.mjs`, `book-worker.mjs`.

One tagged PDF (cover, agenda, items, printed documents, Word and Markdown papers, appended PDF papers),
in public and members' versions, plus a text-only version for screen readers; PDF papers are appended in
a sandboxed process.

### E45-26 Member reading view

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/governance/members.ts`, `web/src/modules/governance/MyMeetings.tsx`.

My work > Committee meetings: agenda, papers, board book and published minutes for committee members who
hold no governance permission; membership is checked on every route.

### E45-27 Load past meetings, minutes, motions and votes

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/governance/meetings.ts`, `decisions.ts`, `motions.ts`.

A data load accepts locked meetings, named movers and seconders, votes by name, resolution numbers and dates.

## IT workflows

### E45-28 Raise a security incident from a ticket

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/tickets/escalate.ts`, `web/src/modules/tickets/Escalate.tsx`.

Copies the title, description, requester and affected system or asset; discovered when the ticket opened;
linked both ways (the link is audited on the incident only).

### E45-29 Raise a change from a ticket

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/tickets/escalate.ts`, `web/src/modules/tickets/Escalate.tsx`.

A draft change with the ticket's system and asset and the requester in "Why it is needed", linked as the fix.

### E45-30 Link a ticket to a problem or create the problem from it

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/tickets/escalate.ts`, `web/src/modules/tickets/TicketActions.tsx`.

One dialog from the ticket links it to an existing problem or creates the problem.

### E45-31 Mark a ticket as a duplicate

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/tickets/escalate.ts`.

Links to the original, resolves with the code Duplicate, refuses loops and joins the original's problem.

### E45-32 Link tickets from the problem

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/tickets/escalate.ts`, `web/src/modules/tickets/Problems.tsx`.

Similar-title suggestions plus search, many tickets at once, and an unlink route.

### E45-33 Starter questions and fulfillment tasks on the built-in catalog

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/tickets/defaults.ts`, `index.ts`.

Every built-in catalog item has starter questions and tasks; existing installations get them once where
the item has none.

### E45-34 Security incident next-stage button

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/secincidents/nextstage.ts`, `web/src/modules/secincidents/NextStage.tsx`.

One button moves to the next status with its checks; closing needs the Affected answers, the required
notifications made and no ransom under consideration.

### E45-35 Access reviews start from the import

**Status:** done · **Priority:** P2 · **Implemented in:** `web/src/modules/accessreviews/shared.tsx`, `Accounts.tsx`, `Reviews.tsx`.

A first-steps panel replaces "create the first ..." while no account is loaded.

### E45-36 Findings grouped by identifier

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/vulnerabilities/groups.ts`, `web/src/modules/vulnerabilities/Groups.tsx`.

One row per finding across hosts (finding ID, else CVE list, else title), per-host status, and bulk
assign, accept, fixed and false positive.

### E45-37 Raise a change from findings

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/vulnerabilities/groups.ts`, `web/src/modules/vulnerabilities/List.tsx`, `Detail.tsx`.

A draft change listing the findings, hosts and fix-by dates, linked to each finding; open findings move to
In remediation.

### E45-38 Urgency order and exposure

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/vulnerabilities/rules.ts`, migration `003_urgency_and_known_exploited.sql`.

Exposure (internet-facing, internal, isolated) and a stored urgency of severity, exposure, known
exploitation and fix-by closeness; the default sort.

### E45-39 Known-exploited catalog from a file

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/vulnerabilities/known-exploited.ts`, `web/src/modules/vulnerabilities/KnownExploited.tsx`.

An administrator loads the public catalog file (JSON or CSV) offline; matching open findings are marked on
load and on every save, and never unmarked.

### E45-40 Vulnerabilities by age widget

**Status:** done · **Priority:** P2 · **Implemented in:** `web/src/modules/home/widgetsVulnAge.tsx`.

Open vulnerabilities by age on the home dashboard, in the vulnerability dashboard's buckets.

### E45-41 Send outcomes that need work to owners

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/frameworks/owner-actions.ts`, `web/src/modules/frameworks/SendToOwners.tsx`.

One click turns outcomes below target into owner actions with due dates, from the board or a snapshot;
outcomes with no owner are listed back, and no second open action is made for the same outcome.

### E45-42 System version, end of support and annual cost

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/inventory/migrations/011_system_lifecycle_cost.sql`, `reminders.ts`, `web/src/modules/inventory/SystemFacts.tsx`, `Systems.tsx`.

Portfolio fields on systems, an End of support list column and end-of-support reminders to the technical
owner (else the business owner, else system editors).

### E45-43 Spend on contract and vendor lists

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/vendors/spend.ts`, migration `007_annual_spend.sql`, `web/src/modules/vendors/SpendTotal.tsx`.

A worked-out annual value per contract and annual spend per vendor, with totals that count every record.

### E45-44 Change success rate

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/changes/success.ts`.

`GET /api/changes/success-rate` and the metric `changes.success_pct`; canceled changes are left out,
failed and backed-out changes count as not successful.

### E45-45 IT leadership widgets on home and the IT leadership overview tiles

**Status:** done · **Priority:** P2 · **Implemented in:** `web/src/modules/home/widgetsItLeadership.tsx`, `registry.ts`, `server/src/modules/reports/standard.ts` (`cio_overview`).

Home widgets "Service levels met" and "Change success rate"; the IT leadership overview dashboard gains an
open-vulnerabilities-by-age chart and two gauges (tickets resolved within target, change success rate).
Existing installations get them when the standard dashboard is re-synced.

## AI assistants (MCP)

### E45-46 MCP values resolved by reference, name, email and label

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/mcp/resolve.ts`, `tools-records.ts`, `index.ts` (`GET /api/mcp/people`).

create_record and update_record take a linked record by reference or unique exact title, a person by
username, email or display name (disabled accounts only in data load mode), list values by label and dates
in common formats; ambiguous or missing values are field errors listing candidates; answers list what was
matched.

### E45-47 Files and links on any record through MCP

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/mcp/tools-files.ts`, `tools-documents.ts`.

`attach_file`, `attach_link` and `list_attachments`; the upload tools are offered to every write token;
evidence kind and dates; `as` in data load mode.

### E45-48 Related types and field help in list_record_types

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/mcp/tools-records.ts`, `toolkit.ts`.

`related_types`, `links`, field `help` and `how`, custom fields with choices, and the required fields per
type when no type is given.

### E45-49 Completeness hints after a save

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/mcp/tools-records.ts`.

`unfilled` and `related_empty` in create_record and update_record answers.

### E45-50 Completeness guidance and prompt

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/mcp/server.ts`, `prompts.ts`.

Server instructions (completeness, data load text), tool descriptions and the prompt
`load_records_from_sources`.

### E45-51 A chunked upload attached as someone records the named person

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/attachments/uploads.ts`, `index.ts`.

`claimUpload` and `PUT /api/attachments/upload` record `actorOf(req)` as the uploader, so a file attached
with `as` in data load mode shows the named person as "added by".

### E45-52 Attachments added in data load mode keep their date and are undone with the load

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/attachments/`, `server/src/core/dataload.ts`, `server/src/modules/admin/dataload.ts`.

In a load an attachment keeps the `created_at` it is given, and it is listed in `data_load_records`
(type `attachment`), so undoing the load removes it.

## Wave 26 follow-ups (data load, risk, funding, committees, audits)

All done in wave 26, except E45-61, done in wave 27.

### E45-53 Audits: inspection inspector and finding owner defaults follow the named person

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/audits/checklists.ts`.

`audits/checklists.ts` still sets `inspector_id` and `response_owner_id` from the signed-in person; in a
load they should follow `actorOf(req)` (follow-up of E18-94).

Done in wave 26: the inspection inspector and the finding owner default to `actorOf(req)`, so a load that names a person records that person.

### E45-54 Evidence `created_by` follows the named person

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/frameworks/index.ts`, `extras.ts`, `server/src/modules/attachments/index.ts`.

Evidence rows written from `req.user!.id` (the attachments evidence copy, `frameworks/extras.ts`,
`frameworks/index.ts`) should follow the named person in a load (follow-up of E18-94).

Done in wave 26: outcome evidence `created_by`/`updated_by` and the attachment PATCH `updated_by` follow `actorOf(req)`; evidence links already did.

### E45-55 Loaded times for checklist ticks

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/tickets/catalog.ts`, `secincidents/index.ts`, `controls/steps.ts`, `changes/workflow.ts` (test `secincidents/loaded-times.test.ts`).

Ticket fulfillment task `done_at`, incident checklist `done_at`, control step `done_at` and change PIR
`pir_completed_at` should take the body's time in a load (the actor already follows).

Done in wave 26: ticket task `done_at`, incident checklist `done_at`, control step `done_at` and change `pir_completed_at` take the time the body gives in a load.

### E45-56 Appetite change through an approval workflow or committee decision

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/risks/enterprise.ts`, migration `risks/010_appetite_decision_and_risk_fields.sql`, `governance/decision-ref.ts`, `web/src/modules/risks/Appetite.tsx`.

Today an appetite version is recorded after the fact; it could go through an approval workflow or be
tied to a committee decision.

Done in wave 26 (committee decision): a new appetite version may name `decision_id`, a carried committee decision; the committee is the approver and body, the meeting date the approval date and the resolution the reference. An approval workflow for the appetite is not built: it is E46-53.

### E45-57 Risk restriction per category form and further risk fields

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/risks/enterprise.ts`, `index.ts`, migration `010_appetite_decision_and_risk_fields.sql`, `web/src/modules/risks/Appetite.tsx`, `RiskDetail.tsx`, `RiskRegister.tsx` (test `risks/categories.test.ts`).

Restriction per category is set by editing the category list's meta; a form is not built. Proximity,
velocity and strategic objective fields are not added.

Done in wave 26: `GET /api/risks/categories` and `PUT /api/risks/categories/:category/restriction` (`risks.administer` and `security.view`, optionally applied to existing risks) behind the **Restricted categories** card; new risk fields proximity, velocity (lists `risk_proximity`, `risk_velocity`) and strategic objective.

### E45-58 Funder review readiness view and package export

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/funding/package.ts`, `web/src/modules/funding/Readiness.tsx`, `Reviews.tsx` (test `funding/package.test.ts`).

A readiness view of a funder review and an export of its evidence package.

Done in wave 26: the **Readiness** tab of a funder review shows readiness per area and request; the package export is a ZIP with an index PDF (PDF/UA) and the evidence files the caller may see.

### E45-59 Outside reviewer sees library evidence linked to the review

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/outsidereviews/subjects.ts`, `routes.ts`, `web/src/modules/outsidereviews/ReviewerApp.tsx`.

Outside reviewers do not yet see evidence library records linked to the review they are invited to.

Done in wave 26: the reviewer workspace of audits and funder reviews lists linked evidence library records and their files; restricted evidence is never shown.

### E45-60 Recused votes and conflict-of-interest declarations

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/governance/declarations.ts`, `motions.ts`, `decisions.ts`, `book.ts`, migration `004_declarations_and_work_plan.sql`, `web/src/modules/governance/Interests.tsx`, `Board.tsx`, `MyMeetings.tsx` (test `governance/declarations.test.ts`).

A "recused" vote and conflict-of-interest declarations per agenda item.

Done in wave 26: a vote may be "recused"; members declare an interest per agenda item (also from their own meeting page); the minutes list the declarations and recused votes.

### E45-61 Merge the structure of tagged PDF papers into the board book

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/governance/book-structure.mjs`, `book-worker.mjs`, `book-sandbox.ts`, `book.ts`, `web/src/modules/governance/Board.tsx` (test `governance/book-structure.test.ts`).

Appended PDF pages are marked as artifacts today; their tag structure could be merged so the book stays
fully accessible.

Done in wave 27: a tagged paper's structure tree is copied, in the board book sandbox, under a Part
element (named after its appendix, with the paper's language) of the book's Document element: types
resolved through its RoleMap, heading levels evened out, table and list children wrapped as the standard
requires, figures without alternative text described as such; every page's content made tagged or
artifact (untagged drawing and unreferenced marked-content ids become artifacts); /Pg and the ParentTree
rebuilt for the copied pages. The merged book passes the PDF/UA check. A paper whose tags point into form
XObjects, or an untagged paper, is appended as artifacts as before; the Appendices page says which papers
are tagged.

### E45-62 Agenda posting deadline per committee and annual work plan

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/governance/workplan.ts`, `committees.ts`, `reminders.ts`, `web/src/modules/governance/Interests.tsx`, `Committees.tsx`.

An agenda posting deadline per committee with a reminder, and an annual work plan of standing items.

Done in wave 26: `agenda_posting_days` per committee with a reminder and a notice on the meeting; the committee **Work plan** of standing items by month, added to a meeting's agenda, with a year view.

### E45-63 Workpaper reference numbering and time budget

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/audits/time.ts`, `checklists.ts`, `resources.ts`, migration `005_plan_decision_and_time.sql`, `web/src/modules/audits/Time.tsx`, `Workpapers.tsx` (test `audits/time.test.ts`).

Workpaper reference numbers and budgeted against actual hours per audit.

Done in wave 26: workpaper references A.1, B.1 (`AUD-00012/A.1`), `budget_hours` per audit and time entries by person and step on the **Time** tab.

### E45-64 Audit plan approval through a committee decision

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/audits/plan.ts`, migration `005_plan_decision_and_time.sql`, `web/src/modules/audits/Plan.tsx`.

Approval is by a person holding `audits.approve`; linking it to a committee's meeting decision is not built.

Done in wave 26: `POST /api/audits/plans/:id/approve` takes `decision_id`; the plan keeps `approval_decision_id` and `approval_reference`.

### E45-65 MCP tool to link evidence

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/mcp/tools-files.ts`, `server.ts` (test `mcp/link-evidence.test.ts`).

Evidence records are ordinary MCP resources, but linking them (`/api/evidence-links`) has no tool
(for example `link_evidence`).

Done in wave 26: the `link_evidence` tool (`POST /api/evidence-links`), offered while the evidence library is on; `as` in data load mode.

### E45-66 Change-to-incident link so "caused an incident" counts against change success

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/changes/success.ts`, `web/src/modules/changes/RelatedTab.tsx` (test `changes/caused-incident.test.ts`).

No change-to-incident link exists, so the change success rate does not count changes that caused an incident.

Done in wave 26: a "caused" link from a change to a ticket, security incident or safety event (or "caused by" back) counts against change success; the API gives `caused_incident`. The standard report gauge still counts outcomes only (E46-54).

### E45-67 Members' committee meetings in calendar feeds

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/feeds/sources.ts`.

The `governance.meetings` calendar source could become `named: true`, so members without
`governance.view` get their meetings, linking to `/governance/my-meetings/:id`.

Done in wave 26: `governance.meetings` is `named`; members without `governance.view` get their meetings, linking to `/governance/my-meetings/:id`.
