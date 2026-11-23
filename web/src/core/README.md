# Web core: component catalog

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
11. [Color names, icon names, CSS helpers](#11-color-names-icon-names-css-helpers)
12. [Custom fields, tags, watching, preferences, labels](#12-custom-fields-tags-watching-preferences-labels)

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

### Code splitting: what loads when

The first download holds the shell only: React, the Mantine pieces the shell uses, sign-in,
navigation, the Create menu and the route table. **Each module is a chunk of its own** (its
pages, its CSS and whatever only it imports) that is fetched the first time one of its routes is
opened; the record layer (`ResourceList`, `RecordPage`, forms, pickers) is one shared chunk
fetched with the first module, the chart library loads with the first chart, and the date pickers
(`dateFields.tsx` and the `vendor-dates` chunk) with the first date field (`DateField` and
`DateTimeField` draw a read-only stand-in with the same label for the moment that takes).

Libraries are in chunks of their own, named in `VENDOR_GROUPS` in `vite.config.ts`:
`vendor-react` (React and the router) and `vendor-mantine` (the component library and its
helpers) load with every page; `vendor-dates`, `vendor-echarts` and `vendor-zrender` only when
needed. They change rarely, so browsers keep them across releases. Each group names its packages
exactly: a catch-all group would pull libraries only some pages need into every page. A new
library that every page needs belongs in `vendor-mantine` or a group of its own; one that only a
module uses needs nothing (it lands in that module's chunk).

A module author does nothing for this. The build (the `grc-modules` plugin in
`vite.config.ts`) reads `key`, `nav`, `create`, each route's `path` and `permission` and each
public route's `path` straight out of your `index.tsx` and gives them to the shell at start; the
`element` of a route stays in your chunk. The one rule: **write those parts as plain literals**,
as in the example above.

- Understood: string, number and boolean literals, template strings, `+`, top-level `const`
  values (`const ADMIN = 'admin.administer'`), arrays and objects of those, and spreads of them.
- Not understood: values computed at run time (a function call, an imported constant, a
  conditional). The module still works, but it is loaded at start like before and the build prints
  `modules/<key>/index.tsx is loaded at start, not on demand: <reason>`. Fix the reason.
- Keep `index.tsx` small: import your CSS and pages there as usual, but put anything other
  modules import from you (a panel, a helper) in its own file, so importing it does not pull in
  your whole module.
- While a chunk loads the content area shows `RouteLoading` (nothing for 150 ms, then a thin
  bar and a skeleton; element class `route-loading`). If the chunk cannot be fetched the page
  offers a reload. The shell starts fetching a module when the pointer or focus reaches one of
  its navigation links.
- `modules` (the registry) is unchanged in shape: `nav`, `create` and route paths are there at
  once, and a route's `element` is a stand-in that loads the module. `routePaths` lists every
  route path; `preloadRoute('/tickets/123')` starts loading whatever serves an address;
  `loadModule('tickets')` resolves to a module's full definition.
- Lazy pieces of your own: `const Heavy = lazy(() => import('./Heavy'))` inside a
  `<Suspense fallback={<Loading />}>`. Use it for something large that most visits do not need.

Build switches (environment variables): `GRC_WEB_MODULES=home,admin` builds only those module
folders (for parallel work when another module is mid-edit), and `GRC_ANALYSE=1` writes one
chunk per npm package and core file so the build output shows what each weighs (never serve
that build). Sizes at the time of writing (E18-55): entry script 220 kB, `vendor-mantine` 421 kB
and `vendor-react` 258 kB (275 kB compressed together); charts 656 kB in three files; no chunk is
over 500 kB.
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
  security, Change password, Help, Keyboard shortcuts, Sign out). The Help button opens **Help for this page**: it
  links to `/help?for=<address>` and the Help module turns that into the matching section of the guide
  (its `routeMap.ts`). The second-factor reminder is a slim bar under the
  top bar that stays until the factor is set up (with the date when a grace period is running). The bell is `NotificationBell` from the
  notifications module: the shell finds it with `import.meta.glob` and loads it lazily, so the core
  has no hard dependency on that module and shows no bell when it is absent.
- **Focus after a change of page** (`routeFocus.ts`, `useRouteFocus(mainRef)`; the portal layout
  uses it too). After the path changes, once the page shows its `<h1>` (and no loading skeleton),
  the focus moves to that heading (`tabindex="-1"`), so a screen reader announces the page. It is
  left alone on a fresh page load and when the focus is already inside the page content (a field
  with `autoFocus`) or in a dialog. The same hook rescues the focus when the element that had it is
  removed or becomes unavailable (a button replaced after its action, a Save button with nothing
  left to save): back to it once it is usable again after being busy, or else to the heading. A
  page that wants the focus elsewhere after an action should put it there itself (as the comment
  box does after "Add note").
- **Second factor required.** When `/api/auth/state` reports `mfaEnrollmentBlocked` (setting
  `auth.mfa_enforcement` = `required` and the user has no factor), the shell is not drawn at all:
  `EnrollmentGate.tsx` shows only the `/account/security` page with a Sign out button, and no
  metadata is requested. That page must call `useAuth().refresh()` after enrollment.
- **Keyboard.** `?` opens the list of shortcuts (`Shortcuts.tsx`; add a line there when a core
  component gains one); `g` then `o`, `n` or `h` goes to the overview, notifications or Help for
  the current page. Single keys are ignored while typing and while a dialog is open.
- **Content.** Routes render inside `<main id="main" class="content">`, which is the page's
  one scrolling region (so `position: sticky; top: 0` inside a page sticks under the top bar)
  and centers its children at up to 1400px. Design for a content width of about 700px upwards:
  at 820px wide the rail is showing.
- **Print.** Paper is always white: the light colors are used whatever the theme on screen.
  The sidebar, top bar, toasts, `PageHeader` and card actions, list toolbars, paging, row
  checkboxes, comment composers and form buttons are left out. Lists print every column with
  wrapped text and the header row repeated on each sheet (they print the page on screen: raise
  the page size or export for everything). A record prints its header, banner, summary and the
  open tab. Cards, tiles and timeline entries are not split across sheets. Add `no-print` to
  anything else that should stay off paper and `print-only` to what should appear only there;
  add your own `@media print` rules for module layouts.

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
const { user, appName, features, pilot, mfaEnrollmentRequired, mfaEnrollmentBlocked, mfaGraceEndsAt, setupRequired, can, refresh, logout } = useAuth();
if (can('tickets.edit')) { /* ... */ }
```

`user` is `{ id, username, displayName, email, roles } | null`. `can(perm)` honors wildcard
grants (`*`, `tickets.*`) and returns true for `undefined`. `features` is the feature-switch
map. `mfaEnrollmentRequired` is true when the user's role needs a second factor that is not set
up yet (the shell then shows a notice linking to `/account/security`); `mfaGraceEndsAt` is the
end of the grace period when one is running, and `mfaEnrollmentBlocked` is true once the server
refuses everything but set-up (the shell is then replaced by the set-up page, so module pages
never see it true). `refresh()` re-reads
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
chooser, row density, export (CSV, Excel or PDF), import from CSV or Excel, row selection
with bulk edit, a New dialog, and
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
| `columns` | `(string \| { field, label?, render?, sortable?, align?, hidden?, priority? })[]` | A string is a field name, rendered by type: lookup as chip, user/ref from `_display` (ref links to the target record), date `Nov 18, 2026`, datetime `Nov 18, 2026, 14:05` (organization time zone), boolean Yes/No, currency in the organization's currency. `created_at` and `updated_at` work too. The title and reference columns link to the detail page. Long text is cut to one line with the full text as a tooltip; numbers are right-aligned (`align` overrides). `render(row)` replaces the cell; render-only columns are not sortable unless `sortable: true` and `field` is a real column. `hidden: true` starts the column switched off in the column chooser. `priority` (1, 2 or 3) says which columns give way when the table is wider than the page: 3 and then 2 are left out, the rightmost first; 1 always shows. Default 1 for the first column, the reference, the title and `status`, 2 for the rest. A left-out column shows in the chooser as "Hidden to fit this width"; checking it keeps it on however narrow the page (remembered per person). The table never scrolls down inside itself (the page does), and scrolls sideways only when its priority 1 columns alone are too wide, with a fade at the edge that has more |
| `filters` | `string[]` | Fields offered in the Filters popover. lookup: chips (any of); boolean: any/yes/no; user and ref: pickers (user fields also offer "Me"); date and datetime: after/before. Other types are ignored (the search box covers text). Active filters show as removable pills under the toolbar |
| `baseFilter` | `Record<string, string>` | Always applied, not shown. Keys as in `listQuery` filters: `{ project_id: id }`, `{ 'due_at.lt': '2026-12-01' }`, `{ status: 'open,pending' }` |
| `title` | `string` | Renders a `PageHeader`. Leave out when embedding the list in a tab or card (`actions` then sit in the toolbar, and New moves into the page's own `PageHeader` when the list is the page, else it stays in the toolbar) |
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

**Saved views** (name, search, filters, sort) are a person's own, kept on the server as the
preference `views:<type>` with a `localStorage` copy (`grc.views.<type>`); "All <plural>" is built
in. A view can also be **shared** with everyone who can see the list (`/api/views`, `core/views.ts`:
audited, changed or removed only by its author or an administrator; labels of picked people and
records are not stored, so the pills look them up with each viewer's own permissions). The menu
lists "My views" and "Shared with everyone" (`useSavedViews` in `listState.ts`, `useSharedViews` in `sharedViews.ts`),
and offers to keep views that are still only in this browser (`useBrowserOnlyViews`). **Column choice, density and page size** are
kept in `localStorage` per user (`grc.u.<userId>.*`).

**Export.** The Export menu (`ExportMenu`, needs `<module>.export`) offers Excel, CSV and
PDF. Each downloads from the server every row that matches the current search, filters and
sort, not just the page on screen, with the columns on screen in their order
(`format=xlsx|csv|pdf&columns=a,b`). The server applies the same permissions and
restricted-record rule to every format and audits each export. To put the menu on a
hand-built list: `<ExportMenu resource={resource} query={query} columns={['ref', 'title']} filtered={false} />`.

**Import.** A list that is the page (`title` given, or the record type's own `route`)
shows an Import button to people who may create or edit the record type (and, for a wholly
restricted type, have `security.view`). It opens the import wizard (`core/ImportWizard.tsx`,
loaded only when first opened): choose a CSV or Excel file (and a sheet), match its columns
to fields, choose whether to create, update or both, check every row in a dry run that
writes nothing, map values that matched nothing, then import. The server does the work
(`core/import`). `?import=1` in the address opens
it too, as `?new=1` opens the New dialog.

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
| `fields` | `string[]` | Field names in order. Control by type: text, longtext (a text area that grows), number, currency (organization currency code, two decimals), date, datetime (organization time zone), boolean (checkbox), lookup (select with color dots), user and ref (search pickers), json (text area, validated). `readOnly` fields are shown disabled and never sent |
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
  (Keep editing / Discard changes) in the action bar. The form also registers with the shared
  guard (`useUnsavedChanges`, below): moving to another page or closing the tab asks first, a
  `Modal` or `Drawer` around it asks before closing, and when the session ends mid-edit the
  draft is kept. It releases the guard itself after a successful save, so `onSaved` may navigate.

### Unsaved changes: `useUnsavedChanges` (core/unsaved.tsx)

One guard for every form, page and dialog. A hand-written form calls
`const unsaved = useUnsavedChanges(dirty)` and gets:

- **Leaving the page**: a link, the sidebar, the Create menu, search or Back asks "Discard your
  unsaved changes?" (React Router's `useBlocker`; the app runs on a data router for this). A change
  of query or hash only (a tab) does not ask. Closing or reloading the tab asks through `beforeunload`.
- **`unsaved.release()`**: call it after a successful save, before navigating to the saved record.
- **`unsaved.guard(onClose)`**: wrap a dialog's own Cancel button with it.
- **Dialogs**: pass `dirty` to `Modal`/`Drawer` (Escape, ×, backdrop ask "Discard this draft?";
  `discardPrompt` changes the words). A `ResourceForm` inside a dialog tells it by itself.
- **Session ended** (core/session.ts): a 401 while something is unsaved opens "Your session has
  ended" in place instead of the sign-in page: sign in in a new tab and **Continue** sends the failed
  request again; or **Sign in on this page instead** keeps each form's draft in sessionStorage
  (`keep` option, `keepDraft`/`takeDraft`), and the sign-in page says why it is showing.
- `confirmDiscard()` asks the same question anywhere; `hasUnsavedChanges()` says whether anything is unsaved.

`UnsavedChangesHost` is mounted once under the router (App.tsx and the component test harness).
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
Activity and Related tabs show a count (comments, linked records). Every record page's
header also carries a **PDF** button (`RecordPdfButton`, shown only with
`<module>.export`) that downloads the record's fact sheet (its fields, tags and recent
history); put `<RecordPdfButton resource={resource} id={id} label={reference} />` among the
header buttons of a hand-built record page.

| Prop | Type | Notes |
|---|---|---|
| `type` | `string` | Record type key |
| `id` | `string` | Default: `useParams().id` |
| `title` | `(row) => string` | Default: the resource's `titleField` |
| `subtitle` | `(row) => ReactNode` | Default: "Updated 3 hours ago" |
| `status` | `(row) => ReactNode` | Default: a `LookupChip` of the `status` field when it is a lookup |
| `actions` | `(rec) => ReactNode` | Header buttons |
| `banner` | `(rec) => ReactNode` | Between header and summary: `Stepper`, `Countdown`s |
| `evidence` | `boolean` | The built-in files tab is called "Evidence files" and records new files as evidence (collection and expiry dates). Default: the type's `evidence` flag in `/api/meta` (`ResourceDef.evidence`, else core's `EVIDENCE_TYPES`: evidence items, framework outcomes, obligations, policies, exercises, risks) |
| `summaryFields` | `string[]` | Default summary: an `EditableSummary` of these fields |
| `summary` | `(rec) => ReactNode` | Replaces the default summary |
| `tabs` | `{ key, label, count?, content: (rec) => ReactNode }[]` | Shown before the built-in tabs |
| `defaultTabs` | `('activity' \| 'attachments' \| 'links' \| 'history')[]` | Built-in tabs to include; default all four, in this order: "Activity", "Attachments", "Related", "History". Every record must keep its history visible |
| `breadcrumbs` | `{ label, to? }[]` | Default: plural (link to the list) / reference or title |

`rec` is a `RecordContext`: `{ row, resource, reload, save(patch), canEdit }`.

The **Attachments** tab shows the attachments module's `AttachmentsPanel`
(`web/src/modules/attachments/AttachmentsPanel.tsx`, props `recordType`, `recordId`,
`evidence?`) for the record, with the number of files on the tab (from
`GET /api/attachments?record_type=&record_id=`, refreshed when the user changes tab and as
soon as a panel for that record adds or removes a file: the panel takes an optional `onChange`
and also fires a `grc:attachments-changed` event on `window` with `{ recordType, recordId }`, so a
module tab that shows its own count can listen too). The
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
| `option` | `ChartOption` (ECharts option) | **Memoize it** (`useMemo`): a new object redraws the chart |
| `label` | `string` | Required name of the chart for screen readers |
| `height` | `number` | Pixels, default 280. Width follows the container and resizes |
| `onSegmentClick` | `(seg: { name, value, seriesName?, dataIndex, data }) => void` | Click on a bar, slice, point, cell or node |
| `loading` | `boolean` | Shows the chart skeleton (use while your data loads: `loading={!data}`) |
| `emptyMessage` | `string` | Text of the empty state. Default "No data to show yet" |
| `empty` | `boolean` | Forces the empty state on or off. Default: worked out from the option (every series has no data, or a pie is all zeros) |
| `description` | `string` | A longer description read out after the label (what the chart shows, the main finding) |

- The chart follows the light/dark theme: fonts, text, axes, grid, tooltip and the eight-color
  series palette come from the design tokens and the Mantine theme. Do not set those colors
  yourself. The series palette is used in its fixed order and has been checked for color-vision
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
- For status/priority colors use `chartColor('red')` (any color name from section 11), or
  `statsToData(groups)` which turns a stats response into `{ name, value, key, itemStyle }[]`
  using each group's configured color. Any `var(--token)` string inside the option is resolved
  for the current theme.
- The ECharts code loads on first use (a skeleton shows meanwhile). The default plot margins
  are `grid: { top: 24, right: 16, bottom: 32, left: 48 }`; pass your own `grid` to change them
  (e.g. more `left` for long category names on a horizontal bar chart).
- Mark defaults: bars at most 24px thick with rounded top corners (for horizontal bars set
  `itemStyle: { borderRadius: [0, 4, 4, 0] }` on the series), 2px lines with 8px round
  markers, and a 2px gap in the surface color between pie slices and heatmap cells.
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
| `paused` | `boolean` | Shows "Paused" (gray) |
| `label` | `string` | Text before the time |

Green "2d 4h left", amber when close, red "Overdue by 3h 12m". It ticks by itself.

`Stepper` is an ordered list of stages (not Mantine's `Stepper`, which has no blocked state or
per-step override): done steps show a check mark, the current one the brand color with a halo, a
blocked one a cross in red. It scrolls sideways inside its own box when the stages do not fit,
wherever it is placed (it is its own positioned, shrinkable box: no wrapper or `position` rule
is needed around it).

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
| `Badge` | `color?`, `children` | Plain colored chip |
| `StatusChip` | `color?`, `label` | Chip with a dot; use for status and priority |
| `LookupChip` | `list`, `value` | Label and color from the lookup list |
| `Card` | `title?`, `actions?`, `flush?`, `className?`, `children` | `flush` removes body padding; a `table-wrap` directly inside a flush card loses its own border |
| `TableWrap` | `label` (required: the region name, usually the caption), `className?`, `ref?`, plus `<div>` attributes | The bordered scroll box around a data table (`.table-wrap`). While the table is wider or taller than the box, the box is a named region in the tab order so the keyboard can scroll it (WCAG 2.1.1). Every `<table>` goes in one; `tableWrap.test.ts` fails on a hand-written `table-wrap` box or Mantine `Table.ScrollContainer` |
| `Stat` | `label`, `value`, `trend?: { direction: 'up' \| 'down' \| 'flat', label, tone?: 'good' \| 'bad' \| 'neutral' }`, `color?`, `to?`, `icon?`, `hint?` | Number tile; `to` makes it a drill-down link, `icon` sits beside the label, `hint` is a short line under the value. Lay several out with `<div className="grid-stats">` |
| `Tabs` | `tabs: { key, label, count?, content? }[]`, `active?`, `onChange?`, `label?` | Mantine `Tabs`: arrow keys, Home and End move between tabs. Uncontrolled unless `active` is passed; only the active panel is mounted. Tabs that do not fit the width go into a **More** menu after the tab list (outside the `tablist`); the active tab always stays in the strip, and a tab chosen from More gets the focus. The strip never scrolls sideways |
| `Modal` (alias `Dialog`) | `open`, `title`, `onClose`, `footer?`, `size?: 'sm' \| 'md' \| 'lg'`, `dirty?`, `discardPrompt?`, `children` | Mantine `Modal`: focus trap, Esc and backdrop close, focus returns to the opener. With `dirty` (or a `ResourceForm` inside that has changes) closing asks "Discard this draft?" first. Focus starts in the first form control. With several open, Esc closes only the top one, and never while a dropdown inside it is open. `footer` stays visible while the body scrolls |
| `Drawer` | as `Modal`, plus `side?: 'left' \| 'right'` | Side panel (Mantine `Drawer`), same behavior |
| `ConfirmDialog` | `open`, `title`, `message`, `confirmLabel?`, `danger?`, `busy?`, `onConfirm`, `onCancel` | Focus starts on Cancel when `danger`, otherwise on the confirm button |
| `Menu` | `label`, `items: { label, icon?, onSelect?, to?, danger?, disabled?, separated?, group? }[]`, `icon?`, `iconOnly?`, `variant?`, `size?`, `align?: 'start' \| 'end'` | Button with a dropdown menu (Mantine `Menu`): arrow keys, Esc, type-ahead. Items with `to` are real links; `group` draws a heading above the first item of each group. In a `PageHeader`, an icon-only "⋯" menu (or one labeled "More" or "More actions") is always drawn last |
| `useToast()` | returns `{ success(msg), error(msg), info(msg) }` | Mantine notifications at the bottom right; errors stay 9 seconds, others 5. Works anywhere inside the app, e.g. `toast.error(errorMessage(err))` |
| `EmptyState` | `title`, `message?`, `icon?`, `action?` | Icon in a soft circle, title, message, then the action (usually a `Button`) |
| `Loading` | `lines?` (4), `label?` | Skeleton lines (Mantine `Skeleton`); `label` is announced to screen readers |
| `ErrorState` | `title?`, `error?`, `onRetry?` | Shows the error's message and a Try again button |
| `PageHeader` | `title`, `reference?`, `subtitle?`, `status?`, `actions?`, `breadcrumbs?: { label, to? }[]`, `primaryFirst?` | Renders the page `<h1>` and sets the tab title. One per page (`ResourceList` with `title` and `RecordPage` already render it). Header buttons keep one order: with `primaryFirst` (record pages) a core `Button variant="primary"` comes first; the overflow `Menu` always comes last; a list on the page puts its New button just before that menu. They move through portals, so the order on screen is the Tab order |
| `Notice` | `tone?: 'info' \| 'success' \| 'warning' \| 'error' \| 'neutral'`, `title?`, `icon?`, `onClose?` | A message box (Mantine `Alert`). Only `error` uses `role="alert"` (announced at once); the others use `role="status"`. Use it rather than a bare Mantine `Alert`, whose default role is `alert` |
| `DefinitionList` | `items: { label, value, wide? }[]` | Label/value grid |
| `KeyValue` (alias `FactSheet`) | `items: { label, value, icon?, hint?, wide? }[]`, `layout?: 'rows' \| 'columns'`, `compact?`, `title?` | A fact sheet. `rows` (default) puts one fact per line with the label at the left and a rule between lines, for cards and side panels; `columns` is a responsive grid with the label above. Empty values show a dash |
| `Timeline` | `items: { key, title, time?, timeText?, meta?, icon?, color?, body? }[]`, `label?`, `compact?`, `empty?` | Events down a line, each with a colored marker (an icon, or a dot). `time` shows as relative time with the exact time on hover. Pass the items already sorted. For a record's comments and changes use `ActivityPanel` instead |
| `AgendaList` | `items: { key, date, title, to?, reference?, timeText?, meta?, color? }[]`, `label?`, `empty?`, `limit?`, `moreTo?` | Dated items grouped under a heading per day, each with a colored bar: upcoming changes, renewals, exercises. Sort by date first; `limit` cuts the list and adds "and N more" |
| `RouteLoading` | `bare?` | The loading state the shell shows while a page's code is fetched; use it as the `Suspense` fallback for a lazy page of your own |
| `NotFound`, `Forbidden` | none | Full-page states with their own heading and links to the overview and Help |
| `ChangePasswordDialog` | `open`, `onClose` | Password boxes have a show/hide button and a length meter |
| `useTheme()` | returns `{ theme: 'light' \| 'dark', toggle }` | Also `setTheme(theme)` and `cssVar('--text')`. Mantine's color scheme follows it |
| `ExportMenu` | `resource`, `query`, `columns`, `filtered` | The Export menu of a list (Excel, CSV, PDF); see [ResourceList](#3-resourcelist) |
| `RecordPdfButton` | `resource`, `id`, `label?` | Downloads one record's PDF fact sheet; renders nothing without `<module>.export` |
| `useScrollFocus<T>()` | returns a ref callback | Makes a box with `overflow: auto` a Tab stop only while its content overflows, so a keyboard user can scroll it (WCAG 2.1.1): `const ref = useScrollFocus<HTMLDivElement>(); <div ref={ref}>` |
| `BreakGlassBanner` | none | Not exported: the shell (`Shell.tsx`) places it with its other notices above the page. It shows a warning for the whole session when someone signs in with the break-glass account, and nothing otherwise |
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
| `LookupSelect` | `string` | `list` (lookup list name). Shows each value's color dot |
| `MultiSelect` | `string[]` | `label`, `options`, `disabled?`, `size?` (compact button with a dropdown of checkboxes, for toolbars; no `error`/`hint`) |
| `Checkbox`, `Switch` | `checked: boolean`, `onChange(checked)` | `label`, `hint?`, `error?`, `disabled?`. `Switch` is the same contract drawn as an on/off switch, for settings that apply at once |
| `DateField` | `'YYYY-MM-DD'` or `''` | `min?`, `max?`, `placeholder?`. Calendar, or type `Nov 18, 2026`, `11/18/2026` (month first), `2026-11-18` or `18 Nov 2026` |
| `DateTimeField` | ISO instant or `''` | `placeholder?`. Edited as wall-clock time in the organization's time zone (named in the hint); the browser's own zone plays no part |
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
colors.

Lay hand-built forms out with `<form className="form">`, `<div className="form-grid">` (two
columns, one on narrow screens; `form-cell-wide` spans both) and `<div className="form-actions">`.

## 10. Formatting

All in the organization's time zone (`timeZone()`, set by the server's `GRC_TIMEZONE`), and in US English whatever the browser's language (numbers and money too); empty values give "—".

| Function | Example |
|---|---|
| `formatDate(v)` | `Nov 18, 2026` (date-only values are never shifted by time zone) |
| `formatDateTime(v)` | `Nov 18, 2026, 14:05` |
| `relativeTime(v)` | `3 hours ago`, `in 2 days` |
| `formatDuration(ms)` | `2d 4h`, `3h 12m`, `45m` |
| `formatCurrency(v)` | `$1,234.50` |
| `formatNumber(v)` | `1,234.5` |
| `escapeHtml(v)` | `&lt;b&gt;`: for the few HTML strings built by hand (chart tooltip formatters) |
| `humanize('review_date')` | `Review date` |

## 11. Color names, icon names, CSS helpers

### Theme and tokens

Three files decide how everything looks:

| File | Holds |
|---|---|
| `tokens.css` | The design tokens (CSS variables) for the light theme and, under `:root[data-theme="dark"]`, the dark theme. The single source of color |
| `mantine.tsx` | The Mantine theme: brand and neutral color scales, type, radius, spacing, shadows and component defaults (sizes, radius, focus ring), set once. Its CSS-variable resolver points Mantine's own variables (`--mantine-color-body`, `-text`, `-default-border`, `-dimmed`, `-anchor`, `-error`, the primary color and the light variants of the eight named colors) at the tokens, so a Mantine component and hand-written CSS cannot disagree in either theme |
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

Every interactive element shows a 2px `--focus` ring for keyboard users (links, buttons and
anything focusable get it from `base.css` even where a component removed its outline; set
`outline-offset: -2px` on an element whose ring should sit inside its box); inputs add a soft
glow. Animations and transitions are switched off under `prefers-reduced-motion`.

**Checking contrast.** `node tools/contrast.mjs` reads `tokens.css` and works out the WCAG 2.1
contrast ratio of every token pair in both themes (text on each surface, chip text on chip
background, navigation text, and 3:1 for borders, focus rings, solid colors and chart series).
It lists the pairs under AA and exits 1 if there are any (`--fails` shows only those, `--json`
for a machine). Run it after changing a color; at the time of writing every pair passes.

### Re-branding

1. In `tokens.css` change the `--brand*` and `--accent` values in both themes (and the `--nav-*`
   values if the sidebar should change). Check contrast: `--brand-contrast` on `--brand` and
   `--link` on `--surface` need 4.5:1.
2. In `mantine.tsx` change the ten-step `brand` scale to match (index 7 is the light theme's
   `--brand`), and `STANDARD_SCALE` in `branding.ts`. An organization's brand color
   (Administration > Organization) replaces the scale at run time with one made from it
   (`brandScale`).
3. Replace the mark in `Logo.tsx` and the same drawing in `web/public/favicon.svg`. The
   application's name comes from the organization profile (`appName`), not from code.

### Colors

`ColorName`, `COLOR_NAMES`: the one scale for every status and priority chip; lookup values
carry one of these in `color`:

`gray`, `blue`, `teal`, `green`, `amber`, `orange`, `red`, `purple`

Tokens per color: `--c-<name>-bg`, `--c-<name>-fg` (chip background and text) and
`--c-<name>-solid` (bars, charts, accents). All eight are also Mantine colors, so a Mantine
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
| `stack`, `row` | Vertical flow with gaps; horizontal, wrapping, centered |
| `grid-stats`, `grid-2` | Responsive tiles for `Stat`; two columns, one when narrow |
| `muted`, `num`, `ref`, `truncate`, `prose`, `sr-only` | Muted text; right-aligned tabular numbers; record reference; one-line ellipsis; keeps line breaks; screen-reader only |
| `table` inside `<TableWrap label="...">` | Data table with a scrolling, bordered wrapper (the `table-wrap` class; always through `TableWrap`) |
| `chip chip-<color>` | The chip that `Badge` and `StatusChip` render |
| `card`, `card-head`, `card-title`, `card-body` | The markup `Card` renders, for hand-built cards |
| `btn` with `btn-primary`, `btn-secondary`, `btn-ghost` or `btn-danger` (and `btn-sm`) | Button look for links and other non-button elements |
| `notice` (and `notice-warn`, `notice-pilot`, `notice-success`) | A short message box inside a page: blue information by default, or red, amber, green |
| `form`, `form-grid`, `form-cell-wide`, `form-actions`, `field`, `field-label`, `field-hint`, `field-error`, `form-error`, `input` | Hand-built forms and plain inputs that match the Mantine controls |
| `kbd` | A keyboard key: `<kbd className="kbd">Ctrl K</kbd>` |
| `no-print`, `print-only` | Left off paper; shown on paper only |
| `ui-timeline`, `facts` (`facts-rows`, `facts-columns`), `agenda` | The markup `Timeline`, `KeyValue` and `AgendaList` render |
| `route-loading` | Present while a page's code is loading (useful to wait on in browser scripts) |
| `auth-page`, `auth-card`, `auth-brand`, `auth-title` | Centered card for pages outside the shell |

## 12. Custom fields, tags, watching, preferences, labels

All of these work without changes to a module that uses the generic pieces.

**Custom fields.** `/api/meta` lists an administrator's own fields as `cf_<key>` with `custom: true`
(and `multiple`, `help`, `section`, `position`; a multiple choice is `type: 'lookup'` with
`multiple: true`, its value an array). `customFieldNames(resource)` gives them in order.

- `ResourceForm` adds them after `fields`, each under its own `section` heading (default "More
  details"), with `help` as the hint; `customFields={false}` turns that off for a short dialog.
  Multiple choice uses `ChoicesField` / `LookupChoices` (form controls with a label).
- `ResourceList` offers them as columns (hidden until the person turns them on in the column
  chooser) and in **Filters** when their type is filterable; `extras={false}` turns that off.
- `RecordPage` with `summaryFields` shows them in the default summary; with your own `summary`,
  a **More details** card (`CustomFieldsCard`) follows it. `EditableSummary` shows them only with
  `customFields`, so a page with several summary cards does not repeat them.
- `FieldValue` and the History panel show multiple-choice values as chips / a list.
- A hand-written record page places `<CustomFieldsCard type row onSaved />` (RecordPage with
  `summary` already does).
- A hand-written form that keeps its own state uses `useCustomFieldInputs(type, { initial? })`:
  render `custom.inputs` (the controls, grouped by section, with each field's help), spread
  `custom.collect()` into the request body (it returns null and shows the messages when a
  required field is empty; with `initial` it returns only what changed), and pass a failed
  request's `err.fields` to `custom.showErrors`. `FieldControl` (one control for one field from
  its metadata, as `ResourceForm` draws it) and `toFormValue` / `toApiValue` are exported too.
  Without this, a required custom field makes such a form fail on the server.

**Tags.** Rows carry `_tags`. Administrators rename and merge tags on the **Tags** tab of
Administration > Lists (`POST /api/admin/tags/rename`). `ResourceList` adds a **Tags** column (hidden until chosen) and a
**Tags** filter (`f.tags=a,b`: any of them; the pseudo-field `TAGS_FILTER`). `RecordPage` shows
`<RecordTags>` under the header (`tags={false}` to leave it out). Also exported: `TagChips`,
`TagsFilter`.

**Watching.** `RecordPage` adds `<WatchButton>` after the module's header buttons
(`watch={false}` to leave it out). The Overview has a **Watching** list (`/api/me/watching`).

**Preferences.** `usePref(key, fallback)` keeps `grc.u.<user id>.<name>` keys on the server as
`list.<name>` (`/api/me/preferences/:key`) with a localStorage copy that draws the first render;
saved views use `useSavedViews(type)` (server key `views:<type>`). For anything else use
`useSyncedPreference(serverKey, localKey, fallback)`, or `loadPreferences` / `savePreference`.
Without the server's preferences service everything falls back to localStorage.

**Labels.** `useLabels(targets, resources)` looks names up in batches (`GET /api/users/labels`,
`POST /api/records/labels`), falling back to one request per record on an older server. People
no longer active are named "(no longer active)". History entries made through an API token say so.

**Component props that follow Mantine's names** (all optional, all additive): `StatusChip`
`size` (`sm`|`md`), `variant` (`light`|`filled`|`outline`), `withDot`, `title`, `className`;
`Card` `padding` (`none`|`sm`|`md`|`lg`), `withBorder`, `id`; `Stat` `size`, `className`;
`Stepper` `active` (index, as Mantine), `orientation` (`vertical`), `size` (`sm`), `className`;
`ProgressBar` `size` (`xs`|`sm`|`md`|`lg`), `striped`, `animated`, `className`. `MultiSelect`
(the toolbar control) takes `error`. `api.put` exists for whole-value writes.

**Sticky form buttons.** `.rc-form-actions` sticks to the bottom of the window inside the page
(it cancels `.content`'s bottom padding through `--content-pad-bottom`); modules need no
workaround. Dialogs no longer start with focus in a date field (its calendar would open over the
dialog): focus starts on the dialog body instead.
