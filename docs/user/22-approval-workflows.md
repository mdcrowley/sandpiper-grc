# Approval workflows

An approval workflow sends a record through ordered approval steps before something happens: a high-priority purchase request needs a buyer and then the department head; a vehicle taken out of service needs the fleet manager; an asset disposal needs the inventory manager. An administrator defines the workflows; everyone else meets them as an **approval panel** on the record page, in the **Approvals** page and in their notifications.

Workflows work with any kind of record. Some parts of the application also keep approval rules of their own (change approvals, multi-person approval of catalog requests, project gates, asset disposal requests); those keep working as before, and a workflow can run beside them.

## Approvals waiting for you

Open **Approvals** in the **Home** group of the sidebar. It has three tabs:

- **Waiting for me**: every approval step waiting for your decision, the soonest due first. Each shows the record (select it to open the record), the workflow, which step of how many it is (the small bars), who asked, how many approvals the step has and needs, and the time left before it is due. An overdue one has a red edge; **Escalated** means it went past its due time and was passed to more people.
- **Decided by me**: what you approved or rejected, with your comment.
- **My requests**: the approvals you asked for, or that started when you changed a record, with where each stands: **Waiting for approval**, **Approved**, **Rejected** or **Canceled**.

You are notified (kind **Approvals**) when a step needs you, when an approval you asked for is approved or rejected, and when an overdue step is escalated to you. The notification opens the record.

### Approving or rejecting

Select **Approve** or **Reject**, on the Approvals page or in the record's approval panel. A comment is optional when you approve and required when you reject: the person who asked sees it, and it stays on the record.

- One rejection rejects the whole request: the remaining steps do not run.
- A step that needs several approvals (for example **All of them**, or **2 of them**) moves on once enough people approve. Each person decides once.
- **You never approve your own request.** The person who asked (by hand, or by making the change that started the workflow) is left out of the approvers, even when named in the workflow, and the application refuses their decision.
- You only see, and can only decide, approvals for records you may open. A restricted record goes only to approvers who may see restricted records.

Every start, decision, escalation and outcome is recorded on the record's **History** tab.

## The approval panel on a record

When a workflow is running on a record, a panel under its title shows:

- the workflow and **Waiting for approval**;
- who asked, when, and their note;
- the steps in order: done steps are ticked, the current one shows how many have approved, a step that only applies when its conditions hold says so, and a step that did not apply says **Skipped**;
- **Waiting for**: the approvers of the current step (a tick beside those who have approved) and the time left;
- **Your decision is needed** with **Approve** and **Reject**, when it is your turn;
- each decision so far, with comments.

**Cancel request** stops a running workflow. Only the person who asked, or an administrator, can cancel it. Earlier workflows on the record are listed under **earlier approvals**.

### Asking for approval

When an administrator has made a workflow for this kind of record, people who may edit the record see **Request approval** at the bottom of the panel (a menu when there are several). Choose the workflow, add a note for the approvers if you like, and select **Send for approval**. A workflow already running on the record cannot be started twice.

## Setting up workflows (administrators)

Open **Administration > Approval workflows**. The **Workflows** tab lists every workflow by kind of record, with its steps, whether it is active and how many are running. **New workflow** opens the editor; select a workflow's name to change it.

The editor has four parts, and on the right (above, on a narrower screen) **How it runs**: a picture of the workflow from start to finish that changes as you edit. Select a step in the picture to open it in the form.

### What it is for

- **Name**, **Record type** and an optional **Description** (shown to people when they ask for this approval).
- **Active**: an inactive workflow starts nothing; any already running carry on.

### What starts it

- **When someone asks for approval on the record**: only by hand, from the record's panel.
- **When a record is created**.
- **When a field changes to a value**: choose a list field (usually **Status**) and the value, for example "Status changes to Submitted".

**Which records** narrows it with conditions on the record's fields, all of which must hold: for example **Priority is one of P1 Critical or P2 High**, or **Cost is more than 5,000**. Comparisons depend on the field: lists offer **is**, **is not** and **is one of**; numbers, amounts and dates also **is more than**, **is at least**, **is less than** and **is at most**; any field **is empty** or **is filled in**.

Any active workflow for the record type can also be started by hand from the record page, whatever starts it automatically.

### Approval steps

Steps run in order (use the arrows to reorder them; up to ten). For each step:

- **Who approves**:
  - **Named people**: choose them one by one;
  - **Everyone with a role**: every active person holding that role when the step starts;
  - **A person on the record**: the person a field names, such as the owner, the project manager or the assignee;
  - **The head of a department**: of the requester's department, or of the department a field names (a department name, or a person whose department is used). Set each department's head on the **Department heads** tab; the departments themselves are under **Administration > Settings > Departments**.
- **How many must approve** (named people and roles): **Any one of them**, **All of them**, or a number.
- **When this step applies**: conditions, as above. A step whose conditions do not hold when it is reached is skipped, for example a finance step only when the cost is more than a set amount.
- **Due within** (hours or days, optional). When a step is past its due time, its approvers who have not decided are reminded, and the people it **escalates to** (named people, a role or both) are told and may decide too. If nobody named by a step can approve it (inactive, the requester, or unable to see the record), it goes straight to the people it escalates to; if there are none, the panel says so and an administrator can cancel the workflow.

### At the end

**When approved** and **When rejected** each set fields on the record, for example **Status to Approved**, or **Approved on to the day it ends** and **Approved by to the last approver**. A person field can be set to **the last approver**, **the requester** or a named person. The change is made by the application and recorded on the record's history; if the record's own rules refuse it, the workflow still ends and the panel shows why the fields could not be set.

### Changing and removing workflows

Saving a workflow gives it a new version. Workflows already running keep the version they started with, so a change never moves a request mid-way. **Remove** stops the workflow from starting; those running finish as they are.

The **Running now** tab lists every workflow waiting for approval, with the step it is waiting at and any problem (such as a step nobody can approve), and **Cancel** for each. A record you may not see is not named.

### Switched-off parts and webhooks

A workflow for a kind of record whose part of the application is switched off under **Administration > Features** does nothing while it is off: it does not start, its running approvals leave the Approvals lists and are not escalated, and they come back when the part is switched on again.

Webhooks can send **Approval decided** (each decision) and **Approval workflow finished** (approved, rejected or canceled); both are as restricted as the record (see [Administration](09-administration.md#other-events)).

AI assistants can list the approvals waiting for you and, with write access, approve or reject one (see [AI assistants and MCP](21-ai-assistants-and-mcp.md)).
