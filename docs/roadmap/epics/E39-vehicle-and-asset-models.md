# E39 Vehicle and asset models: shared specifications that members inherit

**Status:** done (7 of 7 issues done)

## Goal

Many vehicles and assets are copies of one another: a bus order of the same length, make and
equipment, or a station camera model installed in dozens of places. Each still has its own fleet
number, serial number and asset tag. A **model** holds what they share. Each vehicle or asset points
at its model and takes the shared values from it. Changing the model changes every member that has
not overridden that value, after showing how many records will change.

## Scope notes

- Two record types: **vehicle model** (fleet area, follows the Fleet and services switch) and **asset
  model** (inventory, always on). The name "model" is used because an asset's **Type** is already the
  kind of thing (laptop, AVL unit); a model is a particular specification of it.
- What a member inherits: for vehicles, mode, make, model name, model year, passenger capacity, asset
  class and funding source; for assets, type, make, model name, vendor, asset class, funding source and
  support end. Custom fields marked as inheritable are inherited too.
- A member may override an inherited value. An override stays until it is cleared, and is shown as
  such. Clearing it takes the model's value again.
- A vehicle model's **equipment** adds to the equipment its mode requires (Equipment coverage): the
  mode's list is the base, and the model adds kinds and counts on top ("2 cameras").
- Each vehicle and each piece of equipment keeps its own fleet number, serial number and tag. Models
  never create records by themselves; "New vehicle from this model" fills the form.
- Not planned here: maintenance schedules and parts (E32-06).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E39-01 | Vehicle model and asset model records | done | P2 |
| E39-02 | Members inherit the model's values, with overrides | done | P2 |
| E39-03 | Changing a model: preview, apply and audit | done | P2 |
| E39-04 | Equipment a vehicle model adds to its mode's required equipment | done | P2 |
| E39-05 | Assigning models: new from model, bulk assign, import | done | P2 |
| E39-06 | Inheritable custom fields | done | P3 |
| E39-07 | Guide, API, assistant tools, app and sample data | done | P2 |

### E39-01 Vehicle model and asset model records

**Status:** done · **Priority:** P2 · **Type:** feature

An administrator of the fleet or of assets wants one record that describes a kind of bus or a model of
equipment.

**Acceptance criteria**

- [x] Record types `vehicle_model` (fleet permissions, Fleet and services area) and `asset_model`
  (assets permissions), with a name, the shared fields listed in the scope notes, a description and an
  **Active** switch; lists, record pages, search, history, attachments and exports like other records
- [x] A **Members** tab lists the vehicles or assets using the model, with counts by status
- [x] A model with members cannot be deleted; an inactive model is not offered for new members
- [x] Switched off with Fleet and services, vehicle models appear nowhere but the switch

**Implemented in:** new module `server/src/modules/models/` (`index.ts`: record types `vehicle_model` and `asset_model`, the delete guard, `pickerWhere: 'active'` so record pickers leave inactive models out; migration `001_models.sql`); web `web/src/modules/inventory/models.tsx` (list, record page, Members tab with counts by status), `inventory/AssetModels.tsx`, `fleet/VehicleModels.tsx`, routes `/vehicle-models` (fleet module, so it follows the Fleet and services switch) and `/asset-models`. Core: `ResourceDef.pickerWhere` (`core/module.ts`, `core/routes.ts`). Tests `models/models.test.ts`, `admin/features-hidden.test.ts`.

### E39-02 Members inherit the model's values, with overrides

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] A vehicle or asset with a model shows each inherited field with "From model <name>"; editing it
  makes an override, shown as "Overridden" with **Use the model's value** to clear it
- [x] Stored values stay in the member's own columns (lists, filters, sorting, reports, exports and
  search keep working unchanged); which fields are overridden is kept per member
- [x] Choosing or changing a member's model fills the inherited fields that are not overridden; removing
  the model keeps the current values as the member's own
- [x] The API reads and writes the same way (`model_id`, an overrides list named `model_overrides`); rules and lifecycles of
  the member's type still apply to inherited values

**Implemented in:** `models/engine.ts` (`prepareMember`, wired as the members' `prepare` hook), member fields `fleet/fields-models.ts` and `inventory/fields-models.ts` with migrations `fleet/004_vehicle_models.sql` and `inventory/008_asset_models.sql` (`model_id`, `model_overrides`). Core: `ResourceDef.hooks.prepare` runs before validation on create and update (`core/resource.ts`), so lifecycles, lookups and the type's own hooks apply to inherited values. A field left empty on the model is not inherited. Web: "From model" (the model's name is in the note's tooltip and linked from the member's model field, rather than repeated beside every value) / "Overridden" with **Use the model's value** (`ModelNote`), through the new `annotate` prop of `EditableSummary` and `RecordPage`. Tests `models/models.test.ts`, `core/confirmSave.component.test.ts`.

### E39-03 Changing a model: preview, apply and audit

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] Saving a change to a model's inherited fields first shows how many members change and which
  members keep an override
- [x] The change is applied to every member without an override (each member on its own, not in one database transaction: see below), each member's
  history and audit records the change as coming from the model, and webhooks fire once per member
- [x] A member whose own rules refuse the new value (a lifecycle or validation) is listed and left
  unchanged rather than failing the whole change
- [x] Large models (thousands of members) are applied as a background job with progress

**Implemented in:** `models/engine.ts` (`previewChange`, `startChange`, `runChange`), routes `POST {model}/:id/preview`, `GET {model}/:id/changes[/:changeId]`, the model's `afterUpdate` hook (the answer carries `_model_change`), table `model_changes`, job types `fleet.model_apply` and `inventory.model_apply` above `models.background_after` (200) members. Core: `ResourceRegistry.update(..., { via })` ends the audit and history line with "from vehicle model ..."; web `ResourceForm`'s `confirmSave` shows the preview. Each member is saved through the normal update path on its own (rules, lifecycles, audit, history, one webhook each); they are **not** wrapped in one database transaction, because the update path runs on the shared database handle: a refusal leaves that member unchanged and listed, the others are saved. In a background job the lifecycle rules are checked as the person who saved the model, and the members are then saved as system work. Tests `models/models.test.ts` (preview, override kept, refusal listed, webhooks per member, background job).

### E39-04 Equipment a vehicle model adds to its mode's required equipment

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] A vehicle model lists kinds of equipment (asset types) with a count; this adds to the mode's
  required equipment (Equipment coverage), and a higher count raises the mode's count
- [x] The vehicle's **Equipment** tab and Equipment coverage show each requirement and where it comes
  from (mode or model), with Working, Not working and Missing per item, counting installed units
- [x] An equipment requirement may name an asset model; then only assets of that model count as working

**Implemented in:** `models/equipment.ts` (`mergeRequirements`, `assess`, `requirementsFor`, `GET/PUT /api/vehicle-models/:id/equipment`, table `vehicle_model_equipment`), used by `fleet/equipment.ts` (vehicle Equipment tab and `/api/fleet/coverage`, which now add `count`, `source`, units and `detail` per cell); web `fleet/Equipment.tsx`, `fleet/Coverage.tsx` ("1/2"), `fleet/VehicleModels.tsx` (the model's Equipment tab). Tests `models/models.test.ts`.

### E39-05 Assigning models: new from model, bulk assign, import

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] **New vehicle from this model** and **New asset from this model** open the form filled in
- [x] A list bulk action sets the model of the selected vehicles or assets, with the same preview as a
  model change (values that differ become overrides only when the person chooses to keep them)
- [x] Imports accept a model by name; a suggestion lists existing vehicles whose make, model name and
  year match a model

**Implemented in:** "New vehicle/asset from this model" (`useFromModel`, the list's `?new=1&model=<id>`); bulk **Set model** (`inventory/BulkActions.tsx`, `AssignDialog`; routes `POST {model}/:id/assign/preview` and `/assign`); suggestions `GET {model}/suggestions` (make and model name, and year for vehicles); imports resolve the model by name through the generic ref resolver, and `ResourceDef.filledBy` (core import, `ImportWizard`) lets a vehicle import with a model omit the Mode column. Web `ResourceList` reloads on `grc:list-changed`. Tests `models/models.test.ts`, browser suite `22-models`.

### E39-06 Inheritable custom fields

**Status:** done · **Priority:** P3 · **Type:** feature

**Acceptance criteria**

- [x] A custom field on vehicles or assets can be marked **Inherited from the model**; it then appears on
  the model and is inherited with overrides like the built-in fields

**Implemented in:** setting `models.inherited_custom` (`{ vehicle: [keys], asset: [keys] }`), `GET/PUT {model}/inherited-fields` (`admin.administer` to change), model values in `inherited_custom` (sent as `cf_<key>` on the model), the **Inherited custom fields** dialog on the model lists and card on the model page. The marking lives on the model lists, not on the Administration > Custom fields screen. Tests `models/models.test.ts`.

### E39-07 Guide, API, assistant tools, app and sample data

**Status:** done · **Priority:** P2 · **Type:** docs

**Acceptance criteria**

- [x] User guide pages for fleet (19) and inventory (03), the administration and features pages, and the
  API reference updated
- [x] The assistant (MCP) can read models and members; the mobile app shows a member's model on its
  record view
- [x] Sample data: a few vehicle models (with equipment) and asset models with members
- [x] Browser tests: create a model, assign members, change the model and see the members follow, an
  override kept, equipment coverage with model equipment, everything gone while Fleet is off

**Implemented in:** user guide `19-fleet-and-services.md` (Vehicle models), `03-inventory.md` (Asset models), `09-administration.md`, `31-asset-condition.md`; the assistant tools `vehicle_model_members` (offered only while Fleet and services is on) and `asset_model_members` (`mcp/tools-models.ts`; models themselves through the generic record tools; test `models/mcp.test.ts`); the app shows the model on a vehicle's and an asset's record view (`mobile/src/records/layouts.ts`, test `ModelField.test.tsx`; read-only); sample data `models/seed.ts` ("[Sample]" vehicle and asset models, equipment, one override, one inactive model); browser suite `tools/e2e/suites/22-models.mjs` and the fleet-off check in `09-features-off.mjs`. The API reference text is with the coordinator (shared file).
