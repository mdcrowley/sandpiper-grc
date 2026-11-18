// Generic list for any registered record type: server-side search, sort, filter and paging kept
// in the page address, saved views, column chooser, density, CSV export, row selection with bulk
// edit, and an optional New dialog.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ActionIcon, Alert, Button, CloseButton, Menu, Pagination, Select as MSelect, Text, TextInput, Tooltip } from '@mantine/core';
import {
  IconBaselineDensityMedium, IconBaselineDensitySmall, IconBookmark, IconCheck, IconChevronDown, IconDownload,
  IconPlus, IconSearch, IconTrash,
} from '@tabler/icons-react';
import { api, errorMessage, listQuery, type ListResult, type Row } from './api';
import { useAuth } from './auth';
import { TextField } from './fields';
import { fieldMeta } from './FieldValue';
import { formatNumber } from './format';
import { useDebounced, useFetch } from './hooks';
import { knownLabel, rememberLabel } from './labels';
import { BULK_TYPES, BulkBar, BulkEditDialog, downloadRowsCsv } from './ListBulk';
import { FilterButton, FilterPills } from './ListFilters';
import { EMPTY_VIEW, loadViews, sameView, storeViews, useListState, usePref, type SavedView, type View } from './listState';
import { ColumnChooser, ListTable, TableSkeleton, type ListColumn } from './ListTable';
import { recordHref, useResource } from './meta';
import { ConfirmDialog, Modal, useToast } from './overlay';
import { ResourceForm } from './ResourceForm';
import { EmptyState, ErrorState, PageHeader } from './ui';
import './records.css';

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
}

const PAGE_SIZES = [10, 25, 50, 100];

export function ResourceList({
  type, columns, filters = [], baseFilter, title, actions, onRowClick, createFields, createInitial, onCreated,
  pageSize: defaultPageSize = 25, bulkFields, urlState, defaultSort,
}: ResourceListProps) {
  const resource = useResource(type);
  const { can, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // The list owns the address when it is the page: it has the page title, or sits at its type's own route.
  const atHome = useLocation().pathname.replace(/\/$/, '') === resource?.route;
  const { view, page, change, setPage } = useListState(urlState ?? (Boolean(title) || atHome));

  const prefKey = `grc.u.${user?.id ?? 'anon'}`;
  const [hidden, setHidden] = usePref<string[] | null>(`${prefKey}.cols.${type}`, null);
  const [density, setDensity] = usePref<'comfortable' | 'compact'>(`${prefKey}.density`, 'comfortable');
  const [pageSize, setPageSize] = usePref<number>(`${prefKey}.pageSize.${type}`, defaultPageSize);

  const [views, setViews] = useState<SavedView[]>(() => loadViews(type));
  const [naming, setNaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const formDirty = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Map<string, Row>>(() => new Map());
  const [bulkEditing, setBulkEditing] = useState(false);
  const bulkChanged = useRef(false);

  const canCreate = Boolean(createFields && resource && can(`${resource.module}.create`));
  const canEdit = Boolean(resource && can(`${resource.module}.edit`));
  const canExport = Boolean(resource && can(`${resource.module}.export`));

  // The global Create menu links here with ?new=1.
  const wantsNew = params.get('new') === '1';
  useEffect(() => {
    if (!wantsNew) return;
    if (canCreate) setCreating(true);
    setParams((p) => {
      p.delete('new');
      return p;
    }, { replace: true });
  }, [wantsNew, canCreate, setParams]);

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
    return columns.map((c) => {
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

  const hiddenNow = hidden ?? cols.filter((c) => c.startHidden).map((c) => c.field);
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

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await api.blob(`${resource.path}${listQuery({ ...query, format: 'csv' })}`);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };
  const exportSelected = () => {
    const fields = visible.filter((c) => c.known).map((c) => c.field);
    downloadRowsCsv(resource, fields.length > 0 ? fields : [resource.titleField], [...selected.values()], fileName.replace('.csv', '-selected.csv'));
    toast.success(`${selected.size} ${noun(selected.size)} exported.`);
  };

  /* Saved views */
  const activeView = views.find((v) => sameView(v.view, view));
  const isAll = sameView(view, EMPTY_VIEW);
  const filtered = Boolean(view.q) || Object.values(view.filters).some((v) => v.length > 0);
  const saveView = (name: string) => {
    const labels: Record<string, string> = {};
    for (const [key, values] of Object.entries(view.filters)) {
      const meta = fieldMeta(resource, key);
      const label = values[0] && knownLabel(meta.type === 'user' ? 'user' : meta.to ?? '', values[0]);
      if (label) labels[key] = label;
    }
    const next = [...views.filter((v) => v.name !== name), { name, view: { ...view, labels } }].sort((a, b) => a.name.localeCompare(b.name));
    setViews(next);
    storeViews(type, next);
    setNaming(null);
    toast.success(`View "${name}" saved.`);
  };
  const deleteView = (target: SavedView) => {
    const next = views.filter((v) => v !== target);
    setViews(next);
    storeViews(type, next);
    toast.info(`View "${target.name}" deleted.`);
  };
  const viewName = activeView ? activeView.name : isAll ? `All ${plural}` : 'Unsaved view';

  const newButton = canCreate && (
    <Button leftSection={<IconPlus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>
      New {resource.label.toLowerCase()}
    </Button>
  );
  const headerActions = <>{actions}{newButton}</>;

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const closeCreate = () => {
    if (formDirty.current) setConfirmClose(true);
    else setCreating(false);
  };

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
          <Menu position="bottom-end" shadow="md" width={260}>
            <Menu.Target>
              <Button variant="default" className="rc-view-button" leftSection={<IconBookmark size={16} aria-hidden="true" />} rightSection={<IconChevronDown size={14} aria-hidden="true" />}>
                <span className="rc-sr-only">View: </span>
                <span className="rc-view-name">{viewName}</span>
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Views</Menu.Label>
              <Menu.Item leftSection={isAll ? <IconCheck size={16} /> : <span className="rc-menu-gap" />} onClick={() => applyView(EMPTY_VIEW)}>
                All {plural}
              </Menu.Item>
              {views.map((v) => (
                <Menu.Item key={v.name} leftSection={v === activeView ? <IconCheck size={16} /> : <span className="rc-menu-gap" />} onClick={() => applyView(v.view)}>
                  {v.name}
                </Menu.Item>
              ))}
              <Menu.Divider />
              <Menu.Item leftSection={<IconBookmark size={16} />} disabled={isAll} onClick={() => setNaming(activeView?.name ?? '')}>
                Save current view…
              </Menu.Item>
              {activeView && (
                <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => deleteView(activeView)}>
                  Delete “{activeView.name}”
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
          <ColumnChooser
            columns={cols}
            hidden={hiddenNow}
            onChange={setHidden}
            onReset={() => setHidden(null)}
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
            <Tooltip label={`Export ${filtered ? 'the filtered' : 'all'} ${plural} as CSV`}>
              <Button variant="default" className="rc-icon-label" loading={exporting} leftSection={<IconDownload size={16} aria-hidden="true" />} onClick={() => void exportCsv()}>
                <span className="rc-btn-label">Export</span>
                <span className="rc-sr-only"> CSV</span>
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

      <Modal open={creating} title={`New ${resource.label.toLowerCase()}`} size="lg" onClose={closeCreate}>
        <ResourceForm
          type={type}
          fields={createFields ?? []}
          initial={createInitial}
          onDirtyChange={(d) => { formDirty.current = d; }}
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
        open={confirmClose}
        title="Discard this draft?"
        message={`The new ${resource.label.toLowerCase()} has not been saved. Closing now loses what you have entered.`}
        confirmLabel="Discard"
        danger
        onConfirm={() => { setConfirmClose(false); setCreating(false); }}
        onCancel={() => setConfirmClose(false)}
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

      <Modal open={naming !== null} title="Save view" size="sm" onClose={() => setNaming(null)}>
        <form
          className="rc-form"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (naming?.trim()) saveView(naming.trim());
          }}
        >
          <TextField label="View name" required autoFocus maxLength={60} value={naming ?? ''} onChange={setNaming}
            hint={views.some((v) => v.name === naming?.trim()) ? 'A view with this name exists and will be replaced.' : 'Saves the current search, filters and sort order in this browser.'} />
          <div className="rc-form-actions">
            <Button variant="default" onClick={() => setNaming(null)}>Cancel</Button>
            <Button type="submit" disabled={!naming?.trim()}>Save view</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
