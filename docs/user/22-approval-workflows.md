# Approval workflows

An approval workflow sends a record through ordered approval steps before something happens: a high-priority purchase request needs a buyer and then the department head; a vehicle taken out of service needs the fleet manager; an asset disposal needs the inventory manager. An administrator defines the workflows; everyone else meets them as an **approval panel** on the record page, in the **Approvals** page and in their notifications.

Workflows work with any kind of record. The approvals of other parts of the application run on them too (see [Approvals of other parts](#approvals-of-other-parts)): change approval, catalog request approval, asset disposal requests, risk acceptance and project gate decisions. So there is one **Approvals** page, one kind of notification, and the same due times, escalation and stand-ins for all of them, and an administrator changes who approves without any programming.

## Approvals waiting for you

Open **Approvals** in the **Home** group of the sidebar. It has four tabs:

- **Waiting for me**: every approval step waiting for your decision, the soonest due first. Each shows the record (select it to open the record), the workflow, which step of how many it is (the small bars), who asked, how many approvals the step has and needs, and the time left before it is due. An overdue one has a red edge; **Escalated** means it went past its due time and was passed to more people.
- **Decided by me**: what you approved or rejected, with your comment.
- **My requests**: the approvals you asked for, or that started when you changed a record, with where each stands: **Waiting for approval**, **Approved**, **Rejected** or **Canceled**.
- **Stand-ins**: who stands in for you while you are away, and whom you stand in for (see [Stand-ins](#stand-ins)).

A step you see because you stand in for someone is marked **Standing in for** and their name.

You are notified (kind **Approvals**) when a step needs you, when an approval you asked for is approved or rejected, and when an overdue step is escalated to you. The notification opens the record.

### Approving or rejecting

Select **Approve** or **Reject**, on the Approvals page or in the record's approval panel. A comment is optional when you approve and required when you reject: the person who asked sees it, and it stays on the record.

- One rejection rejects the whole request: the remaining steps do not run.
- A step that needs several approvals (for example **All of them**, or **2 of them**) moves on once enough people approve. Each person decides once.
- **You never approve your own request.** The person who asked (by hand, or by making the change that started the workflow) is left out of the approvers, even when named in the workflow, and the application refuses their decision.
- You only see, and can only decide, approvals for records you may open. A restricted record goes only to approvers who may see restricted records.
- When the approval belongs to another part of the application (for example a risk acceptance), you must still hold that part's approve permission **when you decide**. If an administrator takes it away while a step waits for you, the step leaves your list and your decision is refused.
- A step can ask for **a different person from the other steps**: if you decided another step of the same request, you cannot decide that one, and it is not offered to you. The executive step of the ready-made Risk acceptance workflow works this way.
- When the record is deleted, its running workflows are canceled ("The record was deleted.") and leave everyone's lists.

Every start, decision, escalation, reassignment and outcome is recorded on the record's **History** tab.

## Stand-ins

When you will be away, name someone to stand in for you on approvals: on the **Approvals** page, open **Stand-ins**, choose the **Stand-in**, the **From** and **To** days (both included, at most a year) and an optional **Note** (for example "annual leave"), and select **Save stand-in**. They are told. Administrators can name a stand-in for anyone with **For**, see everyone's with **Show everyone's**, and end any of them.

While the period runs:

- every approval step that goes to you also goes to your stand-in, including steps already waiting when the period starts; **either of you may decide**, once between you;
- a decision by your stand-in is recorded as made **on your behalf** ("Jordan Lee on behalf of Sam Patel") on the record, in its history and in the part's own record of decisions;
- a stand-in never decides a request they made themselves, only receives restricted records they may already see, must hold the permission the part asks of its approvers (for example **Approve** on **Change enablement**), and does not pass the step on to their own stand-in (no chains).

Select **End** to stop a stand-in early; from then on they can no longer decide for you.

You can also name your stand-in from your own **Account security** page (your name at the top right > **Account security**): the **Stand-in for approvals** card lists the stand-ins you named and those naming you, and **Name a stand-in** opens the same form. Both places show the same periods.

## The approval panel on a record

When a workflow is running on a record, a panel under its title shows:

- the workflow and **Waiting for approval**;
- who asked, when, and their note;
- the steps in order: done steps show a check mark, the current one shows how many have approved, a step that only applies when its conditions hold says so, and a step that did not apply says **Skipped**;
- **Waiting for**: the approvers of the current step (a check mark beside those who have approved) and the time left;
- **Your decision is needed** with **Approve** and **Reject**, when it is your turn;
- **Stand-ins**: people standing in for an approver of the current step, and for whom;
- each decision so far, with comments ("on behalf of" for a stand-in's decision).

A step whose groups run **side by side** shows one box per group (for example **Finance** and **Operations**), each with its own **Waiting for**, due time and status (**Waiting**, **Approved**, **Not needed** when its conditions did not hold). The step is done once every group has approved; a rejection in any group rejects the request and stops the others. On the **Approvals** page such a step is named "Step: Group", for example "Finance and operations: Operations".

When the record is **waiting for approval to move to a new status** (see [Lifecycles](23-lifecycles.md#changes-that-wait-for-approval)), the panel starts with a line such as *Waiting for approval to move to Scheduled (now In review)*: the status changes when the workflow is approved, and stays as it is when it is rejected or canceled.

**Cancel request** stops a running workflow. Only the person who asked, or an administrator, can cancel it. Administrators also see **Reassign**: choose the approver to replace (**Instead of**) and the person to **Hand it to**; the new approver must be able to decide (active, not the requester, able to see the record), is told, and the reassignment is recorded in the history. Earlier workflows on the record are listed under **earlier approvals**.

### Asking for approval

Workflows that belong to another part of the application (a change approval, a disposal request...) are started by that part, as its own pages describe, never from this panel. When an administrator has made a workflow for this kind of record, people who may edit the record see **Request approval** at the bottom of the panel (a menu when there are several). Choose the workflow, add a note for the approvers if you like, and select **Send for approval**. A workflow already running on the record cannot be started twice.

## Setting up workflows (administrators)

Open **Administration > Approval workflows**. The **Workflows** tab lists every workflow by kind of record, with its steps, whether it is active and how many are running. **New workflow** opens the editor; select a workflow's name to change it.

The editor has four parts, and on the right (above, on a narrower screen) **How it runs**: a picture of the workflow from start to finish that changes as you edit. Select a step in the picture to open it in the form.

### What it is for

- **Name**, **Record type** and an optional **Description** (shown to people when they ask for this approval).
- **Used for** (new workflows, when the record type has one): **Its own approval**, or the approval of another part of the application, such as **Change approval** for changes. It cannot be changed later. Such a workflow is started by that part, so **What starts it** shows when that happens and what approval and rejection do to the record; **Which records** then picks among the workflows of that kind (the one with the most conditions that all hold; between equals, the oldest).
- **Active**: an inactive workflow starts nothing; any already running carry on.

### What starts it

- **When someone asks for approval on the record**: only by hand, from the record's panel.
- **When a record is created**.
- **When a field changes to a value**: choose a list field (usually **Status**) and the value, for example "Status changes to Submitted".

**Which records** narrows it with conditions on the record's fields, all of which must hold: for example **Priority is one of P1 Critical or P2 High**, or **Cost is more than 5,000**. Comparisons depend on the field: lists offer **is**, **is not** and **is one of**; numbers, amounts and dates also **is more than**, **is at least**, **is less than** and **is at most**; any field **is empty** or **is filled in**.

Any active workflow for the record type can also be started by hand from the record page, whatever starts it automatically.

### Approval steps

Steps run in order (use the arrows to reorder them; up to ten). For each step:

- **How it is approved**: **One set of approvers** (most steps), or **Several groups side by side** when, for example, finance and operations must both approve at the same time. Each group (two to five) has a **Group name**, its own **Who approves**, **How many must approve** and due time, and optionally **When this group takes part** (conditions: for example the operations group only when the work is urgent). Every group that takes part must approve before the workflow moves on; one rejection in any group rejects the request.
- **Who approves**:
  - **Named people**: choose them one by one;
  - **Everyone with a role**: every active person holding that role when the step starts;
  - **A person on the record**: the person a field names, such as the owner, the project manager or the assignee;
  - **The head of a department**: of the requester's department, or of the department a field names (a department name, or a person whose department is used). Set each department's head on the **Department heads** tab; the departments themselves are under **Administration > Settings > Departments**;
  - **Named people and roles together**: chosen people and the members of chosen roles;
  - **Everyone who holds a permission**: for example everyone with `changes.approve`.
- **How many must approve** (named people, roles and permissions): **Any one of them**, **All of them**, or a number.
- **A different person from the other steps** (optional): someone who decided another step (or group) of the same request is left out of this step's approvers and cannot decide it, so two steps always mean two people. If that leaves nobody, the step goes to the people it escalates to, or waits for an administrator to reassign it.
- **When this step applies**: conditions, as above. A step whose conditions do not hold when it is reached is skipped, for example a finance step only when the cost is more than a set amount.
- **Due within** (hours or days, optional). When a step is past its due time, its approvers who have not decided are reminded, and the people it **escalates to** (named people, a role or both) are told and may decide too. If nobody named by a step can approve it (inactive, the requester, or unable to see the record), it goes straight to the people it escalates to; if there are none, the panel says so and an administrator can cancel the workflow.
- **After this step** (optional routes): where the workflow goes once the step is approved. Add a route, choose a later step (or **Finish: approved**) under **go to**, and the conditions that send a record there, for example "If **Cost is more than 10,000**, go to **Director**". The first route whose conditions all hold is taken; with none, the workflow goes on to the next step. A route without conditions is always taken, which is how a cheaper branch skips the director step: "after **Small purchase**, finish". Routes only go forward, so a workflow never loops; the steps passed over are shown as skipped ("Not on this record's route"). The picture shows each route under its step.

Workflows saved before groups and routes existed keep working exactly as they did; they simply have none.

### At the end

**When approved** and **When rejected** each set fields on the record, for example **Status to Approved**, or **Approved on to the day it ends** and **Approved by to the last approver**. A person field can be set to **the last approver**, **the requester** or a named person. The change is made by the application and recorded on the record's history; if the record's own rules refuse it, the workflow still ends and the panel shows why the fields could not be set.

### Changing and removing workflows

Saving a workflow gives it a new version. Workflows already running keep the version they started with, so a change never moves a request mid-way. **Remove** stops the workflow from starting; those running finish as they are. When a status change waits for the workflow (Administration > Lifecycles), the editor says so: while the workflow is inactive or removed, that status change is refused until another workflow is chosen on the Lifecycles page.

The **Running now** tab lists every workflow waiting for approval, with the step it is waiting at and any problem (such as a step nobody can approve), and **Cancel** for each. A record you may not see is not named. When approvers a step still needs are deactivated or removed, so it can no longer get the approvals it needs (for example **All of them** and one of them has left), the check that runs every 15 minutes shows that as the step's problem and tells the administrators once (**Approval stuck**); reassign the step or cancel the workflow. A workflow whose record was deleted some other way is canceled by the same check, and an administrator can cancel it at any time.

## Approvals of other parts

These parts of the application hand their approvals to workflows. Each has a ready-made workflow (made once, from that part's own settings, on a new installation and when upgrading) that administrators can change like any other: add steps, due times and escalation, or change who approves. The part still enforces its own rules, for example that a change cannot start before it is approved, and approvers must hold that part's approve permission.

| Part | Used for | Starts when | Ready-made workflow | Approval and rejection |
|---|---|---|---|---|
| [Change enablement](10-change-enablement.md#approvals) | **Change approval** | A change is submitted | One per approval rule: its approvals and approvers are the first step, kept in line with the rule | Approved; rejected (after the work started: asked again) |
| [Service desk](02-service-desk.md) | **Catalog request approval** | A request is raised from a catalog item that needs approval (for the chosen answers) | From each catalog item's earlier approval settings, plus a default | The request's approval status |
| [Inventory](03-inventory.md) | **Asset disposal** | Someone asks for an asset to be disposed of | Inventory manager, then the funder when the asset has a funder interest | The approver and date are written on the asset; refused with the reason |
| [Risks](06-risks-actions-obligations.md) | **Risk acceptance** | The owner asks for a risk to be accepted | Risk approver, then an executive approver (a different person) at or above the scale's threshold | The acceptance is recorded (approver, date, expiry) and the risk becomes Accepted, whatever the approver may set by hand; rejected: the risk stays open |
| [Corrective action plans](24-corrective-action-plans.md) | **Corrective action plan approval** and **Due-date extension** | A plan is submitted; someone asks for more time on an action of an approved plan | One step, anyone who may approve actions | The plan is approved and work starts, or the new due date is set; rejected: the plan goes back to draft, or the due date stays |
| [Audits and inspections](25-audits-and-inspections.md#closing-an-audit) | **Audit report approval** | Someone asks for an audit's report to be approved, once it has a summary and a response or plan on every finding | "Audit report approval": one step, anyone with `audits.approve` | The approval is recorded on the audit and it closes; rejected: it stays in Reporting |
| [Funding and grants](27-funding-and-grants.md#sign-off) | **Funding certification sign-off** | Someone sends a yearly certification for signing once every applicable item is confirmed | "Funding certification sign-off": the authorized official named on the certification | The certification is signed and dated; rejected: it goes back to draft with the reason in its history |
| [Committees and meetings](28-committees-and-meetings.md) | **Minutes approval** and **Plan review** | Minutes are submitted for approval; the annual review of a plan starts | The meeting's chair; for a plan, the accountable executive, the governing body and the safety committee, each a different person | The minutes are approved and the meeting is locked, or the plan's next review date is set; rejected: back to draft |
| [Safety management](20-safety-management.md) | **Safety performance targets** | Someone asks for a year's targets to be approved | One step, anyone who may approve in safety | The targets are approved for the year; rejected: they stay proposed |
| [Business continuity](30-business-continuity.md#approval-and-review) | **Continuity plan approval** | Someone selects **Submit for approval** on a continuity or emergency plan | "Continuity plan approval": one step, anyone with `continuity.approve` | The plan is Approved, with the approval date and its next review date; rejected: it goes back to Draft with the reason |
| [Business continuity](30-business-continuity.md#impact-analysis) | **Impact analysis sign-off** | Someone selects **Submit for sign-off** on an impact analysis whose process has an owner | "Impact analysis sign-off": one step, the process owner (who needs only `continuity.view`) | The analysis is signed off as **Sign off** does: its downtime and targets are copied onto the process and the next analysis becomes due; rejected: it goes back to Draft with the reason. Someone with `continuity.approve` can still sign it off directly, which cancels the request |
| [Asset condition](31-asset-condition.md#yearly-targets) | **Asset condition targets** | Someone asks for an asset class's target for a year to be approved | "Asset condition targets": one step, anyone with `assets.approve` | The target is approved for the year (approver and date); rejected: it goes back to draft with the reason in its note. A target can also be approved directly, with a decision reference |
| [Legal holds](33-legal-holds.md#release-a-hold) | **Legal hold release** | Someone asks for an active hold to be released | One step, anyone with `legal.approve` | The hold is released and its records follow their retention periods again; rejected: the hold stays active |
| [Records requests and privacy](37-records-requests-and-privacy.md#privacy-impact-assessments) | **Privacy impact assessment** | An assessment is submitted for approval | One step, anyone with `privacy.approve` | The assessment is approved and its next review date is set; rejected: it goes back to Draft |
| [Vendor risk lifecycle](34-vendor-risk-lifecycle.md#sign-off) | **Vendor offboarding sign-off** | Someone signs off an offboarding whose items are all done or not applicable | One step, anyone with `vendors.approve` | The offboarding is signed off with the approver's name and date; rejected: it stays in progress, with the reason in its history |
| [Projects](08-projects.md) | **Project gate decision** | Someone asks for a gate decision once its checklist and documents are complete | "Gate decision", named on a gate template by an administrator | The gate passes as a recorded decision does; rejected: it stays open. While a gate's template names a workflow, only an administrator can record its decision by hand, with a reason, and never the person who asked |

Approvals that were waiting when a part moved to workflows carried on there, with the decisions already given (marked as recorded before the move); earlier decisions stay on the records. Each part's page says what changed for it, and decisions given outside the application can still be recorded by hand where they could before.

### Switched-off parts and webhooks

A workflow for a kind of record whose part of the application is switched off under **Administration > Features** is hidden and does nothing while it is off: it is not listed here, it does not start, its running approvals leave the Approvals lists and are not escalated, and everything comes back when the part is switched on again.

Webhooks can send **Approval decided** (each decision) and **Approval workflow finished** (approved, rejected or canceled); both are as restricted as the record (see [Administration](09-administration.md#other-events)).

AI assistants can list the approvals waiting for you (a group of a step side by side is named "Step: Group") and, with write access, approve or reject one (see [AI assistants and MCP](21-ai-assistants-and-mcp.md)). When an assistant changes a status that waits for approval, it is told that the status stays as it is until the workflow approves it.
