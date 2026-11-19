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

## What works

- Every page has one main heading, a "Skip to content" link, labeled navigation, and a
  page title that names the page.
- Form controls have labels (visible ones, except search boxes, whose name is given to
  assistive technology); required fields are marked, and a refused form says what is wrong
  beside the field and moves focus to it.
- Status is never shown by color alone: chips carry their label, charts have a text
  alternative, and the risk heat map and framework board say each cell's rating in words.
- Light and dark themes follow the operating system, and either can be chosen. Motion is
  reduced when the operating system asks for it.
- Pages work at 820 pixels wide and when zoomed to 200 percent without scrolling sideways;
  wide tables scroll inside their own frame.

## Known limitations

- **Screen-reader journeys have not yet been walked through** with NVDA, JAWS or VoiceOver
  by a person; only the automated checks above have been run (roadmap issue E16-15).
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

## Reporting a problem

Tell the people who run the application in your organization, or raise an issue in the
project's public repository with the page address, what you were trying to do, and the
browser and assistive technology you use. Do not include personal or confidential data.
