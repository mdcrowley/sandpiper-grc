# E17 Documentation

**Status:** in progress (7 of 14 issues done)

## Goal

Make the project understandable to three readers: someone deciding whether to try it,
someone using it every day, and someone installing, running or changing it. The same
user guide should be readable on GitHub and inside the application.

## Scope notes

- The documentation set was being written when this tracker was created. Issues marked
  "in progress" have files in the repository that had not yet been reviewed as a whole;
  close each one when its acceptance criteria have been checked.
- The user guide has one source: the Markdown files in `docs/user/`. The in-app Help
  bundles those files at build time.
- `docs/known-gaps.md` and this tracker must be updated with every change (see the
  [tracker rules](../README.md)).
- Nothing organization-specific belongs in any of these files.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E17-01 | README | done | P1 |
| E17-02 | Developer conventions | done | P1 |
| E17-03 | Web component catalog | done | P2 |
| E17-04 | Known gaps list | done | P1 |
| E17-05 | Example organization profile | done | P1 |
| E17-06 | Feature tracker | done | P1 |
| E17-07 | Documentation index | in progress | P2 |
| E17-08 | User guide | in progress | P1 |
| E17-09 | In-app Help | in progress | P1 |
| E17-10 | Installation and administrator guide | in progress | P1 |
| E17-11 | Operations runbook | in progress | P1 |
| E17-12 | Architecture and security notes | in progress | P2 |
| E17-13 | License, contributing guide and security policy | in progress | P1 |
| E17-14 | American English throughout | done | P2 |

---

### E17-01 README

**Status:** done · **Priority:** P1 · **Type:** docs

As a visitor to the repository, I learn in one page what the application does, that it
is a prototype, how to run it and how to make it my own.

**Acceptance criteria**

- [x] What it is, by area
- [x] A clear "prototype" status with a pointer to the known gaps
- [x] Steps to run it on a new machine
- [x] How the organization profile works
- [x] A warning that incident notification rules must be set by each organization
- [ ] Links to the user guide, the documentation index and this tracker

**Implemented in:** `README.md`

### E17-02 Developer conventions

**Status:** done · **Priority:** P1 · **Type:** docs

As a developer, I can read the hard rules, the layout, how to
write a module, the generated API, permissions, tests and web conventions in one place.

**Acceptance criteria**

- [x] Hard rules, including "nothing organization-specific" and "local only"
- [x] Commands and environment variables
- [x] Module shape, migrations, resources and generated routes
- [x] Permissions, restricted records and the shared actions contract
- [x] Record types and which module owns each

**Implemented in:** `docs/development.md`

### E17-03 Web component catalog

**Status:** done · **Priority:** P2 · **Type:** docs

As a developer writing a screen, I can look up every shared component, hook and helper
with an example.

**Acceptance criteria**

- [x] Writing a module, data hooks, list, form, record page, charts
- [x] Form controls, formatting, color and icon names

**Implemented in:** `web/src/core/README.md`

### E17-04 Known gaps list

**Status:** done · **Priority:** P1 · **Type:** docs

As anyone evaluating the application, I can read an honest list of what is not built,
what is built but incomplete, and what has and has not been verified.

**Acceptance criteria**

- [x] "Not built", "Built but incomplete" and "Verification status" sections
- [x] Every gap has at least one open issue in this tracker (see the coverage table in the [tracker README](../README.md))
- [x] Updated with every change (a standing rule)

**Implemented in:** `docs/known-gaps.md`

### E17-05 Example organization profile

**Status:** done · **Priority:** P1 · **Type:** docs

As the person setting up an installation, I copy an invented example of the
organization profile and edit it, rather than working out its shape from the code.

**Acceptance criteria**

- [x] An example file with invented content
- [x] Covers the application name, extra list values, obligations and notification rules
- [x] The README says where to copy it

**Implemented in:** `examples/organization.example.json`

### E17-06 Feature tracker

**Status:** done · **Priority:** P1 · **Type:** docs

As a maintainer, I have every feature, built or not, written down as an issue under an
epic, in files that can be copied into GitHub Issues later.

**Acceptance criteria**

- [x] One file per epic with an issues table and a section per issue
- [x] Built features are recorded as done, with the files that implement them
- [x] Every known gap has an open issue
- [x] Rules for keeping the tracker up to date, and for moving it to GitHub Issues

**Implemented in:** `docs/roadmap/README.md`, `docs/roadmap/epics/`

### E17-07 Documentation index

**Status:** in progress · **Priority:** P2 · **Type:** docs

As a reader, I open one page in the `docs` folder and find every other document, with a
line on who each is for.

**Acceptance criteria**

- [x] `docs/README.md` exists
- [ ] It links to the user guide, installation, operations, architecture, security, known gaps and this tracker
- [ ] Every link resolves

**Files:** `docs/README.md`

### E17-08 User guide

**Status:** in progress · **Priority:** P1 · **Type:** docs

As a user, I can read a plain-English guide to each area of the application: what it is
for, the main tasks step by step, and what each term means.

**Acceptance criteria**

- [x] Pages exist for getting started, service desk, inventory, vendors and contracts, frameworks, risks and actions, security incidents, projects, and administration
- [ ] Each page has been checked against the running application
- [ ] No page describes a feature that is not built without saying so
- [ ] British spelling and plain English throughout
- [ ] Nothing organization-specific

**Files:** `docs/user/01-getting-started.md` to `docs/user/09-administration.md`

### E17-09 In-app Help

**Status:** in progress · **Priority:** P1 · **Type:** feature

As a user, I open Help from my account menu and read the same guide inside the
application, with search and links between pages.

**Acceptance criteria**

- [x] A Help module bundles the files in `docs/user/` at build time
- [x] A Help entry in the account menu
- [ ] Every guide page renders correctly in both themes
- [x] Links between pages and to sections work (each heading has a link to itself; Help search results open the section)
- [x] Search finds text in any page, with the matching words highlighted in a passage under each result
- [x] Works with no network access (nothing loaded from outside; the pages are bundled, one chunk per page, fetched when Help is opened)
- [x] "Help for this page" (the ? button in the top bar, and `g` then `h`) opens the section about the current screen; the map is `web/src/modules/help/routeMap.ts`, and a test checks every entry points at a heading that exists
- [x] A keyboard-shortcut sheet (`?`) and an API reference page (`/help/api`) built from `GET /api/openapi.json`

**Files:** `web/src/modules/help/` (`index.tsx`, `HelpHome.tsx`, `HelpPage.tsx`, `guide.ts`, `text.ts`, `routeMap.ts`, `ApiReference.tsx`, `help.test.ts`); `web/src/core/Shell.tsx`, `web/src/core/Shortcuts.tsx`

### E17-10 Installation and administrator guide

**Status:** in progress · **Priority:** P1 · **Type:** docs

As the person installing the application and looking after its users, I can follow one
guide from an empty machine to a configured installation with users, roles, lists and
my organization's profile loaded.

**Acceptance criteria**

- [x] An installation document and an administration page in the user guide exist
- [ ] Installation steps tested on a clean machine
- [ ] First-run setup, users, roles, second factor, lists and settings are covered
- [ ] The organization profile and seed files are explained with the example
- [ ] Says clearly what must be set before a pilot (notification rules, service-level targets, risk scales)

**Files:** `docs/installation.md`, `docs/user/09-administration.md`

### E17-11 Operations runbook

**Status:** in progress · **Priority:** P1 · **Type:** docs

As an operator, I have written procedures for starting and stopping, backing up,
checking health, reading logs and recovering from the common failures.

**Acceptance criteria**

- [x] An operations document exists
- [ ] Start, stop, health, backup and log locations are covered
- [ ] Says plainly that restore, upgrade and scheduled backup are not built ([E16](E16-hosting-operations-and-hardening.md))
- [ ] A manual restore procedure is written and has been tried
- [ ] What to do when the server will not start

**Files:** `docs/operations.md`

### E17-12 Architecture and security notes

**Status:** in progress · **Priority:** P2 · **Type:** docs

As a developer or a reviewer, I can read how the application is put together and what
its security model is, including what is deliberately left for later.

**Acceptance criteria**

- [x] Architecture and security documents exist
- [ ] Module discovery, the resource registry, permissions and restricted records are explained
- [ ] The sign-in, session and audit design are described
- [ ] Known weaknesses match `docs/known-gaps.md` and [E02](E02-account-security.md)

**Files:** `docs/architecture.md`, `docs/security.md`

### E17-13 License, contributing guide and security policy

**Status:** in progress · **Priority:** P1 · **Type:** docs

As a visitor to the public repository, I can see under what terms I may use the code,
how to propose a change, and how to report a security problem privately. None of these
files exist yet, and the repository is about to be published.

**Acceptance criteria**

- [x] A license file chosen by the owner: MIT (`LICENSE`)
- [x] A contributing guide: how to run tests, the hard rules, the "update the tracker" rule (`CONTRIBUTING.md`)
- [x] A security policy saying how to report a vulnerability (`SECURITY.md`)
- [x] Issue templates that match this tracker's issue format (`.github/ISSUE_TEMPLATE/`)
- [ ] A check that no private or internal file is tracked before the first push

### E17-14 American English throughout

**Status:** done · **Priority:** P2 · **Type:** improvement

As a reader in the United States, the product's main audience, I see one spelling
throughout: American English in the documentation, the user guide, the screens, messages
and code comments ("organization", "catalog", "authorization", "color", "license"). Names
that other systems or stored data depend on change only with a way back: an old file name,
web address or API path keeps working, and stored lookup values stay as they are while
their labels change.

**Acceptance criteria**

- [x] The documentation (`docs/**`, `web/src/core/README.md`) uses American spelling, and the developer guide states the rule
- [x] The README uses American spelling
- [x] Screens, messages, labels and code comments use American spelling
- [x] `seed/organization.json` and `examples/organization.example.json` replace the `organisation` names; a seed file with the old name is still read, and the seed option is `organization`
- [x] The web address `/catalog` replaces `/catalogue`, and the old address redirects
- [x] API paths with a British spelling gain an American one; the old path stays as a deprecated alias, marked as such in the OpenAPI document
- [x] Help links into the user guide still reach their sections after headings changed

Stored values that are identifiers (for example the status `cancelled`, the setting `catalogue_seeded`) keep their spelling so existing data and integrations keep working; every label shows the American spelling ("Canceled"). Dates are written the American way (Nov 18, 2026) on screen, in exports, PDFs and email.

**Implemented in:** `server/src/core/migrations/006_american_labels.sql`, `server/src/core/api/deprecations.ts` (old API paths as deprecated aliases), `web/src/core/renamedRoutes.ts` (`/catalogue` redirects), `server/src/core/profile.ts` (reads `organisation` seed names too), `web/src/core/format.ts` and every server date format (`en-US`).

