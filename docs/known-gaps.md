# Known gaps

What the prototype does not do yet. Update with every change. The roadmap
(`docs/roadmap/`) has an issue for each item.

## Not built

Every part planned through wave 11 is built; the open roadmap issues finish or prove parts that
exist (see "Built but incomplete" and "Verification status" below).

Not planned: drug and alcohol test results, hours-of-service and fatigue records, maintenance
work orders and inspection schedules, which belong in specialist systems, and redaction of document
content, which belongs in a document tool (E25-13, E29-11, E32-06, E34-09).

## Built but incomplete

- **Accessibility**: tables on the Help pages always take a Tab stop, even when they fit, and carry the generic name "Table".
- **Wave 10 parts** (corrective action plans, audits and inspections, controls, funding, committees,
  the staff roster, obligations and enterprise risk):
  - The person asked for audit evidence answers in text only (attaching files needs `audits.edit`);
    taking inspection photos needs `audits.edit` and the attachments module.
  - Coverage cannot be imported from a spreadsheet, and controls have no per-control test steps.
  - Funding: drawdowns, budgets and spending by award are left to the finance system.
  - A meeting decision can be applied only to approvals declared as an approval kind, not to
    workflows an administrator defined with no kind; meetings send no calendar invitations by
    email; members subscribe through a calendar feed (E36-03).
  - Departments are not a record type, so person and position exports show the department's id;
    kiosk lockouts after wrong employee numbers are kept per server process.
  - Key risk indicators are monthly only; regulatory changes are entered by hand (no outside feed).
- **Wave 11 parts** (business continuity, asset condition, OT security, legal holds, records
  requests and privacy, the vendor risk lifecycle and integrations):
  - Business continuity: call trees are printed and called by hand; nothing pages or messages
    people.
  - Asset condition: one useful-life benchmark per class (changing it recomputes every member);
    condition history is listed, not charted.
  - OT security: no network scanning or device discovery; the starter structure file's mappings are
    not loaded automatically; the zones-below-target figure keeps no history; a saved map picture
    shows no OT badge.
  - Records requests: working days skip weekends only, not public holidays.
  - Vendor risk lifecycle: exclusion-list checks are recorded by hand (no outside service is
    called); finishing an offboarding item does not remove accounts by itself.
  - Integrations: SCIM bulk requests and sorting are not supported, and attributes the application
    does not keep are ignored; a log forwarder sends to one collector. Calendar feeds are read-only.
    The work-tracker bridge has no ready-made connections for particular products and brings back only
    the status.
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
  Directory. The Change password dialog revokes API tokens and
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
- **Mobile app (server)**: a refresh is repeated safely once within 30 seconds if its first answer
  was never used; two refreshes of the same token at the same moment get one answer, and the other is
  refused. Within `auth.reauth_minutes` of a `prompt=login` sign-in, the phone may perform any
  sensitive action the person may, like a freshly confirmed browser.
- **Asset tags**: an inventory count's area restricts it to records with a location (assets); counts
  have no offline mode until E38-12.
- **Mobile app (testing)**: the Maestro flows (`mobile/test/maestro/`) run locally on the Android
  emulator, not yet in CI. iPhone builds run only on the macOS leg of continuous
  integration and have not been run on a device; whether ML Kit sends usage statistics on iPhone has
  not been measured (see `docs/security.md`). The app's open-source licenses list includes packages
  used only at build time.
- **Push notifications (E38-14)**: tested only against fake Apple, Google and UnifiedPush services in
  the test process, not yet with real credentials on real phones. The Android app has no UnifiedPush
  connector yet, so without Firebase in the build Android phones get no pushes. A push that fails
  temporarily is not retried; the next new notification pushes again.
- **Mobile app (offline)**: a photo whose upload failed is sent again whole (no partial resume), but
  never attached twice. The portal, safety and attachment routes themselves still ignore
  `Idempotency-Key` when called directly (the app goes through `/api/mobile/sync`, which keeps each
  answer for 7 days). Only reports work offline so far; inspections, condition assessments and counts
  follow (E38-11, E38-12), and tags are not looked up in the offline package yet. A phone signed out
  from the web loses work it had not sent. Portal users report from a tag card only, not from scratch,
  and photos on a portal safety report may be refused.
- **Hosting**: with a least-privilege database account, adding a custom field is queued
  for the database owner, and a new text custom field is searched only after the owner's
  next `migrate` step. JSON API responses are not compressed by the application (a risk with
  session-bound answers); a reverse proxy may compress them. Web assets are compressed and cached.
- **Service restarts on real machines (E16-42)**: the user services run on GitHub's Linux and macOS
  machines. The Linux system service, its backup timer and a lingering user service were checked
  across a restart of a systemd container, not of a real machine; macOS (`deploy/launchd/`, the
  agent after a restart) is unproven.
- **Performance**: the embedded database is for evaluation. The database on its own machine is not
  yet measured (E16-41): load figures come from a PostgreSQL container limited to 2 processors and
  2 GB on the same laptop as the application, with people in different roles. At scale 1 global
  search (0.8 to 1.1 s) and sometimes the full-text list miss the server targets; at scale 4 the two
  database processors are saturated and lists, search and the Overview take 0.8 to 4.3 s. Under
  bursts of writes, a request that waits more than `GRC_DATABASE_CONNECT_TIMEOUT` (10 s) for one of
  the `GRC_DATABASE_POOL_MAX` (10) connections fails with "Something went wrong" (30 of about 82,000
  while seeding scale 4).
- **Vendors**: the contract import fills structured dates only where the text is
  unambiguous; the "Complete the dates" queue lists the rest.

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
  1440 and 820 pixels, and fails the build on a new one. The main journeys have
  been run with NVDA by a script (`tools/sr/journeys.mjs`, a manual check), proving what is announced
  and that the keyboard is enough; approving a workflow step is not yet proven, and no screen reader
  user has walked through the application (E16-15).
- Containers and the PostgreSQL server are proven in continuous integration: the container
  build and smoke test, the test suite through the PostgreSQL wire protocol and on
  PostgreSQL 17.
- Load tested (E16-14, E16-36, E16-38): see [Operations](operations.md#performance-and-load-testing).
- Tested only against stand-ins: email to ticket, Microsoft Graph and the Gmail API (fake
  services), SAML sign-in (a stand-in identity provider), directory sign-in (a stand-in
  directory), OAuth for remote MCP connectors (the MCP SDK's own client), webhook delivery
  over HTTPS, incident alerts by text message (email-to-text and webhook stand-ins).
- Not done: an independent security review or penetration test (E16-40).
