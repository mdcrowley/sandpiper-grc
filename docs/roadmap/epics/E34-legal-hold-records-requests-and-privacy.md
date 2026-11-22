# E34 Legal hold, records requests and privacy

**Status:** done (9 of 9 issues done)

## Goal

Stop records under a legal hold from being anonymized or removed, track records requests and personal-data requests against a configurable deadline, and assess privacy impact on systems that hold personal data. Gap review GP-15 and GP-19.

## Scope notes

- Built in wave 11. The hold is enforced in core (`core/holds.ts`, tables in `core/migrations/025_legal_holds.sql`) on every delete, purge, anonymize and file-removal path, whatever is switched on or off; the module `holds` (permission `legal`) is always on.
- Records requests and privacy assessments are the module `records` (permissions `records` and `privacy`, feature area `records`).
- Deadlines are configurable days (default 20 for every kind, "set your own"); no jurisdiction's law, deadline, exemption or legal ground is built in. Document redaction is not planned (E34-09).
- Guide pages: [Legal holds](../../user/33-legal-holds.md) (always shown) and [Records requests and privacy](../../user/37-records-requests-and-privacy.md) (hidden with the area). The legal-hold part was moved to a page of its own so that it stays readable while the records area is off.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E34-01 | Hold records applied to records or by query | done | P2 |
| E34-02 | Retention respects holds | done | P1 |
| E34-03 | Records and personal-data requests with a due clock | done | P2 |
| E34-04 | Responsive records and exemptions | done | P3 |
| E34-05 | Privacy impact assessments on systems | done | P2 |
| E34-06 | Permission keys, area and Records and privacy officer role | done | P2 |
| E34-07 | Request clocks and reminders | done | P2 |
| E34-08 | Sample data and guide | done | P2 |
| E34-09 | Not planned: document redaction | done | P3 |

---

### E34-01 Hold records applied to records or by query

**Status:** done · **Priority:** P2 · **Type:** feature

Legal counsel wants to place records under a hold for a matter, with custodian and dates.

**Acceptance criteria**

- [x] Hold records applied to chosen records or to every record a query matches
- [x] `legal_hold` records (`LGH-` numbers): matter, description, custodian, counsel, start and expected end; generated `/api/legal-holds`
- [x] Records added by hand (only records the person can see) or by a saved query (record type, search words and `f.` filters in the list API's shape) run as system work, so restricted records are held too; queries run again nightly (`holds.queries`) and only ever add; a record taken off by hand is not put back by a query
- [x] The hold page lists only the records the reader may see; its count includes every held record; a query on a type the reader may not see shows only its count; searching the words of a type that may be restricted needs `security.view`
- [x] `placeHold(ctx, { holdId | matter, records }, req)` (contract C1) for other modules
- [x] Record pages carry `_holds: [{ id, ref }]` for `legal.view` holders (a `preSerialization` hook on the generated `GET {path}/:id`), shown as a "Legal hold" banner
- [x] Release through the "Legal hold release" approval kind (default one-step workflow, `legal.approve`); with no workflow, a holder of `legal.approve` releases it directly (audited)

**Implemented in:** `server/src/core/holds.ts`, `server/src/core/migrations/025_legal_holds.sql`, `server/src/modules/holds/`; `web/src/modules/holds/`

### E34-02 Retention respects holds

**Status:** done · **Priority:** P1 · **Type:** feature

Legal counsel wants retention to skip held records and say why, and anonymizing or removing them refused.

**Acceptance criteria**

- [x] Retention review lists held records with their hold (`held`, `holds` per row; filter `held=only|none`; "Held" chip and filter on the Review tab)
- [x] Anonymize and remove refuse a held record (409 `on_hold`, naming the hold's reference, never its matter)
- [x] The same refusal on the generic delete (and so bulk delete), `purge`, the `anonymize()` function itself, file removal, and merging duplicate vulnerabilities; the purge of removed files skips a held record's files; the sweep leaves held records unflagged and counts them (`held`) — one test per path
- [x] An active hold is itself held (cannot be deleted or anonymized until released); holds never lapse when any area is switched off (tested with the records and risks areas off)
- [x] Anonymizing a record clears the address, title and checker of its evidence links (attachments with `storage_driver = 'link'`, E36-05; `link_url`, `link_title`, `checked_by` set to null) and deletes no stored bytes for them (tested in `core/retention.test.ts`)

**Implemented in:** `server/src/core/holds.ts`, `server/src/core/retention.ts`; `web/src/modules/admin/Retention.tsx`; tests `server/src/modules/holds/holds.test.ts`

### E34-03 Records and personal-data requests with a due clock

**Status:** done · **Priority:** P2 · **Type:** feature

A records officer wants each request tracked against a configurable deadline.

**Acceptance criteria**

- [x] One request type for records and personal-data requests, with a clock (`records_request`, `RRQ-` numbers; kinds from the list `records_request_kind`, `meta.personal` on the personal-data kinds)
- [x] Personal-data kinds are seen only with `privacy.view` as well (row rule, `figures: 'mask'`): hidden from lists, search, links and exports, still counted in figures
- [x] Extension needs a reason and is audited; closing needs a response summary; preservation places the responsive records under a legal hold (needs `legal.edit`)
- [x] `GET /api/records/summary` (contract C5): figures only; active holds only for `legal.view` holders

**Implemented in:** `server/src/modules/records/requests.ts`, `settings.ts`; `web/src/modules/records/Requests.tsx`

### E34-04 Responsive records and exemptions

**Status:** done · **Priority:** P3 · **Type:** feature

A records officer wants the records that answer a request linked to it, with exemptions noted.

**Acceptance criteria**

- [x] Links to responsive records and an exemptions note per record (`records_request_items`: exemption from the operator-defined list `records_exemption`, disclosure full, partial or withheld, note)
- [x] Only records the person can see may be linked; mirrored as record links `responsive_to` (contract C7) so the record's Related tab shows the request
- [x] Anonymizing a request blanks the notes on its responsive records (`onAnonymize`)

**Implemented in:** `server/src/modules/records/requests.ts`; `web/src/modules/records/Requests.tsx`

### E34-05 Privacy impact assessments on systems

**Status:** done · **Priority:** P2 · **Type:** feature

A privacy officer wants an assessment for each system that holds personal data categories.

**Acceptance criteria**

- [x] An assessment template on systems with personal data categories (`privacy_assessment`, `PIA-` numbers: purpose, legal basis as recorded, necessity, retention, sharing, risks, mitigations, residual risk, configurable screening questions `privacy_question`)
- [x] Data categories gain `personal_data` and `personal_data_kinds` (contract C2, `inventory/migrations/006`), hidden while the area is off
- [x] Coverage (`GET /api/privacy/coverage`): systems holding personal data without an approved assessment in date; counts include every system
- [x] Approval kind "Privacy impact assessment" (`privacy.approve`); approving sets the next review date; a change to the system's data categories after approval moves it to "Needs update"; linked from the system as `assessed_by` (contract C7)
- [x] Privacy tab on systems and a Personal data section on data categories (inventory extension panel)

**Implemented in:** `server/src/modules/records/privacy.ts`, `server/src/modules/inventory/fields-privacy.ts`; `web/src/modules/records/Privacy.tsx`, `InventoryPanel.tsx`

### E34-06 Permission keys, area and Records and privacy officer role

**Status:** done · **Priority:** P2 · **Type:** feature

An administrator wants records requests and privacy to be an optional part, and legal holds always on with their own permission. Wave 11 (coordinator step 0 declared the `legal`, `records` and `privacy` keys, the `records` area and the Records and privacy officer role, and wired the legal-hold hook points into core as no-ops.)

**Acceptance criteria**

- [x] Legal holds (`legal`) are always on, enforced in core whatever is switched off
- [x] The `records` area hides requests and privacy assessments while off: routes answer 404 `switched_off`; fields, lists, action sources, the notification kind and the calendar source disappear (tested)
- [x] The Records and privacy officer role

**Implemented in:** `server/src/modules/records/index.ts`, `server/src/modules/holds/index.ts`; `web/src/modules/records/index.tsx`, `web/src/modules/holds/index.tsx`

### E34-07 Request clocks and reminders

**Status:** done · **Priority:** P2 · **Type:** feature

A records officer wants each request's deadline counted from a setting, an amber and a red alert, and privacy reviews reminded.

**Acceptance criteria**

- [x] Due days per request kind from a setting (default 20 for every kind, labeled "set your own"); working days optional (`records.request_due_days`, `records.business_days`, `GET/PUT /api/records/settings`)
- [x] Alerts claimed before sending; calendar source `records.requests_due`; metric `records.requests_overdue`
- [x] Clock from `clockOf` (amber at `records.clock_amber_fraction`, 0.25); job `records.clocks` every 15 minutes claims `alerted_amber_at` and `alerted_red_at` in one statement; an extension starts them again
- [x] Job `records.reminders` (daily) reminds owners of privacy reviews `privacy.review_reminder_days` (30) ahead, claimed with `review_reminded_for`; two overlapping runs send once (tested)

**Implemented in:** `server/src/modules/records/requests.ts`, `privacy.ts`, `index.ts`

### E34-08 Sample data and guide

**Status:** done · **Priority:** P2 · **Type:** documentation

An evaluator wants an invented hold, requests and assessments, and a guide page.

**Acceptance criteria**

- [x] Invented samples, labeled "(sample)": one active hold (two safety events by hand, the sample incident by query), six requests (one overdue, one extended, one closed with exemptions), personal-data flags on the sample data categories, three assessments (approved, in review, due)
- [x] Guide pages `33-legal-holds.md` (always shown) and `37-records-requests-and-privacy.md` (follows the area); the legal-hold part was split from the planned page 33 so that it stays readable while the records area is off

**Implemented in:** `server/src/modules/holds/seed.ts`, `server/src/modules/records/seed.ts`; `docs/user/33-legal-holds.md`, `docs/user/37-records-requests-and-privacy.md`; browser suite `tools/e2e/suites/16-records.mjs`

### E34-09 Not planned: document redaction

**Status:** done · **Priority:** P3 · **Type:** feature

Not planned: redacting the content of documents belongs in a document tool. Exemptions are recorded per responsive record instead.

**Implemented in:** nothing to build; recorded so that nobody builds it here (wave 11 plan, scope guards)
