# Known gaps

What the local prototype does not do yet. Update with every change.

## Not built

- **Change enablement**: nothing yet.
- **Rest of cybersecurity**: policies and acknowledgements, training, exceptions,
  exercises, vulnerabilities (scanner findings import).
- **Reporting**: only the fixed overview and service desk dashboards. No
  user-built dashboards, report builder, scheduled delivery, or report packs.
- **Imports, API**: asset CSV import and JSON ingest only. No XLSX, no personal access
  tokens, no OpenAPI document, no webhooks.
- **Sign-in**: local accounts only. No OpenID Connect or SAML single sign-on, account
  linking, WebAuthn/passkeys or break-glass account.
- **Platform**: no attachments, custom fields, notifications (in-app or email), tags,
  watchers, bulk edit or XLSX export. Workflow is per-module code plus configurable lists,
  not a general workflow engine. Search is substring matching, not full-text.
- **Self-service portal** and email-to-ticket.
- **Hosting**: runs on embedded Postgres (PGlite) under portable Node, not a PostgreSQL
  server in containers. No HTTPS, no scheduled backup, no `restore`, `upgrade`, `export-all`
  or `import-all` commands, no continuous integration.
- **Documentation**: no administrator guide, user guide or operations runbook.

## Built but incomplete

- **Second factor** is offered and works (authenticator app, recovery codes) but is a
  notice only, not enforced. No replay protection; secrets are not field-encrypted.
- **No re-authentication** before administrative actions; rate limiters are in memory.
- **Setup and reset links** are shown to the administrator to pass on (no email).
- **Service desk**: priority matrix, SLA targets, calendars and holidays are editable by
  API only; no warning/breach notifications or escalation rules; catalogue items only
  pre-fill a ticket; "agents only" article audience is not enforced.
- **Inventory**: disposal approval is a recorded name and date, not a
  routed approval.
- **Vendors**: the contract import fills structured dates only where the text is
  unambiguous; other contracts need dates entered before renewal reminders mean anything.
  Reminders are audit events and
  calendar state only. No vendor assessment questionnaire. Value by year is raw JSON.
- **Frameworks**: NIST CSF 2.0 outcome text was written from memory and must be proofread
  against CSWP 29 (start with GV.SC-06, GV.SC-09, PR.AA-05). Evidence is text only.
- **Risks**: no screen for editing scales (API only); acceptances cannot be revoked and
  expiry does not change status; action titles linked to a restricted risk are visible to
  anyone who can see actions.
- **Security incidents**: the offline kit prints from the browser (no scheduled PDF);
  lookup list names and labels are visible to all signed-in users through `/api/meta`.
- **Projects**: required documents do not block a gate (only the checklist does); no stage
  rollback; intake needs `projects.create`.
- **Retention**: no retention settings or review flags.

## Verification status

- 205 automated API tests pass with all modules loaded.
- Every screen was loaded once in headless Edge at 1440px, light theme, signed in as an
  administrator, against seeded data: no script errors or failed API calls.
- Not exercised in a browser: dark theme, tablet width, keyboard-only use, forms being
  submitted, non-administrator roles. No accessibility audit has been done.
- Two pages scroll horizontally at 1440px: security terms matrix, notification rules.
- No load testing.
