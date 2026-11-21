# E23 Corrective action plans and verification (wave 10)

**Status:** open

## Goal

Group the actions that answer one finding, event, failed test or deficiency into a corrective action plan with a problem statement and root cause, have the plan approved, and close it only once each action has been verified as effective. Every module that finds problems (audits, control tests, funder reviews, safety events) raises its corrective action plans the same way.

## Scope notes

- The `cap` record type lives in the risks module folder beside the action tracker and uses the `actions` permission module, so it is always on, like actions.
- A plan takes its restriction from its source record (`restrictedFrom`), as actions do.
- Contracts C1 (the `cap` type and `CapPanel`) and C2 (the `pending_verification` action status) of the wave 10 plan are delivered first, because other modules build on them.
- Issues marked "stretch" in the wave 10 plan carry priority P3; an unfinished one stays open for wave 11.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E23-01 | CAP record grouping actions from any source | open | P1 |
| E23-02 | Plan approval through approval workflows | open | P2 |
| E23-03 | Verification of effectiveness, with reopen when not effective | open | P1 |
| E23-04 | Required closure evidence per source | open | P2 |
| E23-05 | Due-date extension requests with approval history | open | P2 |
| E23-06 | CAP register across sources | open | P2 |
| E23-07 | CapPanel and the create contract for other modules | open | P1 |
| E23-08 | Verification reminders | open | P2 |
| E23-09 | CAP metrics | open | P2 |
| E23-10 | Sample data | open | P3 |
| E23-11 | Guide page and route descriptions | open | P2 |

---

### E23-01 CAP record grouping actions from any source

**Status:** open · **Priority:** P1 · **Type:** feature

A quality or safety lead wants one record per problem: the problem statement, the root cause and its category, who is responsible, the due date and the actions that fix it, whatever module the problem came from.

**Acceptance criteria**

- [ ] A `cap` record type (`CAP-` numbers) with source, source record, problem statement, root cause, root cause category, responsible person, status and due date
- [ ] Actions carry `cap_id` and show on their plan
- [ ] The plan takes the restriction of its source record
- [ ] Every change is audited

### E23-02 Plan approval through approval workflows

**Status:** open · **Priority:** P2 · **Type:** feature

A manager wants to approve a corrective action plan before work starts, using the same approval workflows as the rest of the application.

**Acceptance criteria**

- [ ] An approval kind `cap_approval` with a default one-step workflow (permission `actions.approve`)
- [ ] `POST /api/caps/:id/submit` and `GET /api/caps/:id/approval`
- [ ] The plan records who approved it and when

### E23-03 Verification of effectiveness, with reopen when not effective

**Status:** open · **Priority:** P1 · **Type:** feature

An auditor wants a corrective action to count as done only once someone has checked that it worked, and to see it reopened when it did not.

**Acceptance criteria**

- [ ] Action status `pending_verification` ("Awaiting verification"), not a closed status
- [ ] Setting an action that needs verification to done stamps its completion date and moves it to awaiting verification
- [ ] Recording an effective result moves it to done; a not-effective result reopens it, records why and moves the plan back to in progress
- [ ] `POST /api/actions/:id/verify` with method, result and note
- [ ] A plan closes only when all its actions are done

### E23-04 Required closure evidence per source

**Status:** open · **Priority:** P2 · **Type:** feature

An administrator wants actions from some sources (for example audits) to need evidence before they close.

**Acceptance criteria**

- [ ] Setting `actions.closure_evidence_sources` (default none)
- [ ] An action from such a source closes only with an evidence file or closure evidence text

### E23-05 Due-date extension requests with approval history

**Status:** open · **Priority:** P2 · **Type:** feature

An action owner who cannot meet a due date wants to ask for more time, and a manager wants every extension recorded.

**Acceptance criteria**

- [ ] An approval kind `action_extension`; approval sets the new due date, keeps the original and counts the extension
- [ ] `POST` and `GET /api/actions/:id/extension-request(s)`
- [ ] The history of requests and decisions shows on the action

### E23-06 CAP register across sources

**Status:** open · **Priority:** P2 · **Type:** feature

A quality lead wants one list of every corrective action plan, filtered by source, status, overdue and awaiting verification.

**Acceptance criteria**

- [ ] `/caps` page with those filters, saved views and export
- [ ] `GET /api/caps/register` and `GET /api/caps/summary`
- [ ] Restricted plans are hidden without `security.view`; figures count every plan

### E23-07 CapPanel and the create contract for other modules

**Status:** open · **Priority:** P1 · **Type:** feature

Other modules (audits, controls, funding, safety) want to raise and show corrective action plans on their own records without editing the risks module.

**Acceptance criteria**

- [ ] `ctx.resources.create('cap', {...})` documented in the developer guide
- [ ] `web/src/modules/risks/CapPanel.tsx` exports `CapPanel({ sourceType, sourceId, source })`, loaded by host pages with `import.meta.glob`
- [ ] A build without the panel shows nothing on the host page

### E23-08 Verification reminders

**Status:** open · **Priority:** P2 · **Type:** feature

The person who verifies an action wants a reminder before the verification is due.

**Acceptance criteria**

- [ ] Job `actions.verification_due` on the job queue
- [ ] Setting `actions.verification_reminder_days` (7), listed under Administration > Reminders
- [ ] Each reminder goes out once

### E23-09 CAP metrics

**Status:** open · **Priority:** P2 · **Type:** feature

Safety and risk indicators want to count overdue actions, overdue plans and actions awaiting verification.

**Acceptance criteria**

- [ ] Metrics `actions.overdue`, `actions.caps_overdue` and `actions.awaiting_verification` in the metric registry
- [ ] Figures count every record, restricted or not

### E23-10 Sample data

**Status:** open · **Priority:** P3 · **Type:** feature

Someone trying the application wants to see plans in each state.

**Acceptance criteria**

- [ ] Four invented plans on sample risks: one awaiting approval, one verifying, one closed effective, one reopened

### E23-11 Guide page and route descriptions

**Status:** open · **Priority:** P2 · **Type:** docs

Users need a guide page for corrective action plans, and integrators need every new route described.

**Acceptance criteria**

- [ ] `docs/user/24-corrective-action-plans.md`
- [ ] The action tracker section of `06-risks-actions-obligations.md` mentions verification
- [ ] Every new route is described for the API document
