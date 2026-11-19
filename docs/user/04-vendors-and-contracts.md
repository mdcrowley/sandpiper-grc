# Vendors and contracts

This part of the application records the organisations that supply you (scheduling software, fare collection, vehicle location services and so on), the contracts you hold with them, the security terms those contracts contain, the assurance evidence vendors send, your own security assessment of each vendor, and the dates by which you must decide whether to renew. Lists and record pages work as described in [Getting started](01-getting-started.md).

## Vendors

Open **Vendors** in the **Vendors** group. Besides the usual columns, the list shows:

- **Security terms**: a small bar for the vendor's contracts, green for clauses present, amber for partial, red for absent and grey for not assessed, with the number present out of the number of clauses. Point at it to read the counts. "No contract" means nothing is recorded yet.
- **Next notice date**: the nearest notice date still to come (or the latest one that has passed), coloured as on the contract list.

These two columns appear only if you may view contracts. **Security terms matrix** opens the matrix; **Assessment questions** (for people who administer vendors) opens the questions used in vendor assessments.

### Add a vendor

1. Select **New vendor**, or **Create** then **Vendor**.
2. Enter the **Name**. Two vendors cannot have the same name.
3. Describe what they supply in **Services**.
4. Choose the **Criticality**: **Critical**, **High**, **Medium** or **Low**. This is how much the organisation depends on the vendor.
5. Enter the **Remote access method** if the vendor connects to your systems.
6. Enter the **Incident contact**, **Incident contact phone** and **Incident contact email**: the person to reach when something goes wrong.
7. Add any **Notes** and select **Create vendor**.

The vendor gets a reference such as `VND-00007` and its status starts as **Active**. The other statuses are **Prospective** and **Former**; change the status by editing the **Details** card.

### The vendor profile

The top of a vendor's page is a profile of the facts that matter most, one panel each:

| Panel | Shows |
|---|---|
| **In an incident, call** | The incident contact from the **Details** card and any contacts ticked as incident contacts, with phone and email links. "Nobody recorded" if there is none. **All contacts** opens the **Contacts** tab |
| **Contracts and next notice date** | The nearest notice date still to come, how long is left, which contract it belongs to and what happens if nobody acts. It also says how many notice dates have passed and how many open contracts have no notice date. Shown only if you may view contracts |
| **Security terms** | How many clauses are present across the vendor's contracts, with a bar and counts for present, partial, absent and not assessed. **Open the checklist** opens the **Security terms** tab |
| **Evidence** | How many evidence items are current, how many have expired or expire within 90 days, and when the newest was received |
| **Assessment** | The score of the latest completed assessment, how many gaps it found and when it was done, or "Not assessed" |

The panel's border turns amber or red when something needs attention: a notice date within 120 or 30 days, expired evidence, or a low assessment score.

Below the profile, a strip repeats **What they supply**, **Criticality**, **Remote access**, **Systems supplied** and **Last changed**, and the **Details** card holds every field for editing.

| Tab | What it holds |
|---|---|
| **Contracts** | This vendor's contracts. **New contract** adds one with the vendor filled in |
| **Security terms** | The security-terms checklist for each of the vendor's contracts |
| **Evidence** | Assurance evidence received from the vendor |
| **Assessment** | The vendor security assessment: the latest score and gaps, an assessment in progress, and the history |
| **Contacts** | The people you deal with |
| **Systems supplied** | Systems whose **Vendor** field points to this vendor; see [Inventory](03-inventory.md) |
| **Actions** | Follow-up actions raised for this vendor, including those raised from assessment gaps. Shown when the action tracker is switched on |

## Contacts

To add a contact:

1. Open the vendor and its **Contacts** tab.
2. Select **Add contact**.
3. Enter the **Name**, and optionally the **Role**, **Email** and **Phone**.
4. Tick **Incident contact** if this is the person to reach when there is a security incident involving the vendor.
5. Select **Add contact**.

Incident contacts are listed first with a red **Incident contact** badge, and appear in the profile's **In an incident, call** panel. Email addresses and phone numbers are links you can select to start a message or call.

To change a contact, select the pencil button on its row, then **Save changes**. To remove one, select the bin button and confirm with **Remove**. Changes are kept in the vendor's history.

## Contracts

Open **Contracts** in the **Vendors** group. The list is sorted by notice date, soonest first, and the **Notice date** column is a coloured chip: red when the date has passed or is within 30 days, amber within 120 days, green beyond that, and grey ("No notice date") when there is none.

When open contracts are missing an end date or notice period, the list shows a **Complete the dates** button with how many there are; see [Complete the dates](#complete-the-dates).

### Add a contract

1. Select **New contract** on the contract list or on a vendor's **Contracts** tab, or **Create** then **Contract**.
2. Enter the **Title** and choose the **Vendor**. Both are required.
3. Choose the **Document type**, for example **Agreement**, **Order form or quote**, **Amendment** or **Nothing on file**.
4. Choose the **Status**: **Draft**, **Active**, **Not on file**, **Expired** or **Ended**.
5. Enter the **Start date** and **End date**. The end date cannot be before the start date.
6. Choose the **Renewal**: **Renews automatically**, **Fixed term**, **Option to extend**, **Runs until ended** or **Not known**.
7. Enter the **Notice period (days)**: how many days before the end date you must tell the vendor that you are not renewing.
8. Choose an **Owner**: the person who will make the renewal decision and who receives its reminders.
9. Select **Create contract**.

The contract gets a reference such as `CON-00015`.

### The contract record

The top of the record puts the notice date first:

- **Last day to give notice** in large type, with how many days are left (or how long ago it passed).
- **If we do nothing**: one sentence saying what happens if nobody acts, worked out from the renewal type. For example, "It renews automatically on 31 Dec 2027 for a further term, at whatever price the contract allows", or "It ends on 31 Dec 2027. The service stops unless a new contract is agreed before then."
- A bar from the start of the term to its end, marking today, the notice date and the closed period after it.
- A **Time to give notice** countdown, the sum it is worked out from (for example "End date 31 Dec 2027 less 90 days' notice"), and the contract's **Reminders** (see [Reminders](#reminders)).

The panel is green, amber within 120 days and red within 30 days or once passed. For a contract with the status **Expired** or **Ended**, it says the contract has ended and no reminders are sent. With no end date it shows **Not set** and points you to [Complete the dates](#complete-the-dates).

Below it:

- **Details**, in three sections: **Agreement**, **Dates and renewal**, and **Value and approval**.
- **Value by year**: the contract's value year by year (see below).
- **As recorded in the contract register**: free-text notes carried over from an earlier register, such as **Document on file** and **Term and renewal (as recorded)**.

The tabs are **Security terms**, **Evidence**, **Actions** (when the action tracker is switched on), and the usual **Activity**, **Attachments**, **Related** and **History**. Attach the signed contract and its schedules on the **Attachments** tab.

### Value by year

1. On the **Value by year** card, select **Add years** (or **Edit** once there are figures).
2. Enter a **Year** and an **Amount** in the organisation's currency. Select **Add year** for each further year, or the bin button to remove one.
3. The card shows the **Total of the years** and compares it with the contract's **Total value**: "Matches the total value", or how much more or less it is.
4. Select **Save years**. If the total differs, **Save and set total value to …** saves the years and makes their total the contract's total value.

Each year can appear once. Saved figures are shown as a small table with a bar per year.

### The computed notice date

The notice date is the last day on which you can give notice. You do not type it; the application works it out:

**Notice date** = **End date** minus **Notice period (days)**

- A contract ending on 31 December with a 90-day notice period has a notice date of 2 October.
- If no notice period is entered, it counts as zero and the notice date is the end date. The record says so.
- If there is no end date, there is no notice date, and the contract cannot appear on the renewal calendar or get reminders.
- The date is worked out again whenever you change the end date or the notice period.

### Complete the dates

**Complete the dates** is a guided queue of open contracts that have no end date (unless they run until ended) or no notice period. Open it from the **Complete the dates** button on the contract list, from **Cannot be placed** on the renewal calendar, or from a contract with no notice date.

1. The **To do** list on the left shows each contract with badges for what is missing: **No end date** or **No notice period**. The bar shows how many you have completed in this visit.
2. The selected contract shows, under **As recorded**, what was written down about its term: **Term and renewal (as recorded)**, **Date and resolution (as recorded)**, **Term** and **Document on file**. Read the contract itself if nothing was written down.
3. Enter the **Start date**, **End date**, **Notice period (days)** and **Renewal**. The line beneath shows the notice date the contract will get. Enter 0 days if no notice is needed. A contract that runs until ended needs no end date.
4. Select **Save and next** (or **Save** on the last one). The contract leaves the queue and the next one opens. **Skip for now** moves on without saving.

When the queue is empty the page says "Every contract has its dates".

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
2. For each clause, select **Present**, **Partial**, **Absent** or **Not assessed**. The choice is saved at once and the bar at the top updates.
3. To record what the contract says, select **Add wording**. Enter the contract's own words in the first box and a note, such as the clause number, in the second. They are saved when you move on from the boxes ("Saved" appears). **Hide wording** closes them; the wording stays visible under the clause.
4. When you have read the whole contract, **Mark the rest absent** marks every clause still **Not assessed** as **Absent**. Confirm with **Mark absent**. Clauses you have already assessed are left as they are.

The statuses mean:

- **Present**: the contract clearly contains the term.
- **Partial**: the term is there but hedged or incomplete.
- **Absent**: the contract does not contain it.

Every change is recorded in the contract's history.

## The security-terms matrix

The matrix shows every vendor against every clause on one page. Open **Security terms matrix** in the **Vendors** group, or select **Security terms matrix** on the vendor list.

- Vendors run down the page, most critical first. Clauses run across. The vendor column and the clause headings stay in view as you scroll.
- Each cell is coloured and marked: a tick on green for **Present**, a half-filled circle on amber for **Partial**, a cross on red for **Absent**, and a dot in a dashed box for **Not assessed**. The legend at the top repeats this.
- When a vendor has several contracts, the cell shows the weakest position among them: absent outranks partial, which outranks present. Contracts with the status **Ended** are left out.
- The **Coverage** column gives each vendor's bar and the number of clauses present. The bottom row, **Vendors with the term**, gives each clause's bar and how many of the vendors shown have it.
- Tiles above the grid count the **Vendors shown**, the share of **Terms present**, the cells **Absent** (with the number partial) and the cells **Not assessed**.

To use it:

1. Type in **Search vendors** to find a vendor by name.
2. Use **Criticality** to limit the matrix to, for example, critical and high vendors.
3. Choose **All vendors**, **With gaps** (any clause partial or absent) or **Not fully assessed**.
4. Point at a cell, or move to it with the `Tab` key, to read the clause text and note. With several contracts, each contract's text is listed. Point at a clause heading to read what to look for.
5. Select a cell to open that vendor's **Security terms** tab and update the checklist.

The filters are kept in the page address, so you can bookmark or share a filtered view. On a narrow window the grid scrolls sideways inside its frame.

## Evidence and expiry

Evidence is what a vendor sends to show its security is in order. Each item belongs to a vendor and, optionally, to one of that vendor's contracts.

### Record evidence

1. Open the vendor's **Evidence** tab, or a contract's **Evidence** tab, and select **New evidence item**. You can also use **Evidence** in the **Vendors** group, or **Create** then **Evidence item**.
2. Enter a **Title**.
3. Choose the **Type**: **Assurance report**, **Insurance certificate**, **Card-data attestation**, **Questionnaire** or **Other**.
4. Choose the **Vendor** if it is not already filled in, then the **Contract** if the evidence belongs to one. The **Contract** list shows only the chosen vendor's contracts.
5. Enter **Received on** and **Expires on**. The expiry cannot be before the date received.
6. Summarise what the evidence shows in **Note**.
7. Select **Save and attach the document**.
8. In **Attach the document**, drag the file onto the box or select **Choose files**. **Record new files as evidence** is ticked, so enter the **Collected on** date and, if the document has one, its **Expires on** date. The file is listed once it has been uploaded and checked.
9. Select **Done**. You can also attach the document later from the evidence item's **Files** tab.

### Expiry

The **Expiry** column shows a coloured chip:

| Chip | Meaning |
|---|---|
| Red, "Expired … ago" | The expiry date has passed |
| Amber, "Expires in …" | Expires within 90 days |
| Green, "Valid to …" | More than 90 days left |
| Grey, "No expiry" | No expiry date recorded |

To see everything that needs chasing, open **Expiring evidence** in the **Vendors** group.

1. Use **Look ahead** to choose **30 days**, **60 days**, **90 days**, **180 days** or **365 days**.
2. The tiles count the items **Already expired**, **Expires within 30 days** and expiring later in the period.
3. The items are listed in those groups, soonest first, each with its date, vendor, type and how long is left. Select the evidence to open it, or the vendor to open its **Evidence** tab.
4. Ask the vendor for a current copy. When it arrives, record it as a new evidence item so the old one remains as history.

## Vendor assessments

A vendor assessment is a set of security questions that you work through for a vendor, from a call with them or from what they have sent. Each question is answered **Yes**, **Partly**, **No** or **Not applicable**, and the answers give a score out of 100 and a list of gaps. The vendor does not sign in; you record the answers.

### Assess a vendor

1. Open the vendor and its **Assessment** tab.
2. Select **Start assessment** (or **Assess again** if the vendor has been assessed before). The questions open, grouped by section.
3. Choose an answer for each question. Answers are saved as you choose them, and the score so far is shown at the top. For **No** or **Partly**, a box opens for a note on what is missing.
4. Add **Overall notes** if useful, for example who answered.
5. You can select **Close and carry on later** at any time; the tab then shows **Continue assessment**. **Discard draft** throws the draft away.
6. When every question is answered, set **Assessed on** and select **Complete assessment**.

If **Save as an evidence item** is ticked (it is, unless you cannot add evidence), a **Questionnaire** evidence item is added for the vendor with the score and the number of gaps. **Evidence expires on** is optional: use it for when the vendor should be assessed again, so the expiry reminders prompt you.

### Scores and gaps

The score is the weighted share of the answers: **Yes** counts in full, **Partly** counts half, **No** counts nothing, and **Not applicable** questions are left out. Each question has a weight from 1 to 5. A score of 80 or more is **Strong**, 50 to 79 is **Some gaps**, and below 50 is **Weak**.

After completing, the **Assessment** tab shows the score, who assessed the vendor and when, and the **Outstanding gaps**: every question answered **No** or **Partly**, heaviest first. Select **Raise action** on a gap to add a follow-up action linked to the vendor; its priority comes from the question's weight. The gap then shows **Open action**.

Completed assessments cannot be changed or removed. They are listed under **History** with their score, gaps and question version; select **View** to open one.

### The questions

Open **Assessment questions** on the vendor list, or on the **Assessment** tab. Everyone who can view vendors can read them; people who administer vendors can change them.

1. Edit the **Name of the question set**, and for each question its text, its section, guidance for the person asking, and its weight, from **Weight 1** (counts least) to **Weight 5** (counts most).
2. Use the arrow buttons to reorder questions, the bin button to remove one, and **Add question** to add one.
3. Select **Save as version …**.

Each save makes a new version. New assessments use the latest version; completed assessments keep the version they were answered against. The **Versions** card lists every version.

## The renewal calendar and reminders

Open **Renewal calendar** in the **Vendors** group, or select **Renewal calendar** on the contract list. Contracts with the status **Expired** or **Ended** are left out.

- Tiles at the top count the contracts in each window, and **Cannot be placed** counts the open contracts with no notice date (select it to open [Complete the dates](#complete-the-dates)).
- **Notice dates in the next twelve months** marks each notice date in its month, coloured by how close it is. Point at a mark to see the contract; select it to open the contract.
- Below, an agenda lists the contracts window by window, each with its notice date, vendor, owner, value, how long is left, its reminders and an **If we do nothing** line.

With the reminder days as installed (120, 90, 60 and 30), the windows are:

| Window | What to do |
|---|---|
| **Notice date passed** | The last day to give notice has gone by. Check whether the contract renewed, and on what terms |
| **Notice due within 30 days** | Decide now: renew, renegotiate or give notice |
| **Notice due in 31 to 60 days**, **Notice due in 61 to 90 days**, **Notice due in 91 to 120 days** | Start the renewal decision and gather what is needed |
| **More than 120 days away** | No action needed yet |
| **Cannot be placed** | No notice date, so no reminder can be sent. Shows the **Term as recorded**; select **Complete the dates** to fill them in |

Contracts with "No owner" are highlighted; give every contract an owner so its reminders reach the person deciding.

### Reminders

A reminder is sent for each contract a set number of days before its notice date: 120, 90, 60 and 30 days as installed. The page subtitle states the days in use. Each reminder:

- appears in the notifications (the bell) of the contract's owner and of everyone who may edit contracts, so a contract with no owner still reaches someone;
- is written to the contract's **History** tab, such as "Renewal reminder (60 days)", and to the audit log.

Evidence expiry works the same way: 60, 30 and 7 days before an evidence item expires as installed, a reminder goes to everyone who may edit vendors and to the owner of the contract the evidence belongs to. Evidence that ran out more than 30 days before it was first seen is not announced.

The reminders of a contract are shown as small badges on the calendar and on the contract record:

| Badge | Meaning |
|---|---|
| Plain, for example **60d** | Planned: its date is still to come |
| Highlighted | Due: its date has arrived and it is sent within the hour |
| With a tick | Sent |
| Struck through | Skipped: several reminders were already overdue when the contract was entered, so only the nearest was sent |

Point at a badge, or move to it with the `Tab` key, to see its date.

If you change a contract's end date or notice period (or an evidence item's expiry date), its reminders are planned again from the new date.

### Change the reminder days

People who administer contracts see **Reminder days** on the renewal calendar.

1. Select **Reminder days**.
2. Enter the days in **Days before a contract's notice date** and **Days before evidence expires**, separated by commas, for example `120, 90, 60, 30`.
3. Select **Save reminder days**.

Each value must be a whole number of days from 1 to 3650, with no repeats and at most twelve. The change is recorded in the audit log. If notifications are not switched on in your installation, the dialog says so and reminders are recorded in history only.

## Not available yet

- Email delivery of reminders. They arrive as in-application notifications.
- Approval steps for signing or renewing a contract.
- A vendor's own sign-in. Vendors have no access and do not fill in assessments themselves; staff record everything.
