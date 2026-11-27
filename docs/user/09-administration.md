# Administration

This page is for administrators. It explains how to add people and give them access, how roles and permissions work, how to manage the second sign-in factor, how to change the choices offered in drop-down lists, the application settings, and how to read the audit log. The last section, on the **Account security** page, applies to every user. It also covers single sign-on with your organization's identity provider and the break-glass account (**Sign-in providers**), your own fields on records (**Custom fields**), how long records are kept (**Retention**), **API tokens**, **Webhooks** and the **API reference**. It also covers the organization's name, logo and colors (**Organization**) and switching parts of the application on and off (**Features**). The administration screens are in the **Administration** group of the menu; the table under [The Administration menu](#the-administration-menu) says where each one is described.

## What you need

- Most screens in the **Administration** group need **Administer** on **Administration**. The built-in **Administrator** role has it.
- **Audit log** needs **View** on **Audit log**. The built-in **Administrator** and **Security lead** roles have it, and so does the **Auditor** role (switched off to begin with).
- **Risk scales** needs **Administer** on **Risks** to change the scales. **Hazard matrix** needs **Administer** on **Safety**. **Service desk settings** is listed for anyone with **View** on **Tickets**; changing them needs **Administer** on **Tickets**.
- **Account security** is open to every signed-in user, for their own account.

### The Administration menu

| Screen | What it is for | Described in |
|---|---|---|
| **Users** | Add people, give them roles, issue sign-in links | [Users](#users) |
| **Roles** | Roles and their permissions | [Roles and permissions](#roles-and-permissions) |
| **Sign-in providers** | Single sign-on and the break-glass account | [Sign-in providers](#sign-in-providers-single-sign-on) |
| **User provisioning** | Let your identity provider create and switch off accounts | [User provisioning](35-user-provisioning-and-log-forwarding.md#user-provisioning) |
| **Outside reviewers** | Every outside auditor or funder's reviewer invited to one audit or review, and revoking their access | [Outside reviewers](25-audits-and-inspections.md#outside-reviewers) |
| **Lists** | The choices in drop-down lists, and tags | [Lists](#lists) |
| **Asset tags** | Tag formats, tag stock, printing tags and their settings | [Asset tags](38-asset-tags.md#tag-formats) |
| **Organization** | The organization's names, address, contacts, logo and colors | [Organization](#organization) |
| **Settings** | Passwords, second factor, sessions, tokens, outbound connections | [Settings](#settings) |
| **Features** | Switch parts of the application on and off | [Features](#features) |
| **Custom fields** | Your own fields on records | [Custom fields](#custom-fields) |
| **Lifecycles** | Allowed status changes and the fields each status needs | [Lifecycles](23-lifecycles.md) |
| **Approval workflows** | Who approves what, step by step | [Approval workflows](22-approval-workflows.md) |
| **Email** | Outgoing email, templates, delivery log, text messages | [Email settings](14-attachments-and-notifications.md#email-settings) |
| **Reminders** | How far ahead reminders go out | [Reminders](14-attachments-and-notifications.md#reminders) |
| **Mobile app** | How long the app stays signed in, whether it must be unlocked, and how long a phone keeps its offline work (only while the mobile app is switched on) | [The mobile app](39-mobile-app.md#for-administrators) |
| **Push notifications** | Your organization's credentials for push notifications to the app on iPhone and Android, and a test push (only while the mobile app is switched on) | [The mobile app](39-mobile-app.md#for-administrators) |
| **API tokens** | Everyone's API tokens | [API tokens](#api-tokens) |
| **AI assistant access** | Whether AI assistants may connect | [AI assistants and MCP](21-ai-assistants-and-mcp.md) |
| **Webhooks** | Tell other systems about changes | [Webhooks](#webhooks) |
| **Log forwarding** | Send the audit log to a security monitoring system | [Log forwarding](35-user-provisioning-and-log-forwarding.md#log-forwarding) |
| **Calendar and work trackers** | Calendar feeds and connections to an outside work-tracking tool | [Calendar feeds, work trackers and evidence links](36-calendar-feeds-work-trackers-and-evidence-links.md#set-up-a-connection) |
| **Background jobs** | Work the application does by itself | [Background jobs](14-attachments-and-notifications.md#background-jobs) |
| **Retention** | How long records are kept | [Retention](#retention) |
| **Data loads** | What data load mode created, by day and record type, and undoing a load | [Data load mode](#data-load-mode) |
| **Legal holds** | Keep records for a matter so they cannot be deleted or anonymized | [Legal holds](33-legal-holds.md) |
| **Audit log** | Who did what, and when | [The audit log](#the-audit-log) |
| **About** | The version installed, and whether a newer release exists | [About and updates](#about-and-updates) |
| **Service desk settings** | Priorities, targets, calendars, escalation, the portal and email to ticket | [Service desk settings](02-service-desk.md#service-desk-settings) |
| **Risk scales** | The likelihood and impact scales for risks | [Editing the risk scales](06-risks-actions-obligations.md#editing-the-risk-scales) |
| **Risk appetite** | How much risk the organization accepts, by category | [Risk appetite](06-risks-actions-obligations.md#risk-appetite) |
| **Hazard matrix** | The levels and cell ratings of the safety hazard matrix | [Change the hazard matrix](20-safety-management.md#change-the-hazard-matrix) |
| **Safety reporting rules** | Which safety events must be reported to whom, and by when | [Safety reporting rules](20-safety-management.md#safety-reporting-rules) |
| **Confidential safety reports** | Who may see the identity of a safety reporter who asked to stay confidential | [Confidential reporting](20-safety-management.md#confidential-reporting) |
| **File settings** | Upload limits, malware scanning, storage, removed files | [File settings](14-attachments-and-notifications.md#file-settings) |
| **Backups** | Daily backups to a second location | [Backups](14-attachments-and-notifications.md#backups) |

A screen that belongs to a part switched off under **Features** is not shown. The staff roster (**People** and **Positions**) is in the **People** group of the menu, with **Qualifications** and **Certifications**; see [People and qualifications](29-people-and-qualifications.md).

The first administrator is created by the setup wizard the first time the application is opened. There is no default account.

### Confirming your password

Some changes decide who can do what, so the application checks it is really you before making them. If you have not given your password in the last 10 minutes, a **Confirm it is you** box appears when you:

- add a role, change a role's permissions, switch a role on or off, or change **Members must use a second factor**;
- select **Apply default permissions**;
- add a user or change a person's roles;
- **Enable** a person whose account was disabled, or change a person's email address (password-reset links go there);
- reset a person's second factor, or issue a setup or password-reset link;
- change anything under **Security**, **API tokens** or **Outbound connections** in **Settings**, or the **Idle time-out** under **Sessions**;
- switch a part of the application on or off under **Features**;
- make an API token, add a webhook, change where a webhook sends or whether it includes restricted records, or replace a webhook's secret;
- anonymize a record or remove it for good from the **Retention** review list;
- add, change or remove a sign-in provider, switch **Allow sign-in with a password** off or on, or change the **Application address**;
- on a person's **Single sign-on** card: save **Ways to sign in**, **Allow** a link at next sign-in, **Unlink** an identity, or make or remove the break-glass account;
- link or unlink a provider on your own **Account security** page, including linking a directory (with its user name and password);
- change the allowed source addresses of an API token.

Outside this section, the same box appears when you allow another file type for uploads, change file storage, scanning or backups, change the email settings, switch the self-service portal on or off from the service desk settings, switch on vendor response links, merge duplicate vulnerability findings, or connect an AI assistant. The full list, with the reason for each and the actions that deliberately do not ask, is in [Security](../security.md#actions-that-ask-you-to-confirm-your-identity).

Enter your password and select **Confirm and continue**. If you have a second factor, the box then asks for it too: type the **6-digit code** from your authenticator app (or a recovery code), or select **Use your passkey or security key**, and select **Confirm and continue** again. A wrong code is refused with "That code was not accepted", and too many wrong attempts make you wait a few minutes. The change you asked for is then made; you do not need to repeat it. Select **Cancel** and nothing is changed. You are not asked again for the next 10 minutes (an administrator can change this under **Settings**). Signing in counts, so you will not see the box straight after signing in; that includes signing in through a provider. If you have no password here (you only sign in through a provider), the **Single sign-on** card on **Account security** offers **Confirm with …** instead: you sign in at the provider again and come back. If your account is linked to a directory, the box itself offers **Confirm with**: choose the directory and enter your directory password (the directory user name you last used is filled in; change it if you need to), then your second factor if you have one.

## Users

Open **Administration > Users**. People are added by an administrator; nobody can register themself.

The list shows each person's **Name** and email, **Username**, **Status**, **Roles**, **Second factor** (On or Not set up), **Department** and **Last sign-in**. **Second factor** shows **On** when the person has an authenticator app or at least one passkey or security key; their page names which. Their keys are listed on their page. Search by name, username or email, and filter by **Status** or **Role**. Each filter in use appears under the search box as a pill; select the cross on a pill to remove that filter, or **Clear all** to remove them together. Select a person's name, or anywhere on their row, to open them.

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
4. Under **Roles**, check only what this person needs. With no role they can sign in but see nothing.
5. Select **Create user**.

You do not set a password. Instead, the window changes to show a **one-time setup link** for the person.

### One-time setup and reset links

When email is switched on (**Administration > Email**), the link is also emailed to the person's address. You are still shown it, so you can pass it on yourself if the email does not arrive. When email is off, you always pass the link on yourself. The link is shown in a large framed box, with a warning above it that it is shown once and, below it, the date and time it expires.

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
- On the **Roles** card, select or clear roles and select **Save roles**. A role marked "(switched off)" can be given but grants nothing until it is switched on. A role marked "needs a second factor" expects its members to set one up.

Role changes take effect immediately. An outside reviewer's account cannot be given roles: the application refuses, and so do role mapping from a sign-in provider and user provisioning.

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

Accounts of outside reviewers (people outside the organization invited to one audit or funder review, see [Outside reviewers](25-audits-and-inspections.md#outside-reviewers)) are listed here too. They are disabled by themselves when no review is open to them any more. Give them no roles: whatever their roles, they reach only the reviews they are invited to and their own account security. An outside reviewer's account you disable stays disabled even when someone invites them again.

Outside reviewers' accounts cannot hold roles: saving roles on one is refused, single sign-on role mapping and user provisioning never give them one, and any role that reaches one another way grants nothing and is taken off by the next check, every six hours. Their accounts are never offered when someone picks a person. They must set up a second factor at their first sign-in (see [Second factor](#second-factor)). If the server is ever started without the outside reviews part of the application, these accounts cannot sign in at all.

Two safeguards apply. You cannot disable your own account or remove your own administrator access; ask another administrator. And the application refuses any change that would leave no active administrator.

### Recent account events

The **Recent account events** card on a person's page lists the latest sign-ins and changes to that account, with how long ago, who did it and the network address it came from. Select **See all events for this account in the audit log** to open the audit log already filtered to that person's account. You need access to the audit log to see the card.

While a person is still **Waiting for setup**, the **Sign-in and security** card says whether a setup link is waiting to be used. The **Second factor** line is marked in amber when one of the person's roles expects a second factor and they have not set one up. **Sign-in providers** says how many single sign-on identities are linked to the account.

### Passkeys and single sign-on on a person's page

The **Passkeys and security keys** card lists the person's keys; see [Passkeys and security keys](16-passkeys-and-security-keys.md). **Reset second factor** removes their keys as well as their authenticator app.

The **Single sign-on** card has four parts:

- **Linked identities**: each provider the person can sign in with, the email it gave, how and when it was linked, and when it was last used. **Unlink** removes one; the person's account, roles and history stay. The last way a person can sign in cannot be unlinked.
- **Link at next sign-in**: for someone who cannot link a provider themselves (for example when passwords are switched off). Choose the **Provider** and select **Allow**. The person's next sign-in with that provider links it, provided the provider gives the same, verified email address as the account here. The permission lasts 7 days; **Withdraw** cancels it.
- **Ways to sign in**: check **Allow only the ways checked below**, then check **Password** and the providers this person may use, and select **Save**. Clear the box and save to allow every way again.
- **Break-glass account**: see "The break-glass account" below.

## Roles and permissions

A role is a named set of permissions. People get access only through the roles they hold, and a person may hold several. Open **Administration > Roles**.

### The roles supplied

| Role | Intended for | Starts |
|---|---|---|
| **Administrator** | Configuration, users and roles. Holds every permission. | On |
| **Agent** | Service desk and inventory work: tickets, knowledge, inventory, changes (including approving them and change settings), fleet and actions, finding asset tags and counting inventory, with read access to most other areas. | On |
| **Security lead** | Risks, frameworks, security incidents (and every restricted record), vulnerabilities, policies, training, vendors and contracts, the audit log, dashboards and reports, and the same service desk, inventory and change rights as an agent, with read access to projects, fleet and safety. Also controls and their testing, with read access to audits, committees, the staff roster, business continuity and privacy assessments. | On |
| **Project manager** | Projects, gates, status reports and actions. | On |
| **Safety manager** | Safety team: hazard log, safety events, investigations and indicators, audits and inspections, with the action tracker and read access to fleet, systems, sites, committees, the staff roster, business continuity, policies, training, dashboards and reports. | On |
| **Compliance officer** | Obligations, funding and grant compliance, controls and committees, with the action tracker and read access to audits, policies, vendors, contracts, projects, assets, fleet, the staff roster, dashboards and reports, business continuity, records requests, privacy assessments and legal holds. | On |
| **Audit lead** | Audits and inspections, controls and their testing, and the action tracker, with read access to committees, obligations, policies and framework outcomes. | On |
| **Training coordinator** | Training, the staff roster and qualifications, with read access to policies. | On |
| **Continuity manager** | Business continuity and emergency management: business processes, impact analyses, plans and activations, with the action tracker and read access to systems, sites, assets, fleet, vendors, the staff roster, exercises, dashboards and reports. | On |
| **Records and privacy officer** | Legal holds, requests for records and personal data, and privacy impact assessments, with the action tracker and read access to data categories, systems and reports. | On |
| **Asset manager** | Assets, sites and vehicles, their tags, inventory counts, condition and replacement, with the action tracker and read access to projects, funding, dashboards and reports. | On |
| **Approver** | People who approve changes, service requests, asset decisions and project gates. It does not include risks: a risk acceptance is recorded by someone who can see the risk, naming the approver. | Off |
| **Executive viewer** | Read-only dashboards and reports, projects, framework outcomes, committees and business continuity. | Off |
| **Auditor** | Read-only access to chosen areas, with export of framework evidence, audits and controls, and read access to business continuity, privacy assessments and legal holds. | Off |
| **Requester** | Anyone in the organization submitting their own requests. | Off |

The list shows each role's **Access** (for example "12 permissions in 5 areas", or "Everything"), the number of **Members**, whether a **Second factor** is Required or Optional, and a **Switched on** switch. Treat the supplied roles as a starting point and check each one's permissions against how your organization works.

The Compliance officer, Audit lead and Training coordinator roles come with the audits, controls, funding, committees and staff roster parts. On an installation set up before these roles existed, the three new roles appear by themselves; the new permissions of the roles you already have are offered under [Applying default permissions after an upgrade](#applying-default-permissions-after-an-upgrade).

The Continuity manager, Records and privacy officer and Asset manager roles come with the business continuity, legal holds, records requests and privacy, and asset condition parts. The three roles appear by themselves on an existing installation, and the new permissions of your existing roles are offered in the same way.

Asset tags add the permission area **Asset tags** with three permissions: **View** (tag history and stock), **Manage** (formats, stock, printing, attaching, replacing and ending tags) and **Count** (inventory counts). Asset managers get all three and agents get **View** and **Count**; on an existing installation they are offered under [Applying default permissions after an upgrade](#applying-default-permissions-after-an-upgrade). Finding a record by its tag needs no permission beyond seeing the record.

### Applying default permissions after an upgrade

To link a record to another one, a person needs permission to view the other record's area (for example **Sites** to choose a vehicle's depot); otherwise the link is refused as "not found". Since wave 19 the Training coordinator, Continuity manager and Asset manager roles include the view permissions they need for this; on an existing installation they are offered here.

A new version of the application may add permissions to the supplied roles. Your roles are never changed without you: when there is something to apply, the **Roles** page shows a notice listing, role by role, what would be added.

1. Read the list.
2. Select **Apply default permissions** and confirm your password if asked.

Applying only adds permissions. It never removes one, and it replaces a role's description only if you have never edited it. If you later remove one of the added permissions, it is not offered again. The first time you do this on an installation that was set up before this feature existed, the list may include permissions you removed on purpose in the past: remove them again afterward. Each role changed is recorded in the audit log.

### Switching roles on and off

The last four roles carry an **Audience switch** badge and start switched off. They exist so that you can begin with the IT team alone and open the application to wider audiences one at a time.

- To switch a role on or off, use the switch in the **Switched on** column, or open the role and use **Switched on** there.
- While a role is off, its members keep the role but get none of its permissions.
- On a narrow screen the **Switched on** column sits next to the role's name and the **Second factor** column is left out.
- Switching takes effect at once. Nobody needs to sign in again.
- Every switch is recorded in the audit log.
- The **Administrator** role cannot be switched off.

You can switch off any other role in the same way, which is the quickest way to suspend access for a whole group. There is no button to delete a role; switch it off instead.

### Reading and changing permissions

Open a role. The **Permissions** card is a grid with one row for each area of the application and one column for each kind of action. Every area the application knows about is listed. The grid scrolls inside its own frame: the column headings and the area names stay in view while you scroll, so you always know which box you are looking at.

- Type in **Find an area** to show only the areas whose name matches, for example "risk".
- Check **Only areas this role can use** to hide the areas where the role has nothing.
- The top right of the card shows how many areas the role reaches.
- With the keyboard, Tab moves from box to box and Space checks or unchecks.

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

1. Select or clear the boxes. Checking **All** on a row grants every action in that area, including any added in future.
2. On the **About this role** card you can also change the **Name** and **Description**, and check **Members must use a second factor**.
3. Select **Save role**. Changes apply at once. Until you save, **Unsaved changes** is shown beside the buttons; select **Undo changes** to go back to what was saved.

The **Members** card lists who holds the role. To give a role to someone, or take it away, go to that person's page.

The **Administrator** role holds every permission (stored as a single star), so every box is checked and cannot be changed.

The server tells the page which permissions something in this installation actually checks. A box for an action nothing checks (for example **Approve** on **Knowledge base**, or **Create** on **Audit log**) is grayed out and cannot be checked, because granting it would have no effect; if a role already holds such a permission, the box can still be unchecked. An area where nothing is checked at all (for example one whose part of the application is not installed) carries a small **not yet used** label. **All** still grants every action in the area, including any a later version starts to check. **Manage** and **Count** are actions of the **Asset tags** area only, so the other areas have no box in those columns. **View** on **Dashboards and overview** decides who sees the dashboards on the overview page.

### Which records a role reaches

A role can be limited to the records of its members' own departments or sites, so that a depot manager sees the hazards, safety events, inspections, vehicles, assets and actions of their own depot and not every depot's. Below **Permissions**, the **Which records** card lists the areas this role grants whose records carry a department or a site. For each, choose **All records**, **Their departments** or **Their sites**, then select **Save role** (this needs your password confirmed, like any change of permissions).

| Records | Carry |
|---|---|
| People on the roster | department and work site |
| Positions, projects, business processes | department |
| Assets, actions | department and site (an action takes its site from the hazard, safety event or inspection it came from) |
| Sites | the site itself |
| Hazards, safety events, vehicles, services, security zones, inventory counts | site |
| Inspections, inspection schedules, condition assessments | the site inspected or rated, when it is a site |

- **Their departments** are the department on the person's account (**Users**), their department on the staff roster and the departments they manage, and every department below those. **Their sites** are their work site on the roster and the sites they manage, and every site within those. See [People and qualifications](29-people-and-qualifications.md#departments).
- A record with no department or site, or another one, is hidden from them everywhere: lists, record pages, search, pickers, links, exports and the AI assistant, as restricted records are. They always see the records they created.
- A limit applies only to records that carry that kind of place: limited to **Their sites**, a role still reaches every project, since projects have no site.
- Another role of theirs that grants the same area with **All records** lifts the limit. The **Administrator** role cannot be limited.
- Figures (counts, charts and dashboards) still count every record, the same for everyone. A figure grouped by words (a name, an email address, notes) shows the words only of records the person can see: records outside their departments or sites, and restricted ones, are counted together under **Other records**, so the total is unchanged. Figures grouped by a list (status, priority, type) are the same for everyone.
- A person whose role is limited this way cannot widen their own reach: they cannot change the **Manager** or **Part of** of a department or site, merge departments, link a roster entry to their own account, or change the department, work site or status of their own roster entry. An administrator, or someone none of whose roles is limited, makes those changes.

Limiting a role narrows what its members work with; it does not keep records confidential. For that, use restricted records.

### Restricted records

Risks and security incidents are restricted. To see them a person needs **View** on **Security incidents and restricted records** in addition to the permission for the area itself. For example, a role with **View** on **Risks** but not on **Security incidents and restricted records** sees no risks at all. See [Risks, actions and obligations](06-risks-actions-obligations.md) and [Security incidents](07-security-incidents.md).

### Adding a role

1. Select **New role**.
2. Enter a **Name** and a **Description** saying who holds the role and what it is for.
3. Select **Create role**. The role starts with no permissions and opens on its own page.
4. Check its permissions and select **Save role**.

## Second factor

A second factor means a stolen password is not enough to sign in. After setting it up, a person is asked for a 6-digit code from an authenticator app each time they sign in.

### Who is expected to use one

- Members of any role that has **Members must use a second factor** checked. **Administrator** and **Security lead** have it to begin with.
- Everyone, if **Expect a second factor from every user** is switched on under **Settings > Security**.
- Outside reviewers (people invited from outside the organization to one audit or funder review), while **Outside reviewers must use a second factor** is on under **Settings > Security** (on to begin with). For them it is always required at once, whatever **Enforcement** and **Grace period** say: after their first sign-in they can only set up an authenticator app or a passkey, change their password or sign out.

What happens to a person who is expected to use a second factor and has not set one up depends on **Enforcement** under **Settings > Security**:

| Choice | What the person sees |
|---|---|
| **Off** | Nothing. |
| **Reminder** (the starting value) | A notice at the top of every page with a link to set it up. They can still sign in and work. |
| **Required** | After signing in they see the **Account security** page by itself, with no menu. They can set the second factor up, change their password or sign out, and nothing else, until it is set up. |

The application starts on **Reminder** so that nobody is locked out by surprise. **Switch to Required before you put real records in.** You must set up your own second factor first; the page warns you if you have not, and the application refuses the change. Use the **Second factor** column on the **Users** list to see who has not done it. If you want to give people time, set **Grace period**: each person can keep working for that many days from their first visit, then the block applies. During the grace period their **Account security** page states the date by which they must finish.

A 6-digit code works once. If you have just used a code, wait for the app to show the next one.

A passkey or security key counts as a second factor too (see [Passkeys and security keys](16-passkeys-and-security-keys.md)), and so does a multi-factor sign-in at your organization's identity provider when you trust that provider for it (see "The provider's own second factor" under Sign-in providers). A person signed in that way sees on **Account security** that the provider confirmed a second factor for this session.

On a new installation set up through the wizard, **Enforcement** starts at **Required** unless the person setting it up chooses **Only remind people for now**.

### Setting it up for yourself

1. Select your name at the top right and choose **Account security**.
2. On the **Second factor** card, select **Set up an authenticator app**. If you signed in more than a few minutes ago, you are asked to confirm your password first (see "Confirming your password").
3. In your authenticator app, choose to add an account and **scan the square code** shown on the page with your phone's camera. The code is always drawn in black on white, so it scans in the dark theme too.
4. If you cannot scan it, type the key shown under **Cannot scan? Type this key into the app instead**. It is written in groups of four to make it easier to read; the spaces do not matter. **Copy key** copies it without the spaces. If the app asks, the key is time based, with 6 digits and a new code every 30 seconds. For an app that accepts a set-up address, open **Show the set-up address** and copy that.
5. Under **Enter the code the app now shows**, type the **6-digit code** and select **Confirm and turn on**. Nothing changes until you do this; **Cancel** abandons the set-up.
6. Your **recovery codes** are shown, once only. Select **Copy codes**, **Download as text** or **Print**, keep them somewhere safe and separate from your phone, then select **I have saved them**. That button stays unavailable until you have copied, downloaded or printed the codes.

Any standard authenticator app that supports time-based codes will work. The square code and the key hold the same secret: do not photograph them or share your screen while they are showing. They are shown only during set-up.

### Recovery codes

You get ten recovery codes. Each one signs you in once in place of the 6-digit code, for when your phone is lost or broken. To use one, sign in with your username and password as usual and, when asked for the **6-digit code**, type a recovery code instead. There is also a separate page, **Sign in with a recovery code**, at the address `/sign-in/recovery`, which asks for your username, password and a recovery code together.

The **Second factor** card shows how many codes are left, and turns amber when three or fewer remain. To replace them, select **New recovery codes** and enter your current password. The old codes stop working and the new ones are shown once, with the same **Copy codes**, **Download as text** and **Print** buttons. The downloaded file is plain text named `recovery-codes.txt`; printing gives a page with the codes and none of the buttons.

### Turning it off for yourself

Select **Turn off** on the **Second factor** card, then enter your current password and either a 6-digit code or a recovery code. Your recovery codes stop working too, unless you still have a passkey or security key: then they stay, for signing in when the key is not at hand.

### Resetting it for someone else

When a person has lost both their phone and their recovery codes:

1. Confirm who is asking. A reset removes a protection from the account, so check by a means you trust, such as in person or by calling a known number.
2. Open the person from **Users**.
3. On the **Sign-in and security** card, select **Reset second factor** and confirm.

Their authenticator app and recovery codes stop working. Their passkeys and security keys are removed too, and their API tokens and AI assistant connections are revoked. They sign in with a password only until they set the second factor up again, so ask them to do that straight away. The button appears when the person has an authenticator app or a passkey or security key.

A person whose only second factor is a passkey can make recovery codes too (see [Passkeys and security keys](16-passkeys-and-security-keys.md#recovery-codes-for-passkeys)); if they have lost both their keys and their codes, use **Reset second factor** as above, or remove their keys from the **Passkeys and security keys** card on their page.

## Sign-in providers (single sign-on)

Single sign-on lets people sign in with their organization account, at your organization's identity provider, instead of a password kept here. Any provider that supports **OpenID Connect** or **SAML 2.0** works. People can also sign in here with their **directory** user name and password (Active Directory, OpenLDAP or another LDAP v3 directory): see [Directory (LDAP) sign-in](#directory-ldap-sign-in). Open **Administration > Sign-in providers**.

**Nothing is contacted until you switch a provider on.** A provider you have added but not switched on is never called, except when you select **Test connection** (OpenID Connect). A SAML provider is never called by the application at all: the browser carries every message, and its metadata is fetched only if you ask (see [SAML 2.0 providers](#saml-20-providers)). Nobody can register themself: people sign in through a provider only to an account an administrator has added or linked, unless you switch on **Create an account at first sign-in**.

The list shows each provider's name (with **Default** beside the default one) and issuer address (for SAML, its entity ID; for a directory, its address), its **Kind** (**OpenID Connect**, **SAML 2.0** or **Directory (LDAP)**), how many **Linked people** it has, its **Options** (**Role mapping**, **Creates accounts**, **No client secret** in red when one is missing; for SAML also **Certificate expired** or **Certificate expires soon**, **Key unreadable**, **Encrypted** and **Metadata refreshed daily** (or **Metadata refresh failing** in red); for a directory **No service account password** in red and **Pinned CA**) and an **On** switch. The **…** menu offers **Edit**, **Test connection** (for SAML, **Check settings** and **Download metadata**), **Make default** and **Remove** (only for a provider that is switched off).

### Registering the application with your provider

At your identity provider, register this application as a web application (a confidential client) using the **authorization code** flow. Give it the **redirect address** shown on the **Redirect address** card, with the provider's short name in place of `<short name>`, for example `https://grc.example.org/api/auth/sso/staff-directory/callback`. The provider gives you a **client ID** and a **client secret**, and states its **issuer** address.

Enter the address people type to open the application under **Application address** on the **Redirect address** card and select **Save address**. It must be an `https` address with no path, such as `https://grc.example.org`. On an installation other computers reach, set it: without it, single sign-on is refused (people see "Single sign-on needs the application address"), the card shows **Set the application address** instead of the redirect address, a SAML provider's addresses and metadata are not given out, and assistant (MCP) connections, calendar feeds and the work-tracker callback cannot hand out addresses. The application never builds these addresses from the address a browser happened to use, because anyone can send any address; only on an installation used on this computer alone (`localhost`, `127.0.0.1`) may the address stay empty. A provider on this computer or your internal network is reached only when its exact address (for example `10.20.0.5` or `127.0.0.1:8443`) is on **Allowed hosts** under **Settings**.

Settings for common kinds of provider:

| Kind of provider | Issuer | Email | Groups for role mapping |
|---|---|---|---|
| A cloud directory service | The tenant's own issuer, usually ending in the tenant identifier and a version, for example `https://<sign-in host>/<tenant id>/v2.0` | Often `email`; some directories send the address only in `preferred_username` or `upn` | `groups` (often group identifiers rather than names) or `roles` (application roles) |
| A government or sovereign cloud tenant of a major directory service | The same form, but on that cloud's own sign-in host, which differs from the commercial one. Copy it from the tenant's discovery document; never assume the commercial host | As above | As above |
| A self-hosted identity server | The server's address followed by a path for your realm or application, exactly as its discovery document states | `email`, with `email_verified` | Add a groups claim (often `groups`) to the ID token in the server's client settings |

The issuer must match the provider's discovery document exactly, including any trailing slash; **Test connection** tells you if it does not. Nothing about any provider is built in: issuer and every address come from the discovery document of the issuer you enter.

### Adding a provider

These steps are for **OpenID Connect**. For SAML 2.0, see [SAML 2.0 providers](#saml-20-providers).

1. Select **Add provider**, and keep **OpenID Connect** chosen under **Kind of provider**.
2. Under **About**, enter the **Name** shown on the sign-in button ("Sign in with …") and a **Short name** (lower-case letters, numbers and dashes; it is part of the redirect address and cannot be changed later). Check **Default provider** to make its button come first. Leave **Switched on** off until you have tested it.
3. Under **Connection**, enter the **Issuer** and **Client ID**, choose the **Client authentication** (most providers: **Client secret, sent in the Authorization header**) and enter the **Client secret**. The secret is stored encrypted and never shown again; to replace it later, type a new one. **Scopes** start as `openid email profile`. **Accepted signature algorithms** are RS256, ES256 and PS256; clear any you do not want. **Extra sign-in parameters** (one `name=value` to a line, for example a domain hint) are optional.
4. Under **Who the person is**, the **Email claim** is usually `email`. Check **Treat the provider's email address as verified** only for a directory that controls every address it issues but does not send `email_verified`: matching accounts by email relies on it.
5. Select **Add provider**. You are asked for your password if you have not given it recently.
6. Open the provider again (select its name) and select **Test connection**. The result says whether the discovery document and key set were read, and lists the **Sign-in address**, **Token address**, **Key set address**, the algorithms the provider signs with, the number of **Signing keys** and whether it **Offers PKCE (S256)**.
7. Switch it on with the **On** switch. Its button appears on the sign-in page at once.

The sign-in uses the authorization code flow with PKCE, a one-time `state` and a `nonce`; the ID token's signature, issuer, audience, expiry and nonce are all checked. A provider whose discovery document is not on `https` is refused (plain `http` is accepted only on the same machine, for trials).

### SAML 2.0 providers

Use SAML when your identity provider offers SAML only, or your organization runs it that way. The application signs people in with the SAML 2.0 **Web Browser SSO** profile, started here: the sign-in request goes to the identity provider with the **HTTP-Redirect** binding, and its answer comes back with the **HTTP-POST** binding.

1. Select **Add provider** and choose **SAML 2.0** under **Kind of provider**.
2. Under **About**, enter the **Name** shown on the sign-in button and a **Short name** (it is part of every address below and cannot be changed later). Leave **Switched on** off for now.
3. The box **Give these to your identity provider** shows this application's **Entity ID (audience)**, its **Assertion consumer service (ACS) address** and its **Metadata address**, each with **Copy**. Most identity providers read everything from the metadata address (or from the metadata file) in one step; otherwise, enter the entity ID and the ACS address (HTTP-POST binding) in the identity provider's application settings. Have it release the person's email address, display name and, for role mapping, groups as attributes, and a **persistent** name identifier.
4. Under **Identity provider**, read its metadata: **Paste the metadata (XML)** and select **Read pasted metadata**, or **Upload a metadata file**, or (only when outbound connections are switched on under **Settings** and its host is on the allowed hosts list) enter its address and select **Fetch**. The **Identity provider entity ID**, **Sign-in address (HTTP-Redirect binding)**, sign-out address and **Signing certificates** are filled in. You can also type them yourself. Nothing is saved until you save the provider.
5. Under **Who the person is**, choose the **Name identifier (NameID) format** (persistent unless your identity provider can only send the email address). The person is recognized by the NameID from then on; transient identifiers are refused because they change at every sign-in. **Email attribute** and **Display name attribute** can stay empty: the usual names (`email`, `mail`, the email address claim URI, `displayName` and so on) are tried. **Trust the email addresses this identity provider sends** starts checked for a SAML provider: SAML has no "email verified" statement, and matching existing accounts by email and creating accounts both need it. Uncheck it for an identity provider that lets people choose their own address.
6. Select **Add provider**. The application makes its own key and certificate for this provider at that moment (the private key is stored encrypted and never shown); open the provider again for **Download the metadata file**.
7. Give the metadata to the identity provider if you have not already, switch the provider on and sign in once through it to try the whole exchange (**Check settings** checks only what is stored).

**Message security.** Every answer must carry a valid signature, by one of the **Signing certificates** you entered, on the assertion or on the response around it; an unsigned answer is refused, and so is one signed with SHA-1 or anything weaker than RSA-SHA256. The answer must be for this application (audience), sent to this address (destination and recipient), in reply to this very sign-in (InResponseTo), from the identity provider's entity ID, and within its time limits (one minute of clock difference is allowed). Each assertion is accepted once. Answers the identity provider sends without being asked (identity-provider-initiated sign-in) are refused: people start at this application's sign-in page. Under **Message security** you can also:

- **Require the assertion itself to be signed** (otherwise a signed response around it is enough).
- **Sign sign-in requests**, for an identity provider that wants signed requests (reading metadata that asks for them switches this on).
- **Ask for encrypted assertions, and refuse unencrypted ones**: the metadata then offers an encryption key. Only AES-GCM with RSA-OAEP is accepted.

**Certificate changes.** When the identity provider announces a new signing certificate, add it under **Signing certificates** beside the old one and save; both are trusted. Remove the old one once the identity provider has switched. Each stored certificate is shown with its expiry date, and the list warns 30 days ahead; **Check settings** reports expired certificates. If this application's own key is lost (for example after the secret key was changed) or due for a change, check **Make a new key and certificate for this application when saving** and give the new metadata to the identity provider at once. Do the same if the identity provider refuses this application's certificate as unreadable: versions before this one made such a certificate for about one SAML provider in 128.

Role mapping, the provider's second factor, signing out and accounts created at first sign-in work as for OpenID Connect (below), with these differences: role mapping reads the **Groups attribute** (the attribute's `Name`, for example `groups`, `memberOf` or a role claim URI); the provider's multi-factor sign-in is shown by the assertion's **AuthnContextClassRef** (list the values your identity provider uses, for example `https://refeds.org/profile/mfa`; they are also asked for at sign-in); and signing out at the provider sends a signed logout request to the **Identity provider sign-out address**, after which the identity provider sends the browser back here.

**Sign-outs started at the identity provider (off unless you switch it on).** Under **Signing out**, switch on **Act on sign-outs started at the identity provider**, enter the **Identity provider sign-out address** (its answer goes there) and give the identity provider the new metadata: it lists this application's single logout address for both bindings. When the person then signs out at the identity provider, or in another application that shares its session, the identity provider sends a logout request here. It must be signed by one of the **Signing certificates** (RSA-SHA256 or stronger; unsigned requests are refused), come from the identity provider's entity ID, be addressed to this application's sign-out address, be no more than five minutes old, and is accepted once. The sessions here made through that provider for that person (only the one session the request names, when it names one) end, and a signed answer goes back to the identity provider. Each sign-out is recorded (`identity.saml_logout`, with how many sessions ended); a refused request is recorded as a failure. While the option is off, such requests are ignored as before.

**Signed metadata and a daily refresh.** Under **Read the identity provider's metadata**, open **Signed metadata and a daily refresh**. Paste the **Metadata signing certificate**, the certificate a federation or identity provider signs its metadata with (get it by a trusted route, not from the metadata itself): from then on, metadata you paste, upload or fetch must carry a valid signature by it, on the whole document, with RSA-SHA256 or stronger, and only what the signature covers is read; metadata past its `validUntil` date is refused. Enter the **Metadata address** and check **Refresh the metadata every day** to have it fetched again daily, through the background jobs. This needs outbound connections switched on and the host on the allowed hosts list under **Settings**, and accepts signed metadata only. A refresh adds new signing certificates (so a certificate change at the identity provider needs nothing from you), updates the sign-in and sign-out addresses, and keeps a certificate the metadata no longer lists for 7 more days before removing it. Metadata that names another entity ID, is not signed by the pinned certificate or is out of date changes nothing. Every refresh, and every failure, is recorded (`identity_provider.metadata_refresh`); the last one is shown under the option, and **Refresh now** runs one at once (you may be asked for your password).

### Directory (LDAP) sign-in

With a directory provider, people type their directory user name and password into this application's sign-in form, and the directory checks them. It works with Active Directory, OpenLDAP and other LDAP v3 directories. The directory is contacted only over an encrypted connection: an `ldaps://` address, or an `ldap://` address with **StartTLS**. Plain LDAP is refused (it would send passwords unencrypted), except to `127.0.0.1` for trials.

1. Select **Add provider** and choose **Directory (LDAP)** under **Kind of provider**. Enter the **Name** (shown on the sign-in form) and a **Short name**. Leave **Switched on** off for now.
2. Under **Connection**, choose the **Kind of directory** (**Active Directory**, **OpenLDAP** or **Another LDAP v3 directory**): the usual search filter and attributes below are filled in for it. Enter the **Directory address**, for example `ldaps://dc1.example.org` (add `:port` for another port), or an `ldap://` address with **Use StartTLS** checked.
3. **Trust only this CA certificate** is optional: paste your organization's CA certificate (or the directory's own certificate) in PEM form, and no other certificate is trusted for this directory. Empty, the system's trusted certificate authorities are used. Either way the certificate must be valid and name the host in the address.
4. Enter the **Service account DN**, an account made for this application that may read people's entries and groups (it never changes anything), and its **Service account password**. The password is stored encrypted with the secret key and never shown again; to replace it, type a new one. A directory where every person's DN follows one pattern and people may read their own entry can do without a service account: leave the DN empty and enter a **User DN template** such as `uid={username},ou=people,dc=example,dc=org`.
5. Under **Who the person is**, enter the **Base DN** where people are searched for, and check the **User search filter**: `{username}` is what the person types. It is escaped, so that whatever they type (`*`, brackets and so on) can only ever be one value, and exactly one entry must match. The **Identifier attribute** must never change for the person (`objectGUID` for Active Directory, `entryUUID` for OpenLDAP): it is what links the entry to an account here. **Email attribute** is usually `mail`. Check **Trust the email addresses in this directory** (it starts checked) only for your organization's own directory: matching existing accounts by email and creating accounts need it.
6. Select **Add provider**, open it again, enter a user name under **Look up a person (optional)** and select **Test connection**. The result shows the TLS version, the directory's certificate and its expiry, whether the service account and base DN work, and for the person looked up their DN, identifier, email, whether the account is disabled or locked, and their groups. No password is checked and nobody is signed in.
7. Switch the provider on. It appears on the sign-in form under **Sign in with**.

**Groups for role mapping.** Under **Role mapping**, choose where **Groups come from**: **The person's memberOf attribute**, or **A search for groups that list the person** (the **Group search filter**, where `{dn}` is the person's DN, and an optional **Group base DN**). **Include nested groups (Active Directory)** adds the groups the person is in through other groups, which Active Directory works out itself. A rule's group value is the group's full DN, exactly as the directory gives it: **Test connection** with a user name lists them to copy.

**At sign-in.** The service account finds the person's entry; then the directory checks the password with the person's own DN, on a connection of its own. An empty password is never sent. Disabled, expired and locked directory accounts are refused. A directory password is one factor: a person who has a second factor here (an authenticator app, or recovery codes) is asked for it next, and the second-factor requirement applies as for everyone. A person whose second factor is a passkey is asked for it after the directory password; a recovery code also works. Failures are limited as for a password: by address, by user name at the directory (five wrong passwords in 15 minutes stop further tries for that name for a while), and a wrong directory password counts toward the lockout of the account it is linked to. People always see the same "Sign-in failed" message; the audit log records the reason (`signin.failure`), never the password or the service account's details. Matching, linking and creating accounts work as for the other providers (below). A directory can also be linked from **Account security** (see "Single sign-on" under My account).

### Role mapping (off unless you switch it on)

Under **Role mapping**, switch on **Give roles from the provider's groups**, enter the **Groups claim** (for example `groups` or `roles`) and add rules with **Add rule**: a **Group value** and the role it **gives**. At every sign-in through that provider, each role named in a rule follows the person's groups: it is added when they are in a matching group and taken away when they are not. Roles that no rule names are never touched. A change that would leave nobody able to administer is not made, and is recorded in the audit log. Every role change made this way is recorded as a role change on the person.

**People in many groups.** Some cloud directories stop listing groups in the token when a person is in too many, and send a reference instead. The application then asks the provider's userinfo address, and the source the token names, for the list. If it still cannot get it, it leaves the person's roles as they are (recorded as `identity.groups_unknown`) rather than taking them away. If your provider never puts groups in the token, check **Also read groups from the provider's userinfo address**. For a directory whose group list needs its own kind of request, send application roles, or a filtered groups claim, in the token instead.

### The provider's own second factor (off unless you switch it on)

If your identity provider already makes people use a second factor, under **Second factor** switch on **The provider enforces multi-factor sign-in**. A sign-in through that provider then counts as the second factor here, so people who must have one (see [Second factor](#second-factor)) are not asked to set up another. It counts only when the provider's token shows a multi-factor sign-in: one of the **Authentication methods that show it (amr)** (usually `mfa`), or one of the **Authentication levels that show it (acr)** your provider uses. Levels you list are also asked for when the person signs in. A sign-in whose token does not show it counts for nothing, and the person is asked to set up a second factor here as usual. Switching the option off takes effect at once, for people already signed in too.

### Signing out at the provider (off unless you switch it on)

Under **Signing out**:

- **Signing out here also signs out at the provider** sends people to the provider's sign-out page when they sign out, so their organization session ends too; the provider then sends them back to the sign-in page. Register the return address shown (the application's address followed by `/`) with the provider. The provider must offer a sign-out address (**Test connection** shows it).
- **Let the provider end sessions here (back-channel sign-out)** lets the provider tell this application when a person signs out there or their directory account is disabled: their sessions here made through that provider end at once. Register the address shown (ending in `/backchannel-logout`) with the provider. It works only on a server installation the provider can reach. Each call is recorded (`identity.backchannel_logout`), and a call with a token that does not check out is refused and recorded.

### Accounts created at first sign-in (off unless you switch it on)

Under **New people**, switch on **Create an account at first sign-in** and list the **Allowed email domains**, one to a line (subdomains must be listed separately). Then a person the provider vouches for, whose verified email is in one of those domains and who has no account here, gets one at first sign-in, with only the roles role mapping gives (none without it). Anyone else with no account sees "there is no account here for you".

### How people's accounts are matched

- A person who has signed in through a provider before is recognized by the provider's identifier for them, whatever their email says now.
- A first sign-in whose verified email matches an existing account is **not** linked straight away. The sign-in page asks the person to sign in once with that account's password ("Link your sign-in"); only then are the two linked. They can also choose **Do not link**. An administrator's **Link at next sign-in** permission skips the password step.
- People can link and unlink providers themselves on **Account security**.
- The break-glass account is never linked and never signs in through a provider.

### Passwords

The **Passwords** card has the **Allow sign-in with a password** switch. Switch it off once everyone signs in through a provider: the sign-in page then shows only the provider buttons, with **Emergency access with a password** for the break-glass account. The application refuses to switch passwords off until there is a break-glass account and every other active person has a linked identity at a switched-on provider; the card names anyone still without one (open **… active people have no linked provider yet**). While passwords are off, a provider that some people depend on cannot be switched off, and the break-glass account can be neither disabled nor removed.

### The break-glass account

One local administrator kept for when single sign-on is unavailable (the provider is down, or misconfigured). It always signs in with its own password and second factor, never through a provider, and **every sign-in raises an alarm**: a `signin.break_glass` event in the audit log, an in-app notification to every administrator and, when email is switched on, an email to every administrator. The person using it sees a red notice at the top of **every page** for the whole session: "You are signed in with the break-glass account."

To set it up:

1. Add a user for it (for example "Emergency administrator") with the **Administrator** role, and set its password with the one-time link. Use a long random password (30 characters or more), written down and kept sealed somewhere safe.
2. Sign in as it once and add a second factor, ideally a hardware security key kept apart from the password (see [Passkeys and security keys](16-passkeys-and-security-keys.md)).
3. As another administrator, open the user, and on the **Single sign-on** card select **Make break-glass account** and confirm.

The account must be active, hold the Administrator role, have a password and no linked provider. There can be only one: remove the designation from the old one (**Remove break-glass designation**) before choosing another. The **Passwords** card on **Sign-in providers** names the break-glass account and whether it has a second factor. After any use, check the audit log, and change its password.

### What is recorded

Every sign-in through a provider (`signin.success`, naming the provider, and saying when the provider's multi-factor sign-in counted), every failure with its reason (`signin.failure`, for example "bad signature", "wrong audience", "token expired", "no account for this email", or for SAML "wrong InResponseTo", "assertion replayed", "unsolicited SAML response"), every provider change (`identity_provider.create`, `.update`, `.enable`, `.disable`, `.test`, `.delete`), every fetch of SAML metadata (`identity_provider.metadata_fetch`), every link and unlink (`identity.link`, `identity.unlink`), link permissions, changes to a person's ways to sign in, and break-glass designations and uses, each with the time and the network address it came from.

## Lists

Lists are the choices offered in drop-downs across the application: statuses, priorities, categories and so on. You can add to them and rename them without any change to the software. Open **Administration > Lists**.

The left-hand panel names every list (by its name, such as **Knowledge article category** or **OT security level**) with the number of values in it and, in small print, the record types that use it. Type in **Find a list** to narrow the panel by list name or record type. Select a list to see its values in the order they are offered, with **Shown as**, **Stored value** and **State** (In use or Retired), and a column for each setting the list keeps on its values (see [Settings of a value](#settings-of-a-value)). The list's stored key (for example `kb_category`) is shown in small print beside the **Used by** line.

Above the values, a **Used by** line names each record type and field that offers the list, for example "Ticket (Status)". A list that no record field offers directly says so; it is usually used by a page of its own.

To say which status changes are allowed, which fields a status needs and who may set it, see [Lifecycles](23-lifecycles.md) (**Administration > Lifecycles**).

### Adding a status or category

1. Select the list, for example **Risk category**.
2. Select **Add value**.
3. In **Shown as**, type the text people will see. The stored value is made from it and shown underneath.
   If the list keeps settings on its values (below), fill them in too: for example, how a new business impact analysis question is answered.
4. Choose a **Color** by selecting one of the eight swatches: Gray, Blue, Teal, Green, Amber, Orange, Red or Purple. With the keyboard, the arrow keys move between them. The **Preview** shows how the value will look as a chip.
5. Select **Add value**.

The new value is available in the relevant drop-downs at once.

### Renaming, recoloring and reordering

- Select **Edit** on a value to change the text or the color. The stored value never changes, so renaming is safe: existing records simply show the new text.
- Select **Move up** or **Move down** in the **Order** column to change the order in which values are offered. The value moves one place and the new order is saved at once; there is nothing to drag and no separate save.

### Settings of a value

A few lists keep a setting on each value as well as its name and color. The settings are shown as columns of the list (a long description only in the dialog) and changed in the **Add value** and **Edit** dialogs:

| List | Setting | What it does |
|---|---|---|
| **Certification type** | **Valid for (months)**, **Usually issued by** | The expiry date of a new certification is its issue date plus the months; the issuer is filled in when none is given. Leave the months empty for a type that does not expire. See [People and qualifications](29-people-and-qualifications.md). |
| **Business impact analysis question** | **Answered as**: Yes or no, A number, or Text | How the question is answered in an impact analysis. See [Business continuity](30-business-continuity.md). |
| **Privacy impact assessment question** | **Answered as**: Yes or no, or Text | How the question is answered in a privacy impact assessment. |
| **Policy document type** | **Review every (months)** | The review cycle of documents of this type. |
| **Funding clause** | **What the clause requires** | Shown beside the clause on a contract's funder clause checklist. |
| **Contract security term** | **What the term requires** | Shown beside the term on a contract's security terms checklist. |

Other lists keep no settings you can change here.

### Retiring a value

Values are retired, never deleted, so that existing records keep their meaning.

- Select **Retire** on a value. It can no longer be chosen, but records that already use it still show it.
- Select **Restore** to bring a retired value back.

### What to be careful about

Some values carry behavior as well as a name, and that behavior belongs to the values supplied with the application. For example, an action counts as finished when its status is **Done** or **Canceled**, and a framework outcome's status decides how much it counts toward the score. A value you add yourself is an ordinary value with none of this behavior: a new action status is treated as open (unless you add it to **Action statuses that need no reminder** under **Reminders**), and a new outcome status counts as zero until you give it a weight under [Framework settings](05-cybersecurity-frameworks.md#framework-settings). A few lists are fixed steps in a process, such as the project stages, the incident statuses and the notification triggers; add to or retire from those only after testing the effect.

Rename supplied values freely, but be cautious about retiring them. You cannot create a new list on this screen. A list made for a custom field's options is named after that field.

### Tags

The **Tags** tab on the same page lists the tags used on each kind of record, with how many records carry each one; select a count to open those records. **Rename** changes a tag on every record at once; renaming it to a tag that already exists merges the two. Every rename and merge is recorded in the audit log.

## Organization

Open **Administration > Organization** to say who the organization is and how the application looks for it. The page is always there (it is not one of the optional parts under Features), and only administrators can open it. The links at the side of the page (at the top on a narrow screen) jump to **Names**, **Address**, **Contacts**, **Logo** and **Colors**.

Change the names, address, contacts and colors, then select **Save organization** at the top right, or **Undo changes** to discard them. Changed parts are marked **Changed**. If a value is not allowed, nothing is saved and the field shows the reason in red. A logo is different: it is saved as soon as you upload it. Every change, including each logo upload and removal, is recorded in the audit log (for a logo, its size and type, not the picture).

### Names

| Field | What it does |
|---|---|
| **Application name** | The application's name, 1 to 60 characters. Shown on the sign-in page, in the header, at the end of the browser tab's title, in emails and as the account name in authenticator apps. It used to be under Settings; it is now only here. |
| **Organization name** | How the organization is usually named, such as "Example Transit Authority". Up to 120 characters. Shown on the vendor response page, above every email (in place of the logo, or as its alternative text), in the footer of PDF and HTML documents and on the offline incident kit. Where it is empty, the application name is used instead. |
| **Legal name** | The registered name, when it differs. Up to 200 characters. Printed in the footer of emails and PDF documents. |
| **Short name** | An abbreviation, such as "ETA". Up to 20 characters. |

### Address

Up to three **Street** lines (each up to 120 characters), then **City**, **State or region**, **Postal code** (up to 20 characters) and **Country** (each up to 80 characters). Write the address the way it is written where the organization is: no country's format is assumed, and every part is optional. The address is printed on one line in the footer of emails and PDF documents and on the incident kit's contacts sheet.

### Contacts

| Field | What it does |
|---|---|
| **Main phone** | Digits, spaces and `+ ( ) - . /`, with an optional extension (`ext 12` or `x12`). Printed in email and PDF footers. |
| **General email** | Printed in email and PDF footers. |
| **Website** | An http or https address; `www.example.org` becomes `https://www.example.org`. Printed in email and PDF footers. |
| **Security contact phone** and **email** | Optional: who to contact about a security incident. Printed on the offline incident kit's contacts sheet, and nowhere else. Shown on this page only while Security incidents is switched on (the values are kept while it is off). |

The address and contacts are never shown before sign-in. The sign-in page, the portal and the vendor response page show only the names, the logo and the colors.

Email templates (Administration > Email > Templates) may use `{{organizationName}}`, `{{organizationAddress}}`, `{{organizationPhone}}`, `{{organizationEmail}}` and `{{organizationWebsite}}`. Every email, except a text message sent to a phone, also has the organization's logo (or, without one, its name) above it and its legal name, address and contacts underneath (see [Logo](#logo) for the logo in emails).

### Logo

There are two logos, both optional:

- **Logo for the light theme**: used everywhere unless a dark-theme logo is set.
- **Logo for the dark theme**: used in the dark theme, and in the sidebar, which is dark in both themes. Without one, the light-theme logo is used there too.

Select **Upload logo** (or **Replace**) and choose a file. The rules:

- **PNG, JPEG or WebP only.** The application checks what the file really is from its content, not its name. **SVG is refused**, because an SVG picture can carry scripts.
- **Up to 512 KB**, and from **16 to 2048 pixels** each way.
- A logo about four times as wide as it is tall, with a see-through background, fits best. It is shown at a fixed height and keeps its proportions; a very wide logo is narrowed to fit.
- **WebP logos.** PDF documents can hold PNG and JPEG pictures only, and many email programs do not show WebP. When you upload a WebP logo, your browser also makes a PNG copy of it (at most 1024 by 512 pixels), which is saved with the logo and used for PDFs and emails. The line under the picture then says "PNG copy for PDFs and emails". A WebP logo that has no copy yet (for example one imported by the organization profile, or uploaded from a browser that could not make the copy) shows a note saying that PDFs and emails carry no logo; select **Make printable copy** and the browser makes it from the logo already saved. Making the copy is recorded in the audit log.

**Remove** takes a logo away (with its PNG copy); the standard mark comes back.

The logo replaces the standard mark in the header and sidebar, on the sign-in and second-factor pages, in the self-service portal, on the vendor response page and on the offline incident kit. It is printed on the first page (or cover) of PDF exports, report documents and packs, and at the top of the HTML form of report documents and packs (the print-ready document you download or open from **Produced documents**) and of the on-screen pack preview, which also end with the organization's name, legal name, address and contacts, as the PDF does.

**Browser tab icon.** The browser draws a square icon from the light-theme logo, as large as fits and centered on a see-through background (32 pixels), and a 180-pixel one on white for phones and tablets that put the application on their home screen. It keeps both until the logo changes. A browser that cannot draw them shows the logo as uploaded.

**Logo in emails.** With **Show the logo in emails** on (the default), every email except a text message sent to a phone shows the light-theme logo above the message, at most 40 pixels tall and 200 wide, with the organization's name as its alternative text. The picture travels inside the message (an inline part named by its content ID), so mail programs show it without loading anything from the internet, and the plain-text part of the message is unchanged. It is sent with SMTP, Microsoft Graph and the Gmail API alike. Only a PNG or JPEG logo (or a WebP logo's PNG copy) of up to 200 KB is sent; a larger one is left out and the name is shown instead. Switch it off to show the name only; the switch is saved with the rest of the page.

### Colors

Pick a **Brand color** and an **Accent color**, with the color square or by typing six hexadecimal digits such as `#17656f`. Leave a box empty for the standard color; **Reset to default** empties both. The brand color fills buttons and tints the sidebar, and colors links; the accent marks the current page in the sidebar and highlights.

You can pick any color. The application does not use it exactly as typed: it works out a shade of it for the light theme and another for the dark theme, so that everything stays readable to the standard of WCAG 2.2 AA:

- text on the brand color (buttons), and links in the brand color on every background, reach a contrast of at least 4.5 to 1;
- the accent and the focus outline, which are marks rather than text, reach at least 3 to 1;
- the sidebar's text stays readable on its brand-tinted background.

So a pale brand color is made darker for the light theme, and a dark one lighter for the dark theme. The **Preview** shows the header, a button, a light button and a link in both themes with the shades that will be used, a note saying which colors were adjusted, and, under **contrast checks**, every pair checked with its ratio. The colors take effect for everyone when you save, in both themes, including the few controls that use a lighter or darker step of the brand color (a scale of ten shades worked out from it), and also color the rules of PDF and HTML documents and the name above emails.

## Settings

Open **Administration > Settings**. The settings are in groups: **Identity**, **Security**, **Sessions**, **API tokens**, **Outbound connections**, **Retention**, **Actions**, **Features**, **Files** and **Departments**. The links at the side of the page (at the top on a narrow screen) jump to each group.

Each setting has its name and an explanation on the left and its control on the right. Make your changes, then select **Save settings** at the top right, or **Undo changes** to discard them. A setting you have altered is marked **Changed**, and the number of unsaved changes is shown beside the buttons. Every change is recorded in the audit log with the old and new value.

If a value is not allowed, nothing is saved. A message at the top says how many settings need attention, and each of those settings shows the reason in red beside its control, for example "Idle time-out must be a whole number from 5 to 480."

### Identity

| Setting | What it does |
|---|---|
| **Name, logo and colors** | A link to [Organization](#organization), where the application name, the organization's details, the logo and the colors are set. |
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
| **Requests a minute** | 600 | 10 to 6000 | How many requests one token may make in a minute; more are refused until the next minute. The count is kept in the database, so it holds however many server processes share it. |

### Outbound connections

Changing these asks you to confirm your password.

| Setting | Starts at | Notes |
|---|---|---|
| **Allow outbound connections** | Off | While off, nothing leaves the application: webhook deliveries are recorded as blocked and never sent. The same switch and host list also govern fetching SAML metadata and the text-message webhook. |
| **Allowed hosts** | Empty | The only hosts a delivery may go to, one to a line: a host name (`receiver.example.org`), a host and port (`receiver.example.org:8443`) or every host under a domain (`*.example.org`). Up to 50. Anything else is blocked. A host name that turns out to point at a private or internal network address (such as `10.x.x.x`, `192.168.x.x` or this machine) is blocked too, unless that exact address is also listed (`10.0.0.5` or `10.0.0.5:8443`). |

### Retention (settings)

| Setting | Starts at | Allowed | Notes |
|---|---|---|---|
| **Audit log** | 84 | 12 to 1200 months | How long the audit log is to be kept, for your records schedule. It is recorded only: audit events are never deleted. |
| **Webhook delivery log** | 30 | 1 to 3650 days | How long finished webhook deliveries (delivered, failed or blocked) stay in a webhook's **Deliveries** list. Older ones are removed by the daily check; deliveries still waiting are always kept. What a delivery sent is removed as soon as it is delivered: the list keeps its date, event and status only. |
| **Outgoing message log** | 180 | 7 to 3650 days | How long the email and text-message **Delivery log** (recipients and subjects) is kept. Messages still waiting or due to be tried again are kept. |
| **Incoming email log** | 180 | 7 to 3650 days | How long the log of emails received by the service desk mailbox (senders and subjects) is kept. Shown only while **Service desk** is switched on. A reply to an email older than this still finds its ticket when it quotes the ticket reference. |
| **Audit-log forwarding log** | 30 | 1 to 3650 days | How long a forwarder's delivery log is kept (also set on Log forwarding). Events already forwarded are not recalled. |

The logs are removed once a day by the same daily check as retention reviews, and the audit log notes how many rows went. They are logs, not records, so nothing waits for a decision.

### Actions

**Evidence needed before closing**: check the action sources (for example **Audit** or **Inspection**) whose actions can be marked done only with an attachment or some **Closure evidence** text. None are checked at first. Sources of switched-off areas are not listed. See [Corrective action plans](24-corrective-action-plans.md#closure-evidence).

### Features (settings)

This group only points to **Administration > Features**, where the parts of the application are switched on and off (see [Features](#features) below). The audience roles (Requester, Approver, Executive viewer, Auditor) are not there either: they are switched on the **Roles** page.

### Files

The limits for files attached to records. They apply to new uploads; files already attached are not affected. This group has its own buttons: select **Save file settings** to save it, separately from **Save settings**.

| Setting | Allowed | Notes |
|---|---|---|
| **Largest file** | 1 to 2048 megabytes | Each attached file may be up to this size. |
| **Allowed file types** | Extensions separated by commas, for example `pdf, docx, png` | A file is refused when its content does not match its extension. Programs and scripts can never be allowed. Adding a type asks you to confirm your password. |
| **Malware scanning** | Shown only | Says whether new files are scanned, and by which scanner. Scanning is set on the **Malware scanning** tab of **File settings** (see [Attachments and notifications](14-attachments-and-notifications.md#malware-scanning)). |

The same settings are on **Administration > File settings**. If file attachments are not part of your installation, the group says so.

### Departments

The **Departments** group holds the list used to group people. Departments are also records of their own, with the department each is part of and a manager, under **People > Departments** (see [People and qualifications](29-people-and-qualifications.md#departments)); changes made in either place show in both.

- Select **Add department**, enter a name and select **Save**.
- Select **Rename** to change a name.
- Select **Remove** to delete a department. The people in it are left without a department.

Department changes save immediately; they do not wait for **Save settings**.

### Data load mode (settings)

The **Data load mode** group switches [data load mode](#data-load-mode) on and off. It saves with its own buttons, not with **Save settings**.

## Data load mode

Data load mode is for loading historical records with their original dates and values: for example the service desk's past tickets, with the times each was opened, first answered, resolved and closed, so that the service desk figures cover the past correctly. It is **off** unless you switch it on, and it switches itself off at the end you choose.

### Switching it on

1. Open **Administration > Settings** and go to the **Data load mode** group.
2. Choose how many days it stays on: 7 unless you change it, at most 30.
3. Select **Switch data load mode on**, and confirm your password.

While it is on, every administrator sees a banner at the top of each page: "Data load mode is on until ...". Select **Change the end** to give it a new end (counted from now), or **Switch off now** when the load is done. Switching on, changing the end, switching off and the end itself are recorded in the audit log.

### What it allows

While it is on, a record saved by someone holding the administration permission (**admin.administer**) is a *load*. This applies to their API tokens and to their AI assistant connections too, when the token's owner is an administrator; an assistant also needs write access switched on under **AI assistant access** (see [AI assistants and MCP](21-ai-assistants-and-mcp.md#loading-historical-records)). For everyone else nothing changes.

A load may set:

- **every field**, including the ones the application normally works out and shows as read-only: for a ticket the opened, first response, resolved and closed times, the respond-by and resolve-by times, the "target missed" and "close to target" flags, the paused minutes and the satisfaction answer;
- **any status**, without the allowed moves on the **Lifecycles** page and without the steps a status normally needs (for example a resolution code to close a ticket, an approval, or a review);
- the record's **created** and **updated** times and who **created** it (a person in the application);
- the **reference** (for example `TKT-00412`). A reference that is already used is refused. When you leave it out the record is numbered as usual, and numbering always continues after the highest reference loaded.

The values you give are kept. What you leave out is worked out as usual, from the dates you give rather than from today: a ticket loaded with only its opened and resolved times gets its respond-by and resolve-by times from its priority's targets counted from when it was opened, and "target missed" from when it was resolved. Values that are calculated by the database itself (such as a ticket's "any target missed") cannot be set. A loaded ticket that is still open with a target already past is recorded as missed (and warned) when it is loaded, so the service-level check sends no alert, warning or escalation about it.

The usual checks still apply: each value must be of the right kind, a list value must be in the list, a linked record must exist and be one you can see, required fields must be given, restricted records stay restricted, and records under a legal hold cannot be deleted.

**Nothing is sent** for a load: no notifications, email, text messages or push messages, no webhooks, no records sent to work trackers, no approvals started and no service-level alerts. Search finds loaded records as usual.

Each save is recorded in the audit log as usual, marked "(data load)", and a loaded record's **History** starts with "loaded (data load mode)".

Records you save on screen while the mode is on are loads too (they send no notifications), so switch it off as soon as the load is done.

### Undoing a load

Every record created in data load mode is listed on **Administration > Data loads**, grouped by the day it was loaded and its record type, with how many were created, how many are still there and who loaded them.

To undo a load, select **Delete this load** on its row (it deletes everything that load created), then **Delete them**, and give your password again. Each record is deleted as if it were deleted from its own page (it is kept in the database as deleted, and the deletion is in the audit log). Records under a legal hold are kept, and the message says how many. This works whether data load mode is on or off.

An AI assistant can also delete single records it loaded, while data load mode is on (see [AI assistants and MCP](21-ai-assistants-and-mcp.md#loading-historical-records)). Records not created in data load mode can never be deleted this way.

## Features

Not every organization uses every part of the application. Open **Administration > Features** to switch off the parts you do not use, for example **Fleet and services** and **Safety management** when you do not manage vehicles or a safety program here, and to switch them back on later.

Each part has a switch, a line saying what it covers, whether it is **On** or **Off**, and what depends on it:

| Part | What it covers | Starts |
|---|---|---|
| **Service desk** | Tickets, problems, the knowledge base and the service catalog | On |
| **Self-service portal** | The simpler pages where anyone submits and tracks their own requests. Needs the service desk | Off |
| **Change enablement** | Change requests, approvals, the change calendar and post-implementation reviews | On |
| **Vendors and contracts** | Vendors, contracts, renewals and vendor evidence | On |
| **Framework outcomes** | Cybersecurity framework outcomes, assessments and target profiles | On |
| **Risks and obligations** | The risk register, risk reviews and acceptances, and obligations. The action tracker stays | On |
| **Security incidents** | Security incidents, notification clocks and notification tasks | On |
| **Policies and exceptions** | Policies, acknowledgments and policy exceptions | On |
| **Training and exercises** | Courses, assignments and exercises | On |
| **Vulnerabilities** | Vulnerability records, scanner imports and remediation deadlines | On |
| **Projects** | Projects, the portfolio and project reminders | On |
| **Dashboards and reports** | Saved dashboards, the report catalog, scheduled reports and report packs. The **Overview** page and its figures stay | On |
| **Fleet and services** | Vehicles, vehicle models, services (routes and lines) and the systems they depend on | On |
| **Safety management** | Hazards, safety events, safety performance indicators, and safety reports from the portal | On |
| **Audits and inspections** | The audit plan and coverage, audit engagements and findings, checklist templates and recurring inspections | On |
| **Control library and testing** | The control library, what each control covers, control tests and their schedule | On |
| **Funding and grant compliance** | Funding awards and what they fund, yearly certifications, funder compliance reviews and their deficiencies | On |
| **Committees and meetings** | Committees and their members, meetings with agendas, packs and minutes, and the decisions register | On |
| **Business continuity and emergency management** | Business processes and their impact analyses, continuity and emergency plans with call trees, the gap report and emergency activations | On |
| **Asset condition and state of good repair** | Asset classes and useful life, condition assessments of assets, vehicles and sites, and the state-of-good-repair dashboard and targets | On |
| **OT and rail-systems security** | Operational technology on systems and assets, security zones and conduits with their target and achieved levels | On |
| **Records requests and privacy** | Requests for records and personal data with their deadlines, responsive records and exemptions, and privacy impact assessments. Legal holds stay on | On |
| **Asset tags** | Tag numbers on assets, vehicles, sites and systems (printed digits, letters, barcodes or 2D codes), tag formats and stock, printing your own tags, finding a record by its tag, and inventory counts. While it is off, the **Tag number** of vehicles, sites and systems is hidden; an asset's **Tag** stays, because it is also the asset's reference | On |
| **User access reviews** | The accounts each system holds, matched to the staff roster with leavers and people on leave flagged, and review campaigns in which system owners keep or remove each account, with removals tracked to done ([User access reviews](40-user-access-reviews.md)) | On |
| **Records retention schedule** | The organization's own record series, paper and electronic, with their retention periods and triggers, and the destruction log with approvals ([Records retention schedule](42-records-retention-schedule.md)). It uses the records permissions, so it is hidden while **Records requests and privacy** is off | On |
| *Each register* | Every register an administrator defines under Administration > Registers has a switch of its own, named after the register ([Registers](41-registers.md#switching-a-register-off)) | On |
| **Mobile app** | The Sandpiper GRC app for iPhone and Android: sign-in through the phone's browser, My work, reading asset tags with the camera, reporting problems with photos, inspections, condition assessments and counts that work offline, push notifications, and the list of signed-in devices. Switching it off signs out every device | Off |

[Legal holds](33-legal-holds.md) are not a part that can be switched off: a hold must never lapse because a part of the application was switched off.

**AI assistant access** is listed too, with its state, but it keeps its own page: select the link to open **Administration > AI assistant access**. **Inventory** (systems, assets, sites, data categories and the relationship map), the **action tracker**, **notifications**, **files**, **administration**, the **Overview** and **Help** are always on.

After an upgrade every part you already had stays on, and the portal keeps the setting it had.

### Switching a part off or on

1. Select the part's switch.
2. A box asks you to confirm. When you switch a part off it says that the part disappears for everyone and that its data is kept; when something depends on it (the portal depends on the service desk), the box says that part will be switched off too. When you switch a part on that needs another (the portal), the box says the other is switched on as well.
3. Select **Switch off** or **Switch on**. If you have not confirmed your password in the last few minutes, the **Confirm it is you** box appears first.

The change applies at once for everyone, without a restart. It is recorded in the audit log ("Switched off: Fleet and services").

### What happens when a part is off

The part disappears for everyone, administrators and API tokens included. The only place it still appears is its switch on this page (and past entries in the audit log):

- its menu entries, **Create** entries and pages go; an old link to one of its pages says "This part of the application is switched off";
- the fields of other records that refer to it go: with **Vendors and contracts** off, a system's and an asset's **Vendor** and **Contract** (and a system's **Vendor (as recorded)**, **Agreement on file**, its fact-sheet card and the vendors lane of the relationship map); with the portal off, a catalog item's **Show in the self-service portal**, the portal tab of the service desk settings and the portal notes and shared files on tickets. The values are kept;
- its choices leave the drop-down lists of the parts that stay (an action's **Source** loses **Risk**, **Project**, **Safety** and so on), and its own lists leave **Administration > Lists**, including a list offered only by fields it adds to other records (for example **Condition rating** while asset condition is off);
- its notification kinds leave everyone's **Preferences**, and notifications about its records or pages are not shown or counted (they come back when it is switched on);
- its AI assistant tools, background jobs and schedules, reminders, its retention category (**Contracts and suppliers** with vendors), its API routes in the **API reference**, and its permissions on a role's page and in the permissions a new API token may carry, are left out. With **Security incidents** off, the text-message alerts (the **Alerts by text message** card and the **Text messages** tab of **Email**) go too, since only incidents send them; with **Dashboards and reports** off, the **Overview**'s figures are headed **At a glance**;
- its records are left out of search, record links, the relationship map and impact panels (for example the vehicles and services on a system's impact panel and on a security incident's **Affected** tab), the **Overview** widgets, the report catalog and dashboards, imports, exports, custom fields, retention, webhooks, the API reference and the tools offered to AI assistants;
- its reminders and other background work stop (the **Background jobs** page shows those runs as skipped), and the sample data command does not load its sample records;
- its permissions are held by nobody and are not listed on a role's page. The checked boxes are kept and work again when the part is switched back on;
- roles that belong to it are not shown: the **Safety manager** with safety management, the **Project manager** with projects, the **Training coordinator** with training, the **Continuity manager** with business continuity and the **Requester** with the self-service portal. They are left out of the **Roles** page, a person's roles, **AI assistant access**, provisioning's group mapping and every list of roles to choose from (lifecycles, approval rules, report sharing, policy audiences, sign-in provider role mapping). People and groups keep these roles, and saving their other roles does not remove them. A supplied role's description, while you have not edited it, names only the parts that are on (the **Asset manager** reads "Assets and sites, …" while fleet is off). The safety hazard matrix is not offered for new risks, the heat map or **Risk scales** while safety management is off; risks already scored on it keep it. Asset classes that rate vehicles are hidden while fleet is off;
- its guide pages are left out of **Help** and its search; a guide page opened by a link says the part is switched off;
- the API answers 404 with the code `switched_off` for its routes.

What stays, because it is your organization's own data rather than the part itself: the names and descriptions of roles you created or edited, the names of records that stay (a system called "Fleet Maintenance System"), the incident playbooks and notification parties, the risk scales of the parts that stay (while **Risks and obligations** is off, hazards are still scored on the hazard matrix, which is changed under **Administration > Hazard matrix**) and the user guide's wording on the pages that stay. Search may still find a record that stays by the text of a field that is hidden (for example a system's vendor name).

Nothing is deleted. Switching the part back on restores everything: records, links, history, permissions and reminders.

### Options within the parts

Some features suit some transit organizations but not others. A public agency, a private operator and a contractor running service for an agency fund equipment, approve contracts and decide on a ransom payment in different ways. The **Options within the parts** card on the same page lists these features under the part they belong to (the inventory ones under **Inventory**, which is always on). Each has a switch, a line saying what it does and, where the idea is general but the word is not, a **Name shown on screens**:

| Option | Part | What it does | Name to start with |
|---|---|---|---|
| **Outside funder interest in equipment** | Inventory (and vehicles in Fleet and services) | The **Funder interest** and **Funder interest (%)** fields on assets and vehicles, and the rule that an asset with a funder interest cannot be disposed of until the funder's approval reference is entered | Funder interest |
| **Approval number on contracts** | Vendors and contracts | The field for the number of the decision that approved a contract | Approval or resolution number |
| **Recorded approval of a ransom payment** | Security incidents | The reference field on the **Ransom** tab, and the rule that a ransom payment cannot be marked approved without it | Payment approval reference |

Every option starts **On** with the name shown, so an upgrade changes nothing.

To rename one, type the name your organization uses in **Name shown on screens** (for example **Board resolution**, **Approval reference** or **Grant interest**, up to 60 characters) and select **Save name**. **Use the default** puts the name back. Forms, lists, record pages, exports, imports, report columns, the rule's messages, the API reference and the tools offered to AI assistants all use the new name at once.

To switch one off, select its switch and confirm with **Switch off**. While an option is off:

- its fields disappear everywhere: forms, list columns and filters, record pages, exports, import columns, reports and the report builder, the API reference and AI assistants. A value sent for one is ignored;
- its rule stops: assets are disposed of without a funder approval reference, and a ransom payment can be marked approved without a reference;
- values already recorded are kept, and come back when the option is switched on again.

An option of a part that is switched off counts as off and cannot be changed until the part is on again; its card says **Off with** that part. Each change needs your password again (**Confirm it is you**) and is recorded in the audit log, for example "Approval number on contracts: renamed "Board resolution"".

## Custom fields

Custom fields are your own fields on a kind of record, added without any change to the software. Open **Administration > Custom fields**. For a kind of record of your own (lost property, keys issued, visitors), define a register under **Administration > Registers** and give it custom fields: see [Registers](41-registers.md).

Choose the kind of record under **Record type**. The table lists its custom fields in order, with **Order**, **Field** (the label, and underneath the name used in the API and exports, such as `cf_funding_source`), **Type**, **Section** and **State** (**In use** or **Switched off**). The fields of a kind of record whose area is switched off under **Administration > Features** (or of a register that is switched off) are not listed; they are kept and come back when it is switched on again.

A custom field appears on the record type's forms and record pages, can be chosen as a list column and filter, and is included in CSV exports, the record's history and webhook deliveries. That includes the guided forms (a new ticket, a new change, declaring a security incident, taking an assessment snapshot, a project request). Two places ask less, on purpose: the self-service portal does not ask the custom fields of tickets (the service desk fills them in, and a required one is not enforced there), and the one-line quick add for actions asks only the required ones. A project request does not ask them of people who may submit requests but not view projects, and does not enforce required ones for them.

### Adding a field

1. Choose the **Record type** and select **Add field**.
2. Enter the **Label** people will see. The **Key** is made from it; change it now if you want, because it cannot be changed later.
3. Choose the **Type**: **Text**, **Long text**, **Number**, **Currency**, **Date**, **Checkbox**, **Single choice**, **Multiple choice**, **User** or **Record link**. The type cannot be changed later either.
4. For **Single choice** and **Multiple choice**, under **Options** choose **New options** and type one option to a line, or **An existing list** and pick one of the lists from **Lists**. New options get a list of their own, whose colors, order and retired values you change under **Lists**.
5. For **Record link**, choose what it **Links to**, for example systems.
6. Optionally give a **Section** (a heading the field is grouped under on forms), a **Position** (lower numbers come first) and **Help** (shown under the field). Check **Required** if people must fill it in.
7. Select **Add field**.

If something is wrong, for example the key is already used, the reason is shown under the field and nothing is added.

### Changing and switching off a field

Select **Edit** to change the label, section, position, help or whether it is required. The up and down buttons in the **Order** column move a field earlier or later on forms. For a choice field you can also **Add options**. **In use** switches the field on or off.

Select **Switch off** to hide a field everywhere. **The values already entered are kept**: select **Switch on** to bring the field and its values back. Fields are never deleted.

### Fields inherited from a model

A custom field of vehicles or assets can come from the vehicle's or asset's model, like the make or the passenger capacity. Open **Vehicle models** or **Asset models**, select **Inherited custom fields** and check the fields to inherit, then **Save**. Each checked field then appears on every model of that kind, and vehicles or assets with a model take its value unless they keep their own (see [Fleet and services](19-fleet-and-services.md#vehicle-models) and [Inventory](03-inventory.md#asset-models)). Unchecking a field stops the inheritance; the values already on the vehicles and assets stay.

On an installation whose server uses a database account that may not change the database's structure (a least-privilege account, see [Installation](../installation.md#a-least-privilege-database-role)), custom fields still work at once. A new text field is found by the search box only after the database owner's next migrate step (run at every server start when the owner account is set up): until then the record type is searched as before, and the server log says that a change is waiting.

## Retention

Open **Administration > Retention** to set how long each kind of record is kept and to decide what happens to records past that age.

**The daily check flags records. It never deletes anything.** Once a day the application looks for records older than their retention period and lists them under **Waiting for a decision**. Each one stays there until an administrator keeps it for longer, anonymizes it or removes it for good, as far as the record type's period allows.

### Retention periods

On the **Retention periods** tab, each record type shows how long it is **Kept for**, what the period is **Counted from**, its **Schedule category** and its **State** (**Checked** or **Paused**). Select **Set period** (or **Change**) to open it:

- **Keep for (months)**: from 1 to 1200. 84 months is 7 years.
- **Counted from**: **Last change** (records still being updated are not flagged) or **Creation**.
- **Schedule category**: the heading in your records schedule. The choices are the list **Retention category** under **Lists**.
- **At the end of the period, the review may**: what may be done with a flagged record of this type. **Only keep longer** (nothing is ever anonymized or removed), **Keep longer or anonymize**, or **Keep longer, anonymize or remove for good** (the choice for types set before this option existed). The hint lists the fields of this type that anonymizing replaces. The **At the end** column shows the choice.
- **Notes**: where the period comes from, for example the schedule item.
- **Check these records every day**: switch off to pause the check for this type. Records already flagged stay on the list.

Select **Save**. The change is recorded in the audit log.

The audit log's own period is under **Settings > Retention**. It is recorded, not enforced: audit events are never deleted or changed, not even when a record is anonymized or removed. The audit log keeps who changed what, by design, so that every change stays accountable.

### Reviewing flagged records

The **Review** tab lists the records past their period. **Show** switches between **Waiting for a decision**, **Kept longer**, **Anonymized** and **Removed for good**; **Record type** narrows the list. Select **Run the check now** at the top of the page to check at once instead of waiting for the daily check, for example after changing a period. Records you may not see (restricted ones, without **View** on **Security incidents and restricted records**) are not listed.

For each record waiting for a decision:

- **Keep longer**: choose **For a number of months** or **Until a date**, give a **Reason** and select **Keep longer**. The record leaves the list and is flagged again once that date has passed.
- **Anonymize…** (when the period allows it): give a **Reason**, check **I understand that the personal details will be removed permanently** and select **Anonymize**. You are asked to confirm your identity if you have not done so recently. Anonymizing **cannot be undone**. It replaces the record's personal fields (the people on it, names, email addresses, phone numbers and long text that may hold personal details) with "Removed at the end of the retention period" or empties them, empties the people who created and last changed it, replaces the text and author of each of its comments, deletes the contents of its files and renames them "Removed file", replaces the titles of notifications about it, and removes its watchers; an evidence link's address, title and who checked it are cleared. Search no longer finds the removed details. The record itself, its reference, status, dates, numbers, tags, links and the number of its comments and files stay, so counts and charts stay the same for everyone; only a chart grouped by a person or a long-text field shows the record under no value. A person field that the record type requires cannot be emptied and is kept; the audit entry names it. The audit log is not changed: its earlier entries for the record, shown on the record's **History** tab, still hold the earlier values. Webhook deliveries already made or waiting for the record lose what they carried: those still waiting are not sent (they show as **Blocked**, and cannot be sent again). The review moves to **Anonymized**, with your reason.
- **Remove…** (when the period allows it): give a **Reason**, check **I understand that this record will be deleted permanently** and select **Remove for good**. You are asked for your password if you have not given it recently. The record, its comments, tags and links are deleted and cannot be brought back. A record with files attached cannot be removed until its files are. The audit log keeps the record's history and a note of the removal with your reason. Webhook deliveries made or waiting for the record lose what they carried, as for anonymizing. Anonymizing and removing are sent to webhooks (see "Other events" under [Webhooks](#webhooks)), with no personal values from before the change.

A record under a legal hold is never flagged while held. One flagged before the hold was placed shows a **Held** chip with the hold's reference: it can be kept longer but not anonymized or removed. Filter with **Legal hold**. See [Legal holds](33-legal-holds.md).

## API tokens

An API token lets a script or another system use the application's API as a person, limited to the permissions chosen for the token. Each person makes their own on the **Account security** page (see "API tokens" under "My account" below).

Open **Administration > API tokens** to see everyone's tokens: the **Owner**, the **Token** name and its first characters, its **Permissions**, when it **Expires**, when it was **Last used** and from which address, and its **Status** (**Active**, **Expires soon**, **Expired** or **Revoked**). Search by name, owner or permission, and filter by **Status** or **Owner**.

Select **Revoke** and confirm to stop a token at once, for example when someone leaves or a token may have leaked. Tell the owner: anything using it will be refused. Revoking cannot be undone.

A token can never do more than its owner can do at the time. Every change made with a token is recorded in the audit log with the token's name. Tokens cannot sign in, change account security or manage tokens, and cannot confirm a password, so they cannot make the changes listed under "Confirming your password". The longest life and the request limit are under **Settings > API tokens**.

When making a token, its owner can fill in **Allowed source addresses** (up to 20 addresses or ranges, such as `203.0.113.7` or `198.51.100.0/24`). The token is then refused from anywhere else, and each refusal is recorded in the audit log. To change the list later, select **Addresses** on the token, edit the addresses (one per line, or leave it empty to allow any address) and select **Save addresses**; you may be asked to confirm it is you. Administrators can do the same for anyone's token on **Administration > API tokens**. Each change is recorded in the audit log with the lists before and after. A token without a list shows **From any address**.

### API reference

**Help > API reference** lists every route the signed-in person may call, grouped by subject, with the method, parameters, request body and what comes back. Type in **Filter routes** to narrow the list, for example "tickets", "POST" or "/api/admin"; select a route to open it. The page also links to the machine-readable description, `openapi.json`.

## Webhooks

A webhook tells another system, straight away, when records are added, changed or deleted, or when one of the other events listed below happens (a notification clock about to run out, a backup that failed, and so on). Open **Administration > Webhooks**.

**Nothing is sent until outbound connections are switched on.** Under **Settings > Outbound connections**, switch on **Allow outbound connections** and add the receiving host to **Allowed hosts**. Until then every delivery is recorded as blocked, and the page says so at the top. A webhook whose host is not allowed is marked **Host not allowed**. A receiver on your internal network must be listed by its address as well as its name: a name that leads to a private address is blocked with the reason "... resolves to ..., which is a private, loopback or reserved address".

### Adding a webhook

1. Select **Add webhook**.
2. Enter a **Name** and the **Address** the receiving system gave you (an `https` address with no user name or password in it). The address is kept encrypted; the list shows its host and a fingerprint. In **Edit**, leave it empty to keep it, or select **Show current address** (asks for your password; audited).
3. Choose a **Format**: the full event as JSON, a chat message (one line), or a chat card (title, text, link and facts). Chat formats carry a summary and the names of changed fields, never values, and are signed the same way.
4. Under **Events**, check **Every change to every record type, and every other event**, or choose the record types and changes (added, changed, deleted or any change) under **Record changes** and check the events you want under **Other events**.
5. Check **Include restricted records** only if the receiver should get security incidents, risks and records flagged restricted. Only someone holding **View** on **Security incidents and restricted records** can switch this on, and those records stop being sent if that person loses it.
6. Leave **Secret** empty to have a strong one made for you, and select **Add webhook**.

The **signing secret** is then shown once. Select **Copy secret** and give it to whoever runs the receiving system; it cannot be shown again, only replaced.

### What is sent

Each event is sent as a JSON `POST`: the record's type, reference, title and fields, and for a change the values before and after. Every delivery is signed: the header `X-GRC-Signature` holds `sha256=` and the HMAC-SHA256, made with the secret, of the `X-GRC-Timestamp` header, a period and the body. A delivery that fails (no answer within 10 seconds, or an answer other than 2xx) is tried again after 1, 5, 30, 120 and 720 minutes, then marked failed. Redirects are never followed.

### Other events

Besides record changes, a webhook can send these events. Each carries its own details and, where there is one, the record it is about; the [integration guide](../api.md#other-events) lists every field.

| Event | Sent when | Restricted |
|---|---|---|
| **Notification clock about to run out** | A security incident's deadline to notify someone is close (the clock turned amber) | Yes |
| **Notification clock ran out** | That deadline passed and the notification is still pending (the clock turned red) | Yes |
| **Security incident declared** | An incident is declared and its notification clocks start | Yes |
| **Change approval decided** | An approver approves or rejects a change | When the change is |
| **Scheduled report delivered** | A report schedule ran and reached at least one person; only the counts are sent, never the figures | No |
| **Approval decided** | Someone approves or rejects a step of an [approval workflow](22-approval-workflows.md) | When the record is |
| **Approval workflow finished** | An approval workflow ends: approved, rejected or canceled | When the record is |
| **Backup failed** | A scheduled or manual backup failed | No |
| **Record anonymized at the end of its retention period** | An administrator anonymizes a record from the retention review; only the names of the replaced fields are sent, never their earlier values | When the record is |
| **Record removed for good at the end of its retention period** | An administrator removes a record for good from the retention review; it is named by its reference only | When the record is |

A restricted event is sent only by a webhook with **Include restricted records** switched on, as for restricted records. When a part of the application is switched off under **Features**, its events are not sent and are not offered in the form: the clock and incident events belong to **Security incidents**, the change approval to **Change enablement** and the report delivery to **Dashboards and reports**. Webhooks that follow a record type also get the record's own update or delete event for the two retention decisions, without the earlier values.

### Managing webhooks

The list shows each webhook's events, when it last delivered, how many deliveries are waiting and how many failed or were blocked in the last 7 days. The **On** switch pauses or restarts a webhook. The **…** menu offers:

- **Edit**: change the name, address, events or the restricted-records choice. Changing the address or including restricted records asks for your password.
- **Deliveries**: the delivery log, newest first, with each delivery's event, status (**Delivered**, **Waiting to retry**, **Failed** or **Blocked**), attempts and the reason for a failure. Select **Send again** on a failed or blocked delivery (not on one whose content was removed at the end of its record's retention period). A delivered delivery keeps its date, event and status but not what it sent, and finished deliveries are removed after the **Webhook delivery log** period under **Settings > Retention** (30 days to begin with).
- **Send a test**: sends a `webhook.test` event at once and says what happened.
- **Replace secret**: makes a new secret, shown once. The receiver must be given it, or it will reject deliveries.
- **Remove**: stops the webhook for good and cancels deliveries still waiting. The delivery log is kept.

Every change to a webhook is in the audit log. Because a webhook address often contains the receiving system's own secret, the audit log shows only its start (for example `https://chat.example.test/…`) and a short fingerprint that changes when the address does, never the whole address.

## The audit log

The audit log records every sign-in, change, export and permission change: who did it, when, from which network address, and the values before and after. Entries cannot be edited or deleted by anyone; the only way events leave the log is the archive of old events, which is off unless an administrator switches it on (see below). Open **Administration > Audit log**.

### Finding events

Events are listed newest first, 50 to a page. Use **Older** and **Newer** to move between pages. Under the list the page says how many events match; when more than 10,000 match it says "More than 10,000 events" rather than counting them all, and shows the page number without a total. Combine any of these filters:

| Filter | Use it to |
|---|---|
| **Search** | Find text in the summary, the person's name or the action. |
| **Action** | Show one exact action name, for example `signin.failure`. The action name is shown in small print under **What happened** on every event. |
| **Record type** | Show events for one kind of record, such as Risk, Project, User or Role. |
| **Request id** | Show everything one request did. Every answer from the application carries an `X-Request-Id`, and an integration usually logs it; paste it here to see the changes that one call made. |
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

Under the values are the event number, the API token used (if any) and the request id, then shortcuts: a link to open the record (where it has a page), **Only "…" events** to filter the log to that action, **Only this record** to see everything that happened to that record, and **Everything this request did** to see the other events of the same request.

To see the history of one record without leaving it, use the **History** tab on the record itself.

### Exporting

1. Set the filters so that the list shows the events you want.
2. Select **Export CSV**.

A file named with today's date is downloaded, containing every event that matches the filters, not only the page on screen, up to the newest 50,000. Besides the columns on screen it has the API token used (`token_name`) and the request id (`request_id`). The export is itself recorded in the audit log.

### Archiving old events

*Administrators.* Years of events make the log large. Under the list, **Archive old events** can move events older than a number of months out of the application into files you keep with your long-term records. It is **off** until you switch it on, and nothing is ever removed while it is off.

1. Switch on **Archive old events every day**.
2. Set **Archive events older than (months)**: at least 12. The default, 84 (seven years), matches the audit retention period on the **Retention** page; use what your records schedule says.
3. Enter the **Folder for archive files**: a full path the server can write to, outside the data folder, for example `D:\Archive\Sandpiper` or `/srv/archive/sandpiper`.
4. Select **Save archive settings**. You will be asked to confirm your password.

Every day the application then writes the events older than that age to a compressed file in the folder, reads the file back and checks it, and only then removes those events from the log. **Archive now** runs it at once; the card shows the last run while it works. Each archive is itself an event in the log, naming the file, how many events it holds and its checksum, and the last ten are listed on the card. An archived event is no longer in the application, in exports or in backups taken afterward: keep the files safe. The person running the server can read them with ordinary tools (see the operations guide).

If the database account the server uses may not remove audit events (a set-up the person running the server can choose), the card says so: the server does not archive by itself, **Archive now** is not offered and the switch reads **Archive old events (run by the database owner)**. Switch it on and choose the age and folder as above; the person running the server then runs the archive as the database owner from a scheduled task (the card shows the command, and the operations guide explains it). Each such run is in the log as usual, ending "removed by the owner command". If old events wait more than a month past the age you chose, the administrators are told once.

## About and updates

**Administration > About** shows the version installed here, the commit it was built from, the Node.js version, the kind of database and when the server last started. Quote the version when you report a problem.

### Checking for a newer version

The **Updates** card can say when a newer release of Sandpiper GRC exists, with a link to its release notes. To find out, the server asks the project's public list of releases on GitHub for the newest version, at most once a day and only while someone has the About page open. It sends nothing about your installation, your organization or its people, and it never downloads or installs anything.

The check runs only when all three of these are true:

1. **Check for new versions once a day** is on, on this page. It is on unless you switch it off; switching it is recorded in the audit log.
2. Outbound connections are on (**Settings > Outbound connections**). They are off on a new installation.
3. `api.github.com` is one of the allowed hosts under **Settings > Outbound connections**.

Until then the card says which of these is missing, and nothing is sent. The result is shown on this page only; nobody else is told. A check that fails (no network, for example) is shown with the reason and tried again a day later.

### Updating the server

The application cannot update itself. The person who runs the server installs the new version:

- **Windows installer**: download the new installer from the release page (**Check for updates** in the "Sandpiper GRC" Start menu folder on the server shows whether one exists and opens the download page) and run it over the installed version. It stops the service, takes a backup, puts the new version in place, updates the database and starts the service again; if any step fails, it puts the previous version and its data back by itself. An older installer refuses to install over a newer version.
- **Other installations**: follow "Upgrading" in the operations guide.

Everyone signed in sees the version on the Help page afterward.
## My account: the Account security page

Every user has this page. Select your name at the top right and choose **Account security**. The same menu has **Notifications**, **Change password**, **Help**, **Keyboard shortcuts** and **Sign out**.

Besides the cards described below, the page has three cards described elsewhere:

- **Alerts by text message** (when security incidents or business continuity are on): your mobile number for urgent alerts; see [Your mobile number and email-to-text address](14-attachments-and-notifications.md#your-mobile-number-and-email-to-text-address). An administrator sees the same card on a person's page under **Users**.
- **Stand-in for approvals**: someone to decide your approvals while you are away; see [Stand-ins](22-approval-workflows.md#stand-ins).
- **Connect an AI assistant**: a token and ready-made configuration for an AI assistant; see [Connecting your assistant](21-ai-assistants-and-mcp.md#connecting-your-assistant).

If a second factor is required for your account and you have not set one up, this page is shown by itself after you sign in, without the menu, with a red notice at the top and a **Sign out** button. Set up the second factor as described under "Setting it up for yourself"; as soon as you select **Confirm and turn on** the rest of the application opens, and your recovery codes stay on screen until you have saved them.

### Password

The **Password** card shows when your password was last changed. To change it:

1. Select **Change password**.
2. Enter your **Current password**, then the **New password** and **Repeat new password**.
3. Select **Change password**.

Use at least the minimum number of characters shown on the card; a phrase of several words works well. Changing your password signs you out everywhere else, and revokes your API tokens and your AI assistant connections (make new ones afterward), so nothing made by someone who knew the old password keeps working. Too many wrong current passwords make you wait a few minutes.

### Second factor

The **Second factor** card shows whether it is on and how many recovery codes are left. Setting it up (by scanning a square code or typing a key), replacing recovery codes and turning it off are described under "Second factor" above.

### Where you are signed in

This card lists every browser you are signed in from, with its **Address**, when you **Signed in** and when it was **Last active**. The one you are using is marked **This session**.

- Select **End** on a session to sign that browser out.
- Select **End all other sessions** to keep only the one you are using.
- Select **Sign out** on your current session to sign out here.

If you do not recognize a session, end it and change your password.

### Passkeys and security keys

The **Passkeys and security keys** card lets you add a passkey or security key as your second factor, or to sign in with it alone. See [Passkeys and security keys](16-passkeys-and-security-keys.md).

### Single sign-on

When your administrator has set up a sign-in provider, the **Single sign-on** card lists the providers linked to your account and offers **Link …** for the others.

- To link one, select **Link** and the provider's name. Confirm your password if asked, then sign in at the provider. It must give the same email address as your account here, or nothing is linked and you are told why. You come back to this page with "Linked".
- To unlink one, select **Unlink** and confirm. You may be asked to confirm your password. The last way you can sign in cannot be unlinked.
- If you have no password here and are asked to confirm it is you, the card shows **Confirm with …**: you sign in at the provider again, and then have a few minutes to make the change.
- A directory is linked with **Link …** too: enter your user name and password at the directory (it must give your account's email address). **Confirm with …** for a directory opens the confirmation box, where you enter your directory password: the user name you last signed in, linked or confirmed with is filled in. Only the user name is remembered, never the password.

You can also link a provider from the sign-in page: if you sign in through a provider and your email matches your account here, the page asks you to sign in once with your password to link them.

If you are signed in with the break-glass account, a red notice at the top of the page says so: every administrator has been alerted.

On the sign-in page, a provider's button (**Sign in with …**) sends you to your organization's sign-in and back. Under the password form are **Sign in with a passkey** and **Forgot your password?**. When passwords are switched off, the password form is folded away under **Emergency access with a password**, for the break-glass account only, and neither of those is shown.

When your organization's directory is set up for sign-in, the password form has a **Sign in with** choice: the directory's name (use your directory user name and password, as for your computer) or **Password for this application**. If you have a second factor here, you are asked for it after your directory password, as with a password kept here: the code from your authenticator app, or your passkey or security key.

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

- SAML 2.0 sign-in must start at this application (identity-provider-initiated sign-in is refused). A sign-out started at the identity provider is acted on only when switched on for that provider (see "SAML 2.0 providers").
- A directory whose group list can be fetched only with its own kind of request gives no groups when a person is in too many to list; their roles are then left unchanged. Use application roles or a filtered groups claim instead.
- Signing in through a provider never asks for this application's own second factor; it counts as one only when you trust the provider for it (see "The provider's own second factor").
- Setup and reset links are emailed only when email is set up (see [Attachments and notifications](14-attachments-and-notifications.md#email-settings)); otherwise you pass them on by hand.
- The audit log's filters are not kept in the page address, so a filtered view cannot be bookmarked.
- Roles cannot be deleted and user accounts cannot be removed; switch off or disable them instead.
- New lists cannot be created on screen, and the special behavior of supplied values cannot be given to values you add.
- Data load mode works out missing values from the dates given for tickets, risks, actions, corrective action plans, changes, security incidents, vulnerabilities and policy exceptions. Other record types keep the values given, but what they would work out from today (for example a review date) is still worked out from today; give those values in the load.
- Anonymizing a record does not change the audit log, which keeps the earlier values of its personal fields; the audit log's own period is recorded, not enforced.