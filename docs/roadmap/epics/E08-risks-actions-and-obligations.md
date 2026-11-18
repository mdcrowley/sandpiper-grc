# E08 Risks, actions and obligations

**Status:** in progress

## Goal

Keep a risk register that scores risks on scales the organisation chooses, shows them
on a heat map, and records formal acceptance; one action tracker shared by every
module; and a register of the obligations the organisation must meet.

## Scope notes

- Covers `server/src/modules/risks/` and `web/src/modules/risks/`.
- Record types: `risk` (restricted), `action`, `obligation`.
- Risks are restricted: they need `security.view` as well as the `risks` permission.
- The `action` type is the shared to-do list for all modules (see `CLAUDE.md`,
  "Actions (shared contract)").
- Obligations are organisation data. None ship with the application; they come from the
  organisation profile or are entered by hand.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E08-01 | Risk register | done | P1 |
| E08-02 | Configurable risk scales | done | P1 |
| E08-03 | Inherent and residual scoring | done | P1 |
| E08-04 | Heat map | done | P1 |
| E08-05 | Risk summary | done | P2 |
| E08-06 | Risk acceptance with an approver rule | done | P1 |
| E08-07 | List of acceptances about to expire (API) | done | P2 |
| E08-08 | Action tracker | done | P1 |
| E08-09 | Action summary by owner, source and department | done | P2 |
| E08-10 | Actions raised from other modules | done | P2 |
| E08-11 | Obligations register | done | P1 |
| E08-12 | Obligations loaded from the organisation profile | done | P2 |
| E08-13 | Screen for editing risk scales | open | P2 |
| E08-14 | Revoke a risk acceptance | open | P2 |
| E08-15 | Act on expired acceptances | open | P2 |
| E08-16 | Hide actions that come from a restricted risk | done | P1 |
| E08-17 | Risk review reminders | open | P3 |

---

### E08-01 Risk register

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, I record each risk with its cause, consequence, what it affects,
existing controls, treatment, owner, due date and next review.

**Acceptance criteria**

- [x] Risks are numbered automatically
- [x] Category, treatment and status are configurable lists
- [x] The register is sorted by residual score by default
- [x] Risks are invisible to people without `security.view`, everywhere
- [x] Detail page with scoring, acceptance, actions, history, comments and links

**Implemented in:** `risk` resource (`server/src/modules/risks/index.ts`); `web/src/modules/risks/RiskRegister.tsx`, `RiskDetail.tsx`

### E08-02 Configurable risk scales

**Status:** done · **Priority:** P1 · **Type:** feature

As a risk administrator, I define the scales risks are scored on: the likelihood and
impact levels, the ratings, the matrix that turns a pair into a rating, and the rating
at which acceptance needs an executive.

**Acceptance criteria**

- [x] Scales are data; a 5 by 5 scale and a second, hazard-style scale are seeded
- [x] Each risk category chooses its scale
- [x] A scale can be added or changed by people with `risks.administer`
- [x] A level that risks are scored on cannot be removed
- [x] Changing a scale re-rates the risks on it and is audited
- [ ] A screen for this (see E08-13); today it is API only

**Implemented in:** `server/src/modules/risks/scales.ts`; `GET/POST /api/risks/scales`, `GET/PATCH /api/risks/scales/:key` (`index.ts`)

### E08-03 Inherent and residual scoring

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, I score a risk before and after controls, and the rating and a
summary level are worked out from the scale.

**Acceptance criteria**

- [x] Scores must be levels of the risk's scale
- [x] Likelihood and impact must be given together
- [x] Rating, score and summary level are computed, never typed
- [x] The scoring panel previews the rating as I choose levels

**Implemented in:** `prepareRisk` (`server/src/modules/risks/index.ts`), `scoreRisk` (`scales.ts`); `web/src/modules/risks/ScoringPanel.tsx`

### E08-04 Heat map

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, I see how many risks sit in each likelihood-by-impact cell, on
either the inherent or the residual basis, and click a cell to list its risks.

**Acceptance criteria**

- [x] One heat map per scale
- [x] Inherent or residual basis
- [x] Closed risks left out unless asked for
- [x] Totals per rating and a count of unscored risks
- [x] Choosing a cell filters the register

**Implemented in:** `GET /api/risks/heatmap` (`server/src/modules/risks/index.ts`); `web/src/modules/risks/HeatMap.tsx`

### E08-05 Risk summary

**Status:** done · **Priority:** P2 · **Type:** feature

As a manager, I see counts of open risks by summary level across all scales and the ten
highest-rated risks.

**Acceptance criteria**

- [x] Counts by summary level, split by scale
- [x] The top ten open risks by score
- [x] Used on the risk register and the overview dashboard

**Implemented in:** `GET /api/risks/summary` (`server/src/modules/risks/index.ts`); `web/src/modules/risks/RiskSummary.tsx`

### E08-06 Risk acceptance with an approver rule

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, I record that a risk has been accepted, by whom, why and until
when. A risk rated at or above the scale's threshold needs a named executive, their
title and a reference for the approval.

**Acceptance criteria**

- [x] A risk must be scored before it can be accepted
- [x] Rationale and expiry date are required; expiry must be after approval
- [x] At or above the threshold, approver name, title and reference are required
- [x] A risk cannot be marked "accepted" without a current acceptance
- [x] Recording an acceptance needs `risks.approve` and is audited
- [x] The risk page shows the acceptance history

**Implemented in:** `GET/POST /api/risks/:id/acceptances` (`server/src/modules/risks/index.ts`); `web/src/modules/risks/AcceptancePanel.tsx`

### E08-07 List of acceptances about to expire (API)

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I can ask which accepted risks have an acceptance that has expired
or will expire within a number of days.

**Acceptance criteria**

- [x] Returns the latest acceptance of each accepted risk inside the window
- [x] Shows days left and whether it has already expired
- [ ] Shown on a screen (covered by E08-15)

**Implemented in:** `GET /api/risks/acceptances-expiring` (`server/src/modules/risks/index.ts`). No screen calls it yet.

### E08-08 Action tracker

**Status:** done · **Priority:** P1 · **Type:** feature

As anyone with follow-up work, I see all actions in one place with their owner, due
date, priority, status and where they came from.

**Acceptance criteria**

- [x] Actions are numbered automatically
- [x] Status, priority and source are configurable lists
- [x] Marking an action done stamps the completion date; reopening clears it
- [x] Filters for open, overdue and due this week
- [x] Status can be changed from the list

**Implemented in:** `action` resource (`server/src/modules/risks/index.ts`); `web/src/modules/risks/ActionTracker.tsx`, `ActionStatus.tsx`

### E08-09 Action summary by owner, source and department

**Status:** done · **Priority:** P2 · **Type:** feature

As a manager, I see how many actions are open, overdue, due this week and unassigned,
broken down by owner, source and department.

**Acceptance criteria**

- [x] Headline counts
- [x] Breakdown by owner, source and department with overdue counts
- [x] Used on the action tracker and the overview dashboard

**Implemented in:** `GET /api/actions/summary` (`server/src/modules/risks/index.ts`)

### E08-10 Actions raised from other modules

**Status:** done · **Priority:** P2 · **Type:** feature

As a user of any module, follow-up work raised from a risk or an imported register
lands in the one action tracker with a pointer back to where it came from, and any
other module can raise actions the same way.

**Acceptance criteria**

- [x] An action records its source type and source record
- [x] Other modules create actions through the shared registry, not their own tables
- [x] A risk page lists its actions and can add one

**Implemented in:** `source_type` and `source_id` on `action` (`server/src/modules/risks/index.ts`); `web/src/modules/risks/ActionsPanel.tsx`; used today by the vendor register import (`server/src/modules/vendors/seed.ts`) and the risks seed

### E08-11 Obligations register

**Status:** done · **Priority:** P1 · **Type:** feature

As a compliance lead, I list each obligation the organisation must meet, where it comes
from, who owns it, how it is met, the evidence, and when it is next due.

**Acceptance criteria**

- [x] Obligations are numbered automatically
- [x] Status is a configurable list (not assessed, met, partly met, not met)
- [x] No obligations exist on a fresh installation
- [x] List, detail page, history, comments and links

**Implemented in:** `obligation` resource (`server/src/modules/risks/index.ts`); routes `/obligations` in `web/src/modules/risks/index.tsx`

### E08-12 Obligations loaded from the organisation profile

**Status:** done · **Priority:** P2 · **Type:** feature

As the person setting up an installation, I list my organisation's obligations in the
private profile and load them once.

**Acceptance criteria**

- [x] Obligations in the profile are created by the seed command
- [x] Running again never overwrites an edit made in the application
- [x] An optional delimited file of information requests becomes actions

**Implemented in:** `server/src/modules/risks/seed.ts`

### E08-13 Screen for editing risk scales

**Status:** open · **Priority:** P2 · **Type:** feature

As a risk administrator, I edit levels, ratings, the matrix and the acceptance
threshold on a screen, and see how many risks will be re-rated before I save.

**Acceptance criteria**

- [ ] Levels and ratings are editable tables
- [ ] The matrix is a grid with a rating picker in each cell
- [ ] The acceptance threshold is chosen from the ratings
- [ ] Saving uses the existing scale routes and shows the server's validation messages
- [ ] Needs `risks.administer`

### E08-14 Revoke a risk acceptance

**Status:** open · **Priority:** P2 · **Type:** feature

As a security lead, I can withdraw an acceptance when circumstances change, with a
reason, and the risk returns to an open status.

**Acceptance criteria**

- [ ] An acceptance can be revoked with a reason and date; it is never deleted
- [ ] The risk's status changes back and the change is audited
- [ ] Needs `risks.approve`

### E08-15 Act on expired acceptances

**Status:** open · **Priority:** P2 · **Type:** improvement

As a security lead, a risk whose acceptance has expired stops being shown as accepted
and appears on a list of acceptances to renew. Today expiry does not change the status.

**Acceptance criteria**

- [ ] A daily check moves risks with an expired acceptance to a "needs review" status
- [ ] The change is audited as a system event
- [ ] A screen lists expiring and expired acceptances (using the existing endpoint)
- [ ] The overview dashboard shows the count

### E08-16 Hide actions that come from a restricted risk

**Status:** done · **Priority:** P1 · **Type:** bug

As a security lead, I do not want the title of an action that was raised from a
restricted risk (or security incident) to be visible to everyone who can see actions.

Solved generally: actions are `restricted: 'flag'` and inherit the flag from their source
record ([E01-26](E01-platform-foundations.md)). The flag is set by the server, follows the
action when its source changes and the source when its restriction changes, and is
repaired for existing actions at every start.

**Acceptance criteria**

- [x] An action whose source record is restricted is hidden from people without `security.view`
- [x] This holds in lists, counts, statistics, the summary, single reads, search, pickers, exports, links, comments, history and the audit search
- [x] A person cannot raise an action on, or move one to, a record they cannot see
- [x] A test covers an agent with `actions.view` but without `security.view`
- [ ] Not done: sharing one restricted action with one person who lacks `security.view` (for example its owner)

**Implemented in:** the `action` resource and `GET /api/actions/summary` (`server/src/modules/risks/index.ts`); `server/src/modules/risks/migrations/002_action_restriction_and_scale_key.sql`; `restrictedFrom` (`server/src/core/resource.ts`); tests in `server/src/modules/risks/risks.test.ts` and `server/src/core/core.test.ts`

### E08-17 Risk review reminders

**Status:** open · **Priority:** P3 · **Type:** feature

As a risk owner, I am reminded when a risk's next review date arrives.

**Acceptance criteria**

- [ ] A list of risks whose review is due or overdue
- [ ] The owner is notified (depends on [E14-03](E14-platform-services.md))
- [ ] Completing a review records the date and sets the next one
