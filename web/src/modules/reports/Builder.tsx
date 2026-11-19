// The report builder: three panes (fields, shape, live preview) that a person with no technical
// background can use. Every change shows at once in the preview; nothing is saved until Save.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Button, Card, EmptyState, ErrorState, Icon, Loading, Menu, Modal, PageHeader, TextArea, TextField,
  api, errorMessage, useAuth, useDebounced, useFetch, useToast,
} from '../../core';
import { ChartPicker, FieldList, ShareFields, TypePicker, useUndo } from './BuilderParts';
import { downloadFile, fileName, openDocument, useCatalogue, usePost } from './data';
import { completeFilters, defaultCondition } from './FilterEditor';
import { ResultTable, ResultView } from './ResultView';
import { ColumnsEditor, FiltersSection, GroupEditor, Section, SortEditor, TotalsEditor, isSummary } from './SpecEditor';
import type { CatalogueField, CatalogueType, ChartSpec, ReportDefinition, ReportResult, ReportSpec, Sharing } from './types';

interface Draft { name: string; description: string; spec: ReportSpec | null; chart: ChartSpec; sharing: Sharing; shared_roles: string[] }
const BLANK: Draft = { name: '', description: '', spec: null, chart: { kind: 'table' }, sharing: 'private', shared_roles: [] };

/** A useful first list for a record type: reference, title, then the fields people usually want. */
function starterSpec(t: CatalogueType): ReportSpec {
  const has = (p: string) => t.fields.some((f) => f.path === p);
  const columns = [t.refField, t.titleField, 'status', 'priority', 'owner_id', 'assignee_id', 'created_at']
    .filter((p): p is string => Boolean(p) && has(p as string));
  return { type: t.type, columns: [...new Set(columns)].slice(0, 6) };
}

/** What is sent to the server: half-finished conditions are left out so the preview keeps working. */
export function sendable(spec: ReportSpec, type: CatalogueType): ReportSpec {
  const summary = isSummary(spec);
  return {
    type: spec.type,
    filters: completeFilters(spec.filters, type.fields),
    ...(summary
      ? { groupBy: (spec.groupBy ?? []).filter((g) => g.field), aggregates: (spec.aggregates ?? []).filter((a) => a.fn === 'count' || a.fn === 'pct' || a.field), pivot: spec.pivot && spec.groupBy?.length === 2 }
      : { columns: spec.columns }),
    sort: spec.sort?.length ? spec.sort : undefined,
    limit: spec.limit,
  };
}

function Preview({ type, spec, chart, name, onResult }: { type: CatalogueType; spec: ReportSpec; chart: ChartSpec; name: string; onResult: (r: ReportResult | undefined) => void }) {
  const body = useDebounced(useMemo(() => ({ spec: sendable(spec, type), limit: 50 }), [spec, type]), 350);
  const { data, error, loading, reload } = usePost<ReportResult>('/api/reports/run', body);
  useEffect(() => { onResult(data); }, [data, onResult]);
  const noColumns = !isSummary(spec) && (spec.columns?.length ?? 0) === 0;
  return (
    <Card className="rp-preview" title="Preview"
      actions={<span className="rp-preview-status" role="status">{loading ? 'Updating…' : data ? `${data.total.toLocaleString('en-GB')} ${(data.total === 1 ? type.label : type.plural).toLowerCase()} match` : ''}</span>}>
      {error && !data ? <ErrorState title="The preview could not be worked out" error={error} onRetry={reload} />
        : !data ? <Loading lines={6} label="Working out the preview" />
        : (
          <div className={loading ? 'rp-preview-body is-loading' : 'rp-preview-body'}>
            {error !== undefined && <p className="notice notice-warn"><Icon name="alert-circle" size={16} /> {errorMessage(error)} The preview shows the last version that worked.</p>}
            {noColumns && <p className="notice"><Icon name="info" size={16} /> No columns chosen, so a standard set is shown. Pick fields on the left to choose your own.</p>}
            {chart.kind !== 'table' && <ResultView result={data} chart={chart} label={name || `${type.plural} report`} height={300} />}
            {(chart.kind === 'table' || data.mode !== 'total') && (
              <>
                {chart.kind !== 'table' && <h4 className="rp-preview-sub">The figures</h4>}
                {chart.kind === 'table' ? <ResultView result={data} chart={chart} label={name} maxRows={50} /> : <ResultTable result={data} maxRows={50} />}
              </>
            )}
            <p className="rp-preview-foot muted">
              <Icon name="eye" size={14} /> You are seeing what your own role allows. Other people who open this report see what theirs allows.
              {data.restricted && <> <Icon name="lock" size={14} /> Includes restricted records.</>}
            </p>
          </div>
        )}
    </Card>
  );
}

export function Builder() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { types, error: catError, reload: catReload } = useCatalogue();
  const existing = useFetch<ReportDefinition>(id ? `/api/reports/${id}` : null);
  const draft = useUndo<Draft>(BLANK);
  const [ready, setReady] = useState(!id);
  const [saving, setSaving] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [changeType, setChangeType] = useState(false);
  const [nameError, setNameError] = useState('');
  const [result, setResult] = useState<ReportResult | undefined>();
  const d = draft.value;
  const type = types?.find((t) => t.type === d.spec?.type);

  // Start from a saved report (edit, or "save a copy" with ?copy=), or from ?type= for a new one.
  useEffect(() => {
    if (id && existing.data && !ready) {
      const r = existing.data;
      draft.reset({ name: r.name, description: r.description ?? '', spec: r.spec, chart: r.chart?.kind ? r.chart : { kind: 'table' }, sharing: r.sharing, shared_roles: r.shared_roles ?? [] });
      setReady(true);
    }
  }, [id, existing.data, ready, draft]);
  useEffect(() => {
    const wanted = params.get('type');
    const t = types?.find((x) => x.type === wanted);
    if (!id && t && !draft.value.spec) draft.reset({ ...BLANK, spec: starterSpec(t) });
  }, [id, params, types, draft]);

  if (catError) return <ErrorState title="The report builder could not be loaded" error={catError} onRetry={catReload} />;
  if (existing.error) return <ErrorState title="This report could not be opened" error={existing.error} onRetry={existing.reload} />;
  if (!types || !ready) return <><PageHeader title={id ? 'Edit report' : 'New report'} /><Loading lines={8} label="Loading the report builder" /></>;

  const crumbs = [{ label: 'Reports', to: '/reports' }, { label: id ? d.name || 'Report' : 'New report' }];

  if (!d.spec || !type) {
    const missing = d.spec && !type;
    return (
      <div className="stack">
        <PageHeader title={id ? 'Edit report' : 'New report'} breadcrumbs={crumbs} subtitle="Step 1 of 3: choose what the report is about. You can change everything else afterwards." />
        {missing && <p className="notice notice-warn">This report is about a kind of record that is not available to you here. Choose another to carry on.</p>}
        {types.length === 0
          ? <EmptyState icon="lock" title="Nothing to report on" message="Your role does not include any records that reports can be built from. Ask an administrator." />
          : <TypePicker types={types} onPick={(t) => draft.reset({ ...d, spec: starterSpec(t), chart: { kind: 'table' } })} />}
      </div>
    );
  }

  const spec = d.spec;
  const summary = isSummary(spec);
  const setSpec = (next: ReportSpec) => draft.set((prev) => ({ ...prev, spec: next }));
  const setChart = (chart: ChartSpec) => draft.set((prev) => ({ ...prev, chart }));
  const chosen = summary ? (spec.groupBy ?? []).map((g) => g.field) : spec.columns ?? [];

  function toggleField(f: CatalogueField) {
    if (!summary) {
      const cols = spec.columns ?? [];
      return setSpec({ ...spec, columns: cols.includes(f.path) ? cols.filter((c) => c !== f.path) : [...cols, f.path] });
    }
    const groups = spec.groupBy ?? [];
    if (groups.some((g) => g.field === f.path)) return setSpec({ ...spec, groupBy: groups.filter((g) => g.field !== f.path), pivot: false, sort: [] });
    if (!f.group) return toast.info(`${f.label} cannot be used for grouping. Use the filter button to filter by it.`);
    const dated = f.type === 'date' || f.type === 'datetime';
    setSpec({ ...spec, groupBy: [...groups.slice(0, 1), { field: f.path, ...(dated ? { bucket: 'month' as const } : {}) }], sort: [] });
  }
  function setMode(toSummary: boolean) {
    if (toSummary === summary) return;
    if (!toSummary) return draft.set((prev) => ({ ...prev, spec: { ...starterSpec(type!), filters: spec.filters }, chart: { kind: 'table' } }));
    const first = type!.fields.find((f) => f.path === 'status') ?? type!.fields.find((f) => f.type === 'lookup') ?? type!.fields.find((f) => f.group)!;
    draft.set((prev) => ({ ...prev, spec: { type: spec.type, filters: spec.filters, groupBy: [{ field: first.path }], aggregates: [{ fn: 'count' }] }, chart: { kind: 'bar' } }));
  }

  async function save() {
    if (!d.name.trim()) { setNameError('Give the report a name.'); return; }
    setSaving(true);
    try {
      const body = { name: d.name.trim(), description: d.description, spec: sendable(spec, type!), chart: d.chart, sharing: d.sharing, shared_roles: d.shared_roles };
      const saved = id ? await api.patch<ReportDefinition>(`/api/reports/${id}`, body) : await api.post<ReportDefinition>('/api/reports', body);
      toast.success('Report saved.');
      navigate(`/reports/${saved.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }
  const exportBody = (format: string) => ({ title: d.name || `${type.plural} report`, format, spec: sendable(spec, type), chart: d.chart });
  const exportAs = (format: 'csv' | 'xlsx' | 'pdf' | 'html') => (format === 'html'
    ? openDocument('POST', '/api/reports/export', exportBody('html'))
    : downloadFile(fileName(d.name || type.plural, format), 'POST', '/api/reports/export', exportBody(format))).catch((err) => toast.error(errorMessage(err)));

  return (
    <div className="rp-builder">
      <PageHeader
        title={id ? `Edit: ${d.name}` : d.name || `New report on ${type.plural.toLowerCase()}`}
        breadcrumbs={crumbs}
        subtitle={type.description}
        actions={(
          <>
            <Button variant="ghost" icon="history" disabled={!draft.canUndo} onClick={draft.undo} title="Undo (Ctrl+Z)">Undo</Button>
            <Button variant="ghost" disabled={!draft.canRedo} onClick={draft.redo} title="Redo (Ctrl+Y)">Redo</Button>
            {can('reports.export') && type.canExport && (
              <Menu label="Export" icon="download" align="end" items={[
                { label: 'PDF', icon: 'file-text', onSelect: () => exportAs('pdf') },
                { label: 'Excel (XLSX)', icon: 'download', onSelect: () => exportAs('xlsx') },
                { label: 'CSV', icon: 'download', onSelect: () => exportAs('csv') },
                { label: 'Print-ready page', icon: 'external', onSelect: () => exportAs('html'), separated: true },
              ]} />
            )}
            <Button variant="primary" icon="check" onClick={() => { setNameError(''); setSaveOpen(true); }}>{id ? 'Save changes' : 'Save report'}</Button>
          </>
        )}
      />

      <div className="rp-panes">
        <aside className="rp-pane rp-pane-fields" aria-label="Fields">
          <Card title="1 · What it is about" actions={<Button size="sm" variant="ghost" onClick={() => setChangeType(true)}>Change</Button>}>
            <p className="rp-about"><strong>{type.plural}</strong>{type.restricted && <span className="chip chip-red"><Icon name="lock" size={12} /> Restricted</span>}</p>
            <p className="rp-section-hint">{summary ? 'Select a field to group by it, or the funnel to filter by it.' : 'Select a field to add it as a column, or the funnel to filter by it.'}</p>
            <FieldList type={type} chosen={chosen} verb={summary ? 'Group by' : 'Add'} onToggle={toggleField}
              onFilter={(f) => setSpec({ ...spec, filters: { op: spec.filters?.op ?? 'and', items: [...(spec.filters?.items ?? []), defaultCondition(f)] } })} />
          </Card>
        </aside>

        <div className="rp-pane rp-pane-shape">
          <Card title="2 · Shape it">
            <div className="rp-mode" role="radiogroup" aria-label="Kind of report">
              <button type="button" role="radio" aria-checked={!summary} className={!summary ? 'is-on' : ''} onClick={() => setMode(false)}>
                <strong>List</strong><span>One row for each {type.label.toLowerCase()}</span>
              </button>
              <button type="button" role="radio" aria-checked={summary} className={summary ? 'is-on' : ''} onClick={() => setMode(true)}>
                <strong>Summary</strong><span>Counts and totals, grouped</span>
              </button>
            </div>

            {summary ? (
              <>
                <Section title="Group" hint="Records with the same value are counted together. Dates can be grouped by week, month and so on.">
                  <GroupEditor type={type} spec={spec} onChange={setSpec} />
                </Section>
                <Section title="Totals" hint="What to work out for each group.">
                  <TotalsEditor type={type} spec={spec} onChange={setSpec} />
                </Section>
              </>
            ) : (
              <Section title="Columns" hint="In the order they will appear. Use the arrows to reorder.">
                <ColumnsEditor type={type} spec={spec} onChange={setSpec} />
              </Section>
            )}
            <Section title="Filters" hint="Narrow down which records are included.">
              <FiltersSection type={type} spec={spec} onChange={setSpec} />
            </Section>
            <Section title="Order">
              <SortEditor type={type} spec={spec} onChange={setSpec} />
            </Section>
            <Section title="Show as" hint={summary ? 'Charts that do not suit this report are greyed out; hover to see why.' : 'A list is shown as a table. Switch to Summary for charts.'}>
              <ChartPicker chart={d.chart} onChange={setChart} result={result} kinds={summary ? undefined : ['table']} />
            </Section>
          </Card>
        </div>

        <div className="rp-pane rp-pane-preview">
          <Preview type={type} spec={spec} chart={d.chart} name={d.name} onResult={setResult} />
        </div>
      </div>

      <Modal open={saveOpen} title={id ? 'Save changes' : 'Save report'} onClose={() => setSaveOpen(false)}
        footer={<><Button onClick={() => setSaveOpen(false)}>Cancel</Button><Button variant="primary" loading={saving} onClick={save}>Save</Button></>}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <TextField label="Name" required value={d.name} error={nameError} onChange={(name) => { setNameError(''); draft.set((p) => ({ ...p, name })); }} placeholder="For example: Open tickets by team" />
          <TextArea label="Description" rows={2} value={d.description} onChange={(description) => draft.set((p) => ({ ...p, description }))} hint="One line saying what the report is for." />
          <ShareFields what="report" sharing={d.sharing} roles={d.shared_roles} onChange={(sharing, shared_roles) => draft.set((p) => ({ ...p, sharing, shared_roles }))} />
        </form>
      </Modal>

      <Modal open={changeType} title="Report on something else" onClose={() => setChangeType(false)} size="lg">
        <p className="muted">Choosing a different kind of record starts the columns, groups and filters again. Undo brings them back.</p>
        <TypePicker types={types} current={type.type} onPick={(t) => { draft.set((p) => ({ ...p, spec: starterSpec(t), chart: { kind: 'table' } })); setChangeType(false); }} />
      </Modal>
    </div>
  );
}
