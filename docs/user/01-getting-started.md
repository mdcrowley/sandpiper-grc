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

1. Open the application in your browser. The page **Set up the first administrator** appears.
2. Fill in **Your name**, **Username**, **Email**, **Password** and **Repeat password**. The username must be 3 to 64 letters, numbers, dots, dashes or underscores.
3. Select **Create administrator**.

You are signed in straight away as an administrator. This account can add other users and manage settings. The setup page never appears again once one account exists.

Other people get their accounts from an administrator, who gives each person a one-time link. The link opens a **Set your password** page. It works once only and stops working after 24 hours; if yours has expired, ask an administrator for a new one. See [Administration](09-administration.md).

## Signing in

1. Open the application. The **Sign in** page appears.
2. Enter your **Username** and **Password**. You can type your email address in place of your username.
3. Select **Sign in**.
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

1. Select your name at the top right, then **Change password**.
2. Enter your **Current password**, then the **New password** twice.
3. Select **Change password**.

Changing your password signs you out everywhere else.

### Setting up a second factor

A second factor means a stolen password is not enough to sign in as you. It is a 6-digit code from an authenticator app on your phone; any standard app that supports time-based codes works.

If your role is expected to use a second factor and you have not set one up, a notice appears at the top of every page: "Your role requires a second sign-in factor." In this version the notice is a reminder only; it does not stop you signing in.

1. Select **Set it up now** in the notice. If you do not see the notice, add `/account/security` to the application's address in your browser. The **Account security** page opens.
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
| Service desk | **Tickets**, **Service desk dashboard**, **Catalogue**, **Problems**, **Knowledge base** |
| Inventory | **Systems**, **Relationship map**, **Assets**, **Sites**, **Data categories**, **Inventory reports** |
| Vendors | **Vendors**, **Security terms**, **Contracts**, **Renewal calendar**, **Evidence**, **Expiring evidence** |
| Cybersecurity | **Framework outcomes**, **Assessments**, **Risk register**, **Security incidents**, **Notification rules**, **Offline incident kit**, **Action tracker**, **Obligations** |
| Projects | **Portfolio**, **New request**, **Project settings** |
| Administration | **Users**, **Roles**, **Lists**, **Settings**, **Audit log** |

On a narrow window the menu is hidden. Select the menu button at the top left to open it.

### Overview

**Overview** is the home page. It shows headline figures (**Open tickets**, **SLA compliance**, **Open actions**, **Overdue actions**, **Actions with no owner**) and panels such as **Open tickets by priority**, **Top risks**, **Contracts approaching notice** and **Projects by status**. Each figure and panel links to the list behind it. Panels for areas you cannot see are left out.

### Global search

The **Search all records** box at the top searches every kind of record you are allowed to see.

1. Select the box, or press `/` (when you are not typing in a field) or `Ctrl+K` from anywhere.
2. Type at least two characters. Results appear as you type, each with its record type and reference.
3. Select a result, or use the up and down arrow keys and press `Enter`.

Search matches any part of a word or reference. It does not understand misspellings or similar words.

### Create button

The **Create** button at the top right lists everything you are allowed to create, in alphabetical order, for example **Ticket**, **Asset**, **Contract** or **Risk**. Choosing an item opens the form for a new record of that kind.

### Theme toggle

The sun or moon button at the top right switches between the light and dark themes.

### User menu

The button showing your name at the top right opens a menu with **Change password** and **Sign out**.

## How every list works

Tickets, assets, vendors, risks and most other records are shown in lists that all behave the same way.

### Search

Type in the **Search** box above the list. The list updates as you type. Search looks in the main text fields of that kind of record and in its reference.

### Filters

Beside the search box are filters for that list. There are four kinds:

- **Choice filters** such as **Status**: tick one or more values. The list shows records that match any ticked value.
- **Yes or no filters** such as **Major incident**: choose yes, no or any.
- **Person and record filters** such as **Assignee** or **Vendor**: start typing a name and choose from the matches.
- **Date filters**: each has an **after** box and a **before** box.

Select **Clear** to remove the search, all filters and the sort order in one step.

### Sort

Select a column heading to sort by that column. Select it again to reverse the order. An arrow shows the column and direction in use. A few columns cannot be sorted and have no button.

### Saved views

A saved view remembers the current search, filters and sort order.

1. Set up the list the way you want it.
2. Select **Views**, then **Save current view…**.
3. Type a **View name** and select **Save view**.

To use a view, select **Views** and choose it. The button then shows the view's name. To remove it, choose the view and then select **Delete view** in the same menu.

Saved views are kept in your browser only. They are not shared with colleagues and do not follow you to another computer or browser.

### CSV export

Select **Export CSV** to download the list as a file that opens in a spreadsheet. The file holds every record that matches your current search and filters (not only the page on screen, up to 50,000 rows) and every field of each record (not only the columns shown). The button appears only if your role allows exporting that kind of record.

### Paging

Lists show 25 records per page unless stated otherwise. The foot of the list shows which records you are looking at, for example "1–25 of 140", with buttons for the previous and next page.

### Opening and creating records

- Select a row, or the reference or title in it, to open the record. With the keyboard, move to the row and press `Enter`.
- Select the **New** button above the list (for example **New problem**) to create a record. Fill in the form and select the **Create** button at the bottom. Fields marked as required must be filled in. The new record then opens.

## How every record page works

Opening a record shows its page. The top of the page has the title, the reference (for example `TKT-00042`), coloured chips for status and similar values, and buttons for the things you can do to that record. A trail of links above the title takes you back to the list.

### Summary and editing

Below the header is a **Details** card showing the main fields. Some records have further cards or tabs for other groups of fields.

1. Select **Edit** on the card.
2. Change the fields you need.
3. Select **Save changes**, or **Cancel** to leave the record as it was.

If a value is not allowed, the message appears beside the field. **Edit** is shown only if your role allows editing that kind of record. Some fields are worked out by the application and cannot be typed in; they appear greyed out in the form.

### Activity and comments

The **Activity** tab shows comments and changes together, newest first.

1. Type in **Add a comment**.
2. Leave **Internal note** ticked for a note meant for staff only. Untick it to mark the comment as a **Public comment**.
3. Select **Add comment**.

Comments cannot be edited or removed afterwards.

### Related links

The **Related** tab links a record to any other record, for example a ticket to a risk.

1. Choose the **Record type**.
2. In **Record**, start typing and choose the record.
3. Check the **Relation** (it starts as "related to").
4. Select **Add link**.

The link appears on both records. On the other record it is marked "(linked from that record)". To remove a link, select the bin button beside it and confirm with **Remove link**. Removing a link never deletes either record.

### History

The **History** tab is the audit trail of the record: each change, who made it, when, and the old and new values. Where a field holds a person or another record, the history shows "set" rather than the name. Changes made by the application itself are shown as "System".

## The pilot-mode banner

While the application is in pilot mode, a banner appears at the top of every page:

"Pilot mode: use seed and test data only. Do not record live incident details, health information or card data."

The banner is there so nobody mistakes a trial installation for the system of record. Follow it: enter only sample or test information until your administrator switches pilot mode off under **Administration**, **Settings**. See [Administration](09-administration.md).

## Where to get help

- This guide is shown in the application's Help section. The same pages are in the `docs/user` folder of the installation.
- For a forgotten password, a locked account or a lost second factor, ask an administrator. They can give you a new one-time link or reset your second factor.
- If you cannot see a menu item or button that this guide describes, your role does not include it. Ask an administrator.
- If a page fails to load, select **Try again** on the message. If it keeps failing, tell whoever looks after the installation.

## Not available yet

- Signing in with your organisation's single sign-on, or with a passkey. Accounts are local to the application.
- Menu entries for the **Account security** page and for signing in with a recovery code on a separate page. Use the steps above.
- Notifications, in the application or by email. Nothing is sent to you when a record changes.
- Attachments on records.
- Tags, watchers, custom fields and editing several records at once.
- Deleting a record from its page.
- Saved views that are shared with other people or kept on the server.
- Export to spreadsheet formats other than CSV.
- A self-service portal for people outside the IT team.
