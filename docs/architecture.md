# Architecture

How the application is put together, and why. [`CLAUDE.md`](../CLAUDE.md) is the detailed
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
| Styling | Plain CSS with design tokens (`web/src/core/tokens.css`) | No UI framework to track |
| Charts | ECharts | Covers the heat map and dashboard charts |
| Tests | Vitest | Runs the server in memory, quickly |

There is no ORM: SQL is written by hand with parameters. There is no job queue: scheduled
work (for example the service-level sweep) uses in-process timers.

## Layers

```
 Browser
 ┌────────────────────────────────────────────────────────────┐
 │ web/src/modules/<key>/   screens for one module            │
 │ web/src/core/            shell, generic list/detail/form,  │
 │                          API client, design system         │
 └──────────────────────────────┬─────────────────────────────┘
                                │ HTTP on 127.0.0.1 (JSON, session cookie)
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
 │ core/db.ts  the only file that knows about PGlite          │
 └──────────────────────────────┬─────────────────────────────┘
                                ▼
                       data/pg  (database files)
```

## Process model

- **One process.** `server/src/main.ts` calls `buildApp()` in `server/src/app.ts`, listens
  on `127.0.0.1`, and serves both the API (`/api/...`) and the built web application
  (`dist/web`, with a fallback to `index.html` for client-side routes).
- **Embedded database.** PGlite runs inside that process and allows one process per data
  folder. That is why `server/src/cli.ts` (the `seed` and `migrate` commands) refuses to
  run while `data/grc.pid` exists, and why `grc.ps1` stops the server around `seed` and
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

1. **Session.** The `grc_session` cookie is hashed and looked up. If the session exists,
   has not expired and has not been idle too long, the user is loaded with their roles and
   permissions, and attached as `req.user`. A disabled user or a disabled role stops
   counting immediately, because this happens on every request.
2. **CSRF header.** Any method other than `GET`, `HEAD` or `OPTIONS` must carry the header
   `X-GRC-CSRF: 1`, or the request is refused with 403. The web API client adds it.
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
[`CLAUDE.md`](../CLAUDE.md#record-types-and-owners).

## The generic resource engine

Most record types are declared, not coded. `ctx.defineResource(def)`
(`server/src/core/resource.ts`) takes a description of a record type (table, fields,
permission module, title field, optional auto-number) and provides:

- **Routes**: list, stats, get one, create, partial update, soft delete. The table of
  routes and query parameters is in [`CLAUDE.md`](../CLAUDE.md#resources-generic-crud).
- **Permission checks**: `<module>.view`, `.create`, `.edit`, `.delete`, `.export`.
- **Validation** by field type (text, number, date, lookup, reference and so on). Lookup
  values must be active values of the named list. Failures return 400 with a message per
  field. `readOnly` fields can be set only by system code.
- **Filters, search, sort and paging** on the list route, built from declared fields only;
  field names are checked against an identifier pattern before they reach SQL.
- **CSV export** (`format=csv`), limited to 50,000 rows, audited, with cells that start
  with a formula character neutralised.
- **`_display` labels.** Each row carries `_display: { field: label }` for user, reference
  and lookup fields, so the web never has to resolve identifiers itself.
- **Auto-numbering** such as `TKT-00001`, from the `counters` table.
- **Audit**: create, update (changed fields only, with before and after), delete, export.
- **Hooks**: `beforeCreate`, `beforeUpdate`, `afterCreate`, `afterUpdate` for module rules.
- **Restricted records.** `restricted: true` makes the whole type need `security.view` as
  well as the module permission. `restricted: 'flag'` hides only rows whose `restricted`
  column is true. The engine applies this to lists, counts, stats, single reads, exports,
  search, record pickers, links and `_display` labels (a hidden reference shows as
  "Restricted").

The registry (`ctx.resources`) also gives modules `find`, `create`, `update` and
`labelFor` for any registered type. On the web, `web/src/core` has matching generic list,
form and record pages driven by `/api/meta`, which describes every record type the user
may see.

Routes that do not fit the pattern are ordinary Fastify routes in the module's `register`.
They must apply the same permission, restriction and audit rules themselves.

## Data model conventions

- **Standard columns** on every resource table: `id` (UUID), `created_at`, `created_by`,
  `updated_at`, `updated_by`, `deleted_at`.
- **Soft delete.** Deleting sets `deleted_at`; queries filter on it. Nothing is removed.
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
  summary, and before/after JSON. A database trigger raises an error on any `UPDATE` or
  `DELETE` of a row.
- **Migrations.** Plain SQL files, `NNN_name.sql`, applied in file-name order (core first,
  then modules alphabetically), each in a transaction, recorded in `schema_migrations` as
  `<scope>/<file>`. There are no downward migrations.
- **Types.** Dates are kept as `YYYY-MM-DD` strings end to end; timestamps are
  `timestamptz`; numerics come back as JavaScript numbers.

## Authentication

Local accounts only. Details and limits are in [Security](security.md).

- **First run.** While no user exists, `POST /api/setup` creates the first administrator.
- **Passwords.** Argon2id hashes; a policy check (length, common-password list, no
  username, no reuse of recent passwords).
- **Sessions.** A random token in an `HttpOnly`, `SameSite=Strict` cookie; only its
  SHA-256 hash is stored. Eight-hour lifetime and a configurable idle time-out.
- **Lockout and rate limiting.** Progressive per-account lockout and an in-memory limit
  per source address on failed sign-ins.
- **Second factor.** Time-based one-time passwords (TOTP) from an authenticator app, with
  ten single-use recovery codes. Offered and working, but not enforced.
- **One-time links.** New users and password resets use single-use links valid for 24
  hours, which the administrator passes on by hand (`server/src/modules/admin`).

## Authorisation

- **Permissions** are strings `<module>.<action>`. The fixed module keys and actions are
  listed in [`CLAUDE.md`](../CLAUDE.md#permissions).
- **Roles** hold grants; users hold roles. A grant is exact (`tickets.view`), a module
  wildcard (`tickets.*`) or everything (`*`). `can(user, perm)` in
  `server/src/core/services.ts` is the whole rule.
- **Default roles** are created at first start (`DEFAULT_ROLES` in the same file) and can
  then be edited. Some ship switched off; a switched-off role grants nothing. Only the
  Administrator role may hold `*`, and the application refuses changes that would leave
  no active administrator or remove the acting administrator's own access.
- **`security.view` and restricted records.** Risks, security incidents and notification
  tasks are restricted types: holding `risks.view` alone is not enough. Without
  `security.view` they do not appear in lists, counts, search, links, exports, stats or
  the audit search.
- **The web hides what the user cannot do**, using the permissions in `/api/auth/state`,
  but the server is the control: every route checks again.

## Organisation profile and seed profiles

Nothing in the repository is specific to one organisation. What differs between
installations arrives in one of three ways:

1. **Defaults** (`seedDefaults`): generic lookup values, starter rules and checklists,
   added at every start if missing.
2. **The seed command** (`server/src/cli.ts`), with two profiles:
   - `dev`: generated, invented data; reads no files.
   - `pilot`: reads the private seed folder. Core applies `appName` and `lookups` from
     `organisation.json`; each module's `seed(ctx, opts)` reads its own section from
     `opts.organisation` and its own optional import files with `ctx.readSeed`.
   Seeds are idempotent and never overwrite later edits.
3. **The application itself**: everything in the profile can be entered or changed there.

File formats are documented in [Installation](installation.md#5-load-data).

## Time zone and currency

- **Time zone.** `GRC_TIMEZONE` (default: the machine's zone) is validated at start
  (`server/src/core/timezone.ts`). It is set as the database session time zone, used by
  server code for "today" (`todayInZone`) and business-hours arithmetic, and reported to
  the web in `/api/auth/state` so that every user sees times in the organisation's zone,
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
[`CLAUDE.md`](../CLAUDE.md#server-conventions).

1. **Choose the permission module key** from the fixed list, or agree a new one. The role
   editor only accepts keys in `MODULE_KEYS` (`server/src/modules/admin/shared.ts`), so a
   new key has to be added there and to `CLAUDE.md`.
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
7. **Update** `docs/known-gaps.md` and the record-type table in `CLAUDE.md`.

No registration step is needed anywhere: both sides find the folder.

## Path to production

The prototype choices were made so that each can be replaced without redesign. None of
the following is built yet; see [Known gaps](known-gaps.md).

- **Database.** Replace PGlite with a PostgreSQL server by reimplementing `openDb` in
  `server/src/core/db.ts` with a PostgreSQL client and a connection pool. Nothing else
  imports PGlite, and the SQL and migrations are already PostgreSQL. Things to design
  with it: a real transaction-per-request story, the session time zone on every pooled
  connection, and a database role for the application that cannot alter the audit trigger.
- **Containers.** Replace `grc.ps1` and the portable Node.js with a container image for
  the server and a managed or containerised PostgreSQL. The pid-file and stop-file
  mechanism goes away in favour of ordinary signals, which `main.ts` already handles.
- **HTTPS.** Terminate TLS in front of the server (or in it), mark the session cookie
  `Secure`, add HSTS, tell Fastify which proxy to trust so that source addresses in the
  audit log and rate limiter are real, and revisit the fixed `127.0.0.1` binding.
- **Single sign-on.** Add OpenID Connect or SAML beside local accounts, with account
  linking and a break-glass local administrator. Decide where the second factor is
  enforced.
- **More than one process.** Move rate limiters and timers out of process memory (a
  shared store and a job queue) before running several instances.
- **Operations.** Scheduled backups with tested restores, an upgrade procedure, log
  retention, monitoring and continuous integration.
