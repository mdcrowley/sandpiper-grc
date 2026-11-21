# E19 Fleet and services

**Status:** done (14 of 14 issues done)

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
| E19-09 | `fleet` permission key and default role grants | done | P1 |
| E19-10 | Vehicles and services in the inventory impact panel and the relationship map | done | P2 |
| E19-11 | Affected services in the security incident workspace | done | P2 |
| E19-12 | A bus or vehicle icon | done | P3 |
| E19-13 | Vehicles and services in the pilot seed profile | done | P3 |
| E19-14 | Vehicles drawn on the relationship map | done | P3 |

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

**Status:** done · **Priority:** P1 · **Type:** feature

As an administrator, I can grant fleet permissions in the role editor. `fleet` was not in
`MODULE_KEYS` (`server/src/modules/admin/shared.ts`), so only `*` granted it.

**Acceptance criteria**

- [x] `fleet` added to `MODULE_KEYS` and to the developer guide's list
- [x] Default roles: Agent gets `fleet.*`; Security lead `fleet.view`; Auditor `fleet.view` (the Safety manager role also holds `fleet.view`). Existing installations receive the new grants through **Sync default grants** under Administration > Roles

**Implemented in:** `MODULE_KEYS` (`server/src/modules/admin/shared.ts`), `DEFAULT_ROLES` (`server/src/core/services.ts`); tests in `server/src/modules/fleet/fleet.test.ts` ("gives the default roles their fleet grants"); user guide [Fleet and services](../../user/19-fleet-and-services.md)

### E19-10 Vehicles and services in the inventory impact panel and the relationship map

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] The inventory web impact panel lists `vehicles` and `services` from the impact answer, counted in its summary, for people with `fleet.view`; affected services are outlined on the map, and a name not drawn on the map opens its record
- [x] Services as nodes on the relationship map: a **Services** lane (shown with **Show > Services**, always on a system's Map tab), tied to the systems they depend on, each line naming what the service needs the system for; discontinued services and services with no dependency are left out; nothing for people without `fleet.view`
- [ ] Vehicles as nodes on the map: not planned for now (dozens to thousands per operator); they are listed in the impact panel

**Implemented in:** `app.fleet.serviceDependencies(user)` (`server/src/modules/fleet/services.ts`); `buildGraph` in `server/src/modules/inventory/relations.ts` (node type `service`, edge kind `service`); `web/src/modules/inventory/MapPanel.tsx`, `mapLayout.ts`; tests in `fleet.test.ts`, `mapLayout.test.ts`

### E19-11 Affected services in the security incident workspace

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] The incident workspace embeds `AffectedPanel` for the incident's affected systems (the systems linked to the incident), on the **Affected** tab, sharing one request for the links with the links card so it follows as systems are linked and unlinked
- [x] Found by file name (`import.meta.glob`), so the incident module builds and works without fleet; nothing shown without `fleet.view`; the panel carries its own styles

**Implemented in:** `web/src/modules/secincidents/AffectedTab.tsx`, `secincidents.css`; `web/src/modules/fleet/AffectedPanel.tsx`

### E19-12 A bus or vehicle icon

**Status:** done · **Priority:** P3 · **Type:** design

**Acceptance criteria**

- [x] A vehicle icon in the core icon set, used for the Vehicles navigation entry
- [x] Also a route icon for Services; both used for the create menu entries, the coverage tile and the impact tiles

**Implemented in:** `bus` and `route` in `web/src/core/Icon.tsx` (Tabler `IconBus`, `IconRoute`); `web/src/modules/fleet/index.tsx`, `AffectedPanel.tsx`, `Coverage.tsx`, `Impact.tsx`

### E19-13 Vehicles and services in the pilot seed profile

**Status:** done · **Priority:** P3 · **Type:** feature

An organization loads its own vehicles and services when it sets up a pilot, as it does its
systems and sites, rather than only the invented fleet of the `dev` profile.

**Acceptance criteria**

- [x] Optional `vehicles.psv` and `services.psv` in the private seed folder, read by `seed --profile pilot`; a missing file is skipped and named
- [x] Rows matched by fleet number and by route, so a second run updates; an empty cell never clears a value; list values matched by value or label
- [x] Depots found by site name, and the systems a service depends on by system name (with an optional dependency in brackets); the inventory's own pilot files are loaded first so they can be named
- [x] A row that cannot be loaded is skipped and named with its line number; a depot or system not found is named
- [x] The columns documented in [Installation](../../installation.md#optional-import-files); tests with an invented temporary seed folder

**Implemented in:** `server/src/modules/fleet/seed-pilot.ts`, `seed.ts`; `seedPilotEstate` in `server/src/modules/inventory/seed.ts`; test `server/src/modules/fleet/seed-pilot.test.ts`; `docs/installation.md`; [user guide](../../user/19-fleet-and-services.md#sample-data)

### E19-14 Vehicles drawn on the relationship map

**Status:** done · **Priority:** P3 · **Type:** feature

Services can be drawn on the relationship map, and the impact panel lists the vehicles a
system supports, but vehicles themselves are not drawn on the map. Split from E19-10.

**Acceptance criteria**

- [x] Vehicles can be shown on the map (grouped by depot and mode, one node per group, so a large fleet stays readable), tied to the systems whose equipment they carry ("equipment on 12 of 40") and to their depot when it is on the map; for people with `fleet.view` and `assets.view` (equipment is asset information, as in the impact answer); never while the fleet area is switched off. Grouped by depot rather than service because vehicles are not assigned to services yet
- [x] The map picture (PNG, SVG) and the layout tests include them

**Implemented in:** `vehicleGroups` in `server/src/modules/fleet/services.ts` (the `app.fleet` read API); `buildGraph` in `server/src/modules/inventory/relations.ts`; `web/src/modules/inventory/mapLayout.ts` (type `vehicle`, gray, its own lane), `MapCanvas.tsx`; tests in `fleet.test.ts` and `mapLayout.test.ts`
