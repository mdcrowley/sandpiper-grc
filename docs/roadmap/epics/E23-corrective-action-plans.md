# E23 Corrective action plans and verification (wave 10)

**Status:** done (12 of 12 issues done)

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
| E23-01 | CAP record grouping actions from any source | done | P1 |
| E23-02 | Plan approval through approval workflows | done | P2 |
| E23-03 | Verification of effectiveness, with reopen when not effective | done | P1 |
| E23-04 | Required closure evidence per source | done | P2 |
| E23-05 | Due-date extension requests with approval history | done | P2 |
| E23-06 | CAP register across sources | done | P2 |
| E23-07 | CapPanel and the create contract for other modules | done | P1 |
| E23-08 | Verification reminders | done | P2 |
| E23-09 | CAP metrics | done | P2 |
| E23-10 | Sample data | done | P3 |
| E23-11 | Guide page and route descriptions | done | P2 |
| E23-12 | Settings screen for closure-evidence sources | done | P3 |

---

### E23-01 CAP record grouping actions from any source

**Status:** done · **Priority:** P1 · **Type:** feature

A quality or safety lead wants one record per problem: the problem statement, the root cause and its category, who is responsible, the due date and the actions that fix it, whatever module the problem came from.

**Acceptance criteria**

- [x] A `cap` record type (`CAP-` numbers) with source, source record, problem statement, root cause, root cause category, responsible person, status and due date
- [x] Actions carry `cap_id` and show on their plan
- [x] The plan takes the restriction of its source record
- [x] Every change is audited

**Implemented in:** `server/src/modules/risks/caps.ts` (record type `cap`, `syncCap`), `risks/actions-resource.ts` (`cap_id`), migration `risks/migrations/005_corrective_action_plans.sql`; web `risks/CapDetail.tsx`; tests `risks/cap.test.ts`

### E23-02 Plan approval through approval workflows

**Status:** done · **Priority:** P2 · **Type:** feature

A manager wants to approve a corrective action plan before work starts, using the same approval workflows as the rest of the application.

**Acceptance criteria**

- [x] An approval kind `cap_approval` with a default one-step workflow (permission `actions.approve`)
- [x] `POST /api/caps/:id/submit` and `GET /api/caps/:id/approval`
- [x] The plan records who approved it and when

**Implemented in:** `risks/caps.ts` (approval kind `cap_approval`, default workflow "Corrective action plan approval", submit and approval routes); web `risks/CapDetail.tsx` (Approval tab, Submit for approval); tests `risks/cap.test.ts`

### E23-03 Verification of effectiveness, with reopen when not effective

**Status:** done · **Priority:** P1 · **Type:** feature

An auditor wants a corrective action to count as done only once someone has checked that it worked, and to see it reopened when it did not.

**Acceptance criteria**

- [x] Action status `pending_verification` ("Awaiting verification"), not a closed status
- [x] Setting an action that needs verification to done stamps its completion date and moves it to awaiting verification
- [x] Recording an effective result moves it to done; a not-effective result reopens it, records why and moves the plan back to in progress
- [x] `POST /api/actions/:id/verify` with method, result and note
- [x] A plan closes only when all its actions are done

**Implemented in:** `risks/actions-resource.ts` (`pending_verification`, `verifiedNow`), `risks/caps.ts` (lists, `POST /api/actions/:id/verify`, plan status from its actions); web `risks/VerifyDialog.tsx`, `ActionDetail.tsx` (Verification tab), `ActionRows.tsx`, `ActionTracker.tsx` (Awaiting verification tile), `MyActions.tsx` (To verify); tests `risks/cap.test.ts`

### E23-04 Required closure evidence per source

**Status:** done · **Priority:** P2 · **Type:** feature

An administrator wants actions from some sources (for example audits) to need evidence before they close.

**Acceptance criteria**

- [x] Setting `actions.closure_evidence_sources` (default none)
- [x] An action from such a source closes only with an evidence file or closure evidence text

**Implemented in:** `risks/actions-resource.ts` (`checkClosureEvidence`, setting `actions.closure_evidence_sources`); tests `risks/cap.test.ts`. The setting is chosen under Administration > Settings > Actions (E23-12).

### E23-05 Due-date extension requests with approval history

**Status:** done · **Priority:** P2 · **Type:** feature

An action owner who cannot meet a due date wants to ask for more time, and a manager wants every extension recorded.

**Acceptance criteria**

- [x] An approval kind `action_extension`; approval sets the new due date, keeps the original and counts the extension
- [x] `POST` and `GET /api/actions/:id/extension-request(s)`
- [x] The history of requests and decisions shows on the action

**Implemented in:** `risks/caps.ts` (approval kind `action_extension`, default workflow "Action due date extension", table `action_extensions`, extension routes), `risks/actions-resource.ts` (due date fixed once the plan is approved); web `risks/ExtensionDialog.tsx`, `ActionDetail.tsx` (Extensions tab); tests `risks/cap.test.ts`

### E23-06 CAP register across sources

**Status:** done · **Priority:** P2 · **Type:** feature

A quality lead wants one list of every corrective action plan, filtered by source, status, overdue and awaiting verification.

**Acceptance criteria**

- [x] `/caps` page with those filters, saved views and export
- [x] `GET /api/caps/register` and `GET /api/caps/summary`
- [x] Restricted plans are hidden without `security.view`; figures count every plan

**Implemented in:** `risks/caps.ts` (`/api/caps/register`, `/api/caps/summary`, plan columns `actions_total`, `actions_done`, `actions_awaiting` for list filters); web `risks/CapRegister.tsx`, nav Governance > Corrective action plans; tests `risks/cap.test.ts`

### E23-07 CapPanel and the create contract for other modules

**Status:** done · **Priority:** P1 · **Type:** feature

Other modules (audits, controls, funding, safety) want to raise and show corrective action plans on their own records without editing the risks module.

**Acceptance criteria**

- [x] `ctx.resources.create('cap', {...})` documented in the developer guide
- [x] `web/src/modules/risks/CapPanel.tsx` exports `CapPanel({ sourceType, sourceId, source })`, loaded by host pages with `import.meta.glob`
- [x] A build without the panel shows nothing on the host page

**Implemented in:** contract C1 in `risks/caps.ts` (header comment) and in the developer guide; web `risks/CapPanel.tsx` (`CapPanel({ sourceType, sourceId, source })`, also the default export)

### E23-08 Verification reminders

**Status:** done · **Priority:** P2 · **Type:** feature

The person who verifies an action wants a reminder before the verification is due.

**Acceptance criteria**

- [x] Job `actions.verification_due` on the job queue
- [x] Setting `actions.verification_reminder_days` (7), listed under Administration > Reminders
- [x] Each reminder goes out once

**Implemented in:** `risks/caps.ts` (`runVerificationReminders`, job `actions.verification_due` every 6 hours, `once` keys); the setting is listed under Administration > Reminders by `notifications/reminder-settings.ts`; tests `risks/cap.test.ts`

### E23-09 CAP metrics

**Status:** done · **Priority:** P2 · **Type:** feature

Safety and risk indicators want to count overdue actions, overdue plans and actions awaiting verification.

**Acceptance criteria**

- [x] Metrics `actions.overdue`, `actions.caps_overdue` and `actions.awaiting_verification` in the metric registry
- [x] Figures count every record, restricted or not

**Implemented in:** `risks/caps.ts` (`defineMetric`); tests `risks/cap.test.ts`

### E23-10 Sample data

**Status:** done · **Priority:** P3 · **Type:** feature

Someone trying the application wants to see plans in each state.

**Acceptance criteria**

- [x] Four invented plans on sample risks: one awaiting approval, one verifying, one closed effective, one reopened

**Implemented in:** `risks/seed-caps.ts` (dev profile only); tests `risks/cap.test.ts`

### E23-11 Guide page and route descriptions

**Status:** done · **Priority:** P2 · **Type:** docs

Users need a guide page for corrective action plans, and integrators need every new route described.

**Acceptance criteria**

- [x] `docs/user/24-corrective-action-plans.md`
- [x] The action tracker section of `06-risks-actions-obligations.md` mentions verification
- [x] Every new route is described for the API document

**Implemented in:** `docs/user/24-corrective-action-plans.md`, the action tracker section of `docs/user/06-risks-actions-obligations.md`, `ctx.describeRoute` on every new route in `risks/caps.ts`

### E23-12 Settings screen for closure-evidence sources

**Status:** done · **Priority:** P3 · **Type:** feature

An administrator wants to choose, on a screen, the action sources whose actions need evidence before they close (`actions.closure_evidence_sources`). Stretch for wave 11.

**Acceptance criteria**

- [x] A row under Administration > Settings (group **Actions**): a check box for each action source (values of switched-off areas left out), saved with the other settings and audited
- [x] The row shows only when the server offers the setting (`actions.closure_evidence_sources` in `admin/settings.ts`)

**Implemented in:** `web/src/modules/admin/Settings.tsx`, `server/src/modules/admin/settings.ts`; test `web/src/modules/admin/Settings.component.test.ts`; `docs/user/24-corrective-action-plans.md`, `docs/user/09-administration.md`
