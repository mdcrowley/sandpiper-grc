# Committees and meetings

The committee pages hold the work of your organization's committees: the **governing body** (a board of directors or similar), a **risk committee**, a **safety committee** (including a joint labor-management one), an **audit committee** or any other. For each committee you keep its members and the side each sits for, its quorum rule and its meetings. For each meeting you keep the agenda with each item's papers, the board book and report pack sent out beforehand, who attended, the minutes written item by item with the motions and votes, their approval and publication, the decisions taken and the actions agreed. Members of a committee read its agendas, board books and published minutes in their own reading view, without any other access. Open them from **Governance and records > Committees** in the navigation; **Committees**, **Meetings** and **Decisions** are tabs along the top. The pages share tabs along the top with the same names. Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not run its committees here, an administrator can switch **Committees and meetings** off under **Administration > Features** (see [Administration](09-administration.md#features)). The committee pages, their reminders, the "Meeting" source in the action tracker and the committee notifications then disappear. Records are kept and return when it is switched back on.

You need the **governance** permissions: `governance.view` to read committees, meetings and decisions, `governance.create` and `governance.edit` to plan meetings, keep agendas, record attendance and decisions, `governance.delete` and `governance.export`, and `governance.administer` to send the reminders by hand. The default **Compliance officer** role holds all of them; **Security lead**, **Safety manager**, **Audit lead**, **Auditor** and **Executive viewer** can read the pages. An administrator can grant the permissions to any other role under **Administration > Roles**. A committee's members, chair and secretary need none of them to read their meetings in the member reading view (see [Member reading view](#member-reading-view)).

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
7. Optionally give a **Resolution number prefix**, such as `R-`. Resolution numbers are then the prefix, the year of the meeting and a running number: `R-2026-01`, `R-2026-02`, and so on (see [Motions and votes](#motions-and-votes)).
8. Select **Create committee**. It gets a reference such as `COM-00001`.

### Members

Open the committee and its **Members** tab. Members are listed by side: **Management**, **Labor**, **Independent** and **Not applicable**. The line above the list says how many voting members are in office today and how many must be present for a quorum. A joint labor-management committee without members in office from both management and labor shows a warning.

To add a member, select **Add a member** and give any of:

- an **Account**, for someone who signs in (needed to be named as an approver, or to be reminded);
- a **Roster person**, for someone on the staff roster without an account (see [People and qualifications](29-people-and-qualifications.md)); this box is shown when the roster is part of your installation;
- a **Name**, for anyone else (for example an independent board member).

The name of an account or roster person is read from them, so it stays up to date. Then choose the **Side** and the **Role** (**Chair**, **Member** or **Alternate**), whether the member **Votes** (only voting members count toward the quorum), and the term (**Member from** and **Member until**). Someone whose term has ended stays on the list, marked **Not in office**, and no longer counts toward the quorum of later meetings. **Change** edits a member (for example to end their term), and **Remove** takes a member off the committee; past attendance keeps their name.

### Meetings

The **Meetings** tab lists the committee's meetings and plans a new one.

### Annual work plan and agenda posting deadline

The **Work plan** tab keeps the standing items the committee takes every year: the budget, the audit plan, the risk register review, a progress report at every meeting. **Add a standing item** gives its title, the **Months** it is due (none: at every meeting), a presenter, open or closed session and notes for the agenda. The table shows, for the year chosen, which meeting took each item.

A meeting's **Agenda** tab lists the standing items due in its month that are not on its agenda yet; **Add them to the agenda** adds them as agenda items, linked to the plan.

A committee may set **Agenda posted at least this many days before the meeting** (for example 3, or what your bylaws or open-meetings rules require). The meeting's **Agenda** tab then says the day the agenda must be posted by (and when that day has passed while the agenda is not published), and the secretary is reminded from two days before that day until the agenda is published.

### Approvals waiting for the chair

The **Waiting for the chair** tab lists the approvals now waiting for the chair's decision (for example a risk acceptance, a corrective action plan or a plan review) on records you may see, so they can be put on an agenda.

## Meetings

Open **Meetings**, or the committee's **Meetings** tab. Filter by committee, status, date or whether the quorum was met.

### Plan a meeting

1. Select **New meeting**, or **Create** then **Meeting**.
2. Choose the **Committee**, and enter the **Title**, the **Date and time**, the **Length (minutes)** (an hour if you leave it empty) and the **Location or call details**.
3. Select **Create meeting**. It gets a reference such as `MTG-00001`, and the committee's chair and secretary are recorded with it.

Meetings reach members' calendars through a personal calendar feed (see [Calendar feeds](36-calendar-feeds-work-trackers-and-evidence-links.md#calendar-feeds)), or by an invitation email.

### Invitations

The **Invitations** tab lists the committee's members in office on the day of the meeting and how each is reached: **By email** (their account's address), **By email (staff roster address)** for a member who is a roster person, or **No email address: tell them yourself** for a member known only by name.

- **Email invitations** sends each member an email with the meeting attached as a calendar file (`invitation.ics`). Opening it adds the meeting to their calendar, with the time, length, place and a link to the meeting here. You are named as the organizer when your account has an email address. Replies are not collected: record who came under **Attendance**.
- After a change of time, length or place, **Email the updated invitation** sends it again. Calendars move the same event rather than adding a second one.
- Once the meeting is canceled, **Email the cancellation** sends a cancellation that takes the meeting off their calendars.
- **Download calendar file** gives you the same file to send or import yourself, for example while email is not set up.

Invitations can be emailed by anyone who may edit meetings, while email is set up (see [Email](14-attachments-and-notifications.md)), and not for a meeting that has already taken place. **Invitations sent** on the meeting shows when they were last emailed, and each sending is in the meeting's history. Invitations for one meeting (updates and cancellations included) can be emailed at most 10 times in an hour; after that, wait a while or download the calendar file.

A meeting moves through **Planned**, **Agenda published**, **Held** and **Minutes approved**, shown along the top of its page. Use **Publish agenda**, **Mark as held** and **Cancel meeting** at the top of the page. **Minutes approved** is set by the chair's approval through the workflow, or by recording that a later meeting approved them (see [Minutes](#minutes)). Publishing the agenda tells the committee's members who have an account that the agenda and board book are ready, with a link to their reading view. When the committee had no chair as the meeting was planned, the meeting's page says so: its minutes are then approved at a later meeting.

### Agenda

On the **Agenda** tab, **Add an item** adds:

- the **Title** and **Notes for the members**;
- the presenter: **Presenter (account)** for someone who signs in, or **Presenter (name)** for anyone else;
- the **Time allotted (minutes)**; the agenda adds up the time of every item;
- the **Session**: **Open session**, or **Closed (executive) session** for an item discussed in private (see [Closed sessions](#closed-sessions));
- **On the consent agenda**, for routine items adopted together by one motion without discussion (a closed-session item cannot be on it);
- if the item is about a record, the record (choose its type, then the record).

The arrows change the order. **Add a waiting approval** lists the approvals waiting for the chair; **Put on the agenda** adds one as an item, linked to the record and to that approval. **Change** edits an item and **Remove** takes it off the agenda (an item with a decision recorded on it cannot be removed; remove the decision first).

**Add paper** puts a paper on an item:

- **A file attached to this meeting**: upload staff reports, presentations and other papers under the meeting's **Attachments** tab first, then choose the file. A PDF paper is appended to the board book; a Word (`.docx`), Markdown or text paper is printed in it; other files are named in the book, to open in the application.
- **A controlled document from the library**: a policy, procedure or other document from the document library (see [Policies and exceptions](11-policies-and-exceptions.md)). The board book prints the version in force (a document kept as a PDF is appended). Only documents you may read can be chosen.
- **Another record**: any record you may see, summarized in the book with its type, reference and status.

The cross beside a paper takes it off the item (a file stays attached to the meeting). A record or document that someone reading the agenda may not see (for example a restricted risk) is shown as "A record you cannot see" or "A paper you cannot see".

### Closed sessions

A closed-session (executive session) item is read in full only by the committee's members (people with an account, directly or through their roster person), its chair and secretary, and the people who prepare meetings (`governance.edit`). Everyone else who may see the meeting sees that there is a **Closed session item** at that place on the agenda, never its title, notes, papers or minutes. Decisions taken on a closed-session item are left out of their lists and searches in the same way, while counts in figures stay the same for everyone. Closed-session items are left out of the public version of the board book and of the minutes, which say how many items were left out.

### Board book

The **Board book** tab makes the board book: one PDF with a cover, the agenda (with presenters, time allotted and session), then each item with its details, notes and papers. Documents and Word, Markdown and text papers are printed in the book; PDF papers are appended at the end, in order, after an **Appendices** page listing on which pages of the file each starts.

- **Public version** leaves closed-session items out, and with them restricted records and documents with restricted distribution.
- **Members' version** includes closed-session items, marked on every page as for committee members only. It is offered to the chair, the secretary and the people who prepare meetings; members get it in their reading view.
- **Text only** prints the text read from each PDF paper in place of its pages. Use it with a screen reader: the book's own pages are tagged for accessibility (PDF/UA), but the pages of appended PDF papers are kept as they were supplied and are not described.

Each book is made from the papers as they are at that moment, with your own access: a paper you may not see is left out and named as such. A PDF paper that is protected by a password, damaged or too large is not appended; the book says so. Every book made is recorded in the meeting's history.

The same tab keeps the **Report pack** sent to the members before the meeting. Choose a **Report pack** (see [Dashboards and reports](15-dashboards-and-reports.md)) and select **Freeze pack**: the pack is produced at once, with your permissions, and kept with the meeting, so its figures stay exactly as the members saw them. Freezing again replaces it. The pack opens under Reports, which applies its own access rules. Freezing needs permission to export reports (`reports.export`).

### Attendance and quorum

On the **Attendance** tab, tick who was **Present** and who sent **Apologies**, then **Save attendance**. Members in office on the day of the meeting are listed. The line above the list says how many voting members were present, how many were needed and whether the **quorum** was met; the meeting's **Quorum met** shows the same.

### Minutes

The **Minutes** tab follows the agenda. For each item, write a summary of the discussion and select **Save minutes of this item**; record the motions on it with **Motion** (see [Motions and votes](#motions-and-votes)). Items on the consent agenda are listed together, with **Motion to adopt** for the one motion that adopts them. **General minutes** holds anything that belongs to no item (the call to order, announcements). The attendance and quorum come from the **Attendance** tab.

**Minutes PDF (public)** and **Minutes PDF (members)** give the minutes as a PDF: the attendance and quorum, the general minutes, and each item's discussion and motions with the mover, seconder, vote (each member's vote when recorded so), result and resolution number. Until they are approved, the PDF says **Draft: not yet approved**. The public version leaves closed-session items out.

Minutes are approved in one of two ways:

- **By the chair, through the workflow.** Once the meeting is **Held**, the secretary selects **Submit minutes for approval**: the **Minutes approval** workflow asks the chair of the meeting to approve them (see [Approval workflows](22-approval-workflows.md)). The chair approves or rejects them under **Approvals**, or on the meeting's page. While they wait they cannot be changed. When the chair rejects them, the meeting stays **Held**, with the reason in its history, so the minutes can be corrected and submitted again. The chair cannot submit minutes for their own approval: the secretary submits them.
- **At a later meeting, by a motion.** At the next meeting of the same committee, record a motion to approve the minutes, about the earlier meeting (in the motion, choose **Meeting (minutes approval)** and the earlier meeting; an item on the consent agenda works too). Back on the earlier meeting's **Minutes** tab, select **Record approval at a later meeting** and choose that decision. The approval is recorded with the date of the meeting at which the motion was carried, that meeting and the decision.

Either way the meeting becomes **Minutes approved** and is locked: its details, minutes, agenda, attendance and decisions can no longer be changed. Then select **Publish minutes**: the members can read them in their reading view and download the minutes PDF. The page shows when and by whom they were published.

### Motions and votes

On the **Minutes** tab, **Motion** on an item (or **Motion to adopt** on the consent agenda) records a motion and the decision taken on it:

1. Write the **Motion** as moved, for example "That the board adopt the revised fare policy."
2. Choose who **Moved by** and **Seconded by**: a member of the committee, or **Someone else (type the name)**. The mover and seconder must be different people.
3. Record the **Vote**: **Each member's vote** (for, against, abstain, absent or **recused** for each voting member; present members start as "for" and the others as "absent"), **Counts only**, or **No vote recorded**. The counts are shown as you go. A member who declared an interest in the item and took no part (see [Declarations of interest](#declarations-of-interest)) can only be recorded as recused (or absent).
4. Choose the **Result** (**Approved**, **Rejected**, **Noted** or **Deferred**). Left empty, the motion is approved when more members voted for it than against it. No voting rule of any one jurisdiction is built in: where your committee needs a two-thirds vote or the chair has a casting vote, choose the result yourself.
5. Give a **Resolution number**, or tick **Give it the committee's next resolution number**. A resolution number is used once in a committee.
6. If the motion is about a record, choose its type and the record (to approve the minutes of an earlier meeting, choose **Meeting (minutes approval)**).

When no attendance is recorded, or the quorum was not met, the dialog says so. **Change** beside a motion corrects it. Each motion is a decision of the register, with its reference such as `DEC-00001`, linked to its agenda item; its page shows the motion, mover, seconder and vote. An approved decision without a number can be given the next one from its page or with the API (`POST /api/meeting-decisions/:id/resolution-number`).

### Declarations of interest

A member who has an interest in an item (a relative works for a bidder, shares in a supplier, a former employer) declares it. On the meeting's **Agenda** tab, **Record a declaration** names the member, the agenda item (or the whole meeting), the interest and what they did: **Took no part (recused)**, **Left the room**, or **Stayed, with the chair's agreement**. A member who took no part or left the room is recorded as recused in the vote on that item (on every item, for a declaration about the whole meeting). Members declare their own interests from their reading view before the meeting (**Declare an interest**). The minutes list every declaration, and the public version leaves out those about closed-session items. A declaration recorded by mistake can be removed until the minutes are approved; every declaration is in the meeting's history.

### Decisions

On the **Decisions** tab, the decisions taken at the meeting are listed with their outcome, resolution number and vote. **Record a decision** records a decision without a motion:

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

Open **Decisions** for every decision of every committee, with its meeting, outcome, resolution number and vote; the mover, seconder and whether it was applied to an approval can be added from the column chooser. Filter by outcome, meeting, closed session or date, search by the motion's words or the resolution number, and export the list. A decision's page shows the motion and vote, the record decided and, for the chair or secretary, **Apply to approval**. Decisions taken in closed session are listed only for the committee's members and the people who prepare meetings.

## Member reading view

A committee's members who have an account (directly, or through their roster person), its chair and its secretary open **My work > Committee meetings**. It lists the meetings of their committees coming up and of the past year, with whether the board book is ready and the minutes are published. No other access is needed, and nobody else sees these meetings there.

A meeting's page shows the agenda once it is published, with presenters, time allotted, closed-session and consent agenda items, and each item's papers: a file paper downloads from there, and a document or record opens in the application when the member may see it. **Board book (PDF)** gives the members' version (closed-session items included) and **Board book, text only** the version with the text of PDF papers. Once the minutes are published, each item shows its minutes and **Minutes (PDF)** downloads them. Until the meeting is held, **Declare an interest** records the member's own interest in an item or the whole meeting.

Members who subscribe to a calendar feed (see [Calendar feeds](36-calendar-feeds-work-trackers-and-evidence-links.md)) can add **Meetings of committees I sit on** even without access to committees: each meeting links to their reading view. Every book, minutes and paper a member downloads is recorded in the meeting's history.

## Loading past meetings

In data load mode (see [Administration](09-administration.md)), an administrator can load past meetings with their own dates and people through the API (`POST /api/meetings`, `/api/meetings/:id/agenda`, `/api/meetings/:id/motions`, `/api/meetings/:id/minutes/approve` and `/api/meetings/:id/minutes/publish`):

- a meeting can be created as **Minutes approved**, and its agenda, minutes and motions added afterward;
- a motion's mover and seconder may be a member by name, or anyone else named as a data load names people: an account, a roster person, or `name:<their name>` for someone with neither; votes can be given per member by name;
- the resolution number, the date the motion was recorded (`created_at`), the date minutes were approved (`approved_on`) and the time they were published (`published_at`) are kept as given;
- `on_behalf_of` names the secretary who recorded them; the history keeps the administrator who loaded them.

Nothing is sent while loading: no notifications or emails reach the members.

## Reminders

Every hour the application reminds the secretary of a committee (or, when none is named, everyone who may edit committee records):

- **Meeting pack due**: a meeting is coming up within **5 days** with no frozen pack. Each meeting date is announced once.
- **Agenda to post**: the committee's agenda posting deadline is two days away or has passed and the agenda is not published. Each deadline is announced once before and once after.
- **Minutes waiting**: a meeting was held more than **7 days** ago and its minutes have not been submitted for approval. Each meeting is announced once.

An administrator can change the lead time for packs (**Remind secretaries before a meeting's pack is due**, setting `governance.pack_days`) under **Administration > Reminders**. People can switch these notifications off under their notification settings (**Committees and meetings**).

## Figures for AI assistants

An AI assistant you connect ([AI assistants and MCP](21-ai-assistants-and-mcp.md)) can give the committee figures: active committees, meetings coming up in the next 30 and 90 days (and those without a frozen pack), meetings held in the last year and whether they had a quorum, minutes still to write up (and how many are late) or waiting for the chair, and decisions by outcome. These are counts only, the same for everyone who may see committee records: no meeting titles, names or decision wording.

## Retention

When a committee reaches the end of its retention period and is anonymized (**Administration > Retention**), the names typed for members who have neither an account nor a roster record are replaced as well. When a decision is anonymized, the names of its mover and seconder are replaced. Members linked to an account or a roster person keep no name of their own on the committee: theirs is read from that record, which has its own retention.

## Sample data

The `dev` sample data has three invented committees: a board of directors, a risk and audit committee and a joint safety committee with management and labor members. It has four meetings: two held (one with approved minutes), with attendance, agendas and decisions, and two planned. Two actions were agreed at the safety committee. A sample safety plan has its element map and last year's review. When the sample data is loaded again and an approval waits for the board's chair (for example a corrective action plan), a sample decision of the board's last meeting is applied to it. Every sample record is marked as such. The committees come with sample members who are accounts, and no account is added before the first administrator exists (so that the setup wizard is still offered): when the sample data is loaded before setup, load it again after the first administrator has been created to add the committees and meetings.
