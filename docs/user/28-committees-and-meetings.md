# Committees and meetings

The committee pages hold the work of your organization's committees: the **governing body** (a board of directors or similar), a **risk committee**, a **safety committee** (including a joint labor-management one), an **audit committee** or any other. For each committee you keep its members and the side each sits for, its quorum rule and its meetings. For each meeting you keep the agenda, the report pack sent out beforehand, who attended, the minutes the chair approves, the decisions taken and the actions agreed. Open them from the **Governance** group in the navigation: **Committees**, **Meetings** and **Decisions**. The pages share tabs along the top with the same names. Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not run its committees here, an administrator can switch **Committees and meetings** off under **Administration > Features** (see [Administration](09-administration.md#features)). The committee pages, their reminders, the "Meeting" source in the action tracker and the committee notifications then disappear. Records are kept and return when it is switched back on.

You need the **governance** permissions: `governance.view` to read committees, meetings and decisions, `governance.create` and `governance.edit` to plan meetings, keep agendas, record attendance and decisions, `governance.delete` and `governance.export`, and `governance.administer` to send the reminders by hand. The default **Compliance officer** role holds all of them; **Security lead**, **Safety manager**, **Audit lead**, **Auditor** and **Executive viewer** can read the pages. An administrator can grant the permissions to any other role under **Administration > Roles**.

A plan, such as the safety plan, is a policy: its element map and its yearly review are on the policy's page (see [Plans](11-policies-and-exceptions.md#plans)).

## Committees

Open **Committees**. Filter by kind, status, chair or whether the committee is a joint labor-management one.

### Set up a committee

1. Select **New committee**, or **Create** then **Committee**.
2. Enter the **Name** and choose the **Kind**: **Governing body**, **Risk committee**, **Safety committee**, **Audit committee** or **Other**.
3. Describe its **Purpose and terms of reference**.
4. Choose the **Chair** and the **Secretary**. Both are people with an account: the chair approves the minutes and can decide approvals at meetings, and the secretary prepares meetings and is reminded about packs and minutes.
5. Set the quorum: **Quorum counted as** a **Number of voting members** or a **Percentage of voting members**, and the **Quorum** (for example 3, or 60). A percentage is rounded up. With no quorum set, a majority of the voting members is needed.
6. Choose how often it **Meets**, and tick **Joint labor-management committee** if management and frontline staff sit on it together.
7. Select **Create committee**. It gets a reference such as `COM-00001`.

### Members

Open the committee and its **Members** tab. Members are listed by side: **Management**, **Labor**, **Independent** and **Not applicable**. The line above the list says how many voting members are in office today and how many must be present for a quorum. A joint labor-management committee without members in office from both management and labor shows a warning.

To add a member, select **Add a member** and give any of:

- an **Account**, for someone who signs in (needed to be named as an approver, or to be reminded);
- a **Roster person**, for someone on the staff roster without an account (see [People and qualifications](29-people-and-qualifications.md)); this box is shown when the roster is part of your installation;
- a **Name**, for anyone else (for example an independent board member).

The name of an account or roster person is read from them, so it stays up to date. Then choose the **Side** and the **Role** (**Chair**, **Member** or **Alternate**), whether the member **Votes** (only voting members count toward the quorum), and the term (**Member from** and **Member until**). Someone whose term has ended stays on the list, marked **Not in office**, and no longer counts toward the quorum of later meetings. **Remove** takes a member off the committee; past attendance keeps their name.

### Meetings and approvals waiting for the chair

The **Meetings** tab lists the committee's meetings and plans a new one. The **Waiting for the chair** tab lists the approvals now waiting for the chair's decision (for example a risk acceptance, a corrective action plan or a plan review) on records you may see, so they can be put on an agenda.

## Meetings

Open **Meetings**, or the committee's **Meetings** tab. Filter by committee, status, date or whether the quorum was met.

### Plan a meeting

1. Select **New meeting**, or **Create** then **Meeting**.
2. Choose the **Committee**, and enter the **Title**, the **Date and time** and the **Location or call details**.
3. Select **Create meeting**. It gets a reference such as `MTG-00001`, and the committee's chair and secretary are recorded with it.

Meetings reach members' calendars through a personal calendar feed (see [Calendar feeds](36-calendar-feeds-work-trackers-and-evidence-links.md#calendar-feeds)).

A meeting moves through **Planned**, **Agenda published**, **Held** and **Minutes approved**, shown along the top of its page. Use **Publish agenda**, **Mark as held** and **Cancel meeting** at the top of the page. **Minutes approved** is set only by the chair's approval (see [Minutes](#minutes)).

### Agenda

On the **Agenda** tab, **Add an item** adds a title, the presenter, notes and, if the item is about a record, the record (choose its type, then the record). The arrows change the order. **Add a waiting approval** lists the approvals waiting for the chair; **Put on the agenda** adds one as an item, linked to the record and to that approval.

A record that someone reading the agenda may not see (for example a restricted risk) is shown as "A record you cannot see".

### Pack

The **Pack** tab keeps the report pack sent to the members before the meeting. Choose a **Report pack** (see [Dashboards and reports](15-dashboards-and-reports.md)) and select **Freeze pack**: the pack is produced at once, with your permissions, and kept with the meeting, so its figures stay exactly as the members saw them. Freezing again replaces it. The pack opens under Reports, which applies its own access rules. Freezing needs permission to export reports (`reports.export`).

### Attendance and quorum

On the **Attendance** tab, tick who was **Present** and who sent **Apologies**, then **Save attendance**. Members in office on the day of the meeting are listed. The line above the list says how many voting members were present, how many were needed and whether the **quorum** was met; the meeting's **Quorum met** shows the same.

### Minutes

Write the minutes on the **Minutes** tab. Once the meeting is **Held**, the secretary selects **Submit minutes for approval**: the **Minutes approval** workflow asks the chair of the meeting to approve them (see [Approval workflows](22-approval-workflows.md)). The chair approves or rejects them under **Approvals**, or on the meeting's page. While they wait they cannot be changed. When the chair approves them, the meeting becomes **Minutes approved** and is locked: its details, minutes, agenda, attendance and decisions can no longer be changed. When the chair rejects them, the meeting stays **Held**, with the reason in its history, so the minutes can be corrected and submitted again.

The chair cannot submit minutes for their own approval: the secretary submits them.

### Decisions

On the **Decisions** tab, **Record a decision** records what the committee decided:

1. Choose the **Agenda item** (its record is filled in for you), or leave it empty.
2. Write the **Decision**, and choose the **Outcome**: **Approved**, **Rejected**, **Noted** or **Deferred**.
3. If the decision is about a record, choose its type and the **Record decided**.
4. Add **Notes** if needed and select **Record**.

The decision gets a reference such as `DEC-00001` and is linked to the record decided (relation "decided"), so it also shows on that record's **Related** tab. A decision about a restricted record (a risk, a security incident) is restricted too: only people who may see restricted records see it.

### Apply a decision to a waiting approval

When an approval on the record decided is waiting for the chair, an **Approved** or **Rejected** decision can complete that step: select **Apply to approval**. The step is then decided as the chair's own decision, with the comment "Decided at" and the meeting's reference, and every rule of the approval applies as if the chair had decided it under **Approvals**:

- the chair must be one of the approvers of the step now waiting;
- the chair must still hold the permission the approval needs and be able to see the record;
- the chair cannot decide an approval they asked for;
- where a step asks for a different person from the earlier steps, a chair who decided an earlier step cannot decide this one.

When one of these rules stops it, the decision is not applied and the message says so; decide it on the approval itself instead.

Only the chair may apply a decision while the minutes wait. Once the chair has approved the minutes, the secretary (with `governance.edit`) may apply the decisions recorded in them. A decision is applied once, and its outcome and record can no longer be changed afterward. Both the decision and the record decided keep an entry in their history.

### Actions

The **Actions** tab holds the actions agreed at the meeting, kept in the action tracker under the source **Meeting** (see [Risks, actions and obligations](06-risks-actions-obligations.md)).

## Decisions register

Open **Decisions** for every decision of every committee, with its meeting, outcome and whether it was applied to an approval. Filter by outcome, meeting or date, and export the list. A decision's page shows the record decided and, for the chair or secretary, **Apply to approval**.

## Reminders

Every hour the application reminds the secretary of a committee (or, when none is named, everyone who may edit committee records):

- **Meeting pack due**: a meeting is coming up within **5 days** with no frozen pack. Each meeting date is announced once.
- **Minutes waiting**: a meeting was held more than **7 days** ago and its minutes have not been submitted for approval. Each meeting is announced once.

An administrator can change the lead time for packs (**Remind secretaries before a meeting's pack is due**, setting `governance.pack_days`) under **Administration > Reminders**. People can switch these notifications off under their notification settings (**Committees and meetings**).

## Figures for AI assistants

An AI assistant you connect ([AI assistants and MCP](21-ai-assistants-and-mcp.md)) can give the committee figures: active committees, meetings coming up in the next 30 and 90 days (and those without a frozen pack), meetings held in the last year and whether they had a quorum, minutes still to write up (and how many are late) or waiting for the chair, and decisions by outcome. These are counts only, the same for everyone who may see committee records: no meeting titles, names or decision wording.

## Retention

When a committee reaches the end of its retention period and is anonymized (**Administration > Retention**), the names typed for members who have neither an account nor a roster record are replaced as well. Members linked to an account or a roster person keep no name of their own on the committee: theirs is read from that record, which has its own retention.

## Sample data

The `dev` sample data has three invented committees: a board of directors, a risk and audit committee and a joint safety committee with management and labor members. It has four meetings: two held (one with approved minutes), with attendance, agendas and decisions, and two planned. Two actions were agreed at the safety committee. A sample safety plan has its element map and last year's review. When the sample data is loaded again and an approval waits for the board's chair (for example a corrective action plan), a sample decision of the board's last meeting is applied to it. Every sample record is marked as such.
