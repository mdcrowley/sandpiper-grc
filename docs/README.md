# Documentation

Sandpiper GRC is a governance, risk and compliance application for transit organizations
(bus, rail and paratransit operators) and their IT, cybersecurity and safety teams. It is a
prototype. Start with the [project README](../README.md) for a one-page introduction.

## For people who install and run it

| Document | What it covers |
|---|---|
| [Installation](installation.md) | Requirements on Windows, macOS and Linux, portable Node.js, first start, the setup wizard, sample data, loading your own data, environment variables, and server installation: PostgreSQL server, HTTPS, reverse proxy, containers |
| [Docker](docker.md) | Running the published container image with Docker or the compose file: quick start, data volume, secrets, upgrades |
| [Operations](operations.md) | Every `grc.ps1` command, data and logs, backup (scheduled and encrypted) and restore, upgrading and automatic rollback, health check, troubleshooting |
| [Security](security.md) | What protects the application today, what is not yet built, how to report a vulnerability |
| [AI assistant access (MCP)](mcp.md) | The MCP endpoint, tokens and scopes, settings, tools, connecting Claude Desktop, Claude Code and other clients, and the security model |
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
11. [Policies and exceptions](user/11-policies-and-exceptions.md)
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
