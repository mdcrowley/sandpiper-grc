# E30 Obligations, regulatory change and enterprise risk (wave 10)

**Status:** open

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
| E30-01 | Obligation type, frequency, applicability | open | P2 |
| E30-02 | Per-period history and attestation | open | P2 |
| E30-03 | Period reminders | open | P2 |
| E30-04 | Regulatory change intake | open | P2 |
| E30-05 | Obligations and policy revisions from a change | open | P2 |
| E30-06 | Risk appetite and breach highlighting | open | P2 |
| E30-07 | KRIs | open | P3 |
| E30-08 | Parent risks and roll-up | open | P3 |
| E30-09 | Sample data and guide | open | P2 |

---

### E30-01 Obligation type, frequency, applicability

**Status:** open · **Priority:** P2 · **Type:** feature

A compliance officer wants each obligation to say what kind it is, how often it recurs and what it applies to.

**Acceptance criteria**

- [ ] Fields `type` (list `obligation_type`, with `funding_condition`), `frequency` (list `obligation_frequency`) and `applies_to`

### E30-02 Per-period history and attestation

**Status:** open · **Priority:** P2 · **Type:** feature

A compliance officer wants each period of a recurring obligation attested with evidence, and the next due date moved on.

**Acceptance criteria**

- [ ] `GET` and `POST /api/obligations/:id/periods`, `POST .../periods/:pid/attest`
- [ ] The obligation's status follows its latest period

### E30-03 Period reminders

**Status:** open · **Priority:** P2 · **Type:** feature

An obligation owner wants a reminder before each period is due.

**Acceptance criteria**

- [ ] The obligation reminders cover periods; each reminder goes out once

### E30-04 Regulatory change intake

**Status:** open · **Priority:** P2 · **Type:** feature

A compliance officer wants to log a new or changed requirement, assess its impact and track it to implementation.

**Acceptance criteria**

- [ ] `regulatory_change` records (`REG-` numbers, permission module `obligations`)
- [ ] Links with relation `affects`; actions with source `regulatory_change`

### E30-05 Obligations and policy revisions from a change

**Status:** open · **Priority:** P2 · **Type:** feature

A compliance officer wants a regulatory change to create an obligation or start a draft policy revision.

**Acceptance criteria**

- [ ] `POST /api/regulatory-changes/:id/obligation`
- [ ] A draft policy version through the policies API, only when policies are on

### E30-06 Risk appetite and breach highlighting

**Status:** open · **Priority:** P2 · **Type:** feature

An executive wants the risk appetite stated per category and every risk above it highlighted.

**Acceptance criteria**

- [ ] `GET` and `PUT /api/risks/appetite`
- [ ] A breach flag worked out on every save; a badge in the register and an outline on the heat map

### E30-07 KRIs

**Status:** open · **Priority:** P3 · **Type:** feature

A risk owner wants key risk indicators with amber and red thresholds, entered by hand or computed from a metric, that bring the risk's review forward at red. A stretch goal.

**Acceptance criteria**

- [ ] `kri` records (`KRI-` numbers, restricted)
- [ ] `PUT /api/kris/:id/values/:period`
- [ ] Daily job `risks.kri_check`

### E30-08 Parent risks and roll-up

**Status:** open · **Priority:** P3 · **Type:** feature

An executive wants department risks rolled up under enterprise risks. A stretch goal.

**Acceptance criteria**

- [ ] A parent risk field
- [ ] `GET /api/risks/rollup` and a roll-up section in the risk report

### E30-09 Sample data and guide

**Status:** open · **Priority:** P2 · **Type:** docs

Users need invented periods, changes, appetite and indicators, and the guide updated.

**Acceptance criteria**

- [ ] Invented sample data
- [ ] The obligations and risk sections of `06-risks-actions-obligations.md`
