# AI assistant access (MCP server)

Sandpiper GRC is a **Model Context Protocol (MCP)** server, so AI assistants such as Claude
Desktop, Claude Code and other MCP clients can look things up, summarise and (when allowed)
make changes, always **as the person who owns the token** and never with more rights. The
task-oriented guide is [AI assistants and MCP](user/21-ai-assistants-and-mcp.md); this page is
the technical reference.

Code: `server/src/modules/mcp` (endpoint, tools, resources, prompts, settings and call log),
`web/src/modules/mcp` (Administration > AI assistant access; Connect an AI assistant),
`tools/mcp-stdio.mjs` (stdio bridge). Tests: `server/src/modules/mcp/mcp.test.ts` (the SDK's own
client against the real endpoint on port 0, and through the bridge), `web/src/modules/mcp/configs.test.ts`.

## Endpoint

| | |
|---|---|
| Address | `POST <application address>/mcp` (Streamable HTTP transport, JSON responses) |
| `GET`, `DELETE` | `405` with `Allow: POST`: the server is stateless (no `Mcp-Session-Id`) and sends nothing unasked |
| Authentication | `Authorization: Bearer grc_pat_...` only. The session cookie is never read |
| Server name | `sandpiper-grc` |
| Off by default | Administration > **AI assistant access** > **AI assistant access (MCP)** |

The server binds to 127.0.0.1 like the rest of the application (see
[Installation](installation.md) for HTTPS and a reverse proxy). The SDK used is
`@modelcontextprotocol/sdk` 1.32 with `zod` 4.

## Authentication and scopes

An assistant uses an ordinary personal access token (`core/tokens.ts`) that also carries the
scope **`mcp.use`** (or `mcp.*`). A token with `*` alone is **not** accepted: MCP use is always a
deliberate choice. Each request to `/mcp`:

1. **Origin.** A request with an `Origin` header is refused (`403`) unless that origin is listed
   in **Browser origins** (setting `mcp.allowed_origins`, empty by default). MCP clients send no
   Origin; browsers always do. This is the MCP specification's DNS-rebinding defence and, with
   point 2, makes the endpoint CSRF-proof.
2. **Bearer token only.** No `Authorization` header: `401` with `WWW-Authenticate: Bearer`. A
   cookie is ignored, so a web page cannot drive the endpoint even for a signed-in person.
3. **The core checks the token**, exactly as for `/api`: the endpoint calls
   `GET /api/mcp/session` in-process with the same header, which runs the core authentication
   (hash lookup, expiry, revocation, wrong-token lockout by address, the per-token request limit
   `tokens.rate_per_minute`, owner still active, second-factor enforcement). It refuses
   (`403`) a token without `mcp.use` (`mcp_scope_missing`) and every token while access is off
   (`mcp_disabled`).
4. **Per-token limit** of requests to `/mcp`: setting `mcp.rate_per_minute` (default 120; `429`
   with `Retry-After`).
5. **Tools run as the token.** Every tool calls the application's own `/api` routes in-process
   (`app.inject`) with the same bearer token. Permissions are those the token's scopes and the
   owner's grants have in common, worked out on every call; restricted records (security
   incidents, risks, vulnerabilities, anything flagged) are invisible without `security.view`
   in lists, search, links, history, summaries and resources; validation, numbering, hooks,
   notifications and audit are the REST API's. No tool reads the database directly.

Tokens for assistants are made on **Connect an AI assistant** (`/account/ai-assistant`) by
`POST /api/mcp/tokens` (a signed-in session only, with a recent password confirmation; never
with a token). The person chooses a name, an expiry (at most `tokens.max_days`) and:

- **Read only**: `<module>.view` for every permission module the person holds, plus `mcp.use`.
- **Read and write**: `<module>.view`, `.create` and `.edit`, plus `mcp.use`. Never `.delete`,
  `.approve` or `.administer`.

They are stored and shown like every other token (shown once, SHA-256 at rest, listed under
Account security and Administration > API tokens, revocable there). Because they are ordinary
tokens they also work with the REST API within their scopes.

## Settings

Administration > **AI assistant access** (`PUT /api/mcp/admin/settings`, `admin.administer`, a
signed-in session with a recent password confirmation; refused for any token). These keys are
not on the general Settings screen, so a token can never change them.

| Key | Default | Meaning |
|---|---|---|
| `mcp.enabled` | `false` | The endpoint answers at all |
| `mcp.write_enabled` | `false` | Tools that change records are offered (to tokens whose permissions include a `.create` or `.edit`) |
| `mcp.allowed_tools` | `null` (all) | Tool names offered; others are not listed and cannot be called |
| `mcp.rate_per_minute` | `120` | Requests a minute to `/mcp` per token |
| `mcp.allowed_origins` | `[]` | Browser origins allowed to call `/mcp` |

A tool is **offered** to a caller only when it is allowed, write access permits it, and the
caller may use the part of the application behind it (for example `risk_heatmap` needs a
loaded `risk` type the caller can see, `fleet_equipment_gaps` the fleet module and
`fleet.view`). Unoffered tools do not appear in `tools/list` and a call to one fails with
"Tool not found". **Delete is not exposed at all.**

## Tools

Every tool returns a short readable summary (`content[0].text`) and the same answer as
`structuredContent`. Records carry `id`, `ref`, `title`, labelled field values (people's names
and list labels rather than ids and codes) and a `url` to open them. Failures come back as a
tool error (`isError: true`) with `structuredContent.error = { code, status, message, fields? }`;
validation failures name each field. Annotations: read tools `readOnlyHint: true`; all tools
`destructiveHint: false`, `openWorldHint: false`; `idempotentHint` where repeating changes
nothing (all reads, `update_record`, `link_records`).

`type` accepts a record type key, label or plural (`ticket`, `Tickets`); `id` accepts an id or a
reference (`TKT-00012`).

### Records

| Tool | Input | Output |
|---|---|---|
| `list_record_types` | `type?` | Without `type`: the types you can see with their field names. With: each field's label, kind, required, read-only, target type and allowed choices |
| `search` | `query`, `types?`, `limit?` (≤ 30) | Ranked matches across everything visible (`GET /api/search`) with snippets |
| `list_records` | `type`, `query?`, `filters?`, `sort?`, `direction?`, `page?`, `page_size?` (≤ 50), `fields?` | `{ total, page, pages, rows }`. Filters as the list API: `{"status": ["new","open"]}`, `"me"` in person fields, `field.lt/gt/lte/gte`, `field.null` |
| `get_record` | `type`, `id` | Every visible field with labels, tags, the five latest comments and changes |
| `get_related` | `type`, `id` | Linked records both ways with relation (`GET /api/links`) |
| `get_history` | `type`, `id`, `limit?` | Audit events for the record, naming any token used |
| `add_comment` | `type`, `id`, `body`, `internal?` (default true) | Write. `POST /api/comments` |
| `create_record` | `type`, `fields` | Write. Unknown and read-only fields refused before sending; `POST {path}` |
| `update_record` | `type`, `id`, `changes` | Write. `PATCH {path}/:id` |
| `link_records` | `from_type`, `from_id`, `to_type`, `to_id`, `relation?` | Write. `POST /api/links` |

### Work and insight

| Tool | Offered when | Source |
|---|---|---|
| `my_work` | always | Open tickets assigned to you, your open actions, `GET /api/changes/waiting`, `GET /api/policies/acknowledgements/mine`, unread `GET /api/notifications` (each part only where visible) |
| `overdue_summary` (`per_kind?`) | always | Actions, tickets past resolution target, vulnerabilities past fix-by, pending incident notifications past deadline, obligations and exercises past due, risk reviews due, late safety investigations |
| `risk_heatmap` (`scale?`, `basis?`) | can see `risk` | `GET /api/risks/heatmap`: grid, totals by rating, top ten |
| `framework_progress` (`framework?`) | can see `framework` | `GET /api/frameworks/:id/progress`: at target, score, by status, assessments |
| `incident_clocks` | can see `security_incident` | Open incidents and pending `notification_task`s with time left or overdue |
| `contracts_nearing_notice` (`days?`, default 90) | can see `contract` | `GET /api/contracts/renewals` |
| `vulnerability_summary` | can see `vulnerability` | `GET /api/vulnerabilities/summary` |
| `service_desk_metrics` (`from?`, `to?`) | can see `ticket` | `GET /api/tickets/metrics` |
| `fleet_equipment_gaps` (`mode?`) | fleet module loaded, `fleet.view` | `GET /api/fleet/coverage?gaps=true` |
| `safety_summary` | safety module loaded, `safety.view` | `GET /api/safety/summary` |
| `run_report` (`report?`, `max_rows?` ≤ 200) | can see `report_definition` | Without `report`: the saved reports you can run. With an id or name: `GET /api/reports/:id/run` as labelled rows |

## Resources and prompts

- `sandpiper://guide/<page>`: each page of the user guide (`docs/user/*.md`), Markdown.
- `sandpiper://record/{type}/{id}` (template): any record you may see as JSON, the same as
  `get_record`. A record you may not see reads as an error, exactly like one that does not exist.
- Prompts: `weekly_risk_and_action_review` (`focus?`), `board_summary` (`period?`),
  `triage_open_tickets` (`queue?`), `incident_status_update` (`incident?`). Each tells the
  assistant which tools to use, to cite references and links, and not to change anything unless
  asked.

## Audit and call log

- Every change a tool makes goes through the REST route, so the record's own audit event names
  the user and the token (`token_name`), and the core adds its `token.use` event.
- Each successful write tool also adds an `mcp.write` event on the record:
  `Updated ticket TKT-00012 (Status) via MCP (tool update_record) with API token "<name>"`. It
  shows in the record's History.
- Every tool call and resource read is logged in `mcp_calls` (token, owner, tool, ok or the error
  code, duration; never arguments or results), kept 90 days. Administrators see counts per token
  and tool and the latest 50 calls on the AI assistant access page (`GET /api/mcp/admin?days=`).
- Changing an `mcp.*` setting writes a `setting.change` event; making an assistant token writes
  `token.create` ("created for an AI assistant (MCP, read only)").

## Connecting clients

The Connect an AI assistant page shows these filled in with the installation's address and the
new token. The token is shown once.

**Claude Code** (over HTTP):

```
claude mcp add --transport http sandpiper http://127.0.0.1:8080/mcp --header "Authorization: Bearer grc_pat_..."
```

or through the bridge:

```
claude mcp add sandpiper --env GRC_URL=http://127.0.0.1:8080 --env GRC_TOKEN=grc_pat_... -- node "C:\Tools\sandpiper-mcp-stdio.mjs"
```

**Claude Desktop** (`claude_desktop_config.json`, opened from Settings > Developer > Edit
Config; restart Claude Desktop afterwards) through the bridge:

```json
{
  "mcpServers": {
    "sandpiper": {
      "command": "node",
      "args": ["C:\\Tools\\sandpiper-mcp-stdio.mjs"],
      "env": { "GRC_URL": "http://127.0.0.1:8080", "GRC_TOKEN": "grc_pat_..." }
    }
  }
}
```

Claude Desktop's remote connectors are reached from the provider's cloud and sign in with
OAuth; an installation listening on 127.0.0.1 cannot be reached that way, and this server does
not offer OAuth. Use the bridge.

**Other MCP clients** commonly accept the same `mcpServers` shape, either the command form above
or a remote server by address:

```json
{ "mcpServers": { "sandpiper": { "url": "http://127.0.0.1:8080/mcp", "headers": { "Authorization": "Bearer grc_pat_..." } } } }
```

Some clients name these fields differently (for example `"type": "http"` or `serverUrl`); see
the client's documentation.

## The stdio bridge

`tools/mcp-stdio.mjs` (also downloadable as `sandpiper-mcp-stdio.mjs` from
`GET /api/mcp/bridge` on the Connect page) is for clients that can only start a local command.
It has no dependencies and runs on any Node.js 18 or later, including the portable one in
`.tools/node`.

- Reads `GRC_URL` (the application address; `.../mcp` also accepted) and `GRC_TOKEN` from the
  **environment only**, so the token never appears in a process list.
- Reads one JSON-RPC message per line on standard input, POSTs each to `<GRC_URL>/mcp` with the
  token, and writes each answer as one line on standard output, in order. It remembers the
  negotiated protocol version and sends `MCP-Protocol-Version`.
- A refusal (`401`, `403`, `429`) or an unreachable server becomes a JSON-RPC error for each
  waiting request, with the reason on standard error, so the client never hangs.
- Warns on standard error when `GRC_URL` is plain `http` to another computer.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `403` "AI assistant access is switched off" | An administrator switches it on under Administration > AI assistant access |
| `403` "lacks the mcp.use scope" | The token was made on the API tokens card. Make one on Connect an AI assistant |
| `401` "That API token is not valid" | Expired, revoked or mistyped. Make a new one. After 20 wrong tokens in 5 minutes from one address, `429` for a while |
| `403` "Requests from web pages are not accepted" | The client sends an `Origin` header. Use a desktop or command-line client, or list the origin under Browser origins |
| `429` | The token's request limit (`mcp.rate_per_minute` or `tokens.rate_per_minute`). Wait a minute |
| A tool is missing from the list | Not allowed by the administrator, write access is off, the token is read only, or the person cannot see that part of the application |
| "not a record type you can see" | The type is not loaded here, or needs a permission (restricted types need `security.view`) |
| The bridge exits at once | `GRC_URL` or `GRC_TOKEN` is not set in the client's configuration (`env`) |
| `405` on `GET /mcp` | Expected: the server is stateless; clients fall back to POST only |

## Security notes and limits

- The assistant acts with the person's rights; it cannot reach sign-in, account-security,
  token or settings routes (the core blocks token use there, and these routes refuse tokens).
- Prompt injection: text in records (ticket descriptions, comments) reaches the assistant. A
  read-only token limits what a manipulated assistant could do; write access is off by default,
  and nothing can be deleted.
- Data read by an assistant goes to that assistant's provider. Restricted records only reach
  people who may see them, but organisations should decide which roles may connect assistants.
- Not built (see the epic E21): OAuth for remote connectors, per-role permission to connect,
  streaming progress for long tools, a per-tool permission list per token.
