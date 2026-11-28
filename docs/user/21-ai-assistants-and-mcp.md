# AI assistants and MCP

You can use Sandpiper GRC from an AI assistant such as **Claude Desktop**, **Claude Code** or any other client that speaks the **Model Context Protocol (MCP)**. You ask in plain words ("what is overdue in my team?", "summarize the open security incidents", "draft a board summary") and the assistant looks the answers up in Sandpiper GRC for you.

Tools that work with a part of the application an administrator has switched off under **Administration > Features** (for example the fleet and safety tools) are not offered, whatever the token allows, and record types of that part are not listed (see [Administration](09-administration.md#features)).

The assistant always works **as you**: it sees only what you can see and can do only what you can do. It cannot delete anything. Everything it changes is recorded in the record's history, naming the token it used.

## Switching it on (administrators)

AI assistant access is **off** until an administrator switches it on.

1. Open **Administration**, then **AI assistant access**.
2. Turn on **AI assistant access (MCP)**. You are asked for your password if you have not given it in the last few minutes.
3. Leave **Write access for AI assistants** off unless people need assistants to create or change records. While it is off, every assistant can only read, whatever its token allows.
4. Under **Tools**, clear any tool you do not want assistants to use, then select **Save tools**. **Allow all** checks them all again.
5. **Requests a minute per token** limits how fast one assistant can call (120 to start with); the count is kept in the database, so it holds however many server processes share it. Select **Save limit** after changing it.

**Who may connect an assistant**: leave it at **Everyone who holds a permission**, or choose **Only people in chosen roles** and pick the **Roles**, then select **Save who may connect**. It applies at once: assistants of people outside those roles are refused on their next request, and those people can no longer make assistant tokens or approve connectors.

**Tools by role** narrows the tools offered to the assistants of people in a role: choose tools beside a role, or leave it on **Every allowed tool**, then select **Save tools by role**. Someone in several roles gets the tools of all of them, and a role left empty does not narrow anything for the people who hold it. People can narrow their own connections further.

The **Call log** shows, for the last 30 days, each assistant token with its owner, the number of calls and failed calls, when it was last used and the tools it used most. **Latest calls** lists the most recent calls one by one. To stop a token at once, revoke it under **Administration**, **API tokens** (assistant tokens carry the permission `mcp.use`).

**Latest calls** also shows each call's request id, which matches the request id on the audit events the call caused.

**Browser origins** is normally left empty: requests that come from a web page are refused, so that a page cannot use someone's token. List an origin only for a browser-based MCP client you trust.

### Sign-in for remote connectors (administrators)

Some assistants connect from the provider's cloud instead of from someone's computer, for example Claude's **custom connectors**. They do not take a pasted token: the person is sent to Sandpiper GRC to sign in and approve the connector (OAuth). This is off until you switch it on, and it works only when Sandpiper GRC is reached over **HTTPS** at an address the connector can reach (set the public address under **Settings** first).

1. Under **Sign-in for remote connectors (OAuth)**, turn on **Let connectors sign in (OAuth 2.1)**.
2. Decide how connectors are added:
   - Turn on **Let connectors register themselves** to let any connector introduce itself the first time someone connects it. Each person still has to approve it.
   - Or leave it off and select **Add a connector** for each connector you trust: enter its **Name** and its **Redirect addresses** (from the connector's documentation), and check **The connector keeps a client secret** only for connectors that run on a server. Give the **Client id** (and the **Client secret**, shown once) to the people who will use it.
3. Newer connectors identify themselves by a **web address** instead of registering: the address of a small document published by the connector's maker that describes it (a client ID metadata document). Sandpiper GRC must fetch that document, so this needs **Allow outbound connections** under **Settings** > **Outbound connections** as well. Under **Connectors known by their web address**:
   - Turn on **Accept connectors known by their web address**.
   - In **Hosts they may come from**, list the hosts you trust, one per line (for example `assistant.example.org` or `*.example.net`), then select **Save hosts**. Leave it empty to accept any public host.
   - Turn on **An administrator approves each new connector first** if you want to look at each new connector before anyone can connect it. A new one then appears in the table as **Waiting for approval**; select **Approve** to let people connect it.

   Sandpiper GRC fetches the document only from public addresses, never follows a redirect, reads at most 5 KB within 5 seconds, and keeps the document for up to a day. A document that is not exactly right (for example one naming a different address, or asking to keep a secret) is refused, and the person connecting sees why.
4. The table lists the connectors with where they return to, how they were added (**By an administrator**, **Registered itself** or **Known by its web address**, with the host the document comes from) and how many people are connected. **Remove** stops a connector and ends all its connections; a connector known by its web address then stays refused, listed under **Removed connectors known by their web address**, until you select **Allow again**. **Connections people approved** lists each person's connection; **End** stops one.

Turning sign-in for connectors off ends every connector connection at once. Turning off **Accept connectors known by their web address**, or outbound connections, ends the connections of those connectors at once.

Turning **AI assistant access (MCP)** off refuses every assistant immediately. Assistant tokens are personal API tokens too, so they still work with the REST API within their permissions; revoke them to stop that as well.

## Connecting your assistant

1. Open your account menu (your name at the top right), choose **Account security** and find the **Connect an AI assistant** card. The same card has a page of its own at `/account/ai-assistant`, and administrators can also select **Connect my assistant** on **AI assistant access**.
2. Select **Connect an assistant**.
3. Enter a **Name** that says which assistant and computer, for example "Claude Desktop on my laptop".
4. Choose **What it may do**:
   - **Read only: look things up and summarize** (the safe choice).
   - **Read and write: also create, update, comment and link** (offered when you can change records yourself; it works only while your administrator allows write access).
5. Choose when it **Expires after**.
6. Optionally, choose **Tools it may use** to limit the assistant to some tools (leave it empty for every tool your administrator allows), and enter **Allowed source addresses** to make the token work only from certain addresses (for an assistant on your own computer, `127.0.0.1` and `::1`).
7. Select **Make token**. Give your password if asked.
8. The token is **shown once**. Copy the configuration for your assistant from the tabs before you select **Done**:
   - **Claude Desktop**: download the bridge (**Download the bridge**), save it, enter **Where you saved the bridge**, then copy the `claude_desktop_config.json` entry. In Claude Desktop open **Settings**, **Developer**, **Edit Config**, add the entry, save and restart Claude Desktop. The bridge needs Node.js 18 or later on that computer.
   - **Claude Code**: copy the command **Over HTTP (recommended)** and run it in a terminal. If your setup needs a local command instead, use **Through the bridge**.
   - **Other MCP clients**: copy the `mcpServers` entry **Over HTTP (Streamable HTTP)**, or **As a local command (stdio)** for clients that only start local programs. Some clients name the fields a little differently; see the client's documentation.
9. Ask your assistant something, such as "What is waiting for me in Sandpiper?".

Your connected assistants are listed on the same card with what they may do, when they expire, when they were last used, how many calls they made in 30 days, how many tools they may use and any address limit. Select **Tools** to change which tools one may use, and **Disconnect** to stop one at once.

### Connecting a remote connector by signing in

When your administrator has switched on sign-in for remote connectors, the card also shows **Connect a remote connector by signing in (no token needed)** with the address to give the connector:

- **Claude** (claude.ai or Claude Desktop): open **Settings**, **Connectors**, **Add custom connector**, give it a name and the address (it ends in `/mcp`), then select **Connect**. If your administrator gave you a client id, enter it in the connector's advanced settings.
- **Claude Code**: run the command shown (`claude mcp add --transport http sandpiper <address>/mcp`), then type `/mcp` in Claude Code and choose the server to sign in.
- **Other MCP clients** that support sign-in: give them only the address.

The connector sends you to the **Connect an AI assistant** consent screen in Sandpiper GRC (sign in first if asked). It shows which connector is asking, that it will act as you, and where you will return. Allow only if it is the assistant you just started connecting. Choose **What it may do** (**Read and write** is offered only when the connector asked for it and you can change records yourself) and **Allow for** (how long before it must sign in again), then select **Allow** and give your password if asked, or select **Decline**. You return to the assistant, connected.

If the connector is known by its **web address**, the consent screen shows, at the top, the **host** that published its description, with the full address. The connector's name is only what that description says about itself: anyone can publish any name, so allow only if you trust that host. When the connector returns to an address on your own computer (such as `127.0.0.1`), the screen warns you: any program on your computer could receive the answer, so allow only if you started the connection yourself, just now. If the screen says the connector is **waiting for an administrator**, ask an administrator to approve it.

Connectors you approved are listed on the card as **Signed in**; select **Disconnect** to end one at once.

If the card says AI assistant access is switched off, ask an administrator.

## What an assistant can do

With a **read only** connection it can:

- list the kinds of record you can see and their fields, search everything you can see, list and filter records, read a record with its comments, related records and history;
- summarize **your work** (tickets assigned to you, your actions, changes waiting for your approval, policies to acknowledge, unread notifications) and **what is overdue**;
- show the **risk heat map**, **framework progress**, **security incident clocks** (notification deadlines), **contracts nearing their notice date**, **vulnerabilities**, **service desk metrics**, **fleet equipment gaps** and the **safety summary**, where you may see them and those parts of the application are in use;
- give the **figures** of the program areas, where you may see them and those parts are switched on: **audits and inspections**, **controls**, **corrective action plans**, **funding**, **committees and meetings**, **qualifications** (the roster and training), **business continuity**, **asset condition**, **OT security**, **records requests** and the **vendor lifecycle**. These answers are counts and percentages only: they never name a person, a requester or a record, and they are the same figures you see on the dashboards;
- list the **approvals waiting for your decision** ([Approval workflows](22-approval-workflows.md));
- run a **saved report** you can open;
- say **what is affected if a system fails**: the systems that depend on it, and the sites, data, assets, vehicles and services involved, where you may see them;
- **search the audit log**, if you may read it: for example everything one request did (give it the request id shown with an error or in the call log), or what happened to a record in a time span. It sees who, when and what, never the values before and after a change;
- read the pages of this user guide;
- **find and read controlled documents** you may read (policies, plans, procedures, standard operating procedures, forms, external and reference documents): by words, type, department, status or review state; one document with its versions, their labels and dates, the text of a version (or the text read from its PDF), its place under other documents and its links; the **register figures** (the same for everyone); and a **check** of documents for problems such as two versions in force at once, gaps between versions' dates or missing original files.

A document whose distribution leaves you out does not exist for the assistant either: it is not found, not read and not named, although the register figures count it, as they do on screen.

For the longer summaries (your work, what is overdue, framework progress, saved reports and what a failure affects) the assistant can show progress while it works, if it supports that.

With a **read and write** connection, and while your administrator allows write access, it can also **create records**, **update fields**, **add comments** (internal notes unless asked otherwise), **link records** and **approve or reject** an approval step waiting for you (a rejection needs a reason, and it can never decide a request you made yourself). The same rules apply as on screen: required fields, allowed values and permissions. If something is not valid, the assistant is told which field and why.

**Building complete records.** When it creates or updates a record, the assistant fills the fields themselves rather than writing everything into the description. You and your sources can name things the way people do:

- a **linked record** (the affected system, the vendor, the site) by its reference, such as `SYS-00012`, or by its exact title, when only one record you can see has that title. If several do, or none, the assistant is told which ones it could have meant and nothing is saved;
- a **person** by their user name, email address or exact display name (or "me"). Disabled accounts can be named only in data load mode;
- a **choice** from a list (priority, category, status, custom selects) by its value or by the label you see on screen, in any case;
- a **date** as 2024-03-05, 03/05/2024 (month first), "March 5, 2024" or "5 March 2024".

Each answer tells the assistant what every name was matched to, which optional fields are still empty and which kinds of related record (such as a vendor's contracts and contacts) have none yet, so it can fill in what your sources give. When you ask it about a kind of record, it also learns the related kinds, the help text of custom fields and their choices.

**Files and links on any record.** It can **attach a file** to any record you may edit, such as a ticket, an asset, a vendor or a contract (the file is uploaded in parts of at most 1 MB and checked and scanned like any upload), **attach a link** to a document kept elsewhere, keep either as **evidence** with the date it was collected and when it expires, and **list the files and links** on a record. It can also **use a record of the evidence library** for another record (`link_evidence`: the evidence by its reference, such as EVD-00012, and the record, optionally a part of it such as a review area `area:FM`), so the same evidence serves several controls, audits and reviews without being uploaded again; linking again only changes how it relates.

With a read and write connection and the right to write documents, it can also **upload files** (in parts of at most 1 MB, checked and scanned like any upload), **preview the conversion of a Word file**, **create or update a document** by its number, **add a version** (as Markdown text, or from an uploaded Word file, which is converted with its images kept, or from a PDF or older file, kept as the original), **set who may read a document**, **link a document** to controls, obligations, systems, courses, framework outcomes and other documents, and **record a review**. Outside data load mode a new version is always a draft, to be sent for review and approved in the application. In data load mode it can also **record past acknowledgments** of a version by its readers (`record_acknowledgment`, below).

Assistants also offer ready-made requests: **Weekly risk and action review**, **Prepare a board summary**, **Triage open tickets**, **Incident status update**, **Load a document package** and **Load records from source files**.

## Loading historical records

To load past records from source documents (for example a service desk's old tickets), an administrator switches on [data load mode](09-administration.md#data-load-mode) under **Administration > Settings**, for a few days. Then, for an administrator's **read and write** connection, while write access for assistants is on:

- **list_record_types** says that data load mode is on and until when, and for one type lists the extra fields it may set;
- **create_record** and **update_record** may also set the read-only fields (for a ticket `opened_at`, `first_responded_at`, `resolved_at`, `closed_at`, `response_due_at`, `resolve_due_at`, `response_breached`, `resolve_breached`, `paused_minutes`, the satisfaction answer and so on), any status, `created_at`, `created_by`, `updated_at` and the reference `ref`. Dates and times are given as ISO 8601, for example `2024-03-04T14:00:00Z`. Values given are kept; what is left out is worked out from the dates given. Field errors come back as usual, field by field;
- **delete_record** deletes a record that was created in data load mode, for example to correct a wrong load. It is offered only while data load mode is on, never deletes any other record, and is refused for a record under a legal hold;
- **record_acknowledgment** records that someone acknowledged (read and understood) a version of a document on a past date, for loading acknowledgment history from another system. Give the document, the version (default: the effective one), the person (a user name or email, disabled accounts too, or `person:` and a roster reference, email or employee number for someone on the people roster without an account) and the date or time. The person must be one of the document's readers: someone outside its distribution is refused. A roster person is recorded on the roster list as "recorded by hand" (with `as`, the person who recorded it, for example the supervisor with the sign-in sheet). One already acknowledged is left as it was. It is offered only while data load mode is on.

**Writing in other people's names.** While data load mode is on (and only for an administrator's token with write access), every tool that writes in someone's name (`create_record`, `update_record`, `add_comment`, `link_records`, `attach_file`, `attach_link`, `link_evidence`, `decide_approval`, `save_document`, `add_document_version`, `link_document`, `record_document_review` and `record_acknowledgment`) gains an `as` argument: the person who really wrote or did the thing. Give a user name or email (disabled accounts too), `person:` and a roster reference or email for someone on the people roster, or `name:` and a name for someone with neither. `add_comment` also takes `created_at`, the time the comment was written, and `attach_file` and `attach_link` take `created_at`, the date the file or link was first added; files and links attached in a load are undone with that load's files. The assistant is refused when the person is not found; it never writes as you instead. The audit log still records you and your token, "on behalf of" the person. For example: *"Load these 2021 records. Each row's 'Opened by' is the author; add the notes as comments in the names of the people who wrote them."* When data load mode is off the argument is not offered at all.

The person named is recorded everywhere the application keeps who did something, not only as the author of a record: who approved a document version, decided an access review account or a change, wrote an incident log entry or a project status report, entered an indicator value or a contract score, attested an obligation period, checked an asset out or in, verified a corrective action, recorded a training completion or a roster acknowledgment, and so on. Where the act has its own time (for example `decided_at` on an access review decision, `checked_out_at` and `checked_in_at` on an asset, `applied_at` on a meeting decision, a notification's time, a verification date), the time given in the load is kept instead of now. The usual rules apply to the person named: an access review decision is recorded only for the system's named reviewer, and the person who asked for an approval cannot decide it. Someone named only by `name:` has no account, so where the application needs an account (an approval decision, a disposal request) the load is refused for them.

Nothing is sent for loaded records: no notifications, email, webhooks or approvals. Every record loaded is listed under **Administration > Data loads**, where an administrator can delete everything one load created. For anyone who is not an administrator, and once data load mode ends, the assistant works as before.

### Loading records from source files

To load records such as vendors, assets, contracts or old tickets from spreadsheets, exports, reports and emails, use the ready-made request **Load records from source files**, naming the kind of record and the sources. The assistant then:

1. looks up the fields of that kind of record and of its related kinds (for a vendor: its contacts, contracts and systems), and what already exists, so nothing is created twice;
2. shows you which source column or section goes into which field, and asks when something has no place or needs a decision;
3. checks that data load mode is on when the original dates and authors must be kept;
4. for each record: creates it with every field the sources give (people, linked records, dates, choices), then its related records, links to other records, the source files or links attached, and its history as comments in the order it happened;
5. fills what each answer says is still empty, checks a sample of records, and reports what it created, what each name was matched to, and what it could not place.

It never invents a value, a person or a date; it asks you instead.

### Loading a document package

An assistant such as Claude Desktop can load a whole set of controlled documents, for example a department's procedures with every older revision, keeping the organization's own numbers and the original approval, effective and superseded dates. Use the ready-made request **Load a document package** and tell it which folder to load. It then:

1. lists the files, leaving out Office lock files (names starting with `~$`) and thumbnail caches, and groups them into documents and versions;
2. proposes, for your approval, each document's number, title, type, owner, department, parent document and readers, and each version's label, status and dates, marking what it had to guess;
3. checks that data load mode is on (without it, dates and statuses are not kept and every version is a draft);
4. creates each document, then adds its versions oldest first: it uploads each original in parts, shows you what a Word file converts to (tracked changes, comments and anything left out, such as text boxes or SmartArt) and adds the version with its dates;
5. checks every document it loaded and reports what it loaded, which files were kept only as originals and why, and any problems left.

What happens to each kind of file:

| File | Kept as |
|---|---|
| Word (`.docx`) | Markdown text, with its headings, lists, tables, bold and italic text and links; its pictures become files on the document, shown in the text; the original `.docx` is kept on the version. A file with tracked changes is refused until you say to convert it as it is |
| PDF | The PDF itself is the version; its text is read for search. A scanned PDF with no text layer is found by title and number only (there is no text recognition) |
| Word 97-2003 (`.doc`) and other types | The original file only, with the note "Could not convert": open it in Word and save it as `.docx` to convert it |

The documents' distribution applies throughout: the assistant acts as you, so it can load into and read back only documents you may read. Documents loaded this way are listed under **Administration > Data loads** and can be undone there; the assistant can delete a document it loaded (and nothing else) while data load mode is on. The same package can also be loaded without an assistant, as a `.zip` with a manifest, under **Documents > Import** ([Importing and exporting](17-importing-and-exporting.md#importing-a-document-package)).

## What an assistant cannot do

- See anything you cannot see. Restricted records (security incidents, risks, vulnerabilities and anything marked restricted) stay invisible unless you have the permission to see restricted records.
- Delete anything (except, while data load mode is on, records an administrator's connection loaded), change settings, manage users, roles or tokens, or confirm your password.
- Act as anyone else.

## Keeping it safe

- Choose **Read only** unless you really need changes, and the shortest expiry that will do. Limit the tools and the source addresses when you can.
- Keep the token in the assistant's configuration only. Anyone holding it can act as you within its limits. If it may have leaked, **Disconnect** it.
- Read what the assistant proposes before you let it change records. Changes it makes appear in each record's **History** with the token's name and "via MCP".
- Be careful what you paste into an assistant from elsewhere: instructions hidden in a document or web page could ask it to do things you did not mean. A read-only connection limits the harm.
- Remember that what the assistant reads is sent to the assistant's provider. Follow your organization's rules on which information may be shared with it.
