# E41 Product gaps found in the wave 19 review

**Status:** open (0 of 17 issues done)

## Goal

Close the product gaps a transit organization's IT, security, safety, risk, compliance, asset and
audit teams would expect a GRC application to cover, found by the wave 19 gap analysis. Each was
checked against the code; most extend or join up parts that exist.

## Scope notes

- Nothing names a real organization, place, vendor or person; no single jurisdiction's law is a
  built-in default.
- Left out on purpose: regulatory-change feeds and automatic exclusion-list checks (each needs an
  outside service per jurisdiction), claims payments, grant budgets and money-based risk modeling.
- Restriction hides details, never counts: figures stay the same for everyone (also for E41-01).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E41-01 | Departments and sites as access scope | open | P1 |
| E41-02 | User access reviews and the register of accounts on each system | open | P1 |
| E41-03 | One "My work" list and a compliance calendar across every area | open | P1 |
| E41-04 | Figures over time for board reporting | open | P2 |
| E41-05 | Confidential safety reporting, and telling the reporter what changed | open | P2 |
| E41-06 | Registers an administrator defines | open | P2 |
| E41-07 | More than one language for the portal, kiosk, policies and the app | open | P2 |
| E41-08 | Safety and security certification of capital projects | open | P2 |
| E41-09 | A workspace for outside auditors and funder reviewers | open | P2 |
| E41-10 | Vendor intake with risk tiers and required checks | open | P2 |
| E41-11 | Contractor performance reviews | open | P3 |
| E41-12 | Written test steps per control, and importing coverage | open | P3 |
| E41-13 | Accessible (tagged) PDFs | open | P2 |
| E41-14 | Call-tree messages with acknowledgment | open | P3 |
| E41-15 | Retention schedule and destruction log for the organization's own records | open | P3 |
| E41-16 | Searching inside attached files, and file preview | open | P3 |
| E41-17 | Small items: data wiping proof at disposal, holiday-aware request deadlines, meeting invitations, a combined heat map, reports from scratch in the app | open | P3 |

### E41-01 Departments and sites as access scope

**Status:** open · **Priority:** P1 · **Type:** feature

A depot manager should see the inspections, hazards and corrective actions of their own depot, not
every depot's.

**Acceptance criteria**

- [ ] Departments are a record type (name, parent, manager); people, positions and records that carry a department point at it, and existing text values are converted
- [ ] A role grant can be scoped to the person's departments or sites (and those below them) for record types that carry one
- [ ] Out-of-scope records are hidden from lists, search, pickers, exports and the assistant like restricted ones; figures are unchanged for everyone
- [ ] Tests for every scoped type; the guide explains scoping

### E41-02 User access reviews and the register of accounts on each system

**Status:** open · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [ ] Accounts on a system (imported from a file per system, or entered) are kept with their holder, role on that system and last-seen date; holders are matched to the staff roster
- [ ] An access review campaign asks each system owner or manager to keep or remove each account, with due dates, reminders and evidence
- [ ] Leavers and people on leave with active accounts are flagged; removals are tracked to done
- [ ] A finished campaign can be recorded as a control test

### E41-03 One "My work" list and a compliance calendar across every area

**Status:** open · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [ ] "My work" and the personal calendar feed include evidence requests, control tests, corrective-action verifications, inspections, obligation attestations, vendor reassessments and certifications, through one registration each part uses
- [ ] An in-app compliance calendar (month and list views, filter by area and person) shows everything due; switched-off areas are left out
- [ ] The mobile app's My work shows the new kinds

### E41-04 Figures over time for board reporting

**Status:** open · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [ ] Chosen figures (open risks by level, overdue actions, open findings and others) are recorded at each month end (and on demand), the same for everyone
- [ ] Reports and dashboards chart a figure over time; board packs can include it

### E41-05 Confidential safety reporting, and telling the reporter what changed

**Status:** open · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [ ] A reporter can ask for their identity to be kept confidential: only named people may see it, and every view is audited
- [ ] The reporter is told, in plain words, what was done about their report when it closes

### E41-06 Registers an administrator defines

**Status:** open · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [ ] An administrator defines a new kind of record (name, fields, lists, numbering, permissions, area) that gets lists, record pages, search, history, attachments, imports, exports, lifecycles and reports like built-in types
- [ ] Defined registers can be switched off like other areas

### E41-07 More than one language for the portal, kiosk, policies and the app

**Status:** open · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [ ] The portal, the policy kiosk and the mobile app's employee-facing screens can be shown in a second language chosen by the person; texts are kept in translation files
- [ ] A policy can carry a translation, and an acknowledgment records which language was read

### E41-08 Safety and security certification of capital projects

**Status:** open · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [ ] A project can carry certifiable items with requirements derived from hazards and threats, each with its verification evidence and status
- [ ] A certificate of readiness lists open items and cannot be issued while required items are open; project gates can require it

### E41-09 A workspace for outside auditors and funder reviewers

**Status:** open · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [ ] An outside reviewer gets access limited to one audit engagement or review: its requests, evidence and findings, for a set period
- [ ] People asked for evidence can attach files without `audits.edit`

### E41-10 Vendor intake with risk tiers and required checks

**Status:** open · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [ ] An intake questionnaire sets a vendor's risk tier by rules the organization defines
- [ ] Each tier has required checks; a contract cannot become active until they are done or waived with a reason

### E41-11 Contractor performance reviews

**Status:** open · **Priority:** P3 · **Type:** feature

**Acceptance criteria**

- [ ] A contract can carry measures with targets; periodic scores are recorded with comments and a trend

### E41-12 Written test steps per control, and importing coverage

**Status:** open · **Priority:** P3 · **Type:** feature

**Acceptance criteria**

- [ ] A control can carry written test steps; a control test records the result of each step
- [ ] Control coverage can be imported from a spreadsheet

### E41-13 Accessible (tagged) PDFs

**Status:** open · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [ ] PDFs made by the server are tagged (headings, tables, reading order, document language and title) and pass an automated PDF/UA check

### E41-14 Call-tree messages with acknowledgment

**Status:** open · **Priority:** P3 · **Type:** feature

**Acceptance criteria**

- [ ] A continuity call tree can be sent by email and text message through the existing alert channels; each person can acknowledge, and the activation shows who has not

### E41-15 Retention schedule and destruction log for the organization's own records

**Status:** open · **Priority:** P3 · **Type:** feature

**Acceptance criteria**

- [ ] A retention schedule of the organization's record series (paper and electronic), with periods and triggers, and a destruction log with approvals

### E41-16 Searching inside attached files, and file preview

**Status:** open · **Priority:** P3 · **Type:** feature

**Acceptance criteria**

- [ ] Text in attached PDF, Word and plain-text files is found by search (with the attachment's record's visibility)
- [ ] Images and PDFs can be previewed in the browser without downloading

### E41-17 Small items

**Status:** open · **Priority:** P3 · **Type:** feature

**Acceptance criteria**

- [ ] Disposal of a data-bearing asset records how its data was wiped, by whom, with a certificate
- [x] Records-request deadlines use the holiday calendar (with E40-10: the service desk's **Business hours** calendar is the one working-day calendar, `server/src/core/working-days.ts`)
- [ ] Meeting invitations by email (an `.ics` attachment)
- [ ] A heat map that combines every risk scale at the common level
- [ ] Portal users can report a problem from scratch in the mobile app, not only from a tag card
