# E10 Policies, training, exceptions, exercises and vulnerabilities

**Status:** open (nothing built)

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
- Acknowledgements and training assigned to all staff need the portal
  ([E15](E15-self-service-portal.md)) and notifications
  ([E14](E14-platform-services.md)) to be useful beyond IT.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E10-01 | Policy register with versions and review dates | done | P2 |
| E10-02 | Policy acknowledgements | done | P2 |
| E10-03 | Training records and assignments | done | P3 |
| E10-04 | Exceptions register | done | P2 |
| E10-05 | Exercises with findings | in progress | P3 |
| E10-06 | Vulnerability register | done | P2 |
| E10-07 | Import scanner findings | done | P3 |
| E10-08 | Fix-by dates by severity for vulnerabilities | in progress | P3 |
| E10-09 | Send acknowledgement and training reminders through notifications | open | P2 |
| E10-10 | A failed training result still counts as complete | open | P2 |
| E10-11 | Let people mark their own training complete | open | P3 |
| E10-12 | Vulnerability deduplication misses port and host aliases | open | P2 |
| E10-13 | Asset or system criticality should shorten fix-by dates | open | P3 |
| E10-14 | Reuse an incident scenario checklist in an exercise | open | P3 |
| E10-15 | Discard a draft policy version and set the reminder interval in Settings | open | P3 |

---

### E10-01 Policy register with versions and review dates

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I keep each policy with its owner, approver, effective date and
next review date, and each approved change becomes a new version.

**Acceptance criteria**

- [ ] A `policy` record type with reference numbers
- [ ] Draft, approved and retired statuses as a configurable list
- [ ] Approving a change creates a new version and keeps the old text
- [ ] A list of policies due for review
- [ ] Policies can be mapped to framework outcomes and obligations through links
- [ ] Tests for create, version, permissions and audit

### E10-02 Policy acknowledgements

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I ask a group of people to read and acknowledge a policy version,
and see who has and has not.

**Acceptance criteria**

- [ ] An acknowledgement request targets roles, departments or everyone
- [ ] Each person acknowledges a specific version, with a time stamp
- [ ] A new version can require fresh acknowledgement
- [ ] A completion report by department, with export

### E10-03 Training records and assignments

**Status:** done · **Priority:** P3 · **Type:** feature

As a security lead, I record which training each person has completed and when it must
be repeated, and assign courses to groups.

**Acceptance criteria**

- [ ] Courses with a repeat interval
- [ ] Completion records per person with a date and optional score
- [ ] Assignment to roles, departments or everyone
- [ ] A list of overdue training
- [ ] Completion can be imported from a file

### E10-04 Exceptions register

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I record each agreed exception to a policy or control with its
reason, the compensating measures, who approved it and when it expires.

**Acceptance criteria**

- [ ] An `exception` record type linked to a policy, outcome, system or asset
- [ ] An approver and an expiry date are required
- [ ] Needs `exceptions.approve` to approve
- [ ] Expired exceptions are flagged and listed
- [ ] An exception can be linked to a risk

### E10-05 Exercises with findings

**Status:** in progress · **Priority:** P3 · **Type:** feature

As a security lead, I plan a tabletop or technical exercise, record who took part and
what was learned, and turn the findings into actions.

**Acceptance criteria**

- [ ] An `exercise` record type with scenario, date, participants and objectives
- [ ] Findings are recorded and each can raise an action (source "exercise")
- [ ] An exercise can reuse a security incident scenario checklist
- [ ] A list shows when each kind of exercise was last run

### E10-06 Vulnerability register

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I track each vulnerability with its severity, the assets or systems
it affects, who will fix it and by when.

**Acceptance criteria**

- [ ] A `vulnerability` record type with severity and status as configurable lists
- [ ] Linked to one or more assets or systems
- [ ] Owner, due date and fix notes
- [ ] A vulnerability can be accepted with an exception (E10-04)
- [ ] Views by severity, by system and overdue

### E10-07 Import scanner findings

**Status:** done · **Priority:** P3 · **Type:** feature

As a security lead, I load the output of a vulnerability scanner and get new findings
added, known ones updated and fixed ones closed.

**Acceptance criteria**

- [ ] CSV import with column mapping and a dry run
- [ ] Findings are matched to assets by serial, tag, name or address
- [ ] A finding missing from a later scan is marked fixed, not deleted
- [ ] Unmatched hosts are listed for review
- [ ] Reuses the asset import pattern ([E13-01](E13-imports-api-integrations.md))

### E10-08 Fix-by dates by severity for vulnerabilities

**Status:** in progress · **Priority:** P3 · **Type:** feature

As a security lead, each vulnerability gets a fix-by date from its severity and the
criticality of what it affects, and overdue ones are reported.

**Acceptance criteria**

- [ ] Days allowed per severity held as a setting
- [ ] The due date is computed and can be overridden with a reason
- [ ] An overdue report by system owner

## Delivered in

Policies and exceptions: `server/src/modules/policies`, `web/src/modules/policies` (E10-01, E10-02, E10-04). Training and exercises: `server/src/modules/training`, `web/src/modules/training` (E10-03, E10-05). Vulnerabilities: `server/src/modules/vulnerabilities`, `web/src/modules/vulnerabilities` (E10-06, E10-07, E10-08). User guide pages 11, 12 and 13.

### E10-09 Send acknowledgement and training reminders through notifications

**Status:** open · **Priority:** P2 · **Type:** feature

Policy acknowledgement and overdue-training reminders are recorded but nobody is told. Send them through the in-app notification service.

**Acceptance criteria**

- [ ] People with an outstanding acknowledgement or overdue training get a notification, once per reminder interval

### E10-10 A failed training result still counts as complete

**Status:** open · **Priority:** P2 · **Type:** bug

A completion recorded with the result "Did not pass" is counted as complete in rates and clears the assignment.

**Acceptance criteria**

- [ ] A failed result does not count as complete and the record stays due

### E10-11 Let people mark their own training complete

**Status:** open · **Priority:** P3 · **Type:** feature

Users can see My training but cannot record a completion themselves.

**Acceptance criteria**

- [ ] A user can record completion of a course that allows self-certification, with an evidence note

### E10-12 Vulnerability deduplication misses port and host aliases

**Status:** open · **Priority:** P2 · **Type:** bug

The same finding on two ports of one host merges into one, and a host seen first by address and later by name is duplicated.

**Acceptance criteria**

- [ ] Findings are keyed by host, port and finding identifier, and host name and address are reconciled

### E10-13 Asset or system criticality should shorten fix-by dates

**Status:** open · **Priority:** P3 · **Type:** improvement

The fix-by date uses severity only; the overdue report groups by finding owner, not system owner.

**Acceptance criteria**

- [ ] Criticality feeds the date by policy, and the report can group by system owner

### E10-14 Reuse an incident scenario checklist in an exercise

**Status:** open · **Priority:** P3 · **Type:** feature

An exercise cannot start from a security incident scenario checklist.

**Acceptance criteria**

- [ ] An exercise can copy a scenario checklist and record how each step went

### E10-15 Discard a draft policy version and set the reminder interval in Settings

**Status:** open · **Priority:** P3 · **Type:** improvement

A draft version cannot be discarded, and the reminder interval is a setting with no screen.

**Acceptance criteria**

- [ ] Both can be done from the policy screens
