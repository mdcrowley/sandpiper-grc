# Civil rights programs

Transit organizations keep programs that protect riders and workers from discrimination and make service accessible: a nondiscrimination program, an accessible service program, a program for the participation of small and disadvantaged businesses in contracts, an equal employment opportunity program, a language assistance plan. Each has required parts, is updated on a cycle, is reported on, and comes with complaints that must be answered within set times. The **Civil rights** area keeps all of this in one place.

Nothing in it is any one jurisdiction's law. Program types, the required elements of a program, report types, the bases of complaints and the complaint time limits are your organization's own: lists you edit under **Administration > Lists**, templates you write, and settings under **Civil rights > Settings**. A new installation's examples (labeled as such) are starting points to change.

Open it from **Governance and records > Civil rights** in the navigation, with the tabs **Programs**, **Complaints**, **Reports**, **Participation**, **Awards**, **Templates** and **Settings**. Lists and record pages work as described in [Getting started](01-getting-started.md).

The area is **off** when the application is installed, because it holds confidential complaints and an organization should choose to keep them here. An administrator switches **Civil rights** on under **Administration > Features** (see [Administration](09-administration.md#features)). While it is off, its pages, menu entry, lists, reminders, My work items, figures and the **Civil rights officer** role appear nowhere; nothing is deleted.

Eligibility for accessible services (for example paratransit eligibility decisions, which hold people's medical details) is not part of this area.

## What you need

The area uses the **civilrights** permissions: `civilrights.view` to read programs, reports, goals and the figures; `civilrights.create`, `civilrights.edit` and `civilrights.delete` to add, change and delete; `civilrights.export` to export lists and a goal's report data; and `civilrights.administer` to change the settings, name the complaint handlers and change whether a complaint is confidential.

The **Civil rights officer** role (switched off until an administrator enables it under **Administration > Roles**) holds all of these, and reading vendors, contracts, vehicles and services, sites, people, documents and committees, so its holder can link them.

Seeing a confidential complaint needs more than the permission: see [Who sees a complaint](#who-sees-a-complaint).

## Programs

Select **Civil rights**, then **New** (or **Create > Civil rights program**). A program (`CRP-` numbers) has:

| Field | What it holds |
|---|---|
| **Name** | "Nondiscrimination program" |
| **Program type** | Your own list (**Civil rights program type**) |
| **Status** | Draft, Adopted, Update due or Retired (your own list) |
| **Owner** | The person who keeps it current and is reminded of its updates and reports |
| **Made from template** | A [program template](#program-templates): its required elements and reports are copied into the new program |
| **Program document** | The controlled document that sets out the program (see [Document library](11-policies-and-exceptions.md)) |
| **Board decision** | The decision of the board or committee that adopted or approved it, while committees are on (see [Committees and meetings](28-committees-and-meetings.md)) |
| **Adopted on**, **Update cycle (months)**, **Last updated on** | When it was adopted, how often it is updated, and when it last was |
| **Next update due** | Worked out from the last update (or the adoption) and the cycle when you leave it empty |

The list page shows the area's figures above the list: programs, updates overdue, reports overdue and due within 30 days, open and overdue complaints, and the current participation goal against its attainment. These figures are the same for everyone who may see the area.

A program's page has these tabs:

- **Required elements**: the checklist of what the program must contain, each with a status (**Not yet in place**, **In progress**, **In place**, **Needs attention**, **Not applicable**), an optional due date, and when and by whom it was last checked. While the [evidence library](43-evidence-library.md) is on (and you may view it), select **Evidence** on an element to link the evidence that shows it is in place (a signed policy statement, the public notice, the board minutes), or upload a file into the library from there.
- **Public notices**: where the public can read its rights and how to complain (a site, a bus interior, a web page), with the languages and the day each was last checked.
- **Language assistance**: the items of the language assistance plan (translated documents, interpreting services), each with its language and status.
- **Reports**: the program's [monitoring reports](#monitoring-reports).
- **Complaints**: the complaints filed under the program that you may see.

## Program templates

A template (`CRT-`) is your own description of what one kind of program contains. Under **Civil rights > Templates**, give it a name, a program type, an update cycle, the **Required elements** (one per line) and the **Monitoring reports**, one per line as `Name | months between reports` (for example `Program update | 36`; leave out the months for a one-off report).

When a program is made from a template, each element becomes a line of its **Required elements** and each report becomes a planned report, first due that many months after the program's adoption (or after today). Changing a template later does not change programs already made from it.

## Monitoring reports

A report (`CRR-`) has a title, a program, a **Report type** (your own list), the **Period** it covers, a **Due on** date, an owner, who it is **Sent to**, and **Repeats every (months)** for a report that comes back on a cycle.

When a report is sent, open it and select **Record a submission**: give the day it was sent, who it went to, a reference and a note. Each submission is added to the report's **Submission log** with the person who recorded it, the report becomes **Submitted**, and for a repeating report the next one is planned (due that many months after this one's due date). A report returned for changes can be submitted again; the log keeps every time it was sent.

The report's owner is reminded once before it is due and once when it is overdue, and open reports appear in the owner's **My work** and calendar feed.

## Complaints

Select **Complaints**, then **New** (or **Create > Civil rights complaint**). A complaint (`CRC-`) has:

| Field | What it holds |
|---|---|
| **Subject** | A short title for lists, never the complainant's name ("Ramp not deployed at a stop") |
| **Received on** and **Received by** | The day it arrived (today when left empty) and how: in person, phone, email, letter, web form, referral (your own list) |
| **Anonymous** | The complainant did not give a name: no name or contact is kept |
| **Complainant**, **Complainant contact**, **Language or format needed** | Who complained and how to reach them, and the language or accessible format their letters need |
| **Basis** | What the complaint says the treatment was based on (your own list, **Civil rights complaint basis**) |
| **Program** | The program the complaint falls under |
| **Route or service**, **Vehicle**, **Site**, **Employee involved**, **Happened on** | What it is about, linked to the records of the fleet, sites and people areas while they are on |
| **What happened** | The complainant's account |
| **Investigator** | The person who investigates; they always see the complaint |
| **Confidential** | On by default: see [Who sees a complaint](#who-sees-a-complaint) |

### Time limits

Three time limits are worked out from the dates, using the days set under **Settings**:

- **Acknowledge by**: the day received plus the acknowledgment days (10 as installed).
- **Investigation due**: the day received plus the investigation days (90 as installed).
- **Appeal decision due**: the day an appeal is received plus the appeal days (30 as installed).

The list's **Next due** column shows the next limit still open (red once it has passed); the complaint's **Time limits** tab shows each limit as **Open**, **Due soon**, **Overdue**, **Met**, **Met late** or **Stopped** (closed). These defaults are only a starting point: set the limits of your own procedure. A change applies to complaints received from then on.

Moving the status fills in the dates it means: **Acknowledged** sets **Acknowledged on**, **Findings issued** needs the findings and sets **Findings issued on**, **Appealed** sets **Appeal received on**, **Closed** needs an **Outcome**, and **Closed** or **Withdrawn** set **Closed on**. You can also type the dates yourself.

### Steps and letters

The **Steps and letters** tab keeps the **Investigation steps** (interviews, records to review, site visits), each with a due date and the day it was done (and by whom), and the **Letters sent** to the complainant with the day each was sent. Attach the letters themselves on the complaint's **Files** tab.

The investigator's **My work**, the compliance calendar and their calendar feed list the complaint's next time limit and its open steps. The investigator (or, when there is none, the complaint handlers) is reminded once before a limit and once when it has passed; reminders name only the complaint's reference.

### Findings, outcome and appeal

The **Findings and outcome** tab holds the findings and the day they were issued, the **Outcome** (your own list: substantiated, not substantiated, resolved informally, referred, withdrawn), the day it closed, and the appeal: when it was received, when its decision is due, the decision and when it was made.

### Who sees a complaint

A **confidential** complaint (the default) is seen only by:

- the people an administrator names as **complaint handlers** under **Civil rights > Settings**;
- its **investigator**; and
- the person who **entered** it.

Everyone else who may see the area sees the **counts** (open, overdue, received this year, and the figures of dashboards and indicators) but never the complaint itself: it is left out of lists, search, links, exports, reports and the AI assistant, and opening its address says it is not found. Only the handlers and people with `civilrights.administer` can change whether a complaint is confidential. A complaint that names no one (a general complaint about a service change) can be marked not confidential, so that everyone who may see the area can read it.

### Personal data and retention

The complainant's name, contact and language, the employee involved, the account of what happened, the findings, the appeal decision and the notes of steps are personal data. Set how long complaints are kept under **Administration > Retention**, following your [records retention schedule](42-records-retention-schedule.md); at the end of the period a complaint can be anonymized, which also blanks the notes of its steps and letters. A complaint under a [legal hold](33-legal-holds.md) cannot be deleted or anonymized.

## Participation goals

Under **Participation**, a **participation goal** (`CRG-`) is set for each period: its **Period** (in your own words) with its start and end, the **Goal (%)** (the share of the period's award amounts expected to go to certified firms), **How the goal was set**, its status and owner.

**Awards** (`CRA-`) are the contracts and awards that count toward a goal: a title, the goal, the **Contract** and **Prime contractor** (from the vendor register while it is on), the day awarded and the **Award amount**. On an award's **Participating firms** tab, add each firm taking part: a vendor or a firm's name, whether it is a **Certified firm**, its role and the amount.

A goal's page shows its **Attainment**: the award total, the amounts to participating firms and to certified firms, the share attained, and the shortfall when it is below the goal. The **Shortfall and good faith** tab holds the **Shortfall analysis** and the **Good-faith efforts** made. **Report data (CSV)** downloads the period's data: each award with its firms, then the period's figures, for the report your organization sends. The **Participation** tab also lists the attainment of every period.

Which firms count as certified, and how a goal is set, are up to your organization.

## Settings

**Civil rights > Settings** holds:

- **Complaint time limits**: the days to acknowledge, to finish an investigation and to decide an appeal, and how many days ahead reminders are sent (7 as installed). Changing them needs `civilrights.administer`.
- **Complaint handlers**: the people who see every confidential complaint. Each must be active and able to see civil rights; adding someone asks you to confirm your password. Name as few people as you can.

## Figures, dashboards and indicators

Three figures are offered to computed indicators (see [Dashboards and reports](15-dashboards-and-reports.md)): **Civil rights complaints open**, **Civil rights complaints overdue** (open at the end of the month and past their acknowledgment or investigation limit) and **Business participation goal attainment** (for the goals whose period includes the end of the month). The Overview can show a **Civil rights** panel with the same figures. Confidential complaints are counted in every figure, whoever looks.

## Loading past records

In [data load mode](09-administration.md) an administrator can load past complaints with their own dates, statuses and references, and the people who handled them: the time limits are worked out from the dates given, the status rules above are skipped, and steps, letters and report submissions record the person the load names. Nothing is sent while loading. A program loaded from a template does not get the template's elements and reports copied: load them as well.
