# Attachments and notifications

This page covers two things that work the same way everywhere in the application: files attached to records, and the notifications that tell you something needs your attention. Lists and record pages work as described in [Getting started](01-getting-started.md).

## Attachments

Any record can hold files: a signed contract on a contract record, a screenshot on a ticket, a test report on a framework outcome. The files are kept on the server beside the database, not inside it.

### Who can see and change files

Files follow the record they are attached to.

| You can | If |
|---|---|
| See the list of files and download them | You can open the record |
| Attach, edit the details of, and remove files | Your role allows editing that kind of record |

If you cannot open a record, you cannot see its files or find out that it has any. This includes restricted records such as risks and security incidents: without the right role, their files do not appear anywhere, including the **Expiring evidence files** page.

### Attach a file

1. Open the record and select the **Attachments** tab.
2. Drag one or more files from your computer onto the box marked **Drag files here**, or select **Choose files** and pick them.
3. A progress bar shows each file as it is sent. When it finishes, the file appears in the list and the message "File attached." is shown.

The number beside the **Attachments** tab's name is how many files the record holds. It changes as soon as a file is attached or removed.

The line under the box tells you the largest file allowed and which types are accepted. Your administrator sets both; a new installation allows 25 MB for each file.

### When a file is refused

A file that cannot be accepted is listed in a red box under the upload area with the reason. Nothing is stored. Select the cross to dismiss the message.

| Message | What it means | What to do |
|---|---|---|
| "Files of type … cannot be attached." | The file's type is not on the list of allowed types | Convert it to an allowed type such as PDF, or ask an administrator whether the type can be allowed |
| "… The limit is … for each file." | The file is too large | Reduce the file, split it, or ask an administrator about the limit |
| "… is empty." | The file has no content | Check that you picked the right file |
| "The content of this file is not what its name says" | The file's content does not match its extension, for example a web page renamed to end in `.pdf` | Save the file again in the right format from the program that made it |
| "This file is a program or script. Programs cannot be attached." | Programs and scripts are never accepted, whatever they are called | Do not attach it. If you need to share a tool, record where it is kept instead |
| "This file was refused by the malware scanner." | A scanner installed by your administrator found a problem with the file | Do not try again. Tell whoever looks after security |

### The list of files

Each file is shown with an icon for its kind, its name, its size, who attached it and when. If it has a description, that appears under the name.

- Select the file's name, or the download button on its row, to download it. Files always download; they never open inside the application.
- Select the pencil button to edit its details.
- Select the bin button to remove it.

The pencil and bin buttons appear only if your role allows editing the record.

### Edit a file's details

1. Select the pencil button on the file's row.
2. Type a **Description**: what the file is and why it is attached.
3. Tick **This file is evidence** if it is evidence (see [Evidence files](#evidence-files)), and set the dates.
4. Select **Save changes**.

The same window shows the file's **Size**, when and by whom it was **Attached**, the result of the **Malware scan**, and its **Checksum (SHA-256)**. The checksum is a fingerprint of the file's content. The application checks it every time the file is downloaded, and refuses to send a file whose content has changed since it was attached.

**Malware scan** shows **Not scanned** unless your administrator has installed a scanner. Treat a file marked **Not scanned** as you would any file from the same source.

You cannot rename a file or replace its content. To replace a file, attach the new one and remove the old one.

### Remove a file

1. Select the bin button on the file's row.
2. Read the confirmation and select **Remove file**.

The file disappears from the list and can no longer be downloaded. The removal is kept in the record's history, with the file's name and checksum.

### What is recorded in the history

The record's **History** tab shows each file attached, each change to a file's details, each file removed and each file refused, with who did it and when. Downloading a file from a restricted record is recorded too.

## Evidence files

Evidence is a file that shows something was done or was true on a date: a signed approval, a test result, a certificate. Evidence has two dates of its own.

| Date | Meaning |
|---|---|
| **Collected on** | The date the evidence was produced or gathered. It cannot be in the future. If you leave it empty when attaching, today's date is used |
| **Expires on** | Optional. The date after which the evidence is too old to rely on and a newer copy is needed. It cannot be before the collection date |

### Attach evidence

On pages whose **Attachments** tab is set up for evidence, a box under the upload area offers **Record new files as evidence**, ticked to begin with.

1. Check the **Collected on** date, and enter **Expires on** if the evidence goes out of date.
2. Drag the files in, or select **Choose files**. Every file you add takes those dates.

On any other record, attach the file first, then select the pencil button, tick **This file is evidence** and set the dates.

### How evidence is shown

An evidence file has an **Evidence** badge and its collection date in the list, and a coloured chip for its expiry:

| Chip | Meaning |
|---|---|
| Red, "Expired … days ago" or "Expires today" | The evidence is out of date |
| Orange, "Expires in … days" | It expires within 30 days |
| Amber, "Expires in … days" | It expires within 90 days |
| Green, "Expires" and a date | It expires later than that |
| Grey, **No expiry date** | No expiry date was given |

### Expiring evidence files

Open **Expiring evidence files** in the **Reports** group. The page lists every evidence file, on any record you can open, that has already expired or will expire within the period you choose.

1. Choose a period in **Show evidence expiring in**, from **Next 30 days** to **Next 365 days**. It starts at **Next 90 days**.
2. The two tiles show how many files have **Already expired** and how many are expiring in the period.
3. The table lists the files, soonest first, with the record each one is **Attached to**, the dates and a status chip.
4. Select a file's name to download it, or the record's name to open the record and attach a current copy.

This page is separate from **Expiring evidence** in the **Vendors** group, which lists vendor evidence records; see [Vendors and contracts](04-vendors-and-contracts.md).

## File settings

Administrators set the limits. Open **File settings** in the **Administration** group.

| Setting | Meaning |
|---|---|
| **Largest file (MB)** | The largest size allowed for one file, from 1 to 2048 megabytes. A new installation uses 25 |
| **Allowed file types** | The file extensions that are accepted, separated by commas, for example `pdf, docx, png` |

Select **Save settings**. The new limits apply to files attached from then on; files already attached are not affected. Changes to these settings are kept in the audit log.

- A file is checked twice: its extension must be on the list, and its content must be what that extension says. For a type the application does not recognise, only the extension is checked.
- Programs and scripts (for example `.exe`, `.bat`, `.ps1`, `.js` and documents with macros such as `.docm`) cannot be added to the list.
- Web pages and vector images (`.html`, `.svg`) are not on the list to begin with. If you add them, they are still only ever downloaded, never shown in the browser.
- The page also says whether a malware scanner is installed. None is supplied with the application.

## Notifications

A notification is a short message telling you that something needs your attention: an action you own is overdue, a ticket assigned to you is close to its target time. Notifications are shown inside the application only.

### The bell

The bell at the top right of every page shows a red number when you have unread notifications.

1. Select the bell. A list of your eight most recent notifications opens, newest first.
2. Unread notifications are in bold with a dot beside them. Each one shows a coloured chip for its kind and how long ago it arrived.
3. Select a notification to open the record it is about. It is marked as read.
4. Select **Mark all as read** to clear the number without opening anything.
5. Select **See all notifications** for the full list, or **Preferences** to choose what you are told about.

The number is checked about once a minute while you are using the application. It is not checked while the application is in a background tab or when you have not touched it for five minutes, so a notification can take a moment to appear when you come back.

### The notifications page

Open **Notifications** in the menu on the left, under **Overview**.

| Tab | Shows |
|---|---|
| **All** | Every notification you have received, newest first, 20 to a page. Use **Newer** and **Older** to move between pages |
| **Unread** | Only those you have not read, with the count on the tab |
| **Preferences** | Your choices; see below |

Select a notification to open its record and mark it as read. Select **Mark all as read** at the top of the page to mark everything as read.

Notifications are not deleted in this version; read ones stay in the **All** tab.

### What you are told about

| Kind | Examples |
|---|---|
| **Assigned to me** | Work that has been given to you |
| **Approvals** | Something is waiting for your decision |
| **Due dates** | An action you own is overdue or is due within three days |
| **Service-level targets** | A ticket assigned to you is within four hours of its resolution target |
| **Reminders** | Dates set on records, such as contract notice dates |
| **Acknowledgements** | You have been asked to read and acknowledge something |
| **Notification clocks** | A deadline to notify someone outside the organisation is close or has passed |
| **Other** | Anything that does not fit the kinds above |

In this version the application raises two of these by itself, once a day for each record: **Due dates** for the owners of actions, and **Service-level targets** for the assignees of tickets. Paused and resolved tickets, and actions that are done or cancelled, are left out. The other kinds appear as each part of the application starts sending them.

### Records you watch

Select **Watch** at the top of a record page to be told when that record's status changes or someone comments on it. You are not told about your own changes, and you stop being told if you lose access to the record. Select **Watching** to stop. The records you watch are listed under **Watching** on the Overview.

### Notifications and restricted records

You are never sent a notification about a record you are not allowed to open. If a record is restricted, or your role changes, after a notification was sent, the notification changes to "A record you can no longer open" and no longer names the record or links to it.

### Preferences

1. Open **Notifications** and select the **Preferences** tab, or select **Preferences** at the foot of the bell's list.
2. Under **What to tell me about**, untick any kind you do not want. Each row shows **On** or **Off**.
3. Changes are saved as you make them.

Switching a kind off stops new notifications of that kind from then on. It does not remove ones you already have, and it does not change anything on the records themselves: an overdue action is still overdue.

Under **Email**, the box **Send me one summary a day instead of a message for each notification** is kept for later. Email delivery is not set up in this version, so ticking it changes nothing yet.

## Not available yet

- Notifications by email. The application makes no outside connections, so nothing is sent to your inbox.
- Notifications when a record you follow changes, or when someone comments on your record.
- Deleting notifications, or clearing old ones automatically.
- A malware scanner. The application has a place to connect one, but none is supplied, and files are marked **Not scanned**.
- Viewing a file inside the application. Files are downloaded and opened on your computer.
- Renaming a file, replacing its content while keeping its history, or keeping several versions of one file.
- Recovering a removed file from the application. An administrator can find it in the data folder while it is still kept there.
- Storing files anywhere other than the server's own data folder.
- Searching inside the content of attached files.
