# Known gaps

What the prototype does not do yet. Update with every change. The roadmap
(`docs/roadmap/`) has an issue for each item.

## Not built

- **Sign-in**: single sign-on supports OpenID Connect only. There is no SAML 2.0 (blocked:
  it cannot be done safely without an XML-signature library) and no directory (LDAP)
  sign-in.
- **Email**: email goes out through an SMTP server only; there is no other mail provider
  (E14-25).
- **Workflow engine**: lifecycles are per-module code plus configurable lists, not a
  general workflow designer.
- **AI assistants (MCP)**: connectors cannot identify themselves with a client ID metadata
  document (E21-21); a connector registers itself (when an administrator allows it) or is
  added by an administrator.
- **Webhooks** are sent for record changes only, not for other events such as a
  notification clock running out (E13-19).
- **Audit log**: events cannot be searched by request id, and the export leaves it out
  (E13-20).
- **Vendor response links**: a vendor answers the questions but cannot upload files through
  the link (E06-22), and the application does not email the link (E06-23).

## Built but incomplete

- **Second factor**: a new installation requires it for the roles that expect one
  (Administrator and Security lead) unless setup explicitly asks for a reminder only. An
  existing installation keeps its setting.
- **Passkeys and security keys**: checked in the browser with a virtual authenticator, not
  yet with hardware keys over real HTTPS.
- **Identity confirmation**: the prompt (password and second factor) can be used by any
  screen, but only administration and a few module settings ask for it; the rest have not
  been reviewed module by module (E01-33).
- **Default role changes** reach an existing database only when an administrator applies
  them on the Roles page.
- **Feature switches** (Administration > Features): while Risks and obligations is
  switched off, the hazard risk matrix (kept with the risk scales) cannot be edited, and
  Safety keeps using the saved one. The email digest may still list notifications about a
  part switched off since. The portal's own switch (service desk portal settings) does
  not ask to confirm your identity; Administration > Features does.
- **Backups**: `backup` and `restore` cover the embedded database only; with a PostgreSQL
  server, use `pg_dump` and `pg_restore` (see [Operations](operations.md)). Files kept in
  the object store are not in backups. Restoring a backup and moving files between the
  disk and the object store are done from the command line only. Scheduled backups to a
  second location still need proving on a real installation (E16-08).
- **Exports and imports**: PDFs made by the server print text outside Western European
  languages with a font found on the machine (or named in `GRC_PDF_FONTS`); right-to-left
  text is not reordered, and text mixing scripts that no one font covers prints "?"
  (E12-16). The check before an import does not run record hooks, so a hook can still
  refuse a row on the real import (E13-10).
- **Reports**: a report cannot be grouped by a multi-choice field (E12-15). Saved reports
  and dashboards can be given custom fields that their dialogs do not ask for (E18-45).
- **Custom fields**: the portal deliberately does not ask ticket custom fields of
  requesters (they are the service desk's own classification); catalog questions do that
  job.
- **API**: the `If-Match` check takes its lock in one server process only; several
  processes on one database do not share it.
- **Hosting**: with a least-privilege database account, adding a custom field still needs
  the database owner (E16-37). The systemd and launchd user services have not been run on
  a real Linux or Mac (E16-35).
- **Performance**: the embedded database is for evaluation. With several people at once it
  is slow for the Overview and global search (E16-38); a PostgreSQL server meets the
  targets.
- **Fleet**: services are drawn on the relationship map; vehicles are listed in the impact
  panel but not drawn on the map.
- **Vendors**: the contract import fills structured dates only where the text is
  unambiguous; the "Complete the dates" queue lists the rest.
- **Security incidents**: the offline kit prints from the browser (no scheduled PDF,
  E09-16).

## Verification status

- The full unit test suite (server and web) passes on Windows, and again with the clock
  on UTC; `.\grc.ps1 ci` runs it both ways, with the typecheck and a production build.
- The browser suite (`npm run test:e2e`, 92 tests in 8 suites) covers every route as an
  administrator in the light theme at 1440px and the dark theme at 820px, every default
  role, the create and edit form of every record type, the hand-written dialogs (submitted
  empty, then filled in), keyboard-only use module by module, and list features.
- Accessibility: the automated axe-core audit (`npm run test:a11y`; see
  [Accessibility](accessibility.md)) finds no violations on any page in light and dark at
  1440 and 820 pixels, and fails the build on a new one. There has been no screen-reader
  walkthrough (E16-15).
- Containers and the PostgreSQL server are proven in continuous integration: the container
  build and smoke test, the test suite through the PostgreSQL wire protocol and on
  PostgreSQL 17.
- Load tested (E16-14, E16-36): a PostgreSQL server meets the targets at about 22,000
  records with 8 people at once; see [Operations](operations.md).
- Tested only against stand-ins: email to ticket (a fake mail server), OAuth for remote
  MCP connectors (the MCP SDK's own client), webhook delivery over HTTPS.
- Not done: an independent security review or penetration test (E16-40).
