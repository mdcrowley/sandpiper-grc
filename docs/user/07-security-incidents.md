# Security incidents

A security incident is a suspected or confirmed attack on, loss of, or unauthorized access to your organization's systems, accounts or data. For a transit operator that includes an outage of dispatch or vehicle tracking caused by an attack, a compromised fare system, or an intrusion into the network on board vehicles. This page explains how to declare an incident, how the notification clocks work, and how to use the incident workspace: the log, checklists, roles, evidence, what is affected, the ransom-payment control and the post-incident review. It also covers the notification rules an administrator must set up, the page of notification deadlines across incidents, the printable incident report, and the printable kit for when the system itself is unavailable.

An administrator can switch security incidents off under **Administration > Features** (see [Administration](09-administration.md#features)). Restricted records elsewhere (risks, vulnerabilities) are still protected the same way. Records are kept and return when it is switched back on.

The screens are under **Security > Security incidents**, with the tabs **Incidents**, **Notification deadlines** and **Rules and checklists**; the **Offline incident kit** opens from a button on the incident list (or the search, by its name).

## Who can see security incidents

Security incidents are **restricted records**. Everything described on this page, including the list, each incident, the notification deadlines, the rules, the report and the offline kit, is visible only to people whose roles include **View** on **Security incidents and restricted records**. For everyone else, incidents do not appear in the menu, in search, in counts, in related-record links, in notifications or in exports.

Beyond viewing:

| To do this | You need this permission on Security incidents and restricted records |
|---|---|
| Declare or record an incident | **Create** |
| Work an incident: log entries, checklists, roles, evidence, notifications, status, review | **Edit** |
| Change notification rules, kinds of data, checklist templates, the standing contact list and the incident statuses | **Administer** |

Roles are managed by an administrator; see [Administration](09-administration.md).

## The pilot-mode notice

While pilot mode is on, the incident pages carry this notice:

"Pilot mode: do not record live incident details here yet. Use exercise or invented data only."

Take it literally. Use the application to rehearse, to run exercises and to prepare your rules, contacts and checklists. During a real incident, work from the printed offline kit and your organization's own incident procedure until your administrator confirms the application is approved for live use. An administrator switches pilot mode off under **Administration**, **Settings**. The notice is never printed.

## The incident list

**Security > Security incidents** opens with four figures: **Open incidents**, **Notifications overdue**, **Notifications due soon** and **Reviews to complete** (closed incidents whose post-incident review is not finished). Select one of the notification figures to open the notification deadlines.

Below is the list of incidents, with search, filters, saved views, column choice and export like every other list. Columns such as **Declared**, **Closed**, **Post-incident review** and **Review due** are hidden to begin with; add them from the column menu.

## Declaring an incident

Select **Declare incident** on the list, or **Create > Security incident** from any page. Declaring takes three short steps. Beside the steps, the card **Notifications this will require** shows, as you answer, who must be told and by when. Nothing is saved until you confirm.

A report that reached the service desk first can become an incident from the ticket: **More actions > Raise a security incident** on the ticket (see [Service desk](02-service-desk.md#take-a-ticket-further)). The incident is recorded as **Reported** with the ticket's description, requester and affected system, discovered when the ticket was opened, and linked to the ticket; declare it from the incident page.

### Step 1: What happened

1. Enter a **Title**: a short plain description, such as "Dispatch screens frozen at the control center".
2. Add a **Summary** if you have more detail.
3. Set **Discovered**: the date and time the organization first became aware, in the organization's time zone. It starts as the present moment. Correct it if the incident was noticed earlier. It cannot be in the future. Every notification deadline counts from this time.
4. Choose a **Scenario** if one fits: **Ransomware**, **Account compromise**, **Payment fraud**, **Vendor compromise**, **Lost device**, **Dispatch or CAD/AVL outage**, **Fare system compromise**, **Onboard network compromise** or **Other**. The scenario brings the matching containment and recovery checklists.
5. Choose a **Severity** by selecting one of the four cards. It starts as **Moderate**.
6. If your administrator has added fields of their own to security incidents (**Custom fields**), fill them in below the severity; those marked with an asterisk are required. On the incident's workspace they are shown, and can be edited, in the **More details** card beside the clocks and the team.
7. Select **Continue**.

The severity guide:

| Severity | Use when |
|---|---|
| **Critical** | Service to customers or safety is affected, or regulated data is confirmed exposed. |
| **High** | A core system or regulated data is at real risk; spread is possible. |
| **Moderate** | Limited to a few accounts or devices and contained quickly. |
| **Low** | Attempt or near miss with no confirmed impact. |

### Step 2: What is involved

Answer the **Questions that decide who must be told** with the switches. If unsure, answer yes. An answer can be changed later and the clocks follow. Then select **Continue**.

| Question | Switch it on when |
|---|---|
| **Is this a cybersecurity or ransomware incident?** | There is any attack on, or unauthorized access to, the organization's systems, accounts or data. On to begin with. |
| **Could personal information be involved?** | Details of identifiable people, such as names with identity, license or account numbers, may be affected. |
| **Could financial or payment information be involved?** | Bank, payment or account details of the organization or of other people may be affected. |
| **Could confidential business information be involved?** | Contracts, plans, credentials or anything else the organization keeps confidential may be affected. |
| **Could rider account information be involved?** | Fare accounts, concession eligibility, journey history or contact details of riders may be affected. |
| **Could operational and safety information be involved?** | Vehicle locations, schedules, signaling or dispatch records, or safety reports may be affected. |

The first two questions are built in. After them, one question is asked for each **kind of data** on the list an administrator keeps on the **Kinds of data** tab of **Rules and checklists**, so the last four rows are only the kinds supplied to begin with.

### Step 3: Review and declare

Check the summary of your answers. The note **What happens when you declare** says how many clocks will start. Then choose one of:

- **Confirm and declare incident**: saves the incident as declared and starts the clocks. Everyone who can see security incidents is told in their notifications.
- **Save as reported only**: saves it as reported. No clocks are created. Use this when you are not yet sure it is an incident.

Either way you are taken to the incident workspace, and the incident is given a reference beginning `SEC-`. Select any earlier step in the step bar, or **Back**, to change an answer before confirming.

### The notification preview

The **Notifications this will require** card lists each notification your answers would require, soonest deadline first: who must be told, **Required** or **Recommended**, the deadline from discovery, the date and time it falls due, the time left, and **Guidance**. Under **Also consider (no deadline configured, so no clock)** it lists parties whose rule matches your answers but is switched off: no clock will be created for them, so decide for yourself whether they must be told.

### Declaring an incident that was saved as reported

Open the incident and select **Declare incident** at the top of the page (see [The next stage](#the-next-stage)), or select the next step in the status bar and confirm with **Declare incident**. The clocks start, and their deadlines are still counted from the discovery time, not from the moment you declare.

## The incident workspace

The workspace is laid out so that the things that matter most under pressure are always in view:

- At the top, the title, reference, severity and status, with the next-stage button (such as **Mark contained**), **Edit details**, **Incident report** and a **More** menu (links to **All notifications**, **Offline incident kit** and **Rules and checklists**).
- The **status bar**, with the key times beneath it: **Discovered** (and how long ago), **Declared**, **Contained**, **Closed**, **Incident lead** and **Scenario**, then the summary.
- On a wide screen, the **Notification clocks** and the **Team** down the right-hand side, staying in view as you scroll; on a narrow screen the clocks come first, above the tabs.
- The tabs: **Log**, **Checklists**, **Roles**, **Evidence**, **Affected**, **Ransom**, **Lessons**, **Attachments** and **History**.

### Status

The status bar shows the incident statuses in order. To begin with these are **Reported**, **Declared**, **Contained**, **Recovering** and **Closed**. To change status, select a step and confirm. Each change is time-stamped and added to the log. The application fills in the **Declared**, **Contained** and **Closed** times the first time the incident reaches those stages. Closing the incident also sets the date the post-incident review is due.

An administrator can rename, add and retire statuses on the **Incident statuses** tab of **Rules and checklists**; see below.

### The next stage

The first button at the top of the workspace is always the next step: **Declare incident**, **Mark contained**, **Mark recovering**, then **Close incident** (it follows the statuses in order, with their own names, so an added status gets its own button). Select it to see the checks that step needs, each marked **Done**, **Not yet (you can still go ahead)** or **Needed before this step**, with **Open** taking you to the tab where it is put right:

| Step | Checks |
|---|---|
| Declare | The **Affected** questions are answered, and an incident lead is named. Neither stops you: declare first if you must, then answer the questions at once, since no notification clock can start without them |
| Contained (and recovering) | An incident lead is named, and the containment checklist is done. Neither stops you |
| Close | Needed before closing: the **Affected** questions answered, every required notification recorded as done or not required, and no ransom payment still **Under consideration**. A warning only: checklist steps still open |

Confirm with the button in the dialog. It stays unavailable while a needed check fails, or when the lifecycle rules do not allow the move (hover over it to see why). The status bar still lets you choose any status the lifecycle rules allow, for example to step back; the checks apply to the button.

### Edit details

Select **Edit details** to change the **Title**, **Summary**, **Severity**, **Scenario**, **Incident lead** or any of the times. Changing **Discovered** moves the deadline of every notification that is still pending.

## Notification clocks

There is one clock for each party that must be told. They sit in the **Notification clocks** panel of every declared incident, most urgent first.

### The headline

At the top of the panel one line says what matters most:

- **Next deadline**: the time left on the most urgent open notification, the party and when it is due, and how many notifications are still to make.
- **Notification overdue** (or "2 notifications overdue" and so on) in red when a deadline has passed.
- **Nothing outstanding** when every notification has been recorded or stood down.

### How deadlines are worked out

Each clock comes from a notification rule that is active, has a deadline, and whose trigger matches the incident's answers to the questions. The due time is:

**discovery time + the rule's deadline in hours**

For example, with a 72-hour rule and a discovery time of 09:30 on a Monday, the notification is due at 09:30 on the Thursday. A deadline of 0 hours means immediately. The time you declared the incident does not affect the deadline, so an incident declared late may open with clocks that are already amber or red.

### Colors

Each card shows the party, **Required** or **Recommended**, the time left, a bar showing how much of the time allowed has gone, the due date and time, and **Guidance**.

| What you see | Meaning |
|---|---|
| Green, "… left" | More than a quarter of the time allowed remains. |
| Amber, "… left" | A quarter of the time allowed, or less, remains. |
| Red, "Overdue by …" | The deadline has passed and no notification is recorded. |
| "Notified in time" | The notification was recorded at or before the deadline. |
| "Notified … late" | The notification was recorded after the deadline. |
| "Not required for this incident" | The clock has been stood down. |

A clock turns amber when a quarter of the time allowed, or less, remains.

### Alerts

You do not have to watch the screen. The application checks the clocks every minute and, once for each clock:

- when it turns amber, sends a notification "… left to notify …";
- when it passes its deadline, sends a notification "Overdue: notify …".

Alerts go to the incident lead and to everyone else who can see security incidents, and never to anyone who cannot. Each alert is also written to the incident log. If the discovery time is corrected and a deadline moves, the alerts start afresh.

Named responders can also be told by email and text message, away from the application: see [Alerts by email and text message](#alerts-by-email-and-text-message).

### Recording a notification

When the party has been told:

1. On its clock, select **Record notification**.
2. In **Who was notified**, enter the name and role of the person or desk that took the report.
3. In **How**, enter the method, or select one of **Phone**, **Email**, **Web form**, **Letter** or **In person**.
4. Check **When**. It starts as the present moment; change it to the time the notification was actually made. It cannot be in the future.
5. Enter any **Reference received**, such as a report or case number.
6. Select **Record notification**.

The clock stops and shows who was told, how, when, the reference, and who recorded it and when. The details are added to the log as a Communication entry. A completed notification is kept as a record and cannot be deleted. If you made a mistake, select **Correct record** and save the corrected details.

### Marking a notification "not required"

Use this when, on the facts or on advice, a party does not have to be told.

1. On the clock, select **Not required**.
2. Enter the **Reason**. This is required.
3. Select **Mark not required**.

The reason is written to the log as a Decision. If things change, select **Reopen** on the clock and it starts counting again against the original deadline.

### When the answers change

The answers can be changed on the **Affected** tab. After the incident is declared:

- switching an answer on adds the matching clocks;
- switching it off stands down the matching clocks that are still pending, marking them not required;
- switching it on again reopens the clocks that were stood down that way;
- completed notifications are never removed.

The answers count as given once the incident was declared through **Declare incident** (which asks every question), or once someone has answered a question on the **Affected** tab. A question left as it was is not an answer: an incident recorded another way (a quick record, an import) shows **The answers are complete** on the **Affected** tab until someone answers or confirms them. A declared incident with no clock says why:

- **Answer the Affected questions to check notification duties** (amber): nobody has answered the questions yet, so a clock that should run may be missing.
- **No notification rule is switched on**: every rule is off or has no deadline (see [Notification rules, checklists and contacts](#notification-rules-checklists-and-contacts)).
- **No notifications required**: the questions are answered and no active rule matches them.

## Notification deadlines across incidents

The **Notification deadlines** tab of **Security > Security incidents** shows every notification on every incident in one place.

The **Deadlines** tab shows four figures, **Overdue**, **Due soon**, **On track** and **Recorded**, then a table, most urgent first, with the deadline and time left, the party, and the incident. Choose what to show with **To make**, **Recorded**, **Not required** or **All**. **Record notification**, **Not required** and **Correct record** work exactly as they do on the incident.

The **Register** tab is the full list of notification tasks with filters, saved views and export. Selecting a row opens its incident.

### Alerts by email and text message

The **Alerts by email and text** tab names the **Responders** who are told, by email and by text message, when:

- an incident is declared;
- a notification deadline is close (amber);
- a notification deadline has passed (red).

Each is sent once: once when the incident is declared, and once for each clock state (if several clocks of one incident turn red together, one alert goes). The messages name only the incident's reference and what needs attention, such as "Security incident SEC-0042 needs attention: a notification deadline has passed", and link to the incident; never its title, the party to notify or any other detail.

People with **Administer** on **Security incidents and restricted records** choose:

- **Responders**: active people with **View** on security incidents. Someone who loses that access is skipped when a message is sent, and shown as **Cannot receive alerts**. Beside each name, **Email** and **Text** say whether they can be reached that way; each person adds a mobile number or email-to-text address under **Account security** ([Text messages](14-attachments-and-notifications.md#your-mobile-number-and-email-to-text-address)).
- **Send**: **By email**, **By text message**, and **Also to the incident's lead**.
- **When**: any of the three events above.

Select **Save alert settings**. Adding a responder, or the lead, asks you to confirm your password, because the alerts leave the application. **Send a test alert** sends a test to the responders by each chosen way. Changes, tests and every alert sent are recorded in the audit log.

Email must be set up, and text messages switched on, by an administrator (**Administration** > **Email**); until then that way sends nothing. While the security incidents area is switched off under **Administration** > **Features**, no alerts are sent.

## The log

The **Log** tab is the running record of the incident and the center of the workspace.

To add an entry:

1. Press **L** anywhere on the page (outside a text box) to jump to **Add a log entry**, or select the box.
2. Write what happened, what was decided or done, and by whom.
3. Choose the kind: **Note**, **Action taken**, **Decision** or **Communication**.
4. Press **Ctrl+Enter**, or select **Add to log**.

The entry is stamped with your name and the time now, in the organization's time zone (shown beside the box). If it happened earlier, select **It happened earlier** and set **When it happened**; **Use the time now** goes back.

The log is shown newest first, grouped by day. Show only one kind with **Everything**, **Note**, **Action taken**, **Decision**, **Communication** or **System**.

The log is append-only. Entries cannot be edited or deleted. If an entry is wrong, add a new entry that corrects it. The application adds its own entries, marked **System**, when the incident is recorded or declared, when the status or scenario changes, when a clock alert is raised, when a notification is recorded or reopened, when the ransom-payment decision changes and when the review moves on.

## Checklists

The **Checklists** tab shows overall progress (**All steps**, "… of … done") and one card per phase: **Containment** and **Recovery**, each with its own count. The number on the tab is the steps still to do. When a scenario is chosen, the steps of that scenario's template are copied onto the incident. Starter checklists are supplied for Ransomware, Account compromise, Payment fraud, Vendor compromise, Lost device, Dispatch or CAD/AVL outage, Fare system compromise and Onboard network compromise.

- Check a step when it is done. Your name and the time are shown beneath it. Clear it if it was checked by mistake.
- To add a step for this incident only, type it in **Add a step for this incident**, choose the **Phase** and select **Add step**.

If you change the scenario, the new scenario's steps are copied in. Unchecked steps of the old scenario are removed; checked ones are kept and labeled with the checklist they came from. Steps you added yourself are always kept. If no scenario is chosen, the tab says so: choose one with **Edit details**.

## Roles and the team

The **Team** panel beside the clocks lists each role, the person and their contact. A phone number or email address is a link: select it to call or write, or select the copy button beside it. Select **Manage roles** to open the **Roles** tab.

The **Roles** tab lists who is doing what on this incident. A new incident starts with a copy of the standing contact list, supplied with these roles: Incident lead, Technical lead, Communications, Scribe, Executive sponsor, Legal counsel, Cyber insurer contact and Operations control liaison.

- Select **Add role** to add one. Enter the **Role**, the **Person** and a **Contact**: a phone number that works if email is down.
- Use the pencil icon to change a row and the trash icon to remove it.

Changes here affect this incident only.

## Evidence and attachments

The **Evidence** tab is the evidence register: each item kept as evidence, so that it can be found and relied on later.

1. Select **Add evidence item**.
2. In **Item**, say what it is, for example "Disk image of the affected workstation".
3. Fill in **Where held**, **Collected by** and **Collected at**.
4. In **Hash or reference**, enter a file hash, a bag number or a ticket reference.
5. Select **Save**.

Files themselves go on the **Attachments** tab. Files added there are recorded as evidence, with the date they were collected. Describe each one in the evidence register too.

## Affected

The **Affected** tab has these parts:

- **Questions that decide who must be told**: the same switches as when declaring. Changing one brings the clocks up to date straight away.
- **Affected systems and data**: free text for **Affected systems** and **Affected data**. Select **Edit** to change them.
- **Linked systems, data categories and other records**: connect the incident to records elsewhere, such as entries in the [Inventory](03-inventory.md) or a vendor in [Vendors and contracts](04-vendors-and-contracts.md).
- **Services and vehicles affected**, when the fleet module is installed and you may see fleet records: the services (routes and lines) that depend on the systems linked to the incident, and the vehicles that carry their equipment, each with a link to its record. Link the affected systems in the part above and this list follows. It covers only the linked systems themselves, not the systems they feed; for those, open a system's **Map** tab or **What is affected** (see [Fleet and services](19-fleet-and-services.md)). Vehicles are listed only for people who may see assets.

## The ransom-payment control

The **Ransom** tab records whether paying a ransom is being considered and what was decided. Your organization's policy or the law may require formal approval before a ransom is paid, so the application enforces one rule:

**The status cannot be set to "Approved for payment" until the approval reference is entered.**

Who must approve a ransom payment differs between organizations: a public agency's board, a company's directors or owners, or the agency a contractor runs service for. An administrator can therefore rename the reference field under **Administration > Features** (for example to **Board resolution** or **Owner approval reference**); the field, the rule's messages, the incident report and the printable kit then use that name. The status names are changed under **Administration > Lists** (list **Ransom payment status**). Installations set up before this version show the approved status as "Approved by the governing body"; rename it there (for example to "Approved for payment") if that does not fit your organization. A new version never renames a list value, a notification rule, a standing role or a report pack you already have, in case you edited it: the wording of the defaults reaches new installations only. If your policy records the decision elsewhere, the administrator can switch the **Recorded approval of a ransom payment** option off: the reference field disappears and "Approved" can be chosen without it. Every decision is still recorded. See [Features](09-administration.md#options-within-the-parts).

1. Open the **Ransom** tab.
2. Choose the **Status**: **Not applicable**, **Under consideration**, **Approved for payment** or **Refused**.
3. If the status is approved, enter the **Payment approval reference** (or the name your organization gave it; installations set up before this version may show **Governing body approval reference**): for example the resolution or decision number and its date, as recorded.
4. Select **Save decision**.

Every change is written to the history and to the log as a Decision. Recording a status here is a record of a decision; it does not itself authorize anything.

## Lessons learned and the post-incident review

The **Lessons** tab holds the post-incident review, its findings and the follow-up actions.

### The review

The **Post-incident review** card shows the review's progress: **Not started**, **Scheduled**, **Findings drafted**, **Completed** (or **Not required**). Closing the incident sets the **Due** date (14 days after closure) and tells the review lead, or the incident lead if there is none, in their notifications.

- **Plan the review**: set **Review due**, **Review lead**, **Review meeting** and **Who took part**, then **Save**.
- Select **Scheduled** or **Findings drafted** in the progress bar as the review moves on.
- **Complete review**: available once **What happened**, **Root cause** and **What to improve** are filled in. The completion is stamped with your name and the time and added to the log, and everyone who can see the incident is told. The findings are then frozen.
- **No review needed**: give the reason under **Why no review is needed** and select **Mark not required**. The reason goes in the log.
- **Reopen review**: unfreezes the findings so they can be changed.

### Findings

Select **Edit** on the **Findings** card to fill in **What happened**, **Root cause**, **What went well** and **What to improve**.

### Follow-up actions

Turn each improvement into a follow-up action with an owner and a due date in the **Actions** panel. The action's source is **Incident**, it is restricted like the incident, and it also appears in the action tracker; see [Risks, actions and obligations](06-risks-actions-obligations.md).

The **History** tab shows every change to the incident, including changes to roles, evidence, checklists and notifications.

## The incident report

Select **Incident report** at the top of an incident. The report is generated from the incident as it stands, in the organization's time zone, and laid out for printing:

1. **Summary**: severity, status, scenario, lead and the key times, with how long after discovery each came.
2. **What was involved**: the answers, affected systems and affected data.
3. **Notifications**: each party, its deadline, what was done and whether it was in time.
4. **Decisions**: every Decision entry in the log, and the ransom-payment position.
5. **Timeline**: the whole log, oldest first.
6. **Response**: the checklists with who checked each step and when, the roles and the evidence register.
7. **Lessons learned**: the review and its findings, and the follow-up actions.

It ends with spaces to sign. Select **Print or save as PDF** and use your browser's print window. Opening the report is recorded in the audit log.

## Notification rules, checklists and contacts

Open **Security > Security incidents** and the **Rules and checklists** tab. The page has five tabs: **Notification rules**, **Kinds of data**, **Scenario checklists**, **Roles and contacts** and **Incident statuses**. Everyone who can see security incidents can read it. Only people with **Administer** can change it.

### Why the built-in rules start inactive

Seven starter rules are supplied:

| Notify | Triggered by | Kind |
|---|---|---|
| National cyber security agency or CSIRT | Any cybersecurity or ransomware incident | Required |
| Data protection or sector regulator | Personal information involved | Required |
| Partners whose data is held under an agreement | Personal information involved | Required |
| Cyber insurer | Any incident | Required |
| Affected individuals | Personal information involved | Required |
| Transport safety or oversight authority | Any cybersecurity or ransomware incident | Required |
| Funders and partner operators | Any incident | Recommended |

All of them are switched off and have **no deadline**; the table shows them as **Off: no deadline**, and a note at the top says how many are switched off. This is deliberate. Who must be told, and how quickly, depends on the law where you operate, your contracts and your insurance policy. The application cannot know these, and a wrong deadline is worse than none. **A rule stays inactive until you set a deadline**, and until then declaring an incident starts no clock for it.

Set each rule with legal advice:

1. Go through the starter rules with your legal adviser and decide which apply to your organization.
2. For each one that applies, take the deadline from the law, contract or policy concerned and note where it comes from.
3. Add rules for any other party you must tell, such as a key customer.
4. Review the rules whenever the law, a contract or your insurance changes.

### Setting up a rule

1. On the **Notification rules** tab, select the pencil icon on a rule, or **Add notification rule**.
2. In **Notify**, name the party.
3. Choose the **Trigger**: **Any incident**, or one of the questions (for a kind of data, "… involved").
4. In **Deadline from discovery**, enter the number of hours: 24, 72 (3 days), 168 (7 days), 720 (30 days), or 0 for immediately. The longest allowed is one year.
5. Leave **Required by law or contract** checked, or clear it for a notification that is only recommended.
6. Check **Active**. A rule cannot be active without a deadline.
7. In **Guidance**, write what the person making the notification needs to know: how to report, what to have ready and where the requirement comes from.
8. Select **Save**.

Changes apply to open incidents straight away: a new or changed rule adds or updates pending clocks on every incident that is declared and not closed.

### Kinds of data

The **Kinds of data** tab lists the kinds of data your organization holds. Each becomes a yes/no question when an incident is declared (shown under **Question asked**) and can trigger notification rules. Personal information is built in. Supplied to begin with: Financial or payment information, Confidential business information, Rider account information, and Operational and safety information.

- **Add kind of data**: enter the **Name** and an **Explanation** shown under the question.
- The pencil icon changes a kind; **Order** sets its position.
- **Retire** stops it being asked on new incidents; incidents that already carry it keep it. A kind that triggers an active rule cannot be retired until that rule is switched off or changed.

### Scenario checklists

The **Scenario checklists** tab holds the templates. Choose a **Scenario**, then add, edit or remove steps under **Containment** and **Recovery**. **Order** sets the position; lower numbers come first. Editing a template does not change incidents already under way.

### Roles and contacts

The **Roles and contacts** tab is the standing incident team. Fill in the **Person** and **Contact** for each role, with phone numbers that work when email and this system are down. The list is printed in the offline kit and copied onto each new incident as its starting role list.

### Incident statuses

The **Incident statuses** tab sets the steps of the status bar. Each status has a **What it means**, which decides what the application does when an incident reaches it:

| What it means | What happens |
|---|---|
| Before declaration: no clocks run | Nothing yet. |
| Declared: clocks run | The declaration time is stamped and the clocks start. |
| Contained: spread has stopped | The containment time is stamped. |
| Closed | The closure time is stamped and the review due date is set. |

Select **Add status** to add one, or the pencil icon to rename, recolor, reorder or change its meaning. **Retire** removes a status from the bar; a status that an incident still holds cannot be retired, and there must always be at least one status meaning before declaration, one meaning declared and one meaning closed.

## The offline incident kit

An incident may take down the network or this application. The kit is a printed document with what you need in the first hour.

1. Open **Security > Security incidents** and select **Offline incident kit** (or find it by name in the search). The page shows a print preview, page by page.
2. Select **Print or save as PDF** and use your browser's print window. A4 or Letter, portrait.
3. Keep copies where they can be reached if the network is down, for example in a locked cabinet and with each member of the incident team.

The kit contains, each part starting on a new page:

- a **cover** with when and by whom it was produced, a line for who keeps the copy, and the contents;
- **First hour**: the first steps, spaces for the discovery time, and the questions with Yes and No boxes;
- **Incident roles and contacts**, with blank lines for any detail not yet filled in;
- **Who must be told, and by when**: every notification rule with its trigger and deadline ("No deadline set" for those switched off) and its guidance;
- **Severity guide and ransom rule**;
- **one checklist per scenario**, with a checkbox and a time line for every step;
- a **notification record sheet** to fill in by hand;
- **incident log sheets** for a paper log.

The kit is a restricted document: handle it as a security record. Each time it is opened the fact is recorded in the audit log. Reprint it after any change to the rules, contacts or checklists and destroy the old copies.

### PDF copies made by the server

The kit is only useful if a current copy exists somewhere other than this application on the day the application is down. So the server also makes the kit as a PDF by itself, and keeps the copies. The **PDF copies** panel at the top of the kit page shows them.

- **When a copy is made.** After any change to what the kit contains (the notification rules, contacts, checklists, questions, severities or the ransom rule), checked every 15 minutes; at least every 7 days even when nothing changed; and whenever someone selects **Make a PDF copy now**. The first copy is made a few minutes after the feature is first started.
- **The date on every page.** Each page of the PDF carries, at the top, "Restricted security record · Produced" with the date and time it was made and the organization's time zone, so a sheet found on its own still says how old it is. The cover also says who or what produced it.
- **Is my paper copy current?** The panel says whether the latest PDF copy matches the kit as it is now. When it does, it gives the time since which printed copies are up to date: a paper copy printed before that time is out of date. When the kit has changed since the last copy, it says so in amber until the next copy is made. Each copy in the list is marked **Current** or **Out of date**.
- **Downloading.** Select **PDF** beside a copy. Downloading or making a copy needs **Export** on **Security incidents and restricted records** as well as **View**, because the file leaves the application; people with **View** only see the list and print from the browser instead. Every copy made and every download is recorded in the audit log.
- **How many are kept.** The newest 12 copies; older ones are deleted. The copies are stored in the database, so they are in every backup.

People with **Administer** on security incidents see a **Schedule** under the list:

- **Fresh copy every (days)**: 7 by default, from 0 to 90. With 0, copies are made only after a change and on request.
- **Copies kept**: 1 to 100.
- **Email each automatic copy to**: people who receive every automatic copy (first, scheduled and after a change, never one made on request) by email, with the PDF attached. This is the copy that survives an outage of the application: it sits in their mailbox and on their phone, ready to print. Only active people whose roles include **View** and **Export** on security incidents can be chosen. The kit holds standing material only (rules, contacts, checklists and guides, never an incident), and all of it is visible to anyone with **View**; so the check is repeated each time a copy is sent, and anyone who has lost those permissions or has been deactivated is skipped, with the reason shown against the copy. Changing who receives it asks you to confirm your identity. Nothing is sent unless an administrator has switched email on (see [Administration](09-administration.md)); the **Email** column then says "Not emailed: email is switched off".

The email names no incident and tells the reader not to forward it. While **Security incidents** is switched off under **Administration > Features**, no copies are made and the panel is not available.

## Not available yet

- The application is in pilot. Do not record live incident details until your administrator confirms it is approved for that.
- PDF copies of the offline kit are kept in the application and sent by email; they are not written to a shared folder or printer automatically. The application cannot know when someone prints a copy, so it says from when paper copies are current rather than tracking each one.
- Clock alerts reach everyone who can see security incidents in the application's notifications, but only the named responders by email and text message (see [Alerts by email and text message](#alerts-by-email-and-text-message)).
