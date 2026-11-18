# Sandpiper GRC

An IT governance, risk and compliance platform for a small IT team, in one application:

- **Service desk**: incidents and requests with SLA clocks, problems, knowledge base, catalogue
- **Inventory**: systems, assets, sites, data categories and a relationship map
- **Vendors**: contracts, a security-terms matrix, evidence and a renewal calendar
- **Cybersecurity**: framework outcomes (NIST CSF 2.0 included) with assessments over time,
  a risk register with configurable scales and a heat map, an action tracker, an
  obligations register, and security incidents with notification deadline clocks
- **Projects**: tiers, stage gates with checklists, status reports and portfolio views
- **Administration**: users, roles, second factor, configurable lists, settings, audit log

**Status: prototype.** It runs locally on one Windows machine for evaluation. It is not
hardened for production; read `docs/known-gaps.md` before relying on it.

## Run it

Windows, no admin rights, no Docker.

1. Download the Node.js 24 LTS Windows x64 zip from nodejs.org, check it against the
   published SHASUMS256.txt, and extract it so that `.tools\node\node.exe` exists.
2. `.\grc.ps1 npm install`
3. `.\grc.ps1 seed -Profile dev` (optional: invented sample data)
4. `.\grc.ps1 start`, then open http://127.0.0.1:8080

The first visit shows a setup wizard that creates the administrator. There is no default
account. The server listens on 127.0.0.1 only and makes no outbound connections.

Other commands: `stop`, `restart`, `health`, `dev`, `build`, `test`, `typecheck`, `backup`.

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

TypeScript throughout. Fastify and embedded Postgres (PGlite) on the server; React, Vite
and ECharts on the web. `CLAUDE.md` describes the structure and conventions in detail.
