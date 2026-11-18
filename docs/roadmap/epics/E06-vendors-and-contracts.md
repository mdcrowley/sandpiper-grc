# E06 Vendors and contracts

**Status:** in progress

## Goal

Know who the organisation depends on, what has been agreed with each vendor, which
security terms are in each contract, what evidence they have supplied, and when each
contract must be renewed or ended, with enough warning to act.

## Scope notes

- Covers `server/src/modules/vendors/` and `web/src/modules/vendors/`.
- Record types: `vendor`, `contract`, `evidence_item`.
- Contract clauses, clause statuses, document types, renewal mechanisms and evidence
  types are configurable lists.
- Reminders exist as audit events and calendar state only; delivering them to people
  depends on [E14](E14-platform-services.md).

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
| E06-12 | Deliver renewal and evidence reminders to people | open | P2 |
| E06-13 | Vendor assessment questionnaire | open | P2 |
| E06-14 | Editor for contract value by year | open | P3 |
| E06-15 | Review queue for contracts with missing dates | open | P2 |
| E06-16 | Screen for reminder thresholds | open | P3 |
| E06-17 | Attach contract and evidence documents | open | P2 |

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

Known defect: the page scrolls horizontally at 1440px, see
[E18-01](E18-quality-and-known-defects.md).

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

**Status:** open · **Priority:** P2 · **Type:** feature

As a contract owner, I am told when one of my contracts reaches a reminder threshold or
a piece of evidence is about to expire. Today reminders are audit events only.

**Acceptance criteria**

- [ ] The contract owner receives a notification at each threshold
- [ ] Contracts with no owner notify a fallback role
- [ ] Evidence expiry notifies the same way
- [ ] Depends on [E14-03](E14-platform-services.md)

### E06-13 Vendor assessment questionnaire

**Status:** open · **Priority:** P2 · **Type:** feature

As a security lead, I send a vendor a set of security questions, record their answers,
and score the result.

**Acceptance criteria**

- [ ] Question sets are data, with versions
- [ ] Answers are recorded against a vendor with a date
- [ ] A score and outstanding gaps are shown on the vendor
- [ ] Gaps can be raised as actions
- [ ] A completed assessment can be saved as an evidence item

### E06-14 Editor for contract value by year

**Status:** open · **Priority:** P3 · **Type:** improvement

As a contract owner, I enter the value for each year in a small table. Today the field
is shown and edited as raw JSON.

**Acceptance criteria**

- [ ] A year-and-amount table with add and remove
- [ ] The total is shown and compared with "total value"
- [ ] Amounts use the organisation's currency

### E06-15 Review queue for contracts with missing dates

**Status:** open · **Priority:** P2 · **Type:** improvement

As a contract owner, I see the contracts that have no end date or notice period, so I
can fill them in. Until then their renewal reminders mean nothing.

**Acceptance criteria**

- [ ] A saved filter or report of contracts with no end date or notice period
- [ ] The renewal calendar says how many contracts it cannot place
- [ ] The original "as recorded" text is shown beside the fields to fill in

### E06-16 Screen for reminder thresholds

**Status:** open · **Priority:** P3 · **Type:** improvement

As an administrator, I change the reminder thresholds on a screen. No screen for this
setting was found in the web app.

**Acceptance criteria**

- [ ] The thresholds are shown and editable by people with `contracts.administer`
- [ ] Values are validated (whole days, descending)
- [ ] The change is audited

### E06-17 Attach contract and evidence documents

**Status:** open · **Priority:** P2 · **Type:** feature

As a contract owner, I attach the signed contract and each evidence document to its
record, instead of noting where the file is kept.

**Acceptance criteria**

- [ ] Files can be attached to contracts and evidence items
- [ ] Depends on [E14-01](E14-platform-services.md)
