# Dashboards and reports

You can build your own reports and dashboards without help from a developer: choose what to report on, pick the columns or groups you want, and see the answer straight away. Everything is under the **Reports** group: **Dashboards**, **Reports**, **Report packs**, **Schedules** and **Delivered to me**.

Two rules run through all of it. **Everyone who may see a figure sees the same figure**: counts, totals, charts, pivot tables, numbers and gauges include every record, restricted ones too, so two people never read different numbers for the same thing. **Records themselves are shown only to people allowed to open them**: a list of records, the records behind a figure and the rows of a **List** report show only what you may see, and when a summary is grouped by words or people (such as a title, a department or an owner) restricted records are counted under **Restricted records** instead, for everyone. Sharing a report or dashboard shares the *design*, never the records. Someone without access to security incidents sees a dashboard's incident widget say "Your role does not include this information" while the rest of the dashboard works as normal.

## Reports

Open **Reports** to see the saved reports you can use: your own, those shared with you, and the standard reports that come with the application. Select a report to run it. The figures are as at the moment you open it; select **Refresh the figures** under the **More** button (three dots) to work them out again.

On an open report you can:

- **Export**: **PDF** downloads a PDF with the title, the report's filters, the time it was made, a chart (bars, a line or a pie, as the report is drawn) and the table, which continues over as many pages as it needs with its header row repeated; **Excel (XLSX)** downloads a spreadsheet with dates, numbers and amounts as real typed cells; **CSV** downloads every row as plain text; **Print-ready page** opens a page you can print or save as a PDF from the browser's Print command. The PDF uses standard fonts that cover Western European letters only: other characters print as `?`, so use Excel or CSV for text in other scripts. Exports need the reports export permission and export permission for the records in the report. Every export is written to the audit log, and an export that lists restricted records carries a "Restricted export by …" line (a summary does not: it shows none of their details).
- **Schedule**: send the report to people regularly (see [Scheduled delivery](#scheduled-delivery)).
- **Add to dashboard**: place the report on a dashboard you can change, or on a new one.
- **Share** and **Edit**: only for the report's owner (and administrators). Anyone else can select **Save a copy** under **More** to make their own version.
- Select the count under the report ("21 tickets") or any figure in the table to open the list of records behind it.

### Build a report

1. Select **New report** on the **Reports** page, or **Create** then **Report**.
2. **Choose what the report is about.** Each kind of record is listed with a one-line description, for example **Tickets** ("Requests and faults raised with the service desk") or **Assets**. You can only choose kinds of record your role lets you see. Type in the search box to narrow the list.
3. The builder opens in three panes:
   - **1 · What it is about** (left): every field you can use, with its kind (text, choice, date, money and so on). Fields of linked records are listed under "From …", for example **From vendor**, and fields your organisation added are under **Added by your organisation**. Select a field to add it; select the funnel beside it to filter by it.
   - **2 · Shape it** (middle): the columns or groups, totals, filters, order and the chart.
   - **Preview** (right): the answer, updated a moment after every change. It shows what *your* role allows; other people see what theirs allows.
4. Choose **List** (one row for each record) or **Summary** (counts and totals, grouped).
5. Select **Save report**, give it a **Name** and a **Description**, choose **Who can see it**, and select **Save**.

**Undo** and **Redo** (or Ctrl+Z and Ctrl+Y) step back and forward through every change. Select **Change** in the first pane to report on something else; **Undo** brings the old report back.

### Lists

Under **Columns**, the chosen fields are listed in the order they will appear. Use the arrows to move a column up or down and the cross to remove it, or pick one from **Add a column…**. With no columns chosen, a standard set is shown.

### Summaries

- **Group**: choose a field under **Group by**, and optionally a second one under **Then by**. Records with the same value are counted together. A date field can be grouped **by day**, **by week**, **by month**, **by quarter** or **by year**, always in the organisation's time zone. With two groups, **Show as a pivot table** puts the first field down the side and the second across the top, with totals.
- **Totals**: **Count of records**, **Total of**, **Average of**, **Lowest (or earliest)**, **Highest (or latest)** or **Share of total (%)**. Select **Add another total** for more than one.

### Filters

Select **Add a condition**, choose a field, then a comparison in plain words and a value. The comparison suits the field:

- text: **contains**, **does not contain**, **is exactly**, **starts with**;
- numbers and money: **is at least**, **is at most**, **is more than**, **is less than**, **is between** and so on;
- dates: **in the last … days**, **in the next … days**, **this month**, **this quarter**, **this year**, **before today**, **after today**, **on or after**, **on or before**, **between**;
- choices: **is any of**, **is none of**; people: **is me**, **is**, **is not**, **is nobody**; yes/no fields: **is yes**, **is no**;
- every field: **is empty** / **is not empty** (or **has no date** / **has a date**).

With two or more conditions, choose whether records must match **all of these** or **any of these**. **Add a group** adds a set of conditions with the opposite rule, for "A and (B or C)". A condition that still needs a value is left out of the preview until it has one.

### Order and charts

Under **Order**, choose what to **Sort by** and the direction.

Under **Show as**, pick how the result is drawn: **Table**, **Number**, **Gauge** (a figure against a **Target**, with a **Full scale**), **Bars**, **Ranked bars**, **Stacked bars**, **Line**, **Area**, **Doughnut**, **Pie**, **Heat map** or **Calendar**. Charts that do not suit the report are greyed out; hover over one to see why (for example, a heat map needs two fields to group by). When the report has several totals, **Figure to draw** chooses which one the chart shows; the table keeps them all.

Every bar, slice, point, cell and figure can be selected to open the list of records behind it, with the matching filters in the address, so you can bookmark or send it. When a filter has no equivalent on the list page, the report says the list uses the closest filters it can.

### Standard reports

The application comes with these reports, shared with everyone (each shows only what the viewer may see, and says so plainly when a part of the application is not switched on):

| Report | Shows |
|---|---|
| Open tickets by assignee and priority | A pivot table of who is carrying what |
| Tickets opened each month | Volume over the last year |
| Tickets that missed their target | Every ticket past its response or resolution time |
| Tickets by requesting department | Where demand comes from, with each department's share |
| Overdue actions | Agreed actions past their due date |
| Assets by site and type | A pivot table of every kind of asset at every site |
| Asset purchase cost by funding source | What was spent, and from which source |
| On-vehicle equipment past its support date | Onboard computers, fare equipment, validators, routers, cameras, radios and displays still in service after support ends |
| Depot equipment by type and support end year | Equipment at sites whose name includes "depot" |
| Systems by criticality and hosting | How the most important systems are hosted |
| Critical systems without recovery targets | Tier 1 and tier 2 systems with no recovery time or recovery point objective |
| Contracts with a notice date in the next year | Agreements to decide on |
| Contract value by vendor | Total value of agreements with each vendor |
| Framework outcomes by function and status | Progress against the cybersecurity framework |
| High and critical risks | The risks that most need attention |
| Security incidents by severity and status | Every recorded incident |
| Open vulnerabilities by severity | What is still open, with how old the oldest is |
| Project budget and spend by stage | Money committed and spent at each stage |
| Changes by month and type | How much change the organisation is making |

## Dashboards

Open **Dashboards** to see the dashboards you can use, with a small drawing of each layout. **Your home** marks the one you chose as home.

Seven standard dashboards come with the application: **IT leadership overview**, **Service desk**, **Cybersecurity programme**, **Assets and systems**, **Vendors and contracts**, **Project portfolio** and **Board summary** (one page in plain language, where each line is a sentence such as "21 requests and faults are open with the IT team" with an arrow comparing the last 30 days with the 30 days before). A widget whose part of the application is not switched on says so in its place.

### Looking at a dashboard

- **Filters** across the top narrow every widget at once: **Dates** (with **30 days**, **90 days** and **This year** shortcuts), **Department**, **Site**, **System** and **Owner** (select **Me** for yourself), depending on the dashboard. A widget whose records have no such field shows "Not narrowed by …". The filters are kept in the page address, so a filtered dashboard can be bookmarked or sent, and the list behind any figure carries them on. **Clear filters** removes them.
- Select any figure, bar, slice, cell or calendar day to open the records behind it.
- **Refresh** works the figures out again. A dashboard can also refresh itself (see **Settings** below); the time the figures were worked out is shown under the widgets.
- **Wall mode** fills the screen for a display on the wall: larger text, no menus, and the figures refresh at least every 5 minutes. Press Esc or **Leave wall mode** to go back.
- Under **More** (three dots): **Set as my home dashboard** (or **Stop using as my home**), **Share…**, **Schedule…**, **Print this page**, **Save a copy** and **Delete**.
- **Export** (needs the dashboards export permission; leaves out any widget about records you may not export): **PDF** (each group of widgets that shares rows of the dashboard and holds a chart or table starts a new page; figures and text run on together), **Excel (XLSX)** (one sheet per widget with figures) or **Print-ready page**.

Your home dashboard is your own choice and does not change anyone else's. If it is later deleted or no longer shared with you, the choice quietly stops applying.

### Build or change a dashboard

1. Select **New dashboard** (or **Create** then **Dashboard**), enter a **Name** and select **Create and add widgets**. It starts empty and private to you. To change an existing dashboard, open it and select **Edit** (only its owner and administrators can; anyone else can **Save a copy**).
2. Select **Add a widget**. Build a new one (**Number**, **Chart**, **Gauge**, **Progress toward a target**, **Table**, **List of records**, **Countdown clock**, **Calendar** or **Text**) or pick one of the saved reports under **Or use a saved report**.
3. The widget editor opens at the side. Choose the **Records**, then the groups, totals, columns, filters and chart, depending on the kind of widget:
   - **Number**: one figure. Switch on **Show a trend arrow** to compare the latest period with the one before (choose **Counted by**, **Days in each period** and whether **More is good news**). **Say it in a sentence** turns the figure into a sentence: write `{value}` where the figure goes.
   - **Gauge** and **Progress toward a target**: under **Out of**, measure against **All …** (shows a percentage) or **A target figure**.
   - **Countdown clock**: **A date I choose**, or **The next dates on records** (choose the **Date to use**).
   - **Calendar**: a month with the number of records on each day; use the arrows to change month.
   - **Text**: a heading, note or instructions. Start a line with `#` for a heading or `-` for a bullet; use `**bold**`, `*italic*` and `[words](/tickets)` for a link. Text is never run as code.
   - **Saved report**: the report as it is now, drawn the way the report says.
4. Select **Done**.
5. **Move** a widget by dragging its handle (the three lines beside its title), and **resize** it by dragging its bottom-right corner. Other widgets move out of the way. With the keyboard, Tab to a widget's handle and use the arrow keys to move it, or Shift and the arrow keys to make it wider, narrower, taller or shorter.
6. Each widget has buttons to change it, duplicate it and remove it.
7. **Settings** sets the **Name**, **Description**, the **Filters across the whole dashboard** and how often to **Refresh the figures**.
8. **Undo** and **Redo** work as in the report builder. Select **Save** to keep your changes, or **Cancel** to leave them (you are asked first if you changed anything).

A saved report placed on a dashboard runs only for people the report is shared with; everyone else sees "This report has been removed or is not shared with you" in its place. You can only place reports you can see yourself.

## Sharing

Reports, dashboards and report packs each have **Who can see it**: **Only me**, **People in chosen roles** or **Everyone who can view** reports (or dashboards). Sharing lets people open and use the item; only its owner and administrators can change or delete it. Standard items belong to nobody and can be changed by anyone allowed to edit reports or dashboards.

## Report packs

A report pack is a document for a governing body or an auditor: a cover page followed by an ordered set of saved reports and text sections. Open **Report packs**. The **Governing body security pack** comes with the application (a summary to write, framework progress, top risks, overdue actions and incidents).

- Open a pack to see it as it will print: the cover page with the title, subtitle, "Figures as at" and "Prepared by", a contents list, then one section per page.
- **Print** prints the page from the browser (each section starts on a new sheet). **Download** (needs the reports export permission) offers **PDF** (a cover page, then one section per page, with page numbers), **Excel (XLSX)** (one sheet per report) or **Print-ready page**, which opens the same pack as a separate page.
- **Produce dated copy** (needs the reports export permission) freezes the figures as they are now and keeps the copy under **Produced documents**, so it can be opened again later. Anyone who can see the pack and every saved report in it, and can see every kind of record in it, can read the copy in the application; a copy that lists restricted records needs security access too.
- **Edit sections** (under **More**, or the button beside the preview): change the **Name**, **Cover title**, **Cover subtitle** and **Description**; add sections with **Add a saved report** or **Add text**; give each a **Heading**; move them with the arrows and remove them with the cross. Select **Save**.

To start a new pack, select **New report pack** on the **Report packs** page, or **Create** then **Report pack**.

## Scheduled delivery

Select **Schedule** on a report (or **Schedule…** on a dashboard) to send it regularly.

1. Enter a **Name**.
2. Choose **How often** (**Every day**, **Every week** **On** a weekday, or **Every month** on a **Day of the month**: in shorter months, the last day) and **At** what hour, in the organisation's time zone.
3. Choose **As**: **Document (print or save as PDF)**, **PDF file**, **Excel file (XLSX)** or, for a report, **Spreadsheet file (CSV)**. Anyone whose role may not export receives the document instead of a file. When an administrator has switched email on, each person is also emailed a link to their copy, with the PDF or Excel file attached when they may export it; the attachment is recorded in the audit log. Without email, delivery is in the application only.
4. Under **Send to**, add people with **Add a person…** and whole roles with **Everyone in a role…**.
5. Select **Schedule**.

At each delivery, every recipient gets a notification in the application with a link to a copy frozen at that moment, worked out from **their own** permissions, and listed under **Delivered to me**. A recipient is skipped (and the reason logged) when their role cannot view reports or dashboards or the records in them, or the report or dashboard is not shared with them. Email delivery is not available yet.

**Schedules** lists every schedule you own. Select one to see its **Deliveries** (who received it, when, and any reason it was skipped), and to **Edit**, **Send now** or **Delete** it.

**Delivered to me** lists every copy delivered to you or produced by you. Select one to read it in the application. A copy opens only while you can still see the report, dashboard or pack it was made from and every saved report in it. A PDF or Excel copy is only offered as a file to download. Taking a copy out of the application, with **Download PDF**, **Download Excel file**, **Download CSV** or **Download to print or save as PDF**, needs the reports (or dashboards) export permission and is recorded in the audit log.

## Permissions

| Permission | Allows |
|---|---|
| Reports: view | Open and run reports and packs shared with you; use the report builder's preview; receive and read delivered copies |
| Reports: create | Build and save reports and packs, schedule them |
| Reports: edit / delete | Change or delete reports, packs and schedules you own |
| Reports: export | PDF, Excel, CSV and print-ready exports of reports and packs, producing pack copies, downloading delivered copies |
| Dashboards: view | Open dashboards shared with you and choose a home dashboard |
| Dashboards: create / edit / delete | Build, change or delete dashboards you own |
| Dashboards: export | PDF, Excel and print-ready dashboard exports; downloading delivered dashboard copies |
