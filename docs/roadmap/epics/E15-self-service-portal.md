# E15 Self-service portal

**Status:** in progress (portal built; email-to-ticket open)

## Goal

Let any member of staff raise a request, report a fault and follow its progress without
needing an IT account with wider access, and let requests arrive by email.

## Scope notes

- The portal is a separate, simpler area of the web app at `/portal` with its own layout
  (`web/src/modules/portal/PortalApp.tsx`, picked up by `web/src/App.tsx`), not the agent
  screens with parts hidden. It is behind the `portal` feature switch and the Requester role,
  both off by default.
- People who hold only portal permissions have no `tickets.*` permission, so every agent route
  refuses them; the `/api/portal/*` routes are their only way to tickets, and each is scoped to
  tickets where they are the requester or the affected person.
- Email-to-ticket needs inbound mail, which the local prototype cannot receive.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E15-01 | Portal feature switch and Requester role | done | P2 |
| E15-02 | Portal home and "raise a request" | done | P2 |
| E15-03 | Track my own requests | done | P2 |
| E15-04 | Catalogue in the portal | done | P2 |
| E15-05 | Knowledge base for requesters | done | P3 |
| E15-06 | Email-to-ticket | open | P3 |
| E15-07 | Satisfaction answer from the requester | done | P3 |
| E15-08 | Document the `portal` permission key | done | P3 |
| E15-09 | Requester scoping on the server | done | P1 |
| E15-10 | Portal home: approvals, policies, training, equipment, service banner | done | P2 |
| E15-11 | Portal settings | done | P2 |
| E15-12 | Raise a request on behalf of someone else from the portal | open | P3 |
| E15-13 | Files the service desk shares with the requester | open | P3 |
| E15-14 | Required custom fields on tickets block portal requests | open | P2 |

---

### E15-01 Portal feature switch and Requester role

**Status:** done · **Priority:** P2 · **Type:** feature

As an administrator, I can see a switch for the portal in settings and a Requester role
in the role list, ready for when the portal is built.

**Acceptance criteria**

- [x] A `portal` feature switch, off by default, reported to the web app
- [x] A Requester default role, switched off, with `portal.view` and `portal.create`
- [x] `portal` appears in the role editor's permission list
- [x] Something uses them (the remaining issues in this epic)

**Implemented in:** `FEATURE_KEYS` (`server/src/modules/admin/settings.ts`); `DEFAULT_ROLES` (`server/src/core/services.ts`); `web/src/modules/admin/Settings.tsx`, `RoleDetail.tsx`; `server/src/modules/portal/access.ts`

### E15-02 Portal home and "raise a request"

**Status:** done · **Priority:** P2 · **Type:** feature

As a member of staff, I sign in to a simple page where I can report a fault or ask for
something in a few fields, without seeing the agent screens.

**Acceptance criteria**

- [x] A portal layout shown to people who hold only portal permissions (they are sent to `/portal`; others reach it from **Self-service portal** in the sidebar)
- [x] A short form creates a ticket with me as the requester and the channel set to "portal" ("Report a problem": what, detail, where, who is affected and how urgent in plain words, mapped to impact and urgency)
- [x] I cannot set priority, assignee or internal fields (the server builds the ticket from a fixed set of inputs)
- [x] Routes check `portal.*` and the feature switch
- [x] Tests prove a requester cannot reach agent routes
- [x] Works at 390, 820 and 1440 wide, light and dark; touch targets at least 44 px

**Implemented in:** `server/src/modules/portal/` (`index.ts`, `requests.ts`, `access.ts`, `words.ts`); `web/src/modules/portal/` (`PortalApp.tsx`, `Home.tsx`, `RequestForm.tsx`, `portal.css`); `web/src/App.tsx`; tests `server/src/modules/portal/portal.test.ts`

### E15-03 Track my own requests

**Status:** done · **Priority:** P2 · **Type:** feature

As a requester, I see the tickets I raised, their status and the public comments, and I
can add a reply.

**Acceptance criteria**

- [x] I see only tickets where I am the requester (or the affected person, `affected_user_id`)
- [x] Internal comments are never shown
- [x] My replies are added as public comments; a reply to "waiting on requester" hands the ticket back to IT
- [x] I can reopen a resolved ticket within a set number of days (setting; default 7), giving a reason
- [x] Status in plain words (Received, Being worked on, Waiting for you, On hold, Waiting for approval, Not approved, Resolved, Closed, Cancelled; a status's lookup `meta.portal_label` overrides the label)
- [x] I add files to my request and see only the files I added
- [x] I am notified of public replies and when IT need me or resolve the request (links into the portal)

**Implemented in:** `server/src/modules/portal/requests.ts`, `files.ts`; `tellRequester` in `server/src/modules/tickets/index.ts`; `web/src/modules/portal/MyRequests.tsx`, `RequestDetail.tsx`

### E15-04 Catalogue in the portal

**Status:** done · **Priority:** P2 · **Type:** feature

As a requester, I browse the service catalogue and pick what I need, which opens the
right request form.

**Acceptance criteria**

- [x] Active catalogue items are listed by category
- [x] Choosing one pre-fills the request (its type, category, impact, urgency and group; title from "Title starts with" and the first answer)
- [x] Items can be marked as agent-only (items appear only when **Show in the self-service portal** is ticked; `catalog_items.portal`)
- [x] Works with item-specific questions (text, long text, choice, date, yes or no), and approval

**Implemented in:** `server/src/modules/tickets/migrations/004_portal.sql`; `web/src/modules/portal/CataloguePage.tsx`, `RequestForm.tsx`; `web/src/modules/tickets/Catalogue.tsx`; invented transit samples in `server/src/modules/portal/seed.ts`

### E15-05 Knowledge base for requesters

**Status:** done · **Priority:** P3 · **Type:** feature

As a requester, I search published articles written for everyone and am offered
matching ones before I submit a request.

**Acceptance criteria**

- [x] Only published articles with the "All staff" (`staff`) audience are shown
- [x] Suggestions appear as I type a request title, and in the home page search
- [x] "Was this helpful?" records one vote per person per version (shared with the knowledge base)

**Implemented in:** `/api/portal/knowledge*` in `server/src/modules/portal/index.ts`; `server/src/modules/tickets/feedback.ts`; `web/src/modules/portal/ArticlePage.tsx`, `parts.tsx`

### E15-06 Email-to-ticket

**Status:** open · **Priority:** P3 · **Type:** feature

As a member of staff, I email the service desk address and a ticket is created; my
later replies are added to it as comments.

**Acceptance criteria**

- [ ] A mailbox is polled or a mail hook is received, by configuration
- [ ] A new message creates a ticket with the sender as requester and channel "email"
- [ ] A reply with the ticket reference becomes a public comment
- [ ] Attachments are kept (depends on [E14-01](E14-platform-services.md))
- [ ] Messages from unknown senders follow a configurable rule

### E15-07 Satisfaction answer from the requester

**Status:** done · **Priority:** P3 · **Type:** feature

As a requester, when my ticket is resolved I am asked how it went and answer in one
click. Today an agent asks and records the answer.

**Acceptance criteria**

- [x] A one-question prompt on the resolved ticket in the portal (one to five stars, optional comment)
- [x] The answer is stored in the existing satisfaction fields (with `satisfaction_by_requester`, `satisfaction_at`)
- [x] One answer per ticket; agents can no longer overwrite it

**Implemented in:** `server/src/modules/portal/requests.ts`; `beforeUpdate` in `server/src/modules/tickets/index.ts`; `web/src/modules/tickets/TicketDetail.tsx`

### E15-08 Document the `portal` permission key

**Status:** done · **Priority:** P3 · **Type:** docs

**Acceptance criteria**

- [x] `portal` is added to the "Module keys (fixed)" list in `docs/development.md`
- [x] The Requester role's purpose is described in the user guide (`docs/user/18-self-service-portal.md`)

### E15-09 Requester scoping on the server

**Status:** done · **Priority:** P1 · **Type:** security

As the organisation, I am sure that someone with only the Requester role sees their own
tickets and nothing else.

**Acceptance criteria**

- [x] Lists, one ticket, search, stats, exports, comments, history, links, record pickers and labels refuse or leave out tickets for a requester
- [x] Every portal route answers "not found" for another person's ticket
- [x] Files: a requester may upload to their own ticket and download only files they added; the agent file list, change and delete stay closed
- [x] Tests for every route (`server/src/modules/portal/portal.test.ts`)

**Implemented in:** `server/src/modules/portal/access.ts`, `files.ts`

### E15-10 Portal home: approvals, policies, training, equipment, service banner

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] My approvals: service requests (people with `tickets.approve`) and changes routed to me (`/api/changes/waiting`), approved or rejected with a reason in place
- [x] Policies to acknowledge, read and acknowledged in the portal
- [x] My training (when the training module is loaded) and My equipment (assets whose user is me)
- [x] A service status banner set by the service desk

**Implemented in:** `web/src/modules/portal/Home.tsx`, `Approvals.tsx`, `PolicyPage.tsx`; `/api/portal/assets`, `/api/portal/approvals`

### E15-11 Portal settings

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] On or off (administrators only; the shared `portal` feature switch), title, welcome line, banner, reopen window
- [x] Which catalogue items appear, switched per item
- [x] Changes audited

**Implemented in:** `server/src/modules/portal/settings.ts`; `web/src/modules/tickets/SettingsPortal.tsx` (Service desk settings, **Self-service portal** tab)

### E15-12 Raise a request on behalf of someone else from the portal

**Status:** open · **Priority:** P3 · **Type:** feature

A supervisor raises a request for one of their operators, who then sees it too.

- [ ] Choose a colleague as the affected person in the portal form
- [ ] Limit who may do this (for example by department)

### E15-13 Files the service desk shares with the requester

**Status:** open · **Priority:** P3 · **Type:** feature

Today a requester sees only files they added, because attachments have no "public" flag.

- [ ] Agents can mark a file on a ticket as shared with the requester
- [ ] The portal lists and downloads shared files

### E15-14 Required custom fields on tickets block portal requests

**Status:** open · **Priority:** P2 · **Type:** defect

Portal requests are created as the requester, so an administrator's **required** custom field
on tickets would refuse them (the requester cannot see or fill it).

- [ ] Portal requests skip custom fields, or custom fields can be marked "not asked in the portal"
- [ ] A test with a required custom field
