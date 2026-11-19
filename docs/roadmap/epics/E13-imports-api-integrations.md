# E13 Imports, API and integrations

**Status:** in progress

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
| E13-06 | Webhooks | in progress | P3 |
| E13-07 | CSV import for other record types | done | P2 |
| E13-08 | Webhook address checks after name resolution | open | P3 |
| E13-09 | Describe every module's hand-written routes | done | P3 |
| E13-10 | Import follow-ups | open | P3 |
| E13-11 | Stable versioned base path `/api/v1` | done | P2 |
| E13-12 | ETag and If-Match optimistic concurrency | done | P2 |
| E13-13 | Idempotency-Key on creates | done | P2 |
| E13-14 | Request id on every answer and in audit events | in progress | P2 |
| E13-15 | Paging links and the error envelope everywhere | done | P3 |
| E13-16 | Rate-limit headers on token requests | done | P3 |
| E13-17 | API reference page and integration guide | done | P2 |
| E13-18 | Capability scopes for tokens (`mcp.use`) | done | P2 |

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

**Status:** in progress (server done; screens open) · **Priority:** P3 · **Type:** feature

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
- [ ] Events for things other than record changes (for example a notification clock
  turning red) — needs modules to publish them

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

- [x] The importer is generalised to any registered record type
- [x] Each list page offers "Import" to people who can create that type
- [x] Validation, hooks and audit run exactly as for records created by hand (the check runs the engine's validation; hooks run on the real import)
- [x] A match key can be chosen for updating existing rows (create, update only, or update and create)
- [x] Restricted types need the same permissions as creating them by hand
- [x] Column mapping suggested by label; values of lists, people and records matched by value, label, user name, email, reference or title, with a screen to map what matched nothing
- [x] Duplicates in the file and against existing records (that the person can see) are skipped and reported; per-row results; import history from the audit log; 5 MB, 5,000 rows, 200 columns

**Implemented in:** `server/src/core/import/` (`read.ts`, `service.ts`, `routes.ts`: `GET /api/import/:type/fields`, `GET /api/import/:type/template`, `POST /api/import/:type/read`, `POST /api/import/:type`, `GET /api/import/history?type=`), registered from `core/resource.ts`; `web/src/core/ImportWizard.tsx`, `ImportWizardParts.tsx`, `ImportWizard.css`, `ResourceList.tsx` (Import button, `?import=1`). The asset importer (`inventory/importer.ts`) stays as it is. Tests: `server/src/core/import/import.test.ts`.

### E13-10 Import follow-ups

**Status:** open · **Priority:** P3 · **Type:** improvement

- [ ] Run `beforeCreate`/`beforeUpdate` hooks in the check without writing (today a hook's refusal shows only on the real import)
- [x] Describe the import and fact-sheet routes for the OpenAPI document (`core/export/docs.ts`, registered from `core/apidocs.ts`)
- [ ] Let the asset screen delegate to the generic import once it can express the asset-specific checks

### E13-08 Webhook address checks after name resolution

**Status:** open · **Priority:** P3 · **Type:** improvement

As a security lead, a webhook cannot be used to reach an internal address through a
host name on the allow-list that resolves somewhere unexpected. Today the allow-list is
checked against the host name only. Found while building E13-06.

**Acceptance criteria**

- [ ] The resolved address is checked at connection time, and private, loopback and
  link-local addresses are refused unless that exact address is on the allow-list
- [ ] The refusal is recorded on the delivery as `blocked`

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

**Status:** in progress · **Priority:** P2 · **Type:** feature

- [x] Every answer carries `X-Request-Id` (the caller's when it is sensible, else a UUID),
  available to code as `req.requestId`
- [ ] Audit events record the request id: needs a `request_id` column on `audit_events` (a new
  core migration) and `req?.requestId` in `makeAudit` (`core/services.ts`), owned by core

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
