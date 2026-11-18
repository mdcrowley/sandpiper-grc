# Inventory

The inventory records what the organisation runs and owns: the systems people rely on, the physical and licensed assets, the sites they are at, and the categories of data held. It also records how these relate, so you can see what is affected if a system fails. Lists and record pages work as described in [Getting started](01-getting-started.md).

## Systems

A system is an application or service that people use, for example a finance system or the email service. Open **Systems** in the **Inventory** group. The list shows 50 systems per page.

### Add a system

1. Select **New system**, or **Create** then **System**.
2. Enter the **Name**. Optionally enter a **Group** (a heading you use to sort systems, such as "Finance"), the **Vendor (as recorded)** and the **Function**.
3. Choose the **Status**: **Planned**, **In use**, **Being replaced** or **Retired**.
4. Choose the **Criticality**, from **Tier 1 - Critical** to **Tier 4 - Low**.
5. Choose the **Hosting**: **On-premises**, **Vendor-hosted**, **Cloud** or **Hybrid**.
6. Choose the **Business owner** and **Technical owner**.
7. Select **Create system**.

The system gets a reference such as `SYS-00012`.

### The system record

The **Details** card holds the main fields, including **Vendor** and **Contract**, which link the system to records in [Vendors and contracts](04-vendors-and-contracts.md). **Vendor (as recorded)** is free text for when no vendor record exists yet.

The tabs hold the rest:

| Tab | What it holds |
|---|---|
| **Overview** | **Hosting**; **Recovery and sign-in** (recovery objectives, **Manual fallback**, **Authentication method**, **Multi-factor**, **Planned replacement**); **As recorded in the source inventory** (free-text notes carried over from an earlier inventory); **Sites served** |
| **Integrations** | Other systems this one exchanges data with |
| **Data held** | Data categories held in this system |
| **Assets** | Assets linked to this system |
| **Map** | The system's connections, and what is affected if it fails |

Each card on **Overview** has its own **Edit** button.

Two fields matter for the reports described later:

- **Recovery time objective (hours)** is how long the organisation can do without the system. **Recovery point objective (hours)** is how much recent data it can afford to lose.
- **Multi-factor** records whether sign-in to the system needs a second factor: **Enforced**, **Available, not enforced**, **Not in place**, **Not applicable** or **Not known**.

### Record an integration

An integration is a flow of data between two systems.

1. Open the system and its **Integrations** tab.
2. Select **Add integration**.
3. Choose the **Other system**.
4. Choose the **Direction of data**: **This system sends to the other**, **This system receives from the other** or **Both ways**.
5. Optionally choose the **Method**, for example **API** or **File transfer**, and add **Notes** on what is exchanged and how often.
6. Select **Add integration**.

The integration appears on both systems, as **Sends to** on one and **Receives from** on the other. Removing it from one removes it from both. A system cannot be integrated with itself, and the same pair with the same method cannot be recorded twice.

### Link sites and data categories

- On the **Overview** tab, under **Sites served**, select **Add site** and choose the site.
- On the **Data held** tab, select **Add data category** and choose the category.

To remove a link, select the bin button on its row and confirm with **Remove**. Only the link is removed.

## The relationship map

The map draws systems, the integrations between them, and the vendors, sites, data categories and assets around them. Open **Relationship map** in the **Inventory** group.

### Read the map

- Each dot is a record, coloured by type. Larger dots are systems with more connections.
- Solid arrows are integrations and point the way data flows. Dashed lines are other relationships: "supplied by" a vendor, "serves" a site, "holds" a data category, "runs on" an asset.
- Drag to move, scroll to zoom, and hover over a dot to highlight its neighbours.
- Select a dot to open that record.
- Select an entry in the legend to hide that type.

Above the map:

- **Group** limits the map to systems in one group.
- **Show around systems** chooses which other types are drawn. Vendors, sites and data categories are shown to start with; tick **Assets** to add them. Only assets linked to a system appear.
- **Layout** switches between **Clustered** and **Circle**.
- **Reset filters** puts these back.

The **Table** tab lists the same relationships as rows, with a **Search relationships** box. Use it if you prefer text or work with the keyboard.

### What is affected if this fails

1. Open a system and its **Map** tab.
2. Under **Neighbourhood**, use **Show** to choose **Direct connections**, **Two steps away** or **Three steps away**.
3. Read the card **What is affected if** (system name) **fails**.

The card counts and lists:

- **Downstream systems**: every system that receives data from this one, directly or through another system. A both-ways integration counts in each direction. Each entry says whether it is "fed directly" or through which system, and by what method.
- **Sites**, **Data categories** and **Assets**: those of this system and of every downstream system. Each entry says "directly" or names the system it comes through. Retired and disposed assets are left out.

The list is only as good as the integrations, sites and data categories you have recorded. A system with none shows nothing affected.

## Assets

An asset is a piece of equipment, a licence or a subscription. Open **Assets** in the **Inventory** group.

### Add an asset

1. Select **New asset**, or **Create** then **Asset**.
2. Enter the **Name** and choose the **Type**, for example **Workstation**, **Server** or **Software licence**.
3. Choose the **Status**: **Ordered**, **In stock**, **In use**, **In repair** or **Retired**. Do not choose **Disposed** here; use the disposal step below.
4. Enter **Make**, **Model** and **Serial number**, the **Site** and **Location**.
5. Enter the **Purchase date**, **Cost** and **Funding source**. Costs are in the organisation's currency, here and in an import; an amount written with another currency's symbol is refused.
6. If an outside funder paid for some or all of it and keeps an interest, tick **Funder interest** and enter **Funder interest (%)**.
7. Select **Create asset**.

The asset is given a tag such as `AST-00031`. To use your own tag, edit the **Details** card and change **Tag**. No two assets can share a tag.

The asset record has three tabs of its own: **Assignment**, **Purchase and technical** (purchase, funding, warranty and support dates, and technical details such as operating system and addresses) and **Disposal**. A notice at the top of the record warns when support has ended or when a funder interest is recorded.

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

The **Assignment** tab shows the **Current assignment** and the **Assignment history**: every check-out and check-in, who did it and when.

### Dispose of an asset

Every disposal needs a recorded approval: who approved it and when.

1. Open the asset and select **Dispose**.
2. Enter **Approved by** (the approver's name) and **Approved on**.
3. Enter the **Disposal approval reference** if there is one. It is required when a funder interest is recorded.
4. Optionally enter the **Disposal method**, for example recycled, sold or returned to the vendor, and check **Disposed on**.
5. Select **Mark as disposed**.

The asset is checked in if it was out, its status becomes **Disposed**, and the approval is kept in its history. The disposal fields can no longer be edited.

### The funder-interest rule

If **Funder interest** is ticked, the asset cannot be disposed of until the **Disposal approval reference** is entered. This is the reference of the funder's approval, for example a letter or email reference.

- The asset record shows a **Funder interest** notice saying so.
- The dispose box shows "Blocked: an outside funder keeps an interest in this asset", and **Mark as disposed** cannot be selected until the reference is filled in.
- The rule applies however the status is changed, including by editing the record or importing a file. A blocked attempt is recorded in the audit log.

The approval is a recorded name, date and reference. The application does not send the request to anyone for approval.

## Sites

A site is a building or location. Open **Sites** in the **Inventory** group.

To add one, select **New site** and enter the **Name**, **Address**, **Function**, **Power protection**, **Physical security**, **Third parties on site** and **Network links**. Only the name is required.

The site record has two tabs:

- **Systems** lists the systems serving the site. To add one, open that system and use **Sites served** on its **Overview** tab.
- **Assets** lists the assets held at the site. Select **New asset** there to add one with the site already filled in.

## Data categories

A data category is a kind of information the organisation holds, for example staff records or payment details. Open **Data categories** in the **Inventory** group.

To add one:

1. Select **New data category**.
2. Enter the **Name** and **What it contains**.
3. Enter **Where held**, the **Custodian** (who is responsible for it), **Shared with**, the **Governing rule or agreement** and the **Retention period**.
4. Choose the **Sensitivity**: **Public**, **Internal**, **Confidential** or **Restricted**.
5. Select **Create data category**.

A category with no sensitivity chosen is shown as **Not classified** and is treated as sensitive in reports until you classify it.

The **Systems** tab on a data category lists the systems holding it, with their hosting and multi-factor status. To add one, open that system and use its **Data held** tab.

## Inventory reports

Open **Inventory reports** in the **Inventory** group. Each tile shows a ready-made check and the number of rows it has now. Select a tile to see its rows.

| Report | Lists |
|---|---|
| **Assets past support** | Assets still held whose support end date has passed |
| **Warranty expiring** | Assets whose warranty ends in the next 90 days |
| **Assets by site** | Number of assets at each site, how many are in use or carry a funder interest, and their recorded cost |
| **Unassigned assets** | Assets that are not retired or disposed and have nobody assigned |
| **Systems without an owner** | Systems with no business owner or no technical owner |
| **Systems without recovery targets** | Systems with no recovery time objective or no recovery point objective |
| **Systems holding sensitive data without multi-factor** | Systems that hold a confidential, restricted or unclassified data category and do not enforce multi-factor sign-in |

Retired and disposed assets, and retired systems, are left out. You see only the reports your role allows.

In an open report:

- Type in **Filter rows** to narrow the rows.
- Select a column heading to sort.
- Select the first or second column of a row to open the record.
- Select **Refresh** to run the report again, or **Export CSV** to download it.

## Importing assets from CSV

Use the import to load many assets at once from a spreadsheet saved as CSV. Nothing is written until you have seen the preview and chosen to import.

### Prepare the file

- The first row must hold the column names.
- Every asset needs a name. Other columns are optional.
- Write dates as `YYYY-MM-DD` or month/day/year.
- For **Type**, **Status** and **Funding source**, use the value as it appears on screen.
- For **Site**, use the site's name. For **System**, use its name or reference. For **Owner** and **User**, use the person's username, email or display name.
- For **Funder interest**, use yes or no.
- A file can hold up to 5,000 rows. Save a spreadsheet workbook as CSV first.

### Run the import

1. Open **Assets** and select **Import**.
2. Under **1. Choose or paste a CSV file**, choose the file or paste its text, then select **Next: map columns**.
3. Under **2. Match your columns to asset fields**, check each field. Columns are matched by name where possible; change any that are wrong and leave unwanted fields as **Not imported**. The **Name** field must be matched.
4. Tick **Update assets that already exist (matched by tag or serial number) instead of skipping them** if you want the file to update existing assets.
5. Select **Next: preview**.
6. Read the preview. Each row is marked **New**, **Update**, **Duplicate, skipped** or **Error**, and the **Problems** column explains why. Tick **Only show problems** to shorten the list.
7. Select **Import** (the button shows the number of assets), or **Back** to change the mapping.

A duplicate is a row whose tag or serial number matches an existing asset or an earlier row in the file. Rows with errors are never imported: fix them in the file and import again, or import the rest now. When the import finishes, select **Go to assets** or **Import another file**.

Vendor, contract and disposal fields cannot be imported. A row with the status **Disposed** is rejected unless the disposal approval is complete, so dispose of assets from their records instead.

## Not available yet

- Routed approval for disposals. The approval is a name, date and reference typed in by staff.
- Importing spreadsheet workbooks directly; importing systems, sites or data categories from the screens.
- Automatic discovery of assets on the network.
- Reminders when a warranty, support period or loan is about to end. Use the reports.
- Attachments, such as purchase documents or disposal certificates.
- Editing an integration. Remove it and add it again.
