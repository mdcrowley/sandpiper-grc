# E21 MCP server (AI assistant access)

**Status:** in progress (core built)

## Goal

Let people use Sandpiper GRC from AI assistants such as Claude Desktop, Claude Code and other
Model Context Protocol (MCP) clients: look things up, summarise their work, risks, incidents
and service levels, and (when allowed) make changes, always as themselves and never with more
rights than they have.

## Scope notes

- Module `mcp` (server `server/src/modules/mcp`, web `web/src/modules/mcp`), the stdio bridge
  `tools/mcp-stdio.mjs`, technical reference [`docs/mcp.md`](../../mcp.md), user guide
  [`docs/user/21-ai-assistants-and-mcp.md`](../../user/21-ai-assistants-and-mcp.md).
- Security first: bearer tokens only (never the cookie), Origin validation, off by default,
  write access separately off by default, no delete, every tool through the REST routes with
  the caller's token.
- No core files changed. The `mcp.use` scope is outside `scopeCovered`'s grants, so assistant
  tokens are made by the module's own route (E21-14 proposes the core change).

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
| E21-14 | Core: let `scopeCovered` accept the `mcp` scope family | open | P2 |
| E21-15 | "Connect an AI assistant" card on Account security and a Settings link | open | P2 |
| E21-16 | OAuth 2.1 authorisation for remote connectors | open | P3 |
| E21-17 | Who may connect an assistant (role permission) | open | P2 |
| E21-18 | Help for this page: route map entries | open | P3 |
| E21-19 | Tool-level choice per token and per role | open | P3 |
| E21-20 | Progress notifications for long-running tools | open | P3 |

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

- [x] `list_record_types`, `search`, `list_records`, `get_record`, `get_related`, `get_history` with zod inputs, labelled values, links, paged (≤ 50)
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

**Implemented in:** `tools/mcp-stdio.mjs`

### E21-12 Tests

**Status:** done · **Priority:** P1 · **Type:** quality

**Acceptance criteria**

- [x] SDK client over HTTP on port 0: initialise, list tools, read-only calls, every insight tool offered
- [x] Agent token cannot see restricted records through any tool, resource or search
- [x] Writes refused when off, allowed when on with scopes; audit names the token; allowed-tool list
- [x] Origin, cookie-only, wrong token, no `mcp.use`, settings out of a token's reach, rate limit
- [x] Bridge round trip and refused token through the bridge

**Implemented in:** `server/src/modules/mcp/mcp.test.ts`; `web/src/modules/mcp/configs.test.ts`

### E21-13 Documentation

**Status:** done · **Priority:** P1 · **Type:** docs

**Implemented in:** `docs/mcp.md`, `docs/user/21-ai-assistants-and-mcp.md`

### E21-14 Core: let `scopeCovered` accept the `mcp` scope family

**Status:** open · **Priority:** P2 · **Type:** tech debt

`POST /api/me/tokens` refuses `mcp.use` for anyone without `*`, so the module makes assistant
tokens with its own route (the same format and storage). Treat `mcp.*` as a capability any
user may give their own token, then let the API tokens dialog offer it and drop the copy.

### E21-15 Card on Account security and a Settings link

**Status:** open · **Priority:** P2 · **Type:** feature

Account security (admin module) should show `ConnectAssistantCard` from
`web/src/modules/mcp/ConnectCard.tsx`, and Settings should link to AI assistant access. Until
then the pages are reached at `/account/ai-assistant` and from Administration.

### E21-16 OAuth 2.1 for remote connectors

**Status:** open · **Priority:** P3 · **Type:** feature

Remote connectors (for example Claude's custom connectors) expect the MCP authorisation flow
(OAuth 2.1 with protected resource metadata). Needs HTTPS and a reachable address.

### E21-17 Who may connect an assistant

**Status:** open · **Priority:** P2 · **Type:** security

A permission (for example `mcp.use` granted by role) so administrators can limit which roles
connect assistants, rather than everyone once switched on.

### E21-18 Help for this page

**Status:** open · **Priority:** P3 · **Type:** docs

Help module `routeMap.ts`: `/admin/ai-assistants` and `/account/ai-assistant` to
`ai-assistants-and-mcp`.

### E21-19 Tool choice per token and per role

**Status:** open · **Priority:** P3 · **Type:** feature

### E21-20 Progress notifications for long-running tools

**Status:** open · **Priority:** P3 · **Type:** feature

Needs the stateful (session) transport; today every request is stateless.
