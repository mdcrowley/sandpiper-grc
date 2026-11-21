# Known gaps

What the prototype does not do yet. Update with every change. The roadmap
(`docs/roadmap/`) has an issue for each item.

## Not built

Planned for wave 11 (E31 to E36): business continuity and emergency management, asset condition
and state of good repair, OT and rail-systems cybersecurity, legal hold with records and
personal-data requests and privacy assessments, the vendor risk lifecycle, and integrations
(user provisioning, audit log forwarding, calendar feeds). Their permission keys (`continuity`,
`legal`, `records`, `privacy`), feature switches and default roles (Continuity manager, Records and
privacy officer, Asset manager) exist already with nothing behind them, and so do the legal-hold
checks in every delete, removal and anonymizing path (`core/holds.ts`, holding nothing until legal
holds are built) and the calendar source registry (`core/calendar.ts`).

Not planned: drug and alcohol test results, hours-of-service and fatigue records, maintenance
work orders, which belong in specialist systems, and redaction of document content, which belongs
in a document tool (E25-13, E29-11, E32-06, E34-09).

## Built but incomplete

- **Wave 10 parts** (corrective action plans, audits and inspections, controls, funding, committees,
  the staff roster, obligations and enterprise risk):
  - `actions.closure_evidence_sources` has no settings screen yet; set it through the settings API.
  - The person asked for audit evidence answers in text only (attaching files needs `audits.edit`);
    taking inspection photos needs `audits.edit` and the attachments module.
  - The controls panel is not yet on the pages of the records a control covers (E26-11); coverage
    cannot be imported from a spreadsheet, and controls have no per-control test steps.
  - Funding: sub-recipient monitoring, and one clause checklist shared by funder clauses and contract
    security terms (E27-11); drawdowns, budgets and spending by award are left to the finance system.
  - A meeting decision can be applied only to approvals declared as an approval kind, not to
    workflows an administrator defined with no kind; typed names of committee members are not
    anonymized at the end of the retention period; meetings send no calendar invitations (E36).
  - Departments are not a record type, so person and position exports show the department's id;
    kiosk lockouts after wrong employee numbers are kept per server process.
  - Key risk indicators are monthly only; regulatory changes are entered by hand (no outside feed).
  - The new parts have no AI assistant (MCP) summary tools yet.
- **Approval workflows and lifecycles**: project gates use a workflow only once an administrator
  names one on the gate template; while no disposal workflow is active, a disposal request is
  decided once by anyone who may approve disposals. The `change.approval_decided` webhook event
  is kept for this release beside `workflow.decided`. A status change that waits for approval
  is made as system work when approved, so a part's own rules for the new status are checked
  then rather than when it was asked for; a new record's first status never waits.
- **Organization branding** (Administration > Organization): a WebP logo imported by the
  organization profile prints on PDFs and in emails only after an administrator selects **Make
  printable copy**; emails always show the light-theme logo, also in mail programs with a dark
  theme.
- **Sign-in**: single sign-on supports OpenID Connect, SAML 2.0 and a directory (LDAP).
  Directory sign-in has been tried against a stand-in directory, not a real Active
  Directory. The per-address limit on single sign-on routes is checked before an attempt and
  recorded after it, so attempts sent at the same moment can exceed it; the per-account and
  per-user-name limits count every attempt. The Change password dialog revokes API tokens and
  assistant connections unless the person checks the box to keep them.
- **Second factor**: a new installation requires it for the roles that expect one
  (Administrator and Security lead) unless setup explicitly asks for a reminder only. An
  existing installation keeps its setting.
- **Passkeys and security keys**: checked in the browser with a virtual authenticator, not
  yet with hardware keys over real HTTPS.
- **Default role changes** reach an existing database only when an administrator applies
  them on the Roles page.
- **Feature switches** (Administration > Features): a switched-off part is hidden everywhere but its switch (E14-34);
  what stays is the organization's own text: role names and descriptions, record names, incident
  playbooks and the guide's wording on pages that stay. Search still matches, and its snippet
  may show, the text of a field hidden by a switch (a system's vendor name).
- **Retention**: anonymizing or removing a record from the review list is audited and raises
  webhook events, but does not run the record type's after-save hooks. The fields anonymizing replaces are chosen
  broadly (for example a ticket's description); check the list shown for each type before
  allowing it.
- **Backups**: `backup` and `restore` cover the embedded database only; with a PostgreSQL
  server, use `pg_dump` and `pg_restore` (see [Operations](operations.md)). Files kept in
  the object store are not in backups. Restoring a backup is done from the command line only; stored files can be moved between
  the disk and the object store under Administration > File settings. Scheduled backups to a
  second location still need proving on a real installation (E16-08). On the embedded database,
  the server's own backup still pauses requests while it takes its snapshot: about a second per
  65,000 rows.
- **Exports and imports**: PDFs made by the server print text outside Western European
  languages with a font found on the machine (or named in `GRC_PDF_FONTS`); explicit
  bidirectional embedding characters are ignored. List exports stop at 50,000 rows (the file and
  the `X-GRC-Export-Truncated` header say so) and are built in memory; a PDF holds at most 12
  columns. A CSV that is not UTF-8 is read as Windows-1252; other code pages are not detected.
  The pause in sending email while the mail server is unreachable is kept per server process.
- **Custom fields**: the portal deliberately does not ask ticket custom fields of
  requesters (they are the service desk's own classification); catalog questions do that
  job.
- **API**: the `If-Match` check takes its lock in one server process only; several
  processes on one database do not share it. The Overview's figures are kept for a few
  seconds per process, so a change saved through another process shows up there after up
  to 10 seconds.
- **Hosting**: with a least-privilege database account, adding a custom field is queued
  for the database owner, and a new text custom field is searched only after the owner's
  next `migrate` step. JSON API responses are not compressed by the application (a risk with
  session-bound answers); a reverse proxy may compress them. Web assets are compressed and cached.
  Webhook addresses are stored in clear in the `webhooks` table (administrators only); audit
  entries show only their host and a fingerprint. The user services run on GitHub's Linux and macOS machines; a restart of the machine and the
  system examples in `deploy/` are not yet proven on real machines (E16-42).
- **Performance**: the embedded database is for evaluation. A PostgreSQL server meets the
  targets in the load test, but only with the server on the same machine and everyone
  signed in as one administrator; a run with the database on its own machine and people in
  different roles is still to do (E16-41).
- **Vendors**: the contract import fills structured dates only where the text is
  unambiguous; the "Complete the dates" queue lists the rest.
- **Unsaved changes**: forms built on the shared record form, the New ticket dialog and the
  full-page forms ask before discarding a draft; about 60 hand-written dialogs that hold their own
  state do not yet (E22-14).

## Verification status

- The full unit test suite (server and web) passes on Windows, and again with the clock
  on UTC; `.\grc.ps1 ci` runs it both ways, with the typecheck, a production build and the
  dependency audit (skipped without a network).
- The browser suite (`npm run test:e2e`, 102 tests in 10 suites) covers every route as an
  administrator in the light theme at 1440px and the dark theme at 820px, every default
  role, the create and edit form of every record type, the hand-written dialogs (submitted
  empty, then filled in), keyboard-only use module by module, list features, and every page
  with all optional parts switched off (and with a mix) showing nothing of them.
- Accessibility: the automated axe-core audit (`npm run test:a11y`; see
  [Accessibility](accessibility.md)) finds no violations on any page in light and dark at
  1440 and 820 pixels, and fails the build on a new one. There has been no screen-reader
  walkthrough (E16-15).
- Containers and the PostgreSQL server are proven in continuous integration: the container
  build and smoke test, the test suite through the PostgreSQL wire protocol and on
  PostgreSQL 17.
- Load tested (E16-14, E16-36, E16-38): see [Operations](operations.md#performance-and-load-testing).
- Tested only against stand-ins: email to ticket, Microsoft Graph and the Gmail API (fake
  services), SAML sign-in (a stand-in identity provider), directory sign-in (a stand-in
  directory), OAuth for remote MCP connectors (the MCP SDK's own client), webhook delivery
  over HTTPS, incident alerts by text message (email-to-text and webhook stand-ins).
- Not done: an independent security review or penetration test (E16-40).
