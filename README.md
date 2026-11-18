# Sandpiper GRC

An IT governance, risk and compliance platform for a small IT team, in one application:

- **Service desk**: incidents and requests with SLA clocks, problems, knowledge base, catalogue
- **Inventory**: systems, assets, sites, data categories and a relationship map
- **Vendors**: contracts, a security-terms matrix, evidence and a renewal calendar
- **Cybersecurity**: framework outcomes (NIST CSF 2.0 included) with assessments over time,
  a risk register with configurable scales and a heat map, an action tracker, an
  obligations register, and security incidents with notification deadline clocks
- **Change enablement**: risk-scored changes, approvals, a calendar with blackout periods and conflict warnings
- **Policies and exceptions**: versions, publishing, acknowledgement tracking, time-limited exceptions
- **Training and exercises**: courses, assignments, completion tracking, tabletop and restore tests
- **Vulnerabilities**: findings with fix-by dates, scanner CSV import, dashboard
- **Projects**: tiers, stage gates with checklists, status reports and portfolio views
- **Everywhere**: attachments, in-app notifications, comments, history, search, CSV export
- **Administration**: users, roles, second factor, configurable lists, settings, audit log

**Status: prototype.** It runs locally on one Windows machine for evaluation. It is not
hardened for production; read `docs/known-gaps.md` before relying on it.

## Run it

Windows, no admin rights, no Docker.

1. `powershell -ExecutionPolicy Bypass -File tools\install-node.ps1` (downloads the pinned
   Node.js LTS into `.tools\node` and verifies its checksum).
2. `.\grc.ps1 npm install`
3. `.\grc.ps1 seed -Profile dev` (optional: invented sample data)
4. `.\grc.ps1 start`, then open http://127.0.0.1:8080

The first visit shows a setup wizard that creates the administrator. There is no default
account. The server listens on 127.0.0.1 only and makes no outbound connections.

Other commands: `stop`, `restart`, `health`, `status`, `logs`, `dev`, `build`, `test`,
`typecheck`, `backup`, `restore`, `upgrade`, `export-all`, `import-all`. See
[docs/operations.md](docs/operations.md).

## Documentation

- **User guide**: [docs/user](docs/user/01-getting-started.md), also inside the application under **Help**
- **Installation, operations, architecture, security**: [docs](docs/README.md)
- **Roadmap** (epics and issues): [docs/roadmap](docs/roadmap/README.md)
- **Known gaps**: [docs/known-gaps.md](docs/known-gaps.md)

## Make it yours

Nothing in this repository is specific to one organisation. Your own name, lists,
obligations and incident notification rules go in a private **organisation profile**:
copy `examples/organisation.example.json` to `seed/organisation.json`, edit it, and run
`.\grc.ps1 seed`. The `seed/` folder is git-ignored. Everything in the profile can also be
entered or changed in the application afterwards.

Set `GRC_TIMEZONE` (for example `Europe/London`) and `GRC_CURRENCY` (for example `GBP`)
before starting if the machine's time zone or US dollars are not what you want.

Incident notification rules ship as inactive placeholders. Deadlines and recipients depend
on your law, regulators, contracts and insurer: set them yourself, with legal advice.

## Technology

TypeScript throughout. Fastify and embedded Postgres (PGlite) on the server; React, Vite,
Mantine and ECharts on the web. `CLAUDE.md` describes the structure and conventions in detail.
