# Web core: component catalogue

Everything is exported from one place:

```tsx
import { ResourceList, RecordPage, useFetch, Chart, Stepper, Countdown /* ... */ } from '../../core';
import type { ModuleDef } from '../../core';
```

The interface is built on **Mantine 9** (`@mantine/core`, `hooks`, `dates`, `notifications`)
with a Sandpiper theme (`mantine.tsx`) driven by design tokens (`tokens.css`). The core
components below are the normal way to build a screen; for a richer layout a module may also
import Mantine components directly (`import { Group, Popover } from '@mantine/core'`): they
pick up the same theme. Styles are global (`tokens.css`, `base.css`, `shell.css`) and already
loaded. Do not add another CSS framework or web fonts. Put module-specific CSS in your module
folder and import it from your `index.tsx`; use the tokens (`var(--surface)`, `var(--border)`,
`var(--text-muted)`, `var(--s-4)`, ...) so both themes work. Section 11 explains the theme,
the tokens and how to re-brand.

## Contents

1. [Writing a module](#1-writing-a-module)
2. [Data: api, useFetch, useRecord, auth, meta](#2-data)
3. [ResourceList](#3-resourcelist)
4. [ResourceForm](#4-resourceform)
5. [RecordPage and panels](#5-recordpage-and-panels)
6. [Chart](#6-chart)
7. [Stepper, Countdown, ProgressBar](#7-stepper-countdown-progressbar)
8. [Other components](#8-other-components)
9. [Form controls](#9-form-controls)
10. [Formatting](#10-formatting)
11. [Colour names, icon names, CSS helpers](#11-colour-names-icon-names-css-helpers)

## 1. Writing a module

`web/src/modules/<key>/index.tsx` default-exports a `ModuleDef`. It is discovered
automatically (folders starting with `_` are ignored). Never edit files outside your folder.

```tsx
import { RecordPage, ResourceList } from '../../core';
import type { ModuleDef } from '../../core';

function TicketList() {
  return (
    <ResourceList
      type="ticket"
      title="Tickets"
      columns={['ref', 'title', 'status', 'priority', 'assignee_id', 'due_at']}
      filters={['status', 'priority', 'assignee_id']}
      createFields={['title', 'description', 'priority', 'assignee_id']}
    />
  );
}

function TicketDetail() {
  return <RecordPage type="ticket" summaryFields={['title', 'description', 'status', 'priority', 'assignee_id', 'due_at']} />;
}

const mod: ModuleDef = {
  key: 'tickets',
  nav: [{ group: 'Service desk', label: 'Tickets', path: '/tickets', icon: 'ticket', permission: 'tickets.view', order: 10 }],
  routes: [
    { path: '/tickets', element: <TicketList />, permission: 'tickets.view' },
    { path: '/tickets/:id', element: <TicketDetail />, permission: 'tickets.view' },
  ],
  create: [{ label: 'Ticket', path: '/tickets?new=1', permission: 'tickets.create' }],
};
export default mod;
```

`ModuleDef` (from `module.ts`):

| Key | Shape | Notes |
|---|---|---|
| `key` | `string` | Module folder name |
| `nav` | `{ group, label, path, icon, permission?, order? }[]` | `group` is one of `Home`, `Service desk`, `Inventory`, `Change`, `Vendors`, `Cybersecurity`, `Projects`, `Reports`, `Administration`, `Help`. `icon` is an icon name (section 11). Items are sorted by `order` (default 100) and hidden without `permission`; empty groups are hidden |
| `routes` | `{ path, element, permission? }[]` | React Router paths rendered inside the shell. With `permission`, users without it see a "no access" page |
| `create` | `{ label, path, permission?, icon? }[]` | Entries in the global Create menu. Use `path: '/things?new=1'`: a `ResourceList` with `createFields` opens its New dialog when it sees `?new=1` |
| `publicRoutes` | `{ path, element }[]` | Rendered **without** the shell and **without** sign-in (e.g. `/redeem` for a one-time link). They work with or without a session and win over the sign-in screen. Inside them `useAuth()` and `useToast()` work; `useResource`, `useLookup`, `ResourceList` and other metadata-driven pieces do not (metadata loads only after sign-in). Wrap the page in `<div className="auth-page"><div className="auth-card">...</div></div>` to match the sign-in screen |

Every screen needs loading, empty and error states: `ResourceList`, `RecordPage` and the
panels have them built in; for your own data use `useFetch` with `Loading`, `EmptyState` and
`ErrorState`.

### What the shell does with a module

`Shell.tsx` is a Mantine `AppShell`. Nothing in a module needs to know about it, but it helps
to know what happens to `nav` and `create`:

- **Sidebar.** `nav` entries appear under their group heading. Headings fold and unfold (the
  choice is kept per user in `localStorage`); the entry whose `path` is the longest prefix of
  the address is the current one, and its group opens by itself. From 1200px wide the sidebar is
  full width (the user can fold it to a rail); from 768px to 1199px it is a rail of one icon per
  group with a fly-out menu of that group's pages; below 768px it is a drawer opened from the
  top bar. Up/Down move between entries, Left/Right fold and open a group.
- **Search.** `/` or Ctrl+K opens the command palette (`CommandPalette.tsx`): every `nav`
  entry is offered under "Go to", every `create` entry under "Create" (as "New <label>"), and
  `/api/search` results are grouped by record type. Recent searches are kept per user.
- **Top bar.** Search, a "Pilot" label with a popover while `pilot` is on, the Create menu
  (`create` entries, alphabetical), the notification bell, Help (`/help`), the theme toggle and the user menu (Notifications, Account
  security, Change password, Help, Sign out). The second-factor reminder is a slim bar under the
  top bar that stays until the factor is set up. The bell is `NotificationBell` from the
  notifications module: the shell finds it with `import.meta.glob` and loads it lazily, so the core
  has no hard dependency on that module and shows no bell when it is absent.
- **Content.** Routes render inside `<main id="main" class="content">`, which is the page's
  one scrolling region (so `position: sticky; top: 0` inside a page sticks under the top bar)
  and centres its children at up to 1400px. Design for a content width of about 700px upwards:
  at 820px wide the rail is showing.
- **Print.** The sidebar, top bar, toasts and `PageHeader` actions are hidden and the content
  flows over as many pages as it needs. Add your own `@media print` rules for anything else.

## 2. Data

### api

```ts
import { api, ApiError, errorMessage, listQuery, qs } from '../../core';

const rows = await api.get<Row[]>('/api/things');
await api.post('/api/things', { title: 'x' });       // also api.patch(url, body), api.del(url)
```

- JSON in and out, same-origin cookies, `X-GRC-CSRF: 1` added on every non-GET call.
- Failures throw `ApiError { status, code, message, fields }` (`fields` is `{ [field]: message }`).
  `errorMessage(err)` gives a safe sentence for a toast. A 401 re-checks the session automatically.
- `qs({ a: 1, b: '' })` gives `"?a=1"` (empty values dropped; `""` when nothing is left).
- `listQuery({ q, sort, dir, page, pageSize, filters, format }, extra?)` builds a list or stats query.
  `filters` keys are what follows `f.` in the API: `{ status: ['new', 'open'], 'due_at.lt': '2026-12-01', 'assignee_id.null': true }`.
  Example: `` `/api/tickets/stats${listQuery({ filters: { priority: ['high'] } }, { group: 'status' })}` ``.
- Types: `Row` (`{ id, _display?, [field]: any }`), `ListResult<T>` (`{ rows, total, page, pageSize }`),
  `StatsResult` (`{ groups: { value, label, color, count }[], total }`).

### useFetch

```tsx
const { data, loading, error, reload } = useFetch<StatsResult>('/api/tickets/stats?group=status');
if (error) return <ErrorState error={error} onRetry={reload} />;
if (!data) return <Loading />;
```

`useFetch<T>(url: string | null)`: GETs the URL, refetches when it changes, `null` skips the
request. During `reload()` the previous `data` stays (so check `!data`, not `loading`, for the
first-load skeleton). `error` is whatever the api client threw.

### useRecord

```tsx
const { row, loading, error, reload, save } = useRecord('ticket', id);
await save({ status: 'resolved' });   // PATCH; updates `row`; rejects with ApiError
```

### useAuth

```tsx
const { user, appName, features, pilot, mfaEnrollmentRequired, setupRequired, can, refresh, logout } = useAuth();
if (can('tickets.edit')) { /* ... */ }
```

`user` is `{ id, username, displayName, email, roles } | null`. `can(perm)` honours wildcard
grants (`*`, `tickets.*`) and returns true for `undefined`. `features` is the feature-switch
map. `mfaEnrollmentRequired` is true when the user's role needs a second factor that is not set
up yet (the shell then shows a notice linking to `/account/security`). `refresh()` re-reads
`/api/auth/state`: call it after anything that changes the session (redeeming a link,
enrolling a second factor).

### Metadata and lookups

```tsx
const resource = useResource('ticket');        // ResourceMeta | undefined
const statuses = useLookup('ticket_status');   // { value, label, color, sort }[] ([] if unknown)
const { resources, lookups, reload } = useMeta();   // reload() after editing lookups

lookupLabel('ticket_status', 'new');   // "New"  (plain functions, usable anywhere)
lookupColor('ticket_status', 'new');   // "blue"
<LookupChip list="ticket_status" value={row.status} />
recordHref('/tickets', id);            // "/tickets/<id>"
```

`ResourceMeta`: `{ type, label, plural, module, path, route, titleField, refField?, restricted, fields }`;
`FieldMeta`: `{ label, type, required?, readOnly?, list?, to? }`.

## 3. ResourceList

A complete list screen for a record type, built on Mantine: search, a Filters popover with
removable pills, server-side sort and paging (with a page-size choice), saved views, a column
chooser, row density, CSV export, row selection with bulk edit, a New dialog, and
loading (skeleton), empty and error states. The table scrolls inside its own frame with a
sticky header, so the page never scrolls sideways. Rows are keyboard operable: Tab to the
table, arrow keys (and Home/End) to move, Enter to open, Space to select.

```tsx
<ResourceList
  type="asset"
  title="Assets"
  columns={[
    'ref', 'name', 'status', 'owner_id', 'site_id', 'purchase_cost', 'warranty_end',
    { field: 'age', label: 'Age', render: (row) => `${row.age_years} y` },
  ]}
  filters={['status', 'site_id', 'owner_id', 'funder_interest', 'warranty_end']}
  baseFilter={{ category: 'laptop' }}
  createFields={['name', 'status', 'site_id', 'owner_id']}
/>
```

| Prop | Type | Notes |
|---|---|---|
| `type` | `string` | Record type key (required) |
| `columns` | `(string \| { field, label?, render?, sortable?, align?, hidden? })[]` | A string is a field name, rendered by type: lookup as chip, user/ref from `_display` (ref links to the target record), date `18 Nov 2026`, datetime `18 Nov 2026, 14:05` (organisation time zone), boolean Yes/No, currency in the organisation's currency. `created_at` and `updated_at` work too. The title and reference columns link to the detail page. Long text is cut to one line with the full text as a tooltip; numbers are right-aligned (`align` overrides). `render(row)` replaces the cell; render-only columns are not sortable unless `sortable: true` and `field` is a real column. `hidden: true` starts the column switched off in the column chooser |
| `filters` | `string[]` | Fields offered in the Filters popover. lookup: chips (any of); boolean: any/yes/no; user and ref: pickers (user fields also offer "Me"); date and datetime: after/before. Other types are ignored (the search box covers text). Active filters show as removable pills under the toolbar |
| `baseFilter` | `Record<string, string>` | Always applied, not shown. Keys as in `listQuery` filters: `{ project_id: id }`, `{ 'due_at.lt': '2026-12-01' }`, `{ status: 'open,pending' }` |
| `title` | `string` | Renders a `PageHeader`. Leave out when embedding the list in a tab or card (New and `actions` then sit in the toolbar) |
| `actions` | `ReactNode` | Extra buttons beside New |
| `onRowClick` | `(row) => void` | Default: navigate to `${route}/${id}` |
| `createFields` | `string[]` | Shows "New ..." (needs `<module>.create`), opening a `ResourceForm` with these fields. Also opened by `?new=1` |
| `createInitial` | `Record<string, unknown>` | Hidden values for new records, e.g. `{ project_id: id }` |
| `onCreated` | `(row) => void` | Default: navigate to the new record. When given, the list reloads and stays |
| `pageSize` | `number` | Rows per page to start with (default 25). The user can pick 10, 25, 50 or 100; the choice is remembered per record type |
| `bulkFields` | `string[]` | Fields that can be changed for many rows at once (lookup, user, ref, boolean, date; never `readOnly` ones). Default: the lookup and user fields among `columns` and `filters`. `[]` turns row selection off |
| `urlState` | `boolean` | Keep search, filters, sort and page in the page address. Default: on when the list is the page (`title` is given, or the address is the record type's own `route`), off for lists embedded elsewhere |
| `defaultSort` | `{ field, dir? }` | Sort used until the user picks one. Default: the server's `defaultSort` |

**Address bar.** A list that is the page keeps its state in the address, using the API's own
names, and reads it back, so a view can be bookmarked or sent to a colleague and the browser's
Back button undoes a filter: `/tickets?q=printer&f.status=new,open&f.due_at.lt=2026-12-01&sort=due_at&dir=desc&page=2`.
Typing in the search box replaces the current history entry; filters, sort and page add one.
Dashboards can link straight to such an address. An embedded list (`urlState` off) reads `q`
and `f.*` once when it mounts and then keeps its state to itself.

**Saved views** (name, search, filters, sort) are kept in `localStorage` per record type
(`grc.views.<type>`); "All <plural>" is built in. **Column choice, density and page size** are
kept in `localStorage` per user (`grc.u.<userId>.*`).

**Export.** The Export button (needs `<module>.export`) downloads every row that matches the
current search and filters from the server (`format=csv`), not just the page on screen.

**Selection and bulk actions.** Users with `<module>.edit` get a checkbox column when there is
at least one bulk field. The header checkbox selects the page; a selection is kept while
paging and cleared when the search or filters change. The bulk bar offers "Edit selected…"
(one field, one new value or "clear"; sent as one `PATCH {path}/:id` per row, so validation,
hooks and audit apply to each; rows that already hold the value are skipped; the dialog shows
progress and then how many were updated and why any failed) and, with `<module>.export`,
"Export selected" (a CSV of the selected rows with the columns on screen, built in the browser).

To show cell values yourself: `<FieldValue resource={resource} field="status" row={row} />`
(`compact` keeps it to one line with the full text as a tooltip), and
`fieldMeta(resource, field)` for the label and type.

`useFetch(url, { keepPrevious: true })` is what keeps the table in place between pages and
filters: the last result stays visible (with `loading` true) while a different URL loads.

## 4. ResourceForm

```tsx
<ResourceForm
  type="risk"
  fields={['title', 'description', 'likelihood', 'impact', 'owner_id', 'review_date']}
  initial={row}          // optional; pass the row when editing
  id={row.id}            // PATCH when set, POST when not
  onSaved={(saved) => reload()}
  onCancel={() => setEditing(false)}
/>
```

| Prop | Type | Notes |
|---|---|---|
| `type` | `string` | Record type key |
| `fields` | `string[]` | Field names in order. Control by type: text, longtext (a text area that grows), number, currency (organisation currency code, two decimals), date, datetime (organisation time zone), boolean (checkbox), lookup (select with colour dots), user and ref (search pickers), json (text area, validated). `readOnly` fields are shown disabled and never sent |
| `initial` | `Record<string, unknown>` | Starting values. Pass the whole row when editing so pickers show `_display` labels. On create, keys **not** in `fields` are sent as hidden values (e.g. a parent id) |
| `id` | `string` | Edit mode: only changed fields are PATCHed |
| `onSaved` | `(row: Row) => void` | Receives the server's row |
| `onCancel` | `() => void` | Shows a Cancel button |
| `submitLabel` | `string` | Default "Create <label>" / "Save changes" |
| `sections` | `{ title?, description?, fields }[]` | Groups fields under headings. Fields not named in a section come first, without a heading |
| `hints` | `Record<string, string>` | Help text under individual fields, by field name |
| `onDirtyChange` | `(dirty: boolean) => void` | Told when the form gains or loses unsaved changes, e.g. to guard a dialog's own close button (as `ResourceList` does for its New dialog) |

- **Layout.** Two columns that collapse to one when the form's own container is narrow (it
  measures the dialog or card, not the window). Long text, JSON and the title field span the
  full width.
- **Validation.** Required fields are checked before sending (same rule as the server); server
  `error.fields` messages are shown under their fields and any other message above the form.
  Either way focus moves to the first field with a problem and it is scrolled into view.
- **Unsaved changes.** Cancel on a changed form first asks "Discard your unsaved changes?"
  (Keep editing / Discard changes) in the action bar.
- **Action bar.** Sticks to the bottom of the scrolling dialog or page, so Save is always in reach.
- On create, empty fields are left out so server defaults apply. The form has no title: wrap
  it in a `Modal`, `Drawer` or `Card`.

## 5. RecordPage and panels

```tsx
function ChangeDetail() {
  return (
    <RecordPage
      type="change"
      banner={({ row }) => (
        <Stepper current={row.status} steps={[
          { key: 'draft', label: 'Draft' }, { key: 'review', label: 'Review' },
          { key: 'approved', label: 'Approved' }, { key: 'done', label: 'Implemented' },
        ]} />
      )}
      actions={({ row, save, canEdit }) => canEdit && row.status === 'draft' && (
        <Button variant="primary" onClick={() => save({ status: 'review' })}>Submit for review</Button>
      )}
      summaryFields={['title', 'description', 'risk_level', 'owner_id', 'planned_start', 'planned_end']}
      tabs={[{ key: 'tasks', label: 'Tasks', content: ({ row }) => <ChangeTasks changeId={row.id} /> }]}
    />
  );
}
```

`RecordPage` loads the record (id from the `:id` route parameter unless `id` is given), shows
loading, not-found/no-access and error states, then: breadcrumbs, header (reference + title +
status chip + actions), `banner`, summary, tabs. The active tab is kept in `?tab=`, and the
Activity and Related tabs show a count (comments, linked records).

| Prop | Type | Notes |
|---|---|---|
| `type` | `string` | Record type key |
| `id` | `string` | Default: `useParams().id` |
| `title` | `(row) => string` | Default: the resource's `titleField` |
| `subtitle` | `(row) => ReactNode` | Default: "Updated 3 hours ago" |
| `status` | `(row) => ReactNode` | Default: a `LookupChip` of the `status` field when it is a lookup |
| `actions` | `(rec) => ReactNode` | Header buttons |
| `banner` | `(rec) => ReactNode` | Between header and summary: `Stepper`, `Countdown`s |
| `summaryFields` | `string[]` | Default summary: an `EditableSummary` of these fields |
| `summary` | `(rec) => ReactNode` | Replaces the default summary |
| `tabs` | `{ key, label, count?, content: (rec) => ReactNode }[]` | Shown before the built-in tabs |
| `defaultTabs` | `('activity' \| 'attachments' \| 'links' \| 'history')[]` | Built-in tabs to include; default all four, in this order: "Activity", "Attachments", "Related", "History". Every record must keep its history visible |
| `breadcrumbs` | `{ label, to? }[]` | Default: plural (link to the list) / reference or title |

`rec` is a `RecordContext`: `{ row, resource, reload, save(patch), canEdit }`.

The **Attachments** tab shows the attachments module's `AttachmentsPanel`
(`web/src/modules/attachments/AttachmentsPanel.tsx`, props `recordType`, `recordId`,
`evidence?`) for the record, with the number of files on the tab (from
`GET /api/attachments?record_type=&record_id=`, refreshed when the user changes tab). The
panel's code is loaded the first time the tab is opened. The tab is left out when the
attachments module is not part of the build or not loaded on the server, when `defaultTabs`
omits `'attachments'`, and when the page passes a tab of its own with the key `attachments`
or `files` (do that to show the panel with `evidence`).

The panels and helpers also work on their own (e.g. on a custom page):

```tsx
<ActivityPanel type="ticket" id={id} />            // props: type, id, defaultInternal? (true), internalOnly?, row?
<HistoryPanel type="ticket" id={id} />             // props: type, id, row?
<LinksPanel type="ticket" id={id} />               // props: type, id, editable? (default: <module>.edit)
<EditableSummary type="ticket" row={row} fields={['title', 'status']} onSaved={reload} />
                                                   // props: type, row, fields, onSaved?, title? ("Details"), editable?, sections?
```

- `EditableSummary`: a card of label/value pairs (long text takes the full width only when
  there is enough of it) with an Edit button that turns the card into a `ResourceForm` in place.
- `ActivityPanel`: a composer (internal note / public comment switch, internal by default;
  Ctrl+Enter posts) above one timeline of comments (`/api/comments`) and changes, newest
  first, with initials avatars and relative times (exact time on hover). "Everything /
  Comments / Changes" narrows the timeline.
- `HistoryPanel`: `/api/history`: who, when, summary and each changed field as
  ~~before~~ → after, using the field labels and lookup labels. History stores ids for user
  and record fields; the panel shows names where it can find them (the record's own
  `_display` labels when `row` is passed, otherwise a lookup of the user or record) and
  "Another user" / "Another <type>" where it cannot. A creation lists the fields that were
  given a value; long lists fold behind "Show more".
- `LinksPanel`: `/api/links` grouped by record type, each linking to its page, with the
  relation as a badge; "Add link" opens a dialog (record type, relation, record picker),
  remove asks for confirmation. If a lookup list named `link_relation` exists it supplies the
  relation choices, otherwise relation is free text.

## 6. Chart

A thin ECharts wrapper. Registered: bar, line, pie (and doughnut), heatmap, graph; grid,
tooltip, legend, visualMap, aria. Other chart types are not available.

```tsx
const { data } = useFetch<StatsResult>('/api/tickets/stats?group=status');
const option = useMemo(() => ({
  tooltip: { trigger: 'item' },
  xAxis: { type: 'category', data: data?.groups.map((g) => g.label) ?? [] },
  yAxis: { type: 'value', minInterval: 1 },
  series: [{ type: 'bar', data: statsToData(data?.groups ?? []) }],
}), [data]);

<Chart
  label="Tickets by status"
  option={option}
  height={260}
  onSegmentClick={(seg) => navigate(`/tickets?f.status=${(seg.data as { key: string }).key}`)}
/>
```

| Prop | Type | Notes |
|---|---|---|
| `option` | `ChartOption` (ECharts option) | **Memoise it** (`useMemo`): a new object redraws the chart |
| `label` | `string` | Required name of the chart for screen readers |
| `height` | `number` | Pixels, default 280. Width follows the container and resizes |
| `onSegmentClick` | `(seg: { name, value, seriesName?, dataIndex, data }) => void` | Click on a bar, slice, point, cell or node |
| `loading` | `boolean` | Shows the chart skeleton (use while your data loads: `loading={!data}`) |
| `emptyMessage` | `string` | Text of the empty state. Default "No data to show yet" |
| `empty` | `boolean` | Forces the empty state on or off. Default: worked out from the option (every series has no data, or a pie is all zeros) |
| `description` | `string` | A longer description read out after the label (what the chart shows, the main finding) |

- The chart follows the light/dark theme: fonts, text, axes, grid, tooltip and the eight-colour
  series palette come from the design tokens and the Mantine theme. Do not set those colours
  yourself. The series palette is used in its fixed order and has been checked for colour-vision
  deficiency separation in both themes; with more than eight series, group the rest as "Other".
- States are built in: a bar skeleton while the chart code or your data loads, and one empty
  state ("No data to show yet") whenever there is nothing to draw.
- Accessibility: the chart is an image named by `label`; for bar, line and pie charts the
  numbers are also written into a visually hidden table that screen readers reach from the
  chart. Animations are short and are switched off for people who ask for reduced motion.
- A tooltip on hover is on by default (`tooltip: { trigger: 'item' }`); for line charts pass
  `tooltip: { trigger: 'axis' }`.
- A legend (`legend: {}`) is placed above the plot and the default margins make room for it.
  Give `legend.top` or `legend.bottom` to place it yourself.
- For status/priority colours use `chartColor('red')` (any colour name from section 11), or
  `statsToData(groups)` which turns a stats response into `{ name, value, key, itemStyle }[]`
  using each group's configured colour. Any `var(--token)` string inside the option is resolved
  for the current theme.
- The ECharts code loads on first use (a skeleton shows meanwhile). The default plot margins
  are `grid: { top: 24, right: 16, bottom: 32, left: 48 }`; pass your own `grid` to change them
  (e.g. more `left` for long category names on a horizontal bar chart).
- Mark defaults: bars at most 24px thick with rounded top corners (for horizontal bars set
  `itemStyle: { borderRadius: [0, 4, 4, 0] }` on the series), 2px lines with 8px round
  markers, and a 2px gap in the surface colour between pie slices and heatmap cells.
- One y-axis per chart. For two or more series add `legend: {}`. Wrap charts in a `Card` and
  give the page a table or list alternative where the numbers matter.

## 7. Stepper, Countdown, ProgressBar

```tsx
<Stepper
  label="Project gates"
  current={row.gate}                 // earlier steps show done, later ones to do
  blocked={row.gate_blocked}         // marks the current step blocked
  steps={[
    { key: 'idea', label: 'Idea' },
    { key: 'plan', label: 'Plan', hint: 'Approved 3 Nov 2026' },
    { key: 'build', label: 'Build' },
    { key: 'golive', label: 'Go-live', state: 'blocked' },   // state overrides: 'done' | 'current' | 'todo' | 'blocked'
  ]}
  onStepClick={(key) => save({ gate: key })}   // optional: makes steps buttons
/>
```

```tsx
<Countdown label="Response" deadline={row.response_due_at} start={row.created_at} completedAt={row.responded_at} />
<Countdown label="HHS notice" deadline={task.due_at} warnMs={7 * 24 * 3600 * 1000} />
```

| Countdown prop | Type | Notes |
|---|---|---|
| `deadline` | `string \| Date \| null` | ISO instant. Empty shows "No deadline" |
| `start` | `string \| Date \| null` | With it, amber starts when under a quarter of the window is left |
| `warnMs` | `number` | Amber threshold in ms when there is no `start` (default 24 hours) |
| `completedAt` | `string \| Date \| null` | Stops the clock: "Met" (green) or "Missed by ..." (red) |
| `paused` | `boolean` | Shows "Paused" (grey) |
| `label` | `string` | Text before the time |

Green "2d 4h left", amber when close, red "Overdue by 3h 12m". It ticks by itself.

`Stepper` is an ordered list of stages (not Mantine's `Stepper`, which has no blocked state or
per-step override): done steps show a tick, the current one the brand colour with a halo, a
blocked one a cross in red. It scrolls sideways inside its own box when the stages do not fit.

```tsx
<ProgressBar label="Outcomes at target" value={31} max={53} color="green" valueText="31 of 53" />
// props: value, max? (100), label, hideLabel?, color? ('blue'), valueText?
```

## 8. Other components

| Component | Props | Notes |
|---|---|---|
| `Button` | `variant?: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`, `size?: 'sm' \| 'md'`, `icon?`, `loading?`, plus `<button>` attributes | A Mantine `Button`. Default `secondary`, `type="button"`. `loading` shows a spinner and blocks clicks. For a link that looks like a button use the classes: `<Link className="btn btn-primary">` |
| `IconButton` | `icon`, `label` (required accessible name), `variant?`, `size?` | The label is also shown as a tooltip |
| `Icon` | `name`, `size?` (18), `label?` | Decorative unless `label` is given |
| `Badge` | `color?`, `children` | Plain coloured chip |
| `StatusChip` | `color?`, `label` | Chip with a dot; use for status and priority |
| `LookupChip` | `list`, `value` | Label and colour from the lookup list |
| `Card` | `title?`, `actions?`, `flush?`, `className?`, `children` | `flush` removes body padding; a `table-wrap` directly inside a flush card loses its own border |
| `Stat` | `label`, `value`, `trend?: { direction: 'up' \| 'down' \| 'flat', label, tone?: 'good' \| 'bad' \| 'neutral' }`, `color?`, `to?`, `icon?`, `hint?` | Number tile; `to` makes it a drill-down link, `icon` sits beside the label, `hint` is a short line under the value. Lay several out with `<div className="grid-stats">` |
| `Tabs` | `tabs: { key, label, count?, content? }[]`, `active?`, `onChange?`, `label?` | Mantine `Tabs`: arrow keys, Home and End move between tabs. Uncontrolled unless `active` is passed; only the active panel is mounted |
| `Modal` (alias `Dialog`) | `open`, `title`, `onClose`, `footer?`, `size?: 'sm' \| 'md' \| 'lg'`, `children` | Mantine `Modal`: focus trap, Esc and backdrop close, focus returns to the opener. Focus starts in the first form control. With several open, Esc closes only the top one, and never while a dropdown inside it is open. `footer` stays visible while the body scrolls |
| `Drawer` | as `Modal`, plus `side?: 'left' \| 'right'` | Side panel (Mantine `Drawer`), same behaviour |
| `ConfirmDialog` | `open`, `title`, `message`, `confirmLabel?`, `danger?`, `busy?`, `onConfirm`, `onCancel` | Focus starts on Cancel when `danger`, otherwise on the confirm button |
| `Menu` | `label`, `items: { label, icon?, onSelect?, to?, danger?, disabled?, separated? }[]`, `icon?`, `iconOnly?`, `variant?`, `size?`, `align?: 'start' \| 'end'` | Button with a dropdown menu (Mantine `Menu`): arrow keys, Esc, type-ahead. Items with `to` are real links |
| `useToast()` | returns `{ success(msg), error(msg), info(msg) }` | Mantine notifications at the bottom right; errors stay 9 seconds, others 5. Works anywhere inside the app, e.g. `toast.error(errorMessage(err))` |
| `EmptyState` | `title`, `message?`, `icon?`, `action?` | Icon in a soft circle, title, message, then the action (usually a `Button`) |
| `Loading` | `lines?` (4), `label?` | Skeleton lines (Mantine `Skeleton`); `label` is announced to screen readers |
| `ErrorState` | `title?`, `error?`, `onRetry?` | Shows the error's message and a Try again button |
| `PageHeader` | `title`, `reference?`, `subtitle?`, `status?`, `actions?`, `breadcrumbs?: { label, to? }[]` | Renders the page `<h1>` and sets the tab title. One per page (`ResourceList` with `title` and `RecordPage` already render it) |
| `DefinitionList` | `items: { label, value, wide? }[]` | Label/value grid |
| `NotFound`, `Forbidden` | none | Full-page states with their own heading and links to the overview and Help |
| `ChangePasswordDialog` | `open`, `onClose` | Password boxes have a show/hide button and a length meter |
| `useTheme()` | returns `{ theme: 'light' \| 'dark', toggle }` | Also `setTheme(theme)` and `cssVar('--text')`. Mantine's colour scheme follows it |
| `useDebounced(value, ms?)`, `useMediaQuery(query)`, `cx(...classes)` | | Small helpers |

```tsx
const toast = useToast();
const [open, setOpen] = useState(false);

<Card title="Open risks" actions={<Button size="sm" onClick={() => setOpen(true)}>Add</Button>}>
  <div className="grid-stats">
    <Stat label="High" value={4} color="red" to="/risks?f.level=high" trend={{ direction: 'down', label: '2 fewer than last month', tone: 'good' }} />
  </div>
</Card>
<Modal open={open} title="Add risk" onClose={() => setOpen(false)}>
  <ResourceForm type="risk" fields={['title']} onCancel={() => setOpen(false)}
    onSaved={() => { setOpen(false); toast.success('Risk added.'); }} />
</Modal>
```

## 9. Form controls

Built on the Mantine inputs, so they follow the theme. All controlled (`value` +
`onChange(value)`), all take the common props `label` (required), `required?` (adds the
marker), `disabled?`, `error?` (message under the control), `hint?` (help text under the
control), `hideLabel?` (the label becomes the accessible name only), `className?`,
`size?` (`xs`, `sm` default, `md`).

| Control | Value | Extra props |
|---|---|---|
| `TextField` | `string` | `type?` (`text`, `email`, `password`, `url`, `search`, `tel`), `placeholder?`, `autoComplete?`, `autoFocus?`, `maxLength?`, `inputMode?`, `leftSection?`, `rightSection?` |
| `TextArea` | `string` | `rows?` (4, the starting height: the box grows with its content), `maxRows?` (16), `placeholder?` |
| `Select` | `string` (`''` = none) | `options: { value, label, color? }[]`, `placeholder?`, `searchable?` (default: on above eight options). Can be cleared unless `required`. Option values must be unique; an option with value `''` is used as the placeholder |
| `LookupSelect` | `string` | `list` (lookup list name). Shows each value's colour dot |
| `MultiSelect` | `string[]` | `label`, `options`, `disabled?`, `size?` (compact button with a dropdown of tick boxes, for toolbars; no `error`/`hint`) |
| `Checkbox`, `Switch` | `checked: boolean`, `onChange(checked)` | `label`, `hint?`, `error?`, `disabled?`. `Switch` is the same contract drawn as an on/off switch, for settings that apply at once |
| `DateField` | `'YYYY-MM-DD'` or `''` | `min?`, `max?`, `placeholder?`. Calendar, or type `18 Nov 2026`, `18/11/2026` or `2026-11-18` |
| `DateTimeField` | ISO instant or `''` | `placeholder?`. Edited as wall-clock time in the organisation's time zone (named in the hint); the browser's own zone plays no part |
| `NumberField` | `number \| null` | `min?`, `max?`, `step?`, `prefix?` (shown inside the control, e.g. `currency()`), `thousands?` (group digits), `decimals?`, `placeholder?` |
| `UserPicker` | `string \| null` (user id) | `display?` (label of the current value, e.g. `row._display?.owner_id`), `placeholder?`; `onChange(id, option?)` |
| `RecordPicker` | `string \| null` (record id) | `type` (record type key), `display?`, `placeholder?`; `onChange(id, option?)` |

```tsx
<UserPicker label="Owner" value={ownerId} display={row._display?.owner_id} onChange={(id) => setOwnerId(id)} />
<RecordPicker label="System" type="system" value={systemId} onChange={(id) => setSystemId(id)} />
```

The pickers are search-as-you-type comboboxes: the list opens on focus, typing searches after
a short pause, arrow keys and Enter choose, Escape closes the list (not the dialog), and the
cross clears. Record options show reference and title.

Dropdowns and calendars work inside `Modal` and `Drawer`. If you put controls inside a Mantine
`Popover` of your own, wrap the content in `<InlinePopups>` so that choosing from a dropdown
does not count as a click outside the popover. `ColorDot` (`color`) is the dot used for lookup
colours.

Lay hand-built forms out with `<form className="form">`, `<div className="form-grid">` (two
columns, one on narrow screens; `form-cell-wide` spans both) and `<div className="form-actions">`.

## 10. Formatting

All in the organisation's time zone (`timeZone()`, set by the server's `GRC_TIMEZONE`); empty values give "—".

| Function | Example |
|---|---|
| `formatDate(v)` | `18 Nov 2026` (date-only values are never shifted by time zone) |
| `formatDateTime(v)` | `18 Nov 2026, 14:05` |
| `relativeTime(v)` | `3 hours ago`, `in 2 days` |
| `formatDuration(ms)` | `2d 4h`, `3h 12m`, `45m` |
| `formatCurrency(v)` | `$1,234.50` |
| `formatNumber(v)` | `1,234.5` |
| `humanize('review_date')` | `Review date` |

## 11. Colour names, icon names, CSS helpers

### Theme and tokens

Three files decide how everything looks:

| File | Holds |
|---|---|
| `tokens.css` | The design tokens (CSS variables) for the light theme and, under `:root[data-theme="dark"]`, the dark theme. The single source of colour |
| `mantine.tsx` | The Mantine theme: brand and neutral colour scales, type, radius, spacing, shadows and component defaults (sizes, radius, focus ring), set once. Its CSS-variable resolver points Mantine's own variables (`--mantine-color-body`, `-text`, `-default-border`, `-dimmed`, `-anchor`, `-error`, the primary colour and the light variants of the eight named colours) at the tokens, so a Mantine component and hand-written CSS cannot disagree in either theme |
| `base.css`, `shell.css` | The helper classes and core component classes; the shell, command palette, sign-in pages and print rules |

`theme.ts` switches the theme: it sets `data-theme` (tokens) and `data-mantine-color-scheme`
(Mantine) on `<html>` together, and `UiProvider` forces Mantine to the same scheme.

Cascade order is the `reset` layer, then the `mantine` layer, then everything unlayered.
Mantine's styles are loaded as `styles.layer.css`, so any ordinary rule in the core or in a
module wins over them without `!important`.

Tokens (all defined for both themes):

| Group | Tokens |
|---|---|
| Brand | `--brand`, `--brand-hover`, `--brand-contrast` (text on brand), `--brand-soft` (tinted background), `--brand-strong`, `--accent` |
| Surfaces | `--bg` (page), `--surface` (cards, dialogs, inputs), `--surface-2` (table heads, wells), `--surface-hover` |
| Lines | `--border` (cards, dividers), `--border-control` (buttons), `--border-strong` (inputs; 3:1 against the surface) |
| Text | `--text`, `--text-muted`, `--link`, `--danger`, `--danger-contrast`, `--danger-text` |
| Feedback | `--focus` (focus ring), `--overlay`, `--shadow-1` (resting), `--shadow-2` (raised), `--shadow-3` (dialogs) |
| Navigation | `--nav-bg`, `--nav-text`, `--nav-muted`, `--nav-hover`, `--nav-active`, `--nav-accent`, `--nav-focus` |
| Type | `--font`, `--font-mono` (system fonts only), `--fs-xs` 12px, `--fs-sm` 13px, `--fs-md` 14px (body), `--fs-lg` 16px, `--fs-xl` 20px, `--fs-2xl` 26px (page title), `--fs-3xl` 32px |
| Space | `--s-1` 4px, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 24, `--s-6` 32, `--s-7` 48 |
| Shape and layout | `--radius-sm` 6px, `--radius` 8px, `--radius-lg` 12px, `--control-height` 36px, `--topbar-height`, `--nav-width`, `--rail-width` |
| Charts | `--series-1` to `--series-8`, `--chart-grid`, `--chart-axis` |

Text and its background are chosen to meet WCAG 2.1 AA (4.5:1) in both themes: keep to the
pairs above (`--text` or `--text-muted` on a surface, `--brand-contrast` on `--brand`,
`--c-<name>-fg` on `--c-<name>-bg`). In the dark theme `--brand` is a light tone with dark
text on it; never put white text on `--brand`.

Every interactive element shows a 2px `--focus` ring for keyboard users; inputs add a soft
glow. Animations and transitions are switched off under `prefers-reduced-motion`.

### Re-branding

1. In `tokens.css` change the `--brand*` and `--accent` values in both themes (and the `--nav-*`
   values if the sidebar should change). Check contrast: `--brand-contrast` on `--brand` and
   `--link` on `--surface` need 4.5:1.
2. In `mantine.tsx` change the ten-step `brand` scale to match (index 7 is the light theme's
   `--brand`, index 4 the dark theme's).
3. Replace the mark in `Logo.tsx` and the same drawing in `web/public/favicon.svg`. The
   application's name comes from the organisation profile (`appName`), not from code.

### Colours

`ColorName`, `COLOR_NAMES`: the one scale for every status and priority chip; lookup values
carry one of these in `color`:

`gray`, `blue`, `teal`, `green`, `amber`, `orange`, `red`, `purple`

Tokens per colour: `--c-<name>-bg`, `--c-<name>-fg` (chip background and text) and
`--c-<name>-solid` (bars, charts, accents). All eight are also Mantine colours, so a Mantine
`<Badge color="amber" variant="light">` uses the same pair.

### Icons

`Icon` draws from the open-source Tabler set (`@tabler/icons-react`); each icon is imported on
its own in `Icon.tsx`, so only these reach the bundle. To add one, import it there and add a
line to the map. Names (`IconName`, `ICON_NAMES`):

`home`, `ticket`, `book`, `server`, `box`, `map-pin`, `database`, `refresh`, `building`,
`file-text`, `shield`, `alert`, `bug`, `clipboard`, `graduation`, `clock`, `scale`, `target`,
`check-square`, `folder`, `chart`, `settings`, `users`, `user`, `search`, `plus`, `minus`, `x`,
`check`, `chevron-down`, `chevron-up`, `chevron-left`, `chevron-right`, `chevrons-left`,
`chevrons-right`, `arrow-up`, `arrow-down`, `external`, `download`, `upload`, `filter`, `sun`,
`moon`, `menu`, `more`, `edit`, `trash`, `link`, `lock`, `info`, `calendar`, `message`,
`history`, `eye`, `star`, `logout`, `help`, `eye-off`, `arrow-right`, `check-circle`,
`alert-circle`, `key`, `flask`, `bell`, `enter`, `sidebar-collapse`, `sidebar-expand`

### CSS helpers

| Class | Use |
|---|---|
| `stack`, `row` | Vertical flow with gaps; horizontal, wrapping, centred |
| `grid-stats`, `grid-2` | Responsive tiles for `Stat`; two columns, one when narrow |
| `muted`, `num`, `ref`, `truncate`, `prose`, `sr-only` | Muted text; right-aligned tabular numbers; record reference; one-line ellipsis; keeps line breaks; screen-reader only |
| `table` inside `<div className="table-wrap">` | Data table with a scrolling, bordered wrapper |
| `chip chip-<colour>` | The chip that `Badge` and `StatusChip` render |
| `card`, `card-head`, `card-title`, `card-body` | The markup `Card` renders, for hand-built cards |
| `btn` with `btn-primary`, `btn-secondary`, `btn-ghost` or `btn-danger` (and `btn-sm`) | Button look for links and other non-button elements |
| `notice` (and `notice-warn`, `notice-pilot`, `notice-success`) | A short message box inside a page: blue information by default, or red, amber, green |
| `form`, `form-grid`, `form-cell-wide`, `form-actions`, `field`, `field-label`, `field-hint`, `field-error`, `form-error`, `input` | Hand-built forms and plain inputs that match the Mantine controls |
| `kbd` | A keyboard key: `<kbd className="kbd">Ctrl K</kbd>` |
| `auth-page`, `auth-card`, `auth-brand`, `auth-title` | Centred card for pages outside the shell |
