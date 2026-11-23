# Sandpiper GRC

[![CI](https://github.com/mdcrowley/sandpiper-grc/actions/workflows/ci.yml/badge.svg)](https://github.com/mdcrowley/sandpiper-grc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Governance, risk and compliance for transit organizations, in one open-source application.**

Bus, rail and paratransit operators, and the IT, cybersecurity and safety teams inside
them, keep their service desk, inventory, changes, vendors, risks, safety hazards,
incidents, policies and projects in one place. It suits a small team, assumes no country or
regulator, and nothing in it is specific to one organization.

## Features

- **Service desk**: incidents and requests with service-level clocks, problems, a knowledge
  base, a service catalog, email to ticket and a self-service portal for staff
- **Inventory, fleet and services**: systems, assets, sites and data categories with a
  relationship map; vehicles and on-vehicle equipment; "what is affected" when a system fails;
  asset condition and state of good repair (useful life, condition assessments, yearly targets);
  OT and rail-systems security zones and conduits
- **Change enablement**: risk-scored changes, approvals, a change calendar with blackout periods
- **Vendors and contracts**: security-terms checklist, evidence with expiry, assessments, renewals,
  reassessment on a cadence, exclusion-list checks, vendor issues and offboarding
- **Business continuity**: business processes, impact analyses, continuity and emergency plans
  with call trees, a recovery gap report and emergency activations
- **Legal holds, records requests and privacy**: holds that stop deletion and anonymizing
  everywhere, records and personal-data requests against a deadline, privacy impact assessments
- **Risk, safety and compliance**: risk register and heat map, a safety hazard log and safety
  events, NIST CSF 2.0 outcomes, obligations, policies, training and vulnerabilities
- **Security incidents**: a restricted workspace with notification clocks you configure
- **Approval workflows**: approval steps on any kind of record (change approval, catalog
  requests, asset disposal, risk acceptance and project gates included), run in order or side by
  side and routed by condition, with due times, escalation, stand-ins and an Approvals page for
  each person; allowed status changes, required fields and status changes that wait for
  approval, set per record type
- **Projects and reporting**: portfolio and stage gates, dashboards, a report builder,
  exports to Excel, CSV and PDF
- **Asset tags and the mobile app**: tag numbers, barcodes and QR or Data Matrix codes on assets,
  vehicles, sites and systems, printed labels and inventory counts; an iPhone and Android app (beta)
  that reads tags with the camera, reports problems and hazards with photos, runs inspections,
  condition assessments and counts offline, decides approvals and sends push notifications (off
  until switched on)
- **Sign-in and security**: single sign-on (OpenID Connect, SAML 2.0 or a directory over LDAP), passkeys, second factor,
  roles, restricted records and a full audit log
- **Integrations**: a REST API with an OpenAPI description, webhooks (also as chat messages),
  user provisioning over SCIM 2.0, audit-log forwarding, personal calendar feeds, a two-way
  bridge to an outside work-tracking tool, evidence links to documents kept elsewhere, and AI
  assistant access over MCP (Claude Desktop, Claude Code and other MCP clients, by token or
  OAuth), all off until switched on
- **Your organization**: name, address, contacts, logo and brand colors (kept readable in
  light and dark) on screens, emails and PDFs
- **Use only what you need**: switch optional areas (for example fleet or safety) off under
  Administration > Features, and they disappear everywhere; the data is kept
- **Runs anywhere**: an embedded database or PostgreSQL, a container image for amd64 and
  arm64, verified and optionally encrypted backups, and upgrades that roll back on failure

## Quick start

With Docker:

```sh
git clone https://github.com/mdcrowley/sandpiper-grc.git && cd sandpiper-grc
docker compose up -d
# open http://127.0.0.1:8080 and complete the setup wizard
```

From source: install Node.js 24 with `tools/install-node.ps1` (Windows) or
`tools/install-node.sh` (macOS, Linux), then `.\grc.ps1 start` or `./grc.sh start`. Step by
step for each system: [Installation](docs/installation.md).

The first visit shows a setup wizard that creates the administrator; there is no default
account. Load invented sample data for a bus and light-rail operator with `seed --profile dev`
([Sample data](docs/installation.md#sample-data)).

## Documentation

- [Installation](docs/installation.md): Docker, Windows, macOS, Linux and servers
- [Docker](docs/docker.md): configuration, volumes, backups, upgrades, PostgreSQL, HTTPS
- [Operations](docs/operations.md): backup, restore, export, upgrade, troubleshooting
- [User guide](docs/user/01-getting-started.md), also in the application under **Help**
- [REST API](docs/api.md) and [AI assistant access (MCP)](docs/mcp.md)
- [Mobile app](docs/mobile.md): building, signing and distributing the iPhone and Android app
- [Security](docs/security.md), [Known gaps](docs/known-gaps.md) and [Accessibility](docs/accessibility.md)
- [Contributing](CONTRIBUTING.md) and the [developer guide](docs/development.md)
- [Roadmap](docs/roadmap/README.md) and the [documentation index](docs/README.md)

## Status

**Prototype.** It has not had an independent security review; read
[Known gaps](docs/known-gaps.md) before relying on it. Report vulnerabilities privately as
described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). TypeScript throughout: Fastify with embedded PostgreSQL (PGlite) or a
PostgreSQL server, and React, Vite, Mantine and ECharts on the web.
