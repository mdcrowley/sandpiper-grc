# Cybersecurity frameworks and assessments

A framework is a published list of security outcomes that an organization works toward; NIST CSF 2.0 is included, and others can be added from a file. This page explains how to read the outcomes board, how to record where you stand on each outcome and the evidence for it, and how to take assessment snapshots so that progress can be shown between two dates. The screens are in the **Cybersecurity** group of the menu: **Framework outcomes** and **Assessments**.

An administrator can switch framework outcomes off under **Administration > Features** (see [Administration](09-administration.md#features)). Records are kept and return when it is switched back on.

Transit operators often map framework outcomes to the security guidance issued for their sector, or to the conditions of a grant, an insurer or a contract. The **Also satisfies** tab and the **Coverage of other frameworks** page are made for this: record the mapping once on each outcome, then see the other document's requirements with the outcomes that meet them.

## Words used on these screens

| Word | Meaning |
|---|---|
| Framework | The whole standard, for example NIST CSF 2.0. |
| Function | The top-level grouping in a framework. Each function has a short code and its own color band. |
| Category | A group of related outcomes inside a function. |
| Outcome | One thing the framework expects to be true, identified by a code such as `GV.OC-01`. |
| Priority outcome | An outcome your organization has chosen to concentrate on first. It carries a star. |
| Target | The status every outcome is expected to reach. It is **Largely met** unless your installation has been set up differently. |
| Snapshot | A saved copy of every outcome's status on one date. |

## What you need

- To see these screens you need **View** on **Frameworks and assessments**.
- To change an outcome, add or change evidence, add or change a mapping, or edit a framework's functions and categories you need **Edit**.
- To add an outcome, take a snapshot or add a new framework from a file you need **Create**. Loading a file for a framework that is already there needs **Edit**. To delete a snapshot you need **Delete**.

If a button described here is missing, your role does not include that permission. Ask an administrator (see [Administration](09-administration.md)).

## Status colors

Every outcome has one status. The colors are the same on every screen, and a key is always shown beside any colored bar.

| Status | Color | Counts toward the score as |
|---|---|---|
| Not evidenced | Red | 0 |
| Partial | Amber | 33 |
| Largely met | Blue | 67 |
| Met | Green | 100 |

An outcome is "at target" when its status is the target status or better. With the usual target, that means **Largely met** or **Met**.

Administrators can rename statuses and change their colors under **Lists** (the list is called **Outcome status**). The score each status counts for, and the target status, are changed on the framework settings screen (see [Framework settings](#framework-settings)).

## The outcomes board

Open **Cybersecurity > Framework outcomes**. The line under the title names the framework and says how many outcomes it has and how many are priority outcomes.

### Summary

The summary card at the top shows:

- a ring with the percentage of priority outcomes at target, and the count beside it, for example "5 of 53 priority outcomes at "Largely met" or better", with the score and the target score underneath. If no outcome is a priority outcome, all outcomes are counted instead;
- a bar of all outcomes split by status;
- one box per status, with the number of outcomes in that status and, underneath, how many of those are priority outcomes. On the board, select a box to show only that status (select it again to remove the filter). In the table view, a box opens the table filtered to that status.

### Functions, categories and tiles

Below the filters the board is laid out as follows:

- Each **function** is a section with a colored band. The band shows the function's code, name and description, a ring with the share of its outcomes at target, a line such as "7 of 31 outcomes at "Largely met" or better", and a bar split by status with the counts written under it.
- Inside a function, each **category** has a heading with its code, name and number of outcomes. Hover over a category name to read its description.
- Each **outcome** is a tile edged in the color of its status. A tile shows:
  - the outcome code;
  - a star if it is a priority outcome;
  - the status in words;
  - the plain-language description (or the official text when no description has been written);
  - the phase, if one is set (**Now**, **Next** or **Later**);
  - the review date, if one is set, or **Review overdue** in red when it has passed;
  - the owner's initials, or "No owner".

Select a tile to open the outcome.

### Changing a status from the board

If you have **Edit**, the status on each tile is a button. Select it, then choose the new status from the list. The change is saved straight away, a confirmation appears and the counts are brought up to date. The change is recorded in the outcome's history.

### Density

The **Detailed**, **Compact** and **Map** buttons at the right of the filter bar change how much each tile shows:

- **Detailed**: everything listed above.
- **Compact**: one line per outcome: code, star, text and status.
- **Map**: a small colored block per outcome with its code and star. Useful for seeing the whole framework at a glance. Hover over a block to read the outcome.

Your choice is remembered in this browser.

### Using the keyboard

Press Tab to reach the first tile, then:

| Key | What it does |
|---|---|
| Arrow keys | Move to the next tile left, right, up or down. |
| Home, End | Move to the first or last tile. |
| Enter | Open the outcome. |
| S | Open the status list for the outcome (needs **Edit**; not in **Map**). Use the arrow keys and Enter to choose, or Escape to close. |

### Filtering the board

The filter bar stays at the top of the screen as you scroll. Filters combine: an outcome must match all of them to be shown.

| Filter | What it does |
|---|---|
| **Priority focus** | Shows only outcomes with the star, and the function bands and summary count only priority outcomes. |
| **Status** | Shows outcomes in any of the statuses you select. |
| **Phase** | Shows outcomes in any of the phases you select. Choose **No phase** to find outcomes that have not been planned. |
| **Function** | Shows only the functions you select. |
| **Any owner** | Shows one person's outcomes. Choose **No owner** to find outcomes nobody is responsible for. |
| **Search code or wording** | Shows outcomes whose code, description or official text contains what you type. |

The bar shows how many outcomes match, for example "44 of 106 shown". Select **Clear filters** to see the whole framework again.

The filters are part of the page address, so you can bookmark a filtered board or send the link to a colleague, and the browser's Back button steps back through your filter changes.

### Saved views

Use the **Views** menu in the filter bar:

- **All outcomes** and **Priority outcomes** are always there.
- **Save current view…** saves the filters you have set under a name. A view of yours with the same name is replaced. Turn on **Share with everyone who can see the outcomes** to share it instead.
- Your own views, then the shared ones (marked with the name of the person who shared them), are listed in the menu; select one to apply it. When the current filters match a saved view, the menu shows its name.
- **Manage views…** lists your views and the shared ones. **Share** shares one of your own views; the trash icon deletes one of yours, or removes a shared view you shared (an administrator can remove any shared view).

Your own views are kept with your account, so they follow you to any browser; views you saved in this browser before are carried over the first time you open the board. A shared view is stored as filters on the outcome fields (status, phase, priority, function and owner), so it also appears among the saved views of the table view. Sharing, changing and removing a shared view is recorded in the audit log. A shared view holds filters, never outcomes: everyone sees only what their own permissions allow.

### Printing the board

Choose **More > Print this board**. The printout leaves out the menu and filter bar and keeps the summary, the function bands and the tiles as they are filtered on screen.

### Table view

Use the **Board** and **Table** buttons at the top right to switch views. The table lists the same outcomes in rows, with these columns: **Code**, **Outcome**, **Status**, **Priority outcome**, **Phase**, **Owner**, **Function**, **Category** and **Review date**.

In the table you can:

- search by code or wording using the search box;
- filter by **Status**, **Phase**, **Priority outcome**, **Owner** and **Review date**;
- sort by selecting a column heading;
- save the current search and filters as a view, for yourself or shared with everyone who can see the outcomes (shared board views appear here too);
- download the rows as a spreadsheet file with **Export** (needs the **Export** permission);
- add an outcome with **New framework outcome** (needs **Create**).

### Adding an outcome by hand

Outcomes are normally loaded with the framework. To add one yourself:

1. Switch to the **Table** view and select **New framework outcome**.
2. Enter the **Code**. It must be unique within the framework. If the code follows the framework's pattern (for example `GV.OC-06`), the function and category are filled in for you from the part before the last hyphen.
3. Enter the **Official text** and, if you wish, a **Plain-language description**.
4. Fill in any of **Category**, **Priority outcome**, **Status**, **Phase**, **Owner**, **Target**, **First action** and **Review date**.
5. Save.

### More than one framework

If more than one framework has been loaded, a framework selector appears beside the **Board** and **Table** buttons, and on the **Assessments** and **Coverage** pages. Each of these shows one framework at a time; the one you looked at last is shown first.

The **More** menu also leads to **Coverage of other frameworks**, **Assessments**, **Frameworks and structure** and **Framework settings**, and on the board holds **Print this board**.

The **Create** menu at the top of every page offers **Framework outcome**, **Assessment snapshot** and **Framework from a file** to people with **Create**.

## Working on one outcome

Select a tile or a table row to open the outcome. The page title is the plain-language description, the code is shown beside it, and a **Priority outcome** badge appears under the title when it applies. **Back to the board** returns to the board.

### Changing the status

The **Status** buttons sit directly under the title, one for each status.

1. Select the status that matches where you are today.
2. The change is saved straight away and a confirmation appears.

There is no separate save button. The change is recorded in the outcome's **History** tab with your name and the time.

### Official text and plain language

The first card shows where the outcome sits (framework, function, category and, if one was loaded, its designation) and two blocks side by side:

- **Official text**: the framework's own wording, for reference.
- **In plain language**: what the outcome means for your organization, in your own words. Write it with **Edit** on the card below.

### Where we are going

This card holds the plan for the outcome: **Target**, **First action**, **Phase**, **Owner**, **Review date** and whether it is a **Priority outcome**. Select **Edit** to change it, then **Save**.

| Field | What to put in it |
|---|---|
| **Plain-language description** | The outcome in your own words. This becomes the page title and the text on the tile. |
| **Target** | What "done" looks like for your organization. |
| **First action** | The next concrete step. |
| **Phase** | When you plan to work on it: **Now**, **Next** or **Later**. |
| **Owner** | The person responsible. |
| **Review date** | When the status should next be checked. |
| **Priority outcome** | Check to give the outcome a star. |
| **Evidence summary** | A sentence or two on what evidence exists overall. It is shown at the top of the **Evidence** tab. |

### Review-date reminders

When an outcome has a review date, its owner receives a notification (the bell at the top of the screen) two weeks before the date (the lead time is set on the [framework settings](#framework-settings) screen) and again when the date is reached. If the outcome has no owner, everyone who may edit framework outcomes is told instead. Each review date is announced at most twice; set a new review date after the review and the reminders start again for that date. Notifications can be turned off under **Reminders** in your notification settings.

### Status over time

The **Status over time** card, beside the plan (below it on a narrow screen), lists:

- the next review date, or **Review overdue** when it has passed;
- every change of status, newest first, with the old and new status, the date and who made it;
- when the outcome was added;
- the status it held in each assessment snapshot. Select a snapshot's name to open it.

### Evidence

The **Evidence** tab has two parts.

**Evidence files** holds the documents, screenshots and exports that show the outcome is met:

1. Drag files onto the box, or select **Choose files**.
2. Leave **Record new files as evidence** checked. Check **Collected on** (today by default) and, if the evidence goes out of date, enter **Expires on**.
3. The files are uploaded straight away and listed with an **Evidence** label and their expiry.

Use the download, pencil and trash icons on a file's row to download it, change its dates, or remove it. Files follow the outcome's permissions: anyone who can see the outcome can download them.

**Evidence notes** describe evidence that is kept somewhere else. To add one:

1. Select **Add evidence note**.
2. Enter a **Title**, for example "Signed minutes adopting the policy".
3. In **What it shows**, say what the item proves.
4. In **Where it is kept**, give a folder path, document reference or web address.
5. Enter **Collected on** and, if the item goes out of date, **Expires on**. The expiry date cannot be earlier than the collected date.
6. Select **Add evidence**.

To change a note, select the pencil icon on its row, make the change and select **Save changes**. To remove one, select the trash icon and confirm. Both are recorded in the history.

Each note shows an expiry label:

| Label | Meaning |
|---|---|
| **No expiry** | No expiry date was given. |
| **Valid to** (green) | The expiry date is more than 30 days away. |
| **Expires** (amber) | The item expires within 30 days. |
| **Expired** (red) | The expiry date has passed. |

The outcome's owner (or, when it has none, everyone who may edit framework outcomes) is reminded once when a note's expiry date is 30 days away, and once when it has passed. An administrator changes the 30 days under **Administration** > **Reminders**. Files attached as evidence are listed on the **Expiring evidence files** page instead.

Adding evidence does not change the status. Update the status yourself when the evidence justifies it.

### Also satisfies

The **Also satisfies** tab records other frameworks, sector guidance, laws or contract conditions that this outcome also meets, so that one piece of evidence can be used for all of them.

To add a mapping:

1. Open the **Also satisfies** tab.
2. Enter the **Framework or requirement**, or select one of the **Quick pick** names. Names you have used before, and the names in the **Mapping framework** list, are offered here.
3. Enter the **Reference**: the section, clause or control number, if there is one. For example, framework "PCI DSS" with reference "12.10.1".
4. Select **Add mapping**.

The same framework and reference cannot be added twice to one outcome. A name cannot contain a colon or a semicolon, and a reference cannot contain a semicolon: add a separate mapping for each reference. To change a mapping, select the pencil icon, edit it and select **Save changes**. To remove one, select the trash icon; it is removed immediately, without a confirmation step. Select a framework's name to open its coverage.

An outcome also has an **Also satisfies** text field, which is filled when your organization's designations are loaded at setup (entries separated by semicolons, for example `ISO/IEC 27001 A.5.1; Example Standard 2: 4.1`). The text and the mappings are kept in step: adding, changing or removing a mapping rewrites the text, and changing the text adds and removes mappings to match. In the text, a colon marks where a name ends and its reference begins. Without a colon, a name from the **Mapping framework** list, or one already used in a mapping, is recognized even when it contains a number; otherwise the reference starts at the first word that contains a digit. Administrators can add names to the **Mapping framework** list under **Lists**. If a name containing a number was split in the wrong place when the designations were loaded (for example "Example Standard" with reference "2 4.1.3"), add the full name to the list and run the seed command again: mappings the seed made with the same words split differently are replaced by the correct one, and mappings people added themselves are left alone.

### Risks, policies and actions

The **Risks, policies and actions** tab gathers the work connected to this outcome. Each part appears only when that area is in use and you may see it:

- **Risks this outcome reduces**: find a risk in the box and select **Link risk** (needs **Edit**).
- **Policies that support this outcome**: policies mapped to the outcome. A policy is mapped from the policy's own page.
- **Actions**: the follow-up actions raised from this outcome, with their owner, due date and status. Add one from here.

### Related records, activity and history

- **Related** links the outcome to any other record, such as a system or a contract. Choose the **Record type**, find the **Record**, choose the **Relation** and select **Add link**. The link also appears on the other record.
- **Activity** shows comments and changes together, newest first. Use **Add a comment** to leave a note for colleagues.
- **History** lists every change with who made it, when, and the values before and after.

## Coverage of other frameworks

Open **Framework outcomes > More > Coverage of other frameworks**. The page turns the **Also satisfies** mappings around:

- On the left is one card for each other framework or document that outcomes are mapped to, with the number of its requirements, the number of outcomes mapped to it, and how many of those are at target.
- Select a card to see its requirements. Each row shows the **Requirement** (or "The framework as a whole" when no reference was given), the outcomes that satisfy it with their **Status**, and how many are **At target**.
- Use **Find a requirement or outcome** to narrow the list. Select an outcome's code to open it.

## Frameworks and structure

Open **Framework outcomes > More > Frameworks and structure**. The page lists the loaded frameworks as cards; select one to work on it. **Open the board** goes to its board and **History of this framework** lists the changes made to it.

### Editing functions and categories

With **Edit**, the functions and categories of the chosen framework can be changed on this page:

- Change a function's **Function name**, **Color** or description, or a category's name, in place.
- Use the up and down arrows to reorder functions, or categories within a function.
- **Add function** adds a function at the end; **Add category** adds a category to that function. Enter a code and a name. The code of a saved function or category cannot be changed.
- The trash icon removes a function or category after you confirm. A category that still has outcomes, or a function that still has categories or outcomes, cannot be removed: move or delete those first.

Changes to names, colors and order are kept until you select **Save structure**; **Discard changes** goes back to what is saved. Removing is done at once. Every change is recorded in the framework's history.

### Adding a framework from a file

1. Select **Add framework from a file**.
2. Select **Choose a file** and pick the framework's reference file (a `.json` file; the format is described below).
3. The application checks the file and says what loading it would do: how many functions and categories, how many outcomes would be added, how many have changed wording, and how many are unchanged. If something is wrong, it lists the problems instead.
4. Select **Load framework** (or **Update framework** when that framework is already loaded).

Loading the file for a framework that is already loaded updates names and wording and adds new outcomes. It never changes a status, owner, target, evidence or mapping, and it never removes an outcome: outcomes that are in the application but not in the file are listed and left alone.

**Download as a file** saves the chosen framework in the same format, which is a good starting point for writing a file of your own.

### Checking the official wording

For NIST CSF 2.0, **Check official wording** (needs **Edit**) compares the outcome text and the function and category names and descriptions with the wording supplied with this version of the application, which has been checked against the published framework. It lists every difference; **Update** brings them in line. Only the wording changes: statuses, owners, targets, evidence, mappings and your own plain-language descriptions are not touched, and no outcome is added or removed. Use it after an upgrade on an installation that loaded the framework with an earlier version. The change is recorded in the framework's history.

## Framework settings

Open **Framework outcomes > More > Framework settings**. Everyone who can see the outcomes can read the settings; changing them needs the **Administer** permission on frameworks. Every change is recorded in the audit log.

- **Scoring**: the weight of each status, as a percentage of an outcome (usually 0, 33, 67 and 100). The score out of 100 is the average weight of the outcomes.
- **Target status**: the line drawn on the board, the progress chart and assessment reports. An outcome at that status, or at one that weighs more, counts as on target. The target status needs a weight above 0%.
- **Days before the review date**: when the first review reminder goes out (0 to 90; 0 sends only the reminder on the day). The same setting is listed under **Administration** > **Reminders**.

Select **Save settings**; **Discard changes** goes back to what is saved. Scores on the board, the progress chart and in reports use the new weights at once, including those of earlier snapshots.

### The reference file format

A reference file is one JSON object:

```json
{
  "key": "example-standard-1",
  "name": "Example Standard",
  "version": "1.0",
  "description": "Optional. Shown on the Frameworks and structure page.",
  "functions": [
    {
      "code": "AC", "name": "Access", "color": "blue",
      "description": "Optional.",
      "categories": [
        {
          "code": "AC.ID", "name": "Identities", "description": "Optional.",
          "outcomes": [
            { "code": "AC.ID-01", "text": "Every account belongs to a named person or service" },
            { "code": "AC.ID-02", "text": "Accounts are removed when they are no longer needed" }
          ]
        }
      ]
    }
  ]
}
```

| Field | Rules |
|---|---|
| `key` | Required. 2 to 60 letters, digits, dots, hyphens or underscores. Loading a file with the key of a framework that is already loaded updates that framework. |
| `name`, `version`, `description` | `name` is required; the others are optional. |
| `functions` | Required, at least one. Each needs a `code` and a `name`; `description` is optional. |
| `color` | Optional: one of `purple`, `blue`, `teal`, `green`, `amber`, `orange`, `red`, `gray`. |
| `categories` | A list under each function. Each needs a `code` and a `name`. |
| `outcomes` | A list under each category. Each needs a `code` (up to 60 characters) and its `text`. Every outcome must sit under a category. |

Function, category and outcome codes must each be unique within the file. A file may hold up to 5,000 outcomes. New outcomes start as **Not evidenced**.

## Assessments

An assessment snapshot records the status of every outcome on one date. Snapshots are what make it possible to show progress: without one there is nothing to compare today against.

Open **Cybersecurity > Assessments**. The tiles at the top show **Score now, all outcomes**, **Score now, priority outcomes**, **Priority outcomes at "Largely met" or better** (each with the change since the latest snapshot) and **Snapshots taken**.

### Taking a snapshot

Before you start, make sure outcome statuses are up to date, because the snapshot copies them exactly as they stand at that moment.

1. Select **Take snapshot**.
2. Enter a **Name**, for example "Quarter 1 review".
3. Leave **Date** empty to use today, or enter the date the assessment relates to. The date cannot be in the future or before 2000.
4. Add any **Notes**, and fill in any custom fields your administrator has added to snapshots (those marked with an asterisk are required).
5. Select **Take snapshot**.

The statuses a snapshot holds cannot be changed afterward; its custom fields, if any, are shown and can be edited in the **More details** card on the snapshot's page. The **Date** only labels the snapshot and sets its position on the chart: whatever date you enter, the statuses saved are the ones on the board when you select the button.

Take the first snapshot as soon as the statuses are a fair reflection of the present. It becomes the baseline.

### Progress over time

The **Progress over time** card starts with a sentence saying how the score for all outcomes has moved since the first snapshot. The chart has one point for each snapshot, placed by its date, and a final open circle for today's position, which is not saved until a snapshot is taken. It shows three lines:

- **Priority outcomes**: the score for priority outcomes only.
- **All outcomes**: the score for the whole framework.
- **Target**: a dashed line showing the score you would have if every outcome were at the target status (67 with the usual target).

Hover over a point to read the snapshot's name, date and scores.

The **score** is a number from 0 to 100. Each outcome counts as 0, 33, 67 or 100 according to its status (see "Status colors" above) and the score is the average. A rising line means outcomes are moving up the scale.

The **Snapshots** table below the chart gives the same figures in numbers. For each snapshot, and for "Now (not saved)", it shows the date, a bar of outcomes by status, **Score, priority**, **Score, all** and **Priority at target**. Select a snapshot's name to open it, or **Report** to open its printable report.

### Comparing two points in time

The **Compare two points in time** card is at the bottom of the **Assessments** page.

1. In **From**, choose the earlier snapshot. The earliest one is chosen for you.
2. In **To**, choose a later snapshot, or leave it on **Now (not saved)** to compare with today's statuses.

The swap button between the two boxes exchanges them. Your choice is kept in the page address, so the comparison can be bookmarked or shared.

The card then shows:

- **Improved** and **Declined**: how many outcomes moved up or down the scale.
- **Score, all outcomes**: the score at each point, with the change in points.
- **Priority outcomes at target**: the count at each point, with the change.
- **What moved, by function**: for each function, the score at each point, two status bars (the first point above, the second below), and the codes of the outcomes that moved. Select a code to open the outcome.
- **Changed outcomes**: one row per outcome whose status changed, with its status at each point and a **Direction**.

| Direction | Meaning |
|---|---|
| **Improved** | The status moved up the scale. |
| **Declined** | The status moved down the scale. |
| **Changed** | The status changed to one that counts the same. |
| **Added since** | The outcome did not exist at the "From" point. |
| **Removed since** | The outcome no longer exists at the "To" point. |

If you choose the same snapshot in both boxes, the card asks you to choose two different points in time.

### Opening a snapshot

Select a snapshot's name in the **Snapshots** table. The snapshot page shows:

- the notes entered when it was taken;
- the share of priority outcomes at target, a bar of all outcomes by status, **Score, priority outcomes** and **Score, all outcomes**;
- **By function**: the score and a status bar for each function;
- the **Outcomes** tab: every outcome with its **Status at the time**. Filter the list with **Priority only** and **Status**;
- the **History** tab: who took the snapshot and when.

**Compare with another** opens the **Assessments** page comparing this snapshot with the one before it (or with now, for the first snapshot).

### Printable assessment report

Select **Printable report** on a snapshot page, or **Report** in the **Snapshots** table. The report is laid out for paper and suitable for a board or committee pack. It shows:

- the framework, the snapshot's name and date, and the snapshot it is compared with (the one before it);
- the share of priority outcomes at target, the scores with their change, the target score and how many outcomes moved up and down;
- a bar of all outcomes by status and the snapshot's notes;
- **By function**: outcomes, at target, score, change and a status bar for each function;
- **What moved since** the previous snapshot (named in the heading): each changed outcome with what it **Was** and what it **Is**;
- **Every outcome**, grouped by function, with its status at the time.

Select **Print**, then choose a printer or "Save as PDF". The menu and buttons are left out of the printout.

### Deleting a snapshot

1. Open the snapshot and select **Delete**.
2. Confirm.

The snapshot disappears from the progress chart and from comparisons. The deletion is recorded in the audit log.

## Not available yet

Nothing tracked for this area is missing at the moment.
