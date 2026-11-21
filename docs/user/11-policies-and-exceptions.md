# Policies and exceptions

This part of the application holds the policy library: each policy with its owner, approver, review date and every version of its text. Publishing a version asks the right people to read and acknowledge it, and a tracking view shows who has. It also holds the exceptions register, where each agreed deviation from a policy is recorded with its approver and the date it expires. Both are in the **Cybersecurity** group of the menu. Lists and record pages work as described in [Getting started](01-getting-started.md).

An administrator can switch policies and exceptions off under **Administration > Features** (see [Administration](09-administration.md#features)); **My acknowledgments** then goes too. Records are kept and return when it is switched back on.

## Who can do what

| To do this | You need |
|---|---|
| Read the policy library and the published text | **View** on **Policies** |
| Add a policy, edit its details, write a version, map outcomes | **Create** or **Edit** on **Policies** |
| Approve a version, publish it, retire a policy | **Approve** on **Policies** |
| Export the acknowledgment list | **Export** on **Policies** |
| Change the acknowledgment reminder interval (**Reminder settings**) | **Administer** on **Policies** |
| See the exceptions register | **View** on **Exceptions** |
| Record or edit an exception, withdraw it | **Create** or **Edit** on **Exceptions** |
| Approve or reject an exception, or change the expiry date of an approved one | **Approve** on **Exceptions** |
| Acknowledge a policy you have been asked to read | Nothing more than being able to sign in |
| See which people on the roster were asked, and record their acknowledgments | **View** (to see) or **Edit** (to record) on **Policies**, and **View** on **People** |
| Run the acknowledgment kiosk | **Edit** on **Policies** |

Roles are managed by an administrator; see [Administration](09-administration.md).

## The policy library

Open **Cybersecurity > Policies**. Each row shows the policy's reference (such as `POL-00004`), document type, category, status, the version in force and its review date. Filter by **Document type** to see only procedures, rulebook sections or bulletins, for example.

The tiles above the list each open the policies they count:

| Tile | Shows |
|---|---|
| **Published** | Policies with a version in force |
| **Being written or approved** | Policies whose latest version is a draft, in review or approved |
| **Due for review** | Policies that are not retired and whose review date has passed or falls in the next 60 days, soonest first |
| **Retired** | Policies no longer in use |

The **View** menu beside **Filters** holds ready-made saved views (**Published**, **Being written or approved**, **Owned by me** and **Retired**), which you can keep, rename or delete like your own. **All policies** shows everything. The address in the browser keeps the search, filters and sort, so a view can be bookmarked. To give many policies a new **Category**, **Owner** or **Review date**, check them and select **Edit selected…**.

The **Review** column is green when the review date is more than 60 days away, amber when it is closer, and red once it has passed.

### Statuses

A policy's status follows its versions. You do not set it by hand.

| Status | Meaning |
|---|---|
| **Draft** | Being written. Nothing has been approved |
| **In review** | A version has been sent for review and is waiting for approval |
| **Approved** | A version has been approved but not yet published |
| **Published** | A version is in force. This is what readers see |
| **Retired** | No longer in use. The text and history are kept |

A published policy stays **Published** while its next version is being written and approved.

### Add a policy

1. Select **New policy**, or **Create** then **Policy**.
2. Enter the **Title**, choose the **Document type** (see below) and enter a short **Summary**.
3. Choose the **Category**, the **Owner**, and enter the **Approver** and **Approver role**.
4. Enter the **Review date**: when the policy should next be looked at.
5. Select **Create policy**.

The policy opens with no text yet. Write the first version next.

### Document types

Every document in the library has a **Document type**. Each type has its own review cycle: when a version is published, the **Review date** moves to the date the version takes effect plus that many months, unless a later review date is already set.

| Document type | Review cycle |
|---|---|
| **Policy** (the default) | 24 months |
| **Procedure** | 24 months |
| **Rulebook section** | 12 months |
| **Bulletin** | 6 months |
| **Standard** | 36 months |
| **Plan** | 12 months; plans also have plan elements and an annual review (see [Plans](#plans)) |

An administrator can rename the types, add others and change a cycle under **Administration > Lists** (list **policy_document_type**: the number of months is `review_months` in the value's settings, and a value with `plan` set is a plan).

## The policy page

The page has these tabs:

| Tab | What it holds |
|---|---|
| **Policy** | The text readers see, the **Details** card and **Who must acknowledge** |
| **Versions** | Every version, and two versions side by side |
| **Acknowledgments** | Who has and has not acknowledged a version |
| **Mapped outcomes** | The framework outcomes this policy supports |
| **Exceptions** | Exceptions recorded against this policy |
| **Activity**, **Evidence files**, **Related**, **History** | Comments, files such as a signed approval (recorded as evidence, see [Evidence files](14-attachments-and-notifications.md#evidence-files)), linked records, and every change made to the policy |

The **Policy** tab shows the published version. If nothing is published yet, people who write or approve policies see the newest version, marked as not published; everyone else is told there is nothing to read yet.

When a policy has more than one version, the list at the top right of the text switches to another version to read. Readers can choose the published version and earlier published ones; people who write or approve policies can also read a version being worked on. An earlier version carries a notice saying which version is in force, with a link back to it.

When a newer version is being worked on, a notice at the top says so, and that readers still see the published one.

## Write, approve and publish a version

The text of a policy is written in plain text with a few simple marks. Each version goes through the same steps.

| Step | Button | Who | What happens |
|---|---|---|---|
| 1 | **Write the first version**, **New version** or **Edit draft** | Edit | Opens the editor |
| 2 | **Send for review** | Edit | The version becomes **In review** and can no longer be edited |
| 3 | **Approve** | Approve | Records who approved it and when. The text is now fixed |
| 4 | **Publish** | Approve | The version becomes the one readers see, and acknowledgments are requested |

Step 2 is optional: a person who can approve may approve a draft directly. Nobody can approve a version they wrote themselves: the **Approve** button is not offered to the author, and someone else with **Approve** on **Policies** must approve it.

### Discard a version

A draft or in-review version that should not go ahead can be thrown away: select the **More actions** button (three dots), then **Discard version** and the number, and confirm. Readers keep seeing the published version, if there is one. The discarded text is kept in the policy's **History**, and a new version can be started straight away. An approved or published version cannot be discarded.

### Write the text

1. On the policy page select **Write the first version**, **New version** or **Edit draft**.
2. In **What changed in this version** say briefly what is different, for example "adds a section on personal devices".
3. Write in **Policy text**. The **Preview** beside it shows how readers will see it.
4. Select **Save draft**.

A new version starts from the text of the one before it, which is kept unchanged. Only one unpublished version can be open at a time.

| To get | Write |
|---|---|
| A heading | `## Heading` |
| A smaller heading | `### Heading` |
| Bold | `**bold**` |
| A list | A line starting with `- ` |
| A numbered list | A line starting with `1. ` |
| A link | `[link text](https://address)` |
| A table | Columns separated by `\|`, with a line of `\|---\|---\|` under the heading row |
| A quotation | A line starting with `> ` |

Web page code typed into the text is shown as text and never run. Pictures are not loaded; only their description is shown.

### Approve

1. Select **Approve**.
2. Check **Approved by** (leave it empty to record your own name) and the **Approval date**.
3. Enter an **Effective date** if the policy takes effect on a particular day. Leave it empty to use the day it is published.
4. Select **Approve version**.

Only an approved version can be published. Once approved, the text cannot be changed; to change it, publish it and start a new version.

### Publish

1. Check **Who must acknowledge** first (see below).
2. Select **Publish**. The confirmation says how many people will be asked to acknowledge.
3. Select **Publish** again to confirm.

The earlier published version is kept and marked **Superseded**.

### Retire a policy

Select the **More actions** button (three dots), then **Retire policy**, and confirm. The policy is marked **Retired**, outstanding acknowledgment requests are closed, and no new version can be written. The text and history stay available.

## Compare versions

Open the **Versions** tab. The table lists every version with its status, what changed, who approved it and when.

Below it, two versions are shown side by side so you can read what changed. Choose which with **Earlier version** and **Later version**, or select **Read** on a row. Old versions are kept exactly as they were approved.

## Acknowledgment

### Choose who must acknowledge

On the **Policy** tab, in **Who must acknowledge**, select **Change**.

- Check **Everyone** to ask every active user, or
- choose one or more **Roles** and **Departments**. A person is asked if they hold any of the roles or belong to any of the departments.
- Set **Days to acknowledge** (14 unless changed).

Select **Save audience**. The choice is used the next time a version is published; it does not change requests already sent.

#### Staff on the roster

Frontline staff often have no account. If the roster is in use (see [People and qualifications](29-people-and-qualifications.md)), **Who must acknowledge** also offers **Ask staff on the roster too**. Check it and choose the **Positions** whose people must acknowledge (with **Everyone** checked, everyone on the roster is asked). When a version is published, each active person on the roster in those positions gets a request with the same due date. A person whose account was already asked through the roles or departments above is not asked twice.

### What publishing does

When a version is published:

- each active user in the audience gets a request to acknowledge that version, with a due date, and a notification (**Please read and acknowledge** and the policy) that opens the policy for them to read, even if they cannot open the policy library;
- requests for earlier versions that were never answered are closed;
- everyone is asked again, including people who acknowledged an earlier version, because the text has changed.

### Acknowledge a policy

1. Open **Cybersecurity > My acknowledgments**, or the notification. The tiles count what is **Waiting for me**, what is **Overdue** and what you have **Acknowledged**. **Awaiting my acknowledgment** lists what you have been asked to read, most urgent first, each with its due date.
2. Select **Read and acknowledge**. The policy opens in a page of its own, with its summary, what changed in this version, and the text.
3. Read it. At the bottom, check **I have read and understood this policy**.
4. Select **Acknowledge**. **Not now** goes back to your list without recording anything.

The policy moves to **Already acknowledged**; select its name to read the same text again. The date and time of your acknowledgment are recorded against the version you read.

### Track acknowledgment

Open the policy's **Acknowledgments** tab.

- The bar and tiles show how many people have **Acknowledged**, how many are **Outstanding**, and how many are **Overdue** (outstanding and past the due date), each with a percentage.
- **People** lists who was asked. Use **Show** to switch between outstanding, overdue only, acknowledged and everyone.
- **By department** gives the same counts for each department.
- **Version** switches to an earlier version's record.
- **Export CSV** downloads the list for the version shown.
- **Staff on the roster** (shown to people who can see the roster) lists the roster people asked, with their employee number, position, status, when and how they acknowledged (**Sign-in sheet**, **Kiosk** or **By hand**) and who recorded it, with the same counts.

### Record acknowledgments from a sign-in sheet

After a briefing, staff often sign a paper sheet. To record it (you need **Edit** on **Policies** and **View** on **People**):

1. Scan the sheet and add it to the policy on its **Evidence files** tab.
2. On the **Acknowledgments** tab, under **Staff on the roster**, select **Record acknowledgments**.
3. Type or paste the **Employee numbers** from the sheet, one per line or separated by commas or spaces.
4. Leave **How** as **Sign-in sheet**, or choose **Recorded by hand**. Set **Acknowledged on** if the briefing was on an earlier day (never a later one).
5. Choose the **Scanned sheet** you added in step 1.
6. Select **Record**.

Everyone listed is recorded against the published version, including people on the roster who were not asked. People who had already acknowledged are skipped, and employee numbers not on the roster are named in the message so you can check them. You are recorded as the person who recorded the acknowledgments, and the change is in the policy's **History**.

### The acknowledgment kiosk

The kiosk lets staff acknowledge for themselves on a supervisor's device, for example a tablet in a depot's crew room. It runs only while someone with **Edit** on **Policies** is signed in on that device; there is no page that works without signing in.

1. Sign in as the supervisor and open **Cybersecurity > Acknowledgment kiosk** (or **Open the kiosk** on a policy's **Acknowledgments** tab).
2. The member of staff types the start of their name and picks it. Only people on the roster with something to acknowledge are listed, with their position.
3. They enter their **Employee number** and select **Continue**. A wrong number is refused; after five wrong numbers for the same person the kiosk stops accepting numbers for that person for 15 minutes, and each wrong number is recorded in the audit log.
4. They read each document, check **I have read and understood this document**, and select **Acknowledge**.

The kiosk thanks them and returns to the list for the next person. Each acknowledgment is recorded with the method **Kiosk** and the signed-in supervisor as the person who recorded it. Sign out when you leave the device.

### Reminders

Once a day the application looks for acknowledgments that are past their due date. Each person who is overdue gets a notification (**Reminder: please read and acknowledge** and the policy) that opens the policy for them. The reminder is recorded in the policy's **History** and its date is shown under **Last reminder**. A person is reminded again every 7 days until they acknowledge.

To change the 7 days, someone with **Administer** on **Policies** selects **Reminder settings** at the top of the policy library, enters **Days between reminders** (1 to 90) and selects **Save**. The change is recorded in the audit log.

One policy can have its own interval: on the policy, select **Change** on **Who must acknowledge** and enter **Days between reminders** (1 to 90), or leave it empty to use the setting above.

## Plans

A plan, such as the safety plan, is a policy whose **Document type** is **Plan** (or any document type an administrator marks as a plan). Its page shows two more cards under the text: the **Plan elements** and the **Annual review**.

### Plan elements

**Plan elements** shows each element the plan must cover and where it does: one box per element, listing what covers it, the section of the plan and its owner. An element nothing covers yet is shown with a dashed border and "Not covered in the plan yet". The elements are a list an administrator keeps under **Administration > Lookups** (**Plan element**); it starts with the four generic pillars of safety management: **Safety policy and objectives**, **Safety risk management**, **Safety assurance** and **Safety promotion**.

To change the map, someone who may edit policies selects **Edit map**, then for each entry chooses the **Element** and fills in **What covers it**, **Where in the plan** (for example "Section 2.1") and the **Owner**. **Add an entry** adds a row and the bin removes one. **Save** replaces the map; the change is recorded in the policy's history.

### Annual review

A plan is reviewed by several parties in turn. **Start annual review** (needs **Edit** on **Policies**) starts the **Annual plan review** approval workflow (see [Approval workflows](22-approval-workflows.md)). Its first version asks, in turn, the **Accountable executive**, the **Governing body** and the **Safety committee**, each a different person who may approve policies; an administrator names the right people in each step under **Administration > Approval workflows**. The person who starts the review cannot approve it. Its progress shows in the approval panel at the top of the page.

When the last party approves, the review is recorded as approved and the plan's **Review date** moves to a year from that day (or the review cycle of its document type). A rejection is recorded with its reason, and the review date stays. The **Annual review** card lists every review: the year, its outcome, when it started and was approved, and the version reviewed. Only one review runs at a time.

A committee can decide a step of the review at a meeting (see [Committees and meetings](28-committees-and-meetings.md#apply-a-decision-to-a-waiting-approval)).

Once a plan's review date is within **30 days**, its owner (or, without one, everyone who may edit policies) is reminded once, and again once when the date is reached, unless a review is already running. An administrator can change the 30 days (**Remind plan owners before the annual review**, setting `policies.plan_review_reminder_days`) under **Administration > Reminders**.

The `dev` sample data includes an invented **[Sample] Safety plan** with its element map and last year's approved review (loaded with the sample committees).

## Map a policy to framework outcomes

Open the **Mapped outcomes** tab to show which framework outcomes the policy helps to meet.

1. In **Add an outcome**, search by code or words and pick the outcome.
2. Select **Map outcome**.

Select the cross on a row to remove a mapping. The policy also appears on the outcome's **Related** tab. See [Cybersecurity frameworks](05-cybersecurity-frameworks.md).

## Exceptions

An exception is a time-limited, approved deviation from a policy or standard: something that does not comply, the reason, what is done instead to reduce the risk, who agreed to it and until when.

Open **Cybersecurity > Exceptions**. The tiles count exceptions **Awaiting decision**, **In force** and **Expired**; select one to see them.

Two tabs sit under the tiles:

| Tab | Shows |
|---|---|
| **Register** | The whole register, with search, **Filters**, export and the saved views **Awaiting decision**, **In force**, **Expired** and **Requested by me** in the **View** menu |
| **Expiring soon** | Approved exceptions that run out in the next 30, 60, 90 or 180 days, and those already expired. The policy each one belongs to is shown only to people who may read policies |

### Request an exception

1. Select **New exception**, or **Create** then **Exception**. From a policy, use its **Exceptions** tab to have the policy filled in.
2. Enter the **Title** and choose the **Policy**.
3. Describe **What is the deviation**, the **Justification** and the **Compensating controls**.
4. Enter the date you would like it to run to in **Expires on**.
5. Select **Create exception**.

The exception gets a reference such as `EXC-00012` and the status **Requested**. You are recorded as **Requested by**.

### Approve or reject

1. Open the exception and select **Approve**.
2. Enter the **Approver** (leave it empty to record your own name) and **Approver role**.
3. Enter **Expires on**. An exception cannot be approved without an expiry date, and the date cannot be in the past.
4. Check **Approved on**. Leave it empty to record today. The expiry date cannot be before it.
5. Select **Approve exception**.

Select **Reject** to refuse the request.

### Statuses

| Status | Meaning |
|---|---|
| **Requested** | Waiting for a decision. The deviation is not yet permitted |
| **Approved** | In force until the expiry date |
| **Rejected** | Refused |
| **Expired** | The expiry date has passed. Set automatically, once a day |
| **Withdrawn** | Closed by the requester, or ended early |

While an exception is approved, its page shows the expiry date with a countdown: green with more than 30 days left, amber inside 30 days.

- **Withdraw** closes a request, or ends an approved exception early.
- **Request again** puts a rejected, withdrawn or expired exception back to **Requested**. It then needs a new approval and a new expiry date.

An administrator can limit which status changes are allowed, and who may make them, under **Administration > Lifecycles**; see [Lifecycles](23-lifecycles.md). The rules above always apply as well.

### Link a risk

If the deviation is on the risk register, edit **The exception** card and choose the **Linked risk**. Risks are restricted records, so the field is only useful to people who can see them; others see "Restricted". See [Risks, actions and obligations](06-risks-actions-obligations.md).

## Sample data

Policies and exceptions whose titles start with **[Sample]** are invented examples loaded with the sample data. Retire or delete them when you no longer need them.
