// Overview widgets for the people who lead safety, the fleet, asset condition, inspections and continuity
// (wave 26, E44-09), so the leaders of those areas see their own work on the start page. Each reads the
// area's own summary route (figures, the same for everyone) and links to the area's pages; a widget whose
// area is switched off, or that the person's role does not include, is not offered.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, EmptyState, ErrorState, Icon, Loading, Notice, TableWrap, listQuery, todayInZone, useFetch } from '../../core';
import type { ColorName, ListResult, StatsResult } from '../../core';
import { GroupBars } from './charts';
import { MoreLink, Panel } from './parts';
import type { WidgetDef } from './types';

/** A small linked figure inside a panel: a number over its label. */
function Figure({ value, label, to, tone }: { value: number | string; label: string; to: string; tone?: ColorName }) {
  return (
    <Link to={to} className={`home-figure${tone ? ` home-figure-${tone}` : ''}`}>
      <span className="home-figure-value">{value}</span>
      <span className="home-figure-label">{label}</span>
    </Link>
  );
}

/* ---------- safety ---------- */

interface SafetySummary {
  periods: string[];
  totals: { events: number; serious: number; open: number; investigations_overdue: number; hazards_open: number; hazards_high: number; hazards_review_overdue: number };
  by_month: { period: string; total: number }[];
  indicators: { id: string; name: string; target: number | null; latest: { value: number | null; met: boolean | null } | null }[];
}

function SafetyAtAGlance() {
  const state = useFetch<SafetySummary>('/api/safety/summary');
  return (
    <Panel title="Safety" state={state} to="/safety" linkLabel="Safety dashboard">
      {(d) => {
        const months = d.by_month;
        const now = months[months.length - 1]?.total ?? 0;
        const before = months[months.length - 2]?.total ?? 0;
        const offTarget = d.indicators.filter((i) => i.latest?.met === false);
        return (
          <div className="stack">
            <div className="home-figures">
              <Figure value={now} label={`Events this month (${before} last month)`} to="/safety/events" tone={now > before ? 'amber' : undefined} />
              <Figure value={d.totals.investigations_overdue} label="Investigations past due" to="/safety/events" tone={d.totals.investigations_overdue ? 'red' : undefined} />
              <Figure value={d.totals.hazards_high} label="Hazards rated high or serious" to="/safety/hazards" tone={d.totals.hazards_high ? 'red' : undefined} />
              <Figure value={d.totals.hazards_review_overdue} label="Hazards past their review" to="/safety/hazards" tone={d.totals.hazards_review_overdue ? 'amber' : undefined} />
            </div>
            {d.indicators.length === 0 ? null : offTarget.length === 0 ? (
              <p className="muted"><Icon name="check-circle" size={14} /> Every safety indicator met its target in the latest month.</p>
            ) : (
              <div>
                <p className="home-subhead">{offTarget.length} {offTarget.length === 1 ? 'indicator is' : 'indicators are'} off target</p>
                <ul className="home-plain-list">
                  {offTarget.slice(0, 4).map((i) => (
                    <li key={i.id}><Link to={`/safety/indicators/${i.id}`}>{i.name}</Link> <span className="muted">latest {i.latest?.value ?? '–'}, target {i.target ?? '–'}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      }}
    </Panel>
  );
}

/* ---------- emergencies and continuity ---------- */

interface ContinuitySummary {
  processes: number; with_gap: number;
  plans: { total: number; review_overdue: number; unapproved: number };
  activations: { active: number };
}

/** A banner while an emergency activation is active: the first thing a leader needs to know. */
function ActiveEmergency() {
  const { data } = useFetch<ContinuitySummary>('/api/continuity/summary');
  if (!data || data.activations.active === 0) return null;
  const n = data.activations.active;
  return (
    <Notice tone="error" title={n === 1 ? 'An emergency activation is active' : `${n} emergency activations are active`}>
      <Link to={`/continuity/activations${listQuery({ filters: { status: 'active' } })}`}>Open the activation{n === 1 ? '' : 's'}</Link>
    </Notice>
  );
}

function ContinuityAtAGlance() {
  const state = useFetch<ContinuitySummary>('/api/continuity/summary');
  return (
    <Panel title="Business continuity" state={state} to="/continuity" linkLabel="Continuity overview"
      empty={(d) => d.plans.total === 0 && d.processes === 0} emptyIcon="shield" emptyTitle="No plans or processes yet"
      emptyMessage="Figures appear here once business processes and continuity plans are recorded.">
      {(d) => (
        <div className="home-figures">
          <Figure value={d.activations.active} label="Activations active" to="/continuity/activations" tone={d.activations.active ? 'red' : undefined} />
          <Figure value={d.plans.review_overdue} label="Plans past their review" to="/continuity/plans" tone={d.plans.review_overdue ? 'red' : undefined} />
          <Figure value={d.plans.unapproved} label="Plans not yet approved" to="/continuity/plans" tone={d.plans.unapproved ? 'amber' : undefined} />
          <Figure value={d.with_gap} label="Processes with a recovery gap" to="/continuity/gaps" tone={d.with_gap ? 'amber' : undefined} />
        </div>
      )}
    </Panel>
  );
}

/* ---------- fleet ---------- */

function FleetStatus() {
  const navigate = useNavigate();
  const state = useFetch<StatsResult>('/api/vehicles/stats?group=status');
  return (
    <Panel title="Vehicles by status" state={state} to="/vehicles" linkLabel="Vehicles"
      empty={(d) => d.total === 0} emptyIcon="bus" emptyTitle="No vehicles yet" emptyMessage="Vehicles appear here once the fleet is recorded.">
      {(d) => {
        const down = d.groups.filter((g) => g.value === 'out_of_service' || g.value === 'in_maintenance').reduce((n, g) => n + g.count, 0);
        return (
          <div className="stack">
            <p className="muted">
              <strong>{down}</strong> of {d.total} {d.total === 1 ? 'vehicle is' : 'vehicles are'} out of service or in maintenance.
            </p>
            <GroupBars label="Vehicles by status" description="Select a bar to open the vehicles with that status." groups={d.groups}
              onPick={(key) => navigate(`/vehicles${listQuery({ filters: key ? { status: key } : { 'status.null': true } })}`)} />
          </div>
        );
      }}
    </Panel>
  );
}

/* ---------- asset condition ---------- */

interface ConditionSummary { classes: { id: string; name: string; total: number; past_ulb: number; past_ulb_pct: number | null; target_pct: number | null }[]; poor_pct: number | null }

function ConditionAtAGlance() {
  const state = useFetch<ConditionSummary>('/api/condition/summary');
  return (
    <Panel title="State of good repair" state={state} to="/condition" linkLabel="Asset condition"
      empty={(d) => d.classes.length === 0} emptyIcon="box" emptyTitle="No asset classes yet"
      emptyMessage="Figures appear here once asset classes with a useful life are set up.">
      {(d) => {
        const classes = [...d.classes].sort((a, b) => (b.past_ulb_pct ?? 0) - (a.past_ulb_pct ?? 0)).slice(0, 5);
        return (
          <div className="stack">
            {d.poor_pct !== null && <p className="muted"><strong>{d.poor_pct}%</strong> of rated assets are in poor condition.</p>}
            <TableWrap fit label="Share past useful life by asset class">
              <table className="table">
                <thead><tr><th>Asset class</th><th data-priority={1}>Past useful life</th><th>Target</th></tr></thead>
                <tbody>
                  {classes.map((c) => {
                    const over = c.past_ulb_pct !== null && c.target_pct !== null && c.past_ulb_pct > c.target_pct;
                    return (
                      <tr key={c.id}>
                        <td><Link to={`/condition/classes/${c.id}`}>{c.name}</Link></td>
                        <td className={over ? 'home-bad' : undefined}>{c.past_ulb_pct === null ? '–' : `${c.past_ulb_pct}%`} <span className="muted">({c.past_ulb} of {c.total})</span></td>
                        <td>{c.target_pct === null ? 'None set' : `${c.target_pct}% or less`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </div>
        );
      }}
    </Panel>
  );
}

/* ---------- inspections ---------- */

function InspectionsDue() {
  const today = useMemo(() => todayInZone(), []);
  const weekOut = useMemo(() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 8);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const open = ['scheduled', 'in_progress'];
  const overdue = useFetch<ListResult>(`/api/inspections${listQuery({ pageSize: 5, sort: 'due_on', dir: 'asc', filters: { status: open, 'due_on.lt': today } })}`);
  const soon = useFetch<ListResult>(`/api/inspections${listQuery({ pageSize: 1, filters: { status: open, 'due_on.gte': today, 'due_on.lt': weekOut } })}`);
  const missed = useFetch<ListResult>(`/api/inspections${listQuery({ pageSize: 1, filters: { status: ['missed'] } })}`);
  const error = overdue.error ?? soon.error ?? missed.error;
  return (
    <Card title="Inspections" className="home-panel" actions={<MoreLink to="/inspections">Inspections</MoreLink>}>
      {error ? <ErrorState error={error} onRetry={() => { overdue.reload(); soon.reload(); missed.reload(); }} />
        : !overdue.data || !soon.data || !missed.data ? <Loading lines={3} />
        : (
          <div className="stack">
            <div className="home-figures">
              <Figure value={overdue.data.total} label="Overdue" to={`/inspections${listQuery({ filters: { status: open, 'due_on.lt': today } })}`} tone={overdue.data.total ? 'red' : undefined} />
              <Figure value={soon.data.total} label="Due in the next 7 days" to={`/inspections${listQuery({ filters: { status: open, 'due_on.gte': today, 'due_on.lt': weekOut } })}`} />
              <Figure value={missed.data.total} label="Missed" to={`/inspections${listQuery({ filters: { status: ['missed'] } })}`} tone={missed.data.total ? 'amber' : undefined} />
            </div>
            {overdue.data.rows.length === 0 ? (
              <EmptyState icon="check-circle" title="No inspection is overdue" />
            ) : (
              <ul className="home-plain-list">
                {overdue.data.rows.map((r) => (
                  <li key={r.id}><Link to={`/inspections/${r.id}`}><span className="ref">{r.ref}</span> {r.title || r.target_label || 'Inspection'}</Link></li>
                ))}
              </ul>
            )}
          </div>
        )}
    </Card>
  );
}

export const AREA_LEAD_WIDGETS: WidgetDef[] = [
  {
    id: 'active-emergency', title: 'Active emergency', group: 'dashboard', wide: true,
    description: 'A banner while an emergency activation is active. Shows nothing otherwise.',
    visible: (ctx) => ctx.hasModule('continuity') && ctx.sees('emergency_activation'), render: () => <ActiveEmergency />,
  },
  {
    id: 'safety-glance', title: 'Safety', group: 'dashboard',
    description: 'Safety events this month against last month, investigations past due, high hazards, hazards past review and indicators off target.',
    visible: (ctx) => ctx.hasModule('safety') && ctx.sees('safety_event'), render: () => <SafetyAtAGlance />,
  },
  {
    id: 'inspections-due', title: 'Inspections', group: 'dashboard',
    description: 'Inspections overdue, due in the next week and missed, with the most overdue listed.',
    visible: (ctx) => ctx.hasModule('audits') && ctx.sees('inspection'), render: () => <InspectionsDue />,
  },
  {
    id: 'fleet-status', title: 'Vehicles by status', group: 'dashboard',
    description: 'Vehicles in service, spare, in maintenance and out of service.',
    visible: (ctx) => ctx.hasModule('fleet') && ctx.sees('vehicle'), render: () => <FleetStatus />,
  },
  {
    id: 'condition-glance', title: 'State of good repair', group: 'dashboard',
    description: 'The share of each asset class past its useful life against its target, and the share in poor condition.',
    visible: (ctx) => ctx.hasModule('condition') && ctx.sees('asset_class'), render: () => <ConditionAtAGlance />,
  },
  {
    id: 'continuity-glance', title: 'Business continuity', group: 'dashboard',
    description: 'Activations active, plans past review or not yet approved, and processes with a recovery gap.',
    visible: (ctx) => ctx.hasModule('continuity') && ctx.sees('continuity_plan'), render: () => <ContinuityAtAGlance />,
  },
];
