# Security incidents

A security incident is a suspected or confirmed attack on, loss of, or unauthorised access to your organisation's systems, accounts or data. This page explains how to declare one, how the notification clocks work, and how to use the incident workspace: the log, checklists, roles, evidence register, ransom-payment control and lessons learned. It also covers the notification rules an administrator must set up, and the printable kit for when the system itself is unavailable. The screens are in the **Cybersecurity** group of the menu: **Security incidents**, **Notification rules** and **Offline incident kit**.

## Who can see security incidents

Security incidents are **restricted records**. Everything described on this page, including the list, each incident, the notification rules and the offline kit, is visible only to people whose roles include **View** on **Security incidents and restricted records**. For everyone else, incidents do not appear in the menu, in search, in counts, in related-record links or in exports.

Beyond viewing:

| To do this | You need this permission on Security incidents and restricted records |
|---|---|
| Declare or record an incident | **Create** |
| Work an incident: log entries, checklists, roles, evidence, notifications, status | **Edit** |
| Change notification rules, checklist templates and the standing contact list | **Administer** |

Roles are managed by an administrator; see [Administration](09-administration.md).

## The pilot-mode notice

The incident list, the declare page and every incident carry this notice:

"Pilot mode: do not record live incident details here yet. Use exercise or invented data only."

Take it literally. This version of the application is a prototype that has not been hardened for real incident data. Use it to rehearse, to run exercises and to prepare your rules, contacts and checklists. During a real incident, work from the printed offline kit and your organisation's own incident procedure until your administrator confirms the application is approved for live use.

The notice on these pages is always shown in this version. It is separate from the pilot banner at the top of every page, which an administrator can switch off.

## Declaring an incident

Open **Cybersecurity > Security incidents** and select **Declare incident**, or use **Create > Security incident** from any page. The page has two parts side by side. Nothing is saved until you confirm.

### Step 1: What do we know?

1. Enter a **Title**: a short plain description, such as "Ransom note on the scheduling server".
2. Add a **Summary** if you have more detail.
3. Choose a **Scenario** if one fits: **Ransomware**, **Account compromise**, **Payment fraud**, **Vendor compromise**, **Lost device** or **Other**. The scenario brings the matching containment and recovery checklists.
4. Choose a **Severity** (see the severity guide below). It starts as **Moderate**.
5. Set **Discovered**: the date and time the organisation first became aware. It starts as the present moment. Correct it if the incident was noticed earlier. It cannot be in the future. Every notification deadline counts from this time.
6. Answer the **four questions that decide who must be told** (see the table below). If unsure, answer yes. An answer can be changed later and the clocks follow.
7. Select **Review notifications**.

The severity guide:

| Severity | Use when |
|---|---|
| **Critical** | Service to customers or safety is affected, or regulated data is confirmed exposed. |
| **High** | A core system or regulated data is at real risk; spread is possible. |
| **Moderate** | Limited to a few accounts or devices and contained quickly. |
| **Low** | Attempt or near miss with no confirmed impact. |

The four questions:

| Question | Tick it when |
|---|---|
| **Is this a cybersecurity or ransomware incident?** | There is any attack on, or unauthorised access to, the organisation's systems, accounts or data. Ticked to begin with. |
| **Could health information be involved?** | Medical, care or other health-related details of identifiable people may be affected. |
| **Could payment card data be involved?** | Card numbers, or the systems and devices that take card payments, may be affected. |
| **Could personal information be involved?** | Names with identifiers such as national identity, licence or account numbers may be affected. |

### Step 2: Notifications this will require

The right-hand card now lists every notification your answers will require. Each line shows who must be told, whether it is **Required** or **Recommended**, the deadline, the exact date and time it falls due, and any guidance.

Under the heading "Also consider (no deadline configured, so no clock)" you may see further parties. These are rules that match your answers but are switched off or have no deadline, so no clock will be created for them. Decide for yourself whether they must be told.

If you change anything in step 1 the preview clears; select **Review notifications** again.

Then choose one of:

- **Confirm and declare incident**: saves the incident with status **Declared** and starts the clocks.
- **Save as reported only**: saves it with status **Reported**. No clocks are created. Use this when you are not yet sure it is an incident.

Either way you are taken to the incident workspace, and the incident is given a reference beginning `SEC-`.

### Declaring an incident that was saved as reported

Open the incident and either select **Declare incident** at the top of the page, or select the **Declared** step in the status bar and confirm. The clocks start, and their deadlines are still counted from the discovery time, not from the moment you declare.

## The incident workspace

Opening an incident shows, from top to bottom: the title with severity and status, the status bar, the notification clocks, the **Details** card and a row of tabs.

### Status

The status bar shows five steps: **Reported**, **Declared**, **Contained**, **Recovering** and **Closed**. To change status, select a step and confirm. Each change is time-stamped and added to the incident log. The application also fills in the **Declared**, **Contained** and **Closed** times on the **Details** card the first time the incident reaches those steps; you can correct them with **Edit**.

### Details

Select **Edit** on the **Details** card to change the **Title**, **Summary**, **Severity**, **Scenario**, **Incident lead** or any of the times. Changing **Discovered** moves the deadline of every notification that is still pending.

## Notification clocks

The **Regulatory clocks** strip sits near the top of every declared incident. There is one clock for each party that must be told.

### How deadlines are worked out

Each clock comes from a notification rule that is active, has a deadline, and whose trigger matches the incident's answers to the four questions. The due time is:

**discovery time + the rule's deadline in hours**

For example, with a 72-hour rule and a discovery time of 09:30 on a Monday, the notification is due at 09:30 on the Thursday. A deadline of 0 hours means immediately. The time you declared the incident does not affect the deadline, so an incident declared late may open with clocks that are already amber or red.

### Colours

| What you see | Meaning |
|---|---|
| Green, "… left" | More than a quarter of the time allowed still remains. |
| Amber, "… left" | A quarter of the time allowed, or less, remains. |
| Red, "Overdue by …" | The deadline has passed and no notification is recorded. |
| "Notified: Met" (green) | The notification was recorded at or before the deadline. |
| "Notified: Missed by …" (red) | The notification was recorded after the deadline. |
| "Not required for this incident" | The clock has been stood down. |

Clocks are ordered with the most urgent first: red, then amber, then green, then completed ones. Each card also shows the deadline in words (for example "72 hours") and the due date and time.

### Recording a notification

When the party has been told:

1. On its clock, select **Record notification**.
2. In **Who was notified**, enter the name and role of the person or desk that took the report.
3. In **How**, enter the method: phone, email, web form, letter and so on.
4. Check **When**. It starts as the present moment; change it to the time the notification was actually made. It cannot be in the future.
5. Enter any **Reference received**, such as a report or case number.
6. Select **Record notification**.

The clock stops and shows whether the deadline was met. The details are added to the incident log as a Communication entry. A completed notification is kept as a record and cannot be deleted. If you made a mistake, select **Correct record** on the clock and save the corrected details.

### Marking a notification "not required"

Use this when, on the facts or on advice, a party does not have to be told.

1. On the clock, select **Not required**.
2. Enter the **Reason**. This is required.
3. Select **Mark not required**.

The reason is written to the incident log as a Decision. If things change, select **Reopen** on the clock and it starts counting again against the original deadline.

### When the answers change

The four questions can be changed on the **Affected** tab. After the incident is declared:

- changing an answer to yes adds the matching clocks;
- changing an answer to no stands down the matching clocks that are still pending, marking them not required;
- changing it back to yes reopens the clocks that were stood down that way;
- completed notifications are never removed.

If a declared incident shows "No notifications required", no active rule matches it. Check the answers on the **Affected** tab and check that the rules have been set up.

## The log

The **Log** tab is the running record of the incident, newest first.

To add an entry:

1. In **Add a log entry**, write what happened, what was decided or done, and by whom.
2. Choose the **Kind**: **Note**, **Action taken**, **Decision** or **Communication**. (The list also offers **System**, which is the kind the application uses for its own entries.)
3. Select **Add to log**.

The log is append-only. An entry is stamped with your name and the time, and cannot be edited or deleted after saving. If an entry is wrong, add a new entry that corrects it.

The application adds its own entries, marked **System**, when the incident is recorded or declared, when the status or scenario changes, when a notification is recorded or reopened, and when the ransom-payment decision changes.

## Checklists by scenario

The **Checklists** tab holds two lists: **Containment** (stop it getting worse) and **Recovery** (get back to normal). When a scenario is chosen, the steps of that scenario's template are copied onto the incident. Starter checklists are supplied for Ransomware, Account compromise, Payment fraud, Vendor compromise and Lost device.

- Tick a step when it is done. Your name and the time are shown beside it. Untick it if it was ticked by mistake.
- A progress bar above each list shows how many steps are done.
- To add a step that applies only to this incident, type it in **Add a step for this incident**, choose the **Phase** and select **Add step**.

If you change the scenario, the new scenario's steps are copied in. Steps from the old scenario that were not ticked are removed; steps that were ticked are kept and labelled with the checklist they came from. Steps you added yourself are always kept.

If no scenario is chosen the tab says so. Choose one on the **Details** card.

## Roles

The **Roles** tab lists who is doing what on this incident. A new incident starts with a copy of the standing contact list, which is supplied with these roles: Incident lead, Technical lead, Communications, Scribe, Executive sponsor, Legal counsel and Cyber insurer contact.

- Select **Add role** to add one. Enter the **Role**, the **Person** and a **Contact**: a phone number that works if email is down.
- Use the pencil icon to change a row and the bin icon to remove it.

Changes here affect this incident only.

## Evidence register

The **Evidence register** tab lists each item kept as evidence, so that it can be found and relied on later.

1. Select **Add evidence item**.
2. In **Item**, say what it is, for example "Disk image of the affected laptop".
3. Fill in **Where held**, **Collected by** and **Collected at**.
4. In **Hash or reference**, enter a file hash, a bag number or a ticket reference.
5. Select **Save**.

The register records descriptions only. The items themselves stay where you hold them.

## Affected

The **Affected** tab has three parts:

- **What is involved**: the four yes/no answers, plus free text for **Affected systems** and **Affected data**. Select **Edit** to change them.
- A reminder that the four answers decide which notifications are required.
- **Linked systems, data categories and other records**: choose the **Record type**, find the **Record**, choose the **Relation** and select **Add link** to connect the incident to records elsewhere, such as entries in the [Inventory](03-inventory.md) or a vendor in [Vendors and contracts](04-vendors-and-contracts.md).

## The ransom-payment control

The **Ransom payment** tab records whether paying a ransom is being considered and what was decided. Your organisation's policy or the law may require formal approval before a ransom is paid, so the application enforces one rule:

**The status cannot be set to "Approved by the governing body" until a governing body approval reference is entered.**

To record the position:

1. Open the **Ransom payment** tab.
2. Choose the **Status**: **Not applicable**, **Under consideration**, **Approved by the governing body** or **Refused**.
3. If the status is approved, enter the **Governing body approval reference**: for example the resolution or decision number and the meeting date, as recorded in the minutes.
4. Select **Save decision**.

Every change is written to the incident's history and to the log as a Decision. Recording a status here is a record of a decision; it does not itself authorise anything.

## Lessons learned

Once the incident is under control, open the **Lessons learned** tab, select **Edit** and fill in:

- **What happened**: the agreed account of the incident.
- **What went well**.
- **What to improve**.

To turn improvements into tracked work, add each one in the action tracker with the source **Incident** and link it to the incident on the action's **Related** tab. See [Risks, actions and obligations](06-risks-actions-obligations.md).

The **Related** tab lists linked records, and the **History** tab shows every change to the incident, including changes to roles, evidence, checklists and notifications.

## Notification rules, checklists and contacts

Open **Cybersecurity > Notification rules**. The page is titled **Notification rules and checklists** and has three tabs. Everyone who can see security incidents can read it. Only people with **Administer** can change it.

### Why the built-in rules start inactive

Six starter rules are supplied:

| Notify | Triggered by |
|---|---|
| National cyber security agency or CSIRT | Any cybersecurity or ransomware incident |
| Data protection or sector regulator | Personal information involved |
| Health data partner or regulator | Health information involved |
| Card acquirer and card brands | Payment card data involved |
| Cyber insurer | Any incident |
| Affected individuals | Personal information involved |

All six are **Switched off** and have **no deadline**. This is deliberate. Who must be told, and how quickly, depends on the law where you operate, your sector, your contracts and your insurance policy. The application cannot know these, and a wrong deadline is worse than none. Until you set the rules up, declaring an incident starts no clocks.

Set each rule with legal advice:

1. Go through the starter rules with your legal adviser and decide which apply to your organisation.
2. For each one that applies, take the deadline from the law, contract or policy concerned and note where it comes from.
3. Add rules for any other party you must tell, such as a funder or a key customer.
4. Review the rules whenever the law, a contract or your insurance changes.

### Setting up a rule

1. On the **Notification rules** tab, select the pencil icon on a rule, or **Add notification rule**.
2. Choose the **Trigger**: **Any incident**, or one of the four questions.
3. In **Notify**, name the party.
4. In **Deadline from discovery**, enter the number of hours: 24, 72 (3 days), 168 (7 days), 720 (30 days), or 0 for immediately. The longest allowed is one year.
5. Leave **Required by law or contract** ticked, or untick it for a notification that is only recommended.
6. Tick **Active**. A rule cannot be made active without a deadline.
7. In **Guidance**, write what the person making the notification needs to know: how to report, what to have ready and where the requirement comes from.
8. Select **Save**.

Changes apply to open incidents straight away: a new or changed rule adds or updates pending clocks on every incident that is declared and not closed.

### Scenario checklists

The **Scenario checklists** tab holds the templates. Choose a **Scenario**, then add, edit or remove steps under **Containment** and **Recovery**. **Order** sets the position; lower numbers come first. Editing a template does not change incidents already under way.

### Roles and contacts

The **Roles and contacts** tab is the standing incident team. Fill in the **Person** and **Contact** for each role, with phone numbers that work when email and this system are down. The list is printed in the offline kit and copied onto each new incident as its starting role list.

## The offline incident kit

An incident may take down the network or this application. The kit is a printable copy of what you need in the first hour.

1. Open **Cybersecurity > Offline incident kit**.
2. Select **Print or save as PDF** and use your browser's print window.
3. Keep copies where they can be reached if the network is down, for example in a locked cabinet and with each member of the incident team.

The kit contains:

- **First hour**: the first steps, the four questions with tick boxes, and a space to write the discovery time.
- **Who must be told, and by when**: every notification rule with its deadline, with rules that are active listed first and a column to write in when each was done.
- **Incident roles and contacts**.
- **Severity guide**.
- **Scenario checklists**, with a tick box for every step.

The kit is a restricted document: handle it as a security record. Each time it is opened the fact is recorded in the audit log. Reprint it after any change to the rules, contacts or checklists; the date it was produced is printed at the top.

## Not available yet

- The application is in pilot. Do not record live incident details until your administrator confirms it is approved for that.
- No alerts are sent when a clock turns amber or red. Someone must watch the incident page.
- The offline kit is printed from the browser by hand. It is not produced or distributed on a schedule.
- Files cannot be attached to an incident, a log entry or an evidence item.
- An incident has no **Actions** tab. Add follow-up actions in the action tracker and link them.
- The names of the lists used on these screens, such as the scenario and severity names, can be seen by every signed-in user, although the incidents themselves cannot.
