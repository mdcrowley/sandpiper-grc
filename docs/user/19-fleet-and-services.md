# Fleet and services

The fleet pages record the vehicles you run, the equipment fitted to each one, the services (routes and lines) you operate and the systems each service needs. Together they answer two everyday questions: which vehicles are missing working equipment, and which vehicles and services are affected when a system fails. Open them from the **Inventory** group: **Vehicles**, **Vehicle models**, **Services**, **Equipment coverage** and **What is affected**. The five pages share tabs along the top, so you can move between them directly. Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not manage vehicles here, an administrator can switch **Fleet and services** off under **Administration > Features** (see [Administration](09-administration.md#features)). Vehicles, vehicle models and services then disappear everywhere, including the impact panels on system pages, the relationship map and the **Affected** tab of security incidents. Records are kept and return when it is switched back on.

You need the **fleet** permissions to see these pages (`fleet.view`, and `fleet.create`, `fleet.edit`, `fleet.delete`, `fleet.export` to change and export; `fleet.administer` for the required equipment). Equipment is made of assets, so working with it also needs permission to see assets; **What is affected** needs permission to see systems.

Of the default roles, **Agent** holds every fleet permission; **Security lead**, **Safety manager** and **Auditor** can read the fleet pages (`fleet.view`). An administrator can grant the fleet permissions to any other role under **Administration > Roles**.

## Vehicles

Open **Vehicles**. The list shows each vehicle's **Fleet number**, **Mode**, **Status**, **Depot or garage**, **Make**, **Model** and **Model year**; the **Vehicle model** column can be turned on with the column chooser. Filter by mode, status, depot, vehicle model, funding source, funder interest or the date it entered service.

### Add a vehicle

1. Select **New vehicle**, or **Create** then **Vehicle**.
2. Enter the **Fleet number** (it must be unique). If the vehicle is one of a kind you have recorded as a [vehicle model](#vehicle-models), choose it under **Vehicle model**; it is quicker to start from the model's page with **New vehicle from this model**, which fills in the form. Choose the **Mode**: **Bus**, **Trolleybus**, **Light rail**, **Heavy rail**, **Paratransit / demand-responsive** or **Ferry**.
3. Choose the **Status**: **In service**, **Spare**, **In maintenance**, **Out of service** or **Retired**.
4. Choose the **Depot or garage** (a site from the inventory), and enter the **Make**, **Model**, **Model year** (four digits), **Registration or vehicle number**, **In service since** and **Passenger capacity** if you know them.
5. If an outside funder paid for part of the vehicle, choose the **Funding source**, check **Funder interest** and enter the **Funder interest (%)**, as for assets.
6. Select **Create vehicle**.

A vehicle that still has equipment installed cannot be set to **Retired**: remove the equipment first. An administrator can limit which status changes are allowed, and what each needs, under **Administration > Lifecycles**; see [Lifecycles](23-lifecycles.md). The rule about equipment always applies as well.

### Import vehicles

Select **Import** on the vehicle list and follow the import screen (see [Importing and exporting](17-importing-and-exporting.md#importing-records)). To update vehicles you already have, choose **Update existing records only** (or **Update existing records and create the rest**) and pick **Fleet number** under **Find existing records by**. A depot is matched by the site's name, a vehicle model by its name, and a mode or status by its value or its label (for example "Bus"). A file with a **Vehicle model** column needs no **Mode** column: each new vehicle takes the model's mode and other shared values, and a value given in the file that differs from the model's is kept as that vehicle's own. Every row is checked by the same rules as a vehicle added by hand.

### The vehicle record

The **Details** card holds the facts above; select **Edit** to change them. When the vehicle has a **Vehicle model**, each value it takes from the model says **From model** under it, and a value the vehicle keeps as its own says **Overridden** (see [Vehicle models](#vehicle-models)). The **Equipment** tab shows:

- **Required equipment**: each kind of equipment this vehicle should carry (what its mode requires and what its vehicle model adds, with how many and where each requirement comes from), marked **Working**, **Not working** (installed, but the asset's status is not **In use**, for example **In repair**) or **Missing**. The card's heading says how many gaps there are, or **Fully equipped**.
- **Installed now**: the equipment on the vehicle, with its type, the asset's status and when it was installed.
- **Earlier installations**: equipment that has been removed, with when and why.

Where safety management is in use, a **Safety events** tab lists the safety events recorded against the vehicle.

### Vehicle condition

Where asset condition is in use, a **Condition** tab shows the vehicle's **Asset class**, its latest **Condition** and when it was assessed, the **End of useful life** (marked **Past useful life** once it has passed), its **Odometer** and the day it was read, and its **Replacement project**, with every condition assessment, newest first. Select **Edit condition details** to choose the class, enter the odometer or name the replacement project, and **Record assessment** to rate the vehicle. The end of useful life counts from **In service since** (or the **Model year**) and the class's years, or the day the vehicle reaches the class's miles at the rate it has run so far, whichever comes first. Retired vehicles are left out of the condition figures. The vehicle list can show the class, condition, end of useful life and odometer as columns, and filter by them. See [Asset condition](31-asset-condition.md).

### Install equipment

1. Open the vehicle and its **Equipment** tab.
2. Select **Install equipment**.
3. In **Equipment (asset)**, search the asset register by tag or name and choose the item.
4. Enter **Installed on** (leave it empty for today; it cannot be in the future) and any **Notes**.
5. Select **Install**.

A piece of equipment can be on only one vehicle at a time: if it is on another vehicle, remove it there first. Retired and disposed assets cannot be installed, and nothing can be installed on a retired vehicle.

### Remove equipment

Select **Remove** beside the item under **Installed now**, enter **Removed on** (leave it empty for today; it cannot be before the installation date) and a **Reason**, and select **Remove**. The installation moves to **Earlier installations**; the asset itself is not changed. Both the vehicle's and the asset's history record each installation and removal.

## Vehicle models

Many vehicles are copies of one another: a bus order of the same length, make and equipment. A **vehicle model** holds what they share. Each vehicle still has its own fleet number, registration and tag; it points at its model and takes the shared values from it. Open **Vehicle models**.

A vehicle model has a **Name**, and the values its vehicles share: **Mode**, **Make**, **Model**, **Model year**, **Passenger capacity**, **Asset class** (where asset condition is in use) and **Funding source**, plus a **Description** and an **Active** switch. Custom fields of vehicles that an administrator marks as inherited appear on the model too (see [Inherited custom fields](#inherited-custom-fields)). A field left empty on the model is not shared: each vehicle keeps its own value. Add a model with **New vehicle model**, or **Create** then **Vehicle model**.

### Give vehicles a model

- **One new vehicle**: open the model and select **New vehicle from this model**. The new vehicle form opens with the model's values filled in.
- **One existing vehicle**: edit the vehicle and choose its **Vehicle model**. The shared values are filled in from the model, except those the vehicle keeps as its own.
- **Many vehicles**: on the vehicle list, select the vehicles, then **Set model** in the bar that appears. Choose the model: the dialog shows how many of the selected vehicles already have it and, for each shared value, how many vehicles have a different one (with examples). Every vehicle takes the model's values unless you check **Keep their own** for a value; a value kept this way becomes that vehicle's override. Select **Give the model to ... vehicles**. Any vehicle whose own rules refuse the change is listed and left as it was.
- **Suggestions**: the vehicle model list says when existing vehicles with no model match a model by make, model name and (when the model has one) model year. Select **Review and assign** to open the same dialog for them.
- **Import**: a **Vehicle model** column in an import file names the model (see [Import vehicles](#import-vehicles)).

An inactive model is not offered for new vehicles; vehicles that already have it keep it. A model that still has vehicles cannot be deleted, or removed for good at the end of its retention period: give them another model, or make it inactive. A vehicle model removed for good takes its equipment list with it. If a vehicle's model is gone anyway (a vehicle given the model at the moment it was deleted), the vehicle keeps its values as its own and has no model.

### Overrides

On a vehicle with a model, a shared value marked **From model** follows the model. Editing that value on the vehicle makes it an **override**: the vehicle keeps its own value whatever happens to the model, and the value is marked **Overridden**. Select **Use the model's value** beside it to clear the override; the vehicle then takes the model's value again. Typing the model's own value is not an override. Removing the vehicle's model keeps its current values as its own.

### Change a model

Edit the model's **Details** and save. When the change reaches vehicles, a dialog first says how many of the model's vehicles take the new values, how many keep their own value (an override) for each field that changes, and which ones. Select **Save and apply**, or **Cancel** to change nothing.

Each vehicle is then saved through the usual rules, so its lifecycle rules and checks still apply, and its **History** (and the audit log) says the change came from the model, for example "Vehicle updated: 1205 (Make) from vehicle model [Sample] Citystrider 12 diesel bus". Webhooks are sent for each vehicle that changed. A vehicle whose own rules refuse the new value is left unchanged and listed in a notice on the model's page; it takes the value at its next save unless you keep its value as an override. A change that reaches more than 200 vehicles runs in the background: the model's page shows its progress until it is done. The background change saves each vehicle as you, so your name is in each vehicle's **History** and your rules apply. It stops, and the model's page says why, if your account is disabled or you can no longer edit Fleet and services before it is finished, or if Fleet and services is switched off before it runs; save the model again to apply it. A model has one background change at a time: saving the model again while a change is still waiting replaces it (shown as **Replaced by a newer change** under **Model changes**), and the newer change applies both. A change saved with an access token (through the API) is applied in the background within that token's permissions, and stops if the token is revoked first.

The model's tabs:

- **Vehicles**: how many vehicles use the model by status, which shared values some of them keep as their own, and the vehicles themselves.
- **Equipment**: what the model adds to the equipment its vehicles' mode requires (see below).
- **Model changes**: every change applied to the vehicles and every time the model was given to vehicles: when, by whom, which fields, how many changed, how many kept their own value, and which refused.

### Equipment a model adds

The equipment a mode requires (set under [Required equipment](#required-equipment)) is the base for every vehicle of that mode. A vehicle model can add to it on its **Equipment** tab: select **Edit**, then for each row choose the **Kind of equipment** (an asset type) and **How many**, and optionally an **Asset model**. Select **Save**.

- A kind the mode does not require is added for the model's vehicles.
- A kind the mode requires with a higher count raises the count ("2 cameras" where the mode asks for one).
- With an asset model named, only equipment of that asset model counts as working; other equipment of that kind counts as installed but not working.

Naming an asset model needs permission to see assets. Someone with Fleet and services access only does not see the **Equipment** tab; through the API they see that a row names an asset model, but not which one, and saving the list keeps it.

The vehicle's **Equipment** tab and **Equipment coverage** then show each requirement with where it comes from (**Required for the mode**, **Added by the vehicle model**, or the mode's with the count set by the model) and, for a count above one, how many units are working, not working and missing.

### Inherited custom fields

An administrator selects **Inherited custom fields** on the vehicle model list and checks the custom fields of vehicles that should come from the model. Each checked field then appears on every vehicle model (in the **Inherited custom fields** card, changed with **Edit**) and is inherited with overrides like the built-in shared values. A value on the model is checked as it would be on a vehicle (a number must be a number, a choice must be on its list), and a reference must name a record you can see. See [Administration](09-administration.md#custom-fields).

## Equipment coverage

Open **Equipment coverage**. The tiles count the vehicles (retired ones are left out), those **Fully equipped** and those **With a gap**. The table has one row per vehicle and one column for each kind of equipment a mode or a vehicle model needs, with a key above it:

| Mark | Meaning |
|---|---|
| Check mark | **Working**: equipment of that kind is installed and in use |
| Exclamation mark | **Installed, not working**: installed, but the asset is in repair or otherwise not in use |
| Cross | **Missing**: nothing of that kind is installed |
| Dash | **Not needed for this mode or model** |
| 1/2 | Where a vehicle model asks for more than one: working units out of the count |

Each column heading says how many gaps it has, and the **Gaps** column counts them for each vehicle. Filter by **Mode** or **Depot or garage**, or switch on **Only vehicles with a gap**, for example to find every bus without a working on-vehicle router or camera. Select a fleet number to open that vehicle's equipment. The table shows 200 vehicles at a time, with page numbers under it for a larger fleet; the tiles and the column headings count every vehicle that matches the filters.

### Required equipment

People with `fleet.administer` (the **Administrator** and **Agent** roles by default) select **Required equipment** to check the kinds of equipment each mode should carry, and **Save**. The kinds are the asset types of the inventory, so a new type added under **Administration > Lists** appears here too.

## Services

Open **Services**. A service is a route or line: its **Route or line** (for example "12" or "LR-A", unique), **Name**, **Mode**, **Service type** (**Fixed route**, **Express**, **Demand-responsive**, **Rail line** or **Other**), **Status** (**Running**, **Planned**, **Suspended** or **Discontinued**) and **Depot or garage**. Add one with **New service**, or **Create** then **Service**.

### Systems a service depends on

Open the service; its **Systems** tab lists **Systems this service depends on**.

1. Select **Add system**.
2. Choose the **System** and what it is **Needed for**: **CAD/AVL**, **Fare collection**, **Passenger information**, **Scheduling**, **Radio** or **Other**. Add **Notes** if useful.
3. Select **Add system**.

Select **Remove** beside a system, then confirm, to take it off. Each change is recorded in the history of both the service and the system. A **Safety events** tab appears where safety management is in use.

## What is affected

Open **What is affected**, choose the **System that has failed** (for example the CAD/AVL system or the onboard video system), and the page lists:

- **Services affected**: services that depend on the system, with their mode and what they need it for. Discontinued services are left out.
- **Vehicles affected**: vehicles that carry equipment belonging to the system, with their mode, depot and how many pieces of its equipment they carry. Retired vehicles are left out.

Switch on **Include systems it feeds** to follow the recorded integrations downstream, as the relationship map does: the **Systems reached** card then lists every system the failure reaches and how many steps away it is, and the vehicles and services of all of them are counted. The tiles always count everything affected; for a system whose failure reaches more than 500 vehicles, services or systems, the lists show the first 500 of each and a note says so. The same answer is part of the system's own impact view in the inventory: select a system on the relationship map, or open its **Map** tab, and **If this fails** lists the **Services** and **Vehicles** too (see [Inventory](03-inventory.md)).

## Elsewhere in the application

- **Relationship map**: services that depend on at least one system can be drawn on the map, in their own lane, tied to the systems they need (select **Services** under **Show**). Each line says what the service needs the system for.
- **Vehicles on the relationship map**: select **Vehicles** under **Show**. So that a fleet of hundreds stays readable, vehicles are drawn in groups, one box per depot and mode, for example "Bus ×40 · Example Depot North" (a group with no depot says "no depot"). A group is drawn when its vehicles carry equipment of a system on the map; the line from the system says on how many of the group's vehicles that equipment is installed ("equipment on 12 of 40"), and a line joins the group to its depot when the depot is on the map. Retired vehicles are left out. Select a group to see its connections; its link opens the vehicle list filtered to that depot and mode. Vehicle groups are included when you save the map as a picture (PNG or SVG). They are shown to people whose roles include **View** on fleet and on assets (equipment is asset information, as in the impact answer), and not at all while **Fleet and services** is switched off.
- **Security incidents**: the **Affected** tab of an incident lists the services and vehicles reached by the systems linked to the incident (see [Security incidents](07-security-incidents.md)).
- **Safety events** name the vehicle and route involved; see [Safety management](20-safety-management.md).

The answer is only as good as the equipment installed on vehicles and the dependencies recorded on services.

## Sample data

The `dev` sample profile loads an invented operator: 40 buses at two depots and 8 light-rail vehicles at the rail yard, each with its equipment, a few deliberate gaps, one replaced router in the history of bus 1203, and twelve services with the systems they depend on. Every vehicle has one of four sample vehicle models (one of which adds a second camera and a passenger information display, so its two buses show gaps), bus 1205 keeps its own passenger capacity as an override, and a fifth model is inactive.

When the application is set up, the person installing it can load your own vehicles and services from two files in the private seed folder, `vehicles.psv` and `services.psv` (the `pilot` profile; their columns are described in the installation guide). Running it again updates the vehicles and services by fleet number and route rather than adding them twice. After set-up, use **Import** on the lists instead.

## Not available yet

- Vehicle blocks and daily assignments of vehicles to services.
- Individual vehicles on the relationship map: they are drawn as groups by depot and mode. Open a group's vehicle list to see each one.
- Mileage logs, inspections and maintenance work orders; these belong in a fleet maintenance system. Only the latest odometer reading is kept, for the useful life.
- Maintenance schedules and parts on a vehicle model (planned separately, E32-06). A model never creates vehicles by itself.
