# Corrective action plans

A **corrective action plan** (CAP) groups the actions that fix one problem: an audit finding, a safety event, a failed control test, a funder's deficiency, a risk, or anything else. It records what went wrong (the **problem statement**), why (the **root cause**), who is responsible and by when, and the actions that remove the cause. The plan is approved before work starts, and it closes only when every action has been **verified** as effective.

Corrective action plans belong to the action tracker, so they are always available and use the **Actions** permissions (**View**, **Create**, **Edit**, **Approve**). They are never switched off.

## The register

Open **Risk and compliance > Action tracker** and the **Corrective action plans** tab. The tiles count every plan, the same for everyone:

| Tile | Counts |
|---|---|
| **Open plans** | Plans not closed or rejected. |
| **Overdue** | Open plans past their due date. |
| **Awaiting approval** | Plans submitted and waiting for an approver. |
| **Actions to verify** | Actions in plans whose work is finished but whose effectiveness has not been checked yet; the hint says how many are past their verification date. |

Select a tile to filter the list. The list has the usual search, filters (**Status**, **Source**, **Responsible**, **Root cause category**, **Due after** and **Due before**, **Tags**), sorting, saved views, column options and export. Each row shows how many of the plan's actions are done and how many wait for verification, or **No actions yet** for a plan with none. **Raised on** links to the record the plan came from.

A plan raised on a restricted record (for example a risk or a security incident) is itself restricted: only people who may see security records see it in the list. It still counts in the tiles. **Actions awaiting verification** at the top opens the action tracker filtered to those actions.

## Raising a plan

- From a record: modules that find problems show a **Corrective action plans** card on their records (for example audit findings, control tests, funder reviews and safety events). Select **Raise a plan**. The plan is tied to that record and filed under its source.
- From the register: select **New corrective action plan**, fill in the form and select **Create corrective action plan**. A plan raised here has no source record; you can still choose its **Source** (the kind of problem it fixes).

Give the **Title** and the **Problem statement**; the **Root cause**, its **Root cause category**, the **Responsible** person and the **Due** date can follow. A new plan is a **Draft**. Its reference begins `CAP-`.

## The plan page

The page shows where the plan stands (**Draft**, **Approval**, **Actions**, **Verification**, **Closed**), its due date, the responsible person and how many actions are done. The tabs are:

- **Actions**: the plan's actions with their progress. Type a title in **Add an action and press Enter**, or select **Add action** for one with an owner, due date, verifier and verification date. An action added to a plan comes from the plan's source record (and is restricted when that record is) and **needs verification** unless you clear that box.
- **Approval**: whether the plan was approved, by whom and when, and the approval workflow it went through.
- **Activity**, **Attachments**, **Related** and **History**, as on other records.

### Statuses

| Status | Meaning |
|---|---|
| **Draft** | Being written. |
| **Awaiting approval** | Submitted; the approval workflow is running. Set only by submitting. |
| **Approved** | Approved; no action has started yet. Set only by the approval. |
| **In progress** | At least one action has started, or an action was reopened after a failed verification. |
| **Verifying** | Every remaining action is finished and waiting for verification. |
| **Closed** | Every action is done (verified). The closing date is recorded. |
| **Rejected** | The approver rejected the plan; the reason is in its history. Set it back to **Draft**, rework it and submit it again. |

After approval the plan follows its actions by itself: it moves to **In progress**, **Verifying** and **Closed** as they do, and back to **In progress** if an action is reopened. Closing a plan by hand is refused while any action is not done. Canceled actions do not count.

A plan raised from an audit finding closes only after the auditor's verification of that finding (see [Audits and inspections > Verifying a finding before it closes](25-audits-and-inspections.md#verifying-a-finding-before-it-closes)). Until then it stays at **Verifying**, even when every action is done.

## Approval

Select **Submit for approval** on a draft or rejected plan (needs **Edit** on **Actions**). The plan needs a problem statement, a root cause and at least one action. Submitting starts the **Corrective action plan approval** workflow: one step for someone who may approve actions. Approvers find it under **My work > Approvals**, as for every other approval; see [Approval workflows](22-approval-workflows.md). An administrator can change the workflow (more steps, conditions, due times) under **Administration > Approval workflows**.

- **Approved**: the plan records who approved it and when, and becomes **Approved**.
- **Rejected**: the plan becomes **Rejected**, with the reason in its history.
- If no workflow applies (for example an administrator turned it off), submitting approves the plan at once and says so in its history.

## Verification of effectiveness

An action that **needs verification** is not finished when its work is done. When its owner marks it done (the round check, the status list, or a bulk change), it moves to **Awaiting verification** instead: its completion date is recorded and its **Verification due** date is set 30 days later unless one was already given. An action awaiting verification still counts as open, so a record that waits for its actions (for example a safety event that cannot close while actions are open) waits for the verification too.

To record the verification, open the action, select the **Verification** tab and **Record verification**. Only the **Verifier** named on the action (or, when none is named, the plan's responsible person) or someone who may approve actions can do it. Choose:

- the **Method**: **Record review**, **Observation**, **Re-inspection**, **Data trend** or **Interview**;
- the **Result**: **Effective**, **Partly effective** or **Not effective**;
- a **Note**: what you checked and what you found. It is required when the result is not effective.

**Effective** and **Partly effective** make the action **Done**. **Not effective** reopens it (**In progress**, completion date cleared), tells its owner, keeps your note as the reason in its history, and moves the plan back to **In progress**. The tab keeps the last result, method, date and verifier.

Actions outside a plan can need verification too: tick **Needs verification** on the action.

**My work > Actions** (**My actions**) has a **To verify** section with the actions that name you as their verifier, and a **Finished, awaiting verification** section with your own actions that wait for someone else's check. On the action tracker, the **Awaiting verification** tile shows every such action.

### Verification reminders

The verifier (or, when none is named, the plan's responsible person; otherwise everyone who may approve actions) is told once when a verification is due within 7 days, and once more when the date is reached or has passed. An administrator changes the number of days under **Administration > Reminders** (**Remind verifiers before the verification date**).

## Closure evidence

An administrator can require evidence before actions from some sources are finished, for example every action from an audit. Actions from those sources can then be marked done only when they have an attachment or some **Closure evidence** text. An administrator checks those sources under **Administration > Settings > Actions** (**Evidence needed before closing**; none are checked at first). The choice is kept in the setting `actions.closure_evidence_sources` and every change is recorded in the audit log.

## Asking for more time

Once a plan is approved, the due dates of its actions are fixed: only someone who may approve actions can change them directly. An owner who needs more time opens the action, selects the **Extensions** tab and **Ask for more time**, and gives the **New due date** and **Why more time is needed**. The request goes through the **Action due date extension** approval workflow.

- **Approved**: the action gets the new due date, keeps its **Original due date**, and counts the extension.
- **Rejected**: the due date stays as it was.

The tab lists every request with its decision, who decided and when. One request at a time can wait for a decision. Extensions can be asked for on any action whose work is not finished (not done, canceled or awaiting verification), in a plan or not, by someone with **Edit** on **Actions**.

## Figures for indicators

Three figures are offered to safety performance indicators and key risk indicators: **Overdue actions**, **Overdue corrective action plans** and **Actions awaiting verification**, each counted at the end of a month (or today for the current month). Like every figure, they count every record, restricted or not.

## For other modules and integrators

Plans have the usual API at `/api/caps`, and:

| Route | What it does |
|---|---|
| `POST /api/caps/:id/submit` | Submit a plan for approval. |
| `GET /api/caps/:id/approval` | Who approved the plan and its newest approval workflow. |
| `GET /api/caps/register` | Plans with counts of their actions; filters `source`, `status`, `source_type`, `source_id`, `overdue=1`, `awaiting=1`, `q`. |
| `GET /api/caps/summary` | The figures on the register's tiles. |
| `POST /api/actions/:id/verify` | Record a verification (`method`, `result`, `note`). |
| `POST /api/actions/:id/extension-request` | Ask for a later due date (`new_due_on`, `reason`). |
| `GET /api/actions/:id/extension-requests` | The extension requests of an action and their decisions. |
