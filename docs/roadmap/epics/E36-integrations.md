# E36 Integrations

**Status:** done (8 of 8 issues done)

## Goal

Connect the application to the tools around it: user provisioning, audit log forwarding to a security monitoring system, calendar feeds, chat notifications, evidence kept in a document store and a two-way bridge to an outside work-tracking tool. Gap review GP-17.

## Scope notes

- Planned for wave 11: provisioning and log forwarding first (security posture), then calendar feeds.
- Calendar feeds, evidence links and the work-tracker bridge (E36-03, -05, -06) are module `feeds` and the attachments module; they make no outside call except the work-tracker push, through the same address checks as webhooks (`postWebhook`). The server never fetches a linked document.
- Every outside connection is off by default and limited to allowed hosts, like webhooks.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E36-01 | SCIM user provisioning and deprovisioning | done | P1 |
| E36-02 | Audit log forwarding to a security monitoring system | done | P1 |
| E36-03 | Calendar feeds | done | P2 |
| E36-04 | Chat notification presets | done | P3 |
| E36-05 | Evidence by link to a document store | done | P3 |
| E36-06 | Two-way work-tracker bridge | done | P3 |
| E36-07 | Provisioning and forwarding guide | done | P2 |
| E36-08 | Feeds and links guide | done | P2 |

---

### E36-01 SCIM user provisioning and deprovisioning

**Status:** done · **Priority:** P1 · **Type:** feature

An identity administrator wants accounts created and disabled from the directory, so leavers lose access at once.

**Acceptance criteria**

- [x] A SCIM endpoint for users and groups (`/api/scim/v2/Users`, `/Groups`, `/ServiceProviderConfig`, `/Schemas`, `/ResourceTypes`; module `integrations`)
- [x] Deprovisioning disables the account and ends its sessions and tokens (`deactivateUser` in `admin/users.ts`: sessions, links, API tokens, AI assistant connections and calendar feeds; never a hard delete)
- [x] Its own token (`grc_scim_`, hashed, constant-time compare, revocable, address-limited, audited), off by default (`integrations.scim_enabled`), refused calls limited per address with `take()`, 600 calls a minute per token
- [x] Groups give roles only through an administrator's mapping; never a role that administers; only roles provisioning gave are taken away; the last administrator and the break-glass account are protected
- [x] Administration > User provisioning; guide page 35; tests `integrations/scim.test.ts`, browser suite `18-integrations`

Limits: no SCIM bulk requests or sorting; attributes the application does not keep (titles, phone numbers, addresses) are ignored. A provisioned account has no local password: it links its sign-in provider by email at first sign-in when an administrator chose one, otherwise an administrator allows the link.

### E36-02 Audit log forwarding to a security monitoring system

**Status:** done · **Priority:** P1 · **Type:** feature

A security team wants every audit event forwarded as syslog or JSON over HTTPS.

**Acceptance criteria**

- [x] Forwarding through the job queue (`integrations.audit_forward`, every minute, lane `integrations`), with retries (one minute doubling to an hour, the cursor moves only on success) and a delivery log (kept `retention.audit_forward_log_days`, 30)
- [x] Syslog RFC 5424 over TLS (certificates verified; an extra certificate authority may be given) or plain TCP, and JSON lines over HTTPS through the SSRF-safe client; only to allowed hosts; off by default
- [x] Claimed per forwarder (`claimed_until`), so overlapping runs send each event once; values under secret-like keys and webhook addresses left out of what is sent
- [x] Administration > Log forwarding; tests `integrations/forwarding.test.ts`

### E36-03 Calendar feeds

**Status:** done · **Priority:** P2 · **Type:** feature

Staff want due dates, reviews, exercises and changes in their calendar.

**Acceptance criteria**

- [x] Personal ICS feeds with a revocable secret address, permission-filtered
- [x] Off until an administrator sets `feeds.calendar_enabled` (password confirmation to switch on); switched off, every feed answers 404
- [x] The secret (`grc_cal_` and 32 random bytes) is shown once and stored as a SHA-256; the owner can replace the address (the old one stops at once) or revoke the feed, and an administrator can revoke anyone's
- [x] A feed is worked out as its person on every read, from the calendar source registry (`core/calendar.ts`): sources of a switched-off area or without the permission are left out, every event's record is checked again with `visibleWhere`, restricted records show as "Restricted record" unless the feed shows titles; a disabled account, an unknown, revoked or replaced address all get the same 404; the public route is rate limited (120 a minute per address)
- [x] Sources for the modules built before wave 11: `actions.due`, `risks.review`, `obligations.due`, `policies.review`, `exercises.date`, `changes.window`, `governance.meetings` (answers E28's "meetings send no calendar invitations"), `audits.inspections`, `controls.tests`
- [x] Window 90 days back to 365 days ahead; each event links to its record

**Implemented in:** `server/src/modules/feeds/` (`calendar.ts`, `sources.ts`, `ics.ts`, migration `001_feeds.sql`), `web/src/modules/feeds/CalendarFeeds.tsx`, `FeedsAdmin.tsx`; tests `feeds/feeds.test.ts`, browser suite `19-feeds.mjs`

### E36-04 Chat notification presets

**Status:** done · **Priority:** P3 · **Type:** feature

A team wants notifications in its chat channel as formatted cards.

**Acceptance criteria**

- [x] Webhook presets for common chat formats: `plain_json` (the full event), `chat_text` (`{ text }`) and `chat_card` (`{ title, text, link, facts }`), generic and named after no product; a summary and changed field names only, never values; signed as before (core migration 027)

### E36-05 Evidence by link to a document store

**Status:** done · **Priority:** P3 · **Type:** feature

An evidence owner wants to link a document in the document store, with when it was last checked, instead of uploading a copy.

**Acceptance criteria**

- [x] Evidence links with a freshness date
- [x] `POST /api/attachments/link` (http or https, at most 1,000 characters, no credentials; same view and edit checks as uploads) and `POST /api/attachments/:id/checked`; a link is an attachments row with `storage_driver = 'link'` and no stored bytes, so removal, legal holds, purge and retention treat it as a file; the server never fetches the address, and audit events keep only its host and a fingerprint
- [x] Links not checked for `attachments.link_check_days` (90) remind the record's owner, claimed on the row before sending
- [x] "Add link" and a "Checked" stamp in the attachments panel

**Implemented in:** `server/src/modules/attachments/links.ts`, `linkReminders.ts`, migration `003_evidence_links.sql`; `web/src/modules/attachments/LinkDialog.tsx`, `AttachmentsPanel.tsx`; tests `attachments/links.test.ts`, browser suite `19-feeds.mjs`

### E36-06 Two-way work-tracker bridge

**Status:** done · **Priority:** P3 · **Type:** feature

An IT lead wants actions and vulnerabilities sent to an outside work-tracking tool and their status brought back.

**Acceptance criteria**

- [x] Outbound create and inbound status update for actions and vulnerabilities
- [x] Connections (`ticket_connectors`) with a sealed address and secrets, off until switched on, generic signed JSON only; adding one, a new address, including restricted records (needs `security.view`) or switching it on needs a password confirmation
- [x] Outbound by hand ("Send to work tracker", needs edit on the record) or on create; job `feeds.tracker_push` claims each link in one statement before sending (two overlapping pushes send once), through `postWebhook` and the allow-list; restricted records never sent unless the connection includes them
- [x] Inbound `POST /api/integrations/tracker/:connectorId/status`: HMAC over timestamp and raw body, 5-minute window, replay refused (last 1,000 signatures per connector), the same 401 for every refusal, rate limited; the status map moves the record only as its lifecycle allows the person who sent it

- [x] Named neutrally ("work tracker", routes `/api/admin/tracker-connectors`, `/api/tracker/...`, `/api/integrations/tracker/...`) so nothing of the switched-off service desk shows; a kind of record whose area is switched off is not offered, accepted, sent or named (the connection keeps it stored), and the API descriptions name no kind

**Implemented in:** `server/src/modules/feeds/tracker.ts`; `web/src/modules/feeds/TrackerLinkPanel.tsx` (a Work tracker tab on action and vulnerability pages), `FeedsAdmin.tsx`; tests `feeds/tracker.test.ts`, browser suites `19-feeds.mjs`, `09-features-off.mjs`

### E36-07 Provisioning and forwarding guide

**Status:** done · **Priority:** P2 · **Type:** documentation

An administrator wants a guide to user provisioning and audit-log forwarding.

**Acceptance criteria**

- [x] Guide page `35-user-provisioning-and-log-forwarding.md`, saying that forwarded events cannot be recalled at the end of retention

### E36-08 Feeds and links guide

**Status:** done · **Priority:** P2 · **Type:** documentation

A user wants a guide to calendar feeds, evidence by link and the work-tracker bridge.

**Acceptance criteria**

- [x] Guide page `36-calendar-feeds-work-trackers-and-evidence-links.md`
- [x] Evidence links in `14-attachments-and-notifications.md`

**Implemented in:** `docs/user/36-calendar-feeds-work-trackers-and-evidence-links.md`, `docs/user/14-attachments-and-notifications.md`
