# E24 Audits and inspections (wave 10)

**Status:** open

## Goal

Plan internal audits and safety reviews over several years, run them with checklists, findings and evidence requests, and run recurring inspections of stations, depots, vehicles and equipment on a phone or tablet. Findings raise corrective action plans and hazards.

## Scope notes

- A new module `audits` with its own permission key and feature area ("Audits and inspections").
- Checklists are templates; the organization writes its own questions. No standard or regulator text is shipped.
- Findings raise corrective action plans through contract C1 (E23).
- Issues marked "stretch" in the wave 10 plan carry priority P3; an unfinished one stays open for wave 11.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E24-01 | Permission key, area and Audit lead role | open | P2 |
| E24-02 | Audit universe and multi-year coverage | open | P2 |
| E24-03 | Engagements and their lifecycle | open | P2 |
| E24-04 | Checklist templates | open | P2 |
| E24-05 | Recurring inspection schedules and reminders | open | P2 |
| E24-06 | Inspections run on a phone or tablet | open | P2 |
| E24-07 | Findings (rating, criteria, condition, cause, effect, response) | open | P2 |
| E24-08 | Findings raise CAPs and hazards | open | P2 |
| E24-09 | Evidence requests answered by the auditee | open | P2 |
| E24-10 | Audit report approval and PDF | open | P3 |
| E24-11 | Dashboard and metrics | open | P2 |
| E24-12 | Sample data | open | P3 |
| E24-13 | Guide page | open | P2 |

---

### E24-01 Permission key, area and Audit lead role

**Status:** open · **Priority:** P2 · **Type:** feature

An administrator wants to give audit work its own permissions, switch the area off when it is not used, and start from a ready-made role.

**Acceptance criteria**

- [x] Permission key `audits` and feature area `audits` (wave 10 step 0)
- [x] An Audit lead role and grants on the existing roles (wave 10 step 0)

### E24-02 Audit universe and multi-year coverage

**Status:** open · **Priority:** P2 · **Type:** feature

An audit manager wants the list of areas that need auditing, how often, when each was last audited and when it is next due.

**Acceptance criteria**

- [ ] `audit_area` records with category, cycle, owner and risk level
- [ ] `GET /api/audits/coverage?years=3` and a coverage view

### E24-03 Engagements and their lifecycle

**Status:** open · **Priority:** P2 · **Type:** feature

An auditor wants each audit as a record with scope, criteria, team and dates, moving from planned to fieldwork, reporting and closed.

**Acceptance criteria**

- [ ] `audit` records (`AUD-` numbers) with the fields and statuses of the plan
- [ ] A page with tabs Scope, Checklist, Evidence requests, Findings, Report and Approval

### E24-04 Checklist templates

**Status:** open · **Priority:** P2 · **Type:** feature

An audit lead wants reusable checklists for audits and inspections, with sections, guidance, critical items and items that need a photo.

**Acceptance criteria**

- [ ] `checklist_template` records with ordered items
- [ ] Templates can be edited, versioned and switched off

### E24-05 Recurring inspection schedules and reminders

**Status:** open · **Priority:** P2 · **Type:** feature

A supervisor wants inspections of each station, depot or vehicle created on a schedule, with reminders and missed inspections marked.

**Acceptance criteria**

- [ ] `inspection_schedule` records
- [ ] Daily job `audits.inspections` creates due inspections, marks missed ones and sends reminders
- [ ] Settings `audits.inspection_reminder_days` and `audits.request_reminder_days`

### E24-06 Inspections run on a phone or tablet

**Status:** open · **Priority:** P2 · **Type:** feature

An inspector walking a station wants one item at a time with large yes, no and not applicable buttons and photo upload.

**Acceptance criteria**

- [ ] `/inspections/:id/run` works at phone width
- [ ] Answers are saved as they are given; completing works out the result and score

### E24-07 Findings (rating, criteria, condition, cause, effect, response)

**Status:** open · **Priority:** P2 · **Type:** feature

An auditor wants each finding recorded in the usual structure, with the management response and its owner.

**Acceptance criteria**

- [ ] `audit_finding` records (`FND-` numbers) restricted from their source
- [ ] Ratings: major and minor nonconformity, observation, opportunity

### E24-08 Findings raise CAPs and hazards

**Status:** open · **Priority:** P2 · **Type:** feature

An auditor wants a finding to raise a corrective action plan, or a hazard when it is a safety concern.

**Acceptance criteria**

- [ ] `POST /api/audit-findings/:id/cap` (contract C1)
- [ ] `POST /api/audit-findings/:id/hazard`, only while the hazard type is available

### E24-09 Evidence requests answered by the auditee

**Status:** open · **Priority:** P2 · **Type:** feature

An auditee wants to see and answer the evidence requests addressed to them without seeing the rest of the audit.

**Acceptance criteria**

- [ ] `audit_request` records (`REQ-` numbers)
- [ ] `GET /api/audit-requests/mine` and `POST /api/audit-requests/:id/respond`, owner only, returning the request text only

### E24-10 Audit report approval and PDF

**Status:** open · **Priority:** P3 · **Type:** feature

An audit lead wants the report approved before the audit closes, and a branded PDF of it. The PDF is a stretch goal.

**Acceptance criteria**

- [ ] Approval kind `audit_report`; closing waits for it and needs a summary and a response or plan on every finding
- [ ] `GET /api/audits/:id/report.pdf` (`audits.export`) with the organization's branding

### E24-11 Dashboard and metrics

**Status:** open · **Priority:** P2 · **Type:** feature

An audit manager wants the plan, coverage, open findings and inspection results at a glance, and safety wants inspection figures as indicators.

**Acceptance criteria**

- [ ] `/audits` dashboard and `GET /api/audits/summary`
- [ ] Metrics `audits.inspections_on_time_pct` and `audits.findings_overdue`

### E24-12 Sample data

**Status:** open · **Priority:** P3 · **Type:** feature

Someone trying the application wants invented audits, templates, schedules and inspections.

**Acceptance criteria**

- [ ] The invented sample set of the wave 10 plan, with nothing that names a real organization or place

### E24-13 Guide page

**Status:** open · **Priority:** P2 · **Type:** docs

Users need a guide page for audits and inspections.

**Acceptance criteria**

- [ ] `docs/user/25-audits-and-inspections.md`, hidden while the area is off
