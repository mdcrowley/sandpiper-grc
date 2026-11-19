# Known gaps

What the prototype does not do yet. Update with every change. The roadmap
(`docs/roadmap/`) has an issue for each item.

## Not built

- **Sign-in**: single sign-on supports OpenID Connect only. There is no SAML 2.0 (blocked:
  it cannot be done safely without an XML-signature library) and no directory (LDAP)
  sign-in. A sign-in through a provider does not use the provider's own second factor, and
  signing out here does not sign out at the provider.
- **Email-to-ticket**: the self-service portal is built (off by default), but a request
  cannot be raised by sending an email. Email goes out through an SMTP server only; there
  is no other mail provider.
- **Workflow engine**: lifecycles are per-module code plus configurable lists, not a
  general workflow designer.
- **AI assistants (MCP)**: no OAuth for remote connectors (an assistant connects with a
  personal access token). Once an administrator switches access on, anyone with a role
  may make an assistant token; there is no role permission for it yet. The endpoint is
  stateless, so long-running tools send no progress notifications.

## Built but incomplete

- **Second factor**: the setup wizard of a new installation requires it for the roles
  that expect one (Administrator and Security lead) unless the person chooses otherwise.
  An existing installation, and a setup made through the API without a choice, keep the
  reminder only (`auth.mfa_enforcement` = `notice`).
- **Passkeys and security keys**: checked in the browser with a virtual authenticator, not
  yet with hardware keys over real HTTPS.
- **Password confirmation** before sensitive administrative actions asks for the password
  only (not the second factor).
- **Default role changes** reach an existing database only when an administrator applies
  them on the Roles page.
- **Backups**: `backup` and `restore` cover the embedded database only; with a PostgreSQL
  server, use `pg_dump` and `pg_restore` (see [Operations](operations.md)). Files kept in
  the object store are not in backups. Restoring a backup and moving files between the
  disk and the object store are done from the command line only.
- **Exports and imports**: PDFs made by the server use the standard fonts, so characters
  outside the Western European set print as "?" (E12-14). The check before an import does
  not run record hooks, so a hook can still refuse a row on the real import (E13-10).
- **API**: the `If-Match` check takes its lock in one server process only; several
  processes on one database do not share it.
- **Background jobs**: other modules' timers have not yet moved onto the job queue
  (E14-22), nor have file housekeeping and rescans (E14-27). The queue and email are
  started by the notifications module, so a server built without that module has neither
  (E14-23).
- **Webhooks**: receivers' addresses are checked by host name only, not after name
  resolution.
- **Change enablement**: changes cannot yet be dragged on the calendar.
- **Vulnerabilities**: duplicates created before the improved matching are not merged
  automatically.
- **Vendors**: the contract import fills structured dates only where the text is
  unambiguous; the "Complete the dates" queue lists the rest. Evidence items and their
  files each carry an expiry date, and the two can disagree.
- **Frameworks**: the NIST CSF 2.0 outcome text needs a line-by-line check against the
  publication (CSWP 29).
- **Security incidents**: the offline kit prints from the browser (no scheduled PDF).
- **Reports**: multi-choice custom fields cannot be used in the report builder.
- **Custom fields** appear automatically in generic lists, forms and record pages, but not
  on hand-built forms such as the new-ticket flow.

## Verification status

- The full unit test suite (server and web) passes on Windows, and again with the clock
  on UTC; `.\grc.ps1 ci` runs it both ways, with the typecheck and a production build.
- The browser suite (`npm run test:e2e`) passed 49 of 49 tests on Windows: every route as
  an administrator in the light theme at 1440px and the dark theme at 820px, every default
  role, the create and edit form of every record type, keyboard use and list features.
- Containers and the PostgreSQL server are proven in continuous integration only: the
  container build and smoke test, the test suite through the PostgreSQL wire protocol, and
  a non-blocking run on PostgreSQL 17.
- Accessibility: an automated axe-core audit runs (`npm run test:a11y`; see
  [Accessibility](accessibility.md)). Open findings: the grid roles of the dashboard
  calendar widget and the faded empty cells of the safety hazard matrix (E18-39). There
  has been no screen-reader walkthrough, and keyboard-only use (E18-06) and submitting
  every form in the browser (E18-08) are only partly checked.
- Not done: load testing (E16-14), an independent security review or penetration test.
