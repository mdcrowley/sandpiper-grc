// Generic list for any registered record type: server-side search, sort, filter and paging kept
// in the page address, saved views, column chooser, density, export (CSV, Excel, PDF), import from
// a CSV or Excel file, row selection with bulk edit, and an optional New dialog.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ActionIcon, Alert, Button, CloseButton, Menu, Pagination, Select as MSelect, Text, TextInput, Tooltip } from '@mantine/core';
import {
  IconBaselineDensityMedium, IconBaselineDensitySmall, IconBookmark, IconCheck, IconChevronDown, IconCloudUpload, IconUpload,
  IconPlus, IconSearch, IconShare, IconTrash, IconUsers,
} from '@tabler/icons-react';
import { api, ApiError, errorMessage, listQuery, type ListResult, type Row } from './api';
import { useAuth } from './auth';
import { Checkbox, TextField } from './fields';
import { fieldMeta, knownFields } from './FieldValue';
import { knownFilters } from './fieldNames';
import { formatNumber } from './format';
import { useDebounced, useFetch } from './hooks';
import { knownLabel, rememberLabel } from './labels';
import { BULK_TYPES, BulkBar, BulkEditDialog, downloadRowsCsv } from './ListBulk';
import { ExportMenu } from './ListExport';
import { FILTERABLE, FilterButton, FilterPills, TAGS_FILTER } from './ListFilters';
import { EMPTY_VIEW, sameView, useListState, usePref, useSavedViews, type SavedView, type View } from './listState';
import { useBrowserOnlyViews, useSharedViews, type SharedView } from './sharedViews';
import { ColumnChooser, ListTable, TableSkeleton, type ListColumn } from './ListTable';
import { customFieldNames, recordHref, useResource } from './meta';
import { TagChips } from './tags';
import { ConfirmDialog, Modal, useToast } from './overlay';
import { ResourceForm } from './ResourceForm';
import { EmptyState, ErrorState, PageHeader } from './ui';
import './records.css';

// The import wizard's code loads the first time someone opens it.
const ImportWizard = lazy(() => import('./ImportWizard').then((m) => ({ default: m.ImportWizard })));

export type ColumnDef =
  | string
  | {
      /** Field name. With `render`, any unique key will do. */
      field: string;
      label?: string;
      /** Custom cell. Without it the cell is rendered by field type. */
      render?: (row: Row) => ReactNode;
      /** Defaults to true for real fields, false for render-only columns. */
      sortable?: boolean;
      /** Defaults to right for number and currency fields. */
      align?: 'left' | 'right';
      /** Start hidden; the user can turn the column on in the column chooser. */
      hidden?: boolean;
    };

export interface ResourceListProps {
  /** Record type key, e.g. "ticket". */
  type: string;
  columns: ColumnDef[];
  /** Fields offered in the Filters popover (lookup, boolean, user, ref, date and datetime fields). */
  filters?: string[];
  /** Filters always applied and not shown, keyed like the list contract without the `f.` prefix. */
  baseFilter?: Record<string, string>;
  /** Renders a page header with this title. Leave out when embedding the list in a tab or card. */
  title?: string;
  /** Extra buttons beside New. */
  actions?: ReactNode;
  /** Default: go to `${route}/${id}`. */
  onRowClick?: (row: Row) => void;
  /** Shows a New button that opens a ResourceForm with these fields (needs `<module>.create`). */
  createFields?: string[];
  /** Hidden values for new records, e.g. `{ project_id: id }`. */
  createInitial?: Record<string, unknown>;
  /** Default: go to the new record's page. */
  onCreated?: (row: Row) => void;
  /** Rows per page to start with (default 25); the user's own choice is remembered. */
  pageSize?: number;
  /**
   * Fields that can be changed for many rows at once (lookup, user, ref, boolean, date).
   * Default: the lookup and user fields among `columns` and `filters`. `[]` turns row selection off.
   */
  bulkFields?: string[];
  /**
   * Keep search, filters, sort and page in the page address. Default: on when the list is the
   * page (`title` is given, or the page address is the record type's own route), off for lists
   * embedded elsewhere (a tab of a record, a card), which only read the address once.
   */
  urlState?: boolean;
  /** Sort used until the user picks one, e.g. `{ field: 'due_at', dir: 'asc' }`. Default: the server's. */
  defaultSort?: { field: string; dir?: 'asc' | 'desc' };
  /**
   * Offer the record type's custom fields (as columns, hidden until chosen, and filters) and its
   * tags (a Tags column and filter). Default true.
   */
  extras?: boolean;
  /**
   * Extra buttons in the bulk bar while rows are selected (wave 13: print the tags of the selected
   * records). Given the selected rows and a function that clears the selection.
   */
  bulkActions?: (rows: Row[], clear: () => void) => ReactNode;
}

const PAGE_SIZES = [10, 25, 50, 100];

export function ResourceList({
  type, columns: givenColumns, baseFilter, title, actions, onRowClick, createFields, createInitial, onCreated,
  pageSize: defaultPageSize = 25, bulkFields, urlState, defaultSort, extras = true, filters: givenFilters = [], bulkActions,
}: ResourceListProps) {
  const resource = useResource(type);
  const { can, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // The list owns the address when it is the page: it has the page title, or sits at its type's own route.
  const atHome = useLocation().pathname.replace(/\/$/, '') === resource?.route;
  const urlSync = urlState ?? (Boolean(title) || atHome);
  const { view: given, page, change, setPage } = useListState(urlSync);
  // A filter from the page address or a saved view on a field the type lacks (or one hidden by a
  // switched-off option) is ignored, and dropped from the address (E18-49).
  const view = useMemo(() => {
    const filters = knownFilters(resource, given.filters);
    return Object.keys(filters).length === Object.keys(given.filters).length ? given : { ...given, filters };
  }, [given, resource]);
  useEffect(() => {
    if (urlSync && view !== given) change({ filters: view.filters }, { replace: true });
  }, [urlSync, view, given, change]);

  const prefKey = `grc.u.${user?.id ?? 'anon'}`;
  const [hidden, setHidden] = usePref<string[] | null>(`${prefKey}.cols.${type}`, null);
  // Columns the list adds by itself (custom fields, tags) start hidden; this remembers which ones the person turned on.
  const [shownExtras, setShownExtras] = usePref<string[]>(`${prefKey}.cols.${type}.extras`, []);
  const custom = extras ? customFieldNames(resource) : [];
  const authored = givenColumns.map((c) => (typeof c === 'string' ? c : c.field));
  const extraColumns: ColumnDef[] = extras && resource
    ? [
      ...custom.filter((f) => !authored.includes(f)).map((f) => ({ field: f, hidden: true })),
      ...(authored.includes('_tags') ? [] : [{ field: '_tags', label: 'Tags', hidden: true, sortable: false, render: (row: Row) => <TagChips tags={row._tags as string[] | undefined} /> }]),
    ]
    : [];
  const extraKeys = extraColumns.map((c) => (typeof c === 'string' ? c : c.field));
  const columns = useMemo(() => [...givenColumns, ...extraColumns], [givenColumns, extraKeys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const named = resource ? givenFilters.filter((f) => f === TAGS_FILTER || knownFields(resource, [f]).length > 0) : givenFilters;
  const filters = extras && resource
    ? [...named, ...custom.filter((f) => !givenFilters.includes(f) && FILTERABLE.includes(resource.fields[f].type)), ...(givenFilters.includes(TAGS_FILTER) ? [] : [TAGS_FILTER])]
    : named;
  const [density, setDensity] = usePref<'comfortable' | 'compact'>(`${prefKey}.density`, 'comfortable');
  const [pageSize, setPageSize] = usePref<number>(`${prefKey}.pageSize.${type}`, defaultPageSize);

  const [views, setViews] = useSavedViews(type);
  // Views shared with everyone who can see this list, and views kept only in this browser (E01-24).
  const shared = useSharedViews(type, Boolean(resource));
  const browserOnly = useBrowserOnlyViews(type);
  const [keptLocal, setKeptLocal] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [shareNamed, setShareNamed] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const [unsharing, setUnsharing] = useState<SharedView | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Map<string, Row>>(() => new Map());
  const [bulkEditing, setBulkEditing] = useState(false);
  const bulkChanged = useRef(false);

  const canCreate = Boolean(createFields && resource && can(`${resource.module}.create`));
  const canEdit = Boolean(resource && can(`${resource.module}.edit`));
  const canExport = Boolean(resource && can(`${resource.module}.export`));
  // Import (core/ImportWizard): from the list that is the page, for people who may create or change the type.
  const isPage = Boolean(title) || atHome;
  const canImport = Boolean(resource && isPage && (can(`${resource.module}.create`) || can(`${resource.module}.edit`))
    && (!resource.restricted || resource.restricted === 'flag' || can('security.view')));

  // The global Create menu links here with ?new=1; ?import=1 opens the import wizard.
  const wantsNew = params.get('new') === '1';
  const wantsImport = params.get('import') === '1';
  useEffect(() => {
    if (!wantsNew && !wantsImport) return;
    if (wantsNew && canCreate) setCreating(true);
    if (wantsImport && canImport) setImporting(true);
    setParams((p) => {
      p.delete('new');
      p.delete('import');
      return p;
    }, { replace: true });
  }, [wantsNew, wantsImport, canCreate, canImport, setParams]);

  // Search box: typed text is local, the view follows after a pause; Back/Forward flow the other way.
  const [text, setText] = useState(view.q);
  const typed = useDebounced(text, 300);
  const viewQ = useRef(view.q);
  const written = useRef(view.q);
  useEffect(() => {
    viewQ.current = view.q;
    if (view.q !== written.current) {
      written.current = view.q;
      setText(view.q);
    }
  }, [view.q]);
  useEffect(() => {
    if (typed.trim() !== viewQ.current.trim()) {
      written.current = typed.trim();
      change({ q: typed.trim() }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const sort = view.sort || defaultSort?.field || '';
  const dir = view.sort ? view.dir : defaultSort?.dir ?? 'asc';
  const query = useMemo(() => ({
    q: view.q.trim(),
    sort: sort || undefined,
    dir: sort ? dir : undefined,
    filters: { ...Object.fromEntries(Object.entries(view.filters).filter(([, v]) => v.length > 0)), ...baseFilter },
  }), [view.q, sort, dir, view.filters, baseFilter]);
  const queryKey = JSON.stringify(query);
  const url = resource ? `${resource.path}${listQuery({ ...query, page, pageSize })}` : null;
  const { data, loading, error, reload } = useFetch<ListResult>(url, { keepPrevious: true });

  // A different search or filter is a different set of rows: start the selection again.
  useEffect(() => setSelected(new Map()), [queryKey]);

  // If rows were removed and this page no longer exists, step back to the last one.
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (data && !loading && page > pages) setPage(pages);
  }, [data, loading, page, pages, setPage]);

  const cols = useMemo<ListColumn[]>(() => {
    if (!resource) return [];
    // A column with its own rendering stays; a plain field the record type does not have is left out (E18-48).
    return columns.filter((c) => typeof c !== 'string' && c.render ? true : knownFields(resource, [typeof c === 'string' ? c : c.field]).length > 0).map((c) => {
      const def = typeof c === 'string' ? { field: c } : c;
      const meta = fieldMeta(resource, def.field);
      const known = def.field in resource.fields || ['created_at', 'updated_at'].includes(def.field);
      const numeric = !def.render && ['number', 'currency'].includes(meta.type);
      return {
        field: def.field,
        label: def.label ?? meta.label,
        render: def.render,
        sortable: def.sortable ?? (known && !['json', 'longtext'].includes(meta.type)),
        align: def.align ?? (numeric ? 'right' : 'left'),
        known,
        startHidden: Boolean(def.hidden),
      };
    });
  }, [columns, resource]);

  if (!resource) return <ErrorState title={`Unknown record type "${type}"`} />;

  const noun = (n: number) => (n === 1 ? resource.label : resource.plural).toLowerCase();
  const plural = resource.plural.toLowerCase();

  const extraSet = new Set(extraKeys);
  const hiddenNow = [
    ...(hidden ?? cols.filter((c) => c.startHidden && !extraSet.has(c.field)).map((c) => c.field)).filter((f) => !extraSet.has(f)),
    ...extraKeys.filter((f) => !shownExtras.includes(f)),
  ];
  const chooseHidden = (next: string[]) => {
    setHidden(next.filter((f) => !extraSet.has(f)));
    setShownExtras(extraKeys.filter((f) => !next.includes(f)));
  };
  const shownCols = cols.filter((c) => !hiddenNow.includes(c.field));
  const visible = shownCols.length > 0 ? shownCols : cols.slice(0, 1);

  const bulkList = (bulkFields ?? [...cols.map((c) => c.field), ...filters].filter((f) => ['lookup', 'user'].includes(fieldMeta(resource, f).type)))
    .filter((f, i, all) => all.indexOf(f) === i && f in resource.fields && !resource.fields[f].readOnly && BULK_TYPES.includes(resource.fields[f].type));
  const selectable = canEdit && bulkList.length > 0;

  const setFilter = (key: string, values: string[], label?: string) => {
    if (key === '__q') {
      setText('');
      written.current = '';
      change({ q: '' });
      return;
    }
    const meta = fieldMeta(resource, key);
    if (label && values[0]) rememberLabel(meta.type === 'user' ? 'user' : meta.to ?? '', values[0], label);
    const next = { ...view.filters };
    if (values.length > 0) next[key] = values; else delete next[key];
    change({ filters: next });
  };
  const applyView = (next: View) => {
    for (const [key, label] of Object.entries(next.labels ?? {})) {
      const meta = fieldMeta(resource, key);
      rememberLabel(meta.type === 'user' ? 'user' : meta.to ?? '', next.filters[key]?.[0], label);
    }
    written.current = next.q;
    setText(next.q);
    change({ q: next.q, sort: next.sort, dir: next.dir, filters: next.filters });
  };
  const clearAll = () => applyView({ ...EMPTY_VIEW, sort: view.sort, dir: view.dir });
  const toggleSort = (field: string) => {
    if (view.sort !== field) change({ sort: field, dir: 'asc' });
    else if (view.dir === 'asc') change({ dir: 'desc' });
    else change({ sort: '', dir: 'asc' });
  };

  const open = (row: Row) => (onRowClick ? onRowClick(row) : navigate(recordHref(resource.route, row.id)));
  const fileName = `${plural.replace(/\s+/g, '-')}.csv`;

  const exportSelected = () => {
    const fields = visible.filter((c) => c.known).map((c) => c.field);
    downloadRowsCsv(resource, fields.length > 0 ? fields : [resource.titleField], [...selected.values()], fileName.replace('.csv', '-selected.csv'));
    toast.success(`${selected.size} ${noun(selected.size)} exported.`);
  };

  /* Saved views */
  const activeView = views.find((v) => sameView(v.view, view));
  const isAll = sameView(view, EMPTY_VIEW);
  const filtered = Boolean(view.q) || Object.values(view.filters).some((v) => v.length > 0);
  const activeShared = activeView ? undefined : shared.views.find((v) => sameView(v.view, view));
  const labelsNow = () => {
    const labels: Record<string, string> = {};
    for (const [key, values] of Object.entries(view.filters)) {
      const meta = fieldMeta(resource, key);
      const label = values[0] && knownLabel(meta.type === 'user' ? 'user' : meta.to ?? '', values[0]);
      if (label) labels[key] = label;
    }
    return labels;
  };
  const shareView = async (name: string, toShare: View): Promise<boolean> => {
    const same = shared.views.find((v) => v.name.toLowerCase() === name.toLowerCase());
    const body = { q: toShare.q, sort: toShare.sort, dir: toShare.dir, filters: toShare.filters };
    try {
      if (same?.canManage) await api.patch(`/api/views/${same.id}`, { name, view: body });
      else await api.post('/api/views', { record_type: type, name, view: body });
      shared.reload();
      toast.success(`View "${name}" shared with everyone who can see ${plural}.`);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError && err.code === 'duplicate' ? `Someone else has shared a view called "${name}". Choose another name.` : errorMessage(err));
      return false;
    }
  };
  const saveView = async (name: string) => {
    if (shareNamed) {
      setSavingView(true);
      const ok = await shareView(name, view);
      setSavingView(false);
      if (!ok) return;
      // A shared view replaces a personal one of the same name.
      if (views.some((v) => v.name === name)) setViews(views.filter((v) => v.name !== name));
      setNaming(null);
      return;
    }
    const next = [...views.filter((v) => v.name !== name), { name, view: { ...view, labels: labelsNow() } }].sort((x, y) => x.name.localeCompare(y.name));
    setViews(next);
    setNaming(null);
    toast.success(`View "${name}" saved. It follows you to any browser you sign in from.`);
  };
  const deleteView = (target: SavedView) => {
    const next = views.filter((v) => v !== target);
    setViews(next);
    toast.info(`View "${target.name}" deleted.`);
  };
  const shareSaved = async (target: SavedView) => {
    if (await shareView(target.name, target.view)) setViews(views.filter((v) => v !== target));
  };
  const unshare = async (target: SharedView) => {
    try {
      await api.del(`/api/views/${target.id}`);
      shared.reload();
      toast.info(`View "${target.name}" is no longer shared.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUnsharing(null);
    }
  };
  const keepBrowserViews = () => {
    setViews(views);
    setKeptLocal(true);
    toast.success(`${views.length} ${views.length === 1 ? 'view' : 'views'} kept in your account.`);
  };
  const viewName = activeView ? activeView.name : activeShared ? activeShared.name : isAll ? `All ${plural}` : 'Unsaved view';

  const nameHint = (name: string) => {
    if (shareNamed) {
      const same = shared.views.find((v) => v.name.toLowerCase() === name.toLowerCase());
      if (same) return same.canManage ? 'A shared view with this name exists and will be replaced.' : 'Someone else has shared a view with this name. Choose another.';
      return 'Saves the current search, filters and sort order for everyone who can see this list.';
    }
    return views.some((v) => v.name === name)
      ? 'A view of yours with this name exists and will be replaced.'
      : 'Saves the current search, filters and sort order in your account, so it follows you to any browser.';
  };

  const newButton = canCreate && (
    <Button leftSection={<IconPlus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>
      New {resource.label.toLowerCase()}
    </Button>
  );
  const headerActions = <>{actions}{newButton}</>;

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <div className={`rc-list${title ? ' rc-list-page' : ''}`}>
      {title && <PageHeader title={title} actions={headerActions} />}

      <div className="rc-toolbar" role="search" aria-label={`Search and filter ${plural}`}>
        <TextInput
          className="rc-search"
          type="search"
          aria-label={`Search ${plural}`}
          placeholder={`Search ${plural}`}
          value={text}
          leftSection={<IconSearch size={16} aria-hidden="true" />}
          rightSection={text ? <CloseButton size="sm" aria-label="Clear search" onClick={() => setFilter('__q', [])} /> : undefined}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <FilterButton resource={resource} fields={filters} view={view} setFilter={setFilter} onClear={() => change({ filters: {} })} />

        <div className="rc-tools">
          <Menu position="bottom-end" shadow="md" width={300}>
            <Menu.Target>
              <Button variant="default" className="rc-view-button" leftSection={<IconBookmark size={16} aria-hidden="true" />} rightSection={<IconChevronDown size={14} aria-hidden="true" />}>
                <span className="rc-sr-only">View: </span>
                <span className="rc-view-name">{viewName}</span>
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={isAll ? <IconCheck size={16} /> : <span className="rc-menu-gap" />} onClick={() => applyView(EMPTY_VIEW)}>
                All {plural}
              </Menu.Item>
              {views.length > 0 && <Menu.Label>My views</Menu.Label>}
              {views.map((v) => (
                <Menu.Item key={v.name} leftSection={v === activeView ? <IconCheck size={16} /> : <span className="rc-menu-gap" />} onClick={() => applyView(v.view)}>
                  {v.name}
                </Menu.Item>
              ))}
              {shared.views.length > 0 && <Menu.Label>Shared with everyone</Menu.Label>}
              {shared.views.map((v) => (
                <Menu.Item
                  key={v.id}
                  leftSection={v === activeShared ? <IconCheck size={16} /> : <IconUsers size={16} aria-hidden="true" className="rc-menu-muted" />}
                  onClick={() => applyView(v.view)}
                >
                  <span className="rc-view-item">
                    <span>{v.name}</span>
                    {v.createdBy && <span className="rc-view-by">{v.mine ? 'Shared by you' : `Shared by ${v.createdBy.label}`}</span>}
                  </span>
                </Menu.Item>
              ))}
              <Menu.Divider />
              <Menu.Item
                leftSection={<IconBookmark size={16} />}
                disabled={isAll}
                onClick={() => { setShareNamed(Boolean(activeShared)); setNaming(activeView?.name ?? activeShared?.name ?? ''); }}
              >
                Save current view…
              </Menu.Item>
              {activeView && shared.available && (
                <Menu.Item leftSection={<IconShare size={16} />} onClick={() => void shareSaved(activeView)}>
                  Share “{activeView.name}” with everyone
                </Menu.Item>
              )}
              {activeView && (
                <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => deleteView(activeView)}>
                  Delete “{activeView.name}”
                </Menu.Item>
              )}
              {activeShared?.canManage && (
                <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => setUnsharing(activeShared)}>
                  Stop sharing “{activeShared.name}”
                </Menu.Item>
              )}
              {browserOnly.length > 0 && !keptLocal && (
                <>
                  <Menu.Divider />
                  <Menu.Item leftSection={<IconCloudUpload size={16} />} onClick={keepBrowserViews}>
                    <span className="rc-view-item">
                      <span>Keep {browserOnly.length === 1 ? 'this browser’s view' : `this browser’s ${browserOnly.length} views`} in your account</span>
                      <span className="rc-view-by">Saved here before views followed you between browsers</span>
                    </span>
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
          <ColumnChooser
            columns={cols}
            hidden={hiddenNow}
            onChange={chooseHidden}
            onReset={() => { setHidden(null); setShownExtras([]); }}
          />
          <Tooltip label={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}>
            <ActionIcon
              variant="default"
              size="lg"
              aria-label="Compact rows"
              aria-pressed={density === 'compact'}
              onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
            >
              {density === 'compact' ? <IconBaselineDensitySmall size={18} /> : <IconBaselineDensityMedium size={18} />}
            </ActionIcon>
          </Tooltip>
          {canExport && (
            <ExportMenu resource={resource} query={query} filtered={filtered}
              columns={visible.filter((c) => c.known || c.field in resource.fields).map((c) => c.field)} />
          )}
          {canImport && (
            <Tooltip label={`Import ${plural} from a CSV or Excel file`}>
              <Button variant="default" className="rc-icon-label" leftSection={<IconUpload size={16} aria-hidden="true" />} onClick={() => setImporting(true)}>
                <span className="rc-btn-label">Import</span>
                <span className="rc-sr-only"> {plural}</span>
              </Button>
            </Tooltip>
          )}
          {!title && headerActions}
        </div>
      </div>

      <FilterPills resource={resource} view={view} setFilter={setFilter} onClear={clearAll} />

      {selectable && selected.size > 0 && (
        <BulkBar
          count={selected.size}
          noun={noun(selected.size)}
          canEdit={canEdit}
          canExport={canExport}
          onEdit={() => setBulkEditing(true)}
          onExport={exportSelected}
          extra={bulkActions?.([...selected.values()], () => setSelected(new Map()))}
          onClear={() => setSelected(new Map())}
        />
      )}

      {error && !data ? (
        <div className="rc-panel"><ErrorState title={`${resource.plural} could not be loaded`} error={error} onRetry={reload} /></div>
      ) : !data ? (
        <TableSkeleton columns={visible} density={density} label={`Loading ${plural}`} selectable={selectable} />
      ) : data.rows.length === 0 ? (
        <div className="rc-panel" aria-busy={loading}>
          {filtered ? (
            <EmptyState icon="filter" title={`No ${plural} match`} message="Try a different search, or remove a filter."
              action={<Button variant="default" onClick={clearAll}>Clear search and filters</Button>} />
          ) : (
            <EmptyState title={`No ${plural} yet`}
              message={canCreate ? `Create the first ${resource.label.toLowerCase()} to get started.` : `When ${plural} are added they will be listed here.`}
              action={newButton || undefined} />
          )}
        </div>
      ) : (
        <>
          {error !== undefined && error !== null && (
            <Alert color="red" variant="light" role="alert" mb="xs">{errorMessage(error)} Showing the last loaded results.</Alert>
          )}
          <ListTable
            resource={resource}
            caption={title ?? resource.plural}
            columns={visible}
            rows={data.rows}
            busy={loading}
            density={density}
            sort={view.sort}
            dir={view.dir}
            onSort={toggleSort}
            onOpen={open}
            linkTitles={!onRowClick}
            selectable={selectable}
            selected={selected}
            onSelect={setSelected}
          />
          <div className="rc-foot">
            <Text size="sm" c="dimmed" role="status">
              {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)} {noun(total)}
            </Text>
            <div className="rc-foot-right">
              <MSelect
                className="rc-page-size"
                size="xs"
                aria-label="Rows per page"
                data={[...new Set([...PAGE_SIZES, pageSize])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: `${n} per page` }))}
                value={String(pageSize)}
                allowDeselect={false}
                onChange={(v) => { if (v) { setPageSize(Number(v)); setPage(1); } }}
              />
              {pages > 1 && (
                <Pagination
                  size="sm"
                  total={pages}
                  value={Math.min(page, pages)}
                  onChange={setPage}
                  siblings={1}
                  boundaries={1}
                  getControlProps={(control) => ({ 'aria-label': `${control.charAt(0).toUpperCase()}${control.slice(1)} page` })}
                  getItemProps={(n) => ({ 'aria-label': `Page ${n}` })}
                />
              )}
            </div>
          </div>
        </>
      )}

      {/* The form inside tells the dialog about unsaved changes, so closing it asks first (core/unsaved.tsx). */}
      <Modal
        open={creating} title={`New ${resource.label.toLowerCase()}`} size="lg" onClose={() => setCreating(false)}
        discardPrompt={{ message: `The new ${resource.label.toLowerCase()} has not been saved. Closing now loses what you have entered.` }}
      >
        <ResourceForm
          type={type}
          fields={knownFields(resource, createFields ?? [])}
          initial={createInitial}
          onCancel={() => setCreating(false)}
          onSaved={(row) => {
            setCreating(false);
            toast.success(`${resource.label} created.`);
            if (onCreated) {
              onCreated(row);
              reload();
            } else {
              navigate(recordHref(resource.route, row.id));
            }
          }}
        />
      </Modal>

      <ConfirmDialog
        open={unsharing !== null}
        title="Stop sharing this view?"
        message={`“${unsharing?.name ?? ''}” will no longer be offered to anyone. No records are changed.`}
        confirmLabel="Stop sharing"
        danger
        onConfirm={() => { if (unsharing) void unshare(unsharing); }}
        onCancel={() => setUnsharing(null)}
      />

      <BulkEditDialog
        open={bulkEditing}
        resource={resource}
        rows={[...selected.values()]}
        fields={bulkList}
        onClose={() => {
          setBulkEditing(false);
          if (bulkChanged.current) setSelected(new Map());
          bulkChanged.current = false;
        }}
        onDone={(changed) => {
          if (changed > 0) {
            bulkChanged.current = true;
            reload();
          }
        }}
      />

      {canImport && importing && (
        <Suspense fallback={null}>
          <ImportWizard resource={resource} open={importing} onClose={() => setImporting(false)} onImported={reload} />
        </Suspense>
      )}

      <Modal open={naming !== null} title="Save view" size="sm" onClose={() => setNaming(null)}>
        <form
          className="rc-form"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (naming?.trim()) void saveView(naming.trim());
          }}
        >
          <TextField label="View name" required autoFocus maxLength={60} value={naming ?? ''} onChange={setNaming}
            hint={nameHint(naming?.trim() ?? '')} />
          {shared.available && (
            <Checkbox
              label="Share with everyone who can see this list" checked={shareNamed} onChange={setShareNamed}
              hint="They get the same search, filters and sort, and see only the records they are allowed to see. Only you and administrators can change or remove it."
            />
          )}
          <div className="rc-form-actions">
            <Button variant="default" onClick={() => setNaming(null)}>Cancel</Button>
            <Button type="submit" loading={savingView} disabled={!naming?.trim()}>{shareNamed ? 'Share view' : 'Save view'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
