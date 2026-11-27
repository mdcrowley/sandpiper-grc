# Projects

The Projects area takes a technology project from a one-page request through a fixed set of stages, with a gate between each stage where a checklist must be complete, the required documents must be in place and an approval recorded before the project can move on. This page covers submitting a request, how the tier is set, working a gate, moving a project back, status reports, the project register, milestones, scoring, safety and security certification, actions and the portfolio views. The screens are under **Projects and funding > Project portfolio**, with the tabs **Portfolio**, **Certifiable items** and, for people who administer projects, **Settings**; a new request starts from the **Create** menu or **New project request** on the portfolio.

An administrator can switch projects off under **Administration > Features** (see [Administration](09-administration.md#features)). Records are kept and return when it is switched back on.

## What you need

| To do this | You need this |
|---|---|
| See the portfolio and open projects | **View** on Projects |
| Submit a project request | Whatever your administrator chose under **Who may submit a project request** (see [Project settings](#project-settings)). By default, **Create** on Projects |
| Edit a project, check checklist items, mark documents received, attach files, add reports, items and milestones, save scores | **Edit** on Projects |
| Ask for approval at a gate (when its template names an approval workflow) | **Edit** on Projects |
| Record a gate decision, waive a required document, move a project back a stage | **Approve** on Projects |
| Add certifiable items and requirements, record verification | **Edit** on Projects |
| Issue or withdraw a certificate of readiness | **Approve** on Projects |
| Derive a requirement from a hazard, or from a threat | **View** on Safety, or **View** on Risks and on Security incidents and restricted records |
| Escalate a project risk to the risk register | **Edit** on Projects and **Create** on Risks |
| Change project settings and gate templates | **Administer** on Projects |

Roles are managed by an administrator; see [Administration](09-administration.md).

## Submitting a request (intake)

Every project starts as a one-page request.

1. Select **New project request** on the portfolio, or choose **Project request** from the **Create** menu. These are shown only to people who may send a request: people who may create projects, and, depending on **Who may submit a project request** in **Project settings**, people who may view projects or everyone.
2. Enter a **Name**.
3. In **What is needed and why**, describe the problem. In **Expected benefits**, say what will be better afterward.
4. Enter the **Sponsor** and choose the **Department** (one of the organization's departments).
5. Enter a rough **Budget**, choose the **Funding source** (**Operating budget**, **Capital budget**, **Grant or outside funder** or **Other**; leave it as **Not known yet** if you do not know) and enter a **Target date**.
6. Under **Does it touch any of these?**, check any that apply: **Touches payment**, **Touches personal data**, **Touches operational systems**.
7. Where the system inventory is in use and you may view it, name any **Systems affected**: existing systems the project would change, replace or depend on.
8. If you may view projects and your administrator has added fields of their own to projects (**Custom fields**), fill them in; those marked with an asterisk are required. People who may submit requests but not view projects are not asked them, and the project team fills them in later.
9. A box under the form says which tier the request looks like and why. Select **Submit request**.

The request is given a reference beginning `PRJ-`, joins the portfolio at the **Idea** stage with status **Active**, and its first gate, **Intake approval**, opens.

- If you can view projects, you are taken to the new project's page.
- If you cannot, the form says "Request PRJ-… submitted" and the request appears under **Your requests** on the right, with its stage, its status and how far through the current gate's checklist it is. You can follow your requests there but you cannot change a project after submitting it.

If requests are not open to you, the page says "You cannot submit project requests". Ask a project manager to submit it for you, or ask an administrator to open requests to more people.

## Tiers and how they are assigned

The tier says how much scrutiny a project gets. It decides who approves each gate. You do not choose it: it is worked out from the budget and the three impact questions, and recalculated every time the project is saved.

| Tier | Assigned when |
|---|---|
| **Tier 1** | The project touches payment, personal data or operational systems, whatever its budget; or the budget is above the upper threshold. |
| **Tier 2** | None of the three questions is checked and the budget is between the two thresholds, including a budget exactly equal to either one. |
| **Tier 3** | None of the three questions is checked and the budget is below the lower threshold. A project with no budget entered is Tier 3. |

The thresholds are 50,000 and 100,000 unless your administrator has changed them. The **New project request** page shows the amounts in force under **How the tier is set**.

### Overriding the tier

If the rules give the wrong answer for a particular project, someone with **Edit** can set the tier by hand:

1. On the project's **Overview** tab, select **Edit** on the **Tier and impact** card.
2. Choose a **Tier override**.
3. Enter the **Reason for override**. This is required.
4. Save.

A notice headed "The tier was set by hand" then states the tier that was set, the tier the rules would give, and the reason. The override is recorded in the history. To go back to the rules, clear **Tier override** and save.

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

The stage cannot be edited directly. A project moves forward only when its current gate is approved, and moves back only through **Move back a stage** (see below). When the **Go-live** gate is approved the project reaches **Close** and its status becomes **Completed** by itself.

Separately, a project has a **Status**: **Active**, **On hold**, **Canceled** or **Completed**. Change it with **Edit** on the **Project** card. Gate decisions can be recorded only while the project is **Active**.

### The stage bar

The bar at the top of a project page shows the six stages with the gates between them. Completed stages are checked and the current stage is highlighted. Each gate shows its state:

| Gate shows | Meaning |
|---|---|
| **Not reached** | The project has not got to this gate yet. |
| **Waiting for an earlier gate** | The gate was opened before, but the project has since moved back to an earlier stage. |
| **Blocked: N to do** | Checklist items or required documents are still outstanding. |
| **Waiting for approval** | Approval was asked for through the approval workflow the gate's template names; the approval panel at the top of the page shows who it waits for. |
| **Ready for a decision** | Every checklist item is checked and every required document is received or waived. |
| **Deferred · …** | A decision to defer was recorded. The gate is still open. |
| **Approved** with a date | The gate was passed. |
| **Rejected** | A decision to reject was recorded. |

The line under the bar names the current gate and its state. Select a gate on the bar to open its record in a side panel: its status, who approved it and when, the checklist with who checked each item, the documents, any change record and every decision. On the current gate, **Work this gate** takes you to the **Gate** tab.

Under the bar, a strip shows the latest **Schedule**, **Budget** and **Risk** ratings, **Spend against budget**, the **Target date** with the days to go (or past it), and the project manager, sponsor and priority score.

## Working a gate

Open the project and select the **Gate** tab. The current gate is shown. Use the **Gate** drop-down to look at an earlier gate.

A box at the top says where the gate stands: "Approval is blocked" followed by what is outstanding (for example "6 checklist items to do, 3 required documents missing") and what to do about it, or "Ready for a decision".

### The checklist

Each gate has a checklist copied from the gate template at the moment the gate opened. A progress bar shows how many items are done.

1. Check an item when it is done. Your name and the time are shown under it.
2. Select **Add note** on an item to record a **Note** and an **Evidence reference**, such as a document or ticket number, then select **Save**.
3. Clear an item if it was checked by mistake.

Once a gate is approved its checklist and documents can no longer be changed.

### Required documents

The **Required documents** card lists the documents expected at this gate. Each is marked **Required** or **Optional**, with a state chip: **Missing**, **Received**, **Waived** or **Optional**.

- Check a document when it has been received, and type where it is filed in the box under it.
- Or select **Attach file** to upload the document itself. The file is kept on the project (it also appears on the **Attachments** tab) and the document is marked as received. **Replace file** swaps it. Attaching needs the attachments feature to be in use.
- An approver can select **Waive** on a missing required document, give a **Reason** and select **Waive document**. A waived document no longer blocks the gate; who waived it, when and why are shown on the gate and kept in the history. **Withdraw waiver** puts it back.

A required document that is neither received nor waived stops the gate being approved. Optional documents never do.

### Change record

On a gate that asks for one (by default **Go-live**), and where change records are in use, a **Change record** card lets you link the change that carries the go-live. Select **Link a change record**, search for it and choose it. The link shows on the gate and in the gate's record; **Unlink** removes it. Linking is recorded in the history.

### Approvers

The **Approvers** card lists the roles expected to approve this gate for the project's tier. Open **Approvers for every tier** to see the full table. The list is guidance for whoever records the decision; the application does not check the approver's name against it. For the largest projects the supplied list ends with **Approving body (board, directors or owners)** (installations set up before this version show **Governing body**); an administrator changes the approvers of each gate under **Project settings**.

### Asking for approval through a workflow

A gate template may name an **approval workflow** (see **Project settings** below, and [Approval workflows](22-approval-workflows.md)). On such a gate, once every checklist item is checked and every required document is received or waived, the box at the top says "Ready for a decision" and the **Gate** tab shows **Ask for approval** to anyone with **Edit** on Projects.

1. Select **Ask for approval**. The workflow starts, and its approvers are told (in the application and by email, as their notification settings say). They find it on their **Approvals** page.
2. While it runs, the box says "Waiting for approval", and the **approval panel** at the top of the project page shows the workflow's steps, who it is waiting for, its due time and every decision. Approvers decide there, or from the **Approvals** page.
3. When the workflow approves, the approval is recorded as a gate decision, exactly as **Record decision** would: the approver's name (for a stand-in, "Stand-in name on behalf of approver name"), today's date and the reference "Approval workflow" followed by the workflow's name. The gate closes and the project moves to the next stage. If something blocks the gate again by then (for example a checklist item was cleared, or the project was put on hold), nothing changes and the workflow shows that its outcome could not be recorded; deal with the blocker and ask again.
4. When the workflow is rejected, a **Rejected** decision is recorded with the approver's reason and the gate stays open. You can ask again once the reason has been dealt with.

You cannot approve a request you asked for yourself. The person who asked, or an administrator, can cancel the request from the approval panel. While a gate's template names a workflow, or a request is waiting, its decision goes through the workflow: only an administrator can record it by hand instead (below), with a reason in **Notes**, and never the person who asked for the approval. That settles the gate and stops the request.

On a gate whose template names no workflow (the default, and every gate template of an installation set up before this version), decisions are recorded by hand as below.

### Recording a decision

Approvals given outside the application, for example by email or at a board meeting, are recorded here. You need **Approve** on **Projects**, and the button appears only on the project's current gate. On a gate whose template names an approval workflow (or with a request waiting), the button is shown only to administrators, who must say in **Notes** why the decision is recorded by hand.

1. On the **Gate** tab, select **Record decision**.
2. Choose the **Decision**: **Approved: move to** the next stage, **Deferred: decide later** or **Rejected**.
3. Enter the **Approver name**. This is required.
4. Check the **Approver role**. It is filled in with the first approver for the project's tier; change it if someone else decided.
5. Enter the **Decision date**. It starts as today and cannot be in the future.
6. In **Reference**, say where the approval is filed, and add any **Notes**.
7. Select **Record decision**.

What happens next depends on the decision:

- **Approved**: the gate closes, the project moves to the next stage and the next gate opens with a fresh checklist. Approving **Go-live** completes the project.
- **Deferred**: the gate stays open and the project appears under **Gate decisions due** on the portfolio. Record another decision later.
- **Rejected**: the gate is marked rejected and the project stays in its stage. The project's status does not change by itself; set it to **Canceled** or **On hold** if that is the outcome. A further decision can still be recorded on the gate.

Every decision is kept under **Decisions** on the **Gate** tab, newest first, with the date, approver, reference, notes and who recorded it.

### Why approval is blocked

In the decision window, choosing **Approved** while something is outstanding shows "This gate cannot be approved yet" and lists exactly what blocks it, one line each:

- **Checklist:** each item still unchecked.
- **Required document:** each required document that is neither received nor waived.
- **Certificate of readiness not issued:** the gate's template requires a certificate of readiness, the project carries certifiable items, and no certificate is in force (see [Safety and security certification](#safety-and-security-certification)).

**Record decision** stays disabled until the list is empty. Check the items and deal with the documents first, or record the decision as **Deferred**. A project that is on hold, canceled or completed cannot have any gate decision recorded ("No decision can be recorded yet"): make it **Active** again first.

### Moving a project back a stage

If a gate decision turns out to be premature, someone with **Approve** can send the project back to the stage before its last approved gate.

1. On the project page, open the **More actions** menu (the three dots at the top right) and choose **Move back a stage…**.
2. Enter the **Reason**. This is required.
3. Select **Move back a stage**.

The project returns to the earlier stage and that gate is reopened with its checklist and documents as they were. The reopening and your reason appear in the gate's **Decisions** and in the project's history. The gate needs a new decision before the project can move forward again. A completed project moved back from **Close** becomes **Active** again.

## Status reports and the red, amber, green trend

A status report is a short periodic update with four ratings. Open the **Status reports** tab.

### Adding or changing a report

1. Select **Add status report**.
2. Enter the **Period end** date. It starts as today.
3. Choose a rating for each of **Overall rating**, **Schedule rating**, **Budget rating** and **Risk rating**. All four are required.
4. Fill in **Accomplishments**, **Next steps** and **Decisions needed**.
5. Select **Add report**.

To correct a report, open the menu on it (the three dots) and choose **Edit**, change it and select **Save changes**. Choose **Delete** to remove it. Either way the project's ratings are recalculated and the change is recorded in the history.

The ratings mean:

| Rating | Meaning |
|---|---|
| **Green** | On track. |
| **Amber** | Needs attention. |
| **Red** | Needs a decision or help. |

### Where the ratings show

The ratings of the report with the latest period end become the project's current ratings. They appear as chips at the top of the project page and in the portfolio. A project with no reports shows "No report". The first chip at the top of a project names its stage, for example **Stage: Plan**. The spend against budget is shown in full ("$46,200 of $48,000"); the portfolio's tiles and chart use short amounts ("$46.2K").

Beside the overall rating an arrow shows the direction of travel, found by comparing the overall rating of the latest report with the one before it:

- up arrow: improving since the last report;
- right arrow: no change since the last report;
- down arrow: worse than the last report.

### The trend chart and the reports timeline

The **Trend** card draws one line for each of the four ratings over up to the last twelve reports, oldest on the left: green at the top of each line's band, amber in the middle, red at the bottom. Each point carries the letter G, A or R, so the chart can be read without relying on color; hover over a point for the rating and period.

Below it, **Reports** lists every report on a timeline, newest first, with its author, its four ratings and its text.

## The register: risks, issues, decisions and change requests

The **Register** tab is the project's own log. It holds four kinds of item: **Risk**, **Issue**, **Decision** and **Change request**. Use the buttons at the top to show **All** or one kind; each shows a count.

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

A project risk that matters beyond the project can be copied to the organization's risk register. Because this adds a risk to the register, you need **Create** on **Risks** as well as **Edit** on **Projects**; without it the menu entry is grayed out and the tab explains why.

1. On the risk's row, open the menu and choose **Escalate to risk register**.
2. Confirm with **Escalate**.

A new risk is created in the risk register with the same title and detail, a note saying which project it came from, the project risk's likelihood and impact as its inherent score, and the item's owner (or the project manager if the item has none). The project risk stays in the project and is marked "Escalated to the risk register" with the date, with **Open the risk** when you may see it. A risk can be escalated once. If the project risk has a likelihood without an impact, or the other way round, the risk register refuses it: enter both, or neither, and try again.

The risk register is restricted, so after escalating you may not be able to open the new risk yourself. See [Risks, actions and obligations](06-risks-actions-obligations.md).

## Milestones

Milestones are the handful of dates that matter. They appear on the portfolio timeline. Open the **Milestones** tab.

- To add one, select **Add milestone**, enter a **Name** and a **Due date**, and select **Add milestone**. Leave **Completed on** empty until it is done.
- To complete one, select **Mark done** on its row. Today's date is recorded. To record a different date, select **Edit** and set **Completed on**.
- To change or remove one, select **Edit** or **Delete**.

The **State** column shows **To do**, **Overdue** (past its due date and not done), or **Done** with the date, marked "(late)" if it was completed after the due date.

When a milestone passes its due date without being done, the project manager is told once. A register item (risk, issue, decision or change request) that passes its due date while still open is told to its owner, or to the project manager when it has none. Only projects that are active or on hold are looked at. Moving the due date and missing it again sends a new reminder.

## Scoring

Scoring gives each project a priority score out of 100 so that projects can be ranked against each other. Open the **Scoring** tab.

1. For each criterion under **Criteria**, select a number from 0 (none) to 5 (very strong), or **–** to leave it unscored.
2. The **Priority score** dial updates as you go and says "Preview: not saved yet."
3. Select **Save scores**, or **Discard changes** to go back.

Each criterion's weight is its share of the 100 points. It earns that share multiplied by its score out of 5, shown under each criterion (for example "25 points × 4/5 = 20"). The priority score is the sum; a criterion left unscored earns nothing. **How the score is worked out** on the tab says the same. The preview on the tab uses exactly the rule the application applies when it saves, so the score shown before saving is the score saved. The criteria supplied are:

| Criterion | Weight |
|---|---|
| Strategic alignment | 25 |
| Risk and compliance | 25 |
| Benefit to customers and staff | 20 |
| Financial return | 15 |
| Readiness to deliver | 15 |

Administrators can change the criteria and weights. The score appears on the project page and in the **Score** column of the portfolio table.

## Safety and security certification

A capital project that builds or changes something people will ride, work on or rely on (a new vehicle type, a signal system, a station, a fare system) is often certified safe and secure before it is used. The **Certification** tab on a project keeps that work: the items to certify, the requirements each must meet, the evidence that each requirement was verified, and the **certificate of readiness**.

### Certifiable items

A certifiable item is one part of the project to certify. On the **Certification** tab, select **Add certifiable item** and give:

- **Item**: for example "Low-floor bus type" or "Platform screen doors". It gets a reference such as CI-00001.
- **What it covers**, a **Category** (vehicles and rolling stock, systems and equipment, stations and facilities, track and infrastructure, operations and training, other) and an **Owner**.
- **Required for the certificate of readiness**: on by default. A required item must be verified before the certificate can be issued. Turn it off for an item that may stay open when the project is certified (for example finishing work); the certificate then lists it as an accepted open item.

An item is **Open** until it has at least one requirement and every requirement is verified or marked not applicable; it is then **Verified**. Use the three-dot menu on an item to add a requirement, edit the item or delete it (its requirements are deleted with it).

### Requirements and where they come from

Each requirement says what must be true, for example "Doors cannot open away from the platform". Select **Add requirement** on the item and give the **Requirement**, **What must be true**, and where it comes from:

- **Derived from: A hazard**: pick a hazard from the safety hazard log (needs **View** on Safety).
- **Derived from: A threat (a risk)**: pick a risk from the risk register (needs **View** on Risks and on Security incidents and restricted records). A requirement derived from a threat is **restricted**: only people who may see restricted records see its details. Everyone else sees "A restricted requirement" in its place, with its status, and it still counts in every figure.
- **Other basis**: a standard, design criterion or rule, as text.

Only the kinds of record you may open, in areas that are switched on, are offered. Add the **Verification method** (inspection, test, analysis, demonstration or document review), the **Verifier** and a **Due** date. Requirements with a verifier and a due date appear in that person's **My work** and on the **Calendar** until they are verified.

### Verifying a requirement

Choose **Record verification** from the requirement's menu. A requirement can be marked **Verified** only with a **Verification method** and some evidence: an **Evidence reference** (the test report or inspection record), **Verification notes**, or a file attached on the requirement's own page (open it from its reference; files there are evidence files). **Not applicable** needs a note saying why. The person and the date are recorded. Setting a requirement back to **Open** or **Verification under way** clears them.

### The certificate of readiness

The top of the tab says where the project stands:

- **The certificate cannot be issued yet**: lists each required item that is open and how many of its requirements are open.
- **Ready for the certificate of readiness**: every required item is verified. Someone with **Approve** on Projects selects **Issue the certificate**, says what it **Certifies as ready**, adds any **Conditions and restrictions**, their role and the date, and selects **Issue certificate**. The window lists the open items that are not required, which the certificate accepts.
- **Certificate of readiness in force**: with **Download the certificate (PDF)** and **Withdraw**.

The certificate PDF names the project, what it certifies, who issued it and when, every certifiable item with how many of its requirements were verified, the open items accepted, and the conditions. It shows only items, never the details of restricted requirements.

Only one certificate is in force at a time. It is **withdrawn automatically** when a required item opens again (a requirement is set back to open, a new required item or requirement is added, or an item is made required); the project manager and sponsor are told, and the reason names the items. Someone with **Approve** can also withdraw it by hand, with a reason. Withdrawn certificates stay under **Certificates** on the tab, with their PDFs. Issuing, withdrawing and printing are recorded in the project's history.

### Gates that require the certificate

An administrator can turn on **Require a certificate of readiness** on a gate template (see [Project settings](#project-settings)), typically **Go-live**. Such a gate cannot be approved while the project carries certifiable items and no certificate is in force; it shows "Certificate of readiness not issued" among the blockers. A project with no certifiable items is not affected.

### Across projects

The **Certifiable items** tab of **Projects and funding > Project portfolio** lists every certifiable item you may see, across projects, with filters by status, category, project and owner; **All requirements** lists the requirements. A role scoped to departments (see [Administration](09-administration.md)) sees the items and requirements of its departments' projects.

## Actions

Where the action tracker is in use, the **Actions** tab lists the to-dos raised from this project. Type in **Add an action and press Enter** (with an optional due date) to add one; it also appears in the action tracker with the source **Project**. See [Risks, actions and obligations](06-risks-actions-obligations.md).

## The portfolio

Open **Projects and funding > Project portfolio**. The strip at the top summarizes every project that is not canceled:

- **Projects**: how many there are and how many are active.
- **Overall rating**: how many are red, amber and green, with a bar of the split.
- **Spend against budget**: total spend to date against the total budget, with the percentage; it turns red when spend is over.
- **Gate decisions due**: active projects whose current gate is ready for a decision or was deferred. Select **Show which** for a table naming each project and gate, how much of the checklist is complete and whether it is ready or deferred; select a project to go straight to its **Gate** tab.
- **In delivery**: active projects in the Deliver stage against the work-in-progress limit, for example "2 of 3".

Below the strip, one box per stage shows how many projects are in it and their total budget. Select a stage box to show only that stage; select it again to clear it.

### The work-in-progress warning

Running too many projects at once slows all of them. The portfolio counts the **active** projects in the **Deliver** stage and compares the count with a limit, which is 3 unless your administrator has changed it. When the count is above the limit, a banner headed "Work-in-progress limit exceeded" appears, the **In delivery** tile turns red and the Deliver box is flagged. Projects on hold do not count.

The warning is advice only. It does not stop a gate being approved or a project entering delivery.

### The four views

Use **Table**, **Board**, **Timeline** and **Budget** to switch views. The view, the search and the filters are kept in the page address, so a view can be bookmarked or sent to a colleague, and the browser's Back button undoes a change.

| View | What it shows |
|---|---|
| **Table** | Every project in rows: **Reference**, **Name**, **Tier**, **Stage**, **Status**, **Overall** rating with trend arrow, **Score**, **Budget**, **Spend against budget**, **Project manager** and **Target date**. Search, filter, sort, save views and export here. Filters include tier, stage, status, overall rating, trend, funding source, project manager, the three impact questions and target date. |
| **Board** | One column per stage with a card for each project: reference, tier, name, overall rating with trend, target date, project manager, a budget bar, the next gate with how much is left to do, and a button: **Work the gate**, **See the gate** when it is ready, or **Move to** the next stage for an approver when it is ready (this opens the decision window). Cards cannot be dragged. Canceled projects are not shown. |
| **Timeline** | One row per project, the project names staying in view as you scroll sideways. Each project has a bar from start date to target date colored by stage, a diamond for each milestone (done, to do or overdue) and a line for today. Choose **Quarter** or **Year** to zoom. Projects with no dates and no milestones are left out, with a note saying how many. Open **Show milestones as a table** for the same information as text. |
| **Budget** | Tiles for the total **Budget**, **Spend to date**, **Remaining** and how many projects are **Over budget**; a **Budget versus actual** chart for each project with a budget or spend (spend beyond the budget is drawn in red; select a bar to open the project); and a **Figures** table with the remaining amount and totals. |

The **Board**, **Timeline** and **Budget** views have their own search box and **Tier**, **Stage**, **Status** and **Rating** filters; **Clear filters** removes them. Filters set in the table view that these views do not offer are named under the filters and apply only to the table.

In every view, spend against budget is drawn as a bar that turns red and says "over" when spend passes the budget.

## The project page

The **Overview** tab has cards you can change with **Edit**:

- **Project**: name, description, benefits, sponsor, project manager, system owner, department, status, start date and target date. The target date cannot be before the start date.
- **Money and suppliers**: budget, spend to date, funding source, and the linked vendor and contract (see [Vendors and contracts](04-vendors-and-contracts.md)). Spend to date is typed in by hand.
- **Tier and impact**: the tier, any override, the three impact questions, and free text for **Security impact** and **Data impact**.
- **Systems affected** (where the system inventory is in use): the systems the project changes, replaces or depends on, each linking to the system. Select **Add system** to search the inventory, **Done** to finish, and the cross beside a system to remove it. Systems you are not allowed to see are counted but not named.

The **Activity**, **Attachments**, **Related** and **History** tabs work as on every record. Files attached to gate documents are on the **Attachments** tab too.

## Notifications

Where notifications are in use, the projects area tells people about:

- **A gate ready for a decision**: approvers are told "Gate ready for a decision" and the project manager "Gate decision due". A daily check repeats this while the gate waits.
- **A certificate of readiness withdrawn automatically**: the project manager and sponsor are told "Certificate of readiness withdrawn" when a required certifiable item opens again.
- **A project turning red**: when a new report rates the project red overall and the previous one did not, the project manager and approvers are told "Project turned red".
- **A status report that is due**: once a project has left the Idea stage, its manager is reminded "Status report due" when there has been no report for longer than the number of days set in **Project settings** (30 by default).

Each person hears about one project at most once a day for each of these, and only about projects they can see.

## Project settings

Open **Projects and funding > Project portfolio** and the **Settings** tab (also on the **Administration** page), or select **Settings** on the portfolio. You need **Administer** on **Projects**. Each card is saved separately, and every change is recorded in the audit log.

| Card | What you can change |
|---|---|
| **Tier thresholds** | **Tier 3 is below** and **Tier 1 is above**. The second amount cannot be lower than the first. Select **Save thresholds**; the tier of every project is recalculated. |
| **Work-in-progress limit** | **Active projects in delivery**: a whole number of 1 or more. Select **Save limit**. |
| **Requests and reminders** | **Who may submit a project request**: **People who can create projects** (the default), **Everyone who can view projects** or **Everyone who can sign in**. **Status report due after (days)**: 1 to 366, counted from the period end of the last report. Select **Save requests and reminders**. |
| **Scoring criteria** | For each criterion, its name (**Criterion**), **What it means** and **Weight**. Use **Add criterion** or the trash icon, then **Save criteria**. At least one criterion must have a weight above zero. Every project's score is recalculated. |
| **Gates** | For each gate, select **Edit** to change the **Gate name**, the **Checklist** (one item per line), the **Documents** (a name each, with a **Required** switch; **Add document** adds one, the trash button removes one), **Ask for a change record at this gate**, **Require a certificate of readiness** (projects with certifiable items pass the gate only while a certificate of readiness is in force; this applies at once to gates already open), the **Approval workflow** (one of the active workflows of the kind "Project gate decision", or **None: decisions are recorded by hand**; the table shows it under **Approval**), and the **Approvers** for each tier (one role per line). Select **Save gate**. |

A ready-made workflow, **Gate decision** (one approval from anyone with **Approve** on Projects, due in five days), is supplied under **Administration > Approval workflows**, but no gate template names it until an administrator chooses it. The approval workflow a template names applies to its gates at once, including gates already open.

Other changes to a gate template apply to gates opened from then on. A gate already open on a project keeps the checklist and documents it started with.

## Sample data

The `dev` sample data (never the `pilot` profile a real installation uses) adds seven invented projects whose names start with **[Sample]**, for example "[Sample] Real-time passenger information upgrade" and "[Sample] Depot network refresh", spread across every stage with gates, reports, milestones and register items; "[Sample] Real-time passenger information upgrade" also carries certifiable items with their requirements. Delete them when you no longer need them.

## Not available yet

- A gate collects sign-off in the application only when its template names an approval workflow (see [Asking for approval through a workflow](#asking-for-approval-through-a-workflow)). The **Approvers** list of each tier is guidance: the application does not check a decision recorded by hand against it.
- Gates cannot be added or removed, and the stages they sit between cannot be changed, on screen.
- Moving a project back goes one stage at a time.
- Certification covers the whole project with one certificate of readiness: there is no separate certificate of conformance per item, and the application does not require a second person to confirm a verification.
