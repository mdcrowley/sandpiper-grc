# AI assistant access (MCP server)

Sandpiper GRC is a **Model Context Protocol (MCP)** server, so AI assistants such as Claude
Desktop, Claude Code and other MCP clients can look things up, summarize and (when allowed)
make changes, always **as the person who owns the token** and never with more rights. The
task-oriented guide is [AI assistants and MCP](user/21-ai-assistants-and-mcp.md); this page is
the technical reference.

Code: `server/src/modules/mcp` (endpoint, tools, resources, prompts, settings, call log and
OAuth), `web/src/modules/mcp` (Administration > AI assistant access; Connect an AI assistant;
the OAuth consent screen), `tools/mcp-stdio.mjs` (stdio bridge). Tests:
`server/src/modules/mcp/mcp.test.ts` (the SDK's own client against the real endpoint on port 0,
and through the bridge), `oauth.test.ts` (the SDK client running the whole OAuth flow, then every
failure path), `access.test.ts` (who may connect, tool choice, progress, request ids, source
addresses, system impact), `web/src/modules/mcp/configs.test.ts`.

## Endpoint

| | |
|---|---|
| Address | `POST <application address>/mcp` (Streamable HTTP transport) |
| Answers | JSON; a `tools/call` that carries `_meta.progressToken` is answered as `text/event-stream` with progress notifications and then the result |
| `GET`, `DELETE` | `405` with `Allow: POST` once the token is accepted (before that, the same `401` or `403` as a `POST`): the server is stateless (no `Mcp-Session-Id`) and sends nothing unasked |
| Authentication | `Authorization: Bearer grc_pat_...` (a personal access token) or, when switched on, an OAuth access token `grc_oat_...`. The session cookie is never read |
| Request id | Every answer carries `X-Request-Id` (yours when you send a sensible one) |
| Server name | `sandpiper-grc` |
| Off by default | Administration > **AI assistant access** > **AI assistant access (MCP)** |

The server binds to 127.0.0.1 like the rest of the application (see
[Installation](installation.md) for HTTPS and a reverse proxy). The SDK used is
`@modelcontextprotocol/sdk` 1.32 with `zod` 4; it supports protocol versions up to `2025-11-25`.

## Authentication and scopes

An assistant uses either an ordinary personal access token (`core/tokens.ts`) that also carries
the scope **`mcp.use`** (or `mcp.*`), or an OAuth access token from a connector that signed in
(see [OAuth for remote connectors](#oauth-for-remote-connectors)). A token with `*` alone is
**not** accepted: MCP use is always a deliberate choice. Each request to `/mcp`:

1. **Origin.** A request with an `Origin` header is refused (`403`) unless that origin is listed
   in **Browser origins** (setting `mcp.allowed_origins`, empty by default). MCP clients send no
   Origin; browsers always do. This is the MCP specification's DNS-rebinding defense and, with
   point 2, makes the endpoint CSRF-proof.
2. **Bearer token only.** No `Authorization` header: `401` with `WWW-Authenticate: Bearer`, which
   also names the protected resource metadata (`resource_metadata="..."`) when OAuth is on. A
   cookie is ignored, so a web page cannot drive the endpoint even for a signed-in person.
3. **The core checks the token**, exactly as for `/api`: the endpoint calls
   `GET /api/mcp/session` in-process with the same header, which runs the core authentication
   (hash lookup, expiry, revocation, allowed source addresses, wrong-token lockout by address, the
   per-token request limit `tokens.rate_per_minute`, owner still active, second-factor
   enforcement). It refuses (`403`) a token without `mcp.use` (`mcp_scope_missing`), every token
   while access is off (`mcp_disabled`), and the tokens of people outside the roles allowed to
   connect (`mcp_not_allowed`).
4. **Per-token limit** of requests to `/mcp`: setting `mcp.rate_per_minute` (default 120; `429`
   with `Retry-After`, the seconds left in the minute). Like `tokens.rate_per_minute`, it is counted
   per clock minute in the database, so every server process on it shares one count.
5. **Tools run as the token.** Every tool calls the application's own `/api` routes in-process
   (`app.inject`) with the same bearer token and the same `X-Request-Id`. Permissions are those
   the token's scopes and the owner's grants have in common, worked out on every call;
   restricted records (security incidents, risks, vulnerabilities, anything flagged) are
   invisible without `security.view` in lists, search, links, history, summaries and resources;
   validation, numbering, hooks, notifications and audit are the REST API's. No tool reads the
   database directly.

Tokens for assistants are made on **Connect an AI assistant** (`/account/ai-assistant`) by
`POST /api/mcp/tokens` (a signed-in session only, with a recent password confirmation; never
with a token). It uses the core's `issueToken`, so the tokens are stored exactly like every other
personal access token. The person chooses a name, an expiry (at most `tokens.max_days`), and:

- **Read only**: `<module>.view` for every permission module the person holds, plus `mcp.use`.
- **Read and write**: `<module>.view`, `.create` and `.edit`, plus `mcp.use`. Never `.delete`,
  `.approve` or `.administer`.
- Optionally **Tools it may use** (`tools`, see [Choosing tools](#choosing-tools)) and **Allowed
  source addresses** (`allowedSources`, addresses or CIDR ranges; requests from elsewhere get
  `403 token_source_not_allowed`).

They are shown once, kept as SHA-256, listed under Account security and Administration > API
tokens, and revocable there. Because they are ordinary tokens they also work with the REST API
within their scopes. A person can also add `mcp.use` to any token on the API tokens card.

## Settings

Administration > **AI assistant access** (`PUT /api/mcp/admin/settings`, `admin.administer`, a
signed-in session with a recent password confirmation; refused for any token). These settings
are not on the general Settings screen, so a token can never change them. The request body
uses the names in the first column (for example `{ "enabled": true, "ratePerMinute": 60 }`);
the second column is the setting as it is stored, which the body does not accept.

| API field | Stored setting | Default | Meaning |
|---|---|---|---|
| `enabled` | `mcp.enabled` | `false` | The endpoint answers at all |
| `writeEnabled` | `mcp.write_enabled` | `false` | Tools that change records are offered (to tokens whose permissions include a `.create` or `.edit`) |
| `allowedTools` | `mcp.allowed_tools` | `null` (all) | Tool names offered; others are not listed and cannot be called |
| `ratePerMinute` | `mcp.rate_per_minute` | `120` | Requests a minute to `/mcp` per token (1 to 6000) |
| `allowedOrigins` | `mcp.allowed_origins` | `[]` | Browser origins allowed to call `/mcp` (up to 20) |
| `allowedRoles` | `mcp.allowed_roles` | `null` (everyone) | Role keys whose holders may connect an assistant |
| `roleTools` | `mcp.role_tools` | `{}` | Tools per role key; a role without a list is not narrowed |
| `oauthEnabled` | `mcp.oauth_enabled` | `false` | Remote connectors may sign in with OAuth 2.1 |
| `oauthRegistration` | `mcp.oauth_registration` | `false` | Connectors may register themselves (dynamic client registration) |
| `clientMetadata` | `mcp.oauth_client_metadata` | `false` | Connectors may use the `https` address of a client ID metadata document as `client_id` (also needs `integrations.outbound_enabled`) |
| `clientMetadataHosts` | `mcp.oauth_client_metadata_hosts` | `[]` (any public host) | Hosts those addresses may be on: `host`, `host:port` or `*.domain` (up to 50) |
| `clientMetadataApproval` | `mcp.oauth_client_metadata_approval` | `false` | A connector seen for the first time waits for an administrator's approval |
| `localImportRoots` | `mcp.local_import_roots` | `[]` (off) | Folders on the server's own disk that a data load may read source files from (E18-96, [Local file import](#local-file-import)): full paths of existing folders, up to 20; no network (UNC) paths; a folder inside the server's data, secret key, backup or application folder is refused. **The server process reads these folders with its own account** |

## Who may connect

By default anyone holding at least one permission may connect an assistant once access is on.
**Who may connect an assistant** (`mcp.allowed_roles`) narrows that to chosen roles. It applies
at once and everywhere: making an assistant token (`403 mcp_not_allowed`), adding `mcp.use` on
the API tokens card (the core's scope gate, `registerScopeGate`), the OAuth consent screen, and
every request to `/mcp`, so the assistants of someone who leaves those roles are refused on their
next request.

## Choosing tools

A tool is **offered** to a caller only when every one of these allows it:

1. the administrator's allowed list (`mcp.allowed_tools`);
2. **Tools by role** (`mcp.role_tools`): the union of the lists of the caller's roles; when any
   of their roles has no list, roles do not narrow;
3. the token's own list (table `mcp_token_tools`, set at creation or with
   `PUT /api/mcp/tokens/:id/tools`, `{ tools: string[] | null }`, by the token's owner);
4. write access, when the tool changes records;
5. the caller's permissions for the part of the application behind it (for example
   `risk_heatmap` needs a loaded `risk` type the caller can see, `fleet_equipment_gaps` the fleet
   module and `fleet.view`, `system_impact` the `system` type). A part of the application an
   administrator has switched off under Administration > Features counts as not loaded, and its
   permissions as held by nobody, so its tools and record types disappear for every token.

Unoffered tools do not appear in `tools/list` and a call to one fails with "Tool not found".
**Delete is not exposed at all.**

## Tools

Every tool returns a short readable summary (`content[0].text`) and the same answer as
`structuredContent`. Records carry `id`, `ref`, `title`, labeled field values (people's names
and list labels rather than ids and codes) and a `url` to open them. Failures come back as a
tool error (`isError: true`) with `structuredContent.error = { code, status, message, fields? }`;
validation failures name each field. Annotations: read tools `readOnlyHint: true`; all tools
`destructiveHint: false`, `openWorldHint: false`; `idempotentHint` where repeating changes
nothing (all reads, `update_record`, `link_records`, and the document tools marked so below).

`type` accepts a record type key, label or plural (`ticket`, `Tickets`); `id` accepts an id or a
reference (`TKT-00012`).

**Data load mode** (E18-70, [Security](security.md#data-load-mode)). `GET /api/mcp/session` carries
`dataLoad: { on, until, allowed }`; `allowed` is true while the mode is on, the token's owner holds
`admin.administer` and write access is on. Then the server instructions say so, `list_record_types`
reports `data_load` (with a type: `extra_fields`, and `settable_in_data_load` on read-only fields),
`create_record` and `update_record` accept read-only fields and `created_at`, `created_by`,
`updated_at` (their descriptions say so), and `delete_record` is offered. Field errors come back as
usual. In data load mode the write tools (`create_record`, `update_record`, `add_comment`, `link_records`, `attach_file`, `attach_link`,
`link_evidence`, `decide_approval`, `save_document`, `add_document_version`, `link_document`, `record_document_review`,
`record_acknowledgment`) also take `as`, the person who really wrote or did the thing (E18-71, E18-94; see
the user guide, chapter 21): the tools resolve it with `POST /api/data-load/person` and send `on_behalf_of`.
The argument is part of the input schema only while the caller's saves are loads (`ToolSpec.dataLoadInput`).
Module columns that record who did something (approvals, decisions, log entries, figures entered,
sign-offs) follow the person named (`actorOf(req)`), and `record_acknowledgment` is offered.
`create_account` (E18-95) is offered too: it creates a disabled account used only to name a person
(an employee or vendor contact who must appear as requester, author, assignee, owner or `as`)
through `POST /api/data-load/accounts`, with no password, link, invitation or email; the instructions
and the `load_records_from_sources` prompt tell the assistant to use it only when asked, and to put
everyone else on the people roster (`create_record` with type `person`) or name them with `name:`.
With local file import set up (`mcp.local_import_roots`), `list_local_files` and `attach_local_file`
are offered too, and `convert_upload` and `add_document_version` take a `path` (below).

Evidence library records (`evidence_record`) and funders (`funder`), added in wave 25, are ordinary
record types, so `list_record_types` and the record tools cover them while their areas are on.
Linking an evidence record to other records (`/api/evidence-links`) has no tool yet (E45-65).

### Records

| Tool | Input | Output |
|---|---|---|
| `list_record_types` | `type?` | Without `type`: the types you can see with their field names and required fields (`required`). With: each field's label, kind, required, read-only, target type, `help` (an administrator's help text on custom fields), `how` (how to give the value), `custom` and `multiple` for custom fields, and allowed choices (value and label); `related_types` (every type with a reference field pointing at this one: child records such as a vendor's contracts) and `links` (what `link_records`, `attach_file`, `attach_link` and `add_comment` add) |
| `search` | `query`, `types?`, `limit?` (≤ 30) | Ranked matches across everything visible (`GET /api/search`) with snippets |
| `list_records` | `type`, `query?`, `filters?`, `sort?`, `direction?`, `page?`, `page_size?` (≤ 50), `fields?` | `{ total, page, pages, rows }`. Filters as the list API: `{"status": ["new","open"]}`, `"me"` in person fields, `field.lt/gt/lte/gte`, `field.null` |
| `get_record` | `type`, `id` | Every visible field with labels, tags, the five latest comments and changes |
| `get_related` | `type`, `id` | Linked records both ways with relation (`GET /api/links`) |
| `get_history` | `type`, `id`, `limit?` | Audit events for the record, naming any token used |
| `add_comment` | `type`, `id`, `body`, `internal?` (default true) | Write. `POST /api/comments`. In data load mode `created_at` (ISO 8601, or a date in a common format) and `as` |
| `create_record` | `type`, `fields` | Write. Unknown and read-only fields refused before sending; values resolved (below); `POST {path}`. Answers `resolved`, `unfilled` and `related_empty` (below) |
| `update_record` | `type`, `id`, `changes` | Write. Values resolved as for `create_record`; `PATCH {path}/:id`. Answers `resolved`, `unfilled` and `related_empty` |
| `link_records` | `from_type`, `from_id`, `to_type`, `to_id`, `relation?` | Write. `POST /api/links` |
| `delete_record` | `type`, `id` | Write, `destructiveHint: true`. Offered only while data load mode is on and the token's saves are loads; deletes a record created in data load mode (`DELETE /api/data-load/records/:type/:id`); refused under a legal hold |
| `create_account` | `name`, `email?`, `username?` (default: made from the email address or the name, made unique), `department?` (name or id), `roles?` (role keys, default none), `person?` (roster person: id, reference, exact name, email or employee number) | Write, idempotent. Offered only while data load mode is on and the token's saves are loads (E18-95). `POST /api/data-load/accounts`: a **disabled** account for attribution only, with no password, set-up link, invitation or email (without an email address, a placeholder at `no-email.invalid`); audited `user.create` "(data load)". An account with that email address or username (or, with neither, the made username and the same name) is returned as it is with `existing: true`, never changed. Links the roster person named, or else the one roster person with the same email and no account (`PATCH /api/people/:id`). Accounts have no job title or phone: those go on the roster person. Answer: `user_id`, `username`, `email`, `status`, `roles`, `existing`, `linked_person`, `warnings` |
| `decide_approval` | `step_id` (from `my_approvals`), `decision` (`approve` or `reject`), `comment?` (required to reject) | Write. `POST /api/workflows/steps/:id/decision`; refuses a step not waiting for you, including your own request |

**Values resolved** (E45-46, `server/src/modules/mcp/resolve.ts`). `create_record` and `update_record` turn the
values an assistant has in its sources into what the record routes take, through routes the caller may
use, so a record or person the caller may not see is never matched:

- a `ref` field: an id; the target's reference (`SYS-00012`, any case); or a title equal to the given
  text (any case) on exactly one record the caller may see (`GET /api/records/lookup`, and the list
  route's `f.<title>` filter when the picker's 25 rows may have cut it). A roster person (`ref` to
  `person`) is also found by email or employee number. Several matches: a field error naming them
  (give the reference); none: a field error with up to five close matches;
- a `user` field: an id, `me`, or a username, email or display name equal to the text
  (`GET /api/mcp/people`, tokens only, exact matches only). Active staff accounts only, except while the
  token's saves are data loads, when disabled accounts count too. A username or email wins over a
  display name; several people with one display name are a field error;
- a `lookup` field (custom selects with several values too): the value, or the value or label in any case;
  otherwise a field error listing the choices;
- a `date` field: YYYY-MM-DD, an ISO date and time (cut to the date), YYYY/MM/DD, MM/DD/YYYY (month
  first; a first number above 12 is read as the day), "March 5, 2024", "5 March 2024", or an Excel day
  number; anything else is a field error. A `datetime` field takes anything `Date` reads, or a date;
- `boolean`: also yes, no, y, n, 1, 0; `json`: a JSON object or list, also when sent as JSON text.

Any field that cannot be matched stops the save (nothing is saved) with one field error per value.
The answer's `resolved` lists `{ field, given, value, label }` for each value worked out, and the text
says "Matched: …". After the save, `unfilled` lists the optional, writable fields still empty (`field`,
`label`) and `related_empty` the related types (at most 12 counted, the type's own self-references left
out) with no record pointing at this one yet (`type`, `plural`, `field`), so the assistant sees what its
sources might still fill.

### Files and links

`server/src/modules/mcp/tools-files.ts` (E45-47). Files and links on any record type, through the
attachments routes with the caller's token: seeing the record lists its files, editing it adds one. The
upload tools (`start_upload`, `upload_part`, `finish_upload`, see Documents below) are offered to every
token with write scopes, not only to document editors.

| Tool | Input | Output |
|---|---|---|
| `attach_file` | `type`, `id`, `upload_id` (from `finish_upload`), `evidence?`, `description?`, `collected_on?`, `expires_on?` | Write. `POST /api/attachments/uploads/:id/attach`: the file on the record (the full intake ran when the upload was finished), once per upload. `evidence` defaults to the type's own default (evidence types); dates in the common formats above; `as` in data load mode (sent as `on_behalf_of`), and `created_at` (a date or ISO time) kept as the file's added date; a file attached in a load records the person named as "added by" and is listed with the load, so undoing it removes the file (E45-51, E45-52) |
| `attach_link` | `type`, `id`, `url`, `title?`, `evidence?`, `description?`, `collected_on?`, `expires_on?`, `created_at?` | Write. `POST /api/attachments/link`: http or https, no user name or password, never fetched; `as` in data load mode (the link's "added by" is the person named), and `created_at` kept as the link's added date; a link attached in a load is listed with the load, so undoing it removes the link (E46-51) |
| `link_evidence` | `evidence`, `type`, `id`, `part?`, `relation?`, `note?` | Write. `POST /api/evidence-links`: links an evidence library record to a record (or a part of one, such as a workpaper step); offered while the evidence library is on and the caller may see it; `as` in data load mode (E45-65) |
| `list_attachments` | `type`, `id` | `GET /api/attachments`: each file and link with kind, size, description, evidence dates, who added it and when |
| `list_local_files` | `folder?` (full path, or relative to the only allowed folder), `pattern?` (`*` and `?`, any case), `recursive?`, `page?`, `page_size?` (≤ 1000, default 200) | Read only. Offered only with local file import on (below). `GET /api/data-load/local-files`: each file's `name`, `relative_path`, full `path`, `size_bytes`, `modified_at`, `extension` and `allowed_type`; subfolders by name when not recursive; what was left out (`skipped`: lock and system files, links, server files). Without `folder` and with several folders: the allowed folders |
| `attach_local_file` | `path`, `type`, `id`, `evidence?`, `description?`, `collected_on?`, `expires_on?`, `created_at?`, `as?` | Write, idempotent. Offered only with local file import on. `POST /api/data-load/local-files/attach`: the server reads the file and attaches it exactly as an upload (allowed types, size limit, content check, malware scanner; "added by" the person named; listed with the load). A file whose content (SHA-256) is already on the record is not attached again: `duplicate: true` |

### Work and insight

| Tool | Offered when | Source |
|---|---|---|
| `my_work` | always | Open tickets assigned to you, your open actions, `GET /api/changes/waiting`, `GET /api/policies/acknowledgments/mine`, unread `GET /api/notifications` (each part only where visible). Reports progress |
| `overdue_summary` (`per_kind?`) | always | Actions, tickets past resolution target, vulnerabilities past fix-by, pending incident notifications past deadline, obligations and exercises past due, risk reviews due, late safety investigations. Reports progress |
| `risk_heatmap` (`scale?`, `basis?`) | can see `risk` | `GET /api/risks/heatmap`: grid, totals by rating, top ten |
| `framework_progress` (`framework?`) | can see `framework` | `GET /api/frameworks/:id/progress`: at target, score, by status, assessments. Reports progress |
| `incident_clocks` | can see `security_incident` | Open incidents and pending `notification_task`s with time left or overdue |
| `contracts_nearing_notice` (`days?`, default 90) | can see `contract` | `GET /api/contracts/renewals` |
| `vulnerability_summary` | can see `vulnerability` | `GET /api/vulnerabilities/summary` |
| `service_desk_metrics` (`from?`, `to?`) | can see `ticket` | `GET /api/tickets/metrics` |
| `fleet_equipment_gaps` (`mode?`) | fleet module loaded, `fleet.view` | `GET /api/fleet/coverage?gaps=true` |
| `safety_summary` | safety module loaded, `safety.view` | `GET /api/safety/summary` |
| `vehicle_model_members` (`model`, `limit?`) | fleet module loaded and on, `fleet.view` | `/api/vehicle-models`, `/:id/summary`, `/inherited-fields`, `/api/vehicles?f.model_id=` |
| `asset_model_members` (`model`, `limit?`) | `assets.view` | The same under `/api/asset-models` and `/api/assets` |
| `run_report` (`report?`, `max_rows?` ≤ 200) | can see `report_definition` | Without `report`: the saved reports you can run. With an id or name: `GET /api/reports/:id/run` as labeled rows. Reports progress |
| `system_impact` (`system`: id, reference or name) | can see `system` | `GET /api/systems/:id/impact`: downstream systems with depth and criticality, and the sites, data categories, assets, vehicles and services affected (each only where visible). Reports progress |
| `my_approvals` | always (answers "not available" without the workflows module) | `GET /api/workflows/approvals`: the approval steps waiting for your decision, soonest due first, each with its `step_id` |
| `search_audit_log` (`request_id?`, `text?`, `action?`, `record_type?`, `record_id?`, `from?`, `to?`, `limit?` ≤ 100) | `audit.view` | `GET /api/audit`: who, when, action, summary, token and request id, newest first; at least one filter; before and after values left out. Events about records the person may not see stay hidden. Assistant tokens carry `audit.view` when their owner holds it |
| `audit_summary` | can see `audit_engagement` | `GET /api/audits/summary`: audits by status, the audit universe due and overdue, open and late findings by rating, inspections due, overdue, missed and failed, evidence requests |
| `controls_summary` | can see `control` | `GET /api/controls/summary`: controls in use by state (effective, partly effective, ineffective, untested), tests due, overdue and waiting for review, results over twelve months, coverage counts by record type |
| `cap_summary` | `actions.view` and can see `cap` | `GET /api/caps/summary`: corrective action plans open, overdue, waiting for approval and being verified, actions waiting for verification, by status and by source |
| `funding_summary` | can see `funding_award` | `GET /api/funding/summary`: awards by status with open amounts, reports and close-outs overdue or due within 30 days, review deficiencies, certification progress |
| `governance_summary` | can see `meeting` | `GET /api/governance/summary`: active committees, meetings in the next 30 and 90 days (and those without a frozen pack), meetings held and quorum, minutes to write up or waiting for approval, decisions by outcome |
| `qualifications_summary` | can see `person` or `course` | `GET /api/people/summary` and `GET /api/training/summary` (each where the caller may): the roster by status, training complete, due and overdue by course and department, the overdue trend. No person is named |
| `continuity_summary` | can see `business_process` | `GET /api/continuity/summary`: business processes and those with a recovery gap, plans overdue for review or not approved, emergency activations under way |
| `asset_condition_summary` | can see `asset_class` | `GET /api/condition/summary`: per asset class, how many are past their useful life against the yearly target, and the share in poor condition |
| `ot_summary` | can see `ot_zone` | `GET /api/ot/summary`: OT systems, zones below their target level, conduits with remote access, systems that cannot be patched |
| `records_requests_summary` | can see `records_request` | `GET /api/records/summary`: requests open, due soon and overdue, by kind; active legal holds only for callers with `legal.view`. Counts only, never who asked |
| `vendor_lifecycle_summary` | can see `vendor` | `GET /api/vendors/lifecycle-summary`: reassessments and exclusion checks overdue, open vendor issues, offboardings under way |

The program summary tools (`audit_summary` to `vendor_lifecycle_summary`, `server/src/modules/mcp/tools-programs.ts`)
read their area's summary route with the caller's token, so permissions, restricted records and switched-off
areas apply exactly as in the web application. They pass on figures only: no titles, names or
requester details, even where a dashboard route also lists records. A tool whose area is switched off
is not offered to anyone; a route that does not answer for the caller (not built in this version, or
a permission the token lacks) gives a "not available" answer instead of an error.

### Documents

Document control tools (E43-10, `server/src/modules/mcp/tools-documents.ts`). Each calls the
documents' own routes with the caller's token, so a document's **distribution** (who may read it),
permissions, scope, numbering and data load mode are exactly those of the web application: a
restricted document the token's person may not read is never listed, read, counted under its name or
checked, and asking for it answers `not_found`, as for a document that does not exist. The read tools
are offered to a caller who can see `policy`; the write tools also need `policies.create` or
`policies.edit`, AI assistant write access (`mcp.write_enabled`) and a token with write scopes.
Nothing here deletes; in data load mode `delete_record` removes a document a load created, and nothing
else.

| Tool | Input | Output |
|---|---|---|
| `find_documents` | `q?`, `type?`, `department?` (name or id), `status?`, `review?` (`overdue`, `due_90`), `limit?` (≤ 200) | Number, title, type, status, current version, next review and link of each document you may read (`GET /api/policies`) |
| `read_document` | `document` (number, reference or id), `version?`, `max_chars?` (≤ 100,000) | Details, every version you may see with label, status, approved, effective, superseded and withdrawn dates, approval body and reference and conversion warnings; the chosen version's text (its Markdown, or for a file version the text read from its PDF original, `GET /api/documents/:id/versions/:vid/text`; a scan says it has no text); parent, children (hidden ones counted), links. `access_lists` only when you may change them |
| `document_register_summary` | none | Figures, the same for everyone: total, effective, in review, reviews overdue and due within 90 days, obsolete, without an owner, acknowledgment completion, by type and status (`GET /api/documents/summary`, `GET /api/policies/stats?group=status`). No titles |
| `check_document` | `document?`, `number_prefix?` | Per document: more than one effective version, gaps or overlaps between versions' dates, versions out of order or without an effective date, a file version without its original, children of obsolete documents (and an obsolete document's live children), the type tier warning, an acknowledgment audience outside the readers, no owner. Without `document`, up to 100 documents you may read. Reports progress |
| `convert_upload` | `upload_id` or (local file import on) `path`, `max_chars?` | Read-only effect: the Markdown a `.docx` upload converts to and the conversion report (tracked changes, comments, left-out content, images, hints from headers and footers), nothing saved (`POST /api/documents/convert`). Any other type: the report says it is kept as the original file. With `path` the server first reads the file into an upload (`POST /api/data-load/local-files/upload`) and answers its `upload_id` for `add_document_version` |
| `start_upload` | `file_name`, `size`, `sha256?` | Write. `POST /api/attachments/uploads`: `upload_id`, `part_size` (1 MiB), `part_count` |
| `upload_part` | `upload_id`, `part` (from 1), `data` (base64), `sha256?` | Write, idempotent. `POST /api/attachments/uploads/:id/parts/:n`; reports progress |
| `finish_upload` | `upload_id`, `sha256?` | Write, idempotent. Joins the parts, checks the SHA-256, type and content, runs the malware scanner (`POST .../finish`). The upload is kept 24 hours and used once (`attach_file` on any record, or `add_document_version`). The three upload tools are offered to every token with write scopes (E45-47) |
| `save_document` | `doc_number?`, `title?`, `summary?`, `type?`, `owner?` (user name, id or `me`), `owning_department?`, `parent_number?`, `approver_name?`, `approver_role?`, `review_months?`, `access?`, `access_departments?`, `access_roles?`, `access_groups?`, `access_users?`, `ack_required?`, `audience_*?`, `ack_days?`, `publisher?`, `edition?`, `published_on?`, `source_url?`, `license_note?`, `expires_on?` | Write, idempotent. Updates the document with that number (`PATCH /api/policies/:id`), or creates one (`POST /api/policies`). Setting a number by hand needs `policies.administer` except in data load mode, where the given number is kept |
| `add_document_version` | `document`, `body_markdown` or `upload_id` or (local file import on) `path`, `convert?` (default true for `.docx`), `accept_as_is?`, `version?`, `version_label?`, `status?`, `approved_on?`, `effective_on?`, `superseded_on?`, `withdrawn_on?`, `approved_by_name?`, `approval_body?`, `approval_reference?`, `change_summary?`, `minor?` | Write. `POST /api/policies/:id/versions` with `source_upload_id`: a Word upload is converted (its images become files on the document); a tracked-changes file is refused before the upload is used, unless `accept_as_is`; a Word file that cannot be converted, a PDF or a legacy `.doc` becomes a file-only version with a note. The version number, status and dates are sent only in data load mode; otherwise the version is a draft and the answer says so |
| `set_document_access` | `document`, `access`, `access_departments?`, `access_roles?`, `access_groups?`, `access_users?` | Write, idempotent. Replaces the distribution (owner or `policies.administer`); names are matched |
| `link_document` | `document`, `to_type`, `to`, `relation?`, `as?` (data load mode) | Write, idempotent. `POST /api/links` with a `document_link_relation` value (default `references`); a framework outcome goes through `POST /api/policies/:id/outcomes` |
| `record_document_review` | `document`, `result` (`no_change`, `revise`, `retire`), `reviewed_on?`, `reviewed_by_name?`, `note?`, `reason?`, `replaced_by?`, `as?` (data load mode: the reviewer) | Write. `POST /api/policies/:id/reviews`; past dates in data load mode |
| `record_acknowledgment` | `document`, `version?` (default: the effective version), `person` (user id, username or email; `person:<roster id, reference, email or employee number>`), `acknowledged_on` (`YYYY-MM-DD` or ISO time), `language?`, `as?` (who recorded a roster person's) | Write, idempotent. Offered only while data load mode is on and the token's saves are loads (E18-94). `POST /api/policies/:id/versions/:version/acknowledgments`: the person must be one of the document's readers; an account's acknowledgment is recorded as theirs, a roster person without an account on the roster list (method `recorded`); one already acknowledged is left as it was |

In data load mode (`dataLoad.allowed`) the descriptions of `save_document`, `add_document_version`
and `record_document_review` say that the dates, statuses and numbers given are kept and that nothing
is sent; versions may arrive out of order and superseding is worked out from their dates. Every
document loaded is listed in `data_load_records`.

### Local file import

E18-96, `server/src/modules/attachments/local.ts` and `server/src/modules/mcp/tools-local.ts`. For loading
a large set of source files (thousands of files, gigabytes) that sit on the server's own machine: the
**server reads them from disk itself**, so the assistant does not send each file as base64 parts.

- **Off by default.** An administrator lists folders in `localImportRoots` (Administration > AI assistant
  access > Local file import; a signed-in session with a recent password confirmation). Empty the list
  when the load is done.
- **Who.** The tools (`list_local_files`, `attach_local_file`, and the `path` of `convert_upload` and
  `add_document_version`) are offered only while the caller's saves are data loads (data load mode on,
  the token's owner holds `admin.administer`, AI assistant write access on), the token can write, and
  at least one folder is set. The server instructions then say so. The REST routes
  (`/api/data-load/local-files...`, [API](api.md)) check all of it again on every request; an
  administrator's ordinary API token needs `admin.administer` in its own scopes.
- **Which files.** Only regular files inside an allowed folder, after following links and junctions
  (realpath, compared without case on Windows). Refused: `..`, network and device paths (`\\server`,
  `\\?\`, `\\.\`), alternate data streams (a colon after the drive letter), device names, links that
  lead out, and the server's own files even inside an allowed folder: the data folder, the secret key
  file and its retired keys (and any file named `*.secret.key`), the backup folders (`GRC_BACKUP_DIR`
  and the scheduled backup folder), every file named by a `GRC_*_FILE` setting, the TLS files and the
  application folder. Listings leave out Office lock files (`~$...`), `Thumbs.db`, `desktop.ini`,
  `.DS_Store` and recycle bins, and do not follow links.
- **The same intake.** A file read this way goes through the upload intake (allowed types, the size
  limit of the File settings, content against the name, the malware scanner), is attached under the
  record's own rules, carries the person named with `as`, and is listed with the load.
- **Audit.** Every file read is audited as `attachment.import_local` with its full path (marked as a
  data load), every refusal as `attachment.import_local_refused`, and the attachment as
  `attachment.upload` naming the folder.

### Progress notifications

A client that wants progress sends `_meta.progressToken` with `tools/call`. That request is then
answered as an event stream (still stateless, on the same POST): `notifications/progress` with
`progress`, `total` and a `message` as the tool works through its steps, then the result. The
tools marked "Reports progress" above send them; the others answer at once. Without a
`progressToken` the answer is plain JSON as before. The bridge passes the events on as they
arrive.

## Resources and prompts

- `sandpiper://guide/<page>`: each page of the user guide (`docs/user/*.md`), Markdown.
- `sandpiper://record/{type}/{id}` (template): any record you may see as JSON, the same as
  `get_record`. A record you may not see reads as an error, exactly like one that does not exist.
- Prompts: `weekly_risk_and_action_review` (`focus?`), `board_summary` (`period?`),
  `triage_open_tickets` (`queue?`), `incident_status_update` (`incident?`). Each tells the
  assistant which tools to use, to cite references and links, and not to change anything unless
  asked.
- `load_document_package` (`folder?`, `department?`, E43-10): walks an assistant through loading a
  folder of controlled documents with their history: inventory the files (skipping Office lock files
  `~$...` and thumbnail caches), find what exists, propose numbers, types, owners, access and versions
  for the person's approval, check that data load mode is on, then per document `save_document` and
  per version, oldest first, the upload tools, `convert_upload` for Word files and
  `add_document_version`; then `check_document` and a report (files kept as originals only, warnings,
  links). It never invents a number, date, owner or reader.
- `load_records_from_sources` (`record_type?`, `sources?`, E45-50): walks an assistant through building complete
  records of one type from source files: `list_record_types` for the type and its related types, a mapping of
  source columns and sections to fields (facts with a field of their own never go into the description),
  data load mode when original dates and authors matter, then per record `create_record` with linked records
  and people by reference, title, email or name, child records, `link_records`, the source files
  (`attach_file`, `attach_link`), history as comments, `unfilled` and `related_empty` read and acted on, and a
  report of what could not be placed.

The server instructions (`server.ts`, `COMPLETENESS`) tell every assistant the same: fill every field the
source supports, set reference and person fields, create child records and links, attach the source
files, keep history as comments and report what it could not place.

The two loading prompts also say to use `list_local_files`, `attach_local_file` and a `path` for document
versions when local file import is on, and the upload tools otherwise.

**Clients without prompts or resources** (E18-97, `server/src/modules/mcp/tools-guide.ts`). Some clients
(Claude Desktop among them) offer the server's tools to the assistant but not its prompts or resources.
Two read-only tools, always offered, give the same text, and the server instructions point to them:

| Tool | Input | Output |
|---|---|---|
| `read_guide` | `page?` (its name such as `21-ai-assistants-and-mcp`, the name without the number, the number, or the title) | Without `page`: every page's name, title and resource address. With: the page's Markdown, exactly the text of `sandpiper://guide/<page>` |
| `get_prompt` | `name?`, `args?` (an object of the prompt's arguments) | Without `name`: every prompt with its description and arguments. With: the prompt's text with the arguments filled in, exactly what `prompts/get` answers; an unknown name or argument is an error |

## OAuth for remote connectors

The same OAuth server also serves the mobile app's built-in client (client kind `mobile`,
`server/src/modules/mobile/`); `mcp.oauth_enabled` and the connector settings below do not govern it.

Remote connectors (for example Claude's custom connectors, or Claude Code without a token) do not
take a pasted token: they follow the [MCP authorization
specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
Sandpiper GRC is both the protected resource and the authorization server. **Off by default**
(`mcp.oauth_enabled`), and it needs MCP access on.

**HTTPS is required.** Every OAuth address answers only when the application is reached over
HTTPS (or on this computer, `localhost`/`127.0.0.1`, for testing). Set the public address
(**Application address**, `auth.public_url`, under Administration > Sign-in providers, on the
**Redirect address** card) to the `https://` address people use: it is the issuer and
the base of the resource (`<public address>/mcp`). Connectors in a provider's cloud must be able
to reach that address, which usually means a reverse proxy on a reachable host
([Installation](installation.md#server-installation)).

| Address | Standard | Purpose |
|---|---|---|
| `GET /.well-known/oauth-protected-resource/mcp` (and without `/mcp`) | RFC 9728 | `resource`, `authorization_servers`, `scopes_supported` (`mcp:read`, `mcp:write`), `bearer_methods_supported: ["header"]` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 | Endpoints; `code_challenge_methods_supported: ["S256"]`; `grant_types_supported: ["authorization_code", "refresh_token"]`; `registration_endpoint` only while self-registration is on; `authorization_response_iss_parameter_supported: true`; `client_id_metadata_document_supported` true only while metadata documents are accepted and outbound connections are on |
| `GET /oauth/authorize` | OAuth 2.1 | The consent screen (a page of the web application; signs the person in first) |
| `POST /oauth/token` | OAuth 2.1 | `authorization_code` (with `code_verifier`) and `refresh_token` |
| `POST /oauth/register` | RFC 7591 | Dynamic client registration, only when `mcp.oauth_registration` is on |
| `POST /oauth/revoke` | RFC 7009 | Revoke an access or refresh token (a refresh token ends the whole connection) |

While OAuth is off, all of these answer `404` and the `401` from `/mcp` does not mention them.

**The flow.** The connector calls `/mcp`, gets `401` with `resource_metadata`, reads both
metadata documents, registers (or uses a client an administrator added, or its own client ID
metadata document address, below), and sends the person's
browser to `/oauth/authorize` with PKCE (`code_challenge_method=S256`, the only method), `state`
and `resource=<public address>/mcp`. The person signs in if needed and sees the consent screen:
the connector's name (as it gave it, or as the administrator entered it), where they return to,
and a choice of **Read only** or (when the connector asked for `mcp:write` and the person can
change records) **Read and write**, and how long to allow it (up to `tokens.max_days`). Allowing
asks for a recent password confirmation; people outside the roles allowed to connect can only
decline. The browser goes back to the registered redirect address with `code`, `state` and
`iss`. The connector exchanges the code at `/oauth/token`.

**Tokens.**

- Authorization codes are single use and last five minutes; they are bound to the client, the
  exact redirect address and the PKCE challenge. A code used twice ends the connection it made.
- Access tokens (`grc_oat_...`) last an hour (never beyond the connection's end).
  Refresh tokens (`grc_ort_...`) last 30 days and **rotate**: each refresh returns a new pair and
  uses the old refresh token up; presenting a used refresh token again ends the whole
  connection (`mcp.oauth.refresh_reuse` in the audit log).
- Scopes: `mcp:read` gives the person's `<module>.view` permissions; `mcp:write` adds `.create`
  and `.edit` (subject to write access being on). As with tokens, the permissions in force are
  those in common with the person's roles at the moment of each request.
- Access tokens are accepted **only at `/mcp`**: the core resolves them (through
  `registerBearerResolver` in `core/tokens.ts`) only for the in-process calls the endpoint makes,
  which carry a secret marker that changes at every start. Sent directly to `/api`, they get
  `401 invalid_token`.
- Everything is stored as SHA-256 only: client secrets, codes, access and refresh tokens. None
  is written to a log or an audit event.

**Clients.** `token_endpoint_auth_method` may be `none` (public clients with PKCE, the usual
choice for desktop and command-line clients), `client_secret_basic` or `client_secret_post`.
Redirect addresses must be `https`, `http` on a loopback address (any port, as OAuth 2.1 allows
for native apps), or an app's own scheme; `javascript:`, `data:`, `file:` and similar are refused,
as are fragments and user names. An authorization request with an unknown client or an
unregistered redirect address is **never redirected**: the consent screen shows the error.
Self-registration is limited to 10 an hour per address and 1000 connectors in all.

**Client ID metadata documents (E21-21).** The specification's preferred way for a connector
with no prior relationship: its `client_id` is an `https` address serving a JSON document that
describes it ([draft-ietf-oauth-client-id-metadata-document](https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/)).
**Off by default**, and only while outbound connections are on (`integrations.outbound_enabled`),
because the document must be fetched:

- Settings: `mcp.oauth_client_metadata` (accept them), `mcp.oauth_client_metadata_hosts` (hosts
  they may come from: `host`, `host:port` or `*.domain`; empty = any public host) and
  `mcp.oauth_client_metadata_approval` (a connector seen for the first time waits until an
  administrator approves it, `POST /api/mcp/admin/oauth/clients/:id/approve`).
- The address must be `https`, have a path, and carry no fragment, user name, dot segments or
  default port (written in its normal form); at most 400 characters.
- It is fetched only from the consent screen's API (`POST /api/mcp/oauth/authorize`, someone
  signed in), at most 20 lookups per person in 10 minutes. The token endpoint never fetches.
- Fetching is fenced like webhooks, more tightly (`server/src/modules/mcp/client-metadata.ts`):
  port 443 only, unless the host list names that host with another port; the name is resolved at
  connection time and **every** address checked, so private, loopback, link-local and reserved
  addresses are refused unless that exact address is on the host list; **no redirect is
  followed** (any 3xx is a refusal); only a `200` with a JSON media type counts; at most **5 KB**
  is read; the whole exchange is limited to **5 seconds**; the certificate must be valid; no
  cookies or credentials are sent.
- The document must give `client_id` exactly equal to its address, a `client_name`, and one to
  ten `redirect_uris` (the same rules as above). Only known registration fields are accepted
  (RFC 7591 and common OpenID ones, with `#language` variants); `client_secret`,
  `client_secret_expires_at` and private key material are refused, and
  `token_endpoint_auth_method` must be `none` or absent (these connectors are public clients with
  PKCE). Redirect addresses must match **exactly** (no loopback port leeway). URLs inside the
  document (`logo_uri` and so on) are never fetched.
- A valid document is kept in `mcp_oauth_clients` (`registered_by = 'metadata'`) for its
  `Cache-Control` max-age, between one minute and a day (an hour when none is given), then fetched
  again; a change of name or redirect addresses is audited. Errors and invalid documents are never
  cached. Refusals answer on the consent screen, never redirect to the connector: `400
  invalid_client` with the reason, `403 client_host_not_allowed`, `client_pending` or
  `client_blocked`, `409 outbound_disabled`, `429 rate_limited`.
- The consent screen shows the **host of the document** prominently with the full address, says
  the name is self-declared, and warns when the connector returns to an address on the person's
  own computer (any local program could receive it).
- Removing such a connector ends its connections and keeps it **blocked**; the administrators'
  page lists blocked connectors with **Allow again** (`DELETE /api/mcp/admin/oauth/blocked/:id`),
  after which the document is fetched afresh. Switching the feature or outbound connections off
  stops these connections at once.

**Who sees what.** Each person sees their connections on Connect an AI assistant and can
**Disconnect** them (`DELETE /api/mcp/oauth/grants/:id`). Administrators see every connector
and connection on AI assistant access, add connectors by hand
(`POST /api/mcp/admin/oauth/clients`), remove a connector with all its connections
(`DELETE /api/mcp/admin/oauth/clients/:id`) and end any one connection. Switching OAuth off
stops every connection at once.

## Audit and call log

- Every change a tool makes goes through the REST route, so the record's own audit event names
  the user and the token (`token_name`), and the core adds its `token.use` event. For a
  connector the token name is "<connector> (connector)".
- Each successful write tool also adds an `mcp.write` event on the record:
  `Updated ticket TKT-00012 (Status) via MCP (tool update_record) with API token "<name>"`. It
  shows in the record's History.
- All of these events carry the `request_id` of the `/mcp` request.
- Every tool call and resource read is logged in `mcp_calls` (token or connection, owner, tool,
  ok or the error code, duration, request id; never arguments or results), kept 90 days.
  Administrators see counts per token and tool and the latest 50 calls on the AI assistant
  access page (`GET /api/mcp/admin?days=`).
- Changing an `mcp.*` setting writes a `setting.change` event; making an assistant token writes
  `token.create`; choosing its tools `mcp.tools`. OAuth writes `mcp.oauth.client_register`,
  `mcp.oauth.consent`, `mcp.oauth.deny`, `mcp.oauth.revoke`, `mcp.oauth.client_remove`,
  `mcp.oauth.code_reuse` and `mcp.oauth.refresh_reuse`; client ID metadata documents add
  `mcp.oauth.client_metadata` (first seen, or changed), `mcp.oauth.client_metadata_refused`
  (with the address and reason), `mcp.oauth.client_approve` and `mcp.oauth.client_unblock`.
- To find everything one `/mcp` request did, an assistant can call `search_audit_log` with the
  request id (from the call log or an error), or open Administration > Audit log with
  **Request id**.

## Connecting clients

The Connect an AI assistant page shows these filled in with the installation's address and the
new token. The token is shown once.

### With a token

**Claude Code** (over HTTP):

```
claude mcp add --transport http sandpiper http://127.0.0.1:8080/mcp --header "Authorization: Bearer grc_pat_..."
```

or through the bridge:

```
claude mcp add sandpiper --env GRC_URL=http://127.0.0.1:8080 --env GRC_TOKEN=grc_pat_... -- node "C:\Tools\sandpiper-mcp-stdio.mjs"
```

**Claude Desktop** (`claude_desktop_config.json`, opened from Settings > Developer > Edit
Config; restart Claude Desktop afterward) through the bridge:

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

**Other MCP clients** commonly accept the same `mcpServers` shape, either the command form above
or a remote server by address:

```json
{ "mcpServers": { "sandpiper": { "url": "http://127.0.0.1:8080/mcp", "headers": { "Authorization": "Bearer grc_pat_..." } } } }
```

Some clients name these fields differently (for example `"type": "http"` or `serverUrl`); see
the client's documentation.

### By signing in (OAuth)

With sign-in for remote connectors on and the installation served over HTTPS at, say,
`https://grc.example.org`:

- **Claude** (claude.ai or Claude Desktop): Settings > Connectors > **Add custom connector**,
  name it and enter `https://grc.example.org/mcp`, then **Connect**. Claude registers itself (or
  enter the client id an administrator gave you under the connector's advanced settings), opens
  the consent screen, and comes back connected. Claude's connectors run in the provider's cloud,
  so the address must be reachable from the internet.
- **Claude Code**: `claude mcp add --transport http sandpiper https://grc.example.org/mcp`, then
  run `/mcp` in Claude Code and choose the server to sign in in your browser.
- **Other MCP clients** that support MCP authorization: give only the address,
  `{ "mcpServers": { "sandpiper": { "url": "https://grc.example.org/mcp" } } }`; the client finds
  the rest from the `401` and the metadata.

## The stdio bridge

`tools/mcp-stdio.mjs` (also downloadable as `sandpiper-mcp-stdio.mjs` from
`GET /api/mcp/bridge` on the Connect page) is for clients that can only start a local command.
It has no dependencies and runs on any Node.js 18 or later, including the portable one in
`.tools/node`. It uses a personal access token (not OAuth).

- Reads `GRC_URL` (the application address; `.../mcp` also accepted) and `GRC_TOKEN` from the
  **environment only**, so the token never appears in a process list.
- Reads one JSON-RPC message per line on standard input, POSTs each to `<GRC_URL>/mcp` with the
  token, and writes each answer as one line on standard output, in order. It remembers the
  negotiated protocol version and sends `MCP-Protocol-Version`, and sends its own
  `X-Request-Id` (`bridge-<process>-<n>`).
- Passes progress notifications on as they arrive, a moment before the result they belong to.
- A refusal (`401`, `403`, `429`) or an unreachable server becomes a JSON-RPC error for each
  waiting request, with the reason on standard error, so the client never hangs.
- Warns on standard error when `GRC_URL` is plain `http` to another computer.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `403` "AI assistant access is switched off" | An administrator switches it on under Administration > AI assistant access |
| `403` "lacks the mcp.use scope" | The token was made on the API tokens card without **Use with an AI assistant**. Make one on Connect an AI assistant |
| `403` "Your role may not connect AI assistants" | **Who may connect an assistant** names other roles |
| `403` "may not be used from this address" | The token has **Allowed source addresses** that do not include where the assistant runs |
| `401` "That API token is not valid" | Expired, revoked or mistyped. Make a new one. After 20 wrong tokens in 5 minutes from one address, `429` for a while |
| `403` "Requests from web pages are not accepted" | The client sends an `Origin` header. Use a desktop or command-line client, or list the origin under Browser origins |
| `429` | The token's request limit (`mcp.rate_per_minute` or `tokens.rate_per_minute`). Wait a minute |
| A tool is missing from the list | Not allowed by the administrator, not chosen for the role or the token, write access is off, the token is read only, or the person cannot see that part of the application |
| "not a record type you can see" | The type is not loaded here, or needs a permission (restricted types need `security.view`) |
| The bridge exits at once | `GRC_URL` or `GRC_TOKEN` is not set in the client's configuration (`env`) |
| `405` on `GET /mcp` | Expected: the server is stateless; clients fall back to POST only |
| A connector says the server has no sign-in, or the metadata is `404` | OAuth is off, MCP access is off, or the address is not HTTPS: set the public address (`auth.public_url`) to the `https://` address |
| The consent screen says the connector "asked to return to an address it did not register" | The redirect address differs from its registration. Remove the connector and let it register again, or fix the address an administrator entered |
| "Connectors cannot register themselves here" | Self-registration is off: an administrator adds the connector and gives you its client id |
| "identifies itself by a web address" / `outbound_disabled` | The connector uses a client ID metadata document: an administrator switches on **Accept connectors known by their web address** and outbound connections, or adds the connector by hand |
| "metadata document ... was not accepted" | The reason follows: not reachable over HTTPS on a public address, a redirect, too large, not JSON, `client_id` not exactly its address, or a field this server refuses. Fix the document; nothing was cached |
| `client_host_not_allowed`, `client_pending`, `client_blocked` | Its host is not on the allowed list, it waits for approval, or an administrator removed it (Allow again on AI assistant access) |
| A connector keeps asking to sign in again | Its connection ended (disconnected, expired, connector removed, OAuth switched off, or a refresh token was used twice) |

## Security notes and limits

- The assistant acts with the person's rights; it cannot reach sign-in, account-security,
  token or settings routes (the core blocks token use there, and these routes refuse tokens).
- Prompt injection: text in records (ticket descriptions, comments) reaches the assistant. A
  read-only token limits what a manipulated assistant could do; write access is off by default,
  and nothing can be deleted.
- Data read by an assistant goes to that assistant's provider. Restricted records only reach
  people who may see them; use **Who may connect an assistant** and **Tools by role** to decide
  which roles may connect and what their assistants may use.
- A connector's name on the consent screen is what the connector registered with; the screen
  says so, and shows where the person returns to. Prefer adding connectors by hand (and leaving
  self-registration off) where only a few known connectors are used. For a connector known by
  its metadata document, the screen leads with the document's host: the name is what that host
  says, so an allowed-host list or approval first suits installations that want only known
  connectors. A loopback redirect address cannot prove which program receives the answer; the
  screen warns about it.
- Not planned for now (E21-25): `private_key_jwt` for metadata-document connectors and sign-in
  through the stdio bridge.
