# Known gaps

What the local prototype does not do yet. Update with every change.

## Not built

- **Reporting**: only the fixed overview and service desk dashboards. No
  user-built dashboards, report builder, scheduled delivery, or report packs.
- **Imports, API**: asset CSV import and JSON ingest only. No XLSX, no personal access
  tokens, no OpenAPI document, no webhooks.
- **Sign-in**: local accounts only. No OpenID Connect or SAML single sign-on, account
  linking, WebAuthn/passkeys or break-glass account.
- **Platform**: no custom fields, email notifications, tags, watchers or XLSX export. Workflow is per-module code plus configurable lists,
  not a general workflow engine. Search is substring matching, not full-text.
- **Self-service portal** and email-to-ticket.
- **Hosting**: runs on embedded Postgres (PGlite) under portable Node, not a PostgreSQL
  server in containers. No HTTPS. The continuous-integration workflow is written but has
  not run yet.

## Built but incomplete

- **Second factor**: enforcement exists but is off by default (`auth.mfa_enforcement` is
  `notice`; an administrator switches it to `required`). When a person is blocked, the
  web application does not yet send them to the enrolment page by itself: the shell
  shows errors until they open Account security. Authenticator keys are encrypted, but
  with the default key file the key sits in the data folder and is copied by `backup`
  along with the database; see [Security](security.md) for keeping it elsewhere.
- **Password confirmation** before sensitive administrative actions asks for the password
  only (not the second factor) and covers the administration screens only.
- **Secure cookie and proxy settings** (`GRC_COOKIE_SECURE`, `GRC_TRUST_PROXY`) exist but
  are off by default; there is still no HTTPS, no HSTS header, and no refusal to start on
  a non-loopback address.
- **Default role changes** reach an existing database only when an administrator applies
  them on the Roles page. On a database created before that feature, the first run offers
  every default permission the role lacks, including any removed on purpose.
- **Permissions nobody checks**: `dashboards`, `reports` and `portal` can be granted but
  no route or screen checks them yet.
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
  expiry does not change status. The default Approver role cannot record a risk
  acceptance (it would need `security.view`); someone who can see the risk records it.
- **Actions**: an action raised on a restricted record is hidden from people without
  `security.view`, including its owner if they lack it; there is no way to share one
  such action with one person.
- **Security incidents**: the offline kit prints from the browser (no scheduled PDF).
- **Configurable lists**: a list that a module creates without naming an owner, and that
  no record type uses, can be read by administrators only (the server log names them).
- **Sector-leaning features** remain and are not yet configurable away: the asset
  "funder interest" rule, the contract "approval or resolution number", and the
  governing-body approval on a ransom decision. The pilot banner text in the web shell
  still names particular kinds of data.
- **Projects**: required documents do not block a gate (only the checklist does); no stage
  rollback; intake needs `projects.create`.
- **Retention**: no retention settings or review flags.

## Verification status

- 249 automated API tests pass for core, administration and the service desk, inventory,
  vendors, frameworks, risks, security incidents and projects modules, run together.
  Some tests of the newer modules expect to be run alone (`GRC_MODULES=<module>`).
- The password-confirmation prompt, the Settings page and the Roles page were tried in
  headless Edge in the light theme at 1440px and the dark theme at 820px.
- Every screen was loaded once in headless Edge at 1440px, light theme, signed in as an
  administrator, against seeded data: no script errors or failed API calls.
- Not exercised in a browser: dark theme, tablet width, keyboard-only use, forms being
  submitted, non-administrator roles. No accessibility audit has been done.
- Two pages scroll horizontally at 1440px: security terms matrix, notification rules.
- No load testing.

## Added in the second build wave (see the roadmap for detail)

- **Change enablement**: approvals are recorded by hand, with no per-approver routing.
- **Policies and training**: reminders are recorded but not sent; a failed training result
  still counts as complete (E10-10).
- **Vulnerabilities**: deduplication misses port and host-alias cases (E10-12).
- **Attachments**: no malware scanner is plugged in (files are marked "not scanned"); removed
  files keep their bytes on disk.
- **Notifications**: in-app only; most modules do not emit them yet.
- **Second factor**: when enforcement is set to required, the web shell does not yet send
  a blocked user to the enrolment page.
- **Encryption key**: the default key file is in the data folder, so backups hold the key
  beside the data.
- **Web bundle**: one 1.8 MB script; not split by route yet.
- **Verification**: every screen was loaded in a browser once after the redesign (light,
  1440px, administrator). Forms and non-administrator roles were only spot-checked.
