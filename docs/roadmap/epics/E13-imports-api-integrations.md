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
- Examples: `examples/api-token.ps1` (calling the API with a token) and
  `examples/webhook-receiver.mjs` (checking a webhook signature).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E13-01 | Asset CSV import with mapping and dry run | done | P1 |
| E13-02 | Asset JSON ingest | done | P2 |
| E13-03 | Delimited seed files for first load | done | P2 |
| E13-04 | Spreadsheet (XLSX) import | open | P3 |
| E13-05 | OpenAPI document | done | P2 |
| E13-06 | Webhooks | in progress | P3 |
| E13-07 | CSV import for other record types | open | P2 |
| E13-08 | Webhook address checks after name resolution | open | P3 |
| E13-09 | Describe every module's hand-written routes | open | P3 |

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

**Status:** open · **Priority:** P3 · **Type:** feature

As an agent, I upload a spreadsheet file directly instead of saving it as CSV first.

**Acceptance criteria**

- [ ] The import screen accepts `.xlsx` and lets me choose a sheet
- [ ] Typed cells (dates, numbers) are read correctly
- [ ] Everything after reading the file is shared with the CSV import

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

**Status:** open · **Priority:** P2 · **Type:** feature

As a user, I can import systems, vendors, contracts, tickets, risks and other record
types from CSV through the same mapping and dry-run screen that assets have.

**Acceptance criteria**

- [ ] The importer is generalised to any registered record type
- [ ] Each list page offers "Import" to people who can create that type
- [ ] Validation, hooks and audit run exactly as for records created by hand
- [ ] A match key can be chosen for updating existing rows
- [ ] Restricted types need the same permissions as creating them by hand

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

**Status:** open · **Priority:** P3 · **Type:** docs

As an integrator, every route in `/api/openapi.json` has a summary and its parameters.
Core and the admin module describe theirs; other modules' hand-written routes appear
marked `x-undocumented` until each module calls `ctx.describeRoute({...})` beside them.

**Acceptance criteria**

- [ ] Each module describes its hand-written routes
- [ ] A test lists the routes still undocumented, and the list only shrinks
