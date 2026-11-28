# Vendors and contracts

This part of the application records the organizations that supply you (scheduling software, fare collection, vehicle location services and so on), the contracts you hold with them, the security terms those contracts contain, the assurance evidence vendors send, your own security assessment of each vendor, and the dates by which you must decide whether to renew. Reassessment on a cadence, exclusion-list checks, vendor issues and offboarding when a contract ends are described in [Vendor risk lifecycle](34-vendor-risk-lifecycle.md). Lists and record pages work as described in [Getting started](01-getting-started.md).

An administrator can switch vendors and contracts off under **Administration > Features** if your organization does not use them here (see [Administration](09-administration.md#features)). Records are kept and return when it is switched back on.

## Vendors

Open **Vendors > Vendors**. Its tabs are **Vendors**, **Reassessments due**, **Issues**, **Offboarding**, **Security terms** and, for people who administer vendors, **Assessment questions** and **Intake questions**. Besides the usual columns, the list shows:

- **Security terms**: a small bar for the vendor's contracts, green for clauses present, amber for partial, red for absent and gray for not assessed, with the number present out of the number of clauses. Point at it to read the counts. "No contract" means nothing is recorded yet.
- **Next notice date**: the nearest notice date still to come (or the latest one that has passed), colored as on the contract list.

- **Annual spend**: the sum of the **Annual value** of the vendor's active contracts (see [Annual value](#annual-value)); empty when it has none with a value. Sort by it to see where the money goes.

These three columns appear only if you may view contracts. Under the list, **Annual spend with all vendors** gives the total for the year over every vendor, with how many have spend. It is a figure, so it is the same for everyone and does not change with the list's search or filters. The **Security terms** tab shows the matrix. People who administer vendors change the questions used in vendor assessments on their own tab; readers without that tab have an **Assessment questions** button instead.

### Add a vendor

1. Select **New vendor**, or **Create** then **Vendor**.
2. Enter the **Name**. Two vendors cannot have the same name.
3. Describe what they supply in **Services**.
4. Choose the **Criticality**: **Critical**, **High**, **Medium** or **Low**. This is how much the organization depends on the vendor, and it sets how often the vendor is reassessed (see [Reassessment on a cadence](34-vendor-risk-lifecycle.md#reassessment-on-a-cadence)).
5. Choose the **Vendor owner**: the person reminded when the vendor's reassessment or exclusion-list check comes due.
6. Enter the **Remote access method** if the vendor connects to your systems. It also adds remote-access items to the vendor's offboarding checklist.
7. Enter the **Incident contact**, **Incident contact phone** and **Incident contact email**: the person to reach when something goes wrong.
8. Add any **Notes** and select **Create vendor**.

The vendor gets a reference such as `VND-00007` and its status starts as **Active**. The other statuses are **Prospective** and **Former**; change the status by editing the **Details** card.

### The vendor profile

The top of a vendor's page is a profile of the facts that matter most, one panel each:

| Panel | Shows |
|---|---|
| **In an incident, call** | The incident contact from the **Details** card and any contacts checked as incident contacts, with phone and email links. "Nobody recorded" if there is none. **All contacts** opens the **Contacts** tab |
| **Contracts and next notice date** | The most urgent notice date of an open contract: a notice date that has passed (the latest one) comes first, in red, with its contract and what happens if nobody acts, and the next date still to come under it; otherwise the nearest date still to come and how long is left. It also says how many notice dates have passed when there are several, and how many open contracts have no notice date. Ended (expired or terminated) contracts are left out. Shown only if you may view contracts |
| **Security terms** | How many clauses are present across the vendor's contracts, with a bar and counts for present, partial, absent and not assessed. **Open the checklist** opens the **Security terms** tab |
| **Evidence** | How many evidence items are current, how many have expired or expire within 90 days, and when the newest was received |
| **Assessment** | The score of the latest completed assessment, how many gaps it found and when it was done, or "Not assessed". **Open the assessment** (or **Start an assessment**) opens the **Assessment** tab |

The panel's border turns amber or red when something needs attention: a notice date within 120 or 30 days, expired evidence, or a low assessment score.

Below the profile, a strip repeats **What they supply**, **Criticality**, **Remote access**, **Systems supplied** and **Last changed**, and the **Details** card holds every field for editing.

| Tab | What it holds |
|---|---|
| **Contracts** | This vendor's contracts. **New contract** adds one with the vendor filled in |
| **Security terms** | The security-terms checklist for each of the vendor's contracts |
| **Evidence** | Assurance evidence received from the vendor |
| **Assessment** | The vendor security assessment: the latest score and gaps, an assessment in progress, and the history |
| **Intake and checks** | The vendor's risk tier from its intake questionnaire, why, and the checks the tier needs before a contract becomes active; see [Intake and risk tiers](34-vendor-risk-lifecycle.md#intake-and-risk-tiers) |
| **Lifecycle** | When the vendor is next reassessed, its exclusion-list checks, its issues and its offboardings; see [Vendor risk lifecycle](34-vendor-risk-lifecycle.md) |
| **Contacts** | The people you deal with |
| **Systems supplied** | Systems whose **Vendor** field points to this vendor; see [Inventory](03-inventory.md) |
| **Actions** | Follow-up actions raised for this vendor, including those raised from assessment gaps. Shown when the action tracker is switched on |

## Contacts

To add a contact:

1. Open the vendor and its **Contacts** tab.
2. Select **Add contact**.
3. Enter the **Name**, and optionally the **Role**, **Email** and **Phone**.
4. Check **Incident contact** if this is the person to reach when there is a security incident involving the vendor.
5. Select **Add contact**.

Incident contacts are listed first with a red **Incident contact** badge, and appear in the profile's **In an incident, call** panel. Email addresses and phone numbers are links you can select to start a message or call.

To change a contact, select the pencil button on its row, then **Save changes**. To remove one, select the trash button and confirm with **Remove**. Changes are kept in the vendor's history.

## Contracts

Open **Vendors > Contracts**; its tabs are **Contracts**, **Renewals** and **Performance**. The list is sorted by notice date, soonest first, and the **Notice date** column is a colored chip: red when the date has passed or is within 30 days, amber within 120 days, green beyond that, and gray ("No notice date") when there is none. An ended contract (expired or terminated) needs no notice: its notice date is shown as plain gray text and never in red.

The list also shows **End date** and **Annual value**; **Total value** is in the column chooser. Under the list, **Annual value of all active contracts** gives the total for the year, how many contracts are active and how many of them have no value recorded. It counts every active contract, whoever is looking and whatever the list is filtered to.

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
- **If we do nothing**: one sentence saying what happens if nobody acts, worked out from the renewal type. For example, "It renews automatically on Dec 31, 2027 for a further term, at whatever price the contract allows", or "It ends on Dec 31, 2027. The service stops unless a new contract is agreed before then."
- A bar from the start of the term to its end, marking today, the notice date and the closed period after it.
- A **Time to give notice** countdown, the sum it is worked out from (for example "End date Dec 31, 2027 less 90 days' notice"), and the contract's **Reminders** (see [Reminders](#reminders)).

The panel is green, amber within 120 days and red within 30 days or once passed. For a contract with the status **Expired** or **Ended**, it says the contract has ended and no reminders are sent. With no end date it shows **Not set** and points you to [Complete the dates](#complete-the-dates).

Below it:

- **Details**, in three sections: **Agreement**, **Dates and renewal**, and **Value and approval**. **Value and approval** holds the **Total value**, the **Approval or resolution number** (the number of the decision that approved the contract, such as a board resolution, a purchase approval or a delegated-authority reference) and **Notes**. Your administrator may have renamed that field, for example to **Board resolution** or **Approval reference**, or switched it off under **Administration > Features** if your contracts are not approved that way; the section is then called **Value**, and the field is left out of the list columns, exports and imports too (see [Features](09-administration.md#options-within-the-parts)).
- **Value by year**: the contract's value year by year (see below).
- **As recorded in the contract register**: free-text notes carried over from an earlier register, such as **Document on file** and **Term and renewal (as recorded)**.

The header has **Start offboarding**, which starts an offboarding checklist for the contract by hand, or **Open offboarding** once it has one (an offboarding also starts by itself when the contract's status becomes **Expired** or **Ended**; see [Offboarding](34-vendor-risk-lifecycle.md#offboarding)). A contract can be made **Active**, and an active contract moved to another vendor, only once every check its (new) vendor's risk tier needs is done or waived (see [Intake and risk tiers](34-vendor-risk-lifecycle.md#intake-and-risk-tiers)); a draft contract's page says which are missing. When your administrator has asked for it, it also needs a recent exclusion-list check of its vendor (see [Exclusion-list checks](34-vendor-risk-lifecycle.md#exclusion-list-checks)).

The tabs are **Security terms**, **Evidence**, **Performance** (measures with targets and periodic scores; see [Contractor performance](#contractor-performance)), **Actions** (when the action tracker is switched on), **Funder clauses** (when funding and grant compliance is switched on and you may see funding records), and the usual **Activity**, **Attachments**, **Related** and **History**. Attach the signed contract and its schedules on the **Attachments** tab. **Funder clauses** is a checklist of the clauses required by each award that pays for the contract; see [Funder-required clauses on contracts](27-funding-and-grants.md#funder-required-clauses-on-contracts). A contract made from a procurement award shows the solicitation under **Related** (see [Procurement and budgets](44-procurement-and-budgets.md#the-resulting-contract)).

### Value by year

1. On the **Value by year** card, select **Add years** (or **Edit** once there are figures).
2. Enter a **Year** and an **Amount** in the organization's currency. Select **Add year** for each further year, or the trash button to remove one.
3. The card shows the **Total of the years** and compares it with the contract's **Total value**: "Matches the total value", or how much more or less it is.
4. Select **Save years**. If the total differs, **Save and set total value to …** saves the years and makes their total the contract's total value.

Each year can appear once. Saved figures are shown as a small table with a bar per year.

### Annual value

The **Annual value** of a contract is worked out by the application, never typed:

1. this year's line of **Value by year**, when there is one;
2. otherwise the average of the years given;
3. otherwise the **Total value** spread over the term from **Start date** to **End date**, counted in whole months and at least one year (a three-year contract worth 90,000 has an annual value of 30,000), or the whole total value when the dates are missing.

It is worked out again whenever the contract is saved, and every few hours, so a new year moves it to that year's line. Only active contracts count toward a vendor's **Annual spend**.

### The computed notice date

The notice date is the last day on which you can give notice. You do not type it; the application works it out:

**Notice date** = **End date** minus **Notice period (days)**

- A contract ending on December 31 with a 90-day notice period has a notice date of October 2.
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
| **Multi-factor sign-in** | Multi-factor authentication for vendor staff and for the organization's users |
| **Breach notice time** | A fixed deadline for telling the organization about a security incident |
| **Data ownership and return** | The organization owns its data and gets it back, or has it destroyed, on exit |
| **Recovery times and service levels** | Stated recovery time and recovery point, uptime and remedies |
| **Cyber insurance** | Cyber liability cover with stated limits |
| **Liability carve-out** | Data breach and confidentiality losses sit outside the liability cap |
| **Subcontractors** | Subcontractors are disclosed and held to the same security terms |
| **Named security standard** | The vendor commits to a named, recognized security standard |

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

The security terms and the funder-required clauses (see [Funder-required clauses on contracts](27-funding-and-grants.md#funder-required-clauses-on-contracts)) are kept by one clause-checklist engine; what was recorded before it arrived was moved across when the application was upgraded.

## The security-terms matrix

The matrix shows every vendor against every clause on one page. Open **Vendors > Vendors** and the **Security terms** tab.

- Vendors run down the page, most critical first. Clauses run across. The vendor column and the clause headings stay in view as you scroll.
- Each cell is colored and marked: a check mark on green for **Present**, a half-filled circle on amber for **Partial**, a cross on red for **Absent**, and a dot in a dashed box for **Not assessed**. The legend at the top repeats this.
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

1. Open the vendor's **Evidence** tab, or a contract's **Evidence** tab, and select **New evidence item**. You can also use **Vendors > Evidence**, or **Create** then **Evidence item**.
2. Enter a **Title**.
3. Choose the **Type**: **Assurance report**, **Insurance certificate**, **Card-data attestation**, **Questionnaire** or **Other**.
4. Choose the **Vendor** if it is not already filled in, then the **Contract** if the evidence belongs to one. The **Contract** list shows only the chosen vendor's contracts.
5. Enter **Received on** and **Expires on**. The expiry cannot be before the date received.
6. Summarize what the evidence shows in **Note**.
7. Select **Save and attach the document**.
8. In **Attach the document**, drag the file onto the box or select **Choose files**. **Record new files as evidence** is checked, so enter the **Collected on** date and, if the document has one, its **Expires on** date. The file is listed once it has been uploaded and checked.
9. Select **Done**. You can also attach the document later from the evidence item's **Files** tab.

### Expiry

The **Expiry** column shows a colored chip:

| Chip | Meaning |
|---|---|
| Red, "Expired … ago" | The expiry date has passed |
| Amber, "Expires in …" | Expires within 90 days |
| Green, "Valid to …" | More than 90 days left |
| Gray, "No expiry" | No expiry date recorded |

To see everything that needs chasing, open **Vendors > Evidence** and the **Expiring** tab. It is the one **Expiring evidence** page: it opens on vendor evidence, and its **Source** filter also shows evidence library records and evidence files attached to any record you can see; choose how far ahead to look (30 to 365 days). Select an item to open it, ask the vendor for a current copy, and record it as a new evidence item so the old one remains as history. See [Attachments and notifications](14-attachments-and-notifications.md#expiring-evidence).

### One expiry date for the item and its file

An evidence item has its own **Expires on** date, and a file attached to it as evidence may carry another. Only the item's date drives the reminders and the lists above. When the two disagree (for example, you attach a renewed certificate that runs a year longer, or the item has no date but the file does), the evidence page shows **The expiry dates do not agree**, with each date. With **Edit** on vendors:

- **Use … for the item** copies that file's date onto the evidence item; its reminders are planned again from the new date.
- **Set the file to …** (or **the files**) copies the item's date onto its evidence files.

The notice appears as soon as a file with another date is attached, and both changes are recorded in the item's history.

## Vendor assessments

A vendor assessment is a set of security questions that you work through for a vendor, from a call with them or from what they have sent. Each question is answered **Yes**, **Partly**, **No** or **Not applicable**, and the answers give a score out of 100 and a list of gaps. The vendor never signs in: you record the answers, or, when an administrator has switched it on, you send the vendor a link to answer for themselves and then review what they said.

### Assess a vendor

1. Open the vendor and its **Assessment** tab.
2. Select **Start assessment** (or **Assess again** if the vendor has been assessed before). The questions open, grouped by section.
3. Choose an answer for each question. Answers are saved as you choose them, and the score so far is shown at the top. For **No** or **Partly**, a box opens for a note on what is missing.
4. Add **Overall notes** if useful, for example who answered.
5. You can select **Close and carry on later** at any time; the tab then shows **Continue assessment**. **Discard draft** throws the draft away.
6. When every question is answered, set **Assessed on** and select **Complete assessment**.

If **Save as an evidence item** is checked (it is, unless you cannot add evidence), a **Questionnaire** evidence item is added for the vendor with the score and the number of gaps. **Evidence expires on** is optional. Completing an assessment also works out the vendor's **Next assessment due** from its criticality, and the vendor's owner is reminded before then (see [Reassessment on a cadence](34-vendor-risk-lifecycle.md#reassessment-on-a-cadence)).

### The vendor answers through a link

When **Let vendors answer through a link** is on (see below), a draft assessment shows **Vendor's own answers** at the top:

1. Select **Create link**. Optionally say **Who it is for**, and how many **Days it works** (the default is set by the administrator, at most 90).
2. Send the link to your contact at the vendor, in one of two ways:
   - Email it from the application (only when email is set up, under **Administration > Email**): fill in **Email it to** and select **Create and email link**. The application sends the link to that address; nobody, you included, sees it.
   - Send it yourself: leave **Email it to** empty, select **Create link**, then **Copy link** and send it. It is shown **only once**.

   Either way, if the link is lost, make a new one (**New link**, or **Send a new link** when the last one was emailed): the earlier link then stops working.
3. The vendor opens the link without an account, answers each question (with a note where it helps), can **Save and finish later** while the link lasts, and finally **Send answers** with their name. Every question must be answered first. Until they send their answers, they can also send **Supporting files** (see [Files from the vendor](#files-from-the-vendor)).
4. The panel shows whether the link has been opened, how many questions are answered so far, when the answers were sent, and, for an emailed link, the address, when it was sent and when a reminder went. Whoever created the link is notified when the answers are sent.
5. Under **answers from the vendor to review**, each answer that differs from the assessment is listed. **Take over** copies one into the assessment, **Take over all** copies them all. Nothing the vendor says counts until you take it over, and you can still change any answer before you **Complete assessment**.

**Withdraw link** stops a link at once; answers and files already sent stay for review. A link also stops working when it expires, when the assessment is completed or discarded, and when the feature is switched off. The vendor sees the questions, their guidance, their own answers and the files they sent only: never the weights, the score or your answers. Opening, sending, creating, emailing and withdrawing links, files sent, refused, taken over or discarded, and answers taken over, are recorded in the vendor's history. The link's page refuses too many requests from one address.

#### The email

The email names your organization (the application name), the vendor and the assessment, and says until when the link works; it has a plain-text and an HTML version. The link itself is never stored, shown to staff, or written to the delivery log or the audit log: it is kept encrypted in the queued message until it is sent. A link can be emailed at most 5 times a day for one assessment.

If the vendor has not sent their answers a set number of days before an emailed link expires (2 as installed), the application sends one reminder to the same address. The reminder cannot repeat the link: it asks them to use the earlier email, or to ask you for a new link.

An administrator can word both messages under **Administration > Email > Templates**: **Vendor response link** (placeholders `{{organization}}`, `{{vendorName}}`, `{{assessmentTitle}}`, `{{expiresAt}}` and `{{link}}`) and **Vendor response link reminder** (the same without `{{link}}`, plus `{{sentAt}}`, when the link was emailed).

#### Files from the vendor

While the link works and before they send their answers, the vendor can send files that back their answers, such as a certificate or an assurance report, with an optional note on what the files show. They can remove a file they sent until they send their answers.

- Every file goes through the same checks as any upload: the allowed types (see [Attachments and notifications](14-attachments-and-notifications.md)), the content compared with the type its name claims, the malware scanner when one is set up, and the size limit. On top of that, a link takes only the **File types vendors may send**, up to **Files a vendor may send per link** and **Total size per link** (see below). A refused file is not kept, and the refusal is recorded in the vendor's history.
- A file the vendor sends is **not** attached to anything. It waits on the link, under **files from the vendor to review** in the **Vendor's own answers** panel, with its size, when it was sent, the vendor's note and whether it was scanned.
- Select the file name to download it and look at it. Then select **Take over** to keep it as **Evidence of the vendor** (with an optional **Expires on** date) or as **An ordinary file**: it moves to the vendor's **Attachments** tab, and search can then find the vendor by the words inside it. Or select **Discard**: the file is deleted at once and cannot be brought back. The vendor is not told either way.
- Files stay for review after the link expires, is withdrawn or replaced, or the assessment is completed, but not for ever: a file still waiting **Discard unreviewed files after the link closes (days)** after the link closed (30 as installed; the link closes when the answers are sent, or it expires or is withdrawn) is discarded by a daily check, like a file you discard, and the discard is recorded in the vendor's history. Three days before, the person who created the link gets a **Reminders** notification saying how many files will go. Set the number of days to 0 to keep waiting files until someone decides.

### Scores and gaps

The score is the weighted share of the answers: **Yes** counts in full, **Partly** counts half, **No** counts nothing, and **Not applicable** questions are left out. Each question has a weight from 1 to 5. A score of 80 or more is **Strong**, 50 to 79 is **Some gaps**, and below 50 is **Weak**.

After completing, the **Assessment** tab shows the score, who assessed the vendor and when, and the **Outstanding gaps**: every question answered **No** or **Partly**, heaviest first. Select **Raise action** on a gap to add a follow-up action linked to the vendor; its priority comes from the question's weight. The gap then shows **Open action**.

Completed assessments cannot be changed or removed. They are listed under **History** with their score, gaps and question version; select **View** to open one.

### The questions

Open **Assessment questions** on the vendor list, or on the **Assessment** tab. Everyone who can view vendors can read the questions; people who administer vendors can also change them.

1. Edit the **Name of the question set**, and for each question its text, its section, guidance for the person asking, and its weight, from **Weight 1** (counts least) to **Weight 5** (counts most).
2. Use the arrow buttons to reorder questions, the trash button to remove one, and **Add question** to add one.
3. Select **Save as version …**.

Each save makes a new version. New assessments use the latest version; completed assessments keep the version they were answered against. The **Versions** card lists every version.

The **Vendors answering for themselves** card (people who administer vendors can change it) has:

- **Let vendors answer through a link**: off as installed. Switching it on asks you to confirm it is you (your password, and your second factor if you have one), because it opens a way in for people outside your organization. Switching it off stops every open link.
- **Days a new link works**: from 1 to 90, 14 as installed. Staff can choose another length for each link.
- **Files a vendor may send per link**: from 0 (no files) to 50, 10 as installed.
- **Total size per link (MB)**: from 1 to 500, 50 as installed. Each file is also held to the upload limit under **File settings**.
- **File types vendors may send**: separated by commas; as installed csv, doc, docx, jpeg, jpg, pdf, png, pptx, txt, xls and xlsx. Only types also allowed under **File settings** are accepted, so this list can narrow what may be uploaded but never widen it.
- **Reminder before an emailed link expires (days)**: from 0 (no reminder) to 30, 2 as installed.
- **Discard unreviewed files after the link closes (days)**: from 0 (never) to 365, 30 as installed.

Select **Save file and reminder settings** after changing any of the last five.

## The renewal calendar and reminders

Open **Vendors > Contracts** and the **Renewals** tab, or select **Renewal calendar** on the contract list. Contracts with the status **Expired** or **Ended** are left out.

- Tiles at the top count the contracts in each window, and **Cannot be placed** counts the open contracts with no notice date (select it to open [Complete the dates](#complete-the-dates)).
- **Notice dates in the next twelve months** marks each notice date in its month, colored by how close it is. Point at a mark to see the contract; select it to open the contract.
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

- appears in the notifications (the bell) of the contract's owner and of everyone who may edit contracts, so a contract with no owner still reaches someone. Each person can also have **Reminders** sent by email in their notification preferences (see [Preferences](14-attachments-and-notifications.md#preferences));
- is written to the contract's **History** tab, such as "Renewal reminder (60 days)", and to the audit log.

Evidence expiry works the same way: 60, 30 and 7 days before an evidence item expires as installed, a reminder goes to everyone who may edit vendors and to the owner of the contract the evidence belongs to. Evidence that ran out more than 30 days before it was first seen is not announced.

The reminders of a contract are shown as small badges on the calendar and on the contract record:

| Badge | Meaning |
|---|---|
| Plain, for example **60d** | Planned: its date is still to come |
| Highlighted | Due: its date has arrived and it is sent within the hour |
| With a check mark | Sent |
| Struck through | Skipped: several reminders were already overdue when the contract was entered, so only the nearest was sent |

Point at a badge, or move to it with the `Tab` key, to see its date.

If you change a contract's end date or notice period (or an evidence item's expiry date), its reminders are planned again from the new date.

### Change the reminder days

People who administer contracts see **Reminder days** on the renewal calendar.

1. Select **Reminder days**.
2. Enter the days in **Days before a contract's notice date** and **Days before evidence expires**, separated by commas, for example `120, 90, 60, 30`.
3. Select **Save reminder days**.

Each value must be a whole number of days from 1 to 3650, with no repeats and at most twelve. The change is recorded in the audit log. If notifications are not switched on in your installation, the dialog says so and reminders are recorded in history only.

## Contractor performance

A contract can carry **performance measures**, each with a target, and a score is recorded for each month, quarter or year with a comment. The contract's **Performance** tab shows whether each score met the target and which way the measure is heading. Reading needs `contracts.view`; adding measures and recording scores needs `contracts.edit`.

### Add a measure

1. Open the contract and its **Performance** tab, and select **Add a measure**.
2. Fill in:
   - **Measure**: what is measured, for example "Shelters cleaned on schedule" or "Hours to fix a fault".
   - **Target** and **Unit** (such as `%`, `hours` or `count`).
   - **Better when**: **Higher** (the target is a minimum) or **Lower** (the target is a maximum).
   - **Scored**: **Monthly**, **Quarterly** or **Yearly**. It cannot change once a score is recorded.
   - **How it is measured**: optional.
3. Select **Add the measure**.

To change a measure, use its pencil button. Switch off **Still scored** to stop asking for scores but keep the history; the bin button removes the measure and its scores (refused while the contract is under a legal hold).

### Record a score

Select **Score** on the measure's line, choose the **Period** (it offers the score that is due, otherwise the latest period not yet scored), enter the **Score** and a **Comment** about what happened and what was agreed with the contractor, and select **Record the score**. The form says at once whether the score meets the target. Each period can be scored once; to change a score, open the measure (select its name) and use the pencil button beside the score, or the bin button to remove one recorded in error. If someone else changed the score since you opened it, you are asked to reload.

### Reading the tab

- The tiles count the measures still scored, how many **met** or fell **below** the target at their latest score, and how many **scores are due**.
- Each measure shows its target, its latest score (green when it met the target, red when below), a small line of the recent scores with the target dashed, the **Trend**, how many scores met the target, and **Due** with the period when the last month, quarter or year has ended without a score (on contracts that are not expired or ended).
- **Trend** follows the line that best fits the last six scores: **Improving** or **Worsening** (turned so that improving is always the better way, also for "lower is better" measures), or **Steady** when the change along it is no more than 0.5% of the target. It needs two scores.
- Select a measure's name for its chart against the target and every score with its comment and who recorded it.

Every measure and score, and every change, is recorded in the contract's history. Anonymizing a contract at the end of its retention period also clears the comments and who recorded the scores.

### Across contracts

The **Performance** tab of **Vendors > Contracts** lists every contract with measures, those with measures below target first: how many met their target at the latest score, which fell below, how many are worsening and how many scores are due. Vendor names show to people who may see vendors.

## Not available yet

- A built-in approval for signing or renewing a contract. An administrator can set up an approval workflow for contracts instead, for example one that starts when a contract's status changes (see [Approval workflows](22-approval-workflows.md)).
- A vendor's own sign-in. Vendors can answer an assessment and send files through a link, but cannot see anything else.
