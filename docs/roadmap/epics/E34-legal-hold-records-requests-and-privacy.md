# E34 Legal hold, records requests and privacy

**Status:** open

## Goal

Stop records under a legal hold from being anonymized or removed, track records requests and personal-data requests against a configurable deadline, and assess privacy impact on systems that hold personal data. Gap review GP-15 and GP-19.

## Scope notes

- Planned for wave 11. The hold is enforced in core retention (`core/retention.ts`).
- Deadlines are configurable days; no jurisdiction's law is a default.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E34-01 | Hold records applied to records or by query | open | P2 |
| E34-02 | Retention respects holds | open | P1 |
| E34-03 | Records and personal-data requests with a due clock | open | P2 |
| E34-04 | Responsive records and exemptions | open | P3 |
| E34-05 | Privacy impact assessments on systems | open | P2 |

---

### E34-01 Hold records applied to records or by query

**Status:** open · **Priority:** P2 · **Type:** feature

Legal counsel wants to place records under a hold for a matter, with custodian and dates.

**Acceptance criteria**

- [ ] Hold records applied to chosen records or to every record a query matches

### E34-02 Retention respects holds

**Status:** open · **Priority:** P1 · **Type:** feature

Legal counsel wants retention to skip held records and say why, and anonymizing or removing them refused.

**Acceptance criteria**

- [ ] Retention review lists held records with their hold
- [ ] Anonymize and remove refuse a held record

### E34-03 Records and personal-data requests with a due clock

**Status:** open · **Priority:** P2 · **Type:** feature

A records officer wants each request tracked against a configurable deadline.

**Acceptance criteria**

- [ ] One request type for records and personal-data requests, with a clock

### E34-04 Responsive records and exemptions

**Status:** open · **Priority:** P3 · **Type:** feature

A records officer wants the records that answer a request linked to it, with exemptions noted.

**Acceptance criteria**

- [ ] Links to responsive records and an exemptions note per record

### E34-05 Privacy impact assessments on systems

**Status:** open · **Priority:** P2 · **Type:** feature

A privacy officer wants an assessment for each system that holds personal data categories.

**Acceptance criteria**

- [ ] An assessment template on systems with personal data categories
