// The controls that shape a report: list or summary, columns, grouping, totals, filters and sort.
// Used whole by the report builder and in part by the dashboard widget editor.
import { Button, Icon, IconButton, Select, Switch } from '../../core';
import { FilterEditor } from './FilterEditor';
import type { AggFn, Bucket, CatalogueField, CatalogueType, ReportSpec } from './types';

const BUCKETS: { value: Bucket; label: string }[] = [
  { value: 'day', label: 'by day' }, { value: 'week', label: 'by week' }, { value: 'month', label: 'by month' },
  { value: 'quarter', label: 'by quarter' }, { value: 'year', label: 'by year' },
];
const AGGS: { value: AggFn; label: string; needsField: boolean }[] = [
  { value: 'count', label: 'Count of records', needsField: false },
  { value: 'sum', label: 'Total of', needsField: true },
  { value: 'avg', label: 'Average of', needsField: true },
  { value: 'min', label: 'Lowest (or earliest)', needsField: true },
  { value: 'max', label: 'Highest (or latest)', needsField: true },
  { value: 'pct', label: 'Share of total (%)', needsField: false },
];
const isDate = (f?: CatalogueField) => f?.type === 'date' || f?.type === 'datetime';
const opt = (fields: CatalogueField[]) => fields.map((f) => ({ value: f.path, label: f.label }));

export const isSummary = (spec: ReportSpec) => Boolean(spec.groupBy?.length || spec.aggregates?.length);

export function Section({ title, hint, children, step }: { title: string; hint?: string; children: React.ReactNode; step?: number }) {
  return (
    <section className="rp-section">
      <h3 className="rp-section-title">{step !== undefined && <span className="rp-step">{step}</span>}{title}</h3>
      {hint && <p className="rp-section-hint">{hint}</p>}
      {children}
    </section>
  );
}

export function ColumnsEditor({ type, spec, onChange }: { type: CatalogueType; spec: ReportSpec; onChange: (s: ReportSpec) => void }) {
  const cols = spec.columns ?? [];
  const label = (path: string) => type.fields.find((f) => f.path === path)?.label ?? path;
  const move = (i: number, by: number) => { const next = [...cols]; const [c] = next.splice(i, 1); next.splice(i + by, 0, c); onChange({ ...spec, columns: next }); };
  const left = type.fields.filter((f) => !cols.includes(f.path));
  return (
    <div className="rp-columns">
      {cols.length === 0 && <p className="rp-empty-hint">No columns chosen yet. Pick fields from the list on the left, or add one here.</p>}
      <ol className="rp-column-list">
        {cols.map((path, i) => (
          <li key={path}>
            <span className="rp-column-n">{i + 1}</span>
            <span className="rp-column-name truncate">{label(path)}</span>
            <IconButton icon="arrow-up" label={`Move ${label(path)} up`} variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon="arrow-down" label={`Move ${label(path)} down`} variant="ghost" size="sm" disabled={i === cols.length - 1} onClick={() => move(i, 1)} />
            <IconButton icon="x" label={`Remove ${label(path)}`} variant="ghost" size="sm" onClick={() => onChange({ ...spec, columns: cols.filter((c) => c !== path) })} />
          </li>
        ))}
      </ol>
      {left.length > 0 && (
        <Select label="Add a column" hideLabel searchable placeholder="Add a column…" value="" options={opt(left)} onChange={(path) => path && onChange({ ...spec, columns: [...cols, path] })} />
      )}
    </div>
  );
}

export function GroupEditor({ type, spec, onChange, maxGroups = 2, pivot = true }: { type: CatalogueType; spec: ReportSpec; onChange: (s: ReportSpec) => void; maxGroups?: number; pivot?: boolean }) {
  const groups = spec.groupBy ?? [];
  const groupable = type.fields.filter((f) => f.group);
  const set = (i: number, path: string) => {
    const f = type.fields.find((x) => x.path === path);
    const next = [...groups];
    if (!path) next.splice(i, 1); else next[i] = { field: path, ...(isDate(f) ? { bucket: 'month' as Bucket } : {}) };
    onChange({ ...spec, groupBy: next, pivot: next.length === 2 ? spec.pivot : false, sort: [] });
  };
  return (
    <div className="stack rp-group">
      {Array.from({ length: Math.min(maxGroups, groups.length + 1) }, (_, i) => {
        const g = groups[i];
        const f = type.fields.find((x) => x.path === g?.field);
        return (
          <div key={i} className="rp-group-row">
            <Select label={i === 0 ? 'Group by' : 'Then by'} searchable placeholder={i === 0 ? 'Choose a field…' : 'Optional: a second field'} value={g?.field ?? ''}
              options={opt(groupable.filter((x) => x.path === g?.field || !groups.some((o) => o.field === x.path && !isDate(x))))} onChange={(path) => set(i, path)} />
            {g && isDate(f) && (
              <Select label="Dates" required value={g.bucket ?? 'month'} options={BUCKETS}
                onChange={(b) => onChange({ ...spec, groupBy: groups.map((x, j) => (j === i ? { ...x, bucket: b as Bucket } : x)) })} />
            )}
          </div>
        );
      })}
      {pivot && groups.length === 2 && (
        <Switch label="Show as a pivot table" hint="The first field down the side, the second across the top." checked={Boolean(spec.pivot)} onChange={(v) => onChange({ ...spec, pivot: v })} />
      )}
    </div>
  );
}

export function TotalsEditor({ type, spec, onChange, single }: { type: CatalogueType; spec: ReportSpec; onChange: (s: ReportSpec) => void; single?: boolean }) {
  const aggs = spec.aggregates?.length ? spec.aggregates : [{ fn: 'count' as AggFn }];
  const fieldsFor = (fn: AggFn) => type.fields.filter((f) => f.sum || ((fn === 'min' || fn === 'max') && isDate(f)));
  const set = (i: number, patch: Partial<{ fn: AggFn; field?: string }>) => {
    const next = aggs.map((a, j) => {
      if (j !== i) return a;
      const merged = { ...a, ...patch };
      const def = AGGS.find((x) => x.value === merged.fn)!;
      if (merged.fn === 'count') return { fn: merged.fn };
      const ok = merged.field && fieldsFor(merged.fn).some((f) => f.path === merged.field);
      return { fn: merged.fn, field: ok ? merged.field : def.needsField ? fieldsFor(merged.fn)[0]?.path : undefined };
    });
    onChange({ ...spec, aggregates: next });
  };
  const noNumbers = !type.fields.some((f) => f.sum);
  return (
    <div className="stack rp-totals">
      {aggs.map((a, i) => {
        const def = AGGS.find((x) => x.value === a.fn)!;
        return (
          <div key={i} className="rp-total-row">
            <Select label={i === 0 ? 'Show' : 'And'} required value={a.fn} onChange={(fn) => set(i, { fn: fn as AggFn })}
              options={AGGS.filter((x) => !x.needsField || fieldsFor(x.value).length > 0).map((x) => ({ value: x.value, label: x.label }))} />
            {(def.needsField || (a.fn === 'pct' && !noNumbers)) && (
              <Select label="Of" required={def.needsField} searchable placeholder={a.fn === 'pct' ? 'the number of records' : 'Choose a number field'} value={a.field ?? ''}
                options={opt(fieldsFor(a.fn))} onChange={(field) => set(i, { field: field || undefined })} />
            )}
            {!single && aggs.length > 1 && <IconButton icon="x" label="Remove this total" variant="ghost" size="sm" onClick={() => onChange({ ...spec, aggregates: aggs.filter((_, j) => j !== i), sort: [] })} />}
          </div>
        );
      })}
      {!single && aggs.length < 6 && <div><Button size="sm" variant="ghost" icon="plus" onClick={() => onChange({ ...spec, aggregates: [...aggs, { fn: noNumbers ? 'pct' : 'sum', field: noNumbers ? undefined : fieldsFor('sum')[0]?.path }] })}>Add another total</Button></div>}
    </div>
  );
}

export function SortEditor({ type, spec, onChange }: { type: CatalogueType; spec: ReportSpec; onChange: (s: ReportSpec) => void }) {
  const summary = isSummary(spec);
  const aggs = spec.aggregates?.length ? spec.aggregates : [{ fn: 'count' as AggFn }];
  const label = (path?: string) => type.fields.find((f) => f.path === path)?.label ?? path ?? '';
  const options = summary
    ? [
      ...(spec.groupBy ?? []).map((g, i) => ({ value: `g${i}`, label: label(g.field) })),
      ...aggs.map((a, i) => ({ value: `a${i}`, label: a.fn === 'count' ? 'Count of records' : a.fn === 'pct' ? 'Share of total' : `${AGGS.find((x) => x.value === a.fn)!.label} ${label(a.field).toLowerCase()}` })),
    ]
    : opt(type.fields.filter((f) => f.type !== 'json'));
  const s = spec.sort?.[0];
  return (
    <div className="rp-group-row">
      <Select label="Sort by" searchable placeholder={summary ? 'Automatic' : 'Newest first'} value={s?.by ?? ''} options={options}
        onChange={(by) => onChange({ ...spec, sort: by ? [{ by, dir: s?.dir ?? (by.startsWith('a') && summary ? 'desc' : 'asc') }] : [] })} />
      {s && <Select label="Order" required value={s.dir ?? 'asc'} options={[{ value: 'asc', label: 'A to Z, low to high, oldest first' }, { value: 'desc', label: 'Z to A, high to low, newest first' }]}
        onChange={(dir) => onChange({ ...spec, sort: [{ by: s.by, dir: dir as 'asc' | 'desc' }] })} />}
    </div>
  );
}

export function FiltersSection({ type, spec, onChange }: { type: CatalogueType; spec: ReportSpec; onChange: (s: ReportSpec) => void }) {
  return (
    <>
      {!spec.filters?.items.length && <p className="rp-empty-hint"><Icon name="filter" size={14} /> No filters: every {type.label.toLowerCase()} you can see is included.</p>}
      <FilterEditor fields={type.fields} value={spec.filters} onChange={(filters) => onChange({ ...spec, filters })} />
    </>
  );
}
