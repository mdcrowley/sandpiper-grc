# The mobile app

The **Sandpiper GRC** app for iPhone and Android is for work away from a desk: see what is waiting for
you, point the camera at an asset tag to act on the thing it is stuck to, report a problem or a hazard
with photos, look up and update records, decide approvals, acknowledge policies and read your
notifications. Administration, report building and framework work stay on the web.

The app signs you in to your organization's own Sandpiper GRC server, with the same account,
permissions and rules as the web. It sends nothing to anyone else: no analytics, crash reports or
advertising.

The app works only when an administrator has switched **Mobile app** on under **Administration >
Features** (see [Administration](09-administration.md#features)). It is off by default; switching it off
signs out every phone.

## Install the app

The app is in a test (beta) phase and is not in the App Store or Google Play yet. Your administrator
tells you which way your organization uses.

- **iPhone (iOS 16.4 or later):** install Apple's **TestFlight** app, then open the invitation you were
  sent by email or the public link, and tap **Install**. A test build stops working after 90 days; a
  newer one appears in TestFlight before then, so keep TestFlight's automatic updates on.
- **Android (Android 10 or later):** download the app file (`.apk`) from the link your administrator
  gives you. Your phone asks you to allow your browser or file manager to **install unknown apps**:
  allow it for this install. Your organization's device management may install the app for you
  instead.

## Connect to your server and sign in

1. Open the app. Type your **Server address**, for example `grc.example.org` (your administrator can
   tell you what it is), and tap **Continue**. The app remembers it.
2. The app checks the server. It says so if the address is wrong, if the server cannot be reached, if
   the mobile app is not switched on there, or if the app or the server needs updating first. The app
   always uses a secure (HTTPS) connection.
3. Tap **Sign in**. Your organization's sign-in page opens in the phone's browser: sign in as you do on
   the web, with your password and second factor, a passkey or your organization's single sign-on,
   then choose **Sign in** to let the app on this phone act as you. You are asked for your password
   (and second factor) if you have not given it in the last few minutes.
4. The window closes and the app opens **My work**.

The app never sees your password. What it keeps to stay signed in is held in the phone's secure
storage (the iPhone Keychain or the Android Keystore), and it stays signed in until you sign out, the
phone is signed out from the web, or it has not been used for a time your administrator sets (30 days
unless changed).

**Sensitive actions.** When the app needs you to confirm who you are (for example an approval that asks
for your password), it opens the same page with **Confirm it is you**; after you confirm, it carries on
with what you were doing. The confirmation lasts a few minutes, the same as on the web.

## Unlock with Face ID or a fingerprint

Under **Account**, turn on **Unlock with Face ID or fingerprint** to have the app ask for Face ID, your
fingerprint or your phone's passcode when it opens and after it has been in the background for a few
minutes. Your organization may require it; the switch is then on and cannot be turned off. The phone
must have a passcode, Face ID or a fingerprint set up. While the app is locked, **Sign out instead**
signs you out.

## The tabs

The app has five tabs along the bottom: **My work**, **Tag**, **Report**, **Search** and **Account**.

### My work

My work shows what is waiting for you: tickets assigned to you, your actions, approvals, inspections and
condition assessments due, policies to acknowledge and training due, and one section for each other kind
of your work that is overdue or due in the next 30 days: evidence requests, control tests, corrective
actions to verify, obligation periods to attest, vendor reassessments, certifications to renew or sign,
and the like (the same items as **My due work** on the web). Each section shows how many are
waiting and the first few. Tap an item to open it; "Show all on the web" opens the full list in your
browser (for the other kinds, your due work in the **Calendar**). The screen refreshes when you open it and when you come back to the app; pull down or tap
**Refresh** to refresh it yourself. The number on the My work tab is everything waiting at the last
refresh. Areas your administrator has switched off do not appear.

### Search

Type at least two characters to search everything you may see: names, references, comments and file
names. Results open in the app, or on the web for kinds of record the app does not show. With the box
empty, Search lists the records you opened recently (restricted records are never listed). **Clear
recent** empties the list, and signing out clears it too.

### Records

A record shows its summary, its key fields and the tabs Details, Activity, Comments and Files. You can
add a comment; to add or open files, use **Open on the web**. If you may edit the record, **Edit** shows
the fields you can change on the phone (for example status, assignee, location, condition, notes and
tag number). If someone else saved the record while you were editing, the app shows your value and the
saved value for each field and lets you choose which to keep. If a change needs fields the phone does
not show (a status that needs a resolution code, say), the app asks you to **Finish on the web**. While
a restricted record is open, screenshots are blocked on Android and the iPhone app switcher shows a
blank screen.

### Approvals and policies

**Approvals** lists the approvals waiting for you; **Acknowledgments** lists the policies you have been
asked to acknowledge. Open an approval to see what is being approved, then **Approve**, or **Reject**
with a reason (a reason is needed to reject, and the person who asked sees it). The same rules apply as
on the web: for example, you cannot decide two steps of the same request when the workflow forbids it,
and the app shows the server's explanation. When an approval asks you to sign in again, the app opens
the sign-in page; after you sign in, it sends your decision. Open a policy to read the version you were
asked about, then tap **Acknowledge**. When the version has a translation in the language you chose (see
[Language](#language)), you read the translation, with a button to read the original instead, and your
acknowledgment records the language you read it in.

### Tag

Point the camera at an asset tag. The app reads barcodes, 2D codes and the printed number at the same
time, on the phone, and outlines each tag it reads with how it was read (for example "QR code:
TA-118342"). One tag opens its tag card; several tags in view are listed to choose from. A number read
only as printed text is shown for you to check first: tap it if it matches the tag. A Code 39, Codabar or
ITF barcode, which has no check character, counts once it is read twice; hold the phone steady. Use the flashlight in
poor light, **Take a picture** for small, shiny or curved tags, **Choose a picture** for one already
taken, or **Type a number** (the camera folds away while you type, so the keyboard never hides the box;
tap **Type a number** again to bring the camera back). Pictures stay on the phone and are deleted unless you attach one to the
record from its card. The card shows what the thing is, where it is, who has it and recent activity,
and only the actions you may take: report a problem or hazard, quick updates, add a photo or note,
count it, record its condition, replace the tag, or open the full record. A tag in stock offers **Attach this tag**. See
[Asset tags](38-asset-tags.md) for tags themselves. The Tag tab is hidden while **Asset tags** is
switched off.

### Report

**Report a problem** raises a ticket; **Report a hazard or close call** raises a safety report. Started
from a tag card, the record is linked for you. Add a title, what happened, the site and where exactly,
and up to 10 photos, which are made smaller to fit your organization's limit. Tap **Send**: the report
is saved on the phone first and sent from there, so you can report with no signal at all (see
[Offline work](#offline-work)). The Report tab lists the reports saved on this phone: waiting for a
connection, being sent, **Arrived** with the new record's reference (for example TKT-00042) and how many
photos arrived, or **Needs attention**. **Dismiss** removes an arrived report from the list (it stays on
the server). The Report tab is shown only when you may report a problem or a hazard.

If you report through the self-service portal (the **Requester** role), **Report a problem** opens the
portal's own form: what is wrong, who is affected, how urgent it is, where it is (in your own words)
and photos. It arrives as a request you can follow in the portal, as from a tag card. **Report a hazard
or close call** is offered too while your organization takes safety reports in the portal; it asks how
bad it was in plain words. **Keep my name confidential** on that form sends the report without your name
stored with it, as in the portal: only the few people your organization names can see who sent it, each
look is recorded, and you are still told what was done (see
[Report a safety concern](18-self-service-portal.md#report-a-safety-concern)).

### Field work: inspections, condition and counts

**Report > Inspections, condition and counts** opens **Field work**: your inspections, the condition
assessments due for what you look after, and the open inventory counts you may join. All of it works
with no signal, from the offline package (download it while you have a connection: the list does it by
itself, or tap **Download now**).

- **Inspections.** Open one to run its checklist one item at a time, like the web's runner: **Pass**,
  **Fail** or **Not applicable**, a note (after a fail, what was found) and photos (**Take a photo** or
  **Choose a photo**). Items marked critical or needing a photo say so. Your answers are kept on the
  phone as you go, so you can close the app and carry on later; answers already given on the web are
  shown too. **Send the answers so far** sends them without completing. When every item is answered,
  **Complete the inspection** shows what the result will be, worked out with the server's own rules: a
  critical item failed means **Fail**, another item failed means **Pass with findings**, otherwise
  **Pass**; the score is items passed out of items passed or failed; an item that needs a photo must
  have one unless it is not applicable. Choose whether a finding is raised for each failed item, add a
  note, type your name to sign (and, if you like, sign with your finger: the drawing is added to the
  inspection as a picture), and tap **Complete and send**. The server works the result out again when it
  arrives, and records who signed. If the inspection was canceled on the web meanwhile, or you no longer
  have permission, it waits under **Needs attention** with the reason.
- **Condition assessments.** Choose a record from the list (or **Record condition** on a tag card), pick
  the condition on your organization's scale, how it was assessed, a note and photos, and tap **Save and
  send**. It is dated the day you made it, even if it arrives later.
- **Inventory counts.** Open a count to join it: the camera stays open in counting mode and **every tag
  it reads is counted**, once, with a vibration, so you can sweep a shelf. Each one shows at once what it
  is: **Found** (expected here), **Unexpected** (registered somewhere else), **Not covered** by this count,
  or **Not in the offline package** (the server says what it is when it arrives). A number read only as
  printed text is listed with **Count it** for you to check first, and you can type a number in **Tag
  number**. Each find is sent once; when it has arrived, the server's answer replaces the phone's (for
  example **Already found** when someone else counted it first). Several people can count the same place
  at once, on phones and on the web: their finds are put together on the server.

## Offline work

You can keep working where there is no signal, in a tunnel, a depot basement or out on the line.

- **Field work works offline**: inspections, condition assessments and inventory counts (see
  [Field work](#field-work-inspections-condition-and-counts)).
- **Reports work offline.** Write the report and add photos as usual and tap **Send**. The report is
  saved on the phone and sent on its own as soon as there is a connection: when the signal comes back,
  when you open the app, and every half minute while it is open. **Send now** on the Report tab tries at
  once.
- **Each report arrives once.** Every report and every photo carries its own identifier, which the
  server remembers for 7 days. If the connection drops while something is being sent, or the app is
  closed half-way, it is simply sent again and the server recognizes it, so nothing arrives twice. You
  never need to check before sending again.
- **What the forms need is kept on the phone.** While you have a connection the app downloads an
  **offline package**: My work, the choices the report forms offer (event types, severities, the sites
  you may see), your inspections due within the package's days with their checklists, the condition
  assessments due, the open inventory counts you may count, and the tag numbers of the records these
  cover. Without a connection the forms use it. The package is
  kept for a number of days set by your administrator (7 unless changed) and then deleted; the app
  downloads a fresh one, at most every hour, whenever it has a connection.
- **Needs attention.** If the server does not accept something (you no longer have permission, a field
  is not accepted, the record it was about was deleted), it stays on the phone under **Report > Offline
  work** with the server's reason. Nothing is thrown away by itself. Fix what the reason says (on the
  web if needed) and tap **Send again**, or **Discard** it. Photos of a report that needs attention wait
  for it. In the rare case that the server stopped while saving something, it says it cannot be sure
  whether it was saved: check on the web, then **Send as new** or **Discard**.
- **Offline work** (on the Report tab) shows what is waiting to be sent, what needs attention, and the
  offline package: when it was downloaded and when it will be deleted. **Download now** fetches a fresh
  one.

Everything kept for offline work is stored in the app's own protected storage on the phone, never in
your photo library or shared files, and is deleted when you sign out, when the phone is signed out, or
(the package) when it expires. Signing out warns you first if something has not been sent, and also
deletes inspections you started but did not send.

**Looking up tags offline.** Without a connection, the Tag tab looks the tag up in the offline package.
A record found there opens a short card (marked as found in the offline package) with what you can do
offline: report a problem or hazard about it, or record its condition. A tag of a record outside the
package is "not available offline": read it again once there is a connection.

## Notifications

Open **Account > Notifications** to see your in-app notifications, newest first: the same list as the
bell on the web. Unread ones are marked; opening one marks it read on the web too, and opens its record
when it is about one. **Unread only** shows just the unread ones, **Mark all read** (at the top of the list) marks them all
read, and pulling down refreshes the list. **Load more** at the end shows older ones, and **Try again**
appears when the list could not be loaded. A notification about a record you can no longer open says so,
without its details. To be told on your phone's lock screen, switch on push notifications (below); email
notifications continue as before.

## Push notifications

Under **Account > Push notifications**, switch on **Tell me on this phone**. The first time, the phone
asks whether the app may show notifications. From then on, the phone shows "You have N new
notifications" when something new reaches your notification list. The push never says what the
notifications are about; tap it to open **Notifications**. Pushes follow your notification choices:
kinds you switched off, or chose to receive by email only, are not pushed. Switching the switch off, or
signing the phone out (here or under Devices on the web), stops pushes to that phone. If the switch
says your organization has not set up push for this kind of phone, ask your administrator.

**Android phones without Google services** use UnifiedPush: install a UnifiedPush distributor app (your
administrator tells you which one and which push server it should use), then switch **Tell me on this
phone** on under **Account**. If you have more than one distributor app, the phone asks which to use.
**Account > Push notifications > Push app** shows the one in use; tap it to choose another. If no distributor app is
installed, the app says so. If a push cannot be delivered because the push service is busy or
unreachable, the server tries again for about two hours; the push then says how many notifications are
unread at that time.

## Account

**Account** shows who you are signed in as and to which server, with:

- **Notifications** (with the number unread), **Push notifications** and **Devices**.
- **Unlock with Face ID or fingerprint** (above).
- **Language** (see below).
- **About**: the app's version and **Open-source licenses**, the packages the app is built with. If your
  server recommends a newer version of the app, it says so here.
- **Sign out**.

## Language

Under **Account > Language**, choose **English** or **Español**. The tabs, My work, policies to
acknowledge, the Tag tab and tag cards, the Report tab and its forms, and the Account tab are then shown
in that language; the app goes back to My work as it changes. The choice is kept on your account (the
self-service portal uses it too) and on the phone, so the app opens in it without a connection. Records
and lists your organization wrote (record names, types, statuses, field names) are shown as they were
written, and so are the other screens (Search, records, approvals, field work), which are in English.
Signing out returns the app to English.

## Devices and lost phones

**Account > Devices** in the app, and **Devices** in your user menu on the web, list every phone signed
in with your account: its name, iPhone or Android, the app's version, when it signed in and when it was
last used. **Sign out** next to a phone stops it at once; the app on that phone removes what it kept the
next time it connects. On the web, phones signed out in the last 30 days stay listed with the reason.
If you lose a phone, sign it out straight away and tell your administrator, who can sign out your
phones too. When your account is disabled or deactivated, every phone is signed out.

## Signing out

Tap **Account > Sign out** and confirm. The phone is signed out on the server and the app removes
everything it kept on the phone except the server address. If the app has work it has not sent yet,
it warns you first. The app also signs out by itself, and removes its data, when the server no longer
accepts it: the phone was signed out from Devices, your account was deactivated, the mobile app was
switched off, or it was not used for too long. Work saved on the phone and not yet sent is removed
then too, so let the app send it (Report > Offline work) before a phone is signed out from the web. Sign
in again to continue.

Signing out, or being signed out, removes everything the app kept on the phone, including pictures it
made. Offline work is never put in a phone backup. If you delete the app and install it again, you sign
in again.

## Accessibility

The app follows the phone's own settings:

- **Screen readers** (VoiceOver on iPhone, TalkBack on Android). Every button, switch and choice is
  named by the words it shows, and says its state: a choice is "selected" or "checked", a switch on or
  off, **Type a number** and the site picker "expanded" or "collapsed". Screen titles and section
  names are headings. Messages (saved, sent, an error, a field that needs fixing, what the tag camera
  read, each find while counting) are read out when they appear. When part of a screen is replaced (the
  record's edit form, the next item of an inspection, completing it), the screen reader moves to its
  heading.
- **Large text.** Text grows with the phone's text size up to 200%: lines wrap and screens scroll, and
  nothing is cut off. The tab names grow up to 1.4 times so that all five still fit.
- **Dark mode** follows the phone. Text meets the WCAG AA contrast in both themes.
- **No gesture is needed.** Everything that can be done by a gesture has a button: pulling a list down
  has **Refresh** (or **Try again**), scrolling to the end of Notifications has **Load more**, the tag
  camera has **Type a number**, and the finger signature is optional (your typed name is the
  signature). Switches are whole rows, so the row can be tapped.

What has been checked, and what still needs a person, is in the
[accessibility statement](../accessibility.md#mobile-app).

## For administrators

Switch the app on under **Administration > Features > Mobile app**, then set it up under
**Administration > Mobile app**:

| Setting | Range | Default | What it does |
|---|---|---|---|
| Access token life in minutes | 5 to 60 minutes | 15 | How long the app's short-lived access lasts before it is renewed in the background |
| Days a phone stays signed in without use | 1 to 90 days | 30 | A phone not used for this long must sign in again |
| Require unlock to open the app | on or off | Off | Everyone must unlock the app; the person cannot turn it off under Account |
| Minutes before unlocking again | 0 to 240 | 5 | How long the app may stay in the background before it asks again |
| Days offline work is kept | 1 to 30 days | 7 | How long a phone keeps its offline package (My work, the report forms' choices, inspections with their checklists, condition assessments due, open inventory counts) before deleting it. Work saved on the phone and not yet sent is never deleted by this |

Saving asks for your password; new lifetimes apply to tokens issued afterward. Each person's page under
**Administration > Users** has a **Mobile app devices** card to sign one phone or all phones out.
Disabling or deactivating an account (also through user provisioning) signs out every phone, and they
stay signed out if the account is enabled again; so does switching the Mobile app off under
**Features**. The app asks your server which app versions it accepts, so an old app is asked to update
rather than misbehave.

**Administration > Push notifications** (shown while the Mobile app is on) holds your organization's
credentials for Apple's push service (iPhone), Firebase Cloud Messaging and UnifiedPush (Android). Keys
are stored encrypted and never shown again, only their fingerprint. Saving asks for your password again
and is recorded in the audit log. The page shows how many phones use each service and the last delivery
problem, and can send a test push to your own phones. Under each service it shows how many pushes wait
to be tried again because the service was unreachable or busy; pushes are retried automatically for
about two hours, or later when the service asks for a longer wait (up to six hours). Switching the Mobile app off stops all pushes.
