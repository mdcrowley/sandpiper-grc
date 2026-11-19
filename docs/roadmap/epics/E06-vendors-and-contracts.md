# E06 Vendors and contracts

**Status:** in progress (21 of 23 issues done)

## Goal

Know who the organization depends on, what has been agreed with each vendor, which
security terms are in each contract, what evidence they have supplied, and when each
contract must be renewed or ended, with enough warning to act.

## Scope notes

- Covers `server/src/modules/vendors/` and `web/src/modules/vendors/`.
- Record types: `vendor`, `contract`, `evidence_item`.
- Contract clauses, clause statuses, document types, renewal mechanisms and evidence
  types are configurable lists.
- Reminders are audit events, calendar state and in-application notifications (through the
  notifications module of [E14](E14-platform-services.md) when it is loaded).
- Files on contracts and evidence items use the attachments module of E14.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E06-01 | Vendor register | done | P1 |
| E06-02 | Vendor contacts | done | P2 |
| E06-03 | Contracts with a computed notice date | done | P1 |
| E06-04 | Security-terms checklist per contract | done | P1 |
| E06-05 | Security-terms matrix | done | P2 |
| E06-06 | Evidence register | done | P2 |
| E06-07 | Expiring evidence view | done | P2 |
| E06-08 | Renewal calendar | done | P1 |
| E06-09 | Renewal reminders at set thresholds | done | P2 |
| E06-10 | Vendor summary | done | P2 |
| E06-11 | Contract register import from a seed file | done | P2 |
| E06-12 | Deliver renewal and evidence reminders to people | done | P2 |
| E06-13 | Vendor assessment questionnaire | done | P2 |
| E06-14 | Editor for contract value by year | done | P3 |
| E06-15 | Review queue for contracts with missing dates | done | P2 |
| E06-16 | Screen for reminder thresholds | done | P3 |
| E06-17 | Attach contract and evidence documents | done | P2 |
| E06-18 | Vendor page as a profile; contract page led by the notice date | done | P2 |
| E06-19 | Security-terms matrix as a heat grid; fast checklist editing | done | P2 |
| E06-20 | One expiry date for an evidence item and its file | done | P3 |
| E06-21 | Vendors answer the assessment themselves | done | P3 |
| E06-22 | Vendors attach files through the response link | open | P3 |
| E06-23 | Send the response link by email from the application | open | P3 |

---

### E06-01 Vendor register

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, I keep a register of vendors with what they supply, how critical
they are, how they connect remotely and who to call in an incident.

**Acceptance criteria**

- [x] Vendors are numbered automatically and names are unique
- [x] Services, criticality, status, remote access method
- [x] Incident contact name, email and phone
- [x] Agents can read vendors but not change them

**Implemented in:** `vendor` resource (`server/src/modules/vendors/index.ts`); `web/src/modules/vendors/VendorPages.tsx`

### E06-02 Vendor contacts

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I keep several named contacts for each vendor.

**Acceptance criteria**

- [x] Add, edit and remove contacts on the vendor page
- [x] Every change is audited against the vendor

**Implemented in:** `/api/vendors/:id/contacts` (`server/src/modules/vendors/index.ts`); `web/src/modules/vendors/Contacts.tsx`

### E06-03 Contracts with a computed notice date

**Status:** done · **Priority:** P1 · **Type:** feature

As a contract owner, I record each contract's dates, renewal mechanism, notice period
and value, and the application works out the last day on which notice can be given.

**Acceptance criteria**

- [x] Contracts are numbered and belong to one vendor
- [x] Start and end dates, term, renewal mechanism, notice period in days
- [x] Notice date = end date minus notice period, recomputed on every change
- [x] A supplied notice date is ignored
- [x] Total value, approval or resolution number, owner
- [x] "As recorded" text fields keep the original wording beside the structured fields

**Implemented in:** `contract` resource (`server/src/modules/vendors/index.ts`), `dates.ts`; `web/src/modules/vendors/ContractPages.tsx`

### E06-04 Security-terms checklist per contract

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, I mark each expected security clause on a contract as present,
partial or absent, with a note.

**Acceptance criteria**

- [x] The clause list is a configurable list
- [x] Every clause is listed for every contract, assessed or not
- [x] Each change is audited on the contract
- [x] Free text can be classified into a status when importing

**Implemented in:** `server/src/modules/vendors/clauses.ts`; `GET /api/contracts/:id/clauses` and its update route (`index.ts`); `web/src/modules/vendors/Checklist.tsx`

### E06-05 Security-terms matrix

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I see all vendors against all clauses in one grid, showing the
worst status across each vendor's contracts.

**Acceptance criteria**

- [x] One row per vendor, one column per clause
- [x] The worst status wins (absent, then partial, then present)
- [x] Unassessed cells are shown as such

**Implemented in:** `GET /api/vendors/terms-matrix` (`server/src/modules/vendors/index.ts`); `web/src/modules/vendors/TermsMatrix.tsx`

The horizontal-scroll defect ([E18-01](E18-quality-and-known-defects.md)) is fixed by the
redesign in E06-19: the grid never makes the page wider than the window.

### E06-06 Evidence register

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I record each piece of evidence a vendor supplies (an assurance
report, an insurance certificate, a questionnaire) with when it was received and when
it expires.

**Acceptance criteria**

- [x] Evidence belongs to a vendor and optionally to one of that vendor's contracts
- [x] Type is a configurable list
- [x] Expiry cannot be before the date received

**Implemented in:** `evidence_item` resource (`server/src/modules/vendors/index.ts`); `web/src/modules/vendors/EvidencePages.tsx`

### E06-07 Expiring evidence view

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I see the evidence that has expired or will expire within a chosen
window so I can ask for a replacement.

**Acceptance criteria**

- [x] A list of evidence expiring inside the window, including already expired
- [x] Days left for each item

**Implemented in:** `GET /api/vendors/evidence-expiring` (`server/src/modules/vendors/index.ts`); `EvidenceExpiring` in `web/src/modules/vendors/EvidencePages.tsx`

### E06-08 Renewal calendar

**Status:** done · **Priority:** P1 · **Type:** feature

As a contract owner, I see contracts in the order their notice dates fall due, with how
long is left and which reminders have fired.

**Acceptance criteria**

- [x] Contracts in notice-date order
- [x] Reminder state for each contract
- [x] Ended contracts are left out

**Implemented in:** `GET /api/contracts/renewals` (`server/src/modules/vendors/index.ts`); `web/src/modules/vendors/RenewalCalendar.tsx`

### E06-09 Renewal reminders at set thresholds

**Status:** done · **Priority:** P2 · **Type:** feature

As a contract owner, a reminder is recorded when a contract's notice date is a set
number of days away (for example 120, 90, 60 and 30).

**Acceptance criteria**

- [x] Thresholds are a setting
- [x] Each threshold fires exactly once per contract
- [x] Reminders re-arm when the notice date moves
- [x] Ended contracts are skipped
- [x] Each reminder is an audit event and shows on the renewal calendar

**Implemented in:** `server/src/modules/vendors/reminders.ts`; the reminder timer in `index.ts`

### E06-10 Vendor summary

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, a vendor's page gives me the headline facts: its contracts, the
next notice date, its worst security terms and its evidence.

**Acceptance criteria**

- [x] Counts and next dates for contracts and evidence
- [x] Worst clause statuses across the vendor's contracts

**Implemented in:** `GET /api/vendors/:id/summary` (`server/src/modules/vendors/index.ts`); `web/src/modules/vendors/VendorPages.tsx`

### E06-11 Contract register import from a seed file

**Status:** done · **Priority:** P2 · **Type:** feature

As the person setting up an installation, I load my existing contract register from a
delimited file and get vendors, contracts, clause checks and follow-up actions.

**Acceptance criteria**

- [x] Reads an optional file from the private seed folder
- [x] Creates vendors and contracts and links them to systems by name
- [x] Dates, notice days and totals are filled only where the text is unambiguous
- [x] Safe to run again; edits made in the application are kept
- [x] A later, longer file adds new rows and refreshes changed text

**Implemented in:** `server/src/modules/vendors/seed.ts`

### E06-12 Deliver renewal and evidence reminders to people

**Status:** done · **Priority:** P2 · **Type:** feature

As a contract owner, I am told when one of my contracts reaches a reminder threshold or
a piece of evidence is about to expire.

**Acceptance criteria**

- [x] The contract owner receives a notification at each threshold
- [x] Contracts with no owner still reach someone: everyone with `contracts.edit` is told as well
- [x] Evidence expiry notifies the same way (people with `vendors.edit` and the owner of the
  evidence's contract), at its own thresholds (60, 30 and 7 days as installed); evidence that ran
  out long before it was first seen is not announced
- [x] Depends on [E14-03](E14-platform-services.md); without the notifications module reminders
  are still audit events

**Implemented in:** `runContractReminders` and `runEvidenceReminders` in
`server/src/modules/vendors/reminders.ts`; `evidence_reminders` table in
`migrations/002_assessments_and_evidence_reminders.sql`; tests in `features.test.ts`

### E06-13 Vendor assessment questionnaire

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I work through a set of weighted security questions for a vendor,
record the answers, and score the result. The questionnaire is completed internally.

**Acceptance criteria**

- [x] Question sets are data, with versions; each save makes a new version and completed
  assessments keep theirs
- [x] Answers are recorded against a vendor with a date; one draft at a time, saved as answered
- [x] A score (weighted, 0 to 100) and outstanding gaps are shown on the vendor, with the history
- [x] Gaps can be raised as actions (source `assessment`, linked to the vendor)
- [x] A completed assessment can be saved as an evidence item
- [x] Completed assessments cannot be changed or removed

**Implemented in:** `server/src/modules/vendors/assessments.ts`, migration `002`;
`web/src/modules/vendors/Assessment.tsx` (vendor **Assessment** tab) and `Questions.tsx`
(`/vendors/questions`)

### E06-14 Editor for contract value by year

**Status:** done · **Priority:** P3 · **Type:** improvement

As a contract owner, I enter the value for each year in a small table instead of raw JSON.

**Acceptance criteria**

- [x] A year-and-amount table with add and remove
- [x] The total is shown and compared with "total value", with an option to set the total from it
- [x] Amounts use the organization's currency (`currency()`, `formatCurrency`)
- [x] The server accepts only four-digit years with numeric amounts

**Implemented in:** `web/src/modules/vendors/ValueByYear.tsx`; validation in
`checkContractNumbers` (`server/src/modules/vendors/index.ts`)

### E06-15 Review queue for contracts with missing dates

**Status:** done · **Priority:** P2 · **Type:** improvement

As a contract owner, I work through the contracts that have no end date or notice period,
so their renewal reminders mean something.

**Acceptance criteria**

- [x] A guided queue of open contracts with no end date (unless they run until ended) or no
  notice period, one at a time, with a preview of the resulting notice date
- [x] The renewal calendar says how many contracts it cannot place and links to the queue;
  the contract list shows a **Complete the dates** button with the count
- [x] The original "as recorded" text is shown beside the fields to fill in

**Implemented in:** `GET /api/contracts/missing-dates` (`server/src/modules/vendors/index.ts`);
`web/src/modules/vendors/MissingDates.tsx` (`/contracts/dates`)

### E06-16 Screen for reminder thresholds

**Status:** done · **Priority:** P3 · **Type:** improvement

As an administrator, I change the contract and evidence reminder days on a screen.

**Acceptance criteria**

- [x] The thresholds are shown and editable by people with `contracts.administer`
  (**Reminder days** on the renewal calendar)
- [x] Values are validated (whole days from 1 to 3650, no repeats, at most twelve) and kept
  in descending order
- [x] The change is audited

**Implemented in:** `/api/contracts/reminder-settings` and `parseThresholds`
(`reminders.ts`); `ReminderSettings` in `web/src/modules/vendors/RenewalCalendar.tsx`

### E06-17 Attach contract and evidence documents

**Status:** done · **Priority:** P2 · **Type:** feature

As a contract owner, I attach the signed contract and each evidence document to its record.

**Acceptance criteria**

- [x] Files can be attached to contracts (the record's **Attachments** tab) and evidence items
  (a **Files** tab recording them as dated evidence)
- [x] Adding an evidence item goes straight on to attaching its document
- [x] Depends on [E14-01](E14-platform-services.md)

**Implemented in:** `FilesPanel` in `web/src/modules/vendors/shared.tsx`, `EvidenceForm.tsx`,
`EvidencePages.tsx`; test in `features.test.ts`

### E06-18 Vendor page as a profile; contract page led by the notice date

**Status:** done · **Priority:** P2 · **Type:** improvement

As a security lead, a vendor's page tells me at a glance who to call in an incident, the
next notice date, security-terms coverage, evidence freshness and the assessment score. A
contract's page leads with its notice date, a countdown and what happens if we do nothing.

**Acceptance criteria**

- [x] Vendor profile panels: incident contacts, contracts and next notice date, security-terms
  coverage meter, evidence freshness, assessment
- [x] Vendor list shows a coverage meter and the next notice date
- [x] Contract page: notice date, days left, countdown, term bar, "If we do nothing" sentence,
  reminder badges; value by year beside the details
- [x] Renewal calendar as a twelve-month strip and an agenda by window
- [x] Actions panel on vendor and contract pages when the action tracker is loaded

**Implemented in:** `GET /api/vendors/:id/summary`, `GET /api/vendors/overview`,
`GET /api/contracts/:id/reminders` (`index.ts`); `VendorPages.tsx`, `ContractPages.tsx`,
`RenewalCalendar.tsx`, `shared.tsx`, `vendors.css`

### E06-19 Security-terms matrix as a heat grid; fast checklist editing

**Status:** done · **Priority:** P2 · **Type:** improvement

**Acceptance criteria**

- [x] Heat grid with sticky vendor column and header, legend, clause text on hover and focus,
  search, criticality and gaps filters, a coverage column and a coverage row
- [x] Never wider than the page (fixes [E18-01](E18-quality-and-known-defects.md))
- [x] Checklist statuses are toggles that save at once; wording saves on leaving the box
- [x] **Mark the rest absent** sets every unassessed clause in one step, each change audited

**Implemented in:** `TermsMatrix.tsx`, `Checklist.tsx`; `POST /api/contracts/:id/clauses/bulk`

### E06-20 One expiry date for an evidence item and its file

**Status:** done · **Priority:** P3 · **Type:** improvement

An evidence item has its own **Expires on** date, and a file attached as evidence has
another. They can disagree, and only the item's date drives the evidence reminders.

**Acceptance criteria**

- [x] When a file is attached as evidence, offer to copy its expiry to the item (or the reverse): the notice appears as soon as the file is listed, with one button for each
- [x] The evidence page warns when the two dates differ (including an item with no date and a file with one)

**Implemented in** `server/src/modules/vendors/evidenceExpiry.ts` (`GET /api/evidence/:id/expiry`, `POST /api/evidence/:id/expiry/align`
with `use: file | item`; the item's date changes through the record type, so its reminders are planned again), `links.test.ts`;
`web/src/modules/vendors/EvidenceExpiry.tsx`, `EvidencePages.tsx`, `shared.tsx` (`FilesPanel` passes `onChange`)

### E06-21 Vendors answer the assessment themselves

**Status:** done · **Priority:** P3 · **Type:** feature

Today staff record the answers. A vendor could answer through a one-time link without an
account, with staff reviewing before the assessment is completed.

**Acceptance criteria**

- [x] A time-limited link per assessment, usable without signing in: off by default (setting
      `vendors.response_links_enabled`, on the Assessment questions page), 1 to 90 days (default
      `vendors.response_link_days`, 14), one open link per draft (a new one replaces it), revocable, closed
      when the assessment is completed; only a hash of the secret is stored and it is shown once; the public
      routes answer the same "not valid" for unknown, expired, revoked and switched-off links and are rate
      limited per address (60 a minute, and 20 wrong links in 15 minutes); the vendor sees the questions and
      guidance only (no weights, score or staff answers), can save and come back, and sends with a name
- [x] Staff review and can change answers before completing: the vendor's answers wait on the link; staff take
      over one or all of them into the draft (audited), then change any answer and complete as before; the person
      who created the link is notified when the answers are sent
- [ ] Vendors attach files through the link (split out as E06-22)
- [ ] The application emails the link (split out as E06-23)

**Implemented in** `server/src/modules/vendors/responseLinks.ts` (`GET/PUT /api/vendors/response-links/settings`,
`GET/POST /api/vendor-assessments/:aid/links`, `DELETE …/links/:lid`, `POST …/links/:lid/accept`, public
`GET/PUT /api/vendor-response/:token`), `migrations/003_vendor_response_links.sql`, `links.test.ts`;
`web/src/modules/vendors/ResponseLink.tsx`, `VendorResponse.tsx` (public route `/vendor-response/:token`), `Assessment.tsx`, `Questions.tsx`

### E06-22 Vendors attach files through the response link

**Status:** open · **Priority:** P3 · **Type:** feature

Split out of E06-21. A vendor answering through the link often has a certificate or an assurance
report to back an answer. Today they must send it separately and staff attach it.

**Acceptance criteria**

- [ ] The response page accepts files (same checks and malware scan as other uploads, a small limit per link)
- [ ] Files wait with the answers until staff take them over as evidence of the vendor

### E06-23 Send the response link by email from the application

**Status:** open · **Priority:** P3 · **Type:** feature

Split out of E06-21. Staff copy the link and send it themselves.

**Acceptance criteria**

- [ ] When email is set up, staff can send the link to a vendor contact from the assessment, with a reminder before it expires
