# Strategy and statistics

A transit organization's board adopts a **strategic plan** for several years: goals, the objectives under each goal, the measures that show whether an objective is being met, and the initiatives that deliver it. Each quarter, the people who own the objectives report how they are doing. Alongside the plan, the organization counts **operating statistics** (passenger trips, revenue miles and hours, vehicles in service, incidents per 100,000 miles) and sends periodic **statistical reports** to outside bodies.

Open it from **Governance and records > Strategy** in the navigation, with the tabs **Plan**, **Scorecard**, **Measures**, **Statistics**, **Submissions** and **Settings**. Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not use it, an administrator can switch **Strategy and performance** off under **Administration > Features** (see [Administration](09-administration.md#features)). The pages, the Overview panel, the reminders, the metrics and the My work items then disappear everywhere. Nothing is deleted: everything returns when the part is switched back on.

Nothing about an outside body is built in: you name the reports you submit, who receives them and when they are due, and you define the statistics you keep.

## What you need

The area uses the **strategy** permissions: `strategy.view` to read plans, measures, statistics and submissions; `strategy.create`, `strategy.edit` and `strategy.delete` to add, change and delete them; `strategy.export` for exports and the board PDF; and `strategy.administer` to define statistics series and change the settings.

Two default roles cover it, both switched off until an administrator enables them under **Administration > Roles**:

- **Strategy and performance analyst**: everything in the area, with reading projects, documents, committees and funding, the action tracker, and reports and dashboards.
- **Executive viewer**: reads the plan, the scorecard, the measures and the statistics among its other figures. Apply new grants to an existing role with **Sync default grants** on the Roles page.

## Strategic plans

On the **Plan** tab, select **New** (or **Create > Strategic plan**). A plan (`SP-` numbers) has:

| Field | What it holds |
|---|---|
| **Title** | The plan's name, for example "Strategic plan 2026 to 2030" |
| **Vision and summary** | What the plan sets out to achieve, in a few sentences |
| **Period from** and **to** | The first and last day the plan covers |
| **Status** | **Draft**, **Adopted**, **Superseded** or **Retired** |
| **Adopted on** | Filled in with today's date when you set the status to Adopted, unless you give it |
| **Board decision** | The decision of the board or committee that adopted it (see [Committees and meetings](28-committees-and-meetings.md)) |
| **Plan document** | The controlled document holding the plan as adopted (see [Document library](11-policies-and-exceptions.md)) |
| **Owner** | Who keeps the plan; you, unless you choose someone else |

A plan's page has the tabs **Goals**, **Objectives** and **By quarter**, and the buttons **Scorecard** and **Board PDF**.

### Goals and objectives

Add the plan's **goals** on its **Goals** tab, each with an optional **Code** (G1) and **Order**. Add the **objectives** under each goal, on the plan's **Objectives** tab or on the goal's page. An objective (`OBJ-` numbers) has a code, a title, a description, an owner, a department and a target date; it belongs to the plan of its goal.

An objective's **Status** is the status of its latest quarterly update: **On track**, **At risk** or **Off track**, with the quarter it was reported for (**Status as of**). It reads **Not reported** until the first update.

### Measures

A **measure** (`KPI-` numbers) is a key performance indicator of an objective. Add measures on the objective's **Measures** tab. A measure has:

| Field | What it holds |
|---|---|
| **Measure** and **Definition** | What is measured and how it is counted, so every period is counted the same way |
| **Unit** | For example %, trips, minutes or "per 100,000 miles" |
| **Better when** | **Higher is better**, **Lower is better**, or **Close to the target** |
| **Near the target within (%)** | How far from the target, as a percentage of the target, still counts as **Near target** (5 unless you change it) |
| **Frequency** | **Monthly**, **Quarterly** or **Yearly**: the periods of its targets and actuals |
| **Baseline** and **Baseline period** | Where the measure started, for example 81.5% in 2025 |
| **Data source** | **Entered by hand**, a **Metric** the application works out (for example overdue corrective actions or inspections done on time), or a **Figure over time** recorded under **Reports > Figures over time** (see [Dashboards and reports](15-dashboards-and-reports.md)) |
| **Owner** | Who keeps it current |

The measure's page has the tab **Targets and actuals**: one row for each period, with its **Target** and, once known, its **Actual**. Give the period after the measure's frequency (`2026-Q2`, `2026-05` or `2026`); a date inside the period works too. Each period has one row: enter next years' targets now and add the actual when the period is over. The row records who entered the actual and when, and compares it with the target: **Meets target**, **Near target** or **Misses target** (or **No target**). The chart shows targets and actuals over time.

A new measure is entered by hand. To take its actuals from a metric or a figure over time, open the measure and select **Data source…**, then choose the metric or the figure from the list (only those you may see are offered). Its actual is then filled in each day for the current and the previous period; **Take the current value** on its page does it at once. Targets are still entered by hand.

The **Measures** tab lists every measure with its latest actual and the target for that period. Filter by plan, objective or **Against target**.

### Initiatives

An **initiative** (`INI-` numbers) is a piece of work that delivers an objective. Add initiatives on the objective's **Initiatives** tab. An initiative has an owner, a **Stage** (**Planned**, **In progress**, **On hold**, **Completed** or **Canceled**), start and end dates, the **Project** that delivers it (see [Projects](08-projects.md)), and its budget: the **Budget line** when your installation keeps budget lines, or a **Budget reference** as your budget names it, and the **Budget** amount.

The initiative's **Actions** tab lists the actions raised for it, and **New** adds one to the action tracker with the source **Strategy** (see [Risks, actions and obligations](06-risks-actions-obligations.md)). Like an objective, an initiative takes its **Status** from its latest quarterly update.

### Quarterly status updates

Each quarter, report on each objective and initiative: open it, go to **Status updates** and select **Add a status update**. An update has:

- the **Quarter** (`2026-Q2`); left empty, the quarter of the report date;
- the **Status**: **On track**, **At risk** or **Off track**;
- the **Narrative**: what was done, what is in the way and what happens next;
- **Reported on**: today, unless you give another day.

The update records who reported it. Deleting the latest update brings back the status of the one before.

The plan's **By quarter** tab is the **action-item matrix**: every objective, with its initiatives under it, against the quarters of the plan, each cell showing that quarter's status. Point at a cell to read its narrative. Select **+** in an empty cell to report that quarter. **Quarters shown** picks one year; by default the matrix shows the plan so far (at most 12 quarters).

## Scorecard and board PDF

The **Scorecard** tab shows one plan (choose it under **Plan**; an adopted plan comes first): the number of objectives on track, at risk and off track and of measures meeting their target; then each goal with its objectives, each with its status, its latest narrative, its measures (baseline, the latest period's target and actual, and how they compare) and its initiatives; then the status of each by quarter.

**Board PDF** (on the scorecard or the plan's page; needs `strategy.export`) makes the same scorecard as a PDF for a board pack: a cover page with the organization's name and logo, the summary figures, each goal and objective with its measures and initiatives, and the status by quarter for the latest six quarters. It is tagged for screen readers (PDF/UA). Making it is recorded in the plan's history.

### Measures in dashboards and report packs

Strategic plans, goals, objectives, measures, measure values, initiatives, status updates, statistics and submissions are record types like any other, so the report builder, dashboards and report packs can use them (see [Dashboards and reports](15-dashboards-and-reports.md)). The installation adds:

- the saved report **Strategic plan measures**: every measure with its latest actual, target and how it compares; add it to a report pack for the board;
- the dashboard **Strategy and performance**: objectives off track and at risk, measures missing their target, statistical reports overdue, objectives by status, measures against target, initiatives by stage, and the reports coming due.

A chart of one measure over time is a dashboard chart of **Measure values** filtered to that measure, grouped by period.

### Metrics

The area offers these metrics to computed indicators, key risk indicators and figures over time: **Strategic objectives off track**, **Strategic objectives at risk** (objectives of adopted plans by their latest update at the end of the month), **Statistical reports overdue**, and **Strategic measures meeting target** (a percentage). Like every figure, they count every record and are the same for everyone.

## Operating statistics

The **Statistics** tab shows the statistics your organization counts. An administrator of the area defines each **statistics series** under **Settings**:

| Field | What it holds |
|---|---|
| **Code** and **Name** | For example `UPT`, "Unlinked passenger trips" |
| **Definition** | How it is counted |
| **Unit** | For example trips, miles, hours, vehicles, "per 100,000 miles" |
| **Frequency** | **Monthly**, **Quarterly** or **Yearly** |
| **Broken down by** and **Breakdown values** | What splits the statistic (for example Mode) and its values, one per line (Bus, Light rail, Paratransit). Leave them empty for a single total |
| **Decimal places**, **Active**, **Owner**, **Order** | How values are shown, whether the series is offered, who keeps it, and its place in the list |

Once values have been entered, a series' frequency cannot change: define a new series instead.

On the **Statistics** tab, choose the **Series** to see its chart (one line or bar for each breakdown) and its **Values**. **New** enters a value: the **Period** (`2026-05`, `2026-Q2` or `2026`, or any date inside it), the **Breakdown** (one of the series' values, or empty for the total) and the **Value**, with an optional note. Each period and breakdown has one value; change the existing one rather than adding another. Each value records who entered it and when.

To load many values at once, use **Import** on the values list with a CSV or Excel file with the columns Series (its name), Period, Breakdown and Value (see [Importing and exporting](17-importing-and-exporting.md)). The values go through the same checks as values entered by hand.

## Statistical submissions

The **Submissions** tab is the log of periodic statistical reports your organization submits to outside bodies. Select **New** (or **Create > Statistical submission**). A submission (`SUB-` numbers) has:

| Field | What it holds |
|---|---|
| **Report** | The report's name, as the body that receives it names it |
| **Submitted to** | The outside body |
| **Period covered** | For example 2026-Q1 |
| **Due** | When it is due |
| **Prepared by** | Who prepares it and is reminded; you, unless you choose someone else |
| **Status** | **Planned**, **In preparation**, **Submitted**, **Accepted** or **Returned for correction** |
| **Submitted on** and **Submitted by** | Filled in with today and you when you set the status to Submitted, unless you give them |
| **Confirmation** | The confirmation number or receipt the body gave |

Keep the report as sent and the body's confirmation on the record's **Evidence files** tab.

The person preparing a report is reminded 30 days, 7 days and on the day before it is due (change the steps under **Settings**), once per step, until it is submitted. Reports due appear in their **My work** and on the compliance calendar (see [Calendar feeds](36-calendar-feeds-work-trackers-and-evidence-links.md)). The tab's figures show how many are overdue, due soon (within 30 days unless changed under **Settings**) and not yet submitted.

## Settings

**Settings** (needs `strategy.administer`) holds the statistics series and the reminders: the days before the due date on which the preparer of a statistical report is reminded, and how many days ahead counts as **due soon** for the figures on the Overview and the Submissions tab.

## The Overview

The **Strategy and performance** panel on the Overview (add it with **Customize**) shows objectives off track and at risk, measures missing their target, and statistical reports overdue and due soon, each linked to its list.

## Loading earlier plans and statistics

In data load mode (see [Administration](09-administration.md)), an administrator can load past plans, quarterly updates, measure values, statistics and submissions with their own dates and the people named: the **Reported on** of an update, the **Submitted on** of a submission and the creation date are kept as given, an adopted plan without an adoption date stays without one, and a load that names a person (`on_behalf_of`) records them as the person who reported an update or entered a value. Nothing is sent during a load.
