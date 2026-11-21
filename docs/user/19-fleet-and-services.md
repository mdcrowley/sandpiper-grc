# Fleet and services

The fleet pages record the vehicles you run, the equipment fitted to each one, the services (routes and lines) you operate and the systems each service needs. Together they answer two everyday questions: which vehicles are missing working equipment, and which vehicles and services are affected when a system fails. Open them from the **Inventory** group: **Vehicles**, **Services**, **Equipment coverage** and **What is affected**. The four pages share tabs along the top, so you can move between them directly. Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not manage vehicles here, an administrator can switch **Fleet and services** off under **Administration > Features** (see [Administration](09-administration.md#features)). Vehicles and services then disappear everywhere, including the impact panels on system pages, the relationship map and the **Affected** tab of security incidents. Records are kept and return when it is switched back on.

You need the **fleet** permissions to see these pages (`fleet.view`, and `fleet.create`, `fleet.edit`, `fleet.delete`, `fleet.export` to change and export). Equipment is made of assets, so working with it also needs permission to see assets; **What is affected** needs permission to see systems.

Of the default roles, **Agent** holds every fleet permission; **Security lead**, **Safety manager** and **Auditor** can read the fleet pages (`fleet.view`). An administrator can grant the fleet permissions to any other role under **Administration > Roles**.

## Vehicles

Open **Vehicles**. The list shows each vehicle's **Fleet number**, **Mode**, **Status**, **Depot or garage**, **Make**, **Model** and **Model year**. Filter by mode, status, depot, funding source, funder interest or the date it entered service.

### Add a vehicle

1. Select **New vehicle**, or **Create** then **Vehicle**.
2. Enter the **Fleet number** (it must be unique) and choose the **Mode**: **Bus**, **Trolleybus**, **Light rail**, **Heavy rail**, **Paratransit / demand-responsive** or **Ferry**.
3. Choose the **Status**: **In service**, **Spare**, **In maintenance**, **Out of service** or **Retired**.
4. Choose the **Depot or garage** (a site from the inventory), and enter the **Make**, **Model**, **Model year** (four digits), **Registration or vehicle number**, **In service since** and **Passenger capacity** if you know them.
5. If an outside funder paid for part of the vehicle, choose the **Funding source**, check **Funder interest** and enter the **Funder interest (%)**, as for assets.
6. Select **Create vehicle**.

A vehicle that still has equipment installed cannot be set to **Retired**: remove the equipment first. An administrator can limit which status changes are allowed, and what each needs, under **Administration > Lifecycles**; see [Lifecycles](23-lifecycles.md). The rule about equipment always applies as well.

### Import vehicles

Select **Import** on the vehicle list and follow the import screen (see [Importing and exporting](17-importing-and-exporting.md#importing-records)). To update vehicles you already have, choose **Update existing records only** (or **Update existing records and create the rest**) and pick **Fleet number** under **Find existing records by**. A depot is matched by the site's name, and a mode or status by its value or its label (for example "Bus"). Every row is checked by the same rules as a vehicle added by hand.

### The vehicle record

The **Details** card holds the facts above; select **Edit** to change them. The **Equipment** tab shows:

- **Required equipment**: each kind of equipment this mode of vehicle should carry, marked **Working**, **Not working** (installed, but the asset's status is not **In use**, for example **In repair**) or **Missing**. The card's heading says how many gaps there are, or **Fully equipped**.
- **Installed now**: the equipment on the vehicle, with its type, the asset's status and when it was installed.
- **Earlier installations**: equipment that has been removed, with when and why.

Where safety management is in use, a **Safety events** tab lists the safety events recorded against the vehicle.

### Install equipment

1. Open the vehicle and its **Equipment** tab.
2. Select **Install equipment**.
3. In **Equipment (asset)**, search the asset register by tag or name and choose the item.
4. Enter **Installed on** (leave it empty for today; it cannot be in the future) and any **Notes**.
5. Select **Install**.

A piece of equipment can be on only one vehicle at a time: if it is on another vehicle, remove it there first. Retired and disposed assets cannot be installed, and nothing can be installed on a retired vehicle.

### Remove equipment

Select **Remove** beside the item under **Installed now**, enter **Removed on** (leave it empty for today; it cannot be before the installation date) and a **Reason**, and select **Remove**. The installation moves to **Earlier installations**; the asset itself is not changed. Both the vehicle's and the asset's history record each installation and removal.

## Equipment coverage

Open **Equipment coverage**. The tiles count the vehicles (retired ones are left out), those **Fully equipped** and those **With a gap**. The table has one row per vehicle and one column for each kind of equipment a mode needs, with a key above it:

| Mark | Meaning |
|---|---|
| Check mark | **Working**: equipment of that kind is installed and in use |
| Exclamation mark | **Installed, not working**: installed, but the asset is in repair or otherwise not in use |
| Cross | **Missing**: nothing of that kind is installed |
| Dash | **Not needed for this mode** |

Each column heading says how many gaps it has, and the **Gaps** column counts them for each vehicle. Filter by **Mode** or **Depot or garage**, or switch on **Only vehicles with a gap**, for example to find every bus without a working on-vehicle router or camera. Select a fleet number to open that vehicle's equipment.

### Required equipment

Administrators (`fleet.administer`) select **Required equipment** to check the kinds of equipment each mode should carry, and **Save**. The kinds are the asset types of the inventory, so a new type added under **Administration > Lists** appears here too.

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

Switch on **Include systems it feeds** to follow the recorded integrations downstream, as the relationship map does: the **Systems reached** card then lists every system the failure reaches and how many steps away it is, and the vehicles and services of all of them are counted. The same answer is part of the system's own impact view in the inventory: select a system on the relationship map, or open its **Map** tab, and **If this fails** lists the **Services** and **Vehicles** too (see [Inventory](03-inventory.md)).

## Elsewhere in the application

- **Relationship map**: services that depend on at least one system can be drawn on the map, in their own lane, tied to the systems they need (select **Services** under **Show**). Each line says what the service needs the system for.
- **Vehicles on the relationship map**: select **Vehicles** under **Show**. So that a fleet of hundreds stays readable, vehicles are drawn in groups, one box per depot and mode, for example "Bus ×40 · Example Depot North" (a group with no depot says "no depot"). A group is drawn when its vehicles carry equipment of a system on the map; the line from the system says on how many of the group's vehicles that equipment is installed ("equipment on 12 of 40"), and a line joins the group to its depot when the depot is on the map. Retired vehicles are left out. Select a group to see its connections; its link opens the vehicle list filtered to that depot and mode. Vehicle groups are included when you save the map as a picture (PNG or SVG). They are shown to people whose roles include **View** on fleet and on assets (equipment is asset information, as in the impact answer), and not at all while **Fleet and services** is switched off.
- **Security incidents**: the **Affected** tab of an incident lists the services and vehicles reached by the systems linked to the incident (see [Security incidents](07-security-incidents.md)).
- **Safety events** name the vehicle and route involved; see [Safety management](20-safety-management.md).

The answer is only as good as the equipment installed on vehicles and the dependencies recorded on services.

## Sample data

The `dev` sample profile loads an invented operator: 40 buses at two depots and 8 light-rail vehicles at the rail yard, each with its equipment, a few deliberate gaps, one replaced router in the history of bus 1203, and twelve services with the systems they depend on.

When the application is set up, the person installing it can load your own vehicles and services from two files in the private seed folder, `vehicles.psv` and `services.psv` (the `pilot` profile; their columns are described in the installation guide). Running it again updates the vehicles and services by fleet number and route rather than adding them twice. After set-up, use **Import** on the lists instead.

## Not available yet

- Vehicle blocks and daily assignments of vehicles to services.
- Individual vehicles on the relationship map: they are drawn as groups by depot and mode. Open a group's vehicle list to see each one.
- Vehicle mileage, inspections and maintenance work orders; these belong in a fleet maintenance system.
