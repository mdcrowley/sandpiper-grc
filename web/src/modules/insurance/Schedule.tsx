// The property schedule of values (E46-64): the Schedule of values page (every scheduled property with
// its values, exportable as CSV, Excel or PDF from the list), a policy's Schedule of values tab, and a
// scheduled property's page.
import { useState } from 'react';
import {
  api, Button, ErrorState, errorMessage, formatCurrency, Loading, PageHeader, RecordPage, ResourceList, Stat, useAuth, useFetch, useToast,
} from '../../core';
import type { ColumnDef, RecordContext } from '../../core';

interface ScheduleSummary {
  items: number; total_value: number; building_value: number; contents_value: number; equipment_value: number; income_value: number;
  valuation_due: number; valuation_years: number; stale_before: string;
}

const COLUMNS: ColumnDef[] = [
  'ref', 'title', { field: 'policy_id', priority: 3 }, { field: 'site_id', priority: 2 }, { field: 'location', priority: 3 },
  { field: 'building_value', priority: 3 }, { field: 'contents_value', priority: 3 }, { field: 'equipment_value', priority: 3 },
  { field: 'income_value', hidden: true }, { field: 'total_value', priority: 1 }, { field: 'valued_on', priority: 2 },
  { field: 'construction', hidden: true }, { field: 'occupancy', hidden: true }, { field: 'year_built', hidden: true }, { field: 'floor_area', hidden: true },
  { field: 'valuation_basis', hidden: true }, { field: 'department_id', hidden: true }, { field: 'asset_id', hidden: true }, { field: 'vehicle_id', hidden: true },
];
const FILTERS = ['policy_id', 'site_id', 'department_id', 'valuation_basis', 'valued_on'];
export const SCHEDULE_CREATE = [
  'title', 'policy_id', 'site_id', 'asset_id', 'vehicle_id', 'department_id', 'location', 'occupancy', 'construction', 'year_built', 'floor_area',
  'building_value', 'contents_value', 'equipment_value', 'income_value', 'valuation_basis', 'valued_on', 'notes',
];

function Figures({ s }: { s: ScheduleSummary }) {
  return (
    <div className="grid-stats">
      <Stat label="Total insured value" value={formatCurrency(s.total_value)} icon="shield" hint={`${s.items} scheduled ${s.items === 1 ? 'property' : 'properties'}`} />
      <Stat label="Buildings" value={formatCurrency(s.building_value)} icon="box" hint={`Contents ${formatCurrency(s.contents_value)}`} />
      <Stat label="Equipment and business income" value={formatCurrency(s.equipment_value + s.income_value)} icon="chart" />
      <Stat label="Valuation due" value={s.valuation_due} icon="clock" color={s.valuation_due ? 'amber' : undefined}
        hint={`Not valued in ${s.valuation_years} years`} to={`/insurance/schedule?f.valued_on.lt=${s.stale_before}`} />
    </div>
  );
}

export function ScheduleList() {
  const { data, error } = useFetch<ScheduleSummary>('/api/insurance/schedule/summary');
  return (
    <div className="stack">
      <PageHeader title="Schedule of values" subtitle="The buildings, contents and equipment the property program insures, with their values. Export the list for the insurer or the risk pool." />
      {data ? <Figures s={data} /> : error ? null : <Loading lines={2} label="Loading the figures" />}
      <ResourceList type="insurance_schedule_item" urlState columns={COLUMNS} filters={FILTERS} createFields={SCHEDULE_CREATE} />
    </div>
  );
}

export function PolicySchedule({ row, canEdit }: RecordContext) {
  const { can } = useAuth();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useFetch<ScheduleSummary>(`/api/insurance/schedule/summary?policy_id=${row.id}&v=${version}`);
  const fromCovered = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ added: number; skipped: number }>(`/api/insurance/policies/${row.id}/schedule/from-covered`, {});
      toast.success(r.added ? `${r.added} ${r.added === 1 ? 'property' : 'properties'} added to the schedule. Fill in their values.` : 'Every covered record is already on the schedule.');
      setVersion((n) => n + 1);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      {error ? <ErrorState error={error} onRetry={reload} /> : data ? <Figures s={data} /> : <Loading lines={2} />}
      <ResourceList
        key={version}
        type="insurance_schedule_item"
        baseFilter={{ policy_id: String(row.id) }}
        columns={COLUMNS.filter((c) => (typeof c === 'string' ? c : c.field) !== 'policy_id')}
        filters={['site_id', 'department_id', 'valued_on']}
        createFields={can('insurance.create') ? SCHEDULE_CREATE.filter((f) => f !== 'policy_id') : undefined}
        createInitial={{ policy_id: row.id }}
        onCreated={() => setVersion((n) => n + 1)}
        actions={canEdit && can('insurance.create') ? <Button size="sm" icon="plus" loading={busy} onClick={() => void fromCovered()}>Add covered records</Button> : undefined}
      />
    </div>
  );
}

export function ScheduleDetail() {
  return (
    <RecordPage
      type="insurance_schedule_item"
      summaryFields={[...SCHEDULE_CREATE.slice(0, -1), 'total_value', 'notes']}
      breadcrumbs={[{ label: 'Schedule of values', to: '/insurance/schedule' }, { label: 'Scheduled property' }]}
    />
  );
}
