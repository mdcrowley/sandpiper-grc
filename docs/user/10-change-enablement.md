# Change enablement

The Change area is where changes to systems are planned, assessed for risk, approved, scheduled, carried out and reviewed, so that everyone can see what is about to change and anything that goes wrong can be traced back. This page covers raising a change, the three types of change, the risk questionnaire, approvals, the calendar with blackout periods and conflicts, completing and reviewing a change, and the settings an administrator maintains. The screens are in the **Change** group of the menu: **Changes**, **Change calendar**, **New change** and **Change settings**.

## What you need

| To do this | You need this permission on Changes |
|---|---|
| See the register, the calendar and any change | **View** |
| Raise a change, including a standard change from a template | **Create** |
| Edit a change, move it through its statuses, record the review, link records | **Edit** |
| Approve or reject a change you are an approver for, and acknowledge a conflict | **Approve** |
| Maintain templates, blackout periods, approval rules and the risk questionnaire | **Administer** |

Raising follow-up actions also needs **Create** on **Actions**. Roles are managed by an administrator; see [Administration](09-administration.md).

## The three types of change

| Type | Use it for | Approval |
|---|---|---|
| **Standard** | Routine, low-risk work done the same way every time. | None. It is raised from a pre-approved template. |
| **Normal** | Planned work. | The number of approvals set by the approval rules for its risk level. |
| **Emergency** | Urgent work to restore a service or prevent harm. | One approver, whatever the risk. A post-implementation review is always required afterwards. |

The type can be changed only while a change is a draft, and a change cannot be switched to or from **Standard**.

## The life of a change

A change moves through these statuses. The bar at the top of a change shows where it is.

| Status | Meaning |
|---|---|
| **Draft** | Being written. Not yet visible to approvers as waiting. |
| **Awaiting approval** | Submitted. Waiting for the approvals its rule asks for. |
| **Approved** | Every approval needed has been recorded. |
| **Rejected** | An approver rejected it. It can be returned to draft, revised and submitted again. |
| **Scheduled** | Approved and confirmed for its planned window. |
| **In progress** | Work has started. |
| **Completed** | Work has finished and the outcome is recorded. |
| **Reviewed** | The post-implementation review has been recorded. |
| **Closed** | Finished. Nothing more can be edited. |
| **Cancelled** | Abandoned. It stays in the register but cannot be edited or reopened. |

The application enforces the order. A change cannot be scheduled or started until it has its approvals and its conflicts are resolved or acknowledged, and it cannot be closed while a required review is missing.

## The register

Open **Change > Changes**. The tiles at the top count changes that are **Awaiting approval**, **Planned this week** (Monday to Sunday of the current week), **In progress**, with a **Review due**, and **Open emergency changes**. Select a tile to see those changes.

If you approve changes, **Waiting for your decision** appears under the tiles whenever a change is waiting for you, with its planned start and how many approvals it has. Select a change to open its **Approvals** tab.

The **View** menu beside **Filters** holds ready-made saved views, which you can keep, rename or delete like your own:

- **Owned by me**: changes you own. Whoever raises a change is its owner unless someone else is chosen.
- **Implemented by me**: changes where you are the **Implementer**.
- **Awaiting approval**
- **Scheduled and in progress**
- **Review due**
- **Emergency**

**All changes** shows every change. You can search, use **Filters** (including **Main system**), sort by a column, save your own view and export the list. The address in the browser keeps the search and filters, so a view can be bookmarked or sent to a colleague. To give many changes a new **Owner** or **Implementer** at once, tick them and select **Edit selected…**. See [Getting started](01-getting-started.md) for how lists work.

## Raising a change

1. Open **Change > New change**, or select **New change** on the register or the calendar.
2. On the **Type** step, choose **Standard**, **Normal** or **Emergency**, then select **Next**.
3. Follow the steps for that type, below. Select a step name at the top to go back to an earlier step.

### A normal or emergency change

1. On the **Details** step, enter a **Title**. Describe **What will be done** and **Why it is needed**.
2. Choose the **Main system** and the **Implementer**, the person who will do the work. Under **Other affected systems**, use **Add a system** for every other system the change touches.
3. On the **Risk** step, answer each question. The **Risk** level and score update as you answer.
4. On the **Plans** step, write the **Implementation plan**, the **Test plan** and the **Back-out plan**.
5. On the **Schedule** step, enter the **Planned start** and **Planned end**.
6. Read **Conflicts**. The check runs as you type and lists any blackout period the window falls in and any other change that overlaps it on one of the same systems.
7. Read **What happens next**, which says how many approvals the change will need.
8. Select **Create and submit** to ask for approval straight away, or **Save as draft** to finish later.

**Create and submit** is available only when the change has a description, a reason, an answer to every risk question, an implementation plan, a back-out plan and a planned start and end. The page lists whatever is still missing. A draft needs only a title.

You can create a change that has a conflict. It is flagged, and it cannot be scheduled until the conflict is dealt with; see [Conflicts](#conflicts).

### A standard change

1. On the **Template** step, choose a template. Each shows when to use it, its risk level and its usual duration.
2. Check the **Title**, and choose the **Main system** and **Implementer**. The plans come from the template.
3. On the **Schedule** step, enter the **Planned start**. The **Planned end** is filled in from the template's usual duration; change it if you need to.
4. Select **Create change**.

The change is created with the status **Approved** and needs no further approval.

## Risk

The risk questionnaire gives each change a score from 0 to 100 and a level: **Low**, **Medium** or **High**. The level, with the type, decides how many approvals are needed. The **Risk** card on a change shows the level, the score and each answer.

To change the answers, open the change while it is a **Draft** and select **Edit** on the **Risk** card. Once a change has been submitted the assessment is fixed; use **More > Return to draft** first.

### Overriding the risk level

If the questionnaire gives the wrong answer for a particular change:

1. On a draft, select **Edit** on the **Risk** card.
2. Choose a **Risk override**.
3. Enter the **Reason for override**. This is required.
4. Select **Save risk assessment**.

A notice on the change then shows the level that was set by hand, the level the questionnaire gives, and the reason. The override is recorded in the history. A standard change takes its risk level from its template.

## Approvals

Each approver decides in the application, on their own behalf. The approval rule for the change's type and risk says how many approvals it needs and, optionally, who may give them: named people, the members of chosen roles, or (when it names nobody) anyone with **Approve** on **Changes**.

### Submitting for approval

On a draft, select **Submit for approval**. If anything needed is missing, the message says what. If the approval rules ask for no approval for this type and risk, the change goes straight to **Approved**.

When the change is submitted, the approvers it is waiting for are fixed from the rule in force at that moment, and each of them is sent a notification. A later change to the rules does not change who approves a change already submitted; returning it to draft and submitting it again does.

### Approving or rejecting

You need **Approve** on **Changes**, you must be one of the approvers the change is waiting for, and you cannot decide on a change you raised yourself.

1. Open the change, from the notification, **Waiting for your decision** on the register, or the register itself.
2. Select **Approve** or **Reject**, at the top of the page or on the **Approvals** tab.
3. For an approval, add any **Notes** (for example conditions for the implementer). For a rejection, give the **Reason**; it is required.
4. Select **Approve** or **Reject** in the dialog.

The decision is recorded under your name with today's date. Each person decides once per submission, so one person can never make up the number on their own.

### Recording a decision given outside the application

If you gave your decision in a meeting or by email, record it yourself: on the **Approvals** tab open the menu beside **Reject** and choose **Record a decision given outside the application…**. Choose the **Decision**, check the **Approver name** and **Approver role**, enter the **Decision date** (it cannot be in the future), say in **Reference** where the evidence is filed, and select **Record decision**. It counts as your decision, exactly like **Approve** or **Reject**.

### The Approvals tab

The tab shows how many approvals have been recorded out of the number needed, **Who may approve** and, while the change is waiting, who is **Still to decide**. Below, **Decisions** lists every decision with who gave it and who recorded it. When the last approval needed is recorded the change becomes **Approved**. A rejection makes it **Rejected** at once. If you cannot decide, a note on the tab says why.

The owner, the implementer and the person who raised the change are told about each decision.

To revise a rejected change, select **Return to draft**, make the changes and submit it again. Decisions from the earlier submission stay in the list, marked **Earlier submission**, and no longer count.

### Approval after the work has started

An administrator can allow this for a type of change, usually emergencies, in the approval rules. Where it is allowed, **Start work** is offered while the change is still **Awaiting approval**. The approval must then be recorded before the change can be closed, and it is marked **After the fact**.

## Scheduling and carrying out a change

Use the button at the top of the change. Less common moves are under **More**.

| Button | What it does |
|---|---|
| **Schedule** | Confirms an approved change for its planned window. |
| **Start work** | Marks the change **In progress** and records the actual start. |
| **Complete** | Opens **Complete this change**. Choose the **Outcome**, check the **Actual end**, add **Outcome notes** and select **Complete change**. |
| **Close change** | Closes a completed or reviewed change. |
| **More > Take off the schedule** | Returns a scheduled change to **Approved**. |
| **More > Return to draft** | Withdraws a change that is awaiting approval or was rejected. |
| **More > Cancel change** | Cancels the change. You can give a **Reason**. |

The outcomes are **Successful**, **Successful with issues**, **Failed** and **Backed out**.

To move a change, select **Edit** on the **Schedule and outcome** card and change the **Planned start** and **Planned end**. Conflicts are checked again for the new window.

The **Plans** tab holds the **Implementation plan**, **Test plan** and **Back-out plan**; select **Edit** there to change them.

About a day before an approved or scheduled change is due to start, its owner and implementer get a **Change starting soon** notification. If the change is moved, they are told again about the new window.

## Systems and links

The **Systems and links** tab shows what a change touches and what it relates to.

- **Affected systems and assets**: choose a **Type**, find the record and select **Add**. The main system and main asset are marked **Main**; change those with **Edit** on the **Change** card. Each system's own page lists the change under **Related**.
- **Tickets, problems and projects**: choose a **Type**, find the record, choose **How it relates** (for example **This change fixes it** or **This change caused it**) and select **Add**. The link shows on both records.

Affected systems matter: two changes conflict only when they overlap in time and share a system.

## Conflicts

A change is flagged when its planned window:

- falls in a **blackout period**, a time when changes should not be made (a blackout period for chosen systems flags only changes that affect one of them; one that repeats flags each repeat); or
- overlaps another change that is awaiting approval, approved, scheduled or in progress and affects one of the same systems.

Conflicts are shown in the **New change** flow, in a notice and on the **Conflicts** tab of the change, and on the calendar. Drafts, and changes that are finished, rejected or cancelled, do not count against other changes.

A change with an unresolved conflict cannot be scheduled or started. There are two ways forward:

- **Move the change.** Edit the planned start and end so the window is clear.
- **Acknowledge the conflict.** Someone with **Approve** on **Changes** records that the conflict is known and that the change may go ahead:
  1. Open the **Conflicts** tab and select **Acknowledge and override**.
  2. Enter the **Reason**. This is required.
  3. Select **Acknowledge and override**.

The name of the person and the reason are shown beside the conflict and recorded in the history. An acknowledgement applies only to the planned window it was given for: if the change is moved, any conflict must be looked at again.

## The change calendar

Open **Change > Change calendar**.

- Switch between **Month** and **Week**. Use the arrows to move, and **Today** to come back.
- To see one system, search for it in the box beside **Month** and **Week** (it shows **All systems** until you choose one). The calendar then shows only the changes that affect that system (as main system or as another affected system) and the blackout periods that apply to it. Select **Show all systems** in the notice to go back. The address can be bookmarked or sent from a system's page.
- In the month view, select a day number to open that week.
- Each change is coloured by type. Finished changes are faded and drafts have a dashed outline.
- Blackout periods are shaded with stripes and named.
- A warning triangle marks a change with an unresolved conflict. A tick marks a change whose conflict has been acknowledged.
- Select a change to open it.

Under the calendar, **Conflicts in this period** lists every change with an unresolved conflict and what it clashes with, and **Blackout periods in this period** lists the blackout periods shown, with whether each repeats and which systems it applies to. **Show on calendar** on a change's **Conflicts** tab opens the calendar at that change's week.

## Post-implementation review

A review records what happened, why, and what will be done differently. It is required before closing:

- every **Emergency** change;
- any change whose outcome was **Failed** or **Backed out**;
- any change whose approval rule has **Review required** ticked.

A review can be recorded for any other completed change too.

1. Open the completed change and select **Record review**, or open the **Review** tab.
2. Fill in **What happened** and **Cause**. Both are required. Add any **Follow-up**.
3. Under **Follow-up actions**, select **Add an action** for each piece of work that comes out of the review, and give it an **Owner** and a **Due date**.
4. Select **Save review**.

The change becomes **Reviewed** and can then be closed. Each follow-up action becomes a record in the Actions list, linked to the change, and is listed on the **Review** tab; see [Risks, actions and obligations](06-risks-actions-obligations.md). More actions can be added later with **Raise action**. Until the change is closed the review can be corrected with **Edit review**.

The **Actions** tab (shown when actions are in use) lists every action raised from the change, with its owner, due date and progress, and lets you add one directly.

## History, comments and attachments

Every change has the **Activity**, **Attachments**, **Related** and **History** tabs described in [Getting started](01-getting-started.md). Attach the evidence of an approval, a test report or a screenshot of the outcome on **Attachments**. The history records each status move, approval decision, conflict override, risk override, review and change of main system or asset, with who did it and when.

## Change settings

Open **Change > Change settings**. You need **Administer** on **Changes**. Every change made here is recorded in the audit log.

### Templates

A template describes routine work that has been approved in advance.

1. On the **Templates** tab, select **Add template**.
2. Enter a **Name** and, in **When to use it**, a sentence to help people choose it.
3. Enter the **Change title** given to each change raised from it, **What will be done** and **Why it is needed**.
4. Write the **Implementation plan** and **Back-out plan**. Both are required. Add a **Test plan**.
5. Choose the **Risk** and the **Usual duration in minutes**. Optionally choose a **Main system**.
6. Select **Save template**.

To stop a template being used without deleting it, edit it and untick **In use**.

The table shows how often each template was **Used, last 90 days** and **Used in total**, and when it was **Last used**. A template raised far more often than expected may be covering work it was not approved for.

### Blackout periods

1. On the **Blackout periods** tab, select **Add blackout period**.
2. Enter a **Name**, the **Start** and the **End**.
3. In **Repeats**, keep **Does not repeat**, or choose **Every week** or **Every month** (for example each weekly timetable switch-over night, or every month-end). A repeating period must be shorter than the repeat. Optionally set **Repeat until**; leave it empty to repeat with no end. A monthly repeat on the 31st falls on the last day of shorter months.
4. Optionally, in **Applies to systems**, search for and add the systems the period protects. With none, the period applies to every change. Remove a system with the cross on its chip.
5. Enter a **Reason**. It is shown wherever a change is flagged against the period.
6. Select **Save blackout period**.

The table shows each period's **Repeats** and **Systems**. Deleting a blackout period stops changes being flagged against it.

### Approval rules

Each rule says what one kind of change needs.

| Field | Meaning |
|---|---|
| **Change type** | The type the rule applies to, or **Any type**. |
| **Risk** | The risk level the rule applies to, or **Any risk**. A rule for a named level wins over a rule for any risk. |
| **Approvals** | How many different people must approve. An emergency change cannot need more than one. |
| **Approver titles** | How the expected approvers are described, separated by commas (for example Change manager). Shown to people; they do not limit who approves. |
| **Named approvers** | People who may approve: search for each and select them; remove one with the cross on its chip. Name at least as many as the rule's **Approvals**, or also choose a role. |
| **Approving roles** | Roles whose members may approve. With named approvers or roles, only those people may decide and only they are asked; with neither, anyone with **Approve** on **Changes** may. The line under them says who that is. |
| **Review required** | A post-implementation review is needed before closure. Always on for emergency changes. |
| **Approval may follow the work** | Work may start before approval is recorded. The approval is then marked **After the fact**. |

Select **Add rule** for a new rule and **Save rules** when finished. Saving applies the rules to drafts at once. Changes already submitted keep the number of approvals they were given. If no rule matches a change, it needs one approval.

### Risk questionnaire

On the **Risk questionnaire** tab:

- **Risk levels** sets where each level ends: **Low up to** and **Medium up to** a score. **High** runs from there to 100.
- **Questions** lists each **Question** with its **Weight**, optional **Help text**, and its answers, each with a **Score**. Use **Add answer** and **Add question** to extend the list.

The score of a change is worked out by multiplying the score of each chosen answer by the weight of its question, adding these up, and taking the total as a percentage of the highest total possible.

Select **Save questionnaire** when finished. Drafts are rescored at once. Changes already submitted keep the level they were assessed at.

### Lists

The names and colours of the change types, statuses, risk levels and outcomes can be changed under **Administration > Lists**; see [Administration](09-administration.md).
