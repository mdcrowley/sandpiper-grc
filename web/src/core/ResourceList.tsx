// Generic list for any registered record type: server-side search, sort, filter and paging,
// saved views, CSV export and an optional New dialog.
import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage, listQuery, type ListResult, type Row } from './api';
import { useAuth } from './auth';
import { DateField, MultiSelect, RecordPicker, Select, TextField, UserPicker } from './fields';
import { fieldMeta, FieldValue } from './FieldValue';
import { formatNumber } from './format';
import { useDebounced, useFetch } from './hooks';
import { Icon } from './Icon';
import { recordHref, useLookup, useResource, type ResourceMeta } from './meta';
import { Menu, Modal, useToast, type MenuItem } from './overlay';
import { ResourceForm } from './ResourceForm';
import { Button, EmptyState, ErrorState, IconButton, Loading, PageHeader, cx } from './ui';

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
    };

export interface ResourceListProps {
  /** Record type key, e.g. "ticket". */
  type: string;
  columns: ColumnDef[];
  /** Fields offered in the filter bar (lookup, boolean, user, ref, date and datetime fields). */
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
  /** Rows per page (default 25). */
  pageSize?: number;
  // TODO: selection?: { selected: string[]; onChange: (ids: string[]) => void } for bulk actions.
}

interface View {
  q: string;
  sort: string;
  dir: 'asc' | 'desc';
  /** Keyed like the list contract without `f.`: `status`, `due_at.gt`. */
  filters: Record<string, string[]>;
  /** Labels of picked users and records, so a restored view can show them. */
  labels: Record<string, string>;
}

interface SavedView {
  name: string;
  view: View;
}

const EMPTY_VIEW: View = { q: '', sort: '', dir: 'asc', filters: {}, labels: {} };
const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

/** Starting view from the page address, so dashboards can link to `/tickets?f.status=new,open&q=printer`. */
function viewFromParams(params: URLSearchParams): View {
  const filters: Record<string, string[]> = {};
  for (const [key, value] of params) {
    if (key.startsWith('f.') && value) filters[key.slice(2)] = value.split(',');
  }
  return { ...EMPTY_VIEW, q: params.get('q') ?? '', filters };
}

function loadViews(type: string): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`grc.views.${type}`) ?? '[]');
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
}

function storeViews(type: string, views: SavedView[]): void {
  try {
    localStorage.setItem(`grc.views.${type}`, JSON.stringify(views));
  } catch {
    // Storage unavailable: views last for this page only.
  }
}

interface FilterProps {
  resource: ResourceMeta;
  field: string;
  view: View;
  setFilter: (key: string, values: string[], label?: string) => void;
}

function LookupFilter({ label, list, value, onChange }: { label: string; list: string; value: string[]; onChange: (v: string[]) => void }) {
  return <MultiSelect label={label} options={useLookup(list)} value={value} onChange={onChange} />;
}

function FilterControl({ resource, field, view, setFilter }: FilterProps) {
  const meta = fieldMeta(resource, field);
  const value = view.filters[field] ?? [];
  const pick = (id: string | null, option?: { label: string }) => setFilter(field, id ? [id] : [], option?.label);
  switch (meta.type) {
    case 'lookup':
      return <LookupFilter label={meta.label} list={meta.list ?? ''} value={value} onChange={(v) => setFilter(field, v)} />;
    case 'boolean':
      return (
        <Select
          hideLabel
          className="filter-field"
          label={meta.label}
          placeholder={`${meta.label}: any`}
          options={[{ value: 'true', label: `${meta.label}: yes` }, { value: 'false', label: `${meta.label}: no` }]}
          value={value[0] ?? ''}
          onChange={(v) => setFilter(field, v ? [v] : [])}
        />
      );
    case 'user':
      return <UserPicker hideLabel className="filter-field" label={meta.label} placeholder={meta.label} value={value[0] ?? null} display={view.labels[field]} onChange={pick} />;
    case 'ref':
      return <RecordPicker hideLabel className="filter-field" type={meta.to ?? ''} label={meta.label} placeholder={meta.label} value={value[0] ?? null} display={view.labels[field]} onChange={pick} />;
    case 'date':
    case 'datetime':
      return (
        <>
          <DateField className="filter-field filter-date" label={`${meta.label} after`} value={view.filters[`${field}.gt`]?.[0] ?? ''} onChange={(v) => setFilter(`${field}.gt`, v ? [v] : [])} />
          <DateField className="filter-field filter-date" label={`${meta.label} before`} value={view.filters[`${field}.lt`]?.[0] ?? ''} onChange={(v) => setFilter(`${field}.lt`, v ? [v] : [])} />
        </>
      );
    default:
      return null; // text fields are covered by the search box
  }
}

export function ResourceList({
  type, columns, filters = [], baseFilter, title, actions, onRowClick, createFields, createInitial, onCreated, pageSize = 25,
}: ResourceListProps) {
  const resource = useResource(type);
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [view, setView] = useState<View>(() => viewFromParams(params));
  const [page, setPage] = useState(1);
  const [views, setViews] = useState<SavedView[]>(() => loadViews(type));
  const [naming, setNaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const canCreate = Boolean(createFields && resource && can(`${resource.module}.create`));

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

  const q = useDebounced(view.q, 300);
  const query = useMemo(() => ({
    q: q.trim(),
    sort: view.sort || undefined,
    dir: view.sort ? view.dir : undefined,
    filters: { ...Object.fromEntries(Object.entries(view.filters).filter(([, v]) => v.length > 0)), ...baseFilter },
  }), [q, view.sort, view.dir, view.filters, baseFilter]);
  const url = resource ? `${resource.path}${listQuery({ ...query, page, pageSize })}` : null;
  const { data, loading, error, reload } = useFetch<ListResult>(url);

  if (!resource) return <ErrorState title={`Unknown record type "${type}"`} />;

  const change = (patch: Partial<View>) => {
    setView((v) => ({ ...v, ...patch }));
    setPage(1);
  };
  const setFilter = (key: string, values: string[], label?: string) => {
    const nextFilters = { ...view.filters };
    const nextLabels = { ...view.labels };
    if (values.length > 0) nextFilters[key] = values; else delete nextFilters[key];
    if (label && values.length > 0) nextLabels[key] = label; else delete nextLabels[key];
    change({ filters: nextFilters, labels: nextLabels });
  };
  const toggleSort = (field: string) =>
    change(view.sort === field ? { dir: view.dir === 'asc' ? 'desc' : 'asc' } : { sort: field, dir: 'asc' });

  const cols = columns.map((c) => {
    const def = typeof c === 'string' ? { field: c } : c;
    const known = def.field in resource.fields || ['created_at', 'updated_at'].includes(def.field);
    return {
      ...def,
      label: def.label ?? fieldMeta(resource, def.field).label,
      sortable: def.sortable ?? (known && !['json', 'longtext'].includes(fieldMeta(resource, def.field).type)),
      numeric: !def.render && ['number', 'currency'].includes(fieldMeta(resource, def.field).type),
    };
  });

  const open = (row: Row) => (onRowClick ? onRowClick(row) : navigate(recordHref(resource.route, row.id)));
  const onRowMouse = (e: MouseEvent, row: Row) => {
    if (!(e.target as HTMLElement).closest('a, button, input, select, label')) open(row);
  };
  const onRowKey = (e: KeyboardEvent, row: Row) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) open(row);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await api.blob(`${resource.path}${listQuery({ ...query, format: 'csv' })}`);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${resource.plural.toLowerCase().replace(/\s+/g, '-')}.csv`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const activeView = views.find((v) => sameView(v.view, view));
  const filtered = !sameView(view, EMPTY_VIEW);
  const saveView = (name: string) => {
    const next = [...views.filter((v) => v.name !== name), { name, view }].sort((a, b) => a.name.localeCompare(b.name));
    setViews(next);
    storeViews(type, next);
    setNaming(null);
    toast.success(`View "${name}" saved.`);
  };
  const viewItems: MenuItem[] = [
    ...views.map((v) => ({ label: v.name, icon: v === activeView ? 'check' as const : undefined, onSelect: () => { setView(v.view); setPage(1); } })),
    { label: 'Save current view…', icon: 'star', separated: views.length > 0, onSelect: () => setNaming(activeView?.name ?? '') },
    ...(activeView ? [{
      label: `Delete view "${activeView.name}"`, icon: 'trash' as const, danger: true,
      onSelect: () => {
        const next = views.filter((v) => v !== activeView);
        setViews(next);
        storeViews(type, next);
      },
    }] : []),
  ];

  const headerActions = (
    <>
      {actions}
      {canCreate && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New {resource.label.toLowerCase()}</Button>}
    </>
  );

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const titleLink = (field: string) => !onRowClick && (field === resource.titleField || field === resource.refField);

  return (
    <div className="rlist">
      {title && <PageHeader title={title} actions={headerActions} />}

      <div className="rlist-toolbar" role="search" aria-label={`Filter ${resource.plural.toLowerCase()}`}>
        <TextField hideLabel className="filter-field rlist-search" type="search" label={`Search ${resource.plural.toLowerCase()}`} placeholder={`Search ${resource.plural.toLowerCase()}`} value={view.q} onChange={(v) => change({ q: v })} />
        {filters.map((f) => <FilterControl key={f} resource={resource} field={f} view={view} setFilter={setFilter} />)}
        {filtered && <Button variant="ghost" size="sm" icon="x" onClick={() => change(EMPTY_VIEW)}>Clear</Button>}
        <div className="rlist-tools">
          <Menu label={activeView ? activeView.name : 'Views'} icon="star" size="sm" align="end" items={viewItems} />
          {can(`${resource.module}.export`) && (
            <Button size="sm" icon="download" loading={exporting} onClick={() => void exportCsv()}>Export CSV</Button>
          )}
          {!title && headerActions}
        </div>
      </div>

      {error && !data ? (
        <ErrorState title={`${resource.plural} could not be loaded`} error={error} onRetry={reload} />
      ) : !data ? (
        <Loading label={`Loading ${resource.plural.toLowerCase()}`} lines={6} />
      ) : data.rows.length === 0 ? (
        filtered ? (
          <EmptyState icon="filter" title="Nothing matches these filters" message="Try a different search or clear the filters."
            action={<Button onClick={() => change(EMPTY_VIEW)}>Clear filters</Button>} />
        ) : (
          <EmptyState title={`No ${resource.plural.toLowerCase()} yet`}
            message={canCreate ? `Create the first ${resource.label.toLowerCase()} to get started.` : undefined}
            action={canCreate ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New {resource.label.toLowerCase()}</Button> : undefined} />
        )
      ) : (
        <>
          {error !== undefined && error !== null && <p className="form-error" role="alert">{errorMessage(error)}</p>}
          <div className="table-wrap" aria-busy={loading}>
            <table className={cx('table', loading && 'table-loading')}>
              <caption className="sr-only">{title ?? resource.plural}</caption>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.field} scope="col" className={c.numeric ? 'num' : undefined}
                      aria-sort={view.sort === c.field ? (view.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                      {c.sortable ? (
                        <button type="button" className="th-sort" onClick={() => toggleSort(c.field)}>
                          {c.label}
                          {view.sort === c.field && <Icon name={view.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={13} />}
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} tabIndex={0} className="row-link" onClick={(e) => onRowMouse(e, row)} onKeyDown={(e) => onRowKey(e, row)}>
                    {cols.map((c) => {
                      const cell = c.render ? c.render(row) : <FieldValue resource={resource} field={c.field} row={row} compact />;
                      return (
                        <td key={c.field} className={c.numeric ? 'num' : undefined}>
                          {!c.render && titleLink(c.field) && row[c.field]
                            ? <Link className={c.field === resource.refField ? 'ref' : 'row-title'} to={recordHref(resource.route, row.id)}>{String(row[c.field])}</Link>
                            : cell}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rlist-foot">
            <span className="muted" role="status">{formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}</span>
            <div className="rlist-pager">
              <IconButton icon="chevron-left" label="Previous page" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} />
              <span className="muted">Page {page} of {pages}</span>
              <IconButton icon="chevron-right" label="Next page" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)} />
            </div>
          </div>
        </>
      )}

      <Modal open={creating} title={`New ${resource.label.toLowerCase()}`} size="lg" onClose={() => setCreating(false)}>
        <ResourceForm
          type={type}
          fields={createFields ?? []}
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

      <Modal open={naming !== null} title="Save view" size="sm" onClose={() => setNaming(null)}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (naming?.trim()) saveView(naming.trim());
          }}
        >
          <TextField label="View name" required autoFocus value={naming ?? ''} onChange={setNaming}
            hint="Saves the current search, filters and sort order in this browser." />
          <div className="form-actions">
            <Button onClick={() => setNaming(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!naming?.trim()}>Save view</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
