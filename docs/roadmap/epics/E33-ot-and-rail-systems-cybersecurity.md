# E33 OT and rail-systems cybersecurity

**Status:** open (0 of 6 issues done)

## Goal

Describe operational technology (signaling, train control, supervisory control and fare systems) with the attributes that matter for its security, group it into zones and conduits with target security levels, and offer a starter structure for common control catalogs. Gap review GP-14.

## Scope notes

- Planned for wave 11.
- No copyrighted standard text is shipped: only structure and cross-mappings that organizations fill from their own licensed copies.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E33-01 | OT attributes on systems and assets | open | P2 |
| E33-02 | Zones and conduits with target and achieved security levels | open | P2 |
| E33-03 | Control catalog starter structure file | open | P3 |
| E33-04 | OT on the relationship map and in reports | open | P3 |
| E33-05 | Area and summary | open | P2 |
| E33-06 | Sample data and guide | open | P2 |

---

### E33-01 OT attributes on systems and assets

**Status:** open · **Priority:** P2 · **Type:** feature

An OT security lead wants control-system level, safety relevance, vendor remote access path, patchability and field location on each system.

**Acceptance criteria**

- [ ] OT fields on systems and assets that the map and reports know

### E33-02 Zones and conduits with target and achieved security levels

**Status:** open · **Priority:** P2 · **Type:** feature

An OT security lead wants systems grouped into zones joined by conduits, each with a target and achieved security level.

**Acceptance criteria**

- [ ] Zone and conduit records linked to systems

### E33-03 Control catalog starter structure file

**Status:** open · **Priority:** P3 · **Type:** feature

An OT security lead wants a mapping-file template to fill from a licensed standard.

**Acceptance criteria**

- [ ] A published template with structure and framework cross-mapping only

### E33-04 OT on the relationship map and in reports

**Status:** open · **Priority:** P3 · **Type:** feature

An OT security lead wants zones and OT attributes on the relationship map and in reports.

**Acceptance criteria**

- [ ] Zones shown on the map; OT fields in the report builder

### E33-05 Area and summary

**Status:** open · **Priority:** P2 · **Type:** feature

An administrator wants OT security to be an optional part, and its figures available to assistants. Wave 11 (coordinator step 0 declared the `ot` area.)

**Acceptance criteria**

- [ ] The `ot` area hides zones, conduits and the OT fields on systems and assets while off
- [ ] `GET /api/ot/summary` (figures only) and metric `ot.zones_below_target`

### E33-06 Sample data and guide

**Status:** open · **Priority:** P2 · **Type:** documentation

An evaluator wants invented zones, conduits and OT systems, and a guide page.

**Acceptance criteria**

- [ ] Invented samples, labeled "(sample)"
- [ ] Guide page `32-ot-security.md`
