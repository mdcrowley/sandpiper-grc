# Documentation

Sandpiper GRC is a governance, risk and compliance application for transit organizations
(bus, rail and paratransit operators) and their IT, cybersecurity and safety teams. It is a
prototype. Start with the [project README](../README.md) for a one-page introduction.

New in wave 20: user access reviews (the accounts on each system matched to the staff roster, and
owner review campaigns with removals tracked to done); a compliance calendar and one "My work" list
of everything due across every area; board reporting with figures over time and accessible
(PDF/UA-tagged) PDFs; and roles limited to departments or sites. On Windows, download
`SandpiperGRC-Setup-<version>.exe` from the releases page
([Installation, Windows installer](installation.md#windows-installer)).

New in waves 21 and 22: confidential safety reporting; registers administrators define
(lost property, keys issued, visitors); the portal, the acknowledgment kiosk and the mobile app's
employee screens in English or Spanish, with translated policies; safety and security certification
of capital projects; outside reviewers, who give an external auditor or a funder's reviewer
time-limited access to one audit or funder review, and nothing else; vendor intake questionnaires
that set a risk tier and the checks needed before a contract becomes active, and contractor
performance measures with targets, periodic scores and trends; written test steps per control and
coverage imported from a spreadsheet; call-tree messages with acknowledgment; a records retention
schedule and destruction log; and search inside attached files, with previews of images and PDFs.

## For people who install and run it

| Document | What it covers |
|---|---|
| [Installation](installation.md) | Requirements on Windows, macOS and Linux, portable Node.js, first start, the setup wizard, sample data, loading your own data, environment variables, and server installation: PostgreSQL server, HTTPS, reverse proxy, containers |
| [Docker](docker.md) | Running the published container image with Docker or the compose file: quick start, data volume, secrets, upgrades |
| [Operations](operations.md) | Every `grc.ps1` command, data and logs, backup (scheduled and encrypted) and restore, upgrading and automatic rollback, health check, troubleshooting |
| [Security](security.md) | What protects the application today, what is not yet built, how to report a vulnerability |
| [AI assistant access (MCP)](mcp.md) | The MCP endpoint, tokens and scopes, settings, tools, connecting Claude Desktop, Claude Code and other clients, and the security model |
| [Mobile app](mobile.md) | Building the iPhone and Android app, signing, TestFlight and direct Android installs, running it against a local server, offline work, push notifications, end-to-end flows, accessibility rules, the tag photo test set |
| [Accessibility statement](accessibility.md) | How far the application meets WCAG 2.1 AA, what has been checked and the known limitations |
| [Known gaps](known-gaps.md) | The full list of what the prototype does not do. Read it before relying on the application |

## For people who use it

The user guide is in [`user/`](user/) and is also shown inside the application under Help.

1. [Getting started](user/01-getting-started.md)
2. [Service desk](user/02-service-desk.md)
3. [Inventory](user/03-inventory.md)
4. [Vendors and contracts](user/04-vendors-and-contracts.md)
5. [Cybersecurity frameworks and assessments](user/05-cybersecurity-frameworks.md)
6. [Risks, actions and obligations](user/06-risks-actions-obligations.md)
7. [Security incidents](user/07-security-incidents.md)
8. [Projects](user/08-projects.md)
9. [Administration](user/09-administration.md)
10. [Change enablement](user/10-change-enablement.md)
11. [Documents and exceptions](user/11-policies-and-exceptions.md)
12. [Training and exercises](user/12-training-and-exercises.md)
13. [Vulnerabilities](user/13-vulnerabilities.md)
14. [Attachments and notifications](user/14-attachments-and-notifications.md)
15. [Dashboards and reports](user/15-dashboards-and-reports.md)
16. [Passkeys and security keys](user/16-passkeys-and-security-keys.md)
17. [Importing and exporting](user/17-importing-and-exporting.md)
18. [Self-service portal](user/18-self-service-portal.md)
19. [Fleet and services](user/19-fleet-and-services.md)
20. [Safety management](user/20-safety-management.md)
21. [AI assistants and MCP](user/21-ai-assistants-and-mcp.md)
22. [Approval workflows](user/22-approval-workflows.md)
23. [Lifecycles: allowed status changes and required fields](user/23-lifecycles.md)
24. [Corrective action plans](user/24-corrective-action-plans.md)
25. [Audits and inspections](user/25-audits-and-inspections.md)
26. [Controls and testing](user/26-controls-and-testing.md)
27. [Funding and grants](user/27-funding-and-grants.md)
28. [Committees and meetings](user/28-committees-and-meetings.md)
29. [People and qualifications](user/29-people-and-qualifications.md)
30. [Business continuity](user/30-business-continuity.md)
31. [Asset condition](user/31-asset-condition.md)
32. [OT security](user/32-ot-security.md)
33. [Legal holds](user/33-legal-holds.md)
34. [Vendor risk lifecycle](user/34-vendor-risk-lifecycle.md)
35. [User provisioning and log forwarding](user/35-user-provisioning-and-log-forwarding.md)
36. [Calendar feeds, work trackers and evidence links](user/36-calendar-feeds-work-trackers-and-evidence-links.md)
37. [Records requests and privacy](user/37-records-requests-and-privacy.md)
38. [Asset tags](user/38-asset-tags.md)
39. [The mobile app](user/39-mobile-app.md)
40. [User access reviews](user/40-user-access-reviews.md)
41. [Registers](user/41-registers.md)
42. [Records retention schedule](user/42-records-retention-schedule.md)
43. [Evidence library](user/43-evidence-library.md)

## For people who integrate with it

| Document | What it covers |
|---|---|
| [Integration guide: the REST API](api.md) | Personal access tokens, the stable base path `/api/v1`, the generated record routes, paging, filtering, exports and imports, webhooks, errors, request ids, rate limits, idempotency and optimistic concurrency. The full reference is also in the application under Help > API reference |
| [AI assistant access (MCP)](mcp.md) | Connecting an AI assistant that works as the signed-in person |

## For people who develop it

| Document | What it covers |
|---|---|
| [Architecture](architecture.md) | The stack, process model, request lifecycle, module system, resource engine, data model, authentication and authorization, testing, how to add a module, hosting, path to production |
| [Developer guide](development.md) | Hard rules, commands, environment variables and settings, tests (unit, browser and accessibility), and the detailed API reference: module shape, `defineResource`, generated routes, core routes, permissions, record types |
| [`web/src/core/README.md`](../web/src/core/README.md) | The web component catalog |
| [Roadmap](roadmap/README.md) | Planned work, as epics and issues |
| [Known gaps](known-gaps.md) | What is missing or incomplete today |

## Conventions in these documents

- Commands are shown for Windows PowerShell, run from the repository root. On macOS and
  Linux, `./grc.sh` takes the same commands (see [Installation](installation.md)).
- `.\grc.ps1` (or `./grc.sh`) is the single entry point; it puts the portable Node.js on
  the path for you.
- Nothing here is specific to one organization or jurisdiction. Examples use invented data.
