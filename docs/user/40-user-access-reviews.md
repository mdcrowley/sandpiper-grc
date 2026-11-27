# User access reviews

People keep accounts on systems long after they need them: someone changes jobs and keeps their old access, a contractor's account outlives the contract, an account of someone who has left is never closed. A **user access review** asks the owner of each system to look at every account on it and say whether it should stay.

The access review pages keep a register of the **accounts on each system** (imported from each system's own export, or entered by hand), match each account to a person on the [staff roster](29-people-and-qualifications.md), and flag active accounts of people who have left or are on leave. A **review campaign** then asks each system's owner to keep or remove every account by a due date, with reminders. Removals are tracked until they are done, the decisions can be exported for the evidence file, and a finished campaign can be recorded as a test of a control in the [control library](26-controls-and-testing.md). Lists and record pages work as described in [Getting started](01-getting-started.md).

Open the pages from **Security > Access reviews** in the navigation: the campaigns, with the figures, and the tabs **Accounts on systems** and **My access reviews**. Your own reviews are also under **My work > Access reviews**. The pages share tabs along the top. A system's page also has an **Accounts** tab listing the accounts it holds.

If your organization does not use them, an administrator can switch **User access reviews** off under **Administration > Features** (see [Administration](09-administration.md#features)). The pages, the accounts and campaigns, the Accounts tab on systems, their notifications and calendar entries then disappear everywhere. Nothing is deleted: everything returns as it was when the part is switched back on.

The application does not connect to your systems: account lists come from files people export and import, and removals are carried out by people on each system.

## Where to start

Accounts come first: a campaign reviews the accounts already loaded for its systems. While no account has been loaded, **Access reviews** (with no campaign yet), **Accounts on systems** and a system's **Accounts** tab show the steps in order instead of an empty list:

1. **Import each system's account file** (the primary button; see [Importing a system's account file](#importing-a-systems-account-file)).
2. **Check the matches** to the staff roster and the flags on **Accounts on systems**.
3. **Start a review campaign** for the systems whose accounts are loaded.

**Add one account by hand** is there too, for a system with only a few accounts and no export; **Create > Account on a system** and **Create > Access review** still open the forms directly.

## What you need

Access reviews use the **systems** permissions: `systems.view` to read the accounts and campaigns, `systems.create` and `systems.edit` to keep accounts, import files and set campaigns up, launch and complete them, and `systems.export` to export. The default **Agent** and **Security lead** roles hold them.

Reviewing needs no permission at all: the person a campaign names as a system's reviewer can open that system's review page (from the notification, or **My access reviews**) and decide, even if they cannot otherwise see systems. Recording a campaign as a control test needs `controls.create` as well.

## Accounts on systems

Each account record holds:

| Field | What it means |
|---|---|
| **System** | The system the account is on. |
| **Account** | The name the system knows it by (a login, user name or user id). One account of each name per system. |
| **Name**, **Email** and **Employee number on the system** | What the system says about the holder, used to find them on the staff roster. |
| **Holder** | The person on the staff roster who holds the account. |
| **Holder matched by** | **Employee number**, **Email**, **Name** or **Chosen by hand**. |
| **Kind of account** | **Personal**, **Shared**, **Service or system** or **Supplier**. Only personal accounts are matched and flagged. |
| **Role on the system** | The access the account has there, in the system's own words (for example "Dispatcher" or "Administrator"). |
| **Privileged** | The account can change the system's settings or other people's access. |
| **Status** | **Active**, **Disabled** or **Removed**. |
| **Last seen** | When the account was last used, from the system's file. |
| **Needs attention** | Set by the application (see below). |

### Matching holders to the staff roster

When an account is saved or imported, the application looks for its holder on the staff roster: first by **employee number**, then by **email** (the email on the system, or an account name that is an email address), then by a **name** that exactly matches one person's full or preferred name. If two people share the name, nobody is chosen. A holder you choose by hand (or clear by hand) is kept and never changed by the matching.

### Flags

An **active personal account** is flagged when:

- **Holder has left**: the holder's status on the roster is **Left**.
- **Holder on leave**: the holder's status is **On leave**.
- **Not on the staff roster**: nobody on the roster matches the account.

Flags are worked out again whenever an account is saved, whenever a person on the roster changes (so marking someone as having left flags their accounts at once), and every night. The system's technical and business owners get a notification the first time an account of theirs is flagged because its holder has left or gone on leave. **Match holders again** on the accounts list runs the matching for every account at once (or, on a system's Accounts tab, for that system).

The figures at the top of **Access reviews** count every account and campaign, whatever you may see: active accounts, those flagged, campaigns in progress and removals still to do. Select a figure to open the matching list.

### Importing a system's account file

Most systems can export their list of accounts as a spreadsheet. Select **Import a system's file** on **Accounts on systems** (or on a system's **Accounts** tab), choose the system and the file (CSV or Excel), then **Check the file**. The first row must name the columns; the application recognizes common names:

| Column | Names it recognizes |
|---|---|
| Account (required) | Account, Username, Login, User ID, Logon name, User principal name |
| Name | Name, Display name, Full name |
| Email | Email, E-mail, Mail |
| Employee number | Employee number, Employee ID, Staff number, Payroll number |
| Role | Role, Roles, Group, Groups, Profile, Access level |
| Last seen | Last seen, Last login, Last logon, Last sign-in, Last activity |
| Status | Status, Enabled, Active (yes, true, enabled and active mean active; no, false, disabled, locked and expired mean disabled) |
| Kind | Kind, Type, Account type |
| Privileged | Privileged, Admin |

The check says how many accounts are new, changed and unchanged, which columns it used and which rows it could not read; nothing is saved yet. **Import** then saves them. Accounts are matched by account name, without regard to case.

With **Mark accounts that are not in the file as removed** checked (the default), accounts the system no longer lists are marked **Removed** with today's date, and any removal a review was waiting for on those accounts is recorded as done. Uncheck it when the file is not a complete export.

## Review campaigns

A campaign reviews the accounts of one or more systems by a due date. Select **New** on **Access reviews** and give:

| Field | What it means |
|---|---|
| **Title** | For example "Second-quarter access review". |
| **Scope and instructions** | Shown to every reviewer at the top of their page. |
| **Campaign owner** | Who runs it (you, unless you choose someone else). The owner also decides on a reviewer's own account. |
| **Starts on**, **Decisions due** | The review period. Reviewers are reminded before the due date and weekly once it has passed. |
| **Remind reviewers (days before)** | How many days before the due date the first reminder goes out (default 3). |
| **Days to carry out a removal** | The time allowed for each removal once a system is signed off (default 14). |
| **Control** | The control the campaign tests, if any (see below). |

### Systems and reviewers

On the campaign's **Systems and reviewers** tab, add each system to review. Its **business owner** is asked to review it (its technical owner when it has no business owner); choose **Change the reviewer** in the row's menu to ask someone else. A system can be taken out again while none of its accounts has been decided.

### Launching

Select **Launch**. The **active** accounts of each system are copied into the campaign as they are at that moment, and each reviewer gets a notification with a link to their system. Systems added to a campaign already under way are copied in, and their reviewers asked, at once.

## Reviewing the accounts of a system

Reviewers open their systems from the notification or from **My access reviews**. The page lists every account, flagged accounts first, with the holder, the role, when it was last used and whether it is privileged.

- Select **Keep** or **Remove** on each account, or check several and use the buttons above the table. You can change a decision until you sign off.
- Keeping the account of someone who has **left** needs a comment saying why (for example, it is being handed over).
- You never decide on your own account: it is marked **Your own account**, and the campaign owner decides on it. An account is yours when the staff roster links it to you, and also when its account name or email address on the system is your username or email address (capitals do not matter), so an administrator login such as your username on the system, or an account the roster does not match, still counts as yours.
- When every account is decided, select **Sign off**. Your decisions become final, and each account to remove becomes a **removal** with a due date.

## Removals

Each removal is also raised as an action in the [action tracker](06-risks-actions-obligations.md), owned by the system's technical owner (or the reviewer), with source **Access review**. A removal is recorded as done in any of three ways:

- **Record as removed** on the campaign's **Removals** tab (by the reviewer, the system's technical owner or anyone who may edit systems);
- finishing its action in the action tracker;
- importing the system's file again without the account in it.

The account is then marked **Removed** and its action finished. The owner of a removal past its due date is reminded weekly.

## Completing a campaign

Once every system is signed off, select **Complete**. Removals still under way stay tracked. A completed or canceled campaign can no longer be changed, except its notes. **Cancel the review** in the **More actions** menu stops a campaign; decisions already made are kept.

The **Evidence files** tab holds anything you want to keep with the campaign (for example screenshots of removals). **Export the decisions (CSV)** in the **More actions** menu gives every account with its decision, who made it and when, and its removal: the decision file auditors ask for.

### Recording a campaign as a control test

When the control library is switched on, a completed campaign can be recorded as an **operating test** of a control: select **Record as a control test**, choose the control and, if you wish, the result and a conclusion. The test is recorded with the accounts reviewed as its population and the accounts decided "remove" as its exceptions; without a result chosen, it is **Effective** when nothing was removed and **Partly effective** otherwise. It is linked to the campaign, awaits review by someone other than you like any other test (see [Controls and testing](26-controls-and-testing.md)), and the campaign shows a link to it.

## In your calendar

Each system you are asked to review appears in **My work**, on the **Calendar** and, if you choose **My access reviews due**, in your calendar feed, on the day decisions are due, as "Access review UAR-00012: Payroll system, 5 accounts to decide" (or "ready to sign off" once every account is decided). It links to your review page and stays while overdue, until you sign the system off. This needs no permission: being the named reviewer is enough, and nobody else sees your items. They are left out while **User access reviews** is switched off.

## Sample data

The development sample data adds accounts on two sample systems (most of them held by people on the sample staff roster, one by nobody on it and a shared service account) and a draft campaign over both systems.
