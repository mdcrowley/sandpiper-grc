# E24 Audits and inspections (wave 10)

**Status:** done (13 of 13 issues done)

## Goal

Plan internal audits and safety reviews over several years, run them with checklists, findings and evidence requests, and run recurring inspections of stations, depots, vehicles and equipment on a phone or tablet. Findings raise corrective action plans and hazards.

## Scope notes

- A new module `audits` with its own permission key and feature area ("Audits and inspections").
- Checklists are templates; the organization writes its own questions. No standard or regulator text is shipped.
- Findings raise corrective action plans through contract C1 (E23).
- Issues marked "stretch" in the wave 10 plan carry priority P3; an unfinished one stays open for wave 11.
- The audit record type is `audit_engagement` (table `audits`, routes `/api/audits`), not `audit`: a type named `audit` would share its generated operation ids (`get_audit`) with the audit log's `GET /api/audit` and its generated export audit action (`audit.export`) with the audit log export.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E24-01 | Permission key, area and Audit lead role | done | P2 |
| E24-02 | Audit universe and multi-year coverage | done | P2 |
| E24-03 | Engagements and their lifecycle | done | P2 |
| E24-04 | Checklist templates | done | P2 |
| E24-05 | Recurring inspection schedules and reminders | done | P2 |
| E24-06 | Inspections run on a phone or tablet | done | P2 |
| E24-07 | Findings (rating, criteria, condition, cause, effect, response) | done | P2 |
| E24-08 | Findings raise CAPs and hazards | done | P2 |
| E24-09 | Evidence requests answered by the auditee | done | P2 |
| E24-10 | Audit report approval and PDF | done | P3 |
| E24-11 | Dashboard and metrics | done | P2 |
| E24-12 | Sample data | done | P3 |
| E24-13 | Guide page | done | P2 |

---

### E24-01 Permission key, area and Audit lead role

**Status:** done · **Priority:** P2 · **Type:** feature

An administrator wants to give audit work its own permissions, switch the area off when it is not used, and start from a ready-made role.

**Acceptance criteria**

- [x] Permission key `audits` and feature area `audits` (wave 10 step 0)
- [x] An Audit lead role and grants on the existing roles (wave 10 step 0)

**Implemented in:** `server/src/modules/admin/shared.ts`, `server/src/core/features.ts`, `server/src/core/services.ts` (step 0); `audits.approve` is noted as checked by the approval kind (`server/src/modules/audits/report.ts`)

### E24-02 Audit universe and multi-year coverage

**Status:** done · **Priority:** P2 · **Type:** feature

An audit manager wants the list of areas that need auditing, how often, when each was last audited and when it is next due.

**Acceptance criteria**

- [x] `audit_area` records with category, cycle, owner and risk level; closing an audit records the area's last audit and moves its next due date on by the cycle
- [x] `GET /api/audits/coverage?years=3` and a coverage view (areas by year, restricted audits masked for people who may not see them)

**Implemented in:** `server/src/modules/audits/resources.ts`, `coverage.ts`; `web/src/modules/audits/Areas.tsx`, `Dashboard.tsx`

### E24-03 Engagements and their lifecycle

**Status:** done · **Priority:** P2 · **Type:** feature

An auditor wants each audit as a record with scope, criteria, team and dates, moving from planned to fieldwork, reporting and closed.

**Acceptance criteria**

- [x] Audit records (`audit_engagement`, `AUD-` numbers) with the fields and statuses of the plan; moving to fieldwork and reporting records the dates
- [x] A page with tabs Scope, Checklist, Evidence requests, Findings, Report and Approval, and the audit team

**Implemented in:** `server/src/modules/audits/resources.ts`, `checklists.ts`; `web/src/modules/audits/Engagements.tsx`, `Checklist.tsx`

### E24-04 Checklist templates

**Status:** done · **Priority:** P2 · **Type:** feature

An audit lead wants reusable checklists for audits and inspections, with sections, guidance, critical items and items that need a photo.

**Acceptance criteria**

- [x] `checklist_template` records with ordered items (`GET`/`PUT /api/checklist-templates/:id/items`)
- [x] Templates can be edited, versioned (a template already used gets a new version; removed items are kept for the answers given) and switched off

**Implemented in:** `server/src/modules/audits/checklists.ts`; `web/src/modules/audits/Templates.tsx`

### E24-05 Recurring inspection schedules and reminders

**Status:** done · **Priority:** P2 · **Type:** feature

A supervisor wants inspections of each station, depot or vehicle created on a schedule, with reminders and missed inspections marked.

**Acceptance criteria**

- [x] `inspection_schedule` records (target site, vehicle, asset or system; weekly, monthly, quarterly or yearly)
- [x] Job `audits.inspections` (every three hours, each step safe to repeat) creates due inspections, marks those not done 7 days after their due date missed, and sends reminders; `POST /api/audits/inspections/run`
- [x] Settings `audits.inspection_reminder_days` (2) and `audits.request_reminder_days` (3)

**Implemented in:** `server/src/modules/audits/jobs.ts`, `resources.ts`; `web/src/modules/audits/Inspections.tsx`

### E24-06 Inspections run on a phone or tablet

**Status:** done · **Priority:** P2 · **Type:** feature

An inspector walking a station wants one item at a time with large yes, no and not applicable buttons and photo upload.

**Acceptance criteria**

- [x] `/inspections/:id/run` works at phone width (checked at 390, 820 and 1440 pixels, light and dark)
- [x] Answers are saved as they are given (`PUT /api/inspections/:id/responses`); photos go through the attachments module; completing (`POST /api/inspections/:id/complete`) works out the result and score and raises a finding for each item not met

**Implemented in:** `server/src/modules/audits/checklists.ts`; `web/src/modules/audits/InspectionRun.tsx`; browser suite `tools/e2e/suites/11-audits.mjs`

### E24-07 Findings (rating, criteria, condition, cause, effect, response)

**Status:** done · **Priority:** P2 · **Type:** feature

An auditor wants each finding recorded in the usual structure, with the management response and its owner.

**Acceptance criteria**

- [x] `audit_finding` records (`FND-` numbers) restricted from their source; giving the response records the date
- [x] Ratings: major and minor nonconformity, observation, opportunity

**Implemented in:** `server/src/modules/audits/resources.ts`; `web/src/modules/audits/Findings.tsx`

### E24-08 Findings raise CAPs and hazards

**Status:** done · **Priority:** P2 · **Type:** feature

An auditor wants a finding to raise a corrective action plan, or a hazard when it is a safety concern.

**Acceptance criteria**

- [x] `POST /api/audit-findings/:id/cap` (contract C1; also needs `actions.create`); a plan raised from the plan panel is recorded on the finding too
- [x] `POST /api/audit-findings/:id/hazard`, only while the hazard type is available (also needs `safety.create`)

**Implemented in:** `server/src/modules/audits/findings.ts`; `web/src/modules/audits/Findings.tsx`, `shared.tsx` (`CapPanel` loaded with `import.meta.glob`)

### E24-09 Evidence requests answered by the auditee

**Status:** done · **Priority:** P2 · **Type:** feature

An auditee wants to see and answer the evidence requests addressed to them without seeing the rest of the audit.

**Acceptance criteria**

- [x] `audit_request` records (`REQ-` numbers), restricted from their audit
- [x] `GET /api/audit-requests/mine` and `POST /api/audit-requests/:id/respond`, owner only, returning the request text only; the page `/audits/my-requests`

**Implemented in:** `server/src/modules/audits/requests.ts`; `web/src/modules/audits/Requests.tsx`

### E24-10 Audit report approval and PDF

**Status:** done · **Priority:** P3 · **Type:** feature

An audit lead wants the report approved before the audit closes, and a branded PDF of it.

**Acceptance criteria**

- [x] Approval kind `audit_report` (default workflow "Audit report approval", `audits.approve`); closing waits for it and needs a summary and a response or plan on every finding
- [x] `GET /api/audits/:id/report.pdf` (`audits.export`) with the organization's branding

**Implemented in:** `server/src/modules/audits/report.ts`; `web/src/modules/audits/Engagements.tsx`

### E24-11 Dashboard and metrics

**Status:** done · **Priority:** P2 · **Type:** feature

An audit manager wants the plan, coverage, open findings and inspection results at a glance, and safety wants inspection figures as indicators.

**Acceptance criteria**

- [x] `/audits` dashboard and `GET /api/audits/summary` (figures count every record)
- [x] Metrics `audits.inspections_on_time_pct` and `audits.findings_overdue`

**Implemented in:** `server/src/modules/audits/coverage.ts`, `metrics.ts`; `web/src/modules/audits/Dashboard.tsx`

### E24-12 Sample data

**Status:** done · **Priority:** P3 · **Type:** feature

Someone trying the application wants invented audits, templates, schedules and inspections.

**Acceptance criteria**

- [x] The invented sample set of the wave 10 plan, with nothing that names a real organization or place (dev profile only)

**Implemented in:** `server/src/modules/audits/seed.ts`, `seed.test.ts`

### E24-13 Guide page

**Status:** done · **Priority:** P2 · **Type:** docs

Users need a guide page for audits and inspections.

**Acceptance criteria**

- [x] `docs/user/25-audits-and-inspections.md`, hidden while the area is off

**Implemented in:** `docs/user/25-audits-and-inspections.md`
