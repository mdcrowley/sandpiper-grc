# Self-service portal

The self-service portal is a simple page for any member of staff (a bus operator, a depot supervisor, a finance clerk) to report a problem, ask for something, and follow what they asked for, without the screens IT use. It works on a phone as well as on a computer.

The portal is switched off when the application is installed. An administrator switches it on (see [Settings for the service desk](#settings-for-the-service-desk)) and gives people the **Requester** role.

## Opening the portal

Sign in as usual. If the portal is all your account includes, you go straight to it. If you also use other parts of the application, open **Self-service portal** in the **Home** group of the sidebar. In the portal, the menu under your initials has **Open the full application**.

At the top of every portal page:

- **Home** and **My requests**.
- The bell, for your notifications (for example "New reply on your request TKT-00041").
- The moon or sun button switches between the dark and light themes.
- The menu under your initials: **Change password**, **Sign-in security**, and **Sign out**.

## Home

- **Service status banner**: when the service desk has posted a message (for example "Real-time bus arrival screens are down at the central station; we are working on it."), it is shown first, coloured by how serious it is: **Service update**, **Service warning**, **Service problem** or **Service restored**.
- **What do you need help with?**: type a few words. Help articles that match appear below as you type; select one to read it. **Report "…" as a problem** starts a report with your words filled in.
- **Report a problem**: something is broken or not working.
- **Ask for something**: access, equipment, a new starter and the other requests the service desk offers.
- **My requests**: your open requests, newest first, each with its status in plain words. A request waiting for your answer has an amber edge, and a line above the list says how many are waiting. **See all** opens the full list.
- **Popular requests**: the first requests from the catalogue. **See all** lists every one.

Depending on your account and on what is installed, the right-hand side (below, on a phone) also shows:

- **My approvals**: requests and changes waiting for your decision (see [My approvals](#my-approvals)).
- **Policies to acknowledge**: policies you have been asked to read, with the date to read them by.
- **My training**: courses due, and how many you have completed.
- **My equipment**: equipment recorded as used by you, each with **Report a problem**.

## Ask for something

Select **Ask for something** (or a tile under **Popular requests**). Choose what you need; type in **Find a request** to narrow the list. If it is not listed, select **describe it in your own words** to report it instead.

The form asks the questions for that request. Those marked with a star are required. Then:

- **Anything else we should know?** for extra detail.
- **Where are you?**: site, depot, station or vehicle number, if it matters.
- **Add a photo or file** to attach files (they are sent once the request is created; **Remove** takes one off the list).

Help articles that might answer the question appear under **Before you send: these might help**. Select **Send request**. You see the new request, and a message gives its reference (for example TKT-00043).

A request marked as needing approval says "This needs a manager's approval before work starts". Its status is **Waiting for approval** until someone decides.

## Report a problem

Select **Report a problem** and fill in:

- **What is wrong?** (required): a few words. Articles that might fix it appear under **These might fix it straight away**.
- **More detail**: what happened, any error message, and what you have tried.
- **Where?**: site, depot, station, or vehicle or fleet number.
- **Who is affected?** (required): **Just me**, **My team, depot or station**, or **Passengers, safety or the whole service**.
- **How urgent is it?** (required): **I cannot work at all**, **I can work, but it slows me down**, or **It can wait**.
- **Add a photo or file** if it helps.

Select **Send**. Your two answers set how the service desk prioritises the problem; you never choose a priority or a person yourself. For anything that affects safety, follow your local safety procedure first.

## My requests

Select **My requests** at the top. Choose **Open**, **Finished** or **All**, and type in **Find** to search your requests by words or reference. **New** starts a problem report.

Each request shows its status in plain words:

| Status | Meaning |
|---|---|
| **Received** | The service desk has it; someone will pick it up soon |
| **Being worked on** | Someone in IT is working on it |
| **Waiting for you** | IT have asked you something; reply so they can carry on |
| **On hold** | Paused while IT wait on someone else, such as a supplier |
| **Waiting for approval** | A manager needs to approve it before work can start |
| **Not approved** | It was rejected; the reason is shown on the request |
| **Resolved** | IT think it is sorted; reopen it if not |
| **Closed** | Finished |
| **Cancelled** | Cancelled; nothing more will happen |

You see the requests you raised and those raised for you (where you are the affected person). Nobody else's.

## One request

Open a request to see:

- Its reference, title and status, with who is looking after it.
- **What you told us**: your answers, details, when you sent it, and **Your files**.
- **Messages**: the conversation with IT. You see the messages IT write to you; their internal notes are never shown. Your own messages are on the right.
- **Your reply** (or **Add a message**) with **Add a photo or file**, then **Send**. Replying to a request that is **Waiting for you** passes it back to IT.

When the request is resolved:

- **How did we do?**: select from one to five stars, add a comment if you wish, and select **Send my answer**. You answer once; your answer is kept as you gave it.
- **What was done**: how IT resolved it.
- **Still not right?**: select **Reopen**, say **What is still wrong?** and select **Reopen request**. This is possible for a number of days after the request was resolved (the date is shown); after that, raise a new request.

## Help articles

Articles written for all staff appear in the search on the home page and while you fill in a form. At the end of an article, **Was this helpful?** asks **Yes** or **No**; **Change my answer** lets you answer again. If an article did not help, **report the problem** starts a report.

## Policies to acknowledge

Select a policy under **Policies to acknowledge** to read it. When you have read it, select **I have read and understood it**. It then leaves the list.

## My approvals

People who approve service requests or changes see **My approvals** on the home page. Each item shows who asked and their answers (for a change, when it is planned). Select **Approve**, or **Reject** and then say **Why are you rejecting it?** and select **Reject** again. **Cancel** goes back.

## Settings for the service desk

Open **Service desk settings** in the **Administration** group and choose the **Self-service portal** tab. Reading needs permission to see tickets; changing the settings needs permission to administer the service desk.

- **Portal**: **Self-service portal switched on**. Only an administrator can switch it on or off (it is the same switch as under Administration, Settings). People use the portal with the **Requester** role, which an administrator switches on under Administration, Roles. **Open the portal** goes there.
- **Service status banner**: write the **Message**, choose **How serious** (**Information**, **Warning: some things may not work**, **Service problem: something is down**, **Restored: back to normal**) and select **Save banner**. **Clear banner** removes it.
- **Wording and reopening**: the **Portal title**, the **Days a requester may reopen a resolved request** (0 means never; at most 90) and the **Welcome line**. Select **Save**.
- **What staff can ask for**: a switch for each active catalogue item. Items switched on appear in the portal with their questions; the others stay for the service desk only. **Edit item** opens the item. Changing these needs permission to edit tickets.

Every change is recorded in the audit log.

## What staff can and cannot do

A person with only the Requester role can raise requests, read and reply on their own, add files to them, rate and reopen them, read articles for all staff, and acknowledge policies. They cannot open the service desk screens, search or export tickets, see anyone else's requests, see internal notes, see files IT attached, or set a priority, an assignee or any internal field.

## Not available yet

- Raising a request on behalf of someone else from the portal (IT can still do this, and fill in **Affected person account** so that person sees it).
- Seeing files the service desk attaches to a request; IT send things back as messages.
- Tickets created from email.
