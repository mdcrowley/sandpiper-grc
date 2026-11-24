# Funding and grants

The funding pages help an organization that receives outside funding (grants, capital and operating assistance, and other awards) show that it meets its funders' conditions: the **awards** and what each one paid for, the **reports** each award requires, the **yearly certifications** an authorized official signs, and the **compliance reviews** funders make, with the deficiencies they find and how each is corrected. Open them from **Funding and grants** in the **Governance** group of the navigation. The pages share tabs along the top: **Dashboard**, **Awards**, **Certifications**, **Compliance reviews**, **Deficiencies**, **Sub-recipients** and **Review areas**. Lists and record pages work as described in [Getting started](01-getting-started.md).

No funder, funding program, law or review guide is built in. Funders and programs are names you type on each award, the statements you certify are your own, and a funder's review areas are loaded from a file you prepare (see [Review areas from a file](#review-areas-from-a-file)). Everything shipped as an example is invented and labeled as a sample.

If your organization does not track funding here, an administrator can switch **Funding and grant compliance** off under **Administration > Features** (see [Administration](09-administration.md#features)). The funding pages, the **Funder clauses** tab on contracts and the daily certification job then disappear. Records are kept and return when it is switched back on.

You need the **funding** permissions: `funding.view` to see the pages, `funding.create`, `funding.edit` and `funding.delete` to keep the records, `funding.export` to export them, `funding.approve` to sign a certification as the authorized official, and `funding.administer` to load review areas from a file. Raising a corrective action plan also needs `actions.create`, and the **Reporting obligations** tab needs `obligations.view`. The default **Compliance officer** role holds all the funding permissions; the **Auditor** role (switched off until an administrator enables it) can read them.

## Funding dashboard

Open **Funding and grants**. It shows:

- Tiles for **Open awards** (and the amount awarded), **Reports due** within 30 days (and how many are overdue), **Open deficiencies** (how many are past due, or have no corrective action plan) and **Reviews under way**. The awards and deficiencies tiles open the records behind them.
- **Awards by status**. Select a bar to open those awards.
- **Reports and close-outs due**: each open award whose next report or close-out is due within 30 days, or overdue (in red).
- **Yearly certifications**: this year's and next year's, with how many applicable items are confirmed.
- **Compliance reviews under way**: each open review, with how many areas are assessed, how many are deficient and how many deficiencies are open.

The figures count every funding record, so they are the same for everyone who may see the funding pages.

## Funding awards

Open **Awards**. Filter by status, reporting frequency, award manager, project, end of period or next report due.

### Add an award

1. Select **New funding award** (or **New award** on the dashboard), or **Create** then **Funding award**.
2. Enter the **Award** (its title), the **Funder** and the **Funding program** as the funder names them, and the funder's **Award number**.
3. Choose the **Status**: **Applied for**, **Awarded**, **Active** or **Closed out**.
4. Enter the **Period starts** and **Period ends** dates, the **Amount awarded** and the **Local share** (the part your organization pays). Amounts cannot be negative, and the period cannot end before it starts.
5. Choose the **Project** the award pays for, if there is one, and the **Award manager**.
6. Choose the **Reporting frequency** (**Monthly**, **Quarterly**, **Every six months**, **Yearly** or **Once, at the end**) and enter the **Next report due** and **Close-out due** dates.
7. Select **Create funding award**.

The award gets a reference such as `AWD-00004`.

### Funded items

The **Funded items** tab lists what the award paid for: assets, vehicles, projects and contracts. To add one:

1. Select **Add a funded item**.
2. Choose the **Kind of record**, then the record.
3. Select **Add**.

Each item is linked to the award with the relation **funded by**, so the asset, vehicle, project or contract shows the award on its own **Related** tab too. Select **Remove** to take an item off. You only see, and can only add, records you are allowed to see. Kinds of record that are not part of your installation are not offered.

Whether an outside funder keeps an interest in an asset or vehicle (and must approve its disposal) is recorded on the asset or vehicle itself; see [The funder-interest rule](03-inventory.md#the-funder-interest-rule).

### Reporting obligations

When an award is **Awarded** or **Active**, its reporting becomes part of the obligations register (see [The obligations register](06-risks-actions-obligations.md#the-obligations-register)):

- a **Funder reporting** obligation of the type **Funding condition**, with the award's reporting frequency, the **Next report due** date as its next due date and the award manager as its owner;
- a **Close-out** obligation, due once on the **Close-out due** date.

The **Reporting obligations** tab lists them. Each is made once: after that it lives in the obligations register, where it is attested period by period and its next due date moves on, so later changes to the award do not change it. If an award was saved before its dates or frequency were known, or before the obligations register was installed, select **Make missing obligations** (this needs permission to create obligations too). The tab says so when the obligations register is not part of your installation.

## Yearly certifications

A yearly certification is the list of statements your organization certifies to a funder each year (for example that it has the authority to accept awards, keeps award funds separately and follows its procurement procedures). Each statement is confirmed by the person responsible for it, and then the authorized official signs. Open **Certifications**.

### Add a certification

1. On **Certifications**, select **New funding certification**.
2. Enter the **Year**, a **Certification** title, the **Funder** and the **Due** date.
3. Choose the **Authorized official** who signs.
4. Select **Create funding certification**. It starts as a **Draft**.

### The checklist

The **Checklist** tab shows each statement with its **Category**, the person **Responsible** and its **Confirmation**, and a bar of how many applicable items are confirmed.

- **Add an item**: enter the **Statement**, choose a **Category** and the person **Responsible**, and clear **Applies to the organization this year** if it does not apply. An item that does not apply needs no confirmation.
- **Confirm**: the person responsible for an item, or anyone who may edit funding records, confirms it. **Withdraw** takes a confirmation back. Changing a confirmed statement, or whether it applies, clears its confirmation.
- **Edit** and **Remove** change the list.

The checklist can change only while the certification is a **Draft**.

### Sign-off

1. When every applicable item is confirmed, select **Send for signing**, add a note if you like, and select **Send**.
2. The certification becomes **Waiting for signature** and the authorized official is asked to approve it, through the approval workflow **Funding certification sign-off** (see [Approval workflows](22-approval-workflows.md)). They decide on the record page or on the **Approvals** page.
3. When they approve, the certification is **Signed**, dated today. If they reject it, it goes back to **Draft** with their reason in its history.
4. Once it has been sent to the funder, select **Mark as submitted**.

Sending for signing is refused while an applicable item is not confirmed, while the checklist is empty, or when no authorized official is named. The authorized official needs `funding.approve`. An administrator can change the workflow, for example to add a second signer, under **Administration > Approval workflows**.

### Next year's draft

Select **Copy to next year** to make next year's draft from a certification: the same title, funder and authorized official, the due date a year on, and every item, unconfirmed. If next year's certification is already there, it opens instead.

This also happens by itself. Every day from the month chosen in **Next year's drafts** (default **December**), each certification (by title and funder) whose newest year is before the coming year gets a draft for that year, made from the newest one. Before that month, a certification with no draft for the current year gets one. Someone with `funding.administer` chooses the month under the list on **Certifications** (**Made each year from**, then **Save**; the setting `funding.certification_month`). `POST /api/funding/certifications/rollover/run` runs the job at once.

## Compliance reviews

A funder may review how your organization manages its awards, usually area by area (financial management, procurement, asset management and so on), with a request for documents, a site visit and a report of deficiencies. Open **Compliance reviews**.

### Review areas from a file

The areas a funder reviews, with their questions, are loaded from a file under **Review areas** (this needs `funding.administer`). The file is JSON:

```json
{
  "name": "Funder review areas",
  "version": "2027",
  "description": "Optional: what this set is for",
  "areas": [
    { "code": "FM", "title": "Financial management", "description": "Optional",
      "questions": ["Are award funds recorded separately?", "Are drawdowns reconciled each period?"] }
  ]
}
```

- `name` is required, `version` and `description` are optional.
- Each area needs a `code` (letters, digits, dots, hyphens and underscores, up to 30, unique in the file) and a `title`; `description` and `questions` (a list of questions) are optional.

To load one:

1. Open **Review areas** and select **Choose a file**.
2. The file is checked first and nothing is saved: you see how many areas it holds and, if a set of the same name and version is already loaded, how many areas are new or changed. Problems are listed in plain words.
3. Select **Load** to save it.

Loading the same name and version again updates the areas and adds new ones; it never removes one (areas no longer in the file are listed and kept). **Load the invented sample** loads an invented set of twelve areas for trying the pages out; it does not reproduce any funder's review guide. **Show areas** lists a set's areas and questions.

### Start a review

1. On **Compliance reviews**, select **New compliance review**, or **Create** then **Compliance review**.
2. Enter a **Review** title, the **Funder**, the **Period reviewed**, the **Site visit** date and the **Review lead**.
3. Select **Create compliance review**.
4. On the review's **Areas** tab, choose a set of review areas and select **Load areas**.

The review gets a reference such as `CRV-00002`. Its progress runs **Preparing**, **Self-assessment**, **Site visit**, **Draft report**, **Final report** and **Closed**; change the **Status** on the **Details** card as the review moves on.

### Areas and the self-assessment

The **Areas** tab lists each area with its **Self-assessment** (**Not assessed**, **Compliant**, **Deficient** or **Not applicable**), its owner and how many deficiencies it has. Open an area to:

- answer each of its questions;
- choose the **Self-assessment** and the **Owner**;
- record **Notes and evidence** (where the evidence is kept; attach the files themselves on the review's **Attachments** tab);
- select **Save area**, or **Record a deficiency** for a deficiency the funder found in that area.

A review keeps its own copy of the areas, so loading a newer version of the file later does not change a review under way.

### Document requests

The **Requests** tab tracks what the funder asked to see. Select **Add a request** and enter what was asked for, the **Review area**, who it is **Assigned to**, the **Due** date and the **Status** (**Open**, **Provided** or **Accepted by the funder**), then select **Add**. The person a request is assigned to can **Answer** it (its status and response) even without permission to edit funding records.

### Deficiencies and corrective action plans

What the funder finds is recorded as a **deficiency** (`DEF-` numbers), on the review's **Deficiencies** tab or under **Deficiencies**: a title, the **Review area code**, **What the funder found**, the **Corrective action required**, the **Owner** and the **Due** date. Its status runs **Open**, **Being corrected**, **Response sent to the funder** and **Closed**.

Each deficiency is corrected through a corrective action plan (see [Corrective action plans](24-corrective-action-plans.md)):

- On the deficiency, select **Raise a corrective action plan**. The plan is made from the deficiency (its problem statement, owner and due date) and opens so you can add its actions. You can also raise one from the **Corrective action plans** tab.
- The deficiency is then **Being corrected**, and shows its plan.
- A deficiency with a plan closes by itself when its plan closes, that is when the plan's actions are done and verified. It cannot be closed by hand while a plan for it is still open.

A deficiency with no plan can be closed by hand. **Closed on** is filled in when it closes, and cleared if it is reopened.

### The funder's reviewer

The funder's reviewer can be given access to one review for a set period, on the review's **Outside reviewers** tab (needs `funding.edit` and email set up). They see the review's details (funder, period, site visit, status and lead), its document requests with their answers, the evidence files on the review, and its deficiencies, and nothing else in the application. Mark the files on the review that the reviewer should see as evidence; other files are not shown. Inviting, the account, what the reviewer sees and how access ends work as for audits: see [Outside reviewers](25-audits-and-inspections.md#outside-reviewers). While **Funding and grants** is switched off, invitations to reviews are hidden and closed.

### Close a review

A review can be closed only when none of its deficiencies is open. **Closed on** is filled in for you. A closed review takes no new deficiencies, and its areas and requests cannot change until it is reopened.

## Sub-recipients

A sub-recipient is an organization that receives part of an award to carry out part of its work, such as a partner agency that runs some of the service or a research partner. Funders usually expect you to monitor each one. Open **Funding and grants**, then the **Sub-recipients** tab (or **Create** then **Sub-recipient**).

1. Select **New sub-recipient** and enter its **Name**, the **Award** it receives funding from, optionally the matching **Vendor record**, the **Amount passed through**, a **Risk level** (high, medium or low), how often it is monitored (**Monitoring frequency**: monthly, quarterly, every six months, yearly or once) and who monitors it (**Monitored by**). Each gets a reference such as `SUB-00001`.
2. A new sub-recipient is due for monitoring at once. Open its **Monitoring** tab and select **Record monitoring**: the date, the **Method** (desk review, site visit or report review) and the **Result** (satisfactory, findings or unsatisfactory). Any result other than satisfactory needs the **Findings**.
3. **Last monitored on** and **Next monitoring due** are worked out for you: the latest monitoring plus the frequency ("once" is not due again).
4. When monitoring found something, select **Raise a plan** on that row to raise a corrective action plan with source **Funding** (see [Corrective action plans](24-corrective-action-plans.md)). Raising a plan also needs permission to create actions.

The person monitoring it (or else the award's manager, or else everyone who may edit funding records) is reminded once for each due date, from the number of days before it in the setting `funding.subrecipient_reminder_days` (30 as installed). The **Related** tab links it to other records. Anonymizing a sub-recipient at the end of its retention period clears who monitored it and the findings text.

## Funder-required clauses on contracts

A funder may require certain clauses in contracts paid for with its money. A contract that is a funded item of an award (see [Funded items](#funded-items)) shows a **Funder clauses** tab (see [The contract record](04-vendors-and-contracts.md#the-contract-record)). For each award that funds it, the tab lists the clauses in your list, each marked **Present**, **Partial**, **Absent**, **Not required** or **Not checked**, with a note of where in the contract it is. A change is saved at once and recorded in the contract's history. The checklist is kept by the same clause-checklist engine as the contract security terms (see [The security-terms checklist](04-vendors-and-contracts.md#the-security-terms-checklist)); checks recorded before were moved across when the application was upgraded.

The clause list is your organization's own: an administrator edits it under **Administration > Lists**, in the list **Funding clause**. A few neutral examples are there to start with (access to records, record retention, termination, excluded parties, conflict of interest, flow-down to subcontracts, funder acknowledgment).

The tab needs `funding.view` (and `funding.edit` to change it) besides the contract permissions.

## Sample data

The `dev` sample data adds four invented awards ("[Sample] Bus replacement", "[Sample] Station accessibility upgrade", "[Sample] Operating assistance" and "[Sample] Cybersecurity improvement") from invented funders, this year's certification with twenty statements, and one compliance review built from the invented sample file of review areas, with three requests and two deficiencies (one with a corrective action plan), and two invented sub-recipients of "[Sample] Operating assistance" ("[Sample] County paratransit partner" and "[Sample] University research partner"), each with monitoring history, one with findings and a corrective action plan. The sample awards are linked to the sample vehicles, assets, projects and contracts that exist when the sample data is loaded.

## Not available yet

- Drawdowns, budgets and expenditure by award: keep those in your finance system.
