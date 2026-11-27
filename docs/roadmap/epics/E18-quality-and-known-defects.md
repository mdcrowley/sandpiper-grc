# E18 Quality and known defects

**Status:** done (70 of 70 issues done)

## Goal

Know what works, prove it automatically, and keep a visible list of what is wrong or
has never been checked, so nobody relies on something untested.

## Scope notes

- Defects found in any module are raised here, with a link from the feature's issue in
  its own epic.
- The verification status in `docs/known-gaps.md` is the source for the "never
  exercised" issues below. When one is closed, update that section in the same change.
- The accessibility audit and load testing are larger pieces of work and are tracked in
  [E16](E16-hosting-operations-and-hardening.md); their findings come back here as
  individual issues.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E18-01 | Security-terms matrix scrolls sideways at 1440px | done | P2 |
| E18-02 | Notification rules page scrolls sideways at 1440px | done | P2 |
| E18-03 | Proofread NIST CSF 2.0 outcome text against the publication | done | P1 |
| E18-04 | Check every screen in the dark theme | done | P2 |
| E18-05 | Check every screen at tablet width | done | P2 |
| E18-06 | Check keyboard-only use | done | P2 |
| E18-07 | Check non-administrator roles in the browser | done | P1 |
| E18-08 | Check that every form can be submitted in the browser | done | P1 |
| E18-09 | "Also satisfies" parser splits names that contain numbers | done | P3 |
| E18-10 | Automated API test suite | done | P1 |
| E18-11 | One-off browser pass of every screen | done | P2 |
| E18-12 | Automated browser tests | done | P2 |
| E18-13 | Transit positioning: nothing in built-in text identifies one organization | done | P1 |
| E18-14 | Tests for the web code | done | P3 |
| E18-15 | A ticket can be closed without a resolution code | done | P2 |
| E18-16 | Missed-target dashboard tile and its list disagree | done | P3 |
| E18-17 | Knowledge feedback can be given repeatedly | done | P3 |
| E18-18 | Evidence contract picker offers other vendors' contracts | done | P3 |
| E18-19 | Security incident pilot notice ignores the pilot-mode setting | done | P2 |
| E18-20 | Money shown with a hard-coded dollar sign in places | done | P2 |
| E18-21 | Approver role cannot accept risks | done | P2 |
| E18-22 | Audit log labels system events "Not signed in" | done | P3 |
| E18-23 | Assessment snapshot date is not validated | done | P3 |
| E18-24 | Navigation labels differ from page titles | done | P3 |
| E18-25 | Permissions granted but never checked | done | P2 |
| E18-26 | Only risks have an Actions tab | done | P2 |
| E18-27 | Dev mode ignored a custom port | done | P3 |
| E18-28 | Features that suit some transit organizations but not all | done | P2 |
| E18-29 | Reading a ticket list runs the service-level sweep | done | P3 |
| E18-30 | Escalating a project item creates a risk without a risk permission | done | P3 |
| E18-31 | Review the newer modules for permission and restricted-record checks | done | P1 |
| E18-32 | Hand-written routes: findings of the permission review | done | P1 |
| E18-33 | Web bundle is a single 1.8 MB script | done | P2 |
| E18-34 | Hand-written forms and record pages do not show custom fields | done | P2 |
| E18-35 | Web unit tests are not run by the main test command | done | P3 |
| E18-36 | Category labels run together on narrow bar charts | done | P3 |
| E18-37 | New dashboard: an empty name is refused with a toast, not beside the field | done | P3 |
| E18-38 | A report on records the role cannot see makes a refused request | done | P3 |
| E18-39 | Accessibility audit: findings left for other owners | done | P2 |
| E18-40 | People never see different numbers: figures include restricted records | done | P1 |
| E18-41 | Backups taken in the same second could be pruned at once | done | P1 |
| E18-42 | Chart drill-down works only with a pointer | done | P2 |
| E18-43 | Component tests for the generic list, form and record page | done | P3 |
| E18-44 | The role editor offers actions nothing checks | done | P3 |
| E18-45 | Custom fields on saved reports and dashboards are not asked or shown | done | P3 |
| E18-46 | A malformed date and time could be read as a date | done | P3 |
| E18-47 | Agency-flavored wording in editable defaults | done | P3 |
| E18-48 | Generic list and form show a field the metadata lacks | done | P3 |
| E18-49 | A list filter in the page address on a field the type lacks is still applied | done | P3 |
| E18-50 | Agency wording left in a core option name and an assistant prompt | done | P3 |
| E18-51 | A public reply on an email ticket could be emailed before it was saved | done | P2 |
| E18-52 | Continuous integration failed on macOS and on Linux before 06:00 | done | P2 |
| E18-53 | One SAML certificate in 128 could not be read | done | P1 |
| E18-54 | An API token's change was sometimes audited after the answer was sent | done | P2 |
| E18-55 | Faster first load: no web chunk over 500 kB | done | P3 |
| E18-56 | Date fields read typed dates day first | done | P2 |
| E18-57 | A person whose second factor is a passkey showed as "Not set up" | done | P2 |
| E18-58 | The one-time link dialog said nothing was emailed when it was | done | P3 |
| E18-59 | Small errors in help text, compose.yaml and a command-line message | done | P3 |
| E18-60 | Wave 14 guide check and screen reader findings | done | P2 |
| E18-61 | Wave 17 security review findings | done | P1 |
| E18-62 | Wave 17 correctness review findings | done | P2 |
| E18-63 | Wave 17 interface review: layout | done | P2 |
| E18-64 | Wave 17 interface review: pages and switched-off areas | done | P2 |
| E18-65 | Hand-written tables, the Create menu filter and the remaining interface items | done | P3 |
| E18-66 | Wave 19 security review: models and custom references | done | P1 |
| E18-67 | Wave 19 security review: provisioning, sign-in address and CSV | done | P1 |
| E18-68 | Wave 23 security review: access, platform, files and the Windows installer | done | P1 |
| E18-69 | The pilot seed profile added invented sample records | done | P1 |
| E18-70 | Data load mode: load historical records with their original dates, and undo a load | done | P1 |

---

### E18-01 Security-terms matrix scrolls sideways at 1440px

**Status:** done · **Priority:** P2 · **Type:** bug

As a security lead on an ordinary laptop screen, I have to scroll sideways to see the
whole security-terms matrix. The page should fit, or only the grid should scroll with
the vendor column held in place.

**Acceptance criteria**

- [x] At 1440px the page itself does not scroll horizontally
- [x] If the grid is wider than the page, it scrolls inside its own frame and the vendor column stays visible
- [x] Column headings remain readable
- [x] Checked in both themes

**Where:** `web/src/modules/vendors/TermsMatrix.tsx`, `vendors.css` (feature: [E06-05](E06-vendors-and-contracts.md))

**Done:** the matrix was rebuilt as a contained heat grid (E06-19); verified with no sideways scroll at 1440 and 820 in light and dark.

### E18-02 Notification rules page scrolls sideways at 1440px

**Status:** done · **Priority:** P2 · **Type:** bug

As an administrator on an ordinary laptop screen, I have to scroll sideways to see all
the columns of the notification rules table.

**Acceptance criteria**

- [x] At 1440px the page does not scroll horizontally
- [x] Long text columns wrap, or less-used columns move into the edit dialog
- [x] The same fix is applied to the checklist and contact tables if they overflow
- [x] Checked in both themes

**Where:** `web/src/modules/secincidents/RulesPage.tsx`, `EditableTable.tsx`, `secincidents.css` (feature: [E09-15](E09-security-incidents-and-notification-clocks.md))

**Done:** the rules page was rebuilt as tabbed settings; verified with no sideways scroll at 1440 and 820.

### E18-03 Proofread NIST CSF 2.0 outcome text against the publication

**Status:** done · **Priority:** P1 · **Type:** bug

As a security lead, I need the official text of every outcome to match the published
framework word for word. The included text was written from memory and has not been
checked.

**Acceptance criteria**

- [x] All 106 subcategories compared with the publication (CSWP 29): compared by script with NIST's
      machine-readable export of CSF 2.0 (the reference data published with CSWP 29, downloaded
      from nist.gov in November 2026). All 106 outcome texts match word for word
- [x] GV.SC-06, GV.SC-09 and PR.AA-05 checked first, as already suspected: they match
- [x] Category and function names checked too, and category and function descriptions: they match.
      The only differences are typographic and on NIST's side of the export: it writes function names in
      capitals (GOVERN) where the publication's text uses Govern, uses hyphens where the publication prints
      em dashes (GV.OC description, GV.OC-03), and has a double space in the PR.AA description. The
      application keeps the publication's form
- [x] Corrections made in `server/src/modules/frameworks/csf2.json`: none were needed in wave 4 (the GV.OC
      dashes were corrected in wave 2)
- [x] A way to refresh the text on installations that have already loaded it, without touching statuses:
      **Frameworks and structure > Check official wording** (`POST /api/frameworks/:id/refresh-text`, with
      `dryRun`), which lists and then applies differences in outcome text and function and category names
      and descriptions; nothing is added or removed and statuses, owners, targets, evidence, mappings and
      plain-language descriptions are untouched; audited as `framework.text_refresh`
- [x] The note in `docs/known-gaps.md` removed (and from the user guide)

**Implemented in** `server/src/modules/frameworks/importer.ts` (`refreshText`), `admin.ts`, `admin.test.ts`;
`web/src/modules/frameworks/RefreshText.tsx`, `Manage.tsx`

**Where:** `server/src/modules/frameworks/csf2.json` (feature: [E07-02](E07-framework-outcomes-and-assessments.md))

### E18-04 Check every screen in the dark theme

**Status:** done · **Priority:** P2 · **Type:** bug

As a user who prefers the dark theme, I can read every screen. The dark theme has not
been exercised in a browser.

**Acceptance criteria**

- [x] Every route loaded in the dark theme with seeded data
- [x] No unreadable text, invisible borders or hard-coded light colors
- [x] Charts, the heat map, the relationship map and status colors are legible
- [x] Each problem found is fixed or raised as its own issue here

**Done:** every static route and one record of each type was loaded in the dark theme at 820px on 18 Nov 2026 with no script errors, failed calls or sideways scrolling (tools/browse.mjs --all-routes).

### E18-05 Check every screen at tablet width

**Status:** done · **Priority:** P2 · **Type:** bug

As a user on a tablet, I can use the application. No screen has been checked below
desktop width.

**Acceptance criteria**

- [x] Every route loaded at about 768px and 1024px wide
- [x] Navigation is reachable and can be closed
- [x] Tables scroll inside their own frame, never the whole page
- [x] Dialogs fit the screen
- [x] Each problem found is fixed or raised as its own issue here

**Done:** every static route and one record of each type was loaded at 820px wide on 18 Nov 2026 with no sideways scrolling.

### E18-06 Check keyboard-only use

**Status:** done · **Priority:** P2 · **Type:** bug

As a user who does not use a mouse, I can reach and operate everything. Keyboard-only
use has not been tested.

**Acceptance criteria**

- [x] The main journey in each module completed with the keyboard alone (the shell, the search window, lists, a New dialog, record tabs and the dashboard layout; and, module by module, every list and one record of each: every Tab stop is reached from the skip link and shows a focus indicator, nothing that reacts to a click is left out of the Tab order, and each New dialog opens with Enter, keeps the focus and closes with Escape)
- [x] Focus is always visible and follows a sensible order (skip link, then the top bar, then the navigation, then the page)
- [x] Dialogs trap focus and return it when closed
- [x] Menus, tabs, pickers and the relationship map can be operated (menus, tabs, navigation, list tables, the dashboard grid, a record picker: type, arrows and Enter choose, Escape closes the list before the dialog; and the relationship map: Tab to a node, Enter selects it, the arrow keys move the view)
- [x] Each problem found is fixed or raised as its own issue here

**Found and fixed:** the whole navigation (some 80 Tab stops) came before the top bar, so
search, Create and the account menu were the last things a keyboard user reached; the top
bar now comes first in the page (`web/src/core/Shell.tsx`; the look is unchanged).

**Found by the module tour:** on the Overview, dashboards and reports, a chart's bars and slices
open the records behind them with a pointer only (E18-42). Record pickers open their list as soon
as they take the focus, so when focus comes back to one (after closing the "Discard this draft?"
question) the first Escape closes its list and the next one the dialog; noted in the accessibility
statement.

**Implemented in:** `tools/e2e/suites/05-keyboard.mjs` and `tools/e2e/suites/08-keyboard-modules.mjs` (run by `npm run test:e2e`).

### E18-07 Check non-administrator roles in the browser

**Status:** done · **Priority:** P1 · **Type:** bug

As an agent, security lead or project manager, I see only what my role allows and
nothing breaks. Every screen has so far been loaded only as an administrator; the API
tests cover other roles but the web app has not been tried with them.

**Acceptance criteria**

- [x] Sign in as each enabled default role and walk every navigation entry
- [x] No navigation entry leads to a "forbidden" error
- [x] No page shows a failed request for something the role may not read (one exception raised as E18-38)
- [x] Buttons for actions the role cannot take are hidden or disabled (New, Export, row selection for bulk edit, Edit)
- [x] The overview dashboard is sensible for each role
- [x] Roles shipped switched off are tried once switched on

**Implemented in:** `tools/e2e/suites/04-roles.mjs`: one user per default role (approver,
executive viewer, auditor and requester switched on in the scratch instance) visits every
route; pages a role may not use must say "No access", restricted records stay hidden
without `security.view`, and the role x page matrix is written to
`tools/e2e/out/role-matrix.md`.

### E18-08 Check that every form can be submitted in the browser

**Status:** done · **Priority:** P1 · **Type:** bug

As a user, I can create and edit every kind of record from the screen. Screens were
loaded once without errors, but forms were not submitted.

**Acceptance criteria**

- [x] Create and edit one of every record type through the web app (25 types; dashboards, report packs and reports are changed in their own editors, which the create step drives)
- [x] Every hand-written dialog submitted once (ticket actions, check-out, disposal, gate decision, acceptance, declare incident, and so on): declare incident, the change wizard, the report builder, the second-factor set-up and bulk edit; and in `07-dialogs.mjs`: resolve, close and "with vendor" on a ticket; check out, check in and dispose of an asset; complete a risk review, record a risk acceptance, add an action from a risk; record a gate decision; approve and complete a change; assign, mark fixed and accept the risk of a vulnerability; record training on a course; add an exercise finding. Each is opened from its record page, submitted empty where it asks for something (refused beside the field), filled in and submitted, and the change is read back through the API
- [x] Validation messages appear beside the right field (an empty New form and an emptied title on edit are refused with a message beside the field, for every type)
- [x] Each problem found is fixed or raised as its own issue here (E18-37)

**Implemented in:** `tools/e2e/suites/03-records.mjs`, `tools/e2e/suites/07-dialogs.mjs` and
`tools/e2e/lib/forms.mjs` (fill any form by its labels, whatever the control).

### E18-09 "Also satisfies" parser splits names that contain numbers

**Status:** done · **Priority:** P3 · **Type:** bug

As the person loading framework designations, a cross-mapping to a framework whose name
itself contains a number is split in the wrong place: the parser treats the first word
containing a digit as the start of the reference, unless the name is one it already
knows.

**Acceptance criteria**

- [x] A name containing a number, followed by a reference, is split correctly (a colon, a known name, then the general rule; done in E07-17)
- [x] The list of known names is data (lookup `mapping_framework` plus names in use), and a colon is an explicit separator
- [x] Tests cover names with a number, names without, and entries with no reference (`extras.test.ts`)
- [x] Mappings already loaded wrongly can be corrected by running the seed again: a mapping the seed wrote
      (no author) with the same words split differently is replaced, audited, and reported in the seed's
      summary; mappings people added are left alone (`seed.test.ts`)

**Implemented in** `server/src/modules/frameworks/mappings.ts`, `seed.ts`, `seed.test.ts`, `extras.test.ts`

**Where:** `parseMapping` in `server/src/modules/frameworks/seed.ts` (feature: [E07-11](E07-framework-outcomes-and-assessments.md))

### E18-10 Automated API test suite

**Status:** done · **Priority:** P1 · **Type:** feature

As a developer, I run one command and every module's API behavior is checked against
an in-memory database.

**Acceptance criteria**

- [x] Tests sit beside the code in each module and in core
- [x] A helper gives a signed-in administrator, a client for any other role, and an anonymous client
- [x] One module can be tested with the others not loaded
- [x] Permissions and restricted-record rules are tested for non-administrator roles
- [x] 205 tests passing with all modules loaded, as recorded in `docs/known-gaps.md`
- [x] Tests never read the private seed folder

**Implemented in:** `server/src/test/helpers.ts`; `*.test.ts` under `server/src/core/` and `server/src/modules/`; `vitest.config.ts`

### E18-11 One-off browser pass of every screen

**Status:** done · **Priority:** P2 · **Type:** feature

As a maintainer, I know every screen at least loads: each was opened once in a headless
browser at 1440px, light theme, as an administrator, against seeded data, with no
script errors or failed requests.

**Acceptance criteria**

- [x] Every route loaded once
- [x] No script errors and no failed API calls
- [x] The two pages that overflow were noted (E18-01, E18-02)
- [x] Repeatable as an automated check (built in E18-12: `tools/e2e/suites/01-smoke.mjs` loads every route)

**Recorded in:** `docs/known-gaps.md` ("Verification status"). No script for this pass is kept in the repository.

### E18-12 Automated browser tests

**Status:** done · **Priority:** P2 · **Type:** feature

As a maintainer, a small set of browser tests runs the main journey of each module on
every change, so a broken screen is caught before a user finds it.

**Acceptance criteria**

- [x] A smoke test loads every route and fails on a script error or failed request
- [x] One journey per module: create, edit, and one module-specific action (per record type: create, an empty form refused, edit, status, comment, attachment; plus sign-in and sign-out, second-factor enrollment, search, bulk edit and export)
- [x] Run as an administrator and as one non-administrator role (every default role, in `04-roles.mjs`)
- [x] Run in both themes (the smoke test runs light at 1440 and dark at 820)
- [x] Part of continuous integration ([E16-12](E16-hosting-operations-and-hardening.md)): the browser job in `.github/workflows/ci.yml` runs `npm run test:e2e` on every push and pull request, split into parallel parts (roles; smoke, sign-in and features off; the rest through `--skip`; the accessibility audit) once the whole run passed an hour

**Implemented in:** `tools/e2e/` (`run.mjs`, `lib/`, `suites/01-smoke` to `08-keyboard-modules`),
started by `npm run test:e2e`: it builds the web application (or uses `E2E_WEB_DIST`),
starts a throw-away instance on a free port with the dev seed, drives headless Edge or
Chrome over the DevTools protocol, logs every step to `tools/e2e/out/log.txt`, saves a
screenshot of each failure and exits non-zero on any failure.

### E18-13 Transit positioning: nothing in built-in text identifies one organization

**Status:** done · **Priority:** P1 · **Type:** debt

As a maintainer about to publish the repository, I want every built-in label,
description and notice to suit any transit organization (bus, rail or paratransit
operator), with nothing that identifies one organization and no single jurisdiction's
law as a default. Transit terms are expected; names of real organizations, agencies,
regulators, people, places and vendors are not.

**Acceptance criteria**

- [x] The pilot-mode notice in `web/src/core/Shell.tsx` names no particular kind of data or client (now: "Use sample and test data only. Do not enter real records, personal details or anything confidential while this label is showing.")
- [x] Default role descriptions in `server/src/core/services.ts` name no particular job titles, with a test; existing databases get the new wording through "Apply default permissions" where the old wording was never edited
- [x] The second risk scale's short key was an abbreviation from one sector; it is now `hazard_4x5`, with a migration for scales, ratings, risks, the category list and the acceptance thresholds (`server/src/modules/risks/migrations/002_action_restriction_and_scale_key.sql`)
- [x] The built-in yes/no questions on a security incident keep only "cyber incident" and "personal information"; other kinds of data are values of the `incident_data_kind` list, which an administrator or the organization profile fills (`server/src/modules/secincidents/migrations/002_data_kinds.sql`)
- [x] The example in the code comment in `server/src/modules/frameworks/seed.ts` uses an invented framework name
- [x] Default list values, field labels and seed text in every module use general transit terms or invented names, and nothing that identifies one organization; see E18-28 for features that suit some transit organizations but not all. `examples/organization.example.json` uses the current trigger `kind:payment_card_data`
- [x] A search of the tracked files for the installation's own name, places and people finds nothing
- [x] The README, documentation index, getting-started page, contributing guide and `package.json` present the product as GRC for transit organizations
- [x] A scan of every tracked file before publishing (18 Nov 2026) found no organization identifiers, street addresses or phone numbers other than invented ones, no private keys, credentials or API keys, and no private, generated or screenshot files

**Implemented in:** `README.md`, `docs/README.md`, `docs/user/01-getting-started.md`, `CONTRIBUTING.md`, `package.json`, `docs/development.md`

### E18-14 Tests for the web code

**Status:** done · **Priority:** P3 · **Type:** debt

As a developer, the shared web helpers have their own tests. Today all automated tests
are on the server.

**Acceptance criteria**

- [x] Unit tests for formatting, the list query builder and the saved-view store (`format.test.ts`: dates in the organization's zone, date-time inputs across daylight-saving changes, durations, money; `api.test.ts`: query strings, the list contract, the CSRF header, error bodies, the sign-in handler; `listState.test.ts`: views read from the address, comparing views, saved views in the browser; `preferences.test.ts`, `labels.test.ts`, `meta.test.ts`: preferences on the server and in the browser, custom-field order, record addresses, the form field shell)
- [x] Component tests: the read-only display components (Timeline, KeyValue, AgendaList) are rendered to HTML in `display.test.ts`; the generic list, form and record page need a browser-like environment and are split out as E18-43
- [x] Run by the same `test` command (`web/src/**/*.test.ts`, E18-35)

**Implemented in:** `web/src/core/*.test.ts`

**Note (wave 8).** Component tests that open a Mantine picker click it again until its list shows (up to 10 s; `openPicker` in `web/src/core/ListBulk.component.test.ts`): on GitHub's slower runners a single click could land before the picker was ready, and the bulk-edit test failed there while passing locally.

### E18-15 A ticket can be closed without a resolution code

**Status:** done · **Priority:** P2 · **Type:** bug

Resolving a ticket required a resolution code, but setting the status straight to Closed did not.

**Acceptance criteria**

- [x] Closing a ticket requires a resolution code, on create and on update, and the code cannot be cleared while the ticket is closed
- [x] Canceling does not (any status whose list value carries `resolution_code: false` is exempt)
- [x] The Close dialog asks for the code

**Implemented in:** `server/src/modules/tickets/index.ts`; `web/src/modules/tickets/TicketActions.tsx`; `server/src/modules/tickets/tickets.test.ts`

### E18-16 Missed-target dashboard tile and its list disagree

**Status:** done · **Priority:** P3 · **Type:** bug

The service desk dashboard tile counted tickets that missed either target, but opened a list filtered on resolution breaches only.

**Acceptance criteria**

- [x] The tile and the list it opens show the same tickets (a read-only `target_missed` field; the tile links to `f.target_missed=true`)

**Implemented in:** `server/src/modules/tickets/migrations/002_feedback_and_missed_target.sql`, `index.ts`; `web/src/modules/tickets/Dashboard.tsx`

### E18-17 Knowledge feedback can be given repeatedly

**Status:** done · **Priority:** P3 · **Type:** bug

One person could click "was this helpful" any number of times on the same article.

**Acceptance criteria**

- [x] One vote per person per article version; answering again replaces the earlier answer and is not counted twice

**Implemented in:** `server/src/modules/tickets/migrations/002_feedback_and_missed_target.sql`, `index.ts`

### E18-18 Evidence contract picker offers other vendors' contracts

**Status:** done · **Priority:** P3 · **Type:** bug

When adding evidence for a vendor, the contract picker listed every contract; the server then rejected the wrong ones.

**Acceptance criteria**

- [x] The picker lists only the chosen vendor's contracts

**Implemented in:** `web/src/modules/vendors/EvidenceForm.tsx`, `EvidencePages.tsx`, `VendorPages.tsx`

### E18-19 Security incident pilot notice ignores the pilot-mode setting

**Status:** done · **Priority:** P2 · **Type:** bug

The notice on the incident workspace always showed, even when an administrator had switched pilot mode off.

**Acceptance criteria**

- [x] The notice follows the pilot-mode setting

**Implemented in:** `web/src/modules/secincidents/Workspace.tsx`

### E18-20 Money shown with a hard-coded dollar sign in places

**Status:** done · **Priority:** P2 · **Type:** bug

Project settings, the budget chart and the contract import assumed dollars whatever GRC_CURRENCY is.

**Acceptance criteria**

- [x] Every money value and input in the projects, vendors, inventory and service desk screens uses the configured currency
- [x] The contract import and the asset import read amounts in the configured currency and reject another currency's symbol
- [x] Typed amounts in any record accept any currency symbol and the configured code

**Implemented in:** `web/src/modules/projects/bits.tsx`, `PortfolioBudget.tsx`, `SettingsPage.tsx`; `parseTotalValue` (`server/src/modules/vendors/seed.ts`); `parseAmount` (`server/src/modules/inventory/importer.ts`); `validate` (`server/src/core/resource.ts`)

### E18-21 Approver role cannot accept risks

**Status:** done · **Priority:** P2 · **Type:** bug

The Approver role description promised risk acceptance but the role has no risks permission.

Decision: the description changed, not the grants. Seeing a risk needs `security.view`,
which would also open every security incident to approvers. An acceptance is recorded by
someone who can see the risk and names the approver.

**Acceptance criteria**

- [x] The default Approver grants match its description, with a test
- [x] Changes to default roles reach existing databases through an explicit, audited step (Administration > Roles > "Apply default permissions") that only adds grants and never removes an administrator's edits; a default grant removed after a sync is not offered again
- [x] The limit is documented: on a database from before this step, the first run offers every default grant the role lacks

**Implemented in:** `DEFAULT_ROLES`, `defaultGrantDifferences`, `syncDefaultGrants` (`server/src/core/services.ts`); `GET /api/admin/roles/default-grants`, `POST /api/admin/roles/sync-default-grants` (`server/src/modules/admin/roles.ts`); `web/src/modules/admin/Roles.tsx`; tests "default role grants" in `server/src/modules/admin/admin.test.ts`

### E18-22 Audit log labels system events "Not signed in"

**Status:** done · **Priority:** P3 · **Type:** bug

Events written by the system (seeding, timers) read as if someone was not signed in.

**Acceptance criteria**

- [x] System events show "System" as the actor, including older events stored with no actor name and no address
- [x] A failed sign-in, which is a request from nobody signed in, shows "Not signed in" with its source address rather than "System"

**Implemented in:** `makeAudit` (`server/src/core/services.ts`); `server/src/core/auth.ts`; `web/src/modules/admin/AuditLog.tsx`, `UserDetail.tsx`; test "audit actor" in `server/src/core/core.test.ts`

### E18-23 Assessment snapshot date is not validated

**Status:** done · **Priority:** P3 · **Type:** bug

A snapshot could be created with an invalid or far-future date.

**Acceptance criteria**

- [x] The date is validated on the server (a real day, not in the future, not before 2000) and in the dialog

**Implemented in:** `server/src/modules/frameworks/index.ts`; `web/src/modules/frameworks/Assessments.tsx`

### E18-24 Navigation labels differ from page titles

**Status:** done · **Priority:** P3 · **Type:** improvement

For example Catalog / Service catalog and Security terms / Security terms matrix.

**Acceptance criteria**

- [x] Each navigation item and its page title match in the service desk, inventory, vendors, frameworks, security incidents and projects modules (now "Service catalog", "Security terms matrix", "Project portfolio", "New project request"; the incident page is "Rules and checklists" since wave 12)
- [x] The newer modules are checked too (wave 12: every navigation entry, 123 of them, checked by the browser test "navigation labels match page titles" in `tools/e2e/suites/01-smoke.mjs`, which also fails when a label is cut off in the sidebar; only **Overview** is exempt, as it greets the person by name). Fixed: **Vendor offboarding** (menu), and the page titles **Risk reviews** (was "Reviews and acceptances"), **Rules and checklists** (was "Notification rules and checklists"), **Safety dashboard** (was "Safety"), **Audits** (was "Audits and inspections"), **Lists** (was "Lists and tags") and **User guide** (was "Help")

**Implemented in:** each module's `web/src/modules/<key>/index.tsx` and page headers (`vendors/index.tsx`, `vendors/Offboardings.tsx`, `risks/RiskReviews.tsx`, `risks/RiskRegister.tsx`, `secincidents/RulesPage.tsx`, `Workspace.tsx`, `KitPage.tsx`, `safety/Dashboard.tsx`, `audits/Dashboard.tsx`, `admin/Lists.tsx`, `help/HelpHome.tsx`, `HelpPage.tsx`, `ApiReference.tsx`); test in `tools/e2e/suites/01-smoke.mjs`; the menu table in `docs/user/01-getting-started.md` brought up to date

### E18-25 Permissions granted but never checked

**Status:** done · **Priority:** P2 · **Type:** debt

The dashboards, reports and portal permissions appear in role grants but no route checks them.

When this was raised, no route checked them. The Overview, the reporting module and the
self-service portal now do (below).

**Acceptance criteria**

- [x] Each is either enforced by the screens and routes it names, or removed: `dashboards.view` decides whether the Overview shows its Dashboard part (`DASHBOARD_PERMISSION` in `web/src/modules/home/registry.ts`) and guards the reporting module's dashboards (a record type of module `dashboards`); `reports` is checked by the reporting module (`server/src/modules/reports`); `portal.view` and `portal.create` are checked by the self-service portal (`server/src/modules/portal/access.ts`, `requests.ts`, `files.ts`)
- [x] The role editor says which permission areas nothing checks yet (`web/src/modules/admin/RoleDetail.tsx`, from the list in `server/src/core/permission-use.ts` since E18-44: a combination nothing checks is grayed out, and an area with nothing checked at all carries a "not yet used" hint)

**Audit (19 Nov 2026):** every permission a default role grants by name is checked by a route.
The record-type routes check `<module>.view`, `create`, `edit`, `delete` and `export` for every
module that has a record type; the approver's `changes.approve`, `projects.approve`,
`tickets.approve` and `assets.approve`, the auditor's `frameworks.export` and `audit.view`, and the
requester's `portal.view` and `portal.create` are each checked by name. What remains is the other
way round: the role editor offers every action for every area, about 40 of those combinations
are checked by nothing (for example `knowledge.approve`, `audit.create`, `portal.export`), and its
"not yet used" hint still names `portal` (E18-44, done since).

**Implemented in:** `web/src/modules/home/registry.ts` (`DASHBOARD_PERMISSION`); `server/src/modules/reports/index.ts` (`reports.view` or `dashboards.view`; tested in `delivery.test.ts`); `server/src/modules/portal/access.ts`, `requests.ts`, `files.ts`; `web/src/modules/admin/RoleDetail.tsx` with `server/src/core/permission-use.ts`. Default grants in `DEFAULT_ROLES` (`server/src/core/services.ts`).

### E18-26 Only risks have an Actions tab

**Status:** done · **Priority:** P2 · **Type:** improvement

Actions can arise from incidents, assessments, vendors and projects, but only the risk page embeds the actions panel.

**Acceptance criteria**

- [x] Security incidents, framework outcomes, vendors, contracts and projects show their actions and can add one

**Done:** the shared Actions panel is embedded on problems, vendors, contracts, framework outcomes, security incidents, projects, changes, exercises and vulnerabilities.

### E18-27 Dev mode ignored a custom port

**Status:** done · **Priority:** P3 · **Type:** bug

The web dev server proxied to port 8080 whatever GRC_PORT was.

**Acceptance criteria**

- [x] The proxy follows GRC_PORT

### E18-28 Features that suit some transit organizations but not all

**Status:** done · **Priority:** P2 · **Type:** debt

A few built-in features, not just words, follow how a publicly funded transit agency
works: the asset "funder interest" flag and its disposal rule (equipment part-paid by an
outside funder), the contract "approval or resolution number", and the governing-body
approval on a ransom decision. Privately owned operators and contractors running service
for an agency may have no funder interest, board resolution or governing body in that
sense. Whatever is decided, nothing may identify one organization or assume one
jurisdiction's funding rules.

**Acceptance criteria**

- [x] Each is either made a setting that an installation can switch off or rename, or confirmed as general enough for the range of transit organizations: all three are **options within an area** (`OPTIONS` in `core/features.ts`, setting `feature_options`, Administration > Features), on by default with today's names so an installation that upgrades sees no change. Options rather than new areas, because each is one field and rule inside a part that otherwise suits everyone (inventory is not an area at all). **Outside funder interest in equipment** (inventory; also the vehicle fields), **Approval number on contracts** (vendors) and **Recorded approval of a ransom payment** (security incidents) can each be switched off or renamed ("Board resolution", "Approval reference", "Grant interest")
- [x] While an option is off its fields leave the record type's definition, so forms, lists, filters, record pages, exports, imports, the report builder, the API description and MCP tools drop them; values written to them are ignored and stored values are kept. Its rule stops: the disposal block, the ransom-approval check. Hand-written screens (asset disposal dialog, lifecycle band, disposal tab and queue, contract record, ransom tab, incident report, offline kit) and the inventory report column follow the metadata. A renamed option relabels the fields, the rule's messages and the report column
- [x] Each change needs a recent password confirmation and is audited (`features.option_change`)
- [x] Other agency-only assumptions reviewed in inventory, vendors, security incidents, policies, projects and safety: the rest is editable configuration (list values, rule templates, approval tiers) and is raised as E18-47; the generic list and form still show a field a page names but the metadata lacks (E18-48)
- [x] The user guide follows (Inventory, Vendors and contracts, Security incidents, Administration > Features)

**Where:** `server/src/modules/inventory/index.ts`, `server/src/modules/vendors/index.ts`, `server/src/modules/secincidents/index.ts`

**Implemented in:** `server/src/core/features.ts` (`OPTIONS`, `effectiveOptions`, `optionOn`, `optionName`, the gate's `applyOptions`); `server/src/modules/admin/features.ts`; `server/src/modules/inventory/lifecycle.ts`, `index.ts`, `importer.ts`, `reports.ts`; `server/src/modules/secincidents/index.ts`, `defaults.ts`; `web/src/modules/admin/Features.tsx`; `web/src/modules/inventory/*`; `web/src/modules/vendors/ContractPages.tsx`; `web/src/modules/secincidents/RansomTab.tsx`, `ReportPage.tsx`, `KitPage.tsx`; `server/src/modules/admin/feature-options.test.ts`

### E18-29 Reading a ticket list runs the service-level sweep

**Status:** done · **Priority:** P3 · **Type:** debt

A `GET` on the ticket routes also runs the sweep that writes breach flags and system
audit events, so a read request changes data. It cannot be triggered from another site
in a harmful way (the change is the same one a timer would make), but reads should not write.

**Acceptance criteria**

- [x] The sweep runs on a timer only (a job-queue schedule every minute); neither the ticket routes nor `GET /api/tickets/metrics` run it. Metrics count a target that has just passed without writing anything; `POST /api/tickets/sla/sweep` (`tickets.administer`) runs it by hand

**Where:** `server/src/modules/tickets/index.ts`, `metrics.ts`; tests `tickets.test.ts`, `service.test.ts`, `metrics.test.ts`

### E18-30 Escalating a project item creates a risk without a risk permission

**Status:** done · **Priority:** P3 · **Type:** debt

A person with `projects.edit` can escalate a project item into a risk they cannot then
see. By design, and they get back only the new risk's id and reference, but it lets
someone without `risks.create` add to the risk register.

**Acceptance criteria**

- [x] Decide: keep (and say so in the user guide), or require `risks.create`. Decided: require it. Found
      already built when checked in wave 4: the route refuses with 403 without `risks.create`, the Items tab
      grays out **Escalate to risk register** and explains why, and the user guide's permission table and
      "Escalating a risk" say so

**Implemented in** `server/src/modules/projects/routes.ts` (escalate route), `features.test.ts`
("escalation needs create on risks"); `web/src/modules/projects/ItemsTab.tsx`; `docs/user/08-projects.md`

**Where:** `POST /api/projects/:id/items/:itemId/escalate` (`server/src/modules/projects/routes.ts`)

### E18-31 Review the newer modules for permission and restricted-record checks

**Status:** done · **Priority:** P1 · **Type:** debt

The review recorded in E18-32 covered core, administration and the seven original
modules. Change enablement, policies, training and exercises, vulnerabilities,
attachments, notifications and the operations commands were being written at the time
and were not reviewed.

**Acceptance criteria**

- [x] Every hand-written route checks a permission and, where it returns titles, labels or counts of other records, the restricted-record rules (`ctx.resources.find(type, id, user)` or `ctx.resources.visibleWhere`)
- [x] Every list they create names its owning module (`ctx.lookups.ensure(list, values, { module })`)
- [x] Every data change writes an audit event
- [x] Their tests pass with all modules loaded, not only alone

**Done:** reviewed against the rules above; every finding was fixed with a test in the owning module (changes quorum, vulnerability acceptance, self-approval of policy versions, private reports in dashboards, snapshot access, audit gaps).

### E18-32 Hand-written routes: findings of the permission review

**Status:** done · **Priority:** P1 · **Type:** bug

A read of every hand-written route in core, administration and the seven original
modules for missing permission or restricted-record checks, leaked counts, missing audit
events, unvalidated SQL identifiers and state-changing `GET` requests.

**Acceptance criteria**

- [x] `GET /api/actions/summary` counted restricted actions for everyone: now filtered ([E08-16](E08-risks-actions-and-obligations.md)). Superseded by E18-40: figures count every record again, and mask restricted owners and departments
- [x] `GET /api/audit` showed events about flagged records: now hidden (E01-27)
- [x] `GET /api/meta` and `GET /api/lookups/:list` returned every list: now limited (E01-23)
- [x] Reference labels ignored the target module's view permission: fixed (E01-28)
- [x] `GET /api/contracts/renewals` showed vendor names without `vendors.view`: now blank
- [x] `GET /api/systems/graph` showed the linked vendor record's name without `vendors.view`: the name recorded on the system is used
- [x] `POST /api/assets/:id/check-in` closed the assignment before rejecting a bad status: validated first
- [x] `POST /api/assets/:id/check-out` did not check `site_id`: it must exist and be visible
- [x] Security incident role copy and checklist changes on scenario change, and assessment status capture, wrote no audit event: added
- [x] A resource's default sort field and inherited-restriction fields are checked against the identifier pattern like every other column name
- [x] `GET /api/audit` answered a malformed date with a server error: now 400
- [x] No state-changing `GET` that another site could abuse; see E18-29 for the one read that writes
- [x] Left open and raised separately: E18-29, E18-30, E18-31 (all three since done)

### E18-33 Web bundle is a single 1.8 MB script

**Status:** done · **Priority:** P2 · **Type:** debt

Every module loads at start. Split the bundle by route so the first page loads quickly.

**Acceptance criteria**

- [x] Each module's pages load on demand: the `grc-modules` plugin in `vite.config.ts` reads each module's `key`, `nav`, `create` and route paths at build time (`virtual:grc-modules`); `web/src/core/module.ts` and `lazyRoutes.tsx` load a module's chunk when one of its routes is first opened (with a quiet loading bar after 150 ms, an error state with Reload, and preloading on hover or focus of a navigation link). Help's Markdown is a chunk per page, loaded when Help is opened
- [x] The initial script is under 500 kB: before, one 1,769 kB script (about 520 kB compressed); now the entry script is 378 kB plus 258 kB of React and the router in their own long-cached chunk, 193 kB compressed in all. Charts (649 kB) and each module (5 to 112 kB) load when needed. `GRC_ANALYSE=1 npx vite build` lists what each package weighs

**Implemented in:** `vite.config.ts`, `web/src/core/module.ts`, `web/src/core/lazyRoutes.tsx`, `web/src/core/virtual.d.ts`, `web/src/modules/help/guide.ts`

### E18-34 Hand-written forms and record pages do not show custom fields

**Status:** done (reports and dashboards split out as E18-45) · **Priority:** P2 · **Type:** bug

The generic list, form and record page show an administrator's custom fields by themselves
(see `web/src/core/README.md`, section 12). Pages that build their own form do not, and a
**required** custom field then makes such a form fail on the server.

Core now offers `useCustomFieldInputs(type, { initial? })` (`web/src/core/CustomFieldInputs.tsx`):
the controls grouped by section, `collect()` for the request body with the required check, and
`showErrors(err.fields)`; and `FieldControl` for one field. Every record page built on
`RecordPage` already shows custom fields (the summary, or a **More details** card after a
`summary` of its own), and every form built on `ResourceForm` (including `EditableSummary`
cards and `ResourceList`'s New dialog) adds them.

**Acceptance criteria**

- [x] A reusable component for hand-written forms (`useCustomFieldInputs`), applied in the core
  forms and record pages
- [x] Every module's hand-written create forms add it: the new ticket dialog (last, under its own
  headings), the new change flow (on the **Details** step, or under the chosen template for a
  standard change; `Next` checks required ones), declaring a security incident (step 1), taking an
  assessment snapshot, the project request, and the action quick add (only the **required** ones,
  shown once a title is typed, so the line stays quick; the rest are filled in on the action's
  page). A server refusal of a custom field is shown beside it
- [x] The portal request form deliberately asks no custom fields: they are the service desk's
  own classification, may pick people or records a requester cannot see, and a catalog item's
  questions are how requesters are asked for more. The portal route takes only its own fields and
  does not enforce required custom fields (E15-14); `portal/RequestForm.tsx` says so
- [x] A project request asks them only of people who may view projects (only they have the
  project type in their metadata); for anyone else the server neither takes custom values nor
  enforces required ones (`skipCustomRequired`)
- [x] Server routes that build the record themselves pass `cf_<key>` values through to the
  resource engine: `POST /api/changes/templates/:id/raise`, `POST /api/assessments`,
  `POST /api/projects/requests`. Tickets, changes, security incidents and actions use the generic
  create, which already took them
- [x] Every record page shows them: pages built on `RecordPage` already did; the security incident
  workspace has a **More details** card in its side rail, and the assessment snapshot page one
  under the notes (the snapshot's own statuses stay fixed). Edit forms built on `ResourceForm`
  (the workspace's **Edit details**) already included them
- [x] Checked with a required text field on each of the six types in light and dark at 1440 and
  820: the form shows it, refuses to send without it with the message beside the field, and the
  value is saved and shown on the record page
- Reports and dashboards are split out as E18-45: an administrator can add custom fields to them,
  but they are saved configurations rather than records, and their dialogs do not ask them

**Implemented in:** `web/src/core/CustomFieldInputs.tsx`, `web/src/core/FieldControl.tsx`,
`web/src/core/ResourceForm.tsx`, `web/src/core/RecordPage.tsx`; `web/src/modules/tickets/NewTicketDialog.tsx`,
`web/src/modules/changes/NewChange.tsx`, `web/src/modules/secincidents/DeclareIncident.tsx`,
`Workspace.tsx`, `web/src/modules/frameworks/Assessments.tsx`, `SnapshotDetail.tsx`,
`web/src/modules/projects/IntakeForm.tsx`, `web/src/modules/risks/ActionRows.tsx` (and `risks.css`),
`web/src/modules/portal/RequestForm.tsx` (comment); `server/src/modules/changes/admin.ts`,
`server/src/modules/frameworks/index.ts`, `server/src/modules/projects/service.ts`. Tests:
`server/src/modules/changes/customfields.test.ts`, `frameworks/customfields.test.ts`,
`projects/customfields.test.ts`.

### E18-35 Web unit tests are not run by the main test command

**Status:** done · **Priority:** P3 · **Type:** debt

Tests for pure web helpers (the QR encoder, Help's route map and search, the Overview layout)
live beside the code as `web/src/**/*.test.ts` and run with
`npx vitest run --config tools/vitest.web.config.ts`. The main `vitest.config.ts` includes only
`server/src/**/*.test.ts`.

**Acceptance criteria**

- [x] `vitest.config.ts` also includes `web/src/**/*.test.ts` (as a second project, environment `node`), so `npm test` runs them

**Done:** `vitest.config.ts` includes `web/src/**/*.test.ts`; `.\grc.ps1 ci` runs them.

### E18-36 Category labels run together on narrow bar charts

**Status:** done · **Priority:** P3 · **Type:** bug

On the Assets and systems dashboard, the Assets by status chart prints its category labels with no space between them (for example Ordered and In stock) at 1440px.

**Acceptance criteria**

- [x] Category labels on vertical bar charts wrap, rotate or abbreviate so none touch at 820px and wider: the chart measures the labels against the room each category has and keeps them on one line, wraps them onto two lines, or tilts and shortens them (hiding any that would still overlap), again whenever the chart is resized

**Implemented in:** `web/src/core/ChartImpl.tsx` (`fitCategoryLabels`), `web/src/modules/reports/charts.ts` (fixed label widths removed). Tests: `web/src/modules/reports/labels.test.ts`.

### E18-37 New dashboard: an empty name is refused with a toast, not beside the field

**Status:** done · **Priority:** P3 · **Type:** bug

Found by the browser tests (E18-08). In Reports > Dashboards > New dashboard, pressing
"Create and add widgets" with no name shows a passing notice ("Give the dashboard a
name.") instead of a message under the Name field, so a screen-reader user may miss it and
focus stays on the button. The browser tests reported this step as a known defect until it was
fixed (`tools/e2e/suites/03-records.mjs`, `known: { empty: 'E18-37' }`, removed in wave 12).

**Acceptance criteria**

- [x] The message appears under the Name field (`error` on the `TextField`) and focus moves to the field (`web/src/modules/reports/DashboardPages.tsx`, `create()`); a server refusal of the name shows there too, and the dashboard settings dialog marks an empty name the same way
- [x] The `known` entry for dashboards is removed from the browser tests (`tools/e2e/suites/03-records.mjs`, removed by the coordinator in wave 12; the step passes)

### E18-38 A report on records the role cannot see makes a refused request

**Status:** done · **Priority:** P3 · **Type:** bug

Found by the role tour (E18-07). A project manager opening a shared report about assets
(which the role may not view) gets a refused request (`403` from
`/api/reports/:id/run`) behind the page, rather than the page saying plainly that the
report covers records outside their role.

**Acceptance criteria**

- [x] The report page checks the role's view permission for the report's record type and says so, without asking the server to run it (`web/src/modules/reports`): the type must be in the metadata, which holds only types the person may view; Export, Schedule and Add to dashboard are hidden then
- [x] The role tour shows no failed request on `/reports/:id` for any role (checked with `tools/browse.mjs` as an executive viewer on a report about assets)

### E18-39 Accessibility audit: findings left for other owners

**Status:** done · **Priority:** P2 · **Type:** bug

Found by the automated accessibility audit (E16-15, `node tools/a11y/audit.mjs`), in files
outside the audit's own changes. Each line names the file and the fix.

**Acceptance criteria**

- [x] Dashboard calendar widget: `role="grid"` holds column headers and cells without rows (axe `aria-required-children`, `aria-required-parent`, critical). In `web/src/modules/reports/visuals.tsx` (line 79), wrap each week in `role="row"` (with `display: contents`, as the change calendar now does) or use `role="table"` with rows. Done: the month is a `role="table"` with a header row and one `role="row"` per week; every day (and blank) is a `role="cell"`, and a day with records keeps its button inside its cell. Rows and button cells use `display: contents`, so the layout is unchanged (the report page's calendar view shares it)
- [x] Safety overview (`/safety`) hazard matrix: empty cells are faded with `opacity: 0.55`, taking their rating text ("Medium", "High") to about 2.5:1 (axe `color-contrast`, serious, both themes). In `web/src/modules/safety/safety.css` (`.sf-cell.is-empty`), mark empty cells another way (a dashed border, or a lighter background with the full-strength text color). Done: an empty cell has a paler fill (its rating color mixed with the surface) and a dashed outline, with the rating text at full strength
- [x] The audit reports no serious or critical violation on any route in either theme at 1440 and 820 (re-run on 19 Nov 2026 after the fixes: 173 pages in four combinations, 692 checks, no violation of any impact; `tools/a11y/known.json` is now empty)
- [x] The audit is ready to fail the build: the two findings above are listed in `tools/a11y/known.json` with this issue, anything else serious or critical fails the run; remove their entries when they are fixed (the audit reports an entry that no longer matches as stale), and drop `--no-fail` from the CI step

**Implemented in:** `web/src/modules/reports/visuals.tsx` (`CalendarGrid`), `reports.css`
(`.rp-cal-row`, `.rp-cal-cell`); `web/src/modules/safety/shared.tsx` (`HazardMatrix`: colors as
`--sf-bg`/`--sf-fg`), `safety.css` (`.sf-cell.is-empty`); `tools/a11y/known.json` emptied.

**Fixed in the audit itself (for the record):** combobox pickers now always state
`aria-expanded` (`core/pickers.tsx`); Mantine's clear buttons have a name
(`core/mantine.tsx`); the search button, pilot badge and account button are named by what
they show (`core/Shell.tsx`, `core/shell.css`); the change calendar is a table of weeks with
day buttons named by their number and finished changes no longer faded below 4.5:1
(`modules/changes`); framework tiles, risk heat-map cells, project gate buttons and
relationship-map nodes start their names with their visible text; the relationship map is a
group, not an image holding buttons (`modules/inventory/MapCanvas.tsx`); the portfolio's
split rating bar is hidden from assistive technology beside the same figures in words
(`modules/projects`); skipped contract reminders are no longer faded below 4.5:1
(`modules/vendors/vendors.css`); chart descriptions read as plain English
(`core/ChartImpl.tsx`).

### E18-40 People never see different numbers: figures include restricted records

**Status:** done · **Priority:** P1 · **Type:** security

The owner's rule: two people who may both see a figure always see the same value. Before,
figures left out restricted records for people without `security.view`, so a safety manager
and a security lead read different totals for the same thing. Restriction now protects a
record's details (words and people), not its existence in a figure. The rule and its
reasoning are in `docs/security.md`, "Figures are the same for everyone".

**Acceptance criteria**

- [x] Pure figures count every record: `GET {path}/stats`, `/api/actions/summary` (except "mine"), report and dashboard summaries (count, total, average, share, pivot, number, gauge, progress, chart, calendar), scheduled deliveries, the safety dashboard and indicators (E20-14), the vendor page's system count, the vulnerability summary
- [x] A restricted record's words and people (text, long-text and person fields) are never matched by a search or condition in a figure, and a figure grouped by one puts it under "Restricted records", for everyone (`DETAIL_TYPES`, `MASKED_*` in `core/resource.ts`; `mask` in `reports/spec.ts`)
- [x] Lists stay filtered: list totals, drill-downs, record rows of a report or list widget, search, exports and pickers; a figure about "me" keeps the list rule
- [x] Summaries carry no export watermark (no restricted details); row reports still do
- [x] Knowledge base statistics count agent-only articles for everyone unless the question reads their words (`tickets/audience.ts`)
- [x] Tests: an administrator (or security lead) and an agent get identical figures and no restricted title or person (`core.test.ts`, `reports/query.test.ts`, `delivery.test.ts`, `sharing.test.ts`, `files.test.ts`, `risks.test.ts`, `tickets/service.test.ts`)

**Left as it is, deliberately:** statistics about saved reports and dashboards themselves
(`/api/reports/stats`) still follow sharing, because a private report is a person's own
work, not an organizational record. Revisit if anyone shows those counts.

**Implemented in:** `server/src/core/resource.ts`, `server/src/modules/reports/spec.ts`, `query.ts`, `server/src/modules/risks/index.ts`, `server/src/modules/vendors/index.ts`, `server/src/modules/vulnerabilities/summary.ts`, `server/src/modules/tickets/audience.ts`; `docs/security.md`

### E18-41 Backups taken in the same second could be pruned at once

**Status:** done · **Priority:** P1 · **Type:** bug

Backup archives are named by the second they are taken, with `_2`, `_3` for more in the same
second. Pruning sorted the names as text, so an encrypted archive (`.tar.sgrc`) ranked below a
plain one from the same second, and a new archive could reuse a lower number freed by pruning.
Either way the newest backup could be treated as the oldest and deleted straight after it was
written. Found by an intermittent test failure in CI (macOS and PostgreSQL legs).

**Acceptance criteria**

- [x] Archives are ordered by time, then by same-second sequence, whatever the extension
- [x] A new archive is numbered after the highest sequence used that second, never into a gap
- [x] Regression tests; the affected test passed 10 runs in a row

**Done:** `server/src/ops/online-backup.ts` (`byAge`, `nextArchiveName`), `server/src/ops/online-backup-order.test.ts`.

### E18-45 Custom fields on saved reports and dashboards are not asked or shown

**Status:** done · **Priority:** P3 · **Type:** bug

Split from E18-34. **Administration > Custom fields** offers every record type, including saved
reports (`report_definition`), dashboards, report schedules and report packs. These are saved
configurations rather than organizational records: the report builder's save dialog, the New
dashboard dialog and the dashboard settings do not ask custom fields, and the report and dashboard
pages do not show them. A **required** custom field on one of these types would make creating it
fail with a message about a field the dialog does not show.

**Acceptance criteria**

- [x] Decided (owner): allow them, ask them in the reporting dialogs with `useCustomFieldInputs` and
  show them with `CustomFieldsCard`
- [x] Asked in the report builder's save dialog, the New dashboard dialog, the dashboard settings
  (Save opens them when one is missing), Add to a dashboard (new dashboard), the schedule dialog,
  the New report pack dialog (generic form) and the pack editor; a required one is checked before
  sending, with the message beside the field, and a server refusal is shown there too
- [x] Shown (and editable by people who may change the item) under More details on the report page,
  the dashboard, the pack and the schedule panel; Save a copy carries the values over
- [x] Administration > Custom fields offers the four types with clear names ("Report schedule" rather
  than "Schedule"); a **Custom fields** button for administrators on the Reports, Dashboards, Report
  packs and Schedules pages opens it at the right type
- [x] A required custom field never blocks system work: the standard items are still seeded (core
  applies "required" to people only)
- [x] Tests: `server/src/modules/reports/customfields.test.ts` (values saved, required refused beside the
  field, history, seeding); browser check with an invented required field on dashboards, reports and
  schedules

**Implemented in:** `web/src/modules/reports/` (`custom.tsx`, `Builder.tsx`, `ReportPages.tsx`,
`DashboardPages.tsx`, `dialogs.tsx`, `PackPages.tsx`, `DeliveryPages.tsx`), `web/src/core/CustomFieldInputs.tsx`
(new optional `resetKey`, for a form whose record loads later or that reopens for another record),
`server/src/modules/reports/resources.ts` (label "Report schedule"). Tests: `customfields.test.ts`.

### E18-42 Chart drill-down works only with a pointer

**Status:** done · **Priority:** P2 · **Type:** bug

Clicking a bar, slice or point of a chart on the Overview, a dashboard or a report opens the
records behind it, but only with a pointer: a keyboard user could not reach them. Found by the
keyboard tour (E18-06).

**Acceptance criteria**

- [x] When a chart opens records on click, each data point also has a button, hidden until it has focus, named after its series, category and value, that does the same
- [x] Tested (`web/src/core/chartKeys.test.ts`)

**Implemented in:** `web/src/core/ChartImpl.tsx` (`segmentsOf`), `web/src/core/records.css` (`.rc-chart-keys`).

### E18-43 Component tests for the generic list, form and record page

**Status:** done · **Priority:** P3 · **Type:** debt

The read-only display components have rendering tests, but the generic list, form and record
page need a browser-like test environment (jsdom or happy-dom, a new development package) or an
exported metadata context before they can be tested on their own. Split from E18-14.

**Acceptance criteria**

- [x] A decision on the test environment (new package or exported context): the `happy-dom`
  development package (MIT, pinned 21.0.4; chosen over jsdom for its size and few dependencies),
  used only by files that ask for it with `// @vitest-environment happy-dom`; no testing library:
  React's own `act` and a small harness. The components render inside the application's real
  providers against a stand-in `fetch`
- [x] Tests for list filters and paging, form validation messages and the record page's tabs (also
  search, the tab kept in the address, the server's field messages beside their fields, and
  fields the record type lacks being left out)

**Implemented in:** `web/src/core/componentHarness.tsx`, `componentMeta.ts`;
`ResourceList.component.test.ts`, `ResourceForm.component.test.ts`, `RecordPage.component.test.ts`.
Found while writing them: E18-49.

### E18-44 The role editor offers actions nothing checks

**Status:** done · **Priority:** P3 · **Type:** debt

The role editor offers about 40 combinations of area and action that no route checks, so an
administrator can grant a permission that does nothing. Found by the permissions audit (E18-25).

**Acceptance criteria**

- [x] The "not yet used" hint no longer names `portal`, which is now checked
- [x] The server lists the permissions its routes check, and the role editor grays out the rest
  (`GET /api/admin/permissions/checked`: every `requirePerm`, every route description's
  `permission`, the record-type actions and `HOOK_CHECKS`; a test scans the source for
  permissions named in `can(`, `requirePerm(` and `permission:` and fails on one not listed. A
  grayed box cannot be newly checked; one already granted can be removed)

**Implemented in:** `server/src/core/permission-use.ts` (noted from `requirePerm` in
`core/services.ts` and `describe` in `core/openapi.ts`, registered in `app.ts`),
`permission-use.test.ts`; `web/src/modules/admin/RoleDetail.tsx`

### E18-46 A malformed date and time could be read as a date

**Status:** done · **Priority:** P3 · **Type:** bug

`fromZonedInput`, which turns a date-and-time box's value into an instant, accepted any text:
`'abc'` became 1 January 2000, because the browser reads `'abc:00Z'` as a date. Found by the
web unit tests (E18-14).

**Acceptance criteria**

- [x] Only a `YYYY-MM-DDTHH:MM` value is converted; anything else gives an empty value

**Implemented in:** `web/src/core/format.ts`.

### E18-47 Agency-flavored wording in editable defaults

**Status:** done · **Priority:** P3 · **Type:** debt

Found while reviewing E18-28. These defaults are configuration an administrator can change,
so they do not stop a private operator or a contractor using the product, but they read as
written for a publicly funded agency with a board:

- the ransom payment status "Approved by the governing body" (list `ransom_payment_status`)
  and the incident role note "Links the response team to the executive team and the governing body";
- the project approval tiers whose top tier adds a "Governing body" approver
  (`server/src/modules/projects/rules.ts`) and the sample milestone "Governing body date for the award";
- the funding source value "Grant or outside funder" (inventory and projects), and the
  inactive notification rule template "Funding agencies and partner operators";
- the report pack "Governing body security pack" and its cover subtitle;
- the contract field "Date and resolution (as recorded)", filled only from an earlier register.

**Acceptance criteria**

- [x] Each is either reworded so it reads for owners, directors and boards alike ("approving body", "the people your policy names"), or confirmed as general enough:
  ransom status "Approved for payment"; role note "Links the response team to senior leadership
  and to whoever approves major decisions (a board, directors or owners)"; top approver
  "Approving body (board, directors or owners)"; sample milestone "Award decision by the
  approving body"; notification rule "Funders and partner operators" (guidance "Grant or loan
  conditions..."); report pack "Leadership security pack", subtitle "Prepared for the board and
  senior leadership" (its key `governing_body_pack` kept). Confirmed as general enough: the
  funding value "Grant or outside funder" (private operators receive grants too) and the
  contract field "Date and resolution (as recorded)" (filled only from an earlier register)
- [x] A change to a list label reaches only new installations (`ensure` never overwrites an edited value), and the user guide says how to rename the rest
  (no stored value is rewritten: whether an administrator edited one cannot be told; the
  security incidents, projects and reports chapters say where to rename)

**Implemented in:** `server/src/modules/secincidents/defaults.ts`, `projects/rules.ts`,
`projects/seed.ts`, `reports/standard.ts`; `docs/user/07-security-incidents.md`,
`08-projects.md`, `15-dashboards-and-reports.md`. Left over: E18-50.

**Where:** `server/src/modules/secincidents/defaults.ts`, `server/src/modules/projects/rules.ts`, `server/src/modules/inventory/index.ts`, `server/src/modules/projects/defaults.ts`, `server/src/modules/reports/standard.ts`, `server/src/modules/vendors/index.ts`

### E18-48 Generic list and form show a field the metadata lacks

**Status:** done · **Priority:** P3 · **Type:** debt

A page that names a field in `columns`, `filters`, `createFields` or a summary's `fields`
shows it even when `/api/meta` does not have it (a field of an option that is switched off,
E18-28): `fieldMeta()` falls back to a text field named after the key. The inventory, vendor
and security-incident pages filter their own lists; the fleet vehicle pages and any later page
would have to do the same.

**Acceptance criteria**

- [x] `ResourceList`, `ResourceForm`, `RecordPage` and `EditableSummary` leave out a named field that is neither in the metadata nor a system field (a column with its own `render` stays)
- [x] The vehicle list and record drop the funder-interest fields while that option is off without their own code

**Where:** `web/src/core/ResourceList.tsx`, `ResourceForm.tsx`, `RecordPage.tsx`, `FieldValue.tsx`; `web/src/modules/fleet/Vehicles.tsx`

**Implemented in:** `web/src/core/fieldNames.ts` (`knownFields`), used by `ResourceList`, `ResourceForm` (fields and sections) and `EditableSummary`; `web/src/core/knownFields.test.ts`. The fleet vehicle pages need no code of their own.

### E18-49 A list filter in the page address on a field the type lacks is still applied

**Status:** done · **Priority:** P3 · **Type:** bug

Found by the component tests (E18-43). A page address or saved view with `f.<field>=` for a
field the record type does not have (an option switched off since, E18-28) still shows a filter
pill ("Funder interest: true") and sends the filter to the server. E18-48 left such fields out of
the columns, the Filters popover and the forms, but not out of filters read from the address.

**Acceptance criteria**

- [x] `ResourceList` ignores (and drops from the address) a filter on a field that `knownFields` leaves out
- [x] A component test covers it (`web/src/core/ResourceList.component.test.ts`)
- [x] The list API keeps its behavior, now documented and tested: a filter on a field the type does not have (or one hidden by a switched-off option) or an unknown operator answers 400 `bad_filter`, for the list, `/stats` and the exports alike

**Where:** `web/src/core/ResourceList.tsx`, `listState.ts`, `ListFilters.tsx`

**Implemented in:** `knownFilters` in `web/src/core/fieldNames.ts`, applied to the view in `web/src/core/ResourceList.tsx` (and written back to the address); tests `web/src/core/knownFields.test.ts`, `web/src/core/ResourceList.component.test.ts`, `server/src/core/list-filters.test.ts`; [API guide](../../api.md#filtering), [user guide](../../user/01-getting-started.md)

### E18-50 Agency wording left in a core option name and an assistant prompt

**Status:** done · **Priority:** P3 · **Type:** debt

Split from E18-47. Defaults outside the files reworded there still read as written for a public
agency: the default name of the ransom approval reference ("Governing body approval reference",
`OPTIONS` in `server/src/core/features.ts`, with its test in `modules/admin/feature-options.test.ts`
and the field label in `modules/secincidents/index.ts`), the assistant prompt "A one-page summary
for the governing body" (`modules/mcp/prompts.ts`), and the cover subtitle placeholder in
`web/src/modules/reports/PackPages.tsx`.

**Acceptance criteria**

- [x] Each reads for owners, directors and boards alike (for example "Payment approval reference", "a one-page summary for leadership or the board")

**Implemented in:** `server/src/core/features.ts` and `modules/secincidents/index.ts` (default name "Payment approval reference"; a name an administrator saved is kept), `modules/mcp/prompts.ts` ("leadership or the board"), `web/src/modules/reports/PackPages.tsx`; tests in `modules/admin/feature-options.test.ts` and `modules/secincidents/secincidents.test.ts`.

### E18-51 A public reply on an email ticket could be emailed before it was saved

**Status:** done · **Priority:** P2 · **Type:** defect

When a service desk agent posted a public reply on a ticket that came in by email, the email to
the requester was queued in a response hook that could run after the test (or a fast client) had
already read the outbox, and on the PostgreSQL wire-protocol run the reply was sometimes missing.

**Acceptance criteria**

- [x] The reply email is queued before the answer is sent, so a caller that sees the answer also sees the queued email
- [x] Passes on the embedded database and through the PostgreSQL wire protocol

**Implemented in:** `server/src/modules/tickets/email.ts` (the hook moved from `onResponse` to `onSend` and returns the payload on every path).

### E18-52 Continuous integration failed on macOS and on Linux before 06:00

**Status:** done · **Priority:** P2 · **Type:** bug

Two jobs failed on GitHub since wave 5. On macOS a PDF font test assumed that no single installed
font prints Hebrew and Chinese together, but a system font there does. In the browser tests on
Linux, completing the sample change in progress was refused ("The actual end cannot be before the
actual start") whenever the sample data was made before 06:00, because that change started at
06:00 today, still in the future.

**Acceptance criteria**

- [x] The font test picks a Chinese font that lacks Hebrew, and is skipped where there is none
- [x] The sample change in progress never starts in the future
- [x] The browser suite passes on Linux Chromium with the clock on UTC before 06:00

**Implemented in:** `server/src/core/export/fonts.test.ts`; `server/src/modules/changes/seed.ts` (`started`).

### E18-53 One SAML certificate in 128 could not be read

**Status:** done · **Priority:** P1 · **Type:** bug

The self-signed certificate this application makes for SAML sign-in (and the stand-in identity
provider and directory in the tests) took 16 random bytes as its serial number. When the first byte
was zero, about one time in 128, the number was written with a leading zero byte, which DER forbids
and OpenSSL refuses ("illegal padding"). Such a certificate could not be read by an identity
provider or by xml-crypto. In the tests it showed up as rare failures of the SAML sign-out, SAML
metadata and directory suites, only some runs and on any clock.

An installation whose SAML provider got such a certificate can make a new one: check **Make a new
key and certificate for this application when saving** on the provider, and give the new metadata
to the identity provider.

**Acceptance criteria**

- [x] INTEGERs are written in shortest form: leading zero bytes dropped, one added only before a byte with its top bit set
- [x] A test makes certificates with serials starting 00 12, 00 00 80, 00 80, 80, 7F and all zero, and reads each with OpenSSL (it failed with "illegal padding" before the fix)
- [x] The SAML sign-out tests name the refusal reason if they fail

**Implemented in:** `server/src/core/identity/x509.ts` (`integer`, and an optional serial for tests); test in `server/src/core/identity/saml.test.ts`; `server/src/modules/admin/saml-slo.test.ts`.

### E18-54 An API token's change was sometimes audited after the answer was sent

**Status:** done · **Priority:** P2 · **Type:** bug

The `token.use` audit event for a change made with an API token, and the portal notification that
tells a requester about a public reply, were written in a hook that runs after the answer has gone
out. A client that read the audit log or the requester's notifications straight after the answer
could miss them (seen once in the PostgreSQL CI job). This is the same race as E18-51.

**Acceptance criteria**

- [x] Both are written before the answer is sent (`onSend`, returning the payload on every path)
- [x] The token and portal tests pass on the embedded database

**Implemented in:** `server/src/core/tokens.ts`, `server/src/modules/portal/index.ts` (`tellRequester`).

### E18-55 Faster first load: no web chunk over 500 kB

**Status:** done · **Priority:** P3 · **Type:** improvement

After E18-33 the production build still warned that two chunks were over 500 kB: the entry script
(`index-*.js`, 706 kB, 211 kB compressed), which held the whole component library (Mantine, 277
kB of it), the date pickers and the shell, and the chart chunk (`ChartImpl-*.js`, 654 kB),
which held the chart library and its drawing engine. Every release changed the entry script, so
browsers fetched the component library again each time.

**Acceptance criteria**

- [x] Libraries in chunks of their own (`VENDOR_GROUPS` in `vite.config.ts`), each naming its
  packages exactly so nothing only some pages need is pulled into every page: `vendor-react` (258
  kB), `vendor-mantine` (421 kB: the component library, positioning, scroll locking, transitions),
  `vendor-dates` (94 kB), `vendor-echarts` (472 kB) and `vendor-zrender` (175 kB). Charts stay lazy
  (`core/Chart.tsx`); `ChartImpl` is now 9 kB
- [x] The date pickers load with the first date field (`core/dateFields.tsx`, lazy from
  `DateField` / `DateTimeField`, with a read-only stand-in of the same label and size for that
  moment), not with every page
- [x] The build prints no chunk-size warning; the entry script is 220 kB (66 kB compressed)
- [x] Measured in the browser (requests for the page's scripts and styles after sign-in, sizes
  from the build, compressed with gzip):

  | Page | Before | After |
  |---|---|---|
  | `/` (Overview, with charts) | 10 requests, 1,992 kB (570 kB gzip) | 13 requests, 1,929 kB (554 kB gzip) |
  | `/tickets` (a list) | 10 requests, 1,437 kB (379 kB gzip) | 11 requests, 1,372 kB (361 kB gzip) |
  | `/admin/organization` | 13 requests, 1,614 kB (428 kB gzip) | 14 requests, 1,549 kB (410 kB gzip) |

  Each page downloads about 65 kB less (the date pickers), in one or three more files fetched in
  parallel; and after an upgrade only the application's own chunks change, so a returning browser
  fetches about 220 kB instead of 706 kB for the start of every page
- [x] Nothing changed in behavior: Help, PDF and print-ready exports, charts, the portal and date
  fields checked in the browser and with the targeted browser tests

The Help home still fetches every chapter of the user guide (one small chunk each, in parallel)
to build its contents and search; that is unchanged.

**Implemented in:** `vite.config.ts` (`VENDOR_GROUPS`), `web/src/core/fields.tsx`,
`web/src/core/dateFields.tsx`; `web/src/core/README.md` ("Code splitting").

### E18-56 Date fields read typed dates day first

**Status:** done · **Priority:** P2 · **Type:** bug

Date fields showed "18 Nov 2026" and read a typed "3/4/2026" as April 3, while the rest of the
application uses US order. Found by the documentation pass.

**Acceptance criteria**

- [x] Date and date-time fields show "Nov 18, 2026" (24-hour times, as elsewhere)
- [x] Typed numbers are read month first (11/18/2026); a month written as a word works either side of the day; 2026-11-18 still works

**Implemented in:** `web/src/core/fields.tsx` (`TYPED_DATE_FORMATS`, `valueFormat`), `tools/e2e/lib/forms.mjs`, `docs/user/01-getting-started.md`.

### E18-57 A person whose second factor is a passkey showed as "Not set up"

**Status:** done · **Priority:** P2 · **Type:** bug

The user list and a person's page looked only at the authenticator app, so someone whose second
factor is a passkey or security key showed "Not set up", and **Reset second factor** was hidden,
although the reset also removes passkeys.

**Acceptance criteria**

- [x] The user list shows the second factor as on when the person has a passkey
- [x] The person's page names the authenticator app and the number of passkeys, and offers the reset

**Implemented in:** `server/src/modules/admin/users.ts` (`passkeys` in `USER_SELECT`), `web/src/modules/admin/Users.tsx`, `UserDetail.tsx`, `common.tsx`.

### E18-58 The one-time link dialog said nothing was emailed when it was

**Status:** done · **Priority:** P3 · **Type:** bug

With email set up, setup and reset links are also emailed (`emailedTo` in the answer), but the
dialog always said "Nothing is sent by email".

**Acceptance criteria**

- [x] The dialog names the address the link was emailed to, and keeps the "pass it on yourself" wording when it was not

**Implemented in:** `web/src/modules/admin/Users.tsx` (`LinkIssued`), `common.tsx` (`IssuedLink.emailedTo`).

### E18-59 Small errors in help text, compose.yaml and a command-line message

**Status:** done · **Priority:** P3 · **Type:** bug

Found by the documentation pass: the `logs` help in `grc.ps1` printed `(datalogsgrc.log)`;
`compose.yaml` named a `GRC_DB_PASSWORD` setting that does not exist and let Compose stop the
container after 10 seconds, before the server's 20-second shutdown; the server suggested
`grc stop (container)`, which does not exist; links from the in-app Help to the other documents
in `docs/` opened "Page not found".

**Acceptance criteria**

- [x] Each message names what exists; Compose waits 30 seconds (`stop_grace_period`)
- [x] Help links to the other documents open them on GitHub

**Implemented in:** `grc.ps1`, `compose.yaml`, `server/src/cli.ts`, `web/src/modules/help/HelpPage.tsx`.

### E18-60 Wave 14 guide check and screen reader findings

**Status:** done · **Priority:** P2 · **Type:** bug

Found by the wave 14 user guide check and screen reader run: Calendar feeds could be reached only by
typing its address; several screens said "Administration > Lookups" (it is **Lists**) and "Files
tab" (it is **Attachments**); **Lists** named lists by their keys ("Kb category", "Ot security
level") and could not change a certification type's validity or a business impact analysis
question's kind, so a new question was always answered as text; a reminder in months was labeled
in days; Settings showed the Departments heading twice; the **Condition rating** list stayed on
**Lists** with asset condition switched off; menu entries with the same order number interleaved
(OT security and vulnerabilities); **Qualifications** was offered to people who cannot open it and
sat under Cybersecurity; an inventory count first said "Counting: asset."; the organization page
said the brand color fills the header and two banners named a switch "Outbound connections";
row buttons were announced only as "Edit" or "Remove"; portal pages were announced by the
application name alone; and the policy kiosk counted wrong employee numbers in process memory.

**Acceptance criteria**

- [x] The menu under a person's name offers **Calendar feeds** while calendar feeds are switched on (`GET /api/me/calendar-feeds/enabled`)
- [x] No screen says "Lookups" or "Files tab" for the vendor's **Attachments** tab
- [x] Every list the application ships has a name (`web/src/modules/admin/listLabels.ts`); a test fails for a list without one, and the panel is sorted by name
- [x] Lists that keep a setting on each value declare it (certification type, business impact analysis and privacy questions, policy document type, funding clause, contract security term); **Lists** shows it as a column and edits it in the value's dialog, keeping the value's other stored settings
- [x] **Time between condition assessments** is in months; a test checks each reminder setting's unit
- [x] The Departments group has one heading; its button reads **Add department**
- [x] A list offered only by fields an off area hides (the condition rating on assets, vehicles and sites) leaves **Lists**, `/api/meta` and `/api/lookups` (core `listOff`)
- [x] No two menu entries of a group share an order number (`web/src/core/navOrder.test.ts`); a **People** group holds People, Positions, Qualifications and Certifications; a menu entry may need several permissions (`NavItem.permissions`), and **Qualifications** needs training and people view
- [x] An inventory count names the record types it counts from the start
- [x] The organization page says the brand color tints the sidebar; the Webhooks and Log forwarding banners name **Allow outbound connections**
- [x] Repeated row buttons are named "<visible text>: <row>", for example "Edit: Ben Example" (safety event people, indicator targets, reporting rules, milestones, funding certifications and about twenty other tables)
- [x] Every portal page sets the browser tab's title ("My requests · Help and requests · Sandpiper GRC"), kept when the branding arrives
- [x] The kiosk counts wrong employee numbers in the database (`makeDbLimiter`, bucket `kiosk`): five within 15 minutes stop it for that person, a right number clears the count, and a restart or a second process does not reset it

**Implemented in:** `web/src/core/Shell.tsx`, `web/src/core/module.ts`, `web/src/modules/admin/Lists.tsx`,
`listLabels.ts`, `Departments.tsx`, `Organization.tsx`, `Webhooks.tsx`, `web/src/modules/portal/parts.tsx` (`usePortalTitle`)
and its pages, `web/src/modules/tags/Counts.tsx`, the menu orders of twenty modules,
`server/src/modules/feeds/calendar.ts`, `server/src/modules/notifications/reminder-settings.ts`,
`server/src/modules/policies/personAcks.ts`, `server/src/core/features.ts` (`listOff`); tests
`server/src/modules/admin/list-labels.test.ts`, `features-hidden.test.ts`, `feeds/feeds.test.ts`,
`notifications/reminder-settings.test.ts`, `policies/person-acks.test.ts`, `web/src/core/navOrder.test.ts`,
`web/src/modules/admin/Lists.component.test.ts`, `web/src/modules/portal/portalTitle.component.test.ts`.

### E18-61 Wave 17 security review findings

**Status:** done · **Priority:** P1 · **Type:** security

The wave 17 internal security review found: a SCIM token could change an administrator's email and deactivate and re-enable one with a link permit (account takeover); the figures cache gave one person's private reports, dashboards, schedules and packs to another with the same permissions; email to ticket let a forged From post a public comment as an agent; calendar feeds needed no password confirmation and survived a password change; feed secrets reached the server log; the audit report PDF named a plan without the reader's permissions; the CSV guard looked only at the first character; sign-in provider calls were not fenced against private addresses; without `auth.public_url` the Host header became the MCP OAuth issuer and the feed base; the tracker replay memory could be evicted. It does not replace the independent review (E16-40).

**Acceptance criteria**

- [x] SCIM never changes the email or active state of an account holding `*` or `admin.*` (switched-off roles included) or the break-glass account (403 `mutability`, audited `scim.refused`), and never gives it a link permit
- [x] Any email change (provisioning or administrator) is mailed to the old address
- [x] `/stats` answers are kept per person for a type whose row rule filters figures, a grouping by a link to such a type, or a custom field (`statsScope`)
- [x] An email reply never acts as an agent; email comments are marked "(by email)"; the same for POP3, Graph, Gmail and the relay
- [x] `revokeProgramAccess` revokes calendar feeds and counts them; making a feed or replacing its address needs a recent confirmation; the feeds page prompts
- [x] Feed addresses and `grc_cal_`, `grc_scim_`, `grc_relay_` tokens are masked in the log
- [x] The audit report PDF prints a plan's title only for a reader with view on its module who can see it ("Restricted" otherwise)
- [x] One CSV formula guard (`core/export/csv.ts`) for every CSV export, looking past leading white space and catching full-width = + - @
- [x] OIDC and SAML provider calls check every resolved address; a private address only when listed exactly in `integrations.allowed_hosts`
- [x] Without `auth.public_url`, the Host header is used only when it names this computer; otherwise OAuth metadata is 404 and feed creation 409 `public_url_required`
- [x] Tracker replay memory keeps every signature for the whole window and refuses when full (`feeds/replay.ts`), used by `feeds/tracker.ts`

**Implemented in:** `server/src/modules/integrations/scim.ts`, `server/src/core/identity/accounts.ts`, `base.ts`, `http.ts`, `service.ts`, `server/src/core/routes.ts`, `server/src/core/tokens.ts`, `server/src/core/export/csv.ts`, `server/src/ops/logging.ts`, `server/src/modules/tickets/email.ts`, `server/src/modules/feeds/calendar.ts`, `replay.ts`, `tracker.ts`, `server/src/modules/audits/report.ts`, `server/src/modules/mcp/oauth.ts`, `http.ts`, `server/src/modules/admin/users.ts`, `web/src/modules/feeds/CalendarFeeds.tsx`; tests `integrations/scim.test.ts`, `core/figures-cache-personal.test.ts`, `tickets/email.test.ts`, `feeds/feeds.test.ts`, `feeds/replay.test.ts`, `ops/logging.test.ts`, `audits/audits.test.ts`, `core/export/csv.test.ts`, `core/identity/http.test.ts`, `core/identity/base.test.ts`, `mcp/oauth.test.ts`.

### E18-62 Wave 17 correctness review findings

**Status:** done · **Priority:** P2 · **Type:** bug

Found by the wave 17 code-correctness review of waves 14 to 16 and the core services. Each finding's
proof test is now a regression test. The PostgreSQL ordering of the rerun flag (finish versus a
concurrent enqueue) is argued from row locking and tested in sequence through the wire-protocol test
driver; it has not been raced against a real multi-process PostgreSQL server.

**Acceptance criteria**

- [x] Retrying a dead job while a newer job with the same key is queued, failed or running answers 409 `already_queued` ("A newer run of this job is waiting or running.") instead of 500; a duplicate-key error between the check and the update gives the same answer; Background jobs shows the message and reloads the list
- [x] The kiosk claims each attempt before comparing the employee number (`makeDbLimiter.take()`), so parallel guesses compare at most five numbers in the window; over the limit answers 429; a right number clears the count
- [x] `jobs.enqueue(type, payload, { key, rerunIfRunning: true })` asks a running job with that key to run once more after it finishes (`jobs.rerun`, migration `core.jobs/002_jobs_rerun.sql`) instead of skipping; the flag is cleared when the job is claimed; `push.deliver` and `feeds.tracker_push` use it, so a notification or send arriving during a run is not left for the sweep
- [x] Administration > Push notifications: **Make a new key** is disabled while there are unsaved edits, with a note saying to save first

**Implemented in:** `server/src/core/jobs/index.ts`, `queue.ts`, `migrations/002_jobs_rerun.sql`,
`server/src/modules/policies/personAcks.ts`, `server/src/modules/push/index.ts`,
`server/src/modules/feeds/tracker.ts`, `web/src/modules/notifications/JobsPage.tsx`,
`web/src/modules/push/PushAdmin.tsx`; tests `server/src/core/jobs/jobs.test.ts`,
`server/src/modules/policies/person-acks.test.ts`, `server/src/modules/push/push.test.ts`,
`server/src/modules/feeds/tracker.test.ts`, `web/src/modules/push/PushAdmin.component.test.ts`.

### E18-63 Wave 17 interface review: layout

**Status:** done · **Priority:** P2 · **Type:** bug

The wave 17 interface review found lists cut off with no cue, tab bars cut off at 820, header buttons in different orders, and a flat Create menu. These are fixed in shared web code (`web/src/core`). Proven in the browser suites, the accessibility audit and by screenshots at 1440, 820 and 390; not yet checked with a real screen reader. What is left is E18-65.

**Acceptance criteria**

- [x] List columns have a priority (1 always shown; 3 then 2 give way, rightmost first). Left-out columns stay in the column chooser ("Hidden to fit this width"); checking one keeps it on per person. Default lists fit at 1440 without sideways scrolling
- [x] A table that scrolls sideways fades at the edge with more; lists have no inner vertical scroll (one scroll bar); a list that fits keeps its headings in view as the page scrolls. Long titles are cut at 20rem with the full text as a tooltip
- [x] Key columns marked priority 1 where the defaults were too wide (conduit zones, ticket priority, risk residual, project stage)
- [x] Tab strips put tabs that do not fit into a keyboard-usable **More** menu; the active tab always shows; ARIA tabs pattern kept; no scroll bar
- [x] Header buttons in one order: primary first on record pages, then the others, PDF, Watch, with the "⋯" / More menu last; the Tab order matches the visual order
- [x] Quiet buttons in a page header are bordered, not plain text
- [x] A list that is the page puts **New …** in the page header, not alone at the end of the toolbar
- [x] Create menu grouped under navigation group headings, A to Z within each, with an icon on every entry
- [x] Shared `Notice`: only errors use `role="alert"`; non-error Mantine alerts in projects and security incidents use `role="status"`
- [x] `scrollbar-gutter: stable` on the main scroll area; number boxes at most 16rem wide
- [x] Tests: `web/src/core/fit.test.ts`, `createMenu.test.ts`, `LayoutFit.component.test.ts`; e2e 01-smoke, 05-keyboard, 06-lists and 08-keyboard-modules pass; a11y audit on a sample of routes clean

**Implemented in:** `web/src/core/ui.tsx`, `overlay.tsx`, `ListTable.tsx`, `ResourceList.tsx`, `RecordPage.tsx`, `Shell.tsx`, `fit.ts`, `createMenu.ts`, `base.css`, `records.css`, `shell.css`, `README.md`; column priorities in `ot/Conduits.tsx`, `tickets/TicketList.tsx`, `risks/RiskRegister.tsx`, `projects/PortfolioTable.tsx`; status roles in `projects/GateTab.tsx`, `IntakeForm.tsx`, `PortfolioPage.tsx`, `ProjectDetail.tsx`, `secincidents/KitCopies.tsx`.

### E18-64 Wave 17 interface review: pages and switched-off areas

**Status:** done · **Priority:** P2 · **Type:** bug

The wave 17 interface review found switched-off areas still shown: roles of an off area were listed and switchable (Safety manager) under Roles and AI assistant access, role descriptions named vehicles and grant compliance with Fleet and Funding off, the heat map and Risk scales offered the safety hazard matrix, asset condition listed vehicle classes, and the portal footer named safety. It also found page faults: an empty portal with the sample data, a project stage chip reading "Close" beside a stray dash, a risk register without tabs or New risk, People tiles above the title, tiny relationship map labels, Roles switches and Lists values cut at 820 px (and an empty settings array made on every render), the wrong main button on a just-reported safety event, raw permission keys, "Open Organization", "Add format", a raw time zone id, mixed money formats, small heat-map labels, cut placeholders and two unnamed buttons on a compliance review. What is left is E18-65.

**Acceptance criteria**

- [x] An area declares the shared set-up it owns (`owns` in `core/features.ts`: `role`, `risk_scale`); `ownedOff` and `rolesShown` read it
- [x] A role of an off area is not on Roles, a person's roles, AI assistant access, provisioning's group mapping or any role picker (providers, change rules, lifecycles, policies, reports, training, workflows); its routes answer `switched_off`; people, groups and settings keep it
- [x] An unedited default role description names only the areas that are on (`describe`, `roleDescription`); saving it unchanged keeps the stored default
- [x] The safety hazard matrix is not offered while safety is off (heat map, scales, summary, appetite); new risks fall back to the default scale; scored risks keep it
- [x] Asset classes that rate an off record type are hidden (lists and the condition dashboard)
- [x] The portal footer names safety only while safety reporting is on
- [x] `features-hidden.test.ts`, `integrations/scim.test.ts` and the 09-features-off suite (roles not treated as data, no hazard matrix exemption, funding terms, a portal, fleet, safety and funding tour) check all of the above
- [x] The dev seed offers three catalog items in the portal; "Ask for something" is hidden while the catalog is empty
- [x] Project stage chip "Stage: …"; the no-change trend is an arrow
- [x] Risk register, reviews, report, scales and appetite share a tab strip; New risk in the header; "Across every scale"; heat-map labels 12 px
- [x] People: title before the tiles; relationship map opens at a readable zoom with wider nodes
- [x] Roles switches stay in view at 820 px; Lists stacks below 1000 px; stable empty settings array
- [x] Next-step primary button on safety events; secondary "Cancel the count"
- [x] Permission wording, Pages and Size, "Open organization", "New format", "New scale", friendly time zone name, tag field label and placeholder, hints instead of long placeholders
- [x] Money: full amounts without cents on whole amounts in records, tables and sentences; compact only in tiles, cards and charts
- [x] Compliance review area buttons named with their area

**Implemented in:** `server/src/core/features.ts`, `server/src/core/services.ts`, `server/src/modules/admin/{roles,users,providers}.ts`, `server/src/modules/integrations/scim-admin.ts`, `server/src/modules/mcp/index.ts`, `server/src/modules/risks/{index,enterprise}.ts`, `server/src/modules/condition/{index,dashboard}.ts`, `server/src/modules/tickets/seed.ts`, the role pickers listed above, `web/src/modules/{risks,admin,portal,projects,people,inventory,safety,tags,secincidents,funding}`, `tools/e2e/suites/09-features-off.mjs`.

### E18-65 Hand-written tables, the Create menu filter and the remaining interface items

**Status:** done · **Priority:** P3 · **Type:** debt

Left over from E18-63. The hand-written tables (asset condition, privacy, assessments, audits, the Overview widget) still scroll sideways at 820, now with the edge fade, rather than leaving out lower-priority columns. The Create menu has no filter box, and some entries are verbs rather than nouns ("Plan activation"). Left over from E18-64: sample data is marked two ways ("[Sample]" first, or "(sample)" last; renaming needs a one-off rename of existing data because the seeds find records by name), charts sit small in tall cards, the relationship map's lines can run over group headings, the core `formatCurrency` still shows cents on whole amounts (pages use a local helper) and a date field's time zone hint shows the raw id.

Done in wave 18. A hand-written table in `<TableWrap fit>` leaves out lower-priority columns (`data-priority` on its headings) by the same rule as the shared lists; the Create menu is a `FilterMenu` with a filter box; every seed marks sample data "[Sample] …" and renames records an older seed made ("X (sample)") before it looks them up; the chart grid fault that drew plots small and centered is fixed; map headings sit on a band drawn over the lines; `formatCurrency` drops cents on whole amounts and date fields name the zone in everyday words. Proven by unit and component tests, the browser suites and the accessibility audit listed below and screenshots at 1440, 820 and 390 (portal); not yet checked with a real screen reader.

**Acceptance criteria**

- [x] The hand-written tables use column priorities (or the shared list) and fit at 820: asset condition, privacy coverage (long cells wrap within 20rem), assessment snapshots, audit coverage (past years and the cycle give way first) and the Overview widget tables, through `TableWrap fit` (`watchTableFit`, `fitTableColumns`)
- [x] The Create menu has a filter box (focus on open, arrow keys, Home and End, Enter opens the first match, "No match" announced); every entry names a kind of record ("Emergency activation", "Audit engagement", "Framework")
- [x] Sample data marked one way in every seed ("[Sample]" first); `renameSamples` (`inventory/seed-rename.ts`) renames an existing "X (sample)" record, with an audit event, so running the sample data again neither duplicates nor leaves old names (`seed-rename.test.ts`: a fresh and an existing database)
- [x] Charts top-aligned in tall cards (core `ChartImpl`: a chart whose labels need no extra room kept its own grid instead of ECharts' wide default); map lines drawn behind group headings (on screen and in the saved picture)
- [x] Core `formatCurrency` without cents on whole amounts (the local `wholeCurrency` helpers are gone); friendly time zone name in date field hints (`timeZoneLabel`, shared with the portal)
- [x] Tests: `fit.test.ts`, `createMenu.test.ts`, `TableWrap.component.test.ts`, `FilterMenu.component.test.ts`, `dateFields.component.test.ts`, `format.test.ts`, `reports/labels.test.ts`, `inventory/mapExport.test.ts`, `inventory/seed-rename.test.ts` and the changed seed tests; e2e 01-smoke, 05-keyboard, 06-lists, 09-features-off, 11-audits, 12-governance, 13-continuity, 14-condition, 15-ot, 16-records, 17-vendor-lifecycle, 19-feeds and 21-tags pass (52 tests); the accessibility audit on the changed routes is clean (light and dark, 1440 and 820)

**Implemented in:** `web/src/core/{fit.ts,ui.tsx,overlay.tsx,createMenu.ts,Shell.tsx,ChartImpl.tsx,format.ts,dateFields.tsx,base.css,README.md}`, `web/src/modules/{condition,records,frameworks,audits,home,inventory,portal,funding,projects}`, the Create entries in `audits`, `continuity` and `frameworks`, `server/src/modules/inventory/seed-rename.ts` and the seeds of condition, continuity, feeds, fleet, funding, governance, holds, ot, projects, records, tags and vendors.

### E18-66 Wave 19 security review: models and custom references

**Status:** done · **Priority:** P1 · **Type:** security

The wave 19 review of wave 18 (E39) found five issues in vehicle and asset models and one older gap in custom reference fields that models spread. Each item has a regression test in `server/src/modules/models/security.test.ts`, run on the embedded database, on UTC and through the PostgreSQL driver. What is left is E40-13.

**Acceptance criteria**

- [x] Asset models in a vehicle model's equipment need `assets.view`: hidden from others (`asset_model_hidden`), refused with a message that names nothing, stored link kept on save
- [x] A background model change reloads the person, stops (`stopped`, with a reason) when they are disabled or lack `<module>.edit`, and saves each member as them (audit actor, `updated_by`, lifecycle rules)
- [x] A malformed `model_id` gets a 400 before any query
- [x] A member whose model is gone saves as one with no model; a member given a model at the moment it is deleted is left with no model; a retention removal is refused for a model with members (or an asset model named in equipment); a vehicle model's equipment goes with it (models/002)
- [x] `inherited_custom` is checked: inherited fields only, right types and list values, references visible to the person
- [x] Custom reference fields get the same visibility check as built-in ones
- [x] One background change per model (a newer one supersedes a waiting one); a change skipped while its area is off, or whose job gave up, is marked stopped
- [x] User guide (fleet and services, inventory) updated; the model page shows Stopped and Replaced statuses with the reason

**Implemented in:** `server/src/modules/models/engine.ts`, `index.ts`, `equipment.ts`, `migrations/002_change_reason.sql`, `server/src/core/resource.ts` (`checkRefsVisible`), `web/src/modules/inventory/models.tsx`; tests `server/src/modules/models/security.test.ts`.


### E18-67 Wave 19 security review: provisioning, sign-in address and CSV

**Status:** done · **Priority:** P1 · **Type:** security

The wave 19 internal security review found: two definitions of "can administer", so provisioning could give a role it then refused to deactivate (a leaver kept access); a provisioning link permit that outlived the account becoming an administrator; single sign-on addresses still taken from any Host header (a sign-in meant for a staging copy sharing the identity provider could work on production); and two CSV files made by the browser with the older formula guard. Proven by unit and request tests and a browser check of the Sign-in providers page; not tried against a real identity provider.

**Acceptance criteria**

- [x] One definition of "can administer" (`*` or any `admin.` grant) for SCIM guards, group mapping and given roles; a role with `admin.view` cannot be mapped
- [x] Provisioning may deactivate an account that can administer only when it created it (`user_external_ids.provisioned`, backfilled from the audit log); enabling again and email change stay refused; never the last administrator
- [x] A provisioning link permit is ignored and cleared at sign-in for an account that can administer, and cleared when such a role is given or a held role gains an `admin.` grant
- [x] Single sign-on addresses come from `auth.public_url` or a Host naming this computer; otherwise 409 `public_url_required`, and the Sign-in providers page says so
- [x] Browser CSV files and the import template use the shared formula guard (`shared/csv-guard.ts`)
- [x] The dev-seed sample rename fallback is audited with its reason and skips records under a legal hold

**Implemented in:** `server/src/core/identity/accounts.ts`, `service.ts`, `server/src/modules/integrations/scim.ts`, `scim-admin.ts`, `shared.ts`, `migrations/002_scim_provisioned.sql`, `server/src/modules/admin/users.ts`, `roles.ts`, `sso.ts`, `web/src/modules/admin/SamlFields.tsx`, `shared/csv-guard.ts`, `server/src/core/export/csv.ts`, `server/src/core/import/routes.ts`, `web/src/core/ListBulk.tsx`, `web/src/modules/training/Records.tsx`, `server/src/modules/inventory/seed-rename.ts`; tests in `integrations/scim.test.ts`, `admin/sso.test.ts`, `core/identity/`, `web/src/core/csvGuard.test.ts`, `inventory/seed-rename-hold.test.ts`.


### E18-68 Wave 23 security review: access, platform, files and the Windows installer

**Status:** done · **Priority:** P1 · **Type:** security

The wave 23 internal security review of waves 20 to 22 found issues in four groups: access (scoped people could widen their own scope, detail groupings showed out-of-scope values, outside reviewer accounts could be given roles, offered in pickers and spared a second factor, access-review self-decision under another spelling of the same account, a confidential reporter named in the outgoing message log); the platform (figures saved by people who could not report on their type, register removal, moving an active contract to another vendor, published policy translations changed without approval); attached files (a hostile PDF could exhaust the server while its text was read); and the Windows installer (pre-created folders, settings and scripts that other users could change, service privileges, uninstall following links). Each finding has a regression test; the installer fixes were proven by an elevated install on Windows 11 and in the GitHub Windows workflow. What is left is listed in [Known gaps](../../known-gaps.md).

**Acceptance criteria**

- [x] A hostile PDF cannot exhaust the server: file text is read in a child process with memory and time limits, attempts are recorded first, a stopped file is retried once then failed; vendor files waiting for review are not read (S1)
- [x] A pre-created data or program folder is refused; only `GRC_*` settings are read; elevated steps check file ownership; the program folder is locked down wherever installed; the service keeps two privileges; uninstall does not follow links (S2-S4, E42-08)
- [x] Replaced or expired call-out links do not count toward the wrong-link limit; meeting invitations are limited to 10 sends per meeting per hour (S5, S6)
- [x] Figures are checked as the person who saves them; register removal touches only its own grants and refuses records arriving during removal; moving an active contract to another vendor is checked like an activation; published policy translations need approval and acknowledgments record the text's SHA-256 (F1-F5)
- [x] Scoped people cannot widen their own scope; detail groupings are masked by scope; outside reviewer accounts hold no roles, fail closed without their module, must use a second factor and are not offered in pickers; access-review self-decision by name or email; the confidential reporter's closing message is in-app only (A1-A6)
- [x] Every finding has a regression test; the installer fixes were proven by an elevated install on Windows 11 and in the GitHub Windows workflow

**Implemented in:** `server/src/modules/attachments/text.ts`, `text-reader.mjs`, `deploy/windows/`, `server/src/modules/reports/figures.ts`, `server/src/modules/registers/admin.ts`, `server/src/modules/vendors/index.ts`, `server/src/modules/policies/translations.ts`, `server/src/core/scope.ts`, `core/reviewers.ts`, `core/resource.ts`, `server/src/modules/accessreviews/campaigns.ts`, `server/src/modules/safety/confidential.ts`.

**GitHub browser run of waves 20 to 22:** the Projects menu entry for certification is now "Certifiable items", the same as its page title; text naming switched-off areas was removed from the assistant's `my_work` tool, the API help, the compliance calendar, About, the role "Which records" card, the starter vendor intake and the sample register; the custom fields of a switched-off record type or register are no longer listed under Administration > Custom fields. The new browser tests in suites 05, 13, 17, 24, 25 and 26 were corrected (waits for plain text name an element, Escape closes an open search list before its dialog, the switched-off register's expected 404 is allowed); no product change was needed for them.

### E18-69 The pilot seed profile added invented sample records

**Status:** done · **Priority:** P1 · **Type:** defect

The `pilot` seed profile, the one a real installation uses, loaded the organization's own files and profile but also added invented "[Sample]" records in nine modules: change blackout periods, templates and changes; inventory assets; policies and exceptions; projects; risks; a security incident; service desk tickets, problems, knowledge articles and a catalog item; training courses, rules, records, exercises, findings and follow-up actions; and vulnerability findings with a back-filled weekly trend. That is pretend data in a real installation. Every invented record is now created only in the `dev` profile. The pilot loads what comes from the seed files and the organization profile (systems, sites, data categories, vendors and contracts, framework outcomes, information requests, obligations, notification rules, vehicles and services) and built-in reference content (lists, roles, framework functions and categories, the standard reports, dashboards, pack and tracked figures). A database seeded by an earlier version keeps the samples it has; the installation guide says how to find and delete them.

**Acceptance criteria**

- [x] The `pilot` profile creates no "[Sample]" or other invented record in any module; the `dev` profile loads the same samples as before
- [x] What the pilot does load (seed files, organization profile, reference content) is unchanged
- [x] A test runs every module's pilot seed on an empty seed folder with every optional area on, and fails on any "[Sample]" value in any text column, a filled sample table or a sample person
- [x] The module seed tests expect no samples in the pilot; the installation guide, developer guide and user guide say what each profile loads

**Implemented in:** `server/src/modules/changes/index.ts`, `inventory/seed.ts`, `policies/seed.ts`, `projects/index.ts`, `risks/seed.ts`, `secincidents/index.ts`, `tickets/index.ts`, `training/seed.ts`, `vulnerabilities/seed.ts`; the test `server/src/modules/inventory/seed-pilot-clean.test.ts`.

### E18-70 Data load mode: load historical records with their original dates, and undo a load

**Status:** done · **Priority:** P1 · **Type:** defect

Loading an organization's past records (first 639 historical service desk tickets, then other types)
through the AI assistant connection gave every record today's dates: `create_record` refused the
opened, resolved and closed times because they are read-only fields the application manages, the
ticket hooks set `opened_at` to now and worked due times and breaches out from it, and nothing could
be deleted through MCP, so a wrong load could not be undone. Data load mode, off by default and
switched on by an administrator for at most 30 days, lets administrators (and their API and assistant
tokens) set every field, any status, the created and updated times and author, and the reference.
Values given win over what hooks work out, and what is missing is worked out from the dates given.
Nothing is sent. Every record created is listed so that a load can be deleted from Administration >
Data loads or, one record at a time, with the MCP tool `delete_record`.

**Acceptance criteria**

- [x] Off by default; an administrator switches it on from Administration > Settings with a recent password confirmation (never with a token), until a time at most 30 days ahead (default 7); it switches itself off at the end; switching on, changing the end, switching off and the end are audited; administrators see a banner while it is on
- [x] While on, a save by a holder of `admin.administer`, or with a token whose owner holds it (an assistant token also needs AI assistant write access), may set read-only fields, any status without lifecycle or step rules, `created_at`, `created_by`, `updated_at` and a unique reference, with the counter moved past it; everyone else is unchanged
- [x] The resource engine gives hooks `req.dataLoad` / `isDataLoad(req)` and puts supplied read-only fields and status back over the hooks' result; tickets, risks, actions, corrective action plans, changes, security incidents, vulnerabilities and policy exceptions work out missing values from the dates given and skip their own step rules
- [x] Type checks, list values, visible references, required fields, `If-Match`, restricted records and legal holds still apply; a column the database works out is refused with a field error
- [x] A load sends no notification, email, text, push, webhook, work-tracker send or approval; search indexing is unchanged
- [x] Every record a load creates is listed; Administration > Data loads lists loads by day and type and deletes everything one load created after a fresh password confirmation, keeping records under a legal hold; the MCP tool `delete_record`, offered only while the mode is on, deletes a loaded record and nothing else
- [x] `list_record_types`, `create_record` and `update_record` tell the assistant that the mode is on and which extra fields it may set; field errors unchanged
- [x] Audit events of a load carry "(data load)"; a loaded record's history reads "loaded (data load mode)"
- [x] Tests (also on UTC): historical tickets through MCP with original dates and due and breach values given or worked out, service desk figures from those dates, non-administrators refused, refusal while off, the end time, delete and undo, legal holds, no notifications or webhooks; per-module load tests

**Implemented in:** `server/src/core/dataload.ts`, `server/src/core/resource.ts` (`loadScope`, `suppliedByLoad`, `checkLoadedRef`, `remove`), `server/src/core/migrations/032_data_load.sql`, `server/src/core/tokens.ts` (`tokenOwnerPermissions`), `server/src/core/services.ts` (audit marker), `server/src/core/webhooks.ts`, `server/src/core/auth.ts` (`dataLoad` in the state), `server/src/app.ts` (`quietSenders`, `core.data_load_expiry`), `server/src/modules/admin/dataload.ts` (`GET/POST /api/admin/data-load`, `POST /api/admin/data-load/undo`, `DELETE /api/data-load/records/:type/:id`), `server/src/modules/mcp/` (`delete_record`, session `dataLoad`, tool notes), `server/src/modules/tickets/index.ts` and `catalog.ts`, the risks, changes, secincidents, vulnerabilities and policies hooks, `workflows/index.ts`, `feeds/tracker.ts`; `web/src/modules/admin/DataLoad.tsx` (Settings card and Data loads page), the banner in `web/src/core/Shell.tsx`; tests `server/src/modules/mcp/dataload.test.ts` and `dataload.test.ts` in risks, changes, secincidents, vulnerabilities and policies.
