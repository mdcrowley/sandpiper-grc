# Asset tags and mobile apps: specification

**Status:** proposed (not built). **Epics:** [E37 Asset tags: numbers, printing and lookup](../epics/E37-asset-tags.md),
[E38 Mobile apps for iPhone and Android](../epics/E38-mobile-apps.md). **Date:** November 2026.

This document describes what will be built and why. The epics hold the issues, each with its
acceptance criteria; this document holds the design those issues share. When an issue is built, its
"Implemented in" line points at the code, and this document is updated where the build differed.

## 1. Goals

1. **An asset tag is a value, carried however the tag carries it.** Organizations buy pre-printed asset
   tags or print their own. The value may be a plain number, letters and digits, a barcode, a QR code,
   a Data Matrix code, or several of these on one tag; the application does not care which. It keeps
   track of which value is on which asset, vehicle, site or system. The application never puts a web
   address on a tag.
2. **Point the app's camera at the tag to act on the thing it is stuck to:** the app works out what the
   tag carries (a barcode or 2D code, printed text, or both), reads the value on the phone, finds the
   record, and offers what the person may do: report a problem, edit it, record its condition, run its
   inspection, attach a photo, count it in an inventory check.
3. **Native apps for iPhone and Android** for people who work away from a desk: maintenance staff,
   operators, inspectors, supervisors and managers who approve things on the move. The apps do a
   focused set of field tasks very well, including without a network connection; they do not copy
   the whole desktop application.
4. **Nothing new to host.** Tags are ordinary labels; the camera reading happens on the phone; the
   apps talk only to the organization's own server.

### Who uses it

| Person | Typical use |
|---|---|
| Inventory or asset manager | Registers bought tag stock or prints tags, attaches tags to new equipment, replaces damaged tags, runs inventory counts |
| Maintenance technician | Photographs a tag, sees open tickets and history, updates status, records condition, attaches photos |
| Operator or frontline employee | Photographs the tag in a vehicle or on station equipment to report a defect or a hazard |
| Inspector or auditor | Runs scheduled inspections on site, offline, with photos |
| Service desk agent | Types a tag number a caller reads out, or uses a handheld scanner on barcoded tags, to find the asset |
| Manager or approver | Reviews and decides approvals, acknowledges policies, sees what is assigned to them |

### Not in scope

- Web addresses or links on tags made by the application. (A bought tag whose code happens to hold
  an address is read like any other value: see §3.2.)
- Asset tracking by GPS, RFID or Bluetooth beacons (a tag is read when someone photographs or types it).
- Maintenance work orders and parts (recorded as "Not planned" in E32-06; a defect raises a service
  desk ticket, which a maintenance system can pick up through the work-tracker bridge, E36-06).
- Reporting by people without an account, and a rider-facing public app.
- App store releases for now: the apps are tested through TestFlight (iPhone) and installed directly
  on Android (§5.10).
- The full desktop application on a phone: administration, report building, framework work and
  dashboard editing stay in the web application.

## 2. Approach in brief

- **Tag values are data, not links.** Each taggable record has a tag value field (called "Tag number"
  on screen, though it may hold letters); values are unique across all taggable types; a history keeps
  earlier values when a tag is replaced.
- **The camera decides what the tag carries.** The app reads every barcode and 2D code in view (QR,
  Data Matrix, PDF417, Aztec, Code 128, Code 39, Code 93, EAN, UPC, ITF, Codabar) and the printed text,
  on the phone. A decoded code with a check character is exact; Code 39, Codabar and ITF need a second
  reading. Printed text is read with text recognition and checked against the organization's tag
  formats, because text recognition can misread.
- **Tag formats and tag stock** (both optional) tell the application what a valid value looks like
  (prefix, letters and digits, length, optional check digit, or a pattern) and which values or ranges
  the organization has bought or printed. They make reading printed text reliable and let the app tell
  a misread from a real tag that is simply not attached yet.
- **The picture never leaves the phone** unless the person attaches it to a record.
- **One "tag card" for every way of finding a tag** (photo in the app, typed number, handheld scanner on
  the web): the server works out what the number is and which actions this person may take
  (permissions, switched-off areas, restricted records, legal holds); the app and the web both draw
  that answer.
- **The apps are built with React Native and Expo** (open source, MIT), in TypeScript, in a `mobile/`
  folder of this repository, sharing an API client generated from the server's OpenAPI description.
- **The apps sign in through the phone's browser** with OAuth 2.1 and PKCE (the authorization server
  built for AI assistants, E21, generalized), so single sign-on, passkeys and second factors work unchanged.
- **Phased:** tag numbers, printing and lookup on the web first, then the app with photo reading and the
  online features, then offline work, then push notifications.

## 3. Tags

### 3.1 What can be tagged

Assets (including vehicle equipment), vehicles, sites (stations, depots, rooms, cabinets) and systems
(for example a rack or a signal cabinet that stands for a system). The list is a registry, like the
calendar sources (`core/asset-tags.ts`, `defineTaggable(app, { type, field, identifiers, … })`; `core/tags.ts` holds the
free-text labels any record can carry, a different thing), so a module adds its own
type without core changes. A type in a switched-off area is not taggable, and its tag numbers answer
as if unknown, except to administrators, who are told the area is off.

### 3.2 Tag values

- A tag value is the string the tag carries, up to 200 characters: digits (`004521`), letters and
  digits (`TA-118342`, `K7Q2M9`), or whatever a barcode or 2D code holds. On screen it is called the
  **Tag number** because that is what people call it, even when it has letters.
- **How it is compared:** one comparison form for every source (text, typed, handheld scanner or a
  decoded code): the value is trimmed, made uppercase, and spaces, dashes, underscores and invisible
  control characters are removed (`valueKey` in `shared/tag-format.ts`, used by the server, the web
  and the app alike). So `ta-118 342` and a code holding `TA_118342` are the same tag, and two values
  that differ only in those ways cannot both be in use. Leading zeros always count (`004521` is not
  `4521`).
- **Codes that hold more than the value:** some bought tags encode extra content (a supplier prefix, a
  record of several fields, even a web address from the label maker). A format can say which part is
  the value (a pattern with one marked part); otherwise the whole decoded content is the value. The
  application never opens or follows anything a tag holds.
- **One tag, several carriers:** a tag that has both a barcode and printed text is one value; the app
  reads whichever it can and, when it reads both, uses them to confirm each other.
- **Unique across all taggable types**, so a value alone identifies one record.
- **The asset's existing Tag field becomes its tag number** (assets already have a unique `tag`, used
  as their reference `AST-…`); vehicles, sites and systems gain a **Tag number** field. An asset
  imported or created without a tag keeps working; the number is added when a tag is stuck on.
- Other identifiers stay as they are (serial number, fleet number, vehicle identification number,
  site code) and can be found the same way (§4.2), but they are not tag numbers.

### 3.3 Tag formats and tag stock

**Tag formats** (Administration > Asset tags) describe what this organization's tags look like. They
are optional; they matter most for printed text, which the camera can misread:

| Setting | Example |
|---|---|
| Characters | Digits only, letters and digits, or a pattern (for advanced use) |
| Prefix (optional) | `TA-` |
| Length (exact, or a range) | 6 |
| Check character (none, mod 10, mod 11, mod 36) | mod 10 (the last digit checks the others, as many bought tags have) |
| How the tag carries it | Any, text only, a barcode or 2D code, or both |
| Part of a code that is the value (optional) | A pattern with one marked part, for codes holding more than the value |
| Which record types use it (optional) | Assets and vehicle equipment |

An organization usually has one or two formats (bought tags for equipment, a different series for
sites). Without any format, a decoded barcode or 2D code is accepted as it is, and printed text is
accepted when it is 3 to 40 letters, digits and dashes and is confirmed by the person (§5.5).

**Tag stock** records numbers the organization owns but has not attached yet:

- **Bought tags:** "We received tags 010000 to 010999" registers that range, with an optional supplier
  note and date. No numbers are created one by one; the range is stored as a range.
- **Printed tags:** printing new tags (§3.5) takes the next numbers from a **series** (prefix, next
  number, digits) and registers them as stock.
- A number in stock but not attached is **available**; attaching takes it out of stock. Numbers can be
  marked **void** (damaged, never used) or **lost**.

### 3.4 Data model (module `tags`)

| Table | Columns (main) |
|---|---|
| `tag_formats` | `id`, `name`, `characters` (`digits`, `alphanumeric`, `pattern`), `pattern`, `prefix`, `length_min`, `length_max`, `check_character`, `carrier` (`any`, `text`, `code`, `both`), `extract_pattern`, `record_types`, `active` |
| `tag_ranges` | `id`, `format_id`, `first`, `last` (for sequential values), or a list of values (for bought tags that are not sequential, imported from a file), `source` (`bought`, `printed`), `note`, `received_on`, `created_by` |
| `tag_series` | `id`, `format_id`, `next_number` (for printing your own) |
| `tag_assignments` | `id`, `value` (as read), `value_key` (normalized for comparison), `record_type`, `record_id`, `status` (`active`, `replaced`, `void`, `lost`), `assigned_at`, `assigned_by`, `ended_at`, `replaced_by`, `reason` |
| `tag_lookups` | `id`, `value_key`, `person_id`, `at`, `source` (`app_code`, `app_text`, `app_typed`, `web`), `action`. Kept `retention.tag_lookups_days` (default 90); off entirely with `tags.log_lookups` |

- The current number lives on the record (its tag number field), and `tag_assignments` keeps the
  history, so finding a replaced number still leads to the record, with a notice that the old tag
  should be removed.
- One active tag per record by default; a setting allows several (a long vehicle may carry a tag at
  each end).
- Tags follow the record's retention: when a record is anonymized or removed, its numbers are ended.
  A record under a legal hold cannot have its tag ended or moved (`assertNotHeld`).

### 3.5 Printing your own tags

For organizations that print rather than buy:

- **What prints:** the tag value in large, clear type, and optionally a code holding the same value: a
  linear barcode (Code 128), a QR code or a Data Matrix code (small tags). Options: a line above it
  (for example the organization's name or "Property of …") and the organization's logo (branding,
  E14-36). A code holds only the value, never an address. Printing both text and a code is the default,
  so a tag can be read by the camera, by a handheld scanner, or by a person reading it aloud.
- **Where:** Administration > Asset tags > Print tags: choose the series and how many (new numbers),
  or reprint existing numbers (a list, or the tags of selected records from a list's bulk action).
- **Output:** a PDF made on the server with the existing PDF engine, sized exactly for the label stock:
  - **sheet layouts** for office printers: presets for common Letter and A4 sheet sizes, described by
    their dimensions, and custom (rows, columns, margins, gaps), with "Start at label" for partly
    used sheets and an alignment test page;
  - **roll layouts** for label printers: one label per page at the label's exact size;
  - a thermal-printer format (ZPL) for label printers, with the same fields and sizes as the PDF.
- **Legibility for reading by camera:** a plain sans-serif typeface with distinct `0`/`O` and `1`/`I`,
  minimum text height (default 5 mm), high contrast, no text over the logo. The guide gives the same
  advice for choosing bought tags.
- Printing is audit-logged (who printed which numbers).

## 4. Finding a tag and acting on it

### 4.1 Ways to find a tag

| Way | How it works |
|---|---|
| **Camera in the app** (the main way) | Point the camera at the tag: the app reads any barcode or 2D code and the printed text on the phone, works out the value (§5.5) and asks the server about it. A shutter button takes a still picture for tags that are hard to hold steady on |
| **Typed in the app** | A number pad entry with the format's prefix filled in |
| **Typed on the web** | The global search box and a "Find by tag number" box on the inventory pages accept a tag number |
| **Handheld scanner on the web** | For tags with a barcode or 2D code: a keyboard-mode scanner types the decoded value and Enter into the same boxes |

### 4.2 Resolving a number

`GET /api/asset-tags/lookup?value=<text>` (and `POST /api/asset-tags/lookup` with up to 10 candidates and how
each was read, for the app's camera) answers, for each candidate:

1. A **current** tag number → that record.
2. A **replaced** number → the record, with "This tag was replaced by <new number>".
3. A number **in stock** (bought or printed, not attached) → "Tag <number> is not attached yet",
   with Attach for people who may (E37-07).
4. A number that matches a format but is **unknown** → "Tag <number> is not in your tag stock",
   with Attach for people who may manage tags (a bought range not yet registered, for example).
5. Otherwise an exact match on other identifier fields (serial, fleet number, vehicle identification
   number, site code; each taggable type declares its own) among records the person may see.
6. Nothing → "Nothing found for <text>", identical whether the record does not exist or the person may
   not see it.

A check digit that does not match is refused before any lookup (the app treats it as a misread).

### 4.3 The tag card

For the record found, the answer lists:

- Its type, name, tag number, status, photo (the image attachment marked as the record's photo),
  location, owner or assignee, and a few type-specific facts (for an asset: condition rating, next
  inspection; for a vehicle: fleet number, mode, odometer; for a site: kind, open tickets there).
- Recent activity: open tickets linked to it, the last inspection and condition assessment, recent
  changes, all limited by what the person may see.
- **Actions**, each computed on the server from the person's permissions, the switched-on areas, the
  record's lifecycle and holds. The client never decides what is allowed; it only draws the list.

| Action | Shown when | Does |
|---|---|---|
| Report a problem | Service desk on, may create tickets (or portal access) | New ticket with the record pre-filled as the affected asset, system or site; photos |
| Report a hazard or close call | Safety on, may report | New safety report at the record's site, with the record linked |
| Edit | May edit the record | The record's edit form (web) or the app's field form (§5.4) |
| Quick updates | May edit | Change status, location, assignee or custodian in one step, audit-logged like any edit |
| Add photo or note | May comment or attach | Camera photo or note on the record |
| Record condition | Asset condition on, may assess | New condition assessment for the record |
| Start inspection | Audits on, an inspection is scheduled or a checklist applies | Opens the inspection runner for it |
| Count it | An inventory count is open and the record belongs to it | Marks it found (§4.5) |
| Replace tag | May manage tags | Records a new number for the record (photograph or type it); the old one is marked replaced |
| Open full record | Always | The record page (web) or record view (app) |

### 4.4 Restricted, held and switched-off records

- A restricted record (security, privacy, investigation) answers "Nothing found" to someone who may
  not see it, exactly as an unknown number does, and the lookup is not logged against the record.
- A record under a legal hold shows its hold banner; actions that would change it are left out.
- A record in a switched-off area answers "Nothing found", except to administrators.

### 4.5 Inventory counts

A count checks that what the register says is at a place is really there.

1. A person with the `tags.count` permission starts a count for a site (and optionally a room or area
   within it, and record types). The count lists what is **expected** there.
2. People photograph tags in the app (offline too) or type them on the web. Each one marks the record
   **found**; a record registered elsewhere is **unexpected**. Counting mode keeps the camera open and
   adds each new number it reads, with a sound and vibration, so a shelf of equipment goes quickly.
3. Finishing the count lists what is **missing**. For each unexpected record the counter may move it
   here (updating its location); for each missing one, mark it missing (status) or leave it. A
   discrepancy summary can raise a ticket or an action.
4. Every found record gets its "last verified" date and place. A report lists counts, coverage by site
   and records not verified for longer than a chosen time.

Tables `inventory_counts` and `inventory_count_items`. Counts are records with history, comments and
attachments like any other.

### 4.6 Lookup history

When lookup logging is on, each record's page shows "Last seen" (when, by whom, how). The log is kept
90 days by default, visible to people who may edit the record, and included in retention and
anonymization. The phone's location is never recorded.

## 5. The mobile apps

### 5.1 Technology

| Choice | Decision | Why |
|---|---|---|
| Framework | React Native with Expo (MIT), TypeScript | One code base for iPhone and Android, the same language and React knowledge as the web application, open source |
| Camera | `react-native-vision-camera` (MIT) with frame processors | Live preview, still pictures, torch, and on-device processing of each frame |
| Reading text | Google ML Kit on-device text recognition on both platforms, model bundled in the app (§9, decision 2), through `react-native-vision-camera-ocr-plus`; translation and other scripts switched off | Fast and accurate on printed numbers; images never leave the phone (ML Kit usage reporting is switched off in the build, see §5.8) |
| Reading codes | The platform's on-device code reading through the camera library: QR, Data Matrix, PDF417, Aztec, Code 128, Code 39, Code 93, EAN-8, EAN-13, UPC-A, UPC-E, ITF and Codabar | Bought tags carry any of these; the platform readers are fast and exact |
| Where | `mobile/` in this repository, its own `package.json`; the shared API client in `packages/api-client` generated from `GET /api/openapi.json` | Server and app change together and are tested together |
| Builds | Local builds with Xcode and Android Studio after `expo prebuild`, and in GitHub Actions (Android on Linux, iPhone on macOS runners); no paid build service | No paid services |
| Minimum versions | iOS 16 and Android 10 (API 29) | Covers the phones in use while keeping current security features |
| Tests | Jest and React Native Testing Library; Maestro (Apache 2.0) flows on emulators in CI | Open source, scriptable |

### 5.2 Connecting to a server and signing in

1. **Connect:** the first screen asks for the server address (typed; it is remembered). The app checks
   `GET /api/mobile/hello` (public, answers only while the Mobile app area is on) for compatibility (§5.9)
   and refuses plain HTTP except for development builds.
2. **Sign in:** the app opens the phone's browser sign-in sheet (ASWebAuthenticationSession on iOS,
   Custom Tabs on Android) at the server's `/oauth/authorize` with PKCE. Everything the person normally
   uses works there: password, second factor, passkey, single sign-on, the break-glass rules. The
   server returns to the app through the app's own redirect scheme, and the app exchanges the code
   for tokens. (This is the standard sign-in for native apps; it is not a link a person sees or types.)
3. **Tokens:** a short-lived access token (15 minutes) and a rotating refresh token (30 days of
   inactivity, an administrator setting), bound to this installation. Stored only in the iOS Keychain
   or Android Keystore. Reuse of an old refresh token revokes the whole device session.
4. **Unlock:** optionally (or required by an administrator) Face ID, fingerprint or the device
   credential before the app opens after a set idle time.
5. **Devices:** each signed-in installation is listed on **Account > Devices** (name, platform, app
   version, last used) and on an administrator's user page; either can sign it out. Deactivating a
   user (including SCIM deprovisioning) signs out all their devices; the next refresh fails and the
   app wipes its local data.
6. **Sensitive actions** that ask for the password again on the web (E01-33) ask again in the app
   through the same browser sign-in with `prompt=login` and a short "recent sign-in" claim.

The OAuth server built for AI assistant connections (E21) is generalized: client kinds `assistant` and
`mobile`; the mobile client is registered by the application itself, needs no administrator step, and
is switched off with the **Mobile app** area. Mobile access tokens carry the person's own permissions,
because the app acts on their behalf like the web application.

### 5.3 Screens (first release)

| Screen | Contents |
|---|---|
| **My work** | Tickets assigned to me, my actions, approvals waiting for me, inspections due, condition assessments due, policy acknowledgments and training due; counts and the first few of each |
| **Tag** (camera) | Full-screen camera that reads tag numbers (§5.5), torch, shutter for a still picture, number pad entry; then the tag card (§4.3) |
| **Report** | Report a problem (ticket) or a hazard or close call (safety), with photos, location picked from sites, and the record linked when started from a tag |
| **Search** | Search across what the person may see; recent items; opens a record view |
| **Record view** | Phone layouts for assets, vehicles, sites, systems, tickets, actions, safety reports and inspections: summary, key fields, activity, comments, attachments; edit where §5.4 allows |
| **Approvals** | Waiting approvals with what is being approved, approve or reject with a reason; password confirmation when the step requires it |
| **Inspections** | Run an inspection from its checklist: pass, fail or not applicable per item, notes, photos, findings; works offline (§5.6) |
| **Notifications** | The in-app notification list, read state shared with the web |
| **Account** | Who is signed in, server, devices, unlock settings, sign out, about and licenses |

### 5.4 Editing in the app

The app edits a chosen set of fields per type (status, assignee, location, condition, notes, tag
number, and the fields a type marks `mobileEditable` in its resource definition). The server validates
exactly as for the web (one code path). Edits send `If-Match` with the version the person saw; a
conflict shows both values and lets the person choose. When a form needs fields the phone form does
not show, the app says to finish on the web rather than failing.

### 5.5 Reading a tag with the camera

The person does not choose between "scan a barcode" and "read a number": the app looks for
everything at once and works out what the tag carries.

1. The camera preview runs code reading (every symbology in §5.1) and text recognition on the phone,
   a few times a second.
2. **Codes first.** A decoded code that carries a check character (QR, Data Matrix, PDF417, Aztec,
   Code 128, Code 93, EAN, UPC) is exact. Code 39, Codabar and ITF have none, and the reader can drop or
   misread a character (measured: a small Code 39 `TA-118350` read as `TA-18350`), so one of these counts
   only after two matching frames, matching printed text on the tag, or, from a still picture, the
   person's confirmation. The app applies the format's extraction pattern if one matches (§3.2),
   otherwise takes the whole content.
3. **Printed text next.** Each line of text read is normalized (case, spaces, dashes) and compared with
   the organization's tag formats, including the check character. For formats that are digits only,
   the usual look-alikes are corrected inside the digit part (`O`→`0`, `I`/`l`→`1`, `S`→`5`, `B`→`8`);
   for letters-and-digits formats they are not, and ambiguous characters are resolved against the
   server instead (step 5). Text must be read the same way in two consecutive frames before it counts
   (a still picture counts at once). Text that matches a format without a check character, and any text
   when no format exists, is offered only for the person to confirm, never acted on by itself; with no
   format, only text containing a digit is offered. Codabar start and stop characters are removed.
4. **When a tag has both,** a code and text that agree confirm each other; when they disagree, the code
   wins and the text is ignored. Each candidate is outlined on screen, with how it was read.
5. The app asks the server about the candidates (§4.2; up to 10 at once, with look-alike variants of
   ambiguous text). One record found → its tag card. Several tags in view (a shelf) → a list to choose
   from (in counting mode, all of them are added). A value in stock but not attached → offers Attach.
   Nothing matching → "Couldn't find this tag" with what was read shown for correction, and the
   keyboard.
6. The shutter takes a still picture for hard cases (glare, curved surfaces, small tags); the picture
   is turned upright (camera pictures are stored sideways with an orientation flag the readers ignore),
   read the same way and then discarded, unless the person attaches it to the record.
7. Offline, numbers are looked up in the offline package (§5.6).

Accuracy is measured with a test set of tag photos kept in the repository: every code type in §5.1,
plain digits, letters and digits, tags with both, dirty, scratched, curved, angled and in low light. The
target is the right record or a correct "couldn't find" on at least 98% of them, and never a wrong
record: codes with a check character are exact, codes without one need a second reading, and text is
acted on only when a format and its check character (or the person) confirm it.

### 5.6 Offline work

Offline is limited to work that happens where there is no signal: **inspections**, **condition
assessments**, **inventory counts**, **reports** (problems and hazards) and **photos and notes**.

- **Before going out**, the app downloads a work package: the inspections assigned or scheduled for the
  coming days with their checklists and the records they cover, the open inventory counts the person
  joined, the tag formats, and a lookup table of tag numbers and identifiers for those records. Each
  package has an expiry (administrator setting, default 7 days); expired packages are deleted.
- **While offline**, work is saved in an on-device SQLite database in the app's protected storage (iOS
  Data Protection, Android file-based encryption), with photos as files beside it. A tag outside the
  package is "not available offline".
- **When back online**, an outbox sends each item once, in order: every item carries a client-made UUID
  and an `Idempotency-Key`, so a retry never creates a duplicate. Photos upload in parts and resume. A
  rejected item (the inspection was cancelled, the record was deleted, permission was removed) stays in
  "Needs attention" with the server's reason; nothing is dropped silently.
- **Signing out or being signed out** wipes the database and photos after warning about unsent work.
- Server side: `GET /api/mobile/package`, `POST /api/mobile/sync` (a batch of outbox items, each answered
  separately), idempotency kept 7 days (`idempotency_keys` table, usable by any route).

### 5.7 Notifications on the phone

- **First release:** no push. The app refreshes My work and Notifications when opened and on pull to
  refresh; email notifications continue as today.
- **Push (later, E38-14):** with the apps installed through TestFlight and directly on Android (§5.10),
  the project's own push credentials can be configured on the server for Apple's and Google's push
  services, or UnifiedPush on Android. Push messages carry only "you have N new notifications", never
  record details; the app fetches the rest from the server.

### 5.8 Security

- All traffic over HTTPS with the platform's certificate checks; no certificate pinning (each
  organization has its own certificates), and no user-installed certificate authorities trusted in
  release builds on Android.
- No analytics, crash reporting or advertising libraries that send data anywhere. Crash reports stay on
  the device until the person chooses to share one.
- Camera pictures are processed on the phone and discarded unless attached to a record.
- Screenshots of restricted records are blocked on Android and the app switcher shows a blank screen on
  iOS while a restricted record is open.
- The app holds only what the person may see; the server enforces every rule; offline packages hold
  only what the person's work needs and expire.
- Administrators can switch the Mobile app area off (all devices signed out), require the unlock, set
  token lifetimes and offline package expiry, and see every device.
- The threat model is added to `docs/security.md`; the independent review (E16-40) covers the apps and
  their endpoints.

### 5.9 Versions and compatibility

The server reports the range of app versions it supports: before signing in through the public
`GET /api/mobile/hello` (which does not reveal the server's own version), and to signed-in people in
`GET /api/version` (`mobile: { minVersion, recommendedVersion }` while the Mobile app area is on). The app refuses to connect to a server too old for it,
and tells the person to update the app when it is older than the server allows.

### 5.10 Installing the apps (beta)

For now the apps are not in the App Store or Google Play:

- **iPhone: TestFlight.** Testers get an email or a public TestFlight invitation and install from the
  TestFlight app; builds expire after 90 days, so a new build is uploaded at least that often. This
  needs an Apple Developer Program membership (a yearly fee) for whoever uploads the builds; there is
  no practical way to put an app on iPhones without one.
- **Android: direct install.** A signed APK attached to each GitHub release (and to CI runs), installed
  after allowing "install unknown apps"; or pushed by the organization's device management. Optionally
  a Google Play internal testing track later. The signing key is kept outside the repository.
- `docs/mobile.md` covers both, including building and signing your own copy.

## 6. Changes to the web application

- Taggable record pages show the **Tag number** with its history (Tags panel: current number, earlier
  numbers, attach, replace, end) and "Last seen".
- The global search box and a **Find by tag number** box on the inventory pages accept a tag number
  (typed or from a handheld scanner) and open the tag card as a page.
- **Administration > Asset tags:** tag formats, tag stock (received ranges, available numbers),
  series for printing, print tags, settings (several tags per record, lookup log and its retention).
- **Inventory counts** under Inventory: list, start, count (typing or a handheld scanner), finish, report.
- **Account > Devices** for the mobile app.
- **Administration > Features** gains two areas: **Asset tags** (on by default) and **Mobile app** (off by
  default). Switched off, they disappear everywhere else as usual.

## 7. API summary

| Endpoint | Purpose |
|---|---|
| `GET /api/asset-tags/lookup?value=`, `POST /api/asset-tags/lookup` | Tag card for a value, or for up to 10 candidates read by the camera (§4.2, §4.3). The base is `/api/asset-tags` because `/api/tags` holds the free-text labels of any record |
| `GET/POST/PATCH /api/asset-tags/formats`, `/api/asset-tags/ranges`, `/api/asset-tags/series` | Formats, stock and series |
| `POST /api/asset-tags/attach`, `/replace`, `/end` | Tag life cycle on a record |
| `POST /api/asset-tags/print` | PDF (or ZPL) of new numbers from a series or of existing numbers, with layout and start position |
| `GET/POST /api/inventory-counts`, `POST /api/inventory-counts/:id/found`, `/finish` | Inventory counts |
| `GET /api/me/devices`, `DELETE /api/me/devices/:id` (and administrator equivalents) | Device sessions |
| `GET /api/mobile/hello` | Before signing in (public): the app versions accepted and the OAuth endpoints |
| `GET /api/mobile/home` | My work in one call |
| `GET /api/mobile/settings` | Tag formats and app settings for the signed-in person |
| `GET /api/mobile/package`, `POST /api/mobile/sync` | Offline packages and the outbox |
| `/oauth/authorize`, `/oauth/token`, `/oauth/revoke` | Generalized from the AI-assistant OAuth server |

Permissions: `tags.view` (see tag history and stock), `tags.manage` (formats, stock, printing, attach,
replace, end), `tags.count` (inventory counts). Looking up a tag needs no permission beyond seeing the
record. Default roles: administrators and asset managers all three; agents and maintenance roles
`tags.view` and `tags.count`; attaching a number to a record also needs edit permission on it.

## 8. Testing

- Server: number normalization and check digits for each scheme, ranges (overlap refused, stock
  counts), lookup (every rule in §4.2; restricted, held, switched-off and unknown answering alike),
  printing (label geometry, PDF sizes, series numbering under concurrent prints), counts, idempotent
  sync (the same outbox sent twice), device revocation, refresh-token reuse detection; the
  `permission-use`, coverage, features-hidden and spelling tests.
- Web: component tests for Find by tag number (typed and handheld scanner), the tag card, the print
  dialog, formats and stock; browser suite `21-tags`; the accessibility audit on the new routes.
- Apps: unit tests for candidate extraction and normalization (look-alike characters, check digits,
  two-frame agreement); the tag photo test set (§5.5) run against the recognizers on emulators and
  real phones; Maestro flows for connect, sign-in, reading a tag from a test image, reporting a problem
  with a photo, an inspection completed offline and synced, sign-out wiping data.
- Real-device checks before each beta: reading bought and printed tags on at least one iPhone and one
  Android phone, in daylight, indoors and in low light (recorded in the roadmap like the other
  real-machine checks).

## 9. Decisions

Decided by the project owner in November 2026:

| # | Question | Decision |
|---|---|---|
| 1 | Apple Developer Program membership for TestFlight, and the Android signing key | The project owner holds both. Not needed to build: CI makes unsigned builds until the first beta is signed |
| 2 | Android text recognition | The platform's built-in on-device recognizer (Google's, model bundled in the app; works offline, sends nothing) |
| 3 | What the organization's tags look like | Not known yet: nothing is assumed. Tag formats are configuration (Administration > Asset tags), none supplied by default; codes are accepted as they are and text is confirmed by the person until a format exists |
| 4 | App name and identifiers | **Sandpiper GRC**; bundle ID and Android package `com.sandpipergrc`; redirect scheme `com.sandpipergrc:/oauth` |
| 5 | Printing formats | Both PDF (sheet and roll layouts) and a thermal-printer format (ZPL) in the first tags release |

## 10. Delivery plan

| Wave | Contents | Result |
|---|---|---|
| 13 | E37-01 to E37-09: tag values on records, formats and stock, lookup and the tag card on the web, actions, attach and replace, printing, inventory counts (web) | Tags tracked; found by typing or a handheld scanner; printed tags |
| 14 | E38-01 to E38-09: app foundations, generalized OAuth and devices, connect and sign-in, My work, reading tags with the camera, report, record views, approvals, notifications; CI builds; first TestFlight and Android betas | The app on testers' phones |
| 15 | E38-10 to E38-13, E37-10: offline packages and outbox, offline inspections, condition and counts, app guide and install instructions, lookup history and the tags guide | Field work without signal |
| 16 | E38-14: push notifications | Notifications on the phone |

Each wave follows the usual rules: guide pages, docs and the roadmap updated in the same change;
switched-off areas hidden everywhere; targeted browser tests per change and the full suite on CI.
