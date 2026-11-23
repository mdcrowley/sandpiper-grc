# Accessibility statement (draft)

Sandpiper GRC aims to be usable by everyone who works in a transit organization's IT,
cybersecurity, safety and project teams, including people who use a keyboard instead of a
mouse, a screen reader, speech recognition, screen magnification, or high-contrast and dark
color schemes.

This is a draft for each installation to adapt: an organization publishing the application to
its own staff should add its contact details and its own testing, and review the statement
at least once a year.

## How far it meets the standard

The target is the Web Content Accessibility Guidelines (WCAG) 2.1, level AA. The application
is **partly conformant**: most screens meet the target, and the known exceptions are listed
below.

## What has been checked

- **Automated checks on every screen.** Every route of the application, each list's New
  dialog and the search window are checked with the open-source axe-core engine against the
  WCAG 2.1 A and AA rules, in the light and dark themes, at desktop (1440 pixels) and tablet
  (820 pixels) widths: `node tools/a11y/audit.mjs` (see the developer guide, "Tests"). A
  finding already raised as a roadmap issue is listed in `tools/a11y/known.json`; any other
  serious or critical finding fails the check.
- **Color contrast of the design tokens** in both themes: `node tools/contrast.mjs`. Text
  meets 4.5:1 and controls, focus rings and chart colors 3:1 against their backgrounds.
- **Keyboard-only use**, checked automatically by the browser tests
  (`tools/e2e/suites/05-keyboard.mjs`): the "Skip to content" link, a visible focus indicator
  on every stop, the order of Tab stops (top bar, then navigation, then the page), arrow keys
  in the navigation, menus, tabs and list tables, dialogs that keep focus inside and return it
  when closed with Escape, the search window (Ctrl+K or /), creating a record without a
  mouse, choosing a record in a picker with the arrow keys, selecting a node of the
  relationship map, and moving a dashboard widget with the arrow keys.
- **Keyboard-only use, module by module** (`08-keyboard-modules.mjs`): for every module's
  lists and one record of each, every Tab stop in the page shows a focus indicator, nothing
  that reacts to a click is left out of the Tab order, and each New dialog opens with Enter,
  keeps the focus, and closes with Escape, putting the focus back.
- **Every hand-written dialog** that changes a record (resolving and closing a ticket,
  checking an asset out and in, disposal, risk review and acceptance, gate decisions, change
  approval and completion, vulnerability decisions, training records, exercise findings) is
  opened, submitted empty where it asks for something, and submitted in a real browser
  (`07-dialogs.mjs`).
- **Every role** has been taken through every screen in a browser (`04-roles.mjs`): pages a
  role may not use say "No access" rather than failing.
- **The main journeys with a real screen reader** (NVDA), by keyboard only, as an administrator
  and as a service desk agent: see the next section.

## Screen reader run

`tools/sr/journeys.mjs` (Windows only) takes ten everyday journeys through the application with
[NVDA](https://www.nvaccess.org/), the open-source screen reader, listening. It records, for every
step, the keys pressed, what NVDA said, where the keyboard focus is (from the browser's
accessibility tree: role, name and states) and anything wrong, and writes
`tools/sr/out/transcript.md` (git-ignored).

**How it works.** [Guidepup](https://www.guidepup.dev/) (open source, MIT) downloads a portable
NVDA into `.tools/nvda` and starts it with a throw-away configuration (silent speech, no echo of
typed keys); nothing is installed and the registry is not changed. NVDA's built-in Remote Access
relay hands every phrase NVDA speaks to the script. A visible Edge or Chrome is driven by key
presses only (Tab, Shift+Tab, Enter, Space, the arrow keys, Escape and typing, sent through the
browser's DevTools protocol), on a throw-away instance with the invented sample data, with an
administrator and an agent who each sign in with a password and an authenticator code. To read a
page the way a screen reader user does, NVDA's own browse-mode keys (H for the next heading, G for
the next graphic, F6) are pressed through Remote Access. NVDA reads only the window in front, so
the run waits until nobody has used the machine for 20 seconds before bringing the browser
forward, and drops (does not record) anything said while another window was in front.

It is a **manual, occasional check** (for example before a release, or after a change to the
shell, dialogs or focus handling), never part of `npm test`, the browser tests, the accessibility
audit or continuous integration: it needs a Windows desktop nobody is using, and all ten journeys
for both roles take about half an hour. Run one journey at a time while working on it:

```
cd tools/sr; npm install; npm run nvda     # once: Guidepup's portable NVDA into .tools/nvda
node journeys.mjs --only ticket            # one journey (signin, portal, ticket, risk, safety,
                                           # tag, count, approve, dashboard, setting); a journey
                                           # other than signin signs in through the API
node journeys.mjs                          # all of them
```

`tools/sr` has its own `package.json`; its `node_modules` and `out` folders are git-ignored, and it
is outside the root install, typecheck and tests.

**The journeys:** sign in with a password and a second factor (a wrong code first); raise a
ticket from the self-service portal (sent empty first); work a ticket (find it with the search,
open it, take it, add a note); create a risk and score it; record a safety event (sent with only a
title first); find an asset by its tag number and open the tag card; run an inventory count with a
typed tag; approve a workflow step; read a dashboard; change a setting under Administration (with
the password confirmation).

**What it proves and what it does not.** It shows what NVDA actually announces in these
journeys, that each can be completed with the keyboard alone, and where the focus lands after
every action. It is not a blind person's walkthrough: the script knows where each control is and
Tabs to it, so it does not judge how easy the pages are to find one's way around, how long they
take to listen to, or how clear the words are; it was run with NVDA and Edge only (not JAWS or
VoiceOver); and keys sent through the browser do not pass NVDA's own keyboard handling (NVDA's
browse-mode keys, which do, were used only to read headings and charts). A walkthrough by a
screen reader user remains to be done.

### Results (22 November 2026)

Nine of the ten journeys were completed with the keyboard alone, as the administrator and as the
agent (the agent's role has no portal, risks, safety, approvals or settings, so those ran as the
administrator only). **Approving a workflow step is not proven**: in the last run the new
administrator had nothing waiting for approval; the journey now makes a step to approve first, but
has not been run again. The last two fixes below (the focus after "Save settings", and the
rescue's quicker move to the heading) were also made after the last run. What NVDA said, in short:

| Journey | What NVDA announced | Where the focus went |
|---|---|---|
| Sign in | "Username, edit, required"; "Password, edit, protected"; "6-digit code, edit, required, From your authenticator app"; a wrong code: "alert, Sign-in failed. Check your details and try again." | The code field after the password; the Overview heading ("Good evening, …, heading, level 1") after signing in |
| Portal request | Sent empty: "alert, Check the highlighted fields" and the first field with "invalid entry, Say in a few words what is wrong"; each choice group by its question ("Who is affected?, grouping, required"); sent: "alert, Sent. Your reference is TKT-…" | The first refused field; the new request's heading |
| Work a ticket | The page ("Tickets, heading, level 1"); the search result count ("1–2 of 2 tickets"); "alert, Assigned to you."; "alert, Note added." | The ticket's heading after opening it and after "Assign to me" (which goes away); the comment box after adding a note |
| Create and score a risk | "New risk, dialog" with its fields; "alert, Risk created."; each score with its description ("Possible (Could happen once in two years), 3 of 5"); "alert, Scores saved." | Title in the dialog; the new risk's heading; the Likelihood picker; "Change scores" after saving |
| Safety event | Sent with only a title: the first missing field ("Type, combo box, required, invalid entry, Type is required."), then the next; "alert, Safety event created." | Each refused field in turn; the new event's heading |
| Tag card | The tag number box and "Find by tag number, heading, level 1" | The page heading (see the open finding below) |
| Inventory count | "Start an inventory count, dialog"; the site in the list ("…, 1 of 1"); "alert, Count started"; each typed tag ("Found: Counted radio … found.", "Already found …"); "Finish this count?, dialog" | Site picker; the Tag number box, which keeps the focus after each tag; the count's heading after finishing |
| Approve a step | Not proven (see above) | Not proven |
| Read a dashboard | With NVDA's H key every widget heading ("My approvals:6, heading, level 2", "Opened and resolved by day, heading, level 2"); with G each chart's summary ("Open tickets by priority, figure, Chart. P 1 Critical 1; P 2 High 1; …") | Stays where the reader is (browse mode) |
| Change a setting | The field with its hint ("Idle time-out in minutes, edit, Minutes, from 5 to 480"); "1 unsaved change"; "alert, Settings saved." | Lost (nowhere) in the last run once "Save settings" became unavailable again; fixed afterward to go to the page heading, not yet re-run |

**Fixed as a result** (the first runs found these; the last run above has them fixed):

- Changing page inside the application announced nothing and left the focus on the link used, or
  nowhere when the link went away with the old page; a screen reader user had to start again from
  the top. The focus now moves to the new page's heading (`web/src/core/routeFocus.ts`, used by the
  main layout and the portal), except on a fresh page load and when the new page puts the focus in a
  box itself.
- A button that is unavailable while its work runs, or that the work removes ("Assign to me",
  "Save settings"), dropped the focus to nowhere. The focus now comes back to the button, or goes
  to the page heading when the button is gone or stays unavailable.
- Adding a comment or note said nothing and lost the focus: it now says "Note added." or "Comment
  added." and puts the focus back in the comment box.
- The portal's choice groups ("Who is affected?", "How urgent is it?") were announced as invalid
  before anything was chosen; and after a refused portal form the focus was lost instead of moving
  to the first field to fix.
- Risk scores: "Change scores" and "Save scores" went away with the focus on them, and a refused
  score (likelihood without impact) said nothing. The focus now goes to the first picker, back to
  "Change scores", and to the refused picker.
- Several "Edit" buttons on one record page were announced alike; each now says what it edits
  ("Edit details", "Edit description"), and the portal's Approve and Reject buttons name the
  request.

**Still open** (roadmap issues in [E18](roadmap/epics/E18-quality-and-known-defects.md)):

- Nothing found by the screen reader run is still open; approving a workflow step has not been run
  with NVDA yet.

## What works

- Every page has one main heading, a "Skip to content" link, labeled navigation, and a
  page title that names the page. Moving to another page inside the application puts the focus
  on its main heading, so a screen reader says where you are; when a button you used goes away,
  the focus goes back to it or to the heading, never to nowhere.
- Messages after an action ("Saved", "Note added", errors) are announced by screen readers.
- Table rows' Edit, Remove and similar buttons name their row ("Edit: <name>"), and every portal page
  names itself in the browser tab ("My requests · Help and requests · <application>").
- Finding one record by a typed tag number puts the focus on its tag card's heading; a handheld
  scanner's value leaves the focus in the box for the next tag.
- Form controls have labels (visible ones, except search boxes, whose name is given to
  assistive technology); required fields are marked, and a refused form says what is wrong
  beside the field and moves focus to it.
- Status is never shown by color alone: chips carry their label, charts have a text
  alternative, and the risk heat map and framework board say each cell's rating in words.
- Light and dark themes follow the operating system, and either can be chosen. Motion is
  reduced when the operating system asks for it.
- Pages work at 820 pixels wide and when zoomed to 200 percent without scrolling sideways. Lists
  leave out lower-priority columns as the window narrows (still offered in the column chooser,
  marked "Hidden to fit this width"), so a list scrolls sideways only when its essential columns
  alone are too wide. A table that does scroll sideways fades at the edge that has more, and its
  frame is a named region in the tab order, so the keyboard can scroll it even when the table holds
  no link or button (the shared `TableWrap`; `web/src/core/tableWrap.test.ts` keeps every table on
  it). Lists never scroll down inside their own frame; the page does.
- Tab strips never scroll: tabs that do not fit go into a **More** menu after the tab list (outside
  the `tablist`, so the ARIA tabs pattern is unchanged). The active tab always stays in the strip,
  and a tab chosen from More receives focus.
- Header buttons are in one order on every page (primary first on record pages, the "⋯" menu
  last). They are moved in the page itself, not with CSS, so the Tab order is the visual order.
- Messages use `role="alert"` only for errors; information, success and warnings use
  `role="status"` (the shared `Notice`) (E18-63).

## Known limitations

- **No screen reader user has walked through the application yet.** The main journeys have been
  run with NVDA by a script (above), which proves what is announced and that the keyboard is
  enough, but not how easy the pages are to use by ear; JAWS and VoiceOver have not been tried
  (roadmap issue E16-15).
- The relationship map (Inventory > Relationship map) is drawn as a picture that can be moved
  with the keyboard; its Table view lists the same relationships and is the better choice
  with a screen reader.
- Charts give a summary in words, but the figures behind some charts are only available by
  opening the records behind them. On the Overview, dashboards and reports, a chart's bars and
  slices open the records behind them with a pointer only; with the keyboard, use the report's
  table or the list itself (roadmap issue E18-42).
- Record pickers open their list as soon as they take the focus, so after closing a question
  inside a dialog, the first Escape closes the picker's list and the next one the dialog.
- The automated audit reported no violation on any screen in its last full run (19 November
  2026). Anything it finds later is raised in the roadmap
  ([E18](roadmap/epics/E18-quality-and-known-defects.md)) with the screen and the fix.

## Mobile app

The iPhone and Android app (`mobile/`, [user guide](user/39-mobile-app.md)) was reviewed screen by
screen in November 2026 (roadmap issue E38-15): the five tabs, records and their edit form, approvals
and policy acknowledgments, notifications, devices, Offline work, connecting and signing in, the tag
camera and tag card with its quick update, attach and replace screens, the report forms, and field work
(the inspection runner with its signature, condition assessments, counting).

**What was checked, and how**

- **On the Android emulator** (Android 16, Google APIs image) with the text size at its largest (font
  scale 2.0, that is 200%), in the light and the dark theme: every screen above was opened, looked at in
  screenshots, and its accessibility tree read with `uiautomator dump` (each control's name, whether it
  is checkable, checked or selected, and its size). The Maestro flow `mobile/test/maestro/large-text.yaml`
  repeats the main path at that size in the dark theme.
- **Automated tests** (Jest with React Native Testing Library, part of the app's test run): names start
  with the visible words, choices and switches report their state, a control beside a row's text stays
  reachable, messages and field errors are announced, the focus moves after the screen changes, touch
  targets are at least 48 points, the tag camera can be used by typing a number, the inspection runner
  marks the chosen answer, and the theme's colors meet the contrast ratios below.
- **Color contrast** of the app's theme in light and dark: text at least 4.5:1, text-box and switch
  borders at least 3:1 (`mobile/src/ui/tests/a11y.test.tsx`).
- **iPhone-only properties** (VoiceOver grouping, `accessibilityViewIsModal`, announcements on iPhone,
  Dynamic Type) were reviewed in the code only.

**What was found and fixed**

- Rows with a switch or a button at the right were one grouped item, which hid the switch or button from
  VoiceOver; Android switches were 46 by 35 dp. Switches are now whole rows of at least 48 dp.
- Tapping a row read only its label, not its value or detail (for example "Notifications" without "6
  unread"); choices in lists (report type, severity, the kind of record to attach a tag to) did not say
  which was selected; the site and quick-update pickers did not say whether they were open.
- Messages and errors were not read out on iPhone, and on Android only some were; the whole list of
  search results was read again whenever it changed. Messages are now announced once when they appear,
  and only the number of results is.
- After **Edit**, **Save**, **Cancel**, an inspection answer, or **Complete the inspection**, the screen
  reader's focus was left on a control that had gone. It now moves to the new heading.
- At 200% text: top-bar titles did not grow; the inspection's **Not applicable** broke in the middle of
  the word; labels beside values broke mid-word ("Downloade d"); the Notifications title was cut short
  by **Mark all read**; notification text was cut off after a few lines; the keyboard covered the tag
  camera's number box. Each is fixed.
- The tab names started with the icon and the badge number ("1, My work"); they now start with the name
  ("My work, 1 waiting").
- Notifications could only be refreshed and paged by gestures; **Try again** and **Load more** buttons
  were added. Its filter buttons were 36 points high, the field work Back button 44.
- Text-box and switch borders were below 3:1; the tag camera's outline label on the sand color was
  below 4.5:1 in the light theme. A camera-less phone showed a black Tag screen; it now says to type the
  number.
- Under the unlock cover, the screens behind could still be reached by TalkBack, a keyboard or Switch
  Access; they are now hidden and take no input.

**Not yet done: needs a person**

- **VoiceOver has not been run.** It needs a person with an iPhone (or a Mac with the iOS simulator);
  the iPhone-specific properties were only reviewed in the code.
- **No TalkBack user has walked through the app.** TalkBack is installed on the emulator and the
  accessibility tree was checked, but what TalkBack says, in what order, and how easy the screens are
  by ear have not been heard and judged by a person who uses it.
- **iPhone Dynamic Type** at the largest accessibility sizes has not been seen on a device.
- The camera's pinch to zoom and tap to focus have no buttons; the camera focuses on its own, and
  **Take a picture**, **Choose a picture** and **Type a number** are the alternatives.
- The finger signature cannot be drawn without the gesture; it is optional, and the typed name is the
  signature.

## Reporting a problem

Tell the people who run the application in your organization, or raise an issue in the
project's public repository with the page address, what you were trying to do, and the
browser and assistive technology you use. Do not include personal or confidential data.
