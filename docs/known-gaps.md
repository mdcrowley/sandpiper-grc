# Known gaps

What the local prototype does not do yet. Update with every change. The roadmap
(`docs/roadmap/`) has an issue for each item.

## Not built

- **Sign-in**: local accounts only. No OpenID Connect or SAML single sign-on, account
  linking, WebAuthn/passkeys or break-glass account.
- **Email**: notifications, scheduled reports, and setup and reset links are delivered in
  the application only. The prototype makes no outbound connections; webhooks exist but
  are off until an administrator enables outbound connections.
- **Exports**: CSV and print-ready pages only. No PDF or XLSX files generated on the
  server, and no XLSX import.
- **Self-service portal** and email-to-ticket.
- **Workflow engine**: lifecycles are per-module code plus configurable lists, not a
  general workflow designer.
- **Hosting**: runs on embedded Postgres (PGlite) under portable Node, not a PostgreSQL
  server in containers. No HTTPS. Continuous integration is local only (`.\grc.ps1 ci`);
  no GitHub Actions or Dependabot are in use (their files are kept switched off in
  `tools/ci`), so dependency updates are checked by hand.

## Built but incomplete

- **Second factor**: enforcement is available but defaults to a reminder
  (`auth.mfa_enforcement` = `notice`). Authenticator keys are encrypted, but with the
  default key file the key sits in the data folder and is copied by `backup` with the
  database; see [Security](security.md) for keeping it elsewhere.
- **Password confirmation** before sensitive administrative actions asks for the password
  only (not the second factor).
- **Secure cookie and proxy settings** (`GRC_COOKIE_SECURE`, `GRC_TRUST_PROXY`) exist but
  are off by default; there is no HSTS header and no refusal to start on a non-loopback
  address.
- **Default role changes** reach an existing database only when an administrator applies
  them on the Roles page.
- **Attachments**: no malware scanner is plugged in (files are marked "not scanned");
  removed files keep their bytes on disk; files are stored on local disk only.
- **Change enablement**: changes cannot yet be dragged on the calendar.
- **Vulnerabilities**: duplicates created before the improved matching are not merged
  automatically.
- **Vendors**: the contract import fills structured dates only where the text is
  unambiguous; the "Complete the dates" queue lists the rest. Evidence items and their
  files each carry an expiry date, and the two can disagree.
- **Frameworks**: the NIST CSF 2.0 outcome text needs a line-by-line check against the
  publication (CSWP 29).
- **Security incidents**: the offline kit prints from the browser (no scheduled PDF);
  clock alerts are in-app only.
- **Reports**: multi-choice custom fields cannot be used in the report builder.
- **Custom fields** appear automatically in generic lists, forms and record pages, but not
  on hand-built forms such as the new-ticket flow.
- **Web bundle**: the first load is about 640 kB before compression (193 kB compressed);
  the target is under 500 kB.

## Verification status

- 605 automated tests (server and web) pass with every module loaded (`.\grc.ps1 ci`, 18 Nov
  2026), together with the typecheck and a production build.
- Every static route and one record of each type were loaded in headless Edge in the
  light theme at 1440px and the dark theme at 820px, signed in as an administrator, with
  no script errors, failed API calls or horizontal scrolling.
- Scripted browser runs covered each module's main flows (creating, editing, approving,
  importing, bulk editing, attaching files, declaring and closing an incident, building a
  report and dashboard).
- Restricted records were checked in the browser as an ordinary agent for the risk
  register; other modules rely on API tests for this.
- Not done: keyboard-only use across the whole application, every form in every role, an
  accessibility audit, load testing.
