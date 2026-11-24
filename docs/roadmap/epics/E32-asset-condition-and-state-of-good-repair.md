# E32 Asset condition and state of good repair

**Status:** done (9 of 9 issues done)

## Goal

Rate the condition of vehicles, equipment and facilities against useful-life benchmarks by asset class, and show state-of-good-repair performance against targets, linked to replacement projects and funding. Gap review GP-12.

## Scope notes

- Built in wave 11 as the module `condition` (feature area `condition`, permission module `assets`; vehicles also need `fleet` and sites `sites`), on the inventory extension points of coordinator step 0 (contract C2).
- Condition and useful life are a compliance and capital-planning matter; maintenance work orders are not planned (E32-06).
- With the fleet area switched off, the condition pages and the condition reminder settings name only the kinds that are on (subtitles built from the fleet switch; reminder settings speak of items with an asset class), and the API descriptions name no kind of record.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E32-01 | Asset classes with useful-life benchmarks | done | P2 |
| E32-02 | Condition assessments on vehicles, assets and sites | done | P2 |
| E32-03 | Facility and infrastructure asset classes | done | P2 |
| E32-04 | State-of-good-repair dashboard with targets by class | done | P2 |
| E32-05 | Links to replacement projects and funding awards | done | P3 |
| E32-06 | Not planned: maintenance work orders | done | P3 |
| E32-07 | Area and Asset manager role | done | P2 |
| E32-08 | Yearly target approval | done | P3 |
| E32-09 | Sample data and guide | done | P2 |

---

### E32-01 Asset classes with useful-life benchmarks

**Status:** done · **Priority:** P2 · **Type:** feature

An asset manager wants each asset class to carry a useful-life benchmark.

**Acceptance criteria**

- [x] Asset classes with a benchmark in years or miles

**Implemented in:** `server/src/modules/condition/index.ts` (type `asset_class`, `ACL-`, its checks and default-class suggestions `GET /api/asset-classes/suggest`), `condition/service.ts` (`usefulLifeEnd`: years, or the day the miles are reached at the rate run so far, whichever is earlier; recomputed on save, by `POST /api/asset-classes/:id/recompute` and nightly by `condition.recompute`), `inventory/fields-condition.ts` and `fleet/fields-condition.ts` (the fields of contract C2, plus `in_service_date` on assets, `in_use` on sites and `odometer_read_on` on vehicles), migrations `condition/001`, `inventory/005`, `fleet/002`; web `web/src/modules/condition/Classes.tsx`

### E32-02 Condition assessments on vehicles, assets and sites

**Status:** done · **Priority:** P2 · **Type:** feature

An asset manager wants dated condition ratings with the assessor.

**Acceptance criteria**

- [x] Condition assessment records on vehicles, assets and sites, on a configurable scale

**Implemented in:** `server/src/modules/condition/index.ts` (type `condition_assessment`, `CND-`, evidence files; row rule: a vehicle's needs `fleet.view`, a site's `sites.view`, figures masked but counted; the newest assessment is put on the record as system work, also after a delete; `POST /api/condition-assessments/:id/action` raises an action with source `condition`), list `condition_rating` (1 to 5 with `meta.score`, `inventory/fields-condition.ts`); web `condition/shared.tsx` (`ConditionSection`), `condition/InventoryPanel.tsx`, `condition/Assessments.tsx`, the vehicle page's Condition tab (`fleet/Vehicles.tsx`)

### E32-03 Facility and infrastructure asset classes

**Status:** done · **Priority:** P2 · **Type:** feature

An asset manager wants stations, guideway, track and maintenance facilities assessed like vehicles.

**Acceptance criteria**

- [x] Facility and infrastructure classes in the inventory

**Implemented in:** `inventory/fields-condition.ts` (sites gain `site_kind` (list `site_kind`), `built_year`, `in_use`; infrastructure and facility `asset_type` values with explicit sorts); classes that rate sites or assets

### E32-04 State-of-good-repair dashboard with targets by class

**Status:** done · **Priority:** P2 · **Type:** feature

A capital planner wants the share past useful life by class against yearly targets.

**Acceptance criteria**

- [x] A dashboard and metrics for the share past useful life by class

**Implemented in:** `server/src/modules/condition/dashboard.ts` (`GET /api/condition/dashboard?year=`, `GET /api/condition/aging`, `GET /api/condition/summary` (contract C5), metrics `condition.past_useful_life_pct` and `condition.poor_condition_pct` (C6), calendar source `condition.assessments_due` (C3)), `condition/targets.ts` (yearly targets), `condition/reminders.ts` (`condition.reminders`, claimed per record and due date in `condition_reminders`); web `condition/Dashboard.tsx`, `condition/Aging.tsx`

### E32-05 Links to replacement projects and funding awards

**Status:** done · **Priority:** P3 · **Type:** feature

A capital planner wants each aging asset linked to the project that replaces it and the award that funds it.

**Acceptance criteria**

- [x] Links to projects and to funding awards (`funded_by`)

**Implemented in:** `condition/service.ts` (`replacement_project_id` mirrored as the record link `replaced_by`, contract C7); the dashboard counts records past useful life with a replacement project and, while funding is on, those linked to an award with `funded_by` (sites cannot be linked to an award: `FUNDED_TYPES` in `funding/awards.ts`)

### E32-06 Not planned: maintenance work orders

**Status:** done · **Priority:** P3 · **Type:** feature

Not planned: maintenance work orders belong in a maintenance management system. They are already out of scope in E19 and are repeated here so that nobody builds them as part of asset condition.

**Implemented in:** nothing to build; recorded so that nobody builds it here (gap review GP-20)

### E32-07 Area and Asset manager role

**Status:** done · **Priority:** P2 · **Type:** feature

An administrator wants asset condition to be an optional part, and a ready-made role for the people who look after assets. Wave 11 (coordinator step 0 declared the `condition` area and the Asset manager role.)

**Acceptance criteria**

- [x] The `condition` area hides its record types and the condition fields on assets, vehicles and sites while off

**Implemented in:** step 0 (`core/features.ts`, `core/services.ts`), `server/src/modules/condition/condition.test.ts` ("switched off"); see the wave 11 report for the extra field names the area must list
- [x] The Asset manager role

### E32-08 Yearly target approval

**Status:** done · **Priority:** P3 · **Type:** feature

A capital planning lead wants each class's yearly target approved, or recorded against a meeting decision. Stretch for wave 11.

**Acceptance criteria**

- [x] Approval kind `condition_targets`, one step, `assets.approve`; a meeting decision reference may stand in

**Implemented in:** `server/src/modules/condition/targets.ts` (`defineApprovalKind` with the default workflow "Asset condition targets"; `POST /api/asset-classes/:id/targets/:year/approval`; direct approval with a decision reference, `POST .../approve`)

### E32-09 Sample data and guide

**Status:** done · **Priority:** P2 · **Type:** documentation

An evaluator wants invented asset classes, assessments and targets, and a guide page.

**Acceptance criteria**

- [x] Invented samples, labeled "[Sample]"
- [x] Guide page `31-asset-condition.md`; vehicle condition in the fleet guide

**Implemented in:** `server/src/modules/condition/seed.ts` (dev profile: nine classes, the sample estate's sites and every sample vehicle and farebox classed and assessed, targets for this year and last, three replacement projects), `docs/user/31-asset-condition.md`, `docs/user/19-fleet-and-services.md` ("Vehicle condition"), browser suite `tools/e2e/suites/14-condition.mjs`
