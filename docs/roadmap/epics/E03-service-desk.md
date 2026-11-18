# E03 Service desk

**Status:** in progress

## Goal

Let a small IT team log, prioritise and resolve incidents and requests against agreed
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
| E03-10 | Service catalogue | done | P2 |
| E03-11 | Screen for the priority matrix | open | P1 |
| E03-12 | Screen for targets, calendars and holidays | open | P1 |
| E03-13 | Warnings before and at a missed target | open | P2 |
| E03-14 | Escalation rules | open | P2 |
| E03-15 | Catalogue items with their own form and fulfilment steps | open | P2 |
| E03-16 | Enforce the "agents only" article audience | open | P2 |
| E03-17 | Add and remove working calendars | open | P3 |

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

**Implemented in:** `server/src/modules/tickets/sla.ts`; `GET /api/tickets/:id/sla`, `/api/tickets/sla/policies`, `/api/tickets/sla/calendars`; `web/src/modules/tickets/SlaClocks.tsx`

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

### E03-10 Service catalogue

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I pick a catalogue item (for example "new starter") and get a ticket with
the type, category and other values already filled in.

**Acceptance criteria**

- [x] Catalogue items with name, description, category and active flag
- [x] Each item carries the values it pre-fills on the ticket
- [x] A starter catalogue is added once and then belongs to administrators
- [x] Catalogue list and detail pages

**Implemented in:** `catalog_item` resource (`server/src/modules/tickets/index.ts`), `CATALOGUE` in `defaults.ts`; `web/src/modules/tickets/Catalogue.tsx`

### E03-11 Screen for the priority matrix

**Status:** open · **Priority:** P1 · **Type:** feature

As a service desk administrator, I can edit the impact-by-urgency matrix on a screen.
Today it can only be changed through the API.

**Acceptance criteria**

- [ ] A grid of impact by urgency with a priority picker in each cell
- [ ] A default priority for combinations not in the grid
- [ ] Saving uses the existing `PUT /api/tickets/priority-matrix`
- [ ] Only people with `tickets.administer` can edit; others see it read-only

### E03-12 Screen for targets, calendars and holidays

**Status:** open · **Priority:** P1 · **Type:** feature

As a service desk administrator, I can change respond and resolve targets, opening
hours and holidays on a screen. Today these are editable through the API only.

**Acceptance criteria**

- [ ] Targets per priority with a calendar picker
- [ ] Opening hours per weekday and a 24 by 7 switch
- [ ] Add and remove holidays
- [ ] Uses the existing `/api/tickets/sla/...` routes
- [ ] A note explains that changes apply to new due times, not past ones

### E03-13 Warnings before and at a missed target

**Status:** open · **Priority:** P2 · **Type:** feature

As an agent, I am told when one of my tickets is about to miss its target and when it
has, instead of having to look.

**Acceptance criteria**

- [ ] A warning at a configurable share of the window (for example 75%)
- [ ] A notice at the moment the target is missed
- [ ] Sent to the assignee, or the assignment group when unassigned
- [ ] Depends on notifications ([E14-03](E14-platform-services.md))

### E03-14 Escalation rules

**Status:** open · **Priority:** P2 · **Type:** feature

As a service desk lead, tickets that stay unassigned or untouched for too long are
escalated by rule to a named person or group.

**Acceptance criteria**

- [ ] Rules are data: condition, wait time, who to escalate to
- [ ] Wait time is counted in the ticket's working calendar
- [ ] Each escalation is audited and visible on the ticket
- [ ] Rules can be switched off individually

### E03-15 Catalogue items with their own form and fulfilment steps

**Status:** open · **Priority:** P2 · **Type:** feature

As a requester or agent, choosing a catalogue item shows the questions that item needs
and creates the tasks to fulfil it. Today an item only pre-fills a ticket.

**Acceptance criteria**

- [ ] Each item can define extra questions
- [ ] Answers are stored on the ticket
- [ ] An item can require approval before work starts
- [ ] An item can create a checklist of fulfilment tasks
- [ ] The raw-JSON "values" field is replaced by a form

### E03-16 Enforce the "agents only" article audience

**Status:** open · **Priority:** P2 · **Type:** bug

As an agent, I want articles marked "agents only" hidden from people who are not
agents. Today the audience is recorded but anyone with `knowledge.view` can read every
article.

**Acceptance criteria**

- [ ] Lists, search, links and direct reads hide agent-only articles from non-agents
- [ ] "Agent" is defined by a permission, not a role name
- [ ] A test covers a non-agent reader

### E03-17 Add and remove working calendars

**Status:** open · **Priority:** P3 · **Type:** improvement

As a service desk administrator, I can create a new calendar (for example an
out-of-hours rota) and retire one. Today existing calendars can be edited but not added
or removed through the API.

**Acceptance criteria**

- [ ] Create and retire calendars
- [ ] A calendar in use by a target cannot be retired
- [ ] Changes are audited
