# E15 Self-service portal

**Status:** in progress (groundwork only)

## Goal

Let any member of staff raise a request, report a fault and follow its progress without
needing an IT account with wider access, and let requests arrive by email.

## Scope notes

- Only groundwork exists: a "Self-service portal" feature switch (off by default) and a
  Requester role (switched off by default) holding `portal.view` and `portal.create`.
  Nothing reads the switch and no route checks those permissions.
- The portal should be a separate, simpler area of the web app, not the agent screens
  with parts hidden.
- Email-to-ticket needs inbound mail, which the local prototype cannot receive.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E15-01 | Portal feature switch and Requester role | done | P2 |
| E15-02 | Portal home and "raise a request" | open | P2 |
| E15-03 | Track my own requests | open | P2 |
| E15-04 | Catalogue in the portal | open | P2 |
| E15-05 | Knowledge base for requesters | open | P3 |
| E15-06 | Email-to-ticket | open | P3 |
| E15-07 | Satisfaction answer from the requester | open | P3 |
| E15-08 | Document the `portal` permission key | open | P3 |

---

### E15-01 Portal feature switch and Requester role

**Status:** done · **Priority:** P2 · **Type:** feature

As an administrator, I can see a switch for the portal in settings and a Requester role
in the role list, ready for when the portal is built.

**Acceptance criteria**

- [x] A `portal` feature switch, off by default, reported to the web app
- [x] A Requester default role, switched off, with `portal.view` and `portal.create`
- [x] `portal` appears in the role editor's permission list
- [ ] Something uses them (the remaining issues in this epic)

**Implemented in:** `FEATURE_KEYS` (`server/src/modules/admin/settings.ts`); `DEFAULT_ROLES` (`server/src/core/services.ts`); `web/src/modules/admin/Settings.tsx`, `RoleDetail.tsx`

### E15-02 Portal home and "raise a request"

**Status:** open · **Priority:** P2 · **Type:** feature

As a member of staff, I sign in to a simple page where I can report a fault or ask for
something in a few fields, without seeing the agent screens.

**Acceptance criteria**

- [ ] A portal layout shown to people who hold only portal permissions
- [ ] A short form creates a ticket with me as the requester and the channel set to "portal"
- [ ] I cannot set priority, assignee or internal fields
- [ ] Routes check `portal.*` and the feature switch
- [ ] Tests prove a requester cannot reach agent routes

### E15-03 Track my own requests

**Status:** open · **Priority:** P2 · **Type:** feature

As a requester, I see the tickets I raised, their status and the public comments, and I
can add a reply.

**Acceptance criteria**

- [ ] I see only tickets where I am the requester
- [ ] Internal comments are never shown
- [ ] My replies are added as public comments
- [ ] I can reopen a resolved ticket within a set number of days

### E15-04 Catalogue in the portal

**Status:** open · **Priority:** P2 · **Type:** feature

As a requester, I browse the service catalogue and pick what I need, which opens the
right request form.

**Acceptance criteria**

- [ ] Active catalogue items are listed by category
- [ ] Choosing one pre-fills the request
- [ ] Items can be marked as agent-only
- [ ] Works with item-specific questions once [E03-15](E03-service-desk.md) is built

### E15-05 Knowledge base for requesters

**Status:** open · **Priority:** P3 · **Type:** feature

As a requester, I search published articles written for everyone and am offered
matching ones before I submit a request.

**Acceptance criteria**

- [ ] Only published articles with the "everyone" audience are shown
- [ ] Suggestions appear as I type a request title
- [ ] Depends on [E03-16](E03-service-desk.md)

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

**Status:** open · **Priority:** P3 · **Type:** feature

As a requester, when my ticket is resolved I am asked how it went and answer in one
click. Today an agent asks and records the answer.

**Acceptance criteria**

- [ ] A one-question prompt on the resolved ticket in the portal
- [ ] The answer is stored in the existing satisfaction fields
- [ ] One answer per ticket; agents can no longer overwrite it

### E15-08 Document the `portal` permission key

**Status:** open · **Priority:** P3 · **Type:** docs

As a developer, I find `portal` in the documented list of permission module keys. Today
the server's permission vocabulary includes it but the developer guide's list did not.

**Acceptance criteria**

- [x] `portal` is added to the "Module keys (fixed)" list in `docs/development.md`
- [ ] The Requester role's purpose is described in the administrator guide
