# Inventory

The inventory records what the organization runs and owns: the systems people rely on, the physical and licensed assets, the sites they are at, and the categories of data held. It also records how these relate, so you can see what is affected if a system fails. Lists and record pages work as described in [Getting started](01-getting-started.md).

Inventory is always on. When an administrator switches **Fleet and services** off under **Administration > Features**, the services and vehicles drop out of the relationship map and the impact panels (see [Administration](09-administration.md#features)).

## Systems

A system is an application or service that people use, for example the scheduling system, the fare collection back office or the email service. Equipment on the vehicles themselves, such as the fareboxes or the onboard video, can be recorded as a system too. Open **Systems** in the **Inventory** group. The list shows 50 systems per page.

Use the column chooser to add **Technical owner**, **Vendor (as recorded)**, **Recovery time (h)**, **Recovery point (h)** or **Updated**. To change several systems at once, check them and select **Edit selected…**: you can set **Status**, **Criticality**, **Hosting**, **Multi-factor**, **Business owner** or **Technical owner**.

### Add a system

1. Select **New system**, or **Create** then **System**.
2. Enter the **Name** and the **Function** (what the system is for). Optionally enter a **Group**, a heading you use to sort systems, such as "Finance".
3. Choose the **Status**: **Planned**, **In use**, **Being replaced** or **Retired**.
4. Choose the **Criticality**, from **Tier 1 - Critical** to **Tier 4 - Low**.
5. Choose the **Hosting**: **On-premises**, **Vendor-hosted**, **Cloud**, **Hybrid** or **On-vehicle** (equipment that runs on the vehicles, such as fareboxes, location units or passenger information screens).
6. Choose the **Business owner** and **Technical owner**, and enter the **Vendor (as recorded)** if you know it.
7. Select **Create system**.

The system gets a reference such as `SYS-00012`.

### The system record: a fact sheet

The top of the record shows how complete the fact sheet is, as a percentage and a count ("7 of 12 key facts recorded"), with the facts people look for first: **Business owner**, **Technical owner**, **Criticality**, **Hosting**, **Recovery time / point**, **Multi-factor** and **Vendor**. A fact that is missing reads "Not recorded".

Under **Still to record** there is one button for each gap, for example **a business owner** or **how people sign in**. Select one to open the right card for editing. **the data it holds** opens the **Data held** tab.

The key facts are: what the system is for, a business owner, a technical owner, the criticality, a recovery time objective, a recovery point objective, the hosting, how people sign in, the multi-factor status (anything but **Not known**), the vendor, the contract, and at least one data category.

The tabs hold the rest:

| Tab | What it holds |
|---|---|
| **Fact sheet** | One card for each subject: **Purpose**, **Ownership**, **Criticality and recovery**, **Hosting**, **Sign-in**, **Vendor and contract**, **Outlook and notes**; then **Sites served** |
| **Integrations** | Other systems this one exchanges data with |
| **Data held** | Data categories held in this system |
| **Assets** | Assets linked to this system |
| **Changes and issues** | Change records, open tickets and open vulnerabilities that name this system |
| **Map** | The system's connections, and what is affected if it fails |
| **OT** | Operational technology details: control level, whether it is life-critical, security zone, supplier remote access, patching and field location ([OT security](32-ot-security.md)); shown while **OT and rail-systems security** is on |
| **Attachments** | Files kept with the record, such as a contract summary or a recovery plan |

**Activity**, **Related** and **History** follow, as on every record page.

Each card on **Fact sheet** has its own **Edit** button. A card is marked **Complete**, or shows how many facts it still needs ("2 to record") with "Not recorded" against each gap.

- **Vendor** and **Contract** link the system to records in [Vendors and contracts](04-vendors-and-contracts.md). **Vendor (as recorded)** is free text for when no vendor record exists yet.
- **Recovery time objective (hours)** is how long the organization can do without the system. **Recovery point objective (hours)** is how much recent data it can afford to lose.
- **Multi-factor** records whether sign-in to the system needs a second factor: **Enforced**, **Available, not enforced**, **Not in place**, **Not applicable** or **Not known**.

Select **Show on map** to open the relationship map with this system selected.

### Record an integration

An integration is a flow of data between two systems.

1. Open the system and its **Integrations** tab.
2. Select **Add integration**.
3. Choose the **Other system**.
4. Choose the **Direction of data**: **This system sends to the other**, **This system receives from the other** or **Both ways**.
5. Optionally choose the **Method**, for example **API** or **File transfer**, and add **Notes** on what is exchanged and how often.
6. Select **Add integration**.

The integration appears on both systems, as **Sends to** on one and **Receives from** on the other. Removing it from one removes it from both. A system cannot be integrated with itself, and the same pair with the same method cannot be recorded twice.

### Change an integration

Select the pencil button (**Edit the integration with** the other system) on its row in the **Integrations** tab. Change the **Direction of data**, the **Method** or the **Notes**, and select **Save changes**. The direction is read from the system you are on, so you can turn an integration round from either end. The change shows on both systems and is recorded in the history of both. The other system cannot be changed: to connect a different system, remove the integration and add another.

### Link sites and data categories

- On the **Fact sheet** tab, under **Sites served**, select **Add site** and choose the site.
- On the **Data held** tab, select **Add data category** and choose the category.

To remove a link, select the trash button on its row and confirm with **Remove**. Only the link is removed.

### Changes and issues

The **Changes and issues** tab on a system (and on an asset) starts with the **Changes** panel: every change that affects the record, as its main system or asset or linked to it as affected, grouped as **Under way**, **Planned** and **Earlier** with status and planned window (see [Change enablement](10-change-enablement.md)). Below it are **Open tickets** and **Open vulnerabilities**, listed when their system (or asset) field names this record. Each list shows the newest six with a count; select **See all** or **Open as a list** to open the full list with that filter. A list appears only if that part of the application is in use and your role may see it.

## The relationship map

The map draws systems, the integrations between them, and the vendors, sites, data categories, assets and services around them. Open **Relationship map** in the **Inventory** group.

### Read the map

- Systems sit in the middle, in a box for each group. **Vendors** are in a lane on the left; **Sites**, **Data categories**, **Assets** and **Services** are in lanes on the right, each level with the systems it belongs to, or one under another when they are short, to keep the map narrow. A very large group shows its systems two or more to a row. The same estate always draws the same way.
- Color shows the type. The dot at the end of a system shows its criticality. Systems and assets marked as operational technology carry an **OT** badge ([OT security](32-ot-security.md)).
- A solid line with an arrow is an integration, and the arrow shows the way data flows. A dashed line is another relationship: "supplied by" a vendor, "serves" a site, "holds" a data category, "runs on" an asset, "needed for" a service (with what the service needs the system for, such as CAD/AVL or fare collection).
- The legend under the map repeats this.

### Move around

- The map opens at a size where names can be read, from its top-left corner. Drag to move. Scroll, or use the **Zoom in** and **Zoom out** buttons, to zoom. **Fit the whole map** shows everything at once, however small.
- **Full screen** gives the map the whole window; select **Leave full screen** or press Escape to return.
- With the keyboard: Tab to the map, then the arrow keys move it, plus and minus zoom, and zero fits. Tab again to reach each record and press Enter to select it.
- When the map is zoomed far out, the names of groups and lanes grow so the shape of the estate stays readable. Zoom in to read record names.

### Find and filter

- **Find a system, vendor, site…** searches the records on the map. Choosing one selects it and centers the map on it.
- **Arrange systems by** groups the systems by **Group**, **Criticality** or **Hosting**, and by **Zone** (one box for each OT security zone you may see) while **OT and rail-systems security** is on.
- The group box (showing **All groups**) limits the map to systems in one group.
- **Show** chooses which other types are drawn. Vendors, sites and data categories are shown to start with; select **Assets** or **Services** to add them. Only assets linked to a system appear. **Services** are routes and lines that depend on at least one system; they appear when the fleet module is installed and you may see fleet records, and discontinued services are left out. A system's **Map** tab shows every type.
- **Reset** puts these back.
- **Map** and **Table** switch between the drawing and a table of the same relationships, with a **Search relationships** box. Use the table if you prefer text or use a screen reader.

### Select a record

Select a record on the map. Everything not connected to it fades, and the panel beside the map shows:

- its type, name and reference, and for a system its status, criticality and hosting;
- **Open system** (or site, data category, asset, service, vendor) to go to the record;
- for a system, **If this fails** (see below);
- **Connections**, grouped by relationship: **Sends data to**, **Receives data from**, **Exchanges data with**, **Supplied by**, **Serves**, **Holds**, **Runs on**, **Needed by services**, **Depends on**. Select a name to move to that record.

Select the cross, or an empty part of the map, to clear the selection.

### What is affected if this fails

Select a system on the map, or open a system and its **Map** tab (**How far to look** chooses **Direct connections**, **Two steps away** or **Three steps away**, and the system is selected for you).

Under **If this fails** the panel counts and lists:

- **Downstream systems**: every system that receives data from this one, directly or through another system. A both-ways integration counts in each direction. Each entry says whether it is "fed directly" or through which system, and by what method.
- **Sites**, **Data categories** and **Assets**: those of this system and of every downstream system. Each entry says "directly" or names the system it comes through. Retired and disposed assets are left out.

- **Services** and **Vehicles**, when the fleet module is installed and you may see fleet records: the services (routes and lines) that depend on this system or a downstream one, and the vehicles that carry their equipment, with their mode and depot. Vehicles appear only to people who may see assets. Retired vehicles and discontinued services are left out.

A name drawn on the map moves the map to that record; a name that is not drawn (a vehicle, or a type hidden under **Show**) opens its own page.

On the map, everything affected is outlined with a red dashed line and the lines that carry the failure turn red.

The list is only as good as the integrations, sites and data categories you have recorded. A system with none shows "Nothing recorded depends on" it.

**What is affected**, in the **Inventory** group, shows the vehicles and services for one system on its own page; see [Fleet and services](19-fleet-and-services.md).

### Start the map from a change

On a change's **Systems and links** tab, **Show on relationship map** opens the map with the systems and assets the change affects outlined in amber and their neighbors kept bright; everything else fades. A note above the map names the change and links back to it; **Show the whole map** clears it. Assets the change affects are added to the map even when **Assets** is not chosen under **Show**. Selecting a record works as usual, and clearing the selection returns to the change's highlighting.

### Save the map as a picture

Select **Save as a picture** (the download button under the zoom buttons). The dialog shows a preview and asks:

- **Format**: **PNG picture**, for documents, slides and email, or **SVG drawing**, which stays sharp at any size and opens in drawing programs.
- **Colors**: **For printing** (light colors on a white page) or **As on screen** (the theme you are using now, light or dark).
- **Show what is affected if** the selected system **fails**, when a system is selected: the affected records are outlined in red, as on the screen.

Select **Save picture**. The picture holds the whole map as it is filtered and arranged now, whatever the zoom, with a heading, the date and time, the arrangement and group if you chose one, and a legend. The file is named after the map and the day, for example `relationship-map-2026-11-19.png`. A system's **Map** tab saves its connections the same way. Very large maps are saved at a smaller scale so that the picture stays within what browsers can draw.

## Assets

An asset is a piece of equipment, a license or a subscription. Open **Assets** in the **Inventory** group.

Equipment fitted to vehicles (onboard computers, CAD/AVL units, fareboxes, card validators, on-vehicle routers, cameras, radios and passenger information displays) is recorded here as assets with those types, and installed on a vehicle from the vehicle's **Equipment** tab. See [Fleet and services](19-fleet-and-services.md).

Use the column chooser to add **Disposal approval**, **Department**, **Owner**, **System**, **Serial number**, **Cost** or **Purchase date**. To change several assets at once, check them and select **Edit selected…**: you can set **Status**, **Type**, **Site**, **Owner**, **System**, **Funding source**, **Warranty end** or **Support end**. The disposal rules below still apply to each asset.

### Add an asset

1. Select **New asset**, or **Create** then **Asset**.
2. Enter the **Name** and choose the **Type**, for example **Workstation**, **Server** or **Software license**. Equipment on vehicles has its own types: **Onboard computer**, **CAD/AVL unit**, **Farebox**, **Card validator**, **On-vehicle router**, **Camera**, **Radio** and **Passenger information display**. Put the vehicle number in **Location**.
3. Choose the **Status**: **Ordered**, **In stock**, **In use**, **In repair** or **Retired**. Do not choose **Disposed** here; use the disposal step below.
4. Enter **Make**, **Model** and **Serial number**, the **Site** and **Location**.
5. Enter the **Purchase date**, **Cost** and **Funding source**. Costs are in the organization's currency, here and in an import; an amount written with another currency's symbol is refused.
6. If an outside funder paid for some or all of it and keeps an interest, check **Funder interest** and enter **Funder interest (%)**. These two fields appear only while the **Outside funder interest in equipment** option is on, and your administrator may have given them another name, such as **Grant interest** (see [Features](09-administration.md#options-within-the-parts)).
7. Enter the **Warranty end** and **Support end** dates if you know them.
8. Select **Create asset**.

The asset is given a tag such as `AST-00031`. To use your own tag, edit the **Details** card and change **Tag**. No two assets can share a tag.

### The asset record

The top of the record shows where the asset is in its life: **Ordered**, **In stock**, **In use**, **Retired**, **Disposed** (**In repair** appears while the asset is being repaired). Under it:

- **Warranty** and **Support** each show when the cover ends ("Ends in 45 days"), with **Covered**, **Ending soon**, **Out of warranty** or **Past support**, and a bar showing how much of the period since purchase has passed. Warranty is "ending soon" in its last 90 days and support in its last 180. A date that is missing reads "Not recorded".
- A **Funder interest** notice appears when an outside funder keeps an interest in the asset.
- **Disposal awaiting approval** or **Disposal approved** appears while a disposal is in progress.

The **Details** card holds what the asset is. The **Who has it and where** card shows **Assigned to**, **Owner**, **Department**, **Site** and **Location**; select **Edit** to change the owner, department, site or location. **Department** is chosen from the organization's department list (set up under **Administration**, **Settings**); it is free text only while no departments exist.

While **OT and rail-systems security** is on, an **Operational technology (OT)** section under the details records whether the asset is OT, its control level, whether it is life-critical, its security zone and its firmware version ([OT security](32-ot-security.md)).

The tabs are **Assignment**, **Purchase and support** (purchase, funding, warranty and support dates, and technical details such as operating system and addresses), **Disposal**, **Changes and issues**, then **Activity**, **Attachments** (for purchase documents or disposal certificates), **Related** and **History**.

### Check out an asset

Checking out records who has the asset.

1. Open the asset and select **Check out**.
2. In **Assign to**, choose **A member of staff (by name)** and type the **Name**, or choose **A user of this application** and pick the **User**. Most staff do not have an account, so a name is enough.
3. Check the **Department** and **Location**.
4. Enter **Due back** for a loan, or leave it empty for a permanent assignment.
5. Add **Notes** if needed and select **Check out**.

The status becomes **In use**. A retired or disposed asset cannot be checked out, and an asset that is already out must be checked in first.

### Check in an asset

1. Open the asset and select **Check in**.
2. Choose the **Status after check-in**: **In stock**, **In repair** or **Retired**.
3. Describe the state of the asset in **Condition and notes** and select **Check in**.

The **Assignment** tab shows the **Current assignment**, with when a loan is due back, and the **Assignment history** as a timeline: every check-out and check-in, who did it and when.

### Dispose of an asset

Every disposal needs an approval: who approved it and when. There are two ways to get one.

**Ask an approver (the usual way)**

1. Open the asset and select **Dispose**. **Ask an approver** is selected.
2. Enter **Why it should be disposed of**. Optionally enter the **Disposal method** and, if you already have it, the **Disposal approval reference**.
3. Select **Request approval**.

The asset shows **Awaiting approval**, and the request runs on the **Asset disposal** approval workflow (see [Approval workflows](22-approval-workflows.md)). As set up, it has two steps:

1. **Inventory manager**: anyone who may approve asset disposals, except you.
2. **Funder's approval**: only when **Funder interest** is checked on the asset (and the funder-interest option is on). Someone who may approve asset disposals confirms that the funder has agreed.

Each approver is notified, and the request appears on their **Approvals** page, with the due time and escalation the workflow sets. An approver decides it on the **Approvals** page, in the approval panel at the top of the asset, or on **Disposal approvals** in the **Inventory** group, with **Approve** or **Refuse** and a **Comment**; a refusal must say why. The person who asked cannot decide their own request. An approver's stand-in can decide while they are away; the decision is recorded as made on their behalf. You are notified of the outcome. The **Disposal** tab and **Disposal approvals** show how many approvals the workflow has and who it is waiting for.

An administrator changes who approves, the steps, due times and escalation under **Administration > Approval workflows** (the workflows of the kind **Asset disposal**), and can add more of them with conditions, for example a different approver for vehicles. The one whose conditions hold, with the most conditions, is used. While no disposal workflow is active, a request is decided once by anyone who may approve asset disposals, as before.

- If it is approved, the approver's name and the date are recorded on the asset (with "on behalf of" when a stand-in decided). Select **Dispose** again, check the **Disposal method** and **Disposed on**, and select **Mark as disposed**.
- If it is refused, the asset shows **Disposal refused** with the approver's comment on the **Disposal** tab. You can ask again.
- To take back a request that has not been decided, select **Withdraw request** on the **Disposal** tab. This also cancels its workflow; canceling the workflow from its panel withdraws the request.

Requests made before disposal approvals moved onto the workflows keep their decisions on the **Disposal** tab; one that was still waiting carried on as an **Asset disposal** workflow, with the people who may approve asset disposals as its approvers.

**Approval already given (outside the application)**

1. Open the asset and select **Dispose**, then **Approval already given**.
2. Enter **Approved by** (the approver's name) and **Approved on**.
3. Enter the **Disposal approval reference** if there is one, the **Disposal method**, and check **Disposed on**.
4. Select **Mark as disposed**.

An administrator can switch this second way off: on **Disposal approvals**, turn on **Only accept approvals decided here**. A disposal then needs a request approved in the application (through its approval workflow).

Either way, the asset is checked in if it was out, its status becomes **Disposed**, and the approval is kept in its history. The **Disposal** tab shows the steps (**Request approval**, **Approver decides**, **Mark as disposed**, **Disposed**), every request with its decision, and the **Disposal record**.

### The funder-interest rule

This rule suits organizations whose equipment is part-paid by an outside funder, such as a grant program or a public body. It applies while the **Outside funder interest in equipment** option is on, which it is unless an administrator switches it off under **Administration > Features** (see [Features](09-administration.md#options-within-the-parts)). While it is off, the **Funder interest** fields, notices and report column are hidden, disposal needs only the approval above, and values already recorded are kept. An administrator can also rename it; the screens then use that name.

If **Funder interest** is checked, the asset cannot be disposed of until the **Disposal approval reference** is entered. This is the reference of the funder's own approval, for example a letter or email reference. It is needed as well as the approval above.

- The asset record shows a **Funder interest** notice saying so, and the **Disposal** tab explains the rule.
- The dispose box shows "Blocked: an outside funder keeps an interest in this asset", and **Mark as disposed** cannot be selected until the reference is filled in.
- The rule applies however the status is changed, including by editing the record, changing several assets at once or importing a file. A blocked attempt is recorded in the audit log.

### Reminders about dates

The application sends a notification (see the bell at the top of the page):

- 30 days and 7 days before an asset's **Warranty end** or **Support end**, and on the day. It goes to the asset's **Owner**; if the asset has no owner, to everyone who may edit assets.
- 3 days before a loan is **Due back**, and on the day. It goes to the person who checked the asset out and, if the asset is with a user of the application, to that user.

Retired and disposed assets are left out. Each reminder is sent once. In your notification preferences you can have **Reminders** and **Due dates** sent by email as well as, or instead of, the bell, or switch them off (see [Preferences](14-attachments-and-notifications.md#preferences)). An administrator chooses the steps for warranty and support end dates (30, 7 and 0 days unless changed) under **Administration** > **Reminders**; the change is kept in the audit log.

## Sites

A site is a building or location. Open **Sites** in the **Inventory** group.

To add one, select **New site** and enter the **Name**, **Address**, **Function**, **Power protection**, **Physical security**, **Third parties on site** and **Network links**. Only the name is required.

The site record has two tabs of its own:

- **Systems** lists the systems serving the site. To add one, open that system and use **Sites served** on its **Fact sheet** tab.
- **Assets** lists the assets held at the site. Select **New asset** there to add one with the site already filled in.

System and site pages show a **Business processes** section (a tab on systems) listing the business processes that depend on the record, with their tolerable downtime; a system also lists those that depend on a service built on it. See [Business continuity](30-business-continuity.md).

## Data categories

A data category is a kind of information the organization holds, for example staff records or payment details. Open **Data categories** in the **Inventory** group.

To add one:

1. Select **New data category**.
2. Enter the **Name** and **What it contains**.
3. Enter **Where held**, the **Custodian** (who is responsible for it), **Shared with**, the **Governing rule or agreement** and the **Retention period**.
4. Choose the **Sensitivity**: **Public**, **Internal**, **Confidential** or **Restricted**.
5. Select **Create data category**.

A category with no sensitivity chosen is shown as **Not classified** and is treated as sensitive in reports until you classify it. To classify several at once, check them in the list and select **Edit selected…** to set **Sensitivity**.

The **Systems** tab on a data category lists the systems holding it, with their hosting and multi-factor status. To add one, open that system and use its **Data held** tab.

## Inventory reports

Open **Inventory reports** in the **Inventory** group. Each card is a ready-made check with the number it finds now, under the headings **Assets** and **Systems**. A check that finds nothing reads "all clear". Select a card to see its rows; select it again, or **Close**, to hide them.

| Report | Lists |
|---|---|
| **Assets past support** | Assets still held whose support end date has passed |
| **Warranty expiring** | Assets whose warranty ends in the next 90 days |
| **Assets by site** | Number of assets at each site, how many are in use or carry a funder interest, and their recorded cost (the funder-interest column only while that option is on) |
| **Assets by department** | The same, for each department |
| **Unassigned assets** | Assets that are not retired or disposed and have nobody assigned |
| **Systems without an owner** | Systems with no business owner or no technical owner |
| **Systems without recovery targets** | Systems with no recovery time objective or no recovery point objective |
| **Systems holding sensitive data without multi-factor** | Systems that hold a confidential, restricted or unclassified data category and do not enforce multi-factor sign-in |

Retired and disposed assets, and retired systems, are left out. You see only the reports your role allows.

In an open report:

- Type in **Filter rows** to narrow the rows.
- Select a column heading to sort.
- Select the first or second column of a row to open the record.
- Select **Open as a list** (on **Assets past support**, **Warranty expiring** and **Unassigned assets**) to open the same assets in the **Assets** list, where you can filter further, save the view or change several at once.
- Select **Refresh** to run the report again, or **Export CSV** to download it.

## Importing assets from CSV

Assets are imported with the same import as every other kind of record: open **Assets** and select **Import** (the older address `/assets/import` opens it too). It reads a CSV or Excel (.xlsx) file, lets you match its columns to asset fields, checks every row, and only then imports. The steps are described in [Importing and exporting](17-importing-and-exporting.md#importing-records).

What is particular to assets:

- **Find existing records by** the **Tag** or the **Serial number** (choose **Update existing records only** or **Update existing records and create the rest** to change assets that are already there). Matching ignores capital letters.
- The asset rules apply to every row, in the check as on import: a tag already in use is refused, **Funder interest (%)** must be between 0 and 100, and a row with the status **Disposed** needs the disposal approval (who approved it and when, and, while the funder-interest option is on, the approval reference). Disposing of an asset from its record is usually simpler.
- For **Site**, use the site's name; for **System**, its name or reference; for **Owner** and **User**, the person's username, email or display name; for **Department**, a name from the department list.

Tools that push assets automatically (endpoint management or discovery) use `POST /api/assets/ingest`, which matches by serial number, then by tag. The older `POST /api/assets/import` still works but is deprecated: integrations should move to `POST /api/import/asset` ([integration guide](../api.md)).

## Not available yet

- Automatic discovery of assets on the network.
- Changing an asset's department for several assets at once, or filtering the asset list by department. Use the **Assets by department** report.
- Individual vehicles on the relationship map: they are drawn in groups by depot and mode (see [Fleet and services](19-fleet-and-services.md)).
