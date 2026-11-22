# E35 Vendor risk lifecycle

**Status:** done (7 of 7 issues done)

## Goal

Reassess vendors on a cadence set by their criticality, record exclusion-list checks, keep a register of vendor issues, and offboard a vendor with a checklist when a contract ends. Gap review GP-16, with the generic clause checklist from E27-11.

## Scope notes

- Delivered in wave 11 inside the `vendors` area (no new area or permission key); sub-recipients stay inside `funding`.
- No exclusion list, debarment list, funder or regulator is built in: a check is recorded as performed against a list the organization names (lookup `exclusion_list`, one neutral example).
- Cadences and lead times are settings: reassessment months by criticality (lookup meta `reassess_months`), `vendors.reassessment_reminder_days`, `vendors.exclusion_check_months`, `vendors.exclusion_check_before_contract`, `funding.subrecipient_reminder_days`.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E35-01 | Reassessment cadence by criticality with reminders | done | P2 |
| E35-02 | Exclusion-list checks recorded per vendor | done | P2 |
| E35-03 | Vendor issues register | done | P3 |
| E35-04 | Offboarding checklist when a contract ends | done | P2 |
| E35-05 | One generic clause-checklist engine | done | P3 |
| E35-06 | Sample data and guide | done | P2 |
| E35-07 | Sub-recipient monitoring | done | P3 |

---

### E35-01 Reassessment cadence by criticality with reminders

**Status:** done · **Priority:** P2 · **Type:** feature

A vendor manager wants critical vendors reassessed every year and others less often, with reminders.

**Acceptance criteria**

- [x] A next-assessment date worked out from criticality, with reminders

**Implemented in:** `vendors/lifecycle.ts` (cadence, `recomputeVendor`, `runLifecycleReminders`, `/api/vendors/reassessments`, `/api/vendors/lifecycle-settings`), vendor fields `owner_id`, `last_assessed_on`, `next_assessment_due`; job `vendors.lifecycle`; calendar source `vendors.reassessments`; metric `vendors.reassessments_overdue`; `web/src/modules/vendors/Reassessments.tsx`, `Lifecycle.tsx`

### E35-02 Exclusion-list checks recorded per vendor

**Status:** done · **Priority:** P2 · **Type:** feature

A procurement officer wants each check against an exclusion list recorded with date, list and result.

**Acceptance criteria**

- [x] Check records on each vendor

**Implemented in:** `vendors/lifecycle.ts` (`/api/vendors/:id/exclusion-checks`, `activationBlock` on contract activation), table `vendor_exclusion_checks`; `web/src/modules/vendors/Lifecycle.tsx`

### E35-03 Vendor issues register

**Status:** done · **Priority:** P3 · **Type:** feature

A vendor manager wants issues with a vendor tracked to resolution.

**Acceptance criteria**

- [x] A vendor issue record with owner, status and actions

**Implemented in:** `vendors/issues.ts` (type `vendor_issue`, `POST /api/vendor-issues/:id/cap`); metric `vendors.open_issues`; `web/src/modules/vendors/Issues.tsx`

### E35-04 Offboarding checklist when a contract ends

**Status:** done · **Priority:** P2 · **Type:** feature

A security lead wants accounts and remote access removed, data returned or destroyed and assets returned when a contract ends.

**Acceptance criteria**

- [x] A checklist started when a contract ends, tied to systems' remote access and the inventory

**Implemented in:** `vendors/offboarding.ts` (type `vendor_offboarding`, items, refresh, sign-off, approval kind `vendor_offboarding`, start on contract end and nightly); `web/src/modules/vendors/Offboardings.tsx`

### E35-05 One generic clause-checklist engine

**Status:** done · **Priority:** P3 · **Type:** debt

Security terms and funder-required clauses should share one checklist engine (from E27-11).

**Acceptance criteria**

- [x] Security terms and funder clauses use the same engine

**Implemented in:** `core/clauses.ts`, `core/migrations/026_clause_checks.sql`; `vendors/clauses.ts` (set `security_terms`), `funding/clauses.ts` (set `funder_clauses`)

### E35-06 Sample data and guide

**Status:** done · **Priority:** P2 · **Type:** documentation

An evaluator wants invented reassessments, exclusion checks, vendor issues, an offboarding and sub-recipients, and a guide page.

**Acceptance criteria**

- [x] Invented samples, labeled "(sample)"
- [x] Guide page `34-vendor-risk-lifecycle.md`; edits to the vendors and funding guides

**Implemented in:** `vendors/seed-lifecycle.ts`, `funding/subrecipients.ts` (`seedSubrecipients`); `docs/user/34-vendor-risk-lifecycle.md`, `04-vendors-and-contracts.md`, `27-funding-and-grants.md`; browser suite `tools/e2e/suites/17-vendor-lifecycle.mjs`

### E35-07 Sub-recipient monitoring

**Status:** done · **Priority:** P3 · **Type:** feature

A grants manager wants each sub-recipient monitored on a cadence, with findings that may raise a corrective action plan. Delivers E27-11 together with E35-05.

**Acceptance criteria**

- [x] Sub-recipient records on awards, monitoring history, reminders by frequency
- [x] Findings may raise a corrective action plan (source `funding`)

**Implemented in:** `funding/subrecipients.ts` (type `subrecipient`, monitoring, CAP, job `funding.subrecipients`); `web/src/modules/funding/Subrecipients.tsx`. Delivers E27-11 with E35-05
