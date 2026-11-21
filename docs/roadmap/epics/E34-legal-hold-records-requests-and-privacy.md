# E34 Legal hold, records requests and privacy

**Status:** in progress (1 of 9 issues done)

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
| E34-06 | Permission keys, area and Records and privacy officer role | open | P2 |
| E34-07 | Request clocks and reminders | open | P2 |
| E34-08 | Sample data and guide | open | P2 |
| E34-09 | Not planned: document redaction | done | P3 |

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

### E34-06 Permission keys, area and Records and privacy officer role

**Status:** open · **Priority:** P2 · **Type:** feature

An administrator wants records requests and privacy to be an optional part, and legal holds always on with their own permission. Wave 11 (coordinator step 0 declared the `legal`, `records` and `privacy` keys, the `records` area and the Records and privacy officer role, and wired the legal-hold hook points into core as no-ops.)

**Acceptance criteria**

- [ ] Legal holds (`legal`) are always on, enforced in core whatever is switched off
- [ ] The `records` area hides requests and privacy assessments while off
- [ ] The Records and privacy officer role

### E34-07 Request clocks and reminders

**Status:** open · **Priority:** P2 · **Type:** feature

A records officer wants each request's deadline counted from a setting, an amber and a red alert, and privacy reviews reminded.

**Acceptance criteria**

- [ ] Due days per request kind from a setting (default 20 for every kind, labeled "set your own"); working days optional
- [ ] Alerts claimed before sending; calendar source `records.requests_due`; metric `records.requests_overdue`

### E34-08 Sample data and guide

**Status:** open · **Priority:** P2 · **Type:** documentation

An evaluator wants an invented hold, requests and assessments, and a guide page.

**Acceptance criteria**

- [ ] Invented samples, labeled "(sample)"
- [ ] Guide page `33-legal-holds-records-requests-and-privacy.md`

### E34-09 Not planned: document redaction

**Status:** done · **Priority:** P3 · **Type:** feature

Not planned: redacting the content of documents belongs in a document tool. Exemptions are recorded per responsive record instead.

**Implemented in:** nothing to build; recorded so that nobody builds it here (wave 11 plan, scope guards)
