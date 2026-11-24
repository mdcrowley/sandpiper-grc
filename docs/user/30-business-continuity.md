# Business continuity

The business continuity pages hold what your organization's work depends on and how it recovers when something goes wrong: **business processes** (dispatch, fare collection, scheduling, payroll) with the systems, services, sites, vendors, positions and other processes each one needs; **business impact analyses** that work out how long each process can be down; **continuity and emergency plans** with their call trees, checklists, review cycle and approval; a **gap report** that compares the downtime each process tolerates with the recovery time of the systems it needs; and **emergency activations** for severe weather, power loss, major service disruptions and other events that are not cyber incidents. Open them from the **Safety** group in the navigation: **Business continuity**, **Continuity plans** and **Emergency activations**. The pages share tabs along the top: **Overview**, **Processes**, **Gap report**, **Plans** and **Activations**. Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not use these pages, an administrator can switch **Business continuity and emergency management** off under **Administration > Features** (see [Administration](09-administration.md#features)). The pages, their reminders, the "Business processes" section on system and site pages, the "Business continuity" source in the action tracker, the continuity notifications, the calendar entries and the continuity figures then disappear. Records are kept and return when it is switched back on.

You need the **continuity** permissions: `continuity.view` to read processes, analyses, plans and activations, `continuity.create` and `continuity.edit` to record and change them (and to run an activation), `continuity.approve` to sign off impact analyses directly and approve plans, `continuity.export` to print call trees and export lists, `continuity.delete`, and `continuity.administer` to send the reminders by hand. The default **Continuity manager** role holds all of them; **Security lead**, **Safety manager**, **Compliance officer**, **Auditor** and **Executive viewer** can read the pages. An administrator can grant the permissions to any other role under **Administration > Roles**.

Security incidents keep their own, restricted workspace (see [Security incidents](07-security-incidents.md)). An emergency activation is for everything else and shares nothing with it.

## Overview

**Business continuity** opens the overview: the number of active processes, how many have a **recovery gap**, how many plans are **overdue for review**, the emergencies under way, a chart of active processes by criticality (select a bar to open those processes), the emergencies not yet closed, and the plan reviews and impact analyses due in the next 60 days. **Activate a plan** starts an activation.

The figures count every record, whoever looks at them. The lists show only what you may see.

## Business processes

Open the **Processes** tab, or **Create** then **Business process**. A process has a **Name**, a **Department** (one of the organization's departments, **People > Departments**), an **Owner** (who is reminded about its impact analysis), a **Criticality** (**Vital**, **Essential**, **Important** or **Deferrable**), a **Status** (**Draft**, **Active** or **Retired**; only active processes are on the gap report), its **Peak periods**, the **Maximum tolerable downtime**, **Recovery time target** and **Recovery point target** in hours, the **Minimum staff to run it**, a **Description** and the **Manual workaround** used while its systems are down. **Last impact analysis** is set when an analysis is signed off; **Next impact analysis due** is set then too, and can be changed.

### Dependencies

The **Dependencies** tab lists what the process needs to run. To add one, choose the **Kind of record** (**System**, **Service**, **Site**, **Vendor**, **Business process** or **Position**), pick the record, add **Notes** if useful, and leave **Critical: the process stops without it** checked for something the process cannot run without. **Add dependency** saves it at once. Check or clear **Critical** on a row to change it, and **Remove** takes it off the list. A system shows its recovery time objective, or **Not known** when none is recorded on the system.

Each dependency is also listed on the record's **Related** tab (relation "depends on"), and a system or site page shows the processes that depend on it in a **Business processes** section (see [Inventory](03-inventory.md)). A system's section also lists the processes that depend on a service built on it.

Kinds of record from a part that is switched off (for example fleet services, or vendors) are not offered and not listed; dependencies on them are kept and come back when the part is switched on. A record you may not see is counted but not named, and is kept when you change the list.

### Impact analysis

The **Impact analysis** tab lists the process's analyses. **Start an impact analysis** creates one with the process's current downtime and targets, and opens it.

On the analysis's **Impacts** tab, rate how badly an outage of **1 hour**, **4 hours**, **1 day**, **3 days** and **1 week** hurts in each area: **Operations**, **Harm to people** (injury or risk to the life and health of staff, riders or the public), **Financial**, **Reputation** and **Legal or regulatory**, from **1 - minimal** to **5 - severe**. Ratings of 4 and 5 are shaded. The line under the grid suggests a tolerable downtime: the first outage length rated 4 or more in any area. Then set the **Maximum tolerable downtime**, **Recovery time target** and **Recovery point target**, answer the **Questions**, and select **Save**. Leaving the page with unsaved changes asks first.

The questions are the organization's own: an administrator changes them under **Administration > Lists** (list **Business impact analysis question**). Each question says how it is answered (**Answered as**: **Yes or no**, **A number** or **Text**); the setting is a column of the list and is chosen in the value's **Add value** or **Edit** dialog (see [Settings of a value](09-administration.md#settings-of-a-value)).

When the analysis is ready (it needs the maximum tolerable downtime), select **Submit for sign-off**. Signing it off locks the analysis, copies its downtime and targets onto the process, makes **Last impact analysis** today and **Next impact analysis due** a year later (the setting `continuity.bia_every_months`, 12 unless changed). Start a new analysis for the next review.

Who signs it off:

- **The process owner, through the approval workflow.** When the process has an **Owner**, submitting starts the **Impact analysis sign-off** workflow: the owner is asked to approve (they need only `continuity.view`), finds it under **Approvals**, and the workflow's progress shows at the top of the analysis (see [Approval workflows](22-approval-workflows.md)). **Process owner at submission** on the analysis says who was asked. Approval signs the analysis off in the owner's name; rejection sends it back to **Draft** with the reason in its history. Because the owner signs it off, the owner cannot submit it themselves: someone else does. An administrator can change the workflow (add steps, due times and escalation) or switch it off under **Administration > Approval workflows**.
- **Directly, with Sign off.** When no workflow applies (the process has no owner, or the workflow is switched off), the analysis stays **Submitted** and someone with `continuity.approve` selects **Sign off**. While the owner is still being asked, the button reads **Sign off directly**: it signs the analysis off at once and cancels the waiting request.

Setting a submitted analysis back to **Draft** by hand also cancels a waiting request.

### Plans that cover the process

The **Plans** tab lists the plans that cover the process.

## Gap report

The **Gap report** tab compares each active process's **maximum tolerable downtime** with the **recovery time objective** of every system it critically depends on, directly or through a critical service (while fleet services are on, a service brings in the systems it depends on). A process is listed when:

- a system needs longer to recover than the process tolerates (**Longer than tolerated**: a recovery gap, counted on the overview);
- a system needs longer to recover than the process's own **recovery time target** (**Longer than the target**);
- a critical system has no recovery time recorded (**Not known**).

Gaps come first. Each card shows the process's criticality, downtime and target, what was found, and its critical systems with their recovery times and the service they are reached through. **Show every active process** lists the processes without findings too. **Open process** goes to its dependencies. A system you may not see is listed as "A system you cannot see", with its recovery time.

To close a gap, shorten the system's recovery time (and record it on the system), or agree a longer tolerable downtime in the next impact analysis, or add a manual workaround and mark the dependency as not critical.

## Plans

Open **Continuity plans**, or **Create** then **Continuity plan**. A plan has a **Title**, a **Type of plan** (**Business continuity plan**, **Emergency operations plan**, **IT disaster recovery plan**, **Severe weather annex**, **Pandemic annex** or **Other**), an **Owner**, its **Scope**, **When to activate it** and its **Recovery strategies**. **Full text (policy document)** links a policy that holds the full text, when you keep it as a policy document (see [Policies](11-policies-and-exceptions.md)). **Review every (months)** (12 unless changed) and **Next review** set the review cycle.

### Processes

The **Processes** tab lists the processes the plan covers, with their criticality and tolerable downtime. Pick a process and select **Add**; **Remove** takes it off.

### Call tree

The **Call tree** tab lists who calls whom when the plan is activated: each person calls the people listed under them. **Add at the top** adds the first caller, and **Add under** adds someone they call. For each entry give the **Role** and **Who**:

- **A person on the roster** (when the roster is part of your installation, see [People and qualifications](29-people-and-qualifications.md)): the name and phone are read from the roster, so they stay up to date;
- **A user account**: the name is read from the account, and the phone from the roster person linked to it;
- **Type a name and phone**, for anyone else.

An **Other phone** and **Notes** can be added to any entry. The arrows move an entry up or down among the people called by the same person, a level up, or under the entry above it. **Remove** takes an entry off; the people it called move up to whoever called it.

**Print (PDF)** (with `continuity.export`) produces the call tree as a PDF, indented, with phones, to print and keep where it can be reached without the network. Printing is recorded in the plan's history. During an emergency activation, the call tree can also be sent a message by email and text message, with a link for each person to acknowledge it (see [Messaging the call tree](#messaging-the-call-tree)).

### Checklist

The **Checklist** tab lists the steps to take when the plan is activated, by phase: **Activate**, **Respond**, **Recover** and **Stand down**. Choose the **Phase**, give the **Role** that does it and the **Step**, select **Add step**, and select **Save checklist** when done. The checklist is copied into each activation of the plan; changing it later does not change activations already declared.

### Approval and review

The **Approval** tab shows the status, when and by whom the plan was approved, the review cycle and the next review date. **Submit for approval** (it needs a scope and when to activate it) starts the **Continuity plan approval** workflow, and the plan becomes **In review**; the workflow's progress shows at the top of the page (see [Approval workflows](22-approval-workflows.md)). By default someone with `continuity.approve` decides. Approval makes the plan **Approved**, records the approver and the date, and sets **Next review** to today plus the review cycle. Rejection sends it back to **Draft**, with the reason in its history. To renew an approved plan, review it and select **Submit the reviewed plan for approval**.

A plan whose review date has passed shows a notice at the top of its page and counts as overdue on the overview.

### Exercises

The **Exercises** tab (when exercises are part of your installation) shows the date the plan was **Last exercised** and the exercises that tested it. Pick an exercise and select **Link** (this needs `exercises.view` too); the link is also on both records' **Related** tabs (relation "exercised by"). See [Training and exercises](12-training-and-exercises.md).

## Emergency activations

Open **Emergency activations**, select **Activate a plan** (or **Create** then **Emergency activation**), and give **What is happening**, the **Kind of event** (**Severe weather**, **Power loss**, **Major service disruption**, **Loss of a facility**, **Public health** or **Other**), the **Level** (**Monitoring**, **Partial activation** or **Full activation**) and the **Plans to activate**. **Declare the activation** opens its workspace. Each plan's checklist is copied in, and the log starts with the declaration.

The workspace has five tabs:

- **Log**: what happens, as it happens. Each entry is stamped with your name and the time; **Ctrl+Enter** adds it. Entries cannot be changed or removed; to correct one, add another. Role changes, checklist steps, level changes, standing down and closing are logged too.
- **Roles**: who is doing what (for example **Emergency manager**, **Operations lead**, **Communications lead**, **Scribe**). Choose a roster person, a user account or type a name. **End role** records the handover.
- **Checklist**: the steps copied from the plans, by phase. Check a step when it is done; who and when are shown and logged. **Add step** adds one for this activation only.
- **Call tree messages**: send an activated plan's call tree a message, and see who has acknowledged it (below).
- **Summary**: when the emergency is over, write the **Stand-down summary** (what happened and the state things are left in) and select **Stand down**. Then write the **After-action summary** (what went well, what to improve) and select **Close the activation**. Once stood down, each after-action finding can raise a **corrective action plan** (source "Business continuity"; see [Corrective action plans](24-corrective-action-plans.md)). A closed activation can no longer be changed.

### Messaging the call tree

While an activation is active, someone with `continuity.edit` can send the call tree of one of its plans a message from the **Call tree messages** tab:

1. Select **Send a message**.
2. Choose whose **Call tree** to message (one of the plans activated), write the **Message** (what is happening and what people should do, up to 1,000 characters), and choose **By email**, **By text message** or both. **Links work for (hours)** is 72 unless changed (1 to 168).
3. Select **Send**.

The message goes out through the application's own alert channels, the ones an administrator sets up under **Administration > Email** (see [Administration](09-administration.md)); no paid paging service is involved:

- **Email** goes to the address of the person's account, or, for a roster person with no account, the email address on the roster.
- **Text messages** go to people with an account who have saved a mobile number or an email-to-text address for urgent alerts (see [Your mobile number and email-to-text address](14-attachments-and-notifications.md#your-mobile-number-and-email-to-text-address)). A text carries the start of the message (about the first 200 characters) and the link.
- An entry with only a typed name and phone is not messaged: it is listed as **Not reachable: call them**.

Someone who is on the call tree twice gets one message. If neither email nor text messages are set up, the tab says so and nothing can be sent: call people from the printed call tree.

Each person gets a **link of their own**. Opening it shows the organization, the activation, the message and the button **I have received this message**, with an optional note (for example "On my way"). No sign-in is needed. Opening the link does not acknowledge by itself, so a mail program that checks links cannot acknowledge for them. The link is for that one message and that one person, and works until it expires or the activation is closed; acknowledging twice changes nothing. It should not be forwarded.

Under each message sent, the tab shows how many people have acknowledged, then everyone on it, those who have not yet acknowledged first: their role, how they were reached (and **not delivered** when the email or text could not be sent), and when they acknowledged, through their link or recorded by staff, with their note. For someone who acknowledges another way, such as on the phone, select **Record acknowledgment** and add a note. **Remind those who have not acknowledged** sends the message again to everyone still waiting who can be reached, each with a new link (the earlier one stops working). Sending, each acknowledgment and each reminder are written to the activation's log. At most 20 messages and reminders go out for one activation in an hour.

A text message has to carry its link in its text, so administrators can see the link in the delivery log of text messages; the link can do nothing but acknowledge that one message.

## Reminders

Once a day the application reminds:

- a plan's owner when its review date is within `continuity.plan_review_reminder_days` (30 unless changed), and once more when the date has passed;
- a process's owner when its next impact analysis is due within `continuity.bia_reminder_days` (30 unless changed).

Without an owner, everyone who may edit continuity records is told. Each occasion is announced once, even when two servers run the reminders at the same time. Administrators change the lead times under **Administration > Reminders**, and can send the reminders at once with `POST /api/continuity/reminders/run`. People can switch the **Business continuity** notifications off for themselves.

## Calendar

Two calendar sources can be added to a personal calendar feed (see [Calendar feeds, work trackers and evidence links](36-calendar-feeds-work-trackers-and-evidence-links.md)): **Continuity plan reviews and impact analyses due (mine)**, for the plans and processes you own, and **Exercises of continuity plans I own**.

## Figures for indicators and AI assistants

Two monthly figures are offered to safety performance indicators and key risk indicators: **Business processes with a recovery gap** (`continuity.processes_with_gap`, worked out from the records as they are now, so only the current month has a figure) and **Continuity plans overdue for review** (`continuity.plans_review_overdue`). `GET /api/continuity/summary` gives the counts (processes, gaps, plans, overdue reviews, active activations) with no names, the same for everyone.

## Retention

Anonymizing a plan at the end of its retention period also clears the typed names, phones and notes of its call tree. Anonymizing an activation also replaces its log entries, the names in them, typed role names, the names and notes on its checklist, and the names and acknowledgment notes of its call tree messages. Names read from the roster or from accounts are not stored with the plan or activation. See [Administration](09-administration.md#retention).

## Sample data

The sample data (development profile only) has ten invented business processes of a bus and light-rail operator, with dependencies on the sample systems, services, sites, vendors and positions; impact analyses for six; two recovery gaps by construction (fare collection and payroll); three plans (an approved business continuity plan, an emergency operations plan with a severe weather annex waiting for approval, and an IT disaster recovery plan overdue for review) with call trees from the sample roster and checklists; and one closed severe-weather activation with its log, roles, checklist and an after-action corrective action plan. Everything is marked "[Sample]". Vendors and exercises are loaded after this part, so they are linked when the sample data is loaded a second time.
