# Known gaps

What the prototype does not do yet. Update with every change. The roadmap
(`docs/roadmap/`) has an issue for each item.

## Not built

Every part planned through wave 16 is built; the open roadmap issues finish or prove parts that
exist (see "Built but incomplete" and "Verification status" below).

Not planned: drug and alcohol test results, hours-of-service and fatigue records, maintenance
work orders and inspection schedules, which belong in specialist systems, and redaction of document
content, which belongs in a document tool (E25-13, E29-11, E32-06, E34-09).

## Built but incomplete

- **Accessibility**: tables on the Help pages always take a Tab stop, even when they fit, and carry the generic name "Table".
- **Wave 10 parts** (corrective action plans, audits and inspections, controls, funding, committees,
  the staff roster, obligations and enterprise risk):
  - Taking inspection photos needs `audits.edit` and the attachments module.
  - Funding: drawdowns, budgets and spending by award are left to the finance system.
  - A meeting decision can be applied only to approvals declared as an approval kind, not to
    workflows an administrator defined with no kind; meetings are emailed as calendar invitations
    (.ics) and through the calendar feed; replies are not collected (E41-17).
  - Departments are records (E41-01), but ticket requester departments and training-record
    departments stay as recorded text. Scoped roles (E41-01) have not been run on a PostgreSQL server
    or in the browser suite.
  - Key risk indicators are monthly only; regulatory changes are entered by hand (no outside feed).
- **Wave 11 parts** (business continuity, asset condition, OT security, legal holds, records
  requests and privacy, the vendor risk lifecycle and integrations):
  - Business continuity (E41-14): call-tree text messages reach only people with an account
    (`sendText` takes accounts); a roster person without an account gets email only, and a typed
    name is listed to call. A text carries its acknowledgment link in its text, so the link is
    visible in the text delivery log administrators read (it can only acknowledge that message).
    Not tried with a real mail server, carrier email-to-text gateway, text-message webhook or phone.
  - Asset condition: one useful-life benchmark per class (changing it recomputes every member);
    condition history is listed, not charted.
  - OT security: no network scanning or device discovery; the starter structure file's mappings are
    not loaded automatically; the zones-below-target figure keeps no history; a saved map picture
    shows no OT badge.
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
  columns. Server PDFs pass an automated PDF/UA check built on pdf.js, not veraPDF; run veraPDF's
  PDF/UA-1 profile on a sample of each kind once. The document language is US English for every PDF;
  text in other scripts has no per-span language. A CSV that is not UTF-8 is read as Windows-1252; other code pages are not detected.
  The pause in sending email while the mail server is unreachable is kept per server process.
- **Custom fields**: the portal deliberately does not ask ticket custom fields of
  requesters (they are the service desk's own classification); catalog questions do that
  job.
- **API**: the Overview's figures are kept for a few seconds per process, so a change saved
  through another process shows up there after up to 10 seconds. Record changes made by module
  routes outside the generic save are not yet one transaction with their audit event.
- **Mobile app (server)**: a refresh is repeated safely once within 30 seconds if its first answer
  was never used; two refreshes of the same token at the same moment get one answer, and the other is
  refused. Within `auth.reauth_minutes` of a `prompt=login` sign-in, the phone may perform any
  sensitive action the person may, like a freshly confirmed browser.
- **Asset tags**: an inventory count's area restricts it to records with a location (assets).
- **Mobile app (testing)**: the Maestro flows (`mobile/test/maestro/`) run locally on the Android
  emulator, not yet in CI. iPhone builds run only on the macOS leg of continuous
  integration and have not been run on a device; whether ML Kit sends usage statistics on iPhone has
  not been measured (see `docs/security.md`). The app's open-source licenses list includes packages
  used only at build time.
- **Push notifications (E38-14)**: the Android UnifiedPush connector and delivery retries are built
  and tested with fake services, Kotlin unit tests and a release build. Delivery with real Apple and
  Google credentials, and with a real UnifiedPush distributor and push server, has not been tried on a
  phone. A distributor that moves a phone to a new address while the app is closed is picked up only
  when the app next opens. Account > Open-source licenses lists only npm packages, not native libraries
  (the UnifiedPush connector, Tink, ML Kit).
- **Mobile app (offline)**: a photo whose upload failed is sent again whole (no partial resume), but
  never attached twice. The portal, safety and attachment routes themselves still ignore
  `Idempotency-Key` when called directly (the app goes through `/api/mobile/sync`, which keeps each
  answer for 7 days). Reports, inspections (with a signature), condition assessments and inventory
  counts work offline (E38-10 to E38-12); tags are looked up offline only among the records the package
  covers (my inspections' targets, condition assessments due, open counts). The web's inspection runner
  asks for no signature (the inspection page shows who signed in the app). Inspections and counts were
  proven on the Android emulator only, not on a real phone in a dead spot or an iPhone. A phone signed
  out from the web loses work it had not sent, including inspections started on it. Photos on a
  portal safety report may be refused.
- **Mobile app accessibility not yet tried by people (E38-15)**: the app was checked on the Android
  emulator at 200% text with its accessibility tree and automated tests, but VoiceOver has not been run
  (it needs an iPhone or a Mac), no TalkBack user has walked through it, and iPhone Dynamic Type at the
  largest sizes has not been seen on a device. The camera's pinch to zoom and tap to focus have no
  buttons (autofocus, Take a picture, Choose a picture and Type a number are the alternatives).
- **Mobile app (security, E38-15)**: offline package expiry follows the phone's clock and is enforced
  only while the app runs; a phone that stays offline after being signed out on the web keeps its
  offline data until it next reaches the server (the package until it expires; unsent work and drafts
  until then). On iPhone, offline files use the default Data Protection class (readable after the
  first unlock since restart); the exclusion from iCloud and computer backups and the sign-out after a
  reinstall are built but not yet checked on a real iPhone. The app-switcher image is blanked, and
  screenshots blocked, only while a restricted record is open; Android's recents thumbnail can show the
  last screen. The required unlock cannot be enforced on a phone with no passcode. The app's native
  recognition and push libraries (Google ML Kit, Google Play services and Firebase Messaging) are
  proprietary, though free of charge. 22 moderate `npm audit` advisories in the app's build and test
  tools (`glob` and `minimatch` through jest and `@expo/fingerprint`) have no non-breaking fix; none
  ships in the app.
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
  2 GB on the same laptop as the application, with people in different roles. At scale 1 every server
  target is now met, global search and the full-text list included (95th percentile 310 to 395 ms and
  122 to 135 ms after the wave 15 tuning); a word in nearly every record still takes global search
  about 1 to 1.3 s at the 99th percentile. At scale 4 the two database processors are saturated:
  global search takes 0.8 to 0.9 s and the full-text list 0.4 s, and sorted lists and the Overview 0.8
  to 3.7 s. Under bursts of writes, a request that waits more than `GRC_DATABASE_CONNECT_TIMEOUT` (10 s)
  for one of the `GRC_DATABASE_POOL_MAX` (10) connections answers 503 `busy` with `Retry-After` (since
  wave 19; before, about 30 of 82,000 requests failed this way while seeding scale 4).
- **Operations**: under a least-privilege database role the audit archive runs as the owner with
  `audit-archive` from a scheduled task (E40-14). Rotating sign-in provider, email, push,
  work-tracker, log-forwarder and object-store secrets is written down but was proven by unit tests
  only, not carried out against those systems.
- **Windows installer (E42)**: the installer is unsigned (SmartScreen warns; check the SHA-256 in
  the release's SHA256SUMS.txt). It has been tested silently on a Windows 11 workstation (GitHub's
  Windows Server runner workflow added, first run pending), not yet on a real Windows Server across
  a restart or through its pages by hand (E42-07). Only Windows has an installer. An installation
  made outside Program Files before wave 23 cannot be proven untampered (the old inherited Modify
  permission let other users change files); reinstall it rather than upgrade.
- **Vehicle and asset models (E39)**: a model change saves each member on its own, not in one
  database transaction; a member refused by its own rules is listed on the model and takes the value
  at its next save unless overridden. Inherited custom fields are marked on the model lists, not under
  Administration > Custom fields. Models carry no maintenance schedules or parts (E32-06).
- **Models and references**: a background model change (E39) runs with the full permissions of the
  person who saved the model, even when they saved it with a personal access token of narrower
  scope. Deleting a model does not lock out a member being given that model at the same moment: such a
  member is found right after the delete and left with no model. Reference fields, built-in and
  custom, check that the linked record is not restricted and is within its row rules, but not that the
  person holds view permission on the linked record's module (E40-13).
- **Provisioning**: provisioning deactivates an account that can administer only when it created
  the account; for accounts created before wave 19 this is known from the audit log, so one whose
  creation event was purged keeps the older refusal and is deprovisioned by hand.
- **User access reviews (E41-02)**: the application never connects to systems, so account lists
  are imported from files and removals are carried out by people.
- **Compliance calendar (E41-03)**: records requests, continuity plan reviews and condition
  assessments show only the viewer's own items in the compliance calendar (no "everyone" view yet).
- **Vendors**: the contract import fills structured dates only where the text is
  unambiguous; the "Complete the dates" queue lists the rest. A higher vendor risk tier or an expired
  check (E41-10) does not deactivate contracts that are already active; it only stops new activations.
- **Confidential safety reporting (E41-05)** keeps the reporter's identity off the safety event and
  shows it only to named people, each look audited. It cannot protect what the reporter writes in the
  report itself, and people who run the server can still find the identity in the database, backups
  and the request log.
- **Figures and policy translations (wave 23)**: figures saved before wave 23 are not re-checked
  against their creator's access; they keep being recorded as the system (review them under
  Reports > Figures over time). An acknowledgment records the stamp of the translation current when
  the person acknowledges, not the text their screen showed (changes to a published translation
  need approval). Acknowledgments given before wave 23 record only the language.
- **Certification (E41-08)** issues one certificate of readiness per project, with no per-item
  certificate of conformance and no second-person confirmation of a verification. Requirement CSV
  exports keep the stored source type ('hazard' or 'risk') even when that area is switched off. The
  mobile app's My work has no entry for certification requirements.
- **Registers (E41-06)**: approval workflows on a register defined while the server runs start after
  the next restart; no calendar, My work or mobile app entries for registers; with a least-privilege
  database account a new register waits for `migrate` as the owner, and removing one is refused.
- **Languages (E41-07)**: English and Spanish only. The staff application, server validation
  messages, notifications and email, organization-written content (catalog, articles, lookup lists)
  and the app's Search, records, approvals and field work screens are English only. The Spanish has
  not been reviewed by a native speaker.
- **Outside reviewers (E41-09)** read and download only (no comments or questions). A few
  hand-written recipient lists (security incident responders and kit, confidential safety viewers,
  scheduled reports, disposal approvers, workflow approvers) read roles directly; a reviewer account
  is still kept out of them by the role refusal and the 6-hourly sweep.
- **Scope in module figures**: the hand-written `figureMask(type, alias)` used by some module figure
  queries ignores department/site scope (restriction is masked; scope details may show in those
  module-specific groupings).
- **Data load mode (E18-70)** works out missing values from the dates given for tickets, risks,
  actions, corrective action plans, changes, security incidents, vulnerabilities and policy
  exceptions; other types keep the values given but still work out anything missing from today.
  `list_record_types` lists every read-only field as settable in a load, including the few the
  database works out (refused with a field error on save). A load is undone per record type and day,
  not per assistant conversation.
- **On behalf of someone in a load (E18-71, E18-94):** module actor columns name the person named,
  with a few left: an inspection's inspector and a finding's response owner default to the loader
  (E45-53); evidence rows copied into the evidence library and framework evidence record the loader as
  creator (E45-54); ticks on checklists (a ticket's fulfillment tasks, an incident's checklist, control
  test steps, a change's review after implementation) keep the time they are recorded, not a time
  from the load (E45-55). A loaded comment is not listed on the Data loads page and is not removed by
  undoing a load (it disappears from view with its record when that record was loaded). Approval
  decisions keep the time they are recorded.
- **Enterprise risk (wave 25)**: a change to the risk appetite is recorded after the fact with who
  approved it, not routed through an approval workflow or a committee decision (E45-56); which
  categories are restricted, and the fields each shows, are set by editing the category list's meta,
  with no form of their own; proximity, velocity and strategic objective are not recorded (E45-57).
- **Evidence library (wave 25)**: outside reviewers do not see library evidence linked to their
  review (E45-59); an uploaded file is not checked against existing evidence for duplicates (no
  content hash); AI assistants cannot link evidence to records (E45-65). A funder review has no
  readiness view or package export yet (E45-58).
- **Audits (wave 25)**: the audit plan's factor columns show only on wide screens (no column chooser
  on that table); control tests of a restricted audit are not themselves restricted; a workpaper
  step's files are chosen from the audit's attachments, not uploaded from the step; workpapers have
  no reference numbering and no time budget against actual hours (E45-63); the annual plan is
  approved by a person with `audits.approve`, not linked to a committee decision (E45-64).
- **Committees and meetings (wave 25)**: PDF papers appended to the board book are not described for
  screen readers (a text-only version of the book is offered instead), and a tagged PDF paper, or one
  without embedded fonts, makes the merged book fall short of PDF/UA (E45-61); no "recused" vote or
  conflict-of-interest declarations (E45-60); no electronic approval of minutes by members; no agenda
  posting deadline per committee or annual work plan (E45-62); no personal notes in the member view;
  no rich text in minutes. Members without `governance.view` do not get their meetings in calendar
  feeds (E45-67).
- **IT figures (wave 25)**: the change success rate does not count changes that caused an incident
  (there is no change-to-incident link yet, E45-66). The IT leadership overview's new chart and gauges are not added to
  that dashboard on an existing installation (standard dashboards are added once, never updated).
- **Search inside files (E41-16)** covers PDF, .docx and plain text only; scanned PDFs (no
  OCR), .doc, spreadsheets and presentations are found by name only. File previews cover images and
  PDFs (first 30 pages).
  File text reading: the memory cap is checked every 20 ms, so a single very large allocation can
  briefly push the reader process past 768 MB before it ends; only the reader process is affected,
  not the server. The cap is resident memory (the working set on Windows) and is not configurable.
  Text reading starts one Node process per file (about 100 ms each); acceptable for hourly batches
  of 25 but not pooled. In the compliance calendar's area filter, retention items (E41-15) are listed under
  Records requests and privacy (they share its permissions).

## Verification status

- The full unit test suite (server and web) passes on Windows, and again with the clock
  on UTC; `.\grc.ps1 ci` runs it both ways, with the typecheck, a production build and the
  dependency audit (skipped without a network).
- The browser suite (`npm run test:e2e`, 145 tests in 21 suites) covers every route as an
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
