# E03 Service desk

**Status:** done (22 of 22 issues done)

## Goal

Let a small IT team log, prioritize and resolve incidents and requests against agreed
service levels, learn from repeated faults through problems and known errors, and share
what they know in a knowledge base.

## Scope notes

- Covers `server/src/modules/tickets/` and `web/src/modules/tickets/`.
- The service desk dashboard is tracked in [E12](E12-dashboards-and-reporting.md).
- The portal for requesters and email-to-ticket are in [E15](E15-self-service-portal.md).
- Statuses, priorities, categories, impact, urgency, channels and resolution codes are
  configurable lists ([E01-10](E01-platform-foundations.md)).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E03-01 | Tickets for incidents and requests | done | P1 |
| E03-02 | Priority from impact and urgency | done | P1 |
| E03-03 | Service-level targets, working calendars and holidays | done | P1 |
| E03-04 | Pausing and resuming the clock | done | P1 |
| E03-05 | Missed-target flags and breach reason | done | P1 |
| E03-06 | Ticket lifecycle: resolve, close, reopen, satisfaction | done | P1 |
| E03-07 | Major incidents with child tickets and review | done | P2 |
| E03-08 | Problems and known errors | done | P2 |
| E03-09 | Knowledge base with versions and feedback | done | P2 |
| E03-10 | Service catalog | done | P2 |
| E03-11 | Screen for the priority matrix | done | P1 |
| E03-12 | Screen for targets, calendars and holidays | done | P1 |
| E03-13 | Warnings before and at a missed target | done | P2 |
| E03-14 | Escalation rules | done | P2 |
| E03-15 | Catalog items with their own form and fulfillment steps | done | P2 |
| E03-16 | Enforce the "agents only" article audience | done | P2 |
| E03-17 | Add and remove working calendars | done | P3 |
| E03-18 | Agent workspace: ticket cockpit, quick actions, fast logging, queues | done | P1 |
| E03-19 | Follow-up actions on problems | done | P2 |
| E03-20 | Server-side saved views for ticket queues | done | P3 |
| E03-21 | Approval by more than one person, or by answer | done | P3 |
| E03-22 | Catalog request approvals on the shared approval workflows | done | P3 |
---

### E03-01 Tickets for incidents and requests

**Status:** done · **Priority:** P1 · **Type:** feature

As an agent, I log a ticket on a colleague's behalf with who asked, what is affected
(system, asset), a category, and who is working on it, and I can find it again by
searching or filtering.

**Acceptance criteria**

- [x] Ticket types, categories, channels and assignment groups are configurable lists
- [x] Requester details, affected person, system and asset can be recorded
- [x] Assignment to a group and a person
- [x] "With vendor" tracking: vendor, their reference, when raised and when they responded
- [x] List with filters, saved views and export; detail page with comments, links and history
- [x] Agents can work tickets; a view-only role can only read them

**Implemented in:** `ticket` resource (`server/src/modules/tickets/index.ts`); `web/src/modules/tickets/TicketList.tsx`, `TicketDetail.tsx`, `NewTicketDialog.tsx`

### E03-02 Priority from impact and urgency

**Status:** done · **Priority:** P1 · **Type:** feature

As an agent, I choose impact and urgency and the ticket's priority is worked out for
me from a matrix. I can override it, and the ticket shows that I did.

**Acceptance criteria**

- [x] The matrix is stored as a setting with a default for unknown values
- [x] Priority is recomputed when impact or urgency change, unless overridden
- [x] An override is flagged on the ticket
- [x] The new-ticket dialog previews the computed priority

**Implemented in:** `priorityFor` (`server/src/modules/tickets/sla.ts`); `GET/PUT /api/tickets/priority-matrix`; `web/src/modules/tickets/NewTicketDialog.tsx`

### E03-03 Service-level targets, working calendars and holidays

**Status:** done · **Priority:** P1 · **Type:** feature

As an agent, each ticket shows when a first response and a resolution are due, counted
in working time for the calendar that applies to its priority.

**Acceptance criteria**

- [x] Respond and resolve targets per priority, each tied to a calendar
- [x] Calendars have a time zone, opening hours per weekday and holidays, or are 24 by 7
- [x] Working time is correct across weekends, holidays and daylight-saving changes
- [x] A ticket logged out of hours starts its clock at the next opening time
- [x] The ticket page shows both clocks with time left or overdue

**Implemented in:** `server/src/modules/tickets/sla.ts`; `GET /api/tickets/:id/sla`, `/api/tickets/sla/policies`, `/api/tickets/sla/calendars`; `web/src/modules/tickets/Cockpit.tsx` (was `SlaClocks.tsx`)

### E03-04 Pausing and resuming the clock

**Status:** done · **Priority:** P1 · **Type:** feature

As an agent, when I put a ticket into a waiting status the clock stops, and when work
resumes the due times move by the working time spent waiting.

**Acceptance criteria**

- [x] Each status has a category (open, paused, resolved, closed) held as list data
- [x] Entering a paused status records when the pause began
- [x] Leaving it adds the paused working minutes to the due times
- [x] Paused tickets are never flagged as missed while paused

**Implemented in:** `beforeUpdate` hook and `makeSla` (`server/src/modules/tickets/index.ts`)

### E03-05 Missed-target flags and breach reason

**Status:** done · **Priority:** P1 · **Type:** feature

As a service desk lead, tickets that miss their response or resolution target are
flagged automatically, and the agent can record why.

**Acceptance criteria**

- [x] A sweep runs every minute and before ticket reads
- [x] Response and resolution misses are flagged separately
- [x] Each new flag writes an audit event
- [x] A breach reason can be recorded on the ticket

**Implemented in:** `sweep` in `makeSla` (`server/src/modules/tickets/index.ts`)

### E03-06 Ticket lifecycle: resolve, close, reopen, satisfaction

**Status:** done · **Priority:** P1 · **Type:** feature

As an agent, I move a ticket from new to resolved to closed, must give a resolution
code when I resolve it, can reopen it, and can record the requester's satisfaction.

**Acceptance criteria**

- [x] First response is stamped at first assignment or first move out of "new"
- [x] Resolving needs a resolution code
- [x] Resolved and closed times are stamped and cleared again on reopen
- [x] Satisfaction score (1 to 5) and comment can be recorded on a closed ticket
- [x] Status actions on the ticket page guide the agent through each step

**Implemented in:** ticket hooks (`server/src/modules/tickets/index.ts`); `web/src/modules/tickets/TicketActions.tsx`, `TicketDetail.tsx`

### E03-07 Major incidents with child tickets and review

**Status:** done · **Priority:** P2 · **Type:** feature

As a service desk lead, I can mark a ticket as a major incident, attach the related
tickets to it, post updates, and record a post-incident review.

**Acceptance criteria**

- [x] A ticket can be flagged as a major incident
- [x] Other tickets can be linked as children; a ticket cannot be its own parent
- [x] A structured post-incident review is stored on the ticket
- [x] The ticket page has a major incident panel

**Implemented in:** `major_incident`, `parent_ticket_id`, `post_incident_review` fields (`server/src/modules/tickets/index.ts`); `web/src/modules/tickets/MajorIncident.tsx`

### E03-08 Problems and known errors

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I record the underlying cause of repeated incidents as a problem, with a
root cause and workaround, and publish it to the knowledge base as a known error.

**Acceptance criteria**

- [x] Problem records with status, root cause, workaround and owner
- [x] Tickets can point to a problem
- [x] "Publish known error" drafts a knowledge article from the problem
- [x] A problem can only be published once

**Implemented in:** `problem` resource, `POST /api/problems/:id/publish-known-error` (`server/src/modules/tickets/index.ts`); `web/src/modules/tickets/Problems.tsx`

### E03-09 Knowledge base with versions and feedback

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I write and maintain articles. Each change to the text keeps the previous
version, and readers can say whether an article helped.

**Acceptance criteria**

- [x] Articles have a category, audience, status, owner and review date
- [x] A change to the body creates a new version and keeps the old text
- [x] Version history can be viewed
- [x] "Helpful" and "not helpful" counts
- [x] Separate view, create and edit permissions (`knowledge.*`)

**Implemented in:** `knowledge_article` resource, `GET /api/knowledge/:id/versions`, `POST /api/knowledge/:id/feedback` (`server/src/modules/tickets/index.ts`); `web/src/modules/tickets/Knowledge.tsx`

### E03-10 Service catalog

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I pick a catalog item (for example "new starter") and get a ticket with
the type, category and other values already filled in.

**Acceptance criteria**

- [x] Catalog items with name, description, category and active flag
- [x] Each item carries the values it pre-fills on the ticket
- [x] A starter catalog is added once and then belongs to administrators
- [x] Catalog list and detail pages

**Implemented in:** `catalog_item` resource (`server/src/modules/tickets/index.ts`), `CATALOG` in `defaults.ts`; `web/src/modules/tickets/Catalog.tsx`. The tiles and the shortcuts in the new-ticket dialog were added with E03-18.

### E03-11 Screen for the priority matrix

**Status:** done · **Priority:** P1 · **Type:** feature

As a service desk administrator, I can edit the impact-by-urgency matrix on a screen.

**Acceptance criteria**

- [x] A grid of impact by urgency with a priority picker in each cell
- [x] A default priority for combinations not in the grid
- [x] Saving uses the existing `PUT /api/tickets/priority-matrix`
- [x] Only people with `tickets.administer` can edit; others see it read-only

**Implemented in:** `MatrixSettings` in `web/src/modules/tickets/Settings.tsx` (route `/tickets/settings`, tab Priorities)

### E03-12 Screen for targets, calendars and holidays

**Status:** done · **Priority:** P1 · **Type:** feature

As a service desk administrator, I can change respond and resolve targets, opening
hours and holidays on a screen.

**Acceptance criteria**

- [x] Targets per priority with a calendar picker
- [x] Opening hours per weekday and a 24 by 7 switch
- [x] Add and remove holidays
- [x] Uses the existing `/api/tickets/sla/...` routes
- [x] A note explains that changes apply to new due times, not past ones

**Implemented in:** `TargetSettings` in `web/src/modules/tickets/Settings.tsx`; `web/src/modules/tickets/SettingsCalendars.tsx`

### E03-13 Warnings before and at a missed target

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I am told when one of my tickets is about to miss its target and when it
has, instead of having to look.

**Acceptance criteria**

- [x] A warning at a configurable share of the window (for example 75%): setting `tickets.sla_warning_pct`, 0 switches it off
- [x] A notice at the moment the target is missed
- [x] Sent to the assignee, or the assignment group when unassigned (members kept in the setting `tickets.group_members`; with none, everyone holding `tickets.edit`)
- [x] Depends on notifications ([E14-03](E14-platform-services.md)); without that module nothing is sent and nothing fails
- [x] A new assignee, or the members of a newly chosen group, are told about the assignment

**Implemented in:** `server/src/modules/tickets/notify.ts`, `warn` in `automation.ts`, `sweep` in `index.ts`, migration `003_escalation_catalogue_warnings.sql`; `GET/PUT /api/tickets/sla/settings`; `NotificationSettings` in `web/src/modules/tickets/SettingsAutomation.tsx`; tests in `service.test.ts`

### E03-14 Escalation rules

**Status:** done · **Priority:** P2 · **Type:** feature

As a service desk lead, tickets that stay unassigned or untouched for too long are
escalated by rule to a named person or group.

**Acceptance criteria**

- [x] Rules are data: condition (nobody assigned, no first response, not updated), wait time, who to escalate to
- [x] Wait time is counted in the ticket's working calendar
- [x] Each escalation is audited and visible on the ticket (badge, cockpit line, history)
- [x] Rules can be switched off individually

**Implemented in:** `escalate` and `registerAutomation` in `server/src/modules/tickets/automation.ts` (`/api/tickets/escalation-rules`, `GET /api/tickets/:id/escalations`); `EscalationSettings` in `web/src/modules/tickets/SettingsAutomation.tsx`

### E03-15 Catalog items with their own form and fulfillment steps

**Status:** done · **Priority:** P2 · **Type:** feature

As a requester or agent, choosing a catalog item shows the questions that item needs
and creates the tasks to fulfill it.

**Acceptance criteria**

- [x] Each item can define extra questions (short text, long text, one of a list, date, yes or no; required or not)
- [x] Answers are stored on the ticket (`catalog_answers`, shown as Request details)
- [x] An item can require approval before work starts (`POST /api/tickets/:id/approval`, `tickets.approve`; the ticket cannot start or resolve until approved)
- [x] An item can create a checklist of fulfillment tasks (who checked each and when is kept)
- [x] The raw-JSON "values" field is replaced by a form

**Implemented in:** `server/src/modules/tickets/catalog.ts`; `web/src/modules/tickets/CatalogDesigner.tsx`, `Catalog.tsx`, `NewTicketDialog.tsx`, the approval notice in `Cockpit.tsx` and the checklist in `TicketDetail.tsx`

### E03-16 Enforce the "agents only" article audience

**Status:** done · **Priority:** P2 · **Type:** bug

As an agent, I want articles marked "agents only" hidden from people who are not
agents.

**Acceptance criteria**

- [x] Lists, search, links and direct reads hide agent-only articles from non-agents (also stats, record pickers, comments, history and files of such an article)
- [x] "Agent" is defined by a permission, not a role name: the setting `knowledge.agent_permission`, default `tickets.edit`
- [x] A test covers a non-agent reader

**Implemented in:** `server/src/modules/tickets/audience.ts`; `checkAudience` in `index.ts`; test in `service.test.ts`

### E03-17 Add and remove working calendars

**Status:** done · **Priority:** P3 · **Type:** improvement

As a service desk administrator, I can create a new calendar (for example an
out-of-hours rota) and retire one.

**Acceptance criteria**

- [x] Create and retire calendars (`POST` and `DELETE /api/tickets/sla/calendars`)
- [x] A calendar in use by a target cannot be retired (the message names the priorities)
- [x] Changes are audited

**Implemented in:** `server/src/modules/tickets/index.ts`; `web/src/modules/tickets/SettingsCalendars.tsx`

### E03-18 Agent workspace: ticket cockpit, quick actions, fast logging, queues

**Status:** done · **Priority:** P1 · **Type:** improvement

As an agent who works in the service desk all day, everything I need about a ticket is
above the fold, the usual next step is one click, logging a ticket takes seconds, and my
queues are one click away.

**Acceptance criteria**

- [x] The ticket page shows status with the next step, both clocks with time used, and the assignee in one strip under the header
- [x] One-click actions: assign to me, start work, pause, resume, resolve, close, reopen; the rest under More actions
- [x] New ticket: sensible defaults, catalog shortcuts, the priority and due times from impact and urgency shown live, likely duplicates and knowledge articles while the title is typed, "Log and add another", Ctrl+Enter, the N shortcut
- [x] Queue presets with live counts (`GET /api/tickets/queue-counts`), kept in the address and added to the saved views
- [x] A dashboard of the desk now and in a period, every tile and bar drilling down to the list
- [x] Bulk edit of assignee, group, status, priority, category and type
- [x] Bespoke CSS the core covers is removed

**Implemented in:** `web/src/modules/tickets/Cockpit.tsx`, `TicketActions.tsx`, `TicketDetail.tsx`, `NewTicketDialog.tsx`, `TicketList.tsx`, `Dashboard.tsx`; `server/src/modules/tickets/assist.ts` (`GET /api/tickets/suggest`)

### E03-19 Follow-up actions on problems

**Status:** done · **Priority:** P2 · **Type:** feature

As a problem owner, I record the work agreed to remove a cause as actions that the owners
see in their action list.

**Acceptance criteria**

- [x] An Actions tab on the problem page, using the shared Actions panel
- [x] Shown only when the `action` record type is loaded
- [x] The action source list has a "Problem" value (owned by the risks module: `problem` in `action_source`, `server/src/modules/risks/index.ts` and `actions.ts`; an action made from a problem records it, tested in `risks/lifecycle.test.ts` "action sources and assignment")

**Implemented in:** `web/src/modules/tickets/actions.tsx`, `Problems.tsx`

### E03-20 Server-side saved views for ticket queues

**Status:** done · **Priority:** P3 · **Type:** improvement

As an agent, my saved queues follow me to another computer. The queue presets used to be
copied into the list's saved views in the browser only.

**Acceptance criteria**

- [x] Saved views are stored per user on the server (core preferences `views:<type>`, [E01](E01-platform-foundations.md))
- [x] The service desk presets are offered to every agent as shared views (core shared views, E01-24): added once, then owned by administrators; the browser-only copy is gone

**Implemented in:** `server/src/modules/tickets/views.ts` (`seedSharedQueues`); `web/src/modules/tickets/TicketList.tsx`; test in `server/src/modules/portal/sharing.test.ts`

### E03-21 Approval by more than one person, or by answer

**Status:** done · **Priority:** P3 · **Type:** feature

As a service desk lead, some requests need two approvals, or need approval only when a
particular answer is given (for example access to a restricted system).

**Acceptance criteria**

- [x] An item can name the number of approvals (1 to 5) and who may give them (named people, or anyone with `tickets.approve`)
- [x] Approval can depend on the answer to one of the item's questions
- [x] Each decision is audited; one rejection rejects, an approval after a rejection overturns it, nobody approves their own request
- [x] The ticket strip shows progress and decisions; the portal's approvals list only what I may still decide

**Implemented in:** `server/src/modules/tickets/catalog.ts` (`POST /api/tickets/:id/approval`, `GET /api/tickets/:id/approvals`), migration `tickets/005_sharing_approvals_email.sql` (`ticket_approvals`); `/api/portal/approvals`; `web/src/modules/tickets/CatalogDesigner.tsx`, `Cockpit.tsx`, `web/src/modules/portal/Approvals.tsx`; tests `server/src/modules/tickets/approvals.test.ts`, `server/src/modules/portal/sharing.test.ts`

### E03-22 Catalog request approvals on the shared approval workflows

**Status:** done · **Priority:** P3 · **Type:** improvement

As a service desk lead, the approvals a catalog item asks for (how many, from whom, only for some answers) run on the shared approval workflows (E14-06), so they get due times, escalation, department heads and the Approvals page like every other approval.

**Acceptance criteria**

- [x] A catalog item can name an approval workflow in place of its own approval settings
- [x] Existing approval settings and decisions keep working and stay visible
- [x] The ticket strip and the portal's approvals read the workflow's state

Approval kind `ticket_approval`: a request from an item that needs approval (for the chosen answers, E03-21) starts the item's workflow (`catalog_items.approval_workflow_id`; none: the catalog request approval workflow that fits best). The outcome writes `approval_status`, `approval_by`, `approval_at` and `approval_note`; the status gate is unchanged. One rejection now ends the approval (the earlier "an approval after a rejection overturns it" gave way to **Ask for approval again**, `POST /api/tickets/:id/approval/ask`). `POST /api/tickets/:id/approval` decides through the workflow; items' `approvals_needed` and `approver_ids` sent through the API name a workflow with exactly that step. At upgrade each item's settings became a workflow, and requests still waiting were adopted as running workflows with their approvers and the approvals already given; earlier decisions stay readable.

**Implemented in:** `server/src/modules/tickets/catalog.ts` (kind, install, routes), migration `tickets/006_approval_workflows.sql`; `/api/portal/approvals` in `server/src/modules/portal/index.ts`; `web/src/modules/tickets/CatalogDesigner.tsx`, `Cockpit.tsx`; tests `server/src/modules/tickets/approvals.test.ts`, `server/src/modules/portal/portal.test.ts`
