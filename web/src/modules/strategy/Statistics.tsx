// Operating statistics: the series an administrator defines (Strategy > Settings), their values by
// period and breakdown, entered here or imported from a CSV or Excel file, and a chart of each.
import { Link, useSearchParams } from 'react-router-dom';
import {
  Card, Chart, chartColor, EmptyState, ErrorState, Loading, PageHeader, RecordPage, ResourceList, Select, useAuth, useFetch, type Crumb, type Row,
} from '../../core';
import { periodLabel } from './shared';
import './strategy.css';

interface SeriesValues {
  series: { id: string; name: string; unit: string | null; frequency: string; breakdown_label: string | null; decimals: number | null };
  periods: string[]; breakdowns: string[]; values: Record<string, (number | null)[]>;
}

const PALETTE = ['blue', 'teal', 'violet', 'orange', 'pink', 'green', 'red', 'yellow'];
const VALUE_CREATE = ['period', 'breakdown', 'value', 'note'];
const CRUMBS: Crumb[] = [{ label: 'Operating statistics', to: '/strategy/statistics' }];

export function SeriesChart({ seriesId, height = 280 }: { seriesId: string; height?: number }) {
  const { data, error, reload } = useFetch<SeriesValues>(`/api/strategy/stat-series/${seriesId}/values`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={5} />;
  const parts = data.breakdowns.filter((b) => b !== '' || data.breakdowns.length === 1);
  const stacked = data.breakdowns.length > 1 && !data.breakdowns.includes('');
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: parts.map((b) => b || 'Total'), bottom: 0 },
    grid: { left: 64, right: 16, top: 16, bottom: 56 },
    xAxis: { type: 'category', data: data.periods.map(periodLabel) },
    yAxis: { type: 'value', name: data.series.unit ?? '' },
    series: parts.map((b, i) => ({
      name: b || 'Total', type: data.periods.length > 6 ? 'line' : 'bar', ...(stacked ? { stack: 'all', areaStyle: { opacity: 0.25 } } : {}),
      data: data.values[b], color: chartColor(PALETTE[i % PALETTE.length]),
    })),
  };
  return (
    <Chart label={`${data.series.name} by period${data.series.breakdown_label ? ` and ${data.series.breakdown_label.toLowerCase()}` : ''}`}
      option={option} height={height} empty={data.periods.length === 0} emptyMessage="No values entered yet" />
  );
}

export function StatisticsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data, error, reload } = useFetch<{ rows: Row[] }>('/api/strategy/stat-series?pageSize=200&sort=sort&dir=asc&f.active=true');
  const header = (
    <PageHeader title="Operating statistics" subtitle="Statistics your organization counts each month, quarter or year, entered by period or imported from a file, with who entered each value and when." />
  );
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={6} /></div>;
  if (!data.rows.length) {
    return (
      <div className="stack">{header}
        <EmptyState icon="chart" title="No statistics series yet"
          message={can('strategy.administer') ? 'Define the statistics you keep under Settings, with their unit, frequency and breakdowns such as mode or service.' : 'An administrator of this area defines the statistics series first.'}
          action={can('strategy.administer') ? <Link className="btn btn-primary" to="/strategy/settings">Go to settings</Link> : undefined} />
      </div>
    );
  }
  const chosen = data.rows.find((r) => r.id === params.get('series')) ?? data.rows[0];
  return (
    <div className="stack">
      {header}
      <div className="stg-toolbar">
        <Select label="Series" value={String(chosen.id)} onChange={(v) => setParams({ series: v }, { replace: true })}
          options={data.rows.map((r) => ({ value: String(r.id), label: `${r.name}${r.unit ? ` (${r.unit})` : ''}` }))} />
        <Link to={`/strategy/statistics/${chosen.id}`}>Open the series</Link>
      </div>
      <Card title={String(chosen.name)}>
        {chosen.description && <p className="muted">{String(chosen.description)}</p>}
        <SeriesChart key={chosen.id} seriesId={String(chosen.id)} />
      </Card>
      <ResourceList
        key={`values-${chosen.id}`}
        type="stat_value"
        title="Values"
        urlState
        baseFilter={{ series_id: String(chosen.id) }}
        defaultSort={{ field: 'period_start', dir: 'desc' }}
        columns={['period', 'breakdown', 'value', { field: 'note', priority: 3 }, { field: 'entered_by_name', priority: 2 }, { field: 'entered_at', priority: 3 }]}
        filters={['breakdown', 'period_start', 'entered_by']}
        createFields={VALUE_CREATE}
        createInitial={{ series_id: chosen.id }}
      />
    </div>
  );
}

export function SeriesDetail() {
  return (
    <RecordPage
      type="stat_series"
      breadcrumbs={CRUMBS}
      summaryFields={['code', 'name', 'description', 'unit', 'frequency', 'breakdown_label', 'breakdowns', 'decimals', 'active', 'owner_id', 'sort']}
      tabs={[{
        key: 'values', label: 'Values',
        content: ({ row }) => (
          <div className="stack">
            <Card title="Over time"><SeriesChart seriesId={row.id} /></Card>
            <ResourceList type="stat_value" baseFilter={{ series_id: row.id }} urlState={false} defaultSort={{ field: 'period_start', dir: 'desc' }}
              columns={['period', 'breakdown', 'value', { field: 'entered_by_name', priority: 2 }, { field: 'entered_at', priority: 3 }]}
              createFields={VALUE_CREATE} createInitial={{ series_id: row.id }} />
          </div>
        ),
      }]}
    />
  );
}

export function StatValueDetail() {
  return (
    <RecordPage
      type="stat_value"
      breadcrumbs={CRUMBS}
      title={(row) => `${row._display?.series_id ?? 'Statistic'}: ${periodLabel(String(row.period))}${row.breakdown ? `, ${row.breakdown}` : ''}`}
      subtitle={(row) => <>Value of <Link to={`/strategy/statistics/${row.series_id}`}>{row._display?.series_id ?? 'the series'}</Link></>}
      summaryFields={['series_id', 'period', 'breakdown', 'value', 'note', 'entered_by', 'entered_by_name', 'entered_at', 'period_start', 'period_end']}
    />
  );
}
