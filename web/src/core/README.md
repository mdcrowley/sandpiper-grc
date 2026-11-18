# Web core: component catalogue

Everything is exported from one place:

```tsx
import { ResourceList, RecordPage, useFetch, Chart, Stepper, Countdown /* ... */ } from '../../core';
import type { ModuleDef } from '../../core';
```

Styles are global (`tokens.css`, `base.css`) and already loaded. Do not add CSS frameworks or
web fonts. Put module-specific CSS in your module folder and import it from your `index.tsx`;
use the tokens (`var(--surface)`, `var(--border)`, `var(--text-muted)`, `var(--s-4)`, ...) so
both themes work.

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
| `nav` | `{ group, label, path, icon, permission?, order? }[]` | `group` is one of `Home`, `Service desk`, `Inventory`, `Change`, `Vendors`, `Cybersecurity`, `Projects`, `Reports`, `Administration`. `icon` is an icon name (section 11). Items are sorted by `order` (default 100) and hidden without `permission`; empty groups are hidden |
| `routes` | `{ path, element, permission? }[]` | React Router paths rendered inside the shell. With `permission`, users without it see a "no access" page |
| `create` | `{ label, path, permission?, icon? }[]` | Entries in the global Create menu. Use `path: '/things?new=1'`: a `ResourceList` with `createFields` opens its New dialog when it sees `?new=1` |
| `publicRoutes` | `{ path, element }[]` | Rendered **without** the shell and **without** sign-in (e.g. `/redeem` for a one-time link). They work with or without a session and win over the sign-in screen. Inside them `useAuth()` and `useToast()` work; `useResource`, `useLookup`, `ResourceList` and other metadata-driven pieces do not (metadata loads only after sign-in). Wrap the page in `<div className="auth-page"><div className="auth-card">...</div></div>` to match the sign-in screen |

Every screen needs loading, empty and error states: `ResourceList`, `RecordPage` and the
panels have them built in; for your own data use `useFetch` with `Loading`, `EmptyState` and
`ErrorState`.

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

A complete list screen for a record type: search, server-side sort/filter/paging, saved views,
CSV export, New dialog, and loading/empty/error states.

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
| `columns` | `(string \| { field, label?, render?, sortable? })[]` | A string is a field name, rendered by type: lookup as chip, user/ref from `_display` (ref links to the target record), date `18 Nov 2026`, datetime `18 Nov 2026, 14:05` (organisation time zone), boolean Yes/No, currency in the organisation's currency. `created_at` and `updated_at` work too. The title and reference columns link to the detail page. `render(row)` replaces the cell; render-only columns are not sortable unless `sortable: true` and `field` is a real column |
| `filters` | `string[]` | Fields offered in the filter bar. lookup: multi-select; boolean: any/yes/no; user and ref: pickers; date and datetime: after/before. Other types are ignored (the search box covers text) |
| `baseFilter` | `Record<string, string>` | Always applied, not shown. Keys as in `listQuery` filters: `{ project_id: id }`, `{ 'due_at.lt': '2026-12-01' }`, `{ status: 'open,pending' }` |
| `title` | `string` | Renders a `PageHeader`. Leave out when embedding the list in a tab or card (New and `actions` then sit in the toolbar) |
| `actions` | `ReactNode` | Extra buttons beside New |
| `onRowClick` | `(row) => void` | Default: navigate to `${route}/${id}` |
| `createFields` | `string[]` | Shows "New ..." (needs `<module>.create`), opening a `ResourceForm` with these fields. Also opened by `?new=1` |
| `createInitial` | `Record<string, unknown>` | Hidden values for new records, e.g. `{ project_id: id }` |
| `onCreated` | `(row) => void` | Default: navigate to the new record. When given, the list reloads and stays |
| `pageSize` | `number` | Default 25 |

Drill-down links: a list reads its starting search and filters from the page address, using
the API's own names: `/tickets?f.status=new,open&f.priority=high&q=printer`. (It reads them
once, when the list mounts; it does not write filters back to the address.)

Saved views (name, search, filters, sort) are kept in `localStorage` per record type. The
Export button appears with `<module>.export`. Row selection for bulk actions is not built yet.

To show cell values yourself: `<FieldValue resource={resource} field="status" row={row} />`
(`compact` truncates long text), and `fieldMeta(resource, field)` for the label and type.

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
| `fields` | `string[]` | Field names in order. Control by type: text, longtext (textarea), number, currency ($), date, datetime (organisation time zone), boolean (checkbox), lookup (select), user and ref (search pickers), json (textarea, validated). `readOnly` fields are shown disabled and never sent |
| `initial` | `Record<string, unknown>` | Starting values. Pass the whole row when editing so pickers show `_display` labels. On create, keys **not** in `fields` are sent as hidden values (e.g. a parent id) |
| `id` | `string` | Edit mode: only changed fields are PATCHed |
| `onSaved` | `(row: Row) => void` | Receives the server's row |
| `onCancel` | `() => void` | Shows a Cancel button |
| `submitLabel` | `string` | Default "Create <label>" / "Save changes" |

Required fields are checked before sending (same rule as the server); server `error.fields`
messages are shown beside the fields and any other message above the form. On create, empty
fields are left out so server defaults apply. The form has no title: wrap it in a `Modal`,
`Drawer` or `Card`.

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
status chip + actions), `banner`, summary, tabs. The active tab is kept in `?tab=`.

| Prop | Type | Notes |
|---|---|---|
| `type` | `string` | Record type key |
| `id` | `string` | Default: `useParams().id` |
| `title` | `(row) => string` | Default: the resource's `titleField` |
| `subtitle` | `(row) => ReactNode` | |
| `status` | `(row) => ReactNode` | Default: a `LookupChip` of the `status` field when it is a lookup |
| `actions` | `(rec) => ReactNode` | Header buttons |
| `banner` | `(rec) => ReactNode` | Between header and summary: `Stepper`, `Countdown`s |
| `summaryFields` | `string[]` | Default summary: an `EditableSummary` of these fields |
| `summary` | `(rec) => ReactNode` | Replaces the default summary |
| `tabs` | `{ key, label, count?, content: (rec) => ReactNode }[]` | Shown before the built-in tabs |
| `defaultTabs` | `('activity' \| 'links' \| 'history')[]` | Built-in tabs to include; default all three ("Activity", "Related", "History"). Every record must keep its history visible |
| `breadcrumbs` | `{ label, to? }[]` | Default: plural (link to the list) / reference or title |

`rec` is a `RecordContext`: `{ row, resource, reload, save(patch), canEdit }`.

The panels and helpers also work on their own (e.g. on a custom page):

```tsx
<ActivityPanel type="ticket" id={id} />            // props: type, id, defaultInternal? (true), internalOnly?
<HistoryPanel type="ticket" id={id} />             // props: type, id
<LinksPanel type="ticket" id={id} />               // props: type, id, editable? (default: <module>.edit)
<EditableSummary type="ticket" row={row} fields={['title', 'status']} onSaved={reload} />
                                                   // props: type, row, fields, onSaved?, title? ("Details"), editable?
```

- `ActivityPanel`: comments (`/api/comments`) merged with history, newest first, with an
  add-comment box and an "Internal note" tick box.
- `HistoryPanel`: `/api/history`: who, when, summary and each changed field as before → after.
  User and ref fields show "set" rather than a name, because history stores ids.
- `LinksPanel`: `/api/links` grouped by record type, each linking to its page; add with a
  record type + record picker + relation, remove with confirmation. If a lookup list named
  `link_relation` exists it supplies the relation choices, otherwise relation is free text.

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
| `label` | `string` | Required description for screen readers |
| `height` | `number` | Pixels, default 280. Width follows the container and resizes |
| `onSegmentClick` | `(seg: { name, value, seriesName?, dataIndex, data }) => void` | Click on a bar, slice, point, cell or node |

- The chart follows the light/dark theme: text, axes, grid, tooltip and the eight-colour series
  palette come from the design tokens. Do not set those colours yourself.
- For status/priority colours use `chartColor('red')` (any colour name from section 11), or
  `statsToData(groups)` which turns a stats response into `{ name, value, key, itemStyle }[]`
  using each group's configured colour. Any `var(--token)` string inside the option is resolved
  for the current theme.
- The ECharts code loads on first use (a skeleton shows meanwhile). The default plot margins
  are `grid: { top: 24, right: 16, bottom: 32, left: 48 }`; pass your own `grid` to change them
  (e.g. more `left` for long category names on a horizontal bar chart).
- Bars get rounded top corners by default; for horizontal bars set
  `itemStyle: { borderRadius: [0, 4, 4, 0] }` on the series.
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

```tsx
<ProgressBar label="Outcomes at target" value={31} max={53} color="green" valueText="31 of 53" />
// props: value, max? (100), label, hideLabel?, color? ('blue'), valueText?
```

## 8. Other components

| Component | Props | Notes |
|---|---|---|
| `Button` | `variant?: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`, `size?: 'sm' \| 'md'`, `icon?`, `loading?`, plus `<button>` attributes | Default `secondary`, `type="button"` |
| `IconButton` | `icon`, `label` (required accessible name), `variant?`, `size?` | |
| `Icon` | `name`, `size?` (18), `label?` | Decorative unless `label` is given |
| `Badge` | `color?`, `children` | Plain coloured chip |
| `StatusChip` | `color?`, `label` | Chip with a dot; use for status and priority |
| `LookupChip` | `list`, `value` | Label and colour from the lookup list |
| `Card` | `title?`, `actions?`, `flush?`, `className?`, `children` | `flush` removes body padding (tables) |
| `Stat` | `label`, `value`, `trend?: { direction: 'up' \| 'down' \| 'flat', label, tone?: 'good' \| 'bad' \| 'neutral' }`, `color?`, `to?` | Number tile; `to` makes it a drill-down link. Lay several out with `<div className="grid-stats">` |
| `Tabs` | `tabs: { key, label, count?, content? }[]`, `active?`, `onChange?`, `label?` | Uncontrolled unless `active` is passed |
| `Modal` (alias `Dialog`) | `open`, `title`, `onClose`, `footer?`, `size?: 'sm' \| 'md' \| 'lg'`, `children` | Focus trap, Esc and backdrop close |
| `Drawer` | as `Modal`, plus `side?: 'left' \| 'right'` | Side panel |
| `ConfirmDialog` | `open`, `title`, `message`, `confirmLabel?`, `danger?`, `busy?`, `onConfirm`, `onCancel` | |
| `Menu` | `label`, `items: { label, icon?, onSelect?, to?, danger?, disabled?, separated? }[]`, `icon?`, `iconOnly?`, `variant?`, `size?`, `align?: 'start' \| 'end'` | Button with a dropdown menu |
| `useToast()` | returns `{ success(msg), error(msg), info(msg) }` | e.g. `toast.error(errorMessage(err))` |
| `EmptyState` | `title`, `message?`, `icon?`, `action?` | |
| `Loading` | `lines?` (4), `label?` | Skeleton |
| `ErrorState` | `title?`, `error?`, `onRetry?` | Shows the error's message and a Try again button |
| `PageHeader` | `title`, `reference?`, `subtitle?`, `status?`, `actions?`, `breadcrumbs?: { label, to? }[]` | Renders the page `<h1>` and sets the tab title. One per page (`ResourceList` with `title` and `RecordPage` already render it) |
| `DefinitionList` | `items: { label, value, wide? }[]` | Label/value grid |
| `NotFound`, `Forbidden` | none | Full-page states |
| `ChangePasswordDialog` | `open`, `onClose` | |
| `useTheme()` | returns `{ theme: 'light' \| 'dark', toggle }` | |
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

All controlled (`value` + `onChange(value)`), all take the common props
`label` (required), `required?`, `disabled?`, `error?`, `hint?`, `hideLabel?`, `className?`.

| Control | Value | Extra props |
|---|---|---|
| `TextField` | `string` | `type?` (`text`, `email`, `password`, `url`, `search`, `tel`), `placeholder?`, `autoComplete?`, `autoFocus?`, `maxLength?`, `inputMode?` |
| `TextArea` | `string` | `rows?` (4), `placeholder?` |
| `Select` | `string` (`''` = none) | `options: { value, label }[]`, `placeholder?` |
| `LookupSelect` | `string` | `list` (lookup list name) |
| `MultiSelect` | `string[]` | `label`, `options` (compact dropdown of tick boxes; no `error`/`hint`) |
| `Checkbox` | `checked: boolean`, `onChange(checked)` | `label`, `hint?`, `error?`, `disabled?` |
| `DateField` | `'YYYY-MM-DD'` or `''` | `min?`, `max?` |
| `DateTimeField` | ISO instant or `''` | Edited as wall-clock time in the organisation's time zone |
| `NumberField` | `number \| null` | `min?`, `max?`, `step?`, `prefix?` |
| `UserPicker` | `string \| null` (user id) | `display?` (label of the current value, e.g. `row._display?.owner_id`), `placeholder?`; `onChange(id, option?)` |
| `RecordPicker` | `string \| null` (record id) | `type` (record type key), `display?`, `placeholder?`; `onChange(id, option?)` |

```tsx
<UserPicker label="Owner" value={ownerId} display={row._display?.owner_id} onChange={(id) => setOwnerId(id)} />
<RecordPicker label="System" type="system" value={systemId} onChange={(id) => setSystemId(id)} />
```

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

**Colours** (`ColorName`, `COLOR_NAMES`), the one scale for every status and priority chip;
lookup values carry one of these in `color`:

`gray`, `blue`, `teal`, `green`, `amber`, `orange`, `red`, `purple`

Tokens per colour: `--c-<name>-bg`, `--c-<name>-fg` (chip background and text) and
`--c-<name>-solid` (bars, charts, accents).

**Icons** (`IconName`, `ICON_NAMES`):

`home`, `ticket`, `book`, `server`, `box`, `map-pin`, `database`, `refresh`, `building`,
`file-text`, `shield`, `alert`, `bug`, `clipboard`, `graduation`, `clock`, `scale`, `target`,
`check-square`, `folder`, `chart`, `settings`, `users`, `user`, `search`, `plus`, `minus`, `x`,
`check`, `chevron-down`, `chevron-up`, `chevron-left`, `chevron-right`, `chevrons-left`,
`chevrons-right`, `arrow-up`, `arrow-down`, `external`, `download`, `upload`, `filter`, `sun`,
`moon`, `menu`, `more`, `edit`, `trash`, `link`, `lock`, `info`, `calendar`, `message`,
`history`, `eye`, `star`, `logout`

**CSS helpers**: `stack` (vertical flow with gaps), `row` (horizontal, wrapping, centred),
`grid-stats` (responsive tiles for `Stat`), `grid-2` (two columns, one when narrow), `muted`,
`num` (right-aligned tabular numbers), `ref` (record reference style), `truncate`, `prose`
(keeps line breaks), `sr-only`, `table` (inside `<div className="table-wrap">`), `chip chip-<colour>`.
