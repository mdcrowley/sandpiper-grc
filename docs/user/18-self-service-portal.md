# Self-service portal

The self-service portal is a simple page for any member of staff (a bus operator, a depot supervisor, a finance clerk) to report a problem, ask for something, and follow what they asked for, without the screens IT use. It works on a phone as well as on a computer.

The portal needs the service desk: under **Administration > Features** it cannot be on while the service desk is off. **Report a safety concern** appears only while **Safety management** is on (see [Administration](09-administration.md#features)).

The portal is switched off when the application is installed. An administrator switches it on (see [Settings for the service desk](#settings-for-the-service-desk)) and gives people the **Requester** role.

## Opening the portal

Sign in as usual. If the portal is all your account includes, you go straight to it. If you also use other parts of the application, open **Self-service portal** in the **Home** group of the sidebar. In the portal, the menu under your initials has **Open the full application**.

At the top of every portal page:

- **Home** and **My requests**.
- The bell, for your notifications (for example "New reply on your request TKT-00041").
- The moon or sun button switches between the dark and light themes.
- The menu under your initials: **Change password**, **Sign-in security**, and **Sign out**.

## Home

- **Service status banner**: when the service desk has posted a message (for example "Real-time bus arrival screens are down at the central station; we are working on it."), it is shown first, colored by how serious it is: **Service update**, **Service warning**, **Service problem** or **Service restored**.
- **What do you need help with?**: type a few words. Help articles that match appear below as you type; select one to read it. **Report "…" as a problem** starts a report with your words filled in.
- **Report a problem**: something is broken or not working.
- **Ask for something**: access, equipment, a new starter and the other requests the service desk offers.
- **Report a safety concern** (when your organization takes safety reports in the portal): an accident, an injury, a near miss or something unsafe. See [Report a safety concern](#report-a-safety-concern).
- **My requests**: your open requests, newest first, each with its status in plain words. A request waiting for your answer has an amber edge, and a line above the list says how many are waiting. **See all** opens the full list.
- **Popular requests**: the first requests from the catalog. **See all** lists every one.

Depending on your account and on what is installed, the right-hand side (below, on a phone) also shows:

- **My approvals**: requests and changes waiting for your decision (see [My approvals](#my-approvals)).
- **My safety reports**: the last safety reports you made, with their status.
- **Policies to acknowledge**: policies you have been asked to read, with the date to read them by.
- **My training**: courses due, and how many you have completed.
- **My equipment**: equipment recorded as used by you, each with **Report a problem**.

## Ask for something

Select **Ask for something** (or a tile under **Popular requests**). Choose what you need; type in **Find a request** to narrow the list. If it is not listed, select **describe it in your own words** to report it instead.

The form asks the questions for that request. Those marked with a star are required. Then:

- **Anything else we should know?** for extra detail.
- **Where are you?**: site, depot, station or vehicle number, if it matters.
- **Who is this for?**: **Me**, or **A colleague** (see [Raise a request for a colleague](#raise-a-request-for-a-colleague)). Shown only when the service desk allows it.
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

Under **Who is this for?** you can choose a colleague instead of yourself, as on any request.

Select **Send**. Your two answers set how the service desk prioritizes the problem; you never choose a priority or a person yourself. For anything that affects safety, follow your local safety procedure first, then use **Report a safety concern**.

## Raise a request for a colleague

A supervisor can raise a request for one of their team, for example for an operator who has no computer at hand. On the form, under **Who is this for?**, choose **A colleague**, type at least two letters of their **Colleague's name** and select them; **Change** picks someone else.

- You stay the requester; the colleague is recorded as the affected person. They are told, see the request under **My requests** ("Raised for you by …"), can reply on it, and you see "You raised this for …".
- As installed you can choose only colleagues in your own department. The service desk may allow anyone, or nobody (the choice is then not shown).

## Report a safety concern

Select **Report a safety concern** on the home page. If someone is in danger now, call the emergency services and follow your local safety procedure first, then report it here. Fill in:

- **What happened, in a few words?** (required) and **When did it happen?** (required; it starts at now).
- **What kind of event was it?** (required): for example **Collision**, **Near miss**, **Slip, trip or fall** or **Unsafe condition**.
- **How bad was it?** (required): **Nobody was hurt and nothing was damaged**, **A minor injury or minor damage**, **Someone needed first aid or treatment**, or **A serious injury or major damage**. Your best guess is fine: the safety team checks it.
- **Where?**: site, station, stop, depot, or vehicle or route number.
- **Describe what happened** (required), and optionally **What was done straight away?** and **How many people were hurt?**
- **It involves someone's health or other personal details**: check it so that only the people allowed to see personal information see the details. Please do not write medical details.

Select **Send report**. You get a reference (for example SE-00104). The safety team is told and triages the report in their safety events list, where it has the status **Reported**. **My safety reports**, under the form and on the home page, shows each report you made with a plain status: **Received**, **Being looked into** or **Closed**. A report marked as holding personal details shows its reference only.

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
| **Canceled** | Canceled; nothing more will happen |

You see the requests you raised and those raised for you (where you are the affected person). Nobody else's.

## One request

Open a request to see:

- Its reference, title and status, with who is looking after it.
- **What you told us**: your answers, details, when you sent it, and **Your files**.
- **Files from the service desk**: files IT have shared with you, to download (for example instructions or a report). Only files IT choose to share appear here.
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

Some requests need more than one approval ("Needs 2 approvals: 1 given so far"), or may be approved only by the people named for them; you see only the requests you may still decide, and never your own.

## Settings for the service desk

Open **Service desk settings** in the **Administration** group and choose the **Self-service portal** tab. Reading needs permission to see tickets; changing the settings needs permission to administer the service desk.

- **Portal**: **Self-service portal switched on**. Only an administrator can switch it on or off (it is the same switch as under Administration, Features). People use the portal with the **Requester** role, which an administrator switches on under Administration, Roles. **Open the portal** goes there.
- **Service status banner**: write the **Message**, choose **How serious** (**Information**, **Warning: some things may not work**, **Service problem: something is down**, **Restored: back to normal**) and select **Save banner**. **Clear banner** removes it.
- **Wording and reopening**: the **Portal title**, the **Days a requester may reopen a resolved request** (0 means never; at most 90) and the **Welcome line**. Select **Save**.
- **Requests for colleagues and safety reports**: **Who may raise a request for a colleague** (**Anyone, for a colleague in their own department**, the default; **Anyone, for any colleague**; or **Nobody**), and **Staff can report a safety event** (on by default; shown when the safety module is in use). Select **Save**.
- **What staff can ask for**: a switch for each active catalog item. Items switched on appear in the portal with their questions; the others stay for the service desk only. **Edit item** opens the item. Changing these needs permission to edit tickets.

Every change is recorded in the audit log.

## What staff can and cannot do

A person with only the Requester role can raise requests (for themselves, or for a colleague when allowed), read and reply on their own, add files to them, download files IT shared with them, rate and reopen them, report safety concerns, read articles for all staff, and acknowledge policies. They cannot open the service desk or safety screens, search or export tickets, see anyone else's requests, see internal notes, see files IT did not share, or set a priority, an assignee or any internal field. Custom fields an administrator adds to tickets are not asked in the portal, even when marked required; the service desk fills them in.

Staff can also email the service desk address when email to ticket is set up: see [Email to ticket](02-service-desk.md#email-to-ticket).

## Not available yet

- Following a safety report's investigation in detail from the portal (only its status is shown).
