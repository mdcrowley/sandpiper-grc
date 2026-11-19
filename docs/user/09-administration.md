# Administration

This page is for administrators. It explains how to add people and give them access, how roles and permissions work, how to manage the second sign-in factor, how to change the choices offered in drop-down lists, the application settings, and how to read the audit log. The last section, on the **Account security** page, applies to every user. It also covers your own fields on records (**Custom fields**), how long records are kept (**Retention**), **API tokens**, **Webhooks** and the **API reference**. The administration screens are in the **Administration** group of the menu: **Users**, **Roles**, **Lists**, **Settings**, **Custom fields**, **Retention**, **API tokens**, **Webhooks** and **Audit log**.

## What you need

- **Users**, **Roles**, **Lists**, **Settings**, **Custom fields**, **Retention**, **API tokens** and **Webhooks** need **Administer** on **Administration**. The built-in **Administrator** role has it.
- **Audit log** needs **View** on **Audit log**. The built-in **Administrator** and **Security lead** roles have it.
- **Account security** is open to every signed-in user, for their own account.

The first administrator is created by the setup wizard the first time the application is opened. There is no default account.

### Confirming your password

Some changes decide who can do what, so the application checks it is really you before making them. If you have not given your password in the last 10 minutes, a **Confirm your password** box appears when you:

- add a role, change a role's permissions, switch a role on or off, or change **Members must use a second factor**;
- select **Apply default permissions**;
- add a user or change a person's roles;
- reset a person's second factor, or issue a setup or password-reset link;
- change anything under **Security**, **API tokens** or **Outbound connections** in **Settings**, or the **Idle time-out** under **Sessions**;
- make an API token, add a webhook, change where a webhook sends or whether it includes restricted records, or replace a webhook's secret;
- remove a record for good from the **Retention** review list.

Enter your password and select **Confirm and continue**. The change you asked for is then made; you do not need to repeat it. Select **Cancel** and nothing is changed. You are not asked again for the next 10 minutes (an administrator can change this under **Settings**). Signing in counts, so you will not see the box straight after signing in.

## Users

Open **Administration > Users**. People are added by an administrator; nobody can register themself.

The list shows each person's **Name** and email, **Username**, **Status**, **Roles**, **Second factor** (On or Not set up), **Department** and **Last sign-in**. Search by name, username or email, and filter by **Status** or **Role**. Each filter in use appears under the search box as a pill; select the cross on a pill to remove that filter, or **Clear all** to remove them together. Select a person's name, or anywhere on their row, to open them.

| Status | Meaning |
|---|---|
| **Waiting for setup** | The account exists but the person has not yet set a password. |
| **Active** | The person can sign in. |
| **Disabled** | The person cannot sign in. Their records and history are kept. |
| **Locked** | Shown beside the status when sign-in is temporarily blocked after repeated wrong passwords. |

### Adding a user

1. Select **New user**.
2. Enter the **Name**, a **Username** (3 to 64 letters, numbers, dots, dashes or underscores; this is what they sign in with) and an **Email**.
3. Choose a **Department** if you use them.
4. Under **Roles**, tick only what this person needs. With no role they can sign in but see nothing.
5. Select **Create user**.

You do not set a password. Instead, the window changes to show a **one-time setup link** for the person.

### One-time setup and reset links

The application does not send email, so you pass the link on yourself. The link is shown in a large framed box, with a warning above it that it is shown once and, below it, the date and time it expires.

1. Select **Copy link** beside the link. The button changes to **Copied**. If your browser blocks copying, select the text in the box and copy it by hand.
2. Give it to the person directly: in person, by phone or in a private message.
3. Select **Done**. **Open user** takes you to the person's page instead.

Things to know about a link:

- It is shown once. The application keeps no readable copy, so it cannot be shown again after you close the window.
- It works once, and for 24 hours. The exact expiry time is stated under the link.
- Issuing another link for the same person cancels the earlier one.
- Anyone holding the link can set that account's password, so treat it like a password.

The person opens the link, sees **Set your password** (or **Choose a new password** for a reset), enters a new password twice and selects **Save password**. They can then sign in. Any sessions they had are signed out.

If the link has expired, been used or been replaced, the person sees "This link cannot be used". Issue a new one:

1. Open the person from the **Users** list.
2. On the **Sign-in and security** card, select **New setup link** (if they have never set a password) or **Password-reset link** (if they have).
3. Confirm with **Issue link**, then copy and pass on the link as before.

A reset link does not change the current password until it is used. A link cannot be issued for a disabled account; enable it first.

### Changing a person's details and roles

Open the person from the **Users** list.

- On the **Details** card, change the **Name**, **Username**, **Email** or **Department** and select **Save details**.
- On the **Roles** card, tick or untick roles and select **Save roles**. A role marked "(switched off)" can be given but grants nothing until it is switched on. A role marked "needs a second factor" expects its members to set one up.

Role changes take effect immediately.

### Unlocking an account

Wrong passwords are counted. From the fifth wrong attempt in a row the account is locked, first for 1 minute, then for twice as long after each further wrong attempt, up to 15 minutes. The lock clears by itself when the time is up, and a correct sign-in resets the count.

To clear it sooner:

1. Open the person. **Failed attempts** on the **Sign-in and security** card shows the count and, if locked, the time the lock ends.
2. Confirm who is asking, then select **Unlock** and confirm.

The person can try again straight away. If they have forgotten the password, issue a **Password-reset link** as well.

### Ending sessions

A session is one signed-in browser. To sign a person out everywhere, for example when a device is lost:

1. Open the person. **Active sessions** shows how many they have.
2. Select **End sessions** and confirm.

They must sign in again. If you do this on your own account, your other sessions end and the one you are using stays.

### Disabling and enabling an account

When someone leaves or no longer needs access, disable the account rather than removing it:

1. Open the person and select **Disable account**.
2. Confirm. They are signed out and cannot sign in.

Select **Enable account** to reverse it. Accounts cannot be deleted, so that names in records and history keep their meaning.

Two safeguards apply. You cannot disable your own account or remove your own administrator access; ask another administrator. And the application refuses any change that would leave no active administrator.

### Recent account events

The **Recent account events** card on a person's page lists the latest sign-ins and changes to that account, with how long ago, who did it and the network address it came from. Select **See all events for this account in the audit log** to open the audit log already filtered to that person's account. You need access to the audit log to see the card.

While a person is still **Waiting for setup**, the **Sign-in and security** card says whether a setup link is waiting to be used. The **Second factor** line is marked in amber when one of the person's roles expects a second factor and they have not set one up.

## Roles and permissions

A role is a named set of permissions. People get access only through the roles they hold, and a person may hold several. Open **Administration > Roles**.

### The roles supplied

| Role | Intended for | Starts |
|---|---|---|
| **Administrator** | Configuration, users and roles. Holds every permission. | On |
| **Agent** | Service desk and inventory work: tickets, knowledge, inventory and actions, with read access to most other areas. | On |
| **Security lead** | Risks, frameworks, security incidents, vendors and contracts, and the audit log. | On |
| **Project manager** | Projects, gates, status reports and actions. | On |
| **Approver** | People who approve changes, service requests, asset decisions and project gates. It does not include risks: a risk acceptance is recorded by someone who can see the risk, naming the approver. | Off |
| **Executive viewer** | Read-only dashboards, projects and framework outcomes. | Off |
| **Auditor** | Read-only access to chosen areas, with export of framework evidence. | Off |
| **Requester** | Anyone in the organisation submitting their own requests. | Off |

The list shows each role's **Access** (for example "12 permissions in 5 areas", or "Everything"), the number of **Members**, whether a **Second factor** is Required or Optional, and a **Switched on** switch. Treat the supplied roles as a starting point and check each one's permissions against how your organisation works.

### Applying default permissions after an upgrade

A new version of the application may add permissions to the supplied roles. Your roles are never changed without you: when there is something to apply, the **Roles** page shows a notice listing, role by role, what would be added.

1. Read the list.
2. Select **Apply default permissions** and confirm your password if asked.

Applying only adds permissions. It never removes one, and it replaces a role's description only if you have never edited it. If you later remove one of the added permissions, it is not offered again. The first time you do this on an installation that was set up before this feature existed, the list may include permissions you removed on purpose in the past: remove them again afterwards. Each role changed is recorded in the audit log.

### Switching roles on and off

The last four roles carry an **Audience switch** badge and start switched off. They exist so that you can begin with the IT team alone and open the application to wider audiences one at a time.

- To switch a role on or off, use the switch in the **Switched on** column, or open the role and use **Switched on** there.
- While a role is off, its members keep the role but get none of its permissions.
- Switching takes effect at once. Nobody needs to sign in again.
- Every switch is recorded in the audit log.
- The **Administrator** role cannot be switched off.

You can switch off any other role in the same way, which is the quickest way to suspend access for a whole group. There is no button to delete a role; switch it off instead.

### Reading and changing permissions

Open a role. The **Permissions** card is a grid with one row for each area of the application and one column for each kind of action. Every area the application knows about is listed. The grid scrolls inside its own frame: the column headings and the area names stay in view while you scroll, so you always know which box you are looking at.

- Type in **Find an area** to show only the areas whose name matches, for example "risk".
- Tick **Only areas this role can use** to hide the areas where the role has nothing.
- The top right of the card shows how many areas the role reaches.
- With the keyboard, Tab moves from box to box and Space ticks or unticks.

| Action | Lets members |
|---|---|
| **View** | See records in the area. |
| **Create** | Add new records. |
| **Edit** | Change existing records. |
| **Delete** | Remove records. |
| **Approve** | Record approvals, such as a risk acceptance or a project gate decision. |
| **Administer** | Change the area's configuration, such as project settings or notification rules. |
| **Export** | Download lists as CSV files. |

To change a role:

1. Tick or untick the boxes. Ticking **All** on a row grants every action in that area, including any added in future.
2. On the **About this role** card you can also change the **Name** and **Description**, and tick **Members must use a second factor**.
3. Select **Save role**. Changes apply at once. Until you save, **Unsaved changes** is shown beside the buttons; select **Undo changes** to go back to what was saved.

The **Members** card lists who holds the role. To give a role to someone, or take it away, go to that person's page.

The **Administrator** role holds every permission (stored as a single star), so every box is ticked and cannot be changed.

An area that nothing checks yet carries a small **not yet used** label. Its boxes can be ticked, but ticking them has no effect today. **Self-service portal** is marked this way because the portal is not built; **Reports** is marked only on an installation where the reports part of the application is not installed. **View** on **Dashboards and overview** decides who sees the dashboards on the overview page.

### Restricted records

Risks and security incidents are restricted. To see them a person needs **View** on **Security incidents and restricted records** in addition to the permission for the area itself. For example, a role with **View** on **Risks** but not on **Security incidents and restricted records** sees no risks at all. See [Risks, actions and obligations](06-risks-actions-obligations.md) and [Security incidents](07-security-incidents.md).

### Adding a role

1. Select **New role**.
2. Enter a **Name** and a **Description** saying who holds the role and what it is for.
3. Select **Create role**. The role starts with no permissions and opens on its own page.
4. Tick its permissions and select **Save role**.

## Second factor

A second factor means a stolen password is not enough to sign in. After setting it up, a person is asked for a 6-digit code from an authenticator app each time they sign in.

### Who is expected to use one

- Members of any role that has **Members must use a second factor** ticked. **Administrator** and **Security lead** have it to begin with.
- Everyone, if **Expect a second factor from every user** is switched on under **Settings > Security**.

What happens to a person who is expected to use a second factor and has not set one up depends on **Enforcement** under **Settings > Security**:

| Choice | What the person sees |
|---|---|
| **Off** | Nothing. |
| **Reminder** (the starting value) | A notice at the top of every page with a link to set it up. They can still sign in and work. |
| **Required** | After signing in they see the **Account security** page by itself, with no menu. They can set the second factor up, change their password or sign out, and nothing else, until it is set up. |

The application starts on **Reminder** so that nobody is locked out by surprise. **Switch to Required before you put real records in.** You must set up your own second factor first; the page warns you if you have not, and the application refuses the change. Use the **Second factor** column on the **Users** list to see who has not done it. If you want to give people time, set **Grace period**: each person can keep working for that many days from their first visit, then the block applies. During the grace period their **Account security** page states the date by which they must finish.

A 6-digit code works once. If you have just used a code, wait for the app to show the next one.

### Setting it up for yourself

1. Select your name at the top right and choose **Account security**.
2. On the **Second factor** card, select **Set up an authenticator app**.
3. In your authenticator app, choose to add an account and **scan the square code** shown on the page with your phone's camera. The code is always drawn in black on white, so it scans in the dark theme too.
4. If you cannot scan it, type the key shown under **Cannot scan? Type this key into the app instead**. It is written in groups of four to make it easier to read; the spaces do not matter. **Copy key** copies it without the spaces. If the app asks, the key is time based, with 6 digits and a new code every 30 seconds. For an app that accepts a set-up address, open **Show the set-up address** and copy that.
5. Under **Enter the code the app now shows**, type the **6-digit code** and select **Confirm and turn on**. Nothing changes until you do this; **Cancel** abandons the set-up.
6. Your **recovery codes** are shown, once only. Select **Copy codes**, **Download as text** or **Print**, keep them somewhere safe and separate from your phone, then select **I have saved them**. That button stays unavailable until you have copied, downloaded or printed the codes.

Any standard authenticator app that supports time-based codes will work. The square code and the key hold the same secret: do not photograph them or share your screen while they are showing. They are shown only during set-up.

### Recovery codes

You get ten recovery codes. Each one signs you in once in place of the 6-digit code, for when your phone is lost or broken. To use one, sign in with your username and password as usual and, when asked for the **6-digit code**, type a recovery code instead. There is also a separate page, **Sign in with a recovery code**, at the address `/sign-in/recovery`, which asks for your username, password and a recovery code together.

The **Second factor** card shows how many codes are left, and turns amber when three or fewer remain. To replace them, select **New recovery codes** and enter your current password. The old codes stop working and the new ones are shown once, with the same **Copy codes**, **Download as text** and **Print** buttons. The downloaded file is plain text named `recovery-codes.txt`; printing gives a page with the codes and none of the buttons.

### Turning it off for yourself

Select **Turn off** on the **Second factor** card, then enter your current password and either a 6-digit code or a recovery code. Your recovery codes stop working too.

### Resetting it for someone else

When a person has lost both their phone and their recovery codes:

1. Confirm who is asking. A reset removes a protection from the account, so check by a means you trust, such as in person or by calling a known number.
2. Open the person from **Users**.
3. On the **Sign-in and security** card, select **Reset second factor** and confirm.

Their authenticator app and recovery codes stop working. They sign in with a password only until they set the second factor up again, so ask them to do that straight away. The button appears only when the person has a second factor set up.

## Lists

Lists are the choices offered in drop-downs across the application: statuses, priorities, categories and so on. You can add to them and rename them without any change to the software. Open **Administration > Lists**.

The left-hand panel names every list with the number of values in it and, in small print, the record types that use it. Type in **Find a list** to narrow the panel by list name or record type. Select a list to see its values in the order they are offered, with **Shown as**, **Stored value** and **State** (In use or Retired).

Above the values, a **Used by** line names each record type and field that offers the list, for example "Ticket (Status)". A list that no record field offers directly says so; it is usually used by a page of its own.

### Adding a status or category

1. Select the list, for example **Risk category**.
2. Select **Add value**.
3. In **Shown as**, type the text people will see. The stored value is made from it and shown underneath.
4. Choose a **Colour** by selecting one of the eight swatches: Gray, Blue, Teal, Green, Amber, Orange, Red or Purple. With the keyboard, the arrow keys move between them. The **Preview** shows how the value will look as a chip.
5. Select **Add value**.

The new value is available in the relevant drop-downs at once.

### Renaming, recolouring and reordering

- Select **Edit** on a value to change the text or the colour. The stored value never changes, so renaming is safe: existing records simply show the new text.
- Select **Move up** or **Move down** in the **Order** column to change the order in which values are offered. The value moves one place and the new order is saved at once; there is nothing to drag and no separate save.

### Retiring a value

Values are retired, never deleted, so that existing records keep their meaning.

- Select **Retire** on a value. It can no longer be chosen, but records that already use it still show it.
- Select **Restore** to bring a retired value back.

### What to be careful about

Some values carry behaviour as well as a name, and that behaviour belongs to the values supplied with the application. For example, an action counts as finished when its status is **Done** or **Cancelled**, and a framework outcome's status decides how much it counts towards the score. A value you add yourself is an ordinary value with none of this behaviour: a new action status is treated as open, and a new outcome status counts as zero. A few lists are fixed steps in a process, such as the project stages, the incident statuses and the notification triggers; add to or retire from those only after testing the effect.

Rename supplied values freely, but be cautious about retiring them. You cannot create a new list on this screen.

## Settings

Open **Administration > Settings**. The settings are in groups: **Identity**, **Security**, **Sessions**, **API tokens**, **Outbound connections**, **Retention**, **Features**, **Files** and **Departments**. The links at the side of the page (at the top on a narrow screen) jump to each group.

Each setting has its name and an explanation on the left and its control on the right. Make your changes, then select **Save settings** at the top right, or **Undo changes** to discard them. A setting you have altered is marked **Changed**, and the number of unsaved changes is shown beside the buttons. Every change is recorded in the audit log with the old and new value.

If a value is not allowed, nothing is saved. A message at the top says how many settings need attention, and each of those settings shows the reason in red beside its control, for example "Idle time-out must be a whole number from 5 to 480."

### Identity

| Setting | What it does |
|---|---|
| **Application name** | The application's name, 1 to 60 characters. Shown on the sign-in page, in the header and as the account name in authenticator apps. |
| **Pilot mode** | While on, every page carries a label saying this is a pilot, so nobody mistakes it for the system of record. Switch it off only when the application is approved for real use. It starts switched on. |

### Security

Changing any setting in this group asks you to confirm your password.

| Setting | Starts at | Allowed | Notes |
|---|---|---|---|
| **Minimum password length** | 14 | 12 to 128 | Never below 12. There are no rules about capitals, numbers or symbols and no forced periodic change. Commonly used passwords, and passwords containing the username, are always refused. |
| **Password history** | 5 | 0 to 24 | How many of a person's previous passwords may not be reused. 0 turns the check off. |
| **Who is expected to have one** (second factor) | Off | On or off | Members of roles marked **Members must use a second factor** are always expected to have one. Switch on **Expect a second factor from every user** to expect it of everyone. |
| **Enforcement** | Reminder | Off, Reminder, Required | What happens to people who are expected to have a second factor and do not. A line under the three choices explains the one selected. See "Second factor" above. |
| **Grace period** | 0 | 0 to 30 days | With **Required**, how long a person may keep working before the block applies, counted from their first visit. 0 means no grace period. It has no effect with **Off** or **Reminder**. |
| **Ask again after** (password confirmation) | 10 | 1 to 60 minutes | How long after giving your password you can make sensitive changes without being asked again. See "Confirming your password". |

You need your own second factor before choosing **Required**. If you have none, an amber note appears under **Enforcement** with a link to **Account security**, and saving is refused with the message "Set up your own second factor first (Account security), then require it."

### Sessions

| Setting | Starts at | Allowed | Notes |
|---|---|---|---|
| **Idle time-out** | 30 | 5 to 480 minutes | A session ends after this long without activity. Changing it asks you to confirm your password. |
| **Longest session** | 8 hours | Fixed | Every session ends 8 hours after sign-in, whatever the idle time-out. |

### API tokens (settings)

Changing these asks you to confirm your password.

| Setting | Starts at | Allowed | Notes |
|---|---|---|---|
| **Longest token life** | 365 | 1 to 3650 days | A new token must expire within this many days. Tokens already made keep their expiry. |
| **Requests a minute** | 600 | 10 to 6000 | How many requests one token may make in a minute; more are refused until the next minute. |

### Outbound connections

Changing these asks you to confirm your password.

| Setting | Starts at | Notes |
|---|---|---|
| **Outbound connections** | Off | While off, nothing leaves the application: webhook deliveries are recorded as blocked and never sent. |
| **Allowed hosts** | Empty | The only hosts a delivery may go to, one to a line: a host name (`receiver.example.org`), a host and port (`receiver.example.org:8443`) or every host under a domain (`*.example.org`). Up to 50. Anything else is blocked. |

### Retention (settings)

| Setting | Starts at | Allowed | Notes |
|---|---|---|---|
| **Audit log** | 84 | 12 to 1200 months | How long the audit log is to be kept, for your records schedule. It is recorded only: audit events are never deleted. |

### Features

Feature switches control parts of the application that stay hidden until you turn them on. One is listed: **Self-service portal**, which starts off. The portal's pages are not built in this version, so leave it off.

The audience roles (Requester, Approver, Executive viewer, Auditor) are not here. They are switched on the **Roles** page.

### Files

The limits for files attached to records. They apply to new uploads; files already attached are not affected. This group has its own buttons: select **Save file settings** to save it, separately from **Save settings**.

| Setting | Allowed | Notes |
|---|---|---|
| **Largest file** | 1 to 2048 megabytes | Each attached file may be up to this size. |
| **Allowed file types** | Extensions separated by commas, for example `pdf, docx, png` | A file is refused when its content does not match its extension. Programs and scripts can never be allowed. |
| **Malware scanning** | Shown only | Says whether a scanner is installed. It is set where the application is installed, not on this page. |

The same settings are on **Administration > File settings**. If file attachments are not part of your installation, the group says so.

### Departments

The **Departments** group holds the list used to group people.

- Select **Add**, enter a name and select **Save**.
- Select **Rename** to change a name.
- Select **Remove** to delete a department. The people in it are left without a department.

Department changes save immediately; they do not wait for **Save settings**.

## Custom fields

Custom fields are your own fields on a kind of record, added without any change to the software. Open **Administration > Custom fields**.

Choose the kind of record under **Record type**. The table lists its custom fields in order, with **Order**, **Field** (the label, and underneath the name used in the API and exports, such as `cf_funding_source`), **Type**, **Section** and **State** (**In use** or **Switched off**).

A custom field appears on the record type's forms and record pages, can be chosen as a list column and filter, and is included in CSV exports, the record's history and webhook deliveries.

### Adding a field

1. Choose the **Record type** and select **Add field**.
2. Enter the **Label** people will see. The **Key** is made from it; change it now if you want, because it cannot be changed later.
3. Choose the **Type**: **Text**, **Long text**, **Number**, **Currency**, **Date**, **Checkbox**, **Single choice**, **Multiple choice**, **User** or **Record link**. The type cannot be changed later either.
4. For **Single choice** and **Multiple choice**, under **Options** choose **New options** and type one option to a line, or **An existing list** and pick one of the lists from **Lists**. New options get a list of their own, whose colours, order and retired values you change under **Lists**.
5. For **Record link**, choose what it **Links to**, for example systems.
6. Optionally give a **Section** (a heading the field is grouped under on forms), a **Position** (lower numbers come first) and **Help** (shown under the field). Tick **Required** if people must fill it in.
7. Select **Add field**.

If something is wrong, for example the key is already used, the reason is shown under the field and nothing is added.

### Changing and switching off a field

Select **Edit** to change the label, section, position, help or whether it is required. For a choice field you can also **Add options**. **In use** switches the field on or off.

Select **Switch off** to hide a field everywhere. **The values already entered are kept**: select **Switch on** to bring the field and its values back. Fields are never deleted.

## Retention

Open **Administration > Retention** to set how long each kind of record is kept and to decide what happens to records past that age.

**The daily check flags records. It never deletes anything.** Once a day the application looks for records older than their retention period and lists them under **Waiting for a decision**. Each one stays there until an administrator keeps it for longer or removes it for good.

### Retention periods

On the **Retention periods** tab, each record type shows how long it is **Kept for**, what the period is **Counted from**, its **Schedule category** and its **State** (**Checked** or **Paused**). Select **Set period** (or **Change**) to open it:

- **Keep for (months)**: from 1 to 1200. 84 months is 7 years.
- **Counted from**: **Last change** (records still being updated are not flagged) or **Creation**.
- **Schedule category**: the heading in your records schedule. The choices are the list **Retention category** under **Lists**.
- **Notes**: where the period comes from, for example the schedule item.
- **Check these records every day**: switch off to pause the check for this type. Records already flagged stay on the list.

Select **Save**. The audit log's own period is under **Settings > Retention**.

### Reviewing flagged records

The **Review** tab lists the records past their period. **Show** switches between **Waiting for a decision**, **Kept longer** and **Removed for good**; **Record type** narrows the list. Select **Run the check now** at the top of the page to check at once instead of waiting for the daily check, for example after changing a period. Records you may not see (restricted ones, without **View** on **Security incidents and restricted records**) are not listed.

For each record waiting for a decision:

- **Keep longer**: choose **For a number of months** or **Until a date**, give a **Reason** and select **Keep longer**. The record leaves the list and is flagged again once that date has passed.
- **Remove…**: give a **Reason**, tick **I understand that this record will be deleted permanently** and select **Remove for good**. You are asked for your password if you have not given it recently. The record, its comments, tags and links are deleted and cannot be brought back. A record with files attached cannot be removed until its files are. The audit log keeps the record's history and a note of the removal with your reason.

## API tokens

An API token lets a script or another system use the application's API as a person, limited to the permissions chosen for the token. Each person makes their own on the **Account security** page (see "API tokens" under "My account" below).

Open **Administration > API tokens** to see everyone's tokens: the **Owner**, the **Token** name and its first characters, its **Permissions**, when it **Expires**, when it was **Last used** and from which address, and its **Status** (**Active**, **Expires soon**, **Expired** or **Revoked**). Search by name, owner or permission, and filter by **Status** or **Owner**.

Select **Revoke** and confirm to stop a token at once, for example when someone leaves or a token may have leaked. Tell the owner: anything using it will be refused. Revoking cannot be undone.

A token can never do more than its owner can do at the time. Every change made with a token is recorded in the audit log with the token's name. Tokens cannot sign in, change account security or manage tokens, and cannot confirm a password, so they cannot make the changes listed under "Confirming your password". The longest life and the request limit are under **Settings > API tokens**.

### API reference

**Help > API reference** lists every route the signed-in person may call, grouped by subject, with the method, parameters, request body and what comes back. Type in **Filter routes** to narrow the list, for example "tickets", "POST" or "/api/admin"; select a route to open it. The page also links to the machine-readable description, `openapi.json`.

## Webhooks

A webhook tells another system, straight away, when records are added, changed or deleted. Open **Administration > Webhooks**.

**Nothing is sent until outbound connections are switched on.** Under **Settings > Outbound connections**, switch on **Outbound connections** and add the receiving host to **Allowed hosts**. Until then every delivery is recorded as blocked, and the page says so at the top. A webhook whose host is not allowed is marked **Host not allowed**.

### Adding a webhook

1. Select **Add webhook**.
2. Enter a **Name** and the **Address** the receiving system gave you (an `https` address with no user name or password in it).
3. Under **Events**, tick **Every change to every record type**, or choose the record types and changes (added, changed, deleted or any change) to send.
4. Tick **Include restricted records** only if the receiver should get security incidents, risks and records flagged restricted. Only someone holding **View** on **Security incidents and restricted records** can switch this on, and those records stop being sent if that person loses it.
5. Leave **Secret** empty to have a strong one made for you, and select **Add webhook**.

The **signing secret** is then shown once. Select **Copy secret** and give it to whoever runs the receiving system; it cannot be shown again, only replaced.

### What is sent

Each event is sent as a JSON `POST`: the record's type, reference, title and fields, and for a change the values before and after. Every delivery is signed: the header `X-GRC-Signature` holds `sha256=` and the HMAC-SHA256, made with the secret, of the `X-GRC-Timestamp` header, a full stop and the body. A delivery that fails (no answer within 10 seconds, or an answer other than 2xx) is tried again after 1, 5, 30, 120 and 720 minutes, then marked failed. Redirects are never followed.

### Managing webhooks

The list shows each webhook's events, when it last delivered, how many deliveries are waiting and how many failed or were blocked in the last 7 days. The **On** switch pauses or restarts a webhook. The **…** menu offers:

- **Edit**: change the name, address, events or the restricted-records choice. Changing the address or including restricted records asks for your password.
- **Deliveries**: the delivery log, newest first, with each delivery's event, status (**Delivered**, **Waiting to retry**, **Failed** or **Blocked**), attempts and the reason for a failure. Select **Send again** on a failed or blocked delivery.
- **Send a test**: sends a `webhook.test` event at once and says what happened.
- **Replace secret**: makes a new secret, shown once. The receiver must be given it, or it will reject deliveries.
- **Remove**: stops the webhook for good and cancels deliveries still waiting. The delivery log is kept.

## The audit log

The audit log records every sign-in, change, export and permission change: who did it, when, from which network address, and the values before and after. Entries cannot be edited or deleted by anyone. Open **Administration > Audit log**.

### Finding events

Events are listed newest first, 50 to a page. Use **Older** and **Newer** to move between pages. Combine any of these filters:

| Filter | Use it to |
|---|---|
| **Search** | Find text in the summary, the person's name or the action. |
| **Action** | Show one exact action name, for example `signin.failure`. The action name is shown in small print under **What happened** on every event. |
| **Record type** | Show events for one kind of record, such as Risk, Project, User or Role. |
| **Done by** | Show one person's actions. |
| **From** and **To** | Limit the dates. Both days are included. |

Every filter in use is shown under the filter boxes as a pill, for example "Record type: Risk" or "From: 1 Nov 2026". Select the cross on a pill to remove that one filter, or **Clear all** to start again.

Each row shows **When**, **Who**, **What happened** (with the action name in small print beneath it), the **Record** type and **From** (the network address). "System" under **Who** means the application did it by itself: for example loading sample data or a timed check. "Not signed in" means a request from somebody who was not signed in, such as a failed sign-in or a refused one-time link; **From** shows where it came from. A row marked **Values recorded** has before and after values to look at.

### Before and after

Select the arrow at the start of a row to open its details. Each field that changed has one line: the field's name, the old value struck through on a red background, an arrow, and the new value on a green background. Names and list values are shown as people see them on the record where the application knows them.

- When a record was created there is no old value, so only the new values are shown; when something was removed, only the old ones.
- When a list changed, such as a role's permissions, the line shows what was removed and what was added, and how many entries stayed the same.
- A long value, or one stored as structured data, is folded to one line. Select **Show all** to open it.
- Some events, such as a sign-in, record no field values and say so.

Under the values are the event number and shortcuts: a link to open the record (where it has a page), **Only "…" events** to filter the log to that action, and **Only this record** to see everything that happened to that record.

To see the history of one record without leaving it, use the **History** tab on the record itself.

### Exporting

1. Set the filters so that the list shows the events you want.
2. Select **Export CSV**.

A file named with today's date is downloaded, containing every event that matches the filters, not only the page on screen, up to the newest 50,000. The export is itself recorded in the audit log.

## My account: the Account security page

Every user has this page. Select your name at the top right and choose **Account security**. The same menu has **Change password**, **Help** and **Sign out**.

If a second factor is required for your account and you have not set one up, this page is shown by itself after you sign in, without the menu, with a red notice at the top and a **Sign out** button. Set up the second factor as described under "Setting it up for yourself"; as soon as you select **Confirm and turn on** the rest of the application opens, and your recovery codes stay on screen until you have saved them.

### Password

The **Password** card shows when your password was last changed. To change it:

1. Select **Change password**.
2. Enter your **Current password**, then the **New password** and **Repeat new password**.
3. Select **Change password**.

Use at least the minimum number of characters shown on the card; a phrase of several words works well. Changing your password signs you out everywhere else.

### Second factor

The **Second factor** card shows whether it is on and how many recovery codes are left. Setting it up (by scanning a square code or typing a key), replacing recovery codes and turning it off are described under "Second factor" above.

### Where you are signed in

This card lists every browser you are signed in from, with its **Address**, when you **Signed in** and when it was **Last active**. The one you are using is marked **This session**.

- Select **End** on a session to sign that browser out.
- Select **End all other sessions** to keep only the one you are using.
- Select **Sign out** on your current session to sign out here.

If you do not recognise a session, end it and change your password.

### API tokens on your account

The **API tokens** card lists your tokens, with their first characters, expiry, last use and permissions. Expired and revoked tokens are folded away under **Expired and revoked tokens**.

To make one:

1. Select **New token**.
2. Enter a **Name** saying what will use it.
3. Under **Permissions**, choose what the token may do. Only permissions you hold are offered; **View only, everywhere I can see** picks every view permission at once. If your own access is reduced later, the token's is too.
4. Choose when it **Expires after**: the shortest time that will do.
5. Select **Make token**, and confirm your password if asked.

The token is shown once. Select **Copy token** and keep it somewhere safe, such as a password manager; when you select **Done** it cannot be shown again. Send it in the header `Authorization: Bearer <token>`. Select **Revoke** on a token to stop it at once. The **API reference** under **Help** lists what a token can call.

## Not available yet

- Sign-in is by username and password held in the application only. There is no single sign-on, no passkeys and no emergency access account.
- The application sends no email. Setup and reset links must be passed on by hand, and there are no email or in-app notifications of any kind.
- Confirming your password does not also ask for your second factor.
- The **Self-service portal** permissions can be ticked on a role but do not control anything yet. They are marked **not yet used** on the role page.
- The audit log's filters are not kept in the page address, so a filtered view cannot be bookmarked.
- Roles cannot be deleted and user accounts cannot be removed; switch off or disable them instead.
- New lists cannot be created on screen, and the special behaviour of supplied values cannot be given to values you add.
- The self-service portal is not built, although its switch appears under **Settings**.
- Retention only flags whole records for a decision; records cannot yet be anonymised instead of removed.
- Webhooks are sent for record changes only, not for other events such as a notification clock turning red.
- Risk scales and the framework target status have no settings screen.
