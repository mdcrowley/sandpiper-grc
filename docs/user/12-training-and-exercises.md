# Training and exercises

This part of the application records the courses people must take, who has completed them and who is overdue, and the exercises you run to test your plans: tabletop exercises, restore tests and continuity tests, with what each one showed and the actions that followed. Lists and record pages work as described in [Getting started](01-getting-started.md).

An administrator can switch training and exercises off under **Administration > Features** (see [Administration](09-administration.md#features)); **My training** then goes too. Records are kept and return when it is switched back on.

## Who can do what

| Permission | Allows |
|---|---|
| `training.view` | See courses, records and the training overview |
| `training.create` | Add courses, record training and import completions |
| `training.edit` | Change courses and add or remove assignment rules |
| `training.delete` | Remove courses and training records |
| `training.export` | Export courses and training records |
| `exercises.view`, `exercises.create`, `exercises.edit`, `exercises.delete` | The same for exercises |

Everyone who can sign in can open **My training**, which shows only their own records.

## Courses

Open **Courses** in the **Cybersecurity** group.

### Add a course

1. Select **New course**, or **Create** then **Course**.
2. Enter the **Title** and, if you wish, a **Description**.
3. Choose the **Category** and the **Format**: **Online**, **Classroom**, **Briefing** or **Document to read**.
4. Enter the **Provider** and the **Duration (minutes)**.
5. Enter **Repeat every (months)** if the course must be taken again, for example `12` for a yearly course. Leave it empty for a course taken once.
6. Enter **Days allowed to complete**: how long a person has from the day the course is given to them. The default is 30.
7. Check **Mandatory** if everyone it is assigned to must complete it, and choose the **Owner**.
8. Check **People may mark it complete themselves** for a course people can certify on their own, such as a document to read (see [My training](#my-training)). Leave it unchecked when the completion must be recorded by someone else, for example after an assessed test.
9. Select **Create course**.

On the course list, check several courses and select **Edit selected…** to change their **Category**, **Mandatory**, **People may mark it complete themselves**, **Owner** or **Status** at once.

The course gets a reference such as `CRS-00004` and its status starts as **Active**. Change the status to **Retired** when the course is no longer used: its records are kept, but it no longer counts in the overview and no new records are raised for it.

### The course record

The bar at the top shows how many of the people given the course have completed it. The tiles below it show the number of **People**, **Completed**, **To do** and **Overdue**; select a tile to open those records as a list.

| Tab | What it holds |
|---|---|
| **People** | **People outstanding**, most overdue first, and **Completed**, with result, score and evidence note |
| **Assignment rules** | Who is given the course automatically |
| **Activity**, **Attachments**, **Related**, **History** | Comments, files such as course material, linked records and every change, including each record raised, completed or removed |

## Assign a course

An assignment rule gives a course to people who have an account.

1. Open the course and its **Assignment rules** tab.
2. Select **Add rule**.
3. In **Assign to**, choose **Everyone with an account**, **Everyone holding a role**, **Everyone in a department** or **One person**, then choose the role, department or person.
4. Select **Add rule**.

Each active user the rule matches gets a record at once, due after the course's days allowed. The rules are checked again every day and when the application starts, so a new starter, or someone who joins the role or department, is picked up without anyone doing anything. A person who already has a record for the course is never given a second one by a rule.

Removing a rule with the trash button stops new records being raised. Records already raised are kept.

To give a course to a few people without a rule, or to people who have no account, open the **People** tab, select **Record training**, add the people, clear **They have completed the course** and select **Assign**.

### Courses that repeat

When a person's latest completion of a repeating course becomes older than the repeat period, a new record is raised for them, due after the course's days allowed. This happens for people with and without an account. A user whose account is no longer active is left alone. Each completion raises one follow-up record only: if you remove that record, it is not raised again.

## Record completions

### One person

1. Open the course and its **People** tab.
2. On the person's row under **People outstanding**, select **Record completion**.
3. Enter the date in **Completed on**, and optionally the **Result**, the **Score (%)** and an **Evidence note** saying where the proof is kept.
4. Select **Record completion**.

### A result of Did not pass

A result of **Did not pass** is not a completion. When you choose it, the dialog says so and the button becomes **Record attempt**. The attempt is noted on the person's record (date, result and score) and the course stays **To do**, or **Overdue** once its due date passes; the person's row shows **Retake: did not pass on** and the date. Record the completion again when they pass. The same applies to the import, and to a completion later edited to **Did not pass**. A **Did not pass** entered before this rule existed was turned into an attempt the same way, unless a later completion followed it.

### Several people at once

For people already listed as outstanding, check their rows, or select **Select all**, then select **Record completion for N selected**.

For anyone else:

1. On the **People** tab, select **Record training**.
2. Under **People with an account**, search for each person and choose them to add them to the list.
3. Under **People without an account**, type one person per line: the name, then optionally the email address and the department, separated by commas. Most staff may not have an account, and their training can still be recorded this way.
4. Enter the completion details and select **Record completion**.

A person whose email address matches an account is recorded against that account. Someone who already has the same completion (same course and date) is skipped, and the message tells you how many were skipped.

To remove a record entered by mistake, select the trash button on its row. The removal is kept in the course's history.

## Import completions

Use the import to load a completion report from a learning platform or a spreadsheet.

1. Open **Training overview** or **Courses** and select **Import completions**, or select **Import** on a course's **People** tab.
2. Choose a CSV file or paste its text, then select **Next: map columns**. The first row must hold the column names.
3. Match your columns to **Email**, **Name**, **Department**, **Course**, **Completed on**, **Score**, **Result** and **Evidence note**. You need **Completed on** and either **Email** or **Name**.
4. If the file has no course column, choose the **Course for every row**. Courses named in a file are matched by title or reference.
5. Select **Next: preview**. Nothing has been written yet.
6. Check the preview, then select **Import**.

| Result in the preview | Meaning |
|---|---|
| **New** | The completion will be recorded |
| **Duplicate, skipped** | The same person, course and completion date is already recorded, or appears on an earlier line |
| **Error** | The row cannot be imported; the reason is shown beside the value. Rows with errors are never imported |

Dates may be written as `YYYY-MM-DD` or month/day/year. A completion for a person who has an open record for the course completes that record; otherwise a new completed record is added. Importing the same file twice adds nothing the second time.

## Training overview

Open **Training overview** in the **Cybersecurity** group. Each person counts once for each active course they have been given, by their latest record: **Completed**, **To do** or **Overdue**. A record is overdue when its due date has passed and it has not been completed.

| Part | Shows |
|---|---|
| Tiles | The **Completion rate**, and the number **Overdue**, **To do**, **People** and **Active courses** |
| **Completion by course** | A bar for each course, split into completed, to do and overdue |
| **Completion by department** | The same for each department. People with an account use their department; others use the department typed on their record |
| **Overdue training, last 12 months** | How many records were overdue at the end of each month |
| **By course**, **By department** | The same numbers as tables |
| **Overdue now** | The people who are overdue, longest overdue first |

Select any tile, bar segment, point or number to open **Training records** filtered to exactly those records. There you can search and filter by **Course**, **Department** and **Status**, switch **Show** between **Latest per person** and **Every record**, and select **Export** to download the list as a CSV file.

## My training

Open **My training** in the **Cybersecurity** group to see the courses you have been given, their due dates, and the ones you have completed. The tiles count what is **To do** (and how many are retakes), **Overdue** and **Completed**.

When you finish a course, tell the course owner or your manager so that it can be recorded, unless the course lets you record it yourself:

1. Select **Mark complete** on the course's row, or **Record a completed course** at the top of the page (for a course that was not assigned to you).
2. Check the **Course** and the **Completed on** date (it cannot be in the future).
3. Under **Evidence**, say how you completed it, for example a certificate number or where the signed attendance sheet is kept. This is required.
4. Select **Mark complete**.

The record shows **Self-certified**, and your note is kept with it for the course owner to see. The completion is recorded in the course's history under your name.

### Notifications

When notifications are in use (see [Attachments and notifications](14-attachments-and-notifications.md)):

- You are told when training is assigned to you, by a rule or by hand. Someone given more than three courses at once gets one notification with the count.
- Once a course is past its due date you are reminded, then again every 7 days until it is completed.

Each notification opens **My training**. To change the 7 days, someone with **Administer** on **Training** selects **Reminder settings** on the **Training overview**, enters **Days between reminders** (1 to 90) and selects **Save**. One course can have its own interval: set **Days between overdue reminders** on the course (1 to 90), or leave it empty to use the setting.

## Exercises

Open **Exercises** in the **Cybersecurity** group.

### Plan an exercise

1. Select **New exercise**, or **Create** then **Exercise**.
2. Enter the **Title** and choose the **Type**: **Tabletop exercise**, **Restore test** or **Continuity test**.
3. Enter the **Date**, the **Scenario**, the **Scope and systems**, the **Objectives** and the **Facilitator**, and choose the **Owner**.
4. Select **Create exercise**.

The exercise gets a reference such as `EXR-00003` and its status starts as **Planned**. To link the systems in scope, open the **Related** tab and add each system.

### Record what happened

1. Open the exercise and select **Edit** on the **Details** card.
2. Change the **Status** to **Completed** and choose the **Result**: **Objectives met**, **Partly met** or **Not met**.
3. Describe the outcome in **What happened**.
4. Enter **Next due**, the date by which this kind of exercise should be run again. It must be after the exercise date.
5. Select **Save changes**.

### Rehearse an incident checklist

The **Steps** tab holds the steps of the exercise and how each one went. When security incidents are in use, a tabletop exercise can follow exactly the checklist the team would use in a real incident:

1. Under **Rehearse an incident checklist**, choose the **Incident scenario** (the number of steps is shown beside each) and select **Copy checklist**. The steps are copied from the scenario's checklist in Security incidents and grouped by phase. Each scenario can be copied once per exercise.
2. As the exercise runs, choose for each step **How it went**: **Went well**, **Done, with issues**, **Not done** or **Not tested**, and type a note of what happened, then select **Save note**.
3. To add a step of your own, type it in **Add a step** and select **Add step**. Remove a step with the trash button.

The bar at the top of **Steps** shows how many steps have been recorded and how they went. Every copy, change and removal is kept in the exercise's history.

A step recorded as **Not done** or **Done, with issues** shows **Raise finding** (needs **Edit** on exercises). It adds a finding on the **Findings** tab in one action, naming the step, its phase, how it went and its note (a note you have typed but not saved goes in too). The severity is **High** for a step not done and **Medium** for one done with issues; change it, and add a recommendation, on the **Findings** tab, where a follow-up action can then be created. A step raises one finding; it then shows **Finding raised**.

### Participants

On the **Participants** tab, select **Add participants**, type one name per line, enter their **Role in the exercise** and select **Add participants**. Clear **Attended** on the row of anyone who was invited but did not take part.

### Findings and follow-up actions

1. Open the **Findings** tab and select **Add finding**.
2. Describe the **Finding**, choose the **Severity** (**High**, **Medium** or **Low**) and enter a **Recommendation**.
3. Select **Add finding**.

To turn a finding into work for someone, select **Create follow-up action** on it, check the **Action title**, choose the **Owner** and the **Due** date, and select **Create action**. The action appears on the action tracker with the exercise as its source (see [Risks, actions and obligations](06-risks-actions-obligations.md)), and the finding shows the action's reference, status and due date. Each finding can raise one action. The **Actions** tab lists every action that came from the exercise, with its progress, and **Add action** there raises one that is not tied to a finding.

If the action tracker is not switched on, findings are still recorded, and a note on the **Findings** tab says that follow-up actions cannot be created.

### Exercise calendar

Open **Exercise calendar** in the **Cybersecurity** group.

| Part | Shows |
|---|---|
| **When each kind was last run** | For each type: how many have been completed, the date and result of the last one, how its steps went (a bar with the number that went well, with issues, not done, not tested and not recorded), and the next one due |
| **Overdue** | Planned exercises whose date has passed, and completed exercises whose **Next due** date has passed |
| Month by month | What is coming up: planned exercises, and the next run of each completed exercise that has a **Next due** date |

A **Next run due** entry disappears once a later exercise of the same type is on record, because the newer exercise takes its place. Canceled exercises are not shown.
