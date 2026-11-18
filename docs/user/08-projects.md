# Projects

The Projects area takes a technology project from a one-page request through a fixed set of stages, with a gate between each stage where a checklist must be complete and an approval recorded before the project can move on. This page covers submitting a request, how the tier is set, working a gate, status reports, the risks and issues log, milestones, scoring and the portfolio views. The screens are in the **Projects** group of the menu: **Portfolio**, **New request** and **Project settings**.

## What you need

| To do this | You need this permission on Projects |
|---|---|
| See the portfolio and open projects | **View** |
| Submit a project request | **Create** |
| Edit a project, tick checklist items, add reports, items and milestones, save scores | **Edit** |
| Record a gate decision | **Approve** |
| Change project settings and gate templates | **Administer** |

Roles are managed by an administrator; see [Administration](09-administration.md).

## Submitting a request (intake)

Every project starts as a one-page request.

1. Open **Projects > New request**, or select **New project request** on the portfolio.
2. Enter a **Name**.
3. In **What is needed and why**, describe the problem. In **Expected benefits**, say what will be better afterwards.
4. Enter the **Sponsor** and **Department**.
5. Enter a rough **Budget**, choose the **Funding source** (**Operating budget**, **Capital budget**, **Grant or outside funder** or **Other**) and enter a **Target date**.
6. Answer the three impact questions by ticking any that apply: **Touches payment**, **Touches personal data**, **Touches operational systems**.
7. Select **Submit request**.

The request is given a reference beginning `PRJ-`, joins the portfolio at the **Idea** stage with status **Active**, and its first gate, **Intake approval**, opens. You are taken to the new project's page.

## Tiers and how they are assigned

The tier says how much scrutiny a project gets. It decides who approves each gate. You do not choose it: it is worked out from the budget and the three impact questions, and recalculated every time the project is saved.

| Tier | Assigned when |
|---|---|
| **Tier 1** | The project touches payment, personal data or operational systems, whatever its budget; or the budget is above the upper threshold. |
| **Tier 2** | None of the three questions is ticked and the budget is between the two thresholds, including a budget exactly equal to either one. |
| **Tier 3** | None of the three questions is ticked and the budget is below the lower threshold. A project with no budget entered is Tier 3. |

The thresholds are 50,000 and 100,000 unless your administrator has changed them. The **New project request** page shows the amounts in force under **How the tier is set**.

### Overriding the tier

If the rules give the wrong answer for a particular project, someone with **Edit** can set the tier by hand:

1. On the project page, select **Edit** on the **Tier and impact** card.
2. Choose a **Tier override**.
3. Enter the **Reason for override**. This is required.
4. Save.

A notice on the project then states the tier that was set by hand, the tier the rules would give, and the reason. The override is recorded in the history. To go back to the rules, clear **Tier override** and save.

## Stages and gates

A project moves through six stages. Between each pair is a gate.

| Stage | Gate to leave it | Next stage |
|---|---|---|
| **Idea** | Intake approval | Initiate |
| **Initiate** | Charter approval | Plan |
| **Plan** | Plan and budget approval | Procure |
| **Procure** | Contract award | Deliver |
| **Deliver** | Go-live | Close |
| **Close** | None | None |

The stage cannot be edited directly. A project moves to the next stage only when its current gate is approved, and there is no way to move a project back to an earlier stage.

Separately, a project has a **Status**: **Active**, **On hold**, **Cancelled** or **Completed**. Change it with **Edit** on the **Project** card. Gate decisions can be recorded only while the project is **Active**.

### The stage bar

The bar at the top of a project page shows the six stages with the gates between them. Completed stages are ticked and the current stage is highlighted. Each gate shows its state:

| Gate shows | Meaning |
|---|---|
| **Not reached** | The project has not got to this gate yet. |
| **Blocked: N of M to do** | Checklist items are still outstanding. |
| **Ready for a decision** | Every checklist item is ticked. |
| **Deferred** | A decision to defer was recorded. The gate is still open. |
| **Approved** with a date | The gate was passed. |
| **Rejected** | A decision to reject was recorded. |

Select a gate on the bar to jump to the **Gate** tab.

## Working a gate

Open the project and select the **Gate** tab. The current gate is shown. Use the **Gate** drop-down to look at an earlier gate.

### The checklist

Each gate has a checklist copied from the gate template at the moment the gate opened. A progress bar shows how many items are done.

1. Tick an item when it is done. Your name and the time are shown under it.
2. Select **Add note** on an item to record a **Note** and an **Evidence reference**, such as a document or ticket number, then select **Save**.
3. Untick an item if it was ticked by mistake.

Once a gate is approved its checklist and documents can no longer be changed.

### Required documents

The **Required documents** card lists the documents expected at this gate. Tick each one when it has been received and type where it is filed in the box beside it. Required documents are a record only: an unticked document does not stop the gate being approved. Only the checklist does.

### Approvers

The **Approvers** card lists the roles expected to approve this gate for the project's tier. Open **Approvers for every tier** to see the full table. The list is guidance for whoever records the decision; the application does not check the approver's name against it.

### Recording a decision

Approvals are given outside the application, for example by email, and then recorded here. You need **Approve** on **Projects**, and the button appears only on the project's current gate.

1. On the **Gate** tab, select **Record decision**.
2. Choose the **Decision**: **Approved: move to the next stage**, **Deferred: decide later** or **Rejected**.
3. Enter the **Approver name**. This is required.
4. Check the **Approver role**. It is filled in with the first approver for the project's tier; change it if someone else decided.
5. Enter the **Decision date**. It starts as today and cannot be in the future.
6. In **Reference**, say where the approval is filed, and add any **Notes**.
7. Select **Record decision**.

What happens next depends on the decision:

- **Approved**: the gate closes, the project moves to the next stage and the next gate opens with a fresh checklist.
- **Deferred**: the gate stays open and the project appears under **Gate decisions due** on the portfolio. Record another decision later.
- **Rejected**: the gate is marked rejected and the project stays in its stage. The project's status does not change by itself; set it to **Cancelled** or **On hold** if that is the outcome. A further decision can still be recorded on the gate.

Every decision is kept in the **Decisions** table on the **Gate** tab, with the date, approver, reference, notes and who recorded it.

### Why approval is blocked

A gate cannot be approved in two situations. The **Gate** tab tells you which applies.

- **Checklist items are outstanding.** The tab shows "Approval is blocked" with the number of items still to do. In the decision window, choosing **Approved** shows "This gate cannot be approved yet", lists the outstanding items, and disables **Record decision**. Tick the items first, or record the decision as **Deferred**.
- **The project is not active.** A project that is on hold, cancelled or completed cannot have a gate decision recorded. Make it **Active** again first.

When every item is ticked and the project is active, the tab shows "Ready for a decision".

## Status reports and the red, amber, green trend

A status report is a short periodic update with four ratings. Open the **Status reports** tab.

### Adding a report

1. Select **Add status report**.
2. Enter the **Period end** date. It starts as today.
3. Choose a rating for each of **Overall**, **Schedule**, **Budget** and **Risk**. All four are required.
4. Fill in **Accomplishments**, **Next steps** and **Decisions needed**.
5. Select **Add report**.

The ratings mean:

| Rating | Meaning |
|---|---|
| **Green** | On track. |
| **Amber** | Needs attention. |
| **Red** | Needs a decision or help. |

A report cannot be edited on screen after it is added. If one is wrong, select **Delete** on it and add it again; the project's ratings are recalculated.

### Where the ratings show

The ratings of the report with the latest period end become the project's current ratings. They appear as chips at the top of the project page and in the portfolio. A project with no reports shows "No report".

Beside the overall rating an arrow shows the direction of travel, found by comparing the overall rating of the latest report with the one before it:

- up arrow: improving since the last report;
- level line: no change since the last report;
- down arrow: worse than the last report.

### The trend grid

The **Trend** card on the **Status reports** tab is a grid with a row for each of the four ratings and a column for each reporting period, oldest on the left, covering up to the last twelve reports. Each square is coloured and carries the letter R, A or G, so it can be read without relying on colour.

## Risks, issues, decisions and change requests

The **Risks & issues** tab is the project's own log. It holds four kinds of item: **Risk**, **Issue**, **Decision** and **Change request**. Use the buttons at the top to show one kind or **All**; each shows a count.

### Adding an item

1. Select **Add item**. If you are viewing one kind, the button names it, for example **Add issue**.
2. Choose the **Kind** and the **Status**: **Open**, **In progress**, **Approved**, **Rejected** or **Closed**.
3. Enter a **Title** and any **Detail**.
4. Choose an **Owner** and a **Due date**.
5. For a risk, enter **Likelihood (1 to 5)** and **Impact (1 to 5)**, where 1 is rare or minor and 5 is almost certain or severe.
6. Select **Add**.

A risk's score is likelihood multiplied by impact. It is shown in the **Risk score** column: red for 15 or more, amber for 8 to 14, green below 8. An item past its due date is marked "overdue" unless its status is Closed, Approved or Rejected.

To change or remove an item, open the menu at the end of its row and choose **Edit** or **Delete**.

### Escalating a risk

A project risk that matters beyond the project can be copied to the organisation's risk register.

1. On the risk's row, open the menu and choose **Escalate to enterprise risk register**.
2. Confirm with **Escalate**.

A new risk is created in the risk register with the same title and detail, a note saying which project it came from, the project risk's likelihood and impact as its inherent score, and the item's owner (or the project manager if the item has none). The project risk stays in the project and is marked "Escalated to the enterprise risk register" with the date. A risk can be escalated once. If the project risk has a likelihood without an impact, or the other way round, the risk register refuses it: enter both, or neither, and try again.

The risk register is restricted, so after escalating you may not be able to open the new risk yourself. See [Risks, actions and obligations](06-risks-actions-obligations.md).

## Milestones

Milestones are the handful of dates that matter. They appear on the portfolio timeline. Open the **Milestones** tab.

- To add one, select **Add milestone**, enter a **Name** and a **Due date**, and select **Add milestone**. Leave **Completed on** empty until it is done.
- To complete one, select **Mark done** on its row. Today's date is recorded. To record a different date, select **Edit** and set **Completed on**.
- To change or remove one, select **Edit** or **Delete**.

The **State** column shows **To do**, **Overdue** (past its due date and not done), or **Done** with the date, marked "(late)" if it was completed after the due date.

## Scoring

Scoring gives each project a priority score out of 100 so that projects can be ranked against each other. Open the **Scoring** tab.

1. For each criterion, select a number from 0 (none) to 5 (very strong). Select the same number again to clear it.
2. The **Priority score** at the top updates as you go and shows "(not saved yet)".
3. Select **Save scores**, or **Discard changes** to go back.

The score is the weighted average of your scores, shown out of 100. A criterion left blank counts as zero. The criteria supplied are:

| Criterion | Weight |
|---|---|
| Strategic alignment | 25 |
| Risk and compliance | 25 |
| Benefit to customers and staff | 20 |
| Financial return | 15 |
| Readiness to deliver | 15 |

Administrators can change the criteria and weights. The score appears on the project page and in the **Score** column of the portfolio table.

## The portfolio

Open **Projects > Portfolio**. The top of the page summarises every project that is not cancelled.

- **Projects**: how many there are.
- **In delivery**: active projects in the Deliver stage against the limit, for example "4 of 3".
- **Gate decisions due**: active projects whose current gate is ready for a decision or was deferred.
- **Total budget** and **Spend to date**.
- **Stage funnel**: the number of projects and the total budget at each stage.
- **Gate decisions due**: when there are any, a table naming each project and gate, how much of the checklist is complete and whether it is ready or deferred. Select a project to go straight to its **Gate** tab.

### The work-in-progress warning

Running too many projects at once slows all of them. The portfolio counts the **active** projects in the **Deliver** stage and compares the count with a limit, which is 3 unless your administrator has changed it. When the count is above the limit, a banner headed "Work-in-progress limit exceeded" appears, the **In delivery** tile turns red and the Deliver column is flagged. Projects on hold do not count.

The warning is advice only. It does not stop a gate being approved or a project entering delivery.

### The four views

Use the **Table**, **Kanban**, **Timeline** and **Budget** buttons to switch views.

| View | What it shows |
|---|---|
| **Table** | Every project in rows: **Reference**, **Name**, **Tier**, **Stage**, **Status**, **Overall** rating with trend arrow, **Score**, **Budget**, **Spend against budget**, **Project manager** and **Target date**. Search, filter, sort, save views and export here. Filters include tier, stage, status, overall rating, trend, funding source, project manager, the three impact questions and target date. |
| **Kanban** | One column per stage with a card for each project showing its tier, rating, gate progress, budget and target date. Cards cannot be dragged: a project changes column only when its gate is approved. Cancelled projects are not shown. |
| **Timeline** | One row per project, with a bar from start date to target date, a diamond for each milestone (done, to do or overdue) and a line for today. Projects with no dates and no milestones are left out, with a note saying how many. Open **Show milestones as a table** for the same information as text. |
| **Budget** | A chart of budget against spend to date for each project that has either, largest budget first, followed by a table with the remaining amount and totals. Select a bar to open the project. |

In every view, spend against budget is drawn as a bar that turns red and says "over" when spend passes the budget.

## The project page

Besides the tabs described above, the project page has three cards you can change with **Edit**:

- **Project**: name, description, benefits, sponsor, project manager, system owner, department, status, start date and target date. The target date cannot be before the start date.
- **Money and suppliers**: budget, spend to date, funding source, and the linked vendor and contract (see [Vendors and contracts](04-vendors-and-contracts.md)). Spend to date is typed in by hand.
- **Tier and impact**: the tier, any override, the three impact questions, and free text for **Security impact** and **Data impact**.

The **Activity**, **Related** and **History** tabs work as on every record.

## Project settings

Open **Projects > Project settings**, or select **Settings** on the portfolio. You need **Administer** on **Projects**. Each card is saved separately, and every change is recorded in the audit log.

| Card | What you can change |
|---|---|
| **Tier thresholds** | **Tier 3 is below** and **Tier 1 is above**. The second amount cannot be lower than the first. Select **Save thresholds**; the tier of every project is recalculated. |
| **Work-in-progress limit** | **Active projects in delivery**: a whole number of 1 or more. Select **Save limit**. |
| **Scoring criteria** | For each criterion, its name, **What it means** and **Weight**. Use **Add criterion** or the bin icon, then **Save criteria**. At least one criterion must have a weight above zero. Every project's score is recalculated. |
| **Gates** | For each gate, select **Edit** to change the **Gate name**, the **Checklist** (one item per line), the **Required documents** (one per line) and the **Approvers** for each tier (one role per line). Select **Save gate**. |

Changes to a gate template apply to gates opened from then on. A gate already open on a project keeps the checklist it started with.

## Not available yet

- Required documents do not block a gate; only the checklist does.
- A project cannot be moved back to an earlier stage.
- Submitting a request needs the **Create** permission on **Projects**. There is no request form for staff without it.
- Approvals are recorded by hand. The application does not send approval requests or collect sign-off from the approvers.
- Status reports cannot be edited on screen, only added and deleted.
- Gates cannot be added or removed, and the stages they sit between cannot be changed, on screen.
- Files cannot be attached, so documents and evidence are recorded as references to where they are filed.
- No reminders are sent for milestones, due dates or overdue status reports.
