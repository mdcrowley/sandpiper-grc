# Calendar feeds, work trackers and evidence links

Three ways the application works with the tools around it: a **calendar feed** puts your own due dates, reviews, meetings and changes in your calendar program; the **work-tracker bridge** sends records to an outside work-tracking tool and brings their status back; and an **evidence link** points at a document kept in your document store instead of a copy. Each connection is off until an administrator switches it on. Lists and record pages work as described in [Getting started](01-getting-started.md).

## Calendar feeds

A calendar feed is a secret web address that your calendar program reads, without signing in, to show the dated work you are involved in. It is your own: it shows only what you may see in the application at the moment it is read, and only records you own, are assigned to, or sit on (for meetings).

Open **Calendar feeds** from the menu under your name (top right). The entry is there only while an administrator has switched calendar feeds on (see [Switch calendar feeds on](#switch-calendar-feeds-on)); the page's address is `/account/calendar-feeds` (for example `https://grc.example.org/account/calendar-feeds`). If the page says calendar feeds are switched off, an administrator has not switched them on yet (see [Switch calendar feeds on](#switch-calendar-feeds-on)).

### Make a feed

1. Select **New feed**.
2. Give it a **Name**, for example "Work calendar".
3. Under **Kinds of date**, check what it shows. Only the kinds you may use are offered:

   | Kind of date | What appears |
   |---|---|
   | **My actions due** | Actions you own that are not closed, on their due date |
   | **Reviews of risks I own** | Risks you own, on their next review date |
   | **Obligations I own coming due** | Obligations you own, on their next due date |
   | **Reviews of policies I own** | Policies you own, on their review date |
   | **Exercises I own** | Exercises you own, on the exercise date |
   | **Changes I own, work on or approve** | Changes you own, are assigned to or were named to approve, over their planned window |
   | **Meetings of committees I sit on** | Meetings of committees you are a member of (with your account or your roster person), chair or are secretary of, at their time |
   | **Inspections assigned to me** | Inspections you are the inspector of that are not complete, on their due date |
   | **Tests of controls I own or operate** | Controls you own or operate, on their next test date, and planned tests where you are the tester |

   Other parts of the application, such as business continuity, records requests, vendor reassessments and asset condition, add their own kinds when they are switched on.
4. Choose **What each date shows**: **Titles** (what each date is about, for example "Action due: ACT-00042 Renew the depot certificate") or **Busy only** (only the kind of date, for example "My actions due", never what it is about). Busy only suits a calendar other people can see.
5. Select **Make feed**.

The feed's address is shown once, under **Your feed's address**. Select **Copy address**, then in your calendar program add a calendar from an address (it may be called "subscribe", "from URL" or "from internet") and paste it. The address is not shown again: if you lose it, make a new address (below).

A feed shows dates from 90 days ago to 365 days ahead. Each date links to its record in the application (you sign in to open it). Calendar programs read a feed every few hours, so a change can take that long to appear.

### What a feed shows and hides

- A feed is worked out each time it is read, as you: a record you can no longer see, or a kind of date your role no longer allows, drops out by itself.
- A restricted record (such as a risk or an action raised on one) appears only if you may see restricted records, and then as **Restricted record** unless the feed shows **Titles**.
- When an administrator switches a part of the application off under **Administration > Features**, its dates leave every feed until it is switched back on.
- If your account is disabled, your feeds stop answering at once.

### Edit, replace or revoke a feed

On **Calendar feeds**, each feed shows the kinds of date it holds, whether it shows titles, when it was made and when a calendar program last read it.

- **Edit** renames the feed or changes what it shows. Its address stays the same.
- **New address** makes a new secret address and stops the old one at once. Use it if the address may have been seen by someone else. Add the new address to your calendar program.
- **Revoke** stops the feed for good.

Anyone who has the address sees what the feed shows, so keep it to yourself as you would a password. You can have up to 10 feeds.

### Switch calendar feeds on

*Administrators.* Open **Calendar and work trackers** in the **Administration** group. Turn on **People may make calendar feeds**; you are asked to confirm your password. Switched off, every feed address answers "not found" until it is switched on again; the feeds themselves are kept.

The **Calendar feeds** card lists everyone's feeds with the person, the feed's name, what it shows and when it was last read, and marks feeds of disabled accounts. **Revoke** stops anyone's feed at once. Making, changing, replacing and revoking feeds is kept in the audit log; the secret addresses never are, and the application keeps only a fingerprint of each.

## Evidence links

A record's **Attachments** tab can hold links to documents kept elsewhere, as well as files. See [Link a document instead of attaching it](14-attachments-and-notifications.md#link-a-document-instead-of-attaching-it) for adding a link, recording that it was checked, and the reminder when a check is due.

## Work-tracker bridge

The work-tracker bridge sends a record to an outside work-tracking tool, where another team works on it, and brings the item's status back. It carries actions, and vulnerabilities while that part of the application is switched on. It speaks plain signed JSON over HTTPS: any tool that can receive and send a web request can be connected, with no product built in.

### Send a record to a work tracker

On a record page of a kind a connection takes (an action, for example), a **Work tracker** tab appears once an administrator has set up such a connection.

1. Open the **Work tracker** tab.
2. If there is more than one connection, choose the **Connection**.
3. Select **Send to** and the connection's name (or **Send to work tracker**).

You need permission to change the record. The record is sent within a minute. The tab then lists each work item with its connection, the item's reference and link (once the tool has sent them back), its status in the tool, and when it was sent and last updated. If sending failed, the reason is shown (for example "Outbound connections are switched off"); the application tries again, up to five times.

A restricted record is never sent unless the connection is set to include restricted records, and the tab does not offer such a connection for it.

### Status coming back

When the item changes in the tool, the tool sends its status back. The status is shown on the **Work tracker** tab. If the connection's status map names one of our statuses for it (for example the tool's "Resolved" as **Done**), the record moves to that status, as the person who sent it could move it: a move the record type's lifecycle does not allow them, or one that would wait for an approval, is not made, and the outside status is only shown. Each move is kept in the record's history as "Status brought back from the work tracker".

### Set up a connection

*Administrators.* Open **Calendar and work trackers** in the **Administration** group. The **Work-tracker connections** card says whether outbound connections are on; nothing is sent while they are off. Switch them on, and add the tool's host to the allowed hosts, under **Administration > Settings** (see [Administration](09-administration.md)).

1. Select **Add connection**.
2. Enter a **Name** and the **Address** where the tool receives new items (`https://`).
3. Under **Sends**, check the kinds of record it takes. Only kinds whose part of the application is switched on are offered; a kind a connection already holds stays stored while its part is off, and is sent again once it is switched back on.
4. Turn on **On** when it is ready. **Send new records by themselves** sends every new record of those kinds as it is created.
5. **Include restricted records** is off unless you may see restricted records yourself and switch it on.
6. Fill in the **Status map**: for each kind of record, which of our statuses each of the tool's statuses moves a record to, for example `{ "action": { "Resolved": "done", "In progress": "in_progress" } }`. Use the status values listed under **Administration > Lists**.
7. Select **Add connection** and confirm your password.

Three things are shown once, after you add the connection or select **New secrets**: the **Signing secret** (every item sent is signed with it), the **Secret for status updates sent back**, and the **Address the tool sends status updates to**. Copy them into the tool's settings now. **New secrets** stops the old ones at once. **Edit** changes a connection; changing the address, sending restricted records or switching a connection on asks for your password again. **Remove** stops a connection; items already made stay listed on their records.

### For the people setting up the tool

A new item is a `POST` to the connection's address with a JSON body:

```json
{ "event": "tracker.create", "link_id": "…", "connector_id": "…", "sent_at": "2026-11-21T15:00:00.000Z",
  "record": { "type": "action", "id": "…", "ref": "ACT-00042", "title": "…", "status": "open", "priority": "high",
              "due_on": "2026-12-01", "url": "https://grc.example.test/actions/…", "restricted": false } }
```

It carries the headers `X-GRC-Event: tracker.create`, `X-GRC-Timestamp` (Unix seconds), `X-GRC-Delivery` and `X-GRC-Signature: sha256=<hex>`, the HMAC-SHA256 of `<timestamp>.<body>` with the signing secret, as for webhooks. Any 2xx answer counts as received.

A status update is a `POST` to the status address (`/api/integrations/tracker/<connection id>/status`) with `{ "link_id": "…", "external_id": "WORK-1234", "external_url": "https://…", "status": "Resolved" }` (`link_id` the first time, then `external_id` is enough), the header `X-GRC-Timestamp` and `X-GRC-Signature` made the same way with the status-update secret over the exact body sent. An update is refused, always with the same "could not be verified" answer, when the timestamp is more than five minutes off, the signature is wrong, the same update was already accepted, or the connection is unknown or off. An update for a kind of record whose part of the application is switched off is kept on the item but does not move the record.

## Not available yet

- Calendar invitations sent by email: meetings and dates reach calendars through a feed you subscribe to.
- Adding or changing dates from your calendar program: a feed is read-only.
- Ready-made connections for particular work-tracking products: the bridge speaks signed JSON, which the tool or a small relay must accept.
- Comments and fields other than the status coming back from a work tracker.
