# E37 Asset tags: values, printing and lookup

**Status:** open (0 of 10 issues done)

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
| E37-01 | Tag values on records, taggable types and history | open | P1 |
| E37-02 | Tag formats | open | P1 |
| E37-03 | Tag stock: bought ranges and lists, printed series | open | P1 |
| E37-04 | Look up a tag and the tag card | open | P1 |
| E37-05 | Find by tag on the web, typed or with a handheld scanner | open | P1 |
| E37-06 | Actions from a tag: report a problem, quick updates, photos | open | P1 |
| E37-07 | Attach, replace and end tags | open | P1 |
| E37-08 | Print your own tags | open | P2 |
| E37-09 | Inventory counts | open | P2 |
| E37-10 | Lookup history, guide page and sample data | open | P2 |

---

### E37-01 Tag values on records, taggable types and history

**Status:** open · **Priority:** P1 · **Type:** feature

An asset manager wants each asset, vehicle, site and system to carry the value of the tag stuck on it,
unique across everything, with a history when tags are replaced.

**Acceptance criteria**

- [ ] `defineTaggable(app, …)` registry in `core/tags.ts`; assets, vehicles, sites and systems registered by their modules, each naming its other identifier fields for lookup; a type in a switched-off area is not taggable
- [ ] The asset's existing Tag field is its tag value; vehicles, sites and systems gain a **Tag number** field; values unique across all taggable types (compared by `value_key`, §3.2), checked under concurrent writes
- [ ] `tag_assignments` history; one active tag per record unless the setting allows several
- [ ] Permissions `tags.view`, `tags.manage`, `tags.count`, given to the default roles as in §7; area **Asset tags** in `core/features.ts`
- [ ] Retention ends a record's tags when it is anonymized or removed; a held record's tags cannot be ended or moved
- [ ] Tests: uniqueness across types, comparison rules (text versus code values), registry, retention and holds, features-hidden, permission-use

### E37-02 Tag formats

**Status:** open · **Priority:** P1 · **Type:** feature

An administrator wants to tell the application what the organization's tags look like, so that
printed text read by the camera can be trusted and misreads are refused.

**Acceptance criteria**

- [ ] Formats with characters (digits, letters and digits, or a pattern), prefix, length, check character (none, mod 10, mod 11, mod 36), carrier (any, text, code, both), an optional extraction pattern for codes holding more than the value, and record types (§3.3)
- [ ] Administration > Asset tags > Formats, with a "try a value" box that says whether and how it matches
- [ ] Formats reach the app through `GET /api/mobile/settings` and the offline package
- [ ] Without any format, code values are accepted as they are and text needs the person's confirmation
- [ ] Tests for each check scheme, extraction patterns and pattern safety (patterns are limited in length and checked so they cannot hang the server)

### E37-03 Tag stock: bought ranges and lists, printed series

**Status:** open · **Priority:** P1 · **Type:** feature

An asset manager who receives a box of pre-printed tags wants to register them, so the application
knows they are ours and not yet attached.

**Acceptance criteria**

- [ ] Register a sequential range ("010000 to 010999") or import a list of values from a file for tags that are not sequential; overlaps with existing stock or attached values refused
- [ ] Series for printing your own (format, next number), taking numbers safely when two people print at once
- [ ] Stock view: per range, how many attached, available, void or lost; mark values void or lost
- [ ] Tests: overlap rules, counts, concurrent series use

### E37-04 Look up a tag and the tag card

**Status:** open · **Priority:** P1 · **Type:** feature

Anyone who finds a tag wants to see at once what it is stuck to and what they can do with it.

**Acceptance criteria**

- [ ] `GET /api/tags/lookup?value=` and `?values=` (up to 10 candidates, with how each was read) answer per §4.2: current, replaced, in stock, unknown but matching a format, other identifiers, nothing
- [ ] Unknown, restricted (without permission), switched-off and ended values answer identically
- [ ] The answer carries the tag card: summary, recent activity, and the actions computed on the server (§4.3)
- [ ] Tests: every rule, the identical answers, actions per role and per switched-off area, a held record

### E37-05 Find by tag on the web, typed or with a handheld scanner

**Status:** open · **Priority:** P1 · **Type:** feature

A service desk agent wants to find equipment from a tag a caller reads out, and a storeroom clerk
wants to use a handheld scanner on barcoded tags.

**Acceptance criteria**

- [ ] The global search box and a **Find by tag number** box on the inventory pages accept a tag value; a keyboard-mode scanner's value plus Enter opens it
- [ ] The tag card as a web page with its actions; several matches listed
- [ ] Keyboard and screen-reader usable; accessibility audit clean; browser suite `21-tags`

### E37-06 Actions from a tag: report a problem, quick updates, photos

**Status:** open · **Priority:** P1 · **Type:** feature

A frontline employee wants to report a defect on the thing in front of them in a few taps, and a
technician wants to update its status or location on the spot.

**Acceptance criteria**

- [ ] Report a problem: a ticket with the record pre-filled as affected asset, system or site (portal form for requesters, the service desk form for agents), with photos
- [ ] Report a hazard or close call: a safety report at the record's site with the record linked
- [ ] Quick updates: status, location, assignee or custodian in one step, through the normal update path (validation, `If-Match`, audit)
- [ ] Add photo or note; mark one image attachment as the record's photo, shown on the tag card
- [ ] Record condition and Start inspection open those forms for the record when their areas are on
- [ ] Every action appears only when the server lists it; tests for each action's conditions

### E37-07 Attach, replace and end tags

**Status:** open · **Priority:** P1 · **Type:** feature

An asset manager wants to stick a tag on new equipment and attach it by reading the tag, and to replace
a damaged tag without losing the link.

**Acceptance criteria**

- [ ] Attach a value to a record from the record page (typed or read by the app) or from a tag card of a value in stock or unknown (to a found record or a new one)
- [ ] Replace records a new value and marks the old one replaced (pointing at the new one); end as void or lost with a reason; all audited
- [ ] The record page's Tags panel lists current and earlier values with these actions
- [ ] Tests: each transition, a held record, two people attaching the same value at once (one wins)

### E37-08 Print your own tags

**Status:** open · **Priority:** P2 · **Type:** feature

An organization that prints its own tags wants new values from a series, or reprints of existing ones,
on its label stock.

**Acceptance criteria**

- [ ] The value in large type and optionally a code holding the same value (Code 128, QR or Data Matrix; text and code by default), an optional line above and the logo (§3.5); a code never holds an address
- [ ] PDF on the server: sheet layouts (presets by dimensions, custom, start at label, alignment test page) and roll layouts at exact label size; a print limit (default 1,000)
- [ ] New values from a series are registered as stock; reprints of existing values; bulk action on lists; audit-logged
- [ ] Legibility rules (typeface with distinct look-alikes, minimum text height, quiet zones around codes)
- [ ] Optional thermal-printer format (ZPL) for roll layouts (decision 5)
- [ ] Tests: label geometry for each preset, PDF sizes, series under concurrent prints; a printed sheet read by the app on real phones before release

### E37-09 Inventory counts

**Status:** open · **Priority:** P2 · **Type:** feature

An asset manager wants to check that what the register says is at a site is really there.

**Acceptance criteria**

- [ ] Start a count for a site (optionally an area and record types); the expected list is fixed at the start
- [ ] Tags found mark records found (app camera in counting mode, or typed and handheld scanner on the web); records registered elsewhere are unexpected; several people at once; finding twice is harmless
- [ ] Finishing lists missing records; move unexpected records here, mark missing ones missing; a discrepancy summary can raise a ticket or an action
- [ ] Found records get a last verified date and place; a report of counts, coverage by site and records not verified for a chosen time
- [ ] Counts are records with history, comments and attachments; tests for each outcome and concurrent finds

### E37-10 Lookup history, guide page and sample data

**Status:** open · **Priority:** P2 · **Type:** docs

People want to know when equipment was last seen, and how to set up and use tags.

**Acceptance criteria**

- [ ] `tag_lookups` when `tags.log_lookups` is on (default on), kept 90 days, no phone location; "Last seen" on the record page for people who may edit it; covered by retention and anonymization
- [ ] User guide page "Asset tags": formats, registering bought tags, printing, choosing tags that read well (size, contrast, codes), finding tags on the web and in the app, attaching and replacing, counts, switching the area off
- [ ] Administration and API documented (`docs/api.md`); help route map entries
- [ ] Sample data: tag values on the sample assets, vehicles and sites, a bought range, one finished and one open count
