# E26 Control library and control testing (wave 10)

**Status:** in progress (10 of 11 issues done)

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
| E26-01 | Key, area and grants | done | P2 |
| E26-02 | Control records | done | P2 |
| E26-03 | One control covers many records | done | P2 |
| E26-04 | Test schedule and reminders | done | P2 |
| E26-05 | Test records with evidence and reviewer sign-off | done | P2 |
| E26-06 | A failed test raises a CAP and flags linked risks and hazards | done | P2 |
| E26-07 | Ratings rolled up and the coverage view | done | P2 |
| E26-08 | Catalog import template | done | P3 |
| E26-09 | Dashboard and metrics | done | P2 |
| E26-10 | Sample data and guide | done | P2 |
| E26-11 | Controls panel on the covered records' pages | open | P3 |

---

### E26-01 Key, area and grants

**Status:** done · **Priority:** P2 · **Type:** feature

An administrator wants control work to have its own permissions and switch.

**Acceptance criteria**

- [x] Permission key `controls` and feature area `controls` (wave 10 step 0)
- [x] Grants on Security lead, Auditor, Compliance officer and Audit lead (wave 10 step 0)

**Implemented in:** `server/src/core/features.ts`, `server/src/core/services.ts` (step 0); `server/src/modules/controls/lists.ts` (lists, the `control` action source and the `controls` notification kind)

### E26-02 Control records

**Status:** done · **Priority:** P2 · **Type:** feature

A control owner wants each control described with its objective, type, automation, frequency, domain, owner and operator.

**Acceptance criteria**

- [x] `control` records (`CTL-` numbers) with evidence files

**Implemented in:** `server/src/modules/controls/controls.ts`, `migrations/001_controls.sql`; `web/src/modules/controls/Controls.tsx`

### E26-03 One control covers many records

**Status:** done · **Priority:** P2 · **Type:** feature

A risk manager wants to see which controls a risk relies on, and a control owner what each control covers.

**Acceptance criteria**

- [x] `GET`, `POST` and `DELETE /api/controls/:id/coverage` through relation `covers`
- [x] `GET /api/controls/covering?type=&id=`

**Implemented in:** `server/src/modules/controls/coverage.ts`; `web/src/modules/controls/Controls.tsx` (Coverage tab), `ControlsPanel.tsx`

### E26-04 Test schedule and reminders

**Status:** done · **Priority:** P2 · **Type:** feature

A control owner wants tests due on a schedule with reminders.

**Acceptance criteria**

- [x] Next test due worked out from the last test
- [x] Job `controls.tests_due`; setting `controls.test_reminder_days` (14)

**Implemented in:** `server/src/modules/controls/controls.ts` (`rollUp`), `reminders.ts`

### E26-05 Test records with evidence and reviewer sign-off

**Status:** done · **Priority:** P2 · **Type:** feature

An auditor wants each test recorded with method, sample and result, and reviewed by someone other than the tester.

**Acceptance criteria**

- [x] `control_test` records (`CTT-` numbers) with samples and evidence
- [x] Review needs a different person holding `controls.approve`

**Implemented in:** `server/src/modules/controls/tests.ts`; `web/src/modules/controls/Tests.tsx`

### E26-06 A failed test raises a CAP and flags linked risks and hazards

**Status:** done · **Priority:** P2 · **Type:** feature

A risk manager wants a failed control to bring forward the review of every risk and hazard it covers.

**Acceptance criteria**

- [x] `POST /api/control-tests/:id/cap` (contract C1)
- [x] An ineffective result sets the review date of covered risks and hazards to today and tells their owners

**Implemented in:** `server/src/modules/controls/tests.ts` (plan route), `coverage.ts` (`flagCoverage`); `web/src/modules/controls/Tests.tsx`

### E26-07 Ratings rolled up and the coverage view

**Status:** done · **Priority:** P2 · **Type:** feature

A risk manager wants to see which risks, hazards and outcomes rely on untested or ineffective controls.

**Acceptance criteria**

- [x] The newest reviewed test sets the control's ratings
- [x] `/controls/coverage` and `GET /api/controls/coverage-matrix`

**Implemented in:** `server/src/modules/controls/controls.ts`, `coverage.ts`; `web/src/modules/controls/Coverage.tsx`

### E26-08 Catalog import template

**Status:** done · **Priority:** P3 · **Type:** feature

A compliance officer wants to load a control catalog from a spreadsheet. A stretch goal.

**Acceptance criteria**

- [x] A documented import template for the core CSV and Excel import (coverage is added per control, not imported)

**Implemented in:** `docs/user/26-controls-and-testing.md` (Importing a control catalog; the template is core import's template for the type)

### E26-09 Dashboard and metrics

**Status:** done · **Priority:** P2 · **Type:** feature

A control owner wants the state of testing at a glance, and risk indicators want the figures.

**Acceptance criteria**

- [x] `/controls/dashboard` and `GET /api/controls/summary`
- [x] Metrics `controls.tests_overdue` and `controls.ineffective`

**Implemented in:** `server/src/modules/controls/summary.ts`; `web/src/modules/controls/Dashboard.tsx`

### E26-10 Sample data and guide

**Status:** done · **Priority:** P2 · **Type:** docs

Users need invented sample controls and a guide page.

**Acceptance criteria**

- [x] Twenty invented controls and a year of tests
- [x] `docs/user/26-controls-and-testing.md`

**Implemented in:** `server/src/modules/controls/seed.ts`; `docs/user/26-controls-and-testing.md`

### E26-11 Controls panel on the covered records' pages

**Status:** open · **Priority:** P3 · **Type:** feature

A risk or hazard owner wants to see, on the risk or hazard itself, which controls it relies on and how they rate, without opening the control library. Found in wave 10: the panel (`web/src/modules/controls/ControlsPanel.tsx`, `GET /api/controls/covering`) is built, but the host pages belong to other modules.

**Acceptance criteria**

- [ ] The risk, hazard, framework outcome, obligation and policy pages load `ControlsPanel` with `import.meta.glob`, so a build without the control library shows nothing
