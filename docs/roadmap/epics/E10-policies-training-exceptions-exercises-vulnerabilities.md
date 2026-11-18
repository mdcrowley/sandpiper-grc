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
| E10-01 | Policy register with versions and review dates | open | P2 |
| E10-02 | Policy acknowledgements | open | P2 |
| E10-03 | Training records and assignments | open | P3 |
| E10-04 | Exceptions register | open | P2 |
| E10-05 | Exercises with findings | open | P3 |
| E10-06 | Vulnerability register | open | P2 |
| E10-07 | Import scanner findings | open | P3 |
| E10-08 | Fix-by dates by severity for vulnerabilities | open | P3 |

---

### E10-01 Policy register with versions and review dates

**Status:** open · **Priority:** P2 · **Type:** feature

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

**Status:** open · **Priority:** P2 · **Type:** feature

As a security lead, I ask a group of people to read and acknowledge a policy version,
and see who has and has not.

**Acceptance criteria**

- [ ] An acknowledgement request targets roles, departments or everyone
- [ ] Each person acknowledges a specific version, with a time stamp
- [ ] A new version can require fresh acknowledgement
- [ ] A completion report by department, with export

### E10-03 Training records and assignments

**Status:** open · **Priority:** P3 · **Type:** feature

As a security lead, I record which training each person has completed and when it must
be repeated, and assign courses to groups.

**Acceptance criteria**

- [ ] Courses with a repeat interval
- [ ] Completion records per person with a date and optional score
- [ ] Assignment to roles, departments or everyone
- [ ] A list of overdue training
- [ ] Completion can be imported from a file

### E10-04 Exceptions register

**Status:** open · **Priority:** P2 · **Type:** feature

As a security lead, I record each agreed exception to a policy or control with its
reason, the compensating measures, who approved it and when it expires.

**Acceptance criteria**

- [ ] An `exception` record type linked to a policy, outcome, system or asset
- [ ] An approver and an expiry date are required
- [ ] Needs `exceptions.approve` to approve
- [ ] Expired exceptions are flagged and listed
- [ ] An exception can be linked to a risk

### E10-05 Exercises with findings

**Status:** open · **Priority:** P3 · **Type:** feature

As a security lead, I plan a tabletop or technical exercise, record who took part and
what was learned, and turn the findings into actions.

**Acceptance criteria**

- [ ] An `exercise` record type with scenario, date, participants and objectives
- [ ] Findings are recorded and each can raise an action (source "exercise")
- [ ] An exercise can reuse a security incident scenario checklist
- [ ] A list shows when each kind of exercise was last run

### E10-06 Vulnerability register

**Status:** open · **Priority:** P2 · **Type:** feature

As a security lead, I track each vulnerability with its severity, the assets or systems
it affects, who will fix it and by when.

**Acceptance criteria**

- [ ] A `vulnerability` record type with severity and status as configurable lists
- [ ] Linked to one or more assets or systems
- [ ] Owner, due date and fix notes
- [ ] A vulnerability can be accepted with an exception (E10-04)
- [ ] Views by severity, by system and overdue

### E10-07 Import scanner findings

**Status:** open · **Priority:** P3 · **Type:** feature

As a security lead, I load the output of a vulnerability scanner and get new findings
added, known ones updated and fixed ones closed.

**Acceptance criteria**

- [ ] CSV import with column mapping and a dry run
- [ ] Findings are matched to assets by serial, tag, name or address
- [ ] A finding missing from a later scan is marked fixed, not deleted
- [ ] Unmatched hosts are listed for review
- [ ] Reuses the asset import pattern ([E13-01](E13-imports-api-integrations.md))

### E10-08 Fix-by dates by severity for vulnerabilities

**Status:** open · **Priority:** P3 · **Type:** feature

As a security lead, each vulnerability gets a fix-by date from its severity and the
criticality of what it affects, and overdue ones are reported.

**Acceptance criteria**

- [ ] Days allowed per severity held as a setting
- [ ] The due date is computed and can be overridden with a reason
- [ ] An overdue report by system owner
