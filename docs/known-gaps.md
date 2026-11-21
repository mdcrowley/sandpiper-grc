# Known gaps

What the prototype does not do yet. Update with every change. The roadmap
(`docs/roadmap/`) has an issue for each item.

## Not built

Nothing planned is unbuilt; what remains is listed below as incomplete or unproven.

## Built but incomplete

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
  Directory.
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
  second location still need proving on a real installation (E16-08).
- **Exports and imports**: PDFs made by the server print text outside Western European
  languages with a font found on the machine (or named in `GRC_PDF_FONTS`); explicit
  bidirectional embedding characters are ignored.
- **Custom fields**: the portal deliberately does not ask ticket custom fields of
  requesters (they are the service desk's own classification); catalog questions do that
  job.
- **API**: the `If-Match` check takes its lock in one server process only; several
  processes on one database do not share it. The Overview's figures are kept for a few
  seconds per process, so a change saved through another process shows up there after up
  to 10 seconds.
- **Hosting**: with a least-privilege database account, adding a custom field is queued
  for the database owner, and a new text custom field is searched only after the owner's
  next `migrate` step. The user services run on GitHub's Linux and macOS machines; a restart of the machine and the
  system examples in `deploy/` are not yet proven on real machines (E16-42).
- **Performance**: the embedded database is for evaluation. A PostgreSQL server meets the
  targets in the load test, but only with the server on the same machine and everyone
  signed in as one administrator; a run with the database on its own machine and people in
  different roles is still to do (E16-41).
- **Vendors**: the contract import fills structured dates only where the text is
  unambiguous; the "Complete the dates" queue lists the rest.

## Verification status

- The full unit test suite (server and web) passes on Windows, and again with the clock
  on UTC; `.\grc.ps1 ci` runs it both ways, with the typecheck and a production build.
- The browser suite (`npm run test:e2e`, 94 tests in 9 suites) covers every route as an
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
