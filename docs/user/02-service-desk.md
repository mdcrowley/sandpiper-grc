# Service desk

The service desk is where the IT team logs and works on incidents and service requests, tracks the problems behind repeated incidents, keeps a knowledge base, and offers a catalog of standard requests. This page covers each of those, the service desk dashboard and the service desk settings. Lists and record pages work as described in [Getting started](01-getting-started.md).

An administrator can switch the whole service desk off under **Administration > Features** (see [Administration](09-administration.md#features)); the self-service portal then goes too. Its records are kept and return when it is switched back on.

## Tickets

A ticket is either an **Incident** (something is broken) or a **Service request** (someone needs something). IT staff log tickets on behalf of the colleague who asked; when the [self-service portal](18-self-service-portal.md) is switched on, staff can also raise and follow their own. A ticket raised there shows **Portal** under **How it arrived**, and the **Requester** card notes that the requester sees public comments only.

### The ticket list

Open **Tickets** in the **Service desk** group. Above the list is a row of queues, each with the number of tickets in it now:

| Queue | Shows |
|---|---|
| **My open** | Unresolved tickets assigned to you |
| **Unassigned** | Unresolved tickets with no assignee |
| **At risk** | Unresolved tickets close to their resolution target (see [Warnings](#warnings-and-notices)) |
| **Breaching** | Unresolved tickets that have missed their resolution target |
| **With vendor** | Unresolved tickets held by a vendor |
| **Awaiting approval** | Requests that cannot start until someone approves them |
| **Major incidents** | Open major incidents |
| **All open** | Every unresolved ticket |
| **All** | Every ticket, open or not |

Each queue is an ordinary address, so you can bookmark it or send it to a colleague. The queues are also offered to every agent as **shared views** of the list (the **All tickets** menu beside the search box), so they are there on any computer you sign in from. An administrator can rename or remove a shared view, and anyone can share a view of their own with the desk. Your own saved views are kept with your account, not only in this browser.

The **Resolution target** column shows the time left on the resolution target, **Overdue by** once it has passed, **Paused** while the clock is stopped, and **Met** or **Missed by** once the ticket is resolved. Badges beside the title mark a **Major** incident, a ticket with a **Vendor**, one waiting for **Approval**, and one that has been **Escalated**. More columns (department, type, category, assignment group, last update) can be switched on with the column chooser.

Press **N** anywhere on the list to start a new ticket.

### Change many tickets at once

1. Check the tickets in the list (the box in the header selects the whole page).
2. Select **Edit selected…**.
3. Choose the **Field to change**: **Assignee**, **Assignment group**, **Status**, **Priority**, **Category** or **Type**, and the new value.
4. Select **Apply to** (for example **Apply to 3 tickets**).

Each ticket is changed on its own, so the usual rules apply: for example a ticket cannot be resolved this way without a resolution code. The dialog says how many were changed and why any were not.

### Log a ticket on someone's behalf

1. Select **New ticket** on the ticket list (or press **N**), or **Create** then **Ticket**.
2. To start from a standard request, select it under **Start from the catalog**. Its values are filled in and its questions are added to the form (see [Catalog](#catalog)).
3. Choose the **Type** and, if you can, a **Category**.
4. Enter a **Title**: a short description of what is wrong or what is needed. As you type, the form lists open tickets that look the same under **Possibly already logged**, and published articles under **Knowledge articles that may help**. These links open in a new browser tab, so nothing you have typed is lost.
5. Add detail in **Description**.
6. Under **Who it is for**, enter the **Requester**: the colleague you are logging this for. Add **Requester department** and **Requester email** if you have them. Use **Affected person** only if it is someone other than the requester.
7. Under **How serious it is**, choose **Impact** and **Urgency**. The line **Priority from impact and urgency** shows the priority the ticket will get and when it must be responded to and resolved (**Respond by** and **resolve by**), and changes as you choose.
8. Under **Who works on it**, optionally choose an **Assignment group** and an **Assignee** (**Assign to me** fills in your own name), the **Affected system** and the **Affected asset**. In **How it arrived**, choose how the request reached you, for example **Phone** or **In person**.
9. If your administrator has added fields of their own to tickets (**Custom fields**), they come last, under their own headings (**More details** unless the field has a section). Fields marked with an asterisk must be filled in.
10. Select **Log ticket**, or press **Ctrl** and **Enter**.

The ticket gets a reference such as `TKT-00042` and opens. To log several tickets in a row, select **Log and add another**: the form empties and stays open.

As installed a new ticket starts as an **Incident** with impact **One person** and urgency **Medium**, and **How it arrived** set to **Logged by IT**.

### The ticket page

The header shows the reference, title and priority, then the buttons for the next step. Under it, one strip shows everything needed at a glance:

- **Status**, with one sentence saying what should happen next.
- **Respond** and **Resolve**: the two service-level clocks, with the time left, a bar showing how much of the time has been used, and when each is due.
- **Assignee** and the assignment group.

Below the strip are the **Description** (select **Edit** to change the title or description), **Request details** and **Fulfillment tasks** for a catalog request, the **Resolution** once there is one, and on the right the **Details**, **Requester**, **Vendor** and **Dates** cards. A **May help** card lists published knowledge articles and other open tickets that share words with the title. The tabs at the bottom hold **Activity** (comments and changes), **Attachments**, **Related** records and **History**.

### Quick actions

The buttons in the header change with the ticket so that the usual next step is always one click:

| Button | When it shows | What it does |
|---|---|---|
| **Assign to me** | The ticket is not yours and not finished | Makes you the assignee. A **New** ticket also moves to **Assigned** |
| **Start work** | The ticket is open but not yet in progress | Moves it to **In progress** |
| **Pause** | The ticket is open | Choose **Waiting on requester** or **Waiting on vendor**. The clock stops |
| **Resume** | The ticket is paused | Moves it back to **In progress**. The clock runs again |
| **Resolve** | The ticket is not finished | Asks for the resolution code and notes (see below) |
| **Close ticket** | The ticket is resolved | Asks for the resolution code and the requester's satisfaction |
| **Reopen** | The ticket is resolved or closed | Moves it back to **In progress** |

Everything else is under **More actions** (the **…** button): **Set status** to any status, the vendor actions and the major incident flag.

### Impact, urgency and priority

Priority is worked out from impact and urgency. As installed, the table is:

| Impact | High - work has stopped | Medium - work is slowed | Low - can wait |
|---|---|---|---|
| Whole organization or safety | P1 Critical | P2 High | P3 Normal |
| A department or site | P2 High | P3 Normal | P4 Low |
| One person | P3 Normal | P4 Low | P4 Low |

Your administrator may have changed this table (see [Service desk settings](#service-desk-settings)).

To choose a priority yourself when logging a ticket, check **Set the priority by hand** and pick a **Priority**. On an existing ticket, select **Edit** on the **Details** card and change **Priority**.

A priority set by hand stays as it is when impact or urgency change later. To go back to the worked-out value, set **Priority** to the value in the table.

### Statuses

| Status | Meaning | Clock |
|---|---|---|
| **New** | Logged, nobody has picked it up | Running |
| **Assigned** | Someone owns it | Running |
| **In progress** | Work is under way | Running |
| **Waiting on requester** | You need something from the requester | Paused |
| **Waiting on vendor** | A vendor has to act | Paused |
| **Resolved** | Fixed or fulfilled, awaiting confirmation | Stopped |
| **Closed** | Finished | Stopped |
| **Canceled** | Not needed after all | Stopped |

Use the quick actions above, or **More actions** then **Set status** for any other move. To cancel a ticket, select **More actions**, then **Set status: Canceled**. It is canceled at once, with no further questions.

As installed every status change is allowed. Your administrator may limit which changes are allowed, or which fields must be filled in first, under **Administration > Lifecycles**; a change that is not allowed is refused with a message saying why. See [Lifecycles](23-lifecycles.md).

### Assign a ticket

- To take a ticket yourself, select **Assign to me**. If the ticket is **New**, it also moves to **Assigned**.
- To give it to someone else, select **Edit** on the **Details** card, choose the **Assignee** and, if you use them, the **Assignment group**, then select **Save changes**.

The new assignee is told in their notifications. A ticket given to a group with nobody assigned tells the group's members (see [Notifications](#notifications)).

### Resolve and close a ticket

To resolve:

1. Select **Resolve**.
2. Choose a **Resolution code**, for example **Fixed**, **Workaround provided** or **Request fulfilled**. A code is required.
3. Enter **Resolution notes**: what fixed it, or what was provided. This helps the next person with the same problem.
4. Select **Resolve**.

A **Resolution** card then appears on the ticket, where the code and notes can be corrected. If a catalog request still has fulfillment tasks that are not checked, the **Resolve ticket** and **Close ticket** boxes say how many; you can still go ahead.

To close:

1. Select **Close ticket**.
2. If the ticket has no **Resolution code** yet, choose one. Closing a ticket needs a resolution code, as resolving does; canceling does not.
3. Record the requester's satisfaction if you have it (see below).
4. Select **Close ticket**.

### Satisfaction

A requester who uses the [self-service portal](18-self-service-portal.md) answers for themselves once the ticket is resolved. Their answer shows on the **Requester satisfaction** card with "Given by the requester in the self-service portal", and nobody can change it afterward. For everyone else, ask the requester how satisfied they were and record the answer yourself.

- When closing, the **Close ticket** box asks **How satisfied was the requester? (optional)**. Choose from **1** (Very poor) to **5** (Very good) and add a **Comment** if you wish.
- If you closed without a score, the closed ticket shows a **Requester satisfaction** card. Choose a score there and select **Save**.

Once a score is saved, the card shows it, for example "4 out of 5". Canceled tickets are not asked.

### Comments and files

On the **Activity** tab, type in the box and select **Add note** (an internal note, seen by staff only) or switch to **Public comment** first. **Ctrl** and **Enter** also posts. Files such as photos of a fault or a vendor's report go on the **Attachments** tab: select **Choose files**, or drop them on the panel.

A requester following the ticket in the portal sees your **public comments** (and is told about each one) but never your internal notes. Of the ticket's files they see the ones they added themselves, and the ones you share with them: the **Files the requester sees** card beside the ticket lists every file with a switch; turn it on to show that file in the portal (the requester is told). The card appears when the ticket has a requester or affected person with an account.

When a ticket arrived by email (see [Email to ticket](#email-to-ticket)), your public comments are also emailed to the requester, with the ticket reference in the subject, so they can answer by replying.

## Service-level targets

Each ticket has two targets, shown as clocks in the strip under the header: **Respond** and **Resolve**. They are set by the ticket's priority. As installed:

| Priority | Respond within | Resolve within | Hours counted |
|---|---|---|---|
| P1 Critical | 15 minutes | 4 hours | 24 hours, 7 days |
| P2 High | 1 hour | 1 working day | Business hours |
| P3 Normal | 4 hours | 3 working days | Business hours |
| P4 Low | 1 working day | 5 working days | Business hours |

Business hours are Monday to Friday, 08:00 to 17:00, so a working day is 9 hours. Outside those hours, and on holidays your administrator has entered, the clock does not run for P2 to P4. Your administrator may have changed the targets, hours and holidays (see [Service desk settings](#service-desk-settings)). The line under the clocks names the calendar being used.

### What stops each clock

- **Respond** is met the first time the ticket is assigned to someone or moved out of **New**, whichever comes first.
- **Resolve** is met when the ticket moves to **Resolved**, **Closed** or **Canceled**.

### What pauses the clock

The clock pauses while the status is **Waiting on requester** or **Waiting on vendor**. The strip then says "Clock paused since" and each clock shows how much working time will be left when work resumes. When you move the ticket back to an open status, the time spent paused (working time only) is added to the deadline.

Marking a ticket as with a vendor does not pause the clock by itself. Only the two waiting statuses do.

If you change the priority, the deadlines are worked out again from the time the ticket was opened.

### Breaches

A target that passes without being met is a breach. The clock shows **Missed by** and the ticket appears in the **Breaching** queue (for a missed resolution target). The clocks count down on the page as you watch; the breach flags that the queues and filters use are set by a check that runs every minute in the background (never by opening a list), so a ticket joins the **Breaching** queue within a minute of its target passing. The dashboard figures count a target that has just passed straight away. A paused ticket is not marked as breached while it waits.

To explain a breach:

1. In the strip under the header, select **Record breach reason**.
2. Type a sentence in **Breach reason**.
3. Select **Save**.

### Warnings and notices

You are told in your notifications (the bell at the top of the page) about your tickets:

- **Close to a target**: once for each clock, when a set share of the time has been used (as installed, 75%). The ticket also appears in the **At risk** queue.
- **Target missed**: at the moment a respond or resolve target passes.

A ticket with nobody assigned tells the members of its assignment group instead; with no group, or a group with no members recorded, everyone who works tickets is told. Paused tickets are left alone. You can switch the **Service-level targets** kind of notification off under **Notifications** in your user menu.

### Escalation

Your administrator can set escalation rules, for example "tell the service desk lead when a ticket has been unassigned for four working hours". When a rule fires, the ticket shows an **Escalated** badge and the strip says when; the **History** tab says to whom and by which rule. Each rule fires once for each ticket.

## Requests that need approval

Some catalog items need approval before work starts (as installed, **Vendor access**). A ticket raised from one shows **Waiting for approval** in the strip and sits in the **Awaiting approval** queue. Meanwhile it can be assigned, paused or canceled, but not started or resolved.

Approval runs on the item's approval workflow (see [Approval workflows](22-approval-workflows.md)), of the kind **Catalog request approval**. As installed, anyone allowed to approve service requests (the `tickets.approve` permission) may approve, and one approval is enough. The approvers are told, the request appears on their **Approvals** page (and, for staff, under **My approvals** in the portal), and the approval panel under the ticket's header shows each step, who decides it, the due time and every decision. Approvers decide there with **Approve** or **Reject**; rejecting needs a reason. An approver's stand-in can decide while they are away; the decision is recorded as made on their behalf. The strip says who the request is still waiting for, and the decision, who made it and when, once it is made. Each decision is kept in the ticket's history.

What the workflow can ask for (an administrator sets it up under **Administration > Approval workflows**; an item chooses its workflow, see [Manage catalog items](#manage-catalog-items)):

- **More than one approval**, from anyone who may approve requests or from named people: the strip shows the progress ("1 of 2 approvals so far"). The request is approved when enough people have approved.
- **Several steps**, for example the team lead and then the system owner, each with a due time; an overdue step is escalated.
- **Approval for some answers only** is set on the item itself: for example, approval only when the answer to "Restricted system?" is **Yes**. Requests with other answers start work at once.

One rejection ends the approval: the request is **Rejected** and work stays blocked. Cancel the ticket, or, if the reason has been dealt with, select **Ask for approval again** in the strip (needs permission to edit tickets): a new approval starts and the request waits again. The same button appears when an approval was canceled, or could not start because no approval workflow was active (the strip says so).

The approvers of a step are worked out when the step starts: someone given the permission to approve later is not asked about requests already waiting (an administrator can hand a waiting step to them). Nobody can approve a request they raised themselves, or one raised for them. Canceling or closing a ticket that waits for approval stops its approval. Each decision is audited.

Requests decided before catalog approvals moved onto the approval workflows keep their decisions, shown in the strip under "Decided before approvals moved to approval workflows". A request that was still waiting carried on as a workflow with the same approvers, number of approvals and the approvals already given.

## Vendor-held tickets

Vendors have no access to the application. When a ticket depends on a vendor, staff record what the vendor does.

To hand a ticket to a vendor:

1. On the ticket, select **More actions**, then **Mark as with vendor**.
2. Choose the **Vendor** and enter the **Vendor reference** (the vendor's own case number).
3. Leave **Raised with vendor** empty to use the time now, or enter when you raised it.
4. Leave **Set status to waiting on vendor (pauses the clock)** checked if the ticket cannot move until the vendor acts.
5. Select **Save**.

The ticket shows a **With vendor** badge and a **Vendor** card with the reference, when it was raised, and how long you have been waiting.

- When the vendor replies, select **More actions**, then **Record vendor response now**. To enter a different time, use **More actions**, then **Update vendor details**.
- When the vendor has finished, select **More actions**, then **Back from vendor**. A ticket that was **Waiting on vendor** moves to **In progress** and the clock starts again.

The **Vendor** card then shows the **Vendor response time**, and the dashboard reports the average. See [Vendors and contracts](04-vendors-and-contracts.md) for the vendor register.

## Major incidents

A major incident is a ticket that needs coordination: several people affected, several tickets, regular updates.

To declare one, open the ticket and select **More actions**, then **Declare a major incident**. The ticket shows a **Major incident** badge and gains a **Major incident** tab with three parts.

### Child tickets

Other tickets about the same incident can be attached to the major incident.

- To attach an existing ticket, find it in **Link an existing ticket** and select **Link**.
- To log a new one already attached, select **New child ticket**.

Each child ticket shows the line "Part of major incident" with a link back.

### Timeline and communications log

The timeline lists the key moments (logged, first response, raised with vendor, resolved, closed) together with the entries you add.

1. Type in **Add to the log**.
2. Select **Add note** for a decision or finding, or **Add communication** for what was told to staff and when.

Entries also appear on the ticket's **Activity** tab.

### Post-incident review

Fill in **What happened**, **Root cause**, **What went well**, **What to improve** and **Follow-up actions**, set **Review completed on**, and select **Save review**. You can start the notes while the incident is open and finish them afterward.

To remove the flag, select **More actions**, then **Remove major incident flag**.

A major incident here is a service disruption. A suspected breach of security is recorded separately; see [Security incidents](07-security-incidents.md).

## Problems and known errors

A problem is the underlying cause of one or more incidents. Open **Problems** in the **Service desk** group.

To record a problem:

1. Select **New problem**.
2. Enter a **Title** and **Description**, and choose an **Owner**.
3. Fill in **Root cause** and **Workaround** when they are known.
4. Select **Create problem**.

The problem page shows **What is known** (the description, workaround and cause) and a **Details** card with the title, status, owner and known-error flag. Problem statuses are **Open**, **Investigating**, **Known error**, **Resolved** and **Closed**. Change the status by editing the **Details** card.

To link a ticket to a problem, open the ticket, select **Edit** on the **Details** card and set its **Problem** field. The problem's **Linked tickets** tab lists every ticket that points to it.

### Follow-up actions

The **Actions** tab on a problem lists the work agreed to remove the cause, for example "replace the router firmware at every depot". Type an action, choose a **Due date** and select **Add**, or select **Add action** for the full form with an owner. Actions also appear in the action tracker and under **My actions** for their owner. The tab is shown when the action tracker is part of your installation.

### Publish a known error

When you know the cause or a workaround, you can turn the problem into a knowledge article.

1. Open the problem and select **Publish as known error**.
2. A draft article is created from the problem's description, root cause and workaround, and opens. Its title starts with "Known error:" and it is for IT agents only.
3. Review the draft, then edit it and set its **Status** to **Published** (see below).

The problem is marked **Known error** and shows the link **Open the known-error article**. Each problem can have one article. You need permission to edit tickets and to create knowledge articles.

## Knowledge base

Open **Knowledge base** in the **Service desk** group. The list shows each article's category, audience, status, owner, review date and how many people found it helpful. A review date that has passed is shown in red with "(review due)".

### Write an article

1. Select **New knowledge article**.
2. Enter a **Title** and choose a **Category**: **How to**, **Troubleshooting**, **Known error**, **Policy and procedure** or **Reference**.
3. Choose the **Audience**: **All staff** or **IT agents only**.
4. Leave **Status** as **Draft** until the article is ready.
5. Choose an **Owner** and a **Review on** date.
6. Write the text in **Article**. It is shown as plain text.
7. Select **Create knowledge article**.

To change an article, open it and select **Edit article**. Set **Status** to **Published** when it is ready, or **Retired** when it no longer applies. A draft or retired article carries a notice saying it is not shown to staff. Only published articles are suggested while tickets are logged.

### Who can read an article

An article for **IT agents only** is hidden from everyone who does not work tickets (people without permission to edit tickets): it is left out of their knowledge base list, search, record pickers and related records, reports, dashboards, exports, fact sheets and AI assistants, its files cannot be downloaded, and opening it directly says it was not found. Only an agent can mark an article **IT agents only**. Articles for **All staff** can be read by anyone who can open the knowledge base.

### Versions

Every time the article text changes, the previous text is kept. The **Versions** tab lists each version with the date and the person who saved it. Select **Show text** to read an older version. Changing only the title, category or other fields does not make a new version.

### Feedback

A published article ends with **Was this helpful?** Select **Yes** or **No**. Each person has one answer per version of the article; answering again replaces your earlier answer. The totals appear under the article and in the **Helpful** column of the list. Use low scores and overdue review dates to decide what to rewrite.

## Catalog

The catalog holds standard requests. Choosing one starts a new ticket with the details already filled in, asks the questions that request needs, and adds the tasks to fulfill it. Open **Service catalog** in the **Service desk** group.

As installed it contains **New starter**, **Leaver**, **Access request**, **Hardware**, **Software**, **Vendor access** and **Equipment fault**, grouped by category. Tiles show when an item **Needs approval** and how many questions and tasks it has. Type in **Find a request** to narrow the tiles.

To use an item:

1. Select **Create request** (or **Create incident**) on its tile, or pick it under **Start from the catalog** in the **New ticket** form.
2. The form opens with the item's values filled in and its questions under **request details**. Answer the questions (those marked are required) and add the requester's details.
3. Select **Log ticket**.

The answers are kept on the ticket under **Request details**. The item's tasks appear as a **Fulfillment tasks** checklist: check each one as it is done; the ticket records who checked it and when.

### Manage catalog items

If your role allows editing tickets, a **Manage items** tab is shown.

- To add an item, select **New catalog item** and enter a **Name**, **Description** and **Category**. Check **Needs approval before work starts** if someone must approve each request.
- To hide an item without losing it, edit it and clear **Active**.
- To offer an item to staff in the self-service portal, check **Show in the self-service portal** (or use the switches on the **Self-service portal** tab of the service desk settings). The **Portal** column shows **Shown** for those items, and their tiles say **In the portal**. While the portal is switched off (Administration > Features) the field, the column and the tab are not shown; each item keeps its choice for when the portal is switched on.

Open an item to design its form on the **Form and tasks** tab:

- **What it fills in on the ticket**: the **Type**, **Category**, **Title starts with**, **Description template**, **Impact**, **Urgency**, **Assignment group** and **How it arrived** given to each new ticket.
- **Questions**: select **Add question**, write the question, choose the **Answer** (**Short text**, **Long text**, **One of a list**, **Date** or **Yes or no**), list the **Choices** for a list (one on each line), add **Help text** if useful, and check **An answer is required** where needed. The arrows change the order.
- **Fulfillment tasks**: select **Add task** for each step.

- **Approval**: check **Needs approval before work starts**, then choose the **Approval workflow** (who approves, how many approvals, due times and escalation; **The standard catalog request approval** unless you choose another), and, if approval depends on an answer, choose the question under **Only when a question is answered** and check the **Answers that need approval**. Administrators make more catalog request approval workflows under **Administration > Approval workflows**, for example two approvals from named people for a restricted system. Items that had their own number of approvals and approvers before approvals moved to workflows were each given a workflow with exactly those settings.

Select **Save form, tasks and approval**. Changes apply to tickets logged afterward. The **Tickets created** tab lists every ticket started from the item.

## Service desk dashboard

Open **Service desk dashboard** in the **Service desk** group, or **Dashboard** on the ticket list. Select any tile, bar or point to open the ticket list filtered to the tickets behind it. Select **Refresh** to update the figures.

**Right now** shows the desk as it stands, whatever the period: **Open**, **Unassigned**, **At risk**, **Breaching**, **With a vendor** and **To approve**.

**In the period** covers tickets opened in the chosen period. Choose **Last 7 days**, **Last 30 days** or **Last 90 days**, or **Custom** and set **From** and **To**.

| Tile | What it shows |
|---|---|
| **Opened** | Tickets opened in the period, and how many of them are resolved |
| **Targets met** | Share of measured targets that were met, with the respond and resolve shares |
| **Missed a target** | Tickets that missed the respond or the resolve target |
| **Average first response** | Average time from opening to first response |
| **Average time to resolve** | Average time from opening to resolution |
| **Satisfaction (1 to 5)** | Average of the recorded scores |
| **Average vendor response** | Average time from raising with a vendor to their response |

The two average times are elapsed clock time, not working time.

Below the tiles are charts: **Opened and resolved by day**, **Service-level targets** (met and missed), **Open tickets by age**, **By category**, **By requester department** and **By priority**, with a **Figures** table of the same numbers.

## Service desk settings

Open **Service desk settings** in the **Administration** group. Anyone who can see tickets can read the settings; changing them needs permission to administer the service desk (`tickets.administer`). Every change is recorded in the audit log.

### Priorities

The table of impact against urgency, with a priority in each cell. Choose a priority in any cell, and a **Default priority** for combinations left empty and for impact or urgency values added later, then select **Save matrix**. New tickets, and tickets whose impact or urgency change, use the new table.

### Targets

For each priority, set **Respond within** and **Resolve within** in hours and minutes of working time, and the calendar the hours are **counted on**. Select **Save targets**. Changes apply to due times worked out from now on: new tickets, and tickets whose priority changes. Tickets already logged keep the due times they have.

### Calendars and holidays

Choose a **Calendar** to edit it:

- **Name** and **Time zone** (an IANA time zone name, in the form Region/City; opening hours are read in this zone).
- **Open 24 hours, 7 days**: every minute counts and holidays are ignored.
- Otherwise switch each weekday on or off and set its opening and closing times.

Select **Save calendar**. Under **Holidays**, choose a **Date**, optionally a **Name**, and select **Add holiday**; the trash button removes one. On a holiday the clock does not run for targets counted on that calendar.

To add a calendar, for example an out-of-hours rota, select **New calendar**, give it a **Name** and select **Add calendar**; it starts as Monday to Friday, 08:00 to 17:00 for you to change. **Retire calendar** removes one that no target uses; a calendar still used by a target says which, and cannot be retired until those targets use another.

### Escalation

Select **New rule** and give it a **Name**, what it waits for (**When an open ticket**: **Nobody is assigned**, **No first response** or **Not updated**), **For this much working time**, and who to **Escalate to**: an assignment group or a person. Select **Add rule**. The wait is counted on the calendar of the ticket's priority, and paused tickets are left alone. The switch in the **On** column turns a rule off without removing it; **Fired** counts how many tickets it has escalated.

### Notifications

**Warn when this share of the time is used (%)** sets when the "close to a target" warning is sent (0 switches warnings off). Under **Assignment group members**, add the people in each group; they are told about unassigned tickets and group escalations. A group with no members means everyone who works tickets. Select **Save notification settings**.

### Self-service portal

Switch the portal on and off, set its title, welcome line, service status banner and reopen window, who may raise a request for a colleague, whether staff can report a safety event, and choose which catalog items staff can ask for. See [Self-service portal](18-self-service-portal.md#settings-for-the-service-desk).

### Email to ticket

Off until an administrator sets it up on the **Email to ticket** tab. It needs the `admin.administer` permission because it signs in to a mailbox, and saving asks you to confirm it is you.

1. Under **Where mail comes from**, choose the **Source**:
   - **Read a mailbox (POP3)**: enter the **Mail server**, **Port**, **Security** (**TLS from the start**, usually port 995, or **STARTTLS**; **None** sends the password in clear text and is only for a mail server on the same machine), **User name** and **Password** (kept encrypted, never shown again), and how often to read it. Messages are removed from the mailbox once read, unless you switch on **Leave messages in the mailbox after reading them** (each is then read once). **Test the saved connection** signs in and counts the messages without reading any; **Read the mailbox now** reads it at once.
   - **Read a Microsoft 365 mailbox (Microsoft Graph)** or **Read a Google Workspace mailbox (Gmail API)**: for a mail service that has switched off POP3 sign-in. These use the Microsoft Graph or Gmail API sign-in saved under **Administration > Email** (save it there first; outgoing email can still go over SMTP). Enter the **Mailbox address** and how often to read it. Unread messages in the inbox are read; once handled, each is moved to **Deleted Items** (Microsoft 365) or **Trash** (Gmail), where it can still be recovered, or, with **Leave messages in the mailbox after reading them** on, marked read and left where it is. The Microsoft app registration needs the **Mail.ReadWrite** application permission; the Google service account's domain-wide delegation needs the `https://www.googleapis.com/auth/gmail.modify` scope. **Test the saved connection** signs in and counts the unread messages.
   - **A mail relay hands each message over**: your mail server posts every message for the service desk address to the address shown, with a relay key. Select **Create a relay key** and copy the key straight away: it is shown once. See [Installation](../installation.md#email-to-ticket).
2. Under **New tickets and replies**, enter the **Service desk address** (replies to messages about these tickets go to it), the **Type of new tickets** and **Assignment group**, what to do with **Messages from people who are not users** (create a ticket with them as an outside requester, or ignore the message), an optional list of domains outside senders must come from, and **Most messages from one sender in an hour**. Choose whether to **Acknowledge each new ticket by email** and **Email public comments to the requester**. Select **Save**.
3. Switch **Email to ticket switched on**.

What happens to a message:

- A **new message** becomes a ticket with the subject as its title, the text as its description, **Email** as how it arrived, and the sender as the requester: the user with that address, or an outside requester (name and address). Its files are attached after the same checks as any upload (allowed types, content, malware scanner, size). The assignment group, or everyone who works tickets, is told.
- A **reply** that keeps the ticket reference in its subject (for example "Re: [TKT-00042] Printer offline") is added to that ticket as a **public comment**, marked "(by email)", without the quoted earlier message, when it comes from the requester or the affected person. Email addresses are not checked, so a reply from an agent's address is ignored and logged ("Email replies never act as an agent"): agents answer in the application. A reply to a ticket **Waiting on requester** hands it back to the desk.
- **Ignored**: automatic replies (out of office), delivery reports, mailing lists, messages from the service desk's own address or sent by this application, a message received before, and a sender who writes more often than the limit (a mail loop).

A message is recorded before it is read, so a message that could not be dealt with (for example because the server stopped while reading it) is never read again: it is listed as failed, "Reading this message did not finish". Only the first 1,000,000 characters of a message's HTML are turned into text.

**Messages received** lists every message with what became of it and why, and links to the ticket. Entries are kept for 180 days to begin with (**Incoming email log** under **Administration > Settings > Retention**). With outgoing email off (Administration, Email), nothing is emailed back, but tickets are still created.

## Not available yet

- Formatting in articles.
