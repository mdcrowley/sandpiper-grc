# Vendors and contracts

This part of the application records the organisations that supply you, the contracts you hold with them, the security terms those contracts contain, the assurance evidence vendors send, and the dates by which you must decide whether to renew. Lists and record pages work as described in [Getting started](01-getting-started.md).

## Vendors

Open **Vendors** in the **Vendors** group.

### Add a vendor

1. Select **New vendor**, or **Create** then **Vendor**.
2. Enter the **Name**. Two vendors cannot have the same name.
3. Describe what they supply in **Services**.
4. Choose the **Criticality**: **Critical**, **High**, **Medium** or **Low**. This is how much the organisation depends on the vendor.
5. Enter the **Remote access method** if the vendor connects to your systems, and any **Notes**.
6. Select **Create vendor**.

The vendor gets a reference such as `VND-00007` and its status starts as **Active**. The other statuses are **Prospective** and **Former**; change the status by editing the **Details** card.

### The vendor record

The tiles at the top of the record summarise the vendor:

| Tile | Shows |
|---|---|
| **Contracts** | How many contracts are recorded |
| **Next notice date** | The nearest notice date still to come, or **Passed** if one has gone by |
| **Security terms absent** | How many clauses are marked absent, with the number partial and not assessed |
| **Evidence expiring** | Evidence that has expired or expires within 90 days |
| **Systems supplied** | How many systems name this vendor |

Select a tile to go to the matching tab or page.

The **Details** card includes **Incident contact**, **Incident contact email** and **Incident contact phone** for the main person to reach in an emergency.

| Tab | What it holds |
|---|---|
| **Contracts** | This vendor's contracts. **New contract** adds one with the vendor filled in |
| **Security terms** | The security-terms checklist for each of the vendor's contracts |
| **Evidence** | Assurance evidence received from the vendor |
| **Contacts** | The people you deal with |
| **Systems supplied** | Systems whose **Vendor** field points to this vendor; see [Inventory](03-inventory.md) |

## Contacts

To add a contact:

1. Open the vendor and its **Contacts** tab.
2. Select **Add contact**.
3. Enter the **Name**, and optionally the **Role**, **Email** and **Phone**.
4. Tick **Incident contact** if this is the person to reach when there is a security incident involving the vendor.
5. Select **Add contact**.

Incident contacts are listed first with a red **Incident contact** badge. Email addresses and phone numbers are links you can select to start a message or call.

To change a contact, select the pencil button on its row, then **Save changes**. To remove one, select the bin button and confirm with **Remove**. Changes are kept in the vendor's history.

## Contracts

Open **Contracts** in the **Vendors** group. The list is sorted by notice date, soonest first, and the **Notice date** column is coloured: red when the date has passed or is within 30 days, amber within 120 days, green beyond that, and grey when there is none.

### Add a contract

1. Select **New contract** on the contract list or on a vendor's **Contracts** tab, or **Create** then **Contract**.
2. Enter the **Title** and choose the **Vendor**. Both are required.
3. Choose the **Document type**, for example **Agreement**, **Order form or quote**, **Amendment** or **Nothing on file**.
4. Choose the **Status**: **Draft**, **Active**, **Not on file**, **Expired** or **Ended**.
5. Enter the **Start date** and **End date**. The end date cannot be before the start date.
6. Choose the **Renewal**: **Renews automatically**, **Fixed term**, **Option to extend**, **Runs until ended** or **Not known**.
7. Enter the **Notice period (days)**: how many days before the end date you must tell the vendor that you are not renewing.
8. Choose an **Owner**: the person who will make the renewal decision.
9. Select **Create contract**.

The contract gets a reference such as `CON-00015`.

### The contract record

The record has two cards of fields. **Details** holds the structured fields above plus **Parties**, **Term**, **Total value**, **Value by year**, **Approval or resolution number** and **Notes**. **As recorded in the contract register** holds free-text notes carried over from an earlier register, such as **Document on file** and **Term and renewal (as recorded)**.

**Value by year** is entered as JSON with a year and an amount, for example `{"2026": 12000, "2027": 12500}`.

The tabs are **Security terms** and **Evidence**, described below.

### The computed notice date

The notice date is the last day on which you can give notice. You do not type it; the application works it out:

**Notice date** = **End date** minus **Notice period (days)**

- A contract ending on 31 December with a 90-day notice period has a notice date of 2 October.
- If no notice period is entered, it counts as zero and the notice date is the end date. The record says so.
- If there is no end date, there is no notice date. The record shows **Not set**, and the contract cannot appear on the renewal calendar or get reminders.
- The date is worked out again whenever you change the end date or the notice period.

The top of the contract record shows the notice date in large type with a **Time to give notice** countdown. Once the date has passed, the card is highlighted. For a contract with the status **Expired** or **Ended**, the card says the contract has ended and no reminders are raised.

## The security-terms checklist

Each contract has a checklist of security clauses. For every clause you record whether the contract contains it. As installed the clauses are:

| Clause | What to look for |
|---|---|
| **Independent assurance** | An independent assurance report or certification, provided each year |
| **Multi-factor sign-in** | Multi-factor authentication for vendor staff and for the organisation's users |
| **Breach notice time** | A fixed deadline for telling the organisation about a security incident |
| **Data ownership and return** | The organisation owns its data and gets it back, or has it destroyed, on exit |
| **Recovery times and service levels** | Stated recovery time and recovery point, uptime and remedies |
| **Cyber insurance** | Cyber liability cover with stated limits |
| **Liability carve-out** | Data breach and confidentiality losses sit outside the liability cap |
| **Subcontractors** | Subcontractors are disclosed and held to the same security terms |
| **Named security standard** | The vendor commits to a named, recognised security standard |

Your administrator can change this list.

To check a contract:

1. Open the contract and its **Security terms** tab. You can also use the **Security terms** tab on the vendor, which shows the checklist for each of its contracts.
2. For each clause, choose a status (the meanings are listed below), or leave it as **Not assessed** if you have not read that part yet.
3. In the next box, enter what the contract says, ideally its own wording.
4. Add a **Note** if useful, for example the clause number.
5. Select **Save** on that row. Each row is saved separately; the button turns solid when a row has unsaved changes.

The statuses mean:

- **Present**: the contract clearly contains the term.
- **Partial**: the term is there but hedged or incomplete.
- **Absent**: the contract does not contain it.

Every change is recorded in the contract's history.

## The security-terms matrix

The matrix shows every vendor against every clause on one page. Open **Security terms** in the **Vendors** group, or select **Security terms matrix** on the vendor list. The page is titled **Security terms matrix**.

- Vendors run down the page, most critical first. Clauses run across.
- Each cell shows a letter and a colour: **P** for present, **Pt** for partial, **A** for absent and a dash for not assessed.
- When a vendor has several contracts, the cell shows the weakest position among them: absent outranks partial, which outranks present. Contracts with the status **Ended** are left out.
- A vendor with no contract is marked "No contract recorded".

To use it:

1. Use **Criticality** to limit the matrix to, for example, critical and high vendors.
2. Point at a cell, or move to it with the `Tab` key, to read the clause text in the panel above the table. With several contracts, each contract's text is listed.
3. Select a cell to open that vendor's **Security terms** tab and update the checklist.

On a narrow window the matrix scrolls sideways.

## Evidence and expiry

Evidence is what a vendor sends to show its security is in order. Each item belongs to a vendor and, optionally, to one of that vendor's contracts.

### Record evidence

1. Open the vendor's **Evidence** tab, or a contract's **Evidence** tab, and select **New evidence item**. You can also use **Evidence** in the **Vendors** group, or **Create** then **Evidence item**.
2. Enter a **Title**.
3. Choose the **Type**: **Assurance report**, **Insurance certificate**, **Card-data attestation**, **Questionnaire** or **Other**.
4. Enter **Received on** and **Expires on**. The expiry cannot be before the date received.
5. Summarise what the evidence shows in **Note**, and say where the document itself is kept.
6. Select **Create evidence item**.

If you choose a **Contract**, it must belong to the same vendor.

The evidence item records that the document exists and when it runs out. The document itself cannot be uploaded.

### Expiry

The **Expiry** column shows a coloured chip:

| Chip | Meaning |
|---|---|
| Red, "Expired … ago" | The expiry date has passed |
| Amber, "Expires in …" | Expires within 90 days |
| Green, "Valid to …" | More than 90 days left |
| Grey, "No expiry" | No expiry date recorded |

To see everything that needs chasing, open **Expiring evidence** in the **Vendors** group.

1. Use **Show evidence expiring in** to choose **Next 30 days**, **Next 60 days**, **Next 90 days**, **Next 180 days** or **Next 365 days**.
2. The tiles show how many items are **Already expired** and how many are expiring in the period.
3. The table lists them, soonest first. Select the evidence to open it, or the vendor to open its **Evidence** tab.
4. Ask the vendor for a current copy. When it arrives, record it as a new evidence item so the old one remains as history.

## The renewal calendar and reminders

The renewal calendar groups contracts by how close their notice date is. Open **Renewal calendar** in the **Vendors** group, or select **Renewal calendar** on the contract list.

Contracts with the status **Expired** or **Ended** are left out. With the reminder days as installed (120, 90, 60 and 30), the groups are:

| Group | What to do |
|---|---|
| **Notice date passed** | The last day to give notice has gone by. Check whether the contract renewed, and on what terms |
| **Notice due within 30 days** | Decide now: renew, renegotiate or give notice |
| **Notice due in 31 to 60 days**, **Notice due in 61 to 90 days**, **Notice due in 91 to 120 days** | Start the renewal decision and gather what is needed |
| **More than 120 days away** | No action needed yet |
| **No notice date** | No end date is recorded, so no reminder can be raised. Read the term and enter an end date and notice period where the contract gives them |

Tiles at the top count the contracts in each group. Each row shows the contract, vendor, notice date, end date, renewal type and owner. Select the contract or the vendor to open it.

### Reminders

A reminder is recorded for each contract a set number of days before its notice date: 120, 90, 60 and 30 days as installed. The page subtitle states the days in use.

A reminder is an entry in the contract's **History** tab, such as "Renewal reminder (60 days)". It is also recorded in the audit log. No email or on-screen notification is sent, so look at the renewal calendar regularly. **Overview** also has a **Contracts approaching notice** panel listing notice dates in the next 120 days.

The **Reminders** column on the calendar shows the state of each one:

| Badge | Meaning |
|---|---|
| **planned** | Its date is still to come |
| **due** | Its date has arrived; it is recorded within the hour |
| **recorded** | It has been written to the contract's history |
| **skipped** | Several reminders were already overdue when the contract was entered, so only the nearest was recorded |

Point at a badge to see its date.

If you change a contract's end date or notice period, its notice date changes and its reminders are planned again from the new date.

### Keeping the calendar useful

1. Open **Renewal calendar** and scroll to **No notice date**.
2. For each contract, read the **Term as recorded** column and the contract document.
3. Open the contract, select **Edit** on the **Details** card, and enter the **End date**, **Notice period (days)** and **Renewal**.
4. Give every contract an **Owner**. Contracts without one show "No owner".

## Not available yet

- Email or on-screen notifications for renewal reminders and expiring evidence. Reminders are history entries and calendar badges only.
- Uploading contract documents or evidence files.
- A security questionnaire that vendors fill in.
- A form for **Value by year**; it is entered as JSON.
- Approval steps for signing or renewing a contract.
- A vendor's own sign-in. Vendors have no access; staff record everything.
