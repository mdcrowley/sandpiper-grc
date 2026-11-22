# Architecture

How the application is put together, and why. The [developer guide](development.md) is the detailed
reference for conventions and the API (module shape, `defineResource`, generated and core
routes, permissions, record types); this document explains the design and links there
rather than repeating its tables.

## The stack and why

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript on both sides, ES modules | One language; shared habits |
| Server runtime | Node.js 24, portable copy in `.tools\node` | Runs with no installer and no administrator rights |
| Running TypeScript | `tsx` | No server build step; `tsx watch` restarts on change in development |
| HTTP | Fastify, with `@fastify/cookie` and `@fastify/static` | Small, fast, hooks for cross-cutting checks |
| Database | PGlite: PostgreSQL compiled to WebAssembly, embedded in the process | Real PostgreSQL SQL with nothing to install. Moving to a server is a change to one file |
| Password hashing | `@node-rs/argon2` | Argon2id |
| Web | React 19, React Router, Vite | Familiar, quick builds |
| Components and styling | Mantine 9, wrapped by the core design system, plus plain CSS with design tokens (`web/src/core/tokens.css`) | Accessible components (focus traps, keyboard menus) without writing them; modules import from the core, so the library can be swapped in one place |
| Charts | ECharts | Covers the heat map and dashboard charts |
| Tests | Vitest; a browser suite and an axe-core audit driving a real browser (`tools/e2e`, `tools/a11y`) | Vitest runs the server in memory, quickly; the browser suite checks the screens end to end |

There is no ORM: SQL is written by hand with parameters. Background work goes through a
table-backed job queue (`server/src/core/jobs`, `app.jobs`): jobs are rows that a poller
claims with a lease, so two processes on one database never run the same job and a job
whose process died is taken up again; failures are retried with back-off, or after the time a
handler asks for (`RetryLaterError`, for example a mail service's `Retry-After`). Job types run
in lanes: each lane works through its own due jobs alongside the others, and `mail.send` has a
lane of its own, so a mail server that does not answer never holds up alerts, timers or
schedules. A handler that cannot try yet (sending paused while the mail server is down) throws
`DeferJobError`, which puts the job back without using up an attempt. Email, the
notification digests and every module's scheduled work (the service-level sweep, the
notification clocks, reminders, report schedules, the file purge, the backup schedule)
run there as schedules, registered with one call (`scheduleWork`), so each runs once
however many processes share the database. Long administrative work, such as scanning
earlier files or moving files between stores, runs as a job that reports its progress.
`app.ts` starts the queue and email itself, before any module, and schedules core's own work
there too: the daily retention check and webhook deliveries (every minute, and at once when a
delivery is queued). Webhook deliveries are rows in their own table, so a restart loses none.

## Layers

```
 Browser
 ┌────────────────────────────────────────────────────────────┐
 │ web/src/modules/<key>/   screens for one module            │
 │ web/src/core/            shell, generic list/detail/form,  │
 │                          API client, design system         │
 └──────────────────────────────┬─────────────────────────────┘
                                │ HTTP or HTTPS (JSON, session cookie)
 One Node.js process            ▼
 ┌────────────────────────────────────────────────────────────┐
 │ Fastify hooks: session, CSRF header, security headers      │
 ├────────────────────────────────────────────────────────────┤
 │ server/src/modules/<key>/  routes, rules, migrations, seed │
 ├────────────────────────────────────────────────────────────┤
 │ server/src/core/  resource engine, auth, permissions,      │
 │                   audit, lookups, settings, links,         │
 │                   comments, search, migrations             │
 ├────────────────────────────────────────────────────────────┤
 │ core/db.ts  the only file that knows which database runs   │
 └──────────────────────────────┬─────────────────────────────┘
                                ▼
        data/pg (embedded PGlite) or a PostgreSQL server
```

## Process model

- **One process.** `server/src/main.ts` calls `buildApp()` in `server/src/app.ts`, listens
  (on `127.0.0.1` unless configured otherwise; see Hosting below), and serves both the API
  (`/api/...`) and the built web application (`dist/web`, with a fallback to `index.html`
  for client-side routes). The hashed bundles under `/assets` are compressed (Brotli or gzip,
  once, kept in memory) and cached by browsers for a year; `index.html` is revalidated on
  every load (`core/webassets.ts`).
- **Embedded database** (the default). PGlite runs inside that process and allows one process per data
  folder. The server and every command that opens the database take `data/grc.lock` first
  (`core/datalock.ts`: created exclusively, with process id, host and a heartbeat, so a second
  process on the same folder, even from another container on a shared volume, stops before it
  opens or migrates anything). That is why `server/src/cli.ts` (the `seed` and `migrate` commands) refuses to
  run while the server runs, and why `grc.ps1` stops the server around `seed` and
  `backup`. `grc.ps1` exposes `seed`; `migrate` is available only through
  `npm run cli`.
- **Start-up order.** Open the database; discover modules; apply migrations; ensure the
  default roles; register core services and routes; then for every module run
  `seedDefaults` (idempotent defaults such as lookup values) and `register` (routes).
- **Shutdown.** `main.ts` closes Fastify and then the database on `SIGINT`, `SIGTERM`,
  `SIGBREAK`, or when `data/grc.stop` appears (the mechanism `grc.ps1 stop` uses, since
  Windows cannot send a terminate signal to a background process).
- **Development.** `grc.ps1 dev` runs the API under `tsx watch` and the Vite development
  server on port 5173, which proxies `/api` to port 8080.

## Request lifecycle

For every request under `/api/` (see `registerAuth` in `server/src/core/auth.ts`):

1. **Session or token.** With an `Authorization: Bearer` header, the personal access
   token is hashed and looked up (`server/src/core/tokens.ts`); the owner is loaded and
   given only the permissions the token's scopes and the owner's grants have in common,
   and `req.apiToken` names the token. Otherwise the `grc_session` cookie is hashed and
   looked up. If the session exists, has not expired and has not been idle too long, the
   user is loaded with their roles and permissions, and attached as `req.user`. A
   disabled user or a disabled role stops counting immediately, because this happens on
   every request.
2. **CSRF header.** For a session, any method other than `GET`, `HEAD` or `OPTIONS` must
   carry the header `X-GRC-CSRF: 1`, or the request is refused with 403. The web API
   client adds it. Token requests need no header, but are refused on sign-in,
   account-security and token-management routes.
3. **Authentication.** With no user, the request is refused with 401 unless the route was
   registered with `config: { public: true }` (health, auth state, setup, sign-in,
   sign-out, one-time links).
4. **Permission.** The route checks a permission: `requirePerm('<module>.<action>')` on
   hand-written routes, or the built-in check in generated resource routes.
5. **Handler.** Validation, the database work, then an **audit event** for every change.
6. **Response.** Security headers are added to every response. Errors have the shape
   `{ error: { code, message, fields? } }`; unexpected errors are logged and returned as a
   generic 500.

## The module system

A module is one folder on each side, with the same name:

```
server/src/modules/<key>/   index.ts, migrations/*.sql, seed.ts, *.test.ts
web/src/modules/<key>/      index.tsx and its pages
```

- **Server discovery.** `buildApp()` scans `server/src/modules` for folders that contain
  `index.ts`, skips names starting with `_`, sorts them, and imports each default export
  (a `ModuleDef` with optional `seedDefaults`, `register` and `seed`).
- **Web discovery.** `web/src/core/module.ts` uses `import.meta.glob` over
  `web/src/modules/*/index.tsx`, again skipping `_` folders. Each default export supplies
  navigation entries, routes, "create" menu entries and optional public routes.
- **Isolation.** A module does not edit files outside its two folders. It reaches
  everything else through `ctx` (`ModuleContext` in `server/src/core/module.ts`):
  database, permissions, audit, lookups, settings, the resource registry.
- **Cross-module use.** Another module may not be loaded (see `GRC_MODULES`), so code
  guards with `ctx.resources.get('<type>')` before using another module's record type, and
  writes through `ctx.resources.create` / `update` rather than raw SQL.

A web-only module is possible (the `home` dashboards and the `help` pages have no server
folder).

The current modules and the record types they own are listed in
[the developer guide](development.md#record-types-and-owners).

## The generic resource engine

Most record types are declared, not coded. `ctx.defineResource(def)`
(`server/src/core/resource.ts`) takes a description of a record type (table, fields,
permission module, title field, optional auto-number) and provides:

- **Routes**: list, stats, get one, create, partial update, soft delete. The table of
  routes and query parameters is in [the developer guide](development.md#resources-generic-crud).
- **Permission checks**: `<module>.view`, `.create`, `.edit`, `.delete`, `.export`.
- **Validation** by field type (text, number, date, lookup, reference and so on). Lookup
  values must be active values of the named list. Failures return 400 with a message per
  field. `readOnly` fields can be set only by system code.
- **Filters, search, sort and paging** on the list route, built from declared fields only;
  field names are checked against an identifier pattern before they reach SQL.
- **CSV export** (`format=csv`), limited to 50,000 rows (the file and the
  `X-GRC-Export-Truncated` header say when it was cut), audited, with cells that start
  with a formula character neutralized.
- **`_display` labels.** Each row carries `_display: { field: label }` for user, reference
  and lookup fields, so the web never has to resolve identifiers itself.
- **Auto-numbering** such as `TKT-00001`, from the `counters` table.
- **Audit**: create, update (changed fields only, with before and after), delete, export.
- **Hooks**: `beforeCreate`, `beforeUpdate`, `afterCreate`, `afterUpdate` for module rules.
- **Restricted records.** `restricted: true` makes the whole type need `security.view` as
  well as the module permission. `restricted: 'flag'` hides only rows whose `restricted`
  column is true. The engine applies this to lists (and their totals), single reads, exports,
  search, record pickers, links and `_display` labels (a hidden reference shows as
  "Restricted"). The stats route counts every record ("Figures are the same for everyone" in [Security](security.md#figures-are-the-same-for-everyone)).

- **Custom fields** (`server/src/core/customfields.ts`, `customfield-routes.ts`). An
  administrator adds fields to any record type (text, long text, number, currency, date,
  checkbox, single or multiple choice from a configurable list, user, record link), with
  required, section, help and active. Values live in one `custom` JSON column that the
  engine adds to the table when the first field is defined. They appear in rows and in
  `/api/meta` as `cf_<key>` in the same shape as built-in fields, marked `custom: true`,
  so the generic web pages need no special case. They are validated, audited field by
  field, exported, and can be filtered, sorted and grouped (multiple choice: filtered
  only). Switching a field off hides it and keeps its data.
- **Full-text search** (`server/src/core/search.ts`). At start-up the engine generates,
  per record type, a trigger that keeps one row per record in `search_index` (title and
  reference weighted highest, then `searchable` fields, then text custom fields), in the
  language configuration (`GRC_SEARCH_LANGUAGE`, default `english`) and in `simple`. The
  list `q` and `/api/search` use it: ranked, the last word matched as a prefix, an exact
  reference number boosted to the top, snippets with matches marked; comments and
  attachment file names find their record. Queries under three characters, and types that
  cannot be indexed, use substring matching as before. Because it is a trigger, rows
  written by raw SQL are indexed too. A trigger is rebuilt only when its definition
  changes. The index row also keeps the text matched by part of a word in
  `search_index.body`, with a trigram (`pg_trgm`) index (migration 009; the embedded driver
  loads `pg_trgm`, and on a PostgreSQL server the owner must be allowed to create it, or
  part-of-a-word matching works without the index). Lists find their page on ids first and
  take the exact total from the same statement; the embedded database refreshes its
  planner statistics itself (`GRC_ANALYZE_AFTER_WRITES`).
- **Tags and watchers** (`server/src/core/tags.ts`) on any record, following the record's
  permissions. Tags filter lists (`f.tags=a,b`, `f.tags.all=`, `f.tags.null=`) and travel
  in rows as `_tags`. Watchers are told about comments and status changes through the
  notifications module when it is loaded.
- **Change events.** `create`, `update`, soft delete and purge are published to
  listeners inside the engine (`res.onChange`), which webhooks and watchers use. A failing
  listener never fails the change.

The registry (`ctx.resources`) also gives modules `find`, `create`, `update` and
`labelFor` for any registered type. On the web, `web/src/core` has matching generic list,
form and record pages driven by `/api/meta`, which describes every record type the user
may see.

Routes that do not fit the pattern are ordinary Fastify routes in the module's `register`.
They must apply the same permission, restriction and audit rules themselves, and may
describe themselves for the API document with `ctx.describeRoute({ method, path,
summary, permission, query, body, response })`.

## Platform services in core

Beside the resource engine, `server/src/core/` holds services every module shares. Each
is one file with its routes and its tests in `server/src/core/platform.test.ts`; their
tables are created by `server/src/core/migrations/003_platform_services.sql`.

| Service | File | Routes |
|---|---|---|
| Personal access tokens | `tokens.ts` | `/api/me/tokens`, `/api/admin/tokens` |
| OpenAPI 3.1 document | `openapi.ts`, `apidocs.ts`, `openapi-cli.ts` | `GET /api/openapi.json` |
| Outbound webhooks | `webhooks.ts` | `/api/admin/webhooks...`, `/api/admin/webhook-deliveries/:id/retry` |
| Full-text search | `search.ts` (used by `resource.ts`, `routes.ts`) | list `q`, `GET /api/search` |
| Custom fields | `customfields.ts`, `customfield-routes.ts` | `/api/admin/custom-fields` |
| Tags and watchers | `tags.ts` | `/api/tags...`, `/api/watchers`, `/api/me/watching`, `/api/admin/tags/rename` |
| Labels by id | `routes.ts`, `auth.ts` | `POST /api/records/labels`, `GET /api/users/labels` |
| Personal preferences | `preferences.ts` | `/api/me/preferences[/:key]` |
| Retention | `retention.ts` | `/api/admin/retention...` |
| Saved list views | `views.ts` | `/api/views[/:id]` |
| Organization details and branding | `organization.ts`, `branding-colors.ts` | `/api/branding`, `/api/branding/logo/:variant` |
| Feature switches | `features.ts` | read by `can()`, the registry and the routes; switched in Administration > Features |
| Lifecycles (allowed status changes, required fields) | `lifecycle.ts` | administered by the `lifecycles` module |
| Email in and out, text messages | `mail/` | `mail/routes.ts` |
| Background jobs | `jobs/` | none (a queue in the database) |
| Sign-in providers | `identity/` | `/api/auth/...` and the `admin` module |

The OpenAPI document is built on each request from what is registered, so it cannot drift:
every record type's generated routes with field schemas (custom fields included), and every
other route, with its `describeRoute` description or marked `x-undocumented`. It is cut
down to what the caller may use. `npx tsx server/src/core/openapi-cli.ts <file>` writes the
whole document without a running server.

## Data model conventions

- **Standard columns** on every resource table: `id` (UUID), `created_at`, `created_by`,
  `updated_at`, `updated_by`, `deleted_at`.
- **Soft delete.** Deleting sets `deleted_at`; queries filter on it. Nothing is removed,
  except by an administrator from the retention review (`server/src/core/retention.ts`),
  which is the only hard delete and is audited.
- **No foreign keys across modules.** A module stores another record's UUID in a plain
  column and declares the field as `{ type: 'ref', to: '<type>' }`. Modules can therefore
  be loaded, tested and migrated independently.
- **Lookups as configurable lists.** Statuses, priorities, categories and scales are rows
  in the `lookups` table (`list_key`, `value`, `label`, `color`, `sort`, `active`, `meta`),
  not constants. `ctx.lookups.ensure` adds missing values and never overwrites an edited
  one. Values are retired (`active = false`), never deleted, so old records keep their
  meaning.
- **Settings.** Key and JSON value in `settings`, read with a fallback
  (`ctx.settings.get(key, fallback)`); every change is audited.
- **Generic links and comments.** `record_links` relates any two records by type and id;
  `comments` attaches to any record. Both are served by core routes that check the
  caller may see the records involved.
- **Append-only audit.** `audit_events` holds actor, address, action, record type and id,
  summary, before/after JSON, and the personal access token used, if any. A database trigger raises an error on any `UPDATE` or
  `DELETE` of a row.
- **Migrations.** Plain SQL files, `NNN_name.sql`, applied in file-name order (core first,
  then modules alphabetically), each in a transaction, recorded in `schema_migrations` as
  `<scope>/<file>`. There are no downward migrations.
- **Types.** Dates are kept as `YYYY-MM-DD` strings end to end; timestamps are
  `timestamptz`; numerics come back as JavaScript numbers.

## Authentication

Local accounts, single sign-on (OpenID Connect, SAML 2.0 and directory sign-in over LDAP,
in `server/src/core/identity/`), passkeys (`server/src/core/webauthn/`), personal access
tokens for scripts (`server/src/core/tokens.ts`) and OAuth for AI assistants over MCP. The
sign-in and session code is in `server/src/core/auth.ts`. Details and limits are in
[Security](security.md).

- **First run.** While no user exists, `POST /api/setup` creates the first administrator.
- **Passwords.** Argon2id hashes; a policy check (length, common-password list, no
  username, no reuse of recent passwords).
- **Sessions.** A random token in an `HttpOnly`, `SameSite=Strict` cookie; only its
  SHA-256 hash is stored. Eight-hour lifetime and a configurable idle time-out
  (`auth.idle_minutes`). People can see and end their own sessions; administrators can end
  anyone's.
- **Lockout and rate limiting.** Progressive per-account lockout and an in-memory limit
  per source address on failed sign-ins.
- **Second factor.** Time-based one-time passwords (TOTP) from an authenticator app, with
  ten single-use recovery codes, or a passkey. Roles can require one; the setting
  `auth.mfa_enforcement` decides whether a missing second factor is a reminder or blocks
  work until the person sets one up (a new installation requires it for Administrator and
  Security lead unless setup chose reminders only).
- **Confirming identity.** Sensitive actions ask for the password (or the provider's
  sign-in) again if it was not given recently ([Security](security.md#password-confirmation-before-sensitive-actions)).
- **One-time links.** New users and password resets use single-use links valid for 24
  hours (`server/src/modules/admin/users.ts`). The administrator is shown the link, and it
  is emailed when outgoing email is set up.

## Audit

Every change made through the resource engine or a hand-written route writes an audit
event (table `audit_events`, written by `server/src/core/services.ts`): who, when, the record, the action, the fields
before and after, the request id, the source address and, for a token, its name.
Sign-ins, refused sign-ins, permission and setting changes are audited too. A database
trigger refuses updates and deletes on the audit table, and the retention sweep never
removes audit events. Restricted records are left out of the audit search for people
without `security.view`. See [Security](security.md#audit-log).

## Authorization

- **Permissions** are strings `<module>.<action>`. The fixed module keys and actions are
  listed in [the developer guide](development.md#permissions).
- **Roles** hold grants; users hold roles. A grant is exact (`tickets.view`), a module
  wildcard (`tickets.*`) or everything (`*`). `can(user, perm)` in
  `server/src/core/services.ts` is the whole rule.
- **Default roles** are created at first start (`DEFAULT_ROLES` in the same file) and can
  then be edited. Some ship switched off; a switched-off role grants nothing. Only the
  Administrator role may hold `*`, and the application refuses changes that would leave
  no active administrator or remove the acting administrator's own access.
- **`security.view` and restricted records.** Risks, security incidents, notification
  tasks and vulnerability findings are restricted types: holding `risks.view` alone is not
  enough. Without `security.view` they do not appear in lists, single reads, search,
  pickers, links, exports or the audit search. Some types restrict row by row instead
  (`restricted: 'flag'`): actions take the restriction of the record they arose from, and
  safety events flagged as holding personal information are restricted.
- **Figures are the same for everyone.** Counts, charts, report and dashboard figures
  include restricted records whoever looks; restriction hides the records, not the numbers
  ([Security](security.md#figures-are-the-same-for-everyone)).
- **Feature switches.** An administrator can switch optional parts of the application off
  (`server/src/core/features.ts`). `can()` then answers false for that part's permissions
  whoever holds them, its record types leave the resource registry, its routes answer 404
  `switched_off` and its jobs are skipped, so a switched-off part behaves like a module that
  is not installed. See [the developer guide](development.md#feature-switches-optional-areas).
- **The web hides what the user cannot do**, using the permissions in `/api/auth/state`,
  but the server is the control: every route checks again.

## Organization profile and seed profiles

Nothing in the repository is specific to one organization. What differs between
installations arrives in one of three ways:

1. **Defaults** (`seedDefaults`): generic lookup values, starter rules and checklists,
   added at every start if missing.
2. **The seed command** (`server/src/cli.ts`), with two profiles:
   - `dev`: generated, invented data; reads no files.
   - `pilot`: reads the private seed folder. Core applies `appName` and `lookups` from
     `organization.json`; each module's `seed(ctx, opts)` reads its own section from
     `opts.organization` and its own optional import files with `ctx.readSeed`.
   Seeds are idempotent and never overwrite later edits.
3. **The application itself**: everything in the profile can be entered or changed there.

File formats are documented in [Installation](installation.md#5-load-data).

## Time zone and currency

- **Time zone.** `GRC_TIMEZONE` (default: the machine's zone) is validated at start
  (`server/src/core/timezone.ts`). It is set as the database session time zone, used by
  server code for "today" (`todayInZone`) and business-hours arithmetic, and reported to
  the web in `/api/auth/state` so that every user sees times in the organization's zone,
  not their browser's.
- **Currency.** `GRC_CURRENCY` (default `USD`) is an ISO 4217 code reported the same way
  and used only to format `currency` fields. Amounts are stored as plain numbers; there is
  no conversion and no per-record currency.

## Testing

- Tests are Vitest files named `*.test.ts` beside the code (`server/src/**`). There are no
  automated browser tests.
- `testApp()` in `server/src/test/helpers.ts` builds the whole application on an
  **in-memory database** (`dataDir: 'memory'`), completes setup, and returns `api` (signed
  in as an administrator), `as(roleKey)` (a new user holding only that role; all roles are
  enabled in tests) and `anon`. Requests go through Fastify's `inject`, so the full
  lifecycle above runs, without a network port.
- Tests pin `GRC_TIMEZONE` (in `vitest.config.ts`) so date arithmetic does not depend on
  the machine.
- `GRC_MODULES` limits which modules are loaded, so one module can be tested while others
  are mid-change:

  ```powershell
  $env:GRC_MODULES = 'tickets'; npx vitest run server/src/modules/tickets
  ```

  (In a plain shell, first put the portable Node.js on the path:
  `$env:Path = "$PWD\.tools\node;$env:Path"`.)
- Tests never read the private `seed/` folder. They use invented data.

## How to add a module

A short outline, for an invented "meeting rooms" module. The exact shapes are in
[the developer guide](development.md#server-conventions).

1. **Choose the permission module key** from the fixed list, or agree a new one. The role
   editor only accepts keys in `MODULE_KEYS` (`server/src/modules/admin/shared.ts`), so a
   new key has to be added there and to the developer guide.
2. **Migration.** `server/src/modules/rooms/migrations/001_rooms.sql`: create the table
   with the standard columns. No foreign keys to other modules' tables.
3. **Server module.** `server/src/modules/rooms/index.ts` default-exports a `ModuleDef`:
   - `seedDefaults`: `ctx.lookups.ensure('room_status', [...])`.
   - `register`: `ctx.defineResource({ type: 'room', table: 'rooms', module: ..., path:
     '/api/rooms', route: '/rooms', titleField: 'name', fields: {...} })`, plus any
     hand-written routes with `ctx.requirePerm(...)` and `ctx.audit(...)`.
   - `seed` (optional): invented data for `dev`; optional files for `pilot`.
4. **Test.** `server/src/modules/rooms/rooms.test.ts` using `testApp()`: create, read,
   validation failure, and a role that must be refused.
5. **Web module.** `web/src/modules/rooms/index.tsx` default-exports a `ModuleDef` with
   `nav`, `routes` and `create`. Start from the generic list and record pages in
   `web/src/core` (see `web/src/core/README.md`).
6. **Run** `.\grc.ps1 typecheck` and `.\grc.ps1 test`, then `.\grc.ps1 dev` to see it.
7. **Update** `docs/known-gaps.md` and the record-type table in `docs/development.md`.

No registration step is needed anywhere: both sides find the folder.

## Hosting

How the one process is reached and where its data lives. Operator's view:
[Server installation](installation.md#server-installation).

- **Two database drivers, one interface.** `openDb` in `server/src/core/db.ts` returns the
  same `Db` (`query`, `one`, `exec`, `tx`, `close`) from either PGlite (embedded, the
  default) or a `pg` connection pool (`GRC_DATABASE_URL`). Nothing else imports either
  driver. The server driver is made to behave like the embedded one:
  - *Values*: type parsers give dates as `YYYY-MM-DD` strings, `numeric`/`bigint` (and
    their arrays) as numbers, `interval` as text and `json`/`jsonb` parsed, as PGlite does.
    PGlite knows each parameter's type and sends a JavaScript array bound for `jsonb` as
    JSON; `pg` would send a Postgres array, so for a statement with an array parameter the
    driver asks the server once for the parameter types (`PREPARE` and
    `pg_prepared_statements`) and JSON-encodes those arrays. Cached per statement.
  - *Sessions*: every pooled connection gets the organization's time zone, a statement
    timeout, an idle-in-transaction timeout and an optional `search_path` before first use.
  - *Transactions*: `tx` takes one connection for `begin` ... `commit`/`rollback`. Unlike
    PGlite, other queries on the outer handle are not held back meanwhile; they run on
    other connections and do not see the transaction's uncommitted work.
  - *Portability*: no extensions; `gen_random_uuid()` (core since PostgreSQL 13), the
    `english` and `simple` text-search configurations and PL/pgSQL triggers are standard.
    One migration uses a stored generated column. PostgreSQL 15 or later is supported.
  - *Tests*: `GRC_TEST_DATABASE=pg` makes every in-memory test database a fresh PGlite
    served over the Postgres wire protocol (`@electric-sql/pglite-socket`, random port)
    and reached through the server driver, so the whole suite exercises it;
    `GRC_TEST_DATABASE_URL` gives each a fresh database on a real server, dropped on close.
    An in-memory database never uses `GRC_DATABASE_URL`. `server/src/core/db.test.ts`
    checks both drivers side by side.
- **Listening and HTTPS.** `planListen` in `server/src/core/http.ts` reads `GRC_HOST`,
  `GRC_PORT` and `GRC_TLS_CERT`/`GRC_TLS_KEY` and refuses plain HTTP on a non-loopback
  address unless `GRC_ALLOW_INSECURE=1`. With a certificate the same Fastify instance is
  built with `https` options. `server/src/core/tls-selfsigned.ts` writes a self-signed
  test certificate using Node's crypto only.
- **Trusted proxies.** Fastify is built with a trust-proxy function (`trustProxyFn`) that
  reads `GRC_TRUST_PROXY` on each request: addresses, CIDR ranges and keywords, or a hop
  count. `req.ip`, `req.protocol` and `req.hostname` therefore follow `X-Forwarded-*` only
  from a trusted peer, everywhere. The helpers in `server/src/core/request.ts`
  (`clientIp`, `isHttps`, `cookieSecure`) agree with them.
- **HSTS and cookies.** An `onSend` hook in `app.ts` adds `Strict-Transport-Security` to
  HTTPS responses (`GRC_HSTS_MAX_AGE`). `main.ts` sets `GRC_COOKIE_SECURE=auto` when HTTPS
  or a trusted proxy is configured and the setting was left unset.
- **Shutdown.** On a signal or the stop file, `main.ts` closes Fastify (finishing requests
  in progress) and then the database (flushing PGlite, or ending the pool), and exits;
  after 20 seconds it exits regardless.
- **Containers.** `Dockerfile` (web build stage, production-packages stage, runtime as the
  `node` user running `node --experimental-transform-types server/src/main.ts`, state
  under the `/var/lib/sandpiper` volume, `HEALTHCHECK` via `deploy/healthcheck.mjs` on `/api/ready`, which asks the database),
  `.dockerignore` (never sends `seed/`, `data/`, `.tools/`, secrets or internal documents)
  and `compose.yaml` (profiles `embedded` and `server`, secrets from files, read-only root
  filesystem). CI builds the image and checks it starts healthy.

## Path to production

The prototype choices were made so that each can be replaced without redesign. The
database server, HTTPS and containers are in place (Hosting, above); the rest is not yet
built; see [Known gaps](known-gaps.md).

- **Database.** Still to design: a transaction-per-request story. A least-privilege set-up,
  where the application's own account cannot change the schema or drop the audit trigger,
  is built but optional ([Installation](installation.md#a-least-privilege-database-role));
  by default the application's account owns its tables. Backups in server mode use `pg_dump`; `grc.ps1 backup` covers the embedded database only.
- **Single sign-on.** OpenID Connect, SAML 2.0 (XML signatures checked by the
  @node-saml/node-saml library, with hardening of our own in core/identity/samlxml.ts),
  directory (LDAP) sign-in over TLS (a small client of our own in core/identity/ldapclient.ts),
  sign-outs started at a SAML identity provider, account linking and a break-glass
  administrator are built. Still to do: a passkey second factor after a directory password
  and linking a directory from Account security (E02-29).
- **More than one process.** The job queue already works across processes. Still to do:
  move the remaining timers onto it, and move the per-token request count (E16-43), the `If-Match`
  lock and the webhook worker out of process memory, before running several instances.
- **Operations.** Scheduled, verified backups, an upgrade with automatic rollback and
  continuous integration are built. Still to do: log retention and monitoring.
