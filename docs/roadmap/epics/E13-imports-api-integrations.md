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
- Personal API tokens are tracked in [E02-12](E02-account-security.md). Until they
  exist, the API can only be called with a browser session.
- The application makes no outbound connections. Webhooks and other outbound
  integrations need that rule relaxed by configuration, per installation.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E13-01 | Asset CSV import with mapping and dry run | done | P1 |
| E13-02 | Asset JSON ingest | done | P2 |
| E13-03 | Delimited seed files for first load | done | P2 |
| E13-04 | Spreadsheet (XLSX) import | open | P3 |
| E13-05 | OpenAPI document | open | P2 |
| E13-06 | Webhooks | open | P3 |
| E13-07 | CSV import for other record types | open | P2 |

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
- [ ] Callable with an API token rather than a browser session (see [E02-12](E02-account-security.md))

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

**Status:** open · **Priority:** P2 · **Type:** docs

As an integrator, I can download a machine-readable description of the API, generated
from the record types so it never drifts from the code.

**Acceptance criteria**

- [ ] `GET /api/openapi.json` describes every generated resource route
- [ ] Hand-written routes are described too
- [ ] The document is filtered by the caller's permissions
- [ ] A test fails when a route is missing from the document

### E13-06 Webhooks

**Status:** open · **Priority:** P3 · **Type:** feature

As an administrator, I register a URL to be called when chosen events happen (for
example a ticket is created or a notification clock turns red).

**Acceptance criteria**

- [ ] Webhooks are data: URL, events, secret, on/off
- [ ] Each call is signed and retried with back-off
- [ ] Deliveries and failures are logged and visible to administrators
- [ ] Off by default; outbound calls need an explicit setting per installation
- [ ] Restricted records are never sent to a webhook without an explicit choice

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
