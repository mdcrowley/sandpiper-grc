# E05 Change enablement

**Status:** built (8 of 12 issues done; E05-08 and E05-11 in progress, E05-10 and E05-12 open)

## Goal

Let the IT team plan, assess, approve and review changes to systems so that changes are
visible before they happen, the right people agree to them, and anything that goes
wrong can be traced back to a change.

## Scope notes

- The module lives in `server/src/modules/changes/` and `web/src/modules/changes/`. The
  user guide is `docs/user/10-change-enablement.md`.
- One record type, `change` (table `changes`, references `CHG-`), with permission module
  `changes`. Approvals, standard change templates, blackout periods and acknowledged
  conflicts are child tables served by hand-written routes under `/api/changes/...`.
- What differs between installations is data, not code: the risk questionnaire and the
  approval rules are settings (`changes.questionnaire`, `changes.approval_rules`), edited
  on the **Change settings** page; types, statuses, risk levels and outcomes are lookup
  lists (`change_type`, `change_status`, `change_risk`, `change_outcome`). The allowed
  moves between statuses are each status value's `meta.next`, and `meta.pir` on an
  outcome makes a review compulsory.
- Affected systems and assets, and related tickets, problems and projects, are generic
  links (`record_links`); affected systems use the relation `affects`. The main system and
  asset are also `ref` fields on the change and are kept in step with their link.
- Approvals are recorded by hand (approver name, role, date, reference), in the same way
  as project gate decisions. There is no shared approval service yet
  ([E14-06](E14-platform-services.md)); see E05-09.
- Follow-up actions use the shared Actions contract and appear only when that module is
  loaded. Until the `action_source` list has a `change` value they are filed under
  `other` (E05-10).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E05-01 | Change record and register | done | P2 |
| E05-02 | Change types and risk assessment | done | P2 |
| E05-03 | Approval of changes | done | P2 |
| E05-04 | Change calendar | done | P3 |
| E05-05 | Link changes to systems, tickets and projects | done | P2 |
| E05-06 | Implementation, back-out plan and review | done | P3 |
| E05-07 | Standard change templates | done | P3 |
| E05-08 | Changes on the system page and the relationship map | in progress | P3 |
| E05-09 | Route approvals to named approvers | done | P3 |
| E05-10 | A "change" source for follow-up actions | open | P3 |
| E05-11 | Calendar and blackout refinements | in progress | P3 |
| E05-12 | Move a change by dragging it on the calendar | open | P3 |

---

### E05-01 Change record and register

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I raise a change with what will be done, why, when, and who will do it,
and everyone can see the register of planned and past changes.

**Acceptance criteria**

- [x] A `change` record type with reference numbers, built on the generic resource
- [x] Title, description, reason, planned start and end, implementer, status
- [x] Statuses are a configurable list
- [x] List, detail page, history, comments and links
- [x] Navigation entry under "Change", guarded by `changes.view`
- [x] Tests for create, update, permissions and audit

**Also delivered**

- Owner, actual start and end, outcome and outcome notes
- The status moves only through `POST /api/changes/:id/transition`; the allowed moves are
  enforced on the server, and a closed or cancelled change cannot be edited
- Register with count tiles and ready-made views: All changes, My changes, Awaiting
  approval, This week, Emergency
- A guided "New change" flow: type, template or details, risk, plans, schedule
- Invented sample data in both seed profiles: 14 changes, 2 templates, 2 blackout periods
  and one conflict

**Implemented in**

- `server/src/modules/changes/migrations/001_changes.sql`, `index.ts`, `defaults.ts`,
  `resource.ts`, `base.ts`, `workflow.ts`, `routes.ts`, `seed.ts`, `changes.test.ts`
- `web/src/modules/changes/index.tsx`, `ChangeList.tsx`, `ChangeDetail.tsx`,
  `ChangeActions.tsx`, `NewChange.tsx`, `NewChangeSteps.tsx`, `changes.css`

### E05-02 Change types and risk assessment

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I classify a change as standard, normal or emergency and answer a few
questions that give it a risk level, which decides how much approval it needs.

**Acceptance criteria**

- [x] Change types are a configurable list
- [x] A short risk questionnaire held as data
- [x] The risk level is computed and can be overridden with a reason
- [x] The type and risk level decide the approval path

**Notes**

- Questions, weights, answer scores and the score at which each level ends are edited on
  **Change settings > Risk questionnaire**; saving rescores drafts
- The type and the risk assessment are fixed once a change is submitted
- The behaviour of the built-in values `standard` (needs a template, no approval) and
  `emergency` (one approver, review compulsory) is in code; other types follow the rules

**Implemented in**

- `server/src/modules/changes/rules.ts`, `resource.ts`, `admin.ts`
- `web/src/modules/changes/RiskCard.tsx`, `QuestionnaireAdmin.tsx`, `bits.tsx`, `util.ts`

### E05-03 Approval of changes

**Status:** done · **Priority:** P2 · **Type:** feature

As an approver, I see changes waiting for me and approve or refuse each with a comment.
A change cannot move to "scheduled" without the approvals its type requires.

**Acceptance criteria**

- [x] Needs `changes.approve`
- [x] The requester cannot approve their own change
- [x] Emergency changes can be approved after the fact, and are flagged as such
- [x] Decisions are audited

**Notes**

- Approval rules by type and risk are data (**Change settings > Approval rules**): number
  of approvals, expected approver roles, whether a review is required, and whether
  approval may follow the work
- Each approval must come from a different named person; a rejection sends the change to
  Rejected; returning it to draft resets the count
- An emergency change never needs more than one approver. Approval after the fact is a
  rule option that ships switched off; when on, the approval is flagged and must be
  recorded before closure
- "Waiting for me" is the Awaiting approval view of every submitted change, not a list
  per approver; see E05-09

**Implemented in**

- `server/src/modules/changes/workflow.ts`, `rules.ts`, `admin.ts`
- `web/src/modules/changes/ApprovalsPanel.tsx`, `ApprovalDialog.tsx`, `RulesAdmin.tsx`

### E05-04 Change calendar

**Status:** done · **Priority:** P3 · **Type:** feature

As anyone in IT, I can see scheduled changes on a calendar and spot clashes and
freeze periods.

**Acceptance criteria**

- [x] Month and week views of scheduled changes
- [x] Freeze periods held as data and shown on the calendar
- [x] A warning when two changes to the same system overlap

**Notes**

- Freeze periods are called blackout periods in the application
- A change is flagged when it falls in a blackout period or overlaps another live change
  on a shared system. The warning shows in the "New change" flow as the window is typed,
  on the change, and on the calendar
- A flagged change cannot be scheduled or started until the conflict is resolved or
  someone with `changes.approve` acknowledges it with a reason. The override is audited
  and applies only to the planned window it was given for

**Implemented in**

- `server/src/modules/changes/conflicts.ts`, `admin.ts`
- `web/src/modules/changes/CalendarPage.tsx`, `CalendarMonth.tsx`, `CalendarWeek.tsx`,
  `ConflictsPanel.tsx`, `BlackoutsAdmin.tsx`

### E05-05 Link changes to systems, tickets and projects

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I record which systems a change touches, and link it to the ticket,
problem or project that caused it, so each of those shows the change in turn.

**Acceptance criteria**

- [x] One or more affected systems per change
- [x] A system page lists its recent and planned changes (through its Related tab, which
      shows every change linked to the system; a dated panel is E05-08)
- [x] Links to tickets, problems and projects use the generic links
- [ ] The relationship map can show what else a change may affect (moved to E05-08: the
      map belongs to the inventory module)

**Implemented in**

- `server/src/modules/changes/base.ts` (`systemsOf`, `syncPrimaryLink`), `resource.ts`
- `web/src/modules/changes/RelatedTab.tsx`

### E05-06 Implementation, back-out plan and review

**Status:** done · **Priority:** P3 · **Type:** feature

As an implementer, I record the plan, the test plan and how to back out, then the
outcome and a short review afterwards.

**Acceptance criteria**

- [x] Plan, test plan and back-out plan fields
- [x] Outcome: successful, successful with issues, backed out, failed
- [x] A review is required before closing a failed or emergency change
- [x] Follow-up work can be raised as actions

**Notes**

- A review is also required for a backed-out change (the outcome value's `meta.pir`) and
  wherever the approval rule says so
- The review holds what happened, the cause and the follow-up; recording it moves the
  change to Reviewed

**Implemented in**

- `server/src/modules/changes/workflow.ts` (`saveReview`, `raiseAction`)
- `web/src/modules/changes/ReviewTab.tsx`, `ChangeActions.tsx`

### E05-07 Standard change templates

**Status:** done · **Priority:** P3 · **Type:** feature

As an agent, I pick a pre-approved template for routine work and get a change that is
already filled in and needs no further approval.

**Acceptance criteria**

- [x] Templates are data, maintained by people with `changes.administer`
- [x] A change from a template is marked as standard and pre-approved
- [x] Template use is reported so over-use can be spotted

**Notes**

- A standard change can be raised only from a template; the template list shows uses in
  the last 90 days, uses in total and the last use

**Implemented in**

- `server/src/modules/changes/admin.ts` (`createFromTemplate`, template routes)
- `web/src/modules/changes/TemplatesAdmin.tsx`, `NewChangeSteps.tsx`

### E05-08 Changes on the system page and the relationship map

**Status:** in progress · **Priority:** P3 · **Type:** feature

As anyone looking at a system, I see its recent and planned changes with their dates
and status, and on the relationship map I can see what else a change may affect.

**Acceptance criteria**

- [ ] The system page has a panel of changes that affect it, newest first, with status
      and planned window (inventory module; the data is the `affects` links and
      `GET /api/changes?f.system_id=`)
- [x] The data is ready for it: `GET /api/changes?f.system_id=<id>` filters by main system,
      and `GET /api/changes/calendar?from=&to=&system_id=<id>` returns every change affecting the
      system (main system or `affects` link) with the blackout periods that apply to it; the
      change calendar takes `?system=<id>` so a system page can link to it
- [ ] The relationship map can start from a change and highlight the systems it affects
      and their neighbours
- [ ] Assets get the same panel

### E05-09 Route approvals to named approvers

**Status:** done · **Priority:** P3 · **Type:** feature

As an approver, I am told when a change is waiting for me and can approve it myself in
the application, instead of someone recording my decision from an email.

**Acceptance criteria**

- [ ] Reuses the shared approval service ([E14-06](E14-platform-services.md)) once it exists (not built yet; the change module keeps its own)
- [x] An approval rule can name users or roles, not only role titles; it says how many must approve
- [x] A "Waiting for me" view and a notification for each approver
- [x] The recorded-by-hand route stays for approvals given outside the application

**Notes**

- The approvers are fixed when a change is submitted (`changes.approver_pool`), so a later rule edit does not change who decides
- Each approver records their own decision (`POST /api/changes/:id/approvals` with `decision` and `notes`); a decision given outside the application is recorded by that person with `by_hand`. Approvals count once per recording user, so one person cannot make up the number by typing other names
- Owner, implementer and requester are told about each decision; owner and implementer are reminded a day before an approved change starts (`sweepStartingSoon`, every 15 minutes, once per planned start)

**Implemented in**

- `server/src/modules/changes/workflow.ts`, `rules.ts` (`poolOf`, `inPool`), `admin.ts` (rule validation, roles in settings), `notify.ts`, `routes.ts` (`GET /api/changes/waiting`), `migrations/002_approvers_and_blackout_scope.sql`, `routing.test.ts`, `changes.test.ts`
- `web/src/modules/changes/ApprovalsPanel.tsx`, `ApprovalDialog.tsx`, `ChangeActions.tsx`, `RulesAdmin.tsx`, `ChangeList.tsx` (Waiting for your decision)

### E05-10 A "change" source for follow-up actions

**Status:** open · **Priority:** P3 · **Type:** chore

Follow-up actions raised from a change carry `source_type = change` and the change's id,
but their `source` is `other` because the `action_source` list (risks module) has no
`change` value. The changes module already uses `change` when the list offers it.

**Acceptance criteria**

- [x] `action_source` has a `change` value (risks module `seedDefaults`)
- [x] The Actions contract in `docs/development.md` lists it
- [ ] A test proves a follow-up action raised from a change carries source `change` (the issue stays open until it does)

### E05-11 Calendar and blackout refinements

**Status:** in progress · **Priority:** P3 · **Type:** feature

Found while building the calendar.

**Acceptance criteria**

- [x] A blackout period can apply to chosen systems only, and can repeat (for example
      every month-end): weekly or monthly, with an optional end date
- [ ] A change can be moved by dragging it on the calendar (split out as E05-12)
- [x] "My changes" includes changes where I am the implementer, not only the owner: the
      register has the saved views **Owned by me** and **Implemented by me** (the list filters
      cannot combine two fields with "or" yet)
- [x] The calendar can be narrowed to one system (`?system=<id>`)
- [ ] The lifecycle stepper does not need the module's own fix for sideways scrolling on
      narrow screens (the core `Stepper` should contain its hidden labels)

### E05-12 Move a change by dragging it on the calendar

**Status:** open · **Priority:** P3 · **Type:** feature

Split out of E05-11.

**Acceptance criteria**

- [ ] Dragging a change in the month or week view moves its planned window, checks conflicts again and asks before saving
- [ ] The keyboard can do the same

### Also delivered in the finishing pass

- Register: tiles, **Waiting for your decision**, saved views in place of the preset buttons, bulk edit of owner and implementer, address-bar state
- **Actions** tab on a change (the shared Actions panel; review follow-ups appear there)
- Changing the main system or asset writes its own link event in the change's history (`base.ts` `syncPrimaryLink`)
- `/changes/new?start=<ISO>&end=<ISO>` fills the planned window
- Transit-flavoured sample data, including a monthly month-end fare reconciliation blackout
