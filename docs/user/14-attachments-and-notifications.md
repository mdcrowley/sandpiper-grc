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

If you cannot open a record, you cannot see its files or find out that it has any. This includes restricted records such as risks and security incidents: without the right role, their files do not appear anywhere, including the **Expiring evidence** page.

### Attach a file

1. Open the record and select the **Attachments** tab.
2. Drag one or more files from your computer onto the box marked **Drag files here**, or select **Choose files** and pick them.
3. A progress bar shows each file as it is sent. When it finishes, the file appears in the list and the message "File attached." is shown.

The number beside the **Attachments** tab's name is how many files the record holds. It changes as soon as a file is attached or removed.

The line under the box tells you the largest file allowed and which types are accepted. Your administrator sets both; a new installation allows 25 MB for each file.

### Large files and files sent in parts

A file can also be sent in **parts** of at most 1 MB each, for example by an AI assistant loading documents ([AI assistants and MCP](21-ai-assistants-and-mcp.md#loading-a-document-package)) or for a document package import. The parts may arrive in any order and a part can be sent again. When the last part is in, the parts are joined and the whole file is checked exactly like a file you drop on the box: its type, its size against the limit, its content against its name, the malware scanner, and its fingerprint (SHA-256) against the one the sender gave. A file that fails any check is not kept.

A finished upload belongs to the person who sent it, no one else can see or use it, and it is attached to a record only once, under that record's usual rules (you must be able to change the record's files). Uploads that are not finished, or not attached, within 24 hours are removed with their parts.

### Pictures in converted Word documents

When a Word file (`.docx`) is converted into a document's text ([Documents and exceptions](11-policies-and-exceptions.md)), each picture in it is stored as a file on the document, described as "Image N from" and the file's name, and shown in the text where it was. Pictures follow the document: someone who may not read the document cannot see them. Pictures in formats a browser cannot show (Windows metafiles, for example) are left out and the conversion report says so.

### Link a document instead of attaching it

When a document lives in your organization's document store, you can link it rather than upload a copy, so the record always points at the current version.

1. Open the record and select the **Attachments** (or **Evidence files**) tab.
2. Select **Add link**.
3. Enter the **Address**: the full web address of the document, starting with `https://` (or `http://`), up to 1,000 characters. Use a link that does not expire. An address with a user name or password in it is refused; people sign in to the document store themselves.
4. Optionally give a **Title** (left empty, the last part of the address is used) and a **Description**.
5. Check **This link is evidence** if it is evidence, and set the dates as for an evidence file.
6. Select **Add link**.

A link is listed with the files, with a link icon, a **Link** badge and the site it points to. Selecting its name opens the document in a new tab; nothing is downloaded. The application never opens the address itself: it does not check that the document exists, read it or make a copy, and the document store sees nothing of the page you came from. Who can see and change a link follows the record, as for files.

A link has a date it was **last checked**: when someone confirmed the document is still there and current. Adding a link counts as checking it. The chip beside it shows **Checked today**, **Checked** and the date, or, once 90 days have passed (your administrator can change the period under **Administration > Reminders**), an orange **Check due** chip. To record a check, open the document, make sure it is still the right one, then select the check-mark button on the link's row. The record's owner (or whoever added the link, on a record with no owner) gets a **Reminders** notification once when a link becomes due for a check; recording a check starts the period again.

To change a link's address or title, select the pencil button. Removing a link removes it from the record only; the document stays where it is. A link on a record under a legal hold cannot be removed, like a file. When a record is anonymized at the end of its retention period, its links' addresses and titles are removed with its files.

The record's history shows each link added, changed, checked and removed. It keeps the site of the address and a short fingerprint of it, never the whole address, because sharing addresses often carry their own secret.

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

Each file is shown with an icon for its kind, its name, its size, who attached it and when. If it has a description, that appears under the name. **Text searchable** after the date means search finds the record by the words inside the file (see [Finding a record by what its files say](#finding-a-record-by-what-its-files-say)).

- Select the file's name, or the download button on its row, to download it.
- For an image (PNG, JPEG, GIF, WebP or BMP) or a PDF, select the eye button to preview it without downloading (see [Preview a file](#preview-a-file)).
- Select the pencil button to edit its details.
- Select the trash button to remove it.

The pencil and trash buttons appear only if your role allows editing the record.

### Preview a file

Images and PDFs can be looked at in the application without downloading them.

1. Select the eye button (**Preview**) on the file's row.
2. The file opens in a window. A PDF is shown page by page; a long one shows its first 30 pages, and the window says how many more there are.
3. Select **Download** to keep a copy, or **Close**.

Only images and PDFs are shown this way. Every other kind of file (Word documents, spreadsheets, text files, web pages, SVG drawings) always downloads. A PDF is drawn as pictures of its pages: anything active inside it (scripts, forms, links to other sites) does nothing. Previewing a file on a restricted record is recorded in its history, like a download.

### Finding a record by what its files say

The search at the top of every page finds a record by the words inside its PDF, Word (`.docx`) and plain-text files (`.txt`, `.md`, `.log`, `.csv`), as well as by the file names. A match inside a file is shown with a paperclip and **In a file**, with the file's name and the passage that matched.

- The text is read in the background a minute or so after a file is attached, so a new file is not found at once. Files attached before this was added are read too, newest first.
- What you find follows the record, exactly as the files do: you only find records you can open, and a restricted record's files only if your role lets you see restricted records.
- A scanned PDF that holds only pictures of pages is read by OCR (optical character recognition): the pictures on its first 50 pages are read on the server, in the same separate reader with its own time limit (five minutes) and memory limit, with the English language data that comes with the application. Nothing is downloaded and nothing is sent elsewhere. OCR can make reading mistakes, so a word may be missed. An administrator can switch OCR off, or add languages, with the settings in the installation guide; where it is off, a scan has no text to find. Files larger than 25 MB, and files that cannot be read in 30 seconds or would need too much memory to read, are not read. Only the first 300,000 characters of a file are searched.
- Each file is read apart from the rest of the application, so a damaged or deliberately harmful file cannot slow it down or stop it. A file whose reading had to be stopped is tried once more; if that fails too, it is left unread for good and is found by its name only.
- Files a vendor sends through a response link are not read while they wait for review; their text is read once someone takes them over (see [Files from the vendor](04-vendors-and-contracts.md#files-from-the-vendor)).
- When a file is removed its text is forgotten at once; if an administrator puts the file back, it is read again.
- Older Word files (`.doc`), spreadsheets and presentations are found by their names only.
- A PDF that is the original of a controlled document's effective version also makes the document itself findable by its words, a few minutes after its text has been read; a scanned PDF read by OCR is marked as such on its version, and one with no text that OCR could read is found by its title and number only.

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

The record's **History** tab shows each file attached, each change to a file's details, each file removed and each file refused, with who did it and when. Downloading or previewing a file from a restricted record is recorded too.

## Evidence files

Evidence is a file that shows something was done or was true on a date: a signed approval, a test result, a certificate. Evidence has two dates of its own.

| Date | Meaning |
|---|---|
| **Collected on** | The date the evidence was produced or gathered. It cannot be in the future. If you leave it empty when attaching, today's date is used |
| **Expires on** | Optional. The date after which the evidence is too old to rely on and a newer copy is needed. It cannot be before the collection date |

### Attach evidence

On records that exist to prove something, the files tab is called **Evidence files** instead of **Attachments**: vendor evidence items, framework outcomes, obligations, policies, exercises and risks (where files show that a treatment was carried out). Some pages have an **Evidence** tab of their own that works the same way, such as a framework outcome or a security incident. There a box under the upload area offers **Record new files as evidence**, checked to begin with.

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

### Expiring evidence

One page lists everything used as evidence that has run out or soon will: vendor evidence, evidence library records (while the [evidence library](43-evidence-library.md) is on) and files attached to records as evidence. Open it from the **Expiring** tab of **Vendors > Evidence** or of the **Evidence library** (its address is `/attachments/expiring`; the old address `/evidence/expiring` opens it on vendor evidence). You see only what you could open anyway.

1. Choose a **Source**: **Every source**, **Vendor evidence**, **Evidence library** or **File on a record**.
2. Choose a period in **Show evidence expiring in**, from **Next 30 days** to **Next 365 days**. It starts at **Next 90 days**.
3. The tiles show how much has **Already expired** and how much is expiring in the period.
4. The table lists it soonest first, with where each item is kept, the dates and a status chip. Select an item to open it and record a current copy where the old one was.

The separate **Expiring files** tab and its header links are gone: this page replaces them.

The owner of the record is reminded as an evidence file's expiry date approaches: a **Reminders** notification 30 days before, 7 days before and on the day it expires, each once (only the nearest one when a file is attached with less time left). The owner is the person in the record's **Owner** field; on a record without one, the person who attached the file is told. Only someone who can open the record is told. Files on vendor evidence items are left out, because the evidence item's own expiry reminders cover them (see [Vendors and contracts](04-vendors-and-contracts.md#reminders)). Changing the file's **Expires on** date starts its reminders again.

## File settings

*Administrators.* Open **Administration > File settings** (a card on the **Administration** page). Four tiles at the top show the **Files in use**, the files **Removed, waiting to be purged**, how many are **Not scanned for malware**, and where **New files go to**, each with its size. Below them are four tabs. Changes on the **Malware scanning**, **Storage** and **Removed files** tabs ask you to confirm your password if you have not done so in the last few minutes. Every change is kept in the audit log.

### Uploads

| Setting | Meaning |
|---|---|
| **Largest file (MB)** | The largest size allowed for one file, from 1 to 2048 megabytes. A new installation uses 25 |
| **Allowed file types** | The file extensions that are accepted, separated by commas, for example `pdf, docx, png` |

Select **Save upload limits**. The new limits apply to files attached from then on; files already attached are not affected. Adding a file type to the list asks you to confirm your password if you have not done so in the last few minutes; removing one or changing the size does not.

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
- **Files attached without a scan** shows how many files in use were never scanned. Select **Scan files attached earlier** to scan them all in the background: a progress bar shows how many have been checked, and you can leave the page and keep working; the application carries on. When it finishes, the card shows how many were clean, infected or could not be checked. Only one scan runs at a time, and it also appears under **Background jobs**. A file found to contain malware is removed at once, its content deleted, and every administrator is notified; the audit log names the file and its record (action `attachment.quarantine`).

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

Files already stored stay where they are and can still be downloaded. To move them all to where new files now go, save the choice above, then select **Move files to …** under **Move stored files** and confirm your password. The move runs in the background while the application keeps working, with a progress bar: each file is copied, read back and checked against its checksum before the old copy is deleted, so every file stays readable throughout. A file that cannot be moved stays readable where it was, and the card says how many. The start of each move is kept in the audit log. The person running the server can still do the same with the server stopped: `.\grc.ps1 move-files -To s3` (or `-To disk`).

**Storage check** compares the stored files with the records of attached files. Select **Check storage**: the page lists files missing from storage and stored files that no record refers to. Nothing is changed.

### Removed files

A removed file is kept in storage for the period you set, so it can be put back, and is then deleted for good by a daily job.

1. Set **Keep removed files for (days)**: 30 to begin with, 0 to keep them indefinitely. Select **Save**.
2. **Purge now** deletes at once the files that are already past the period, rather than waiting for the daily job.
3. The **Removed files** table lists each removed file with its **Record**, **Why** it was removed (**Removed by a person**, **Record deleted**), when, and the date it will be purged. Select **Put back** to return a file to its record.

Records themselves are never deleted by this. A record past its retention period goes to the retention review (see the administration guide); only when a record is deleted for good there are its files marked **Record deleted**, and they then follow the same period. Such files cannot be put back. Files of a record that is only removed (and can still be restored) are kept. Every purge and every file put back is recorded in the audit log.

Removed files of restricted records are listed only for administrators who may see restricted records.

## Backups

*Administrators.* Open **Administration > Backups**. The application takes a copy of everything while it keeps running, writes it to a second location, reads it back from there and checks every file in it.

The tiles show the **Last good backup** (red when there is none or it is more than two days old), the **Schedule**, where backups go (**Goes to**), and whether **Encryption** is on and with which key.

### Schedule and destination

1. Switch on **Take a backup every day**, and choose the **Time of day** (in the organization's time zone; 03:30 to begin with). Choose a quiet time: with the built-in database the application pauses briefly while the backup takes its snapshot (about a second for 65,000 records), then keeps answering while the rest is copied. Keep it away from the time of any stop-and-copy backup the person running the server has scheduled (02:00 by default), which stops the application.
2. Set **Backups to keep**: the newest ones at the destination are kept and older ones are deleted after each good backup (14 to begin with).
3. Under **Write backups to**, choose **A folder (another disk, or a network share)** and enter the full **Folder** path, for example `D:\Backups\Sandpiper` or `\\fileserver\backups\sandpiper`, or choose the object store set up on the **File settings** page and a **Prefix in the object store**. A folder inside the data folder is refused.
4. Switch on **Encrypt each backup** if the server has a backup key (the page says which; the person running the server sets it, see the operations guide). Keep a copy of that key somewhere safe and separate: without it the backups cannot be read.
5. **Include the application's secret key** (encrypted backups only) also puts the key that protects second-factor keys and webhook secrets into each backup, so a restore puts it back too. With it off, that key is not in backups and must be kept separately; the page says where it is.
6. Select **Save backup settings**. You may be asked to confirm your password.

Select **Back up now** at any time. The backup runs in the background: the button shows **Backing up**, and a line above the tiles says how far it has got (copying the database, so many tables of so many, packing, writing to the destination, reading it back and checking it, removing older ones). You may leave the page; when you stay, it tells you the result when it finishes. Only one backup runs at a time: while one waits or runs, **Back up now** is not available.

**Recent backups** lists the last 20 with their start time, result (**Checked**, **Failed** or **Running**), file name, size, whether they were taken **Daily** or by a person, and whether they are encrypted. A failed backup shows why; a running one shows how far it has got.

If a backup fails, or none has succeeded for two days, every administrator is notified, and the reason is kept in the audit log. A backup that was running when the server stopped is shown as **Failed** with "Interrupted".

Files kept in the object store are not in these backups: use the store's own versioning. To restore a backup, the person running the server stops it and runs `.\grc.ps1 restore <file>`; see the operations guide, which also has a recovery runbook (what to do, in order, after losing the server) and suggested targets for how much work may be lost and how long the application may be unavailable.

### PostgreSQL database dumps

When the application uses a PostgreSQL server, the person running it backs the database up with the script `deploy/postgres/pg-backup.sh` on a schedule, and the **Backups** page checks those backups too. The section appears only on a PostgreSQL server (or once a dump folder is set).

1. Under **PostgreSQL database dumps**, enter the **Dump folder**: the folder the script writes to, as the server sees it (for example `/srv/backups/grc`).
2. Set **Warn when the newest is older than (hours)**: 26 suits a dump taken every night.
3. Select **Save backup settings**.

Every five minutes the server looks in the folder. Each new dump is read once and compared with the record the script wrote beside it (its size and checksum), and listed under **PostgreSQL dumps checked** as **Checked** or **Failed**, with the number of entries it holds. The **Last PostgreSQL dump** tile shows the newest good one. Every administrator is told once, in the application and by email, when the newest dump failed its check, or when the newest good one is older than the limit (or none is found); they are told again only if the problem clears and comes back.

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

Select **See all notifications** in the bell menu of the top bar, or **Notifications** in your account menu (top right).

| Tab | Shows |
|---|---|
| **All** | Every notification you have received, newest first, 20 to a page. Use **Newer** and **Older** to move between pages |
| **Unread** | Only those you have not read, with the count on the tab |
| **Preferences** | Your choices; see below |

Select a notification to open its record and mark it as read. Select **Mark all as read** at the top of the page to mark everything as read.

To delete a notification, select the bin button at the end of its row. **Delete read** at the top of the page deletes every notification you have already read. Deleting only tidies your own list: it changes nothing on the record, and a reminder you deleted is not sent to you again the same day. Read notifications are also removed by themselves after a period your administrator sets (90 days unless changed); unread ones are kept.

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
| **Safety events** (when safety management is on) | A serious safety event has been reported, or a corrective action is overdue |
| **Audits** (when audits and inspections are on) | An inspection or an evidence request is due or overdue |
| **Controls** (when the control library is on) | A control test is due or overdue, or a control covering your record failed its test |
| **Committees** (when committees and meetings are on) | A meeting's pack is due, or minutes are waiting |
| **Other** | Anything that does not fit the kinds above |

Other parts of the application may add kinds of their own, and an administrator can add more under **Lists** (the list `notification_kind`). They appear in everyone's preferences.

Besides the notifications each part of the application sends as things happen, these reminders are sent by themselves. How far ahead each one goes out is set by your administrator under **Administration** > **Reminders**.

| Reminder | Who is told | When |
|---|---|---|
| An action due or overdue (**Due dates**) | Its owner | Once a day from three days before its due date until it is done or canceled |
| A ticket close to its resolution target (**Service-level targets**) | Its assignee | Once a day, within four hours of the target; not while paused or after it is resolved |
| An obligation's next due date (**Due dates**) | Its owner, or everyone who may edit obligations if it has none | Once when the date is 30 days away, and once when it is reached |
| An overdue project milestone, or an overdue risk, issue, decision or change request in a project's register (**Due dates**) | The item's owner, or the project manager | Once for each due date that passes, while the project is active or on hold |
| An evidence note on a framework outcome about to expire, or expired (**Reminders**) | The outcome's owner, or everyone who may edit framework outcomes | Once when the expiry is 30 days away, and once when it has passed |
| A hazard's review date (**Reminders**) | The hazard's owner, or everyone who may edit safety records | Once when the date is 14 days away, and once when it is reached; not for closed hazards |
| An evidence file about to expire, or expired (**Reminders**) | The owner of its record, or the person who attached it | 30 days before, 7 days before and on the day, each once; see [Expiring evidence](#expiring-evidence) |
| An evidence record about to lapse (**Reminders**) | The evidence record's owner | 30 days before, 7 days before and on its "valid until" date, each once; see [Evidence library](43-evidence-library.md) |
| A civil rights complaint time limit (acknowledgment, investigation, appeal) or monitoring report due (**Civil rights**) | The investigator (or the complaint handlers when there is none), the report owner | Once before the limit (**Remind before a complaint or report time limit**, 7 days) and once when it has passed; a program owner once 30 days before the next update is due; see [Civil rights programs](46-civil-rights-programs.md) |
| Warranty and support end dates of assets, contract notice dates, review dates of framework outcomes, risk acceptances, policy acknowledgments and training due | As described in the guide for each part | |

A date that passed more than 30 days before a reminder could be sent (for example on the day these reminders were first switched on) is not announced. Changing a due or review date starts its reminders again.

### Records you watch

Select **Watch** at the top of a record page to be told when that record's status changes or someone comments on it. You are not told about your own changes, and you stop being told if you lose access to the record. Select **Watching** to stop. The records you watch are listed under **Watching** on the Overview.

### Notifications and restricted records

You are never sent a notification about a record you are not allowed to open. If a record is restricted, or your role changes, after a notification was sent, the notification changes to "A record you can no longer open" and no longer names the record or links to it. Notifications about a part of the application that an administrator has switched off (Administration > Features), or leading to one of its pages, are not shown or counted while it is off, and the kinds that belong to it (for example **Service-level targets** with the service desk, **Notification clocks** with security incidents, **Acknowledgments** with policies) leave **Preferences**; both come back, with your choices, when it is switched on.

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

Messages go to the email address on your account, named in the **Email** card on the **Preferences** tab. Only an administrator can change it.

- **One message for each notification.** Each email has the notification's title and text, a link that opens the record in the application, and a link to your preferences.
- **One summary a day.** Check **Send me one summary a day instead of a message for each notification**. Notifications you get by email then wait, and once a day (from the hour your administrator has set, 07:00 unless changed) you receive one message listing them, each with its link. Nothing is sent on a day with nothing new. The bell is not affected: it always shows notifications as they happen. A notification about a part of the application that is switched off is left out of the summary and kept: it is in the first summary after that part is switched on again.

**Restricted records are never described in an email.** If a notification is about a restricted record, such as a security incident, the email says only "You have a new security notification — open the application to view it" and links to your notifications page; in the daily summary it is listed the same way, without its title. Whether you may still see a record is checked again when the email is sent: if you have lost access in the meantime, nothing is sent about it.

### Forgot your password?

If email is switched on, you can ask for a link to set a new password yourself.

1. Open the address `/forgot-password` (for example `https://grc.example.org/forgot-password`), or follow the **Forgot your password?** link where your sign-in page has one.
2. Enter your username or the email address on your account, and select **Email me a link**.
3. The page always answers the same way, whether or not the account exists: "If that matches an account with an email address, a link to set a new password is on its way."
4. Open the link in the email. It works once and expires after an hour (or the time your administrator has set). Choose your new password; your other sessions are signed out.

Requests are limited: five from one place in 15 minutes, and at most three links an hour for one account. Asking again replaces the link you asked for before. If email is not switched on, the page says so and asks you to contact an administrator, who can still give you a link by hand.

## Email settings

*Administrators.* Open **Administration** > **Email**. Email is **off** until you switch it on: nothing is sent while it is off, and when it is on the application connects only to the mail service you choose.

### Settings

Under **How messages are sent**, choose **Send through**:

- **SMTP**: a mail server that accepts a user name and password, or a relay on your own network.
- **Microsoft Graph**: Microsoft 365 or Exchange Online, for a tenant that has switched off SMTP sign-in with a password.
- **Gmail API**: Google Workspace, for a domain that has switched off SMTP sign-in with a password.

Whoever runs your mail service sets up the sign-in for Microsoft Graph or the Gmail API; the [installation guide](../installation.md#mail-providers) walks through it. The details you enter for each are kept when you choose another, so email to ticket can still read a mailbox through Microsoft Graph or the Gmail API while messages go out over SMTP.

1. For **SMTP**, under **Mail server (SMTP)**, enter the details your mail service gave you:

   | Field | What to enter |
   |---|---|
   | **Mail server** | The host name or address, such as `smtp.example.org` |
   | **Port** | Usually 587 for STARTTLS or 465 for TLS |
   | **Secure connection** | **STARTTLS (port 587)**, **TLS (port 465)**, or **None (plain connection)**. Use None only for a mail relay on your own network |
   | **User name** and **Password** | Leave empty if the server does not ask for a sign-in. The password is kept encrypted and is never shown again; leave the box empty to keep the saved one, or check **Remove the saved password** |

   For **Microsoft Graph**, under **Microsoft Graph**:

   | Field | What to enter |
   |---|---|
   | **Microsoft cloud** | **Worldwide (including GCC)**, **US Government (GCC High)** or **US Government (DoD)** |
   | **Directory (tenant) ID** and **Application (client) ID** | From the app registration's Overview page |
   | **Sign-in method** | **Certificate (recommended)** or **Client secret** |
   | **Client secret**, or **Certificate and private key (PEM)** | The secret's Value (not its Secret ID), or the certificate uploaded to the app registration pasted together with its private key (without a passphrase). Kept encrypted and never shown again; for a certificate the page shows its thumbprint and expiry date. Check **Remove the saved Microsoft Graph sign-in** to delete it |
   | **Send as mailbox** | The mailbox messages are sent from. Empty: the from address |

   For **Gmail API**, under **Gmail API**:

   | Field | What to enter |
   |---|---|
   | **Service account key (JSON)** | The whole key file of the service account. Kept encrypted and never shown again; the page shows the service account and its client ID, which your Google Workspace administrator needs for domain-wide delegation. Check **Remove the saved service account key** to delete it |
   | **Send as mailbox** | A user in your domain whose mailbox sends the messages. Empty: the from address |

   Then, under **Sender**, for every choice:

   | Field | What to enter |
   |---|---|
   | **From address** and **From name** | Who messages come from. With Microsoft Graph or the Gmail API, use the sending mailbox's own address or one it may send as |
   | **Reply-to address** | Optional: where replies go, such as the service desk |
   | **Application address** | The address people use to open the application, such as `https://grc.example.org`. Links in messages start with it |

2. Select **Save settings**. You may be asked to confirm your password.
3. Under **Send a test message**, check the address and select **Send a test message**. The test is sent at once through the saved choice, even while email is off, and the page says whether it was sent or why not, in plain words: for example a wrong client secret, a permission or delegation that is missing (with the permission or scope to add), or a mailbox that does not exist.
4. Switch **Send email** on. The from address, the application address and what the chosen way of sending needs (the mail server; or the tenant ID, client ID and secret or certificate; or the key) must be filled in first.

Switching email off stops everything at once: messages still waiting are not sent, and notifications go to the bell. Every change, and every test, is recorded in the audit log, naming the way of sending but never the password, secret, certificate or key.

If the mail service is busy or limits how fast messages are sent, the message is tried again later (see **Delivery log**). When the service says how long to wait (Microsoft Graph and the Gmail API send `Retry-After`; some mail servers write "try again in 5 minutes"), the next try waits exactly that long, up to an hour, instead of the usual wait.

If the mail server cannot be reached at all (it is down, or the address or port is wrong), each try gives up after 5 seconds. After three such failures in a row, sending pauses for five minutes: waiting messages show "Waiting: the mail server could not be reached" in the **Delivery log** and keep all their tries. After the pause one message tries again; when it gets through, sending carries on. **Send a test message** always tries at once. Email is sent apart from the application's other background work, so alerts, service-level timers and scheduled tasks are never held up by a mail server that does not answer.

Messages up to the 10 MB limit for files go through every way of sending. Through Microsoft Graph, a message larger than one request (about 3 MB with its files) is sent another way: as a draft, with each large file uploaded in parts, then sent. It keeps its message ID and its threading, and the marks that stop auto-replies and stop the application taking its own messages back in.

When email is on:

- people who chose email for a kind of notification receive it, one at a time or as a daily summary;
- the set-up link for a new user, and any set-up or reset link you issue on a user's page, is also emailed to that person. You are still shown the link, as before;
- anyone can ask for their own reset link on the **Forgot your password?** page.

### Templates

The **Templates** tab lists each kind of message: **Test message**, **Notification**, **Security notification**, **Daily summary**, **Account set-up link**, **Password reset link**, **General message** (used by other parts of the application, such as scheduled reports and security incident alerts) and **Text message (email-to-text)**.

1. Select a template. The placeholders it accepts are listed above the fields, for example `{{title}}` or `{{link}}`.
2. Change the **Subject**, the **Plain-text body** and, if you like, the **HTML body**. The HTML body may use only simple tags (p, br, strong, em, ul, ol, li, h1 to h3, hr, blockquote and a), and links may point only at `{{link}}`, `{{preferencesLink}}`, an `https:` address or a `mailto:` address. Leave it empty to build it from the plain text. Values put into the HTML are always escaped.
3. Select **Preview** to see the message with sample values, then **Save template**.

Two templates belong to vendor assessments: **Vendor response link** (the email that carries a response link to a vendor contact) and **Vendor response link reminder** (sent once before an emailed link expires; it cannot carry the link). See [Vendors and contracts](04-vendors-and-contracts.md#the-email).

A template you have changed shows **Changed here**; **Put back the default** restores the original. The **Security notification** template may not contain the title or text of the notification.

### Delivery log

The **Delivery log** tab lists every message the application tried to send, newest first: when, to whom, the subject, what kind of message it was, and its status. Messages are kept for 180 days to begin with (**Outgoing message log** under **Administration > Settings > Retention**); those still waiting or to be tried again are kept until they are done.

| Status | Meaning |
|---|---|
| **Waiting** | Queued, not tried yet |
| **Sent** | The mail server accepted it |
| **Failed, will retry** | The last try did not work (the error is shown); it is tried again later |
| **Gave up** | It failed too often, or the server refused it for good (for example a wrong password). Open its **job** to try again |
| **Not sent** | There was nothing to send: the person has no address, is no longer active, or can no longer see the record |

A message that fails is tried up to five times, waiting 1, 2, 4 and 8 minutes in between, or as long as the mail service asked (at most an hour).

Text messages (below) are listed here too, as **Text message (email-to-text)** with the address, or with the provider **webhook** and the mobile number partly hidden.

### Text messages

Urgent alerts, such as a security incident that needs attention, can also reach people's phones as text messages ([Security incidents](07-security-incidents.md#alerts-by-email-and-text-message)). Text messages also carry the messages sent to a plan's call tree during an emergency activation, each with the person's own acknowledgment link ([Business continuity](30-business-continuity.md#messaging-the-call-tree)). No paid service is built in. On the **Text messages** tab choose one or both ways:

- **Send to email-to-text addresses**: the text is emailed, through the email settings above, to the person's email-to-text address. Many mobile carriers and enterprise messaging services give each phone such an address. Needs email switched on.
- **Send through the webhook**: each text is posted, signed, to your own text-message system's webhook, which sends it on. Enter the **Webhook address** (https) and a **Signing secret** of at least 16 characters (kept encrypted, never shown again). It is an outbound connection: it needs outbound connections switched on and the host on the allow-list under **Administration** > **Settings**, exactly like webhooks. The format your system receives is in the [installation guide](../installation.md#text-messages-for-alerts).

Select **Save text-message settings**; you may be asked to confirm your password. Changes are recorded in the audit log, never the secret.

A text names only what needs attention, never details, so it is safe on a lock screen: "Sandpiper GRC: security incident SEC-0042 needs attention: a notification deadline has passed. Open the app." The **Text message (email-to-text)** template on the **Templates** tab sets how the emailed form looks; keep it short, as many services cut a text at 160 characters.

### Your mobile number and email-to-text address

Each person adds their own under **Account security** > **Alerts by text message**: a **Mobile number** with its country code (used through the webhook) and an **Email-to-text address**. These are personal: only the person and administrators see them, and administrators can change them on the person's page under **Administration** > **Users**. The audit log records that they changed, not the numbers. **Send a test text** sends one straight away through each way that is switched on.

## Reminders

*Administrators.* Open **Administration** > **Reminders** to choose how far ahead reminders go out. The page shows a box for each part of the application that is installed, grouped by area, each with what it does and its starting value.

| Setting | Starting value |
|---|---|
| **Remind action owners before the due date** | 3 days |
| **Action statuses that need no reminder** | Done and Canceled |
| **Warn ticket assignees before the resolution target** | 4 hours |
| **Daily email summary goes out from** | 7:00 (organization time zone) |
| **Remove read notifications after** | 90 days (7 to 730) |
| **Warranty and support end reminders** | 30, 7 and 0 days before (up to six steps, separated by commas) |
| **Remind obligation owners before the next due date** | 30 days |
| **Remind outcome owners before the review date** | 14 days |
| **Remind outcome owners before an evidence note expires** | 30 days |
| **Remind risk owners before an acceptance expires** | 30 days |
| **Remind hazard owners before the review date** | 14 days |
| **Remind evidence owners before evidence lapses** | 30, 7 and 0 days before (shown while the [evidence library](43-evidence-library.md) is on) |
| **Days the auditor has to verify a finding once it is ready** | 30 days (see [Audits and inspections](25-audits-and-inspections.md)) |
| **Remind policy owners before a policy expires** | 90, 60 and 30 days before (shown while [insurance](45-insurance.md) is on) |
| **Remind policy owners before the renewal application is due** | 14, 3 and 0 days before |
| **Remind certificate owners before a certificate of insurance expires** | 30 and 0 days before |
| **Remind before a complaint or report time limit** | 7 days (shown while [civil rights](46-civil-rights-programs.md) is on) |
| **Remind the preparer before a statistical report is due** | 30, 7 and 0 days before (shown while [strategy](47-strategy-and-statistics.md) is on) |

Change the values you need and select **Save changes**; **Undo changes** puts back what is saved. Each value that changed is kept in the audit log. Reminders for policies and training have their own settings in those parts of the application, and a policy or course can set its own interval; see [Policies and exceptions](11-policies-and-exceptions.md) and [Training and exercises](12-training-and-exercises.md).

## Background jobs

*Administrators.* Open **Administration** > **Background jobs** to see the work the application does by itself: sending email, every reminder described above, the daily email summaries, the service-level and notification-clock checks, report schedules, the daily file purge, the backup schedule, file scans and moves started from **File settings**, and the clean-up of old notifications.

- The tiles count jobs that are **Waiting**, **Running**, **Failed, will retry**, **Gave up** and **Done**. Finished jobs are kept for 30 days (two days for the regular runs of a schedule, some of which run every minute) and jobs that gave up for 90.
- **Schedules** lists the regular work, how often it runs, when it last ran and when it runs next. **Run now** runs one straight away.
- **Recent jobs** lists jobs newest first; choose a **Status** to narrow it. Select a job to see its details, its last error and its result. For a job that failed or gave up, **Try again now** runs it again at once, with its attempts counted from nothing. If a newer run of the same job (for example the schedule's next run) is already waiting or running, **Try again now** says so and leaves the old job as it is.

### Problems being watched

When background work keeps failing, every administrator is told once, under the bell and by email, with a link to the page that shows the problem, and it is listed at the top of **Background jobs** under **Problems being watched** until it clears. Nothing more is sent while it lasts; if it clears and later comes back, you are told again. Each one is also recorded in the audit log.

| You are told when | It clears when |
|---|---|
| A job gave up after all its attempts, and no later run of the same kind has finished. When it is the safety notification clock check, the message says that deadline alerts may be missed | A later run finishes, or **Try again now** works |
| Email is on and the last three messages could not be sent | A message is sent |
| A webhook's receiver keeps refusing or not answering | A delivery gets through, or the webhook is switched off |
| An audit-log forwarder has failed three times in a row | It sends again, or is switched off |
| A copy of the server has stopped running background jobs, or no copy is running them at all (jobs have waited 15 minutes) | Jobs run again |
| PostgreSQL backups are overdue, or the newest failed its check (see **Backups**) | A good, recent dump is found |
| The audit archive cannot remove old events (see the administration guide) | The archive runs, or is switched off |

Each job runs once even if more than one copy of the server is using the same database. If the server stops in the middle of a job, the job is picked up again a few minutes after the server starts.

## Not available yet

- Changing the email address on your own account: ask an administrator.
- Signing in to Gmail with a person's own account (a refresh token): the Gmail API is used with a service account only, so a personal Gmail account must use SMTP with an app password.
- Malware scanners other than ClamAV, or scanning through an outside service.
- Viewing a file inside the application. Files are downloaded and opened on your computer.
- Checking a linked document automatically: the application never opens a link's address, so a person confirms that it is still current.
- Renaming a file, replacing its content while keeping its history, or keeping several versions of one file.
- Restoring a backup from the **Backups** page: it is a command for the person running the server.
- Searching inside the content of attached files.
