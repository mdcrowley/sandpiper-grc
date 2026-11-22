# Asset tags and mobile apps: specification

**Status:** proposed (not built). **Epics:** [E37 Asset tags: printing and scanning](../epics/E37-asset-tags.md),
[E38 Mobile apps for iPhone and Android](../epics/E38-mobile-apps.md). **Date:** November 2026.

This document describes what will be built and why. The epics hold the issues, each with its
acceptance criteria; this document holds the design those issues share. When an issue is built, its
"Implemented in" line points at the code, and this document is updated where the build differed.

## 1. Goals

1. **Print durable tags** for assets, vehicles, sites and systems, from any printer, with a code that
   any phone camera or handheld scanner reads.
2. **Scan a tag to act on the thing it is stuck to:** see what it is, report a problem with it, edit
   it, record its condition, run its inspection, attach a photo, count it in an inventory check.
3. **Native apps for iPhone and Android** for people who work away from a desk: maintenance staff,
   operators, inspectors, supervisors and managers who approve things on the move. The apps do a
   focused set of field tasks very well, including without a network connection; they do not copy
   the whole desktop application.
4. **Nothing new to buy or host.** Tags print on ordinary label stock; scanning works in the web
   application on any phone today, with no app; the apps talk only to the organization's own server.

### Who uses it

| Person | Typical use |
|---|---|
| Inventory or asset manager | Prints tags for new equipment, replaces damaged tags, runs inventory counts |
| Maintenance technician | Scans equipment, sees open tickets and history, updates status, records condition, attaches photos |
| Operator or frontline employee | Scans the tag in a vehicle or at a station to report a defect or a hazard |
| Inspector or auditor | Runs scheduled inspections on site, offline, with photos |
| Requester (portal user) | Scans a tag on a printer or workstation to raise a service desk ticket about it |
| Manager or approver | Reviews and decides approvals, acknowledges policies, sees what is assigned to them |

### Not in scope

- Asset tracking by GPS, RFID or Bluetooth beacons (a tag is read when someone scans it).
- Maintenance work orders and parts (recorded as "Not planned" in E32-06; a scanned defect raises a
  service desk ticket, which a maintenance system can pick up through the work-tracker bridge, E36-06).
- A rider-facing public app. Anonymous reporting by tag is an option that is off by default (§4.8).
- The full desktop application on a phone: administration, report building, framework work and
  dashboards editing stay in the web application.

## 2. Approach in brief

- **The tag holds a web address**, `https://<your server>/t/<code>`, as a QR code. A phone camera opens
  it in the browser (no app needed); with the app installed, the same address opens the app instead
  (universal links on iOS, app links on Android). A handheld scanner types the code into the scan box.
- **A tag code is its own record**, separate from the asset number, so a tag can be printed before the
  asset exists, replaced when damaged, and moved without renumbering anything.
- **One "scan card" for every way of scanning**: the server works out what the code is and which
  actions this person may take on it (permissions, switched-off areas, restricted records, legal
  holds), and the web page and the apps both draw that answer.
- **The apps are built with React Native and Expo** (open source, MIT), in TypeScript, in a `mobile/`
  folder of this repository, sharing an API client generated from the server's OpenAPI description.
- **The apps sign in through the browser** with OAuth 2.1 and PKCE (the authorization server built
  for AI assistants, E21, generalized), so single sign-on, passkeys and second factors work unchanged.
- **Phased**: tags and web scanning first (useful on day one, no app store), then the apps' online
  features, then offline work, then push notifications.

## 3. Tags

### 3.1 What can be tagged

Assets (including vehicle equipment), vehicles, sites (stations, depots, rooms, cabinets) and systems
(for example a rack or a signal cabinet that stands for a system). The list of taggable types is a
registry, like the calendar sources (`core/tags.ts`, `defineTaggable(app, { type, label, … })`), so a
module adds its own type without core changes. A type in a switched-off area is not taggable and its
tags answer as if unknown, except to administrators, who are told the area is off.

### 3.2 Tag codes

- 8 characters of Crockford base 32 (digits and capital letters without I, L, O and U) plus one
  check character, shown in groups: `7KQ2-M9XF-R`. About a trillion possible codes, so codes are
  not guessable in practice; case, spaces and dashes are ignored when typed; the check character
  catches a mistyped code before any lookup.
- Codes are not secrets: scanning only shows what the person may already see (§4.3). They are random
  rather than sequential so that a tag reveals nothing about how many assets exist.
- A code belongs to one installation. It is never reused, even after its tag is voided.

### 3.3 Data model (module `tags`)

| Table | Columns (main) |
|---|---|
| `tags` | `id`, `code` (unique), `status` (`blank`, `active`, `replaced`, `void`, `lost`), `record_type`, `record_id`, `batch_id`, `assigned_at`, `assigned_by`, `printed_count`, `last_printed_at`, `last_scanned_at`, `notes`, timestamps |
| `tag_batches` | `id`, `kind` (`records` or `blank`), `count`, `template_id`, `layout_id`, `created_by`, `created_at` |
| `tag_templates` | `id`, `name`, `fields` (ordered list: logo, organization name, record name, record number, code, QR, linear barcode, short instruction line, help phone number), `qr_size`, `font_scale`, `default` |
| `tag_layouts` | `id`, `name`, `kind` (`sheet` or `roll`), page size, label width and height, rows, columns, margins, gaps, `corner_radius` (for the preview only) |
| `tag_scans` | `id`, `tag_id`, `person_id`, `at`, `source` (`web`, `app`, `handheld`), `action` (the action taken, if any). Kept `retention.tag_scans_days` (default 90); off entirely with `tags.log_scans` |

- One active tag per record by default; a setting allows several (a long vehicle may carry a tag at
  each end). Replacing a tag marks the old one `replaced` and points it at the new one, so scanning an
  old tag still finds the record, with a notice that the tag should be removed.
- The existing human numbers stay as they are (asset tag `AST-…`, vehicle fleet number, site code).
  They are printed on the label beside the QR code, and they can be looked up too (§4.2).
- Tags follow the record's retention: when a record is anonymized or removed, its tags are voided.
  A tag on a record under a legal hold cannot be voided or reassigned (`assertNotHeld`).

### 3.4 Printing

- **Where:** "Print tag" on a record page; "Print tags" as a bulk action on the asset, vehicle, site
  and system lists (selected rows or the whole filtered list); "Print blank tags" in
  Administration > Asset tags for a batch of unassigned codes to stick on first and assign by scanning.
- **What comes out:** a PDF, made on the server with the existing PDF engine (E12), sized exactly for
  the chosen layout, so any printer that prints a PDF at 100% prints it right.
  - **Sheet layouts** (office printers, sheets of adhesive labels): presets for common sizes on Letter
    and A4 paper, described by their dimensions, plus "Custom" (any rows, columns, margins and gaps).
    "Start at label" skips labels already used on a partial sheet.
  - **Roll layouts** (label printers): one label per PDF page at the label's exact size.
  - An optional raw thermal-printer format (ZPL) for label printers that cannot print PDFs at the
    right size (P3).
- **The label:** the organization's logo (branding, E14-36) and name, the record's name and number,
  the QR code with a quiet zone of four modules, the code in text, an optional linear barcode (Code 128
  of the record number, for existing handheld scanners and processes), and a short line such as
  "Scan to report a problem". Text never shrinks below a legible minimum; fields that do not fit are
  dropped in the template's order and the preview says which.
- **Preview** in the browser before printing, at real size, with a test page that prints a ruler and
  label outlines on plain paper for checking alignment.
- The QR code uses error correction level M (survives scuffs) and is generated on the server by an
  open-source library (MIT). Each print is audit-logged (who printed which tags, how many).
- The user guide covers materials (polyester or laminated labels for vehicles and outdoors, the
  minimum printed size for reliable scanning: 15 mm / 0.6 in QR code at arm's length).

## 4. Scanning

### 4.1 Ways to scan

| Way | How it works |
|---|---|
| Phone camera, no app | The QR code opens `https://<server>/t/<code>` in the browser; after sign-in (if needed) the scan card shows |
| Web scanner page (`/scan`) | Uses the device camera in the browser: the built-in `BarcodeDetector` where the browser has it, otherwise an open-source decoder (WebAssembly build of ZXing, Apache 2.0) loaded only on that page. Continuous mode for counting; torch toggle where supported |
| Handheld scanner (USB or Bluetooth, keyboard mode) | The scan box on `/scan` and the search box accept what the scanner types; a code followed by Enter opens it |
| Typed | The same scan box: type the 9-character code, an asset number, a fleet number, a serial number or a site code |
| The apps | The native camera scanner (on-device; nothing is sent anywhere but the organization's server); links from the system camera open the app |

### 4.2 Resolving what was scanned

`GET /api/tags/resolve?value=<scanned text>` accepts a tag address, a tag code, or another identifier:

1. A tag address or code → that tag.
2. Otherwise an exact match on registered identifier fields (asset tag and serial, vehicle fleet number
   and vehicle identification number, site code; each taggable type declares its own) among records
   the person may see.
3. Several matches → a short list to choose from. None → "Nothing found for <value>", identical whether
   the record does not exist or the person may not see it.

### 4.3 The scan card

The answer to a resolve lists, for the one record found:

- Its type, name, number, status, photo (the first image attachment marked as the record's photo),
  location, owner or assignee, and a few type-specific facts (for an asset: condition rating, next
  inspection; for a vehicle: fleet number, mode, odometer; for a site: kind, open tickets there).
- Recent activity: open tickets linked to it, the last inspection and condition assessment, recent
  changes, all limited by what the person may see.
- **Actions**, each computed on the server from the person's permissions, the switched-on areas, the
  record's lifecycle and holds. The client never decides what is allowed; it only draws the list.

| Action | Shown when | Does |
|---|---|---|
| Report a problem | Service desk on, may create tickets (or portal access) | New ticket with the record pre-filled as the affected asset, system or site; category list from the service desk; photo attachments |
| Report a hazard or close call | Safety on, may report | New safety report at the record's site, with the record linked |
| Edit | May edit the record | The record's edit form (web) or the app's field form (§5.4) |
| Quick updates | May edit | Change status, location, assignee or custodian in one step, each audit-logged like any edit |
| Add photo or note | May comment or attach | Camera photo or note on the record |
| Record condition | Asset condition on, may assess | New condition assessment for the record |
| Start inspection | Audits on, an inspection is scheduled or a checklist applies | Opens the inspection runner for it |
| Count it | An inventory count is open and the record belongs to it | Marks it found (§4.6) |
| Attach this tag | Tag is blank, may edit taggable records | Search for, or create, the record to attach it to |
| Replace or void tag | May manage tags | Replace (prints a new one), void, mark lost |
| Open full record | Always | The record page |

### 4.4 Signing in from a scan

A scan by someone not signed in goes to the sign-in page and back to the scan card afterwards
(the return address is checked to be a local path, as today). Nothing about the record is shown
before sign-in. The scan card is a phone-width page in the web application (§6).

### 4.5 Restricted, held and switched-off records

- A restricted record (security, privacy, investigation) answers "Nothing found" to someone who may
  not see it, exactly as an unknown code does, and the scan is not logged against the record.
- A record under a legal hold shows its hold banner; actions that would change it are left out.
- A record in a switched-off area answers "Nothing found", except to administrators.

### 4.6 Inventory counts

A count checks that what the register says is at a place is really there.

1. A person with the `tags.count` permission starts a count for a site (and optionally a room or area
   within it, and record types). The count lists what is **expected** there.
2. People scan what they find, on the web scanner page or in the app (offline too). Each scan marks
   the record **found**; a record from elsewhere is **unexpected** (found here, registered elsewhere).
3. Finishing the count lists what is **missing**. For each unexpected record the counter may move it
   here (updating its location); for each missing one, mark it missing (status) or leave it. A
   discrepancy summary can raise a ticket or an action.
4. Every found record gets its "last verified" date and place. A report lists counts, coverage by site
   and records not verified for longer than a chosen time.

Tables: `inventory_counts` (site, scope, status, started and finished by and when),
`inventory_count_items` (record, expected, found_at, found_by, outcome). Counts are records with
history, comments and attachments, like any other.

### 4.7 Scan history

When scan logging is on, each record's page shows "Last scanned" (when, by whom, from which source).
The log is per tag, kept 90 days by default, visible to people who may edit the record, and included
in retention and anonymization. Device location is never recorded.

### 4.8 Reporting a problem without an account (option, off by default)

For tags in places used by people with no account (a staff break room, a contractor's work area), an
administrator may allow anonymous "Report a problem" on chosen tag templates. The scan card then shows
only the record's public name and a short form (description, optional photo, optional contact email);
nothing else about the record. Reports arrive as tickets from a "Tag report" source, rate-limited by
address and by tag, with a size limit on photos and a challenge-free design (no outside service).
Off by default; the guide says when not to use it.

## 5. The mobile apps

### 5.1 Technology

| Choice | Decision | Why |
|---|---|---|
| Framework | React Native with Expo (MIT), TypeScript | One code base for iPhone and Android, the same language and React knowledge as the web application, open source, mature camera and secure-storage modules |
| Where | `mobile/` in this repository, its own `package.json`; the shared API client in `packages/api-client` generated from `GET /api/openapi.json` | Server and app change together and are tested together |
| Builds | Local builds with Xcode and Android Studio after `expo prebuild`, and in GitHub Actions (Android on Linux, iPhone on macOS runners); no paid build service | No paid services |
| Minimum versions | iOS 16 and Android 10 (API 29) | Covers the phones in use while keeping current security features |
| Tests | Jest and React Native Testing Library for components; Maestro (Apache 2.0) flows on emulators in CI | Open source, scriptable |

### 5.2 Connecting to a server and signing in

1. **Connect:** the first screen asks for the server address, or scans a "Connect the app" QR code shown
   on the web application's **Account > Mobile app** page (the code holds only the server address).
   The app checks `GET /api/version` for compatibility (§5.9) and refuses plain HTTP except to
   `localhost` builds for development.
2. **Sign in:** the app opens the system browser (ASWebAuthenticationSession on iOS, Custom Tabs on
   Android) at the server's `/oauth/authorize` with PKCE. Everything the person normally uses works
   there: password, second factor, passkey, single sign-on, the break-glass rules. The server
   redirects back to the app through its claimed `https` app link (or, failing that, the app's own
   scheme), and the app exchanges the code for tokens.
3. **Tokens:** a short-lived access token (15 minutes) and a rotating refresh token (30 days of
   inactivity, an administrator setting), bound to this device installation. Stored only in the
   iOS Keychain or Android Keystore. Reuse of an old refresh token revokes the whole device session.
4. **Unlock:** optionally (or required by an administrator) Face ID, Touch ID or the device credential
   before the app opens after a set idle time.
5. **Devices:** each signed-in installation is listed on **Account > Devices** (name, platform, app
   version, last used) and on an administrator's user page; either can sign it out. Deactivating a
   user (including SCIM deprovisioning) signs out all their devices; the next refresh fails and the
   app wipes its local data.
6. **Sensitive actions** that ask for the password again on the web (E01-33) ask again in the app
   through the same browser sign-in with `prompt=login` and a short "recent sign-in" claim.

The OAuth server built for AI assistant connections (E21) is generalized: client kinds `assistant`
and `mobile`; the mobile client is registered by the application itself, needs no administrator
step, and is switched off with the **Mobile app** area. Mobile access tokens carry the person's own
permissions (not a reduced scope list), because the app acts on their behalf like the web application.

### 5.3 Screens (first release)

| Screen | Contents |
|---|---|
| **My work** | Tickets assigned to me, my actions, approvals waiting for me, inspections due, condition assessments due, policy acknowledgments and training due; counts and the first few of each, each opening its item |
| **Scan** | Full-screen camera with a code frame, torch, manual entry; continuous mode during an inventory count; then the scan card (§4.3) |
| **Report** | Report a problem (ticket) or a hazard or close call (safety), with photos, location picked from sites, and the record linked when started from a scan |
| **Search** | Search across what the person may see; recent items; opens a read-only record view with comments and attachments |
| **Record view** | Phone layouts for assets, vehicles, sites, systems, tickets, actions, safety reports and inspections: summary, key fields, activity, comments, attachments; edit where §5.4 allows |
| **Approvals** | Waiting approvals with what is being approved, approve or reject with a reason; password confirmation when the step requires it |
| **Inspections** | Run an inspection from its checklist: pass, fail or not applicable per item, notes, photos, findings; works offline (§5.5) |
| **Notifications** | The in-app notification list, marked read in step with the web |
| **Account** | Who is signed in, server, devices, unlock settings, sign out, about and licenses |

### 5.4 Editing in the app

The app edits a chosen set of fields per type (status, assignee, location, condition, notes, and the
fields a type marks as `mobileEditable` in its resource definition). The server validates exactly as
for the web (one code path). Edits send `If-Match` with the version the person saw; a conflict shows
both values and lets the person choose. Required fields the phone form does not show are a reason to
open the record in the web application instead (the app says so rather than failing).

### 5.5 Offline work

Offline is limited to work that happens where there is no signal: **inspections**, **condition
assessments**, **inventory counts**, **reports** (problems and hazards) and **photos and notes**.

- **Before going out**, the app downloads a work package: the inspections assigned or scheduled for
  the coming days with their checklists and the records they cover, the open inventory counts the
  person joined, and the scan lookup table for those records (tag codes and identifiers only). Each
  package has an expiry (administrator setting, default 7 days); expired packages are deleted.
- **While offline**, work is saved in an on-device SQLite database in the app's protected storage
  (iOS Data Protection "complete until first unlock", Android file-based encryption), with photos as
  files beside it. Scanning a code outside the package says the record is not available offline.
- **When back online**, an outbox sends each item once, in order: every item carries a client-made
  UUID and an `Idempotency-Key`, so a retry never creates a duplicate. Photos upload in parts and resume.
  A rejected item (the inspection was cancelled, the record was deleted, permission was removed) stays
  in a "Needs attention" list with the server's reason; nothing is dropped silently.
- **Signing out or being signed out** wipes the database and photos after warning about unsent work
  (the person may send it first if still allowed).
- Server side: `GET /api/mobile/package`, `POST /api/mobile/sync` (a batch of outbox items, each
  answered separately), and idempotency stored for 7 days (`idempotency_keys` table, reused by any
  route that accepts the header).

### 5.6 Notifications on the phone

- **First release:** no push. The app refreshes My work and Notifications when opened and on pull to
  refresh, with a badge from the last refresh; email notifications continue as today.
- **Push (later, E38-14):** pushing to a phone needs the publisher's credentials with the platform
  push services, which a self-hosted server does not have. Options, to decide (§9): (a) organizations
  that build and sign their own copy of the app use their own push credentials, configured on their
  server; (b) a small open-source push relay that the app's publisher runs, which receives only an
  opaque device token and "you have N new notifications" (never content), and the app then fetches
  the details from the organization's server; (c) UnifiedPush on Android for organizations that run
  their own distributor. Push content never includes record details.

### 5.7 Security

- All traffic over HTTPS with the platform's certificate checks; no certificate pinning (each
  organization has its own certificates), but no user-installed certificate authorities trusted on
  Android release builds.
- No analytics, crash reporting or advertising libraries that send data anywhere. Crash reports stay
  on the device until the person chooses to share one.
- Screenshots of restricted records are blocked on Android (`FLAG_SECURE`) and the app switcher shows a
  blank screen on iOS while a restricted record is open.
- The app holds only what the person may see; the server enforces every rule; offline packages hold
  only what the person's work needs and expire.
- Administrators can switch the Mobile app area off (all devices signed out), require the unlock, set
  token lifetimes and offline package expiry, and see every device.
- Threat model and the checks above are added to `docs/security.md`; the independent review (E16-40)
  covers the app and its endpoints.

### 5.8 Accessibility and language

VoiceOver and TalkBack labels on every control, Dynamic Type and font scaling to 200%, contrast as in
the web design tokens, light and dark themes following the phone, no action that needs a gesture
without a button alternative. Text in American English, held in one file per screen so translation
can follow later.

### 5.9 Versions and compatibility

The server reports its version and the range of app versions it supports (`GET /api/version` gains
`mobile: { minVersion, recommendedVersion }`). The app refuses to connect to a server too old for it,
and tells the person to update the app when it is older than the server allows. API changes the app
uses follow the existing rule: additive within a major version.

### 5.10 Distribution

The source is in this repository under the MIT license. Two ways to install, to decide (§9):

- **Published by the project** in the App Store and Google Play under a neutral name, so any
  organization installs it and enters its server address.
- **Built by each organization** from source with its own name, icon and signing (instructions in
  `docs/mobile.md`), distributed through its device management (Apple Business Manager custom apps,
  managed Google Play) or as an Android package. This is also the way to get push without a relay.

## 6. Changes to the web application

- `/scan` and `/t/:code`: phone-width first (from 360 px), large touch targets, camera permission
  explained before it is asked, working with a handheld scanner, and tested at 390 px in the browser
  suite and the accessibility audit.
- The record pages of taggable types gain a **Tags** panel (active tag with print, replace and void;
  earlier tags; last scanned).
- Lists of taggable types gain **Print tags** (bulk); the global search box accepts a scan.
- **Administration > Asset tags**: templates, layouts, blank batches, settings (several tags per
  record, scan log and its retention, anonymous reports).
- **Inventory counts** under Inventory: list, start, count, finish, report.
- **Account > Mobile app**: connect code, devices list.
- **Administration > Features** gains two areas: **Asset tags and scanning** (on by default) and
  **Mobile app** (off by default). Switched off, they disappear everywhere else as usual.

## 7. API summary

| Endpoint | Purpose |
|---|---|
| `GET /api/tags/resolve?value=` | Scan card (§4.2, §4.3) |
| `GET /api/tags`, `GET /api/tags/:id` | Tag list and detail (filters: status, type, batch) |
| `POST /api/tags/batches` | Make a batch: tags for chosen records, or blank codes |
| `POST /api/tags/:id/assign`, `/replace`, `/void`, `/lost` | Tag life cycle |
| `POST /api/tags/print` | PDF (or ZPL) for a batch, a list of tags or records, with template, layout and start position |
| `GET/POST/PATCH /api/tags/templates`, `/api/tags/layouts` | Templates and layouts |
| `GET/POST /api/inventory-counts`, `POST /api/inventory-counts/:id/scans`, `/finish` | Inventory counts |
| `GET /api/me/devices`, `DELETE /api/me/devices/:id` (and administrator equivalents) | Device sessions |
| `GET /api/mobile/home` | My work in one call |
| `GET /api/mobile/package`, `POST /api/mobile/sync` | Offline packages and the outbox |
| `/oauth/authorize`, `/oauth/token`, `/oauth/revoke` | Generalized from the AI-assistant OAuth server |

Permissions: `tags.view`, `tags.manage` (print, assign, replace, void, templates), `tags.count`
(inventory counts); scanning itself needs no permission beyond seeing the record. The default roles
get them as follows: administrators and asset managers all three; agents and maintenance roles
`tags.view` and `tags.count`; requesters none (they scan into the portal's "Report a problem").

## 8. Testing

- Server: unit tests for code generation and check characters, resolve (every match rule, restricted,
  held, switched-off and unknown answering alike), printing (layout geometry against expected label
  positions, PDF page sizes), counts, idempotent sync (the same outbox sent twice), device revocation,
  refresh-token reuse detection; the `permission-use`, coverage, features-hidden and spelling tests.
- Web: component tests for the scanner page (with a fake camera stream and a fake handheld scanner),
  the scan card and the print dialog; browser suite `21-tags` at 390 px and desktop widths; the
  accessibility audit on the new routes.
- Apps: component tests; Maestro flows for connect, sign-in (against a scratch server), scan (a test
  image fed to the camera), report a problem with a photo, an inspection completed offline and synced,
  sign-out wiping data; run on emulators in CI for every pull request that changes `mobile/` or the
  API the app uses.
- Printing: a printed test sheet checked on a real office printer and a real label printer before the
  first release (recorded in the roadmap like the other real-machine checks).

## 9. Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| 1 | Publish the app in the App Store and Google Play under the project, or source only (each organization builds its own)? Publishing needs an Apple developer account (yearly fee) and a Google Play developer account (one-time fee), held by whoever publishes | Both: source and build instructions for organizations that want their own, and a published app for everyone else, if you are willing to hold the accounts |
| 2 | Push notifications: none, per-organization credentials, a relay run by the publisher, or UnifiedPush? | Release without push; add per-organization credentials first (no shared service), then decide on a relay with pilot feedback |
| 3 | Anonymous "Report a problem" from a tag (§4.8)? | Build it, off by default, in the second tags release |
| 4 | App name and identifiers (bundle ID, package name, app link domain) | A neutral name such as "Sandpiper GRC"; identifiers under a domain the project controls |
| 5 | Is a thermal-printer format (ZPL) needed in the first release, or is PDF enough? | PDF first; ZPL when a pilot's printer needs it |

## 10. Delivery plan

| Wave | Contents | Result |
|---|---|---|
| 13 | E37-01 to E37-10: tag registry and codes, templates and layouts, printing, web scanner and scan card, quick actions, blank tags, inventory counts, guide | Print tags and scan them with any phone's browser, no app |
| 14 | E38-01 to E38-09: app foundations, generalized OAuth and devices, connect and sign-in, My work, scan, report, record views, approvals, notifications list; CI builds | Online app on both platforms, installable for testing |
| 15 | E38-10 to E38-13, E37-11, E37-12: offline packages and outbox, offline inspections, condition and counts, app guide; anonymous reports and ZPL if decided | Field work without signal; first store release (if decision 1 is to publish) |
| 16 | E38-14: push notifications, as decided | Notifications on the phone |

Each wave follows the usual rules: guide pages, docs and the roadmap updated in the same change;
switched-off areas hidden everywhere; targeted browser tests per change and the full suite on CI.
