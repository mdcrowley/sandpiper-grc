# Sandpiper GRC

[![CI](https://github.com/mdcrowley/sandpiper-grc/actions/workflows/ci.yml/badge.svg)](https://github.com/mdcrowley/sandpiper-grc/actions/workflows/ci.yml)

**Governance, risk and compliance for transit organisations, in one open-source application.**

## Who it is for

Bus, rail and paratransit operators, and the IT, cybersecurity and safety teams inside
them. Sandpiper GRC keeps the records those teams need in one place: the service desk and
the systems and equipment it supports (including what runs on the vehicles), the changes
made to them, the vendors that supply them, the risks and safety hazards around them, the
framework outcomes and obligations they are measured against, and the incidents, policies,
training and projects that tie it together. It suits a small team, makes no assumption
about country or regulator, and nothing in it is specific to one organisation.

## What it does

- **Service desk**: incidents and requests with service-level clocks, approvals, major
  incidents, problems and known errors, a knowledge base and a service catalogue
- **Inventory and relationship map**: systems, assets, sites and data categories, with a
  map of how they connect; asset types and hosting for on-vehicle equipment (fare
  equipment, vehicle location units, on-vehicle routers, cameras, passenger information
  displays); check-out and disposal approval
- **Fleet and services**: vehicles, the equipment installed on them and gaps in that
  coverage, routes and services and the systems they depend on, and "what is affected"
  when a system fails
- **Change enablement**: standard, normal and emergency changes with risk scoring,
  approvals, a change calendar with blackout periods and conflict warnings, and
  post-implementation review
- **Vendors and contracts**: contracts, a security-terms checklist and matrix, evidence
  with expiry dates, vendor assessments and a renewal calendar
- **Framework outcomes**: NIST CSF 2.0 included, with coverage of other frameworks and
  assessments over time
- **Risks**: a risk register with configurable scales, a cyber 5x5 scale and the safety
  hazard matrix (four severity levels by five likelihood levels), a heat map, treatment,
  acceptances and reviews
- **Safety management**: a hazard log scored on the safety hazard matrix, safety events
  and their investigations, corrective actions and safety performance indicators
- **Actions**: one action tracker shared by every area, which inherits restriction from
  the record an action arose from
- **Obligations**: an obligations register and information requests
- **Security incidents**: a restricted incident workspace with notification clocks and
  deadlines, scenario checklists (including dispatch or CAD/AVL outage, fare system
  compromise and onboard network compromise), a log, roles, a ransom-payment control,
  lessons learned and a printable offline kit. Notification rules ship switched off: each
  organisation sets its own
- **Policies and exceptions**: versions, approval and publishing, acknowledgement
  tracking, mapping to framework outcomes, and time-limited exceptions
- **Training and exercises**: courses, assignments, completion tracking and import,
  tabletop exercises and restore tests
- **Vulnerabilities**: findings with fix-by dates from a severity policy, scanner CSV
  import and a dashboard
- **Projects and portfolio**: intake, tiers, stage gates with checklists, status reports,
  a risk and issue register, milestones and portfolio views
- **Dashboards and report builder**: an overview page, user-built reports and
  dashboards, sharing, report packs and scheduled delivery
- **Self-service portal**: a simple area where any member of staff raises and follows
  their own requests (off until an administrator switches it on)
- **Attachments**: files on any record, evidence files with expiry, optional malware
  scanning with ClamAV, an optional S3-compatible object store, and removed files purged
  after a set period
- **Notifications and email**: in-app notifications, and email notifications and daily
  digests (off until an administrator sets up a mail server), sent through a background
  job queue
- **Exports and imports**: any list to Excel, CSV or PDF; a PDF fact sheet for any record;
  import of any record type from CSV or Excel
- **Sign-in**: single sign-on with OpenID Connect (any compliant provider), account
  linking and a break-glass administrator; passkeys and hardware security keys; a second
  factor required by default on a new installation
- **API and webhooks**: a stable REST API at `/api/v1` with personal access tokens and an
  OpenAPI description (see the [integration guide](docs/api.md), and Help > API reference
  in the application), and webhooks (off until an administrator allows outbound
  connections to named hosts)
- **AI assistant access (MCP)**: Claude Desktop, Claude Code and other MCP clients can
  work in the application as the signed-in person, within that person's permissions (off
  until an administrator switches it on; see [AI assistant access](docs/mcp.md))
- **Everywhere**: comments, history, links between records, tags, watchers, custom
  fields and full-text search. Figures are the same for everyone: restricted records count
  in every total, while their details stay hidden (see [Security](docs/security.md))
- **Administration**: users, roles, second factor, configurable lists, settings,
  retention schedule and audit log
- **Hosting and operations**: an embedded database or a PostgreSQL server
  (`GRC_DATABASE_URL`), HTTPS directly or behind a reverse proxy, a container image and
  compose file; scheduled, verified and optionally encrypted backups; an upgrade that puts
  the previous version back by itself if a step fails

## Status

**Prototype.** It runs on one Windows machine for evaluation, and can also run on a server
with PostgreSQL, HTTPS or in a container ([installation](docs/installation.md#server-installation)).
It has not had an independent security review; read [known gaps](docs/known-gaps.md)
before relying on it.

## Quick start

Windows, no admin rights, no Docker.

1. `powershell -ExecutionPolicy Bypass -File tools\install-node.ps1` (downloads the pinned
   Node.js LTS into `.tools\node` and verifies its checksum).
2. `.\grc.ps1 npm install`
3. `.\grc.ps1 seed -Profile dev` (optional: invented sample data for a bus and light-rail operator)
4. `.\grc.ps1 start`, then open http://127.0.0.1:8080

The first visit shows a setup wizard that creates the administrator. There is no default
account. The server listens on 127.0.0.1 only. It makes no outbound connections until an
administrator switches one on: webhooks, email, a sign-in provider, the malware scanner or
an object store. To use passkeys on this machine, open http://localhost:8080 instead.

Other commands: `stop`, `restart`, `health`, `status`, `logs`, `dev`, `build`, `test`,
`typecheck`, `ci`, `backup`, `backups`, `verify-backup`, `restore`, `schedule-backup`,
`unschedule-backup`, `export-all`, `import-all`, `decrypt`, `new-key`, `move-files`,
`upgrade`, `save-code`. See [docs/operations.md](docs/operations.md).

### Make it yours

Your own name, lists, obligations and incident notification rules go in a private
**organisation profile**: copy `examples/organisation.example.json` to
`seed/organisation.json`, edit it, and run `.\grc.ps1 seed`. The `seed/` folder is
git-ignored. Everything in the profile can also be entered or changed in the application
afterwards.

Set `GRC_TIMEZONE` (for example `Europe/London`) and `GRC_CURRENCY` (for example `GBP`)
before starting if the machine's time zone or US dollars are not what you want.

Incident notification rules ship as inactive placeholders. Deadlines and recipients depend
on your law, regulators, funders, contracts and insurer: set them yourself, with legal advice.

## Documentation

- **User guide**: [docs/user](docs/user/01-getting-started.md), also inside the application under **Help**
- **Installation, operations, architecture, security**: [docs](docs/README.md)
- **Integrations**: [REST API](docs/api.md) and [AI assistant access (MCP)](docs/mcp.md)
- **Accessibility statement**: [docs/accessibility.md](docs/accessibility.md)
- **Developer guide**: [docs/development.md](docs/development.md)
- **Roadmap** (epics and issues): [docs/roadmap](docs/roadmap/README.md)
- **Known gaps**: [docs/known-gaps.md](docs/known-gaps.md)

## Technology

TypeScript throughout. Fastify on the server, with embedded Postgres (PGlite) or a
PostgreSQL server; React, Vite, Mantine and ECharts on the web.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the hard rules and
how to run the checks (`.\grc.ps1 ci`), and the [developer guide](docs/development.md)
for the conventions. The browser tests (`npm run test:e2e`) and the accessibility audit
(`npm run test:a11y`) are described there too.

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md), not
as public issues.

## Licence

Released under the [MIT License](LICENSE).
