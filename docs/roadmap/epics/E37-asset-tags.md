# E37 Asset tags: values, printing and lookup

**Status:** in progress (9 of 10 issues done)

## Goal

Keep track of which asset tag is on which asset, vehicle, site or system, whatever the tag carries:
printed digits, letters and digits, a barcode, a QR code or a Data Matrix code. Organizations buy tags
or print their own; people find a tag by pointing the mobile app's camera at it (E38-05), by typing it,
or with a handheld scanner, and act on the record. The design is in
[the asset tags and mobile apps specification](../specs/asset-tags-and-mobile-apps.md) (§3, §4, §6, §7);
section numbers below refer to it.

## Scope notes

- New module `tags` and feature area **Asset tags** (on by default). Switched off, tag values, stock,
  printing, counts and their actions appear nowhere except Administration > Features.
- The application never puts a web address on a tag, and never opens anything a tag holds.
- The camera reading itself is in the mobile app (E38-05); this epic is the server and the web side.
- Not planned: GPS, RFID or Bluetooth tracking; maintenance work orders (E32-06); reporting by people
  without an account.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E37-01 | Tag values on records, taggable types and history | done | P1 |
| E37-02 | Tag formats | done | P1 |
| E37-03 | Tag stock: bought ranges and lists, printed series | done | P1 |
| E37-04 | Look up a tag and the tag card | done | P1 |
| E37-05 | Find by tag on the web, typed or with a handheld scanner | done | P1 |
| E37-06 | Actions from a tag: report a problem, quick updates, photos | done | P1 |
| E37-07 | Attach, replace and end tags | done | P1 |
| E37-08 | Print your own tags | in progress | P2 |
| E37-09 | Inventory counts | done | P2 |
| E37-10 | Lookup history, guide page and sample data | done | P2 |

---

### E37-01 Tag values on records, taggable types and history

**Status:** done · **Priority:** P1 · **Type:** feature

An asset manager wants each asset, vehicle, site and system to carry the value of the tag stuck on it,
unique across everything, with a history when tags are replaced.

**Acceptance criteria**

- [x] `defineTaggable(app, …)` registry in `core/asset-tags.ts`; assets, vehicles, sites and systems registered by their modules, each naming its other identifier fields for lookup; a type in a switched-off area is not taggable
- [x] The asset's existing Tag field is its tag value; vehicles, sites and systems gain a **Tag number** field; values unique across all taggable types (compared by `value_key`, §3.2), checked under concurrent writes
- [x] `tag_assignments` history; one active tag per record unless the setting allows several
- [x] Permissions `tags.view`, `tags.manage`, `tags.count`, given to the default roles as in §7; area **Asset tags** in `core/features.ts`
- [x] Retention ends a record's tags when it is anonymized or removed; a held record's tags cannot be ended or moved
- [x] Tests: uniqueness across types, comparison rules (text versus code values), registry, retention and holds, features-hidden, permission-use

How it works: `tag_assignments` is the source of truth (a unique index on the value key of active
values) and the record's field is a copy of its primary value. The tags module wraps each taggable
type's `beforeCreate` and `beforeUpdate` hooks, so a form edit, an import, a bulk edit, the app and the
attach/replace/end routes all claim a new value, mark the earlier one replaced or end a cleared one, with
the audit actions `tag.attach`, `tag.replace` and `tag.end`. Assets numbered automatically (`AST-00001`)
skip numbers in use on other records. Existing values (asset tags from before wave 13, values written while
the area was off) are claimed at start and by the daily job `tags.reconcile`; a value found on two records
is reported in the server log, never moved, and never stops an edit of the record's other fields. A held
record's tags cannot be attached, replaced or ended (409 `on_hold`, through the field too). Deleting or
removing a record ends its tags; anonymizing ends them and clears the Tag number (an asset keeps its `tag`,
which is also its reference).

**Implemented in:** `server/src/modules/tags/assignments.ts` (hooks, claims, reconcile, retention, routes `GET /api/asset-tags/record`), `common.ts`, `store.ts`; the registrations in `inventory/fields-tags.ts` and `fleet/fields-tags.ts`; tests `tags/assignments.test.ts`, `core/asset-tags.test.ts`

### E37-02 Tag formats

**Status:** done · **Priority:** P1 · **Type:** feature

An administrator wants to tell the application what the organization's tags look like, so that
printed text read by the camera can be trusted and misreads are refused.

**Acceptance criteria**

- [x] Formats with characters (digits, letters and digits, or a pattern), prefix, length, check character (none, mod 10, mod 11, mod 36), carrier (any, text, code, both), an optional extraction pattern for codes holding more than the value, and record types (§3.3)
- [x] Administration > Asset tags > Formats, with a "try a value" box that says whether and how it matches
- [x] Formats reach the app through `GET /api/mobile/settings` (`loadFormats` in `tags/store.ts`); the offline package carries them when E38-10 builds it
- [x] Without any format, code values are accepted as they are and text needs the person's confirmation
- [x] Tests for each check scheme, extraction patterns and pattern safety (patterns are limited in length and checked so they cannot hang the server)

A typed value on a record (the Tag number field, or attach and replace with source `typed` or
`handheld`) must match one of the active formats for its type when any exist; a code or text read by the
app is taken as read (the app checks text against the formats and the person confirms).

**Implemented in:** `shared/tag-format.ts` (+ `tag-format.test.ts`), `server/src/modules/tags/formats.ts` (`/api/asset-tags/formats`, `/formats/try`), `web/src/modules/tags/Formats.tsx`, `AdminTabs.tsx`; tests `tags/store.test.ts`

### E37-03 Tag stock: bought ranges and lists, printed series

**Status:** done · **Priority:** P1 · **Type:** feature

An asset manager who receives a box of pre-printed tags wants to register them, so the application
knows they are ours and not yet attached.

**Acceptance criteria**

- [x] Register a sequential range ("010000 to 010999") or import a list of values from a file for tags that are not sequential; overlaps with existing stock or attached values refused
- [x] Series for printing your own (format, next number), taking numbers safely when two people print at once
- [x] Stock view: per range, how many attached, available, void or lost; mark values void or lost
- [x] Tests: overlap rules, counts, concurrent series use

A range or list holds at most 100,000 values. A sequence range and a series keep the check character of
their format when made (migration `tags/002_tag_stock.sql`). A replaced value counts as void in the
range's figures (its tag was taken off); the values view shows it as replaced. A value marked void or
lost cannot be attached until it is marked available again. `takeFromSeries` (used by printing, E37-08)
takes the numbers and registers the printed range in one transaction: a clash with other stock takes
nothing, and a series refuses numbers beyond its digits.

**Implemented in:** `server/src/modules/tags/stock.ts` (`/api/asset-tags/ranges`, `/ranges/:id/values`, `/stock/mark`, `/series`, `takeFromSeries`, `stockStatus`), migration `002_tag_stock.sql`; `web/src/modules/tags/Stock.tsx`, `Series.tsx`, `Settings.tsx` (`/api/asset-tags/settings`); tests `tags/store.test.ts`

### E37-04 Look up a tag and the tag card

**Status:** done · **Priority:** P1 · **Type:** feature

Anyone who finds a tag wants to see at once what it is stuck to and what they can do with it.

**Acceptance criteria**

- [x] `GET /api/asset-tags/lookup?value=` and `POST /api/asset-tags/lookup` (up to 10 candidates, with how each was read) answer per §4.2: current, replaced, in stock, unknown but matching a format, other identifiers, nothing
- [x] Unknown, restricted (without permission), switched-off and ended values answer identically
- [x] The answer carries the tag card: summary, recent activity, and the actions computed on the server (§4.3)
- [x] Tests: every rule, the identical answers, actions per role and per switched-off area, a held record

A value whose record the person may not see (restricted, no view permission, a switched-off area) or
whose tag was ended answers exactly as a value never attached to anything: `nothing` when it matches no
format and is not in stock, `unknown_format` (or `in_stock`) when a fresh value would. Only
administrators get `switchedOff: true`, and a hidden record is never tied to the lookup log. A check
character that does not match a format is a `misread`, refused before the lookup; a code candidate is
first passed through each active format's extraction pattern. Before a value has any tag history, the
record's own tag field is looked at too (records tagged before the module existed).

**Implemented in:** `server/src/modules/tags/lookup.ts` (`lookupValues`, `buildCard`, the routes), `actions.ts` (`cardActions`); tests `tags/lookup.test.ts`

### E37-05 Find by tag on the web, typed or with a handheld scanner

**Status:** done · **Priority:** P1 · **Type:** feature

A service desk agent wants to find equipment from a tag a caller reads out, and a storeroom clerk
wants to use a handheld scanner on barcoded tags.

**Acceptance criteria**

- [x] The global search box and a **Find by tag number** box on the inventory pages accept a tag value; a keyboard-mode scanner's value plus Enter opens it
- [x] The tag card as a web page with its actions; several matches listed
- [x] Keyboard and screen-reader usable; accessibility audit clean; browser suite `21-tags`

The page `/asset-tags/find?value=` (no permission beyond seeing the record) shows the result, each card
with its actions, and a box for the next value; nothing found lists other records whose words match
(a reference typed into the global search, for example). The box tells a handheld scanner from typing
by the time between key presses (`source=handheld`). The global search offers "Find tag number
<text>" first for text that looks like a tag (letters, digits and dashes with at least one digit).
Checked with axe (WCAG 2.1 A and AA) on the card page and its dialogs in both themes at 1440, 820 and
390 px: clean.

**Implemented in:** `web/src/modules/tags/TagCard.tsx`, `FindByTag.tsx`, `ListActions.tsx`, `PaletteProvider.ts`, `lookup.css`; browser suite `tools/e2e/suites/21-tags.mjs`

### E37-06 Actions from a tag: report a problem, quick updates, photos

**Status:** done · **Priority:** P1 · **Type:** feature

A frontline employee wants to report a defect on the thing in front of them in a few taps, and a
technician wants to update its status or location on the spot.

**Acceptance criteria**

- [x] Report a problem: a ticket with the record pre-filled as affected asset, system or site (portal form for requesters, the service desk form for agents), with photos
- [x] Report a hazard or close call: a safety report at the record's site with the record linked
- [x] Quick updates: status, location, assignee or custodian in one step, through the normal update path (validation, `If-Match`, audit)
- [x] Add photo or note; mark one image attachment as the record's photo, shown on the tag card
- [x] Record condition and Start inspection open those forms for the record when their areas are on
- [x] Every action appears only when the server lists it; tests for each action's conditions

New records start from `prefill` (`{ type, path, values, link? }`) and are created through the normal
create route. Agents (`tickets.create`) get the service desk form with the asset or system as the
affected record; a site or vehicle is linked to the new ticket (`link`). Requesters (`portal.create`,
portal on) go to the portal's Report a problem form with what and where filled in. A hazard report
(`safety.create`, or the portal's safety report when the portal takes them) starts at the record's site,
with the vehicle filled in or the asset or system linked. Quick updates PATCH the record with
`If-Match` (the card's `version`); a stale card is refused with `version_conflict`. Add photo uploads to
the record and can mark the picture as the record's photo (`PUT /api/asset-tags/photo`, table
`tag_record_photos`, migration `003_record_photos.sql`, audit `tag.photo`); Add note writes an internal
comment. Record condition (Asset condition on, `assets.create`) and Start inspection (Audits on: the
record's open inspection, or a new one when an inspection checklist applies to the type) open their
forms. Under a legal hold, Edit, Quick update and Replace tag are left out.

**Implemented in:** `server/src/modules/tags/actions.ts`, `lookup.ts`, `migrations/003_record_photos.sql`; `web/src/modules/tags/TagCard.tsx`; tests `tags/lookup.test.ts`, browser suite `21-tags`

### E37-07 Attach, replace and end tags

**Status:** done · **Priority:** P1 · **Type:** feature

An asset manager wants to stick a tag on new equipment and attach it by reading the tag, and to replace
a damaged tag without losing the link.

**Acceptance criteria**

- [x] Attach a value to a record from the record page (typed or read by the app) or from a tag card of a value in stock or unknown (to a found record or a new one)
- [x] Replace records a new value and marks the old one replaced (pointing at the new one); end as void or lost with a reason; all audited
- [x] The record page's Tags panel lists current and earlier values with these actions
- [x] Tests: each transition, a held record, two people attaching the same value at once (one wins)

`POST /api/asset-tags/attach`, `/replace` and `/end` need `tags.manage` and edit permission on the
record; the tag card's Attach action (E37-04) and the app post to the same routes with how the value was
read (`code`, `text`, `typed`, `handheld`). Ending takes a reason and a status: void (damaged), lost, or
removed. With several tags per record allowed (Administration > Asset tags > Settings), the extra tags
are attached beside the one shown in the record's field; ending that one moves the next into the field.

**Implemented in:** `server/src/modules/tags/assignments.ts`; `web/src/modules/tags/InventoryPanel.tsx` (the Tags panel: a section on asset and site pages, a tab on system and vehicle pages); tests `tags/assignments.test.ts`

### E37-08 Print your own tags

**Status:** in progress (built; open only for the real-phone reading check before release) · **Priority:** P2 · **Type:** feature

An organization that prints its own tags wants new values from a series, or reprints of existing ones,
on its label stock.

**Acceptance criteria**

- [x] The value in large type and optionally a code holding the same value (Code 128, QR or Data Matrix; text and code by default), an optional line above and the logo (§3.5); a code never holds an address
- [x] PDF on the server: sheet layouts (presets by dimensions, custom, start at label, alignment test page) and roll layouts at exact label size; a print limit (default 1,000)
- [x] New values from a series are registered as stock; reprints of existing values; bulk action on lists; audit-logged
- [x] Legibility rules (typeface with distinct look-alikes, minimum text height, quiet zones around codes)
- [x] Thermal-printer format (ZPL) for roll layouts, with the same fields and sizes as the PDF
- [x] Tests: label geometry for each preset, PDF sizes, series under concurrent prints
- [ ] A printed sheet of each code read by the app (E38-05) on real phones before release

**Implemented in:** `server/src/modules/tags/print.ts` (routes), `print-layouts.ts` (presets named by
dimensions: five Letter and five A4 sheets, six rolls; custom layouts in `tag_label_layouts`),
`print-label.ts` (what goes where on a label; legibility rules), `print-codes.ts` (Code 128, QR and Data
Matrix through the `bwip-js` package: MIT, pure JavaScript, no network, one library for all three),
`print-pdf.ts` (PDFKit, the engine every server PDF uses) and `print-zpl.ts` (ZPL: codes as `^GB` boxes of
whole printer dots from the same encoding as the PDF, a PNG logo as `^GFA`, field data through `^FH`);
`web/src/modules/tags/Print.tsx` (Administration > Asset tags > Print tags, with a live preview of one
label drawn from the server's plan) and `BulkActions.tsx` ("Print tags" on the asset, system and vehicle
lists); tests `print-label.test.ts`, `print-zpl.test.ts` (snapshots), `print.test.ts`.

Decisions: the value prints in Helvetica Bold (PDF) or the printer's font 0 (ZPL), its capitals at least
the minimum text height (default 5 mm, 3 to 25 allowed) and grown to fill the space; a value that cannot
print legibly on the chosen label is refused with the reason (`400 not_legible`), never shrunk. Minimum
module 0.2 mm (Code 128) and 0.3 mm (2D), Code 128 bars at least 5 mm, quiet zones 10, 4 and 2 modules.
Numbers are checked to fit before any are taken from the series. The alignment test page takes no
numbers and is not logged; every print is (`tag.print`, with the values).

### E37-09 Inventory counts

**Status:** done · **Priority:** P2 · **Type:** feature

An asset manager wants to check that what the register says is at a site is really there.

**Acceptance criteria**

- [x] Start a count for a site (optionally an area and record types); the expected list is fixed at the start
- [x] Tags found mark records found (app camera in counting mode, or typed and handheld scanner on the web); records registered elsewhere are unexpected; several people at once; finding twice is harmless
- [x] Finishing lists missing records; move unexpected records here, mark missing ones missing; a discrepancy summary can raise a ticket or an action
- [x] Found records get a last verified date and place; a report of counts, coverage by site and records not verified for a chosen time
- [x] Counts are records with history, comments and attachments; tests for each outcome and concurrent finds

**Implemented in:** `server/src/modules/tags/counts.ts` (record type `inventory_count`, `POST /api/inventory-counts/start`, `/:id/items`, `/:id/found`, `/:id/finish`, `/:id/cancel`, `/:id/resolve`, `/:id/raise`, `/countable`; status value **Missing** added to the asset and vehicle status lists, action source "Inventory count"), `counts-report.ts` (`GET /api/inventory-counts/report`); `web/src/modules/tags/Counts.tsx` (list with Start a count, the count page with the Tag number box for typing or a handheld scanner, Items tab with decisions, report); tests `tags/counts.test.ts`. The app's camera counting mode posts to the same `found` route (E38-05, E38-12 offline). Notes: an area restricts the count to records with a location (assets); systems have no site and are not counted.

### E37-10 Lookup history, guide page and sample data

**Status:** done · **Priority:** P2 · **Type:** docs

People want to know when equipment was last seen, and how to set up and use tags.

**Acceptance criteria**

- [x] `tag_lookups` when `tags.log_lookups` is on (default on), kept 90 days, no phone location; "Last seen" on the record page for people who may edit it; covered by retention and anonymization
- [x] User guide page "Asset tags": formats, registering bought tags, printing, choosing tags that read well (size, contrast, codes), finding tags on the web and in the app, attaching and replacing, counts, switching the area off
- [x] Administration and API documented (`docs/api.md`); help route map entries
- [x] Sample data: tag values on the sample assets, vehicles and sites, a bought range, one finished and one open count

**Implemented in:** `server/src/modules/tags/history.ts` (`logLookup`, `logSourceOf`, `lastSeen`, `GET /api/asset-tags/last-seen`, daily job `tags.lookup_housekeeping`, anonymization and purge of a record's log rows), `counts-seed.ts` (dev profile samples: a format, the bought range TA-100000 to TA-100999, tag values on vehicles, sites and the equipment at one depot, a finished and an open count, a few lookups); guide page `docs/user/38-asset-tags.md`; `docs/api.md` (Asset tags and inventory counts), `docs/operations.md`, `docs/security.md`; tests `tags/history.test.ts`, `tags/counts-seed.test.ts`. "Last seen" is drawn by the record's Tags panel (E37-07) from `RecordTags.lastSeen`.
