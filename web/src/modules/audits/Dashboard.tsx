// The audit plan and coverage: what is due, what each area's audits were over the last years,
// open findings, and how inspections are going.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AgendaList, Button, Card, Chart, chartColor, EmptyState, ErrorState, formatDate, Loading, LookupChip, PageHeader, Select, Stat, TableWrap, useAuth, useFetch,
} from '../../core';
import type { ChartOption, ColorName } from '../../core';
import { AuditTabs } from './shared';

interface Entry { id: string | null; ref: string | null; title: string; status: string; restricted: boolean }
interface Coverage {
  today: string; years: number[]; covered: number;
  areas: { id: string; name: string; category: string | null; cycle_months: number | null; last_audited_on: string | null; next_due_on: string | null;
    risk_level: string | null; owner_name: string | null; state: 'overdue' | 'due_soon' | 'ok' | 'never'; audited_in_period: boolean; by_year: Record<string, Entry[]> }[];
  unassigned: Record<string, Entry[]>;
}
interface Group { value: string; label: string; color: string; count: number }
interface Summary {
  today: string; year: number;
  audits: { planned_this_year: number; open: number; closed_this_year: number; by_status: Group[] };
  areas: { total: number; overdue: number; due_soon: number; never: number };
  findings: { open: number; overdue: number; by_rating: Group[] };
  inspections: { due_next_30: number; overdue: number; last_90: { complete: number; missed: number; failed: number; on_time_pct: number | null };
    by_month: { period: string; complete: number; on_time: number; missed: number; failed: number; due: number }[]; missed_after_days: number };
  requests: { open: number; overdue: number };
  upcoming_inspections: { id: string; ref: string; title: string; due_on: string | null; status: string; target_label: string | null; inspector_name: string | null }[];
  active_audits: { id: string; ref: string; title: string; status: string; planned_start: string | null }[];
}

const STATE: Record<string, { label: string; color: ColorName }> = {
  overdue: { label: 'Overdue', color: 'red' }, due_soon: { label: 'Due soon', color: 'amber' }, ok: { label: 'On cycle', color: 'green' }, never: { label: 'Never audited', color: 'gray' },
};
const monthLabel = (p: string) => new Date(`${p}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

function CoverageGrid({ years }: { years: number }) {
  const { data, error, reload } = useFetch<Coverage>(`/api/audits/coverage?years=${years}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} />;
  if (!data.areas.length) {
    return <EmptyState icon="clipboard" title="No audit universe yet" message="List the areas that need auditing (safety plan elements, processes, departments, systems, sites) and how often."
      action={<Link className="btn btn-primary" to="/audits/areas?new=1">Add an area</Link>} />;
  }
  const thisYear = Number(data.today.slice(0, 4));
  return (
    <TableWrap label="Audits of each area by year, with the area's cycle and next due date" className="au-coverage">
      <table className="table">
        <caption className="sr-only">Audits of each area by year, with the area's cycle and next due date</caption>
        <thead>
          <tr>
            <th scope="col">Area</th><th scope="col">Cycle</th><th scope="col">Next due</th>
            {data.years.map((y) => <th scope="col" key={y}>{y}{y > thisYear ? ' (plan)' : ''}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.areas.map((a) => (
            <tr key={a.id}>
              <th scope="row"><Link className="row-title" to={`/audits/areas/${a.id}`}>{a.name}</Link>{a.category && <div><LookupChip list="audit_area_category" value={a.category} /></div>}</th>
              <td>{a.cycle_months ? `${a.cycle_months} months` : '—'}</td>
              <td><span className={`chip chip-${STATE[a.state].color}`}>{STATE[a.state].label}</span><div className="muted">{a.next_due_on ? formatDate(a.next_due_on) : ''}</div></td>
              {data.years.map((y) => (
                <td key={y}>
                  {(a.by_year[y] ?? []).length === 0 ? <span className="muted" aria-label="No audit">·</span> : (a.by_year[y] ?? []).map((e, i) => (
                    <div key={e.id ?? `r${i}`} className="au-cov-entry">
                      {e.id ? <Link to={`/audits/engagements/${e.id}`}><span className="ref">{e.ref}</span></Link> : <span className="muted">{e.title}</span>}
                      {' '}<LookupChip list="audit_status" value={e.status} />
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function AuditsDashboard() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [years, setYears] = useState('3');
  const { data: s, error, loading, reload } = useFetch<Summary>('/api/audits/summary');

  const charts = useMemo(() => {
    const months = s?.inspections.by_month ?? [];
    const inspections: ChartOption = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0 },
      grid: { top: 16, right: 16, bottom: 48, left: 40 },
      xAxis: { type: 'category', data: months.map((m) => monthLabel(m.period)), axisLabel: { interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        { name: 'On time', type: 'bar', stack: 'done', color: chartColor('green'), data: months.map((m) => m.on_time) },
        { name: 'Late', type: 'bar', stack: 'done', color: chartColor('amber'), data: months.map((m) => m.complete - m.on_time) },
        { name: 'Missed', type: 'bar', stack: 'done', color: chartColor('red'), data: months.map((m) => m.missed) },
      ],
    };
    const ratings = s?.findings.by_rating ?? [];
    const findings: ChartOption = {
      tooltip: { trigger: 'item' },
      grid: { top: 8, right: 40, bottom: 24, left: 190 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', data: ratings.map((r) => r.label), inverse: true, axisTick: { show: false } },
      series: [{
        name: 'Open findings', type: 'bar', barMaxWidth: 18, label: { show: true, position: 'right', color: 'var(--text-muted)' },
        data: ratings.map((r) => ({ value: r.count, key: r.value, itemStyle: { color: chartColor(r.color as ColorName) } })),
      }],
    };
    return { inspections, findings };
  }, [s]);

  const header = (
    <>
      <PageHeader title="Audits" subtitle="The audit plan and its coverage over the years, open findings, evidence requests and how inspections are going."
        actions={<>
          <Button icon="refresh" loading={loading && !!s} onClick={reload}>Refresh</Button>
          {can('audits.create') && <Link className="btn btn-primary" to="/audits/engagements?new=1">Plan an audit</Link>}
        </>} />
      <AuditTabs active="dashboard" />
    </>
  );
  if (error && !s) return <div className="stack">{header}<ErrorState title="The dashboard could not be loaded" error={error} onRetry={reload} /></div>;
  if (!s) return <div className="stack">{header}<Loading lines={10} label="Loading the audit dashboard" /></div>;
  const i = s.inspections;
  return (
    <div className="stack">
      {header}
      <div className="grid-stats">
        <Stat label={`Audits planned for ${s.year}`} value={s.audits.planned_this_year} icon="calendar" hint={`${s.audits.closed_this_year} closed so far`} to={`/audits/engagements?f.plan_year=${s.year}`} />
        <Stat label="Audits under way" value={s.audits.open} icon="clipboard" hint="In fieldwork or reporting" to="/audits/engagements?f.status=fieldwork,reporting" />
        <Stat label="Areas overdue for audit" value={s.areas.overdue} icon="alert" color={s.areas.overdue ? 'red' : undefined}
          hint={`${s.areas.due_soon} due in 90 days, ${s.areas.never} never audited`} to={`/audits/areas?f.next_due_on.lt=${s.today}`} />
        <Stat label="Open findings" value={s.findings.open} icon="alert-circle" color={s.findings.overdue ? 'orange' : undefined}
          hint={s.findings.overdue ? `${s.findings.overdue} past the response date` : 'None past the response date'} to="/audit-findings?f.status=open,responded,cap_raised" />
        <Stat label="Inspections due in 30 days" value={i.due_next_30} icon="check-square" color={i.overdue ? 'red' : undefined}
          hint={i.overdue ? `${i.overdue} overdue` : 'None overdue'} to="/inspections?f.status=scheduled,in_progress" />
        <Stat label="Inspections on time" value={i.last_90.on_time_pct === null ? '—' : `${i.last_90.on_time_pct}%`} icon="clock"
          hint={`Last 90 days: ${i.last_90.missed} missed, ${i.last_90.failed} failed`} to="/inspections?f.status=complete,missed" />
        <Stat label="Evidence requests open" value={s.requests.open} icon="file-text" color={s.requests.overdue ? 'amber' : undefined}
          hint={s.requests.overdue ? `${s.requests.overdue} overdue` : 'None overdue'} to="/audits/requests?f.status=requested,returned" />
      </div>

      <Card title="Coverage of the audit universe" actions={(
        <div className="au-years"><Select label="Years shown" hideLabel required size="xs" value={years} onChange={(v) => setYears(v || '3')}
          options={[{ value: '3', label: 'Last 3 years' }, { value: '5', label: 'Last 5 years' }, { value: '1', label: 'This year' }]} /></div>
      )} flush>
        <CoverageGrid years={Number(years)} />
      </Card>

      <div className="au-grid">
        <Card title="Inspections in the last six months">
          <Chart label="Inspections due each month: done on time, done late and missed" option={charts.inspections} height={260}
            empty={i.by_month.every((m) => m.due === 0)} emptyMessage="No inspections were due in the last six months"
            onSegmentClick={() => navigate('/inspections?f.status=complete,missed')} />
        </Card>
        <Card title="Open findings by rating">
          <Chart label="Open audit and inspection findings by rating" option={charts.findings} height={260} empty={s.findings.open === 0}
            emptyMessage="No open findings" onSegmentClick={(seg) => navigate(`/audit-findings?f.rating=${(seg.data as { key: string }).key}&f.status=open,responded,cap_raised`)} />
        </Card>
      </div>

      <div className="au-grid">
        <Card title="Next inspections" actions={<Link className="btn btn-ghost btn-sm" to="/inspections">All inspections</Link>}>
          <AgendaList label="Next inspections" empty="No inspections are scheduled."
            items={s.upcoming_inspections.map((x) => ({
              key: x.id, date: x.due_on ?? s.today, title: x.title, reference: x.ref, to: `/inspections/${x.id}`,
              meta: [x.inspector_name, x.status === 'in_progress' ? 'In progress' : null].filter(Boolean).join(' · '),
              color: (x.due_on && x.due_on < s.today ? 'red' : 'blue') as ColorName,
            }))} />
        </Card>
        <Card title="Audits under way and planned" actions={<Link className="btn btn-ghost btn-sm" to="/audits/engagements">All audits</Link>}>
          <AgendaList label="Audits under way and planned" empty="No audits are planned."
            items={s.active_audits.map((a) => ({
              key: a.id, date: a.planned_start ?? s.today, title: a.title, reference: a.ref, to: `/audits/engagements/${a.id}`,
              meta: a.status === 'planned' ? 'Planned' : a.status === 'fieldwork' ? 'Fieldwork' : 'Reporting',
              color: (a.status === 'planned' ? 'blue' : 'amber') as ColorName,
            }))} />
        </Card>
      </div>
    </div>
  );
}
