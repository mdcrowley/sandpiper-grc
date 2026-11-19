# E08 Risks, actions and obligations

**Status:** in progress

## Goal

Keep a risk register that scores risks on scales the organization chooses, shows them
on a heat map, and records formal acceptance; one action tracker shared by every
module; and a register of the obligations the organization must meet.

## Scope notes

- Covers `server/src/modules/risks/` and `web/src/modules/risks/`.
- Record types: `risk` (restricted), `action`, `obligation`.
- Risks are restricted: they need `security.view` as well as the `risks` permission.
- The `action` type is the shared to-do list for all modules (see `docs/development.md`,
  "Actions (shared contract)"). `web/src/modules/risks/ActionsPanel.tsx`
  (`{ sourceType, sourceId, source? }`) is embedded by other modules.
- Obligations are organization data. None ship with the application; they come from the
  organization profile or are entered by hand (the dev profile adds four invented examples).
- Transit operators are the target sector: the safety hazard matrix (`hazard_4x5`) is the
  matrix used in transit safety management, and the sample risks are invented transit examples.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E08-01 | Risk register | done | P1 |
| E08-02 | Configurable risk scales | done | P1 |
| E08-03 | Inherent and residual scoring | done | P1 |
| E08-04 | Heat map | done | P1 |
| E08-05 | Risk summary | done | P2 |
| E08-06 | Risk acceptance with an approver rule | done | P1 |
| E08-07 | List of acceptances about to expire | done | P2 |
| E08-08 | Action tracker for the weekly review | done | P1 |
| E08-09 | Action summary by owner, source and department | done | P2 |
| E08-10 | Actions raised from other modules | done | P2 |
| E08-11 | Obligations register | done | P1 |
| E08-12 | Obligations and information requests loaded at seed time | done | P2 |
| E08-13 | Screen for editing risk scales | done | P2 |
| E08-14 | Revoke a risk acceptance | done | P2 |
| E08-15 | Act on expired acceptances | done | P2 |
| E08-16 | Hide actions that come from a restricted risk | done | P1 |
| E08-17 | Risk review reminders | done | P3 |
| E08-18 | Action notifications | done | P2 |
| E08-19 | Board-pack risk report | done | P2 |
| E08-20 | Risk page as a story | done | P2 |
| E08-21 | Expired-acceptance count on the overview dashboard | done | P3 |
| E08-22 | Obligation due-date reminders | open | P3 |

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
- [x] Detail page with scoring, acceptance, actions, reviews, history, comments, attachments and links
- [x] Bulk change of owner, treatment, category, review and due dates from the list

**Implemented in:** `risk` resource (`server/src/modules/risks/index.ts`); `web/src/modules/risks/RiskRegister.tsx`, `RiskDetail.tsx`

### E08-02 Configurable risk scales

**Status:** done · **Priority:** P1 · **Type:** feature

As a risk administrator, I define the scales risks are scored on: the likelihood and
impact levels, the ratings, the matrix that turns a pair into a rating, and the rating
at which acceptance needs an executive.

**Acceptance criteria**

- [x] Scales are data; a 5 by 5 scale and the safety hazard matrix (4 by 5) are seeded
- [x] The hazard scale is described as the matrix used in transit safety management; an unedited older description is updated at start-up
- [x] Each risk category chooses its scale
- [x] A scale can be added or changed by people with `risks.administer`
- [x] A level that risks are scored on cannot be removed
- [x] Changing a scale re-rates the risks on it and is audited
- [x] A screen for this (E08-13)

**Implemented in:** `server/src/modules/risks/scales.ts`; `GET/POST /api/risks/scales`, `GET/PATCH /api/risks/scales/:key`, `POST /api/risks/scales/:key/preview` (`index.ts`)

### E08-03 Inherent and residual scoring

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, I score a risk before and after controls, and the rating and a
summary level are worked out from the scale.

**Acceptance criteria**

- [x] Scores must be levels of the risk's scale
- [x] Likelihood and impact must be given together
- [x] Rating, score and summary level are computed, never typed
- [x] The assessment previews the rating and the position on a small matrix as I choose levels

**Implemented in:** `prepareRisk` (`server/src/modules/risks/index.ts`), `scoreRisk` (`scales.ts`); `web/src/modules/risks/ScoringPanel.tsx`, `MiniMatrix` in `scales.tsx`

### E08-04 Heat map

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, I see how many risks sit in each likelihood-by-impact cell, on
either the inherent or the residual basis, and click a cell to list its risks.

**Acceptance criteria**

- [x] One heat map per scale, with a scale switcher; axis and level names come from the scale
- [x] Inherent or residual basis
- [x] Closed risks left out unless asked for (`include_closed=true`; "Include closed risks")
- [x] Totals per rating in a legend, and a count of unscored risks
- [x] Each cell names its rating in words, so color never carries it alone; keyboard navigation with the arrow keys
- [x] Optional movement arrows from each risk's inherent cell to its residual cell
- [x] A ranked list of the highest risks beside the matrix
- [x] Choosing a cell filters the register; scale, basis, cell, movement and closed are kept in the address
- [x] A summary strip above it and a print layout for a board pack

**Implemented in:** `GET /api/risks/heatmap` (`server/src/modules/risks/index.ts`); `web/src/modules/risks/HeatMap.tsx`, `RiskRegister.tsx`, `risks.css`; tests in `lifecycle.test.ts` ("heat map extras")

### E08-05 Risk summary

**Status:** done · **Priority:** P2 · **Type:** feature

As a manager, I see counts of open risks by summary level across all scales, the
highest-rated risks and what needs attention.

**Acceptance criteria**

- [x] Counts by summary level, split by scale
- [x] The top ten open risks by score
- [x] Counts of risks needing review, reviews due, acceptances expiring and expired
- [x] Used on the risk register's summary strip and the overview dashboard

**Implemented in:** `GET /api/risks/summary` (`server/src/modules/risks/index.ts`); the strip in `web/src/modules/risks/RiskRegister.tsx`

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
- [x] The risk page explains the rule for that risk, shows an expiry countdown and the acceptance history

**Implemented in:** `GET/POST /api/risks/:id/acceptances` (`server/src/modules/risks/index.ts`); `web/src/modules/risks/AcceptancePanel.tsx`

### E08-07 List of acceptances about to expire

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I can see which accepted risks have an acceptance that has expired
or will expire within a number of days.

**Acceptance criteria**

- [x] Returns the latest standing acceptance of each accepted (or needs-review) risk inside the window
- [x] Shows days left and whether it has already expired
- [x] Shown on a screen with a 30, 60 or 90-day window

**Implemented in:** `GET /api/risks/acceptances-expiring` (`server/src/modules/risks/index.ts`); `web/src/modules/risks/RiskReviews.tsx`

### E08-08 Action tracker for the weekly review

**Status:** done · **Priority:** P1 · **Type:** feature

As anyone with follow-up work, I see all actions in one place with their owner, due
date, priority, status and where they came from, grouped the way a weekly review reads
them, and I can update them without leaving the page.

**Acceptance criteria**

- [x] Actions are numbered automatically
- [x] Status, priority and source are configurable lists
- [x] Marking an action done stamps the completion date; reopening clears it
- [x] Tiles for open, overdue, due this week and unassigned
- [x] Grouped by due week (overdue first), by owner or by source, or a plain list
- [x] Inline completion, status change and owner change; overdue rows emphasized
- [x] Quick add (press N); bulk change of status, priority, owner or due date
- [x] "My actions" for the signed-in person

**Implemented in:** `action` resource (`server/src/modules/risks/index.ts`); `web/src/modules/risks/ActionTracker.tsx`, `ActionRows.tsx`, `ActionStatus.tsx`, `MyActions.tsx`, `ActionDetail.tsx`

### E08-09 Action summary by owner, source and department

**Status:** done · **Priority:** P2 · **Type:** feature

As a manager, I see how many actions are open, overdue, due this week and unassigned,
broken down by owner, source and department.

**Acceptance criteria**

- [x] Headline counts, and the same for the signed-in person
- [x] Breakdown by owner, source and department with overdue counts
- [x] Used on the action tracker, "My actions" and the overview dashboard

**Implemented in:** `GET /api/actions/summary` (`server/src/modules/risks/index.ts`)

### E08-10 Actions raised from other modules

**Status:** done · **Priority:** P2 · **Type:** feature

As a user of any module, follow-up work raised from a record lands in the one action
tracker with a pointer back to where it came from.

**Acceptance criteria**

- [x] An action records its source type and source record
- [x] Other modules create actions through the shared registry, not their own tables
- [x] `ActionsPanel` lists a record's actions with progress and overdue count, and adds (inline or in a form) and completes them in place
- [x] Sources include change, vulnerability, policy, training, vendor and problem; an action raised on a record is filed under that record's kind when no source is given

**Implemented in:** `source_type` and `source_id` on `action`, `sourceFor` (`server/src/modules/risks/actions.ts`); `web/src/modules/risks/ActionsPanel.tsx`

### E08-11 Obligations register

**Status:** done · **Priority:** P1 · **Type:** feature

As a compliance lead, I list each obligation the organization must meet, where it comes
from, who owns it, how it is met, the evidence, and when it is next due.

**Acceptance criteria**

- [x] Obligations are numbered automatically
- [x] Status is a configurable list (not assessed, met, partly met, not met)
- [x] No obligations exist on a fresh installation
- [x] List with tiles (not met, partly met, overdue, due in 30 days) and next-due countdowns
- [x] Detail page with an Evidence tab for files, history, comments and links

**Implemented in:** `obligation` resource (`server/src/modules/risks/index.ts`); `web/src/modules/risks/Obligations.tsx`

### E08-12 Obligations and information requests loaded at seed time

**Status:** done · **Priority:** P2 · **Type:** feature

As the person setting up an installation, I list my organization's obligations in the
private profile and load them once, and load a file of information requests as actions.

**Acceptance criteria**

- [x] Obligations in the profile are created by the seed command (with an optional `status`)
- [x] Running again never overwrites an edit made in the application
- [x] An optional delimited file of information requests becomes actions
- [x] Re-running the import updates changed rows field by field, keeps fields edited in the application, and never restores a deleted request

**Implemented in:** `server/src/modules/risks/seed.ts` (`import_snapshot` column, migration `003`); test "updates changed information requests on a re-run" in `risks.test.ts`

### E08-13 Screen for editing risk scales

**Status:** done · **Priority:** P2 · **Type:** feature

As a risk administrator, I edit levels, ratings, the matrix and the acceptance
threshold on a screen, and see how many risks will be re-rated before I save.

**Acceptance criteria**

- [x] Levels and ratings are editable tables
- [x] The matrix is a grid with a rating picker in each cell
- [x] The acceptance threshold is chosen from the ratings
- [x] Saving uses the existing scale routes and shows the server's validation messages
- [x] A preview says how many risks would be re-rated (only to people with `security.view`) and whether a removed level is in use
- [x] Needs `risks.administer`

**Implemented in:** `web/src/modules/risks/ScaleEditor.tsx`; `POST /api/risks/scales/:key/preview` (`server/src/modules/risks/index.ts`)

### E08-14 Revoke a risk acceptance

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I can withdraw an acceptance when circumstances change, with a
reason, and the risk returns to an open status.

**Acceptance criteria**

- [x] An acceptance can be revoked with a reason and date; it is never deleted
- [x] The risk's status changes back (unless another acceptance still stands) and the change is audited
- [x] The owner is notified
- [x] Needs `risks.approve` and `security.view`

**Implemented in:** `POST /api/risks/:id/acceptances/:acceptanceId/revoke` (`server/src/modules/risks/lifecycle.ts`); `AcceptancePanel.tsx`; migration `003_reviews_revocation_shares.sql`

### E08-15 Act on expired acceptances

**Status:** done · **Priority:** P2 · **Type:** improvement

As a security lead, a risk whose acceptance has expired stops being shown as accepted
and appears on a list of acceptances to renew.

**Acceptance criteria**

- [x] A regular check (every six hours, and `POST /api/risks/checks/run`) moves risks with an expired acceptance to "Needs review"
- [x] The change is audited as a system event and the owner is notified
- [x] The owner is told once when an acceptance comes within the reminder window (setting `risks.acceptance_reminder_days`, default 30)
- [x] A screen lists expiring and expired acceptances
- [x] The count is available in `GET /api/risks/summary` (`acceptances_expired`) and on the register's strip; showing it on the overview dashboard is E08-21

**Implemented in:** `runChecks` (`server/src/modules/risks/lifecycle.ts`); `RiskReviews.tsx`

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
- [x] This holds in lists (and their totals), single reads, search, pickers, exports, links, comments, history and the audit search. Statistics and the summary count it for everyone, with its owner and department shown as "Restricted records" (E18-40)
- [x] A person cannot raise an action on, or move one to, a record they cannot see
- [x] A test covers an agent with `actions.view` but without `security.view`
- [x] One restricted action can be shared deliberately with one named person who lacks `security.view`: they see it (never its source) under "My actions" and may change its status and notes; sharing is audited and can be withdrawn

**Implemented in:** the `action` resource and `GET /api/actions/summary` (`server/src/modules/risks/index.ts`); sharing in `server/src/modules/risks/actions.ts` (`/api/actions/:id/shares`, `/api/actions/shared-with-me`, `/api/actions/shared/:id`) and the Sharing tab in `ActionDetail.tsx`; `restrictedFrom` (`server/src/core/resource.ts`); tests in `risks.test.ts`, `lifecycle.test.ts` and `server/src/core/core.test.ts`

### E08-17 Risk review reminders

**Status:** done · **Priority:** P3 · **Type:** feature

As a risk owner, I am reminded when a risk's next review date arrives.

**Acceptance criteria**

- [x] A list of risks whose review is due or overdue
- [x] The owner is notified once per review date
- [x] Completing a review records the date, keeps the ratings as they stood, and sets the next one

**Implemented in:** `GET /api/risks/reviews-due`, `GET/POST /api/risks/:id/reviews` (`server/src/modules/risks/lifecycle.ts`); `ReviewPanel.tsx`, `RiskReviews.tsx`

### E08-18 Action notifications

**Status:** done · **Priority:** P2 · **Type:** feature

As an action owner, I am told when an action becomes mine, and reminded of due and
overdue work, without duplicate messages.

**Acceptance criteria**

- [x] Assigning an action to someone else notifies them (`kind: 'assignment'`); assigning to yourself does not
- [x] Due-soon and overdue reminders come from the notifications module's daily digest only; this module sends none
- [x] An owner who may not see a restricted action is not told its title

**Implemented in:** `notifyAssigned` (`server/src/modules/risks/actions.ts`); test "tells a person when an action becomes theirs" in `lifecycle.test.ts`

### E08-19 Board-pack risk report

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I print a one-document risk report for the board.

**Acceptance criteria**

- [x] Open risks by common level, the top risks with inherent and residual ratings, treatment and open actions
- [x] Movement since the last review (increased, reduced, unchanged, not reviewed)
- [x] Acceptances expired or expiring within 90 days
- [x] Prints cleanly; restricted like every risk route

**Implemented in:** `GET /api/risks/report` (`server/src/modules/risks/lifecycle.ts`); `web/src/modules/risks/RiskReport.tsx`

### E08-20 Risk page as a story

**Status:** done · **Priority:** P2 · **Type:** improvement

As a reader of a risk, I follow it from cause to treatment without hunting through tabs.

**Acceptance criteria**

- [x] Cause → event → consequence
- [x] Inherent → existing controls → residual, with rating chips and a small matrix
- [x] Treatment with its actions; acceptance with expiry countdown and the executive-approval rule explained; review date

**Implemented in:** `web/src/modules/risks/RiskDetail.tsx`, `ScoringPanel.tsx`, `AcceptancePanel.tsx`, `ReviewPanel.tsx`

### E08-21 Expired-acceptance count on the overview dashboard

**Status:** done · **Priority:** P3 · **Type:** improvement

As a security lead, I see on the overview dashboard how many acceptances have expired.

**Acceptance criteria**

- [x] The overview dashboard (`home` module) shows `acceptances_expired` and `needs_review` from `GET /api/risks/summary`, for people who may see risks (in Needs attention, linking to Risk reviews and to the register filtered on the needs-review status)

**Implemented in:** `NeedsAttention` in `web/src/modules/home/widgetsSummary.tsx`; `RiskSummary` in `web/src/modules/home/types.ts`

### E08-22 Obligation due-date reminders

**Status:** open · **Priority:** P3 · **Type:** feature

As an obligation owner, I am reminded before an obligation's next due date.

**Acceptance criteria**

- [ ] The owner is notified once when the next due date comes within a configurable window
- [ ] The obligations list can show only those due soon (exists today as a tile)
