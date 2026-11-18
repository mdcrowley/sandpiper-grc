# Cybersecurity frameworks and assessments

A framework is a published list of security outcomes that an organisation works towards; NIST CSF 2.0 is included. This page explains how to read the outcomes board, how to record where you stand on each outcome and the evidence for it, and how to take assessment snapshots so that progress can be shown between two dates. Both screens are in the **Cybersecurity** group of the menu: **Framework outcomes** and **Assessments**.

## Words used on these screens

| Word | Meaning |
|---|---|
| Framework | The whole standard, for example NIST CSF 2.0. |
| Function | The top-level grouping in a framework. Each function has a short code and its own colour band. |
| Category | A group of related outcomes inside a function. |
| Outcome | One thing the framework expects to be true, identified by a code such as `GV.OC-01`. |
| Priority outcome | An outcome your organisation has chosen to concentrate on first. It carries a star. |
| Target | The status every outcome is expected to reach. It is **Largely met** unless your installation has been set up differently. |
| Snapshot | A saved copy of every outcome's status on one date. |

## What you need

- To see these screens you need **View** on **Frameworks and assessments**.
- To change an outcome, add evidence or add a mapping you need **Edit**.
- To add an outcome or take a snapshot you need **Create**. To delete a snapshot you need **Delete**.

If a button described here is missing, your role does not include that permission. Ask an administrator (see [Administration](09-administration.md)).

## Status colours

Every outcome has one status. The colours are the same on every screen, and a key is always shown beside any coloured bar.

| Status | Colour | Counts towards the score as |
|---|---|---|
| Not evidenced | Red | 0 |
| Partial | Amber | 33 |
| Largely met | Blue | 67 |
| Met | Green | 100 |

An outcome is "at target" when its status is the target status or better. With the usual target, that means **Largely met** or **Met**.

Administrators can rename statuses and change their colours under **Lists** (the list is called **Outcome status**).

## The outcomes board

Open **Cybersecurity > Framework outcomes**. The line under the title names the framework and says how many outcomes it has and how many are priority outcomes.

### Summary tiles

The row of tiles at the top shows:

- **Priority outcomes at "Largely met" or better**: the percentage of priority outcomes at target, with the count underneath (for example "12 of 40").
- One tile per status, with the number of outcomes in that status and, underneath, how many of those are priority outcomes. Select a status tile to open the table view filtered to that status.

### Functions, categories and tiles

Below the filters the board is laid out as follows:

- Each **function** is a section with a coloured band. The band shows the function's code and name, a bar split by status with the counts written under it, and a line such as "5 of 9 priority at target". If a function has no priority outcomes the line counts all of its outcomes instead.
- Inside a function, each **category** has a heading with its code and name. Hover over a function or category name to read its description.
- Each **outcome** is a tile in the colour of its status. A tile shows:
  - the outcome code;
  - a star if it is a priority outcome;
  - the status in words;
  - the plain-language description (or the official text when no description has been written);
  - the phase, if one is set (**Now**, **Next** or **Later**);
  - the owner's name, or "No owner";
  - the review date, if one is set.

Select a tile to open the outcome.

### Filtering the board

The filter bar sits above the board. Filters combine: an outcome must match all of them to be shown.

| Filter | What it does |
|---|---|
| **Priority only** | Shows only outcomes with the star. |
| **Status** | Shows outcomes in any of the statuses you tick. |
| **Phase** | Shows outcomes in any of the phases you tick. Choose **No phase** to find outcomes that have not been planned. |
| **Function** | Shows only the functions you tick. |
| **Owner** | Shows one person's outcomes. Choose **No owner** to find outcomes nobody is responsible for. |

The right-hand end of the bar shows how many outcomes match, for example "14 of 106 shown". Select **Clear filters** to see the whole framework again. Board filters are not saved when you leave the page.

### Table view

Use the **Board** and **Table** buttons at the top right to switch views. The table lists the same outcomes in rows, with these columns: **Code**, **Outcome**, **Status**, **Priority outcome**, **Phase**, **Owner**, **Function**, **Category** and **Review date**.

In the table you can:

- search by code or wording using the search box;
- filter by **Status**, **Phase**, **Priority outcome**, **Owner** and **Review date**;
- sort by selecting a column heading;
- save the current search and filters under a name using **Views > Save current view…** (saved views are kept in your browser on this computer);
- download the rows as a spreadsheet file with **Export CSV** (needs the **Export** permission);
- add an outcome with **New framework outcome** (needs **Create**).

### Adding an outcome by hand

Outcomes are normally loaded with the framework. To add one yourself:

1. Switch to the **Table** view and select **New framework outcome**.
2. Enter the **Code**. It must be unique within the framework. If the code follows the framework's pattern (for example `GV.OC-06`), the function and category are filled in for you from the part before the last hyphen.
3. Enter the **Official text** and, if you wish, a **Plain-language description**.
4. Fill in any of **Category**, **Priority outcome**, **Status**, **Phase**, **Owner**, **Target**, **First action** and **Review date**.
5. Save.

### More than one framework

If more than one framework has been loaded, a framework selector appears beside the **Board** and **Table** buttons. The board and the **Assessments** page each show one framework at a time.

## Working on one outcome

Select a tile or a table row to open the outcome. The page title is the plain-language description, the code is shown beside it, and a **Priority outcome** badge appears under the title when it applies.

### Changing the status

The **Status** buttons sit directly under the title, one for each status.

1. Select the status that matches where you are today.
2. The change is saved straight away and a confirmation appears.

There is no separate save button. The change is recorded in the outcome's **History** tab with your name and the time.

### Official text

The shaded block shows the framework's own wording and where the outcome sits: framework, function and category. This text is for reference. Use the description below it to say the same thing in your organisation's words.

### Where we are and where we are going

This card holds the plan for the outcome. Select **Edit** to change it, then **Save**.

| Field | What to put in it |
|---|---|
| **Plain-language description** | The outcome in your own words. This becomes the page title and the text on the tile. |
| **Target** | What "done" looks like for your organisation. |
| **First action** | The next concrete step. |
| **Phase** | When you plan to work on it: **Now**, **Next** or **Later**. |
| **Owner** | The person responsible. |
| **Review date** | When the status should next be checked. |
| **Priority outcome** | Tick to give the outcome a star. |
| **Evidence summary** | A sentence or two on what evidence exists overall. It is shown at the top of the **Evidence** tab. |

### Evidence

The **Evidence** tab lists each document, record or screenshot that shows the outcome is met. An evidence item is a description and a location; the file itself stays wherever you keep it.

To add evidence:

1. Open the **Evidence** tab and select **Add evidence**.
2. Enter a **Title**, for example "Signed minutes adopting the policy".
3. In **What it shows**, say what the item proves.
4. In **Where it is kept**, give a folder path, document reference or web address.
5. Enter **Collected on** and, if the item goes out of date, **Expires on**. The expiry date cannot be earlier than the collected date.
6. Select **Add evidence**.

Each item shows an expiry label:

| Label | Meaning |
|---|---|
| **No expiry** | No expiry date was given. |
| **Valid to** (green) | The expiry date is more than 30 days away. |
| **Expires** (amber) | The item expires within 30 days. |
| **Expired** (red) | The expiry date has passed. |

To remove an item, select the bin icon on its row and confirm. The removal is recorded in the history.

Adding evidence does not change the status. Update the status yourself when the evidence justifies it.

### Also satisfies

The **Also satisfies** tab records other frameworks, laws or contract conditions that this outcome also meets, so that one piece of evidence can be used for all of them.

To add a mapping:

1. Open the **Also satisfies** tab.
2. Enter the **Framework or requirement**, or select one of the **Quick pick** names. Names you have used before are offered here.
3. Enter the **Reference**: the section, clause or control number, if there is one. For example, framework "PCI DSS" with reference "12.10.1".
4. Select **Add mapping**.

The same framework and reference cannot be added twice to one outcome. To remove a mapping, select the bin icon on its row; it is removed immediately, without a confirmation step.

### Related records, activity and history

- **Related** links the outcome to any other record, such as a risk, a system or a contract. Choose the **Record type**, find the **Record**, choose the **Relation** and select **Add link**. The link also appears on the other record.
- **Activity** shows comments and changes together, newest first. Use **Add a comment** to leave a note for colleagues.
- **History** lists every change with who made it, when, and the values before and after.

## Assessments

An assessment snapshot records the status of every outcome on one date. Snapshots are what make it possible to show progress: without one there is nothing to compare today against.

Open **Cybersecurity > Assessments**.

### Taking a snapshot

Before you start, make sure outcome statuses are up to date, because the snapshot copies them exactly as they stand at that moment.

1. Select **Take snapshot**.
2. Enter a **Name**, for example "Quarter 1 review".
3. Leave **Date** empty to use today, or enter the date the assessment relates to.
4. Add any **Notes**.
5. Select **Take snapshot**.

A snapshot cannot be changed afterwards. The **Date** only labels the snapshot and sets its position on the chart: whatever date you enter, the statuses saved are the ones on the board when you select the button.

Take the first snapshot as soon as the statuses are a fair reflection of the present. It becomes the baseline.

### Progress over time

The **Progress over time** chart has one point for each snapshot and a final point called "Now". It shows three lines:

- **Priority outcomes**: the score for priority outcomes only.
- **All outcomes**: the score for the whole framework.
- **Target**: a dashed line showing the score you would have if every outcome were at the target status (67 with the usual target).

The **score** is a number from 0 to 100. Each outcome counts as 0, 33, 67 or 100 according to its status (see "Status colours" above) and the score is the average. A rising line means outcomes are moving up the scale.

The **Snapshots** table below the chart gives the same figures in numbers. For each snapshot, and for "Now (not saved)", it shows the date, a bar of outcomes by status, **Score, priority**, **Score, all** and **Priority at target**. Select a snapshot's name to open it.

### Comparing two points in time

The **Compare** card is at the bottom of the **Assessments** page.

1. In **From**, choose the earlier snapshot. The earliest one is chosen for you.
2. In **To**, choose a later snapshot, or leave it on **Now** to compare with today's statuses.

The card then shows:

- **Outcomes that changed**: how many outcomes have a different status.
- **Priority outcomes at target**: the figure at the "To" point, with the change since the "From" point.
- **Score, all outcomes**: the figure at the "To" point, with the change in points.
- **By function**: for each function, two status bars, one for each point in time, so you can see where the movement was.
- **Changed outcomes**: one row per outcome whose status changed, with the old and new status and a direction.

| Direction | Meaning |
|---|---|
| **Improved** | The status moved up the scale. |
| **Declined** | The status moved down the scale. |
| **Changed** | The status changed to one that counts the same. |
| **Added since** | The outcome did not exist at the "From" point. |
| **Removed since** | The outcome no longer exists at the "To" point. |

Select an outcome's code to open it. If you choose the same snapshot in both boxes, the card asks you to choose two different points in time.

### Opening a snapshot

Select a snapshot's name in the **Snapshots** table. The snapshot page shows:

- the notes entered when it was taken;
- tiles for **Priority outcomes at target**, **Score, priority outcomes**, **Score, all outcomes** and the count in each status;
- **By function**: one status bar for each function;
- the **Outcomes** tab: every outcome with its **Status at the time**. Filter the list with **Priority only** and **Status**;
- the **History** tab: who took the snapshot and when.

Select **Compare with another** to go back to the **Assessments** page and use the **Compare** card.

### Deleting a snapshot

1. Open the snapshot and select **Delete**.
2. Confirm.

The snapshot disappears from the progress chart and from comparisons. The deletion is recorded in the audit log.

## Not available yet

- Evidence is text only: you cannot upload or attach a file to an outcome.
- There is no screen for adding a framework or for editing its functions and categories. They are loaded when the application is set up.
- There is no screen for changing the target status or the score each status counts for.
- No reminder is sent when a review date or an evidence expiry date is reached. Use the **Review date** filter in the table view to find outcomes that are due.
- The NIST CSF 2.0 outcome wording supplied with the application has not yet been proofread against the published standard. Check the official text of an outcome against the standard before quoting it.
