# E43 Document control: policies, standards, procedures, SOPs and plans

**Status:** in progress (15 of 19 issues done; the rest are later phases)

## Goal

An organization keeps its governed documents in one controlled library, following the usual
document-control practice (as in ISO 9001 7.5 and ISO 27001 7.5): policies and plans at the top,
then standards and programs, procedures and SOPs, work instructions, guidelines and forms; each with
an owner, a controlled number, approved versions with their real dates, a review cycle, and a
controlled distribution. A department's own SOPs (IT's, for example) can be limited to that department,
so nobody else sees even their titles, while every figure stays the same for everyone. Word originals
are converted to Markdown with the original kept; PDFs are kept as they are and their text is searched.
An assistant can load a whole document package, with its version history and original dates, over MCP.

The service desk knowledge base stays separate: knowledge articles are quick answers for requesters
and agents; controlled documents are approved, versioned, reviewed and distributed. An article may
link to a document.

The record type stays `policy` (table `policies`, routes `/api/policies`, permissions `policies.*`), so
attachments, links, comments, audit, coverage and saved reports keep working; the screens say
**Document**. The feature switch is **Documents and exceptions**.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E43-01 | Document types and the hierarchy | done | P1 |
| E43-02 | Controlled document numbers | done | P2 |
| E43-03 | Controlled distribution and distribution groups | done | P1 |
| E43-04 | Versions, dates and obsolete documents | done | P1 |
| E43-05 | Periodic reviews | done | P2 |
| E43-06 | Word conversion | done | P1 |
| E43-07 | PDF files, uploads in parts and search | done | P1 |
| E43-08 | Controlled-copy printing | done | P2 |
| E43-09 | Links and the relationships view | done | P2 |
| E43-10 | MCP document tools and the loading prompt | done | P1 |
| E43-11 | Importing a document package | done | P2 |
| E43-12 | The Documents menu and library | done | P1 |
| E43-13 | Old addresses and the guide | done | P2 |
| E43-14 | A register of issued paper copies | open | P3 |
| E43-15 | Reading scanned PDFs (OCR) | open | P3 |
| E43-16 | A diagonal status mark on printed text versions | open | P3 |
| E43-17 | Originals of released versions are kept, and Word originals are for editors | done | P1 |
| E43-18 | The Data loads page lists loaded versions | open | P3 |
| E43-19 | The storage check knows uploads in parts | done | P3 |

### E43-01 Document types and the hierarchy

**Status:** done · **Priority:** P1 · **Implemented in:** `server/src/modules/policies/types.ts`, `index.ts`, migration `007_document_control.sql`.

Fourteen types (policy, plan, charter, standard, program, procedure, SOP, work instruction, guideline,
form or template, rulebook section, bulletin, external, reference), each with a tier, a number prefix, a
review cycle and whether readers acknowledge by default; administrators edit them under
**Administration > Lists** (list **Document type**). Each document has one parent; loops are refused, a
type above its parent's tier is warned, and children someone may not read are counted, not named.

### E43-02 Controlled document numbers

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/policies/numbering.ts`, `web/src/modules/policies/documents/Settings.tsx`.

A number such as `SOP-IT-014` beside the reference, from a pattern (`{prefix}-{dept}-{seq:3}`) and
department codes; sequences per type and department never hand a number out twice; only document
controllers type one by hand; a data load keeps the numbers it is given.

### E43-03 Controlled distribution and distribution groups

**Status:** done · **Priority:** P1 · **Implemented in:** `server/src/modules/policies/access.ts`, `groups.ts`, core `ResourceDef.rowRule`; `web/src/modules/policies/documents/AccessEditor.tsx`, `Groups.tsx`.

A document is for everyone or only for named readers: departments (with those below them), roles,
distribution groups and people; the owner, authors and document controllers always read it. The rule is
part of the visibility rule everywhere (lists, record pages, search, pickers, links, comments, files,
exports, reports, dashboards and MCP). Figures count restricted documents for everyone and mask their
words. People asked to acknowledge must be readers; narrowing the readers closes their open requests.

### E43-04 Versions, dates and obsolete documents

**Status:** done · **Priority:** P1 · **Implemented in:** `server/src/modules/policies/versions.ts`, `lifecycle.ts`, migration `008_versions_and_reviews.sql`; `web/src/modules/policies/VersionsPanel.tsx`, `PolicyActions.tsx`.

Version labels (Rev. C), the adoption record (approving body and reference), file-only versions, minor
versions that ask no one again, a future effective date that the daily run publishes on the day,
superseded and withdrawn dates, and **Make obsolete** with a reason, the replacing document and the
list of documents under it. A data load sets every date and status, in any order.

### E43-05 Periodic reviews

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/policies/reviews.ts`, `metrics.ts`; `web/src/modules/policies/documents/Reviews.tsx`.

A review ends as No change (the next date moves by the cycle), Revise (a draft opens) or Make obsolete.
Owners are reminded 60 and 30 days before, on the day, then weekly. A Reviews due list and four figures
(reviews overdue, due in 90 days, acknowledgment completion, documents without an owner).

### E43-06 Word conversion

**Status:** done · **Priority:** P1 · **Implemented in:** `server/src/modules/policies/convert/` (mammoth, BSD-2-Clause; turndown and turndown-plugin-gfm, MIT), `markdown.ts`; `web/src/modules/policies/documents/VersionUpload.tsx`.

A `.docx` becomes Markdown in a separate, limited process; pictures become files on the document and
show in the text through the preview route (only for its readers); the original is kept on the version.
A report lists what was left out; tracked changes are refused unless converted as they are. A preview
saves nothing.

### E43-07 PDF files, uploads in parts and search

**Status:** done · **Priority:** P1 · **Implemented in:** `server/src/modules/attachments/uploads.ts` (migration `007_chunked_uploads.sql`), `server/src/modules/policies/convert/index.ts`, `search.ts`.

A PDF or a legacy `.doc` is a file-only version; a PDF's text goes into the document's search text, and
a scanned PDF is flagged as having none. Large files arrive in parts of 1 MB, each checked, joined and
then taken through the usual intake; an upload belongs to the person who sent it and expires in 24 hours.

### E43-08 Controlled-copy printing

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/policies/print.ts`, `convert/stamp.ts` (pdf-lib, MIT).

**Print** gives a PDF with the number, version, status line (EFFECTIVE, DRAFT, SUPERSEDED, OBSOLETE),
dates, "Restricted distribution", who printed it and "Uncontrolled when printed". A version kept as a
PDF prints as that PDF with the control block and page numbers stamped on every page, and a DRAFT,
SUPERSEDED or OBSOLETE mark. Prints and downloads of originals are audited.

### E43-09 Links and the relationships view

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/policies/documents.ts`; `web/src/modules/policies/documents/parts.tsx`.

Links from a document to other documents and to other records (controls, obligations, systems and the
rest of the core links) carry a relation from an editable list (list **Document link relations**) and
are grouped on the document page's relationships view; links to records someone may not read are
counted, not named.

### E43-10 MCP document tools and the loading prompt

**Status:** done · **Priority:** P1 · **Implemented in:** `server/src/modules/mcp/tools-documents.ts`, `prompts.ts`.

Thirteen tools (find, read, register figures, check, conversion preview, uploads in parts, save a
document, add a version, set access, link, record a review) and the prompt `load_document_package`.
They obey the distribution, the write switch and data load mode (versions with their own numbers,
statuses and dates; `as` names the real author, E18-71).

### E43-11 Importing a document package

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/policies/import/`; `web/src/modules/policies/documents/Import.tsx`.

**Documents > Import**: a `.zip` with a `manifest.csv` (one row per version); a dry run converts and
checks without saving; each row goes through the documents' own routes as the person importing, so
access rules and data load mode apply. Office lock files and thumbnail caches are skipped.

### E43-12 The Documents menu and library

**Status:** done · **Priority:** P1 · **Implemented in:** `web/src/modules/policies/documents/Library.tsx`, `DocumentReader.tsx`, `Register.tsx`, `DocumentsTabs.tsx`.

The **Documents** menu group has the **Document library** for every signed-in person: browse by tier,
type and department, full-text search with the matched words marked, a lock on restricted documents, and
a reading page with the dates in force. The register, approvals, reviews due, external documents, groups,
import, kiosk and settings are tabs only for the roles that use them.

### E43-13 Old addresses and the guide

**Status:** done · **Priority:** P2 · **Implemented in:** `web/src/modules/policies/index.tsx`, `docs/user/11-policies-and-exceptions.md`.

`/policies` opens the register and `/policies/kiosk` the kiosk; My acknowledgments is a tab of My work
(its address is kept). The guide page is rewritten as **Documents and exceptions**.

### E43-14 A register of issued paper copies

**Status:** open · **Priority:** P3

Record who holds a numbered controlled paper copy and recall it when a new version takes effect.

### E43-15 Reading scanned PDFs (OCR)

**Status:** open · **Priority:** P3

Read the text of image-only PDFs with a free OCR engine (for example tesseract.js) in the sandbox, so
scanned older documents are found by their words, not only their title and number.

### E43-16 A diagonal status mark on printed text versions

**Status:** open · **Priority:** P3

The core PDF builder's diagonal mark says only RESTRICTED; a `mark` option would let a printed Markdown
version carry SUPERSEDED, OBSOLETE or DRAFT diagonally as stamped PDF originals do. Today the status line
under the title says it.

### E43-17 Originals of released versions are kept, and Word originals are for editors

**Status:** done · **Priority:** P1 · **Implemented in:** `server/src/core/attachment-guards.ts`, `server/src/modules/attachments/index.ts`, `server/src/modules/policies/print.ts`.

A file that is the original of an approved, effective, superseded or withdrawn version cannot be
removed (409 `in_use`). A version's original is downloaded only by people who write or approve
documents, except the PDF of a version that has been in force; readers still see pictures and previews.
Modules add such rules through `addAttachmentGuard`.

### E43-18 The Data loads page lists loaded versions

**Status:** open · **Priority:** P3

`data_load_records` lists the document, not its versions: undoing removes the document (and so hides its
versions). Listing versions would let one wrong version be undone alone.

### E43-19 The storage check knows uploads in parts

**Status:** done · **Priority:** P3 · **Implemented in:** `server/src/modules/attachments/housekeeping.ts`.

Parts of unfinished uploads, and finished uploads not yet used, are not reported as stray files.
