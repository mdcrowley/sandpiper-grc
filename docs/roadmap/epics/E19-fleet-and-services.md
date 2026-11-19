# E19 Fleet and services

**Status:** in progress (core built)

## Goal

Let a transit operator record its vehicles and the technology fitted to them, its services
(routes and lines) and the systems they depend on, so that it can see at a glance which
vehicles lack working equipment and which vehicles and services a system failure affects.

## Scope notes

- Module `fleet` (server `server/src/modules/fleet`, web `web/src/modules/fleet`), permission
  module `fleet`. Depots are inventory sites; equipment is inventory assets of on-vehicle types.
- Nothing is specific to one operator or country: modes, statuses, service types and
  dependency kinds are lookup lists; the equipment each mode needs is a setting.
- Vehicle blocks, daily assignments and maintenance work orders are out of scope (they belong
  in scheduling and fleet maintenance systems).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E19-01 | Vehicle records | done | P1 |
| E19-02 | Equipment installed on vehicles, with history | done | P1 |
| E19-03 | Equipment coverage view | done | P1 |
| E19-04 | Services and the systems they depend on | done | P1 |
| E19-05 | What is affected: vehicles and services | done | P1 |
| E19-06 | Read API and embed for other modules | done | P2 |
| E19-07 | Bulk import of vehicles | done | P2 |
| E19-08 | Invented sample fleet | done | P2 |
| E19-09 | `fleet` permission key and default role grants | open | P1 |
| E19-10 | Vehicles and services in the inventory impact panel and the relationship map | open | P2 |
| E19-11 | Affected services in the security incident workspace | open | P2 |
| E19-12 | A bus or vehicle icon | open | P3 |
| E19-13 | Vehicles and services in the pilot seed profile | open | P3 |

---

### E19-01 Vehicle records

**Status:** done · **Priority:** P1 · **Type:** feature

As a fleet or IT manager, I record each vehicle: fleet number, mode, status, make, model,
year, registration, depot, date in service, capacity and funding.

**Acceptance criteria**

- [x] Modes: bus, trolleybus, light rail, heavy rail, paratransit / demand-responsive, ferry (lookup `vehicle_mode`)
- [x] Statuses: in service, spare, in maintenance, out of service, retired (lookup `vehicle_status`; `meta.retired` marks retired)
- [x] Unique fleet number; four-digit model year; funder-interest percentage 0 to 100
- [x] Funding source and funder-interest flag reuse the asset fields' list and rule
- [x] A vehicle with equipment still installed cannot be retired (409 `equipment_installed`)
- [x] List with filters, saved views and export; record page with history

**Implemented in:** `server/src/modules/fleet/index.ts`, `migrations/001_fleet.sql`; `web/src/modules/fleet/Vehicles.tsx`; tests in `fleet.test.ts`

### E19-02 Equipment installed on vehicles, with history

**Status:** done · **Priority:** P1 · **Type:** feature

As a fleet engineer, I install equipment from the asset register on a vehicle and remove it,
and see every installation the vehicle and the asset have had.

**Acceptance criteria**

- [x] Install: asset, date (not in the future, default today), notes; one vehicle at a time per asset (409 `already_installed`)
- [x] Retired or disposed assets and retired vehicles are refused
- [x] Remove: date (not before installation), reason; kept as history
- [x] Audit events on both the vehicle and the asset
- [x] `GET /api/vehicles/:id/equipment`, `GET /api/assets/:id/installations`; needs `assets.view`

**Implemented in:** `server/src/modules/fleet/equipment.ts`; `web/src/modules/fleet/Equipment.tsx`

### E19-03 Equipment coverage view

**Status:** done · **Priority:** P1 · **Type:** feature

As a fleet manager, I see which vehicles lack working required equipment, for example buses
without a working onboard router or camera.

**Acceptance criteria**

- [x] Required equipment per mode is a setting (`fleet.required_equipment`), changed by `fleet.administer` on the page
- [x] Cells: working (asset in use), installed but not working, missing, not needed
- [x] Filters by mode, depot and status; "only vehicles with a gap"; totals per column and per vehicle
- [x] The vehicle page shows the same state for its own required equipment

**Implemented in:** `GET /api/fleet/coverage`, `GET/PUT /api/fleet/requirements` (`equipment.ts`); `web/src/modules/fleet/Coverage.tsx`

### E19-04 Services and the systems they depend on

**Status:** done · **Priority:** P1 · **Type:** feature

As a service planner, I record each route or line and the systems it needs to run.

**Acceptance criteria**

- [x] Route or line (unique), name, mode, service type (fixed route, express, demand-responsive, rail line), status, depot
- [x] Dependencies: system plus what it is needed for (CAD/AVL, fare collection, passenger information, scheduling, radio, other), audited on both records
- [x] Needs `systems.view` to list or change dependencies

**Implemented in:** `server/src/modules/fleet/services.ts`; `web/src/modules/fleet/Services.tsx`

### E19-05 What is affected: vehicles and services

**Status:** done · **Priority:** P1 · **Type:** feature

As a controller, when a system fails I see the vehicles carrying its equipment and the
services depending on it, optionally through the systems it feeds.

**Acceptance criteria**

- [x] `GET /api/fleet/impact?system_id=&downstream=` follows recorded integrations downstream
- [x] Retired vehicles and discontinued services are left out
- [x] The inventory impact answer (`GET /api/systems/:id/impact`) includes `vehicles`, `services` and their counts when fleet is loaded and the caller holds `fleet.view`
- [x] Vehicles are named only to people who may see assets

**Implemented in:** `services.ts`; `server/src/modules/inventory/relations.ts`; `web/src/modules/fleet/Impact.tsx`

### E19-06 Read API and embed for other modules

**Status:** done · **Priority:** P2 · **Type:** feature

As a module author, I can name the vehicles and services a set of systems affects.

**Acceptance criteria**

- [x] Decorator `app.fleet.affected(systemIds, user)` (guard with `app.hasDecorator('fleet')`)
- [x] `GET /api/fleet/affected?system_ids=` and `GET /api/systems/:id/services`
- [x] Web: `web/src/modules/fleet/AffectedPanel.tsx` (`<AffectedPanel systemIds={[...]} />`), rendering nothing without `fleet.view`

### E19-07 Bulk import of vehicles

**Status:** done · **Priority:** P2 · **Type:** feature

As an administrator, I load the fleet from a spreadsheet.

**Acceptance criteria**

- [x] Uses the core import service and wizard (`/api/import/vehicle`), matched by fleet number for updates
- [x] Depots matched by site name; vehicle rules apply to every row
- [x] Test proves create, update and a refused row

### E19-08 Invented sample fleet

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] Dev profile: 40 buses at two depots, 8 light-rail vehicles, equipment from the inventory sample systems, deliberate gaps, one removal in the history, 12 services with dependencies
- [x] Idempotent; loads the inventory sample estate first when needed

**Implemented in:** `server/src/modules/fleet/seed.ts`

### E19-09 `fleet` permission key and default role grants

**Status:** open · **Priority:** P1 · **Type:** feature

As an administrator, I can grant fleet permissions in the role editor. Today `fleet` is not in
`MODULE_KEYS` (`server/src/modules/admin/shared.ts`), so only `*` grants it.

**Acceptance criteria**

- [ ] `fleet` added to `MODULE_KEYS` and to the developer guide's list
- [ ] Default roles: Agent gets `fleet.*`; Security lead `fleet.view`; Auditor `fleet.view`

### E19-10 Vehicles and services in the inventory impact panel and the relationship map

**Status:** open · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [ ] The inventory web impact panel lists `vehicles` and `services` from the impact answer
- [ ] Optionally, services as nodes on the relationship map

### E19-11 Affected services in the security incident workspace

**Status:** open · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [ ] The incident workspace embeds `AffectedPanel` for the incident's affected systems

### E19-12 A bus or vehicle icon

**Status:** open · **Priority:** P3 · **Type:** design

**Acceptance criteria**

- [ ] A vehicle icon in the core icon set, used for the Vehicles navigation entry

### E19-13 Vehicles and services in the pilot seed profile

**Status:** open · **Priority:** P3 · **Type:** feature

**Acceptance criteria**

- [ ] Optional `vehicles.psv` and `services.psv` in the private seed folder
