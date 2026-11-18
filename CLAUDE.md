# Sandpiper GRC

An IT governance, risk and compliance platform for a small IT team: service desk, asset and
system inventory, vendors and contracts, cybersecurity framework outcomes, risks, security
incidents with notification clocks, projects and gates. This repository is a **local
prototype**: it runs on one Windows machine with no Docker, no admin rights and no outbound
network access. See `README.md` for an introduction and `docs/known-gaps.md` for what is
not built.

## Hard rules

- **Nothing organisation-specific in the repository.** No organisation, person, place,
  vendor or product names; no law, regulator or contract of one jurisdiction as a built-in
  default; no sector jargon. Everything specific to one installation lives in the
  **organisation profile** (`seed/organisation.json`, see below) or is entered in the
  application. Samples and tests use invented, sector-neutral data.
- **`seed/` is private** to each installation and is git-ignored. Never commit it, never
  send it to an external service, never paste its content into code, logs, tests or docs.
- **Local only.** The server binds to 127.0.0.1. No telemetry, no CDN fonts or scripts, no
  calls to outside services from application code.
- **Documentation and the roadmap change with the code, always.** A change is not finished
  until every place that describes it is updated in the same piece of work:
  - `docs/user/*.md` - the user guide. These same files are bundled into the application's
    Help section (`web/src/modules/help`), so there is one source; rebuild the web app.
  - `docs/` - `installation.md`, `operations.md`, `architecture.md`, `security.md`,
    `known-gaps.md`, and the index `docs/README.md`.
  - `docs/roadmap/` - the epics and issues. Mark the issue done (tick its acceptance
    criteria), add issues for anything new or newly found, and keep the epic table and
    the summary in `docs/roadmap/README.md` in step.
  - `README.md` when what the product does, or how to run it, changes.
  - This file when structure, commands or conventions change.
- **Do not copy any commercial product's branding, text, icons or screens.**
- Every data change writes an audit event. Every feature ships with a test.
- Configuration over code: statuses, priorities, categories, scales and so on are rows in
  `lookups` / settings tables, not constants.
- Plain English in the UI, British spelling ("catalogue", "authorisation", "organisation").

## Prototype choices (revisit before production)

| Production target | Prototype | Why |
|---|---|---|
| PostgreSQL server | PGlite (Postgres compiled to WASM, embedded, data in `data/pg`) | Runs with no install. SQL is real Postgres, so moving to a server is a driver swap in `server/src/core/db.ts` |
| Containers | `grc.ps1` + portable Node in `.tools/node` | Same reason |
| Job queue | In-process timers | Single process |

## Working in parallel (several people or agents in one working tree)

- Stay inside the folders you were given. Shared files (`README.md`, `CLAUDE.md`,
  `docs/README.md`, `docs/known-gaps.md`, `docs/roadmap/README.md`, `package.json`,
  `web/src/core/**`, `server/src/core/**`) belong to whoever is coordinating: report what
  should change in them instead of editing them, unless they were given to you.
- Never use the shared instance: not `grc.ps1`, not port 8080, not `data/`, not `dist/`.
  Use your own scratch folder outside the repository and your own ports:

  ```
  $env:Path = "$PWD\.tools\node;$env:Path"
  $env:GRC_DATA_DIR = "<scratch>\data"; $env:GRC_WEB_DIST = "<scratch>\dist"
  $env:GRC_SEED_DIR = "<scratch>\none"; $env:GRC_PORT = "<your port>"
  npm run seed -- --profile dev        # invented sample data
  npx vite build                       # builds into GRC_WEB_DIST
  npx tsx server/src/main.ts           # serves API + that build on GRC_PORT (start it hidden/in the background)
  # stop it cleanly: create an empty file <scratch>\data\grc.stop
  ```
- Run only your own tests: `$env:GRC_MODULES='<your modules>'; npx vitest run <your folders>`.
  Typecheck with `npx tsc --noEmit -p server` / `-p web` and act on errors in your files only.
- Look at your screens in a real browser before calling them done:
  `node tools/browse.mjs http://127.0.0.1:<port> <scratch>\shots <user> <password> [light|dark] [width]`
  with `ROUTES=/a,/b` and a `DEBUG_PORT` of your own. It signs in (create the first
  administrator with `POST /api/setup`), visits each route, reports script errors, failed
  API calls and horizontal scrolling, and saves screenshots to read. Check light and dark,
  and 1440 and 820 wide. Delete the screenshots afterwards.
- Do not install or remove npm packages; ask the coordinator.
- Do not commit; the coordinator commits.
- Never read `seed/` or any "Build Specification" file.

## Organisation profile and seed data

`.\grc.ps1 seed` loads data into the database; it is idempotent. Two profiles:

- `dev` (`-Profile dev`): generated, invented sample data only. Needs no files.
- `pilot` (default): reads the private `seed/` folder. Every file is optional; a missing
  file is skipped.
  - `organisation.json`: the organisation profile. Shape and an invented example are in
    `examples/organisation.example.json`: `appName`, `lookups` (extra values for any
    configurable list), `obligations`, `notificationRules`. Core applies `appName` and
    `lookups`; modules read their own sections from `opts.organisation`.
  - Optional pipe-delimited import files (first line is the header): `systems.psv`,
    `sites.psv`, `data_categories.psv`, `vendor_contracts.psv`, `csf_target_profile.psv`,
    `information_requests.psv`, and `csf_subcategory_designations.csv`. The expected
    headers are in each module's `seed.ts`.

Environment: `GRC_TIMEZONE` (IANA name; default is the machine's zone) and `GRC_CURRENCY`
(ISO code, default `USD`) set the organisation's time zone and currency.

## Commands

Everything goes through `grc.ps1` (it puts the portable Node on PATH):

```
.\grc.ps1 start      # build web if needed, run on http://127.0.0.1:8080
.\grc.ps1 stop
.\grc.ps1 health
.\grc.ps1 dev        # API on :8080 (watch) + Vite on :5173 with /api proxy
.\grc.ps1 seed       # idempotent; -Profile pilot (private seed/ files, default) or dev (generated)
.\grc.ps1 test       # vitest
.\grc.ps1 typecheck
.\grc.ps1 backup     # checksummed copy of data/ in backups/<timestamp> (-Prune <n> keeps the newest n)
.\grc.ps1 restore <backup|latest>   # verifies, keeps a safety copy, replaces data/
.\grc.ps1 status | logs | upgrade   # see docs/operations.md for these and export-all / import-all
.\grc.ps1 npm <args> # any npm command with the portable Node
```

### Install on a new machine

No admin rights needed. Run `tools\install-node.ps1` (downloads the pinned Node.js LTS
and verifies its checksum), or do it by hand: download the Node.js 24 LTS Windows x64 zip from nodejs.org, check
it against the published SHASUMS256.txt, and extract it to `.tools\node` (so that
`.tools\node\node.exe` exists). Then `.\grc.ps1 npm install` and `.\grc.ps1 start`. The
first visit shows the setup wizard, which creates the administrator; there is no default
account. `.tools/`, `node_modules/`, `data/` and `seed/` are never committed.

In a plain shell: `$env:Path = "$PWD\.tools\node;$env:Path"` then `npm run <script>`.

Environment: `GRC_PORT` (8080), `GRC_DATA_DIR` (`./data`; `memory` = in-memory database),
`GRC_SEED_DIR` (`./seed`).

Security environment (all optional; see `docs/security.md`): `GRC_SECRET_KEY` (32 bytes as
64 hex characters or base64; encrypts authenticator keys), `GRC_SECRET_KEY_FILE` (a file
holding it; default `secret.key` in the data folder, generated on first start),
`GRC_SECRET_KEY_PREVIOUS` (retired keys, comma-separated, for one start after a key
change), `GRC_COOKIE_SECURE` (`off` default | `auto` | `always`) and `GRC_TRUST_PROXY`
(`1` only behind one trusted reverse proxy). In code, use `clientIp(req)` and
`isHttps(req)` from `core/request.ts` rather than `req.ip` and `req.protocol`.

## Layout

```
server/src/main.ts            starts the server
server/src/app.ts             buildApp({ dataDir }) - used by main and by tests
server/src/cli.ts             seed and other commands
server/src/core/              db, migrations, auth, rbac, audit, resources, lookups, links, comments, search
server/src/core/migrations/   core SQL
server/src/modules/<key>/     one folder per module: index.ts, migrations/*.sql, seed.ts, *.test.ts
server/src/test/helpers.ts    testApp() - in-memory app with a signed-in admin
web/src/core/                 shell, design system, generic list/detail/form, api client (see web/src/core/README.md)
web/src/modules/<key>/        one folder per module: index.tsx (+ pages)
```

Modules are discovered automatically on both sides (directory scan on the server,
`import.meta.glob` on the web). **A module never edits files outside its own two folders.**
Folders starting with `_` are ignored.

## Server conventions

TypeScript ESM, run by `tsx`. Relative imports carry the `.ts` extension. No enums.

### Module shape

```ts
// server/src/modules/tickets/index.ts
import type { ModuleDef } from '../../core/module.ts';

const mod: ModuleDef = {
  key: 'tickets',
  async seedDefaults(ctx) {           // runs at every start, after migrations; must be idempotent
    await ctx.lookups.ensure('ticket_status', [
      { value: 'new', label: 'New', color: 'blue', sort: 10 },
    ]);
  },
  async register(ctx) {               // routes
    ctx.defineResource({ ... });
    ctx.app.get('/api/tickets/:id/sla', { preHandler: ctx.requirePerm('tickets.view') }, async (req) => { ... });
  },
  async seed(ctx, opts) { ... },      // `grc.ps1 seed`; opts = { profile: 'pilot' | 'dev', seedDir }
};
export default mod;
```

`ctx` (`ModuleContext`, see `core/module.ts`):

- `ctx.app` - the Fastify instance. `req.user` is the signed-in user (all `/api` routes
  require a session unless registered with `config: { public: true }`).
- `ctx.db.query<T>(sql, params) => T[]`, `ctx.db.one<T>(sql, params) => T | undefined`,
  `ctx.db.tx(async (tx) => ...)`. Parameterised queries only (`$1`, `$2`).
- `ctx.requirePerm('tickets.edit')` - preHandler. `ctx.can(user, perm)` - boolean.
- `ctx.audit(req, { action, recordType, recordId, summary, before, after })`.
- `ctx.lookups.ensure(list, values, opts?)` / `ctx.lookups.values(list)`. `opts` says who may
  read the list through `/api/meta` and `/api/lookups/:list`: `{ module: '<permission module>' }`
  (people with `<module>.view`; for a module whose record types are all restricted, also
  `security.view`) or `{ public: true }` (every signed-in user). A list used by a `lookup`
  field is also readable by anyone who may view that record type. **A list with neither an
  owner nor a field using it is readable by administrators only**, so pass `{ module }` on
  every `ensure` call for lists used by hand-written routes and pages.
- `ctx.settings.get(key, fallback)` / `ctx.settings.set(key, value)`.
- `ctx.resources` - registry of record types: `get(type)` (undefined when that module is
  not loaded - always guard cross-module use), `labelFor(type, id)`, `find(type, id, user?)`,
  `create(type, data, req?)` and `update(type, id, patch, req?)`. `create`/`update` validate,
  auto-number, run hooks and audit; pass `req` for a user action, omit it for system work
  (seeding, automation), which may also set `readOnly` fields. Use these rather than raw
  SQL whenever you write to a resource table, including another module's.
  `visibleWhere(type, user, alias?)` returns the SQL condition (no parameters) for the rows of
  a type that `user` may see under the restricted-record rules; every hand-written query
  over a resource table includes it:
  `where deleted_at is null and ${ctx.resources.visibleWhere('action', req.user)}`.
- `ctx.readSeed(opts, 'systems.psv', '|')` - parses a delimited seed file into objects keyed by header.
  `opts.organisation` is the organisation profile (`{}` when there is none).
- `ctx.fail(status, code, message, fields?)` - throws an API error.

### Migrations

`server/src/modules/<key>/migrations/001_name.sql`, applied in file-name order, core first
then modules alphabetically, tracked in `schema_migrations`. Never edit an applied migration
in a way that matters after pilot; during prototyping it is fine to edit and delete `data/`.
**No foreign keys across modules** - store the other record's `uuid` in a plain column and
declare the field as `{ type: 'ref', to: '<type>' }`.

Every resource table has these columns:

```sql
id uuid primary key default gen_random_uuid(),
created_at timestamptz not null default now(), created_by uuid,
updated_at timestamptz not null default now(), updated_by uuid,
deleted_at timestamptz
```

### Resources (generic CRUD)

`ctx.defineResource(def)` registers a record type and generates list, stats, get, create,
update and soft-delete routes with permission checks, validation, audit and CSV export.

```ts
ctx.defineResource({
  type: 'ticket',               // record type key, singular, snake_case
  table: 'tickets',
  module: 'tickets',            // permission prefix: tickets.view / .create / .edit / .delete / .export
  label: 'Ticket', plural: 'Tickets',
  path: '/api/tickets',         // API base
  route: '/tickets',            // web route; detail page is `${route}/${id}`
  titleField: 'title',
  ref: { field: 'ref', prefix: 'TKT-' },  // optional auto-number: TKT-00001
  restricted: false,            // true = whole type needs security.view; 'flag' = rows with restricted=true need it
  // restrictedFrom: { typeField: 'source_type', idField: 'source_id' },
  //   with restricted: 'flag' and a boolean `restricted` column: rows take their restriction from
  //   the record those two fields point at. Core sets the flag (declare the field readOnly),
  //   keeps it in step when either record changes, and refuses a source the caller cannot see.
  searchable: ['title', 'description'],
  defaultSort: { field: 'created_at', dir: 'desc' },
  fields: {
    title:       { label: 'Title', type: 'text', required: true },
    description: { label: 'Description', type: 'longtext' },
    status:      { label: 'Status', type: 'lookup', list: 'ticket_status', default: 'new' },
    assignee_id: { label: 'Assignee', type: 'user' },
    system_id:   { label: 'System', type: 'ref', to: 'system' },
    due_at:      { label: 'Due', type: 'datetime' },
    cost:        { label: 'Cost', type: 'currency' },
    details:     { label: 'Details', type: 'json' },
    ref:         { label: 'Reference', type: 'text', readOnly: true },
  },
  hooks: {                      // all optional; may throw ctx.fail(...)
    beforeCreate: async (req, data) => data,
    beforeUpdate: async (req, existing, patch) => patch,
    afterCreate: async (req, row) => {},
    afterUpdate: async (req, before, after) => {},
  },
});
```

Field types: `text`, `longtext`, `number`, `currency`, `date`, `datetime`, `boolean`,
`lookup` (needs `list`), `user`, `ref` (needs `to`), `json`. Field names are column names.

Generated routes:

| Route | Notes |
|---|---|
| `GET {path}` | `q`, `sort`, `dir`, `page`, `pageSize` (max 500), filters `f.<field>=a,b` (any of), `f.<field>.gt=`, `.lt=`, `.null=true\|false`; `format=csv` exports. Returns `{ rows, total, page, pageSize }`. Each row carries `_display: { <field>: label }` for `user`, `ref` and `lookup` fields |
| `GET {path}/stats?group=<field>` | Same filters. `{ groups: [{ value, label, color, count }], total }` |
| `GET {path}/:id` | One row (with `_display`) |
| `POST {path}` | Create. 400 with `error.fields` on validation failure |
| `PATCH {path}/:id` | Partial update |
| `DELETE {path}/:id` | Soft delete |

### Cross-cutting API (core)

| Route | Purpose |
|---|---|
| `GET /api/auth/state` | `{ appName, setupRequired, user, permissions, features, pilot }` (public) |
| `POST /api/setup` | First-run administrator (public, only while no users exist) |
| `POST /api/auth/login`, `/logout`, `/change-password` | Local sign-in |
| `GET /api/meta` | `{ resources: { [type]: meta }, lookups: { [list]: [{ value, label, color, sort }] } }` |
| `GET /api/users/options?q=` | `[{ id, label }]` for user pickers |
| `GET /api/records/lookup?type=&q=` | `[{ id, label, ref }]` for record pickers |
| `GET /api/search?q=` | `[{ type, typeLabel, id, label, ref, route }]`, permission-filtered |
| `GET/POST /api/comments` | `record_type`, `record_id`, `body`, `internal` |
| `GET/POST /api/links`, `DELETE /api/links/:id` | Generic related records; GET returns both directions |
| `GET /api/history?record_type=&record_id=` | Audit events for one record (needs view on that type) |
| `GET /api/audit` | Full audit search (`audit.view`) |
| `GET /api/lookups/:list`, `POST/PATCH/DELETE /api/lookups...` | Lookup values; writes need `admin.administer` |

Errors: `{ error: { code, message, fields? } }` with a matching HTTP status.
Mutating requests must carry the header `X-GRC-CSRF: 1` (the web api client adds it).

### Permissions

Strings of the form `<module>.<action>`; actions: `view`, `create`, `edit`, `delete`,
`approve`, `administer`, `export`. Role grants may use wildcards (`tickets.*`, `*`).
Module keys (fixed): `tickets`, `knowledge`, `assets`, `systems`, `sites`, `data`,
`changes`, `vendors`, `contracts`, `frameworks`, `risks`, `security`, `vulnerabilities`,
`policies`, `training`, `exceptions`, `obligations`, `exercises`, `actions`, `projects`,
`dashboards`, `reports`, `audit`, `admin`.

Restricted records (security incidents, risks, anything flagged) are invisible without
`security.view` in lists, counts, search, links, exports and stats. `defineResource`
enforces this; hand-written routes must too (`ctx.resources.find(type, id, req.user)` for
one record, `ctx.resources.visibleWhere(type, req.user)` in SQL). Actions are
`restricted: 'flag'` and inherit the flag from their source record. Sensitive
administrative routes call `sensitive(ctx, req, what)` (`modules/admin/shared.ts`), which
needs a recent password confirmation (`POST /api/auth/confirm`).

### Tests

Vitest, files named `*.test.ts` beside the code. Use `testApp()` from
`server/src/test/helpers.ts`: an in-memory app with `api.get/post/patch/del` helpers already
signed in as an administrator, `as(roleKey)` for a client holding one other role, and
`anon`. Responses are `{ status, body, text }`. Never read `seed/` from a test.

Run one module's tests in isolation (other modules not loaded):
`$env:GRC_MODULES='tickets'; npx vitest run server/src/modules/tickets`.
`GRC_MODULES` (comma-separated) also limits which modules the server and CLI load.

### Actions (shared contract)

The `action` record type (module folder `risks`, API `/api/actions`) is the one cross-module
to-do list. Fields: `title`, `description`, `status` (`action_status`: open, in_progress,
blocked, done, cancelled), `priority` (`action_priority`: high, medium, low), `owner_id`,
`due_on`, `source` (`action_source`: risk, assessment, incident, audit, exercise,
information_request, project, other), `source_type` + `source_id` (the record it arose
from), `department`, `notes`, `restricted` (read-only: true when the source record is
restricted; such actions are hidden without `security.view`). Any module may create one with
`ctx.resources.create('action', {...})` after checking `ctx.resources.get('action')`.
Always pass `source_type` and `source_id` so the restriction is inherited.

Risk scales: the two built-in scale keys are `cyber_5x5` and `hazard_4x5` (the latter was
`asp` before migration `risks/002`).

## Web conventions

React 19 + React Router + Vite, TypeScript, plain CSS with design tokens
(`web/src/core/tokens.css`), ECharts for charts. The component library is Mantine 9,
wrapped by the core design system: import from `'../../core'` first, and use
`@mantine/core` directly only for layouts the core does not cover. See
`web/src/core/README.md` for the component catalogue.

```tsx
// web/src/modules/tickets/index.tsx
import type { ModuleDef } from '../../core/module';
const mod: ModuleDef = {
  key: 'tickets',
  nav: [{ group: 'Service desk', label: 'Tickets', path: '/tickets', icon: 'ticket', permission: 'tickets.view', order: 10 }],
  routes: [
    { path: '/tickets', element: <TicketList /> },
    { path: '/tickets/:id', element: <TicketDetail /> },
  ],
  create: [{ label: 'Ticket', path: '/tickets?new=1', permission: 'tickets.create' }],
};
export default mod;
```

Nav groups, in order: Home, Service desk, Inventory, Change, Vendors, Cybersecurity,
Projects, Reports, Administration, Help.

Quality bar: every screen has empty, loading and error states; every list
has filter, sort, saved view and export; every record shows its history.

## Record types and owners

| Module folder | Record types (`type` → table) |
|---|---|
| `tickets` | `ticket` → tickets, `problem` → problems, `knowledge_article` → knowledge_articles, `catalog_item` → catalog_items |
| `inventory` | `system` → systems, `asset` → assets, `site` → sites, `data_category` → data_categories |
| `vendors` | `vendor` → vendors, `contract` → contracts, `evidence_item` → evidence_items |
| `frameworks` | `framework` → frameworks, `framework_outcome` → framework_outcomes, `assessment_snapshot` → assessment_snapshots |
| `risks` | `risk` → risks (restricted), `action` → actions, `obligation` → obligations |
| `secincidents` | `security_incident` → security_incidents (restricted), `notification_task` → notification_tasks |
| `projects` | `project` → projects |
| `admin` | users, roles, second factor, audit viewer, lookups, settings |
| `changes` | `change` → changes |
| `policies` | `policy` → policies, `policy_exception` → policy_exceptions |
| `training` | `course` → courses, `exercise` → exercises |
| `vulnerabilities` | `vulnerability` → vulnerabilities (restricted) |
| `attachments` | files on any record (`AttachmentsPanel`; stored in `data/files`) |
| `notifications` | in-app notifications (`app.notify(...)`, `NotificationBell`) |
| `home` | dashboards |
| `help` | the user guide, rendered from `docs/user/*.md` (web only) |

Permission module per type: ticket, problem, catalog_item → `tickets`; knowledge_article →
`knowledge`; system → `systems`; asset → `assets`; site → `sites`; data_category → `data`;
vendor, evidence_item → `vendors`; contract → `contracts`; framework* and
assessment_snapshot → `frameworks`; risk → `risks`; action → `actions`; obligation →
`obligations`; security_incident, notification_task → `security`; project → `projects`.

Permission modules for the newer types: change → `changes`; policy → `policies`;
policy_exception → `exceptions`; course → `training`; exercise → `exercises`;
vulnerability → `vulnerabilities`.

Not yet built: report builder and user-built dashboards, API tokens, single sign-on,
self-service portal, custom fields, email. See `docs/known-gaps.md` and `docs/roadmap/`.

## Known gaps

Kept in `docs/known-gaps.md`. Update it with every change.
