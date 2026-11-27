# Audits and inspections

These pages plan and run **internal audits** (internal audits, safety reviews, compliance pre-reviews and cybersecurity control audits) and **recurring inspections** of stations, depots, vehicles and equipment. Open them from the navigation: **Risk and compliance > Audits** (with tabs **Coverage**, **Audit plan**, **Audits**, **Audit universe**, **Findings**, **Evidence requests** and **Checklists**; the findings of every audit and inspection are on its **Findings** tab) and **Safety and emergency management > Inspections** (with tabs **Inspections**, **Schedules** and **Checklists**). Lists and record pages work as described in [Getting started](01-getting-started.md).

Findings from audits and inspections raise [corrective action plans](24-corrective-action-plans.md) and, for safety concerns, hazards in the [hazard log](20-safety-management.md#hazard-log).

If your organization does not use them, an administrator can switch **Audits and inspections** off under **Administration > Features** (see [Administration](09-administration.md#features)). The pages, the inspection schedules and reminders then stop, and nothing about them is shown elsewhere. Records are kept and return when it is switched back on.

## Permissions and roles

You need the **audits** permissions: `audits.view` to see the pages, `audits.create` and `audits.edit` to plan audits, work and sign workpapers, and record and verify findings, `audits.delete`, `audits.export` for the audit report PDF and list exports, `audits.approve` to approve audit reports and the annual audit plan, and `audits.administer` to weight the plan's risk factors and run the inspection work by hand. Raising a corrective action plan from a finding also needs `actions.create`; adding a hazard needs `safety.create`.

The default roles:

- **Audit lead** holds all of the audits permissions, the action tracker and controls, and can read committees, obligations, policies and frameworks.
- **Safety manager** holds all of the audits permissions, so a safety team can run inspections and safety reviews.
- **Security lead**, **Compliance officer** and **Auditor** can read audits; the **Auditor** can also export them.

Audits flagged **Restricted** (for example a cybersecurity control audit) need `security.view` as well, and so do their findings and evidence requests. Counts on the dashboard include restricted audits for everyone; in the coverage grid someone who may not see one sees "Restricted audit" with its status only.

## Coverage

Open **Risk and compliance > Audits**. The tiles show:

- **Audits planned** for this year (and how many are closed), **Audits under way** (in fieldwork or reporting).
- **Areas overdue for audit**, with how many are due within 90 days and how many were never audited.
- **Open findings**, and how many are past their response date.
- **Findings awaiting verification**, and how many are past the date for the auditor's verification.
- **Inspections due in 30 days** and how many are overdue; **Inspections on time** over the last 90 days, with how many were missed or failed.
- **Evidence requests open**, and how many are overdue.

**Coverage of the audit universe** lists each area with its cycle, its state (**Overdue**, **Due soon**, **On cycle** or **Never audited**), its next due date, and its audits in each of the last three years and next year's plan. Choose **Last 5 years** or **This year** to change the span. This answers "which parts of the safety plan were audited in the last three years?". The grid shows 200 areas at a time, in name order, with page numbers under it when the universe is larger; the tiles count every area.

Below are **Inspections in the last six months** (done on time, done late and missed each month), **Open findings by rating**, **Next inspections** and **Audits under way and planned**. Select a tile, a bar or an entry to open the records behind it.

## The risk-ranked audit plan

Open the **Audit plan** tab. It ranks every area of the audit universe (those **In the plan**) by a **risk score** from 0 to 100 for the plan year you choose (next year from October, otherwise this year), and proposes which areas to audit by risk, not by cycle alone.

Each area's score weighs five factors, each from 0 (lowest risk) to 1:

- **Residual risk**: the highest residual rating of the open risks linked to the area (likelihood times impact, as a share of the largest its scale allows). Link an area to the risks it covers from its **Related** tab (either direction, any relation). With no risk linked, the area's own **Risk level** counts instead (high 1, medium 0.6, low 0.3).
- **Time since the last audit**, as a share of the area's cycle. An area never audited counts fully; an area without a cycle counts against 36 months.
- **Last audit result**: the **Overall opinion** of the area's last closed audit (**Ineffective** 1, **Needs improvement** 0.6, **Effective** 0.2; 0.5 when there is none).
- **Change**: the area's **Change since the last audit** (**Major change**, **Some change**, **Little change** or **No change**).
- **Significance**: the area's **Significance** (**High**, **Medium** or **Low**).

What each list entry adds is its `factor` (0 to 1), which an administrator can change under **Administration > Lists** (lists `audit_significance` and `audit_change_level`). **How areas are scored** shows the weight of each factor (a whole number from 0 to 100; only their proportions matter), the **Audits a year (capacity)** and the **Threshold score**. Someone with `audits.administer` changes them and selects **Save scoring**; every area's score is then worked out again. Scores are also worked out every day (job `audits.risk_scores`) and whenever an area changes, and show as **Risk score** in the audit universe, which lists the highest first.

The table lists the areas from the highest score down, each with **Why** it is proposed: **Ranked 3 of 12 by risk** (the top areas up to the capacity; with no capacity, every area at or above the threshold), **Never audited**, or **Due by its cycle** on a date within the year. An area due by its cycle but below the line is marked **Due by cycle** without **Proposed**, so you can decide to add it. The factors behind each score and the audits already planned for that year are shown on wider screens. The score counts every linked risk, restricted or not, and shows only figures about them (how many, and the highest residual score), never their titles: it is the same for everyone.

### Saving and approving the year's plan

Tick the areas to include (the proposed ones are ticked to start with), add a note if you like and select **Save version** (needs `audits.edit`). Each version keeps the ranking, scores and weights it was made from, with who prepared it and when; **Versions of the plan** lists them. Someone with `audits.approve` who did not prepare it selects **Approve version** on the newest draft, with an optional note (for example the committee meeting that approved it). The version then records who approved it and on what date, and an earlier approved version of that year becomes **Superseded**. An approved version is never changed: to change the plan, save a new version and have it approved. On the approved version, **Create the planned audits** adds a planned audit for each included area that has no audit that year yet. In data load mode an administrator may name the approver (`on_behalf_of`) and give a past approval date (`approved_on`).

## The audit universe

Open the **Audit universe** tab. Each **audit area** is something that needs auditing: a **Safety plan element**, a **Process**, a **Department**, a **System** or a **Site** (the **Category** list can be changed under **Administration > Lists**). For each, record:

- **Audit every (months)**: the cycle, from 1 to 120 months.
- **Next audit due**, the **Owner** and the **Risk level** (high, medium or low).
- **Significance** and **Change since the last audit**, two factors of the [risk score](#the-risk-ranked-audit-plan). **Risk score** itself is worked out.
- **In the plan**: clear it for an area that no longer needs auditing; it leaves the coverage grid.

**Last audited** is filled in by itself when an audit of the area closes (the end of its fieldwork), and **Next audit due** then moves on by the cycle. Changing the cycle also moves the next due date on from the last audit.

## Audits

Open the **Audits** tab, then **New audit engagement** (or **Plan an audit** on the plan, or **Create > Audit**). Enter a **Title**, the **Type** (**Internal audit**, **Safety review**, **Compliance pre-review** or **Cybersecurity control audit**), the **Audit area**, the **Plan year**, the **Scope** and **Criteria** (what the audit checks against, such as your own procedure), the **Checklist** to use, the **Lead auditor**, the **Auditee** and the planned dates. Tick **Restricted** for an audit only people who may see restricted records should open, then select **Create audit engagement**. The audit gets a reference such as `AUD-00004`.

An audit moves through **Planned**, **Fieldwork**, **Reporting** and **Closed** (or **Canceled**), shown along the top of its page:

1. **Start fieldwork** records the fieldwork start date if none is set.
2. **Move to reporting** records the fieldwork end date if none is set.
3. **Close the audit** opens the **Approval** tab (see [Closing an audit](#closing-an-audit)).

Above the tabs, the **Scope** card holds the audit's details (select **Edit** to change them), the **Audit team** card is where you add and remove team members, and **Workpapers and follow-up** counts the program steps worked, prepared and reviewed, open review notes, control tests and findings awaiting verification, with a warning when a verification is overdue. The audit page has these tabs:

- **Workpapers**: the audit program, one step per item of the chosen checklist (see [Workpapers](#workpapers)).
- **Evidence requests**: what the auditors asked the auditee for (see [Evidence requests](#evidence-requests)).
- **Findings**: the findings of this audit, with their verification dates; **New audit finding** adds one.
- **Control tests**: tests of controls recorded as part of this audit, while controls are on (see [Controls and testing](26-controls-and-testing.md#tests-that-are-part-of-an-audit)).
- **Report**: the **Report summary** and **Overall opinion** (**Effective**, **Needs improvement** or **Ineffective**), and **Download the report (PDF)**.
- **Approval**: what still stops the audit closing, and the report approval.
- **Evidence**: while the [evidence library](43-evidence-library.md) is on (and you may view it), the evidence records linked to the audit. Evidence requests and findings have the same tab.

### Workpapers

Each item of the audit's checklist is a step of the audit program. Select **Open step** to work on it:

- **Test procedure** (what you did; the item's guidance to start with), **Sample** (what you looked at and how it was chosen), **Result** (**Satisfactory, no exceptions**, **Minor exceptions**, **Exceptions found**, **Could not be tested (scope limitation)** or **Not applicable**), **What was found**, and **Files** chosen from the files on the audit's **Attachments** tab. Select **Save step**. The result list (`workpaper_result`) can be changed under **Administration > Lists**; each result counts as met, not met or not applicable in the report.
- **Evidence from the library**: while the evidence library is on, **Use existing evidence** links a record of the library to this step, and **Upload a file** files a new one there and links it. The library lists the step among the places the record is used.
- **Sign as preparer** once the step has a result. Any later change to the step withdraws that sign-off, so the preparer signs again.
- **Sign as reviewer**: someone other than the preparer reviews the step. The step is then **locked**: it cannot be changed, and no evidence can be linked to it.
- **Raise note** (the reviewer): a review note sends the step back to its preparer, whose sign-off is withdrawn. Only the preparer clears a note, with a **Response** and **Clear note** (an administrator may clear one whose preparer has left); the preparer then signs again and the reviewer reviews. Open notes are listed in the preparer's **My work** as **Workpaper review notes**, and the preparer is told when one is raised.

Every sign-off and note is recorded in the audit's history. Answers given before workpapers existed (yes, no or not applicable) still count and can be signed. In [data load mode](09-administration.md#data-load-mode) an administrator loading past audits may name the preparer and reviewer (`on_behalf_of`) and give the times (`prepared_at`, `reviewed_at`); they must still be different people.

### Closing an audit

An audit closes only when:

- the **Report summary** is written, and
- every finding of the audit has a **Management response** or a **corrective action plan**, and
- every program step worked is prepared and reviewed, with no review note open, and
- every control test recorded as part of the audit is reviewed, and
- where an **Audit report approval** workflow is active, the report has been approved.

The **Approval** tab lists anything still missing. When nothing is, select **Ask for report approval** (with an optional note for the approvers). The approvers (by default anyone holding `audits.approve`, other than the person asking) decide on the **Approvals** page or on the audit page. Approval records who approved it and when, and closes the audit; rejection leaves it in **Reporting**, with the reason in its history. While the request waits, the audit cannot be closed by hand.

A new installation starts with one workflow, **Audit report approval**, with a single step. An administrator can change it, or add steps for an executive or a committee, under **Administration > Approval workflows** (see [Approval workflows](22-approval-workflows.md)). With no active workflow of this kind, **Close the audit** closes it directly once nothing is missing.

### The audit report PDF

With `audits.export`, **Download the report (PDF)** on the **Report** tab (or `GET /api/audits/<id>/report.pdf`) gives the report with your organization's name, address and logo: the audit's details and team, scope and criteria, summary, overall opinion and approval, a summary of the figures (workpaper steps reviewed included), and every finding with its criteria, condition, cause, effect, recommendation, response, plan and verification. A restricted audit's report is marked restricted on every page. Each download is recorded in the audit log.

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

Open **Safety and emergency management > Inspections**, then the **Schedules** tab, and **New schedule**. Choose the **Checklist**, what it **Inspects** and the record (for example the site), the **Inspector (assigned to each inspection)**, the **First inspection due** and the **Frequency** (**Weekly**, **Monthly**, **Quarterly** or **Yearly**), then select **Create schedule**.

The application works through the schedules every few hours (job `audits.inspections`, under **Administration > Background jobs**):

- When a schedule's next inspection comes within the reminder lead time, the inspection is created (for example `INS-00042`), assigned to the schedule's inspector, and the schedule's next due date moves on by its frequency. A schedule that has fallen behind catches up at most 24 inspections at a time.
- An inspection still not done **7 days** after its due date is marked **Missed**. It can still be carried out late.
- An inspection that is no longer needed can be set to **Canceled**. It cannot then be answered or completed (on the web or from the mobile app), it leaves My work and the app's offline package, and it does not count against **Inspections on time**.
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

The mobile app runs inspections too, also with no signal (see [The mobile app](39-mobile-app.md#field-work-inspections-condition-and-counts)): the same rules apply, and the server checks them again when the answers arrive. Completing in the app asks for a **signature**: the inspector types their name and may sign with a finger. The inspection then shows **Signed by** and **Signed**, and the drawing is one of its attachments.

A completed inspection cannot be changed. Answering needs `audits.edit`; adding photos also needs the attachments module.

## Findings

Open **Risk and compliance > Audits** and the **Findings** tab for the findings of every audit and inspection, or the **Findings** tab of one. A finding (`FND-00012`) records, in the usual structure:

- the **Rating**: **Major nonconformity**, **Minor nonconformity**, **Observation** or **Opportunity for improvement**;
- the **Criteria** (what should be), the **Condition** (what was found), the **Cause**, the **Effect** (the risk or consequence) and a **Recommendation**;
- the **Management response**, its **Response owner** and **Response due** date. Giving the response records the **Responded** date and moves an open finding to **Response given**.

A finding follows the restriction of the audit it was raised on.

On the finding's page:

- **Raise a corrective action plan** (needs `actions.create`, and only while corrective action plans are available) creates a plan from the finding: its title, problem statement (the condition and where it was found), root cause (the cause), responsible person (the response owner) and due date (the response due date). The finding records the plan and moves to **Corrective action plan raised**. A plan raised from the **Corrective action plan** tab is recorded on the finding the same way.
- **Add to the hazard log** (needs `safety.create`, and only while safety management is on) adds a hazard with source **Audit** or **Inspection**; for an inspection of a site, the hazard's site is that site.

Both appear on the finding's **Related** tab.

### Verifying a finding before it closes

A finding closes only after an auditor has verified that it was put right. The **Verification** card on the finding's page shows who is to verify (**Auditor to verify**: by default the audit's lead auditor, unless they own the response) and by when.

1. When the fix is done, someone who may edit audits selects **Ready for verification**. The finding becomes **Awaiting verification**, with the verification due after `audits.verification_days` (**30** days unless changed), and the auditor to verify is told. A corrective action plan raised from the finding that reaches **Verifying** or **Closed** does this by itself.
2. The auditor attaches what they looked at to the finding (its **Attachments** tab, or its **Evidence** tab while the evidence library is on), then selects **Verify and close**, gives the date (today unless another is chosen, never in the future) and what they checked and found, and chooses the files or evidence records.
3. The finding records **Verified on**, **Verified by** and the note, and closes.

The auditor may not be someone who owns the fix: the response owner, the plan's responsible person, or the owner of one of its actions. A finding cannot be set to **Closed** any other way. Findings waiting for verification are listed in the auditor's **My work** as **Finding verifications**, overdue ones first, and the auditor is reminded once when the date has passed. A finding closed before this rule, or by an imported record, shows "Closed without a recorded verification".

## Evidence requests

On an audit's **Evidence requests** tab, select **New evidence request**: say **What is asked for**, who it is **Asked of** and when it is **Due**. The request (`REQ-00007`) moves through **Requested**, **Provided**, **Accepted** or **Returned for more**.

The person asked needs no audit permission. They are notified, and open **My evidence requests** (`/audits/my-requests`, linked from the notification), which shows only their own requests: the reference, what is asked for, the due date and status, never the audit itself. They attach the evidence itself with **Attach files** (as many files as needed; the same file types, size limit and malware check as any other file), say what they are providing, and select **Send my answer**. The request becomes **Provided** and the lead auditor is notified. The auditor then selects **Accept** or **Return for more** on the request's page; a returned request shows again under **Waiting for you**.

The person asked is reminded once when a request comes within `audits.request_reminder_days` (**3** days unless changed) and once when it is overdue. Requests on a restricted audit are shown only to people who may see restricted records.

Files: the person asked attaches files without any audit permission, but only to their own requests. Each file lands on the request as an **evidence file**, so the auditor sees it on the request's **Evidence files** tab with who sent it and when. The person asked sees and downloads the files on their own requests, and may **Remove** a file they sent until the auditor accepts the evidence; after that the files stay. Every file sent or removed is recorded in the request's history. An auditor can also attach files to the request or the audit as usual.

## Outside reviewers

An external auditor, a certification body or a funder's reviewer can be given access to **one** audit for a set period, without becoming a user of the rest of the application. They see that audit's details, its evidence requests with the answers and files, the evidence files on the audit itself, and its findings, and nothing else: no lists, search, other records, people, reports or settings.

### Invite a reviewer

On the audit's **Outside reviewers** tab, select **Invite a reviewer** (needs `audits.edit`, and email set up under Administration > Email). Enter their **Name**, **Email address**, optionally their **Organization** (their firm, or the funder), and the day **Access ends** (from today to a year ahead), then select **Send the invitation**. You are asked to confirm your password first, because an invitation can make an account.

- The first invitation of an address makes an account for it, with no roles, and emails a set-up link to that address only. Nobody in the organization sees the link. The person chooses a password and then signs in like anyone else: the same password rules, lockout and session time-out apply. At their first sign-in they must set up a second factor (an authenticator app or a passkey) before they can see anything; an administrator can switch this off with **Outside reviewers must use a second factor** under Administration > Settings > Security, which is on to begin with.
- A later invitation of the same address, to another audit or a funder review, reuses that account and sends a notice without a link.
- An address that belongs to a staff account cannot be invited: staff get access through their roles.
- The email names the audit by its reference only, never its title.
- On a restricted audit, the dialog says so: the reviewer will see it.

The tab lists each reviewer with their organization, the day access ends, its status (**Open**, **Ended** or **Revoked**), whether they have set their password yet, when they last opened it and who invited them. From each row's menu you can **Change the end date**, **Send the invitation again** (**Send the set-up link again** for someone who has not set their password: a new link, and earlier links stop working) or **Revoke access now**.

### What the reviewer sees

The reviewer signs in to a page of their own, **Your reviews**, with the audits and reviews open to them and how many days are left. Opening one shows its details (type, status, lead auditor, dates, scope and criteria; the report summary and overall opinion once the report is approved or the audit closed), the evidence requests with each answer and its files, the evidence files on the audit, and the findings with their criteria, condition, cause, effect, recommendation and management response. They can download the files. Files on the audit that are not marked as evidence are not shown, so mark the files the reviewer should see as evidence. **Account security** lets them change their password and manage their second factor.

Every time a reviewer opens an audit (at most once an hour) and every file they download is recorded in the audit's history.

### When access ends

Access ends at the end of the chosen day, or at once when revoked. When nothing is open to a reviewer any more, their sessions end and their account is disabled (checked every few hours, and at once on revoking). Inviting them again turns the account back on, unless an administrator disabled it.

**Administration > Outside reviewers** (administrators) lists every invitation, with the audit or review it opens, and can revoke any of them. Reviewer accounts also appear under **Users**. They cannot be given roles (the application refuses, and so do sign-in provider role mapping and user provisioning), they are never offered when someone picks a person, and they never receive notifications or email meant for holders of a permission. Even a role that reached one another way gives it nothing, and the check every six hours takes it off.

While **Audits and inspections** is switched off (Administration > Features), invitations to audits are hidden and closed to their reviewers.

## Indicators

Two figures are offered to computed safety performance indicators and key risk indicators (`GET /api/metrics`):

- **Inspections done on time** (`audits.inspections_on_time_pct`): of the inspections due in a month (done, or past their due date), the share completed on or before the due date.
- **Audit findings overdue** (`audits.findings_overdue`): findings with no response or plan past their response date at the end of the month. Closed findings are not counted.
- **Finding verifications overdue** (`audits.verifications_overdue`): findings whose fix waits for the auditor's verification past its due date, at the end of the month.

## Sample data

The `dev` seed profile loads invented sample data: eight audit areas, three checklists (a 15-item station walk-down, a 12-item yard and vehicle check and an 8-item process audit), three audits (one closed with three findings and two corrective action plans, its workpapers signed by the lead auditor and reviewed by an invented audit manager, one finding verified and one waiting for verification past its date; one in fieldwork with five evidence requests; one planned), an approved audit plan for this year, monthly inspection schedules for the sample interchange, control center and depots, and six months of inspections, two of them failed with findings and one missed.
