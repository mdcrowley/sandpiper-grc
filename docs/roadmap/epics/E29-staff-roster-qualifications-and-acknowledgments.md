# E29 Staff roster, qualifications and frontline acknowledgments (wave 10)

**Status:** open (1 of 12 issues done: E29-11 is a "Not planned" entry)

## Goal

Keep one roster of staff, accounts or not, with positions, the courses and certifications each position needs, certification expiry, a qualification matrix, and policy acknowledgments recorded for frontline staff on sign-in sheets or a supervisor's kiosk.

## Scope notes

- A new module `people` with permission key `people`. It is always on, not a feature area, because policies, governance and safety all use it.
- Contracts C4 (the `person` type) and C6 (policy document types) are delivered first.
- Hours-of-service and fatigue records are not planned (E29-11).
- Issues marked "stretch" in the wave 10 plan carry priority P3; an unfinished one stays open for wave 11.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E29-01 | Key and roster with HR CSV import | open | P2 |
| E29-02 | Positions and requirements | open | P2 |
| E29-03 | Certifications | open | P2 |
| E29-04 | Expiry reminders and report | open | P2 |
| E29-05 | Training by position and for roster people | open | P2 |
| E29-06 | Qualification matrix | open | P2 |
| E29-07 | Training metrics | open | P2 |
| E29-08 | Policy document types and review cycles | open | P2 |
| E29-09 | Audiences by position and recorded acknowledgments | open | P2 |
| E29-10 | Kiosk acknowledgment | open | P3 |
| E29-11 | Not planned: hours-of-service and fatigue records | done | P3 |
| E29-12 | Sample data and guide | open | P2 |

---

### E29-01 Key and roster with HR CSV import

**Status:** open · **Priority:** P2 · **Type:** feature

A training coordinator wants every member of staff in one roster, imported from an HR export, with an optional link to their account, so the same person is never two people.

**Acceptance criteria**

- [ ] `person` records (`PER-` numbers) with personal name fields
- [ ] Import through the core CSV and Excel import
- [x] Permission key `people` and a Training coordinator role (wave 10 step 0)

### E29-02 Positions and requirements

**Status:** open · **Priority:** P2 · **Type:** feature

A training coordinator wants each position to list the courses and certifications it needs.

**Acceptance criteria**

- [ ] `position` records (`POS-` numbers)
- [ ] `/api/positions/:id/requirements` (`training.edit`)

### E29-03 Certifications

**Status:** open · **Priority:** P2 · **Type:** feature

A supervisor wants each person's certifications with issuing body, number and expiry.

**Acceptance criteria**

- [ ] `certification` records (`CRT-` numbers) with evidence files
- [ ] Certification types carry their validity and issuing body

### E29-04 Expiry reminders and report

**Status:** open · **Priority:** P2 · **Type:** feature

A supervisor wants to know which certifications expire in 30, 60 and 90 days.

**Acceptance criteria**

- [ ] Job `training.certifications`; setting `training.certification_reminder_days`
- [ ] `GET /api/training/certifications/expiring?days=`

### E29-05 Training by position and for roster people

**Status:** open · **Priority:** P2 · **Type:** feature

A training coordinator wants to assign training by position and record it for people without accounts.

**Acceptance criteria**

- [ ] Assignment audience type `position`
- [ ] Training records carry `person_id`

### E29-06 Qualification matrix

**Status:** open · **Priority:** P2 · **Type:** feature

An operations supervisor wants to see who is qualified now, by position, department and site.

**Acceptance criteria**

- [ ] `GET /api/training/qualifications` and `/training/qualifications`
- [ ] Qualified means every mandatory requirement complete and in date

### E29-07 Training metrics

**Status:** open · **Priority:** P2 · **Type:** feature

Safety indicators want training compliance and expired certifications.

**Acceptance criteria**

- [ ] Metrics `training.compliance_pct` and `training.certifications_expired`

### E29-08 Policy document types and review cycles

**Status:** open · **Priority:** P2 · **Type:** feature

A policy owner wants procedures, rulebook sections, bulletins, standards and plans as document types, each with its own review cycle.

**Acceptance criteria**

- [ ] List `policy_document_type`; `plan` carries `meta.plan` and `review_months`
- [ ] A document type column and filter in the library

### E29-09 Audiences by position and recorded acknowledgments

**Status:** open · **Priority:** P2 · **Type:** feature

A supervisor wants to ask a position to acknowledge a bulletin and record acknowledgments from a sign-in sheet.

**Acceptance criteria**

- [ ] Audience by position
- [ ] `POST` and `GET /api/policies/:id/person-acknowledgments` (bulk)
- [ ] A sign-in sheet can be attached

### E29-10 Kiosk acknowledgment

**Status:** open · **Priority:** P3 · **Type:** feature

Frontline staff want to acknowledge a document on a supervisor's signed-in device by picking their name and giving their employee number. A stretch goal.

**Acceptance criteria**

- [ ] `/policies/kiosk` (`policies.edit`)
- [ ] `GET /api/policies/kiosk/pending` and `POST /api/policies/kiosk/acknowledge`
- [ ] No unauthenticated route; every acknowledgment records who recorded it

### E29-11 Not planned: hours-of-service and fatigue records

**Status:** done · **Priority:** P3 · **Type:** feature

Not planned: hours of service and fatigue records belong in rostering and timekeeping systems. Whether the organization manages them as required is covered at program level by obligations (E30) and audits (E24).

**Implemented in:** nothing to build; recorded so that nobody builds it here (gap review GP-20)

### E29-12 Sample data and guide

**Status:** open · **Priority:** P2 · **Type:** docs

Users need an invented roster and a guide page.

**Acceptance criteria**

- [ ] An invented roster across eight positions with requirements and certifications
- [ ] `docs/user/29-people-and-qualifications.md`; `12-training-and-exercises.md` and `11-policies-and-exceptions.md` updated
