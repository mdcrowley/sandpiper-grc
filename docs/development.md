# Developer guide

Sandpiper GRC is a governance, risk and compliance platform for transit organizations (bus,
rail and paratransit operators) and their IT, cybersecurity and safety teams: service desk,
asset and system inventory, change enablement, vendors and contracts, cybersecurity
framework outcomes, risks, security incidents with notification clocks, policies,
training, vulnerabilities, projects, fleet and services, safety management and reporting.
This repository is a **prototype**. It runs on Windows (`grc.ps1`), macOS and Linux
(`grc.sh`) with a portable Node.js and no admin rights, or in Docker (`compose.yaml`), with
no outbound network access; it can also run on a server with PostgreSQL and HTTPS. See the [project README](../README.md) for an
introduction and [Known gaps](known-gaps.md) for what is not built.

This guide is the reference for contributors: the hard rules, commands, layout, the module
and resource API, permissions, tests and web conventions. [Architecture](architecture.md)
explains the design behind it, and [`CONTRIBUTING.md`](../CONTRIBUTING.md) is the short
version for a first pull request.

## Hard rules

- **Nothing that identifies one organization in the repository.** The product is for
  transit organizations in general, so transit terms (depots, vehicles, dispatch, fares,
  safety hazards) are expected; but no real organization, agency, regulator, person,
  place, vendor or product names, and no law, regulator or contract of one jurisdiction
  as a built-in default. Everything specific to one installation lives in the
  **organization profile** (`seed/organization.json`, see below) or is entered in the
  application. Samples and tests use invented data.
- **`seed/` is private** to each installation and is git-ignored. Never commit it, never
  send it to an external service, never paste its content into code, logs, tests or docs.
- **Local by default.** The server binds to 127.0.0.1 unless it is configured for a
  server installation. No telemetry, no CDN fonts or scripts, no calls to outside
  services from application code, except the deliberate ones an administrator switches
  on: webhooks and the text-message webhook (only to allowed hosts), email, sign-in providers, the malware scanner and
  the object store. Each is off by default.
- **Documentation and the roadmap change with the code, always.** A change is not finished
  until every place that describes it is updated in the same piece of work:
  - `docs/user/*.md` - the user guide. These same files are bundled into the application's
    Help section (`web/src/modules/help`), so there is one source; rebuild the web app.
  - `docs/` - `installation.md`, `operations.md`, `architecture.md`, `security.md`,
    `known-gaps.md`, this guide, and the index `docs/README.md`.
  - `docs/roadmap/` - the epics and issues. Mark the issue done (check its acceptance
    criteria), add issues for anything new or newly found, and keep the epic table and
    the summary in `docs/roadmap/README.md` in step.
  - `README.md` when what the product does, or how to run it, changes.
  - This guide when structure, commands or conventions change.
- **Do not copy any commercial product's branding, text, icons or screens.**
- Every data change writes an audit event. Every feature ships with a test.
- Configuration over code: statuses, priorities, categories, scales and so on are rows in
  `lookups` / settings tables, not constants.
- Plain English in the UI, American English spelling ("catalog", "authorization",
  "organization").

## Prototype choices (revisit before production)

| Production target | Prototype default | Notes |
|---|---|---|
| PostgreSQL server | PGlite (Postgres compiled to WASM, embedded, data in `data/pg`) | Runs with no install. `GRC_DATABASE_URL` switches to a PostgreSQL server; both drivers are in `server/src/core/db.ts` |
| Containers | `grc.ps1` (Windows) or `grc.sh` (macOS, Linux) with portable Node in `.tools/node` | `Dockerfile`, `compose.yaml` and `compose.postgres.yaml`; images published to `ghcr.io/mdcrowley/sandpiper-grc` ([Docker](docker.md)) |
| Job queue | Table-backed job queue (`app.jobs`), started by core | Every scheduled task runs there, so it runs once however many server processes share the database |

## Organization profile and seed data

`.\grc.ps1 seed` loads data into the database; it is idempotent. Two profiles:

- `dev` (`-Profile dev`): generated, invented sample data only (an invented bus and
  light-rail operator). Needs no files.
- `pilot` (default): reads the private `seed/` folder. Every file is optional; a missing
  file is skipped.
  - `organization.json`: the organization profile (a file still named
    `organisation.json` is read too). Shape and an invented example are in
    `examples/organization.example.json`: `appName`, `lookups` (extra values for any
    configurable list), `obligations`, `notificationRules`. Core applies `appName` and
    `lookups`; modules read their own sections from `opts.organization`.
  - Optional pipe-delimited import files (first line is the header): `systems.psv`,
    `sites.psv`, `data_categories.psv`, `vendor_contracts.psv`, `csf_target_profile.psv`,
    `information_requests.psv`, and `csf_subcategory_designations.csv`. The expected
    headers are in each module's `seed.ts`.

Environment: `GRC_TIMEZONE` (IANA name; default is the machine's zone) and `GRC_CURRENCY`
(ISO code, default `USD`) set the organization's time zone and currency.

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
.\grc.ps1 ci         # local continuous integration: typecheck, tests, tests on UTC, web build
.\grc.ps1 backup     # verified copy of data/ in backups/<timestamp> (-Prune <n> keeps the newest n; -Encrypt)
.\grc.ps1 restore <backup|latest|file>   # verifies, keeps a safety copy, replaces data/
.\grc.ps1 status | logs | upgrade   # see docs/operations.md for these and the other operations commands
.\grc.ps1 version    # installed version and commit
.\grc.ps1 audit-deps # dependency advisories (fails only on a fixable high or critical one)
.\grc.ps1 secret-key show | rotate   # where the secret key comes from; a new key (restarts the server)
./grc.sh service install | remove | status | print   # macOS and Linux: a launchd or systemd user service
.\grc.ps1 npm <args> # any npm command with the portable Node
```

`.\grc.ps1` with no command prints the full list.

**Continuous integration is local first.** Run `.\grc.ps1 ci` before every commit and
push: it runs the typecheck, the tests (server and web) twice, the second time with the
clock on UTC, and the web build, and fails if any step fails. GitHub Actions
(`.github/workflows/ci.yml`) runs on every push and pull request: the typecheck, tests and
build on Windows and Linux with a non-blocking dependency audit (`npm audit`); the tests
through the PostgreSQL wire protocol (and, not yet blocking, on PostgreSQL 17); the
container build and smoke test; and the browser suite with the accessibility audit, which
fails only on a finding not already raised as an issue (see [Tests](#tests)).

The API description: `npx tsx server/src/core/openapi-cli.ts [file] [--unversioned]`
writes the whole OpenAPI document (every record type and route, paths under `/api/v1`;
`--unversioned` puts them under `/api`) to a file, or to standard output with no file. It
checks the document's structure first (`core/api/validate.ts`) and writes nothing when the
check fails. It builds an in-memory application, so it needs no running server.

The secret key: `npx tsx server/src/core/secretkey-cli.ts show` says where the key comes
from (with a fingerprint, never the key); `rotate`, with the server stopped, writes a new
key and keeps the old one as a retired key. See [Security](security.md).

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
| `GRC_TIMEZONE` | the machine's zone | Organization time zone (IANA name) |
| `GRC_CURRENCY` | `USD` | Organization currency (ISO code) |
| `GRC_SEARCH_LANGUAGE` | `english` | PostgreSQL text-search configuration used for full-text search |
| `GRC_ANALYZE` | off | `1` makes the web build report what each package weighs (`GRC_ANALYSE` is still accepted) |
| `GRC_JOBS` | on | `off` stops the job queue's poller in this process (jobs are still queued) |
| `GRC_JOBS_POLL_MS` | `10000` | How often the job queue looks for due work (at least 1000) |
| `GRC_LOG_LEVEL`, `GRC_LOG_DIR`, `GRC_LOG_CONSOLE` | `info`, `<data>/logs`, `text` | Server log: level, folder of the rotating `grc.log` (`off` = none), and what reaches the console (`text`, `json`, `off`); also `GRC_LOG_MAX_MB`, `GRC_LOG_FILES`, `GRC_LOG_REQUESTS` ([Operations](operations.md#logs)) |
| `GRC_PDF_FONTS` | system fonts | Font files for PDF text beyond Western European, separated by `;` (Windows) or `:`; `file.ttc#PostScriptName` picks one font of a collection; `none` switches it off. Unset: Noto, DejaVu, Arial Unicode, Segoe UI, Arial, Microsoft YaHei, Yu Gothic, Malgun or Nirmala, whichever the machine has ([Operations](operations.md#fonts-for-pdf-exports)) |

Security environment (all optional; see [Security](security.md)): `GRC_SECRET_KEY` (32
bytes as 64 hex characters or base64; encrypts authenticator keys and other stored
secrets), `GRC_SECRET_KEY_FILE` (a file holding it; by default a file **beside** the data
folder, named after it, `<data>.secret.key`, generated on first start), and
`GRC_SECRET_KEY_PREVIOUS` (retired keys, comma-separated). Passkeys:
`GRC_WEBAUTHN_RP_ID` (host name) and `GRC_WEBAUTHN_ORIGINS` (comma-separated origins),
both defaulting to the address of the request. Browsers refuse IP addresses for passkeys,
so open `http://localhost:<port>`, not `http://127.0.0.1:<port>`, when working on them.

Hosting environment (see [Installation](installation.md#server-installation) for every
variable): `GRC_DATABASE_URL` (or `GRC_DATABASE_URL_FILE`) uses a PostgreSQL server instead
of the embedded database, and `GRC_DATABASE_MIGRATE_URL` runs migrations as the database
owner so the server's own account can have row access only; `GRC_HOST` (default
`127.0.0.1`); `GRC_TLS_CERT` and `GRC_TLS_KEY` serve HTTPS, re-read every
`GRC_TLS_RELOAD_SECONDS` and on `SIGHUP`; `GRC_TRUST_PROXY` names the reverse proxies whose forwarded
headers are believed; `GRC_ALLOW_INSECURE=1` allows plain HTTP on a reachable address
behind a proxy that terminates HTTPS; `GRC_COOKIE_SECURE` (`off` | `auto` | `always`)
becomes `auto` by itself on HTTPS or behind a trusted proxy. In code, use `clientIp(req)`
and `isHttps(req)` from `core/request.ts` rather than `req.ip` and `req.protocol`.

### Settings

Administrators change these under Administration > Settings (`server/src/modules/admin/settings.ts`).
Read them in code with `ctx.settings.get(key, fallback)`, using the same fallback.

| Key | Default | Meaning |
|---|---|---|
| `app.name` | `Sandpiper GRC` | Name shown in the application |
| `pilot_mode` | `true` | Shows the "sample and test data only" notice |
| `features` | every area on except `portal` | Feature switches, one boolean per optional area (`core/features.ts`); changed under Administration > Features (needs a recent password confirmation). An area missing from the stored value takes its default |
| `auth.password_min_length` | `14` | Minimum password length (never below 12) |
| `auth.password_history` | `5` | Earlier passwords that may not be reused |
| `auth.idle_minutes` | `30` | Session idle time-out |
| `auth.mfa_required_for_all` | `false` | Second factor required for everyone |
| `auth.mfa_enforcement` | `notice` | `off`, `notice` or `required` |
| `auth.mfa_grace_days` | `0` | Days to enroll before enforcement |
| `auth.reauth_minutes` | `10` | How long a password confirmation lasts |
| `auth.passkey_sign_in` | `true` | A passkey alone may sign a person in |
| `auth.passkey_user_verification` | `preferred` | `preferred` or `required` (every passkey use checks a PIN or biometric) |
| `auth.local_signin` | `true` | Password sign-in; can be switched off only when a break-glass account exists and everyone else has a provider |
| `auth.public_url` | `''` | The https address people use, for the redirect address given to sign-in providers; empty = as requested |
| `tokens.max_days` | `365` | Longest life of a new personal access token |
| `tokens.rate_per_minute` | `600` | Requests a minute per token |
| `integrations.outbound_enabled` | `false` | Allows webhook deliveries at all |
| `integrations.allowed_hosts` | `[]` | Hosts webhooks may reach (`host`, `host:port`, `*.domain`) |
| `retention.audit_months` | `84` | Audit log retention, recorded for the retention schedule (nothing deletes audit events) |

Changing an `auth.*`, `tokens.*` or `integrations.*` setting needs a recent password
confirmation.

AI assistant access has its own settings, changed under Administration > AI assistant
access (`server/src/modules/mcp/settings.ts`), never on the general Settings screen and
never with a token:

| Key | Default | Meaning |
|---|---|---|
| `mcp.enabled` | `false` | The `/mcp` endpoint answers at all |
| `mcp.write_enabled` | `false` | Tools that create or change records are offered |
| `mcp.allowed_tools` | `null` (all) | Tool names offered |
| `mcp.rate_per_minute` | `120` | Requests a minute to `/mcp` per token |
| `mcp.allowed_origins` | `[]` | Browser origins allowed to call `/mcp` |
| `mcp.allowed_roles` | `null` (everyone) | Roles whose members may connect an assistant |
| `mcp.role_tools` | `{}` | Tool names offered per role |
| `mcp.oauth_enabled` | `false` | Remote connectors may sign in with OAuth |
| `mcp.oauth_registration` | `false` | Connectors may register themselves (dynamic client registration) |
| `feature_options` | `{}` | Options within areas (`OPTIONS` in `core/features.ts`): `{ <option>: { on, name } }`, for example the funder interest or the contract approval reference; changed under Administration > Features |
| `security.kit_every_days` | `7` | The offline incident kit is made as a PDF at least this often (and after any change to it) |
| `security.kit_keep` | `12` | PDF copies of the kit kept |
| `security.kit_recipients` | `[]` | People the automatic kit PDF is emailed to (each must hold `security.view` and `security.export` when it is sent) |
| `security.alerts` | no responders | Security incident alerts by email and text message (E09-25): `{ responders: [user ids], includeLead, email, text, declared, amber, red }`; changed under Notification deadlines > Alerts by email and text |

Modules keep their own settings too (for example
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
                              search, tags and watchers, custom fields, tokens, webhooks, OpenAPI, retention,
                              feature switches (features.ts)
server/src/core/migrations/   core SQL
server/src/core/identity/     single sign-on (OpenID Connect, SAML 2.0 and directory (LDAP)), account linking, sign-in policy hooks
server/src/core/webauthn/     passkeys and security keys
server/src/core/jobs/         the table-backed job queue (app.jobs)
server/src/core/mail/         outbound email, templates and set-up and reset links (app.sendMail)
server/src/core/export/       Excel and PDF exports, record fact sheets
server/src/core/import/       CSV and Excel import of any record type
server/src/core/api/          /api/v1 versioning, API conventions, route descriptions (docs/)
server/src/modules/<key>/     one folder per module: index.ts, migrations/*.sql, seed.ts, *.test.ts
server/src/ops/               operations commands: backup, restore, export, import, status
server/src/test/helpers.ts    testApp() - in-memory app with a signed-in admin
web/src/core/                 shell, design system, generic list/detail/form, api client (see web/src/core/README.md)
web/src/modules/<key>/        one folder per module: index.tsx (+ pages)
tools/                        install-node.ps1, browse.mjs, contrast.mjs, code-snapshot.mjs
tools/e2e/                    browser test runner and suites (npm run test:e2e)
tools/a11y/                   accessibility audit (npm run test:a11y)
tools/mcp-stdio.mjs           bridge for MCP clients that speak only stdio (docs/mcp.md)
tools/load/                   load test (seeds invented data, measures latency; docs/operations.md)
deploy/                       container health check, the secrets folder for compose.yaml, and
                              systemd and launchd examples (deploy/systemd, deploy/launchd)
Dockerfile, compose.yaml      container image and a compose file (docs/installation.md)
examples/                     invented organization profile, API token and webhook receiver examples
```

Modules are discovered automatically on both sides (directory scan on the server,
`import.meta.glob` on the web). **A module never edits files outside its own two folders.**
Folders starting with `_` are ignored.

## Server conventions

TypeScript ESM, run by `tsx`. Relative imports carry the `.ts` extension. No enums.

Dates: build "today" with `dayInZone(offsetDays)` (or `todayInZone()`) from
`core/timezone.ts`, never from the machine's clock or UTC (`new Date().getDate()`,
`toISOString().slice(0, 10)`): those differ from the organization's date for part of
every day, and tests then fail at some hours or on a machine set to UTC.

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
  async seed(ctx, opts) { ... },      // `grc.ps1 seed`; opts = { profile: 'pilot' | 'dev', seedDir, organization }
};
export default mod;
```

`ctx` (`ModuleContext`, see `core/module.ts`):

- `ctx.app` - the Fastify instance. `req.user` is the signed-in user (all `/api` routes
  require a session or a token unless registered with `config: { public: true }`).
  `req.apiToken` is `{ id, name }` when the request was made with a personal access token,
  otherwise `null`.
- `ctx.db.query<T>(sql, params) => T[]`, `ctx.db.one<T>(sql, params) => T | undefined`,
  `ctx.db.tx(async (tx) => ...)`. Parameterized queries only (`$1`, `$2`).
- `ctx.dataDir` - the folder holding the database and stored files, or `memory` in tests.
- `ctx.requirePerm('tickets.edit')` - preHandler. `ctx.can(user, perm)` - boolean. The role editor greys
  out permissions nothing checks (`GET /api/admin/permissions/checked`, `core/permission-use.ts`):
  it collects `requirePerm` calls, the `permission` of every route description and the record-type
  actions, so a hand-written route that checks with `ctx.can` must name that permission in its
  description; a check made only inside a record type's hook goes in `HOOK_CHECKS` there
  (`permission-use.test.ts` scans the source and fails when one is missing).
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
  **Figures are the same for everyone** (see [Security](security.md)): a summary query that
  counts or totals records counts every record and does **not** use `visibleWhere`. When it
  groups by words or people (text, long-text, JSON and person fields), group restricted rows
  under `MASKED_SQL` from `core/resource.ts` instead of their value, and never match a
  restricted row by such a field. Lists, their totals and drill-downs keep `visibleWhere`.
- `ctx.readSeed(opts, 'systems.psv', '|')` - parses a delimited seed file into objects keyed by header.
  `opts.organization` is the organization profile (`{}` when there is none).
- `ctx.fail(status, code, message, fields?)` - throws an API error.
- `ctx.describeRoute({ method, path, summary, permission?, public?, query?, body?, response? })`
  (also `description` and `tag`) describes a hand-written route for
  `GET /api/openapi.json`. Call it beside the route, or describe the route in
  `server/src/core/api/docs/<module>.ts`. **Every route must be described**:
  `server/src/core/api/coverage.test.ts` fails for a route that is not. A route with a
  `permission` is left out of the document for callers who lack it.

Services other modules may offer are Fastify decorators; check before use:

- `app.notify(...)`: in-app notifications (notifications module;
  `if (ctx.app.hasDecorator('notify')) ...`). For reminders pass `oncePerDay: true` (at
  most once per person, record and kind each organization day) or `once: '<key>'` (at most
  once per person ever, for example `'obligation.due:<id>:<date>'`). A reminder's lead time
  is a setting read with `ctx.settings.get(key, fallback)`; add it to the list in
  `modules/notifications/reminder-settings.ts` so administrators can change it under
  Administration > Reminders.
- `app.jobs` (`core/jobs`): the table-backed job queue. `app.jobs.register(type, handler,
  opts?)` in `register()`, then `await app.jobs.enqueue(type, payload?, { key?, runAt?,
  delayMs?, maxAttempts? })` (a second job with the same `key` while one waits is skipped)
  and `app.jobs.schedule(name, { type, every })` for recurring work. For a module's
  recurring work use `await scheduleWork(ctx, '<module>.<work>', () => run(), { every,
  firstRunInMs? })` (`core/jobs`), never `setInterval`: it registers the handler and a
  schedule of the same name. A handler may report progress with `job.progress(value)`
  (shown as the job's result while it runs). A handler throws to
  fail and is retried with back-off; `PermanentJobError` stops the retries, and
  `RetryLaterError(message, seconds | date)` asks for the next attempt no sooner than then (at
  least one second, at most six hours; it still counts as an attempt). Administrators
  see the queue under Background jobs. The poller starts when the server listens (never
  under tests, which call `app.jobs.runDue()`); `GRC_JOBS=off` keeps it stopped.
- `app.sendMail({ userIds, template, purpose, data, record?, attachments? })` and
  `app.mailEnabled()` (`core/mail`): email through the job queue. Off until an
  administrator sets up a mail server (Administration > Email), so always guard with
  `ctx.app.hasDecorator('sendMail')`. `requirePermission: 'security.view'` drops a user
  recipient who no longer holds it when the message is sent.
- `app.sendText({ userIds, text, purpose, permission? })` (`core/mail/texts.ts`): short text
  messages to people's email-to-text address or mobile number (through the administrator's
  text-message webhook), each a row of the delivery log. Never put restricted detail in `text`.
  Guard with `ctx.app.hasDecorator('sendText')`.

Core starts the job queue and email in `app.ts` before any module registers, so both exist
whichever modules are loaded (`ensureJobs` and `ensureMail` are safe to call again).

### Migrations

`server/src/modules/<key>/migrations/001_name.sql`, applied in file-name order, core first
then modules alphabetically, tracked in `schema_migrations`. Never edit an applied migration
in a way that matters after pilot; during prototyping it is fine to edit and delete `data/`.
A checksum of each applied migration is recorded: start-up and `status` warn when an applied
migration has changed, and continuous integration compares migrations with the last release
tag (`v*`). Never edit a released migration; add a new one.
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
update and soft-delete routes with permission checks, validation, audit, export (CSV,
Excel and PDF), a PDF fact sheet and import.

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

Hooks write through `ctx.db` as usual. The import check (dry run) runs the real create and
update, hooks included, inside `ctx.db.trial(fn)` (`core/db.ts`, E13-22): a transaction that is
always rolled back, into which every query on the shared handle made by that work is routed (on
the embedded database a query on the outer handle would otherwise wait for ever). Record-change
listeners, webhook deliveries and the job queue do nothing inside a trial (`inTrial()`); a hook
with effects outside the database (a file, an outside call) checks `inTrial()` too. To raise a
webhook event that is not a record change, add it to `WEBHOOK_EVENTS` in `core/webhooks.ts`
and call `emitWebhookEvent(ctx.app, { event, data, record?, req? })`.

Field types: `text`, `longtext`, `number`, `currency`, `date`, `datetime`, `boolean`,
`lookup` (needs `list`), `user`, `ref` (needs `to`), `json`. Field names are column names.

`personal: true | false` on a field says whether it holds personal data, which anonymizing a
record at the end of its retention period replaces (E14-19, `core/retention.ts`): text with
"Removed at the end of the retention period", people and other values with `null` (a
required person field is kept and named in the audit entry). Default: `user` and `longtext`
fields, and `text` fields named like an email address, phone number or person's name
(`*email*`, `*phone*`, `*mobile*`, `*_name` except names such as `vendor_name` or
`host_name`); everything else is not personal. Set `personal: false` on a long-text field
that never names anyone (a technical description) and `personal: true` on any other field
that may. Anonymizing also covers long-text and person custom fields, `created_by` and
`updated_by`, the record's comments, files, watchers and notifications, and the search
index; it never changes the audit log, which is append-only by design.

Custom fields that an administrator defines (Administration > Custom fields,
`core/customfields.ts`) appear beside the built-in fields as `cf_<key>`, marked
`custom: true` in `/api/meta`, and are accepted by the generated routes like any other
field.

`evidence: true` on a definition makes its record page's file tab an **Evidence files** tab and
records new files there as evidence (`evidence: false` turns it off). The default list is
`EVIDENCE_TYPES` in `core/resource.ts`.

Generated routes:

| Route | Notes |
|---|---|
| `GET {path}` | `q`, `sort`, `dir`, `page`, `pageSize` (max 500), filters `f.<field>=a,b` (any of), `f.<field>.gt=`, `.lt=`, `.null=true\|false`; tags `f.tags=a,b` (any of), `f.tags.all=a,b` (every one), `f.tags.null=true` (untagged); `format=csv\|xlsx\|pdf` exports every matching row (needs `<module>.export`), with `columns=a,b` choosing the columns. `q` is a full-text search, best matches first when no sort is chosen. Returns `{ rows, total, page, pageSize }`. Each row carries `_display: { <field>: label }` for `user`, `ref` and `lookup` fields, and `_tags` |
| `GET {path}/stats?group=<field>` | Same filters. `{ groups: [{ value, label, color, count }], total }` |
| `GET {path}/:id` | One row (with `_display`) |
| `POST {path}` | Create. 400 with `error.fields` on validation failure |
| `PATCH {path}/:id` | Partial update |
| `DELETE {path}/:id` | Soft delete |

### Cross-cutting API (core)

| Route | Purpose |
|---|---|
| `GET /api/health` | `{ ok: true }` (public) |
| `GET /api/auth/state` | `{ appName, timeZone, currency, setupRequired, user, permissions, features, areasOff, pilot, mfa... }` (public) |
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
| `/api/views...` | List views shared with everyone who can see the list (audited) |
| `GET /api/version` | The installed version (signed in) |
| `/api/me/tokens`, `/api/admin/tokens` | Personal access tokens |
| `/api/admin/webhooks...` | Webhooks and their deliveries |
| `/api/admin/custom-fields...`, `/api/admin/retention...` | Custom fields; retention schedule and reviews |
| `GET /api/records/:type/:id/pdf` | A record's PDF fact sheet (needs `<module>.export`) |
| `/api/import/:type...`, `GET /api/import/history` | Import from CSV or Excel: fields, template, read (check), run; creating needs `<module>.create`, updating `<module>.edit` |
| `/mcp` | The MCP endpoint for AI assistants (tokens with the `mcp.use` scope only; see [AI assistant access](mcp.md)) |
| `/.well-known/oauth-*`, `/oauth/*` | OAuth 2.1 for remote MCP connectors (off by default; [AI assistant access](mcp.md)) |

**Versioning.** Every `/api/...` route is also served at `/api/v1/...`
(`core/api/versioning.ts`), the stable base path for integrators; the web application
keeps using `/api`. See the [integration guide](api.md).

**Conventions** (`core/api/conventions.ts`, applied centrally to generated routes):
`ETag` on one record, and `If-Match` on a `PATCH` or `DELETE` refused with 409
`version_conflict` when the record has changed; `Idempotency-Key` on a create replays the
first answer for 24 hours; list answers carry `Link` and `X-Total-Count`; requests made
with a token carry `RateLimit-*` headers; every answer carries `X-Request-Id`, which is
recorded on audit events as `request_id`.

Errors: `{ error: { code, message, fields? } }` with a matching HTTP status.

Authentication: a browser session (cookie `grc_session`), on which every mutating request
must carry the header `X-GRC-CSRF: 1` (the web api client adds it); or a personal access
token, `Authorization: Bearer grc_pat_...`, which needs no `X-GRC-CSRF` header and never
falls back to the cookie. A token acts as its owner, limited to its scopes, cannot reach
the sign-in, account-security or token routes, and cannot pass a password confirmation.
See `examples/api-token.ps1`. Besides permissions, a token may carry a scope family that
is not a permission (`SCOPE_FAMILIES` in `core/tokens.ts`): today only `mcp.use`, which
lets it be used at `/mcp`.

### Permissions

Strings of the form `<module>.<action>`; actions: `view`, `create`, `edit`, `delete`,
`approve`, `administer`, `export`. Role grants may use wildcards (`tickets.*`, `*`).
Module keys (fixed, `MODULE_KEYS` in `server/src/modules/admin/shared.ts`): `tickets`,
`knowledge`, `assets`, `systems`, `sites`, `data`, `changes`, `vendors`, `contracts`,
`frameworks`, `risks`, `security`, `vulnerabilities`, `policies`, `training`,
`exceptions`, `obligations`, `exercises`, `actions`, `projects`, `dashboards`, `reports`,
`audit`, `admin`, `portal`, `fleet`, `safety`. A new key is added there and here.

Default roles (`server/src/core/services.ts`): Administrator, Agent, Security lead,
Project manager and Safety manager are enabled; Approver, Executive viewer, Auditor and
Requester are present but switched off until an administrator enables them.

Restricted records (security incidents, risks, vulnerabilities, anything flagged) are
invisible without `security.view` in lists, counts, search, links, exports and stats.
`defineResource` enforces this; hand-written routes must too
(`ctx.resources.find(type, id, req.user)` for one record,
`ctx.resources.visibleWhere(type, req.user)` in SQL). Actions are `restricted: 'flag'`
and inherit the flag from their source record. Sensitive administrative routes call
`sensitive(ctx, req, what)` (`modules/admin/shared.ts`), which needs a recent password
confirmation (`POST /api/auth/confirm`).

### Feature switches (optional areas)

Administrators switch optional parts of the application on and off under Administration >
Features (`modules/admin/features.ts`, setting `features`). What each part covers is declared
once, in `AREAS` in `server/src/core/features.ts`:

```ts
{ key: 'fleet', label: 'Fleet and services', defaultOn: true, description: '...',
  permissions: ['fleet'],      // permission modules nobody holds while off (`*` included)
  types: [],                   // extra record types to hide (when their permission module is shared)
  modules: ['fleet'],          // server module folders whose routes answer 404 `switched_off`
  jobs: ['fleet.'],            // job type prefixes that are skipped while off
  lookupValues: {},            // values of shared lists that belong to it: { action_source: ['safety'] }
  fields: {},                  // fields of types that stay on that are about it: { system: ['vendor_name'] }
  lists: [],                   // its public lists it does not own by permission module
  requires: [] }               // areas that must be on for this one (the portal needs tickets)
```

While an area is off, core makes it behave as if its module were not installed, with no
work in the module: `can()` answers false for its permissions (users carry `off`, set by
`loadUser`; `ctx.can` also applies it to users built by hand), so `/api/auth/state`,
menus and permission-checked routes follow; `ctx.resources.get(type)` answers undefined and
`all()` leaves its types out, so metadata, search, links, the report catalog, imports,
custom fields, retention, webhooks, OpenAPI and MCP tools drop them; its module's routes
(tagged with the module that registered them) and its types' generated routes answer 404
`switched_off`, as does a core route asked about one of its types (`:type`, `type`,
`record_type`, `from_type`, `to_type`); and the job queue skips its job types. The state is
cached for five seconds and refreshed at once when the setting is written, so no restart is
needed. The web app reads `features` and `areasOff` from `/api/auth/state`: `can()`
answers false for an off permission, `areaOn(key)` says whether an area is on, and
`MODULE_AREA` in `web/src/core/module.ts` drops a whole web module's menu entries, Create
entries and pages (the pages show "switched off").

An off area is shown nowhere but its switch (E14-34). Besides the above, core hides the fields of
types that stay on that `ref` an off type or that the area lists in `fields` (kept in storage,
like an option's fields); `/api/meta` and `/api/lookups` leave out its lists (owned by an off
permission module, used only by off types, or named in `lists`) and its `lookupValues`
(`visibleValues(state, list, values)` for a hand-written list); notifications about its types or
leading to its pages are not listed or counted (`app.switchedOffTypes()`,
`app.switchedOffPaths()`); notification kinds, MCP tools (`installedTools`), job schedules and
retention categories follow. On the web, text that names parts of the application is written
from `areaOn` or from the fields `/api/meta` gives, never as a fixed list. The browser suite
`09-features-off` switches every area off (and then the portal, fleet and safety) and fails on
any link, label, text, drop-down option or server answer that still names one.

A new module that is optional adds itself to `AREAS` (and to `MODULE_AREA` on the web, and
`PAGE_AREA` in `web/src/modules/help/areas.ts` for its guide page). Guard cross-module code
with `ctx.resources.get(type)` and permission checks as usual, and it follows the switch.
Inventory, actions, notifications, attachments, administration, home and help are not
areas: they are always on.

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
`$env:GRC_TEST_DATABASE='pg'; npm test` runs the suite through the PostgreSQL server
driver (over the wire protocol) instead of the embedded database.

Component tests (E18-43) render the generic list, form and record page in a browser-like document:
name the file `*.component.test.ts`, put `// @vitest-environment happy-dom` (the `happy-dom`
development package) on its first line, and use `render`, `waitFor`, `click` and `typeInto` from
`web/src/core/componentHarness.tsx`, which wraps the component in the application's providers
and answers `fetch` from handlers the test gives, recording every call (see
`ResourceList.component.test.ts`). The files are `.ts` (`createElement`), so the test runner's
include pattern finds them.

The test commands:

- `npm test` (or `.\grc.ps1 test`): server and web unit tests. `.\grc.ps1 ci` runs them
  twice, the second time with the clock on UTC.
- `npm run test:e2e`: the browser suite (`tools/e2e/suites`). It builds the web app (or
  serves the build in `E2E_WEB_DIST`), starts a throw-away instance and drives a real
  browser through every route, every role, every record type, the hand-written dialogs and
  the keyboard, module by module, and every page with the optional parts switched off (suites
  `01-smoke` to `09-features-off`). Options
  after `--`: `--only smoke,roles` (some suites), `--grep ticket` (tests whose name
  contains it), `--headed` (show the browser), `--keep` (keep the scratch data folder).
  Logs and screenshots go to `tools/e2e/out`. `node tools/e2e/serve.mjs` keeps an
  instance running, and `E2E_BASE` points the tests at it; `E2E_BROWSER` picks the
  browser and `E2E_PORT` the port.
- `npm run test:a11y`: the accessibility audit. It runs axe-core (WCAG 2.1 A and AA) on
  every route, in light and dark at 1440 and 820 pixels wide (`--quick`: light at 1440
  only; `--routes /a,/b`; `--no-fail`), and writes `tools/a11y/out/report.md`. It fails
  on any serious or critical finding that is not listed, with its roadmap issue, in
  `tools/a11y/known.json`; remove an entry once its issue is fixed (the report lists stale
  entries). See [Accessibility](accessibility.md).

GitHub Actions runs the typecheck, tests and build on Windows and Linux, the tests through
the PostgreSQL wire protocol, the container build and smoke test, and the browser suite
followed by the accessibility audit, which fails the build on a finding not yet raised as
an issue in `tools/a11y/known.json`.

### Actions (shared contract)

The `action` record type (module folder `risks`, API `/api/actions`) is the one cross-module
to-do list. Fields: `title`, `description`, `status` (`action_status`: open, in_progress,
blocked, done, canceled), `priority` (`action_priority`: high, medium, low), `owner_id`,
`due_on`, `source` (`action_source`: risk, assessment, incident, audit, exercise,
information_request, project, change, vulnerability, policy, training, vendor, problem,
other), `source_type` + `source_id` (the record it arose
from), `department`, `notes`, `restricted` (read-only: true when the source record is
restricted; such actions are hidden without `security.view`). Any module may create one with
`ctx.resources.create('action', {...})` after checking `ctx.resources.get('action')`.
Always pass `source_type` and `source_id` so the restriction is inherited.

### Approval workflows (shared engine)

The `workflows` module (E14-06) runs administrator-defined approval workflows on any record
type: ordered steps, each approved by named people, a role, a person field of the record or a
department head, with a quorum (`any`, `all` or a number), optional conditions on the record's
fields, a due time and escalation; started on create, when a lookup field changes to a value, or
by hand; at the end it sets fields (`on_approve`, `on_reject`). The rules are plain functions in
`modules/workflows/engine.ts`; `service.ts` stores, notifies and escalates (job type
`workflows.escalate` at a step's due time, and the sweep `workflows.escalations` every 15
minutes). It is always on (not a feature area) and needs no permission key of its own: defining
workflows needs `admin.administer`; deciding needs only to be a named approver who may see the
record. It follows each record type's area: a switched-off type is skipped everywhere.

How it sees record changes: once every module has defined its types (`onReady`), it wraps each
type's `afterCreate` and `afterUpdate` hooks; the module's own hook runs first, and a workflow
failure never fails the change. Changes the engine makes itself (outcomes) start nothing.

A module that wants to move its own approval rules onto the engine:

1. Keep its fields (status, approver, approval date) and have the workflow's outcome set them
   (`approver`, `requester` and `today` are special outcome values). An administrator defines the
   workflow, or the module offers a ready-made one in `seedDefaults` (insert into
   `workflow_definitions` only when that table exists and no definition of the same name does).
2. Start it from the module's own route with `app.workflows.start(definitionRow, def, record,
   requesterId, req, note)` (guard with `app.hasDecorator('workflows')`), or let a status change
   start it.
3. Drop its own approve and reject buttons: `RecordPage` shows the approval panel by itself, and
   `GET /api/workflows/records/:type/:id` gives the state.
4. Keep its old approval tables readable for history, and point integrators from its own webhook
   event to `workflow.decided` and `workflow.finished`.

The follow-up issues per module are listed under E14-06 in the roadmap.

Risk scales: the two built-in scale keys are `cyber_5x5` and `hazard_4x5` (the safety
hazard matrix: four severity levels by five likelihood levels; it was `asp` before
migration `risks/002`).

## Web conventions

React 19 + React Router + Vite, TypeScript, plain CSS with design tokens
(`web/src/core/tokens.css`), ECharts for charts. The component library is Mantine 9,
wrapped by the core design system: import from `'../../core'` first, and use
`@mantine/core` directly only for layouts the core does not cover. See
`web/src/core/README.md` for the component catalog.

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

Nav groups, in order (`web/src/core/module.ts`): Home, Service desk, Inventory, Change,
Vendors, Cybersecurity, Safety, Projects, Reports, Administration, Help.

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
| `fleet` | `vehicle` → vehicles, `service` → services |
| `safety` | `hazard` → hazards, `safety_event` → safety_events (flag), `safety_indicator` → safety_indicators |
| `reports` | `report_definition` → report_definitions, `dashboard` → dashboards, `report_schedule` → report_schedules, `report_pack` → report_packs |
| `attachments` | no record type: files on any record (table `attachments`; `AttachmentsPanel`; stored in `<data>/files`) |
| `portal` | no record type: the self-service portal's settings and pages (portal requests are tickets, scoped to their requester) |
| `mcp` | no record type: the `/mcp` endpoint for AI assistants and its settings |
| `notifications` | no record type: in-app notifications (tables `notifications`, `notification_preferences`; `app.notify(...)`, `NotificationBell`) |
| `admin` | users, roles, second factor, audit viewer, lookups, settings, custom fields, tokens, webhooks, retention screens |
| `workflows` | no record type: approval workflows (tables `workflow_definitions`, `workflow_instances`, `workflow_steps`, `workflow_decisions`, `workflow_department_heads`; `/api/workflows`; the record page's approval panel `WorkflowPanel`) |
| `home` | the Overview page (web only) |
| `help` | the user guide, rendered from `docs/user/*.md` (web only) |

Permission module per type: ticket, problem, catalog_item → `tickets`; knowledge_article →
`knowledge`; system → `systems`; asset → `assets`; site → `sites`; data_category → `data`;
change → `changes`; vendor, evidence_item → `vendors`; contract → `contracts`; framework,
framework_outcome, assessment_snapshot → `frameworks`; risk → `risks`; action →
`actions`; obligation → `obligations`; security_incident, notification_task → `security`;
policy → `policies`; policy_exception → `exceptions`; course → `training`; exercise →
`exercises`; vulnerability → `vulnerabilities`; project → `projects`; report_definition,
report_schedule, report_pack → `reports`; dashboard → `dashboards`; vehicle, service →
`fleet`; hazard, safety_event, safety_indicator → `safety`.

Not yet built: approval workflows that branch or run steps side by side (they are ordered steps). See [Known gaps](known-gaps.md) and the
[roadmap](roadmap/README.md).

## Known gaps

Kept in [`docs/known-gaps.md`](known-gaps.md). Update it with every change.
