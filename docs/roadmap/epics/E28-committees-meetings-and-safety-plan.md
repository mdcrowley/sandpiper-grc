# E28 Committees, meetings and the safety plan (wave 10)

**Status:** done (11 of 11 issues done)

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
| E28-01 | Key and area | done | P2 |
| E28-02 | Committees, members by side, quorum | done | P2 |
| E28-03 | Meetings, agenda, frozen pack, attendance | done | P2 |
| E28-04 | Minutes approval | done | P2 |
| E28-05 | Decisions register | done | P2 |
| E28-06 | A decision completes a workflow step | done | P3 |
| E28-07 | Meeting actions | done | P2 |
| E28-08 | Safety plan element map | done | P2 |
| E28-09 | Annual multi-party plan review | done | P2 |
| E28-10 | Reminders | done | P2 |
| E28-11 | Sample data and guide | done | P2 |

---

### E28-01 Key and area

**Status:** done · **Priority:** P2 · **Type:** feature

An administrator wants committee work to have its own permissions and switch.

**Acceptance criteria**

- [x] Permission key `governance` and feature area `governance` (wave 10 step 0)
- [x] A Governance group in the menu (wave 10 step 0; shown once it has entries): Committees, Meetings, Decisions
- [x] Shared list values (action source "Meeting", notification kind "Committees and meetings") are added once every module has seeded its lists, and disappear with the area

**Implemented in:** `server/src/modules/governance/index.ts`; `web/src/modules/governance/index.tsx`

### E28-02 Committees, members by side, quorum

**Status:** done · **Priority:** P2 · **Type:** feature

A committee secretary wants the members of each committee, which side they sit for, who votes, and the quorum rule.

**Acceptance criteria**

- [x] `committee` records (`COM-` numbers): kind, purpose, chair, secretary, quorum rule, how often it meets, joint labor-management
- [x] Members (`/api/committees/:id/members`): an account, a roster person (contract C4, when the people module is loaded) or a typed name; side, role, voting, term. Names of accounts and roster people are read from them, never copied
- [x] Quorum as a count or a percentage of voting members (rounded up; a majority when unset); `GET /api/committees/:id/quorum`
- [x] A joint committee without members in office from both management and labor shows a warning

**Implemented in:** `server/src/modules/governance/committees.ts`; `web/src/modules/governance/Committees.tsx`

### E28-03 Meetings, agenda, frozen pack, attendance

**Status:** done · **Priority:** P2 · **Type:** feature

A secretary wants to plan a meeting, build its agenda from records, freeze the report pack sent out and record attendance.

**Acceptance criteria**

- [x] `meeting` records (`MTG-` numbers) with the chair and secretary of the day; agenda items (about a record, or an approval waiting for the chair) and attendance
- [x] `POST /api/meetings/:id/freeze-pack` produces a report pack with the caller's permissions (also needs `reports.export`) and keeps it with the meeting
- [x] Quorum worked out from attendance (voting members in office on the meeting's day); `quorum_met` read-only
- [x] Agenda items name only records the reader may see

**Implemented in:** `server/src/modules/governance/meetings.ts`; `web/src/modules/governance/Meetings.tsx`

### E28-04 Minutes approval

**Status:** done · **Priority:** P2 · **Type:** feature

A chair wants to approve the minutes in the application.

**Acceptance criteria**

- [x] Approval kind `meeting_minutes` (default workflow "Minutes approval": the meeting's chair); `POST /api/meetings/:id/minutes/submit` by the secretary
- [x] Approval sets the status to minutes approved, which nobody can set by hand, and locks the meeting (details, minutes, agenda, attendance, decisions); minutes cannot change while they wait

**Implemented in:** `meetings.ts`

### E28-05 Decisions register

**Status:** done · **Priority:** P2 · **Type:** feature

Anyone preparing an audit wants every committee decision in one register, linked to the record decided.

**Acceptance criteria**

- [x] `meeting_decision` records (`DEC-` numbers), restricted with the record decided (`restrictedFrom`)
- [x] `/governance/decisions` and each meeting's Decisions tab
- [x] Links with relation `decided`, kept in step with the decision

**Implemented in:** `server/src/modules/governance/decisions.ts`; `web/src/modules/governance/Decisions.tsx`

### E28-06 A decision completes a workflow step

**Status:** done · **Priority:** P3 · **Type:** feature

A chair wants a decision taken at a meeting to complete the approval step waiting for them. A stretch goal.

**Acceptance criteria**

- [x] `POST /api/meeting-decisions/:id/apply` goes through `approvalEngine(app).decide` with the chair as the deciding user, only when the chair may decide the current step now (named approver, kind's permission rechecked, may see the record, not the requester, different person per step)
- [x] By the chair, or by the secretary (with `governance.edit`) once the chair has approved the minutes; claimed before deciding, so it applies once
- [x] `GET /api/governance/waiting-decisions?committee=`
- [x] Audited on both records

**Implemented in:** `decisions.ts`; `Meetings.tsx`, `Decisions.tsx`, `Committees.tsx` (Waiting for the chair)

### E28-07 Meeting actions

**Status:** done · **Priority:** P2 · **Type:** feature

A secretary wants the actions agreed at a meeting in the action tracker.

**Acceptance criteria**

- [x] Actions with source `meeting` on the meeting (Actions tab)

**Implemented in:** `index.ts` (action source), `web/src/modules/governance/shared.tsx`

### E28-08 Safety plan element map

**Status:** done · **Priority:** P2 · **Type:** feature

A safety manager wants to see where each element of the safety plan is covered and who owns it.

**Acceptance criteria**

- [x] `GET` and `PUT /api/policies/:id/plan-elements`, and `GET /api/policies/:id/plan`
- [x] An operator-defined element list (`plan_element`), with four generic safety-management pillars as defaults
- [x] The plan panel on the policy page, for document types marked as plans (`meta.plan`)

**Implemented in:** `server/src/modules/policies/plans.ts`, `policies/migrations/004_plans.sql`; `web/src/modules/policies/PlanPanel.tsx`, `PolicyPage.tsx`

### E28-09 Annual multi-party plan review

**Status:** done · **Priority:** P2 · **Type:** feature

An accountable executive wants the yearly review of the plan approved by each party in turn.

**Acceptance criteria**

- [x] Approval kind `plan_review` with a three-step default workflow (accountable executive, governing body, safety committee; a different person per step)
- [x] Approval sets the next review date from the document type's review cycle
- [x] `POST /api/policies/:id/plan-review` (one review at a time)

**Implemented in:** `plans.ts`; `PlanPanel.tsx`

### E28-10 Reminders

**Status:** done · **Priority:** P2 · **Type:** feature

A secretary wants reminders when a pack is due, minutes wait for approval or the plan review nears.

**Acceptance criteria**

- [x] Job `governance.reminders` (pack due, minutes not submitted 7 days after the meeting), `POST /api/governance/reminders/run`
- [x] Setting `governance.pack_days` (5)
- [x] Plan review reminders run with the policies (job `policies.plan_reviews`, setting `policies.plan_review_reminder_days`, 30), so they follow the policies area rather than the committees one

**Implemented in:** `governance/reminders.ts`, `policies/plans.ts`

### E28-11 Sample data and guide

**Status:** done · **Priority:** P2 · **Type:** docs

Users need invented committees, meetings and a sample safety plan, and a guide page.

**Acceptance criteria**

- [x] Invented sample data: three committees (one joint labor-management), four meetings, decisions, actions, a sample safety plan; a decision applied to a waiting approval when one waits for the board's chair
- [x] `docs/user/28-committees-and-meetings.md` and a Plans section in `11-policies-and-exceptions.md`

**Implemented in:** `governance/seed.ts`; `docs/user/28-committees-and-meetings.md`, `docs/user/11-policies-and-exceptions.md`
