# Attachments and notifications

This page covers two things that work the same way everywhere in the application: files attached to records, and the notifications that tell you something needs your attention. Lists and record pages work as described in [Getting started](01-getting-started.md).

## Attachments

Any record can hold files: a signed contract on a contract record, a screenshot on a ticket, a test report on a framework outcome. The files are kept outside the database: on the server's disk, or in an object store if your administrator has set one up.

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
| "This file was refused by the malware scanner." | The malware scanner your administrator switched on found malware in the file | Do not try again. Tell whoever looks after security |
| "The file could not be checked for malware, so it was not accepted. Try again later." | The scanner could not be reached, and your administrator has chosen to refuse files it cannot check | Try again later; tell an administrator if it goes on |

If the scanner cannot be reached and your administrator has chosen to accept files anyway, the file is attached and marked **Not scanned**, and a message says: "The malware scanner could not be reached, so one file was accepted without a scan and marked "Not scanned"."

### The list of files

Each file is shown with an icon for its kind, its name, its size, who attached it and when. If it has a description, that appears under the name.

- Select the file's name, or the download button on its row, to download it. Files always download; they never open inside the application.
- Select the pencil button to edit its details.
- Select the trash button to remove it.

The pencil and trash buttons appear only if your role allows editing the record.

### Edit a file's details

1. Select the pencil button on the file's row.
2. Type a **Description**: what the file is and why it is attached.
3. Check **This file is evidence** if it is evidence (see [Evidence files](#evidence-files)), and set the dates.
4. Select **Save changes**.

The same window shows the file's **Size**, when and by whom it was **Attached**, the result of the **Malware scan**, and its **Checksum (SHA-256)**. The checksum is a fingerprint of the file's content. The application checks it every time the file is downloaded, and refuses to send a file whose content has changed since it was attached.

**Malware scan** shows **Not scanned** when no scanner checked the file: scanning was off when it was attached, or the scanner could not be reached. Treat such a file as you would any file from the same source. An administrator can have earlier files scanned later; one found to contain malware is removed.

You cannot rename a file or replace its content. To replace a file, attach the new one and remove the old one.

### Remove a file

1. Select the trash button on the file's row.
2. Read the confirmation and select **Remove file**.

The file disappears from the list and can no longer be downloaded. The removal is kept in the record's history, with the file's name and checksum. The file itself is kept for a while (30 days unless your administrator has changed it), so an administrator can put it back if it was removed by mistake; after that it is deleted for good.

### What is recorded in the history

The record's **History** tab shows each file attached, each change to a file's details, each file removed and each file refused, with who did it and when. Downloading a file from a restricted record is recorded too.

## Evidence files

Evidence is a file that shows something was done or was true on a date: a signed approval, a test result, a certificate. Evidence has two dates of its own.

| Date | Meaning |
|---|---|
| **Collected on** | The date the evidence was produced or gathered. It cannot be in the future. If you leave it empty when attaching, today's date is used |
| **Expires on** | Optional. The date after which the evidence is too old to rely on and a newer copy is needed. It cannot be before the collection date |

### Attach evidence

On pages whose **Attachments** tab is set up for evidence, a box under the upload area offers **Record new files as evidence**, checked to begin with.

1. Check the **Collected on** date, and enter **Expires on** if the evidence goes out of date.
2. Drag the files in, or select **Choose files**. Every file you add takes those dates.

On any other record, attach the file first, then select the pencil button, check **This file is evidence** and set the dates.

### How evidence is shown

An evidence file has an **Evidence** badge and its collection date in the list, and a colored chip for its expiry:

| Chip | Meaning |
|---|---|
| Red, "Expired … days ago" or "Expires today" | The evidence is out of date |
| Orange, "Expires in … days" | It expires within 30 days |
| Amber, "Expires in … days" | It expires within 90 days |
| Green, "Expires" and a date | It expires later than that |
| Gray, **No expiry date** | No expiry date was given |

### Expiring evidence files

Open **Expiring evidence files** in the **Reports** group. The page lists every evidence file, on any record you can open, that has already expired or will expire within the period you choose.

1. Choose a period in **Show evidence expiring in**, from **Next 30 days** to **Next 365 days**. It starts at **Next 90 days**.
2. The two tiles show how many files have **Already expired** and how many are expiring in the period.
3. The table lists the files, soonest first, with the record each one is **Attached to**, the dates and a status chip.
4. Select a file's name to download it, or the record's name to open the record and attach a current copy.

This page is separate from **Expiring evidence** in the **Vendors** group, which lists vendor evidence records; see [Vendors and contracts](04-vendors-and-contracts.md).

## File settings

*Administrators.* Open **File settings** in the **Administration** group. Four tiles at the top show the **Files in use**, the files **Removed, waiting to be purged**, how many are **Not scanned for malware**, and where **New files go to**, each with its size. Below them are four tabs. Changes on the **Malware scanning**, **Storage** and **Removed files** tabs ask you to confirm your password if you have not done so in the last few minutes. Every change is kept in the audit log.

### Uploads

| Setting | Meaning |
|---|---|
| **Largest file (MB)** | The largest size allowed for one file, from 1 to 2048 megabytes. A new installation uses 25 |
| **Allowed file types** | The file extensions that are accepted, separated by commas, for example `pdf, docx, png` |

Select **Save upload limits**. The new limits apply to files attached from then on; files already attached are not affected.

- A file is checked twice: its extension must be on the list, and its content must be what that extension says. For a type the application does not recognize, only the extension is checked.
- Programs and scripts (for example `.exe`, `.bat`, `.ps1`, `.js` and documents with macros such as `.docm`) cannot be added to the list.
- Web pages and vector images (`.html`, `.svg`) are not on the list to begin with. If you add them, they are still only ever downloaded, never shown in the browser.

### Malware scanning

The application can send every new file to ClamAV, a free malware scanner, before accepting it. It is **off** until you switch it on. ClamAV's scanning service (`clamd`) must be installed and listening on a TCP port; run it on the same machine or one you control, because each file's content is sent to it.

| Setting | Meaning |
|---|---|
| **Scan every new file with ClamAV** | On or off |
| **Scanner address** and **Port** | Where `clamd` listens: usually `127.0.0.1` and `3310` |
| **Time limit (seconds)** | How long one file may take, from connecting to the verdict (60 to begin with) |
| **Largest file to scan (MB)** | Larger files are not sent (100 to begin with). Keep `clamd`'s own `StreamMaxLength` at least this large |
| **When the scanner cannot check a file** | **Accept it as "Not scanned" and warn the uploader** (the starting choice), or **Refuse it, and ask the uploader to try again later**. This covers a stopped or busy scanner and a file over its limit |

Select **Test connection** to ask the scanner for its version: the page shows the engine, the signatures version and their date. Select **Save scanning settings** to apply the settings.

- A file found to contain malware is refused and its content deleted; the refusal, with the name of what was found, is kept in the audit log.
- A file accepted without a scan is marked **Not scanned**, and the audit log says why.
- **Files attached without a scan** shows how many files in use were never scanned. Select **Scan files attached earlier** to scan them, up to 200 at a time (select it again for more). A file found to contain malware is removed at once, its content deleted, and every administrator is notified; the audit log names the file and its record (action `attachment.quarantine`).

### Storage

New files are kept on the server's disk, in the data folder, unless you choose an S3-compatible object store. The object store is an outbound connection, used only when chosen here (and by backups you send there).

1. Under **Store new files on**, choose **An S3-compatible object store**.
2. Fill in **Object store connection**:

   | Field | What to enter |
   |---|---|
   | **Endpoint** | The service address, without the bucket, for example `https://s3.example.net` |
   | **Region** and **Bucket** | As your provider gave them |
   | **Prefix** | Optional: a folder inside the bucket, such as `grc/` |
   | **Path-style addresses** | Checked (the starting choice) for most self-hosted stores; clear it for addresses of the form `bucket.endpoint` |
   | **Server-side encryption** | **Store default**, **AES256** (keys managed by the store) or **aws:kms** with an optional **Key ID** |
   | **Credentials** | **Entered here** (the **Secret key** is stored encrypted and never shown again; leave it empty to keep the saved one), **A credentials file on the server** (a JSON file with `accessKeyId` and `secretAccessKey`), or **The server's environment** (`GRC_S3_ACCESS_KEY_ID` and `GRC_S3_SECRET_ACCESS_KEY`) |

3. Select **Test connection**: a small test file is written, read back and deleted. Then select **Save storage settings**. The settings are tested again before they are saved, and nothing changes if the test fails.

Files already stored stay where they are and can still be downloaded. To move them all to the other store, the person running the server stops it and runs `.\grc.ps1 move-files -To s3` (or `-To disk`): each file is copied, read back and checked against its checksum before the old copy is deleted.

**Storage check** compares the stored files with the records of attached files. Select **Check storage**: the page lists files missing from storage and stored files that no record refers to. Nothing is changed.

### Removed files

A removed file is kept in storage for the period you set, so it can be put back, and is then deleted for good by a daily job.

1. Set **Keep removed files for (days)**: 30 to begin with, 0 to keep them indefinitely. Select **Save**.
2. **Purge now** deletes at once the files that are already past the period, rather than waiting for the daily job.
3. The **Removed files** table lists each removed file with its **Record**, **Why** it was removed (**Removed by a person**, **Record deleted**), when, and the date it will be purged. Select **Put back** to return a file to its record.

Records themselves are never deleted by this. A record past its retention period goes to the retention review (see the administration guide); only when a record is deleted for good there are its files marked **Record deleted**, and they then follow the same period. Such files cannot be put back. Files of a record that is only removed (and can still be restored) are kept. Every purge and every file put back is recorded in the audit log.

Removed files of restricted records are listed only for administrators who may see restricted records.

## Backups

*Administrators.* Open **Backups** in the **Administration** group. The application takes a copy of everything while it keeps running, writes it to a second location, reads it back from there and checks every file in it.

The tiles show the **Last good backup** (red when there is none or it is more than two days old), the **Schedule**, where backups **Go to**, and whether **Encryption** is on and with which key.

### Schedule and destination

1. Switch on **Take a backup every day**, and choose the **Time of day** (in the organization's time zone; choose a quiet time, as the application pauses for a few seconds while the database is read).
2. Set **Backups to keep**: the newest ones at the destination are kept and older ones are deleted after each good backup (14 to begin with).
3. Under **Write backups to**, choose **A folder (another disk, or a network share)** and enter the full **Folder** path, for example `D:\Backups\Sandpiper` or `\\fileserver\backups\sandpiper`, or choose the object store set up on the **File settings** page and a **Prefix in the object store**. A folder inside the data folder is refused.
4. Switch on **Encrypt each backup** if the server has a backup key (the page says which; the person running the server sets it, see the operations guide). Keep a copy of that key somewhere safe and separate: without it the backups cannot be read.
5. **Include the application's secret key** (encrypted backups only) also puts the key that protects second-factor keys and webhook secrets into each backup, so a restore puts it back too. With it off, that key is not in backups and must be kept separately; the page says where it is.
6. Select **Save backup settings**. You may be asked to confirm your password.

Select **Back up now** at any time. **Recent backups** lists the last 20 with their start time, result (**Checked**, **Failed** or **Running**), file name, size, whether they were taken **Daily** or by a person, and whether they are encrypted. A failed backup shows why.

If a backup fails, or none has succeeded for two days, every administrator is notified, and the reason is kept in the audit log. A backup that was running when the server stopped is shown as **Failed** with "Interrupted".

Files kept in the object store are not in these backups: use the store's own versioning. To restore a backup, the person running the server stops it and runs `.\grc.ps1 restore <file>`; see the operations guide.

## Notifications

A notification is a short message telling you that something needs your attention: an action you own is overdue, a ticket assigned to you is close to its target time. Notifications are shown inside the application, under the bell. When an administrator has switched email on, you can also choose to receive them by email, one at a time or as one summary a day.

### The bell

The bell at the top right of every page shows a red number when you have unread notifications.

1. Select the bell. A list of your eight most recent notifications opens, newest first.
2. Unread notifications are in bold with a dot beside them. Each one shows a colored chip for its kind and how long ago it arrived.
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
| **Acknowledgments** | You have been asked to read and acknowledge something |
| **Notification clocks** | A deadline to notify someone outside the organization is close or has passed |
| **Records I watch** | A record you watch has changed status or has a new comment |
| **Other** | Anything that does not fit the kinds above |

Other parts of the application may add kinds of their own, and an administrator can add more under **Lists** (the list `notification_kind`). They appear in everyone's preferences.

In this version the application raises two of these by itself, once a day for each record: **Due dates** for the owners of actions, and **Service-level targets** for the assignees of tickets. Paused and resolved tickets, and actions that are done or canceled, are left out. The other kinds appear as each part of the application starts sending them.

### Records you watch

Select **Watch** at the top of a record page to be told when that record's status changes or someone comments on it. You are not told about your own changes, and you stop being told if you lose access to the record. Select **Watching** to stop. The records you watch are listed under **Watching** on the Overview.

### Notifications and restricted records

You are never sent a notification about a record you are not allowed to open. If a record is restricted, or your role changes, after a notification was sent, the notification changes to "A record you can no longer open" and no longer names the record or links to it.

### Preferences

1. Open **Notifications** and select the **Preferences** tab, or select **Preferences** at the foot of the bell's list.
2. Under **How to tell me**, choose for each kind:

   | Choice | What happens |
   |---|---|
   | **Bell** | Shown under the bell and on the notifications page (the starting choice for every kind) |
   | **Email** | Sent to you by email only; it does not appear under the bell |
   | **Both** | Shown under the bell and sent by email |
   | **Off** | Not sent at all |

3. Changes are saved as you make them.

Switching a kind off stops new notifications of that kind from then on. It does not remove ones you already have, and it does not change anything on the records themselves: an overdue action is still overdue.

If email is not switched on in your installation, the page says so, and anything set to **Email** or **Both** comes to the bell instead, so nothing is lost.

### Notifications by email

Messages go to the email address on your account, shown under **Email** on the **Preferences** tab. Only an administrator can change it.

- **One message for each notification.** Each email has the notification's title and text, a link that opens the record in the application, and a link to your preferences.
- **One summary a day.** Check **Send me one summary a day instead of a message for each notification**. Notifications you get by email then wait, and once a day (from the hour your administrator has set, 07:00 unless changed) you receive one message listing them, each with its link. Nothing is sent on a day with nothing new. The bell is not affected: it always shows notifications as they happen.

**Restricted records are never described in an email.** If a notification is about a restricted record, such as a security incident, the email says only "You have a new security notification — open the application to view it" and links to your notifications page; in the daily summary it is listed the same way, without its title. Whether you may still see a record is checked again when the email is sent: if you have lost access in the meantime, nothing is sent about it.

### Forgot your password?

If email is switched on, you can ask for a link to set a new password yourself.

1. Open the address `/forgot-password` (for example `https://grc.example.org/forgot-password`), or follow the **Forgot your password?** link where your sign-in page has one.
2. Enter your username or the email address on your account, and select **Email me a link**.
3. The page always answers the same way, whether or not the account exists: "If that matches an account with an email address, a link to set a new password is on its way."
4. Open the link in the email. It works once and expires after an hour (or the time your administrator has set). Choose your new password; your other sessions are signed out.

Requests are limited: five from one place in 15 minutes, and at most three links an hour for one account. Asking again replaces the link you asked for before. If email is not switched on, the page says so and asks you to contact an administrator, who can still give you a link by hand.

## Email settings

*Administrators.* Open **Administration** > **Email**. Email is **off** until you switch it on: it is the one connection the application makes to another server, and nothing is sent while it is off.

### Settings

1. Under **Mail server**, enter the details your mail service gave you:

   | Field | What to enter |
   |---|---|
   | **Mail server** | The host name or address, such as `smtp.example.org` |
   | **Port** | Usually 587 for STARTTLS or 465 for TLS |
   | **Secure connection** | **STARTTLS (port 587)**, **TLS (port 465)**, or **None (plain connection)**. Use None only for a mail relay on your own network |
   | **User name** and **Password** | Leave empty if the server does not ask for a sign-in. The password is kept encrypted and is never shown again; leave the box empty to keep the saved one, or check **Remove the saved password** |
   | **From address** and **From name** | Who messages come from |
   | **Reply-to address** | Optional: where replies go, such as the service desk |
   | **Application address** | The address people use to open the application, such as `https://grc.example.org`. Links in messages start with it |

2. Select **Save settings**. You may be asked to confirm your password.
3. Under **Send test email**, check the address and select **Send test email**. The test is sent at once with the saved settings, even while email is off, and the page says whether it was sent or why not.
4. Switch **Send email** on. The mail server, from address and application address must be filled in first.

Switching email off stops everything at once: messages still waiting are not sent, and notifications go to the bell. Every change is recorded in the audit log, without the password.

When email is on:

- people who chose email for a kind of notification receive it, one at a time or as a daily summary;
- the set-up link for a new user, and any set-up or reset link you issue on a user's page, is also emailed to that person. You are still shown the link, as before;
- anyone can ask for their own reset link on the **Forgot your password?** page.

### Templates

The **Templates** tab lists each kind of message: **Test message**, **Notification**, **Security notification**, **Daily summary**, **Account set-up link**, **Password reset link** and **General message** (used by other parts of the application, such as scheduled reports).

1. Select a template. The placeholders it accepts are listed above the fields, for example `{{title}}` or `{{link}}`.
2. Change the **Subject**, the **Plain-text body** and, if you like, the **HTML body**. The HTML body may use only simple tags (p, br, strong, em, ul, ol, li, h1 to h3, hr, blockquote and a), and links may point only at `{{link}}`, `{{preferencesLink}}`, an `https:` address or a `mailto:` address. Leave it empty to build it from the plain text. Values put into the HTML are always escaped.
3. Select **Preview** to see the message with sample values, then **Save template**.

A template you have changed shows **Changed here**; **Put back the default** restores the original. The **Security notification** template may not contain the title or text of the notification.

### Delivery log

The **Delivery log** tab lists every message the application tried to send, newest first: when, to whom, the subject, what kind of message it was, and its status.

| Status | Meaning |
|---|---|
| **Waiting** | Queued, not tried yet |
| **Sent** | The mail server accepted it |
| **Failed, will retry** | The last try did not work (the error is shown); it is tried again later |
| **Gave up** | It failed too often, or the server refused it for good (for example a wrong password). Open its **job** to try again |
| **Not sent** | There was nothing to send: the person has no address, is no longer active, or can no longer see the record |

A message that fails is tried up to five times, waiting 1, 2, 4 and 8 minutes in between.

## Background jobs

*Administrators.* Open **Administration** > **Background jobs** to see the work the application does by itself: sending email, the daily reminders (actions due, tickets near their target) and the daily email summaries.

- The tiles count jobs that are **Waiting**, **Running**, **Failed, will retry**, **Gave up** and **Done**. Finished jobs are kept for 30 days and jobs that gave up for 90.
- **Schedules** lists the regular work, how often it runs, when it last ran and when it runs next. **Run now** runs one straight away.
- **Recent jobs** lists jobs newest first; choose a **Status** to narrow it. Select a job to see its details, its last error and its result. For a job that failed or gave up, **Try again now** runs it again at once, with its attempts counted from nothing.

Each job runs once even if more than one copy of the server is using the same database. If the server stops in the middle of a job, the job is picked up again a few minutes after the server starts.

## Not available yet

- Changing the email address on your own account: ask an administrator.
- Sending email through anything other than a mail server (SMTP), such as a mail service's web interface.
- Deleting notifications, or clearing old ones automatically.
- Malware scanners other than ClamAV, or scanning through an outside service.
- Viewing a file inside the application. Files are downloaded and opened on your computer.
- Renaming a file, replacing its content while keeping its history, or keeping several versions of one file.
- Moving files between the disk and the object store from the **File settings** page: it is a command for the person running the server.
- Restoring a backup from the **Backups** page: it is a command for the person running the server.
- Searching inside the content of attached files.
