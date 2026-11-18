# E07 Framework outcomes and assessments

**Status:** in progress

## Goal

Track where the organisation stands against a cybersecurity framework, outcome by
outcome: the current status, the target, the owner, the evidence, and how the picture
changes from one assessment to the next. NIST CSF 2.0 is included; other frameworks can
be added as data.

## Scope notes

- Covers `server/src/modules/frameworks/` and `web/src/modules/frameworks/`.
- Record types: `framework`, `framework_outcome`, `assessment_snapshot`.
- The status scale (with a weight per status), the phases and the target status are
  configurable.
- The included NIST CSF 2.0 text has not been checked against the publication; see
  [E18-03](E18-quality-and-known-defects.md).

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
| E07-11 | Load an organisation's designations and target profile | done | P2 |
| E07-12 | Attach evidence files to outcomes | open | P2 |
| E07-13 | Screen for editing a framework's structure | open | P3 |
| E07-14 | Add another framework from a reference file | open | P3 |

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
- [ ] Outcome wording proofread against the publication (tracked as [E18-03](E18-quality-and-known-defects.md))

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
- [ ] Evidence can be a file, not only text (see E07-12)

**Implemented in:** `/api/framework-outcomes/:id/evidence` (`server/src/modules/frameworks/index.ts`); `web/src/modules/frameworks/EvidenceTab.tsx`

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
outcomes and for all outcomes, against the status the organisation is aiming for.

**Acceptance criteria**

- [x] Progress across snapshots and the current position
- [x] Separate lines for priority outcomes and all outcomes
- [x] The target status is a setting and the chart follows it

**Implemented in:** `GET /api/frameworks/:id/progress` (`server/src/modules/frameworks/index.ts`); `web/src/modules/frameworks/ProgressChart.tsx`

### E07-11 Load an organisation's designations and target profile

**Status:** done · **Priority:** P2 · **Type:** feature

As the person setting up an installation, I load which outcomes my organisation has
designated as priorities, with their targets and first actions, from private files.

**Acceptance criteria**

- [x] Reads optional files from the private seed folder
- [x] Skips quietly, and says so, when the files are absent
- [x] Running again does not overwrite what people have changed or duplicate anything
- [x] "Also satisfies" cells become cross-mappings

**Implemented in:** `server/src/modules/frameworks/seed.ts`, `seed.test.ts`

Known defect: the "also satisfies" parser splits framework names that contain numbers,
see [E18-09](E18-quality-and-known-defects.md).

### E07-12 Attach evidence files to outcomes

**Status:** open · **Priority:** P2 · **Type:** feature

As a security lead, I attach the document, screenshot or export that proves an outcome
is met. Today evidence is a text entry only.

**Acceptance criteria**

- [ ] An evidence entry can carry one or more files
- [ ] Files follow the outcome's permissions
- [ ] Depends on [E14-01](E14-platform-services.md)

### E07-13 Screen for editing a framework's structure

**Status:** open · **Priority:** P3 · **Type:** feature

As a security lead, I add or rename functions and categories on a screen. Today the
structure can only be changed through the API.

**Acceptance criteria**

- [ ] Functions and categories can be added, renamed and reordered
- [ ] A category that still has outcomes cannot be removed
- [ ] Needs `frameworks.edit`; changes are audited

### E07-14 Add another framework from a reference file

**Status:** open · **Priority:** P3 · **Type:** feature

As a security lead, I load a second framework from a file in the same shape as the
included one, without a code change.

**Acceptance criteria**

- [ ] An import screen or command accepts a reference file
- [ ] The file is validated (unique codes, every outcome under a category)
- [ ] Loading again updates text without touching statuses
- [ ] The file format is documented
