# E21 MCP server (AI assistant access)

**Status:** done (24 of 24 issues done)

## Goal

Let people use Sandpiper GRC from AI assistants such as Claude Desktop, Claude Code and other
Model Context Protocol (MCP) clients: look things up, summarize their work, risks, incidents
and service levels, and (when allowed) make changes, always as themselves and never with more
rights than they have.

## Scope notes

- Module `mcp` (server `server/src/modules/mcp`, web `web/src/modules/mcp`), the stdio bridge
  `tools/mcp-stdio.mjs`, technical reference [`docs/mcp.md`](../../mcp.md), user guide
  [`docs/user/21-ai-assistants-and-mcp.md`](../../user/21-ai-assistants-and-mcp.md).
- Security first: bearer tokens only (never the cookie), Origin validation, off by default,
  write access separately off by default, no delete, every tool through the REST routes with
  the caller's token.
- Core pieces it relies on (`core/tokens.ts`): scope families and run-time gates (`mcp.use`),
  `issueToken`, source addresses, and `registerBearerResolver` for OAuth access tokens.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E21-01 | Streamable HTTP endpoint at /mcp | done | P1 |
| E21-02 | Token-only authentication, the `mcp.use` scope and Origin validation | done | P1 |
| E21-03 | Off by default; administrator settings | done | P1 |
| E21-04 | Every call as the token's user through the REST routes | done | P1 |
| E21-05 | Generic record tools | done | P1 |
| E21-06 | Write tools behind write access, no delete, audited via MCP | done | P1 |
| E21-07 | Work and insight tools | done | P1 |
| E21-08 | User guide resources, record resource template and prompts | done | P2 |
| E21-09 | Per-token rate limit and call log | done | P1 |
| E21-10 | Connect an AI assistant (tokens and ready-made configuration) | done | P1 |
| E21-11 | stdio bridge | done | P1 |
| E21-12 | Tests against the real endpoint and the bridge | done | P1 |
| E21-13 | Documentation | done | P1 |
| E21-14 | Core: let `scopeCovered` accept the `mcp` scope family | done | P2 |
| E21-15 | "Connect an AI assistant" card on Account security and a Settings link | done | P2 |
| E21-16 | OAuth 2.1 authorization for remote connectors | done | P3 |
| E21-17 | Who may connect an assistant (role permission) | done | P2 |
| E21-18 | Help for this page: route map entries | done | P3 |
| E21-19 | Tool-level choice per token and per role | done | P3 |
| E21-20 | Progress notifications for long-running tools | done | P3 |
| E21-21 | Client ID metadata documents for connectors | done | P3 |
| E21-22 | "What is affected if this system fails" tool | done | P2 |
| E21-23 | Audit log search tool (by request id) | done | P3 |
| E21-24 | Summary tools for the wave 10 and 11 parts | done | P2 |

---

### E21-01 Streamable HTTP endpoint at /mcp

**Status:** done · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [x] `POST /mcp` with the SDK's `StreamableHTTPServerTransport`, stateless, JSON responses, inside the Fastify server
- [x] `GET` and `DELETE /mcp` answer `405` with `Allow: POST`
- [x] Server name `sandpiper-grc`, instructions telling the assistant how to work

**Implemented in:** `server/src/modules/mcp/http.ts`, `server.ts`

### E21-02 Token-only authentication, the `mcp.use` scope and Origin validation

**Status:** done · **Priority:** P1 · **Type:** security

**Acceptance criteria**

- [x] Only `Authorization: Bearer grc_pat_...`; a cookie-only request gets `401` with `WWW-Authenticate: Bearer`
- [x] The token is checked by the core exactly as for `/api` (in-process `GET /api/mcp/session`)
- [x] A token without `mcp.use` (or `mcp.*`) is refused, including `*` tokens
- [x] Any `Origin` header not in `mcp.allowed_origins` is refused (`403`)

**Implemented in:** `server/src/modules/mcp/http.ts`, `index.ts`, `settings.ts`

### E21-03 Off by default; administrator settings

**Status:** done · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [x] `mcp.enabled`, `mcp.write_enabled`, `mcp.allowed_tools`, `mcp.rate_per_minute`, `mcp.allowed_origins`; all off or empty by default
- [x] Changed only by an administrator's signed-in session with a recent password confirmation; tokens refused
- [x] Administration > AI assistant access: on/off, write access, request limit, allowed tools, browser origins

**Implemented in:** `server/src/modules/mcp/index.ts`; `web/src/modules/mcp/AdminPage.tsx`

### E21-04 Every call as the token's user through the REST routes

**Status:** done · **Priority:** P1 · **Type:** security

**Acceptance criteria**

- [x] Tools call `/api` in-process with the caller's token (`app.inject`); no tool reads the database
- [x] Restricted records invisible without `security.view` in every tool, resource and search (tested with an agent token)
- [x] Tools a caller cannot use are not offered

**Implemented in:** `server/src/modules/mcp/caller.ts`, `toolkit.ts`, `tools.ts`

### E21-05 Generic record tools

**Status:** done · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [x] `list_record_types`, `search`, `list_records`, `get_record`, `get_related`, `get_history` with zod inputs, labeled values, links, paged (≤ 50)
- [x] Records by id or reference; types by key, label or plural
- [x] Readable summary plus structured content; clear errors for unknown types and fields

**Implemented in:** `server/src/modules/mcp/tools-records.ts`

### E21-06 Write tools behind write access, no delete, audited via MCP

**Status:** done · **Priority:** P1 · **Type:** security

**Acceptance criteria**

- [x] `add_comment`, `create_record`, `update_record`, `link_records` offered only when write access is on and the token has create or edit permissions
- [x] Read-only fields refused; validation errors returned per field
- [x] No delete tool; `destructiveHint: false`, `readOnlyHint`, `idempotentHint` annotations
- [x] An `mcp.write` audit event on the record naming the token and "via MCP", besides the route's own event

**Implemented in:** `server/src/modules/mcp/tools-records.ts`, `server.ts`

### E21-07 Work and insight tools

**Status:** done · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [x] `my_work`, `overdue_summary`, `risk_heatmap`, `framework_progress`, `incident_clocks` (needs `security.view`), `contracts_nearing_notice`, `vulnerability_summary`, `service_desk_metrics`, `run_report`
- [x] `fleet_equipment_gaps` and `safety_summary` offered only when those modules are loaded and permitted

**Implemented in:** `server/src/modules/mcp/tools-work.ts`

### E21-08 User guide resources, record resource template and prompts

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] `sandpiper://guide/<page>` for every `docs/user/*.md`
- [x] `sandpiper://record/{type}/{id}` through the same permission rules
- [x] Prompts: weekly risk and action review, board summary, triage open tickets, incident status update

**Implemented in:** `server/src/modules/mcp/server.ts`, `prompts.ts`

### E21-09 Per-token rate limit and call log

**Status:** done · **Priority:** P1 · **Type:** security

**Acceptance criteria**

- [x] `mcp.rate_per_minute` per token (`429`), on top of `tokens.rate_per_minute`
- [x] `mcp_calls`: tool, outcome, duration per token (no arguments or results), 90 days
- [x] Administrators see counts per token and tool and the latest calls

**Implemented in:** `server/src/modules/mcp/migrations/001_mcp_calls.sql`, `index.ts`; `web/src/modules/mcp/AdminPage.tsx`

### E21-10 Connect an AI assistant

**Status:** done · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [x] `/account/ai-assistant`: read only or read and write, expiry; token shown once (password confirmation)
- [x] Ready-to-copy configuration with this installation's address: Claude Desktop, Claude Code (HTTP and bridge), other MCP clients (HTTP and stdio)
- [x] List, last use, calls in 30 days and Disconnect for each assistant token
- [x] The bridge can be downloaded from the page

**Implemented in:** `web/src/modules/mcp/ConnectCard.tsx`, `ConnectPage.tsx`, `configs.ts`; `server/src/modules/mcp/index.ts`

### E21-11 stdio bridge

**Status:** done · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [x] `GRC_URL` and `GRC_TOKEN` from the environment only; no dependencies; Node 18+
- [x] Relays line-delimited JSON-RPC to `/mcp` in order; refusals become JSON-RPC errors
- [x] Streams progress notifications as they arrive, ahead of the result (E21-20)

**Implemented in:** `tools/mcp-stdio.mjs`

### E21-12 Tests

**Status:** done · **Priority:** P1 · **Type:** quality

**Acceptance criteria**

- [x] SDK client over HTTP on port 0: initialize, list tools, read-only calls, every insight tool offered
- [x] Agent token cannot see restricted records through any tool, resource or search
- [x] Writes refused when off, allowed when on with scopes; audit names the token; allowed-tool list
- [x] Origin, cookie-only, wrong token, no `mcp.use`, settings out of a token's reach, rate limit
- [x] Bridge round trip and refused token through the bridge

**Implemented in:** `server/src/modules/mcp/mcp.test.ts`; `web/src/modules/mcp/configs.test.ts`

### E21-13 Documentation

**Status:** done · **Priority:** P1 · **Type:** docs

**Implemented in:** `docs/mcp.md`, `docs/user/21-ai-assistants-and-mcp.md`

### E21-14 Core: let `scopeCovered` accept the `mcp` scope family

**Status:** done · **Priority:** P2 · **Type:** tech debt

`mcp.use` is a scope family (E13-18): anyone holding a permission may put it in a token, and the
API tokens dialog offers it. The module's own token route stays as a convenience (read or read and
write, tools, addresses) but no longer keeps its own copy of the token storage code.

**Acceptance criteria**

- [x] `scopeGrantable` accepts `mcp.use` and `mcp.*` for anyone holding a permission (E13-18)
- [x] The API tokens dialog offers `scopeFamilies`
- [x] `POST /api/mcp/tokens` makes the token with the core's `issueToken`
- [x] A run-time gate (`registerScopeGate`) so "who may connect" also applies on the API tokens card

**Implemented in:** `server/src/core/tokens.ts` (`SCOPE_FAMILIES`, `scopeGrantable`, `issueToken`, `registerScopeGate`); `server/src/modules/mcp/index.ts`; `web/src/modules/admin/ApiTokens.tsx`; tests `server/src/core/api/conventions.test.ts`, `server/src/modules/mcp/access.test.ts`

### E21-15 Card on Account security and a Settings link

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] Account security shows `ConnectAssistantCard` beside the API tokens card
- [x] AI assistant access links to the person's own page (**Connect my assistant**); the card links administrators to AI assistant access while it is off
- [x] A link from Administration > Settings to AI assistant access (the Settings page belongs to the admin module; change requested from its owner)

**Implemented in:** `web/src/modules/admin/AccountSecurity.tsx`, `web/src/modules/mcp/ConnectCard.tsx`, `AdminPage.tsx`

### E21-16 OAuth 2.1 for remote connectors

**Status:** done · **Priority:** P3 · **Type:** feature

Remote connectors (for example Claude's custom connectors) sign in with the MCP authorization
flow instead of a pasted token. Off by default; needs HTTPS (or loopback).

**Acceptance criteria**

- [x] Protected resource metadata (RFC 9728) at `/.well-known/oauth-protected-resource[/mcp]`; the `401` from `/mcp` names it (`resource_metadata`)
- [x] Authorization server metadata (RFC 8414) at `/.well-known/oauth-authorization-server`
- [x] Authorization code with PKCE, S256 only; codes single use, five minutes, bound to client, redirect address and challenge; a reused code ends the connection
- [x] Consent screen (`/oauth/authorize`): who asks, where the person returns, read or read and write, how long; recent password confirmation to allow; unknown clients and unregistered redirect addresses are never redirected to
- [x] Dynamic client registration (RFC 7591) only when an administrator allows it, rate-limited; administrators can add connectors by hand (public, or with a secret shown once)
- [x] Access tokens of an hour; refresh tokens rotate; a reused refresh token ends the connection
- [x] Revocation (RFC 7009); people disconnect their own connections; administrators remove connectors and end any connection; switching OAuth off ends all at once
- [x] Resource indicators (RFC 8707) checked; access tokens accepted only at `/mcp`, never on `/api` directly
- [x] Secrets, codes and tokens stored as SHA-256 only and never logged
- [x] Tests: the SDK's own client runs discovery, registration, PKCE, consent, tool calls and refresh; every failure path by hand

**Implemented in:** `server/src/modules/mcp/oauth.ts`, `migrations/002_oauth_and_tool_choice.sql`, `http.ts`, `index.ts`; `server/src/core/tokens.ts` (`registerBearerResolver`); `web/src/modules/mcp/ConsentPage.tsx`, `AdminAccess.tsx`, `ConnectCard.tsx`; test `server/src/modules/mcp/oauth.test.ts`; `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/token`, `/oauth/register`, `/oauth/revoke`, `POST /api/mcp/oauth/authorize`, `POST /api/mcp/oauth/decision`, `DELETE /api/mcp/oauth/grants/:id`, `/api/mcp/admin/oauth/clients`

### E21-17 Who may connect an assistant

**Status:** done · **Priority:** P2 · **Type:** security

Permission strings are fixed per module (`MODULE_KEYS`), so the choice is made by role in the
module's own setting rather than with a new permission.

**Acceptance criteria**

- [x] Setting `mcp.allowed_roles` (null = everyone holding a permission), chosen on AI assistant access
- [x] Applies to making assistant tokens, to `mcp.use` on the API tokens card, to the consent screen and to every `/mcp` request (existing tokens refused at once)
- [x] The card says when the person's role may not connect

**Implemented in:** `server/src/modules/mcp/settings.ts` (`mayConnect`), `index.ts`, `oauth.ts`; `web/src/modules/mcp/AdminAccess.tsx`, `ConnectCard.tsx`; test `access.test.ts`

### E21-18 Help for this page

**Status:** done · **Priority:** P3 · **Type:** docs

**Acceptance criteria**

- [x] `/admin/ai-assistants` and `/account/ai-assistant` open the AI assistants page of the guide
- [x] `/oauth/authorize` to "Connecting a remote connector by signing in" (route map change requested from the help module)

**Implemented in:** `web/src/modules/help/routeMap.ts`

### E21-19 Tool choice per token and per role

**Status:** done · **Priority:** P3 · **Type:** feature

**Acceptance criteria**

- [x] Setting `mcp.role_tools` (tools per role; the union over the person's roles; a role without a list does not narrow)
- [x] Tools per token or connector sign-in (`mcp_token_tools`), chosen when connecting and changed later by the owner (`PUT /api/mcp/tokens/:id/tools`)
- [x] Offered tools: the allowed list, narrowed by role and by token, then by write access and permissions

**Implemented in:** `server/src/modules/mcp/settings.ts` (`chosenTools`), `tools.ts`, `index.ts`; `web/src/modules/mcp/AdminAccess.tsx`, `ConnectCard.tsx`; test `access.test.ts`

### E21-20 Progress notifications for long-running tools

**Status:** done · **Priority:** P3 · **Type:** feature

No sessions needed: a `tools/call` with `_meta.progressToken` is answered as an event stream on
the same POST.

**Acceptance criteria**

- [x] `my_work`, `overdue_summary`, `framework_progress`, `run_report` and `system_impact` report progress (increasing, with total and message)
- [x] Plain JSON answers when no progress is asked for
- [x] The stdio bridge passes the events on as they arrive

**Implemented in:** `server/src/modules/mcp/http.ts` (`wantsProgress`), `server.ts`, `toolkit.ts`, `tools-work.ts`; `tools/mcp-stdio.mjs`; tests `access.test.ts`, `mcp.test.ts`

### E21-21 Client ID metadata documents for connectors

**Status:** done · **Priority:** P3 · **Type:** feature

Found while building E21-16. The 2025-11-25 MCP authorization specification prefers client ids
that are https addresses of a metadata document (draft-ietf-oauth-client-id-metadata-document).
Supporting them means fetching that document, an outbound connection, so it is fenced like
webhooks and more tightly.

**Acceptance criteria**

- [x] Off by default (`mcp.oauth_client_metadata`), and only while outbound connections are on; switching either off ends these connections at once
- [x] Fetched only from the consent screen's API (signed in, 20 lookups per person in 10 minutes), never by the token endpoint
- [x] SSRF fences: https only, port 443 unless listed, every resolved address public unless that exact address is listed, no redirects, 200 and JSON only, 5 KB, 5 seconds, valid certificate
- [x] Validated: `client_id` exactly its address, `client_name`, `redirect_uris` (same rules as registration), known fields only, no secret or private key, `token_endpoint_auth_method` `none`; redirect addresses matched exactly
- [x] Cached for the document's max-age (one minute to a day); errors never cached; changes audited
- [x] Administrators' host allow-list (`mcp.oauth_client_metadata_hosts`) and "approve each new connector first" (`mcp.oauth_client_metadata_approval`); removed connectors stay blocked until allowed again
- [x] Consent screen shows the document's host and address, says the name is self-declared, and warns about loopback redirect addresses
- [x] `client_id_metadata_document_supported` true only when on
- [x] Audited: first seen, changed, refused (with reason), approved, unblocked
- [x] Tests with a local HTTPS server (certificate made at test time): private address, name resolving to private or mixed addresses, redirects (to private and same origin), too large (declared and streamed), wrong type, 404, timeout, untrusted certificate, mismatched `client_id`, forbidden and unknown fields, unknown redirect address, rate limit, approval and blocking, switch-off

**Implemented in:** `server/src/modules/mcp/client-metadata.ts`, `oauth.ts` (`urlClient`), `settings.ts`, `index.ts`, `migrations/003_client_metadata.sql`; `web/src/modules/mcp/AdminAccess.tsx`, `ConsentPage.tsx`, `AdminPage.tsx`; test `server/src/modules/mcp/client-metadata.test.ts`; `POST /api/mcp/admin/oauth/clients/:id/approve`, `DELETE /api/mcp/admin/oauth/blocked/:id`

### E21-22 "What is affected if this system fails" tool

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] `system_impact` (system id, reference or name): downstream systems with depth and criticality, and the sites, data categories, assets, vehicles and services affected, each only where the person may see them
- [x] Offered only to people who can see systems; reports progress

**Implemented in:** `server/src/modules/mcp/tools-work.ts` (`GET /api/systems/:id/impact`); test `access.test.ts`

### E21-23 Audit log search tool (by request id)

**Status:** done · **Priority:** P3 · **Type:** feature

Follow-up of E13-20: an assistant can find everything one request did.

**Acceptance criteria**

- [x] `search_audit_log` (request id, text, action, record type and id, time span, up to 100 events) through `GET /api/audit`; at least one filter; before and after values left out
- [x] Offered only with `audit.view`; assistant tokens and connector sign-ins carry `audit.view` when their owner holds it
- [x] Restricted records' events stay hidden as on the audit log screen

**Implemented in:** `server/src/modules/mcp/tools-work.ts`, `index.ts` (`scopesFor`); test `access.test.ts`

### E21-24 Summary tools for the wave 10 and 11 parts

**Status:** done · **Priority:** P2 · **Type:** feature

An assistant user wants figures from audits, controls, corrective action plans, funding, committees, qualifications, continuity, asset condition, OT, records requests and the vendor lifecycle.

**Acceptance criteria**

- [x] One summary tool per part, reading its summary route with the caller's token (figures only, never requester details): `audit_summary`, `controls_summary`, `cap_summary`, `funding_summary`, `governance_summary`, `qualifications_summary`, `continuity_summary`, `asset_condition_summary`, `ot_summary`, `records_requests_summary`, `vendor_lifecycle_summary`
- [x] A switched-off part's tool is not offered (each is available only to a caller who may view the part's main record type)
- [x] A route that does not answer for the caller gives "not available" rather than an error
- [x] New `GET /api/governance/summary` (committees, meetings coming up and held, minutes waiting, decisions by outcome; figures only, the same for everyone)

**Implemented in:** `server/src/modules/mcp/tools-programs.ts`, `governance/summary.ts`; tests `mcp/tools-programs.test.ts` (stand-in routes for the wave 11 parts), `governance/summary.test.ts`; `docs/mcp.md`, `docs/user/21-ai-assistants-and-mcp.md`, `docs/user/28-committees-and-meetings.md`
