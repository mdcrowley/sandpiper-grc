# E28 Committees, meetings and the safety plan (wave 10)

**Status:** open

## Goal

Run committees and their meetings in the application (members by side, quorum, agenda, frozen pack, attendance, minutes and a decisions register), let a recorded decision complete a waiting approval step, and keep the safety plan's element map and its annual multi-party review.

## Scope notes

- A new module `governance` with its own permission key and feature area ("Committees and meetings").
- The safety plan is a policy whose document type is `plan` (contract C6); its panel lives in the policies module folder.
- Joint labor-management committees are supported without naming any law that requires them.
- Issues marked "stretch" in the wave 10 plan carry priority P3; an unfinished one stays open for wave 11.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E28-01 | Key and area | open | P2 |
| E28-02 | Committees, members by side, quorum | open | P2 |
| E28-03 | Meetings, agenda, frozen pack, attendance | open | P2 |
| E28-04 | Minutes approval | open | P2 |
| E28-05 | Decisions register | open | P2 |
| E28-06 | A decision completes a workflow step | open | P3 |
| E28-07 | Meeting actions | open | P2 |
| E28-08 | Safety plan element map | open | P2 |
| E28-09 | Annual multi-party plan review | open | P2 |
| E28-10 | Reminders | open | P2 |
| E28-11 | Sample data and guide | open | P2 |

---

### E28-01 Key and area

**Status:** open · **Priority:** P2 · **Type:** feature

An administrator wants committee work to have its own permissions and switch.

**Acceptance criteria**

- [x] Permission key `governance` and feature area `governance` (wave 10 step 0)
- [x] A Governance group in the menu (wave 10 step 0; shown once it has entries)

### E28-02 Committees, members by side, quorum

**Status:** open · **Priority:** P2 · **Type:** feature

A committee secretary wants the members of each committee, which side they sit for, who votes, and the quorum rule.

**Acceptance criteria**

- [ ] `committee` records (`COM-` numbers) with members
- [ ] Quorum as a count or a percentage of voting members

### E28-03 Meetings, agenda, frozen pack, attendance

**Status:** open · **Priority:** P2 · **Type:** feature

A secretary wants to plan a meeting, build its agenda from records, freeze the report pack sent out and record attendance.

**Acceptance criteria**

- [ ] `meeting` records (`MTG-` numbers), agenda items and attendance
- [ ] `POST /api/meetings/:id/freeze-pack`
- [ ] Quorum worked out from attendance

### E28-04 Minutes approval

**Status:** open · **Priority:** P2 · **Type:** feature

A chair wants to approve the minutes in the application.

**Acceptance criteria**

- [ ] Approval kind `meeting_minutes`; approval sets the status to minutes approved

### E28-05 Decisions register

**Status:** open · **Priority:** P2 · **Type:** feature

Anyone preparing an audit wants every committee decision in one register, linked to the record decided.

**Acceptance criteria**

- [ ] `meeting_decision` records (`DEC-` numbers)
- [ ] `/governance/decisions`
- [ ] Links with relation `decided`

### E28-06 A decision completes a workflow step

**Status:** open · **Priority:** P3 · **Type:** feature

A chair wants a decision taken at a meeting to complete the approval step waiting for them. A stretch goal.

**Acceptance criteria**

- [ ] `POST /api/meeting-decisions/:id/apply`, by the secretary or chair, only when the chair is an approver of the current step
- [ ] `GET /api/governance/waiting-decisions`
- [ ] Audited on both records

### E28-07 Meeting actions

**Status:** open · **Priority:** P2 · **Type:** feature

A secretary wants the actions agreed at a meeting in the action tracker.

**Acceptance criteria**

- [ ] Actions with source `meeting` on the meeting

### E28-08 Safety plan element map

**Status:** open · **Priority:** P2 · **Type:** feature

A safety manager wants to see where each element of the safety plan is covered and who owns it.

**Acceptance criteria**

- [ ] `GET` and `PUT /api/policies/:id/plan-elements`
- [ ] An operator-defined element list, with four generic safety-management pillars as defaults
- [ ] The plan panel on the policy page

### E28-09 Annual multi-party plan review

**Status:** open · **Priority:** P2 · **Type:** feature

An accountable executive wants the yearly review of the plan approved by each party in turn.

**Acceptance criteria**

- [ ] Approval kind `plan_review` with a three-step default workflow
- [ ] Approval sets the next review date from the document type's review cycle
- [ ] `POST /api/policies/:id/plan-review`

### E28-10 Reminders

**Status:** open · **Priority:** P2 · **Type:** feature

A secretary wants reminders when a pack is due, minutes wait for approval or the plan review nears.

**Acceptance criteria**

- [ ] Job `governance.reminders`
- [ ] Settings `governance.pack_days` (5) and `governance.plan_review_reminder_days` (30)

### E28-11 Sample data and guide

**Status:** open · **Priority:** P2 · **Type:** docs

Users need invented committees, meetings and a sample safety plan, and a guide page.

**Acceptance criteria**

- [ ] Invented sample data
- [ ] `docs/user/28-committees-and-meetings.md` and a Plans section in `11-policies-and-exceptions.md`
