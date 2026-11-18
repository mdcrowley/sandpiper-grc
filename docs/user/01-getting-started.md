# Getting started

This page explains what the application is for, how to set it up the first time, how to sign in, and how the screens are laid out. It also describes the two things you will use everywhere: lists of records and record pages. Read this page first; the other pages of the guide assume you know it.

## What the application is for

The application keeps the records an IT team needs for governance, risk and compliance in one place:

| Area | What you record there | Guide page |
|---|---|---|
| Service desk | Tickets, problems, knowledge articles and a catalogue of standard requests | [Service desk](02-service-desk.md) |
| Inventory | Systems, assets, sites, data categories and how they relate | [Inventory](03-inventory.md) |
| Vendors | Vendors, contracts, security terms, evidence and renewals | [Vendors and contracts](04-vendors-and-contracts.md) |
| Cybersecurity | Framework outcomes and assessments | [Cybersecurity frameworks](05-cybersecurity-frameworks.md) |
| Cybersecurity | Risks, actions and obligations | [Risks, actions and obligations](06-risks-actions-obligations.md) |
| Cybersecurity | Security incidents and notification deadlines | [Security incidents](07-security-incidents.md) |
| Projects | Project requests, stage gates and status reports | [Projects](08-projects.md) |
| Administration | Users, roles, lists, settings and the audit log | [Administration](09-administration.md) |

Every change to a record is kept in an audit trail, so you can always see who changed what and when.

## First run

A new installation has no accounts at all. There is no default user name or password. The first person to open the application sees the setup page instead of the sign-in page.

To create the first administrator:

1. Open the application in your browser. The setup page appears, headed **Welcome. Let's create the first administrator**.
2. Fill in **Your name**, **Username**, **Email**, **Password** and **Repeat password**. The username must be 3 to 64 letters, numbers, dots, dashes or underscores.
3. Select **Create administrator**. If something is missing or wrong, a message in red under that box says what to change. A bar under **Password** shows how close you are to the minimum length.

To check what you typed, select the eye button at the end of a password box. It shows the password; select it again to hide it. Every password box in the application has this button.

You are signed in straight away as an administrator. This account can add other users and manage settings. The setup page never appears again once one account exists.

Other people get their accounts from an administrator, who gives each person a one-time link. The link opens a **Set your password** page. It works once only and stops working after 24 hours; if yours has expired, ask an administrator for a new one. See [Administration](09-administration.md).

## Signing in

1. Open the application. The **Sign in** page appears.
2. Enter your **Username** and **Password**. You can type your email address in place of your username.
3. Select **Sign in**. If you left a box empty, a message under it says so.
4. If you have set up a second factor, a **6-digit code** box appears. Enter the code shown in your authenticator app and select **Verify and sign in**.

If the details are wrong you see "Sign-in failed. Check your details and try again." The message deliberately does not say which part was wrong.

After five failed attempts in a row the account is locked for a short time: one minute at first, doubling with each further failure up to 15 minutes. Wait, or ask an administrator.

You are signed out automatically after 8 hours, or sooner if you leave the application idle (30 minutes unless your administrator has changed it).

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

Changing your password signs you out everywhere else.

### Setting up a second factor

A second factor means a stolen password is not enough to sign in as you. It is a 6-digit code from an authenticator app on your phone; any standard app that supports time-based codes works.

If your role is expected to use a second factor and you have not set one up, a slim notice appears under the top bar on every page: "Your role requires a second sign-in factor." It cannot be dismissed and stays until you have set the second factor up. In this version the notice is a reminder only; it does not stop you signing in.

1. Select **Set it up now** in the notice, or select your name at the top right and then **Account security**. The **Account security** page opens.
2. Select **Set up an authenticator app**.
3. In your authenticator app, choose to add an account and enter the setup key shown on the page by hand. Use **Copy key** if that is easier. If your app accepts a setup address instead, copy that.
4. Type the code your app now shows into **Enter the 6-digit code your app now shows** and select **Turn on**.
5. The page shows **Your recovery codes**. Select **Copy codes** or **Print**, store them safely, then select **I have saved them**.

The **Account security** page also shows when your password was last changed and a list titled **Where you are signed in**, where you can end a session you do not recognise.

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
| (top) | **Overview** |
| Service desk | **Tickets**, **Service desk dashboard**, **Service catalogue**, **Problems**, **Knowledge base** |
| Inventory | **Systems**, **Relationship map**, **Assets**, **Sites**, **Data categories**, **Inventory reports** |
| Vendors | **Vendors**, **Security terms matrix**, **Contracts**, **Renewal calendar**, **Evidence**, **Expiring evidence** |
| Cybersecurity | **Framework outcomes**, **Assessments**, **Risk register**, **Security incidents**, **Notification rules and checklists**, **Offline incident kit**, **Action tracker**, **Obligations** |
| Projects | **Project portfolio**, **New project request**, **Project settings** |
| Administration | **Users**, **Roles**, **Lists**, **Settings**, **Audit log** |

Each group heading is a button: select it to fold that group away or open it again. A folded group shows how many pages it holds, and the application remembers which groups you folded. The page you are on is highlighted, and its group opens by itself when you go there.

The menu has three forms, depending on the width of the window:

- **Wide window:** the full menu. The button at the left of the top bar folds it down to a narrow strip of icons and back; your choice is remembered.
- **Medium window:** the strip of icons, one per group. Point at or select an icon to see that group's pages. The menu button at the left of the top bar opens the full menu over the page.
- **Narrow window:** the menu is hidden. Select the menu button at the top left to open it.

With the keyboard, `Tab` reaches the menu; the up and down arrow keys then move from entry to entry, and the left and right arrow keys fold and open a group. **Skip to content** is the first thing `Tab` reaches on every page.

### Overview

**Overview** is the home page. From top to bottom it shows:

- A greeting with today's date.
- **Needs attention:** one box for each thing that is late or at risk: tickets past their target, overdue actions, security incident notification clocks that are running or overdue, contracts past their notice date, and actions with no owner. Each box is a link to the place where you deal with it. When there is nothing, a green line says so.
- Headline figures: **Open tickets**, **Tickets within target**, **Open actions**, **Risks on the register**, **Projects** and **Notice dates in 120 days**. Each is a link to the list behind it.
- Panels: **Incident notification clocks** (only while a clock is running), **Open tickets by priority**, **Framework progress**, **Top risks**, **Contracts approaching notice** and **Projects by status**. The link at the top right of a panel opens the full page.

Figures and panels for areas you cannot see are left out.

### Global search

The search box in the middle of the top bar finds records, pages and things to create.

1. Select the box, or press `/` (when you are not typing in a field) or `Ctrl+K` from anywhere. A search panel opens over the page.
2. Before you type, the panel lists your **Recent searches** and what you can **Create**.
3. Type. From the first letter, **Go to** lists pages whose name matches (for example "ren" offers **Renewal calendar**) and **Create** lists matching kinds of record (typing "new" lists them all). From two letters, records you are allowed to see appear below, grouped by kind, each with its reference.
4. Select a result, or use the up and down arrow keys and press `Enter`. Press `Esc` to close the panel.

Search matches any part of a word or reference. It does not understand misspellings or similar words. Recent searches are kept in this browser only.

### Create button

The **Create** button at the top right lists everything you are allowed to create, in alphabetical order, for example **Ticket**, **Asset**, **Contract** or **Risk**. Choosing an item opens the form for a new record of that kind. The same choices are in the search panel.

### Notifications bell

The bell at the top right shows a red number when you have unread notifications. Select it to see the latest ones; select one to open the record it is about. **Mark all as read** clears the number, **See all notifications** opens the full **Notifications** page, and **Preferences** lets you choose what you are told about.

### Help button

The question-mark button at the top right opens this guide.

### Theme toggle

The sun or moon button at the top right switches between the light and dark themes. The application starts in the theme your computer uses and remembers your choice.

### User menu

The button with your initials and name at the top right opens a menu with **Notifications**, **Account security**, **Change password**, **Help** and **Sign out**. On a narrow window the button shows your initials only.

### Messages

Short confirmations and errors, such as "Password changed.", appear at the bottom right of the window and fade after a few seconds. Select the cross to dismiss one sooner.

## How every list works

Tickets, assets, vendors, risks and most other records are shown in lists that all behave the same way. Above the table is a toolbar: the **Search** box and the **Filters** button on the left; the views button, the column chooser, the row-height button and **Export** on the right.

The table scrolls inside its own frame. The column headings stay in place while you scroll down, and a wide table scrolls sideways inside the frame rather than moving the whole page.

### Search

Type in the **Search** box above the list. The list updates as you type. Search looks in the main text fields of that kind of record and in its reference. Select the cross in the box to clear it.

### Filters

Select **Filters** to open the filter panel for that list. There are four kinds of filter:

- **Choice filters** such as **Status**: select one or more values. The list shows records that match any selected value.
- **Yes or no filters** such as **Major incident**: choose **Any**, **Yes** or **No**.
- **Person and record filters** such as **Assignee** or **Vendor**: start typing a name and choose from the matches. Under a person filter, **Me** picks yourself in one step.
- **Date filters**: each has an **after** box and a **before** box. Pick a day from the calendar or type it, for example `18 Nov 2026`.

The list updates as soon as you change a filter. Select **Done**, or anywhere outside the panel, to close it. The **Filters** button shows how many filters are in use.

Every filter in use, and the search text, is also shown as a small label under the toolbar, for example "Status: New, Open". Select the cross on a label to remove that one filter, or **Clear all** to remove the search and every filter.

### Sort

Select a column heading to sort by that column. Select it again to reverse the order, and a third time to go back to the usual order. An arrow shows the column and direction in use. A few columns cannot be sorted and have no button.

### Sharing a list and going back

On the main list pages the search, filters, sort order and page number are kept in the address shown by your browser. This means:

- Your browser's **Back** button undoes the last filter, sort or page change.
- You can bookmark the address, or copy it and send it to a colleague. They see the same search, filters and sort (and only the records their role allows).
- Reloading the page keeps the list as you left it.

Lists that sit inside another page, such as the contracts on a vendor's page, do not change the address.

### Saved views

A saved view remembers the current search, filters and sort order. The views button shows the name of the view in use: **All** followed by the kind of record (for example **All tickets**) when nothing is filtered, the name of a saved view, or **Unsaved view** when you have changed something.

1. Set up the list the way you want it.
2. Select the views button, then **Save current view…**.
3. Type a **View name** and select **Save view**. Using the name of an existing view replaces it.

To use a view, select the views button and choose it. Choose **All …** at the top of the menu to go back to the full list. To remove a view, choose it and then select **Delete** in the same menu.

Saved views are kept in your browser only. They are not shared with colleagues and do not follow you to another computer or browser. To share a view, send the page address instead.

### Columns and row height

- Select the **Choose columns** button (three upright bars) and untick the columns you do not need. **Reset** brings back the usual columns.
- Select the **Compact rows** button beside it to fit more rows on the screen. Select it again for the roomier rows.

Both choices, and the number of rows per page, are remembered for you in this browser.

Long text in a cell is cut short with "…". Rest the pointer on it to read the whole text.

### CSV export

Select **Export** to download the list as a file that opens in a spreadsheet. The file holds every record that matches your current search and filters (not only the page on screen, up to 50,000 rows) and every field of each record (not only the columns shown). The button appears only if your role allows exporting that kind of record.

### Paging

Lists show 25 records per page unless stated otherwise. The foot of the list shows which records you are looking at, for example "1–25 of 140 tickets", a box to choose 10, 25, 50 or 100 rows per page, and the page numbers.

### Selecting rows and changing several records at once

If your role allows editing that kind of record, each row starts with a tick box.

1. Tick the rows you want. The tick box in the heading selects or clears every row on the page. Your selection is kept while you move between pages, and is cleared when you change the search or a filter.
2. A bar appears above the table showing how many records are selected.
3. Select **Edit selected…**. Choose the **Field to change** and the new value, or tick the box to leave the field empty instead.
4. Select **Apply**. A bar shows the progress. When it finishes you are told how many records were updated, how many already had that value, and which ones could not be changed and why (for example, a rule of that kind of record does not allow the change).
5. Select **Done**.

Each record is changed separately, exactly as if you had edited it by hand, so every change appears in that record's history under your name. Only some fields can be changed this way: mostly choice fields such as status or priority, and people such as the assignee.

**Export selected** downloads only the ticked rows, with the columns currently shown, as a CSV file (if your role allows exporting). **Clear selection** unticks everything.

### Opening and creating records

- Select a row, or the reference or title in it, to open the record.
- Select the **New** button above the list (for example **New problem**) to create a record. Fill in the form and select the **Create** button at the bottom. Fields marked with a red asterisk must be filled in. If something is missing or not allowed, the message appears under that field and the cursor moves to it. The new record then opens.
- If you select **Cancel** or close the form after typing something, you are asked whether to discard what you entered.

### Using a list with the keyboard

Press `Tab` until a row of the table is outlined. Then:

| Key | What it does |
|---|---|
| `Down` and `Up` arrows | Move to the next or previous row |
| `Home`, `End` | Move to the first or last row on the page |
| `Enter` | Open the record |
| `Space` | Tick or untick the row (when rows can be selected) |

The search box, filters, column headings and page buttons are all reached with `Tab` and worked with `Enter` or `Space`. `Esc` closes a menu or panel.

## How every record page works

Opening a record shows its page. The top of the page has the title, the reference (for example `TKT-00042`), coloured chips for status and similar values, and buttons for the things you can do to that record. A trail of links above the title takes you back to the list. Under the title a line says when the record was last changed.

### Summary and editing

Below the header is a **Details** card showing the main fields. Some records have further cards or tabs for other groups of fields.

1. Select **Edit** on the card. The card turns into a form in place.
2. Change the fields you need.
3. Select **Save changes**, or **Cancel** to leave the record as it was. If you have changed something, **Cancel** first asks whether to discard your changes: choose **Keep editing** or **Discard changes**.

If a value is not allowed, the message appears under the field and the cursor moves to the first such field. **Edit** is shown only if your role allows editing that kind of record. Some fields are worked out by the application and cannot be typed in; they appear greyed out in the form.

In forms:

- **Choice fields** open a list; a coloured dot shows the colour used for that value elsewhere. Long lists can be narrowed by typing.
- **Person and record fields** search as you type. Use the arrow keys and `Enter` to choose, and the cross to clear.
- **Date fields** take a day from the calendar or typed in, for example `18 Nov 2026` or `18/11/2026`.
- **Date and time fields** are in your organisation's time zone, which is named under the field.

### Tabs

The lower part of the page is divided into tabs. Most records have **Activity**, **Attachments**, **Related** and **History**; many have more, such as **Contracts** on a vendor. A number beside a tab's name is a count: comments on **Activity**, files on **Attachments**, linked records on **Related**.

The tab you are looking at is part of the page address, so a bookmark or a link sent to a colleague opens the same tab.

### Activity and comments

The **Activity** tab shows comments and changes together, newest first. Each entry shows who it was, and how long ago; rest the pointer on the time for the exact date and time. **Everything**, **Comments** and **Changes** above the list choose what is shown.

1. Type in the box at the top of the tab.
2. Leave **Internal note** selected for a note meant for staff only. Select **Public comment** to mark the comment as visible to the requester as well. Internal notes are shown with an amber edge and a padlock.
3. Select **Add note** or **Add comment** (or press `Ctrl` and `Enter`).

Comments cannot be edited or removed afterwards.

### Attachments

The **Attachments** tab holds the files attached to the record. See [Attachments and notifications](14-attachments-and-notifications.md) for adding, downloading and removing files. The tab is absent if attachments are not switched on in your installation.

### Related links

The **Related** tab links a record to any other record, for example a ticket to a risk. Linked records are grouped by kind.

1. Select **Add link**.
2. Choose the **Record type**.
3. Check the **Relation** (it starts as "related to").
4. In **Record**, start typing a reference or title and choose the record.
5. Select **Add link**.

The link appears on both records. The relation is shown beside each link; on the other record it is marked with a "←" arrow, meaning the link was made from the first record. To remove a link, select the bin button beside it and confirm with **Remove link**. Removing a link never deletes either record.

### History

The **History** tab is the audit trail of the record: each change, who made it, when, and the old value (struck through) followed by the new value. Where a field holds a person or another record, the history shows the name where it can; if the person or record can no longer be looked up, or you are not allowed to see it, it shows "Another user" or "Another" followed by the kind of record. The entry for a record being created lists the fields that were filled in; select **Show more** to see them all. Changes made by the application itself are shown as "System". History cannot be edited.

## Pilot mode

While the application is in pilot mode, an amber **Pilot: test data only** label is shown in the top bar of every page (just **Pilot** on a narrow window). Select it to read the full message:

"Use seed and test data only. Do not record live incident details, health information or card data."

The label is there so nobody mistakes a trial installation for the system of record. Follow it: enter only sample or test information until your administrator switches pilot mode off under **Administration**, **Settings**. See [Administration](09-administration.md).

## Where to get help

- This guide is shown in the application's Help section. The same pages are in the `docs/user` folder of the installation.
- For a forgotten password, a locked account or a lost second factor, ask an administrator. They can give you a new one-time link or reset your second factor.
- If you cannot see a menu item or button that this guide describes, your role does not include it. Ask an administrator.
- Select the question-mark button at the top right, or **Help** in the menu under your name, to open this guide from any page.
- If a page fails to load, select **Try again** on the message. If it keeps failing, tell whoever looks after the installation.

## Not available yet

- Signing in with your organisation's single sign-on, or with a passkey. Accounts are local to the application.
- A separate page for signing in with a recovery code. Type the code into the **6-digit code** box instead.
- Notifications by email. Notifications are shown in the application only (the bell at the top right).
- Tags, watchers and custom fields.
- Deleting a record from its page.
- Saved views that are shared with other people or kept on the server.
- Export to spreadsheet formats other than CSV.
- A self-service portal for people outside the IT team.
