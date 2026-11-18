# Documentation

Sandpiper GRC is a local prototype of an IT governance, risk and compliance application for
a small IT team. Start with the [project README](../README.md) for a one-page introduction.

## For people who install and run it

| Document | What it covers |
|---|---|
| [Installation](installation.md) | Requirements, portable Node.js, first start, the setup wizard, sample data, loading your own data, environment variables |
| [Operations](operations.md) | Every `grc.ps1` command, data and logs, backup and restore, upgrading, health check, troubleshooting |
| [Security](security.md) | What protects the application today, what is not yet built, how to report a vulnerability |
| [Known gaps](known-gaps.md) | The full list of what the prototype does not do. Read it before relying on the application |

## For people who use it

The user guide is in [`user/`](user/) and is also shown inside the application under Help.

1. [Getting started](user/01-getting-started.md)
2. `user/02-…md` to `user/08-…md`: one page per area of the application
3. [Administration](user/09-administration.md)

## For people who develop it

| Document | What it covers |
|---|---|
| [Architecture](architecture.md) | The stack, process model, request lifecycle, module system, resource engine, data model, authentication and authorisation, testing, how to add a module, path to production |
| [`CLAUDE.md`](../CLAUDE.md) | Developer conventions and the detailed API reference: module shape, `defineResource`, generated routes, core routes, permissions, record types |
| [`web/src/core/README.md`](../web/src/core/README.md) | The web component catalogue |
| [Roadmap](roadmap/README.md) | Planned work, as epics and issues |
| [Known gaps](known-gaps.md) | What is missing or incomplete today |

## Conventions in these documents

- Commands are for Windows PowerShell, run from the repository root.
- `.\grc.ps1` is the single entry point; it puts the portable Node.js on the path for you.
- Nothing here is specific to one organisation. Examples use invented data.
