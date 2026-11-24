# Safety management

The safety pages hold the safety side of the operation: the **hazard log**, **safety events** (collisions, injuries, near misses, assaults, fires, derailments and unsafe conditions) with their investigation and corrective actions, and **safety performance indicators** measured against targets. Open them from the **Safety** group in the navigation: **Safety dashboard**, **Safety events**, **Hazard log** and **Safety indicators**. The pages share tabs along the top: **Dashboard**, **Safety events**, **Hazard log**, **Indicators** and **Exposure**. Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not run its safety program here, an administrator can switch **Safety management** off under **Administration > Features** (see [Administration](09-administration.md#features)). The safety pages, their reminders and **Report a safety concern** in the portal then disappear. Records are kept and return when it is switched back on.

You need the **safety** permissions (`safety.view`, and `safety.create`, `safety.edit`, `safety.delete`, `safety.export`, `safety.approve`, `safety.administer`). `safety.approve` approves yearly indicator targets. Corrective actions and mitigations are kept in the action tracker, so working with them also needs the **actions** permissions.

The default **Safety manager** role holds all of these, the action tracker, and read access to vehicles and services, systems, sites, dashboards, reports, policies and training, so a safety team can be set up by giving people that role. It does not include restricted records (`security.view`, see [Restricted events](#restricted-events)): whoever investigates passenger injuries, assaults and other events holding personal details also needs a role with `security.view`, such as **Security lead**, or they cannot open those events, their corrective actions or the portal reports marked as holding personal details, and are not notified of them. The **People involved** and **Statements** of every event, restricted or not, also need `security.view`. The **Security lead** role can read the safety pages (`safety.view`). An administrator can grant the safety permissions to any other role under **Administration > Roles**.

## Safety dashboard

Open **Safety dashboard**. It covers the last twelve months:

- Tiles for **Safety events**, **Serious or worse**, **Open events** (and how many are past their investigation date), **Corrective actions open** (and how many are overdue), **Open hazards** (how many are rated serious or high, and how many are past their review date) and **Notification clocks running** (how many are overdue or due soon; see [Reporting and notification clocks](#reporting-and-notification-clocks)). Each tile opens the records behind it. The clock count includes restricted events, so it is the same for everyone.
- **Safety events by month**, **By type** and **By severity**. Select a bar to open those events.
- **Open hazards on the hazard matrix**: how many open hazards sit in each cell, rated after mitigation where that is scored, otherwise as they are now.
- **Safety performance indicators**: each active indicator's latest value, whether it is **On target** or **Off target**, and its trend with the target as a dashed line.

Select **Report a safety event** to record a new one.

## Safety events

Open **Safety events**. Filter by type, severity, status, date, vehicle, service, site, investigator, **Reportable** or **Restricted**.

### Record a safety event

1. Select **New safety event**, or **Create** then **Safety event**.
2. Enter a **Title** and check the **Date and time** (it starts at the current time and cannot be in the future).
3. Choose the **Type**: **Collision**, **Passenger injury**, **Near miss**, **Assault on an operator**, **Fire**, **Derailment**, **Unsafe condition**, **Slip, trip or fall** or **Other**.
4. Choose the **Severity**: **No injury or damage**, **Minor**, **Moderate**, **Serious** or **Major or fatal**.
5. Record where it happened: the **Site**, the **Vehicle**, the **Route or service** and a **Location** such as "At a stop".
6. Describe **What happened** and the **Immediate actions**, and enter **People injured** and **Reported by**.
7. If you know them, enter the figures reporting depends on: **Fatalities**, **People taken for medical treatment**, **Estimated damage** and whether the vehicle or station was **evacuated**. Once people are recorded on the **People involved** tab, the first two are counted from them.
8. Leave **Restricted (holds personal information)** as it is, or change it (see below).
9. If the person who made the report asked for their identity to be kept confidential, check **Reporter asked to stay confidential** (see [Confidential reporting](#confidential-reporting)).
10. Select **Create safety event**.

The event gets a reference such as `SE-00101`.

### Reports from the self-service portal

When the portal is on and its setting **Staff can report a safety event** is on, staff can use **Report a safety concern** in the portal to describe what happened in plain words (see [Report a safety concern](18-self-service-portal.md#report-a-safety-concern)). Each report becomes a safety event with the status **Reported**, the reporter in **Reported by**, and a severity taken from how bad the reporter said it was. A note on the event says it came from the portal; check the severity when you triage it. Everyone who may edit safety records is notified of each new report (a **Serious** or worse report is announced as described under "Notifications" below). The reporter sees only the reference, the title and a plain status (**Received**, **Being looked into** or **Closed**); for a restricted event, only the reference. When the event closes, the reporter also sees what was done (see [Telling the reporter what was done](#telling-the-reporter-what-was-done)). A reporter can ask for their name to be kept confidential (see [Confidential reporting](#confidential-reporting)).

### Confidential reporting

People are more willing to report a mistake, a near miss or an unsafe instruction when they know their name will not travel. A reporter can ask for their identity to be kept confidential:

- in the portal, by checking **Keep my name confidential** on **Report a safety concern**;
- when someone on the safety team records a report made to them (for example by phone), by choosing the reporter in **Reported by** and checking **Reporter asked to stay confidential**. You cannot do this for a report you make yourself, because your name is on the event as the person who entered it: use **Report a safety concern** in the portal instead. Checking it with nobody in **Reported by** records an anonymous report.

The event is then saved without the reporter's name. **Reported by** stays empty and is not shown, a portal report is created by the application rather than by the reporter (so neither **Created by** nor the **History** names them), and the notes and notifications say only that the reporter asked to stay confidential. Lists, filters, exports, record PDFs, search, reports, imports, webhooks and the AI assistant all read the event, so none of them can show who reported it. Whether a reporter stays confidential is chosen when the report is made and cannot be changed afterward.

Only the people named under **Administration > Confidential safety reports** can see who made a confidential report. On the event page they see a notice with **Show who reported it**; each look is recorded on the event's **History** as "Confidential reporter's identity viewed", with the name of the person who looked but never the reporter's. Everyone else sees the notice without the button. Name as few people as you can.

To name them, open **Administration > Confidential safety reports** (needs `safety.administer`), choose the people under **Named people** and select **Save named people**. Each must be active and able to see safety events; adding someone asks you to confirm your password. Nobody is named at first, so until someone is, nobody can see who made a confidential report. A named person who loses access to safety events cannot look until they have it again. Every change is recorded in the audit log.

What confidentiality does not cover: the words of the report itself (ask reporters not to name themselves in it), and people who run the server, who can read the database, backups and the request log.

### Telling the reporter what was done

When an event that has a reporter (in **Reported by**, or a confidential one) is closed, the reporter is told in plain words what was done about their report. **Close event** asks for **What the reporter is told**: what was found and what was done about it, without names or personal details. The event cannot be closed without it. The reporter then gets a notification (**Your safety report SE-00104 is closed**, with your words), **Reporter told** records when, and the **History** shows "Reporter told what was done about their report". In the portal, **My safety reports** shows the words under the closed report.

A confidential reporter's notification says only **A safety report you made has been closed** and asks them to read what was done under **My safety reports** in the portal, so the notification names neither the event nor what it was about. (When the portal is off, the notification carries the words.)

Both appear on the event page in the **Telling the reporter** card, where the words can be changed. Reopening an event and closing it again tells the reporter again.

### Restricted events

Events that hold personal information are **restricted**: only people who may see restricted records (`security.view`) can see them in lists, search, links and exports. They still count in the dashboard and the indicators, which are the same for everyone and show no event's details. **Passenger injury** and **Assault on an operator** events start restricted unless you clear **Restricted (holds personal information)**; any other event can be restricted by checking it. Corrective actions of a restricted event are restricted too. Someone without `security.view` who restricts an event can no longer open it.

### Notifications

When a **Serious** or **Major or fatal** event is recorded, or an event is raised to one of those severities, everyone who may see safety records (and the investigator) is notified, under the notification kind **Safety events**. Once a day, each corrective action that is past its due date is reported to the event's investigator and to everyone who may edit safety records. People who cannot see a restricted event are never told about it. Each person can switch **Safety events** notifications off in their notification settings.

### Investigate and close an event

The event page shows the progress (**Reported**, **Under investigation**, **Corrective actions**, **Closed**) and four cards: **What happened**, **Harm and damage** (**People injured**, **Fatalities**, **People taken for medical treatment**, **Estimated damage**, **Vehicle or station evacuated**), **Where** and **Investigation** (**Investigator**, **Investigation due**, **Root cause category**, **Root cause**, **Findings**, **Closed on**, **Notes**). Select **Edit** on a card to change it. A reportable event shows which bodies must be notified above the cards.

The buttons at the top move the event on: **Start investigation**, **Corrective actions raised**, **Close event** and, on a closed event, **Reopen**. The button for the next step is the main one: **Start investigation** on a reported event, **Corrective actions raised** during an investigation, **Close event** once actions are raised.

An event can be closed only when its **Root cause** is recorded and every corrective action is finished or canceled; an event with a reporter also needs **What the reporter is told** (see [Telling the reporter what was done](#telling-the-reporter-what-was-done)). **Closed on** is filled in for you, and cleared if the event is reopened.

### People involved

The **People involved** tab lists each person involved in the event, with their **Role** (**Passenger**, **Employee**, **Contractor**, **Member of the public** or **Trespasser**), **Name** (optional), **Injury** (**No injury**, **First aid only**, **Medical treatment**, **Admitted to hospital** or **Fatal**), whether they were **Taken for medical treatment** and whether it was a **Fatality**, and notes. Select **Add a person**, or **Edit** or **Remove** on a row.

Once anyone is recorded here, the event's **Fatalities** and **People taken for medical treatment** are counted from these rows and can no longer be typed in. The tab needs `security.view` as well as the safety permissions, on every event: names and injuries are personal information. The history of the event records that a person was added or changed by role, never by name. Where the staff roster is part of the application, a person can be linked to their roster entry.

### Investigation record

The **Investigation** tab holds:

- **Conditions**: **Weather**, **Lighting**, **Road or track surface**, the **Latitude** and **Longitude** of the place (give both or neither), and **Post-event testing required** (yes or no). Test results are not recorded: they belong in the testing program's own system.
- **Contributing factors**: everything that played a part, from **Human factors**, **Equipment or vehicle**, **Weather or environment**, **Organizational (procedures, training, scheduling)**, **Infrastructure** and **Third party**. Check them and select **Save**.
- **Timeline**: what happened, in order. Select **Add an entry**, give **When** and **What happened**. The application adds its own entries when a reporting rule applies, an alert is raised or a notification is recorded; those are marked **Recorded by the application** and cannot be changed.
- **Statements**: witness statements, statements of people involved and employee reports, each with who gave it and when. Statements need `security.view`, like the people involved. Keep a signed copy as a file on the event: files of a restricted event are restricted with it.

### Reporting and notification clocks

Your organization writes its own **reporting rules**: when an event must be reported, to whom, and within how many hours of the event (see [Safety reporting rules](#safety-reporting-rules)). The application ships no rule of any jurisdiction.

Every time an event is saved (and when its people involved change), its figures are checked against the rules that are switched on. The **Reporting** tab says whether the event is **Reportable** and which rules apply, and lists a **notification clock** for each: who to notify, by when, and its state: **Running**, **Due soon** (a quarter or less of the time left), **Overdue**, **Made** or **Not required**.

- When a rule newly applies, a clock starts (counted from the event's **Date and time**), a line is added to the timeline, and everyone who may see the event and its investigator are notified.
- When the time left falls to a quarter, and again when the deadline passes, the same people are alerted once and the timeline records it. The check runs every five minutes; an alert that could not be sent (for example while the database was unavailable) is sent by the next check rather than lost.
- Correcting the event's date and time moves the deadline with it.
- If the figures change so that a rule no longer applies, its clock is set aside as **Not required**; it runs again if the rule applies again.

On a running clock, select **Record notification** and give **Who was told**, **How**, **When** and any **Reference received**, or select **Not required** and say why. A notification made after the deadline is shown as late.

An administrator can change the quarter under **Administration > Settings** (`safety.clock_amber_fraction`).

### Corrective actions

On the **Corrective actions** tab, type an action and press Enter, or select **Add action** for the full form (owner, due date, priority). Actions are filed under **Safety** in the action tracker and also appear there and in **My actions**.

### Hazards of an event

On the **Hazards** tab, select **Link a hazard**, choose the **Hazard** and select **Link**. Select **Remove** to take a link off. The hazard's **Safety events** tab lists the events linked to it (restricted ones only for people who may see them).

### Safety reporting rules

With `safety.administer`, open **Administration > Safety reporting rules**. Each rule has:

- a **Name**, **Who must be notified** and **Within (hours from the event)**;
- one or more **conditions**, all of which must hold: **Fatalities**, **People taken for medical treatment** or **Estimated damage** *is at least*, *is more than* or *is exactly* a number; **Type** or **Severity** *is one of* chosen values; **Evacuated** *is* yes or no;
- **Guidance** shown on the clock (how to notify, what to include), whether it is **Required** or only recommended, and whether it is **Switched on**.

A new rule starts switched off. Rules apply to events as they are next saved; changing or removing a rule does not change clocks already started.

## Hazard log

Open **Hazard log**. The list shows each hazard's **Rating** now and **After mitigation**, sorted with the worst first.

### Add a hazard

1. Select **New hazard**, or **Create** then **Hazard**.
2. Enter the **Hazard**, a **Description**, its **Source** (**Safety event**, **Inspection**, **Audit**, **Staff report**, **Change or new service**, **Risk assessment** or **Other**), the **Possible consequence** and the **Existing controls**.
3. Optionally choose the **Mode** and **Site**, and set the **Owner** and **Review date**.
4. Select **Create hazard**.

### Score a hazard on the hazard matrix

Hazards are scored on the **Safety hazard matrix (4 by 5)**: five likelihood levels (**Improbable**, **Remote**, **Occasional**, **Probable**, **Frequent**) by four severity levels (**Negligible**, **Marginal**, **Critical**, **Catastrophic**), giving **Low**, **Medium**, **Serious** or **High**. A safety administrator can rename its levels and change the rating of each cell (see [Change the hazard matrix](#change-the-hazard-matrix)).

On the hazard page, the **Current risk** card scores the hazard with its existing controls and the **After mitigation** card scores it once the mitigations are in place. Choose a cell to score it; the chosen cell is outlined and checked, and the rating appears in the card's heading. A cell names its rating in words, so the color is never the only clue.

Set the **Status** as the work goes on: **Identified**, **Being mitigated**, **Controlled** or **Closed**. Closed hazards are left off the dashboard's matrix.

A hazard's **Owner** (or, when it has none, everyone who may edit safety records) is reminded once when its **Review date** is 14 days away and once when it is reached. Closed hazards are left out. Set the next review date after each review and the reminders start again. An administrator changes the 14 days under **Administration** > **Reminders**.

### Change the hazard matrix

With the `safety.administer` permission (the **Safety manager** role has it), open **Administration > Hazard matrix**, or select **Hazard matrix** at the top of the **Hazard log**.

1. Under **Matrix**, choose the rating each pair of levels gives: likelihood runs down the side, severity along the bottom. Each cell names its rating in words.
2. Under **Likelihood** and **Severity**, change the **Name** and **What it means** of any level. The number of levels and their values stay as they are, so no score loses its meaning.
3. Select **Save hazard matrix**. Every hazard is then rated again on the new matrix, and a message says how many ratings changed. **Discard changes** puts back the saved matrix.

The change is recorded in the audit log. The page works whichever other parts of the application are switched on. Where the risk register is in use, the same matrix is also one of its risk scales, and the scale's other settings (its name, its ratings and the acceptance threshold) are changed there. Saving the matrix from either page rates every hazard again.

### Mitigations

The **Mitigations** tab holds the actions that reduce the hazard, kept in the action tracker under **Safety**, exactly as corrective actions are.

## Safety performance indicators

Open **Safety indicators**. Each indicator is worked out month by month: from the safety events, from values entered by hand, from a figure another part of the application offers, or from the exposure.

### Add an indicator

1. Select **New indicator**.
2. Enter the **Name**, for example "Collisions per 100,000 vehicle-miles", and a **Description**.
3. Choose the **Measure**:
   - **Number of events in the month**, or **Rate: events per amount of exposure**. Choose which events count: **Event types counted**, **Severities counted** and **Modes counted** (by the event's vehicle or service); leave a choice empty to count all. For a rate, choose what it is **Per** (**Vehicle-miles**, **Vehicle-hours** or **Boardings**) and **Per how many** (for example 100,000).
   - **Entered by hand each month**: for a leading indicator such as inspections completed on time. Enter each month's value on the indicator's **Values** tab.
   - **Computed from another part of the application**: choose the figure in **Computed from**, for example overdue corrective actions or training compliance. Which figures are offered depends on the parts of the application in use; one whose part is switched off shows no values.
   - **Revenue miles between major failures**: revenue miles divided by major failures, both entered on the **Exposure** page. Choose **Modes** to add up the figures of some modes only.
4. Choose whether the **Target is** **At most (lower is better)** or **At least (higher is better)**, and enter the **Target**.
5. Leave **Shown on the safety dashboard** checked to show it there.
6. Select **Add indicator**.

### The indicator page

The tiles show the **Latest** value and the **Target**. The **Trend** tab shows the indicator for the last 6, 12 or 24 months with the target as a dashed line, and a table of each month's figures (events, exposure, or revenue miles and failures), value, target and whether it was **On target** or **Off target**. A month without exposure has no rate: select **Enter** to record it. Select **Edit** to change the indicator; the **History** tab lists every change.

An indicator **Entered by hand each month** has a **Values** tab: select **Enter** (or **Edit**) beside a month, give the **Value** and an optional **Note**, and select **Save**. Leave the value empty to remove it. Future months cannot be entered.

Indicators count every safety event, restricted or not, so everyone who may see an indicator sees the same figures. The events behind a figure are listed only for people who may open them.

### Yearly targets

Targets are often set each year and approved by the accountable executive or the safety committee. On the indicator's **Yearly targets** tab, select **Add a target**, give the **Year**, whether the **Target is** at most or at least, and the **Target**. A year's target takes the place of the indicator's own target for the months of that year, unless it is rejected.

A new target is **Proposed**. To have it approved:

- select **Ask for approval**: the **Safety performance targets** approval workflow starts (by default, one approver holding `safety.approve`; an administrator can add steps under **Administration > Approval workflows**). While it waits the target shows **Waiting for approval** and cannot be changed. Approval marks it **Approved** with the approver and date; rejection marks it **Rejected**; or
- with `safety.approve`, select **Record a decision** to record a decision taken elsewhere, for example at a committee meeting: **Approved** or **Rejected**, **Decided by**, the **Date of the decision** and a **Reference** such as the meeting and item.

Changing the figure of an approved target sends it back to **Proposed**. Only someone with `safety.approve` can remove an approved target.

## Exposure

Open the **Exposure** tab to record each month's **Vehicle-miles**, **Vehicle-hours**, **Boardings**, **Revenue miles** and **Major failures** (whole numbers), for the **Whole operation** or for one mode. Select **Enter** (or **Edit**) beside a month, fill in the figures and select **Save**. Future months cannot be entered. When no figure is entered for the whole operation, a rate adds up the figures entered for each mode.

## Sample data

The `dev` sample profile loads an invented year of safety records: twelve hazards, about a hundred safety events across the sample fleet and services (some with corrective actions), a year of exposure (with revenue miles and major failures) and five event indicators. It also loads people involved, conditions and a timeline entry on ten events; two example reporting rules, labeled "Example (invented)" and switched off; two indicators entered by hand with a year of values; one computed indicator; one revenue-miles-between-failures indicator; and this year's targets, one approved at an invented committee meeting and one proposed.

## Not available yet

- Drug and alcohol test results are not recorded, on purpose: they belong in a specialist system with its own privacy rules. Only **Post-event testing required** (yes or no) is kept.
