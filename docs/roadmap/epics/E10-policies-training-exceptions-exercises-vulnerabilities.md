# E10 Policies, training, exceptions, exercises and vulnerabilities

**Status:** done (15 of 15 issues done; follow-ups E10-16 to E10-18 open)

## Goal

Complete the cybersecurity area: publish policies and record who has acknowledged them,
track security training, record time-limited exceptions to policy, run exercises and
capture what they show, and track vulnerabilities from discovery to fix.

## Scope notes

- Nothing exists yet: no module folders, no screens. The permission keys `policies`,
  `training`, `exceptions`, `exercises` and `vulnerabilities` are reserved and the
  default roles already carry grants for them.
- Each area is expected to be its own small module under `server/src/modules/` and
  `web/src/modules/`, built on the generic resource.
- Acknowledgments and training assigned to all staff need the portal
  ([E15](E15-self-service-portal.md)) and notifications
  ([E14](E14-platform-services.md)) to be useful beyond IT.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E10-01 | Policy register with versions and review dates | done | P2 |
| E10-02 | Policy acknowledgments | done | P2 |
| E10-03 | Training records and assignments | done | P3 |
| E10-04 | Exceptions register | done | P2 |
| E10-05 | Exercises with findings | done | P3 |
| E10-06 | Vulnerability register | done | P2 |
| E10-07 | Import scanner findings | done | P3 |
| E10-08 | Fix-by dates by severity for vulnerabilities | done | P3 |
| E10-09 | Send acknowledgment and training reminders through notifications | done | P2 |
| E10-10 | A failed training result still counts as complete | done | P2 |
| E10-11 | Let people mark their own training complete | done | P3 |
| E10-12 | Vulnerability deduplication misses port and host aliases | done | P2 |
| E10-13 | Asset or system criticality should shorten fix-by dates | done | P3 |
| E10-14 | Reuse an incident scenario checklist in an exercise | done | P3 |
| E10-15 | Discard a draft policy version and set the reminder interval in Settings | done | P3 |
| E10-16 | Merge vulnerability duplicates recorded before host and port matching | open | P3 |
| E10-17 | Exercise step outcomes on the exercise calendar and as findings | open | P3 |
| E10-18 | Separate reminder intervals for overdue policy and training per audience | open | P3 |

---

### E10-01 Policy register with versions and review dates

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I keep each policy with its owner, approver, effective date and
next review date, and each approved change becomes a new version.

**Acceptance criteria**

- [x] A `policy` record type with reference numbers
- [x] Draft, approved and retired statuses as a configurable list
- [x] Approving a change creates a new version and keeps the old text
- [x] A list of policies due for review
- [x] Policies can be mapped to framework outcomes and obligations through links
- [x] Tests for create, version, permissions and audit

### E10-02 Policy acknowledgments

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I ask a group of people to read and acknowledge a policy version,
and see who has and has not.

**Acceptance criteria**

- [x] An acknowledgment request targets roles, departments or everyone
- [x] Each person acknowledges a specific version, with a time stamp
- [x] A new version can require fresh acknowledgment
- [x] A completion report by department, with export

### E10-03 Training records and assignments

**Status:** done · **Priority:** P3 · **Type:** feature

As a security lead, I record which training each person has completed and when it must
be repeated, and assign courses to groups.

**Acceptance criteria**

- [x] Courses with a repeat interval
- [x] Completion records per person with a date and optional score
- [x] Assignment to roles, departments or everyone
- [x] A list of overdue training
- [x] Completion can be imported from a file

### E10-04 Exceptions register

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I record each agreed exception to a policy or control with its
reason, the compensating measures, who approved it and when it expires.

**Acceptance criteria**

- [x] An `exception` record type linked to a policy, outcome, system or asset
- [x] An approver and an expiry date are required
- [x] Needs `exceptions.approve` to approve
- [x] Expired exceptions are flagged and listed
- [x] An exception can be linked to a risk

### E10-05 Exercises with findings

**Status:** done · **Priority:** P3 · **Type:** feature

As a security lead, I plan a tabletop or technical exercise, record who took part and
what was learned, and turn the findings into actions.

**Acceptance criteria**

- [x] An `exercise` record type with scenario, date, participants and objectives
- [x] Findings are recorded and each can raise an action (source "exercise")
- [x] An exercise can reuse a security incident scenario checklist
- [x] A list shows when each kind of exercise was last run

### E10-06 Vulnerability register

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I track each vulnerability with its severity, the assets or systems
it affects, who will fix it and by when.

**Acceptance criteria**

- [x] A `vulnerability` record type with severity and status as configurable lists
- [x] Linked to one or more assets or systems
- [x] Owner, due date and fix notes
- [x] A vulnerability can be accepted with an exception (E10-04)
- [x] Views by severity, by system and overdue

### E10-07 Import scanner findings

**Status:** done · **Priority:** P3 · **Type:** feature

As a security lead, I load the output of a vulnerability scanner and get new findings
added, known ones updated and fixed ones closed.

**Acceptance criteria**

- [x] CSV import with column mapping and a dry run
- [x] Findings are matched to assets by serial, tag, name or address
- [x] A finding missing from a later scan is marked fixed, not deleted
- [x] Unmatched hosts are listed for review
- [x] Reuses the asset import pattern ([E13-01](E13-imports-api-integrations.md))

### E10-08 Fix-by dates by severity for vulnerabilities

**Status:** done · **Priority:** P3 · **Type:** feature

As a security lead, each vulnerability gets a fix-by date from its severity and the
criticality of what it affects, and overdue ones are reported.

**Acceptance criteria**

- [x] Days allowed per severity held as a setting
- [x] The due date is computed and can be overridden with a reason
- [x] An overdue report by system owner

## Delivered in

Policies and exceptions: `server/src/modules/policies`, `web/src/modules/policies` (E10-01, E10-02, E10-04). Training and exercises: `server/src/modules/training`, `web/src/modules/training` (E10-03, E10-05). Vulnerabilities: `server/src/modules/vulnerabilities`, `web/src/modules/vulnerabilities` (E10-06, E10-07, E10-08). User guide pages 11, 12 and 13.

### E10-09 Send acknowledgment and training reminders through notifications

**Status:** done · **Priority:** P2 · **Type:** feature

Policy acknowledgment and overdue-training reminders are recorded but nobody is told. Send them through the in-app notification service.

**Acceptance criteria**

- [x] People with an outstanding acknowledgment or overdue training get a notification, once per reminder interval

### E10-10 A failed training result still counts as complete

**Status:** done · **Priority:** P2 · **Type:** bug

A completion recorded with the result "Did not pass" is counted as complete in rates and clears the assignment.

**Acceptance criteria**

- [x] A failed result does not count as complete and the record stays due

### E10-11 Let people mark their own training complete

**Status:** done · **Priority:** P3 · **Type:** feature

Users can see My training but cannot record a completion themselves.

**Acceptance criteria**

- [x] A user can record completion of a course that allows self-certification, with an evidence note

### E10-12 Vulnerability deduplication misses port and host aliases

**Status:** done · **Priority:** P2 · **Type:** bug

The same finding on two ports of one host merges into one, and a host seen first by address and later by name is duplicated.

**Acceptance criteria**

- [x] Findings are keyed by host, port and finding identifier, and host name and address are reconciled

### E10-13 Asset or system criticality should shorten fix-by dates

**Status:** done · **Priority:** P3 · **Type:** improvement

The fix-by date uses severity only; the overdue report groups by finding owner, not system owner.

**Acceptance criteria**

- [x] Criticality feeds the date by policy, and the report can group by system owner

### E10-14 Reuse an incident scenario checklist in an exercise

**Status:** done · **Priority:** P3 · **Type:** feature

An exercise cannot start from a security incident scenario checklist.

**Acceptance criteria**

- [x] An exercise can copy a scenario checklist and record how each step went

### E10-15 Discard a draft policy version and set the reminder interval in Settings

**Status:** done · **Priority:** P3 · **Type:** improvement

A draft version cannot be discarded, and the reminder interval is a setting with no screen.

**Acceptance criteria**

- [x] Both can be done from the policy screens

## Wave 2 notes (finishing pass)

### E10-05 Exercises with findings: implemented in

- `server/src/modules/training/exerciseSteps.ts`, `migrations/002_attempts_self_cert_checklists.sql` (table `exercise_steps`), `exercises.ts`
- `web/src/modules/training/ExerciseSteps.tsx`, `ExercisePages.tsx` (Steps tab; Actions tab is the shared Actions panel)

### E10-08 and E10-13 Fix-by dates, criticality and the overdue report: implemented in

- `server/src/modules/vulnerabilities/policy.ts` (criticality shares; every recalculated date written to the finding's own history), `notify.ts` (hourly sweep recalculates), `summary.ts` (`/api/vulnerabilities/overdue-report?group=owner|system_owner`)
- `web/src/modules/vulnerabilities/PolicySettings.tsx` (Shorter periods for critical systems), `Dashboard.tsx` (Overdue findings, By owner / By system owner), `Detail.tsx` (criticality notice)
- Tests: `platform.test.ts`, `vulnerabilities.test.ts`

### E10-09 Notifications: implemented in

- Policies: `server/src/modules/policies/acknowledgments.ts` (`notifyAck` on publish and in `runPolicyReminders`; the link opens the person's own reader, `/policies/acknowledgments/<request>`, so no policy permission is needed)
- Training: `server/src/modules/training/notify.ts` (`notifyTraining`: assigned once per record, overdue once per `training.reminder_interval_days`; links to `/training/mine`)
- Vulnerabilities: `server/src/modules/vulnerabilities/notify.ts` (assigned; past the fix-by date once per date; only people with `security.view`, enforced by the notification service through the record)
- Changes (E05-09): `server/src/modules/changes/notify.ts`
- Timers are not started under the test runner or an in-memory database
- Tests: `policies/platform.test.ts`, `training/platform.test.ts`, `vulnerabilities/platform.test.ts`

### E10-10 Failed results: implemented in

- `server/src/modules/training/people.ts` (`failingResults`, attempts in `saveTraining`), `records.ts` (manual records and edits), `importer.ts`, `migrations/002_attempts_self_cert_checklists.sql` (existing "did not pass" completions with nothing later become attempts; when the person already had a record to complete, the attempt moves onto it)
- `web/src/modules/training/RecordDialog.tsx` (Record attempt), `shared.tsx` (Retake chip)

### E10-11 Self-certified completion: implemented in

- `server/src/modules/training/records.ts` (`POST /api/training/mine/complete`, `GET /api/training/mine/self-certify`), course field `self_certify`
- `web/src/modules/training/MyTraining.tsx`, `CoursePages.tsx`

### E10-12 Deduplication: implemented in

- `server/src/modules/vulnerabilities/rules.ts` (`portKey`, `samePort`, `HostIndex`, `resolveHostKey`), `importer.ts`, `migrations/002_dedup_keys.sql` (keys existing rows; merges nothing)
- Tests: `dedup.test.ts`; verified in the browser by importing one file twice (second run: nothing new, host name learned)

### E10-14 Incident scenario checklist: see E10-05

### E10-15 Discard and reminder interval: implemented in

- `server/src/modules/policies/versions.ts` (`DELETE /api/policies/:id/versions/:vid`; the author cannot approve their own version), `index.ts` (`GET/PUT /api/policies/settings`)
- `web/src/modules/policies/PolicyActions.tsx` (More actions > Discard version), `PolicyLibrary.tsx` (Reminder settings)

### Also delivered

- The policy reader (`web/src/modules/policies/PolicyReader.tsx`), version switcher on the policy page, saved views and tiles on the policy, exception, change and finding lists
- Risk acceptance on a finding needs an approved exception that has not expired, or an approver other than the person recording it
- `/api/exceptions/expiring` leaves out policy names for people without `policies.view`
- The import audit event lists every finding it reported, with the import each was last reported by before

### E10-16 Merge vulnerability duplicates recorded before host and port matching

**Status:** open · **Priority:** P3 · **Type:** improvement

Migration 002 keys existing findings but deliberately merges nothing, so two rows that are now the same finding (same host after reconciliation, same port and identifier) both stay open.

**Acceptance criteria**

- [ ] A report lists such pairs, and an administrator can merge them, keeping history and attachments of both

### E10-17 Exercise step outcomes on the exercise calendar and as findings

**Status:** open · **Priority:** P3 · **Type:** improvement

**Acceptance criteria**

- [ ] A step recorded as "Not done" or "Done, with issues" can raise a finding in one action
- [ ] The calendar's "When each kind was last run" shows how the steps went

### E10-18 Separate reminder intervals per audience

**Status:** open · **Priority:** P3 · **Type:** improvement

Policies and training each have one reminder interval for everybody.

**Acceptance criteria**

- [ ] A policy or course can set its own interval, falling back to the module setting