# Audits and inspections

These pages plan and run **internal audits** (internal audits, safety reviews, compliance pre-reviews and cybersecurity control audits) and **recurring inspections** of stations, depots, vehicles and equipment. Open them from the navigation: **Governance > Audits** (the plan and coverage, with tabs **Plan and coverage**, **Audits**, **Audit universe**, **Findings**, **Evidence requests** and **Checklists**), **Governance > Audit findings** and **Safety > Inspections** (with tabs **Inspections**, **Schedules** and **Checklists**). Lists and record pages work as described in [Getting started](01-getting-started.md).

Findings from audits and inspections raise [corrective action plans](24-corrective-action-plans.md) and, for safety concerns, hazards in the [hazard log](20-safety-management.md#hazard-log).

If your organization does not use them, an administrator can switch **Audits and inspections** off under **Administration > Features** (see [Administration](09-administration.md#features)). The pages, the inspection schedules and reminders then stop, and nothing about them is shown elsewhere. Records are kept and return when it is switched back on.

## Permissions and roles

You need the **audits** permissions: `audits.view` to see the pages, `audits.create` and `audits.edit` to plan audits, answer checklists and record findings, `audits.delete`, `audits.export` for the audit report PDF and list exports, `audits.approve` to approve audit reports, and `audits.administer` to run the inspection work by hand. Raising a corrective action plan from a finding also needs `actions.create`; adding a hazard needs `safety.create`.

The default roles:

- **Audit lead** holds all of the audits permissions, the action tracker and controls, and can read committees, obligations, policies and frameworks.
- **Safety manager** holds all of the audits permissions, so a safety team can run inspections and safety reviews.
- **Security lead**, **Compliance officer** and **Auditor** can read audits; the **Auditor** can also export them.

Audits flagged **Restricted** (for example a cybersecurity control audit) need `security.view` as well, and so do their findings and evidence requests. Counts on the dashboard include restricted audits for everyone; in the coverage grid someone who may not see one sees "Restricted audit" with its status only.

## Plan and coverage

Open **Governance > Audits**. The tiles show:

- **Audits planned** for this year (and how many are closed), **Audits under way** (in fieldwork or reporting).
- **Areas overdue for audit**, with how many are due within 90 days and how many were never audited.
- **Open findings**, and how many are past their response date.
- **Inspections due in 30 days** and how many are overdue; **Inspections on time** over the last 90 days, with how many were missed or failed.
- **Evidence requests open**, and how many are overdue.

**Coverage of the audit universe** lists each area with its cycle, its state (**Overdue**, **Due soon**, **On cycle** or **Never audited**), its next due date, and its audits in each of the last three years and next year's plan. Choose **Last 5 years** or **This year** to change the span. This answers "which parts of the safety plan were audited in the last three years?".

Below are **Inspections in the last six months** (done on time, done late and missed each month), **Open findings by rating**, **Next inspections** and **Audits under way and planned**. Select a tile, a bar or an entry to open the records behind it.

## The audit universe

Open the **Audit universe** tab. Each **audit area** is something that needs auditing: a **Safety plan element**, a **Process**, a **Department**, a **System** or a **Site** (the **Category** list can be changed under **Administration > Lists**). For each, record:

- **Audit every (months)**: the cycle, from 1 to 120 months.
- **Next audit due**, the **Owner** and the **Risk level** (high, medium or low).
- **In the plan**: clear it for an area that no longer needs auditing; it leaves the coverage grid.

**Last audited** is filled in by itself when an audit of the area closes (the end of its fieldwork), and **Next audit due** then moves on by the cycle. Changing the cycle also moves the next due date on from the last audit.

## Audits

Open the **Audits** tab, then **New audit engagement** (or **Plan an audit** on the plan, or **Create > Audit**). Enter a **Title**, the **Type** (**Internal audit**, **Safety review**, **Compliance pre-review** or **Cybersecurity control audit**), the **Audit area**, the **Plan year**, the **Scope** and **Criteria** (what the audit checks against, such as your own procedure), the **Checklist** to use, the **Lead auditor**, the **Auditee** and the planned dates. Tick **Restricted** for an audit only people who may see restricted records should open, then select **Create audit engagement**. The audit gets a reference such as `AUD-00004`.

An audit moves through **Planned**, **Fieldwork**, **Reporting** and **Closed** (or **Canceled**), shown along the top of its page:

1. **Start fieldwork** records the fieldwork start date if none is set.
2. **Move to reporting** records the fieldwork end date if none is set.
3. **Close the audit** opens the **Approval** tab (see [Closing an audit](#closing-an-audit)).

Above the tabs, the **Scope** card holds the audit's details (select **Edit** to change them), and the **Audit team** card is where you add and remove team members. The audit page has these tabs:

- **Checklist**: the chosen checklist, item by item. Choose **Yes**, **No** or **N/A** for each item and add a note. Each answer is saved as you give it, with who gave it and when. Answers cannot be changed once the audit is closed.
- **Evidence requests**: what the auditors asked the auditee for (see [Evidence requests](#evidence-requests)).
- **Findings**: the findings of this audit; **New audit finding** adds one.
- **Report**: the **Report summary** and **Overall opinion** (**Effective**, **Needs improvement** or **Ineffective**), and **Download the report (PDF)**.
- **Approval**: what still stops the audit closing, and the report approval.

### Closing an audit

An audit closes only when:

- the **Report summary** is written, and
- every finding of the audit has a **Management response** or a **corrective action plan**, and
- where an **Audit report approval** workflow is active, the report has been approved.

The **Approval** tab lists anything still missing. When nothing is, select **Ask for report approval** (with an optional note for the approvers). The approvers (by default anyone holding `audits.approve`, other than the person asking) decide on the **Approvals** page or on the audit page. Approval records who approved it and when, and closes the audit; rejection leaves it in **Reporting**, with the reason in its history. While the request waits, the audit cannot be closed by hand.

A new installation starts with one workflow, **Audit report approval**, with a single step. An administrator can change it, or add steps for an executive or a committee, under **Administration > Approval workflows** (see [Approval workflows](22-approval-workflows.md)). With no active workflow of this kind, **Close the audit** closes it directly once nothing is missing.

### The audit report PDF

With `audits.export`, **Download the report (PDF)** on the **Report** tab (or `GET /api/audits/<id>/report.pdf`) gives the report with your organization's name, address and logo: the audit's details and team, scope and criteria, summary, overall opinion and approval, a summary of the figures, and every finding with its criteria, condition, cause, effect, recommendation, response and plan. A restricted audit's report is marked restricted on every page. Each download is recorded in the audit log.

## Checklists

Open the **Checklists** tab (under Audits or Inspections). A **checklist template** is a reusable list of checks: nothing is built in, so write your own. For each template choose what it is **Used for** (**Inspection** or **Audit**) and, for inspections, what it **Inspects** (a site, vehicle, asset, system or nothing in particular).

On the template's **Items** tab select **Edit items**. For each check enter:

- **Section**: a heading such as "Platforms and access"; checks with the same section are grouped.
- **Check**: the question or check, such as "Emergency exits clear and signed".
- **Guidance for the person checking**.
- **Critical: not met fails the inspection**.
- **Needs a photo**: the inspection cannot be completed without a photo of this item, unless it is not applicable.

Move checks up and down with the arrows, remove them with the trash button, then **Save checklist**. A checklist that has already been used gets a new **Version** when its items change; earlier answers keep their questions (a removed check still shows, marked "No longer on the checklist", on the inspections and audits that answered it). Clear **Active** to stop a template being used for new scheduled inspections.

## Inspections

### Schedules

Open **Safety > Inspections**, then the **Schedules** tab, and **New schedule**. Choose the **Checklist**, what it **Inspects** and the record (for example the site), the **Inspector (assigned to each inspection)**, the **First inspection due** and the **Frequency** (**Weekly**, **Monthly**, **Quarterly** or **Yearly**), then select **Create schedule**.

The application works through the schedules every few hours (job `audits.inspections`, under **Administration > Background jobs**):

- When a schedule's next inspection comes within the reminder lead time, the inspection is created (for example `INS-00042`), assigned to the schedule's inspector, and the schedule's next due date moves on by its frequency. A schedule that has fallen behind catches up at most 24 inspections at a time.
- An inspection still not done **7 days** after its due date is marked **Missed**. It can still be carried out late.
- The inspector is told once when an inspection comes within the lead time (setting `audits.inspection_reminder_days`, **2** days unless changed under **Administration > Reminders**) and once when it is overdue. An inspection with no inspector goes to everyone who may edit audits.

Someone with `audits.administer` can run the work at once with `POST /api/audits/inspections/run`.

You can also create a single inspection with **New inspection** (or **Create > Inspection**).

### Run an inspection on a phone or tablet

Open the inspection and select **Start the checklist** (or open the reminder). The run screen shows one check at a time, made for a phone held in one hand:

1. Read the check, its section and guidance. **Critical** and **Photo needed** are marked.
2. Tap **Yes**, **No** or **Not applicable**. The answer is saved at once; **Yes** and **Not applicable** move on to the next check.
3. After **No**, describe **What was found** and select **Save note**, and add a photo if it helps.
4. **Add a photo** opens the camera (or the photo library). The photo is attached to the inspection (its **Attachments** tab) and to the check.
5. Move with **Previous**, **Next** and **Next unanswered**. The bar at the top shows how many checks are answered.
6. When every check is answered, select **Complete inspection**. Leave **Raise a finding for each item not met** ticked unless the problems were put right on the spot.

Completing works out:

- the **Result**: **Fail** when a critical check is not met, **Pass with findings** when another check is not met, otherwise **Pass**;
- the **Score**: checks met out of checks answered yes or no;
- a **finding** for each check not met (a major nonconformity for a critical check, a minor one otherwise), with the note as its condition and a response due in 30 days.

A completed inspection cannot be changed. Answering needs `audits.edit`; adding photos also needs the attachments module.

## Findings

Open **Governance > Audit findings** for the findings of every audit and inspection, or the **Findings** tab of one. A finding (`FND-00012`) records, in the usual structure:

- the **Rating**: **Major nonconformity**, **Minor nonconformity**, **Observation** or **Opportunity for improvement**;
- the **Criteria** (what should be), the **Condition** (what was found), the **Cause**, the **Effect** (the risk or consequence) and a **Recommendation**;
- the **Management response**, its **Response owner** and **Response due** date. Giving the response records the **Responded** date and moves an open finding to **Response given**.

A finding follows the restriction of the audit it was raised on.

On the finding's page:

- **Raise a corrective action plan** (needs `actions.create`, and only while corrective action plans are available) creates a plan from the finding: its title, problem statement (the condition and where it was found), root cause (the cause), responsible person (the response owner) and due date (the response due date). The finding records the plan and moves to **Corrective action plan raised**. A plan raised from the **Corrective action plan** tab is recorded on the finding the same way.
- **Add to the hazard log** (needs `safety.create`, and only while safety management is on) adds a hazard with source **Audit** or **Inspection**; for an inspection of a site, the hazard's site is that site.

Both appear on the finding's **Related** tab.

## Evidence requests

On an audit's **Evidence requests** tab, select **New evidence request**: say **What is asked for**, who it is **Asked of** and when it is **Due**. The request (`REQ-00007`) moves through **Requested**, **Provided**, **Accepted** or **Returned for more**.

The person asked needs no audit permission. They are notified, and open **My evidence requests** (`/audits/my-requests`, linked from the notification), which shows only their own requests: the reference, what is asked for, the due date and status, never the audit itself. They say what they are providing and where the auditor can find it, and select **Send my answer**. The request becomes **Provided** and the lead auditor is notified. The auditor then selects **Accept** or **Return for more** on the request's page; a returned request shows again under **Waiting for you**.

The person asked is reminded once when a request comes within `audits.request_reminder_days` (**3** days unless changed) and once when it is overdue. Requests on a restricted audit are shown only to people who may see restricted records.

Files: the person asked cannot attach files unless they may edit audits, so the answer names where the evidence is kept. An auditor can attach files to the request or the audit.

## Indicators

Two figures are offered to computed safety performance indicators and key risk indicators (`GET /api/metrics`):

- **Inspections done on time** (`audits.inspections_on_time_pct`): of the inspections due in a month (done, or past their due date), the share completed on or before the due date.
- **Audit findings overdue** (`audits.findings_overdue`): findings with no response or plan past their response date at the end of the month. Closed findings are not counted.

## Sample data

The `dev` seed profile loads invented sample data: eight audit areas, three checklists (a 15-item station walk-down, a 12-item yard and vehicle check and an 8-item process audit), three audits (one closed with three findings and two corrective action plans, one in fieldwork with five evidence requests, one planned), monthly inspection schedules for the sample interchange, control center and depots, and six months of inspections, two of them failed with findings and one missed.
