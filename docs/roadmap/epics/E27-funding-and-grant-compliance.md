# E27 Funding and grant compliance (wave 10)

**Status:** in progress (10 of 11 issues done)

## Goal

Track funding awards and what they pay for, the reporting they require, yearly certifications signed by an authorized official, and funder compliance reviews with their deficiencies, so a grant-funded organization can show it meets its funders' conditions.

## Scope notes

- A new module `funding` with its own permission key and feature area ("Funding and grant compliance").
- No program, funder or law is named: funders, review areas and clauses are the organization's own data, loaded from files or entered.
- Deficiencies raise corrective action plans (contract C1); award reporting creates obligations (contract C5).
- Issues marked "stretch" in the wave 10 plan carry priority P3; an unfinished one stays open for wave 11.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E27-01 | Key and area | done | P2 |
| E27-02 | Awards | done | P2 |
| E27-03 | Funded assets, vehicles, projects and contracts | done | P2 |
| E27-04 | Reporting obligations | done | P2 |
| E27-05 | Yearly certifications with sign-off | done | P2 |
| E27-06 | Compliance reviews from a file | done | P2 |
| E27-07 | Deficiencies and CAPs, close-out | done | P2 |
| E27-08 | Funder-required contract clauses | done | P3 |
| E27-09 | Dashboard | done | P2 |
| E27-10 | Sample data and guide | done | P2 |
| E27-11 | Sub-recipient monitoring and one clause-checklist engine | open | P3 |

---

### E27-01 Key and area

**Status:** done · **Priority:** P2 · **Type:** feature

An administrator wants funding work to have its own permissions and switch.

**Acceptance criteria**

- [x] Permission key `funding` and feature area `funding` (wave 10 step 0)
- [x] Routes, record types, the daily job and the action source "Funding" follow the switch; the contract page's Funder clauses tab is shown only while the area is on

**Implemented in:** step 0 (`core/features.ts`, `modules/admin/shared.ts`); `server/src/modules/funding/index.ts`; `web/src/modules/funding/index.tsx`

### E27-02 Awards

**Status:** done · **Priority:** P2 · **Type:** feature

A grants manager wants each award recorded with funder, program, period, amount, local share, reporting frequency and close-out date.

**Acceptance criteria**

- [x] `funding_award` records (`AWD-` numbers): funder, program, award number, status (applied, awarded, active, closed out), period, amount, local share, project, manager, reporting frequency, next report and close-out dates
- [x] Amounts cannot be negative; the period cannot end before it starts
- [x] List with filters, and the award page in sections (Award, Period and money, Reporting)

**Implemented in:** `server/src/modules/funding/awards.ts`, `migrations/001_funding.sql`; `web/src/modules/funding/Awards.tsx`

### E27-03 Funded assets, vehicles, projects and contracts

**Status:** done · **Priority:** P2 · **Type:** feature

A grants manager wants to see what each award paid for.

**Acceptance criteria**

- [x] Links with relation `funded_by` (contract C7), so the funded record's Related tab shows the award
- [x] A Funded items tab on the award (`GET`, `POST /api/funding-awards/:id/funded-items`, `DELETE .../:linkId`); only records the person may see, and only types that are installed

**Implemented in:** `server/src/modules/funding/awards.ts`; `web/src/modules/funding/Awards.tsx`

### E27-04 Reporting obligations

**Status:** done · **Priority:** P2 · **Type:** feature

A grants manager wants the award's reports to appear as obligations with due dates.

**Acceptance criteria**

- [x] Obligations of type `funding_condition` with the award's frequency, when those fields exist (contract C5): a reporting obligation and a close-out obligation (once), made when the award is awarded or active, linked to it (`condition_of`)
- [x] A Reporting obligations tab, and "Make missing obligations" (`POST /api/funding-awards/:id/obligations`, also needs `obligations.create`); the tab says when the obligations register is not there

**Implemented in:** `server/src/modules/funding/awards.ts`; `web/src/modules/funding/Awards.tsx`

### E27-05 Yearly certifications with sign-off

**Status:** done · **Priority:** P2 · **Type:** feature

An authorized official wants a checklist of the yearly certifications, each confirmed by its owner before signing.

**Acceptance criteria**

- [x] `funding_certification` records (`CER-`) with checklist items (category, statement, applies, responsible, confirmation); the checklist changes only while the certification is a draft
- [x] Items confirmed by the person responsible or by someone with `funding.edit`; a changed statement needs confirming again
- [x] Approval kind `funding_certification` (default workflow "Funding certification sign-off": the authorized official named on the record, `funding.approve`); signing needs every applicable item confirmed; approval signs and dates it, rejection returns it to draft
- [x] Last year's items copied forward each year: "Copy to next year" and the daily job `funding.certification_rollover` from the month in `funding.certification_month` (`GET`, `PUT /api/funding/settings`)

**Implemented in:** `server/src/modules/funding/certifications.ts`; `web/src/modules/funding/Certifications.tsx`

### E27-06 Compliance reviews from a file

**Status:** done · **Priority:** P2 · **Type:** feature

A grants manager preparing for a funder review wants the review areas loaded from a file, self-assessed and owned.

**Acceptance criteria**

- [x] `POST /api/funding/review-area-sets/import` (`funding.administer`) with a documented file format, a check that saves nothing first, and reloads that update and add but never remove
- [x] `compliance_review` records (`CRV-`) with areas copied from a set (self-assessment, answers, owner, notes) and document requests (the person asked may answer)
- [x] An invented sample file (`review-areas.sample.json`, 12 generic areas, no program or law names)

**Implemented in:** `server/src/modules/funding/reviews.ts`, `review-areas.sample.json`; `web/src/modules/funding/Reviews.tsx`, `ReviewAreas.tsx`

### E27-07 Deficiencies and CAPs, close-out

**Status:** done · **Priority:** P2 · **Type:** feature

A grants manager wants each deficiency tracked to closure with a corrective action plan.

**Acceptance criteria**

- [x] `review_deficiency` records (`DEF-` numbers)
- [x] `POST /api/review-deficiencies/:id/cap` (contract C1; also needs `actions.create`), and the corrective action plan panel on the deficiency; a plan raised either way is linked, and the deficiency closes when its last plan closes
- [x] A deficiency cannot close by hand while a plan for it is open
- [x] A review cannot close while deficiencies are open; a closed review takes no new deficiencies or changes to its areas

**Implemented in:** `server/src/modules/funding/reviews.ts`; `web/src/modules/funding/Deficiencies.tsx`, `Reviews.tsx`

### E27-08 Funder-required contract clauses

**Status:** done · **Priority:** P3 · **Type:** feature

A procurement officer wants to check that a funded contract has the clauses the funder requires. A stretch goal.

**Acceptance criteria**

- [x] An operator-defined clause list (`funding_clause`, with neutral examples) and a checklist per contract and award (`GET`, `PUT /api/funding/contracts/:contractId/clauses`)
- [x] A Funder clauses tab on the contract page, loaded only when the module is in the build, the area is on and the person may view funding

**Implemented in:** `server/src/modules/funding/clauses.ts`; `web/src/modules/funding/ContractFundingClauses.tsx`, `web/src/modules/vendors/ContractPages.tsx`

### E27-09 Dashboard

**Status:** done · **Priority:** P2 · **Type:** feature

A grants manager wants awards by status, reports due, open deficiencies and certification progress at a glance.

**Acceptance criteria**

- [x] `/funding` and `GET /api/funding/summary`: awards by status, reports and close-outs due within 30 days, open deficiencies, certification progress and reviews under way (figures the same for everyone)

**Implemented in:** `server/src/modules/funding/summary.ts`; `web/src/modules/funding/Dashboard.tsx`

### E27-10 Sample data and guide

**Status:** done · **Priority:** P2 · **Type:** docs

Users need invented awards, a certification and a review, and a guide page.

**Acceptance criteria**

- [x] Invented sample data with generic funder names (dev profile): 4 awards, this year's certification with 20 items, one review from the sample file with requests and 2 deficiencies (one with a plan); funded items linked to whatever sample records exist
- [x] `docs/user/27-funding-and-grants.md`, and the contract record section of `04-vendors-and-contracts.md`

**Implemented in:** `server/src/modules/funding/seed.ts`; `docs/user/27-funding-and-grants.md`

### E27-11 Sub-recipient monitoring and one clause-checklist engine

**Status:** open · **Priority:** P3 · **Type:** feature

A grants manager who passes funding on wants to monitor sub-recipients, and the security terms and funder clause checklists should share one engine. Planned for wave 11 (E35).

**Acceptance criteria**

- [ ] Sub-recipient records with monitoring checks
- [ ] Security terms and funder clauses use one generic clause checklist
