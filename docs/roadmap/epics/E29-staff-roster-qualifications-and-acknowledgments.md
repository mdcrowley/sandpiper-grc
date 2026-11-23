# E29 Staff roster, qualifications and frontline acknowledgments (wave 10)

**Status:** done (12 of 12 issues done)

## Goal

Keep one roster of staff, accounts or not, with positions, the courses and certifications each position needs, certification expiry, a qualification matrix, and policy acknowledgments recorded for frontline staff on sign-in sheets or a supervisor's kiosk.

## Scope notes

- A new module `people` with permission key `people`. It is always on, not a feature area, because policies, governance and safety all use it.
- Contracts C4 (the `person` type) and C6 (policy document types) are delivered first.
- Hours-of-service and fatigue records are not planned (E29-11).
- Issues marked "stretch" in the wave 10 plan carry priority P3; an unfinished one stays done for wave 11.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E29-01 | Key and roster with HR CSV import | done | P2 |
| E29-02 | Positions and requirements | done | P2 |
| E29-03 | Certifications | done | P2 |
| E29-04 | Expiry reminders and report | done | P2 |
| E29-05 | Training by position and for roster people | done | P2 |
| E29-06 | Qualification matrix | done | P2 |
| E29-07 | Training metrics | done | P2 |
| E29-08 | Policy document types and review cycles | done | P2 |
| E29-09 | Audiences by position and recorded acknowledgments | done | P2 |
| E29-10 | Kiosk acknowledgment | done | P3 |
| E29-11 | Not planned: hours-of-service and fatigue records | done | P3 |
| E29-12 | Sample data and guide | done | P2 |

---

### E29-01 Key and roster with HR CSV import

**Status:** done · **Priority:** P2 · **Type:** feature

A training coordinator wants every member of staff in one roster, imported from an HR export, with an optional link to their account, so the same person is never two people.

**Acceptance criteria**

- [x] `person` records (`PER-` numbers) with personal name fields
- [x] Import through the core CSV and Excel import
- [x] Permission key `people` and a Training coordinator role (wave 10 step 0)

**Implemented in:** `server/src/modules/people/` (`index.ts`, migration `001_people.sql`: type `person`, contract C4; department by id or name; one person per account, email and employee number; names and contacts `personal`), `web/src/modules/people/PeoplePages.tsx`; tests `people/people.test.ts`

### E29-02 Positions and requirements

**Status:** done · **Priority:** P2 · **Type:** feature

A training coordinator wants each position to list the courses and certifications it needs.

**Acceptance criteria**

- [x] `position` records (`POS-` numbers)
- [x] `/api/positions/:id/requirements` (`training.edit`)

**Implemented in:** type `position` in `modules/people/index.ts`; `position_requirements` (`training/migrations/005_qualifications.sql`) and `/api/positions/:id/requirements` in `training/qualifications.ts`; `web/src/modules/training/RequirementsPanel.tsx`; tests `training/qualifications.test.ts`

### E29-03 Certifications

**Status:** done · **Priority:** P2 · **Type:** feature

A supervisor wants each person's certifications with issuing body, number and expiry.

**Acceptance criteria**

- [x] `certification` records (`CRT-` numbers) with evidence files
- [x] Certification types carry their validity and issuing body

**Implemented in:** type `certification` in `training/qualifications.ts` (expiry and issuing body from the `certification_type` list's meta), `web/src/modules/training/Qualifications.tsx`

### E29-04 Expiry reminders and report

**Status:** done · **Priority:** P2 · **Type:** feature

A supervisor wants to know which certifications expire in 30, 60 and 90 days.

**Acceptance criteria**

- [x] Job `training.certifications`; setting `training.certification_reminder_days`
- [x] `GET /api/training/certifications/expiring?days=`

**Implemented in:** `runCertificationReminders` (job `training.certifications`, claimed through `reminded_for` before notifying) and `GET /api/training/certifications/expiring` in `training/qualifications.ts`; settings route `/api/training/certifications/settings`

### E29-05 Training by position and for roster people

**Status:** done · **Priority:** P2 · **Type:** feature

A training coordinator wants to assign training by position and record it for people without accounts.

**Acceptance criteria**

- [x] Assignment audience type `position`
- [x] Training records carry `person_id`

**Implemented in:** `training/sync.ts` (position rules), `training/people.ts` (`person_id`, `p:<id>` keys, `recordsCte`, roster look-up by person, email and employee number), `adoptRosterRecords`; `web/src/modules/training/CourseAssignments.tsx`, `PersonTraining.tsx`

### E29-06 Qualification matrix

**Status:** done · **Priority:** P2 · **Type:** feature

An operations supervisor wants to see who is qualified now, by position, department and site.

**Acceptance criteria**

- [x] `GET /api/training/qualifications` and `/training/qualifications`
- [x] Qualified means every mandatory requirement complete and in date

**Implemented in:** `qualificationRows` and `GET /api/training/qualifications` in `training/qualifications.ts`; `/training/qualifications` (`Qualifications.tsx`)

### E29-07 Training metrics

**Status:** done · **Priority:** P2 · **Type:** feature

Safety indicators want training compliance and expired certifications.

**Acceptance criteria**

- [x] Metrics `training.compliance_pct` and `training.certifications_expired`

**Implemented in:** `defineMetric` calls in `training/qualifications.ts` (computed as of the end of the month)

### E29-08 Policy document types and review cycles

**Status:** done · **Priority:** P2 · **Type:** feature

A policy owner wants procedures, rulebook sections, bulletins, standards and plans as document types, each with its own review cycle.

**Acceptance criteria**

- [x] List `policy_document_type`; `plan` carries `meta.plan` and `review_months`
- [x] A document type column and filter in the library

**Implemented in:** `policies/migrations/003_document_types_and_person_acks.sql`, list `policy_document_type` in `policies/index.ts` (contract C6), review cycle in `publishVersion` (`policies/acknowledgments.ts`); `PolicyLibrary.tsx`

### E29-09 Audiences by position and recorded acknowledgments

**Status:** done · **Priority:** P2 · **Type:** feature

A supervisor wants to ask a position to acknowledge a bulletin and record acknowledgments from a sign-in sheet.

**Acceptance criteria**

- [x] Audience by position
- [x] `POST` and `GET /api/policies/:id/person-acknowledgments` (bulk)
- [x] A sign-in sheet can be attached

**Implemented in:** `policies/personAcks.ts` (`requestRosterAcks`, tracking and bulk recording), `AudienceCard.tsx`, `RecordAcknowledgments.tsx`, `AckTracking.tsx`, `PersonAcks.tsx`; tests `policies/person-acks.test.ts`

### E29-10 Kiosk acknowledgment

**Status:** done · **Priority:** P3 · **Type:** feature

Frontline staff want to acknowledge a document on a supervisor's signed-in device by picking their name and giving their employee number. A stretch goal.

**Acceptance criteria**

- [x] `/policies/kiosk` (`policies.edit`)
- [x] `GET /api/policies/kiosk/pending` and `POST /api/policies/kiosk/acknowledge`
- [x] No unauthenticated route; every acknowledgment records who recorded it

**Implemented in:** kiosk routes in `policies/personAcks.ts` (`policies.edit`; employee number checked, five wrong numbers within 15 minutes stop it for that person, counted in the database (`makeDbLimiter`, bucket `kiosk`; E18-60), every mismatch audited), `web/src/modules/policies/Kiosk.tsx`

### E29-11 Not planned: hours-of-service and fatigue records

**Status:** done · **Priority:** P3 · **Type:** feature

Not planned: hours of service and fatigue records belong in rostering and timekeeping systems. Whether the organization manages them as required is covered at program level by obligations (E30) and audits (E24).

**Implemented in:** nothing to build; recorded so that nobody builds it here (gap review GP-20)

### E29-12 Sample data and guide

**Status:** done · **Priority:** P2 · **Type:** docs

Users need an invented roster and a guide page.

**Acceptance criteria**

- [x] An invented roster across eight positions with requirements and certifications
- [x] `docs/user/29-people-and-qualifications.md`; `12-training-and-exercises.md` and `11-policies-and-exceptions.md` updated

**Implemented in:** `people/seed.ts`, `training/seed-qualifications.ts`, the roster bulletins in `policies/seed.ts` (dev profile); `docs/user/29-people-and-qualifications.md`; tests `people/seed.test.ts`
