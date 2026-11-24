# E33 OT and rail-systems cybersecurity

**Status:** done (6 of 6 issues done)

## Goal

Describe operational technology (signaling, train control, supervisory control and fare systems) with the attributes that matter for its security, group it into zones and conduits with target security levels, and offer a starter structure for common control catalogs. Gap review GP-14.

## Scope notes

- Built in wave 11 (module `ot`, feature area `ot`, permissions shared with `systems`; restricted zones need `security.view`).
- No copyrighted standard text is shipped: only structure and cross-mappings that organizations fill from their own licensed copies. Security levels carry generic words of our own.
- No network scanning and no live asset discovery.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E33-01 | OT attributes on systems and assets | done | P2 |
| E33-02 | Zones and conduits with target and achieved security levels | done | P2 |
| E33-03 | Control catalog starter structure file | done | P3 |
| E33-04 | OT on the relationship map and in reports | done | P3 |
| E33-05 | Area and summary | done | P2 |
| E33-06 | Sample data and guide | done | P2 |

---

### E33-01 OT attributes on systems and assets

**Status:** done · **Priority:** P2 · **Type:** feature

An OT security lead wants control-system level, safety relevance, vendor remote access path, patchability and field location on each system.

**Acceptance criteria**

- [x] OT fields on systems and assets that the map and reports know
- [x] A person can only put a record in a security zone they can see (core checks only that a reference holds an id, so the `ot` module checks it on systems and assets)

**Implemented in:** `server/src/modules/inventory/fields-ot.ts`, `inventory/migrations/004_ot_fields.sql`, `server/src/modules/ot/zones.ts` (`guardZoneRefs`), `web/src/modules/ot/InventoryPanel.tsx` (the OT tab on a system and the OT section on an asset)

### E33-02 Zones and conduits with target and achieved security levels

**Status:** done · **Priority:** P2 · **Type:** feature

An OT security lead wants systems grouped into zones joined by conduits, each with a target and achieved security level.

**Acceptance criteria**

- [x] Zone and conduit records linked to systems
- [x] A zone below target (achieved lower than target, or not assessed) is shown as such; a conduit with remote access or touching such a zone is flagged
- [x] Restricted zones hidden without `security.view`; a conduit is restricted whenever either zone is, kept in step when a zone changes
- [x] Members, conduits, covering controls and actions (source `ot`) on the zone page

**Implemented in:** `server/src/modules/ot/` (`zones.ts`, `routes.ts`: `/api/ot-zones/:id/members`, `/api/ot/matrix`), `web/src/modules/ot/Zones.tsx`, `Conduits.tsx`

### E33-03 Control catalog starter structure file

**Status:** done · **Priority:** P3 · **Type:** feature

An OT security lead wants a mapping-file template to fill from a licensed standard.

**Acceptance criteria**

- [x] A published template with structure and framework cross-mapping only

**Implemented in:** `server/src/modules/frameworks/starters/ot-control-structure.template.json` (placeholders only; a test checks that the framework importer accepts it), `GET /api/frameworks/starters/ot-control-structure`, `web/src/modules/ot/StarterLink.tsx` (offered under Add framework from a file)

### E33-04 OT on the relationship map and in reports

**Status:** done · **Priority:** P3 · **Type:** feature

An OT security lead wants zones and OT attributes on the relationship map and in reports.

**Acceptance criteria**

- [x] Zones shown on the map; OT fields in the report builder
- [x] An OT badge on OT systems and assets; "Arrange systems by Zone" draws a box per zone the person may see

**Implemented in:** `server/src/modules/inventory/relations.ts` (`ot`, `zone`, `zone_name` in node attributes), `web/src/modules/inventory/MapCanvas.tsx`, `SystemMap.tsx`, `mapLayout.ts`; the report builder picks the fields and types up by itself (tested in `ot/ot.test.ts`)

### E33-05 Area and summary

**Status:** done · **Priority:** P2 · **Type:** feature

An administrator wants OT security to be an optional part, and its figures available to assistants. Wave 11 (coordinator step 0 declared the `ot` area.)

**Acceptance criteria**

- [x] The `ot` area hides zones, conduits and the OT fields on systems and assets while off
- [x] `GET /api/ot/summary` (figures only) and metric `ot.zones_below_target`

**Implemented in:** `server/src/modules/ot/routes.ts`, `web/src/modules/ot/Overview.tsx` (`/ot`)

### E33-06 Sample data and guide

**Status:** done · **Priority:** P2 · **Type:** documentation

An evaluator wants invented zones, conduits and OT systems, and a guide page.

**Acceptance criteria**

- [x] Invented samples, labeled "[Sample]"
- [x] Guide page `32-ot-security.md`

**Implemented in:** `server/src/modules/ot/seed.ts`, `docs/user/32-ot-security.md`, targeted edits to `03-inventory.md` and `05-cybersecurity-frameworks.md`, browser suite `tools/e2e/suites/15-ot.mjs`
