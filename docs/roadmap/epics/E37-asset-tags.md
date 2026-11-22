# E37 Asset tags: printing and scanning

**Status:** open (0 of 12 issues done)

## Goal

Print durable tags with a QR code for assets, vehicles, sites and systems, and scan them with any
phone camera, a handheld scanner or the mobile apps to see the record and act on it: report a
problem, edit it, record its condition, run its inspection, attach a photo, or count it in an
inventory check. The design is in [the asset tags and mobile apps specification](../specs/asset-tags-and-mobile-apps.md)
(§3, §4, §6, §7); section numbers below refer to it.

## Scope notes

- New module `tags` and feature area **Asset tags and scanning** (on by default). Switched off, tags,
  the scanner, counts and their actions appear nowhere except Administration > Features.
- Works in the web application on any phone with no app; the mobile apps (E38) use the same endpoints.
- Not planned: GPS, RFID or Bluetooth tracking; maintenance work orders (E32-06).
- Real-machine check before the first release: a printed sheet on an office printer and a label
  printer (E37-12).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E37-01 | Tag codes, the tag registry and taggable types | open | P1 |
| E37-02 | Label templates and layouts | open | P1 |
| E37-03 | Print tags as a PDF from records, lists and blank batches | open | P1 |
| E37-04 | Resolve a scan and the scan card | open | P1 |
| E37-05 | Web scanner page with camera and handheld scanners | open | P1 |
| E37-06 | Actions from a scan: report a problem, quick updates, photos | open | P1 |
| E37-07 | Tag life cycle: attach blank tags, replace, void, lost | open | P2 |
| E37-08 | Inventory counts | open | P2 |
| E37-09 | Scan history and last verified | open | P3 |
| E37-10 | Guide page, sample data and administration | open | P1 |
| E37-11 | Anonymous problem reports from a tag (decision 3) | open | P3 |
| E37-12 | Thermal-printer format and a real printer check | open | P3 |

---

### E37-01 Tag codes, the tag registry and taggable types

**Status:** open · **Priority:** P1 · **Type:** feature

An asset manager wants every asset, vehicle, site and system to be able to carry a tag whose code
is unique, short, not guessable and checkable when typed.

**Acceptance criteria**

- [ ] Codes are 8 Crockford base-32 characters plus a check character, shown grouped (`7KQ2-M9XF-R`); typing ignores case, spaces and dashes; a wrong check character is refused before any lookup (§3.2)
- [ ] Tables `tags` and `tag_batches` (§3.3); a code is never reused; one active tag per record unless the setting allows several
- [ ] `defineTaggable(app, …)` registry in `core/tags.ts`; assets, vehicles, sites and systems registered by their modules, each naming its identifier fields for lookup; a type in a switched-off area is not taggable
- [ ] Permissions `tags.view`, `tags.manage`, `tags.count`, given to the default roles as in §7; area **Asset tags and scanning** in `core/features.ts`
- [ ] Retention: anonymizing or removing a record voids its tags; a held record's tags cannot be voided or reassigned
- [ ] Tests: code generation and checks, uniqueness under concurrent creation, registry, retention and holds, features-hidden, permission-use

### E37-02 Label templates and layouts

**Status:** open · **Priority:** P1 · **Type:** feature

An asset manager wants to choose what a label shows and which label stock it prints on.

**Acceptance criteria**

- [ ] Templates: ordered fields (logo, organization name, record name, record number, code text, QR code, linear Code 128 barcode, instruction line, help phone number), QR size and font scale; a default template supplied
- [ ] Layouts: sheet (page size, label size, rows, columns, margins, gaps) and roll (label size); presets for common Letter and A4 sheet sizes and label-printer sizes, named by their dimensions only; custom layouts
- [ ] Fields that do not fit are dropped in template order and the preview says which; text never below a legible minimum
- [ ] Administration > Asset tags: Templates and Layouts tabs with a real-size preview
- [ ] Tests: layout geometry (label positions in points for each preset), field dropping

### E37-03 Print tags as a PDF from records, lists and blank batches

**Status:** open · **Priority:** P1 · **Type:** feature

An asset manager wants to print tags for one record, a filtered list, or a batch of blank tags,
from any printer.

**Acceptance criteria**

- [ ] "Print tag" on taggable record pages, "Print tags" bulk action on their lists (selection or whole filtered list), "Print blank tags" in administration
- [ ] `POST /api/tags/print` makes a PDF on the server (existing PDF engine) at the layout's exact size; QR codes at error correction M with a four-module quiet zone; "Start at label" for partial sheets; an alignment test page
- [ ] A record without a tag gets one when printed; printing is audit-logged with the number of tags; a limit on tags per print (default 1,000)
- [ ] Only records the person may see can be printed; restricted records need their area's permission as for viewing
- [ ] Tests: PDF page sizes and label count, start position, permission, audit entry; browser test printing a list selection

### E37-04 Resolve a scan and the scan card

**Status:** open · **Priority:** P1 · **Type:** feature

Anyone who scans a tag wants to see at once what it is stuck to and what they can do with it.

**Acceptance criteria**

- [ ] `GET /api/tags/resolve?value=` accepts a tag address, a code, or an identifier (asset tag and serial, fleet number and vehicle identification number, site code) and answers one record, a short list, or "Nothing found" (§4.2)
- [ ] Unknown, restricted (without permission), switched-off and voided-without-replacement answer identically; a replaced tag finds the record with a "remove this old tag" notice
- [ ] The answer carries the summary, recent activity and the list of allowed actions, computed on the server (§4.3)
- [ ] `/t/:code` page: phone-width first, sign-in and return when signed out, nothing shown before sign-in
- [ ] Tests: every match rule, the identical answers, actions per role and per switched-off area, a held record; browser test at 390 px

### E37-05 Web scanner page with camera and handheld scanners

**Status:** open · **Priority:** P1 · **Type:** feature

A technician without the app wants to scan tags with the phone's browser, and a storeroom clerk
wants to use a handheld scanner.

**Acceptance criteria**

- [ ] `/scan` uses the camera: `BarcodeDetector` where available, otherwise a ZXing WebAssembly decoder loaded only on this page; torch toggle where supported; the camera permission explained before the browser asks
- [ ] A scan box that a keyboard-mode handheld scanner fills (code plus Enter opens it); typed codes and identifiers work the same; the global search box accepts a scanned address or code
- [ ] Continuous mode for counting (E37-08) with a sound and vibration on each read where allowed
- [ ] Works from 360 px wide; keyboard and screen-reader usable; accessibility audit clean
- [ ] Tests: component tests with a fake camera stream and a fake handheld scanner; browser suite `21-tags`

### E37-06 Actions from a scan: report a problem, quick updates, photos

**Status:** open · **Priority:** P1 · **Type:** feature

A frontline employee wants to report a defect on the thing in front of them in a few taps, and a
technician wants to update its status or location on the spot.

**Acceptance criteria**

- [ ] Report a problem: a ticket with the record pre-filled as affected asset, system or site (portal form for requesters, the service desk form for agents), photos from the camera
- [ ] Report a hazard or close call: a safety report at the record's site with the record linked
- [ ] Quick updates: status, location, assignee or custodian in one step, through the normal update path (validation, `If-Match`, audit)
- [ ] Add photo or note; mark one image attachment as the record's photo, shown on the scan card
- [ ] Record condition and Start inspection open those forms for the record when their areas are on
- [ ] Every action appears only when the server lists it; tests for each action's conditions

### E37-07 Tag life cycle: attach blank tags, replace, void, lost

**Status:** open · **Priority:** P2 · **Type:** feature

An asset manager wants to stick pre-printed tags on new equipment and attach them by scanning, and
to replace a damaged tag without losing the link.

**Acceptance criteria**

- [ ] Scanning a blank tag offers "Attach this tag" to a found record or to a new one (create form pre-filled with nothing but the tag)
- [ ] Replace prints a new tag and marks the old one replaced (pointing at the new one); void and lost with a reason; all audited
- [ ] The record page's Tags panel lists active and earlier tags with these actions
- [ ] Tests: each transition, a held record, two people attaching the same blank tag at once (one wins)

### E37-08 Inventory counts

**Status:** open · **Priority:** P2 · **Type:** feature

An asset manager wants to check that what the register says is at a site is really there.

**Acceptance criteria**

- [ ] Start a count for a site (optionally an area and record types); the expected list is fixed at the start
- [ ] Scans mark records found; records registered elsewhere are unexpected; several people can count at once; scanning twice is harmless
- [ ] Finishing lists missing records; the counter may move unexpected records here and mark missing ones missing; a discrepancy summary can raise a ticket or an action
- [ ] Found records get a last verified date and place; a report of counts, coverage by site and records not verified for a chosen time
- [ ] Counts are records with history, comments and attachments; tests for each outcome and for concurrent scans

### E37-09 Scan history and last verified

**Status:** open · **Priority:** P3 · **Type:** feature

A manager wants to know when equipment was last seen and by whom.

**Acceptance criteria**

- [ ] `tag_scans` when `tags.log_scans` is on (default on), kept `retention.tag_scans_days` (90); no device location ever
- [ ] "Last scanned" on the record page for people who may edit the record; restricted records' scans not logged for people who may not see them
- [ ] Anonymization and retention cover the scan log; tests

### E37-10 Guide page, sample data and administration

**Status:** open · **Priority:** P1 · **Type:** docs

An administrator and the people who use tags want to know how to set up, print, stick and scan.

**Acceptance criteria**

- [ ] User guide page "Asset tags and scanning": setting up templates and layouts, printing (alignment test, partial sheets), label materials and minimum sizes, scanning with a phone or handheld scanner, actions, blank tags, counts, switching the area off
- [ ] Administration page documented in the Administration guide; the API in `docs/api.md`; help route map entries
- [ ] Sample data: tags on the sample assets, vehicles and sites, one finished and one open count

### E37-11 Anonymous problem reports from a tag (decision 3)

**Status:** open · **Priority:** P3 · **Type:** feature

An administrator wants people without an account (contractors, temporary staff) to report a
problem with tagged equipment in places the administrator chooses.

**Acceptance criteria**

- [ ] Off by default; allowed per template; the anonymous scan card shows only the public name and a short form (§4.8)
- [ ] Tickets from source "Tag report"; limits per address and per tag; photo size limit; no outside service
- [ ] Tests for the limits and that nothing else about the record is revealed

### E37-12 Thermal-printer format and a real printer check

**Status:** open · **Priority:** P3 · **Type:** feature

An asset manager with a label printer that cannot print PDFs at the right size wants a format it
accepts, and everyone wants to know the printed output really scans.

**Acceptance criteria**

- [ ] Optional ZPL output for roll layouts, with the same fields and sizes as the PDF
- [ ] A sheet printed on a real office printer and a roll on a real label printer, scanned by an iPhone, an Android phone and a handheld scanner; results recorded here
