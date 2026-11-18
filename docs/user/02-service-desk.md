# Service desk

The service desk is where the IT team logs and works on incidents and service requests, tracks the problems behind repeated incidents, keeps a knowledge base, and offers a catalogue of standard requests. This page covers each of those and the service desk dashboard. Lists and record pages work as described in [Getting started](01-getting-started.md).

## Tickets

A ticket is either an **Incident** (something is broken) or a **Service request** (someone needs something). There is no self-service portal yet, so IT staff log every ticket on behalf of the colleague who asked.

### The ticket list

Open **Tickets** in the **Service desk** group. Above the list is a row of quick views:

| Quick view | Shows |
|---|---|
| **All** | Every ticket |
| **My open** | Unresolved tickets assigned to you |
| **Unassigned** | Unresolved tickets with no assignee |
| **Breaching** | Unresolved tickets that have missed their resolution target |
| **With vendor** | Unresolved tickets held by a vendor |
| **Major incidents** | Tickets flagged as a major incident |

The first time you open the list, **My open**, **Unassigned**, **Breaching** and **With vendor** are also added to your saved views.

The **Resolve by** column shows the resolution deadline, in red once it has passed, or **Paused** while the clock is stopped. The **Targets** column shows one of **On track**, **Paused**, **Met** or **Target missed**.

### Log a ticket on someone's behalf

1. Select **New ticket** on the ticket list, or **Create** then **Ticket**.
2. Choose the **Type** and, if you can, a **Category**.
3. Enter a **Title**: a short description of what is wrong or what is needed. Add detail in **Description**.
4. In **Requester**, enter the name of the colleague you are logging this for. Add **Requester department** and **Requester email** if you have them. Use **Affected person** only if it is someone other than the requester.
5. Choose **Impact** and **Urgency**. The line **Priority from impact and urgency** shows the priority the ticket will get.
6. Optionally choose an **Assignment group**, an **Assignee**, the **Affected system** and the **Affected asset**.
7. In **How it arrived**, choose how the request reached you, for example **Phone** or **In person**.
8. Select **Log ticket**.

The ticket gets a reference such as `TKT-00042` and opens.

### Impact, urgency and priority

Priority is worked out from impact and urgency. As installed, the table is:

| Impact | High - work has stopped | Medium - work is slowed | Low - can wait |
|---|---|---|---|
| Whole organisation or safety | P1 Critical | P2 High | P3 Normal |
| A department or site | P2 High | P3 Normal | P4 Low |
| One person | P3 Normal | P4 Low | P4 Low |

Your administrator may have changed these values.

To choose a priority yourself when logging a ticket, tick **Set the priority by hand** and pick a **Priority**. On an existing ticket, select **Edit** on the **Details** card and change **Priority**.

A priority set by hand stays as it is when impact or urgency change later. To go back to the worked-out value, set **Priority** to the value in the table above.

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
| **Cancelled** | Not needed after all | Stopped |

To change the status, select **Change status** on the ticket and choose the new one. The strip under the header shows where the ticket is: **Logged**, **Assigned**, **In progress**, **Resolved**, **Closed**.

To reopen a resolved or closed ticket, change its status back to **In progress** or another open status.

### Assign a ticket

- To take a ticket yourself, select **Assign to me**. If the ticket is **New**, it also moves to **Assigned**.
- To give it to someone else, select **Edit** on the **Details** card, choose the **Assignee** and, if you use them, the **Assignment group**, then select **Save changes**.

### Resolve and close a ticket

To resolve:

1. Select **Resolve**.
2. Choose a **Resolution code**, for example **Fixed**, **Workaround provided** or **Request fulfilled**. A code is required.
3. Enter **Resolution notes**: what fixed it, or what was provided. This helps the next person with the same problem.
4. Select **Resolve**.

A **Resolution** card then appears on the ticket, where the code and notes can be corrected.

To close:

1. Select **Change status**, then **Closed**.
2. If the ticket has no **Resolution code** yet, choose one. Closing a ticket needs a resolution code, as resolving does; cancelling does not.
3. Record the requester's satisfaction if you have it (see below).
4. Select **Close ticket**.

To cancel a ticket, select **Change status**, then **Cancelled**. It is cancelled at once, with no further questions.

### Satisfaction

Because there is no portal, ask the requester how satisfied they were and record the answer yourself.

- When closing, the **Close ticket** box asks **How satisfied was the requester? (optional)**. Choose from **1** (Very poor) to **5** (Very good) and add a **Comment** if you wish.
- If you closed without a score, the closed ticket shows a **Requester satisfaction** card. Choose a score there and select **Save**.

Once a score is saved, the card shows it, for example "4 out of 5". Cancelled tickets are not asked.

## Service-level targets

Each ticket has two targets, shown as clocks on the **Service-level targets** card: **Respond** and **Resolve**. They are set by the ticket's priority. As installed:

| Priority | Respond within | Resolve within | Hours counted |
|---|---|---|---|
| P1 Critical | 15 minutes | 4 hours | 24 hours, 7 days |
| P2 High | 1 hour | 1 working day | Business hours |
| P3 Normal | 4 hours | 3 working days | Business hours |
| P4 Low | 1 working day | 5 working days | Business hours |

Business hours are Monday to Friday, 08:00 to 17:00, so a working day is 9 hours. Outside those hours, and on holidays your administrator has entered, the clock does not run for P2 to P4. Your administrator may have changed the targets and hours. The card names the calendar being used.

### What stops each clock

- **Respond** is met the first time the ticket is assigned to someone or moved out of **New**, whichever comes first.
- **Resolve** is met when the ticket moves to **Resolved**, **Closed** or **Cancelled**.

### What pauses the clock

The clock pauses while the status is **Waiting on requester** or **Waiting on vendor**. The card then says "Clock paused since" and shows how much working time will be left when work resumes. When you move the ticket back to an open status, the time spent paused (working time only) is added to the deadline.

Marking a ticket as with a vendor does not pause the clock by itself. Only the two waiting statuses do.

If you change the priority, the deadlines are worked out again from the time the ticket was opened.

### Breaches

A target that passes without being met is a breach. The clock shows **Target missed** and the ticket appears in the **Breaching** quick view (for a missed resolution target). The application checks every minute, so a breach shows without reloading the page. A paused ticket is not marked as breached while it waits.

To explain a breach:

1. On the **Service-level targets** card, select **Record breach reason**.
2. Type a sentence in **Breach reason**.
3. Select **Save**.

Nobody is notified when a target is about to be missed or has been missed. Use the **Breaching** quick view and the dashboard to keep watch.

## Vendor-held tickets

Vendors have no access to the application. When a ticket depends on a vendor, staff record what the vendor does.

To hand a ticket to a vendor:

1. On the ticket, select **More**, then **Mark as with vendor**.
2. Choose the **Vendor** and enter the **Vendor reference** (the vendor's own case number).
3. Leave **Raised with vendor** empty to use the time now, or enter when you raised it.
4. Leave **Set status to waiting on vendor (pauses the clock)** ticked if the ticket cannot move until the vendor acts.
5. Select **Save**.

The ticket shows a **With vendor** badge and a **Vendor** card with the reference, when it was raised, and how long you have been waiting.

- When the vendor replies, select **More**, then **Record vendor response now**. To enter a different time, use **More**, then **Update vendor details**.
- When the vendor has finished, select **More**, then **Back from vendor**. A ticket that was **Waiting on vendor** moves to **In progress** and the clock starts again.

The **Vendor** card then shows the **Vendor response time**, and the dashboard reports the average. See [Vendors and contracts](04-vendors-and-contracts.md) for the vendor register.

## Major incidents

A major incident is a ticket that needs coordination: several people affected, several tickets, regular updates.

To declare one, open the ticket and select **More**, then **Declare a major incident**. The ticket shows a **Major incident** badge and gains a **Major incident** tab with three parts.

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

To remove the flag, select **More**, then **Remove major incident flag**.

A major incident here is a service disruption. A suspected breach of security is recorded separately; see [Security incidents](07-security-incidents.md).

## Problems and known errors

A problem is the underlying cause of one or more incidents. Open **Problems** in the **Service desk** group.

To record a problem:

1. Select **New problem**.
2. Enter a **Title** and **Description**, and choose an **Owner**.
3. Fill in **Root cause** and **Workaround** when they are known.
4. Select **Create problem**.

Problem statuses are **Open**, **Investigating**, **Known error**, **Resolved** and **Closed**. Change the status by editing the **Details** card.

To link a ticket to a problem, open the ticket, select **Edit** on the **Details** card and set its **Problem** field. The problem's **Linked tickets** tab lists every ticket that points to it.

### Publish a known error

When you know the cause or a workaround, you can turn the problem into a knowledge article.

1. Open the problem and select **Publish as known error**.
2. A draft article is created from the problem's description, root cause and workaround, and opens. Its title starts with "Known error:".
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

To change an article, open it and select **Edit article**. Set **Status** to **Published** when it is ready, or **Retired** when it no longer applies. A draft or retired article carries a notice saying it is not shown to staff.

### Versions

Every time the article text changes, the previous text is kept. The **Versions** tab lists each version with the date and the person who saved it. Select **Show text** to read an older version. Changing only the title, category or other fields does not make a new version.

### Feedback

A published article ends with **Was this helpful?** Select **Yes** or **No**. Each person has one answer per version of the article; answering again replaces your earlier answer. The totals appear under the article and in the **Helpful** column of the list. Use low scores and overdue review dates to decide what to rewrite.

## Catalogue

The catalogue holds standard requests. Choosing one opens a new ticket with the details already filled in. Open **Service catalogue** in the **Service desk** group.

As installed it contains **New starter**, **Leaver**, **Access request**, **Hardware**, **Software**, **Vendor access** and **Equipment fault**, grouped by category.

To use an item:

1. Select **Create request** (or **Create incident**) on its tile.
2. The **New ticket** form opens with type, category, impact, urgency and a description template filled in. Complete the template and the requester's details.
3. Select **Log ticket**.

If your role allows editing tickets, a **Manage items** tab is shown.

- To add an item, select **New catalogue item** and enter a **Name**, **Description** and **Category**.
- **Values for the request it creates** holds the values to pre-fill, written as JSON, for example `{"type": "request", "category": "access", "title": "Access request: "}`.
- To hide an item without losing it, edit it and untick **Active**.

An item's own page has a **Tickets created** tab listing every ticket started from it.

## Service desk dashboard

Open **Service desk dashboard** in the **Service desk** group, or **Dashboard** on the ticket list.

Choose the period with **Last 7 days**, **Last 30 days** or **Last 90 days**, or set **From** and **To**. The figures cover tickets opened in that period. Select **Refresh** to update them.

| Tile | What it shows |
|---|---|
| **Opened in period** | Tickets opened in the period |
| **Open now** | Every unresolved ticket, whatever the period |
| **Targets met** | Share of tickets in the period with no missed target |
| **Tickets with a missed target** | Tickets that missed the respond or the resolve target |
| **Average first response** | Average time from opening to first response |
| **Average time to resolve** | Average time from opening to resolution |
| **Satisfaction (1 to 5)** | Average of the recorded scores |
| **With a vendor now** | Unresolved tickets held by a vendor, whatever the period |
| **Average vendor response** | Average time from raising with a vendor to their response |

The two average times are elapsed clock time, not working time.

Below the tiles are charts: **Tickets opened and resolved by day**, **Service-level targets** (met and missed), **Open tickets by age**, **By category**, **By requester department** and **By priority**, with a **Figures** table of the same numbers. Select a tile, bar or point to open the ticket list filtered to the tickets behind it.

## Not available yet

- A self-service portal, and creating tickets from email. All tickets are logged by IT staff.
- Warnings before a target is missed, breach notifications and escalation rules.
- Screens for changing the priority table, the targets, business hours and holidays. An administrator changes these another way; see [Administration](09-administration.md).
- Restricting **IT agents only** articles. The audience is a label; anyone who can open the knowledge base can read every article.
- Formatting in articles, and attachments on tickets or articles.
- Approval or fulfilment steps for catalogue items. An item only pre-fills a ticket.
