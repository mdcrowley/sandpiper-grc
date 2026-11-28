// Premium allocation (E46-64): a policy's Premium allocation tab (how its premium is split across
// departments, sites, assets or vehicles, and each share), and the Premium allocation page (premiums of
// the policies in force by department, site, asset or vehicle, with a CSV download).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, EditableSummary, EmptyState, ErrorState, errorMessage, formatCurrency, Loading, LookupChip, PageHeader, RecordPage, ResourceList,
  Select, Stat, TableWrap, useAuth, useFetch, useLookup, useMeta, useToast,
} from '../../core';
import type { ColumnDef, RecordContext } from '../../core';

interface PolicyAllocation { method: string; measure: string | null; premium: number; shares: number; allocated: number; unallocated: number; allocated_pct: number }

const METHOD_HINT: Record<string, string> = {
  equal: 'Every share takes the same part of the premium.',
  measure: 'Each share takes its part of the premium in proportion to its measure.',
  insured_value: 'Each share takes its part in proportion to the insured value of this policy\'s schedule of values that belongs to it.',
  manual: 'Each share takes the percentage entered for it; what is left is not allocated.',
};

export function PolicyAllocation({ row, reload, canEdit }: RecordContext) {
  const { can } = useAuth();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const { data, error, reload: again } = useFetch<PolicyAllocation>(`/api/insurance/policies/${row.id}/allocation?v=${version}-${String(row.updated_at)}`);
  const [busy, setBusy] = useState(false);
  const method = String(row.allocation_method ?? 'equal');
  const refresh = () => { setVersion((n) => n + 1); again(); };
  const fromCovered = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ added: number; skipped: number }>(`/api/insurance/policies/${row.id}/allocation/from-covered`, {});
      toast.success(r.added ? `${r.added} share${r.added === 1 ? '' : 's'} added from the covered records.` : 'Every covered record already has a share.');
      refresh();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const columns: ColumnDef[] = [
    'title', { field: 'department_id', priority: 3 }, { field: 'site_id', priority: 3 },
    ...(method === 'manual' ? [{ field: 'percent', priority: 1 } as ColumnDef] : method === 'measure' ? [{ field: 'measure', priority: 1, label: row.allocation_measure ? String(row.allocation_measure) : 'Measure' } as ColumnDef] : []),
    { field: 'share_pct', priority: 1 }, { field: 'amount', priority: 1 },
  ];
  return (
    <div className="stack">
      <div className="ins-grid">
        <EditableSummary type="insurance_policy" row={row} onSaved={() => { reload(); refresh(); }} title="How the premium is split" fields={['premium', 'allocation_method', 'allocation_measure']} />
        <Card title="Allocated">
          {error ? <ErrorState error={error} onRetry={again} /> : !data ? <Loading lines={3} /> : (
            <div className="stack">
              <div className="grid-stats">
                <Stat label="Premium" value={formatCurrency(data.premium)} icon="shield" />
                <Stat label="Allocated" value={formatCurrency(data.allocated)} icon="check-square" hint={`${data.allocated_pct}% in ${data.shares} share${data.shares === 1 ? '' : 's'}`} />
                <Stat label="Not allocated" value={formatCurrency(data.unallocated)} icon="alert" color={Math.abs(data.unallocated) >= 0.01 && data.shares ? 'amber' : undefined} />
              </div>
              <p className="muted ins-small">{METHOD_HINT[method] ?? ''}</p>
            </div>
          )}
        </Card>
      </div>
      <ResourceList
        key={version}
        type="insurance_premium_share"
        baseFilter={{ policy_id: String(row.id) }}
        columns={columns}
        filters={[]}
        bulkFields={[]}
        createFields={can('insurance.create') ? ['department_id', 'site_id', 'asset_id', 'vehicle_id', 'percent', 'measure', 'title', 'note'] : undefined}
        createInitial={{ policy_id: row.id }}
        onCreated={() => refresh()}
        actions={canEdit && can('insurance.create') ? <Button size="sm" icon="plus" loading={busy} onClick={() => void fromCovered()}>Add covered records</Button> : undefined}
      />
    </div>
  );
}

export function ShareDetail() {
  return (
    <RecordPage
      type="insurance_premium_share"
      summaryFields={['title', 'policy_id', 'department_id', 'site_id', 'asset_id', 'vehicle_id', 'percent', 'measure', 'weight', 'share_pct', 'amount', 'note']}
      breadcrumbs={[{ label: 'Premium allocation', to: '/insurance/allocation' }, { label: 'Premium share' }]}
    />
  );
}

interface Totals {
  by: string; line: string | null; premium: number; allocated: number; unallocated: number;
  rows: { target_id: string; label: string; amount: number; policies: number; lines: Record<string, number> }[];
}
const BY = [{ value: 'department', label: 'Department' }, { value: 'site', label: 'Site' }, { value: 'asset', label: 'Asset' }, { value: 'vehicle', label: 'Vehicle' }];


export function PremiumAllocation() {
  const { can } = useAuth();
  const { resources } = useMeta();
  const [by, setBy] = useState('site');
  const [line, setLine] = useState('');
  const lines = useLookup('insurance_line');
  const query = `by=${by}${line ? `&line=${line}` : ''}`;
  const { data, error, reload } = useFetch<Totals>(`/api/insurance/allocation?${query}`);
  const shownLines = lines.filter((l) => data?.rows.some((r) => r.lines[l.value] !== undefined));
  // Only the kinds of record the viewer's application has (a switched-off area's are left out).
  const byOptions = BY.filter((b) => resources[b.value]);
  const routeOf = (id: string) => `${resources[by]?.route ?? ''}/${id}`;
  const label = BY.find((b) => b.value === by)?.label ?? 'Department';
  return (
    <div className="stack">
      <PageHeader title="Premium allocation" subtitle="The premiums of the policies in force, allocated by each policy's split to the records it covers." />
      <div className="ins-toolbar-row">
        <div className="ins-toolbar"><Select label="Allocated to" required value={by} onChange={setBy} options={byOptions} /></div>
        <div className="ins-toolbar"><Select label="Line of coverage" value={line} onChange={setLine} options={[{ value: '', label: 'Every line' }, ...lines.map((l) => ({ value: l.value, label: l.label }))]} /></div>
        {can('insurance.export') && <a className="btn btn-secondary ins-download" href={`/api/insurance/allocation?${query}&format=csv`} download>Download CSV</a>}
      </div>
      {error ? <Card><ErrorState error={error} onRetry={reload} /></Card> : !data ? <Card><Loading lines={5} label="Loading the allocation" /></Card> : (
        <>
          <div className="grid-stats">
            <Stat label="Premium in force" value={formatCurrency(data.premium)} icon="shield" hint={line ? 'For this line' : 'Every line'} />
            <Stat label={`Allocated to a ${label.toLowerCase()}`} value={formatCurrency(data.allocated)} icon="check-square" />
            <Stat label="Not allocated this way" value={formatCurrency(data.unallocated)} icon="alert" hint="Split another way, or not yet split" />
          </div>
          <Card title={`Premium by ${label.toLowerCase()}`} flush>
            {data.rows.length === 0 ? (
              <EmptyState icon="chart" title="Nothing allocated this way yet" message="Open a policy in force and add premium shares on its Premium allocation tab." />
            ) : (
              <TableWrap label={`Premium by ${label.toLowerCase()}`} fit>
                <table className="table">
                  <caption className="sr-only">{`Premium by ${label.toLowerCase()}`}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{label}</th><th scope="col">Premium allocated</th>
                      {shownLines.map((l) => <th key={l.value} scope="col" data-priority="3">{l.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.target_id}>
                        <td><Link className="row-title" to={routeOf(r.target_id)}>{r.label}</Link></td>
                        <td>{formatCurrency(r.amount)}</td>
                        {shownLines.map((l) => <td key={l.value} data-priority="3">{r.lines[l.value] === undefined ? <span className="muted">—</span> : formatCurrency(r.lines[l.value])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
          <p className="muted ins-small">Figures count every policy in force, so they are the same for everyone. {line ? <LookupChip list="insurance_line" value={line} /> : null}</p>
        </>
      )}
    </div>
  );
}
