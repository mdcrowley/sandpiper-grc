# E12 Dashboards and reporting

**Status:** in progress

## Goal

Let each person see the state of what they care about at a glance, and let managers
build, schedule and hand out the reports they need without asking for a developer.

## Scope notes

- Two fixed dashboards exist: the overview (home) and the service desk dashboard.
- The seven canned inventory reports are tracked in
  [E04-11](E04-inventory-and-relationship-map.md).
- The permission keys `dashboards` and `reports` are reserved and the default roles
  carry grants for them, but no route checks them yet.
- Scheduled delivery depends on notifications and a job queue
  ([E14](E14-platform-services.md)).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E12-01 | Overview dashboard | done | P1 |
| E12-02 | Service desk dashboard | done | P1 |
| E12-03 | User-built dashboards | open | P3 |
| E12-04 | Report builder | open | P2 |
| E12-05 | Scheduled delivery of reports | open | P3 |
| E12-06 | Report packs | open | P2 |
| E12-07 | Dashboards for read-only roles | open | P3 |
| E12-08 | Print and PDF for dashboards | open | P3 |

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

**Status:** open · **Priority:** P3 · **Type:** feature

As a user, I build my own dashboard from tiles (a count, a chart, a list) based on any
saved view, and share it with my team.

**Acceptance criteria**

- [ ] A dashboard is a named set of tiles stored on the server
- [ ] Tile kinds: number, chart by a field, short list
- [ ] Each tile respects the viewer's permissions, not the author's
- [ ] Dashboards can be private or shared
- [ ] Checked by `dashboards.*` permissions

### E12-04 Report builder

**Status:** open · **Priority:** P2 · **Type:** feature

As a manager, I choose a record type, the columns, filters, grouping and totals, save
the result as a named report, and run it whenever I need it.

**Acceptance criteria**

- [ ] Any registered record type can be reported on
- [ ] Columns, filters, sort, grouping and simple totals
- [ ] Reports are saved, named and shareable
- [ ] Output on screen, CSV and spreadsheet
- [ ] Restricted records stay hidden from people who may not see them
- [ ] Checked by `reports.*` permissions; running an export is audited

### E12-05 Scheduled delivery of reports

**Status:** open · **Priority:** P3 · **Type:** feature

As a manager, I schedule a report or dashboard to be sent to named people every week
or month.

**Acceptance criteria**

- [ ] A schedule has a report, a frequency and recipients
- [ ] Each recipient receives only what their own permissions allow
- [ ] Each delivery is logged
- [ ] Depends on email delivery ([E14-04](E14-platform-services.md)) and a job queue ([E14-12](E14-platform-services.md))

### E12-06 Report packs

**Status:** open · **Priority:** P2 · **Type:** feature

As a security lead, I produce a pack for a governing body or an auditor: a fixed set of
reports and charts as one dated document.

**Acceptance criteria**

- [ ] A pack is an ordered list of reports, charts and text sections
- [ ] Producing a pack freezes the figures as at that date
- [ ] Output as one PDF
- [ ] Past packs are kept and can be opened again
- [ ] At least one starter pack ships: framework progress, top risks, open actions, incidents

### E12-07 Dashboards for read-only roles

**Status:** open · **Priority:** P3 · **Type:** improvement

As an executive viewer or auditor, I sign in and see a home page that suits a
read-only role, rather than an overview with most tiles missing.

**Acceptance criteria**

- [ ] The home page chooses a layout from the user's permissions
- [ ] The executive viewer and auditor default roles each have a useful home page
- [ ] The `dashboards.view` permission is enforced

### E12-08 Print and PDF for dashboards

**Status:** open · **Priority:** P3 · **Type:** improvement

As a manager, I can print the overview or the service desk dashboard, or save it as a
PDF, and get a tidy page.

**Acceptance criteria**

- [ ] Print styles for both dashboards
- [ ] Charts print legibly in black and white
- [ ] The date range and "as at" time appear on the page
