# Safety management

The safety pages hold the safety side of the operation: the **hazard log**, **safety events** (collisions, injuries, near misses, assaults, fires, derailments and unsafe conditions) with their investigation and corrective actions, and **safety performance indicators** measured against targets. Open them from the **Safety** group in the navigation: **Safety dashboard**, **Safety events**, **Hazard log** and **Safety indicators**. The pages share tabs along the top: **Dashboard**, **Safety events**, **Hazard log**, **Indicators** and **Exposure**. Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not run its safety program here, an administrator can switch **Safety management** off under **Administration > Features** (see [Administration](09-administration.md#features)). The safety pages, their reminders and **Report a safety concern** in the portal then disappear. Records are kept and return when it is switched back on.

You need the **safety** permissions (`safety.view`, and `safety.create`, `safety.edit`, `safety.delete`, `safety.export`, `safety.administer`). Corrective actions and mitigations are kept in the action tracker, so working with them also needs the **actions** permissions.

The default **Safety manager** role holds all of these, the action tracker, and read access to vehicles and services, systems, sites, dashboards, reports, policies and training, so a safety team can be set up by giving people that role. It does not include restricted records (`security.view`, see [Restricted events](#restricted-events)): whoever investigates passenger injuries, assaults and other events holding personal details also needs a role with `security.view`, such as **Security lead**, or they cannot open those events, their corrective actions or the portal reports marked as holding personal details, and are not notified of them. The **Security lead** role can read the safety pages (`safety.view`). An administrator can grant the safety permissions to any other role under **Administration > Roles**.

## Safety dashboard

Open **Safety dashboard**. It covers the last twelve months:

- Tiles for **Safety events**, **Serious or worse**, **Open events** (and how many are past their investigation date), **Corrective actions open** (and how many are overdue) and **Open hazards** (how many are rated serious or high, and how many are past their review date). Each tile opens the records behind it.
- **Safety events by month**, **By type** and **By severity**. Select a bar to open those events.
- **Open hazards on the hazard matrix**: how many open hazards sit in each cell, rated after mitigation where that is scored, otherwise as they are now.
- **Safety performance indicators**: each active indicator's latest value, whether it is **On target** or **Off target**, and its trend with the target as a dashed line.

Select **Report a safety event** to record a new one.

## Safety events

Open **Safety events**. Filter by type, severity, status, date, vehicle, service, site, investigator or **Restricted**.

### Record a safety event

1. Select **New safety event**, or **Create** then **Safety event**.
2. Enter a **Title** and check the **Date and time** (it starts at the current time and cannot be in the future).
3. Choose the **Type**: **Collision**, **Passenger injury**, **Near miss**, **Assault on an operator**, **Fire**, **Derailment**, **Unsafe condition**, **Slip, trip or fall** or **Other**.
4. Choose the **Severity**: **No injury or damage**, **Minor**, **Moderate**, **Serious** or **Major or fatal**.
5. Record where it happened: the **Site**, the **Vehicle**, the **Route or service** and a **Location** such as "At a stop".
6. Describe **What happened** and the **Immediate actions**, and enter **People injured** and **Reported by**.
7. Leave **Restricted (holds personal information)** as it is, or change it (see below).
8. Select **Create safety event**.

The event gets a reference such as `SE-00101`.

### Reports from the self-service portal

When the portal is on and its setting **Staff can report a safety event** is on, staff can use **Report a safety concern** in the portal to describe what happened in plain words (see [Report a safety concern](18-self-service-portal.md#report-a-safety-concern)). Each report becomes a safety event with the status **Reported**, the reporter in **Reported by**, and a severity taken from how bad the reporter said it was. A note on the event says it came from the portal; check the severity when you triage it. Everyone who may edit safety records is notified of each new report (a **Serious** or worse report is announced as described under "Notifications" below). The reporter sees only the reference, the title and a plain status (**Received**, **Being looked into** or **Closed**); for a restricted event, only the reference.

### Restricted events

Events that hold personal information are **restricted**: only people who may see restricted records (`security.view`) can see them in lists, search, links and exports. They still count in the dashboard and the indicators, which are the same for everyone and show no event's details. **Passenger injury** and **Assault on an operator** events start restricted unless you clear **Restricted (holds personal information)**; any other event can be restricted by checking it. Corrective actions of a restricted event are restricted too. Someone without `security.view` who restricts an event can no longer open it.

### Notifications

When a **Serious** or **Major or fatal** event is recorded, or an event is raised to one of those severities, everyone who may see safety records (and the investigator) is notified, under the notification kind **Safety events**. Once a day, each corrective action that is past its due date is reported to the event's investigator and to everyone who may edit safety records. People who cannot see a restricted event are never told about it. Each person can switch **Safety events** notifications off in their notification settings.

### Investigate and close an event

The event page shows the progress (**Reported**, **Under investigation**, **Corrective actions**, **Closed**) and three cards: **What happened**, **Where** and **Investigation** (**Investigator**, **Investigation due**, **Root cause category**, **Root cause**, **Findings**, **Closed on**, **Notes**). Select **Edit** on a card to change it.

The buttons at the top move the event on: **Start investigation**, **Corrective actions raised**, **Close event** and, on a closed event, **Reopen**.

An event can be closed only when its **Root cause** is recorded and every corrective action is finished or canceled. **Closed on** is filled in for you, and cleared if the event is reopened.

### Corrective actions

On the **Corrective actions** tab, type an action and press Enter, or select **Add action** for the full form (owner, due date, priority). Actions are filed under **Safety** in the action tracker and also appear there and in **My actions**.

### Hazards of an event

On the **Hazards** tab, select **Link a hazard**, choose the **Hazard** and select **Link**. Select **Remove** to take a link off. The hazard's **Safety events** tab lists the events linked to it (restricted ones only for people who may see them).

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

Open **Safety indicators**. Each indicator is worked out month by month from the safety events.

### Add an indicator

1. Select **New indicator**.
2. Enter the **Name**, for example "Collisions per 100,000 vehicle-miles", and a **Description**.
3. Choose which events count: **Event types counted**, **Severities counted** and **Modes counted** (by the event's vehicle or service). Leave a choice empty to count all.
4. Choose the **Measure**: **Number of events in the month**, or **Rate: events per amount of exposure**. For a rate, choose what it is **Per** (**Vehicle-miles**, **Vehicle-hours** or **Boardings**) and **Per how many** (for example 100,000).
5. Choose whether the **Target is** **At most (lower is better)** or **At least (higher is better)**, and enter the **Target**.
6. Leave **Shown on the safety dashboard** checked to show it there.
7. Select **Add indicator**.

### The indicator page

The tiles show the **Latest** value and the **Target**. The **Trend** tab shows the indicator for the last 6, 12 or 24 months with the target as a dashed line, and a table of each month's events, exposure, value and whether it was **On target** or **Off target**. A month without exposure has no rate: select **Enter** to record it. Select **Edit** to change the indicator; the **History** tab lists every change.

Indicators count every safety event, restricted or not, so everyone who may see an indicator sees the same figures. The events behind a figure are listed only for people who may open them.

## Exposure

Open the **Exposure** tab to record each month's **Vehicle-miles**, **Vehicle-hours** and **Boardings**, for the **Whole operation** or for one mode. Select **Enter** (or **Edit**) beside a month, fill in the figures and select **Save**. Future months cannot be entered. When no figure is entered for the whole operation, a rate adds up the figures entered for each mode.

## Sample data

The `dev` sample profile loads an invented year of safety records: twelve hazards, about a hundred safety events across the sample fleet and services (some with corrective actions), a year of exposure and five indicators.

## Not available yet

- Notifying an outside safety regulator; use a security incident's notification clocks if one is needed.
