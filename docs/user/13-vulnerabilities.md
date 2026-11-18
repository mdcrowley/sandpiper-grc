# Vulnerabilities

A vulnerability finding is a weakness reported on a host by a scanner or an assessment. This part of the application keeps each finding from the day it is first seen until it is fixed, gives it a fix-by date from its severity, imports scanner exports without creating duplicates, and shows the position on a dashboard. Lists and record pages work as described in [Getting started](01-getting-started.md).

## Who can see findings

Findings are security records. To see them you need the vulnerabilities permission and the permission to view security records. Without both, the pages, searches, exports and counts show nothing. The default **Security lead** and **Administrator** roles have both. Roles are described in [Administration](09-administration.md).

## Find your way around

Open **Vulnerabilities** in the **Cybersecurity** group. Four tabs sit under the page title:

| Tab | What it holds |
|---|---|
| **Findings** | The list of findings |
| **Dashboard** | Charts and totals; also reached from **Vulnerability dashboard** in the menu |
| **Imports** | Every imported file, and the import wizard |
| **Severity policy** | The days allowed to fix a finding, by severity |

## The findings list

The buttons above the list are quick views. The number on each is how many findings it holds.

| Quick view | Shows |
|---|---|
| **Open** | Findings not yet fixed or otherwise closed |
| **Overdue** | Open findings past their fix-by date |
| **Critical and high** | Open findings of those two severities |
| **Known exploited** | Open findings marked as known to be exploited |
| **Fixed this month** | Findings closed with a fixed date in the current month |
| **All** | Every finding |

Within a quick view you can still search, select **Filters**, sort by a column, save a view and select **Export**. The search looks at the title, host name, IP address, finding ID, CVE and description.

The columns are the reference, title, **Severity**, **CVSS**, **Host** (with the IP address and port beneath), **Status**, **Owner**, **Fix by** and **Age (days)**. A red **Overdue** label follows a fix-by date that has passed.

## Add a finding by hand

Most findings arrive by import. To record one from a penetration test, a supplier notice or your own review:

1. Select **New vulnerability**, or **Create** then **Vulnerability**.
2. Enter the **Title** and choose the **Severity**.
3. Enter the **Host name**, the **IP address**, or both. Optionally enter the **Port** and **Service**.
4. Enter what identifies the finding: the **Finding ID** from the tool that reported it, or the **CVE** identifiers separated by commas.
5. Optionally enter the **CVSS score** (0 to 10), tick **Known exploited**, set **First seen** (today when left empty), and choose the **Owner**, **System** and **Asset**.
6. Select **Create vulnerability**.

The finding gets a reference such as `VUL-00042`, the status **Open** and a fix-by date.

## The finding page

The band under the title shows the **Severity** and CVSS score, the **Fix by** date with a countdown, the **Age**, **First seen**, **Last seen** and the **Owner**. The countdown is green while there is time, amber when under a quarter of the period is left, and red with **Overdue by** once the date has passed.

- The **Finding** card holds the title, description, severity, score, owner, the linked **System** and **Asset**, and the **Source**.
- The **Host and identifiers** card holds the host name, IP address, port, service, finding ID and CVE.
- The **Remediation** tab holds the **Solution**, your **Remediation notes**, the fix-by date and how the finding was closed.
- **Activity**, **Related** and **History** work as on every record. **History** shows every change, including severity changes made by an import.

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

Fixed, risk-accepted and false-positive findings are closed: they no longer count as open or overdue.

### Accept a risk

A finding can only be marked **Risk accepted** when the decision is on record. In the **Accept the risk** dialog, do one of these:

- Choose the approved **Exception** that covers the finding. This field appears when the exceptions register is in use.
- Enter a **Justification** and choose who it was **Approved by**.

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
3. Select **Save policy**.

Saving recalculates the fix-by date of every open finding, except those with a date set by hand. Closed findings keep the date they had. The change is recorded in the audit log.

## Import findings

The import reads a CSV export from any scanner or assessment tool. You tell it which column is which, check a dry run, then import. Nothing is written before you select the import button on the dry run.

### Step 1: choose the file

1. Open the **Imports** tab and select **Import findings**. The same button is on the findings list.
2. Choose the **CSV file**, or paste the text into **Or paste the CSV text**. The first row must hold the column names. The limits are 5 MB and 10,000 rows; split a larger file and import the parts one after another.
3. Enter the **Source**: a name for where the findings come from, such as the name of the scan. Use exactly the same name each time, because a later import is compared with earlier imports of the same source.
4. Optionally choose a **Saved mapping** from an earlier import.
5. Select **Next: map columns**. With a saved mapping chosen you can instead select **Dry run with** and the mapping's name, which skips step 2.

Commas, semicolons, tabs and vertical bars are recognised as separators without being asked.

### Step 2: map the columns

Each field has a list of the columns found in the file. Columns with familiar names are matched for you; change any that are wrong and leave the rest as **Not imported**.

| Field | Notes |
|---|---|
| **Host name**, **IP address** | At least one is needed |
| **Finding ID**, **CVE**, **Title** | At least one is needed, to tell findings apart |
| **Severity**, **CVSS score** | At least one is needed |
| **Port**, **Service**, **Known exploited**, **First seen**, **Last seen**, **Description**, **Solution** | Optional |

**Preview of the first rows** shows how the first five rows will be read with the current mapping, and changes as you change it.

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

The table lists the rows, problems first, with the reason beside each. Rows with errors are never imported: correct the file and start again, or import the rest.

How duplicates are avoided:

- A finding is recognised by its host and its identifier. The host is the host name, or the IP address when there is no name. The identifier is the finding ID, or the CVE list when there is no ID, or the title when there is neither.
- A row that matches a known finding updates it: **Last seen** moves forward, and a change of severity, score or text is saved and shown in the finding's **History**. No second record is created.
- A row that repeats an earlier row of the same file is shown as **Repeated in file** and only the first is used.

**Findings this file no longer reports** lists the open findings from earlier imports of the same source that are absent. Tick **Close missing findings** to mark them fixed, dated today; the dry run runs again and shows the new totals. Leave it unticked unless the file is a complete scan of the same scope as before. Findings added by hand and findings from other sources are never closed this way.

**Hosts not found in the asset register** appears when the inventory is in use. A host is linked to an asset when its name matches the asset's name, tag or serial number, or its IP address matches. Findings for unmatched hosts are imported without an asset.

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
| **Overdue by owner** | Overdue findings for each owner |

The weekly chart is drawn from counts the application stores once a day and after every import. It cannot be filled in for weeks before the application was in use, so a new installation shows the chart from its second week.

## Sample data

Loading sample data adds about sixty invented findings on twelve invented hosts, with the source **[Sample] Monthly network scan**, and several weeks of history for the weekly chart. To remove them, filter the list by searching for the source, then delete the findings.
