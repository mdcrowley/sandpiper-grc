# E07 Framework outcomes and assessments

**Status:** in progress

## Goal

Track where the organization stands against a cybersecurity framework, outcome by
outcome: the current status, the target, the owner, the evidence, and how the picture
changes from one assessment to the next. NIST CSF 2.0 is included; other frameworks can
be added as data.

## Scope notes

- Covers `server/src/modules/frameworks/` and `web/src/modules/frameworks/`.
- Record types: `framework`, `framework_outcome`, `assessment_snapshot`.
- The status scale (with a weight per status), the phases and the target status are
  configurable.
- The included NIST CSF 2.0 text was proofread from knowledge of NIST CSWP 29 (two
  punctuation fixes); a line-by-line check against the publication by a person is still
  needed, see [E18-03](E18-quality-and-known-defects.md).
- Transit operators often map CSF outcomes to sector guidance; the mappings and the
  coverage view (E07-19) serve that without naming any one document.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E07-01 | Frameworks with functions and categories | done | P1 |
| E07-02 | NIST CSF 2.0 reference data | done | P1 |
| E07-03 | Outcome records | done | P1 |
| E07-04 | Outcome board | done | P1 |
| E07-05 | Outcome table view | done | P2 |
| E07-06 | Evidence on an outcome, with expiry | done | P2 |
| E07-07 | Cross-mappings to other frameworks | done | P2 |
| E07-08 | Assessment snapshots | done | P1 |
| E07-09 | Compare two assessments | done | P2 |
| E07-10 | Progress over time against a target status | done | P2 |
| E07-11 | Load an organization's designations and target profile | done | P2 |
| E07-12 | Attach evidence files to outcomes | done | P2 |
| E07-13 | Screen for editing a framework's structure | done | P3 |
| E07-14 | Add another framework from a reference file | done | P3 |
| E07-15 | Outcomes board redesign | done | P1 |
| E07-16 | Edit evidence notes and mappings | done | P2 |
| E07-17 | Keep "also satisfies" text and mapping rows in step | done | P2 |
| E07-18 | Board filters in the address, and saved views | done | P2 |
| E07-19 | Coverage of another framework | done | P2 |
| E07-20 | Review-date reminders | done | P2 |
| E07-21 | Printable assessment report | done | P2 |
| E07-22 | Outcome page: status timeline and linked work | done | P2 |
| E07-23 | Settings screen for the target status, weights and reminder lead time | open | P3 |
| E07-24 | Reminders when evidence notes expire | open | P3 |
| E07-25 | Saved board views shared between people | open | P3 |

---

### E07-01 Frameworks with functions and categories

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, I can hold more than one framework, each with its own functions and
categories, so outcomes are grouped the way the framework groups them.

**Acceptance criteria**

- [x] Framework records with a unique key, name and version
- [x] Functions and categories stored per framework
- [x] The structure can be read and replaced through the API
- [x] Permissions respected; changes audited

**Implemented in:** `framework` resource, `GET/POST /api/frameworks/:id/structure` (`server/src/modules/frameworks/index.ts`), `structure.ts`

### E07-02 NIST CSF 2.0 reference data

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, the framework's 6 functions, 22 categories and 106 subcategories
are available to load, so I do not type them in.

**Acceptance criteria**

- [x] A reference file with every function, category and subcategory
- [x] Codes are unique, well-formed and sit under their category and function
- [x] Counts per function match the published numbers
- [x] The `dev` seed loads the whole framework with sample statuses
- [ ] Outcome wording proofread line by line against the publication by a person (tracked as [E18-03](E18-quality-and-known-defects.md)). Checked from knowledge of CSWP 29 in wave 2: the GV.OC category description and GV.OC-03 had hyphens where the publication has em dashes (fixed); nothing else found

**Implemented in:** `server/src/modules/frameworks/csf2.json`, `reference.ts`, `reference.test.ts`

### E07-03 Outcome records

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, each outcome has a status, a target, an owner, a phase, a first
action and a review date, alongside the official text and a plain-language description.

**Acceptance criteria**

- [x] The outcome's reference is its own code
- [x] Function and category are filled in from the code when not given
- [x] Status and phase are configurable lists
- [x] Outcomes can be flagged as priority outcomes
- [x] Detail page with history, comments and links

**Implemented in:** `framework_outcome` resource, `GET /api/framework-outcomes/:id/context` (`server/src/modules/frameworks/index.ts`); `web/src/modules/frameworks/OutcomeDetail.tsx`

### E07-04 Outcome board

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, I see a framework as a board: functions, then categories, each with
counts by status and a weighted score, and I can open any outcome from it.

**Acceptance criteria**

- [x] Outcomes grouped by function then category
- [x] Counts by status and a score out of 100 at each level
- [x] How many outcomes are at or above the target status
- [x] A status bar for each group

**Implemented in:** `GET /api/frameworks/:id/board` (`server/src/modules/frameworks/index.ts`); `web/src/modules/frameworks/Board.tsx`, `BoardView.tsx`, `StatusBar.tsx`

### E07-05 Outcome table view

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I can switch from the board to a table of outcomes with the usual
search, filters, saved views and export.

**Acceptance criteria**

- [x] The generic list for outcomes, reachable from the board
- [x] New outcomes can be created from it

**Implemented in:** `web/src/modules/frameworks/Board.tsx` (`view="table"`), route `/frameworks/outcomes`

### E07-06 Evidence on an outcome, with expiry

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I list the evidence that supports each outcome's status and when
each piece goes out of date.

**Acceptance criteria**

- [x] Add, list and remove evidence entries on an outcome
- [x] Each entry shows whether it is current, expiring or expired
- [x] Changes are audited on the outcome
- [x] Evidence can be a file, not only text (see E07-12)

**Implemented in:** `/api/framework-outcomes/:id/evidence` (`server/src/modules/frameworks/index.ts`, `extras.ts`); `web/src/modules/frameworks/EvidenceTab.tsx`

### E07-07 Cross-mappings to other frameworks

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I record which requirements of other frameworks or standards an
outcome also satisfies, so one piece of work is counted everywhere it applies.

**Acceptance criteria**

- [x] An outcome can be mapped to several other frameworks, without duplicates
- [x] Framework names already used are offered when adding a mapping
- [x] Mappings can be removed

**Implemented in:** `/api/framework-outcomes/:id/mappings`, `GET /api/framework-mappings/names` (`server/src/modules/frameworks/index.ts`); `web/src/modules/frameworks/MappingsTab.tsx`

### E07-08 Assessment snapshots

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, I take a dated snapshot of every outcome's status, so I have a
record of each assessment.

**Acceptance criteria**

- [x] A snapshot stores the status of every outcome in the framework on that date
- [x] Snapshots can be listed, renamed and removed
- [x] A snapshot page shows its scores and statuses

**Implemented in:** `POST /api/assessments`, `GET /api/assessments/:id`, `assessment_snapshot` resource (`server/src/modules/frameworks/index.ts`); `web/src/modules/frameworks/Assessments.tsx`, `SnapshotDetail.tsx`

### E07-09 Compare two assessments

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I pick two snapshots and see which outcomes improved, slipped or
stayed the same.

**Acceptance criteria**

- [x] Outcome-by-outcome change between two snapshots
- [x] Totals of improved, unchanged and worse

**Implemented in:** `GET /api/assessments/compare` (`server/src/modules/frameworks/index.ts`); `web/src/modules/frameworks/Compare.tsx`

### E07-10 Progress over time against a target status

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, a chart shows the score at each snapshot and now, for priority
outcomes and for all outcomes, against the status the organization is aiming for.

**Acceptance criteria**

- [x] Progress across snapshots and the current position
- [x] Separate lines for priority outcomes and all outcomes
- [x] The target status is a setting and the chart follows it

**Implemented in:** `GET /api/frameworks/:id/progress` (`server/src/modules/frameworks/index.ts`); `web/src/modules/frameworks/ProgressChart.tsx`

### E07-11 Load an organization's designations and target profile

**Status:** done · **Priority:** P2 · **Type:** feature

As the person setting up an installation, I load which outcomes my organization has
designated as priorities, with their targets and first actions, from private files.

**Acceptance criteria**

- [x] Reads optional files from the private seed folder
- [x] Skips quietly, and says so, when the files are absent
- [x] Running again does not overwrite what people have changed or duplicate anything
- [x] "Also satisfies" cells become cross-mappings

**Implemented in:** `server/src/modules/frameworks/seed.ts`, `seed.test.ts`

The "also satisfies" parser no longer splits framework names that contain numbers
([E18-09](E18-quality-and-known-defects.md), fixed in E07-17).

### E07-12 Attach evidence files to outcomes

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I attach the document, screenshot or export that proves an outcome
is met, alongside the written evidence notes.

**Acceptance criteria**

- [x] Files can be attached to an outcome as dated evidence (collected and expiry dates)
- [x] Files follow the outcome's permissions
- [x] Uses the shared attachments service ([E14-01](E14-platform-services.md)); the tab still works when that module is absent

**Implemented in:** `web/src/modules/frameworks/EvidenceTab.tsx` (`AttachmentsPanel` with `evidence`)

### E07-13 Screen for editing a framework's structure

**Status:** done · **Priority:** P3 · **Type:** feature

As a security lead, I add, rename, recolor, reorder and remove functions and categories
on a screen.

**Acceptance criteria**

- [x] Functions and categories can be added, renamed and reordered
- [x] A category that still has outcomes (or a function that still has categories or outcomes) cannot be removed
- [x] Needs `frameworks.edit`; changes are audited

**Implemented in:** `DELETE /api/frameworks/:id/categories/:code`, `/functions/:code` (`server/src/modules/frameworks/extras.ts`); `web/src/modules/frameworks/Manage.tsx`, route `/frameworks/manage`; tests in `extras.test.ts`

### E07-14 Add another framework from a reference file

**Status:** done · **Priority:** P3 · **Type:** feature

As a security lead, I load a second framework from a file in the same shape as the
included one, without a code change.

**Acceptance criteria**

- [x] An import screen accepts a reference file, shows what loading it would do, then loads it
- [x] The file is validated (unique codes, every outcome under a category) with problems listed in plain words
- [x] Loading again updates text without touching statuses; outcomes missing from the file are left alone
- [x] The file format is documented (user guide, "The reference file format"); any framework can be downloaded in that format

**Implemented in:** `POST /api/frameworks/import`, `GET /api/frameworks/:id/reference` (`server/src/modules/frameworks/importer.ts`, `extras.ts`); `web/src/modules/frameworks/Manage.tsx`

### E07-15 Outcomes board redesign

**Status:** done · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [x] Function bands with a progress ring, at-target count and status bar; category groups; compact tiles (code, plain-language text, status, priority star, phase, review date, owner avatar)
- [x] Filter pills (priority focus, status, phase, function), owner and text search; Detailed / Compact / Map density
- [x] Keyboard navigation between tiles (arrows, Home, End, Enter; S opens the status menu)
- [x] Quick status change from a tile for people with Edit
- [x] Priority focus counts only priority outcomes in the bands and summary
- [x] Smooth with the full 106-outcome framework (memoized tiles, no per-tile requests)
- [x] Print layout (More > Print this board)

**Implemented in:** `web/src/modules/frameworks/Board.tsx`, `BoardView.tsx`, `StatusBar.tsx`, `boardState.ts`, `frameworks.css`

### E07-16 Edit evidence notes and mappings

**Status:** done · **Priority:** P2 · **Type:** feature

- [x] An evidence note's title, description, location and dates can be changed; audited with before and after
- [x] A mapping's name and reference can be changed; duplicates refused

**Implemented in:** `PATCH /api/framework-outcomes/:id/evidence/:evidenceId` and `/mappings/:mappingId` (`extras.ts`); `EvidenceTab.tsx`, `MappingsTab.tsx`

### E07-17 Keep "also satisfies" text and mapping rows in step

**Status:** done · **Priority:** P2 · **Type:** defect

- [x] Adding, changing or removing a mapping rewrites the outcome's "also satisfies" text
- [x] Changing the text through the API adds and removes mapping rows to match; audited
- [x] Names containing numbers are no longer split: an explicit colon, the configurable `mapping_framework` list and names already used are recognized before the general rule (E18-09)

**Implemented in:** `server/src/modules/frameworks/mappings.ts`, hooks in `index.ts`, `seed.ts`; tests in `extras.test.ts`

### E07-18 Board filters in the address, and saved views

**Status:** done · **Priority:** P2 · **Type:** feature

- [x] Every board filter is in the page address (bookmark, share, Back)
- [x] Built-in views (All, Priority) and named views saved in the browser

**Implemented in:** `web/src/modules/frameworks/boardState.ts`, `Board.tsx`

### E07-19 Coverage of another framework

**Status:** done · **Priority:** P2 · **Type:** feature

- [x] Every other framework that outcomes are mapped to, with requirement and outcome counts and how many are at target
- [x] One framework's requirements, each with the outcomes that satisfy it and their status

**Implemented in:** `GET /api/frameworks/:id/coverage` (`extras.ts`); `web/src/modules/frameworks/Coverage.tsx`

### E07-20 Review-date reminders

**Status:** done · **Priority:** P2 · **Type:** feature

- [x] The owner (or, with no owner, people with `frameworks.edit`) is notified through `app.notify` 14 days before the review date (setting `frameworks.review_reminder_days`) and when it is reached
- [x] Each review date is announced at most twice; runs hourly; skipped when the notifications module is absent

**Implemented in:** `server/src/modules/frameworks/reminders.ts`, migration `002_editing_and_reminders.sql`, `POST /api/frameworks/review-reminders/run`

### E07-21 Printable assessment report

**Status:** done · **Priority:** P2 · **Type:** feature

- [x] A report page per snapshot laid out for paper: headline, scores with change since the previous snapshot, by function, what moved, every outcome

**Implemented in:** `web/src/modules/frameworks/SnapshotReport.tsx`, route `/assessments/:id/report`; `previous` and `categories` on `GET /api/assessments/:id`

### E07-22 Outcome page: status timeline and linked work

**Status:** done · **Priority:** P2 · **Type:** feature

- [x] Official and plain-language text side by side; target and first action
- [x] Status timeline from the history and the snapshots, in time order
- [x] Risks this outcome reduces, policies that support it (when policies exist) and the shared Actions panel (when actions exist)

**Implemented in:** `GET /api/framework-outcomes/:id/timeline` (`extras.ts`); `OutcomeDetail.tsx`, `OutcomeTimeline.tsx`, `LinkedPanel.tsx`

### E07-23 Settings screen for the target status, weights and reminder lead time

**Status:** open · **Priority:** P3 · **Type:** feature

The target status and the status weights are stored settings and the reminder lead time is
the setting `frameworks.review_reminder_days`, but none has a screen.

- [ ] An administrator can change them on a screen; changes audited

### E07-24 Reminders when evidence notes expire

**Status:** open · **Priority:** P3 · **Type:** feature

- [ ] The outcome's owner is told when an evidence note is about to expire and when it has (files already follow the attachments module's own rules)

### E07-25 Saved board views shared between people

**Status:** open · **Priority:** P3 · **Type:** feature

Saved board views live in one browser. Sharing today means sending the page address.

- [ ] Views can be saved on the server and shared with a team
