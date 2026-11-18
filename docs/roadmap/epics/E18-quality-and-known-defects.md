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
| E18-01 | Security-terms matrix scrolls sideways at 1440px | open | P2 |
| E18-02 | Notification rules page scrolls sideways at 1440px | open | P2 |
| E18-03 | Proofread NIST CSF 2.0 outcome text against the publication | open | P1 |
| E18-04 | Check every screen in the dark theme | open | P2 |
| E18-05 | Check every screen at tablet width | open | P2 |
| E18-06 | Check keyboard-only use | open | P2 |
| E18-07 | Check non-administrator roles in the browser | open | P1 |
| E18-08 | Check that every form can be submitted in the browser | open | P1 |
| E18-09 | "Also satisfies" parser splits names that contain numbers | open | P3 |
| E18-10 | Automated API test suite | done | P1 |
| E18-11 | One-off browser pass of every screen | done | P2 |
| E18-12 | Automated browser tests | open | P2 |
| E18-13 | Remove sector-specific wording left in built-in text | open | P1 |
| E18-14 | Tests for the web code | open | P3 |
| E18-15 | A ticket can be closed without a resolution code | open | P2 |
| E18-16 | Missed-target dashboard tile and its list disagree | open | P3 |
| E18-17 | Knowledge feedback can be given repeatedly | open | P3 |
| E18-18 | Evidence contract picker offers other vendors' contracts | open | P3 |
| E18-19 | Security incident pilot notice ignores the pilot-mode setting | open | P2 |
| E18-20 | Money shown with a hard-coded dollar sign in places | open | P2 |
| E18-21 | Approver role cannot accept risks | open | P2 |
| E18-22 | Audit log labels system events "Not signed in" | open | P3 |
| E18-23 | Assessment snapshot date is not validated | open | P3 |
| E18-24 | Navigation labels differ from page titles | open | P3 |
| E18-25 | Permissions granted but never checked | open | P2 |
| E18-26 | Only risks have an Actions tab | open | P2 |
| E18-27 | Dev mode ignored a custom port | done | P3 |

---

### E18-01 Security-terms matrix scrolls sideways at 1440px

**Status:** open · **Priority:** P2 · **Type:** bug

As a security lead on an ordinary laptop screen, I have to scroll sideways to see the
whole security-terms matrix. The page should fit, or only the grid should scroll with
the vendor column held in place.

**Acceptance criteria**

- [ ] At 1440px the page itself does not scroll horizontally
- [ ] If the grid is wider than the page, it scrolls inside its own frame and the vendor column stays visible
- [ ] Column headings remain readable
- [ ] Checked in both themes

**Where:** `web/src/modules/vendors/TermsMatrix.tsx`, `vendors.css` (feature: [E06-05](E06-vendors-and-contracts.md))

### E18-02 Notification rules page scrolls sideways at 1440px

**Status:** open · **Priority:** P2 · **Type:** bug

As an administrator on an ordinary laptop screen, I have to scroll sideways to see all
the columns of the notification rules table.

**Acceptance criteria**

- [ ] At 1440px the page does not scroll horizontally
- [ ] Long text columns wrap, or less-used columns move into the edit dialog
- [ ] The same fix is applied to the checklist and contact tables if they overflow
- [ ] Checked in both themes

**Where:** `web/src/modules/secincidents/RulesPage.tsx`, `EditableTable.tsx`, `secincidents.css` (feature: [E09-15](E09-security-incidents-and-notification-clocks.md))

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

**Status:** open · **Priority:** P2 · **Type:** bug

As a user who prefers the dark theme, I can read every screen. The dark theme has not
been exercised in a browser.

**Acceptance criteria**

- [ ] Every route loaded in the dark theme with seeded data
- [ ] No unreadable text, invisible borders or hard-coded light colours
- [ ] Charts, the heat map, the relationship map and status colours are legible
- [ ] Each problem found is fixed or raised as its own issue here

### E18-05 Check every screen at tablet width

**Status:** open · **Priority:** P2 · **Type:** bug

As a user on a tablet, I can use the application. No screen has been checked below
desktop width.

**Acceptance criteria**

- [ ] Every route loaded at about 768px and 1024px wide
- [ ] Navigation is reachable and can be closed
- [ ] Tables scroll inside their own frame, never the whole page
- [ ] Dialogs fit the screen
- [ ] Each problem found is fixed or raised as its own issue here

### E18-06 Check keyboard-only use

**Status:** open · **Priority:** P2 · **Type:** bug

As a user who does not use a mouse, I can reach and operate everything. Keyboard-only
use has not been tested.

**Acceptance criteria**

- [ ] The main journey in each module completed with the keyboard alone
- [ ] Focus is always visible and follows a sensible order
- [ ] Dialogs trap focus and return it when closed
- [ ] Menus, tabs, pickers and the relationship map can be operated
- [ ] Each problem found is fixed or raised as its own issue here

### E18-07 Check non-administrator roles in the browser

**Status:** open · **Priority:** P1 · **Type:** bug

As an agent, security lead or project manager, I see only what my role allows and
nothing breaks. Every screen has so far been loaded only as an administrator; the API
tests cover other roles but the web app has not been tried with them.

**Acceptance criteria**

- [ ] Sign in as each enabled default role and walk every navigation entry
- [ ] No navigation entry leads to a "forbidden" error
- [ ] No page shows a failed request for something the role may not read
- [ ] Buttons for actions the role cannot take are hidden or disabled
- [ ] The overview dashboard is sensible for each role
- [ ] Roles shipped switched off are tried once switched on

### E18-08 Check that every form can be submitted in the browser

**Status:** open · **Priority:** P1 · **Type:** bug

As a user, I can create and edit every kind of record from the screen. Screens were
loaded once without errors, but forms were not submitted.

**Acceptance criteria**

- [ ] Create and edit one of every record type through the web app
- [ ] Every hand-written dialog submitted once (ticket actions, check-out, disposal, gate decision, acceptance, declare incident, and so on)
- [ ] Validation messages appear beside the right field
- [ ] Each problem found is fixed or raised as its own issue here

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

As a developer, I run one command and every module's API behaviour is checked against
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

**Status:** open · **Priority:** P2 · **Type:** feature

As a maintainer, a small set of browser tests runs the main journey of each module on
every change, so a broken screen is caught before a user finds it.

**Acceptance criteria**

- [ ] A smoke test loads every route and fails on a script error or failed request
- [ ] One journey per module: create, edit, and one module-specific action
- [ ] Run as an administrator and as one non-administrator role
- [ ] Run in both themes
- [ ] Part of continuous integration ([E16-12](E16-hosting-operations-and-hardening.md))

### E18-13 Remove sector-specific wording left in built-in text

**Status:** open · **Priority:** P1 · **Type:** debt

As a maintainer about to publish the repository, I want every built-in label,
description and notice to be sector-neutral, as the hard rules require. A read of the
code found a few places that still carry wording from one kind of organisation.

**Acceptance criteria**

- [ ] The pilot-mode notice in `web/src/core/Shell.tsx` names no particular kind of data or client
- [ ] Default role descriptions in `server/src/core/services.ts` name no particular job titles
- [ ] The second risk scale's short key in `server/src/modules/risks/scales.ts` is checked and, if it is an abbreviation from one sector, given a self-explanatory name (with a migration for existing data)
- [ ] The built-in yes/no questions on a security incident (`server/src/modules/secincidents/index.ts`) are reviewed: kinds of data that only some organisations hold should come from the organisation profile
- [ ] The example in the code comment in `server/src/modules/frameworks/seed.ts` uses an invented framework name
- [ ] Default list values, field labels and seed text in every module are re-read for sector terms and either made neutral or moved to the organisation profile
- [ ] A search of the tracked files for the installation's own name, places and people finds nothing

### E18-14 Tests for the web code

**Status:** open · **Priority:** P3 · **Type:** debt

As a developer, the shared web helpers have their own tests. Today all automated tests
are on the server.

**Acceptance criteria**

- [ ] Unit tests for formatting, the list query builder and the saved-view store
- [ ] Component tests for the generic list, form and record page
- [ ] Run by the same `test` command

### E18-15 A ticket can be closed without a resolution code

**Status:** open · **Priority:** P2 · **Type:** bug

Resolving a ticket requires a resolution code, but setting the status straight to Closed does not.

**Acceptance criteria**

- [ ] Closing a ticket requires a resolution code, or closes only from Resolved

### E18-16 Missed-target dashboard tile and its list disagree

**Status:** open · **Priority:** P3 · **Type:** bug

The service desk dashboard tile counts tickets that missed either target, but opens a list filtered on resolution breaches only.

**Acceptance criteria**

- [ ] The tile and the list it opens show the same tickets

### E18-17 Knowledge feedback can be given repeatedly

**Status:** open · **Priority:** P3 · **Type:** bug

One person can click "was this helpful" any number of times on the same article.

**Acceptance criteria**

- [ ] One vote per person per article version

### E18-18 Evidence contract picker offers other vendors' contracts

**Status:** open · **Priority:** P3 · **Type:** bug

When adding evidence for a vendor, the contract picker lists every contract; the server then rejects the wrong ones.

**Acceptance criteria**

- [ ] The picker lists only the chosen vendor's contracts

### E18-19 Security incident pilot notice ignores the pilot-mode setting

**Status:** open · **Priority:** P2 · **Type:** bug

The notice on the incident workspace always shows, even when an administrator has switched pilot mode off.

**Acceptance criteria**

- [ ] The notice follows the pilot-mode setting

### E18-20 Money shown with a hard-coded dollar sign in places

**Status:** open · **Priority:** P2 · **Type:** bug

Project settings, the budget chart and the contract import assume dollars whatever GRC_CURRENCY is.

**Acceptance criteria**

- [ ] Every money value and input uses the configured currency; the contract import reads amounts in it

### E18-21 Approver role cannot accept risks

**Status:** open · **Priority:** P2 · **Type:** bug

The Approver role description promises risk acceptance but the role has no risks permission.

**Acceptance criteria**

- [ ] The default Approver grants match its description, with a test

### E18-22 Audit log labels system events "Not signed in"

**Status:** open · **Priority:** P3 · **Type:** bug

Events written by the system (seeding, timers) read as if someone was not signed in.

**Acceptance criteria**

- [ ] System events show "System" as the actor

### E18-23 Assessment snapshot date is not validated

**Status:** open · **Priority:** P3 · **Type:** bug

A snapshot can be created with an invalid or far-future date.

**Acceptance criteria**

- [ ] The date is validated on the server and in the dialog

### E18-24 Navigation labels differ from page titles

**Status:** open · **Priority:** P3 · **Type:** improvement

For example Catalogue / Service catalogue and Security terms / Security terms matrix.

**Acceptance criteria**

- [ ] Each navigation item and its page title match

### E18-25 Permissions granted but never checked

**Status:** open · **Priority:** P2 · **Type:** debt

The dashboards, reports and portal permissions appear in role grants but no route checks them.

**Acceptance criteria**

- [ ] Each is either enforced by the screens and routes it names, or removed

### E18-26 Only risks have an Actions tab

**Status:** open · **Priority:** P2 · **Type:** improvement

Actions can arise from incidents, assessments, vendors and projects, but only the risk page embeds the actions panel.

**Acceptance criteria**

- [ ] Security incidents, framework outcomes, vendors, contracts and projects show their actions and can add one

### E18-27 Dev mode ignored a custom port

**Status:** done · **Priority:** P3 · **Type:** bug

The web dev server proxied to port 8080 whatever GRC_PORT was.

**Acceptance criteria**

- [x] The proxy follows GRC_PORT
