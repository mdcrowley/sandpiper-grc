# OT security

Operational technology (OT) is the equipment and software that runs the service itself: signaling and train control, traction power supervision, station systems such as public address and passenger information, the radio core, and the fare collection back office. Its security needs are different from office IT: much of it cannot be patched at will, some of it is safety-related, and vendors often need remote access to support it.

The OT security pages let you mark which systems and assets are OT and record what matters for their security, group them into **security zones** joined by **conduits**, each with the security level it should reach and the level it has reached, and see at a glance where you fall short. Lists and record pages work as described in [Getting started](01-getting-started.md).

Open the pages from the **Cybersecurity** group in the navigation: **OT security** (the overview) and **Security zones**. The pages share tabs along the top: **Overview**, **Security zones** and **Conduits**.

If your organization does not use them, an administrator can switch **OT and rail-systems security** off under **Administration > Features** (see [Administration](09-administration.md#features)). The pages, the zones and conduits, the OT fields on systems and assets, the OT mark and zones on the relationship map and the starter structure file then disappear everywhere. Nothing is deleted: everything returns as it was when the part is switched back on.

The application does not scan networks or discover devices: everything here is recorded by people.

## What you need

OT security uses the **systems** permissions: `systems.view` to read, `systems.create`, `systems.edit` and `systems.delete` to keep zones and conduits and to record the OT details of a system, and `systems.export` to export. The OT details of an asset follow the **assets** permissions. Zones marked restricted, and every conduit touching one, also need `security.view` (see below).

The default **Agent** and **Security lead** roles hold the systems permissions; only the **Security lead** also sees restricted zones.

## OT details on systems and assets

A system's page has an **OT** tab, and an asset's page an **Operational technology (OT)** section under its details. Select **Edit** to record:

| Field | What it means |
|---|---|
| **Operational technology (OT)** | Check it for OT. Only checked records count as OT on the overview. |
| **Control level** | Where the system sits, from **0 Field devices** (sensors, actuators), **1 Basic control** (controllers), **2 Supervisory control**, **3 Site operations**, up to **4 Business systems**. |
| **Life-critical** | The system or asset plays a part in keeping people safe. |
| **Security zone** | The zone it belongs to (see below). You can only choose a zone you can see. |
| **Supplier remote access** (systems) | **None**, **Supervised session on request**, **On demand through a managed gateway**, **Always connected** or **Not known**. |
| **Remote access path** (systems) | How the vendor gets in, in your own words, for example "jump host with recorded sessions". |
| **Patching** (systems) | **Patched routinely**, **Supplier-approved patches only**, **Patched only during outages**, **Cannot be patched** or **Not known**. |
| **Field location** (systems) | Where the equipment physically is, for example a substation building or an equipment room. |
| **Firmware version** (assets) | The firmware the device runs. |

An administrator can rename these choices under **Administration > Lists**. The systems list can show and filter by every one of these fields (use the column chooser and the filters), and so can the report builder.

## The OT overview

Open **OT security**. The figures count every system, zone and conduit, restricted ones included, and are the same for everyone:

- **OT systems**: systems marked OT and not retired, with how many are life-critical and how many OT assets there are.
- **Zones below target**: zones whose achieved level is lower than their target, or that have not been assessed yet.
- **Conduits with remote access**, and how many conduits are **flagged**: a conduit is flagged when it allows remote access or touches a zone below target.
- **Cannot be patched**: OT systems whose patching is **Cannot be patched**, and how many are **Always connected** for their supplier.
- **OT systems with no zone**.

Each tile opens the records behind it. Below them:

- **OT systems by control level**: select a bar to open those systems.
- **Zones below target**: the zones you may see that fall short, with their achieved level.
- **Flagged conduits**: the conduits you may see that are flagged, with their two zones and why.

## Security zones

A zone groups OT systems and assets that share security needs, for example the train control servers, or everything in the maintenance shop. Open **Security zones**.

### Add a zone

1. Select **New security zone**, or **Create** then **Security zone**.
2. Enter the **Name** and **What it holds**, and choose the **Site**, the **Owner** and the **Criticality**.
3. Choose the **Target security level**: the level the zone should reach.
4. Choose the **Achieved security level** when the zone has been assessed. **Level assessed on** is set to today when you change the achieved level, and you can correct it.
5. Select **Create security zone**.

The zone gets a reference such as `ZON-00001`.

Security levels run from **Level 1 – casual or accidental** (protection against mistakes and casual misuse) up to **Level 4 – sophisticated, well-resourced attacker**. The words are general descriptions; use the levels your own standard or policy defines, and an administrator can rename them under **Administration > Lists**. A zone is **below target** when its achieved level is lower than its target, or when it has not been assessed; the zone's page shows **Below target**, **Not assessed** or **At target** beside its name.

### The zone page

The zone page shows the zone's details and **Security levels**, and these tabs:

- **Members**: the systems and assets in the zone (only those you may see). To add one, choose the **Kind of record**, search for it and select **Add**: its **Security zone** is set to this zone. To take a record out of a zone, clear the zone on its **OT** details.
- **Conduits**: the conduits joining this zone to others, with the other zone, remote access, levels and whether the conduit is flagged.
- **Controls**: the controls covering the zone, when the control library is on. Link a control to a zone from the control's **Coverage** tab ([Controls and testing](26-controls-and-testing.md)).
- **Actions**: actions raised to close the gap, filed under **OT security** in the [action tracker](06-risks-actions-obligations.md).
- **Activity**, **Attachments**, **Related** and **History**, as on every record page.

Deleting a zone takes its systems and assets out of it.

### Restricted zones

Some zones are sensitive: knowing what is in them, and how they are reached, helps an attacker. Check **Restricted** on such a zone. A restricted zone is then hidden from anyone without security access (`security.view`) in lists, record pages, search, the relationship map, exports and reports; its systems show "Restricted" in place of the zone's name. It is still counted in the overview's figures, which are the same for everyone.

Only someone who may see restricted records can check **Restricted** or clear it.

## Conduits

A conduit is a way data passes between two zones: a network link, a data diode, a remote access path. Open the **Conduits** tab.

1. Select **New conduit**, or **Create** then **Conduit**.
2. Choose the **From zone** and the **To zone** (two different zones, both of which you can see). Leave the **Name** empty to have it written for you ("Zone A to Zone B").
3. Enter the **Protocols** that pass and the **Protections** in place, check **Remote access** when the conduit lets someone in from outside, and choose its **Target** and **Achieved security level**.
4. Select **Create conduit**.

The conduit gets a reference such as `CDT-00001`. A conduit is **restricted** whenever either of its zones is: nobody sets this by hand, and it changes by itself when a zone's restriction changes. Actions raised on a conduit follow it.

## On the relationship map

On the [relationship map](03-inventory.md#the-relationship-map), systems and assets marked OT carry a small **OT** badge, and their tooltip names their zone. **Arrange systems by** offers **Zone**, which draws a box for each security zone you may see, with the systems not in a zone in a box of their own.

## In reports

The report builder ([Dashboards and reports](15-dashboards-and-reports.md)) offers the OT fields on systems and assets, and **Security zones** and **Conduits** as record types of their own, like any other field and record type. Restricted zones and conduits stay hidden from people without security access.

## Starter structure for an OT control catalog

Many organizations follow a licensed standard for the security of their control systems. Its text cannot be shipped with the application, so a **starter structure file** is offered instead: a reference file with seven functions under general headings (identification and authentication control, use control, system integrity, data confidentiality, restricted data flow, timely response to events, resource availability), two categories under each, and three placeholder outcomes in each category, every one reading "Fill from your licensed copy". A `mappings` block suggests, for each placeholder, related outcomes of the framework shipped with the application.

To use it:

1. Open **Framework outcomes > More > Frameworks and structure**, select **Add framework from a file**, then **Download the OT starter structure**.
2. In the file, change the `key`, `name` and codes to match your licensed copy, replace each placeholder text with the requirement from that copy, and remove what you do not use. The format is described in [Cybersecurity frameworks](05-cybersecurity-frameworks.md#the-reference-file-format).
3. Load the file with **Add framework from a file**. The `mappings` block is a guide only and is not loaded: record the links you keep as **Also satisfies** on each outcome.

## Sample data

The sample data (the `dev` seed) adds five invented zones (train control, traction power supervisory, station systems, fare collection back office and maintenance shop network; two below target and one restricted), six conduits (two with remote access), four OT systems and two OT assets, all labeled "[Sample]".
