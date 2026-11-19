# Developer guide

Sandpiper GRC is a governance, risk and compliance platform for transit organisations (bus,
rail and paratransit operators) and their IT, cybersecurity and safety teams: service desk,
asset and system inventory, change enablement, vendors and contracts, cybersecurity
framework outcomes, risks, security incidents with notification clocks, policies,
training, vulnerabilities, projects and reporting. This repository is a **local
prototype**: it runs on one Windows machine with no Docker, no admin rights and no
outbound network access. See the [project README](../README.md) for an introduction and
[Known gaps](known-gaps.md) for what is not built.

This guide is the reference for contributors: the hard rules, commands, layout, the module
and resource API, permissions, tests and web conventions. [Architecture](architecture.md)
explains the design behind it, and [`CONTRIBUTING.md`](../CONTRIBUTING.md) is the short
version for a first pull request.

## Hard rules

- **Nothing that identifies one organisation in the repository.** The product is for
  transit organisations in general, so transit terms (depots, vehicles, dispatch, fares,
  safety hazards) are expected; but no real organisation, agency, regulator, person,
  place, vendor or product names, and no law, regulator or contract of one jurisdiction
  as a built-in default. Everything specific to one installation lives in the
  **organisation profile** (`seed/organisation.json`, see below) or is entered in the
  application. Samples and tests use invented data.
- **`seed/` is private** to each installation and is git-ignored. Never commit it, never
  send it to an external service, never paste its content into code, logs, tests or docs.
- **Local only.** The server binds to 127.0.0.1. No telemetry, no CDN fonts or scripts, no
  calls to outside services from application code. (Webhooks are the one deliberate
  exception: off by default, and only to hosts an administrator allows.)
- **Documentation and the roadmap change with the code, always.** A change is not finished
  until every place that describes it is updated in the same piece of work:
  - `docs/user/*.md` - the user guide. These same files are bundled into the application's
    Help section (`web/src/modules/help`), so there is one source; rebuild the web app.
  - `docs/` - `installation.md`, `operations.md`, `architecture.md`, `security.md`,
    `known-gaps.md`, this guide, and the index `docs/README.md`.
  - `docs/roadmap/` - the epics and issues. Mark the issue done (tick its acceptance
    criteria), add issues for anything new or newly found, and keep the epic table and
    the summary in `docs/roadmap/README.md` in step.
  - `README.md` when what the product does, or how to run it, changes.
  - This guide when structure, commands or conventions change.
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

## Organisation profile and seed data

`.\grc.ps1 seed` loads data into the database; it is idempotent. Two profiles:

- `dev` (`-Profile dev`): generated, invented sample data only (an invented bus and
  light-rail operator). Needs no files.
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
.\grc.ps1 stop | restart | health
.\grc.ps1 dev        # API on :8080 (watch) + Vite on :5173 with /api proxy
.\grc.ps1 seed       # idempotent; -Profile pilot (private seed/ files, default) or dev (generated)
.\grc.ps1 test       # vitest (server and web tests)
.\grc.ps1 typecheck  # server and web
.\grc.ps1 build      # production web build into dist/web
.\grc.ps1 ci         # local continuous integration: typecheck, tests, web build
.\grc.ps1 backup     # checksummed copy of data/ in backups/<timestamp> (-Prune <n> keeps the newest n)
.\grc.ps1 restore <backup|latest>   # verifies, keeps a safety copy, replaces data/
.\grc.ps1 status | logs | upgrade   # see docs/operations.md for these and export-all / import-all
.\grc.ps1 npm <args> # any npm command with the portable Node
```

`.\grc.ps1` with no command prints the full list.

**Continuous integration is local.** Run `.\grc.ps1 ci` before every commit and push: it
runs the typecheck, the tests (server and web) and the web build, and fails if any step
fails. GitHub Actions runs the same checks on Windows and Linux for every push and pull
request (`.github/workflows/ci.yml`), plus a non-blocking dependency audit.

The API description: `npx tsx server/src/core/openapi-cli.ts <file>` writes the whole
OpenAPI document (every record type and route) to a file, or to standard output with no
argument. It builds an in-memory application, so it needs no running server.

### Install on a new machine

No admin rights needed. Run `tools\install-node.ps1` (downloads the pinned Node.js LTS
and verifies its checksum), or do it by hand: download the Node.js LTS Windows x64 zip for
the major version in `tools/node-version.txt` from nodejs.org, check it against the
published SHASUMS256.txt, and extract it to `.tools\node` (so that `.tools\node\node.exe`
exists). Then `.\grc.ps1 npm install` and `.\grc.ps1 start`. The first visit shows the
setup wizard, which creates the administrator; there is no default account. `.tools/`,
`node_modules/`, `data/`, `backups/`, `dist/` and `seed/` are never committed.

In a plain shell: `$env:Path = "$PWD\.tools\node;$env:Path"` then `npm run <script>`.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `GRC_PORT` | `8080` | Port the server listens on (127.0.0.1 only) |
| `GRC_DATA_DIR` | `./data` | Database and stored files; `memory` = in-memory database |
| `GRC_SEED_DIR` | `./seed` | Where the `pilot` seed profile reads its files |
| `GRC_BACKUP_DIR` | `./backups` | Where `backup` writes and `restore` reads |
| `GRC_WEB_DIST` | `./dist/web` | Where the web build is written and served from |
| `GRC_MODULES` | all | Comma-separated server modules to load (server, CLI and tests) |
| `GRC_WEB_MODULES` | all | Comma-separated web module folders to build |
| `GRC_TIMEZONE` | the machine's zone | Organisation time zone (IANA name) |
| `GRC_CURRENCY` | `USD` | Organisation currency (ISO code) |
| `GRC_SEARCH_LANGUAGE` | `english` | PostgreSQL text-search configuration used for full-text search |
| `GRC_ANALYSE` | off | `1` makes the web build report what each package weighs |

Security environment (all optional; see [Security](security.md)): `GRC_SECRET_KEY` (32
bytes as 64 hex characters or base64; encrypts authenticator keys), `GRC_SECRET_KEY_FILE`
(a file holding it; default `secret.key` in the data folder, generated on first start),
`GRC_SECRET_KEY_PREVIOUS` (retired keys, comma-separated, for one start after a key
change), `GRC_COOKIE_SECURE` (`off` default | `auto` | `always`) and `GRC_TRUST_PROXY`
(`1` only behind one trusted reverse proxy). In code, use `clientIp(req)` and
`isHttps(req)` from `core/request.ts` rather than `req.ip` and `req.protocol`.

### Settings

Administrators change these under Administration > Settings (`server/src/modules/admin/settings.ts`).
Read them in code with `ctx.settings.get(key, fallback)`, using the same fallback.

| Key | Default | Meaning |
|---|---|---|
| `app.name` | `Sandpiper GRC` | Name shown in the application |
| `pilot_mode` | `true` | Shows the "sample and test data only" notice |
| `features` | `{ portal: false }` | Feature switches |
| `auth.password_min_length` | `14` | Minimum password length (never below 12) |
| `auth.password_history` | `5` | Earlier passwords that may not be reused |
| `auth.idle_minutes` | `30` | Session idle time-out |
| `auth.mfa_required_for_all` | `false` | Second factor required for everyone |
| `auth.mfa_enforcement` | `notice` | `off`, `notice` or `required` |
| `auth.mfa_grace_days` | `0` | Days to enrol before enforcement |
| `auth.reauth_minutes` | `10` | How long a password confirmation lasts |
| `tokens.max_days` | `365` | Longest life of a new personal access token |
| `tokens.rate_per_minute` | `600` | Requests a minute per token |
| `integrations.outbound_enabled` | `false` | Allows webhook deliveries at all |
| `integrations.allowed_hosts` | `[]` | Hosts webhooks may reach (`host`, `host:port`, `*.domain`) |
| `retention.audit_months` | `84` | Audit log retention, recorded for the retention schedule (nothing deletes audit events) |

Changing an `auth.*`, `tokens.*` or `integrations.*` setting needs a recent password
confirmation. Modules keep their own settings too (for example
`knowledge.agent_permission`, `frameworks.review_reminder_days`); each is described in the
user guide page for that module.

## Working on several modules at once

When you work on more than one module, or alongside someone else in the same working
tree, keep your own copy of the running application so that you do not disturb theirs:

- Use your own scratch data folder outside the repository and your own port, not the
  shared instance (`grc.ps1`, port 8080, `data/`, `dist/`):

  ```
  $env:Path = "$PWD\.tools\node;$env:Path"
  $env:GRC_DATA_DIR = "<scratch>\data"; $env:GRC_WEB_DIST = "<scratch>\dist"
  $env:GRC_SEED_DIR = "<scratch>\none"; $env:GRC_PORT = "<your port>"
  npm run seed -- --profile dev        # invented sample data
  npx vite build                       # builds into GRC_WEB_DIST
  npx tsx server/src/main.ts           # serves API + that build on GRC_PORT
  # stop it cleanly: create an empty file <scratch>\data\grc.stop
  ```
- Load and test only the modules you are working on:
  `$env:GRC_MODULES='<modules>'; npx vitest run <folders>`. `GRC_WEB_MODULES` does the
  same for the web build when another module is mid-edit and does not build. Typecheck
  with `npx tsc --noEmit -p server` / `-p web`.
- Look at your screens in a real browser before calling them done:
  `node tools/browse.mjs http://127.0.0.1:<port> <scratch>\shots <user> <password> [light|dark] [width]`
  with `ROUTES=/a,/b` (or `--all-routes`) and a `DEBUG_PORT` of your own. It signs in
  (create the first administrator with `POST /api/setup`), visits each route, reports
  script errors, failed API calls and horizontal scrolling, and saves screenshots. Check
  light and dark, and 1440 and 820 wide. Keep screenshots outside the repository and
  delete them afterwards.
- Shared files (`README.md`, `docs/README.md`, `docs/known-gaps.md`,
  `docs/roadmap/README.md`, `package.json`, `web/src/core/**`, `server/src/core/**`) are
  changed rarely and deliberately; say in your pull request why they changed.
- Do not add or remove npm packages without saying why in the pull request.

## Layout

```
server/src/main.ts            starts the server
server/src/app.ts             buildApp({ dataDir }) - used by main and by tests
server/src/cli.ts             seed and other commands
server/src/core/              db, migrations, auth, rbac, audit, resources, lookups, links, comments,
                              search, tags and watchers, custom fields, tokens, webhooks, OpenAPI, retention
server/src/core/migrations/   core SQL
server/src/modules/<key>/     one folder per module: index.ts, migrations/*.sql, seed.ts, *.test.ts
server/src/ops/               operations commands: backup, restore, export, import, status
server/src/test/helpers.ts    testApp() - in-memory app with a signed-in admin
web/src/core/                 shell, design system, generic list/detail/form, api client (see web/src/core/README.md)
web/src/modules/<key>/        one folder per module: index.tsx (+ pages)
tools/                        install-node.ps1, browse.mjs, contrast.mjs, switched-off CI files
examples/                     invented organisation profile, API token and webhook receiver examples
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
    ], { module: 'tickets' });
  },
  async register(ctx) {               // routes
    ctx.defineResource({ ... });
    ctx.app.get('/api/tickets/:id/sla', { preHandler: ctx.requirePerm('tickets.view') }, async (req) => { ... });
    ctx.describeRoute({ method: 'GET', path: '/api/tickets/:id/sla', summary: 'Service-level clocks of one ticket', permission: 'tickets.view' });
  },
  async seed(ctx, opts) { ... },      // `grc.ps1 seed`; opts = { profile: 'pilot' | 'dev', seedDir, organisation }
};
export default mod;
```

`ctx` (`ModuleContext`, see `core/module.ts`):

- `ctx.app` - the Fastify instance. `req.user` is the signed-in user (all `/api` routes
  require a session or a token unless registered with `config: { public: true }`).
  `req.apiToken` is `{ id, name }` when the request was made with a personal access token,
  otherwise `null`.
- `ctx.db.query<T>(sql, params) => T[]`, `ctx.db.one<T>(sql, params) => T | undefined`,
  `ctx.db.tx(async (tx) => ...)`. Parameterised queries only (`$1`, `$2`).
- `ctx.dataDir` - the folder holding the database and stored files, or `memory` in tests.
- `ctx.requirePerm('tickets.edit')` - preHandler. `ctx.can(user, perm)` - boolean.
- `ctx.audit(req, { action, recordType, recordId, summary, before, after })`. When the
  request used a token, the audit event records the token too.
- `ctx.lookups.ensure(list, values, opts?)` / `ctx.lookups.values(list)`. `ensure` adds
  missing values and never overwrites values an administrator has edited. `opts` says who
  may read the list through `/api/meta` and `/api/lookups/:list`:
  `{ module: '<permission module>' }` (people with `<module>.view`; for a module whose
  record types are all restricted, also `security.view`) or `{ public: true }` (every
  signed-in user). A list used by a `lookup` field is also readable by anyone who may view
  that record type. **A list with neither an owner nor a field using it is readable by
  administrators only**, so pass `{ module }` on every `ensure` call for lists used by
  hand-written routes and pages.
- `ctx.settings.get(key, fallback)` / `ctx.settings.set(key, value, req?)`.
- `ctx.resources` - registry of record types: `get(type)` (undefined when that module is
  not loaded - always guard cross-module use), `all()`, `labelFor(type, id)`,
  `find(type, id, user?)`, `create(type, data, req?)` and `update(type, id, patch, req?)`.
  `create`/`update` validate, auto-number, run hooks and audit; pass `req` for a user
  action, omit it for system work (seeding, automation), which may also set `readOnly`
  fields. Use these rather than raw SQL whenever you write to a resource table, including
  another module's.
  `visibleWhere(type, user, alias?)` returns the SQL condition (no parameters) for the rows of
  a type that `user` may see under the restricted-record rules; every hand-written query
  over a resource table includes it:
  `where deleted_at is null and ${ctx.resources.visibleWhere('action', req.user)}`.
- `ctx.readSeed(opts, 'systems.psv', '|')` - parses a delimited seed file into objects keyed by header.
  `opts.organisation` is the organisation profile (`{}` when there is none).
- `ctx.fail(status, code, message, fields?)` - throws an API error.
- `ctx.describeRoute({ method, path, summary, permission?, public?, query?, body?, response? })`
  (optional; also `description` and `tag`) describes a hand-written route for
  `GET /api/openapi.json`. Call it beside the route. Routes that are not described still
  appear in the document, marked `x-undocumented`; a route with a `permission` is left out
  for callers who lack it.

Services other modules may offer are Fastify decorators; check before use. For example
the notifications module provides `app.notify(...)`
(`if (ctx.app.hasDecorator('notify')) ...`).

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

Custom fields that an administrator defines (Administration > Custom fields,
`core/customfields.ts`) appear beside the built-in fields as `cf_<key>`, marked
`custom: true` in `/api/meta`, and are accepted by the generated routes like any other
field.

Generated routes:

| Route | Notes |
|---|---|
| `GET {path}` | `q`, `sort`, `dir`, `page`, `pageSize` (max 500), filters `f.<field>=a,b` (any of), `f.<field>.gt=`, `.lt=`, `.null=true\|false`; tags `f.tags=a,b` (any of), `f.tags.all=a,b` (every one), `f.tags.null=true` (untagged); `format=csv` exports. `q` is a full-text search, best matches first when no sort is chosen. Returns `{ rows, total, page, pageSize }`. Each row carries `_display: { <field>: label }` for `user`, `ref` and `lookup` fields, and `_tags` |
| `GET {path}/stats?group=<field>` | Same filters. `{ groups: [{ value, label, color, count }], total }` |
| `GET {path}/:id` | One row (with `_display`) |
| `POST {path}` | Create. 400 with `error.fields` on validation failure |
| `PATCH {path}/:id` | Partial update |
| `DELETE {path}/:id` | Soft delete |

### Cross-cutting API (core)

| Route | Purpose |
|---|---|
| `GET /api/health` | `{ ok: true }` (public) |
| `GET /api/auth/state` | `{ appName, timeZone, currency, setupRequired, user, permissions, features, pilot, mfa... }` (public) |
| `POST /api/setup` | First-run administrator (public, only while no users exist) |
| `POST /api/auth/login`, `/logout`, `/change-password`, `/confirm` | Local sign-in; `confirm` proves the password again before a sensitive action |
| `GET /api/meta` | `{ resources: { [type]: meta }, lookups: { [list]: [{ value, label, color, sort }] } }` |
| `GET /api/openapi.json` | OpenAPI document, cut down to what the caller may use |
| `GET /api/users/options?q=` | `[{ id, label }]` for user pickers |
| `GET /api/records/lookup?type=&q=` | `[{ id, label, ref }]` for record pickers |
| `GET /api/search?q=` | `[{ type, typeLabel, id, label, ref, route }]`, permission-filtered |
| `GET/POST /api/comments` | `record_type`, `record_id`, `body`, `internal` |
| `GET/POST /api/links`, `DELETE /api/links/:id` | Generic related records; GET returns both directions |
| `GET /api/history?record_type=&record_id=` | Audit events for one record (needs view on that type) |
| `GET /api/audit` | Full audit search (`audit.view`) |
| `GET /api/lookups/:list`, `POST/PATCH/DELETE /api/lookups...` | Lookup values; writes need `admin.administer` |
| `/api/tags...`, `/api/watchers`, `/api/me/watching` | Tags and watchers on any record |
| `/api/me/preferences/:key` | Per-person preferences |
| `/api/me/tokens`, `/api/admin/tokens` | Personal access tokens |
| `/api/admin/webhooks...` | Webhooks and their deliveries |
| `/api/admin/custom-fields...`, `/api/admin/retention...` | Custom fields; retention schedule and reviews |

Errors: `{ error: { code, message, fields? } }` with a matching HTTP status.

Authentication: a browser session (cookie `grc_session`), on which every mutating request
must carry the header `X-GRC-CSRF: 1` (the web api client adds it); or a personal access
token, `Authorization: Bearer grc_pat_...`, which needs no `X-GRC-CSRF` header and never
falls back to the cookie. A token acts as its owner, limited to its scopes, cannot reach
the sign-in, account-security or token routes, and cannot pass a password confirmation.
See `examples/api-token.ps1`.

### Permissions

Strings of the form `<module>.<action>`; actions: `view`, `create`, `edit`, `delete`,
`approve`, `administer`, `export`. Role grants may use wildcards (`tickets.*`, `*`).
Module keys (fixed, `MODULE_KEYS` in `server/src/modules/admin/shared.ts`): `tickets`,
`knowledge`, `assets`, `systems`, `sites`, `data`, `changes`, `vendors`, `contracts`,
`frameworks`, `risks`, `security`, `vulnerabilities`, `policies`, `training`,
`exceptions`, `obligations`, `exercises`, `actions`, `projects`, `dashboards`, `reports`,
`audit`, `admin`, `portal`. A new key is added there and here.

Restricted records (security incidents, risks, vulnerabilities, anything flagged) are
invisible without `security.view` in lists, counts, search, links, exports and stats.
`defineResource` enforces this; hand-written routes must too
(`ctx.resources.find(type, id, req.user)` for one record,
`ctx.resources.visibleWhere(type, req.user)` in SQL). Actions are `restricted: 'flag'`
and inherit the flag from their source record. Sensitive administrative routes call
`sensitive(ctx, req, what)` (`modules/admin/shared.ts`), which needs a recent password
confirmation (`POST /api/auth/confirm`).

### Tests

Vitest, files named `*.test.ts` beside the code (server and web). Use `testApp()` from
`server/src/test/helpers.ts`: an in-memory app with `api.get/post/patch/del` helpers already
signed in as an administrator, `as(roleKey)` for a client holding one other role, and
`anon`. Responses are `{ status, body, text }`. `testApp({ extraModules })` adds stand-in
modules (for example a minimal `action` type) so a module can be tested alone. Never read
`seed/` from a test.

Run one module's tests in isolation (other modules not loaded):
`$env:GRC_MODULES='tickets'; npx vitest run server/src/modules/tickets`.
`GRC_MODULES` (comma-separated) also limits which modules the server and CLI load.

### Actions (shared contract)

The `action` record type (module folder `risks`, API `/api/actions`) is the one cross-module
to-do list. Fields: `title`, `description`, `status` (`action_status`: open, in_progress,
blocked, done, cancelled), `priority` (`action_priority`: high, medium, low), `owner_id`,
`due_on`, `source` (`action_source`: risk, assessment, incident, audit, exercise,
information_request, project, change, vulnerability, policy, training, vendor, problem,
other), `source_type` + `source_id` (the record it arose
from), `department`, `notes`, `restricted` (read-only: true when the source record is
restricted; such actions are hidden without `security.view`). Any module may create one with
`ctx.resources.create('action', {...})` after checking `ctx.resources.get('action')`.
Always pass `source_type` and `source_id` so the restriction is inherited.

Risk scales: the two built-in scale keys are `cyber_5x5` and `hazard_4x5` (the safety
hazard matrix: four severity levels by five likelihood levels; it was `asp` before
migration `risks/002`).

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

The build reads each module's `key`, `nav`, `create` and route paths at build time, so
keep them literal; the rest of the module is loaded when one of its routes is first opened.

Nav groups, in order: Home, Service desk, Inventory, Change, Vendors, Cybersecurity,
Projects, Reports, Administration, Help.

Quality bar: every screen has empty, loading and error states; every list
has filter, sort, saved view and export; every record shows its history.

## Record types and owners

| Module folder | Record types (`type` → table) |
|---|---|
| `tickets` | `ticket` → tickets, `problem` → problems, `knowledge_article` → knowledge_articles, `catalog_item` → catalog_items |
| `inventory` | `system` → systems, `asset` → assets, `site` → sites, `data_category` → data_categories |
| `changes` | `change` → changes |
| `vendors` | `vendor` → vendors, `contract` → contracts, `evidence_item` → evidence_items |
| `frameworks` | `framework` → frameworks, `framework_outcome` → framework_outcomes, `assessment_snapshot` → assessment_snapshots |
| `risks` | `risk` → risks (restricted), `action` → actions (flag, inherited), `obligation` → obligations |
| `secincidents` | `security_incident` → security_incidents (restricted), `notification_task` → notification_tasks |
| `policies` | `policy` → policies, `policy_exception` → policy_exceptions |
| `training` | `course` → courses, `exercise` → exercises |
| `vulnerabilities` | `vulnerability` → vulnerability_records (restricted) |
| `projects` | `project` → projects |
| `reports` | `report_definition` → report_definitions, `dashboard` → dashboards, `report_schedule` → report_schedules, `report_pack` → report_packs |
| `attachments` | no record type: files on any record (table `attachments`; `AttachmentsPanel`; stored in `<data>/files`) |
| `notifications` | no record type: in-app notifications (tables `notifications`, `notification_preferences`; `app.notify(...)`, `NotificationBell`) |
| `admin` | users, roles, second factor, audit viewer, lookups, settings, custom fields, tokens, webhooks, retention screens |
| `home` | the Overview page (web only) |
| `help` | the user guide, rendered from `docs/user/*.md` (web only) |

Permission module per type: ticket, problem, catalog_item → `tickets`; knowledge_article →
`knowledge`; system → `systems`; asset → `assets`; site → `sites`; data_category → `data`;
change → `changes`; vendor, evidence_item → `vendors`; contract → `contracts`; framework,
framework_outcome, assessment_snapshot → `frameworks`; risk → `risks`; action →
`actions`; obligation → `obligations`; security_incident, notification_task → `security`;
policy → `policies`; policy_exception → `exceptions`; course → `training`; exercise →
`exercises`; vulnerability → `vulnerabilities`; project → `projects`; report_definition,
report_schedule, report_pack → `reports`; dashboard → `dashboards`.

Not yet built: OpenID Connect or SAML single sign-on, account linking, passkeys and a
break-glass account; email delivery (notifications, scheduled reports and links are
in-app only); PDF and XLSX files generated on the server, and XLSX import; the
self-service portal and email-to-ticket; a general workflow designer; a PostgreSQL server,
containers and HTTPS. See [Known gaps](known-gaps.md) and the
[roadmap](roadmap/README.md).

## Known gaps

Kept in [`docs/known-gaps.md`](known-gaps.md). Update it with every change.
