# E04 Inventory and relationship map

**Status:** done (23 of 23 issues done)

## Goal

Hold one trustworthy picture of what the organization runs: its systems, the assets
people use, the sites they are in, the kinds of data held, and how these depend on each
other. Other modules (tickets, risks, vendors, incidents) point at these records.

## Scope notes

- Covers `server/src/modules/inventory/` and `web/src/modules/inventory/`.
- Asset CSV import and JSON ingest are tracked in
  [E13](E13-imports-api-integrations.md).
- Asset types, statuses, hosting types, criticality tiers and sensitivity levels are
  configurable lists.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E04-01 | Systems register | done | P1 |
| E04-02 | Assets register | done | P1 |
| E04-03 | Sites | done | P2 |
| E04-04 | Data categories | done | P2 |
| E04-05 | Integrations between systems | done | P2 |
| E04-06 | Data categories and sites linked to systems | done | P2 |
| E04-07 | Relationship map | done | P2 |
| E04-08 | Downstream impact of a system | done | P2 |
| E04-09 | Asset check-out, check-in and assignment history | done | P2 |
| E04-10 | Disposal gate with recorded approval | done | P2 |
| E04-11 | Canned inventory reports | done | P2 |
| E04-12 | Routed disposal approval | done | P2 |
| E04-13 | Use the department list on assets | done | P3 |
| E04-14 | Relationship map for a whole estate | done | P2 |
| E04-15 | System fact sheet with completeness | done | P2 |
| E04-16 | Asset lifecycle at a glance | done | P2 |
| E04-17 | Changes, tickets and vulnerabilities on systems and assets | done | P2 |
| E04-18 | Warranty, support and loan reminders | done | P2 |
| E04-19 | Transit equipment types and sample estate | done | P2 |
| E04-20 | Edit an integration in place | done | P3 |
| E04-21 | Reminder steps chosen on screen | done | P3 |
| E04-22 | Export the relationship map as a picture | done | P3 |
| E04-23 | Automated tests for the map layout | done | P3 |

---

### E04-01 Systems register

**Status:** done · **Priority:** P1 · **Type:** feature

As an IT lead, I keep a register of every business system with its owners, vendor,
hosting, criticality, recovery targets and how people sign in to it.

**Acceptance criteria**

- [x] Systems are numbered automatically
- [x] Business and technical owner, vendor and contract
- [x] Hosting type, provider and region
- [x] Criticality tier, recovery time and recovery point objectives, manual fallback
- [x] Authentication method and multi-factor status
- [x] List, detail page with tabs, history, comments and links

**Implemented in:** `system` resource (`server/src/modules/inventory/index.ts`); `web/src/modules/inventory/Systems.tsx`, `SystemTabs.tsx`

### E04-02 Assets register

**Status:** done · **Priority:** P1 · **Type:** feature

As an agent, I record each device, license or subscription with its tag, who has it,
where it is, what it cost and when its warranty and support end.

**Acceptance criteria**

- [x] Unique asset tag, generated when not given
- [x] Type, status, make, model, serial number
- [x] Owner, user, department, site and location
- [x] Purchase date, cost, funding source and outside-funder interest
- [x] Warranty and support end dates
- [x] Links to a vendor, contract and system

**Implemented in:** `asset` resource and `checkAsset` (`server/src/modules/inventory/index.ts`); `web/src/modules/inventory/Assets.tsx`

### E04-03 Sites

**Status:** done · **Priority:** P2 · **Type:** feature

As an IT lead, I record each site with what it is for, the technology there, its power
and physical protection, and its network links.

**Acceptance criteria**

- [x] Site records with the fields above
- [x] A site page lists the systems that serve it
- [x] Assets can be assigned to a site

**Implemented in:** `site` resource (`server/src/modules/inventory/index.ts`); `GET /api/sites/:id/systems` (`relations.ts`); `web/src/modules/inventory/Sites.tsx`

### E04-04 Data categories

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I list the kinds of data the organization holds, how sensitive each
is, who looks after it, who it is shared with and how long it is kept.

**Acceptance criteria**

- [x] Data category records with sensitivity, custodian, sharing, governing rule and retention period
- [x] Sensitivity levels are a configurable list that says which count as sensitive
- [x] A category page lists the systems that hold it

**Implemented in:** `data_category` resource (`server/src/modules/inventory/index.ts`); `GET /api/data-categories/:id/systems` (`relations.ts`); `web/src/modules/inventory/DataCategories.tsx`

### E04-05 Integrations between systems

**Status:** done · **Priority:** P2 · **Type:** feature

As an IT lead, I record which systems send data to which, in what direction and by what
method.

**Acceptance criteria**

- [x] Add, list and remove integrations from a system page
- [x] Direction and method are configurable lists
- [x] Changes are audited on both systems

**Implemented in:** `/api/systems/:id/integrations` (`server/src/modules/inventory/relations.ts`); `web/src/modules/inventory/SystemTabs.tsx`

### E04-06 Data categories and sites linked to systems

**Status:** done · **Priority:** P2 · **Type:** feature

As an IT lead, I say which data categories each system holds and which sites rely on
it.

**Acceptance criteria**

- [x] Link and unlink data categories on a system
- [x] Link and unlink sites on a system
- [x] Changes are audited

**Implemented in:** `/api/systems/:id/data-categories`, `/api/systems/:id/sites` (`server/src/modules/inventory/relations.ts`); `web/src/modules/inventory/SystemTabs.tsx`

### E04-07 Relationship map

**Status:** done · **Priority:** P2 · **Type:** feature

As anyone planning a change or handling an incident, I can see systems, vendors, sites
and data categories as a map and focus on one system's neighborhood.

**Acceptance criteria**

- [x] A graph of typed nodes and edges
- [x] Focus on one system with a chosen number of hops
- [x] Only records the user may see are included
- [x] Opens from the navigation and from a system

**Implemented in:** `GET /api/systems/graph` (`server/src/modules/inventory/relations.ts`); `web/src/modules/inventory/SystemMap.tsx`, `MapCanvas.tsx`, `MapPanel.tsx`, `mapLayout.ts`

### E04-08 Downstream impact of a system

**Status:** done · **Priority:** P2 · **Type:** feature

As an incident lead, I pick a system and see everything downstream of it through its
integrations, so I know what else is affected when it fails.

**Acceptance criteria**

- [x] Follows integrations transitively
- [x] Shown on the relationship map for the chosen system

**Implemented in:** `GET /api/systems/:id/impact` (`server/src/modules/inventory/relations.ts`); `web/src/modules/inventory/SystemMap.tsx`

### E04-09 Asset check-out, check-in and assignment history

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I check an asset out to a person and back in again, and the asset keeps a
history of who had it and when.

**Acceptance criteria**

- [x] Check-out records the person and date
- [x] Check-in closes the assignment
- [x] The full assignment history is shown on the asset

**Implemented in:** `/api/assets/:id/assignments`, `/check-out`, `/check-in` (`server/src/modules/inventory/lifecycle.ts`); `web/src/modules/inventory/AssetDialogs.tsx`

### E04-10 Disposal gate with recorded approval

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I cannot mark an asset as disposed until an approval is recorded, and an
asset with an outside funder's interest also needs an approval reference.

**Acceptance criteria**

- [x] Disposal always needs who approved and when
- [x] An asset flagged with funder interest also needs an approval reference
- [x] The rule holds however the asset is changed (page, API, import)
- [x] Disposal date and method are recorded

**Implemented in:** `POST /api/assets/:id/dispose`, `disposalProblem` (`server/src/modules/inventory/lifecycle.ts`); `web/src/modules/inventory/AssetDialogs.tsx`

### E04-11 Canned inventory reports

**Status:** done · **Priority:** P2 · **Type:** feature

As an IT lead, I can run seven ready-made reports and export each to CSV.

**Acceptance criteria**

- [x] Assets past support
- [x] Warranty expiring in the next 90 days
- [x] Assets by site
- [x] Unassigned assets
- [x] Systems without an owner
- [x] Systems without recovery targets
- [x] Systems holding sensitive data without multi-factor
- [x] CSV export with an audit entry and permission checks

**Implemented in:** `GET /api/inventory/reports`, `/api/inventory/reports/:key` (`server/src/modules/inventory/reports.ts`); `web/src/modules/inventory/Reports.tsx`

### E04-12 Routed disposal approval

**Status:** done · **Priority:** P2 · **Type:** feature

As an approver, I receive a disposal request and approve or refuse it in the
application, instead of the agent typing in an approver's name and date.

**Acceptance criteria**

- [x] An agent requests disposal; the asset shows "awaiting approval"
- [x] A person with `assets.approve` approves or refuses with a comment (a refusal needs one)
- [x] The approver cannot be the requester
- [x] The decision is audited and unlocks the disposal step; a pending request can be withdrawn
- [x] Approvers are notified of a request and the requester of the decision (through notifications, [E14-03](E14-platform-services.md), when installed)
- [x] An administrator can make a routed approval the only way (setting `inventory.disposal_routed_only`)
- [x] A queue of requests for approvers

**Implemented in:** `server/src/modules/inventory/disposal.ts`, migration `002_disposal_requests_and_reminders.sql`, tests in `disposal.test.ts`; `web/src/modules/inventory/AssetDialogs.tsx`, `AssetLifecycle.tsx`, `Assets.tsx` (`DisposalApprovalsPage`)

### E04-13 Use the department list on assets

**Status:** done · **Priority:** P3 · **Type:** debt

As an administrator, I want an asset's department chosen from the same department list
as users, so reports group consistently.

**Acceptance criteria**

- [x] The asset forms (check-out, "Who has it and where") offer the department list; free text only while no departments exist
- [x] Existing text values are matched to departments where they agree (case-insensitive, at every start); a person cannot enter a name outside the list
- [x] An "Assets by department" report

**Implemented in:** `checkAsset` and `GET /api/inventory/departments` (`server/src/modules/inventory/index.ts`), `reports.ts`; `DepartmentInput` in `web/src/modules/inventory/AssetDialogs.tsx`

### E04-14 Relationship map for a whole estate

**Status:** done · **Priority:** P2 · **Type:** feature

As anyone planning a change or handling an incident, I can read a map of 50 to 200
records without it turning into a tangle.

**Acceptance criteria**

- [x] A stable layout worked out from the data (no simulation): systems in boxes by group, criticality or hosting; vendors on the left; sites, data and assets on the right, level with their systems or stacked when short; large groups show several systems to a row
- [x] Zoom, pan, fit and full screen, by mouse, buttons and keyboard
- [x] Search to select and center a record; filters by group and record type
- [x] A side panel with the selected record's details, connections and, for a system, what is affected if it fails (outlined on the map)
- [x] A legend; a searchable table of the same relationships for keyboard and screen-reader use
- [x] Themed for light and dark; checked with an invented estate of about 160 records and 290 relationships

**Implemented in:** `web/src/modules/inventory/SystemMap.tsx`, `MapCanvas.tsx`, `MapPanel.tsx`, `mapLayout.ts`, `inventory.css`

### E04-15 System fact sheet with completeness

**Status:** done · **Priority:** P2 · **Type:** feature

As an IT lead, I see at a glance what is known about a system and what is still missing.

**Acceptance criteria**

- [x] Twelve key facts (purpose, owners, criticality, recovery targets, hosting, sign-in, multi-factor, vendor, contract, data held) with a percentage and a count
- [x] One button per gap that opens the right card for editing
- [x] Cards by subject, each marked complete or with the number still to record

**Implemented in:** `web/src/modules/inventory/SystemFacts.tsx`, `Systems.tsx`

### E04-16 Asset lifecycle at a glance

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I see where an asset is in its life and what is coming up.

**Acceptance criteria**

- [x] A lifecycle band from ordered to disposed
- [x] Warranty and support countdowns with a status
- [x] Funder-interest and disposal-progress notices that explain the rule
- [x] The assignment history as a timeline, and the disposal steps on their own tab

**Implemented in:** `web/src/modules/inventory/AssetLifecycle.tsx`, `Assets.tsx`

### E04-17 Changes, tickets and vulnerabilities on systems and assets

**Status:** done · **Priority:** P2 · **Type:** feature

As an IT lead, I see the change records, open tickets and open vulnerabilities that name a
system or an asset on its own page.

**Acceptance criteria**

- [x] A "Changes and issues" tab on systems and assets with up to three lists, each with a count and a link to the filtered list
- [x] A list appears only when its record type is installed, has a system or asset field, and the reader may see it

**Implemented in:** `RelatedWork` in `web/src/modules/inventory/shared.tsx`; test in `server/src/modules/inventory/disposal.test.ts`

### E04-18 Warranty, support and loan reminders

**Status:** done · **Priority:** P2 · **Type:** feature

As an asset owner, I am told before a warranty or support contract ends and before a loan is
due back.

**Acceptance criteria**

- [x] Notifications 30 and 7 days before and on the day for warranty and support ends; 3 days before and on the day for loans
- [x] To the owner, or everyone who may edit assets when there is no owner; only people who may see the asset
- [x] Each reminder is sent once; a date that passed while the server was off is still announced for a week
- [x] Runs several times a day in the server; an administrator can run it at once (`POST /api/inventory/reminders/run`)

**Implemented in:** `server/src/modules/inventory/reminders.ts`; tests in `disposal.test.ts`

### E04-19 Transit equipment types and sample estate

**Status:** done · **Priority:** P2 · **Type:** feature

As a bus or rail operator, I find the equipment I run among the default lists, and the
sample data looks like my estate.

**Acceptance criteria**

- [x] Asset types for onboard computers, CAD/AVL units, fareboxes, card validators, on-vehicle routers, cameras, radios and passenger information displays
- [x] An "On-vehicle" hosting value
- [x] Added to an existing installation at start without duplicates (`seedDefaults`)
- [x] An invented transit estate for the `dev` profile (24 systems, 6 sites, 8 data categories, 28 integrations) and vehicle equipment among the sample assets

**Implemented in:** `seedDefaults` (`server/src/modules/inventory/index.ts`), `seed-sample.ts`; tests in `inventory.test.ts`, `seed.test.ts`

### E04-20 Edit an integration in place

**Status:** done · **Priority:** P3 · **Type:** feature

As an IT lead, I change an integration's method, direction or notes without removing it and
adding it again.

**Acceptance criteria**

- [x] An Edit button on each integration row
- [x] The change is audited on both systems
- [x] The direction is read from the system being edited, so an integration can be turned round from either end; a change that would duplicate another integration is refused (409); the other system cannot change

**Implemented in:** `PATCH /api/systems/:id/integrations/:integrationId` (`server/src/modules/inventory/relations.ts`, audit action `system.integration_update`); `IntegrationDialog` and `LinkedList` in `web/src/modules/inventory/SystemTabs.tsx`; tests in `relations.test.ts`

### E04-21 Reminder steps chosen on screen

**Status:** done · **Priority:** P3 · **Type:** feature

As an administrator, I choose how many days before a warranty or support end the reminders
go out. Today the setting `inventory.reminder_days` can only be changed through the settings
store.

**Acceptance criteria**

- [x] The steps are shown and edited on an administration screen (Administration > Reminders)
- [x] The change is audited (`setting.change`)

**Implemented in:** `server/src/modules/notifications/reminder-settings.ts`,
`web/src/modules/notifications/ReminderSettings.tsx`; tests
`notifications/housekeeping.test.ts`.

### E04-22 Export the relationship map as a picture

**Status:** done · **Priority:** P3 · **Type:** feature

As an IT lead, I save the map, or the neighborhood of one system, as an image for a report.

**Acceptance criteria**

- [x] Save as SVG or PNG with the legend, in the current theme or a print theme
- [x] The whole map as filtered and arranged, whatever the zoom, with a heading, the date and a legend; optionally the impact of the selected system; a preview before saving
- [x] The same on a system's Map tab (its neighborhood); no new packages (the SVG is drawn from the layout, the PNG on a canvas)

**Implemented in:** `web/src/modules/inventory/mapExport.ts` (`renderMapSvg`, `readPalette`, `svgToPng`), `MapPicture.tsx`, the **Save as a picture** button in `MapCanvas.tsx`; tests in `mapExport.test.ts`

### E04-23 Automated tests for the map layout

**Status:** done · **Priority:** P3 · **Type:** debt

The map layout (`web/src/modules/inventory/mapLayout.ts`) was pure code with no tests, checked by
eye in the browser.

**Acceptance criteria**

- [x] The test runner includes web unit tests (`vitest.config.ts` includes `web/src/**/*.test.ts`)
- [x] Tests that the same data always lays out the same way, that nothing overlaps, and that large groups wrap
- [x] Also: every record is placed once inside the drawing, systems stay inside their group box, long lanes wrap, lanes sit on the correct side, and an empty map draws

**Implemented in:** `web/src/modules/inventory/mapLayout.test.ts`

