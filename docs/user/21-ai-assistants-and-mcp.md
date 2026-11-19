# AI assistants and MCP

You can use Sandpiper GRC from an AI assistant such as **Claude Desktop**, **Claude Code** or any other client that speaks the **Model Context Protocol (MCP)**. You ask in plain words ("what is overdue in my team?", "summarize the open security incidents", "draft a board summary") and the assistant looks the answers up in Sandpiper GRC for you.

The assistant always works **as you**: it sees only what you can see and can do only what you can do. It cannot delete anything. Everything it changes is recorded in the record's history, naming the token it used.

## Switching it on (administrators)

AI assistant access is **off** until an administrator switches it on.

1. Open **Administration**, then **AI assistant access**.
2. Turn on **AI assistant access (MCP)**. You are asked for your password if you have not given it in the last few minutes.
3. Leave **Write access for AI assistants** off unless people need assistants to create or change records. While it is off, every assistant can only read, whatever its token allows.
4. Under **Tools**, clear any tool you do not want assistants to use, then select **Save tools**. **Allow all** checks them all again.
5. **Requests a minute per token** limits how fast one assistant can call (120 to start with). Select **Save limit** after changing it.

The **Call log** shows, for the last 30 days, each assistant token with its owner, the number of calls and failed calls, when it was last used and the tools it used most. **Latest calls** lists the most recent calls one by one. To stop a token at once, revoke it under **Administration**, **API tokens** (assistant tokens carry the permission `mcp.use`).

**Browser origins** is normally left empty: requests that come from a web page are refused, so that a page cannot use someone's token. List an origin only for a browser-based MCP client you trust.

Turning **AI assistant access (MCP)** off refuses every assistant immediately. Assistant tokens are personal API tokens too, so they still work with the REST API within their permissions; revoke them to stop that as well.

## Connecting your assistant

1. Open the **Connect an AI assistant** page at `/account/ai-assistant` (administrators can also select **Connect my assistant** on **AI assistant access**).
2. Select **Connect an assistant**.
3. Enter a **Name** that says which assistant and computer, for example "Claude Desktop on my laptop".
4. Choose **What it may do**:
   - **Read only: look things up and summarize** (the safe choice).
   - **Read and write: also create, update, comment and link** (offered when you can change records yourself; it works only while your administrator allows write access).
5. Choose when it **Expires after**, then select **Make token**. Give your password if asked.
6. The token is **shown once**. Copy the configuration for your assistant from the tabs before you select **Done**:
   - **Claude Desktop**: download the bridge (**Download the bridge**), save it, enter **Where you saved the bridge**, then copy the `claude_desktop_config.json` entry. In Claude Desktop open **Settings**, **Developer**, **Edit Config**, add the entry, save and restart Claude Desktop. The bridge needs Node.js 18 or later on that computer.
   - **Claude Code**: copy the command **Over HTTP (recommended)** and run it in a terminal. If your setup needs a local command instead, use **Through the bridge**.
   - **Other MCP clients**: copy the `mcpServers` entry **Over HTTP (Streamable HTTP)**, or **As a local command (stdio)** for clients that only start local programs. Some clients name the fields a little differently; see the client's documentation.
7. Ask your assistant something, such as "What is waiting for me in Sandpiper?".

Your connected assistants are listed on the same card with what they may do, when they expire, when they were last used and how many calls they made in 30 days. Select **Disconnect** to stop one at once.

If the card says AI assistant access is switched off, ask an administrator.

## What an assistant can do

With a **read only** connection it can:

- list the kinds of record you can see and their fields, search everything you can see, list and filter records, read a record with its comments, related records and history;
- summarize **your work** (tickets assigned to you, your actions, changes waiting for your approval, policies to acknowledge, unread notifications) and **what is overdue**;
- show the **risk heat map**, **framework progress**, **security incident clocks** (notification deadlines), **contracts nearing their notice date**, **vulnerabilities**, **service desk metrics**, **fleet equipment gaps** and the **safety summary**, where you may see them and those parts of the application are in use;
- run a **saved report** you can open;
- read the pages of this user guide.

With a **read and write** connection, and while your administrator allows write access, it can also **create records**, **update fields**, **add comments** (internal notes unless asked otherwise) and **link records**. The same rules apply as on screen: required fields, allowed values and permissions. If something is not valid, the assistant is told which field and why.

Assistants also offer ready-made requests: **Weekly risk and action review**, **Prepare a board summary**, **Triage open tickets** and **Incident status update**.

## What an assistant cannot do

- See anything you cannot see. Restricted records (security incidents, risks, vulnerabilities and anything marked restricted) stay invisible unless you have the permission to see restricted records.
- Delete anything, change settings, manage users, roles or tokens, or confirm your password.
- Act as anyone else.

## Keeping it safe

- Choose **Read only** unless you really need changes, and the shortest expiry that will do.
- Keep the token in the assistant's configuration only. Anyone holding it can act as you within its limits. If it may have leaked, **Disconnect** it.
- Read what the assistant proposes before you let it change records. Changes it makes appear in each record's **History** with the token's name and "via MCP".
- Be careful what you paste into an assistant from elsewhere: instructions hidden in a document or web page could ask it to do things you did not mean. A read-only connection limits the harm.
- Remember that what the assistant reads is sent to the assistant's provider. Follow your organization's rules on which information may be shared with it.
