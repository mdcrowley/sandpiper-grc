# E13 Imports, API and integrations

**Status:** done (23 of 23 issues done)

## Goal

Get existing data in without retyping it, and let other tools read from and write to
the application in a documented, authenticated way.

## Scope notes

- Today: an asset CSV import with a screen, an asset JSON ingest route, and the
  delimited seed files read by the `seed` command.
- CSV export of every list is tracked in [E01-12](E01-platform-foundations.md);
  spreadsheet export in [E01-25](E01-platform-foundations.md).
- Personal API tokens are built (server side) in [E02-12](E02-account-security.md):
  `Authorization: Bearer <token>` on any `/api` route the token's scopes allow.
- The application makes no outbound connections unless an administrator switches on
  `integrations.outbound_enabled` and lists the hosts in `integrations.allowed_hosts`;
  webhooks (E13-06) are the only user of that today.
- Examples: `examples/api-token.ps1` (calling the API with a token),
  `examples/api-client.mjs` (a dependency-free Node.js client) and
  `examples/webhook-receiver.mjs` (checking a webhook signature). Integration guide:
  `docs/api.md`.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E13-01 | Asset CSV import with mapping and dry run | done | P1 |
| E13-02 | Asset JSON ingest | done | P2 |
| E13-03 | Delimited seed files for first load | done | P2 |
| E13-04 | Spreadsheet (XLSX) import | done | P3 |
| E13-05 | OpenAPI document | done | P2 |
| E13-06 | Webhooks | done | P3 |
| E13-07 | CSV import for other record types | done | P2 |
| E13-08 | Webhook address checks after name resolution | done | P3 |
| E13-09 | Describe every module's hand-written routes | done | P3 |
| E13-10 | Import follow-ups | done | P3 |
| E13-11 | Stable versioned base path `/api/v1` | done | P2 |
| E13-12 | ETag and If-Match optimistic concurrency | done | P2 |
| E13-13 | Idempotency-Key on creates | done | P2 |
| E13-14 | Request id on every answer and in audit events | done | P2 |
| E13-15 | Paging links and the error envelope everywhere | done | P3 |
| E13-16 | Rate-limit headers on token requests | done | P3 |
| E13-17 | API reference page and integration guide | done | P2 |
| E13-18 | Capability scopes for tokens (`mcp.use`) | done | P2 |
| E13-19 | Webhook events other than record changes | done | P3 |
| E13-20 | Find audit events by request id | done | P3 |
| E13-21 | Asset import screen on the generic import | done | P3 |
| E13-22 | Import check in a rolled-back transaction | done | P3 |
| E13-23 | Index audit events by request id | done | P3 |

---

### E13-01 Asset CSV import with mapping and dry run

**Status:** done · **Priority:** P1 · **Type:** feature

As an agent, I upload a CSV of assets, match its columns to fields, preview what would
happen, and then import the valid rows.

**Acceptance criteria**

- [x] Handles quoted cells, doubled quotes, and commas and line breaks inside quotes
- [x] Accepts several common date formats
- [x] Column mapping is chosen on screen; a bad mapping is refused
- [x] A dry run reports what would be created, skipped and rejected, without writing
- [x] Rows that match an existing asset are skipped, or updated if I ask
- [x] The import is audited and needs `assets.create`

**Implemented in:** `POST /api/assets/import` (`server/src/modules/inventory/importer.ts`); `web/src/modules/inventory/AssetImport.tsx`

### E13-02 Asset JSON ingest

**Status:** done · **Priority:** P2 · **Type:** feature

As someone running a discovery tool, I post a list of assets as JSON and each is
created or updated by serial number, then tag.

**Acceptance criteria**

- [x] Upsert by serial number, then by tag
- [x] The same validation rules as the CSV import
- [x] Needs `assets.create`
- [x] Callable with an API token rather than a browser session (see [E02-12](E02-account-security.md));
  the token needs `assets.create` and `assets.edit`

**Implemented in:** `POST /api/assets/ingest` (`server/src/modules/inventory/importer.ts`). API only; there is no screen.

### E13-03 Delimited seed files for first load

**Status:** done · **Priority:** P2 · **Type:** feature

As the person setting up an installation, I place my existing registers in the private
seed folder as delimited files and load them with one command.

**Acceptance criteria**

- [x] Files for systems, sites, data categories, vendor contracts, framework designations and target profile, and information requests
- [x] Every file is optional; a missing file is skipped and reported
- [x] Loading again neither duplicates rows nor overwrites edits
- [x] The expected headers are stated in each module's `seed.ts`

**Implemented in:** `readSeed` (`server/src/app.ts`), `server/src/cli.ts`, each module's `seed.ts`

### E13-04 Spreadsheet (XLSX) import

**Status:** done · **Priority:** P3 · **Type:** feature

As an agent, I upload a spreadsheet file directly instead of saving it as CSV first.

**Acceptance criteria**

- [x] The import screen accepts `.xlsx` and lets me choose a sheet
- [x] Typed cells (dates, numbers) are read correctly
- [x] Everything after reading the file is shared with the CSV import

**Implemented in:** `server/src/core/import/xlsx.ts` (a reader on `fflate`: shared and inline strings, number formats that are dates, size limits against oversized archives), `read.ts`. The asset screen (E13-01) still takes CSV only; the generic import (E13-07) takes both, assets included. Tests: `server/src/core/import/import.test.ts`, `server/src/core/export/export.test.ts` (round trip).

### E13-05 OpenAPI document

**Status:** done · **Priority:** P2 · **Type:** docs

As an integrator, I can download a machine-readable description of the API, generated
from the record types so it never drifts from the code.

**Acceptance criteria**

- [x] `GET /api/openapi.json` (OpenAPI 3.1) describes every generated resource route, with
  field schemas (custom fields included), filters, sorting, paging, errors and both
  security schemes (session cookie with `X-GRC-CSRF`, bearer token)
- [x] Hand-written routes are described too: core's and the admin module's in full,
  modules' through the optional `ctx.describeRoute({...})`; any route not described is
  still listed, marked `x-undocumented` (E13-09 tracks describing them)
- [x] The document is filtered by the caller's permissions
- [x] A test fails when a route is missing from the document, or when one of core's own
  routes is undescribed
- [x] `npx tsx server/src/core/openapi-cli.ts <file>` writes the whole document without a
  running server

**Implemented in:** `server/src/core/openapi.ts`, `server/src/core/apidocs.ts` (core
routes), `server/src/core/openapi-cli.ts`, `server/src/modules/admin/docs.ts`,
`describeRoute` in `server/src/core/module.ts`; tests in `server/src/core/platform.test.ts`
("OpenAPI document")

### E13-06 Webhooks

**Status:** done · **Priority:** P3 · **Type:** feature

As an administrator, I register a URL to be called when chosen events happen (for
example a ticket is created or a notification clock turns red).

**Acceptance criteria**

- [x] Webhooks are data: name, URL, events (`<type>.create|update|delete`, `<type>.*`,
  `*`), secret (shown once, stored encrypted, replaceable), on/off
- [x] Each call is signed (`X-GRC-Signature: sha256=` HMAC-SHA256 over timestamp and
  body) and retried with back-off (1, 5, 30, 120, 720 minutes) from a table-backed queue;
  redirects are not followed
- [x] Deliveries and failures are logged and visible to administrators, with a manual
  retry and a test delivery
- [x] Off by default; outbound calls need `integrations.outbound_enabled` and a host on
  `integrations.allowed_hosts` (both security settings needing password confirmation)
- [x] Restricted records are never sent to a webhook without an explicit choice by a
  person holding `security.view`, and stop if that person loses it; only such a person
  can change the address of a webhook that includes them
- [x] **Webhooks** administration page (list, add, edit, deliveries, retry, test) and the
  two outbound settings on the settings page (web): `web/src/modules/admin/Webhooks.tsx`
  (`/admin/webhooks`), the **Outbound connections** group in `web/src/modules/admin/Settings.tsx`
- [x] Events for things other than record changes (for example a notification clock
  turning red): built as E13-19

**Implemented in:** `server/src/core/webhooks.ts`,
`server/src/core/migrations/003_platform_services.sql`; tests against a local
`127.0.0.1` receiver in `server/src/core/platform.test.ts` ("outbound webhooks");
`examples/webhook-receiver.mjs`. Routes: `GET/POST /api/admin/webhooks`,
`PATCH/DELETE /api/admin/webhooks/:id`, `POST /api/admin/webhooks/:id/rotate-secret`,
`POST /api/admin/webhooks/:id/test`, `GET /api/admin/webhooks/:id/deliveries?status=&page=`,
`POST /api/admin/webhook-deliveries/:id/retry`.

### E13-07 CSV import for other record types

**Status:** done · **Priority:** P2 · **Type:** feature

As a user, I can import systems, vendors, contracts, tickets, risks and other record
types from CSV through the same mapping and dry-run screen that assets have.

**Acceptance criteria**

- [x] The importer is generalized to any registered record type
- [x] Each list page offers "Import" to people who can create that type
- [x] Validation, hooks and audit run exactly as for records created by hand (the check runs the engine's validation and before-hooks too since E13-10; after-hooks run on the real import)
- [x] A match key can be chosen for updating existing rows (create, update only, or update and create)
- [x] Restricted types need the same permissions as creating them by hand
- [x] Column mapping suggested by label; values of lists, people and records matched by value, label, user name, email, reference or title, with a screen to map what matched nothing
- [x] Duplicates in the file and against existing records (that the person can see) are skipped and reported; per-row results; import history from the audit log; 5 MB, 5,000 rows, 200 columns

**Implemented in:** `server/src/core/import/` (`read.ts`, `service.ts`, `routes.ts`: `GET /api/import/:type/fields`, `GET /api/import/:type/template`, `POST /api/import/:type/read`, `POST /api/import/:type`, `GET /api/import/history?type=`), registered from `core/resource.ts`; `web/src/core/ImportWizard.tsx`, `ImportWizardParts.tsx`, `ImportWizard.css`, `ResourceList.tsx` (Import button, `?import=1`). The asset importer (`inventory/importer.ts`) stays as it is. Tests: `server/src/core/import/import.test.ts`.

### E13-10 Import follow-ups

**Status:** done · **Priority:** P3 · **Type:** improvement

- [x] Run `beforeCreate`/`beforeUpdate` hooks in the check without writing (today a hook's refusal shows only on the real import).
  The check now runs the engine's validation, the record type's before-hook (on copies, custom
  fields held back as the engine does) and the source-visibility check of a type that inherits
  its restriction, so its verdict matches the real import. Not a rolled-back transaction: the
  resource engine writes through the shared database handle, which cannot run inside a
  transaction (PGlite would wait for itself); after-hooks and database constraints are still
  checked only by the real import (E13-22). Before-hooks must not write (they never did)
- [x] Describe the import and fact-sheet routes for the OpenAPI document (`core/export/docs.ts`, registered from `core/apidocs.ts`)
- [ ] Let the asset screen delegate to the generic import once it can express the asset-specific checks (moved to E13-21)

**Implemented in:** `checkWithoutWriting` in `server/src/core/import/service.ts` (replaced by the rolled-back check of E13-22); tests
`server/src/core/import/check.test.ts` (create hook, update hook, restricted source)

### E13-08 Webhook address checks after name resolution

**Status:** done · **Priority:** P3 · **Type:** improvement

As a security lead, a webhook cannot be used to reach an internal address through a
host name on the allow-list that resolves somewhere unexpected. Today the allow-list is
checked against the host name only. Found while building E13-06.

**Acceptance criteria**

- [x] The resolved address is checked at connection time, and private, loopback and
  link-local addresses are refused unless that exact address is on the allow-list (also
  carrier-grade NAT, multicast, documentation and other reserved ranges, IPv4 and IPv6, IPv4
  carried in IPv6; every address a name resolves to is checked, and the connection goes to the
  checked addresses only)
- [x] The refusal is recorded on the delivery as `blocked`, with the name and the address

**Implemented in:** `nonPublicAddress`, `addressListed`, `addressRefusal`, `postWebhook` (`server/src/core/webhooks.ts`,
deliveries now sent with `node:http`/`node:https` and a checking name lookup); tests "webhook addresses are checked
after name resolution" in `server/src/modules/admin/security.test.ts`

### E13-09 Describe every module's hand-written routes

**Status:** done · **Priority:** P3 · **Type:** docs

As an integrator, every route in `/api/openapi.json` has a summary and its parameters.
Core and the admin module describe theirs; other modules' hand-written routes appear
marked `x-undocumented` until each module calls `ctx.describeRoute({...})` beside them.

**Acceptance criteria**

- [x] Each module's hand-written routes are described (about 320 routes of 14 modules), with
  tag, permission, query parameters and request and response schemas, in central tables
  (`server/src/core/api/docs/<module>.ts`, written in the short schema notation of
  `core/api/shape.ts`). A module's own `ctx.describeRoute` replaces its entry there, so owners
  can move descriptions beside their routes at any time
- [x] A test fails when any registered route is undescribed, with every module loaded or any
  subset (`core/api/coverage.test.ts`; allow-list `INTENTIONALLY_UNDOCUMENTED`, empty), and the
  whole document passes a structure check (tags, unique operation ids, path parameters,
  references: `core/api/validate.ts`)
- [x] Record schemas cover fields by type, `_display`, `_tags` and custom fields `cf_*`; list
  envelopes (`<Type>Page`), `Stats`, `Error`, and the CSV, XLSX and PDF export variants

**Implemented in:** `server/src/core/api/docs/*`, `shape.ts`, `schemas.ts`, `validate.ts`,
`server/src/core/openapi.ts`, `server/src/core/apidocs.ts`; `openapi-cli.ts` checks the
structure before writing.

### E13-11 Stable versioned base path `/api/v1`

**Status:** done · **Priority:** P2 · **Type:** feature

As an integrator, I call a documented, versioned path that will not change under me.

**Acceptance criteria**

- [x] Every `/api/...` route of core and every module is also served at `/api/v1/...`,
  implemented once (`core/api/versioning.ts`: an `onRoute` alias and an `onRequest` rewrite
  so authentication, token rules, module hooks and audit see one path); `/api` stays for the
  web application
- [x] `GET /api/v1/openapi.json` describes the v1 paths; `openapi-cli.ts` writes them by
  default (`--unversioned` for `/api`)
- [x] Compatibility promise documented (additive only within v1); deprecations announced with
  `Deprecation`, `Sunset` and `Link` headers and `deprecated: true` in the document
  (`core/api/deprecations.ts`)

### E13-12 ETag and If-Match optimistic concurrency

**Status:** done · **Priority:** P2 · **Type:** feature

- [x] One record (GET, POST, PATCH answers) carries `ETag`; PATCH and DELETE with `If-Match`
  answer 409 `version_conflict` (with the current `ETag`) when the record changed; without
  the header nothing changes for the web application
- [x] Writes to one record are taken one at a time in the process, so the check and the write
  cannot interleave (`core/api/conventions.ts`)

### E13-13 Idempotency-Key on creates

**Status:** done · **Priority:** P2 · **Type:** feature

- [x] A create with `Idempotency-Key` is stored for 24 hours (table `api_idempotency_keys`,
  migration `core/api/migrations/001_idempotency.sql`, scope `core.api`); a repeat replays the
  first answer with `Idempotent-Replayed: true`; a different body is 422
  `idempotency_key_reused`; a running one 409 `idempotency_in_progress`; refusals are not stored
- [x] Keys belong to the user and token (or session) that sent them

### E13-14 Request id on every answer and in audit events

**Status:** done · **Priority:** P2 · **Type:** feature

- [x] Every answer carries `X-Request-Id` (the caller's when it is sensible, else a UUID),
  available to code as `req.requestId`
- [x] Audit events record the request id (`audit_events.request_id`, core migration 005;
  `makeAudit` in `core/services.ts`)
- [x] The MCP endpoint answers with it too, passes it to every in-process tool call (so the
  changes an assistant makes carry the `/mcp` request's id) and records it in the call log

**Implemented in:** `server/src/core/api/versioning.ts`, `server/src/core/migrations/005_audit_request_id.sql`, `server/src/core/services.ts`; `server/src/modules/mcp/http.ts`, `caller.ts`, `migrations/002_oauth_and_tool_choice.sql`; tests `server/src/core/api/conventions.test.ts`, `server/src/modules/mcp/access.test.ts`

### E13-15 Paging links and the error envelope everywhere

**Status:** done · **Priority:** P3 · **Type:** improvement

- [x] Any `{ rows, total, page, pageSize }` answer carries `Link` (first, prev, next, last) and
  `X-Total-Count`, from the path the caller used; keyset paging guidance in `docs/api.md`
- [x] Every `/api` error answer has `{ error: { code, message } }`; one without it gets it
  (answers outside `/api`, such as `/mcp`, are left alone)

### E13-16 Rate-limit headers on token requests

**Status:** done · **Priority:** P3 · **Type:** improvement

- [x] Token requests carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and
  `RateLimit-Policy`; a 429 carries `Retry-After`. The count mirrors the token limiter in
  `core/tokens.ts` (same clock-minute window)

### E13-17 API reference page and integration guide

**Status:** done · **Priority:** P2 · **Type:** docs

- [x] `/help/api` reads the v1 document: grouped by tag with a contents list, search (also
  in descriptions), expandable schemas, parameters given by reference, response headers,
  copyable curl and PowerShell examples with a `GRC_TOKEN` placeholder; documentation only,
  nothing is sent (`web/src/modules/help/ApiReference.tsx`, `ApiExamples.tsx`,
  `exampleRequests.ts`)
- [x] `docs/api.md`: tokens and scopes, base URL and versioning, paging, filtering, sorting,
  search, exports, imports, webhooks, errors, request ids, rate limits, idempotency,
  concurrency, restricted records, and five worked integrations
- [x] `examples/api-client.mjs` (dependency-free Node.js client); `examples/api-token.ps1` on v1

### E13-18 Capability scopes for tokens

**Status:** done · **Priority:** P2 · **Type:** feature

Found while building the MCP endpoint: `mcp.use` is not a permission any role grants, so only
administrators could put it in a token.

- [x] Scope families (`SCOPE_FAMILIES`, `registerScopeFamily`, `scopeGrantable` in
  `core/tokens.ts`): `mcp.use` (and `mcp.*`) may be added by anyone holding a permission; they
  add no access to records; `GET /api/me/tokens` lists them in `scopeFamilies`
- [ ] The token screen offers `scopeFamilies` (web, admin module) and the MCP module may stop
  issuing its own tokens (`POST /api/mcp/tokens`)

### E13-19 Webhook events other than record changes

**Status:** done · **Priority:** P3 · **Type:** feature

Webhooks are sent when records are created, changed or deleted. An integrator may also want
events that are not record changes, for example a notification clock about to run out or a
backup failing. Split from E13-06.

**Acceptance criteria**

- [x] A list of non-record events a webhook can subscribe to, each with a documented payload:
  `notification_clock.warning`, `notification_clock.overdue`, `security_incident.declared`,
  `change.approval_decided`, `report_schedule.delivered`, `backup.failed` (`WEBHOOK_EVENTS`;
  `docs/api.md#other-events`). Subscribed to by name, by family (`notification_clock.*`) or `*`
- [x] Restricted-record rules apply to them as to record events (an event is restricted always,
  never, or as its record is; a restricted one goes only to a webhook that includes restricted
  records, chosen by someone who still holds `security.view`)
- [x] Feature switches respected: an event of a switched-off area is not emitted and not offered
- [x] Offered on the webhook screen (**Other events** in the form), listed in
  `GET /api/admin/webhooks` as `otherEvents`

**Implemented in:** `WEBHOOK_EVENTS`, `emitWebhookEvent` and the `app.webhookEvent` decorator in
`server/src/core/webhooks.ts`; emitted from `server/src/modules/secincidents/alerts.ts` (clocks),
`secincidents/index.ts` (declared), `changes/workflow.ts` (approval), `reports/schedule.ts`
(delivery), `attachments/backups.ts` (backup failed); `web/src/modules/admin/Webhooks.tsx`;
tests `server/src/core/webhook-events.test.ts`

### E13-20 Find audit events by request id

**Status:** done · **Priority:** P3 · **Type:** improvement

Every answer carries an `X-Request-Id` and audit events store it, but the audit search cannot
filter by it, and the CSV export leaves it out.

**Acceptance criteria**

- [x] `GET /api/audit?request_id=` returns the events of one request (documented in the API description)
- [x] The CSV export has `token_name` and `request_id` columns
- [x] The audit log screen has a **Request id** filter, shows the token and request id of an
  event, and offers **Everything this request did**

**Implemented in:** `GET /api/audit` in `server/src/core/routes.ts`;
`web/src/modules/admin/AuditLog.tsx`; `docs/api.md#request-ids`; tests
`server/src/core/audit-request-id.test.ts`. The column has no index yet (E13-23).

### E13-21 Asset import screen on the generic import

**Status:** done · **Priority:** P3 · **Type:** improvement

Split from E13-10. The asset import under Inventory (`inventory/importer.ts`,
`AssetImport.tsx`) has its own parser, mapping and checks. The generic import already imports
assets; the asset screen should become the generic wizard once the generic import can express
the asset-specific checks (disposal rules, matching by serial number then tag).

**Acceptance criteria**

- [x] The asset-specific checks run as hooks or import options of the generic import: they were
  already the asset type's hooks (`checkAsset`: unique tag in any capitals, funder percentage,
  the disposal gate), and the check now runs them for real (E13-22). Matching is by the field the
  person chooses (Tag or Serial number); matching by serial then tag stays with the ingest route
- [x] The Inventory asset import opens the generic wizard (`/assets/import` opens the asset list
  with it; the list's own Import button replaces the separate one); `POST /api/assets/import`
  stays, unchanged, documented as deprecated (`DEPRECATIONS` in `core/api/deprecations.ts`:
  `Deprecation` header, `deprecated: true` in the document, pointing at `POST /api/import/asset`)
- [x] `POST /api/assets/ingest` keeps its behavior

**Implemented in:** `web/src/modules/inventory/AssetImport.tsx`, `Assets.tsx`;
`server/src/core/api/deprecations.ts`; tests `server/src/modules/inventory/asset-import.test.ts`

### E13-22 Import check in a rolled-back transaction

**Status:** done · **Priority:** P3 · **Type:** improvement

Split from E13-10. The import check runs validation and before-hooks without writing, so it
cannot see what only a write shows: after-hooks that refuse, and database constraints. Running
the real create and update inside a transaction that is rolled back would, but the resource
engine writes through the shared database handle; it would need to accept a transaction handle
(for hooks too).

**Acceptance criteria**

- [x] The resource engine's create and update can run on a transaction handle, hooks included:
  `db.trial(fn)` (`core/db.ts`, both drivers) runs `fn` in a transaction that is always rolled
  back and, through `AsyncLocalStorage`, sends every query on the shared handle made by that
  work (the engine, module hooks, audit, lookups, settings) into it, so nothing waits for the
  transaction (the embedded database deadlock) and a `tx` inside it becomes a savepoint. The
  outer request holds no transaction of its own
- [x] The import check runs the real writes in a transaction that is always rolled back, with
  nothing audited, emitted (webhooks, notifications) or queued: each row in its own savepoint
  (a refused row does not spoil the next; later rows see earlier ones); record-change listeners
  are not called, and webhook deliveries and the job queue do nothing inside a trial (`inTrial()`)

**Implemented in:** `server/src/core/db.ts` (`withTrials`, `inTrial`), `core/import/service.ts`
(`runImport`), guards in `core/resource.ts` (`emit`), `core/webhooks.ts` (`processDue`) and
`core/jobs/queue.ts` (`enqueue`, `runDue`); tests `server/src/core/import/check.test.ts` (after-hook,
unique index, a hook writing through `ctx.db`, nothing kept, audited or queued), on the embedded
database, the wire protocol and PostgreSQL 17

### E13-23 Index audit events by request id

**Status:** done · **Priority:** P3 · **Type:** improvement

Found while building E13-20. `GET /api/audit?request_id=` scans the audit table, which grows
without limit (audit events are never deleted).

**Acceptance criteria**

- [x] A core migration adds an index on `audit_events (request_id)` where it is not null

**Implemented in:** `server/src/core/migrations/011_audit_request_id_index.sql` (partial index where `request_id` is not null).
