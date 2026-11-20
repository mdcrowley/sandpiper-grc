# Known gaps

What the prototype does not do yet. Update with every change. The roadmap
(`docs/roadmap/`) has an issue for each item.

## Not built

- **Sign-in**: single sign-on supports OpenID Connect and SAML 2.0, but there is no
  directory (LDAP) sign-in (E02-26). A sign-out started at a SAML identity provider does not
  end sessions here (E02-27), and SAML metadata signatures are not checked nor metadata
  refreshed on a schedule (E02-28).
- **Workflow engine**: lifecycles are per-module code plus configurable lists, not a
  general workflow designer.
- **AI assistants (MCP)**: connectors cannot identify themselves with a client ID metadata
  document (E21-21); a connector registers itself (when an administrator allows it) or is
  added by an administrator.

## Built but incomplete

- **Second factor**: a new installation requires it for the roles that expect one
  (Administrator and Security lead) unless setup explicitly asks for a reminder only. An
  existing installation keeps its setting.
- **Passkeys and security keys**: checked in the browser with a virtual authenticator, not
  yet with hardware keys over real HTTPS.
- **Default role changes** reach an existing database only when an administrator applies
  them on the Roles page.
- **Feature switches** (Administration > Features): while Risks and obligations is
  switched off, the hazard risk matrix (kept with the risk scales) cannot be edited, and
  Safety keeps using the saved one. The email digest may still list notifications about a
  part switched off since. Some editable default wording still reads like a public agency's
  (for example "Approved by the governing body"; E18-47).
- **Email**: email goes out over SMTP, Microsoft Graph or the Gmail API. Graph takes
  messages up to about 3 MB (E14-29), and a throttled message waits the queue's usual
  back-off rather than the time the service asks for (E14-30).
- **Backups**: `backup` and `restore` cover the embedded database only; with a PostgreSQL
  server, use `pg_dump` and `pg_restore` (see [Operations](operations.md)). Files kept in
  the object store are not in backups. Restoring a backup and moving files between the
  disk and the object store are done from the command line only. Scheduled backups to a
  second location still need proving on a real installation (E16-08).
- **Exports and imports**: PDFs made by the server print text outside Western European
  languages with a font found on the machine (or named in `GRC_PDF_FONTS`); explicit
  bidirectional embedding characters are ignored. The check before an import runs
  validation and before-save rules, but not after-save steps or database constraints
  (E13-22).
- **Custom fields**: the portal deliberately does not ask ticket custom fields of
  requesters (they are the service desk's own classification); catalog questions do that
  job.
- **Vendor response links**: files a vendor sends stay in storage until staff take them
  over or discard them (E06-24), and the email carrying the link uses the General message
  template (E06-25).
- **API**: the `If-Match` check takes its lock in one server process only; several
  processes on one database do not share it.
- **Hosting**: with a least-privilege database account, adding a custom field still needs
  the database owner (E16-37). The systemd and launchd user services have not been run on
  a real Linux or Mac (E16-35).
- **Performance**: the embedded database is for evaluation. With several people at once it
  was slow for the Overview and global search; changes to both are built but not yet
  measured (E16-38). A PostgreSQL server meets the targets.
- **Vendors**: the contract import fills structured dates only where the text is
  unambiguous; the "Complete the dates" queue lists the rest.

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
- Tested only against stand-ins: email to ticket, Microsoft Graph and the Gmail API (fake
  services), SAML sign-in (a stand-in identity provider), OAuth for remote MCP connectors
  (the MCP SDK's own client), webhook delivery over HTTPS.
- Not done: an independent security review or penetration test (E16-40).
