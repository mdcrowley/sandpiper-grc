# E36 Integrations

**Status:** open (0 of 8 issues done)

## Goal

Connect the application to the tools around it: user provisioning, audit log forwarding to a security monitoring system, calendar feeds, chat notifications, evidence kept in a document store and a two-way ticketing bridge. Gap review GP-17.

## Scope notes

- Planned for wave 11: provisioning and log forwarding first (security posture), then calendar feeds.
- Every outside connection is off by default and limited to allowed hosts, like webhooks.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E36-01 | SCIM user provisioning and deprovisioning | open | P1 |
| E36-02 | Audit log forwarding to a security monitoring system | open | P1 |
| E36-03 | Calendar feeds | open | P2 |
| E36-04 | Chat notification presets | open | P3 |
| E36-05 | Evidence by link to a document store | open | P3 |
| E36-06 | Two-way ticketing bridge | open | P3 |
| E36-07 | Provisioning and forwarding guide | open | P2 |
| E36-08 | Feeds and links guide | open | P2 |

---

### E36-01 SCIM user provisioning and deprovisioning

**Status:** open · **Priority:** P1 · **Type:** feature

An identity administrator wants accounts created and disabled from the directory, so leavers lose access at once.

**Acceptance criteria**

- [ ] A SCIM endpoint for users and groups
- [ ] Deprovisioning disables the account and ends its sessions and tokens

### E36-02 Audit log forwarding to a security monitoring system

**Status:** open · **Priority:** P1 · **Type:** feature

A security team wants every audit event forwarded as syslog or JSON over HTTPS.

**Acceptance criteria**

- [ ] Forwarding through the job queue, with retries and a delivery log

### E36-03 Calendar feeds

**Status:** open · **Priority:** P2 · **Type:** feature

Staff want due dates, reviews, exercises and changes in their calendar.

**Acceptance criteria**

- [ ] Personal ICS feeds with a revocable secret address, permission-filtered

### E36-04 Chat notification presets

**Status:** open · **Priority:** P3 · **Type:** feature

A team wants notifications in its chat channel as formatted cards.

**Acceptance criteria**

- [ ] Webhook presets for common chat formats

### E36-05 Evidence by link to a document store

**Status:** open · **Priority:** P3 · **Type:** feature

An evidence owner wants to link a document in the document store, with when it was last checked, instead of uploading a copy.

**Acceptance criteria**

- [ ] Evidence links with a freshness date

### E36-06 Two-way ticketing bridge

**Status:** open · **Priority:** P3 · **Type:** feature

An IT lead wants actions and vulnerabilities sent to an outside ticketing tool and their status brought back.

**Acceptance criteria**

- [ ] Outbound create and inbound status update for actions and vulnerabilities

### E36-07 Provisioning and forwarding guide

**Status:** open · **Priority:** P2 · **Type:** documentation

An administrator wants a guide to user provisioning and audit-log forwarding.

**Acceptance criteria**

- [ ] Guide page `35-user-provisioning-and-log-forwarding.md`, saying that forwarded events cannot be recalled at the end of retention

### E36-08 Feeds and links guide

**Status:** open · **Priority:** P2 · **Type:** documentation

A user wants a guide to calendar feeds, evidence by link and the ticketing bridge.

**Acceptance criteria**

- [ ] Guide page `36-calendar-feeds-ticketing-and-evidence-links.md`
