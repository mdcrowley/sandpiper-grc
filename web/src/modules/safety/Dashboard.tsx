// The safety dashboard: the last twelve months of safety events, open investigations and
// corrective actions, the hazard matrix and the indicators against their targets.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button, Card, Chart, chartColor, EmptyState, ErrorState, formatNumber, Loading, PageHeader, Stat, useAuth, useFetch, useLookup,
} from '../../core';
import type { ChartOption, ColorName } from '../../core';
import { MetChip, targetText, TrendChart, unitText, type Point } from './Indicators';
import { HazardMatrix, SafetyTabs, type Scale } from './shared';

interface Summary {
  today: string;
  periods: string[];
  totals: {
    events: number; serious: number; open: number; investigations_overdue: number;
    corrective_open: number; corrective_overdue: number; hazards_open: number; hazards_high: number; hazards_review_overdue: number;
  };
  by_month: { period: string; total: number }[];
  by_type: { value: string; label: string; color: string; count: number }[];
  by_severity: { value: string; label: string; color: string; count: number }[];
  matrix: { scale: Scale; cells: { likelihood: number; severity: number; count: number }[]; unscored: number } | null;
  indicators: { id: string; name: string; measure: string; exposure: string | null; per_units: number | null; target: number | null; target_direction: string; latest: Point | null; points: Point[] }[];
}

interface Attention {
  inspections: { overdue: number; due_soon: number; missed_open: number; missed_90_days: number; schedules_behind: number };
  defects: { open: number; out_of_service: number; to_verify: number; deferral_overdue: number };
}

const monthLabel = (p: string) => new Date(`${p}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const monthStart = (p: string) => `${p}-01`;
const nextMonth = (p: string) => { const [y, m] = p.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; };

export function SafetyDashboard() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const exposures = useLookup('safety_exposure_measure');
  const { data: s, error, loading, reload } = useFetch<Summary>('/api/safety/summary');
  // Notification clocks (E25-06): counted for everyone, whatever they may see.
  const { data: clocks, reload: reloadClocks } = useFetch<{ summary: { red: number; amber: number; green: number; open: number } }>('/api/safety/clocks');
  // Inspections needing attention (wave 26), while the inspections area is on and the reader may see inspections.
  const { areaOn } = useAuth();
  const inspections = areaOn('audits') && can('audits.view');
  const { data: attention } = useFetch<Attention>(inspections ? '/api/inspections/attention' : null);
  const since = s ? monthStart(s.periods[0]) : '';

  const charts = useMemo(() => {
    const months = s?.by_month ?? [];
    const byMonth: ChartOption = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: months.map((m) => monthLabel(m.period)), axisLabel: { interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{ name: 'Safety events', type: 'bar', barMaxWidth: 28, color: 'var(--series-1)', data: months.map((m) => ({ value: m.total, key: m.period })) }],
    };
    const types = [...(s?.by_type ?? [])].filter((t) => t.count > 0).sort((a, b) => a.count - b.count);
    const byType: ChartOption = {
      tooltip: { trigger: 'item' },
      grid: { top: 8, right: 40, bottom: 24, left: 150 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', data: types.map((t) => t.label), axisTick: { show: false } },
      series: [{
        name: 'Events', type: 'bar', barMaxWidth: 18, color: 'var(--series-1)', itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: 'var(--text-muted)' },
        data: types.map((t) => ({ value: t.count, key: t.value, name: t.label })),
      }],
    };
    const sev = s?.by_severity ?? [];
    const bySeverity: ChartOption = {
      tooltip: { trigger: 'item' },
      xAxis: { type: 'category', data: sev.map((x) => x.label), axisLabel: { interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{
        name: 'Events', type: 'bar', barMaxWidth: 40, label: { show: true, position: 'top', color: 'var(--text-muted)' },
        data: sev.map((x) => ({ value: x.count, key: x.value, name: x.label, itemStyle: { color: chartColor(x.color as ColorName) } })),
      }],
    };
    return { byMonth, byType, bySeverity };
  }, [s]);

  const counts = useMemo(() => Object.fromEntries((s?.matrix?.cells ?? []).map((c) => [`${c.likelihood}.${c.severity}`, c.count])), [s]);

  const header = (
    <>
      <PageHeader title="Safety dashboard" subtitle="The last twelve months of safety events, open investigations and corrective actions, the hazard log and the indicators."
        actions={<>
          <Button icon="refresh" loading={loading && !!s} onClick={() => { reload(); reloadClocks(); }}>Refresh</Button>
          {can('safety.create') && <Link className="btn btn-primary" to="/safety/events?new=1">Report a safety event</Link>}
        </>} />
      <SafetyTabs active="dashboard" />
    </>
  );
  if (error && !s) return <div className="stack">{header}<ErrorState title="The dashboard could not be loaded" error={error} onRetry={reload} /></div>;
  if (!s) return <div className="stack">{header}<Loading lines={10} label="Loading the safety dashboard" /></div>;
  const t = s.totals;
  const ev = (q: string) => `/safety/events?${q}`;

  return (
    <div className="stack">
      {header}
      <div className="grid-stats">
        <Stat label="Safety events" value={t.events} icon="alert" hint="In the last twelve months" to={ev(`f.occurred_at.gt=${since}`)} />
        <Stat label="Serious or worse" value={t.serious} icon="alert-circle" color={t.serious ? 'red' : undefined} hint="In the last twelve months"
          to={ev(`f.occurred_at.gt=${since}&f.severity=serious,major`)} />
        <Stat label="Open events" value={t.open} icon="clock" color={t.investigations_overdue ? 'amber' : undefined}
          hint={t.investigations_overdue ? `${t.investigations_overdue} past the investigation date` : 'None past the investigation date'}
          to={ev('f.status=reported,investigating,actions_open')} />
        <Stat label="Corrective actions open" value={t.corrective_open} icon="check-square" color={t.corrective_overdue ? 'red' : undefined}
          hint={t.corrective_overdue ? `${t.corrective_overdue} overdue` : 'None overdue'} to="/actions?f.source=safety" />
        <Stat label="Open hazards" value={t.hazards_open} icon="shield" color={t.hazards_high ? 'orange' : undefined}
          hint={`${t.hazards_high} rated serious or high${t.hazards_review_overdue ? `, ${t.hazards_review_overdue} past review` : ''}`} to="/safety/hazards" />
        {clocks && (
          <Stat label="Notification clocks running" value={clocks.summary.open} icon="clock"
            color={clocks.summary.red ? 'red' : clocks.summary.amber ? 'amber' : undefined}
            hint={clocks.summary.red || clocks.summary.amber ? `${clocks.summary.red} overdue, ${clocks.summary.amber} due soon` : 'None overdue or due soon'}
            to={ev('f.reportable=true')} />
        )}
        {attention && (
          <Stat label="Inspections overdue or missed" value={attention.inspections.overdue + attention.inspections.missed_open} icon="check-square"
            color={attention.inspections.missed_open ? 'red' : attention.inspections.overdue ? 'amber' : undefined}
            hint={`${attention.inspections.missed_open} missed and not followed up, ${attention.inspections.schedules_behind} ${attention.inspections.schedules_behind === 1 ? 'schedule' : 'schedules'} behind`}
            to="/inspections?view=late" />
        )}
        {attention && (
          <Stat label="Open defects" value={attention.defects.open} icon="alert-circle" color={attention.defects.out_of_service ? 'red' : undefined}
            hint={`${attention.defects.out_of_service} keeping something out of service`} to="/inspections/defects" />
        )}
      </div>

      <div className="sf-grid">
        <Card title="Safety events by month">
          <Chart label="Safety events in each of the last twelve months" option={charts.byMonth} height={250} empty={t.events === 0}
            emptyMessage="No safety events in the last twelve months"
            onSegmentClick={(seg) => { const p = (seg.data as { key: string }).key; navigate(ev(`f.occurred_at.gt=${monthStart(p)}&f.occurred_at.lt=${nextMonth(p)}`)); }} />
        </Card>
        <Card title="By type">
          <Chart label="Safety events in the last twelve months by type" option={charts.byType} height={250} empty={t.events === 0}
            onSegmentClick={(seg) => navigate(ev(`f.occurred_at.gt=${since}&f.event_type=${(seg.data as { key: string }).key}`))} />
        </Card>
      </div>

      <div className="sf-grid">
        <Card title="Open hazards on the hazard matrix" actions={<Link className="btn btn-ghost btn-sm" to="/safety/hazards">Hazard log</Link>}>
          {!s.matrix ? <p className="muted">The hazard matrix is not available on this installation.</p> : (
            <>
              <HazardMatrix scale={s.matrix.scale} counts={counts} label={`Open hazards by likelihood and severity, rated after mitigation where scored`} />
              <p className="muted sf-hint">Each hazard sits where it is rated after mitigation, or where it is rated now when no mitigation is scored.{s.matrix.unscored ? ` ${s.matrix.unscored} not yet scored.` : ''}</p>
            </>
          )}
        </Card>
        <Card title="By severity">
          <Chart label="Safety events in the last twelve months by severity" option={charts.bySeverity} height={250} empty={t.events === 0}
            onSegmentClick={(seg) => navigate(ev(`f.occurred_at.gt=${since}&f.severity=${(seg.data as { key: string }).key}`))} />
        </Card>
      </div>

      <Card title="Safety performance indicators" actions={<Link className="btn btn-ghost btn-sm" to="/safety/indicators">All indicators</Link>} flush>
        {s.indicators.length === 0 ? <EmptyState icon="target" title="No indicators yet" message="Define what to measure, such as collisions per 100,000 vehicle-miles, and the dashboard tracks it."
          action={can('safety.create') ? <Link className="btn btn-primary" to="/safety/indicators">Add an indicator</Link> : undefined} /> : (
          <div className="sf-indicators">
            {s.indicators.map((i) => {
              const unit = unitText(i, exposures);
              return (
                <section key={i.id} className="sf-indicator" aria-labelledby={`ind-${i.id}`}>
                  <div className="sf-ind-head">
                    <Link id={`ind-${i.id}`} className="row-title" to={`/safety/indicators/${i.id}`}>{i.name}</Link>
                    <MetChip met={i.latest?.met} partial={i.latest?.partial} />
                  </div>
                  <div className="sf-ind-figure">
                    <strong className="sf-big">{i.latest ? formatNumber(i.latest.value) : '—'}</strong>
                    <span className="muted">{i.latest ? `${monthLabel(i.latest.period)} · ${unit}` : unit} · Target {targetText(i.latest && i.latest.target !== null ? { target: i.latest.target, target_direction: i.latest.direction ?? i.target_direction } : i).toLowerCase()}</span>
                  </div>
                  <TrendChart points={i.points} name={i.name} unit={unit} height={150} />
                </section>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
