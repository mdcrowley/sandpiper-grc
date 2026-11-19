# E18 Quality and known defects

**Status:** in progress

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
| E18-03 | Proofread NIST CSF 2.0 outcome text against the publication | open | P1 |
| E18-04 | Check every screen in the dark theme | done | P2 |
| E18-05 | Check every screen at tablet width | done | P2 |
| E18-06 | Check keyboard-only use | in progress | P2 |
| E18-07 | Check non-administrator roles in the browser | done | P1 |
| E18-08 | Check that every form can be submitted in the browser | in progress | P1 |
| E18-09 | "Also satisfies" parser splits names that contain numbers | open | P3 |
| E18-10 | Automated API test suite | done | P1 |
| E18-11 | One-off browser pass of every screen | done | P2 |
| E18-12 | Automated browser tests | in progress | P2 |
| E18-13 | Transit positioning: nothing in built-in text identifies one organization | done | P1 |
| E18-14 | Tests for the web code | open | P3 |
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
| E18-25 | Permissions granted but never checked | in progress | P2 |
| E18-26 | Only risks have an Actions tab | done | P2 |
| E18-27 | Dev mode ignored a custom port | done | P3 |
| E18-28 | Features that suit some transit organizations but not all | open | P2 |
| E18-29 | Reading a ticket list runs the service-level sweep | open | P3 |
| E18-30 | Escalating a project item creates a risk without a risk permission | open | P3 |
| E18-31 | Review the newer modules for permission and restricted-record checks | done | P1 |
| E18-32 | Hand-written routes: findings of the permission review | done | P1 |
| E18-33 | Web bundle is a single 1.8 MB script | done | P2 |
| E18-34 | Hand-written forms and record pages do not show custom fields | open | P2 |
| E18-35 | Web unit tests are not run by the main test command | done | P3 |
| E18-36 | Category labels run together on narrow bar charts | open | P3 |
| E18-37 | New dashboard: an empty name is refused with a toast, not beside the field | open | P3 |
| E18-38 | A report on records the role cannot see makes a refused request | open | P3 |
| E18-39 | Accessibility audit: findings left for other owners | open | P2 |
| E18-40 | People never see different numbers: figures include restricted records | done | P1 |
| E18-41 | Backups taken in the same second could be pruned at once | done | P1 |

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

**Status:** open · **Priority:** P1 · **Type:** bug

As a security lead, I need the official text of every outcome to match the published
framework word for word. The included text was written from memory and has not been
checked.

**Acceptance criteria**

- [ ] All 106 subcategories compared with the publication (CSWP 29)
- [ ] GV.SC-06, GV.SC-09 and PR.AA-05 checked first, as already suspected
- [ ] Category and function names checked too
- [ ] Corrections made in `server/src/modules/frameworks/csf2.json`
- [ ] A way to refresh the text on installations that have already loaded it, without touching statuses
- [ ] The note in `docs/known-gaps.md` removed

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

**Status:** in progress · **Priority:** P2 · **Type:** bug

As a user who does not use a mouse, I can reach and operate everything. Keyboard-only
use has not been tested.

**Acceptance criteria**

- [ ] The main journey in each module completed with the keyboard alone (done for the shell, the search window, lists, a New dialog, record tabs and the dashboard layout; not yet module by module)
- [x] Focus is always visible and follows a sensible order (skip link, then the top bar, then the navigation, then the page)
- [x] Dialogs trap focus and return it when closed
- [ ] Menus, tabs, pickers and the relationship map can be operated (menus, tabs, navigation, list tables and the dashboard grid done; record pickers and the relationship map not yet driven)
- [x] Each problem found is fixed or raised as its own issue here

**Found and fixed:** the whole navigation (some 80 Tab stops) came before the top bar, so
search, Create and the account menu were the last things a keyboard user reached; the top
bar now comes first in the page (`web/src/core/Shell.tsx`; the look is unchanged).

**Implemented in:** `tools/e2e/suites/05-keyboard.mjs` (run by `npm run test:e2e`).

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

**Status:** in progress · **Priority:** P1 · **Type:** bug

As a user, I can create and edit every kind of record from the screen. Screens were
loaded once without errors, but forms were not submitted.

**Acceptance criteria**

- [x] Create and edit one of every record type through the web app (25 types; dashboards, report packs and reports are changed in their own editors, which the create step drives)
- [ ] Every hand-written dialog submitted once (ticket actions, check-out, disposal, gate decision, acceptance, declare incident, and so on): declare incident, the change wizard, the report builder, the second-factor set-up and bulk edit done; the rest not yet
- [x] Validation messages appear beside the right field (an empty New form and an emptied title on edit are refused with a message beside the field, for every type)
- [x] Each problem found is fixed or raised as its own issue here (E18-37)

**Implemented in:** `tools/e2e/suites/03-records.mjs` and `tools/e2e/lib/forms.mjs` (fill any
form by its labels, whatever the control).

### E18-09 "Also satisfies" parser splits names that contain numbers

**Status:** open · **Priority:** P3 · **Type:** bug

As the person loading framework designations, a cross-mapping to a framework whose name
itself contains a number is split in the wrong place: the parser treats the first word
containing a digit as the start of the reference, unless the name is one it already
knows.

**Acceptance criteria**

- [ ] A name containing a number, followed by a reference, is split correctly
- [ ] The list of known names is data, or an explicit separator is supported in the file
- [ ] Tests cover names with a number, names without, and entries with no reference
- [ ] Mappings already loaded wrongly can be corrected by running the seed again

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
- [ ] Repeatable as an automated check (see E18-12)

**Recorded in:** `docs/known-gaps.md` ("Verification status"). No script for this pass is kept in the repository.

### E18-12 Automated browser tests

**Status:** in progress · **Priority:** P2 · **Type:** feature

As a maintainer, a small set of browser tests runs the main journey of each module on
every change, so a broken screen is caught before a user finds it.

**Acceptance criteria**

- [x] A smoke test loads every route and fails on a script error or failed request
- [x] One journey per module: create, edit, and one module-specific action (per record type: create, an empty form refused, edit, status, comment, attachment; plus sign-in and sign-out, second-factor enrollment, search, bulk edit and export)
- [x] Run as an administrator and as one non-administrator role (every default role, in `04-roles.mjs`)
- [x] Run in both themes (the smoke test runs light at 1440 and dark at 820)
- [ ] Part of continuous integration ([E16-12](E16-hosting-operations-and-hardening.md)): the job is written (development guide, "Testing") and waits for the workflow file

**Implemented in:** `tools/e2e/` (`run.mjs`, `lib/`, `suites/01-smoke` to `06-lists`),
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

**Status:** open · **Priority:** P3 · **Type:** debt

As a developer, the shared web helpers have their own tests. Today all automated tests
are on the server.

**Acceptance criteria**

- [ ] Unit tests for formatting, the list query builder and the saved-view store
- [ ] Component tests for the generic list, form and record page
- [ ] Run by the same `test` command

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

- [x] Each navigation item and its page title match in the service desk, inventory, vendors, frameworks, security incidents and projects modules (now "Service catalog", "Security terms matrix", "Notification rules and checklists", "Project portfolio", "New project request")
- [ ] The newer modules are checked too

**Implemented in:** each module's `web/src/modules/<key>/index.tsx`

### E18-25 Permissions granted but never checked

**Status:** in progress · **Priority:** P2 · **Type:** debt

The dashboards, reports and portal permissions appear in role grants but no route checks them.

Not changed yet, on purpose. The overview shows each panel by its own module's
permission, the inventory reports check the permissions of the records they read, and
there is no report builder or portal. Removing the three keys from the default roles
would break whichever module arrives next to use them; enforcing them belongs to the
overview screen and the reporting epic.

**Acceptance criteria**

- [ ] Each is either enforced by the screens and routes it names, or removed: `dashboards.view` now decides whether the Overview shows its Dashboard part (`DASHBOARD_PERMISSION` in `web/src/modules/home/registry.ts`) and guards the reporting module's dashboards; `reports` is checked by the reporting module; `portal` is still checked by nothing (no portal)
- [x] The role editor says which permission areas nothing checks yet (`MAYBE_UNUSED` in `web/src/modules/admin/RoleDetail.tsx`: an area carries a "not yet used" hint unless a record type that belongs to it is loaded)

**Where:** `web/src/modules/home`, [E12](E12-dashboards-and-reporting.md); `DEFAULT_ROLES` (`server/src/core/services.ts`); `MODULE_KEYS` (`server/src/modules/admin/shared.ts`)
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

**Status:** open · **Priority:** P2 · **Type:** debt

A few built-in features, not just words, follow how a publicly funded transit agency
works: the asset "funder interest" flag and its disposal rule (equipment part-paid by an
outside funder), the contract "approval or resolution number", and the governing-body
approval on a ransom decision. Privately owned operators and contractors running service
for an agency may have no funder interest, board resolution or governing body in that
sense. Whatever is decided, nothing may identify one organization or assume one
jurisdiction's funding rules.

**Acceptance criteria**

- [ ] Each is either made a setting that an installation can switch off or rename, or confirmed as general enough for the range of transit organizations
- [ ] The user guide follows

**Where:** `server/src/modules/inventory/index.ts`, `server/src/modules/vendors/index.ts`, `server/src/modules/secincidents/index.ts`

### E18-29 Reading a ticket list runs the service-level sweep

**Status:** open · **Priority:** P3 · **Type:** debt

A `GET` on the ticket routes also runs the sweep that writes breach flags and system
audit events, so a read request changes data. It cannot be triggered from another site
in a harmful way (the change is the same one a timer would make), but reads should not write.

**Acceptance criteria**

- [ ] The sweep runs on a timer only

**Where:** `server/src/modules/tickets/index.ts`

### E18-30 Escalating a project item creates a risk without a risk permission

**Status:** open · **Priority:** P3 · **Type:** debt

A person with `projects.edit` can escalate a project item into a risk they cannot then
see. By design, and they get back only the new risk's id and reference, but it lets
someone without `risks.create` add to the risk register.

**Acceptance criteria**

- [ ] Decide: keep (and say so in the user guide), or require `risks.create`

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
- [ ] Left open and raised separately: E18-29, E18-30, E18-31

### E18-33 Web bundle is a single 1.8 MB script

**Status:** done · **Priority:** P2 · **Type:** debt

Every module loads at start. Split the bundle by route so the first page loads quickly.

**Acceptance criteria**

- [x] Each module's pages load on demand: the `grc-modules` plugin in `vite.config.ts` reads each module's `key`, `nav`, `create` and route paths at build time (`virtual:grc-modules`); `web/src/core/module.ts` and `lazyRoutes.tsx` load a module's chunk when one of its routes is first opened (with a quiet loading bar after 150 ms, an error state with Reload, and preloading on hover or focus of a navigation link). Help's Markdown is a chunk per page, loaded when Help is opened
- [x] The initial script is under 500 kB: before, one 1,769 kB script (about 520 kB compressed); now the entry script is 378 kB plus 258 kB of React and the router in their own long-cached chunk, 193 kB compressed in all. Charts (649 kB) and each module (5 to 112 kB) load when needed. `GRC_ANALYSE=1 npx vite build` lists what each package weighs

**Implemented in:** `vite.config.ts`, `web/src/core/module.ts`, `web/src/core/lazyRoutes.tsx`, `web/src/core/virtual.d.ts`, `web/src/modules/help/guide.ts`

### E18-34 Hand-written forms and record pages do not show custom fields

**Status:** open · **Priority:** P2 · **Type:** bug

The generic list, form and record page show an administrator's custom fields by themselves
(see `web/src/core/README.md`, section 12). Pages that build their own form or summary do not:
for example the ticket's **New ticket** dialog and its summary cards (a **More details** card
appears only where the page uses `RecordPage`'s `summary`).

**Acceptance criteria**

- [ ] Every module's hand-written create and edit forms add `customFieldNames(resource)` (or pass `customFields` to `ResourceForm`)
- [ ] Every record page shows them, through `summaryFields`, `CustomFieldsCard` or its own layout

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

**Status:** open · **Priority:** P3 · **Type:** bug

On the Assets and systems dashboard, the Assets by status chart prints its category labels with no space between them (for example Ordered and In stock) at 1440px.

**Acceptance criteria**

- [ ] Category labels on vertical bar charts wrap, rotate or abbreviate so none touch at 820px and wider

### E18-37 New dashboard: an empty name is refused with a toast, not beside the field

**Status:** open · **Priority:** P3 · **Type:** bug

Found by the browser tests (E18-08). In Reports > Dashboards > New dashboard, pressing
"Create and add widgets" with no name shows a passing notice ("Give the dashboard a
name.") instead of a message under the Name field, so a screen-reader user may miss it and
focus stays on the button. The browser tests report this step as a known defect until it is
fixed (`tools/e2e/suites/03-records.mjs`, `known: { empty: 'E18-37' }`).

**Acceptance criteria**

- [ ] The message appears under the Name field (`error` on the `TextField`) and focus moves to the field (`web/src/modules/reports/DashboardPages.tsx`, `create()`)
- [ ] The `known` entry for dashboards is removed from the browser tests

### E18-38 A report on records the role cannot see makes a refused request

**Status:** open · **Priority:** P3 · **Type:** bug

Found by the role tour (E18-07). A project manager opening a shared report about assets
(which the role may not view) gets a refused request (`403` from
`/api/reports/:id/run`) behind the page, rather than the page saying plainly that the
report covers records outside their role.

**Acceptance criteria**

- [ ] The report page checks the role's view permission for the report's record type and says so, without asking the server to run it (`web/src/modules/reports`)
- [ ] The role tour shows no failed request on `/reports/:id` for any role

### E18-39 Accessibility audit: findings left for other owners

**Status:** open · **Priority:** P2 · **Type:** bug

Found by the automated accessibility audit (E16-15, `node tools/a11y/audit.mjs`), in files
outside the audit's own changes. Each line names the file and the fix.

**Acceptance criteria**

- [ ] Dashboard calendar widget: `role="grid"` holds column headers and cells without rows (axe `aria-required-children`, `aria-required-parent`, critical). In `web/src/modules/reports/visuals.tsx` (line 79), wrap each week in `role="row"` (with `display: contents`, as the change calendar now does) or use `role="table"` with rows
- [ ] Safety overview (`/safety`) hazard matrix: empty cells are faded with `opacity: 0.55`, taking their rating text ("Medium", "High") to about 2.5:1 (axe `color-contrast`, serious, both themes). In `web/src/modules/safety/safety.css` (`.sf-cell.is-empty`), mark empty cells another way (a dashed border, or a lighter background with the full-strength text color)
- [ ] The audit reports no serious or critical violation on any route in either theme at 1440 and 820

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
