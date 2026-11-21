# E27 Funding and grant compliance (wave 10)

**Status:** open

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
| E27-01 | Key and area | open | P2 |
| E27-02 | Awards | open | P2 |
| E27-03 | Funded assets, vehicles, projects and contracts | open | P2 |
| E27-04 | Reporting obligations | open | P2 |
| E27-05 | Yearly certifications with sign-off | open | P2 |
| E27-06 | Compliance reviews from a file | open | P2 |
| E27-07 | Deficiencies and CAPs, close-out | open | P2 |
| E27-08 | Funder-required contract clauses | open | P3 |
| E27-09 | Dashboard | open | P2 |
| E27-10 | Sample data and guide | open | P2 |
| E27-11 | Sub-recipient monitoring and one clause-checklist engine | open | P3 |

---

### E27-01 Key and area

**Status:** open · **Priority:** P2 · **Type:** feature

An administrator wants funding work to have its own permissions and switch.

**Acceptance criteria**

- [x] Permission key `funding` and feature area `funding` (wave 10 step 0)

### E27-02 Awards

**Status:** open · **Priority:** P2 · **Type:** feature

A grants manager wants each award recorded with funder, program, period, amount, local share, reporting frequency and close-out date.

**Acceptance criteria**

- [ ] `funding_award` records (`AWD-` numbers)

### E27-03 Funded assets, vehicles, projects and contracts

**Status:** open · **Priority:** P2 · **Type:** feature

A grants manager wants to see what each award paid for.

**Acceptance criteria**

- [ ] Links with relation `funded_by` (contract C7)
- [ ] A Funded items tab on the award

### E27-04 Reporting obligations

**Status:** open · **Priority:** P2 · **Type:** feature

A grants manager wants the award's reports to appear as obligations with due dates.

**Acceptance criteria**

- [ ] Obligations of type `funding_condition` with the award's frequency, when those fields exist

### E27-05 Yearly certifications with sign-off

**Status:** open · **Priority:** P2 · **Type:** feature

An authorized official wants a checklist of the yearly certifications, each confirmed by its owner before signing.

**Acceptance criteria**

- [ ] `funding_certification` records with items
- [ ] Approval kind `funding_certification`; signing needs every applicable item confirmed
- [ ] Last year's items copied forward each year

### E27-06 Compliance reviews from a file

**Status:** open · **Priority:** P2 · **Type:** feature

A grants manager preparing for a funder review wants the review areas loaded from a file, self-assessed and owned.

**Acceptance criteria**

- [ ] `POST /api/funding/review-area-sets/import` with a documented file format
- [ ] `compliance_review` records with areas and requests

### E27-07 Deficiencies and CAPs, close-out

**Status:** open · **Priority:** P2 · **Type:** feature

A grants manager wants each deficiency tracked to closure with a corrective action plan.

**Acceptance criteria**

- [ ] `review_deficiency` records (`DEF-` numbers)
- [ ] `POST /api/review-deficiencies/:id/cap`
- [ ] A review cannot close while deficiencies are open

### E27-08 Funder-required contract clauses

**Status:** open · **Priority:** P3 · **Type:** feature

A procurement officer wants to check that a funded contract has the clauses the funder requires. A stretch goal.

**Acceptance criteria**

- [ ] An operator-defined clause list and a checklist per contract and award
- [ ] A panel on the contract page, loaded only when the module is there

### E27-09 Dashboard

**Status:** open · **Priority:** P2 · **Type:** feature

A grants manager wants awards by status, reports due, open deficiencies and certification progress at a glance.

**Acceptance criteria**

- [ ] `/funding` and `GET /api/funding/summary`

### E27-10 Sample data and guide

**Status:** open · **Priority:** P2 · **Type:** docs

Users need invented awards, a certification and a review, and a guide page.

**Acceptance criteria**

- [ ] Invented sample data with generic funder names
- [ ] `docs/user/27-funding-and-grants.md`

### E27-11 Sub-recipient monitoring and one clause-checklist engine

**Status:** open · **Priority:** P3 · **Type:** feature

A grants manager who passes funding on wants to monitor sub-recipients, and the security terms and funder clause checklists should share one engine. Planned for wave 11 (E35).

**Acceptance criteria**

- [ ] Sub-recipient records with monitoring checks
- [ ] Security terms and funder clauses use one generic clause checklist
