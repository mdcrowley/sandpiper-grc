# E12 Dashboards and reporting

**Status:** in progress

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
- The one rule: figures are always worked out with the permissions of the person looking,
  through the same restricted-record rule as the generic list (`visibleWhere`), never the
  author's. Sharing shares a design, never records.
- Scheduled delivery is an in-app notification linking to a stored snapshot; email waits on
  [E14-04](E14-platform-services.md). The job queue is an in-process timer (every 5 minutes).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E12-01 | Overview dashboard | done | P1 |
| E12-02 | Service desk dashboard | done | P1 |
| E12-03 | User-built dashboards | done | P3 |
| E12-04 | Report builder | done | P2 |
| E12-05 | Scheduled delivery of reports | done | P3 |
| E12-06 | Report packs | done | P2 |
| E12-07 | Dashboards for read-only roles | in progress | P3 |
| E12-08 | Print and PDF for dashboards | in progress | P3 |
| E12-09 | PDF and spreadsheet (XLSX) exports | open | P2 |
| E12-10 | Email delivery of scheduled reports | open | P3 |
| E12-11 | Overview page shows the chosen home dashboard | done | P2 |
| E12-12 | Default roles and scheduled delivery | done | P2 |
| E12-13 | Report builder polish | open | P3 |

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
- [x] Seven standard dashboards seeded idempotently: IT leadership overview, service desk, cybersecurity programme, assets and systems, vendors and contracts, project portfolio, board summary
- [x] Checked by `dashboards.*` permissions

**Implemented in:** `server/src/modules/reports/` (`resources.ts`, `widgets.ts`, `sharing.ts`, `standard.ts`, `seed.ts`, `index.ts`); `web/src/modules/reports/` (`DashboardPages.tsx`, `DashboardGrid.tsx`, `layout.ts`, `FilterBar.tsx`, `Widget.tsx`, `WidgetEditor.tsx`, `visuals.tsx`). Tests: `sharing.test.ts`, `delivery.test.ts`.

### E12-04 Report builder

**Status:** done · **Priority:** P2 · **Type:** feature

As a manager, I choose a record type, the columns, filters, grouping and totals, save
the result as a named report, and run it whenever I need it.

**Acceptance criteria**

- [x] Any registered record type the caller may view can be reported on, in plain words with a description
- [x] Columns (add, remove, reorder), AND/OR filter groups, sort, one or two groupings, date buckets (day, week, month, quarter, year in the organisation time zone), count, sum, average, minimum, maximum and share of total, pivot
- [x] One-hop related fields through `ref` and `user` fields; custom fields (`cf_<key>`, single-value types)
- [x] Everything validated against declared fields; values travel only as parameters; row, group and time limits
- [x] Live preview, undo/redo, chart choice with reasons when a chart does not fit
- [x] Reports are saved, named and shareable
- [x] Output on screen, CSV and a print-ready document (spreadsheet: see E12-09)
- [x] Restricted records stay hidden from people who may not see them, in rows, counts, groups, totals and joined records
- [x] Checked by `reports.*` permissions; every export is audited and watermarked when restricted

**Implemented in:** `server/src/modules/reports/` (`spec.ts`, `query.ts`, `catalogue.ts`, `custom.ts`, `documents.ts`, `render.ts`); `POST /api/reports/run`, `GET /api/reports/:id/run`, `POST /api/reports/export`, `GET /api/reports/:id/export`; `web/src/modules/reports/` (`Builder.tsx`, `BuilderParts.tsx`, `SpecEditor.tsx`, `FilterEditor.tsx`, `ResultView.tsx`, `charts.ts`, `ReportPages.tsx`). Nineteen standard reports, including on-vehicle equipment past support and critical systems without recovery targets. Tests: `query.test.ts`.

### E12-05 Scheduled delivery of reports

**Status:** done · **Priority:** P3 · **Type:** feature

As a manager, I schedule a report or dashboard to be sent to named people every day, week
or month.

**Acceptance criteria**

- [x] A schedule has a report or dashboard, a frequency, an hour in the organisation time zone, a format and recipients (people and roles)
- [x] Each recipient receives only what their own permissions allow (restricted rows filtered by the recipient's permissions, never the creator's); people who may not view the item or its records, or are not shared it, are skipped with the reason logged
- [x] Each delivery is logged and stored as a snapshot linked from an in-app notification
- [x] Reading a snapshot in the application is viewing: it needs view permission and continued sight of the source and every saved report in it. Downloading it (CSV, or HTML with `?download=1`) is an export: it needs `reports.export` / `dashboards.export` and is audited. A CSV schedule sends the document to recipients who may not export
- [ ] Email delivery: see E12-10

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

**Status:** in progress · **Priority:** P3 · **Type:** improvement

As an executive viewer or auditor, I sign in and see a home page that suits a
read-only role, rather than an overview with most tiles missing.

**Acceptance criteria**

- [ ] The home page chooses a layout from the user's permissions
- [x] The board summary dashboard is a one-page view in plain language for an executive viewer
- [x] The `dashboards.view` permission is enforced
- [ ] The Overview page uses the chosen home dashboard (E12-11)

### E12-08 Print and PDF for dashboards

**Status:** in progress · **Priority:** P3 · **Type:** improvement

As a manager, I can print a dashboard, or save it as a PDF, and get a tidy page.

**Acceptance criteria**

- [x] Print styles for user-built dashboards and packs; a print-ready dashboard document (`GET /api/dashboards/:id/export`)
- [x] The "as at" time appears on the page
- [ ] Print styles for the fixed overview and service desk dashboards
- [ ] Charts print legibly in black and white

### E12-09 PDF and spreadsheet (XLSX) exports

**Status:** open · **Priority:** P2 · **Type:** feature

Server-made PDF and XLSX files need packages that are not installed. Today the print-ready
document is saved as a PDF from the browser, and spreadsheets are CSV.

### E12-10 Email delivery of scheduled reports

**Status:** open · **Priority:** P3 · **Type:** feature

Depends on [E14-04](E14-platform-services.md). `schedule.ts` has a delivery-channel list
ready for an email channel; the message must carry a link, never the figures.

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

**Status:** open · **Priority:** P3 · **Type:** improvement

- Series and pivot columns follow the order values are met, not the lookup's sort order.
- Multi-choice custom fields cannot be reported on yet.
- Dashboard drag-and-drop is switched off below 760px of content width (keyboard moves still work).
