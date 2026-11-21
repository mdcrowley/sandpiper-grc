# E30 Obligations, regulatory change and enterprise risk (wave 10)

**Status:** done (9 of 9 issues done)

## Goal

Make obligations recurring, with a type, a frequency and a history of each period attested; take in regulatory changes and turn them into obligations, policy revisions and actions; and give the risk register an appetite per category, key risk indicators and parent risks.

## Scope notes

- Lives in the risks module folder, beside the obligations and the risk register.
- Contract C5 (obligation type, frequency and applicability) is delivered first; funding builds on it.
- No law or regulator is shipped: regulatory changes are the organization's own entries.
- Issues marked "stretch" in the wave 10 plan carry priority P3; an unfinished one stays open for wave 11.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E30-01 | Obligation type, frequency, applicability | done | P2 |
| E30-02 | Per-period history and attestation | done | P2 |
| E30-03 | Period reminders | done | P2 |
| E30-04 | Regulatory change intake | done | P2 |
| E30-05 | Obligations and policy revisions from a change | done | P2 |
| E30-06 | Risk appetite and breach highlighting | done | P2 |
| E30-07 | KRIs | done | P3 |
| E30-08 | Parent risks and roll-up | done | P3 |
| E30-09 | Sample data and guide | done | P2 |

---

### E30-01 Obligation type, frequency, applicability

**Status:** done · **Priority:** P2 · **Type:** feature

A compliance officer wants each obligation to say what kind it is, how often it recurs and what it applies to.

**Acceptance criteria**

- [x] Fields `type` (list `obligation_type`, with `funding_condition`), `frequency` (list `obligation_frequency`) and `applies_to`

**Implemented in:** `risks/obligations.ts` (fields, lists, `applies_to` validation), migration `risks/006`, web `Obligations.tsx`; contract C5. Tests: `risks/obligation-periods.test.ts`.

### E30-02 Per-period history and attestation

**Status:** done · **Priority:** P2 · **Type:** feature

A compliance officer wants each period of a recurring obligation attested with evidence, and the next due date moved on.

**Acceptance criteria**

- [x] `GET` and `POST /api/obligations/:id/periods`, `POST .../periods/:pid/attest`
- [x] The obligation's status follows its latest period

**Implemented in:** `risks/obligations.ts` (period routes), table `obligation_periods`, web `Obligations.tsx` (Periods tab, attest dialog). Tests: `risks/obligation-periods.test.ts`.

### E30-03 Period reminders

**Status:** done · **Priority:** P2 · **Type:** feature

An obligation owner wants a reminder before each period is due.

**Acceptance criteria**

- [x] The obligation reminders cover periods; each reminder goes out once

**Implemented in:** `risks/obligation-reminders.ts` (periodic wording, hand-added periods, `period_reminded_for`). Tests: `risks/obligation-reminders.test.ts`.

### E30-04 Regulatory change intake

**Status:** done · **Priority:** P2 · **Type:** feature

A compliance officer wants to log a new or changed requirement, assess its impact and track it to implementation.

**Acceptance criteria**

- [x] `regulatory_change` records (`REG-` numbers, permission module `obligations`)
- [x] Links with relation `affects`; actions with source `regulatory_change`

**Implemented in:** `risks/regulatory-change.ts`, table `regulatory_changes`, web `RegulatoryChanges.tsx`. Tests: `risks/enterprise.test.ts`.

### E30-05 Obligations and policy revisions from a change

**Status:** done · **Priority:** P2 · **Type:** feature

A compliance officer wants a regulatory change to create an obligation or start a draft policy revision.

**Acceptance criteria**

- [x] `POST /api/regulatory-changes/:id/obligation`
- [x] A draft policy version through the policies API, only when policies are on

**Implemented in:** `POST /api/regulatory-changes/:id/obligation`; draft policy revision from the web through `POST /api/policies/:id/versions`, offered only while policies are on and the person may edit them.

### E30-06 Risk appetite and breach highlighting

**Status:** done · **Priority:** P2 · **Type:** feature

An executive wants the risk appetite stated per category and every risk above it highlighted.

**Acceptance criteria**

- [x] `GET` and `PUT /api/risks/appetite`
- [x] A breach flag worked out on every save; a badge in the register and an outline on the heat map

**Implemented in:** `risks/enterprise.ts` (appetite routes, `breachFor`, `refreshBreaches`), `prepareRisk` and the heat map in `risks/index.ts`, migration `risks/007`, web `Appetite.tsx`, `RiskRegister.tsx`, `HeatMap.tsx`, `RiskReport.tsx`, `scales.tsx` (`AppetiteBadge`).

### E30-07 KRIs

**Status:** done · **Priority:** P3 · **Type:** feature

A risk owner wants key risk indicators with amber and red thresholds, entered by hand or computed from a metric, that bring the risk's review forward at red. A stretch goal.

**Acceptance criteria**

- [x] `kri` records (`KRI-` numbers, restricted)
- [x] `PUT /api/kris/:id/values/:period`
- [x] Daily job `risks.kri_check`

**Implemented in:** `risks/enterprise.ts` (type `kri`, values route, daily `risks.kri_check`), tables `key_risk_indicators` and `kri_values`, web `KriPages.tsx` and the risk page.

### E30-08 Parent risks and roll-up

**Status:** done · **Priority:** P3 · **Type:** feature

An executive wants department risks rolled up under enterprise risks. A stretch goal.

**Acceptance criteria**

- [x] A parent risk field
- [x] `GET /api/risks/rollup` and a roll-up section in the risk report

**Implemented in:** `risks/enterprise.ts` (`checkParent`, `GET /api/risks/rollup`), field `parent_id`, web `RiskDetail.tsx` and `RiskReport.tsx`.

### E30-09 Sample data and guide

**Status:** done · **Priority:** P2 · **Type:** docs

Users need invented periods, changes, appetite and indicators, and the guide updated.

**Acceptance criteria**

- [x] Invented sample data
- [x] The obligations and risk sections of `06-risks-actions-obligations.md`

**Implemented in:** `risks/seed-compliance.ts` (dev profile only), `risks/seed.ts` (type and frequency on the dev obligations and from the organization profile), `docs/user/06-risks-actions-obligations.md`.
