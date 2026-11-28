# Documents and exceptions

This part of the application controls the organization's documents: policies and plans, standards and programs, procedures and standard operating procedures, work instructions, forms, bulletins, and documents from outside such as standards and regulations. Each document has a number, an owner, a place in the hierarchy, a list of who may read it, and every version of its text with the dates it was in force. Publishing a version can ask the right people to read and acknowledge it. The same part holds the exceptions register, where each agreed deviation from a policy is recorded with its approver and the date it expires.

Both are in the **Documents** group of the menu: **Document library** for everyone, and **Exceptions** for people who may see the exceptions register. Lists and record pages work as described in [Getting started](01-getting-started.md).

An administrator can switch documents and exceptions off under **Administration > Features** (see [Administration](09-administration.md#features)): the **Documents** menu, the library, **Acknowledgments** on **My work** and every link to a document then go. Records are kept and return when it is switched back on.

## Who can do what

| To do this | You need |
|---|---|
| Read the documents distributed to you in the library, print them, acknowledge them | Nothing more than being able to sign in |
| See the register, with every document's state, owner and review date | **View** on **Documents (policies)** |
| Add a document, edit its details, write or upload a version, record a review, map outcomes | **Create** or **Edit** on **Documents (policies)** |
| Approve a version, publish it, make a document obsolete | **Approve** on **Documents (policies)** |
| Change who can read a document | Being its owner, or **Administer** on **Documents (policies)** |
| Number documents, manage distribution groups, department codes, the numbering pattern and reminders, import a package; read every document | **Administer** on **Documents (policies)** (a *document controller*) |
| Export the register or the acknowledgment list | **Export** on **Documents (policies)** |
| See the exceptions register | **View** on **Exceptions** |
| Record or edit an exception, withdraw it | **Create** or **Edit** on **Exceptions** |
| Approve or reject an exception, or change the expiry date of an approved one | **Approve** on **Exceptions** |
| See which people on the roster were asked, and record their acknowledgments | **View** (to see) or **Edit** (to record) on **Documents (policies)**, and **View** on **People** |
| Run the acknowledgment kiosk | **Edit** on **Documents (policies)** |

A role can be limited to **Their departments** for documents (see [Administration](09-administration.md)): a department's document coordinator then works only with the documents their department owns, for example the IT department's operating procedures. That limit narrows what a person may change; it does not make a document confidential. Who may read a document is its distribution, described below.

## The document library

Open **Documents > Document library**. It lists the documents in force that are distributed to you, whatever your role.

- **Types** on the left groups the document types by tier of the hierarchy (**Policies and plans**, **Standards and programs**, **Procedures**, **Instructions, guidelines and forms**, **External documents**, **Reference documents**) with the number of documents of each type you can open. Select a type to see only those; select it again, or **All types**, to see everything.
- **Departments** does the same by owning department.
- **Search documents** finds words in the number, the title, the summary and the whole text of the version in force, including the text of a PDF once it has been read. The words found are marked in a few lines of the text under each result.
- **Show obsolete documents** adds documents that are no longer in force, marked **Obsolete**.

Each result shows the document number, the title, its type, owning department, version and the date it took effect. A lock beside the title means the document has a restricted distribution and you are one of its readers. Select the title to read it.

The numbers on the left are of what you can open, so two people may see different numbers there. The figures on the register and on dashboards are different: they count every document, for everyone (see [The register](#the-register)).

People with a role in documents see tabs under the heading: **Library**, **Register**, **Waiting for approval**, **Reviews due**, **External documents**, **Distribution groups**, **Import**, **Acknowledgment kiosk** and **Settings**, each only for the people whose role uses it. Someone who only reads sees no tabs.

### Read a document

The reading page shows the document's number and title, **Effective** (or **Obsolete**, or **Reference only**), **Restricted distribution** when it has one, its type, owner and next review. Its tabs:

| Tab | What it holds |
|---|---|
| **Read** | The text in force, with the line of facts about the version: **Effective from** a date, who approved it and when, the body that adopted it and its record (for example a resolution number), and what changed |
| **Details** | Number, type, owner, owning department, approver, readers, next and last review; for an external document its publisher, edition, publication date, source and license; for an obsolete one when and why, and what replaced it |
| **Versions** | Every issued version with the dates it was in force. **Read** opens one |
| **Relationships** | Where the document sits in the hierarchy, and the controls, obligations, systems, courses, risks and other documents linked to it |

**Version to read**, at the top right of the text, opens an earlier version. An earlier version is marked at the top in red: **Superseded: not for use**, with the dates it was **In force** and a link back to the version in force. A version approved for a later date is shown as **Approved, effective on** that date; the version in force stays in force until the morning of that day.

**Print or save as PDF** gives a controlled copy (see [Printing](#printing)). A version kept as a file (a PDF) opens with **Open the document**. People who may edit documents also see **Download the original**, the file the version came from, and **Open in the register**.

A document that is not distributed to you does not exist for you: it is not in the library, in search, in lists of linked records or in the hierarchy, and its address answers "not found". Where a document you can read has children or links you cannot open, the page counts them ("2 documents you cannot open") without naming them.

## Document types and the hierarchy

Every document has a **Document type**. The type gives the document's tier in the hierarchy, the prefix of its number, its review cycle and whether readers are asked to acknowledge it by default.

| Tier | Document type | Number prefix | Review cycle | Acknowledged by default |
|---|---|---|---|---|
| 1 | **Policy** | POL | 24 months | Yes |
| 1 | **Plan** (see [Plans](#plans)) | PLN | 12 months | No |
| 1 | **Charter or bylaws** | CHR | 36 months | No |
| 2 | **Standard** (internal) | STD | 36 months | No |
| 2 | **Program or manual** | PRG | 24 months | No |
| 3 | **Procedure** | PRC | 24 months | No |
| 3 | **Standard operating procedure** | SOP | 24 months | No |
| 3 | **Rulebook section** | RB | 12 months | Yes |
| 3 | **Bulletin** (may carry an **Expires** date) | BUL | 6 months | Yes |
| 4 | **Work instruction** | WI | 24 months | No |
| 4 | **Guideline** | GDL | 36 months | No |
| 4 | **Form or template** | FRM | 36 months | No |
| External | **External document**: a standard, regulation, guidance or manual from outside | EXT | 12 months (a check for a new edition) | No |
| Reference | **Reference document**: a study, report or assessment kept for reference, not controlled | REF | None | No |

A document sits **Under** one parent: a procedure under the policy it carries out, a work instruction or form under its procedure. A child's tier is normally the same as or below its parent's; a document placed above its own tier is loaded anyway, with a warning on its **Hierarchy and links** tab. A document cannot be placed under one of its own children. Further links (an operating procedure that carries out two policies) are made on the **Related** tab as usual.

A filled-in form, a signed acknowledgment, an inspection checklist or the minutes of a meeting are records, not documents: they belong on the record they are about (inspection, meeting, ticket, evidence) and are kept as long as the [records retention schedule](42-records-retention-schedule.md) says.

A reference document is marked **Reference only**: it has no approval cycle and no review reminders.

An administrator can rename the types, add others and change a cycle under **Administration > Lists** (list **Document type**; see [Settings of a value](09-administration.md#settings-of-a-value)): the stored settings hold the tier, the prefix, the review months and whether readers acknowledge by default.

## Who can read a document

Each document is either for **Everyone in the organization** (every signed-in person, portal users included) or for **Only these readers**:

- **Departments**: everyone in the departments chosen and in every department below them;
- **Roles**: everyone who holds one of the roles;
- **Distribution groups**: everyone in one of the groups (see [Distribution groups](#distribution-groups));
- **People**: people named one by one.

The document's owner, the authors of its versions and document controllers can always read it.

The list is on the **Document** tab of the document's page, in **Who can read it**, with the number of people who can read it. Its owner and document controllers select **Change**, choose, and **Save distribution**; the number of readers updates as you choose. Everyone asked to acknowledge the document must be able to read it: a list that would leave some of them out is refused until the distribution or the acknowledgment audience changes. Narrowing the list closes the open acknowledgment requests of people who can no longer read it, and the message says how many. Each change is recorded in the history with the list before and after.

For everyone outside its distribution, a restricted document shows nowhere: not its number, title, words, owner or files, in no list, search, export, report, dashboard, link or AI assistant answer. It is still counted in every figure, which is the same for everyone (for example "Procedures: 112" includes restricted procedures you cannot open). Where figures are grouped by title or person, restricted documents are grouped under "Restricted".

## Document numbers

Each document has a **Document number**, the controlled number people quote, such as `SOP-IT-014`, and keeps its internal reference (such as `POL-00004`) too. A number is given when the document is created, from the numbering pattern, the type's prefix and the code of the owning department, and is never given again, even after the document is made obsolete. A document created without enough to number it gets one later with **More actions > Give it a number** (document controllers). Document controllers can also type a number by hand, for example an existing number of the organization's; it must not be in use by another document.

The pattern and the department codes are under **Documents > Settings** (see [Settings](#settings)).

## The register

Open **Documents > Document library**, then the **Register** tab. The register lists every document you may see, whatever its state, with its number, title, type, owning department, owner, version, next review, status and readers (**Everyone** or **Restricted**).

The tiles count, for everyone alike: **Effective**, **In review**, **Review overdue**, **Review due in 90 days**, **Obsolete** and **Without owner**. Restricted documents are counted even for people who cannot open them, so the tiles may count more than the list shows you. Select a tile to see the documents it counts.

The **View** menu holds ready-made saved views (**Effective**, **Being written or approved**, **Owned by me**, **Restricted distribution**, **Obsolete**). Filter by **Document type**, **Status**, **Owning department**, **Owner** or **Who may read**; check documents and select **Edit selected…** to change their type, category, owner, department or review date at once.

The **External documents** tab is the register limited to documents of outside origin, with their **Publisher**, **Edition** and **Publication date**.

The **Waiting for approval** tab (for people who may approve) lists the versions sent for review and the approved versions waiting to be published. A version you wrote yourself is marked: someone else must approve it.

### Statuses

A document's status follows its versions. You do not set it by hand.

| Status | Meaning |
|---|---|
| **Draft** | Being written. Nothing has been approved |
| **In review** | A version has been sent for review and is waiting for approval |
| **Approved** | A version has been approved but not yet published |
| **Published** | A version is in force (**Effective**). This is what readers see |
| **Obsolete** | No longer in force. Its text and history are kept |

A published document stays **Published** while its next version is being written and approved.

### Add a document

1. On the register select **New document**, or **Create** then **Document**.
2. Enter the **Title**, choose the **Type**, the **Owning department** (it gives the department part of the number), the parent document it sits **Under** and the **Owner**, and a short **Summary**.
3. Under **Who can read it**, keep **Everyone in the organization** or choose **Only these readers** and the departments, roles, groups and people (see [Who can read a document](#who-can-read-a-document)). Choosing here, before saving, means a restricted document is never open to everyone, even for a moment.
4. Select **Create document**.

The document opens with its number and no text yet. Write or upload the first version next. The **Document** tab also holds the approver, the review cycle (empty uses the type's), **Readers must acknowledge** and, for an external document, its publisher, edition, publication date, source address, license note and the framework it is the source of.

## The document page

People with a role in documents open a document from the register, or with **Open in the register** on its reading page. The page has these tabs:

| Tab | What it holds |
|---|---|
| **Document** | The text, with **Print or save as PDF**; the details; **Who can read it**; **Who must acknowledge**; the controls that carry it out |
| **Versions** | Every version with its dates and original file, and two versions side by side |
| **Hierarchy and links** | The documents above and below it, and every linked record grouped by kind of link |
| **Acknowledgments** | Who has and has not acknowledged a version |
| **Translations** | A version's title, summary and text in another language |
| **Reviews** | Every periodic review and its result, and **Record review** |
| **Mapped outcomes** | The framework outcomes the document supports |
| **Exceptions** | Exceptions recorded against the document |
| **Activity**, **Evidence files**, **Related**, **History** | Comments, files (the originals of versions and their pictures among them), linked records, and every change made |

The **Document** tab shows the version in force. If nothing is published yet, people who write or approve documents see the newest version, marked as not published. When a newer version is being worked on, a notice at the top says so and that readers still see the version in force; a version approved for a later effective date says when it takes over.

## Versions and dates

Each version goes through the same steps.

| Step | Button | Who | What happens |
|---|---|---|---|
| 1 | **Write the first version**, **Write a new version** or **Edit draft**; or **More actions > Upload a version (Word or PDF)** | Edit | Opens the editor, or the upload page |
| 2 | **Send for review** | Edit | The version becomes **In review** and can no longer be edited |
| 3 | **Approve** | Approve | Records who approved it and when, and the adoption record. The text is now fixed |
| 4 | **Publish** | Approve | The version comes into force (now or on its effective date) and acknowledgments are requested |

Step 2 is optional: a person who can approve may approve a draft directly. Nobody can approve a version they wrote themselves.

A version's dates:

| Date | Meaning |
|---|---|
| **Approved** | The day it was approved, and by whom |
| **Effective from** | The day it came into force |
| **In force … to …** | For an earlier version: from its effective date to the day the next version took over (**Superseded**) |
| **Withdrawn** | The day the document was made obsolete, for the version that was in force then |

A version may also carry a **Revision label** as the organization knows it ("Rev. C", "2024-1"), shown beside the version number, and the body that adopted it with its record (for example "Board of trustees, Resolution 20XX-NN").

### Discard a version

A draft or in-review version that should not go ahead can be thrown away: **More actions** (three dots), then **Discard version** and the number. Readers keep seeing the version in force. The discarded text is kept in the **History**. An approved or published version cannot be discarded.

### Write the text

1. On the document select **Write the first version**, **Write a new version** or **Edit draft**.
2. In **What changed in this version** say briefly what is different.
3. Write in **Text**. The **Preview** beside it shows how readers will see it.
4. Select **Save draft**.

A new version starts from the text of the one before it, which is kept unchanged. Only one unpublished version can be open at a time.

| To get | Write |
|---|---|
| A heading | `## Heading` |
| A smaller heading | `### Heading` |
| Bold | `**bold**` |
| A list | A line starting with `- ` |
| A numbered list | A line starting with `1. ` |
| A link | `[link text](https://address)` |
| A table | Columns separated by `\|`, with a line of `\|---\|---\|` under the heading row |
| A quotation | A line starting with `> ` |

Web page code typed into the text is shown as text and never run. Pictures from a converted Word document are shown from the document's own files, only to its readers.

### Upload a Word document or a PDF

On the document select **More actions**, then **Upload a version (Word or PDF)**, and **Choose a file**.

- **A Word document (.docx)** is converted to text. The **Conversion report** says how many pictures were kept with the document and what was left out (comments, text boxes, diagrams and embedded objects; page headers and footers, where a revision, an effective date or a number found is offered). The **Converted text** beside a **Preview** can be corrected before saving. A document with tracked changes is stopped: accept or reject the changes in Word and upload it again, or select **Convert as it is** (insertions are kept, deletions left out).
- **A PDF** becomes a file version: readers open it as a controlled copy, and its text is read for search. A scanned PDF with no text layer is read by OCR (optical character recognition) on the server, with the language data that comes with the application: nothing is sent elsewhere. Its words are then found by search, with the note **Scanned: its text was read by OCR** (the text may contain reading mistakes). Only the first 50 pages are read. Where OCR is switched off or finds no text, the scan is found by its number and title only.
- **An older Word file (.doc)** and other formats cannot be converted. They are kept as the original of a file version; save them as .docx in Word to convert them.

Enter **What changed in this version** and, if you like, a **Revision label**, then select **Save draft**. The file as received is kept as the version's original either way; only people who may edit documents can download it. The draft then goes for review, approval and publication like a written one.

### Approve

1. Select **Approve**.
2. Check **Approved by** (leave it empty to record your own name) and the **Approval date**.
3. When a body adopted it, enter it in **Adopted by** and its **Approval record** (for example a resolution number). A **Revision label** can be added here too.
4. Enter an **Effective date** if the version takes effect on a particular day. Leave it empty to use the day it is published.
5. Select **Approve version**.

### Publish

1. Check **Who must acknowledge** first (see below).
2. Select **Publish**. Enter the **Effective date**: today or empty puts the version in force at once; a later date schedules it, and the version in force stays until the morning of that day.
3. For a correction of typing or layout only, check **Minor change**: nobody is asked to acknowledge again, and open requests move to the new version. The choice is recorded in the history.
4. Select **Publish** (or **Schedule**).

The earlier version is kept and marked **Superseded**, with the day it stopped being in force.

### Make a document obsolete

Select **More actions**, then **Make obsolete…**. Say **Why it is no longer needed**, choose what it is **Replaced by** if anything, and the date it is **Obsolete from**, then **Make obsolete**. The version in force is withdrawn and kept, marked **OBSOLETE** on every print; the document leaves the library (it is found there with **Show obsolete documents**); open acknowledgment requests are closed; and its number is never given again. Documents that still sit under it are listed so they can be moved under another document or made obsolete too.

### Compare versions

Open the **Versions** tab. The table lists every version with its status, the dates it was in force, who approved it, its adoption record and what changed; **Original** downloads the file it came from. Below it, two versions are shown side by side: choose them with **Earlier version** and **Later version**, or select **Read** on a row.

## Reviews

Each document is reviewed for adequacy at its review cycle: the document's own **Review cycle in months**, or its type's. **Next review** is the effective date or the last review plus the cycle. A review ends in one of three ways:

| Result | What happens |
|---|---|
| **No change** | The review is recorded on the version in force ("Reviewed on a date, no change") and **Next review** moves on by the cycle. No new version |
| **Revise** | A draft of the next version is opened from the text in force |
| **Make obsolete** | The document is made obsolete, as above (needs **Approve**) |

Open **Documents > Document library**, then **Reviews due**, to see the documents you look after whose review is overdue or due in the next 30 to 365 days, overdue first. Select **Record review** on a row, or on the document's **Reviews** tab, choose the **Result**, the day it was **Reviewed on**, who **Reviewed by** (empty records your name) and any **Notes**, and select **Record review**.

The owner of a document is reminded 60 and 30 days before its review and on the day, then weekly while it is overdue. An external document's owner is asked to check for a new edition. A bulletin past its expiry date is offered for retirement. Reference documents are never reviewed.

## Printing

**Print or save as PDF** on a version gives a controlled copy: every page has a header with the organization, the document number, the title and the version, and a footer with the version, the effective date, the page, when and by whom it was printed, and "Uncontrolled when printed: the current version is in the document library". A draft, superseded or obsolete version is marked **DRAFT**, **SUPERSEDED** or **OBSOLETE** diagonally across every page, whether it is written text or a PDF original, and a restricted document says **Restricted distribution** in the header. A version kept as a PDF is stamped with the same header and footer. Every print and download is recorded.

### Paper copies

Where numbered paper copies of a document are handed out (a binder at each depot, a copy in a training room, a copy for a supervisor), keep their register on the document's **Paper copies** tab. Select **Issue a copy** and name who holds it (a person with an account, or a name or place such as "North depot operations binder"), where it is kept, and the day it was issued; the copy gets the next number unless you give one. A copy is always of the version in force.

When a later version takes effect, or the document is made obsolete, every copy of an earlier version still out is marked **Due for recall**. The document's owner (or, without an owner, whoever issued the copy) is told once and has each copy in **My work** under **Paper copies to recall** until it is recorded: select **Recall** on the copy, give the day it was collected (or destroyed) and a note. **Remove** takes a copy entered by mistake out of the register. Issuing, recalling and removing are recorded in the document's history. In data load mode a copy can be issued (and recalled) on past dates; the Data loads page lists copies loaded that way.

## Acknowledgment

Readers are asked to acknowledge a document only when **Readers must acknowledge** is on: by default for policies, rulebook sections and bulletins. Everyone asked must be able to read the document; publishing asks only the people in the audience who can.

### Choose who must acknowledge

On the **Document** tab, in **Who must acknowledge**, select **Change**.

- Check **Everyone** to ask every active user who can read it, or
- choose one or more **Roles** and **Departments**. A person is asked if they hold any of the roles or belong to any of the departments.
- Set **Days to acknowledge** (14 unless changed).

Select **Save audience**. The choice is used the next time a version is published; it does not change requests already sent.

#### Staff on the roster

Frontline staff often have no account. If the roster is in use (see [People and qualifications](29-people-and-qualifications.md)), **Who must acknowledge** also offers **Ask staff on the roster too**. Check it and choose the **Positions** whose people must acknowledge (with **Everyone** checked, everyone on the roster is asked). When a version is published, each active person on the roster in those positions gets a request with the same due date. A person whose account was already asked through the roles or departments above is not asked twice.

### What publishing does

When a version comes into force:

- each active user in the audience who can read the document gets a request to acknowledge that version, with a due date, and a notification (**Please read and acknowledge** and the document) that opens it for them to read;
- requests for earlier versions that were never answered are closed;
- everyone is asked again, including people who acknowledged an earlier version, because the text has changed, unless the version was published as a **Minor change**.

A document loaded with its history in data load mode asks nobody (see [Import a document package](#import-a-document-package)).

### Acknowledge a document

1. Open **My work**, then **Acknowledgments**, or the notification. The tiles count what is **Waiting for me**, what is **Overdue** and what you have **Acknowledged**. **Awaiting my acknowledgment** lists what you have been asked to read, most urgent first, each with its due date.
2. Select **Read and acknowledge**. The document opens in a page of its own, with its summary, what changed in this version, and the text.
3. Read it. At the bottom, check **I have read and understood this policy**.
4. Select **Acknowledge**. **Not now** goes back to your list without recording anything.

The document moves to **Already acknowledged**; select its name to read the same text again. The date and time of your acknowledgment are recorded against the version you read.

In the self-service portal, on the kiosk and in the mobile app, a person who chose another language reads the version's translation in it when there is one, and the acknowledgment also records the language they read (see [Translate a version](#translate-a-version)).

### Track acknowledgment

Open the document's **Acknowledgments** tab.

- The bar and tiles show how many people have **Acknowledged**, how many are **Outstanding**, and how many are **Overdue** (outstanding and past the due date), each with a percentage.
- **People** lists who was asked. Use **Show** to switch between outstanding, overdue only, acknowledged and everyone.
- **By department** gives the same counts for each department.
- **Version** switches to an earlier version's record.
- An acknowledgment given in a translation says so after its date, with the stamp of the translated text read, for example (read in Spanish, text 1a2b3c4d).
- **Export CSV** downloads the list for the version shown, with a **Language read** column and a **Translation read (SHA-256)** column holding the full stamp.
- **Staff on the roster** (shown to people who can see the roster) lists the roster people asked, with their employee number, position, status, when and how they acknowledged (**Sign-in sheet**, **Kiosk** or **By hand**) and who recorded it, with the same counts.

### Record acknowledgments from a sign-in sheet

After a briefing, staff often sign a paper sheet. To record it (you need **Edit** on **Documents (policies)** and **View** on **People**):

1. Scan the sheet and add it to the document on its **Evidence files** tab.
2. On the **Acknowledgments** tab, under **Staff on the roster**, select **Record acknowledgments**.
3. Type or paste the **Employee numbers** from the sheet, one per line or separated by commas or spaces.
4. Leave **How** as **Sign-in sheet**, or choose **Recorded by hand**. Set **Acknowledged on** if the briefing was on an earlier day (never a later one).
5. Choose the **Scanned sheet** you added in step 1.
6. Select **Record**.

Everyone listed is recorded against the version in force, including people on the roster who were not asked. People who had already acknowledged are skipped, and employee numbers not on the roster are named in the message so you can check them.

In [data load mode](09-administration.md#data-load-mode), an administrator can record past acknowledgments: a reader's (by user name or email, disabled accounts too) with the date or time they acknowledged, and roster people's on the sign-in sheet form for an earlier version, with the time and the person who recorded them. The person must be one of the document's readers; one already recorded is left as it was. An AI assistant does the same with `record_acknowledgment` (see [AI assistants and MCP](21-ai-assistants-and-mcp.md)).

### The acknowledgment kiosk

The kiosk lets staff acknowledge for themselves on a supervisor's device, for example a tablet in a depot's crew room. It runs only while someone with **Edit** on **Documents (policies)** is signed in on that device; there is no page that works without signing in.

1. Sign in as the supervisor and open **Documents > Document library**, then the **Acknowledgment kiosk** tab (or **Open the kiosk** on a document's **Acknowledgments** tab).
2. The member of staff types the start of their name and picks it. Only people on the roster with something to acknowledge are listed, with their position, and only documents the supervisor can read and whose distribution reaches that person.
3. They enter their **Employee number** and select **Continue**. A wrong number is refused; after five wrong numbers for the same person within 15 minutes the kiosk stops accepting numbers for that person until 15 minutes have passed since the first of them, and each wrong number is recorded in the audit log. Numbers typed at the same moment on several devices count together. A right number clears the count.
4. They read each document, check **I have read and understood this document**, and select **Acknowledge**.

**Language** at the top of the kiosk lets each person choose English or Español for their turn. A document with a translation in that language is shown translated (and says so); one without is shown in the original. The next person starts again in the device's language.

The kiosk thanks them and returns to the list for the next person. Each acknowledgment is recorded with the method **Kiosk** and the signed-in supervisor as the person who recorded it. Sign out when you leave the device.

### Reminders

Once a day the application looks for acknowledgments that are past their due date. Each person who is overdue gets a notification (**Reminder: please read and acknowledge** and the document). The reminder is recorded in the document's **History** and its date is shown under **Last reminder**. A person is reminded again every 7 days until they acknowledge.

To change the 7 days, a document controller opens the **Settings** tab, enters **Days between reminders** (1 to 90) under **Acknowledgment reminders** and selects **Save**. One document can have its own interval: on the document, select **Change** on **Who must acknowledge** and enter **Days between reminders**, or leave it empty to use the setting.

## Translate a version

Staff can choose to read the self-service portal, the acknowledgment kiosk and the mobile app in another language (English and Spanish today). A version can carry a translation for each of those languages; the version's own text stays the approved original.

1. Open the document's **Translations** tab. **Version** at the top right chooses which version (the one in force first).
2. Select **Translate** on the language's row (**Edit** once there is one). You need **Edit** on **Documents (policies)**; for the version in force you also need **Approve**, because staff read the change at once.
3. Write the **Title**, and if you like the **Summary** and **What changed**, in that language, and the **Text** in Markdown, as the original. **Read the original text** below the form shows what you are translating.
4. Select **Save translation**.

**Last changed** shows each translation's **text** stamp (the first characters of a SHA-256 fingerprint of its title, summary and text), which acknowledgments given in it record. A superseded version's translations are kept as they were, and so are an obsolete document's. Every change is in the **History**, with the text it replaced. Discarding a draft discards its translations too.

## Distribution groups

A distribution group is a named list of readers, such as "Network operations on-call" or "Maintenance supervisors", that many restricted documents can share. Changing a group changes who can read every document that uses it.

Document controllers open **Documents > Document library**, then **Distribution groups**. Each group shows its members, the roles and departments it also takes in, how many documents use it and its owner. **New group** (or **Edit** on a row) sets the **Name**, a **Description**, the **Owner** who keeps it up to date, the **Members** (type a name to add someone; the cross takes them off), and optionally **Everyone with these roles** and **Everyone in these departments**. A group still used by a document cannot be deleted. Each change is recorded in the audit log.

## Import a document package

A whole set of documents, with their history, can be loaded at once (document controllers). Open **Documents > Document library**, then **Import**, and **Choose a package**: a .zip with the documents' files and a `manifest.csv` with one row per version. Its columns: `doc_number`, `title`, `document_type`, `department`, `owner`, `parent_number`, `access`, `access_departments`, `access_roles`, `version`, `version_label`, `status`, `approved_on`, `effective_on`, `superseded_on`, `withdrawn_on`, `approved_by_name`, `approval_body`, `approval_reference`, `change_summary` and `file`. Word files are converted as described above; PDF and .doc files are kept as files.

The package is checked first in a **Dry run**, which changes nothing: tiles count the rows, those without problems and with errors, and the documents and versions that would be created; the table gives each row's result and any conversion warnings. Correct the manifest and choose the package again, or select **Load the package**. Rows with errors are left out. **Earlier imports** lists every dry run and load with its results.

With **data load mode** on (**Administration > Data loads**, see [Administration](09-administration.md)), the dates, statuses and numbers in the manifest are kept as given, historical versions create no acknowledgment requests, nobody is notified, and every document, version and file loaded can be undone. Without it, versions are loaded as drafts under today's date. An AI assistant can load a package the same way (see [AI assistants and MCP](21-ai-assistants-and-mcp.md)).

## Settings

Document controllers open **Documents > Document library**, then **Settings** (also the **Document settings** card on the **Administration** page):

- **Document numbers**: the **Pattern** new numbers follow. `{prefix}` is the type's prefix, `{dept}` the owning department's code, `{seq}` or `{seq:3}` the next number in that type and department (with at least three digits), `{year}` the year. The default is `{prefix}-{dept}-{seq:3}`, which gives numbers such as `SOP-IT-014`; a document with no department leaves the code and its dash out. An example under the field shows the effect.
- **Department codes**: the short code of each department in numbers, such as IT or HR, 1 to 10 capital letters or digits, each used once.
- **Acknowledgment reminders**: the days between reminders (see [Reminders](#reminders)).

Document types and their review cycles are a list under **Administration > Lists**.

## Plans

A plan, such as the safety plan, is a document whose **Document type** is **Plan** (or any type an administrator marks as a plan). Its page shows two more cards under the text: the **Plan elements** and the **Annual review**.

### Plan elements

**Plan elements** shows each element the plan must cover and where it does: one box per element, listing what covers it, the section of the plan and its owner. An element nothing covers yet is shown with a dashed border and "Not covered in the plan yet". The elements are a list an administrator keeps under **Administration > Lists** (**Plan element**); it starts with the four generic pillars of safety management: **Safety policy and objectives**, **Safety risk management**, **Safety assurance** and **Safety promotion**.

To change the map, someone who may edit documents selects **Edit map**, then for each entry chooses the **Element** and fills in **What covers it**, **Where in the plan** (for example "Section 2.1") and the **Owner**. **Add an entry** adds a row and the bin removes one. **Save** replaces the map; the change is recorded in the history.

### Annual review

A plan is reviewed by several parties in turn. **Start annual review** (needs **Edit** on **Documents (policies)**) starts the **Annual plan review** approval workflow (see [Approval workflows](22-approval-workflows.md)). Its first version asks, in turn, the **Accountable executive**, the **Governing body** and the **Safety committee**, each a different person who may approve documents; an administrator names the right people in each step under **Administration > Approval workflows**. The person who starts the review cannot approve it.

When the last party approves, the review is recorded as approved and the plan's **Next review** moves to a year from that day (or the review cycle of its type). A rejection is recorded with its reason, and the date stays. The **Annual review** card, and the **Reviews** tab with the periodic reviews, list every review. Only one annual review runs at a time.

A committee can decide a step of the review at a meeting (see [Committees and meetings](28-committees-and-meetings.md#apply-a-decision-to-a-waiting-approval)).

Once a plan's review date is within **30 days**, its owner (or, without one, everyone who may edit documents) is reminded once, and again once when the date is reached, unless a review is already running. An administrator can change the 30 days (**Remind plan owners before the annual review**, setting `policies.plan_review_reminder_days`) under **Administration > Reminders**.

The `dev` sample data includes an invented **[Sample] Safety plan** with its element map and last year's approved review.

## Map a document to framework outcomes

Open the **Mapped outcomes** tab to show which framework outcomes the document helps to meet.

1. In **Add an outcome**, search by code or words and pick the outcome.
2. Select **Map outcome**.

Select the cross on a row to remove a mapping. The document also appears on the outcome's **Related** tab. See [Cybersecurity frameworks](05-cybersecurity-frameworks.md). An external document that is the source of a framework (for example a published standard) names that framework in **Source of framework**.

## Exceptions

An exception is a time-limited, approved deviation from a policy or standard: something that does not comply, the reason, what is done instead to reduce the risk, who agreed to it and until when.

Open **Documents > Exceptions**. The tiles count exceptions **Awaiting decision**, **In force** and **Expired**; select one to see them.

Two tabs sit under the tiles:

| Tab | Shows |
|---|---|
| **Register** | The whole register, with search, **Filters**, export and the saved views **Awaiting decision**, **In force**, **Expired** and **Requested by me** in the **View** menu |
| **Expiring soon** | Approved exceptions that run out in the next 30, 60, 90 or 180 days, and those already expired. The document each one belongs to is shown only to people who can read it |

### Request an exception

1. Select **New exception**, or **Create** then **Exception**. From a document, use its **Exceptions** tab to have the document filled in.
2. Enter the **Title** and choose the **Policy**.
3. Describe **What is the deviation**, the **Justification** and the **Compensating controls**.
4. Enter the date you would like it to run to in **Expires on**.
5. Select **Create exception**.

The exception gets a reference such as `EXC-00012` and the status **Requested**. You are recorded as **Requested by**.

### Approve or reject

1. Open the exception and select **Approve**.
2. Enter the **Approver** (leave it empty to record your own name) and **Approver role**.
3. Enter **Expires on**. An exception cannot be approved without an expiry date, and the date cannot be in the past.
4. Check **Approved on**. Leave it empty to record today. The expiry date cannot be before it.
5. Select **Approve exception**.

Select **Reject** to refuse the request.

### Exception statuses

| Status | Meaning |
|---|---|
| **Requested** | Waiting for a decision. The deviation is not yet permitted |
| **Approved** | In force until the expiry date |
| **Rejected** | Refused |
| **Expired** | The expiry date has passed. Set automatically, once a day |
| **Withdrawn** | Closed by the requester, or ended early |

While an exception is approved, its page shows the expiry date with a countdown: green with more than 30 days left, amber inside 30 days.

- **Withdraw** closes a request, or ends an approved exception early.
- **Request again** puts a rejected, withdrawn or expired exception back to **Requested**. It then needs a new approval and a new expiry date.

An administrator can limit which status changes are allowed, and who may make them, under **Administration > Lifecycles**; see [Lifecycles](23-lifecycles.md). The rules above always apply as well.

### Link a risk

If the deviation is on the risk register, edit **The exception** card and choose the **Linked risk**. Risks are restricted records, so the field is only useful to people who can see them; others see "Restricted". See [Risks, actions and obligations](06-risks-actions-obligations.md).

## Old addresses

The pages moved to the **Documents** menu in this release. Old links keep working: **Policies** (`/policies`) opens the register, the acknowledgment kiosk's old address opens the kiosk tab, and **My acknowledgments** (`/policies/acknowledgments`) is the **Acknowledgments** tab of **My work**.

## Sample data

Documents and exceptions whose titles start with **[Sample]** are invented examples loaded with the `dev` sample data; the `pilot` profile a real installation uses loads none. Make them obsolete or delete them when you no longer need them.
