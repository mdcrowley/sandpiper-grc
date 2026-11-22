# E12 Dashboards and reporting

**Status:** done (16 of 16 issues done)

## Goal

Let each person see the state of what they care about at a glance, and let managers
build, schedule and hand out the reports they need without asking for a developer.

## Scope notes

- Two fixed dashboards exist: the overview (home) and the service desk dashboard.
- The seven canned inventory reports are tracked in
  [E04-11](E04-inventory-and-relationship-map.md).
- The `reports` module (`server/src/modules/reports`, `web/src/modules/reports`) holds the
  report builder, saved reports, user-built dashboards, report packs, exports and scheduled
  delivery. The permission keys `reports` and `dashboards` are enforced on every route.
- The rules: figures (counts, totals, charts) are the same for everyone who may see them,
  restricted records included, with their words and people masked as "Restricted records";
  lists of records and drill-downs show each person only what their permissions allow
  (`visibleWhere`), never the author's. Sharing shares a design, never records.
- Scheduled delivery is an in-app notification linking to a stored snapshot, and optionally an
  email with a link or the file (E12-10). Due schedules run as the recurring `reports.deliver`
  job on the job queue (every 5 minutes); each email is a `mail.send` job.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E12-01 | Overview dashboard | done | P1 |
| E12-02 | Service desk dashboard | done | P1 |
| E12-03 | User-built dashboards | done | P3 |
| E12-04 | Report builder | done | P2 |
| E12-05 | Scheduled delivery of reports | done | P3 |
| E12-06 | Report packs | done | P2 |
| E12-07 | Dashboards for read-only roles | done | P3 |
| E12-08 | Print and PDF for dashboards | done | P3 |
| E12-09 | PDF and spreadsheet (XLSX) exports | done | P2 |
| E12-10 | Email delivery of scheduled reports | done | P3 |
| E12-11 | Overview page shows the chosen home dashboard | done | P2 |
| E12-12 | Default roles and scheduled delivery | done | P2 |
| E12-13 | Report builder polish | done | P3 |
| E12-14 | Non-Latin text in server-made PDFs | done | P3 |
| E12-15 | Group by a multi-choice field | done | P3 |
| E12-16 | Right-to-left and mixed-script text in server-made PDFs | done | P3 |

---

### E12-01 Overview dashboard

**Status:** done · **Priority:** P1 · **Type:** feature

As anyone signing in, the home page shows the headline position across the modules I
can see: open tickets, framework progress, actions, incident notification clocks, top
risks, contract renewals and the project portfolio.

**Acceptance criteria**

- [x] Each tile only appears if the user has permission for its module
- [x] Tiles link through to the list or page behind them
- [x] Loading, empty and error states per tile
- [x] Reads existing summary endpoints; adds none of its own

**Implemented in:** `web/src/modules/home/index.tsx` (reads `/api/tickets/stats`, `/api/tickets/metrics`, `/api/frameworks/...`, `/api/actions/summary`, `/api/security-incidents/clocks`, `/api/risks/summary`, `/api/contracts/renewals`, `/api/projects/portfolio`)

### E12-02 Service desk dashboard

**Status:** done · **Priority:** P1 · **Type:** feature

As a service desk lead, I pick a date range and see volumes, how many tickets met their
targets, response and resolution times, backlog by age and satisfaction, and click any
figure to see the tickets behind it.

**Acceptance criteria**

- [x] Metrics for a date range, or for everything when no range is given
- [x] Share of tickets with no missed target
- [x] Backlog in age bands
- [x] Satisfaction average and count
- [x] Every figure drills down to a ticket list with matching filters
- [x] A bad date is refused with a clear message

**Implemented in:** `GET /api/tickets/metrics` (`server/src/modules/tickets/metrics.ts`); `web/src/modules/tickets/Dashboard.tsx`

### E12-03 User-built dashboards

**Status:** done · **Priority:** P3 · **Type:** feature

As a user, I build my own dashboard from widgets based on any record type or saved report,
and share it with my team.

**Acceptance criteria**

- [x] A dashboard is a named set of widgets on a twelve-column grid, stored on the server (`dashboard` record type)
- [x] Widget kinds: saved report, number with trend, gauge, progress to target, chart (bar, ranked bar, stacked, line, area, pie, doughnut, heat map), table, record list, countdown, calendar, safely rendered text
- [x] Add, move and resize with pointer drag on CSS grid (no package), with keyboard alternatives (arrow keys move, Shift + arrows resize) and a live announcement
- [x] Global filters: date range, department, site, system, owner; kept in the address and carried into every drill-down
- [x] Every segment drills down to the generic list at its route with the filters in the address
- [x] Auto-refresh, wall mode, undo/redo while editing
- [x] Each widget respects the viewer's permissions, not the author's; a widget whose module is absent or whose records the viewer cannot see says so in place
- [x] Private, chosen roles or everyone; a saved report on a dashboard runs only for people it is shared with
- [x] Per-user home dashboard (`GET/POST /api/dashboards/home`)
- [x] Seven standard dashboards seeded idempotently: IT leadership overview, service desk, cybersecurity program, assets and systems, vendors and contracts, project portfolio, board summary
- [x] Checked by `dashboards.*` permissions

**Implemented in:** `server/src/modules/reports/` (`resources.ts`, `widgets.ts`, `sharing.ts`, `standard.ts`, `seed.ts`, `index.ts`); `web/src/modules/reports/` (`DashboardPages.tsx`, `DashboardGrid.tsx`, `layout.ts`, `FilterBar.tsx`, `Widget.tsx`, `WidgetEditor.tsx`, `visuals.tsx`). Tests: `sharing.test.ts`, `delivery.test.ts`.

### E12-04 Report builder

**Status:** done · **Priority:** P2 · **Type:** feature

As a manager, I choose a record type, the columns, filters, grouping and totals, save
the result as a named report, and run it whenever I need it.

**Acceptance criteria**

- [x] Any registered record type the caller may view can be reported on, in plain words with a description
- [x] Columns (add, remove, reorder), AND/OR filter groups, sort, one or two groupings, date buckets (day, week, month, quarter, year in the organization time zone), count, sum, average, minimum, maximum and share of total, pivot
- [x] One-hop related fields through `ref` and `user` fields; custom fields (`cf_<key>`, single-value types)
- [x] Everything validated against declared fields; values travel only as parameters; row, group and time limits
- [x] Live preview, undo/redo, chart choice with reasons when a chart does not fit
- [x] Reports are saved, named and shareable
- [x] Output on screen, CSV and a print-ready document (spreadsheet: see E12-09)
- [x] Restricted records stay hidden from people who may not see them, in rows, counts, groups, totals and joined records
- [x] Checked by `reports.*` permissions; every export is audited and watermarked when restricted

**Implemented in:** `server/src/modules/reports/` (`spec.ts`, `query.ts`, `catalog.ts`, `custom.ts`, `documents.ts`, `render.ts`); `POST /api/reports/run`, `GET /api/reports/:id/run`, `POST /api/reports/export`, `GET /api/reports/:id/export`; `web/src/modules/reports/` (`Builder.tsx`, `BuilderParts.tsx`, `SpecEditor.tsx`, `FilterEditor.tsx`, `ResultView.tsx`, `charts.ts`, `ReportPages.tsx`). Nineteen standard reports, including on-vehicle equipment past support and critical systems without recovery targets. Tests: `query.test.ts`.

### E12-05 Scheduled delivery of reports

**Status:** done · **Priority:** P3 · **Type:** feature

As a manager, I schedule a report or dashboard to be sent to named people every day, week
or month.

**Acceptance criteria**

- [x] A schedule has a report or dashboard, a frequency, an hour in the organization time zone, a format and recipients (people and roles)
- [x] Each recipient receives only what their own permissions allow (restricted rows filtered by the recipient's permissions, never the creator's); people who may not view the item or its records, or are not shared it, are skipped with the reason logged
- [x] Each delivery is logged and stored as a snapshot linked from an in-app notification
- [x] Reading a snapshot in the application is viewing: it needs view permission and continued sight of the source and every saved report in it. Downloading it (CSV, or HTML with `?download=1`) is an export: it needs `reports.export` / `dashboards.export` and is audited. A CSV schedule sends the document to recipients who may not export
- [x] Email delivery: see E12-10

**Implemented in:** `server/src/modules/reports/schedule.ts`, `snapshots.ts`; `web/src/modules/reports/DeliveryPages.tsx`, `dialogs.tsx`. Tests: `delivery.test.ts` (with a chosen clock).

### E12-06 Report packs

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I produce a pack for a governing body or an auditor: a fixed set of
reports and charts as one dated document.

**Acceptance criteria**

- [x] A pack is an ordered list of saved reports and text sections behind a cover page
- [x] Producing a pack freezes the figures as at that date
- [x] Output as one print-ready document (the browser saves it as a PDF; a server-made PDF is E12-09)
- [x] Past packs are kept and can be opened again
- [x] A starter pack ships: summary, framework progress, top risks, overdue actions, incidents

**Implemented in:** `server/src/modules/reports/` (`resources.ts`, `documents.ts`, `index.ts`); `web/src/modules/reports/PackPages.tsx`.

### E12-07 Dashboards for read-only roles

**Status:** done · **Priority:** P3 · **Type:** improvement

As an executive viewer or auditor, I sign in and see a home page that suits a
read-only role, rather than an overview with most tiles missing.

**Acceptance criteria**

- [x] The home page chooses a layout from the user's permissions: someone who may not create, change, delete, approve or administer anything (`readOnly` from `GET /api/dashboards/home`) sees the figures first ("At a glance"), then "Where to look" (every area they may open, from the navigation, without pages that start a new record), then their own lists ("For you"); without `dashboards.view`, "Where to look" leads
- [x] The board summary dashboard is a one-page view in plain language for an executive viewer, and is suggested (`suggested` from `GET /api/dashboards/home`) on the Overview of anyone who only looks until they choose a home dashboard; sentences read correctly for a figure of 1 (`{one|many}`)
- [x] The `dashboards.view` permission is enforced
- [x] The Overview page uses the chosen home dashboard (E12-11): it is shown in the Dashboard section, with a switch back to the Overview's own figures (remembered in the browser) and "Open in full"

**Implemented in:** `server/src/modules/reports/index.ts` (`readOnly`, `/api/dashboards/home`); `web/src/modules/home/` (`OverviewPage.tsx`, `layoutChoice.ts`, `home.css`); `web/src/modules/reports/EmbeddedDashboard.tsx`, `Widget.tsx`, `standard.ts`. Tests: `sharing.test.ts`, `web/src/modules/home/layoutChoice.test.ts`.

### E12-08 Print and PDF for dashboards

**Status:** done · **Priority:** P3 · **Type:** improvement

As a manager, I can print a dashboard, or save it as a PDF, and get a tidy page.

**Acceptance criteria**

- [x] Print styles for user-built dashboards and packs; a print-ready dashboard document (`GET /api/dashboards/:id/export`)
- [x] The "as at" time appears on the page
- [x] Print styles for the fixed overview (two columns, the "as at" time, a Print button); the service desk dashboard prints with the shared print rules and its charts print with patterns (a few rules for its period picker and grids go in `tickets.css`, owned by the service desk module)
- [x] Charts print legibly in black and white: on `beforeprint` every chart is drawn again on white (light colors whatever the theme) with ECharts decal patterns, as a sharp picture at its own size, and put back after printing

**Implemented in:** `web/src/core/ChartImpl.tsx`, `web/src/modules/home/home.css`, `OverviewPage.tsx`.

### E12-09 PDF and spreadsheet (XLSX) exports

**Status:** done · **Priority:** P2 · **Type:** feature

As a manager, I download a report, dashboard or pack as a PDF or an Excel workbook made by the
server, and schedule them in those formats.

**Acceptance criteria**

- [x] XLSX written with `fflate` alone: shared strings, bold frozen header, auto-filter, column widths, typed numbers, currency, percentages and dates (organization time zone)
- [x] PDF with `pdfkit` standard fonts: title, the report's filters in words, generated time, a table that continues over pages with its header repeated, a vector chart (bar, line or pie) drawn from the figures, page numbers
- [x] Dashboards: a group of widgets with a chart or table starts a new page; packs: cover page, one section per page, page numbers
- [x] Restricted content watermarked on every page (PDF) and under the table (XLSX); exports audited with the format; export permission on every record type as for CSV
- [x] Scheduled delivery in PDF or Excel stores the file as the snapshot (recipients who may not export get the document); with an `app.sendMail` decorator the file is attached to a link email and the attachment is audited; without it delivery stays in the application
- [x] Non-Latin text in PDFs (built in E12-14: `server/src/core/export/fonts.ts`; right-to-left text is E12-16)

**Implemented in:** `server/src/core/export/pdf.ts`, `xlsx.ts`, `zone.ts`; `server/src/modules/reports/files.ts` (renderers, filter descriptions), `documents.ts`, `index.ts` (`?format=pdf|xlsx` on `/api/reports/:id/export`, `POST /api/reports/export`, `/api/dashboards/:id/export`, `/api/report-packs/:id/export`), `schedule.ts` (email channel), `snapshots.ts` (binary snapshots); `web/src/modules/reports/` (`ReportPages.tsx`, `Builder.tsx`, `DashboardPages.tsx`, `PackPages.tsx`, `DeliveryPages.tsx`, `dialogs.tsx`). Tests: `files.test.ts`, `server/src/core/export/export.test.ts`.

### E12-14 Non-Latin text in server-made PDFs

**Status:** done · **Priority:** P3 · **Type:** improvement

PDFs used PDFKit's standard Helvetica (Windows-1252 only); other characters printed as "?".
Decided: no font file or package is added to the repository. Windows-1252 text keeps Helvetica
(nothing embedded); any other piece of text takes the first font that has all its characters,
from `GRC_PDF_FONTS` (file list; `none` switches it off) or from well-known system fonts (Noto,
DejaVu, Arial Unicode, Segoe UI, Arial, Microsoft YaHei, Yu Gothic, Malgun Gothic, Nirmala UI),
embedded as a subset through fontkit (PDFKit's own dependency). The code is written and tested but
lives in `server/src/core/export/` (shared): in progress until it is merged there.

- [x] Greek, Cyrillic, Chinese, Japanese, Korean and Indic text prints as written when the machine has a font for it; bold faces found beside the regular ones
- [x] Western European text unchanged (no font embedded, tests that read the text unchanged)
- [x] A character no font has prints as "?"
- [x] Merged into `server/src/core/export/pdf.ts` and `fonts.ts` (with `fonts.test.ts`); the container image installs `fonts-noto-core` and `fonts-noto-cjk` (or `fonts-dejavu-core`)
- Right-to-left order and text mixing scripts that no single font covers: E12-16

**Implemented in:** `server/src/core/export/pdf.ts`, `fonts.ts`, `fonts.test.ts`; `Dockerfile` installs `fonts-noto-core` and `fonts-noto-cjk`; `GRC_PDF_FONTS` in `docs/operations.md`.

### E12-15 Group by a multi-choice field

**Status:** done · **Priority:** P3 · **Type:** feature

A multi-choice custom field can be a column and a filter (E12-13) but not a group: one record
holding several values would be counted in each, so totals would no longer add up. Group by each
value (`jsonb_array_elements_text`), with the table and chart saying that a record can be counted
more than once and the pivot's totals counting distinct records.

- [x] A multi-choice field is offered as a group (`group: true` in the catalog); the compiler joins
  `jsonb_array_elements_text` laterally (`groupFrom`), so each record counts once under each of its
  values and a record with none under "None"; drill-down opens the records holding that value
- [x] The count of records (`total`) stays one per record; a count measure counts distinct records;
  "Share of total" becomes "Share of records" (of all matching records, so shares can pass 100%);
  a share of a field's total is refused with a clear message
- [x] A pivot's row, column and grand totals count distinct records (other measures leave them blank)
- [x] `countingNote` explains it in words, built from the field labels and the record count only (the
  same for every viewer), under the table and chart, in dashboard widgets (one line), and in the PDF,
  Excel and print-ready exports
- [x] Figures stay the same for everyone (tested with a second role)

**Implemented in:** `server/src/modules/reports/spec.ts` (lateral join, `groupFrom`, distinct counts and
shares), `query.ts` (`countingNote`, distinct pivot totals), `catalog.ts`, `custom.ts`, `files.ts`,
`render.ts`; `web/src/modules/reports/ResultView.tsx`, `Widget.tsx`, `types.ts`, `reports.css`.
Tests: `query.test.ts` ("shows a multi-choice field as a column, filters by it and groups by it").

### E12-16 Right-to-left and mixed-script text in server-made PDFs

**Status:** done · **Priority:** P3 · **Type:** improvement

PDFKit shapes Arabic and Hebrew but does not reorder right-to-left runs, so they print left to
right; and the builder chooses one font per piece of text, so text mixing scripts that no single
font covers prints the missing characters as "?". Split text into runs by script and direction
(a bidi pass) and print each run in a font that has it.

Decided: the essentials of the Unicode Bidirectional Algorithm are written in the repository
(about 250 lines, with a compact table of bidirectional classes) rather than adding a package: no
suitable package is already installed, the brief adds none, and the parts needed are small. Not
applied: explicit embeddings and isolates (U+202A to U+202E, U+2066 to U+2069), which are ignored.

- [x] Bidi essentials (P2, P3, W1 to W7, N1, N2, I1, I2, and per line L1, L2, L4 mirrored brackets);
  the left-to-right, right-to-left and Arabic letter marks count and are not printed
- [x] Text with right-to-left characters, or mixing scripts that no single font covers, is laid out
  by the builder: a font per character (the one before it when it can), lines broken at spaces and
  between ideographs, each line reordered, and each run printed whole (so fontkit shapes Arabic and
  keeps a right-to-left run in order); a right-to-left paragraph aligns to the right
- [x] Text one font prints whole, left to right, still goes straight to PDFKit (Western European
  output unchanged); only a character no available font has prints as "?"
- [x] Tests with Hebrew, Arabic and mixed samples (`fonts.test.ts`), and a PDF with every part
  (title, table, charts, facts, figures, note, list) in those scripts

**Implemented in:** `server/src/core/export/fonts.ts` (`bidiClass`, `bidiLevels`, `visualOrder`,
`toVisual`, `FontFace.reverses`), `server/src/core/export/pdf.ts` (`needsRuns`, `facesFor`,
`layoutText`, `PdfBuilder.write` / `heightOf` / `widthOf`); `docs/operations.md`. Tests:
`server/src/core/export/fonts.test.ts`.

### E12-10 Email delivery of scheduled reports

**Status:** done · **Priority:** P3 · **Type:** feature

- [x] Uses the outbound mail service (`app.sendMail`, by user id, the "General message" template, purpose `reports`); nothing is sent while email is off, and the dialog says so (`GET /api/reports/email-status`)
- [x] Each schedule says how email is used (`email`: `link` by default, `attach` or `off`; migration `002_schedule_email.sql`); the message names the schedule and links to the stored copy, never carrying the figures in its text
- [x] A file is attached only when the schedule asks, the format is a file (PDF, Excel, CSV), the recipient may export, and the copy holds no restricted records; otherwise a link goes, and the delivery log says why; attachments are audited (`report_snapshot.export`)
- [x] Due schedules run as the recurring `reports.deliver` job (replacing the in-process timer); each email is a `mail.send` job with retries

**Implemented in:** `server/src/modules/reports/` (`schedule.ts`, `index.ts`, `resources.ts`, `migrations/002_schedule_email.sql`); `web/src/modules/reports/dialogs.tsx`, `DeliveryPages.tsx`. Tests: `files.test.ts` ("scheduled email").

### E12-11 Overview page shows the chosen home dashboard

**Status:** done · **Priority:** P2 · **Type:** improvement

The `home` module should read `GET /api/dashboards/home` and, when a dashboard is chosen,
offer it (or show it) on the Overview page.

**Done:** the Overview offers a "Your dashboard" link when GET /api/dashboards/home returns one.

### E12-12 Default roles and scheduled delivery

**Status:** done · **Priority:** P2 · **Type:** improvement

Decided: an in-app delivered copy stays inside the application, so it is treated as viewing.
Default roles with view permission (agent, project manager, executive viewer) receive and read
deliveries; only downloading a copy needs export permission. No change to the default roles.

- [x] Delivery and reading need view, not export
- [x] Download needs export and is audited (`report_snapshot.export`)
- [x] Tests in `delivery.test.ts`

### E12-13 Report builder polish

**Status:** done · **Priority:** P3 · **Type:** improvement

- [x] Series and pivot columns follow each grouping's natural order (`values` on each dimension column: a list's configured order, dates in time order, words alphabetically, "None" and "Restricted records" last), and with no sort chosen the second grouping follows it inside the first
- [x] Multi-choice custom fields: shown as a column (labels joined), filtered with "has any of", "has none of", "has no value", "has a value"; refused as a group with a clear message (grouping added since by E12-15)
- [x] Dashboard drag-and-drop works while editing down to 480px of content width (tablets); below that a note points to the keyboard moves
- [x] A plain-language sentence describing the report above the preview; one-click Quick starts (count by status, each month, by owner, status by a second choice); Ctrl+S to save; a warning before leaving with unsaved changes; columns reordered by dragging
- [x] Wording says figures are the same for everyone (lists show what each role allows)

**Implemented in:** `server/src/modules/reports/` (`query.ts`, `spec.ts`, `custom.ts`, `catalog.ts`); `web/src/modules/reports/` (`Builder.tsx`, `describe.ts`, `starters.ts`, `ops.ts`, `FilterEditor.tsx`, `SpecEditor.tsx`, `charts.ts`, `DashboardGrid.tsx`). Tests: `query.test.ts`, `describe.test.ts`.
