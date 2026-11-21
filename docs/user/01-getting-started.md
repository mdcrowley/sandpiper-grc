# Getting started

This is a governance, risk and compliance application for transit organizations: bus, rail and paratransit operators and their IT, cybersecurity and safety teams. This page explains what the application is for, how to set it up the first time, how to sign in, and how the screens are laid out. It also describes the two things you will use everywhere: lists of records and record pages. Read this page first; the other pages of the guide assume you know it.

## What the application is for

The application keeps the records an IT team needs for governance, risk and compliance in one place:

| Area | What you record there | Guide page |
|---|---|---|
| Service desk | Tickets, problems, knowledge articles and a catalog of standard requests | [Service desk](02-service-desk.md) |
| Inventory | Systems, assets, sites, data categories and how they relate | [Inventory](03-inventory.md) |
| Vendors | Vendors, contracts, security terms, evidence and renewals | [Vendors and contracts](04-vendors-and-contracts.md) |
| Cybersecurity | Framework outcomes and assessments | [Cybersecurity frameworks](05-cybersecurity-frameworks.md) |
| Cybersecurity | Risks, actions and obligations | [Risks, actions and obligations](06-risks-actions-obligations.md) |
| Cybersecurity | Security incidents and notification deadlines | [Security incidents](07-security-incidents.md) |
| Change | Planned changes, their approvals and the change calendar | [Change enablement](10-change-enablement.md) |
| Cybersecurity | Policies, acknowledgments and exceptions | [Policies and exceptions](11-policies-and-exceptions.md) |
| Cybersecurity | Training courses and exercises | [Training and exercises](12-training-and-exercises.md) |
| Cybersecurity | Vulnerabilities and their fix-by dates | [Vulnerabilities](13-vulnerabilities.md) |
| Inventory | Vehicles, the services they run and the systems each depends on | [Fleet and services](19-fleet-and-services.md) |
| Safety | Safety events, the hazard log and safety indicators | [Safety management](20-safety-management.md) |
| Projects | Project requests, stage gates and status reports | [Projects](08-projects.md) |
| Reports | Dashboards, reports, report packs and scheduled delivery | [Dashboards and reports](15-dashboards-and-reports.md) |
| Everywhere | Approvals waiting for you, and the steps they follow | [Approval workflows](22-approval-workflows.md) |
| Everywhere | Files attached to records, and notifications | [Attachments and notifications](14-attachments-and-notifications.md) |
| Everywhere | Exporting lists and importing records | [Importing and exporting](17-importing-and-exporting.md) |
| All staff | Reporting problems and asking for things without the IT screens | [Self-service portal](18-self-service-portal.md) |
| Administration | Users, roles, sign-in, lists, settings and the audit log | [Administration](09-administration.md) |

Every change to a record is kept in an audit trail, so you can always see who changed what and when.

## First run

A new installation has no accounts at all. There is no default user name or password. The first person to open the application sees the setup page instead of the sign-in page.

To create the first administrator:

1. Open the application in your browser. The setup page appears, headed **Welcome. Let's create the first administrator**.
2. Fill in **Your name**, **Username**, **Email**, **Password** and **Repeat password**. The username must be 3 to 64 letters, numbers, dots, dashes or underscores.
3. Select **Create administrator**. If something is missing or wrong, a message in red under that box says what to change. A bar under **Password** shows how close you are to the minimum length.

To check what you typed, select the eye button at the end of a password box. It shows the password; select it again to hide it. Every password box in the application has this button.

You are signed in straight away as an administrator. This account can add other users and manage settings. The setup page never appears again once one account exists.

A good first step is **Administration > Organization**: enter the organization's name, address and contacts, choose the application name, and upload your logo and colors. They then appear on the sign-in page, in the header, in emails and on printed documents. See [Organization](09-administration.md#organization).

Other people get their accounts from an administrator, who gives each person a one-time link. The link opens a **Set your password** page. It works once only and stops working after 24 hours; if yours has expired, ask an administrator for a new one. See [Administration](09-administration.md).

## Signing in

1. Open the application. The **Sign in** page appears.
2. Enter your **Username** and **Password**. You can type your email address in place of your username.
3. Select **Sign in**. If you left a box empty, a message under it says so.
4. If you have set up a second factor, a **6-digit code** box appears. Enter the code shown in your authenticator app and select **Verify and sign in**.

If the details are wrong you see "Sign-in failed. Check your details and try again." The message deliberately does not say which part was wrong.

After five failed attempts in a row the account is locked for a short time: one minute at first, doubling with each further failure up to 15 minutes. Wait, or ask an administrator.

You are signed out automatically after 8 hours, or sooner if you leave the application idle (30 minutes unless your administrator has changed it). The sign-in page then says "Your session ended".

If this happens while you are changing something, nothing you typed is lost. When you save, a box **Your session has ended** opens over the page instead of the sign-in page: select **Sign in in a new tab**, sign in there as usual, come back and select **Continue**, and your change is saved. Or select **Sign in on this page instead**: what you typed is kept in this browser tab, and once you have signed in it is back in the form the next time you open it (a record page reopens its form by itself), with a note asking you to check it and save.

### Other ways to sign in

Depending on how your administrator has set things up, the sign-in page may also offer:

- **Sign in with …** buttons for your organization's single sign-on. Select one, sign in at your organization, and you come back signed in. See [My account: the Account security page](09-administration.md#my-account-the-account-security-page).
- A **Sign in with** choice above **Username**: your organization's directory (use the user name and password you use for your computer) or **Password for this application**.
- **Sign in with a passkey**, if you have added one. See [Passkeys and security keys](16-passkeys-and-security-keys.md).
- **Forgot your password?**, when the application sends email.

When passwords are switched off for everyone, the password form is folded away under **Emergency access with a password**. It is for the break-glass account only.

### Password rules

- At least 14 characters, unless your administrator has set a different length. A phrase of several words works well.
- No rules about capitals, numbers or symbols, and no forced periodic change.
- Commonly used passwords are refused.
- The password must not contain your username.
- When you change your password, you cannot reuse any of your last five.

### Changing your password

1. Select your name (or the round badge with your initials) at the top right, then **Change password**.
2. Enter your **Current password**, then the **New password** twice.
3. Select **Change password**.

Changing your password signs you out everywhere else and revokes your API tokens and AI assistant connections, as the dialog says. To keep them working, check **Keep my API tokens and assistant connections** before you select **Change password**. Resetting the password with a reset link always revokes them.

### Setting up a second factor

A second factor means a stolen password is not enough to sign in as you. It is a 6-digit code from an authenticator app on your phone; any standard app that supports time-based codes works.

If you are expected to use a second factor and have not set one up, what happens depends on how your administrator has set the application:

- **Reminder.** A slim notice appears under the top bar on every page: "Your account needs a second sign-in factor." It cannot be dismissed and stays until you have set the second factor up. If you have been given a few days' grace, the notice names the date by which you must do it.
- **Required.** After you sign in you see only the **Account security** page, under the message **Set up a second sign-in factor to continue**. The menu, search and every other page are unavailable until the second factor is set up; the only other thing you can do is **Sign out**. As soon as you finish step 5 below, the whole application opens.

1. Select **Set it up now** in the notice, or select your name at the top right and then **Account security**. The **Account security** page opens.
2. Select **Set up an authenticator app**.
3. In your authenticator app, choose to add an account and scan the QR code on the page with your phone's camera. If you cannot scan it, type the key shown under **Cannot scan? Type this key into the app instead** (or use **Copy key**). **Show the set-up address** gives the address for apps that accept one.
4. Under **Enter the code the app now shows**, type the code into **6-digit code** and select **Confirm and turn on**.
5. The page shows **Your recovery codes**. Select **Copy codes**, **Download as text** or **Print**, store them safely, then select **I have saved them** (it works only after you have copied, downloaded or printed them).

You can also use a passkey or security key as your second factor; see [Passkeys and security keys](16-passkeys-and-security-keys.md).

The **Account security** page also shows when your password was last changed and a list titled **Where you are signed in**, where you can end a session you do not recognize.

### Recovery codes

Recovery codes are for when your phone is lost or broken.

- You get ten codes. Each one works once.
- They are shown once only. When you leave the page they cannot be shown again.
- To use one, type it into the **6-digit code** box at sign-in in place of the code from your app.
- The **Account security** page shows how many you have left. Select **New recovery codes** to replace them; the old ones stop working.
- If you have lost both your phone and your codes, ask an administrator to reset your second factor.

To stop using a second factor, select **Turn off** on the **Account security** page. You need your password and a current code or a recovery code.

## The layout

### Left navigation

The menu on the left is divided into groups. You see only the items your role allows, and a group with nothing in it for you is hidden.

| Group | Items |
|---|---|
| (top) | **Overview**, **My actions**, **Approvals**, **Notifications**, **Self-service portal** |
| Service desk | **Tickets**, **Service desk dashboard**, **Service catalog**, **Problems**, **Knowledge base** |
| Inventory | **Systems**, **Relationship map**, **Assets**, **Disposal approvals**, **Sites**, **Data categories**, **Vehicles**, **Services**, **Equipment coverage**, **What is affected**, **Inventory reports** |
| Change | **Changes**, **Change calendar**, **New change**, **Change settings** |
| Vendors | **Vendors**, **Security terms matrix**, **Contracts**, **Renewal calendar**, **Evidence**, **Expiring evidence** |
| Cybersecurity | **Framework outcomes**, **Assessments**, **Risk register**, **Risk reviews**, **Security incidents**, **Notification deadlines**, **Rules and checklists**, **Offline incident kit**, **Vulnerabilities**, **Vulnerability dashboard**, **Action tracker**, **Obligations**, **Policies**, **Training overview**, **Courses**, **My training**, **My acknowledgments**, **Exercises**, **Exercise calendar**, **Exceptions** |
| Safety | **Safety dashboard**, **Safety events**, **Hazard log**, **Safety indicators** |
| Projects | **Project portfolio**, **New project request**, **Project settings** |
| Reports | **Dashboards**, **Reports**, **Report packs**, **Schedules**, **Risk report**, **Delivered to me**, **Expiring evidence files** |
| Administration | **Users**, **Roles**, **Sign-in providers**, **Lists**, **Organization**, **Settings**, **Features**, **Custom fields**, **Lifecycles**, **Retention**, **API tokens**, **Approval workflows**, **AI assistant access**, **Email**, **Webhooks**, **Reminders**, **Background jobs**, **Audit log**, **Risk scales**, **Service desk settings**, **Hazard matrix**, **File settings**, **Backups** |
| Help | **User guide**, **API reference** |

A few entries are for everyone and have no permission of their own: **Overview**, **Approvals**, **Notifications**, **My training**, **My acknowledgments**, **New project request**, **Delivered to me**, **Expiring evidence files**, **User guide** and **API reference**. The settings entries (**Change settings**, **Project settings**, **Risk scales**, **Hazard matrix**, **File settings**) appear only for people who administer that area. A part of the application an administrator has switched off under **Administration > Features** (for example the self-service portal, which starts off) has no entries at all.

Each group heading is a button: select it to fold that group away or open it again. A folded group shows how many pages it holds, and the application remembers which groups you folded. The page you are on is highlighted, and its group opens by itself when you go there.

The menu has three forms, depending on the width of the window:

- **Wide window:** the full menu. The button at the left of the top bar folds it down to a narrow strip of icons and back; your choice is remembered.
- **Medium window:** the strip of icons, one per group. Point at or select an icon to see that group's pages. The menu button at the left of the top bar opens the full menu over the page.
- **Narrow window:** the menu is hidden. Select the menu button at the top left to open it.

With the keyboard, `Tab` reaches the menu; the up and down arrow keys then move from entry to entry, and the left and right arrow keys fold and open a group. **Skip to content** is the first thing `Tab` reaches on every page.

### Overview

**Overview** is the home page. Under a greeting with today's date, a line saying how many items are waiting for you, and the line "Governance, risk and compliance for transit organizations", it has two parts: **My work**, which is about you, and **Dashboard**, which is about the organization. Each part is made of boxes called widgets. You only ever see widgets for areas your role can open.

#### My work

Short lists of what is waiting for you. Each list shows a count beside its title, up to five items, and a **View all** link to the full list with the same filter applied. Select an item to open it.

| List | What it holds |
|---|---|
| **My tickets** | Open tickets assigned to you, with the time left to resolve each one |
| **My actions** | Actions you own that are not done or canceled, soonest due date first |
| **My approvals** | Things waiting for an approval your role can give: changes awaiting approval (not ones you raised yourself), exception requests and policies in review |
| **My acknowledgments** | Policies you have been asked to read and acknowledge |
| **My training** | Courses assigned to you that you have not completed |
| **My notifications** | Your unread notifications; opening one from here marks it as read |
| **Watching** | Records you watch (the **Watch** button on a record page), newest first. They are not counted as work waiting |

Due dates turn amber in their last week and red once they have passed. A list with nothing in it says so, and when every list is empty a green line tells you that you are up to date.

#### Dashboard

Figures, charts and tables for the areas you can see. You need the dashboards permission for this part; without it the page shows **My work** and a short note saying so.

- **Needs attention:** one box for each thing that is late or at risk: tickets past their target, overdue actions, vulnerabilities past their fix-by date, expired risk acceptances and risks that need review (only if you can see risks), security incident notification clocks that are running or overdue, contracts past their notice date, and actions with no owner. Each box is a link to the place where you deal with it. When there is nothing, a green line says so.
- **Headline numbers:** **Open tickets**, **Tickets within target**, **Open actions**, **Changes this week**, **Changes awaiting approval**, **Open vulnerabilities**, **Vulnerabilities overdue**, **Risks on the register**, **Training completed**, **Projects** and **Notice dates in 120 days**. Each is a link to the list behind it.
- **Incident notification clocks:** the deadlines that are running for security incidents.
- **Open tickets by priority** and **Policies by status:** charts. Select a bar to open the list of those records.
- **Changes this week:** the changes planned to start this week, with how many are awaiting approval, in progress or due a review.
- **Open vulnerabilities by severity:** a chart of open findings, how many are past their fix-by date and how many are known to be exploited. Select a bar or a figure to open that list.
- **Top risks**, **Framework progress**, **Training completion**, **Contracts approaching notice** and **Projects by status.**

The link at the top right of a widget opens the full page for that area. If a widget cannot load its figures it says so and offers **Try again**; the rest of the page still works.

The figures are the same for everyone who can see them. To keep the page quick when many people open it at once, the server may answer with figures it worked out a few seconds earlier (ten at most, by default), but never with figures from before a change: as soon as anything is saved, the next visit counts again. (An installation that runs several copies of the server on one database is the exception: a change saved through another copy shows within those few seconds.)

#### Your home dashboard

A chosen home dashboard (see [Dashboards and reports](15-dashboards-and-reports.md)) is shown in the Overview's **Dashboard** part, with a switch back to the Overview's own figures and an **Open in full** link. The Overview stays the page you land on. People whose role only looks (for example Executive viewer or Auditor) see the figures first, then **Where to look** (links to each area they can open), then **For you**.

#### Choosing what the overview shows

**Print** at the top right prints the Overview as it is now, with the date and time it was printed.

1. Select **Customize** at the top right of the page. A panel opens listing every widget you can have, under **My work** and **Dashboard**.
2. Turn the switch beside a widget off to hide it, or on to show it.
3. Select the up or down arrow beside a widget (**Move up**, **Move down**) to change its place. Widgets move within their own part of the page.
4. Select **Save**. **Cancel** closes the panel and leaves the page as it was.

**Reset to default** puts every widget back in its usual place and switches them all on; select **Save** to keep that. Everything in the panel works with the keyboard: `Tab` moves between the switches and arrows, and `Space` or `Enter` works them.

Your layout is yours alone. It is saved with your account, so it follows you to another computer or browser (if the server cannot save it, it is kept in this browser and the message says so). When a new widget is added to the application it appears in its usual place without disturbing your order.

### Global search

The search box in the middle of the top bar finds records, pages and things to create.

1. Select the box, or press `/` (when you are not typing in a field) or `Ctrl+K` from anywhere. A search panel opens over the page.
2. Before you type, the panel lists your **Recent searches** and what you can **Create**.
3. Type. From the first letter, **Go to** lists pages whose name matches (for example "ren" offers **Renewal calendar**) and **Create** lists matching kinds of record (typing "new" lists them all). From two letters, records you are allowed to see appear below, grouped by kind, each with its reference.
4. Select a result, or use the up and down arrow keys and press `Enter`. Press `Esc` to close the panel.

Search looks in titles, references and text, and also in comments and the names of attached files. Under each record found is a short passage with the words you typed highlighted; "In a comment" or "In a file name" says where they were found. Depending on how the server is set up, search matches whole words (with their other forms, such as "renew" for "renewal") or any part of a word. It does not understand misspellings. Recent searches are kept in this browser only.

### Create button

The **Create** button at the top right lists everything you are allowed to create, in alphabetical order, for example **Ticket**, **Asset**, **Contract** or **Risk**. Choosing an item opens the form for a new record of that kind. The same choices are in the search panel.

### Notifications bell

The bell at the top right shows a red number when you have unread notifications. Select it to see the latest ones; select one to open the record it is about. **Mark all as read** clears the number, **See all notifications** opens the full **Notifications** page, and **Preferences** lets you choose what you are told about.

### Help button

The question-mark button at the top right is **Help for this page**: it opens this guide at the section about the page you are on (from a ticket it opens the service desk page, from **Roles** the section on roles, and so on). When there is no matching section it opens the guide's first page, where you can search.

### Tags and watching

At the top of most record pages, under the title:

- **Tags** are short labels you can add to any record you can edit: select **Add tags** (or **Edit**), type a tag and press Enter or a comma, then **Save tags**. Existing tags are suggested as you type. Tags are stored in lower case. In a list, the **Filters** panel has a **Tags** box (records with any of the tags you choose), and the column chooser has a **Tags** column. Administrators can correct a tag on every record of a kind at once, or merge two tags, on the **Tags** tab of **Administration > Lists**.
- **Watch** follows the record: you are notified when its status changes or someone comments on it (not about your own changes). The button then reads **Watching** with the number of people watching; select it again to stop. Hover over it to see who watches. Records you watch are listed under **Watching** on the Overview.

### Lists: columns, saved views and extra fields

In any list, the column chooser and density are remembered for you, and **Save current view** in the views menu keeps a search, filters and sort under a name, for you alone or shared with everyone who can see the list (see [Saved views](#saved-views)). These are saved with your account, so they follow you to another browser. If your administrator has added fields of their own to a kind of record (**Custom fields** in Administration), they appear in its forms under their own heading, on the record page (in **Details**, or a **More details** card), as columns you can switch on, and in **Filters**.

### Keyboard shortcuts

Press `?` (when you are not typing in a box) to see the keyboard shortcuts, or choose **Keyboard shortcuts** in the menu under your name. A few pages have a key of their own, described on that page: `N` on the ticket list and the action tracker, `S` on a framework board tile, and `M` on the change calendar. The ones that work everywhere:

| Keys | What they do |
|---|---|
| `/` or `Ctrl+K` | Open search |
| `?` | Show the list of shortcuts |
| `g` then `o` | Go to the overview |
| `g` then `n` | Go to your notifications |
| `g` then `h` | Open Help for the page you are on |
| `Esc` | Close the dialog, menu or list that is open |

Shortcuts made of single letters do nothing while you are typing in a box or while a dialog is open.

In a dialog, `Esc` first closes a list that is open in a field (a choice list or a record picker), and the next `Esc` closes the dialog. If you have typed something that is not saved yet, the dialog asks before throwing it away: `Tab` to **Discard** and press `Enter`, or choose **Cancel** to go back to it. In a record picker, type a few letters, move through the matches with the `Down` and `Up` arrows and press `Enter` to choose one.

### Theme toggle

The sun or moon button at the top right switches between the light and dark themes. The application starts in the theme your computer uses and remembers your choice.

### User menu

The button with your initials and name at the top right opens a menu with **Notifications**, **Account security**, **Change password**, **Help**, **Keyboard shortcuts** and **Sign out**. On a narrow window the button shows your initials only.

### Messages

Short confirmations and errors, such as "Password changed.", appear at the bottom right of the window and fade after a few seconds. Select the cross to dismiss one sooner.

### Dates, numbers and amounts

Dates are written as "Nov 18, 2026", numbers as "1,234.5" and amounts in the organization's currency as "$1,234.50", whatever language your browser is set to, so a figure reads the same for everyone, on screen and in exports. Notifications and emails write dates the same way. "Today" is the day on the organization's calendar, in its time zone, not your computer's.

## How every list works

Tickets, assets, vendors, risks and most other records are shown in lists that all behave the same way. Above the table is a toolbar: the **Search** box and the **Filters** button on the left; the views button, the column chooser, the row-height button, **Import** and **Export** on the right (each only when your role allows it).

The table scrolls inside its own frame. The column headings stay in place while you scroll down, and a wide table scrolls sideways inside the frame rather than moving the whole page.

### Search

Type in the **Search** box above the list. The list updates as you type. Search looks in the main text fields of that kind of record and in its reference. Select the cross in the box to clear it.

### Filters

Select **Filters** to open the filter panel for that list. There are four kinds of filter:

- **Choice filters** such as **Status**: select one or more values. The list shows records that match any selected value.
- **Yes or no filters** such as **Major incident**: choose **Any**, **Yes** or **No**.
- **Person and record filters** such as **Assignee** or **Vendor**: start typing a name and choose from the matches. Under a person filter, **Me** picks yourself in one step.
- **Date filters**: each has an **after** box and a **before** box. Pick a day from the calendar or type it, for example `Nov 18, 2026` or `11/18/2026`.

The list updates as soon as you change a filter. Select **Done**, or anywhere outside the panel, to close it. The **Filters** button shows how many filters are in use.

Every filter in use, and the search text, is also shown as a small label under the toolbar, for example "Status: New, Open". Select the cross on a label to remove that one filter, or **Clear all** to remove the search and every filter.

### Sort

Select a column heading to sort by that column. Select it again to reverse the order, and a third time to go back to the usual order. An arrow shows the column and direction in use. A few columns cannot be sorted and have no button.

### Sharing a list and going back

On the main list pages the search, filters, sort order and page number are kept in the address shown by your browser. This means:

- Your browser's **Back** button undoes the last filter, sort or page change.
- You can bookmark the address, or copy it and send it to a colleague. They see the same search, filters and sort (and only the records their role allows).
- Reloading the page keeps the list as you left it.
- A filter in an address or a saved view on a field the list no longer has (for example one whose option an administrator has switched off under **Features**) is ignored and taken out of the address, so the list shows everything else the address asks for.

Lists that sit inside another page, such as the contracts on a vendor's page, do not change the address.

### Saved views

A saved view remembers the current search, filters and sort order. The views button shows the name of the view in use: **All** followed by the kind of record (for example **All tickets**) when nothing is filtered, the name of a saved view, or **Unsaved view** when you have changed something.

1. Set up the list the way you want it.
2. Select the views button, then **Save current view…**.
3. Type a **View name** and select **Save view**. Using the name of an existing view replaces it.

To use a view, select the views button and choose it. Choose **All …** at the top of the menu to go back to the full list. To remove a view, choose it and then select **Delete** in the same menu.

Your saved views are kept with your account, under **My views** in the menu, so they follow you to any computer or browser you sign in from. Nobody else sees them.

#### Sharing a view with colleagues

A view can also be shared with everyone who can see the list:

- When you save it, check **Share with everyone who can see this list** and select **Share view**; or
- choose one of your own views and select **Share "…" with everyone** in the menu. It then moves from **My views** to **Shared with everyone**.

Shared views are listed under **Shared with everyone**, each with the name of the person who shared it. A shared view holds only the search, filters and sort: whoever opens it sees just the records they are allowed to see, so the same view can show different records to different people. Only the person who shared a view, or an administrator, can replace it (save a view of the same name with the box checked) or remove it (choose it, then **Stop sharing "…"**). Sharing, changing and removing a shared view is recorded in the audit log. Two shared views on one list cannot have the same name.

To show a colleague a list just once, you can still send the page address instead.

#### Views saved in this browser only

Views saved before they were kept with your account were stored in the browser alone. While they are still only there, the menu ends with **Keep this browser's views in your account**: select it to keep them with your account from then on. Do this in each browser where you saved views.

### Columns and row height

- Select the **Choose columns** button (three upright bars) and clear the columns you do not need. **Reset** brings back the usual columns.
- Select the **Compact rows** button beside it to fit more rows on the screen. Select it again for the roomier rows.

Both choices, and the number of rows per page, are remembered with your account, so they follow you to another browser.

Long text in a cell is cut short with "…". Rest the pointer on it to read the whole text.

### Export and import

Select **Export** and choose **Excel (XLSX)**, **CSV** or **PDF**. The file holds every record that matches your current search and filters (not only the page on screen, up to 50,000 rows, and the file says when it was cut; a PDF holds at most 12 columns and prints at most 2,000 rows), in the order on screen, with the columns on screen. The button appears only if your role allows exporting that kind of record.

**Import** (for people who may create that kind of record) fills the list from a CSV or Excel file. See [Importing and exporting](17-importing-and-exporting.md).

### Paging

Lists show 25 records per page unless stated otherwise. The foot of the list shows which records you are looking at, for example "1–25 of 140 tickets", a box to choose 10, 25, 50 or 100 rows per page, and the page numbers.

### Selecting rows and changing several records at once

If your role allows editing that kind of record, each row starts with a checkbox.

1. Check the rows you want. The checkbox in the heading selects or clears every row on the page. Your selection is kept while you move between pages, and is cleared when you change the search or a filter.
2. A bar appears above the table showing how many records are selected.
3. Select **Edit selected…**. Choose the **Field to change** and the new value, or check the box to leave the field empty instead.
4. Select **Apply to** … (for example **Apply to 3 tickets**). A bar shows the progress; **Stop** halts the run, and the records not reached yet are counted as not attempted. When it finishes you are told how many records were updated, how many already had that value, and which ones could not be changed and why (for example, a rule of that kind of record does not allow the change).
5. Select **Done**.

Each record is changed separately, exactly as if you had edited it by hand, so every change appears in that record's history under your name. Only some fields can be changed this way: mostly choice fields such as status or priority, and people such as the assignee.

**Export selected** downloads only the checked rows, with the columns currently shown, as a CSV file (if your role allows exporting). **Clear selection** clears every check box.

### Opening and creating records

- Select a row, or the reference or title in it, to open the record.
- Select the **New** button above the list (for example **New problem**) to create a record. Fill in the form and select the **Create** button at the bottom. Fields marked with a red asterisk must be filled in. If something is missing or not allowed, the message appears under that field and the cursor moves to it. The new record then opens.
- If you select **Cancel** or close the form after typing something, you are asked whether to discard what you entered.

### Leaving a page with unsaved changes

While a form holds changes that are not saved (a record you are editing, a new record, a dialog such as **New ticket**, or a page such as **New change**, **Declare incident** or **New project request**), the application asks **Discard your unsaved changes?** before it takes you anywhere else: a link in the sidebar, the **Create** menu, search, or the browser's **Back** button. Choose **Keep editing** to stay, or **Discard changes** to go. Closing or reloading the browser tab asks too, in the browser's own words. Switching tabs within a record page does not ask, as it keeps you on the page.

### Using a list with the keyboard

Press `Tab` until a row of the table is outlined. Then:

| Key | What it does |
|---|---|
| `Down` and `Up` arrows | Move to the next or previous row |
| `Home`, `End` | Move to the first or last row on the page |
| `Enter` | Open the record |
| `Space` | Select or clear the row (when rows can be selected) |

The search box, filters, column headings and page buttons are all reached with `Tab` and worked with `Enter` or `Space`. `Esc` closes a menu or panel.

## How every record page works

Opening a record shows its page. The top of the page has the title, the reference (for example `TKT-00042`), colored chips for status and similar values, and buttons for the things you can do to that record. **PDF** among those buttons (when your role allows exporting that kind of record) downloads a fact sheet of the record. A trail of links above the title takes you back to the list. Under the title a line says when the record was last changed.

### Summary and editing

Below the header is a **Details** card showing the main fields. Some records have further cards or tabs for other groups of fields.

1. Select **Edit** on the card. The card turns into a form in place.
2. Change the fields you need.
3. Select **Save changes**, or **Cancel** to leave the record as it was. If you have changed something, **Cancel** first asks whether to discard your changes: choose **Keep editing** or **Discard changes**.

If a value is not allowed, the message appears under the field and the cursor moves to the first such field. **Edit** is shown only if your role allows editing that kind of record. Some fields are worked out by the application and cannot be typed in; they appear grayed out in the form.

In forms:

- **Choice fields** open a list; a colored dot shows the color used for that value elsewhere. Long lists can be narrowed by typing.
- **Person and record fields** search as you type. Use the arrow keys and `Enter` to choose, and the cross to clear.
- **Date fields** take a day from the calendar or typed in, for example `Nov 18, 2026`, `11/18/2026` (month first) or `2026-11-18`.
- **Date and time fields** are in your organization's time zone, which is named under the field.

### Tabs

The lower part of the page is divided into tabs. Most records have **Activity**, **Attachments**, **Related** and **History**; many have more, such as **Contracts** on a vendor. A number beside a tab's name is a count: comments on **Activity**, files on **Attachments**, linked records on **Related**.

The tab you are looking at is part of the page address, so a bookmark or a link sent to a colleague opens the same tab.

### Activity and comments

The **Activity** tab shows comments and changes together, newest first. Each entry shows who it was, and how long ago; rest the pointer on the time for the exact date and time. **Everything**, **Comments** and **Changes** above the list choose what is shown.

1. Type in the box at the top of the tab.
2. Leave **Internal note** selected for a note meant for staff only. Select **Public comment** to mark the comment as visible to the requester as well. Internal notes are shown with an amber edge and a padlock.
3. Select **Add note** or **Add comment** (or press `Ctrl` and `Enter`).

Comments cannot be edited or removed afterward.

### Attachments

The **Attachments** tab holds the files attached to the record. See [Attachments and notifications](14-attachments-and-notifications.md) for adding, downloading and removing files. The tab is absent if attachments are not switched on in your installation.

### Related links

The **Related** tab links a record to any other record, for example a ticket to a risk. Linked records are grouped by kind.

1. Select **Add link**.
2. Choose the **Record type**.
3. Check the **Relation** (it starts as "related to").
4. In **Record**, start typing a reference or title and choose the record.
5. Select **Add link**.

The link appears on both records. The relation is shown beside each link; on the other record it is marked with a "←" arrow, meaning the link was made from the first record. To remove a link, select the trash button beside it and confirm with **Remove link**. Removing a link never deletes either record.

### History

The **History** tab is the audit trail of the record: each change, who made it, when, and the old value (struck through) followed by the new value. Where a field holds a person or another record, the history shows the name where it can; if the person or record can no longer be looked up, or you are not allowed to see it, it shows "Another user" or "Another" followed by the kind of record. The entry for a record being created lists the fields that were filled in; select **Show more** to see them all. Changes made by the application itself are shown as "System". History cannot be edited.

## Moving between pages

The application downloads each area the first time you open it. On a slow connection you may see a thin moving bar under the top bar and gray placeholder lines for a moment; the page then appears. If a page cannot be downloaded (for example because the application was updated while you had it open), a message offers **Reload the page**.

## Printing

Use your browser's print command (`Ctrl+P`) on any page. The printout is always on white, whatever theme you use on screen, and leaves out the menu, the top bar, buttons, search and filter controls and checkboxes.

- **A list** prints the rows on screen with every column, long text wrapped rather than cut short, and the column headings repeated on each sheet. To print more rows, choose a larger number of rows per page first; for everything, use **Export**.
- **A record page** prints its header, summary and the tab you have open, under that tab's name. Open the tab you want (for example **History**) before printing.
- **A guide page** prints in full, with the addresses of outside links written out.

## Pilot mode

While the application is in pilot mode, an amber **Pilot: test data only** label is shown in the top bar of every page (just **Pilot** on a narrow window). Select it to read the full message:

"Use sample and test data only. Do not enter real records, personal details or anything confidential while this label is showing."

The label is there so nobody mistakes a trial installation for the system of record. Follow it: enter only sample or test information until your administrator switches pilot mode off under **Administration**, **Settings**. See [Administration](09-administration.md).

## Where to get help

- This guide is shown in the application's Help section. The same pages are in the `docs/user` folder of the installation.
- For a forgotten password, select **Forgot your password?** on the sign-in page when your installation sends email (see [Forgot your password?](14-attachments-and-notifications.md#forgot-your-password)). For a locked account or a lost second factor, or when there is no such link, ask an administrator. They can give you a new one-time link or reset your second factor.
- If you cannot see a menu item or button that this guide describes, your role does not include it. Ask an administrator.
- Select the question-mark button at the top right to open this guide at the section about the page you are on, or **Help** in the menu under your name for its first page. The first page has a search box that looks through every page of the guide and takes you to the matching section.
- If a page fails to load, select **Try again** on the message. If it keeps failing, tell whoever looks after the installation.
- The foot of the Help page shows the installed version and the commit it was built from. Give it when you report a problem.

## Not available yet

- A separate page for signing in with a recovery code. Type the code into the **6-digit code** box (or the **Recovery code** box) instead.
- Deleting most kinds of record from their page.
- Editing or removing a comment once it is added.
