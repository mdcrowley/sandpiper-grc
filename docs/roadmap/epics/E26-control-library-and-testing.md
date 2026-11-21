# E26 Control library and control testing (wave 10)

**Status:** open

## Goal

Keep one library of controls, say which risks, hazards, framework outcomes, obligations and policies each control covers, test controls on a schedule with evidence and reviewer sign-off, and let a failed test raise a corrective action plan and flag what it covers. Test once, satisfy many.

## Scope notes

- A new module `controls` with its own permission key and feature area ("Control library and testing").
- Coverage is a generic record link with relation `covers` (contract C7), so it shows on every covered record's Related tab.
- No catalog text of a standard is shipped; organizations import their own.
- Issues marked "stretch" in the wave 10 plan carry priority P3; an unfinished one stays open for wave 11.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E26-01 | Key, area and grants | open | P2 |
| E26-02 | Control records | open | P2 |
| E26-03 | One control covers many records | open | P2 |
| E26-04 | Test schedule and reminders | open | P2 |
| E26-05 | Test records with evidence and reviewer sign-off | open | P2 |
| E26-06 | A failed test raises a CAP and flags linked risks and hazards | open | P2 |
| E26-07 | Ratings rolled up and the coverage view | open | P2 |
| E26-08 | Catalog import template | open | P3 |
| E26-09 | Dashboard and metrics | open | P2 |
| E26-10 | Sample data and guide | open | P2 |

---

### E26-01 Key, area and grants

**Status:** open · **Priority:** P2 · **Type:** feature

An administrator wants control work to have its own permissions and switch.

**Acceptance criteria**

- [x] Permission key `controls` and feature area `controls` (wave 10 step 0)
- [x] Grants on Security lead, Auditor, Compliance officer and Audit lead (wave 10 step 0)

### E26-02 Control records

**Status:** open · **Priority:** P2 · **Type:** feature

A control owner wants each control described with its objective, type, automation, frequency, domain, owner and operator.

**Acceptance criteria**

- [ ] `control` records (`CTL-` numbers) with evidence files

### E26-03 One control covers many records

**Status:** open · **Priority:** P2 · **Type:** feature

A risk manager wants to see which controls a risk relies on, and a control owner what each control covers.

**Acceptance criteria**

- [ ] `GET`, `POST` and `DELETE /api/controls/:id/coverage` through relation `covers`
- [ ] `GET /api/controls/covering?type=&id=`

### E26-04 Test schedule and reminders

**Status:** open · **Priority:** P2 · **Type:** feature

A control owner wants tests due on a schedule with reminders.

**Acceptance criteria**

- [ ] Next test due worked out from the last test
- [ ] Job `controls.tests_due`; setting `controls.test_reminder_days` (14)

### E26-05 Test records with evidence and reviewer sign-off

**Status:** open · **Priority:** P2 · **Type:** feature

An auditor wants each test recorded with method, sample and result, and reviewed by someone other than the tester.

**Acceptance criteria**

- [ ] `control_test` records (`CTT-` numbers) with samples and evidence
- [ ] Review needs a different person holding `controls.approve`

### E26-06 A failed test raises a CAP and flags linked risks and hazards

**Status:** open · **Priority:** P2 · **Type:** feature

A risk manager wants a failed control to bring forward the review of every risk and hazard it covers.

**Acceptance criteria**

- [ ] `POST /api/control-tests/:id/cap` (contract C1)
- [ ] An ineffective result sets the review date of covered risks and hazards to today and tells their owners

### E26-07 Ratings rolled up and the coverage view

**Status:** open · **Priority:** P2 · **Type:** feature

A risk manager wants to see which risks, hazards and outcomes rely on untested or ineffective controls.

**Acceptance criteria**

- [ ] The newest reviewed test sets the control's ratings
- [ ] `/controls/coverage` and `GET /api/controls/coverage-matrix`

### E26-08 Catalog import template

**Status:** open · **Priority:** P3 · **Type:** feature

A compliance officer wants to load a control catalog from a spreadsheet. A stretch goal.

**Acceptance criteria**

- [ ] A documented import template for the core CSV and Excel import

### E26-09 Dashboard and metrics

**Status:** open · **Priority:** P2 · **Type:** feature

A control owner wants the state of testing at a glance, and risk indicators want the figures.

**Acceptance criteria**

- [ ] `/controls/dashboard` and `GET /api/controls/summary`
- [ ] Metrics `controls.tests_overdue` and `controls.ineffective`

### E26-10 Sample data and guide

**Status:** open · **Priority:** P2 · **Type:** docs

Users need invented sample controls and a guide page.

**Acceptance criteria**

- [ ] Twenty invented controls and a year of tests
- [ ] `docs/user/26-controls-and-testing.md`
