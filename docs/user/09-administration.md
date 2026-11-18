# Administration

This page is for administrators. It explains how to add people and give them access, how roles and permissions work, how to manage the second sign-in factor, how to change the choices offered in drop-down lists, the application settings, and how to read the audit log. The last section, on the **Account security** page, applies to every user. The administration screens are in the **Administration** group of the menu: **Users**, **Roles**, **Lists**, **Settings** and **Audit log**.

## What you need

- **Users**, **Roles**, **Lists** and **Settings** need **Administer** on **Administration**. The built-in **Administrator** role has it.
- **Audit log** needs **View** on **Audit log**. The built-in **Administrator** and **Security lead** roles have it.
- **Account security** is open to every signed-in user, for their own account.

The first administrator is created by the setup wizard the first time the application is opened. There is no default account.

### Confirming your password

Some changes decide who can do what, so the application checks it is really you before making them. If you have not given your password in the last 10 minutes, a **Confirm your password** box appears when you:

- add a role, change a role's permissions, switch a role on or off, or change **Members must use a second factor**;
- select **Apply default permissions**;
- add a user or change a person's roles;
- reset a person's second factor, or issue a setup or password-reset link;
- change anything under **Sign-in and passwords** in **Settings**.

Enter your password and select **Confirm and continue**. The change you asked for is then made; you do not need to repeat it. Select **Cancel** and nothing is changed. You are not asked again for the next 10 minutes (an administrator can change this under **Settings**). Signing in counts, so you will not see the box straight after signing in.

## Users

Open **Administration > Users**. People are added by an administrator; nobody can register themself.

The list shows each person's **Name** and email, **Username**, **Status**, **Roles**, **Second factor** (On or Not set up), **Department** and **Last sign-in**. Search by name, username or email, and filter by **Status** or **Role**.

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

You do not set a password. Instead, a window shows a **one-time setup link**.

### One-time setup and reset links

The application does not send email, so you pass the link on yourself.

1. Select **Copy** beside the link.
2. Give it to the person directly: in person, by phone or by a private message.
3. Select **Done**.

Things to know about a link:

- It is shown once. The application keeps no readable copy, so it cannot be shown again.
- It works once, and for 24 hours.
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

The **Recent account events** card on a person's page lists the latest sign-ins and changes to that account, with who did it and the network address it came from. You need access to the audit log to see it.

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

Open a role. The **Permissions** card is a grid with one row for each area of the application and one column for each kind of action.

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
3. Select **Save role**. Changes apply at once. Select **Undo changes** to go back to what was saved.

The **Members** card lists who holds the role. To give a role to someone, or take it away, go to that person's page.

The **Administrator** role holds every permission, shown as a single star. That cannot be removed.

The grid lists every area the application defines, including some whose screens are not built yet. Ticking those has no effect today.

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
- Everyone, if **Second factor for everyone** is switched on under **Settings**.

What happens to a person who is expected to use a second factor and has not set one up depends on **When a second factor is expected** under **Settings**:

| Choice | What the person sees |
|---|---|
| **Off: no reminder** | Nothing. |
| **Reminder only** (the starting value) | A notice at the top of every page with a **Set it up now** link. They can still sign in and work. |
| **Required** | After signing in, nothing works except **Account security** (to set the second factor up or change their password) and signing out, until they have set it up. |

The application starts on **Reminder only** so that nobody is locked out by surprise. **Switch to Required before you put real records in.** You must set up your own second factor first; the application refuses the change otherwise. Use the **Second factor** column on the **Users** list to see who has not done it. If you want to give people time, set **Grace period (days)**: each person can keep working for that many days from their first visit, then the block applies.

A 6-digit code works once. If you have just used a code, wait for the app to show the next one.

### Setting it up for yourself

1. Select your name at the top right and choose **Account security**.
2. On the **Second factor** card, select **Set up an authenticator app**.
3. In your authenticator app, add an account and choose to enter a setup key by hand. Type the key shown, or select **Copy key**. If your app accepts a setup address, you can copy that instead.
4. Enter the 6-digit code the app now shows and select **Turn on**.
5. Your **recovery codes** are shown, once only. Select **Copy codes** or **Print**, keep them somewhere safe and separate from your phone, then select **I have saved them**.

Any standard authenticator app that supports time-based codes will work. There is no code to scan in this version.

### Recovery codes

You get ten recovery codes. Each one signs you in once in place of the 6-digit code, for when your phone is lost or broken. To use one, sign in with your username and password as usual and, when asked for the **6-digit code**, type a recovery code instead. There is also a separate page, **Sign in with a recovery code**, at the address `/sign-in/recovery`, which asks for your username, password and a recovery code together.

The **Second factor** card shows how many codes are left. To replace them, select **New recovery codes** and enter your current password. The old codes stop working.

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

The left-hand panel names every list with the number of values in it. Select one to see its values in the order they are offered, with **Shown as**, **Stored value** and **State** (In use or Retired).

### Adding a status or category

1. Select the list, for example **Risk category**.
2. Select **Add value**.
3. In **Shown as**, type the text people will see. The stored value is made from it and shown underneath.
4. Choose a **Colour**. The **Preview** shows how the value will look as a chip.
5. Select **Add value**.

The new value is available in the relevant drop-downs at once.

### Renaming, recolouring and reordering

- Select **Edit** on a value to change the text or the colour. The stored value never changes, so renaming is safe: existing records simply show the new text.
- Use the up and down arrows in the **Order** column to change the order in which values are offered.

### Retiring a value

Values are retired, never deleted, so that existing records keep their meaning.

- Select **Retire** on a value. It can no longer be chosen, but records that already use it still show it.
- Select **Restore** to bring a retired value back.

### What to be careful about

Some values carry behaviour as well as a name, and that behaviour belongs to the values supplied with the application. For example, an action counts as finished when its status is **Done** or **Cancelled**, and a framework outcome's status decides how much it counts towards the score. A value you add yourself is an ordinary value with none of this behaviour: a new action status is treated as open, and a new outcome status counts as zero. A few lists are fixed steps in a process, such as the project stages, the incident statuses and the notification triggers; add to or retire from those only after testing the effect.

Rename supplied values freely, but be cautious about retiring them. You cannot create a new list on this screen.

## Settings

Open **Administration > Settings**. Make your changes, then select **Save settings** at the top right, or **Undo changes** to discard them. Every change is recorded in the audit log with the old and new value.

### Application

| Setting | What it does |
|---|---|
| **Name** | The application's name, up to 60 characters. Shown on the sign-in page, in the header and as the account name in authenticator apps. |
| **Pilot mode** | While on, every page carries a banner saying this is a pilot and that only test data should be entered. Switch it off only when the application is approved for real use. It starts switched on. |

### Feature switches

Feature switches control parts of the application that stay hidden until you turn them on. One is listed: **Self-service portal**, which starts off. The portal's pages are not built in this version, so leave it off.

The audience roles (Requester, Approver, Executive viewer, Auditor) are not here. They are switched on the **Roles** page.

### Sign-in and passwords

| Setting | Starts at | Allowed | Notes |
|---|---|---|---|
| **Minimum password length** | 14 | 12 to 128 | Never below 12. There are no rules about capitals, numbers or symbols and no forced periodic change. Commonly used passwords, and passwords containing the username, are always refused. |
| **Password history** | 5 | 0 to 24 | How many of a person's previous passwords may not be reused. 0 turns the check off. |
| **Idle time-out (minutes)** | 30 | 5 to 480 | A session ends after this long without activity. Every session also ends 8 hours after sign-in, whatever this is set to. |
| **Second factor for everyone** | Off | On or off | Expects every user, not only certain roles, to set up a second factor. |
| **When a second factor is expected** | Reminder only | Off, Reminder only, Required | What happens to people who are expected to have a second factor and do not. See "Second factor" above. You need your own second factor before choosing **Required**. |
| **Grace period (days)** | 0 | 0 to 30 | With **Required**, how long a person may keep working before the block applies, counted from their first visit. 0 means no grace period. |
| **Password confirmation (minutes)** | 10 | 1 to 60 | How long after giving your password you can make sensitive changes without being asked again. See "Confirming your password". |

Changing any setting in this table asks you to confirm your password.

### Departments

The **Departments** card on the same page holds the list used to group people.

- Select **Add**, enter a name and select **Save**.
- Select **Rename** to change a name.
- Select **Remove** to delete a department. The people in it are left without a department.

Department changes save immediately; they do not wait for **Save settings**.

## The audit log

The audit log records every sign-in, change, export and permission change: who did it, when, from which network address, and the values before and after. Entries cannot be edited or deleted by anyone. Open **Administration > Audit log**.

### Finding events

Events are listed newest first, 50 to a page. Use **Older** and **Newer** to move between pages. Combine any of these filters:

| Filter | Use it to |
|---|---|
| **Search** | Find text in the summary, the person's name or the action. |
| **Action** | Show one exact action name, for example `signin.failure`. The action name is shown in the **Action** column of every event. |
| **Record type** | Show events for one kind of record, such as Risk, Project, User or Role. |
| **Done by** | Show one person's actions. |
| **From** and **To** | Limit the dates. Both days are included. |

Select **Clear filters** to start again.

Each row shows **When**, **Who**, **Action**, **What happened**, the **Record** type and **From** (the network address). "System" under **Who** means the application did it by itself: for example loading sample data or a timed check. "Not signed in" means a request from somebody who was not signed in, such as a failed sign-in or a refused one-time link; **From** shows where it came from.

### Before and after

Select the arrow at the start of a row to open its details. A table lists each field that was recorded, with its value **Before** and **After** the change. Some events, such as a sign-in, record no field values and say so.

To see the history of one record without leaving it, use the **History** tab on the record itself.

### Exporting

1. Set the filters so that the list shows the events you want.
2. Select **Export CSV**.

A file named with today's date is downloaded, containing every event that matches the filters, not only the page on screen, up to the newest 50,000. The export is itself recorded in the audit log.

## My account: the Account security page

Every user has this page. Select your name at the top right and choose **Account security**. The same menu has **Change password**, **Help** and **Sign out**.

### Password

The **Password** card shows when your password was last changed. To change it:

1. Select **Change password**.
2. Enter your **Current password**, then the **New password** and **Repeat new password**.
3. Select **Change password**.

Use at least the minimum number of characters shown on the card; a phrase of several words works well. Changing your password signs you out everywhere else.

### Second factor

The **Second factor** card shows whether it is on and how many recovery codes are left. Setting it up, replacing recovery codes and turning it off are described under "Second factor" above.

### Where you are signed in

This card lists every browser you are signed in from, with its **Address**, when you **Signed in** and when it was **Last active**. The one you are using is marked **This session**.

- Select **End** on a session to sign that browser out.
- Select **End all other sessions** to keep only the one you are using.
- Select **Sign out** on your current session to sign out here.

If you do not recognise a session, end it and change your password.

## Not available yet

- Sign-in is by username and password held in the application only. There is no single sign-on, no passkeys and no emergency access account.
- The application sends no email. Setup and reset links must be passed on by hand, and there are no email or in-app notifications of any kind.
- When the second factor is **Required**, a person who has not set one up is not taken to **Account security** automatically after signing in. They see pages that fail to load until they open **Account security** from the menu under their name. Tell people this when you switch it on.
- Confirming your password does not also ask for your second factor.
- The **Dashboards**, **Reports** and **Portal** permissions can be ticked on a role but do not control anything yet.
- Roles cannot be deleted and user accounts cannot be removed; switch off or disable them instead.
- New lists cannot be created on screen, and the special behaviour of supplied values cannot be given to values you add.
- The self-service portal is not built, although its switch appears under **Settings**.
- There are no settings for how long records are kept.
- Risk scales and the framework target status have no settings screen.
