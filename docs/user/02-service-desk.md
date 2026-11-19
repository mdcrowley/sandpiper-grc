# Service desk

The service desk is where the IT team logs and works on incidents and service requests, tracks the problems behind repeated incidents, keeps a knowledge base, and offers a catalog of standard requests. This page covers each of those, the service desk dashboard and the service desk settings. Lists and record pages work as described in [Getting started](01-getting-started.md).

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

Each queue is an ordinary address, so you can bookmark it or send it to a colleague. The first time you open the list, the queues are also added to your saved views (the **All tickets** menu beside the search box), where you can change them or save your own.

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
9. Select **Log ticket**, or press **Ctrl** and **Enter**.

The ticket gets a reference such as `TKT-00042` and opens. To log several tickets in a row, select **Log and add another**: the form empties and stays open.

As installed a new ticket starts as an **Incident** with impact **One person** and urgency **Medium**, logged by an agent.

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

A requester who uses the [self-service portal](18-self-service-portal.md) answers for themselves once the ticket is resolved. Their answer shows on the **Requester satisfaction** card with "Given by the requester in the self-service portal", and nobody can change it afterwards. For everyone else, ask the requester how satisfied they were and record the answer yourself.

- When closing, the **Close ticket** box asks **How satisfied was the requester? (optional)**. Choose from **1** (Very poor) to **5** (Very good) and add a **Comment** if you wish.
- If you closed without a score, the closed ticket shows a **Requester satisfaction** card. Choose a score there and select **Save**.

Once a score is saved, the card shows it, for example "4 out of 5". Canceled tickets are not asked.

### Comments and files

On the **Activity** tab, type in the box and select **Add note** (an internal note, seen by staff only) or switch to **Public comment** first. **Ctrl** and **Enter** also posts. Files such as photos of a fault or a vendor's report go on the **Attachments** tab: select **Choose files**, or drop them on the panel.

A requester following the ticket in the portal sees your **public comments** (and is told about each one) but never your internal notes, and sees only the files they added themselves.

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

A target that passes without being met is a breach. The clock shows **Missed by** and the ticket appears in the **Breaching** queue (for a missed resolution target). The application checks every minute, so a breach shows without reloading the page. A paused ticket is not marked as breached while it waits.

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

People allowed to approve (the `tickets.approve` permission) are told, and see **Approve** and **Reject** on the ticket. Rejecting needs a **Reason**. The decision, who made it and when are shown on the ticket and kept in its history. A rejected request can be canceled, or approved later with **Approve after all**.

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

Fill in **What happened**, **Root cause**, **What went well**, **What to improve** and **Follow-up actions**, set **Review completed on**, and select **Save review**. You can start the notes while the incident is open and finish them afterwards.

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

An article for **IT agents only** is hidden from everyone who does not work tickets (people without permission to edit tickets): it is left out of their knowledge base list, search, record pickers and related records, and opening it directly says it was not found. Only an agent can mark an article **IT agents only**. Articles for **All staff** can be read by anyone who can open the knowledge base.

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
- To offer an item to staff in the self-service portal, check **Show in the self-service portal** (or use the switches on the **Self-service portal** tab of the service desk settings). The **Portal** column shows **Shown** for those items, and their tiles say **In the portal**.

Open an item to design its form on the **Form and tasks** tab:

- **What it fills in on the ticket**: the **Type**, **Category**, **Title starts with**, **Description template**, **Impact**, **Urgency**, **Assignment group** and **How it arrived** given to each new ticket.
- **Questions**: select **Add question**, write the question, choose the **Answer** (**Short text**, **Long text**, **One of a list**, **Date** or **Yes or no**), list the **Choices** for a list (one on each line), add **Help text** if useful, and check **An answer is required** where needed. The arrows change the order.
- **Fulfillment tasks**: select **Add task** for each step.

Select **Save form and tasks**. Changes apply to tickets logged afterwards. The **Tickets created** tab lists every ticket started from the item.

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

- **Name** and **Time zone** (an IANA name such as Europe/London; opening hours are read in this zone).
- **Open 24 hours, 7 days**: every minute counts and holidays are ignored.
- Otherwise switch each weekday on or off and set its opening and closing times.

Select **Save calendar**. Under **Holidays**, choose a **Date**, optionally a **Name**, and select **Add holiday**; the trash button removes one. On a holiday the clock does not run for targets counted on that calendar.

To add a calendar, for example an out-of-hours rota, select **New calendar**, give it a **Name** and select **Add calendar**; it starts as Monday to Friday, 08:00 to 17:00 for you to change. **Retire calendar** removes one that no target uses; a calendar still used by a target says which, and cannot be retired until those targets use another.

### Escalation

Select **New rule** and give it a **Name**, what it waits for (**When an open ticket**: **Nobody is assigned**, **No first response** or **Not updated**), **For this much working time**, and who to **Escalate to**: an assignment group or a person. Select **Add rule**. The wait is counted on the calendar of the ticket's priority, and paused tickets are left alone. The switch in the **On** column turns a rule off without removing it; **Fired** counts how many tickets it has escalated.

### Notifications

**Warn when this share of the time is used (%)** sets when the "close to a target" warning is sent (0 switches warnings off). Under **Assignment group members**, add the people in each group; they are told about unassigned tickets and group escalations. A group with no members means everyone who works tickets. Select **Save notification settings**.

### Self-service portal

Switch the portal on and off, set its title, welcome line, service status banner and reopen window, and choose which catalog items staff can ask for. See [Self-service portal](18-self-service-portal.md#settings-for-the-service-desk).

## Not available yet

- Creating tickets from email.
- Formatting in articles.
- Approval by more than one person, or approval steps that depend on the answers given.
