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
  light-rail operator, with invented organization details: `DEV_ORGANIZATION` in
  `core/profile.ts`). Needs no files.
- `pilot` (default): reads the private `seed/` folder. Every file is optional; a missing
  file is skipped. It **never creates invented records** (E18-69): only what comes from the
  organization's files and profile, plus built-in reference content (lists, roles, framework
  outcomes and mappings, the standard reports, dashboards, pack and tracked figures). Every
  invented "[Sample]" record a module's `seed` adds belongs behind `opts.profile === 'dev'`;
  `modules/inventory/seed-pilot-clean.test.ts` runs every module's pilot seed on an empty
  folder and fails on any `[Sample]` value or a filled sample table.
  - `organization.json`: the organization profile (a file still named
    `organisation.json` is read too). Shape and an invented example are in
    `examples/organization.example.json` (type `OrganizationProfile` in `core/profile.ts`):
    `appName`, `name`, `legalName`, `shortName`, `address`, `phone`, `email`, `website`,
    `securityContact`, `branding` (colors and logo files), `lookups` (extra values for any
    configurable list), `obligations`, `notificationRules`. Core imports the organization's
    details into the settings once, only where none is stored (`applyOrganizationProfile` in
    `core/organization.ts`; they then live under Administration > Organization), and applies
    `lookups`; modules read their own sections from `opts.organization`.
  - Optional pipe-delimited import files (first line is the header): `systems.psv`,
    `sites.psv`, `data_categories.psv`, `vendor_contracts.psv`, `csf_target_profile.psv`,
    `information_requests.psv`, `vehicles.psv`, `services.psv` and
    `csf_subcategory_designations.csv`. The expected headers are in each module's `seed.ts`
    (`fleet/seed-pilot.ts` for vehicles and services). The fleet seed loads the inventory's pilot
    files first (`seedPilotEstate` in `modules/inventory/seed.ts`) so that depots and systems named
    in its files exist.

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
.\grc.ps1 ci         # local continuous integration: typecheck, tests, tests on UTC, web build, dependency audit
.\grc.ps1 backup     # verified copy of data/ in backups/<timestamp> (-Prune <n> keeps the newest n; -Encrypt)
.\grc.ps1 restore <backup|latest|file>   # verifies, keeps a safety copy, replaces data/
.\grc.ps1 status | logs | upgrade   # see docs/operations.md for these and the other operations commands
.\grc.ps1 version    # installed version and commit
.\grc.ps1 audit-deps # dependency advisories (fails only on a fixable high or critical one)
.\grc.ps1 secret-key show | rotate   # where the secret key comes from; a new key (restarts the server)
./grc.sh service install | remove | status | print   # macOS and Linux: a launchd or systemd user service
.\grc.ps1 audit-archive [-Folder <dir>]   # the audit archive as the database owner (least-privilege role)
.\grc.ps1 npm <args> # any npm command with the portable Node
npm run cli -- audit-archive [--folder <dir>]   # the audit archive as the database owner (least-privilege role)
powershell -ExecutionPolicy Bypass -File tools\installer\build.ps1 [-OutDir dir] [-Version x.y.z] [-Instance name] [-BrokenMigration]   # builds the Windows installer (needs Inno Setup 6)
powershell -ExecutionPolicy Bypass -File tools\installer\test-install.ps1   # tests the installer end to end, as an administrator
```

`.\grc.ps1` with no command prints the full list.

**Continuous integration is local first.** Run `.\grc.ps1 ci` before every commit and
push: it runs the typecheck, the tests (server and web) twice, the second time with the
clock on UTC, the web build and the dependency audit (`audit-deps`: it fails on a fixable
high or critical advisory, and is skipped with a warning when the npm registry cannot be
reached), and fails if any step fails. GitHub Actions
(`.github/workflows/ci.yml`) runs on every push and pull request: the typecheck, tests and
build on Windows and Linux with a non-blocking dependency audit (`npm audit`); the tests
through the PostgreSQL wire protocol (and, not yet blocking, on PostgreSQL 17); the
container build and smoke test; and the browser suite with the accessibility audit, which
fails only on a finding not already raised as an issue (see [Tests](#tests)).
A push or pull request that changes only documentation (anything under `docs/` except the
user guide in `docs/user`, and the top-level Markdown files) runs none of this; the user guide is
bundled into the in-app Help and tested, so a change there runs everything.

For one change, run `.\grc.ps1 ci` and only the browser tests that cover it
(`npm run test:e2e -- --only smoke,<suite>` or `--grep <name>`). The whole browser suite (over an
hour in one run; on GitHub it is split into four parallel jobs: roles, smoke with sign-in and
features off, the rest, and the accessibility audit) runs on GitHub for every push; run them locally at the end of a
larger piece of work, before a release, or when a change touches the shell, routing or theme.

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
exists). Then `.\grc.ps1 install` and `.\grc.ps1 start`. The first visit shows the
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
| `GRC_MIGRATION_REPORT_SECONDS` | `15` | How often a long migration is reported in the log |
| `GRC_METRICS_TOKEN` (or `_FILE`) | not set | Switches on `GET /api/ops/metrics` (Prometheus text format) for a bearer token of at least 24 characters ([Operations](operations.md#operational-metrics)) |
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
headers are believed (the keyword `gateway`, the compose default, is resolved at start to the
container's default gateway; `core/gateway.ts`); one process per data folder is enforced by
`data/grc.lock` (`core/datalock.ts`); `GRC_ALLOW_INSECURE=1` allows plain HTTP on a reachable address
behind a proxy that terminates HTTPS; `GRC_COOKIE_SECURE` (`off` | `auto` | `always`)
becomes `auto` by itself on HTTPS or behind a trusted proxy. In code, use `clientIp(req)`
and `isHttps(req)` from `core/request.ts` rather than `req.ip` and `req.protocol`.

### Settings

Administrators change these under Administration > Settings (`server/src/modules/admin/settings.ts`).
Read them in code with `ctx.settings.get(key, fallback)`, using the same fallback.

| Key | Default | Meaning |
|---|---|---|
| `app.name` | `Sandpiper GRC` | Name shown in the application; changed under Administration > Organization |
| `organization.name`, `.legal_name`, `.short_name` | `''` | The organization's names (Administration > Organization, `core/organization.ts`). Read with `readOrganization(db)`; `organizationName(o)` falls back to `app.name` |
| `organization.street`, `.city`, `.region`, `.postal_code`, `.country` | `''` | Postal address, free text; `street` is up to three lines joined by line breaks. `addressLine(o)` gives one line |
| `organization.phone`, `.email`, `.website` | `''` | General contacts, printed in email and PDF footers |
| `organization.security_phone`, `.security_email` | `''` | Security contact, printed only in the offline incident kit |
| `branding.primary_color`, `branding.accent_color` | `''` (the standard look) | `#rrggbb`. Never used as typed: `deriveBrandColors` (`core/branding-colors.ts`) works out WCAG 2.2 AA shades per theme, which the web app lays over `tokens.css` (`web/src/core/branding.ts`) |
| `branding.logo_light`, `branding.logo_dark` | none | Logos (PNG, JPEG or WebP by content, at most 512 KB and 2048 pixels; never SVG) with their description, stored as settings so they are in every backup; set only through `POST/DELETE /api/admin/organization/logo/:variant`, never PATCHed. Served publicly at `/api/branding/logo/:variant`. A WebP logo may hold a browser-made PNG copy (`print`, at most 1 MB, same shape) used by PDFs and emails; `POST /api/admin/organization/logo/:variant/print` adds one |
| `branding.email_logo` | `true` | Emails carry the light-theme logo inline (Content-ID) when it is PNG or JPEG (or a WebP logo's PNG copy) up to 200 KB |
| `pilot_mode` | `true` | Shows the "sample and test data only" notice |
| `features` | every area on except `portal` | Feature switches, one boolean per optional area (`core/features.ts`); changed under Administration > Features (needs a recent password confirmation). An area missing from the stored value takes its default |
| `auth.password_min_length` | `14` | Minimum password length (never below 12) |
| `auth.password_history` | `5` | Earlier passwords that may not be reused |
| `auth.idle_minutes` | `30` | Session idle time-out |
| `auth.mfa_required_for_all` | `false` | Second factor required for everyone |
| `auth.mfa_enforcement` | `notice` | `off`, `notice` or `required` |
| `auth.mfa_grace_days` | `0` | Days to enroll before enforcement |
| `outsidereviews.require_2fa` | `true` | Outside reviewers must set up a second factor at their first sign-in, whatever `auth.mfa_enforcement` says (password confirmation to change) |
| `auth.reauth_minutes` | `10` | How long a password confirmation lasts |
| `auth.passkey_sign_in` | `true` | A passkey alone may sign a person in |
| `auth.passkey_user_verification` | `preferred` | `preferred` or `required` (every passkey use checks a PIN or biometric) |
| `auth.local_signin` | `true` | Password sign-in; can be switched off only when a break-glass account exists and everyone else has a provider |
| `auth.public_url` | `''` | The https address people use, for the redirect address given to sign-in providers; empty = as requested |
| `tokens.max_days` | `365` | Longest life of a new personal access token |
| `tokens.rate_per_minute` | `600` | Requests a minute per token |
| `integrations.outbound_enabled` | `false` | Allows webhook deliveries at all |
| `integrations.allowed_hosts` | `[]` | Hosts webhooks may reach (`host`, `host:port`, `*.domain`) |
| `integrations.scim_enabled` | `false` | User provisioning (SCIM 2.0) answers at all (Administration > User provisioning) |
| `integrations.scim_link_provider` | `''` | The sign-in provider whose external ids provisioned accounts are linked to |
| `feeds.calendar_enabled` | `false` | Calendar feeds answer at all (Administration > Calendar and work trackers; password confirmation to switch on) |
| `attachments.link_check_days` | `90` | Days after which a linked document is due for a check |
| `actions.closure_evidence_sources` | `[]` | Action sources whose actions need an attachment or closure evidence text before they are finished (Administration > Settings > Actions) |
| `continuity.bia_every_months` | `12` | Months between business impact analyses of a process |
| `vendors.reassessment_reminder_days` | `30` | Days before a vendor's reassessment or exclusion-list check that its owner is reminded |
| `vendors.exclusion_check_months` | `12` | Months after which a vendor's exclusion-list check is due again |
| `vendors.exclusion_check_before_contract` | `false` | A match, or no check within `vendors.exclusion_check_months`, stops the vendor's contracts from becoming active |
| `vendors.intake` | starter questionnaire | The vendor intake questionnaire, its tier rules, the default tier and the checks each tier needs (Vendors > Intake questions) |
| `vendors.intake_before_contract` | `false` | A contract can become active only after its vendor has a completed intake |
| `funding.subrecipient_reminder_days` | `30` | Days before sub-recipient monitoring is due that the monitor is reminded |
| `records.request_due_days` | `{ "*": 20 }` | Days to answer a records request, by request kind (`*` is every kind not named); no jurisdiction's deadline is built in |
| `records.business_days` | `false` | Count working days on the organization's working calendar (the service desk's Business hours calendar: its open weekdays and holidays, `core/working-days.ts`) instead of calendar days |
| `records.clock_amber_fraction` | `0.25` | A request's clock turns amber when this fraction of the time to answer remains |
| `privacy.review_reminder_days` | `30` | Days before an approved privacy impact assessment's review that its owner is reminded |
| `safety.clock_amber_fraction` | `0.25` | A safety notification clock turns amber when this fraction of its window remains |
| `funding.certification_month` | `12` | Month in which next year's certification drafts are copied forward |
| `retention.audit_months` | `84` | Audit log retention, recorded for the retention schedule; events are removed only by the audit archive when switched on |
| `audit.archive` | `{ enabled: false, olderThanMonths: 84, folder: '' }` | Audit log archive (Audit log > Archive old events; recent password); nothing is removed while off ([Operations](operations.md#audit-log-archive)) |
| `backups.schedule` `.pgDumpFolder`, `.pgDumpMaxAgeHours` | `''`, `26` | PostgreSQL: folder of `deploy/postgres/pg-backup.sh` dumps checked by the server, and their age limit |
| `retention.webhook_delivery_days` | `30` | Finished webhook deliveries are removed after this many days (pending ones never); delivered ones lose their content at once |
| `retention.mail_log_days` | `180` | Outgoing message log (`mail_log`) rows that are no longer queued or retrying are removed after this many days |
| `retention.mail_inbound_log_days` | `180` | Incoming email log (`mail_inbound_log`) rows are removed after this many days |
| `retention.audit_forward_log_days` | `30` | An audit-log forwarder's delivery log (`audit_forward_log`) is kept this many days; events already forwarded are not recalled |
| `retention.tag_lookups_days` | `90` | Asset tag lookups (the "Last seen" log, `tag_lookups`) are removed after this many days by the daily job `tags.lookup_housekeeping` |
| `tags.log_lookups` | `true` | Keep the asset tag lookup log |

Changing an `auth.*`, `tokens.*` or `integrations.*` setting needs a recent password
confirmation.

AI assistant access has its own settings, changed under Administration > AI assistant
access (`server/src/modules/mcp/settings.ts`), never on the general Settings screen and
never with a token. `PUT /api/mcp/admin/settings` takes the camelCase names of `KEYS` in that
file (`enabled`, `writeEnabled`, ...), not the stored keys below; see [MCP](mcp.md#settings):

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
  delete them afterward.
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
shared/                       code the server, the web and the mobile app share: tag values and formats
                              (tag-format.ts), inspection completion rules (inspection-rules.ts), calendar-date helpers (dates.ts), working-day
                              arithmetic (working-days.ts), project scoring (project-scoring.ts), the CSV formula guard (csv-guard.ts), languages, translate and the missing-keys check (i18n.ts), API shapes (asset-tags-api.ts, mobile-api.ts, push-api.ts); no imports
                              beyond shared/, tested by the root vitest
mobile/                       the iPhone and Android app (Expo, React Native): its own package.json and
                              lockfile, not part of the root install, typecheck or tests (see below)
tools/                        install-node.ps1, browse.mjs, contrast.mjs, code-snapshot.mjs
tools/e2e/                    browser test runner and suites (npm run test:e2e)
tools/a11y/                   accessibility audit (npm run test:a11y)
tools/sr/                     screen reader journeys (NVDA through Guidepup; manual only)
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
every day, and tests then fail at some hours or on a machine set to UTC. Date arithmetic uses
`shared/dates.ts` (`addDays`, `addMonths`, `daysBetween`, …), never a copy; a deadline in working
days uses `dueAfter`/`workingCalendar` from `core/working-days.ts`.

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
  require a session or a token unless registered with `config: { public: true }`; a public
  route that checks a bearer token of its own, such as the SCIM provisioning endpoint, adds
  `ownBearer: true`, so neither a session nor a personal access token is looked at and no
  CSRF header is asked for).
  `req.apiToken` is `{ id, name }` when the request was made with a personal access token,
  otherwise `null`.
- `ctx.db.query<T>(sql, params) => T[]`, `ctx.db.one<T>(sql, params) => T | undefined`,
  `ctx.db.tx(async (tx) => ...)`. Parameterized queries only (`$1`, `$2`).
- `ctx.dataDir` - the folder holding the database and stored files, or `memory` in tests.
- `ctx.requirePerm('tickets.edit')` - preHandler. `ctx.can(user, perm)` - boolean. The role editor grays
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
  In a figure use `ctx.resources.figureWhere(type, user, alias)` for the rows and
  `ctx.resources.figureMask(type, alias)` for the rows whose details must be masked. The generated
  `GET {path}/stats` uses `figureMaskFor` in `core/resource.ts`, which also puts rows outside a scoped
  person's departments or sites under "Other records"; the hand-written `figureMask` does not apply
  scope yet (see [Known gaps](known-gaps.md)).
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

- `app.pushNotify(userIds)` (push module): queues a push delivery to those people's phones; guard with
  `ctx.app.hasDecorator('pushNotify')`. The notifications service calls it, so modules normally just use
  `app.notify`. Push credentials are not settings: they live in the `push_config` table (keys
  encrypted), changed only under Administration > Push notifications (`GET/PUT /api/push/admin/config`,
  `POST /api/push/admin/vapid`, `POST /api/push/admin/test`, recent password confirmation).
- `app.notify(...)`: in-app notifications (notifications module;
  `if (ctx.app.hasDecorator('notify')) ...`). For reminders pass `oncePerDay: true` (at
  most once per person, record and kind each organization day) or `once: '<key>'` (at most
  once per person ever, for example `'obligation.due:<id>:<date>'`). `inAppOnly: true` sends no
  email and no immediate push (for a message whose recipient must not appear in the outgoing message
  log, such as a confidential reporter). A reminder's lead time
  is a setting read with `ctx.settings.get(key, fallback)`; add it to the list in
  `modules/notifications/reminder-settings.ts` so administrators can change it under
  Administration > Reminders.
- `app.jobs` (`core/jobs`): the table-backed job queue. `app.jobs.register(type, handler,
  opts?)` in `register()`, then `await app.jobs.enqueue(type, payload?, { key?, runAt?,
  delayMs?, maxAttempts?, rerunIfRunning? })` (a second job with the same `key` while one waits is
  skipped; with `rerunIfRunning: true`, a job with that key that is already running is asked to run
  once more after it finishes (`jobs.rerun`), for hook-queued work that reads its list when it starts,
  such as push delivery and tracker sends). Core also keeps `core.ops_watch` (alerts administrators
  once per problem when background work keeps failing; `app.opsState.alerts.raise(key, { title,
  detail, route })` / `.clear([key])` for a module's own problems), `core.session_cleanup` and
  `core.audit_archive`. A database connection that does not come free answers 503 `busy` with
  `Retry-After` (`DatabaseBusyError`, `core/db.ts`)
  and `app.jobs.schedule(name, { type, every })` for recurring work. For a module's
  recurring work use `await scheduleWork(ctx, '<module>.<work>', () => run(), { every,
  firstRunInMs? })` (`core/jobs`), never `setInterval`: it registers the handler and a
  schedule of the same name. A handler may report progress with `job.progress(value)`
  (shown as the job's result while it runs). A handler throws to
  fail and is retried with back-off; `PermanentJobError` stops the retries, and
  `RetryLaterError(message, seconds | date)` asks for the next attempt no sooner than then (at
  least one second, at most six hours; it still counts as an attempt).
  `DeferJobError(message, seconds | date)` puts the job back until then without using up an attempt
  (for work that was not tried). `register(type, handler, { lane })` puts a job type in its own lane:
  each lane works through its due jobs alongside the others, so slow work (such as `mail.send`, lane
  `mail`) never holds up the rest. Administrators
  see the queue under Background jobs. The poller starts when the server listens (never
  under tests, which call `app.jobs.runDue()`); `GRC_JOBS=off` keeps it stopped.
- PDFs (`PdfBuilder`, `core/export/pdf.ts`) take `branding: await printBranding(db)` (`core/organization.ts`):
  the organization's name and address in every page's footer, its logo on the first page or
  cover, its brand color for rules. Pass it in every new PDF. Emails get the organization's
  logo (inline, `MAIL_LOGO_CID`), name and footer by themselves; HTML documents use
  `printBranding().logoDataUri`. Every PDF is tagged for PDF/UA (E41-13): use `PdfBuilder`, or for
  pages drawn by hand `taggedDocument`, `setBaseFont`, `structOf` and `asArtifact` from
  `core/export/pdf.ts`. Never use the standard fonts (not embedded). Check new PDFs in tests with
  `checkPdfUa(buffer)` from `core/export/pdfua.ts` (pdf.js); `pdfText` reads
  embedded-font text. `pdfjs-dist` is a runtime dependency since wave 22 (it also reads the text of
  attached files, E41-16), not only the PDF/UA test check. Text extraction from attached files runs in
  a child process (`attachments/text-reader.mjs`); never call pdf.js on untrusted files inside the
  server process.
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
then modules alphabetically, tracked in `schema_migrations`. **Never edit or delete a migration
that is in a release** (any `v*` tag, from v0.1.0 on): installations have applied it, and the edit
would never run there. Add a new migration instead. A migration added since the last release may
still be edited until the next release is tagged.
A checksum of each applied migration is recorded: start-up and `status` warn when an applied
migration has changed, and continuous integration ("Released migrations unchanged") fails when a
migration in the last release tag differs.
A restore or `import-all` of an export builds the schema with the export's own migrations, loads
the rows, then applies the newer ones (`ops/export.ts` `importStaged`), so a migration may change
existing data and it will also run on restored backups.
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
  // rowRule: { where: (user, col) => `(${col('audience')} <> 'agents' or ...)`, figures: 'mask' | 'filter', hidden?: (col) => '...' },
  //   a per-row rule beyond the restricted flag (core/module.ts RowRule). Core makes it part of
  //   visibleWhere/find/labels, so every reader follows it; never enforce row access with a URL hook.
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

A record save through the resource engine (create, update, delete) runs in `ctx.db.atomic(fn)`
(E40-03): its hooks' queries on `ctx.db` go into one transaction with the row and its audit event,
and a `db.tx` inside is a savepoint. Effects outside the database wait for the commit: wrap them in
`afterCommit(fn)` from `core/db.ts` (the job queue does). `inTrial()` is also true while the save's
transaction is open. Record-change listeners run after the commit. Linking a record (a `ref` field)
needs view permission on the linked area, except on the portal and mobile sync routes.

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

`scope: { department?: col | (col) => sql, site?: … }` says where a record belongs, for role grants
scoped to departments or sites (E41-01, `core/scope.ts`); core adds the rule to `visibleWhere`, never
to figures. A person whose roles scope any module may not change the facts scope is worked out from
(department or site manager and parent, merges, their own roster row); check
`mayChangeScopeSources(user)` from `core/scope.ts` in any new route that changes them. `directory: true` lets every signed-in person pick and read a type's names (departments).
A type that used to keep its department as text uses `departmentPrepare(ctx.db)` as its `prepare`
hook and a module migration that adds `department_id`, converts the text and adds the
`grc_department_name` trigger (core migration 031).

Record types defined while the application runs (registers, E41-06) use `ResourceDef.partition`
(several types sharing one table, each seeing only its own rows, search included) and are held in
`app.runtimeResources`; `resolveRecordRoutes` serves their generated routes under one path
(`/api/registers/:register`), and `defineRuntimeArea` gives each its own feature switch.

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
| `GET /api/ready` | `{ ok, database, jobs, mail }` (jobs: `ok`, `off`, `behind` or `stalled`; mail: `ok`, `off` or `failing`); 503 when the database does not answer within 2 s or this process's job poller is stalled (public; container health check) |
| `GET /api/ops/metrics` | Prometheus metrics, off unless `GRC_METRICS_TOKEN` is set; bearer token (public route, own token) |
| `GET /api/branding`, `/api/branding/logo/:variant` | The organization's public look: names, colors as tokens per theme, logo addresses (public; `publicBranding` in `core/organization.ts` never includes the address or contacts) |
| `GET /api/auth/state` | `{ appName, branding, timeZone, currency, setupRequired, user, permissions, features, areasOff, pilot, mfa... }` (public) |
| `POST /api/setup` | First-run administrator (public, only while no users exist) |
| `/api/admin/lifecycles`, `/api/admin/lifecycles/:type` (GET, PUT, DELETE) | Lifecycle rules per record type (`admin.administer`) |
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
| `GET /api/metrics` | Metrics modules offer for computed indicators, with values for `month=YYYY-MM` (signed in; see [Metrics](#metrics-shared-registry)) |
| `/api/me/tokens`, `/api/admin/tokens` | Personal access tokens |
| `/api/admin/webhooks...` | Webhooks and their deliveries |
| `/api/admin/custom-fields...`, `/api/admin/retention...` | Custom fields; retention schedule and reviews |
| `GET /api/records/:type/:id/pdf` | A record's PDF fact sheet (needs `<module>.export`) |
| `/api/import/:type...`, `GET /api/import/history` | Import from CSV or Excel: fields, template, read (check), run; creating needs `<module>.create`, updating `<module>.edit` |
| `/mcp` | The MCP endpoint for AI assistants (tokens with the `mcp.use` scope only; see [AI assistant access](mcp.md)) |
| `/.well-known/oauth-*`, `/oauth/*` | OAuth 2.1 for remote MCP connectors (off by default; [AI assistant access](mcp.md)) |

**Versioning.** Every `/api/...` route is also served at `/api/v1/...`, the stable base path for
integrators; the web application keeps using `/api` (see the [integration guide](api.md)).
`canonicalRequestUrl` (`core/api/versioning.ts`, the server's `rewriteUrl`) routes `/api/v1/x` as
`/api/x` before routing, so there is one route per handler and every hook sees the same `req.url`
and `req.routeOptions.url`. The same step refuses with `400 bad_path` a path the router would read
differently from how it is written (encoded unreserved characters, encoded `/` or `\`, malformed
escapes, `.`/`..` segments). A guard keyed on the matched route uses `routePattern(req)`, which also
maps a renamed route's deprecated alias to its replacement. `core/api/canonical-paths.test.ts`
walks every route under both spellings. List paging uses `pageOf(query)` from
`core/api/conventions.ts` (whole numbers, page capped at 1,000,000).

**Conventions** (`core/api/conventions.ts`, applied centrally to generated routes):
`ETag` on one record, and `If-Match` on a `PATCH` or `DELETE` refused with 409
`version_conflict` when the record has changed (checked in the save itself, so it holds across
server processes); `Idempotency-Key` on a create replays the
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

### Lifecycles (E14-31)

`core/lifecycle.ts` holds, per record type, the moves that are not allowed (stored as `blocked`
[from, to] pairs; from `''` is a new record), the fields each status needs, and who may set it (a
permission or roles). `create` and `update` call `checkLifecycle` before the module's hooks for
requests with a person (system work is exempt), refusing with 400 `validation`; it can only
restrict, so a module's own rules still apply. The status field is `status` (or `stage`) when it is
a lookup that is not read-only; a read-only status is managed by the application. A module with
lifecycle rules in code adds a line to `APPLICATION_RULES` so the page shows them.
`app.lifecycles.check(def, existing, data, req)` is there for hand-written routes. With no rule
saved, a type allows every move and requires nothing. A hand-written route that saves as system
work on someone's behalf (for example `PATCH /api/actions/shared/:id`) calls `app.lifecycles.check`,
`held` and `hold` with the person's request first.

A move may wait for an approval workflow (E14-37): `approvals` [from, to, workflow id] in
`lifecycle_rules` (core migration 018). `lifecycles.held()` and `hold()` are called by
`resources.update`: the status is removed from the patch, the rest is saved, and the workflows
module (`MoveHolder`, set with `app.lifecycles.setHolder`) starts the workflow with `data.move`.
Approval updates the status with no request; the response carries `_pending_move`, and the web API
client then fires `grc:move-held`. While a move waits, `check()` refuses another status change.
Hand-written status controls on the web use `web/src/core/lifecycleMenus.ts`; bulk edit offers only
the statuses every selected record may move to.

### Permissions

Strings of the form `<module>.<action>`; actions: `view`, `create`, `edit`, `delete`,
`approve`, `administer`, `export`. Role grants may use wildcards (`tickets.*`, `*`).
Module keys (fixed, `MODULE_KEYS` in `server/src/modules/admin/shared.ts`): `tickets`,
`knowledge`, `assets`, `systems`, `sites`, `data`, `changes`, `vendors`, `contracts`,
`frameworks`, `risks`, `security`, `vulnerabilities`, `policies`, `training`,
`exceptions`, `obligations`, `exercises`, `actions`, `projects`, `dashboards`, `reports`,
`audit`, `admin`, `portal`, `fleet`, `safety`, `audits`, `controls`, `funding`, `governance`,
`people`, `continuity`, `legal`, `records`, `privacy`, `tags`. A new key is added there and here. The last four
belong to the wave 11 parts (business continuity, legal holds, records requests, privacy
assessments). Asset condition shares `assets`, `sites` and `fleet`, and OT security and user access reviews share `systems`.
A module may also offer actions of its own (`MODULE_ACTIONS` in the same file): asset tags have
`tags.manage` and `tags.count` besides `tags.view`; the role editor shows those columns only in that
module's row, and `isValidGrant` accepts them only there. A register's key (E41-06) is a permission
module of its own, added while the application runs.

Default roles (`server/src/core/services.ts`): Administrator, Agent, Security lead,
Project manager, Safety manager, Compliance officer, Audit lead, Training coordinator, Continuity
manager, Records and privacy officer and Asset manager are enabled; Approver, Executive viewer, Auditor and Requester are present but switched off until an
administrator enables them. A new default role is created on an existing database at the next
start; new grants on an existing role reach it only when an administrator applies them with
"Sync default grants" on the Roles page (`defaultGrantDifferences`, `syncDefaultGrants`).

Restricted records (security incidents, risks, vulnerabilities, anything flagged) are
invisible without `security.view` in lists, counts, search, links, exports and stats.
`defineResource` enforces this; hand-written routes must too
(`ctx.resources.find(type, id, req.user)` for one record,
`ctx.resources.visibleWhere(type, req.user)` in SQL). Actions are `restricted: 'flag'`
and inherit the flag from their source record. Sensitive administrative routes call
`sensitive(ctx, req, what)` (`modules/admin/shared.ts`), which needs a recent password
confirmation (`POST /api/auth/confirm`).

### Outside reviewer accounts

Module `outsidereviews` (not an area) confines accounts listed in `outside_reviewers` with an
`onRequest` hook (`gate.ts`): they hold no roles and reach only `REVIEWER_ROUTES`. A new route needs
nothing to stay out of their reach. Kinds of invitation are listed in `subjects.ts`
(`audit_engagement`, `compliance_review`); their staff routes hang under the record type's path, so
they follow its area. The state grant `outsidereviews.reviewer` makes `App.tsx` show `ReviewerApp`.
Reviewer accounts fail closed in core (`core/reviewers.ts`: `isReviewerAccount`, `reviewerSql`):
every place that loads a person gives them no permission, role assignment refuses them
(`REVIEWER_ROLES_MESSAGE`) and staff pickers leave them out. Leave them out of any new
hand-written recipient or picker query with `not ${await reviewerSql(db, 'u.id')}`.

### Feature switches (optional areas)

Dashboards read `GET /api/dashboards/switched-off-types` and leave widgets of switched-off areas
out; a standard dashboard made only of them is not listed. Suite 09 also switches the service
desk, portal and vendors off to check dashboards.

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
`app.switchedOffPaths()`), and stay out of the daily email summary until it is on again (`shownSql`
/ `switchedOffParams` in `modules/notifications/service.ts`); notification kinds, MCP tools (`installedTools`), job schedules and
retention categories follow. On the web, text that names parts of the application is written
from `areaOn` or from the fields `/api/meta` gives, never as a fixed list. The browser suite
`09-features-off` switches every area off (and then the portal, fleet and safety) and fails on
any link, label, text, drop-down option or server answer that still names one.

A new module that is optional adds itself to `AREAS` (and to `MODULE_AREA` on the web, and
`PAGE_AREA` in `web/src/modules/help/areas.ts` for its guide page). Guard cross-module code
with `ctx.resources.get(type)` and permission checks as usual, and it follows the switch.
Inventory, actions, notifications, attachments, administration, home and help are not
areas: they are always on. Neither are legal holds (permission `legal`, module folder `holds`): a
hold must never lapse because a part was switched off. Of the wave 11 areas, `condition` and `ot` share
the inventory and fleet permissions, so they hide their record types and fields by name (`types`,
`fields`). Wave 13 adds `tags` (Asset tags, on by default; it also hides the `tag_number` field of
vehicles, sites and systems) and `mobile` (Mobile app, off by default; no permission module: its module
folder `mobile` and the OAuth client kind `mobile`). Wave 20 adds `accessreviews` (User access
reviews, on by default; shares the systems permissions, so its types are hidden by name). Wave 22
adds `recordsretention` (Records retention schedule, on by default; shares the records permissions,
so its types are hidden by name).

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
  browser through every route (checking that every menu label matches the title of the page
  it opens), every role, every record type, the hand-written dialogs and
  the keyboard, module by module, every page with the optional parts switched off, and the
  Lifecycles page, and then one suite per newer module area (`01-smoke` to `23-portal`; `23-portal` takes a person with only the Requester role through the self-service portal at 390 and 1440 pixels). Options
  after `--`: `--only smoke,roles` (some suites), `--skip roles` (every suite but these; the
  numbered name, such as `03-records`, picks one of two suites with the same name), `--grep ticket` (tests whose name
  contains it), `--headed` (show the browser), `--keep` (keep the scratch data folder).
  Logs and screenshots go to `tools/e2e/out`. `node tools/e2e/serve.mjs` keeps an
  instance running, and `E2E_BASE` points the tests at it; `E2E_BROWSER` picks the
  browser and `E2E_PORT` the port. `E2E_DATABASE_URL` runs the instance on a PostgreSQL server
  instead of the embedded database: give an account that may create databases; each run creates a
  fresh `grc_e2e_…` database there and drops it afterward (`--keep` keeps it). A `GRC_DATABASE_URL`
  already in the environment is never passed to the test instance.
- `server/src/core/route-sweep.test.ts` calls every registered route signed out, as a person with no
  role, and with every optional area off; a new route is swept automatically. A route that cannot
  follow its rules goes on one of the test's exception lists with its reason.
- `npm run test:a11y`: the accessibility audit. It runs axe-core (WCAG 2.1 A and AA) on
  every route, with every optional area switched on (the portal and the mobile app start off), in light and dark at 1440 and 820 pixels wide (`--quick`: light at 1440
  only; `--routes /a,/b`; `--no-fail`), and writes `tools/a11y/out/report.md`. It fails
  on any serious or critical finding that is not listed, with its roadmap issue, in
  `tools/a11y/known.json`; remove an entry once its issue is fixed (the report lists stale
  entries). See [Accessibility](accessibility.md).
- `tools/sr/journeys.mjs` (Windows, manual only, never in CI or `npm test`): the main journeys by
  keyboard with NVDA listening; `cd tools/sr; npm install; npm run nvda` once, then
  `node journeys.mjs --only <journey>`. Own `package.json`, outside the root install, typecheck and
  tests. See [Accessibility](accessibility.md#screen-reader-run).

GitHub Actions runs the typecheck, tests and build on Windows and Linux, the tests through
the PostgreSQL wire protocol, the container build and smoke test, and the browser suite (with
the smoke, records and portal suites run again on PostgreSQL 17) followed by the accessibility audit, which fails the build on a finding not yet raised as
an issue in `tools/a11y/known.json`.

### Actions (shared contract)

The `action` record type (module folder `risks`, defined in `risks/actions-resource.ts`; API
`/api/actions`) is the one cross-module to-do list. Fields: `title`, `description`, `status` (`action_status`: open, in_progress,
blocked, pending_verification, done, canceled), `priority` (`action_priority`: high, medium, low), `owner_id`,
`due_on`, `source` (`action_source`: risk, assessment, incident, audit, exercise,
information_request, project, change, vulnerability, policy, training, vendor, problem,
inspection, control, funding, meeting, regulatory_change, other), `source_type` + `source_id` (the record it arose
from), `department`, `notes`, `restricted` (read-only: true when the source record is
restricted; such actions are hidden without `security.view`). Any module may create one with
`ctx.resources.create('action', {...})` after checking `ctx.resources.get('action')`.
Always pass `source_type` and `source_id` so the restriction is inherited.

Corrective action plans (type `cap`, `risks/caps.ts`): create one with
`ctx.resources.create('cap', { title, source, source_type, source_id, problem_statement, root_cause?, responsible_id?, due_on? })`
after checking `ctx.resources.get('cap')`, then actions with `cap_id` (they copy the plan's source and
need verification by default). Show plans on a host page with `CapPanel` from
`web/src/modules/risks/CapPanel.tsx`, loaded with `import.meta.glob`. `pending_verification` is not a
closed status, so "no open actions" rules wait for verification.

A module whose key sorts before `notifications` or `risks` adds its `notification_kind` and
`action_source` values in `register` (those lists are seeded after its own `seedDefaults`).

### Metrics (shared registry)

`core/metrics.ts` holds named monthly figures that one module offers and others read, so a computed
safety performance indicator or key risk indicator never needs another module's tables (wave 10,
E14-39). A module defines its metrics in `register`:

```ts
import { defineMetric } from '../../core/metrics.ts';
defineMetric(ctx.app, {
  key: 'actions.overdue', label: 'Overdue actions', unit: 'count',   // unit: count | percent | number
  description: 'Open actions past their due date at the end of the month.',
  recordType: 'action',          // optional: skipped while that type is not loaded or switched off
  compute: async (ctx, monthStart) => 0,   // monthStart = 'YYYY-MM-01'; null when it cannot be worked out
});
```

Readers call `metricsAvailable(ctx.app, ctx.resources)` (sorted by key). Keys are
`<module>.<name>` and unique; a malformed or duplicate key fails at start-up. A metric is a figure,
so `compute` counts every record, restricted or not, never uses `visibleWhere`, and never returns
words or people ("Figures are the same for everyone"). `GET /api/metrics` (signed in) lists the
metrics the caller may read (one about a record type needs view on its module) and, with
`month=YYYY-MM`, their values; a metric that fails gives `null` with an `error` and is logged.
The wave 10 plan's keys: `actions.overdue`, `actions.caps_overdue`,
`actions.awaiting_verification`, `audits.inspections_on_time_pct`, `audits.findings_overdue`,
`training.compliance_pct`, `training.certifications_expired`, `controls.tests_overdue`,
`controls.ineffective` and `safety.hazard_reviews_on_time_pct`. Wave 11 adds
`continuity.processes_with_gap` (current month only), `continuity.plans_review_overdue`,
`condition.past_useful_life_pct`, `condition.poor_condition_pct`, `condition.assessments_due`,
`ot.zones_below_target` (current state, no history), `records.requests_overdue`,
`vendors.reassessments_overdue` and `vendors.open_issues`.

Figures over time (E41-04, `modules/reports/figures.ts`) record metrics and counts monthly;
`GET /api/figures`.

### Legal holds (hook points)

A record under an active legal hold must not be deleted, removed for good, anonymized or lose its
files, whatever is switched off. `core/holds.ts` offers `holdsOn(db, type, id)` (the active holds:
`{ holdId, ref, matter }[]`), `assertNotHeld(db, type, id, 'delete' | 'anonymize' | 'remove' |
'remove_file')` (refuses with 409 `on_hold`, naming the hold's reference, never its matter) and
`heldIdsOf(db, type)` (a `Set` of held ids, for sweeps). Core calls them in the generic `DELETE`
(bulk delete from a list comes through it too), `purge`, the retention review's anonymize and
remove, and the retention sweep (held records are not flagged; the sweep answers `held`); the
attachments module calls them on file removal and skips held records' files in its purge, and
merging duplicate vulnerabilities refuses a held one. Any new path that deletes, purges or
anonymizes a record calls `assertNotHeld` first. Holds live in core tables (migration 025:
`legal_holds`, `legal_hold_records`, `legal_hold_queries`); an active hold is itself held; `holdRefsOf`
serves review lists; the generic `GET {path}/:id` carries `_holds` for `legal.view` holders. The
`holds` module (always on) owns the `legal_hold` record type, its screens and the saved queries.

### Clause checklists (shared engine)

`core/clauses.ts` (E35-05, E27-11) checks a lookup list of clauses, the organization's own, against
one record (today a contract), optionally per sub-key (the funding award a funder-required clause
belongs to). A module defines a set in `register` with `defineClauseSet(ctx.app, { key, label, list,
statusList, scopeType, subKey?, permission, auditAction, describe })`, then reads and writes through
`getChecklist(ctx, setKey, scopeId, subKey?)` and `saveChecklist(...)`; `checksOf` returns the stored
checks for reports. Each check keeps a status from the set's status list, the clause text as found
and a note, in the core table `clause_checks` (migration 026). The sets today are `security_terms`
(vendors) and `funder_clauses` (funding). Routes keep their own shapes and permission checks.

### Calendar sources (shared registry)

`core/calendar.ts` holds the dated work modules offer to a person's calendar feed (E36-03). A module
defines its sources in `register`:

```ts
import { defineCalendarSource } from '../../core/calendar.ts';
defineCalendarSource(ctx.app, {
  key: 'actions.due', label: 'My actions due', recordType: 'action', permission: 'actions.view',
  events: async (ctx, user, from, to) => [],   // { uid, title, start, end?, allDay, url, recordType, recordId }[]
});
```

`calendarSources(app, resources, user)` lists the sources a person may use (record type loaded and
switched on, permission held), sorted by key. A source is a list, not a figure: `events` returns only
what that person may see (`visibleWhere(type, user)` in every query) and is involved in, between
`from` and `to` (`YYYY-MM-DD`). Keys are `<module>.<name>` and unique.

A source is also how a module puts due work in **My work** and the **compliance calendar**
(E41-03): `work: true` lists it in My work (web widget, `GET /api/work/mine`, the mobile app and the
assistant's `my_work`), overdue items included, so its `events` must return open items whatever
their date; `anyone: true` means `events(ctx, user, from, to, scope)` honors `scope.person` (another
user's id, or null for everyone the asker may see; `whoFor(user, scope)` gives the id to match, so
queries read `($1::uuid is null or t.owner_id = $1)`); `kind` names one kind of item ("Evidence
requests"). `named: true` offers a source to a person without its permission because each item
names them (E41-02: an access review's reviewer); its `events` must return only items naming the
asker, and it cannot be `anyone`. Events carry `personId` and `ref`.
`checkedEvents(ctx, user, sources, from, to, scope?)` re-checks each record with `visibleWhere`
(feeds and the `work` module use it); `areaOf(source, resources)` gives the feature area for
filters. Wave 21 adds `projects.certification` (open certification requirements, for their
verifier). The `work` module (`server/src/modules/work`, `web/src/modules/work`, shapes in
`shared/work-api.ts`) has no data of its own.

### Taggable types (shared registry)

`core/asset-tags.ts` (wave 13, E37-01) lists the record types that can carry an asset tag value, so the
`tags` module never needs another module's code. A module registers its types in `register`:

```ts
import { defineTaggable } from '../../core/asset-tags.ts';
defineTaggable(ctx.app, {
  type: 'vehicle', field: 'tag_number',            // the text field holding the record's current value
  identifiers: [{ field: 'fleet_number', label: 'Fleet number' }],   // other exact identifiers for lookup
  siteField: 'depot_id', statusField: 'status', facts: ['mode'], quickFields: ['status', 'depot_id'],
});
```

`taggables(app, ctx.resources)` lists the types in use (loaded and switched on); `allTaggables(app)` lists
every one (retention, holds). Inventory registers assets (`tag`), sites and systems
(`inventory/fields-tags.ts`) and fleet registers vehicles (`fleet/fields-tags.ts`). The values are
unique across every taggable type: `tag_assignments` (modules/tags) is the source of truth, with a
unique index on the comparison form `value_key` of active values (`valueKey` in `shared/tag-format.ts`),
and the record's field is a copy of its primary active value. The API base is `/api/asset-tags`:
`/api/tags` is the free-text labels any record can carry (`core/tags.ts`), a different thing.
Inventory counts expect the records of taggable types with a `siteField`; systems (no site) are not
counted. Several modules may clean up the same taggable type when it is anonymized: `onAnonymize(type,
hook, owner)` keeps one hook per owner and runs them all (`core/retention.ts`). The tags module wraps
each taggable type's `beforeCreate` and `beforeUpdate` once the app is ready, so every way of writing a
tag value (forms, imports, bulk edits, the app, the tag routes) claims, replaces or ends it through one
code path; a module that keeps per-record rows for taggable types anonymizes them with
`onTaggableAnonymize` (`modules/tags/store.ts`). Existing values are claimed at start-up and by the
daily job `tags.reconcile`; a value found on two records is logged and never moved.

Printing tags (`modules/tags/print*.ts`) plans each label once (`print-label.ts`, in millimeters) and
draws that plan as a PDF (PDFKit) or as ZPL for thermal printers; codes (Code 128, QR, Data Matrix)
come from **bwip-js** (MIT, pure JavaScript, the only barcode dependency, server only). Label PDFs
carry no page header or footer (`printBranding` is used only for the logo inside the label).

### Inventory extensions

Optional modules add fields and panels to inventory records without editing inventory. Server: the
field maps in `inventory/fields-ot.ts`, `fields-condition.ts` and `fields-privacy.ts` (and
`fleet/fields-condition.ts`) are spread into the `system`, `asset`, `site`, `data_category` and
`vehicle` definitions, and each file's `ensure<Name>Lists(ctx)` runs in `seedDefaults`; each file has
one owner. Web: a module ships `web/src/modules/<module>/InventoryPanel.tsx` exporting
`panels: InventoryPanelDef[]` (`{ key, label, area?, appliesTo, Panel }`, `inventory/Extensions.tsx`);
a panel is an extra tab on a system and an extra section under the summary of an asset, site or data
category, and is left out while its area is off. Since wave 13 a panel may also apply to `vehicle` (an
extra tab on the vehicle page). Lists take extensions the same way: `<module>/ListActions.tsx` exporting
`listActions` (controls beside the buttons of the asset, site, system and vehicle lists, such as the
"Find by tag number" box) and `<module>/BulkActions.tsx` exporting `bulkActions` (buttons in the bulk bar
while rows are selected; ResourceList's `bulkActions` prop). An administrator's user page takes cards
from `<module>/UserCard.tsx` (`userCards`, `admin/UserExtensions.tsx`), and the global search takes
entries from `<module>/PaletteProvider.ts` (`paletteProvider`, `core/CommandPalette.tsx`), each left out
while its area is off.

### Shared code and the mobile app

`shared/` holds plain TypeScript the server, the web application and the app import by relative path
with the `.ts` extension (the web and app tsconfigs allow it; the container image copies `shared/`).
Its files import nothing outside `shared/`. `mobile/` is an Expo app with its own `package.json` and
lockfile: `cd mobile; npm ci; npm run typecheck; npm test` (Jest with React Native Testing Library). The
root install, typecheck, tests and container never include it. Native builds run in GitHub Actions
(the `mobile` job: Android on Linux, iPhone on macOS, unsigned), and locally for Android after
`tools/install-android-tools.ps1` (or `.sh`) installs a portable JDK 17 and Android SDK into `.tools/`;
`docs/mobile.md` covers building, signing and "Running the app against a local server". The app's
typed API client is `packages/api-client`, generated from the server's OpenAPI description for the
paths listed in its `include.json`: `npx tsx packages/api-client/generate.ts` (add `--check` to verify
it is up to date, as CI does); add a path to `include.json` to type a new API for the app. Builds and
dev servers run with `EXPO_NO_TELEMETRY=1`.

Offline work for the app (E38-10): a new kind of work is a server sync kind (`defineSyncKind`,
`modules/mobile/sync.ts`), an optional package part (`definePackagePart`, `modules/mobile/package.ts`)
and an app outbox kind (`mobile/src/offline/kinds.ts`); see [Mobile app](mobile.md#adding-a-kind-of-offline-work).
End-to-end flows: `mobile/test/maestro/run.sh` (Maestro in `.tools/maestro`, `MAESTRO_CLI_NO_ANALYTICS=1`).
Vehicle and asset models (E39) are the `models` module: `vehicle_model` (table `vehicle_models`,
permission `fleet`) and `asset_model` (`asset_models`, `assets`), with tables `vehicle_model_equipment`
and `model_changes`, and settings `models.inherited_custom` and `models.background_after`. It added
to the resource engine: `pickerWhere` (SQL a record must meet to be offered in pickers), `filledBy`
(`{ field: otherField }`: imports may leave a required field unmapped when the other is mapped),
`hooks.prepare(req, input, existing)` (before validation) and `ctx.resources.update(type, id, patch,
req, { via })` (the audit line ends "from <via>"); and on the web, `annotate` on `RecordPage` and
`EditableSummary`, `confirmSave` on `ResourceForm`, and the `grc:list-changed` window event that makes
a `ResourceList` reload.

Field work (wave 15, E38-11, E38-12) is in `modules/mobile/fieldwork.ts` (sync kinds
`inspection.answers`, `inspection.complete`, `condition.assess`, `count.found`; package parts
`inspections`, `condition`, `counts`) and the app's `src/inspections/`, `src/counts/` and
`app/fieldwork/`. The inspection completion rules are `shared/inspection-rules.ts`, used by both the
audits module and the app. The flows are `mobile/test/maestro/run-fieldwork.sh`.

### Translations

Portal and kiosk texts (E41-07) are keys in `web/src/core/i18n/locales/<code>.json` read with
`useI18n().t(key, vars)`; plural forms are `key_one`/`key_other` with `count`. App screens wrap their
texts as `export const TEXT = localized('<screen>', {...})`, with translations in
`mobile/src/i18n/<code>.ts`. Adding a language means an entry in `shared/i18n.ts` `LANGUAGES` plus
both files. `web/src/core/i18n/i18n.test.ts`, `mobile/src/i18n/i18n.test.ts` and
`npx tsx tools/i18n-missing.ts` report missing keys. A new English text in those screens needs its
Spanish in the same change.

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

A step (or branch) may carry `distinct_approvers: true`: whoever decided another step of the request
is left out of it and refused (`otherDeciders`). `decide` and `mayDecide` check the approval kind's
`approverPermission` again at decision time. Records deleted or purged through the resource engine
end their running workflows (a `ctx.resources.onChange` listener); the sweep also cancels workflows
whose record is gone and flags steps that can no longer reach their approvals (`flagStuck`, note
plus one administrator notification). A step's people are written with a compare-and-set
(`writePeople`), never a blind update.

How it sees record changes: once every module has defined its types (`onReady`), it wraps each
type's `afterCreate` and `afterUpdate` hooks; the module's own hook runs first, and a workflow
failure never fails the change. Changes the engine makes itself (outcomes) start nothing.

A module declares an approval kind with `defineApprovalKind(app, { key, recordType, label,
startsWhen, outcome, approverPermission?, route?, tellsRequester?, install?, onDecision?, onFinish })`
in `register` (`core/approval-kinds.ts`), and reaches the engine at request time with
`approvalEngine(app)`. The engine offers `start`, `running`, `latest`, `cancel`, `decide` (also with
no request, given `opts.userId`), `waiting`, `progress` and `definitions`. `install` runs once per
kind (table `workflow_kind_installs`): it uses `h.define`, `h.adopt`, `h.usersWith` and
`h.definitions`, and must never call the engine itself, because the engine waits for the install.
`onFinish` errors are kept as the workflow's outcome error. The module keeps its own rules (for
example "no work before approval") in its callbacks. Stand-ins: table `workflow_standins`; steps
carry `principals` and `standins`; decisions carry `on_behalf_of`. Change approval, catalog
requests, asset disposal, risk acceptance, project gates, corrective action plans and their due-date
extensions, audit reports, funding certifications, meeting minutes, annual plan reviews, safety
performance targets (`safety_targets`), continuity plans, impact analysis sign-off (`bia_signoff`, by the process owner), asset condition targets, legal hold
releases (`legal_hold_release`), privacy impact assessments, vendor offboarding sign-off
(`vendor_offboarding`) and records destruction (`records_destruction`) are approval kinds. A committee decision may be applied through
`decide` with `opts.userId` set to the chair (E28-06), only when the chair may decide the current step.

A step may have `branches` (2 to 5 units run side by side; step rows carry `branch` and
`group_name`) and `routes` (`[{ conditions, to: later step key | 'end' }]`, forward only;
`routeAfter`), migration `workflows/003`. In `decide`, the workflow row is locked so a step whose
groups run side by side moves on exactly once.

The follow-up issues per module are listed under E14-06 in the roadmap.

Risk scales: the two built-in scale keys are `cyber_5x5` and `hazard_4x5` (the safety
hazard matrix: four severity levels by five likelihood levels; it was `asp` before
migration `risks/002`). Safety reads `hazard_4x5` even while the risks area is off, and changes it
with `PATCH /api/safety/scale` (`safety.administer`; level names and cell ratings only).

## Web conventions

React 19 + React Router + Vite, TypeScript, plain CSS with design tokens
(`web/src/core/tokens.css`), ECharts for charts. The component library is Mantine 9,
wrapped by the core design system: import from `'../../core'` first, and use
`@mantine/core` directly only for layouts the core does not cover. See
`web/src/core/README.md` for the component catalog. Libraries are split into chunks of their own by
`VENDOR_GROUPS` in `vite.config.ts` (E18-55); charts and date pickers load with the first page that
needs them.

Every data table goes in `<TableWrap label="…">` (from core), never a hand-written `div.table-wrap`:
the label names the scroll region (usually the table's caption), and the region becomes a Tab stop
only when it scrolls, so keyboard users can reach every column (E22-48). `web/src/core/tableWrap.test.ts`
enforces this; a file that cannot use it goes on that test's list of exceptions with a reason.

List columns have a priority (`columns={[..., { field: 'owner_id', priority: 3 }]}`): 1 always shows;
when the table is wider than the page, priority 3 and then 2 columns are left out, the rightmost
first. The default is 1 for the first column, the reference, the title and `status`, and 2 for the
rest. Mark a column 1 only when the list makes no sense without it. The person can check a left-out
column in the column chooser to keep it on. A hand-written table does the same in `<TableWrap fit>`, with
`data-priority` on its headings (E18-65). Lists never scroll down inside themselves. `Tabs` puts
tabs that do not fit into a **More** menu; never wrap them or make the strip scroll. In a
`PageHeader`, give the primary action as a core `Button variant="primary"` (it comes first on record
pages) and the overflow as an icon-only `Menu` or one labeled "More" or "More actions" (always
last). A list that is the page but has no title of its own puts its New button in the page header.
Use `Notice` (not a bare Mantine `Alert`, whose role is `alert`) for messages; only `tone="error"`
is announced as urgent. Create entries name a kind of record (a noun, matching the record type's label: "Emergency activation", not "Activate a plan"); the Create menu (`FilterMenu`) has a filter box. Money is shown with core `formatCurrency` (no cents on whole amounts); only tiles, cards and chart axes use a compact form. Sample data names start with "[Sample] "; a seed that renames sample records calls `renameSamples` (`server/src/modules/inventory/seed-rename.ts`) first, since seeds find records by name. Number boxes are at most 16rem wide.

Forms register unsaved changes with `useUnsavedChanges(dirty)` (`core/unsaved.tsx`): leaving the page
asks first, dialogs ask before closing, and a session that ends mid-edit keeps the draft. Call
`release()` after saving and before navigating. The app runs on a data router
(`createBrowserRouter`) so `useBlocker` works.

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
Vendors, Cybersecurity, Safety, Governance, People, Projects, Reports, Administration, Help. A group
with no entry the person may open is not shown. `order` is unique within a group
(`web/src/core/navOrder.test.ts`); `permissions: [...]` hides an entry unless the user also holds each
one.

Quality bar: every screen has empty, loading and error states; every list
has filter, sort, saved view and export; every record shows its history.

## Record types and owners

| Module folder | Record types (`type` → table) |
|---|---|
| `tickets` | `ticket` → tickets, `problem` → problems, `knowledge_article` → knowledge_articles, `catalog_item` → catalog_items |
| `inventory` | `system` → systems, `asset` → assets, `site` → sites, `data_category` → data_categories |
| `changes` | `change` → changes |
| `vendors` | `vendor` → vendors, `contract` → contracts, `evidence_item` → evidence_items, `vendor_issue` → vendor_issues, `vendor_offboarding` → vendor_offboardings (child tables vendor_exclusion_checks, vendor_offboarding_items) |
| `frameworks` | `framework` → frameworks, `framework_outcome` → framework_outcomes, `assessment_snapshot` → assessment_snapshots |
| `risks` | `risk` → risks (restricted), `action` → actions (flag, inherited), `cap` → caps (flag, inherited), `obligation` → obligations, `regulatory_change` → regulatory_changes, `kri` → key_risk_indicators (restricted) |
| `secincidents` | `security_incident` → security_incidents (restricted), `notification_task` → notification_tasks |
| `policies` | `policy` → policies, `policy_exception` → policy_exceptions; tables `policy_person_acknowledgements`, `policy_plan_elements`, `policy_plan_reviews` |
| `training` | `course` → courses, `exercise` → exercises, `certification` → certifications |
| `people` | `person` → people, `position` → positions, `department` → departments (always on, not a feature area) |
| `audits` | `audit_area` → audit_areas, `audit_engagement` → audits (flag), `checklist_template` → checklist_templates, `inspection_schedule` → inspection_schedules, `inspection` → inspections, `audit_finding` → audit_findings (flag, inherited from its audit), `audit_request` → audit_requests (flag, inherited). The type is `audit_engagement` because `audit` would clash with the audit log (`GET /api/audit`, `audit.export`) |
| `controls` | `control` → controls, `control_test` → control_tests (child table `control_test_samples`) |
| `funding` | `funding_award` → funding_awards, `funding_certification` → funding_certifications, `compliance_review` → compliance_reviews, `review_deficiency` → review_deficiencies, `subrecipient` → subrecipients (child table subrecipient_monitoring) |
| `governance` | `committee` → committees, `meeting` → meetings, `meeting_decision` → meeting_decisions (flag, inherited from the record decided) |
| `continuity` | `business_process` → business_processes, `bia` → bia_assessments, `continuity_plan` → continuity_plans, `emergency_activation` → emergency_activations; tables process_dependencies (source of the `depends_on` links), continuity_plan_processes, call_tree_nodes, continuity_checklist_items, activation_log_entries, activation_roles, activation_checklist (no record type) |
| `condition` | `asset_class` → asset_classes, `condition_assessment` → condition_assessments (row rule: a vehicle's needs fleet.view, a site's sites.view); tables condition_targets, condition_reminders |
| `ot` | `ot_zone` → ot_zones (flag), `ot_conduit` → ot_conduits (flag, set from its two zones) |
| `accessreviews` | `system_account` → system_accounts, `access_review` → access_reviews (evidence); tables access_review_systems, access_review_items (no record type) |
| `holds` | `legal_hold` → legal_holds (core tables, migration 025; always on) |
| `registers` | `reg_<key>` → view `reg_<key>` of `register_records` (one per register an administrator defines; table `register_definitions`) |
| `recordsretention` | `record_series` → record_series, `records_destruction` → records_destructions (evidence) |
| `records` | `records_request` → records_requests (row rule: personal-data kinds need privacy.view; child table records_request_items), `privacy_assessment` → privacy_assessments |
| `vulnerabilities` | `vulnerability` → vulnerability_records (restricted) |
| `projects` | `project` → projects, `cert_item` → project_cert_items, `cert_requirement` → project_cert_requirements (flag, inherited from its source: restricted when derived from a threat kept as a risk) |
| `fleet` | `vehicle` → vehicles, `service` → services |
| `tags` | `inventory_count` → inventory_counts (child table inventory_count_items); tables tag_formats, tag_series, tag_ranges, tag_range_values, tag_stock_marks, tag_assignments, tag_lookups, tag_label_layouts, tag_verifications (no record type) |
| `mobile` | no record type: the mobile app's devices, My work, settings, the offline package and the outbox answers (`mobile_sync_items`) (waves 13 and 14, area `mobile`) |
| `push` | no record type: push notifications to the mobile app (tables `push_config`, `push_registrations`, `push_cursor`; part of the `mobile` area; `app.pushNotify(userIds)`, called by the notifications service) |
| `safety` | `hazard` → hazards, `safety_event` → safety_events (flag), `safety_indicator` → safety_indicators; tables safety_event_people, safety_event_timeline, safety_event_statements, safety_report_rules, safety_notifications, safety_indicator_values, safety_indicator_targets (no record type) |
| `reports` | `report_definition` → report_definitions, `dashboard` → dashboards, `report_schedule` → report_schedules, `report_pack` → report_packs |
| `attachments` | no record type: files on any record (table `attachments`; `AttachmentsPanel`; stored in `<data>/files`), links to documents kept elsewhere (`storage_driver = 'link'`, never fetched), and the text of PDF, .docx and plain-text files for search (table `attachment_texts`, job `attachments.text_index`, `text.ts`, `text-reader.mjs` (a child process) and `text-worker.mjs`; `attachment_texts.status` `'reading'` and `attempts` record each attempt before reading); `GET /api/attachments/:id/preview` |
| `feeds` | no record type: calendar feeds (calendar_feeds), calendar sources of earlier modules (sources.ts), work-tracker bridge (tables ticket_connectors, external_ticket_links) |
| `integrations` | no record type: user provisioning over SCIM 2.0 (scim_tokens, scim_group_roles, scim_group_members, scim_role_grants, user_external_ids), audit-log forwarding (audit_forwarders, audit_forward_log) and sealed webhook addresses (always on) |
| `portal` | no record type: the self-service portal's settings and pages (portal requests are tickets, scoped to their requester) |
| `mcp` | no record type: the `/mcp` endpoint for AI assistants and its settings |
| `notifications` | no record type: in-app notifications (tables `notifications`, `notification_preferences`; `app.notify(...)`, `NotificationBell`) |
| `admin` | users, roles, second factor, audit viewer, lookups, settings, custom fields, tokens, webhooks, retention screens |
| `lifecycles` | no record type: Administration > Lifecycles routes (`/api/admin/lifecycles`); rules and enforcement are core (`core/lifecycle.ts`, table `lifecycle_rules`) |
| `workflows` | no record type: approval workflows (tables `workflow_definitions`, `workflow_instances`, `workflow_steps`, `workflow_decisions`, `workflow_department_heads`; `/api/workflows`; the record page's approval panel `WorkflowPanel`) |
| `work` | no record type: My work and the compliance calendar, read from the calendar sources (E41-03) |
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
`fleet`; hazard, safety_event, safety_indicator → `safety`; cap → `actions`; regulatory_change →
`obligations`; kri → `risks`; certification → `training`; person, position, department → `people`; audit_area,
audit_engagement, checklist_template, inspection_schedule, inspection, audit_finding, audit_request →
`audits`; control, control_test → `controls`; funding_award, funding_certification, compliance_review,
review_deficiency, subrecipient → `funding`; committee, meeting, meeting_decision → `governance`;
vendor_issue, vendor_offboarding → `vendors`; business_process, bia, continuity_plan,
emergency_activation → `continuity`; asset_class, condition_assessment → `assets`; ot_zone,
ot_conduit, system_account, access_review → `systems`; legal_hold → `legal`; records_request → `records`; privacy_assessment →
`privacy`; inventory_count → `tags`; cert_item, cert_requirement → `projects`; record_series,
records_destruction → `records`; `reg_<key>` → the register's key (`<key>`).

Core refuses a ref field that names a record the caller cannot see (`checkRefsVisible` in
core/resource.ts); unchanged values are not checked again and system work is exempt.

A module's own tables that hold personal details about a record register `onAnonymize(type, hook)`
(`core/retention.ts`); anonymizing the record runs the hook in the same transaction. Governance registers one for
`committee`: typed names of members with no account or roster person (`committee_members.name`).

See [Known gaps](known-gaps.md) and the [roadmap](roadmap/README.md) for what is not built.

## Known gaps

Kept in [`docs/known-gaps.md`](known-gaps.md). Update it with every change.
