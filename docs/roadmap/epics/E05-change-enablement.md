# E05 Change enablement

**Status:** open (nothing built)

## Goal

Let the IT team plan, assess, approve and review changes to systems so that changes are
visible before they happen, the right people agree to them, and anything that goes
wrong can be traced back to a change.

## Scope notes

- Nothing exists yet: no module folder, no screens. Only the permission key `changes`
  and the "Change" navigation group are reserved, and the default roles already carry
  `changes.*` grants.
- The module would live in `server/src/modules/changes/` and `web/src/modules/changes/`.
- Approval routing here should reuse whatever is built for approvals elsewhere
  ([E14-06](E14-platform-services.md)).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E05-01 | Change record and register | open | P2 |
| E05-02 | Change types and risk assessment | open | P2 |
| E05-03 | Approval of changes | open | P2 |
| E05-04 | Change calendar | open | P3 |
| E05-05 | Link changes to systems, tickets and projects | open | P2 |
| E05-06 | Implementation, back-out plan and review | open | P3 |
| E05-07 | Standard change templates | open | P3 |

---

### E05-01 Change record and register

**Status:** open · **Priority:** P2 · **Type:** feature

As an agent, I raise a change with what will be done, why, when, and who will do it,
and everyone can see the register of planned and past changes.

**Acceptance criteria**

- [ ] A `change` record type with reference numbers, built on the generic resource
- [ ] Title, description, reason, planned start and end, implementer, status
- [ ] Statuses are a configurable list
- [ ] List, detail page, history, comments and links
- [ ] Navigation entry under "Change", guarded by `changes.view`
- [ ] Tests for create, update, permissions and audit

### E05-02 Change types and risk assessment

**Status:** open · **Priority:** P2 · **Type:** feature

As an agent, I classify a change as standard, normal or emergency and answer a few
questions that give it a risk level, which decides how much approval it needs.

**Acceptance criteria**

- [ ] Change types are a configurable list
- [ ] A short risk questionnaire held as data
- [ ] The risk level is computed and can be overridden with a reason
- [ ] The type and risk level decide the approval path

### E05-03 Approval of changes

**Status:** open · **Priority:** P2 · **Type:** feature

As an approver, I see changes waiting for me and approve or refuse each with a comment.
A change cannot move to "scheduled" without the approvals its type requires.

**Acceptance criteria**

- [ ] Needs `changes.approve`
- [ ] The requester cannot approve their own change
- [ ] Emergency changes can be approved after the fact, and are flagged as such
- [ ] Decisions are audited

### E05-04 Change calendar

**Status:** open · **Priority:** P3 · **Type:** feature

As anyone in IT, I can see scheduled changes on a calendar and spot clashes and
freeze periods.

**Acceptance criteria**

- [ ] Month and week views of scheduled changes
- [ ] Freeze periods held as data and shown on the calendar
- [ ] A warning when two changes to the same system overlap

### E05-05 Link changes to systems, tickets and projects

**Status:** open · **Priority:** P2 · **Type:** feature

As an agent, I record which systems a change touches, and link it to the ticket,
problem or project that caused it, so each of those shows the change in turn.

**Acceptance criteria**

- [ ] One or more affected systems per change
- [ ] A system page lists its recent and planned changes
- [ ] Links to tickets, problems and projects use the generic links
- [ ] The relationship map can show what else a change may affect

### E05-06 Implementation, back-out plan and review

**Status:** open · **Priority:** P3 · **Type:** feature

As an implementer, I record the plan, the test plan and how to back out, then the
outcome and a short review afterwards.

**Acceptance criteria**

- [ ] Plan, test plan and back-out plan fields
- [ ] Outcome: successful, successful with issues, backed out, failed
- [ ] A review is required before closing a failed or emergency change
- [ ] Follow-up work can be raised as actions

### E05-07 Standard change templates

**Status:** open · **Priority:** P3 · **Type:** feature

As an agent, I pick a pre-approved template for routine work and get a change that is
already filled in and needs no further approval.

**Acceptance criteria**

- [ ] Templates are data, maintained by people with `changes.administer`
- [ ] A change from a template is marked as standard and pre-approved
- [ ] Template use is reported so over-use can be spotted
