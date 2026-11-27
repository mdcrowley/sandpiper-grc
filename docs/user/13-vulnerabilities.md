# Vulnerabilities

A vulnerability finding is a weakness reported on a host by a scanner or an assessment. This part of the application keeps each finding from the day it is first seen until it is fixed, gives it a fix-by date from its severity, imports scanner exports without creating duplicates, and shows the position on a dashboard. Lists and record pages work as described in [Getting started](01-getting-started.md).

An administrator can switch vulnerabilities off under **Administration > Features** (see [Administration](09-administration.md#features)). Records are kept and return when it is switched back on.

## Who can see findings

Findings are security records. To see them you need **View** on **Vulnerabilities** and **View** on **Security incidents and restricted records**. Without both, the pages, searches, exports and counts show nothing. The default **Security lead** and **Administrator** roles have both. Roles are described in [Administration](09-administration.md).

Beyond viewing, on **Vulnerabilities**:

| To do this | You need |
|---|---|
| Add a finding by hand | **Create** |
| Assign, work, close or reopen a finding, or change several at once | **Edit** |
| Import findings | **Create** and **Edit** |
| Change the severity policy, load the known-exploited catalog, or merge duplicate findings | **Administer** |
| Raise a change from findings | **Create** on **Changes** as well |

## Find your way around

Open **Security > Vulnerabilities**. Five tabs sit under the page title:

| Tab | What it holds |
|---|---|
| **Findings** | The list of findings |
| **By finding** | One row per finding ID (or CVE) with every host it is on; see [Work one finding on many hosts](#work-one-finding-on-many-hosts) |
| **Dashboard** | Charts and totals; also found by its name, **Vulnerability dashboard**, in the search |
| **Imports** | Every imported file, and the import wizard |
| **Severity policy** | The days allowed to fix a finding, by severity, and the [known-exploited catalog](#the-known-exploited-catalog) |

## The findings list

The list opens on the findings that are still open (the filter **Closed: No**). Select **Clear all** under the search box to see every finding.

The tiles above the list each open the findings they count: **Open**, **Overdue**, **Critical and high, open**, **Known exploited, open** and **Fixed this month**.

The **View** menu beside **Filters** holds ready-made saved views, which you can keep, rename or delete like your own: **Open**, **Overdue**, **Open: critical and high**, **Open: known exploited**, **Open: no owner** and **Open: mine**. **All vulnerabilities** shows every finding.

The list is sorted by **Urgency**, most urgent first (see [Urgency](#urgency)); select a column heading to sort by it instead. You can search, select **Filters**, sort by a column, save a view and select **Export**. The search looks at the title, host name, IP address, finding ID, CVE and description. It matches whole words with their other forms (for example "gateways" finds "gateway") and, for a single word, any part of a word, so part of a host name, address or CVE number finds the finding too. Findings are found the same way in the global search. The address in the browser keeps the search, filters and sort, so you can bookmark a view or send it to a colleague.

The columns are the reference, title, **Severity**, **Host** (with the IP address and port beneath), **Status**, **Owner**, **Fix by**, **Age (days)** and **Urgency**. On a narrow screen the age and urgency columns are left out first. A red **Overdue** label follows a fix-by date that has passed. More columns, such as **CVSS**, **Exposure**, **Finding ID**, **System** and **Last seen**, can be switched on with the column button.

To change many findings at once, check them and select **Edit selected…**: you can set the **Owner**, **Status**, **Severity**, **Known exploited**, **Exposure**, **System** or **Asset** of all of them. Each finding is checked and recorded in its history as if you had changed it on its own page. When changes are in use, **Raise a change** in the same bar raises one change for every selected finding (see [Raise a change](#raise-a-change)).

### Urgency

Each open finding has an **Urgency** score, worked out every day from four things, multiplied together:

| Part | Weight |
|---|---|
| **Severity** | Critical 10, High 7, Medium 4, Low 2, Informational 0.5 (a severity added by an administrator counts 1) |
| **Exposure** | Internet-facing 2, Internal network 1, Isolated 0.5, not recorded 1 |
| **Known exploited** | 2 when the finding is known to be exploited, otherwise 1 |
| **Fix-by date** | Passed 2, within 7 days 1.5, within 30 days 1.2, later or none 1 |

For example, a high-severity finding on an internet-facing host that is known to be exploited and is past its fix-by date scores 7 × 2 × 2 × 2 = 56; a low one due in six months scores 2. Closed findings score 0. Set **Exposure** on the finding (or for many at once with **Edit selected…**) to say how reachable the host is.

## Add a finding by hand

Most findings arrive by import. To record one from a penetration test, a supplier notice or your own review:

1. Select **New vulnerability**, or **Create** then **Vulnerability**.
2. Enter the **Title** and choose the **Severity**.
3. Enter the **Host name**, the **IP address**, or both. Optionally enter the **Port**, the **Protocol** (such as `tcp` or `udp`) and the **Service**.
4. Enter what identifies the finding: the **Finding ID** from the tool that reported it, or the **CVE** identifiers separated by commas.
5. Optionally enter the **CVSS score** (0 to 10), check **Known exploited**, choose the **Exposure** (**Internet-facing**, **Internal network** or **Isolated**), set **First seen** (today when left empty), and choose the **Owner**, **System** and **Asset**. With no **Owner**, a finding on an asset or system takes one: the asset's owner, else the system's technical owner, else its business owner (active accounts only). The same happens when a finding with no owner is later linked to a system or asset, and to findings an import adds; an owner already set is never changed. You can also enter a **Description**, the **Solution** and the **Source** (where the finding came from).
6. Select **Create vulnerability**.

The finding gets a reference such as `VUL-00042`, the status **Open** and a fix-by date. When you enter only a host name or only an address that is already recorded for a host, the finding joins that host.

## The finding page

The line under the title shows the host, address, port and service. The band below shows the **Severity** and CVSS score, the **Fix by** date with a countdown, the **Age** and **First seen**, **Last seen** with the source, and the **Owner**. The countdown is green while there is time, amber when under a quarter of the period is left, and red with **Overdue by** once the date has passed. Notices under the band explain a shortened fix-by date (known exploited, or a critical system), a date set by hand, an accepted risk or a false positive.

- The **Finding** card holds the title, description, severity, score, owner, the linked **System** and **Asset**, and the **Source**.
- The **Host and identifiers** card holds the host name, IP address, port, protocol, service, finding ID, CVE and the first and last seen dates.
- The **Remediation** tab holds the **Solution**, your **Remediation notes**, the fix-by date and how the finding was closed.
- The **Actions** tab lists follow-up actions raised from the finding, for work that is bigger than the fix itself (for example replacing an end-of-life server). It appears when actions are in use; see [Risks, actions and obligations](06-risks-actions-obligations.md). Actions raised here are hidden from anyone who cannot see security records, like the finding.
- **Activity**, **Attachments**, **Related** and **History** work as on every record. Attach scan extracts or screenshots on **Attachments**. **History** shows every change, including severity changes made by an import.

### Notifications

When notifications are in use (see [Attachments and notifications](14-attachments-and-notifications.md)):

- The new **Owner** of a finding is told it has been assigned to them, unless they assigned it to themselves.
- Every hour the application checks for open findings past their fix-by date and tells each owner, once for each fix-by date. Someone with more than three such findings gets one notification with the count, which opens the list of them.
- Only people who may see security records are ever told about a finding. An owner who loses that permission stops receiving these notifications.

### Work a finding

The buttons at the top move a finding through its statuses.

| Button | What it does |
|---|---|
| **Assign** or **Reassign** | Sets the **Owner**, the person responsible for the fix |
| **Start remediation** | Changes the status from **Open** to **In remediation** |
| **Mark fixed** | Asks for the **Fixed on** date and notes, and changes the status to **Fixed** |
| **Close without a fix**, then **Accept the risk…** | Changes the status to **Risk accepted** |
| **Close without a fix**, then **False positive…** | Asks for a **Reason** and changes the status to **False positive** |
| **Reopen** | Returns a closed finding to **Open** and clears the fixed date |
| **Raise a change** | Raises a draft change to fix the finding (see [Raise a change](#raise-a-change)); shown on an open finding when changes are in use and you may create them |

Fixed, risk-accepted and false-positive findings are closed: they no longer count as open or overdue.

Under **Host and identifiers**, **See this finding on every host** opens the same finding on every other host it was reported on.

### Raise a change

Fixing a finding on a production system usually needs a change record. **Raise a change** (on a finding, on the **By finding** page, or for the selected rows of the list) creates a **Draft** change and opens it:

- The title names the finding and the hosts, such as "Fix: Outdated database engine on 3 hosts".
- **What will be done** lists each finding with its reference, host, port and fix-by date, followed by the scanner's solution; **Why it is needed** gives the severities and says whether any is known exploited or overdue.
- **Main system** and **Main asset** are filled in when all the findings share one.
- The change and each finding are linked (relation **fixes**), so the change appears under **Related** on every finding, and the findings on the change.
- Open findings move to **In remediation** when you may edit findings.

Fill in the plan, test and back-out steps on the change and submit it as usual (see [Change enablement](10-change-enablement.md)). Anyone who can see changes can read the change's description, which names the hosts and findings: shorten it if that is more than they should see. Raising a change needs the **Create** permission on changes.

### Work one finding on many hosts

The **By finding** tab lists one row for each finding identifier: the scanner's finding ID, else the CVE list, else the title. Each row shows the worst open severity, how many hosts have it, how many are open (and of how many), how many are overdue and unassigned, the oldest open finding's age, the earliest fix-by date and the highest urgency, most urgent first. A red **Known exploited** label marks a row with an open known-exploited finding. Use **Search** for a title, finding ID or CVE; clear **Only findings on more than one host** to see every finding, and check **Include findings closed on every host** to see those too.

Select a row's title to open it. The page lists every host with that finding: the host and port, the finding's reference, severity, status, owner, fix-by date, system and age, open findings first. With the **Edit** permission, check the hosts to work on (the box in the heading checks every open one) and choose:

- **Assign** to set the owner of all of them.
- **Mark fixed**, **Accept the risk** or **False positive**, which ask the same questions as on one finding.

Each finding is saved on its own with every rule, as if you had changed it on its page. When a rule refuses one (for example, an approver who is also the person recording a risk acceptance), the others are saved and the dialog lists the findings that were not, with the reason. **Raise a change for every open host** (or **for N selected**) raises one change for them.

### Accept a risk

A finding can only be marked **Risk accepted** when the decision is on record. In the **Accept the risk** dialog, do one of these:

- Choose the **Exception** that covers the finding. It must be approved and not past its expiry date. This field appears when the exceptions register is in use.
- Enter a **Justification** and choose who it was **Approved by**. The approver must be someone other than you.

The application refuses the change when neither is complete, and refuses to remove the justification while the finding stays accepted.

### Change the fix-by date

The fix-by date normally comes from the severity policy. To set it by hand:

1. Open the **Remediation** tab and select **Edit** on the **Fix-by date** card.
2. Enter the **Fix-by date override** and the **Reason for the override**. The reason is required.
3. Select **Save changes**.

A notice on the finding shows that the date was set by hand, with the reason. Clear the override to return to the policy date.

## The severity policy

The policy says how many days a finding may stay open, counted from the day it was first seen. Open the **Severity policy** tab.

| Severity | Days allowed at first start |
|---|---|
| **Critical** | 15 |
| **High** | 30 |
| **Medium** | 90 |
| **Low** | 180 |
| **Informational** | No fix-by date |

A finding marked **Known exploited** gets the **Critical** period when that is shorter than its own.

To change the policy, you need the permission to administer vulnerabilities:

1. Enter the days for each severity. Leave a severity empty for no fix-by date.
2. In **Known-exploited findings use the period for**, choose the severity whose period those findings borrow, or clear it for no shortening.
3. Optionally, under **Shorter periods for critical systems**, give a criticality a share of the period in percent (see below).
4. Select **Save policy**. **Discard changes** puts back what was saved.

Saving recalculates the fix-by date of every open finding, except those with a date set by hand. Closed findings keep the date they had. The change is recorded in the audit log.

### Shorter periods for critical systems

When the inventory is in use, each system has a criticality. The card **Shorter periods for critical systems** lists the criticality values; give one a share of the period to bring forward the fix-by dates of findings on systems with that criticality. For example, 50 gives a high-severity finding on such a system 15 days instead of 30. Leave a value empty for the whole period. The text beside each value shows the resulting days for every severity.

A finding takes its system from the **System** field, or from the system of its **Asset**. A notice on the finding explains when its date was shortened this way. When a system's criticality changes, its open findings follow within the hour. Findings with no system, and findings with a date set by hand, are not affected.

## The known-exploited catalog

The most important sign that a finding needs fixing first is that attackers are already using it. Public catalogs of vulnerabilities known to be exploited are published as files. The application never fetches them itself: download the catalog file (JSON or CSV) on a computer that can reach it, then load it here.

1. Open the **Severity policy** tab. The card **Known-exploited catalog** shows how many CVEs the catalog holds, when and by whom it was last loaded, and how many open findings are in it (select the number to list them).
2. Under **Catalog file**, choose the file. A JSON file needs a `vulnerabilities` list whose entries carry `cveID`; a CSV file needs a `cveID` (or `cve`) column. Other columns, such as the vendor, product, name, date added and due date, are kept when present. Rows without a valid CVE number are skipped.
3. Select **Load the catalog**.

Loading replaces the catalog with the file's contents and marks every open finding whose **CVE** field names a CVE in it as **Known exploited**, which also gives it the shorter fix-by period of the [severity policy](#the-severity-policy). The message says how many findings were newly marked. From then on, a finding that is added, imported or given new CVE numbers is checked against the catalog as it is saved; a person who sets **Known exploited** in the same save decides. No finding is ever unmarked by a new catalog, and closed findings are left as they are. Each load is recorded in the audit log. Loading needs the **Administer** permission on vulnerabilities.

## Import findings

The import reads a CSV export from any scanner or assessment tool. You tell it which column is which, check a dry run, then import. Nothing is written before you select the import button on the dry run.

### Step 1: choose the file

1. Open the **Imports** tab and select **Import findings**. The same button is on the findings list.
2. Choose the **CSV file**, or select **Paste text** and paste it into **CSV text**. The first row must hold the column names. The limits are 5 MB and 10,000 rows; split a larger file and import the parts one after another. A note under the box says how many columns and rows were found.
3. Enter the **Source**: a name for where the findings come from, such as the name of the scan. Use exactly the same name each time, because a later import is compared with earlier imports of the same source.
4. Optionally choose a **Saved mapping** from an earlier import.
5. Optionally choose an **Owner for new findings**. Findings this import adds are assigned to that person, who is told once when the import finishes. Findings already recorded keep their owner. With no owner chosen, a new finding matched to an asset or system takes the owner of that asset or system, as when it is entered by hand.
6. Select **Next: map columns**. With a saved mapping chosen you can instead select **Dry run with** and the mapping's name, which skips step 2.

Commas, semicolons, tabs and vertical bars are recognized as separators without being asked.

### Step 2: map the columns

The fields are in groups. Each field has a list of the columns found in the file, with the value from the first row beneath. Columns with familiar names are matched for you; change any that are wrong and leave the rest as **Not imported**. A group that still needs a column shows **Needs a column**; one that has what it needs shows **Ready**.

| Field | Notes |
|---|---|
| **Host name**, **IP address** | At least one is needed |
| **Finding ID**, **CVE**, **Title** | At least one is needed, to tell findings apart |
| **Severity**, **CVSS score** | At least one is needed |
| **Port**, **Protocol**, **Service**, **Known exploited**, **First seen**, **Last seen**, **Description**, **Solution** | Optional. A port may carry its protocol, such as `443/tcp`, when the file has no protocol column |

**How the first rows will be read** shows the first rows with the current mapping, and changes as you change it.

How values are read:

- **Severity** may be a word in any letter case (critical, high, medium or moderate, low, informational or info) or a number from 0 (informational) to 4 (critical). When it is empty, the severity is taken from the CVSS score: 9 and above critical, 7 and above high, 4 and above medium, above 0 low.
- Dates written year first, such as `2030-04-03`, are always understood. For dates such as `03/04/2030`, choose **Day first** or **Month first** under **Dates written like 03/04/2030 mean**.
- **Known exploited** accepts yes or no, true or false, 1 or 0.
- Only well-formed CVE identifiers are kept from the **CVE** column.

To reuse the mapping, enter a name in **Save this mapping as** and select **Save mapping**. Saving under an existing name replaces it.

Select **Next: dry run**.

### Step 3: check the dry run

The dry run shows exactly what the import would do.

| Tile | Meaning |
|---|---|
| **Will be added** | Findings not seen before |
| **Will be updated** | Known findings with a change, such as a later last-seen date or a different severity |
| **Will be reopened** | Findings that were marked fixed but are in this file |
| **Missing from file** or **Will be closed** | Open findings from earlier imports of this source that this file does not report |
| **Rows with errors** | Rows that cannot be imported, with the number of repeated rows |

Under the tiles, the tabs **Problems**, **New**, **Updated**, **No change**, **Missing from file** (called **To close** when **Close missing findings** is checked) and **Unmatched hosts** list the rows of each kind, each with its line number, host and port, finding, severity and the reason or the fields that change. Rows with errors are never imported: correct the file and start again, or import the rest.

How duplicates are avoided:

- A finding is recognized by its **host**, its **port** and its **identifier**. The identifier is the finding ID, or the CVE list when there is no ID, or the title when there is neither.
- The same weakness on two ports of one host (say 443 and 8443), or on the same port over two protocols (`53/tcp` and `53/udp`), is two findings. A port written without its protocol (`443`) matches the same port written with one (`443/tcp`). A finding with no port belongs to the host as a whole.
- Host names and addresses are reconciled. A host first reported only by its address and later by its name and address (or the other way round) is one host, and its findings are updated, not added again; the name is filled in. Two hosts with different names are never merged just because they share an address, because addresses are reused.
- A row that matches a known finding updates it: **Last seen** moves forward, and a change of severity, score or text is saved and shown in the finding's **History**. No second record is created.
- A row that repeats an earlier row of the same file is shown as **Repeated in file** and only the first is used.

Findings recorded before the port was part of the match keep working: the upgrade worked out their port and host from what was stored, and merged or removed nothing. Two such findings may now be the same finding; see [Duplicate findings](#duplicate-findings).

**Missing from file** lists the open findings from earlier imports of the same source that are absent. Check **Close missing findings** (on the column step, or on this tab) to mark them fixed, dated today; the dry run runs again and shows the new totals. Leave it unchecked unless the file is a complete scan of the same scope as before. Findings added by hand and findings from other sources are never closed this way.

**Unmatched hosts** lists hosts not found in the asset register, when the inventory is in use. A host is linked to an asset when its name matches the asset's name, tag or serial number, or its IP address matches. Findings for unmatched hosts are imported without an asset.

When the dry run is right, select the **Import** button, which shows the numbers it will write.

### Step 4: the summary

The summary repeats the tiles with the final numbers. **Open this import** goes to the import's page, and **Go to findings** to the list.

### Files that cannot be read

| Message | What to do |
|---|---|
| The file is larger than 5 MB, or has more than 10,000 rows | Split the file |
| This does not look like a text file | Export as CSV; a spreadsheet workbook must be saved as CSV first |
| A quotation mark opened on a line is never closed | Correct that line, or export again |
| The header row repeats a column name | Rename or remove the extra column |
| The file has a header row but no findings below it | Check that the export contains data |

## Import history

The **Imports** tab lists every import, newest first, with the source, file name, who imported it and the numbers of rows, new, updated and closed findings, and errors.

Select the date of an import to open its page. It shows the totals, the column mapping used, whether **Close missing findings** was on, any hosts not found in the asset register, and the findings last reported by that import. A finding moves to a newer import when that import reports it again, so an older import lists only what has not been seen since.

## The dashboard

Open the **Dashboard** tab. Every tile, bar, point and table number opens the findings behind it.

| Part | Shows |
|---|---|
| Tiles | **Open findings** with the change since last week, **Overdue**, **Known exploited, open**, **Open without an owner**, **Fixed this month** |
| **Open by severity** | Open findings for each severity |
| **Overdue by severity** | Open findings past their fix-by date |
| **Open by age** | Open findings in the bands 0-15, 16-30, 31-90, 91-180 and over 180 days since first seen, split by severity |
| **Open findings by week** | The number open at the end of each of the last twelve weeks, split by severity |
| **By severity** | Open, overdue, **Mean days to fix** and the number fixed |
| **Hosts with the most serious open findings** | The ten hosts with the worst open findings |
| **Overdue findings** | Overdue findings for each owner, with the two most serious severities, the rest, the total and the oldest fix-by date. When systems are in use, **By system owner** groups them instead by the owner of the system each finding is on (the technical owner, or the business owner when there is none) |

The weekly chart is drawn from counts the application stores once a day and after every import. It cannot be filled in for weeks before the application was in use, so a new installation shows the chart from its second week.

## Duplicate findings

Findings recorded before hosts were matched by name and address, and before ports were kept apart, can be the same finding twice: the same host, port and identifier, both open. When there are any, the findings list shows a notice with **Review the duplicates**, which opens **Duplicate findings** (also at `/vulnerabilities/duplicates`).

Each group lists its findings with how each was recorded, severity, status, first and last seen, owner, and how many comments and files it has. The first finding, an open one seen most recently, is suggested to keep. With the **Administer** permission on vulnerabilities:

1. Choose the finding to keep with **Keep**.
2. Select **Merge into …** and confirm. A merge cannot be undone, so you are asked to confirm your password if you have not done so in the last few minutes.

The other findings are removed. Their comments, files, links, tags and watchers move to the finding kept, which keeps its own status and owner and takes the earliest **First seen** and latest **Last seen** of the group. The kept finding's **History** records the merge with the details of every finding removed, and each removed finding's history records which finding it was merged into.

## Sample data

The `dev` sample data (never the `pilot` profile a real installation uses) adds about sixty invented findings on twelve invented hosts (the first one internet-facing, some isolated, the rest on the internal network), with the source **[Sample] Monthly network scan**, and several weeks of history for the weekly chart. To remove them, filter the list by searching for the source, then delete the findings.

## Not available yet

- A direct connection to a scanner that pulls findings on a schedule. Export a CSV file from the scanner and import it, or send it to the import through the API with an API token (see [API tokens](09-administration.md#api-tokens)).
- Closing findings by themselves when the change that fixes them is completed. Mark them fixed after the change, or let the next import close them.
- Exploit-probability scores. Only the known-exploited catalog is read.
