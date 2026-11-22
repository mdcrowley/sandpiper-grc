// The continuity overview: processes by criticality, recovery gaps, plans due for review, impact
// analyses due and the activations not yet closed.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AgendaList, Button, Card, Chart, chartColor, EmptyState, ErrorState, formatDateTime, Loading, LookupChip, PageHeader, Stat, useAuth, useFetch,
  useLookup,
} from '../../core';
import type { ChartOption, ColorName, Row } from '../../core';
import { ContinuityTabs } from './shared';

interface Summary {
  processes: number; with_gap: number; with_target_gap: number; with_unknown: number;
  plans: { total: number; review_overdue: number; unapproved: number };
  activations: { active: number };
  by_criticality: { value: string | null; count: number }[];
}
interface Lists { today: string; plans_due: Row[]; activations: Row[]; bia_due: Row[] }

export function ContinuityDashboard() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const levels = useLookup('process_criticality');
  const summary = useFetch<Summary>('/api/continuity/summary');
  const lists = useFetch<Lists>('/api/continuity/dashboard');
  const s = summary.data;
  const l = lists.data;

  const byCriticality = useMemo<ChartOption>(() => {
    const rows = levels.map((v) => ({ ...v, count: s?.by_criticality.find((c) => c.value === v.value)?.count ?? 0 }));
    return {
      tooltip: { trigger: 'item' },
      xAxis: { type: 'category', data: rows.map((r) => r.label), axisLabel: { interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{
        name: 'Active processes', type: 'bar', barMaxWidth: 40, label: { show: true, position: 'top', color: 'var(--text-muted)' },
        data: rows.map((r) => ({ value: r.count, key: r.value, name: r.label, itemStyle: { color: chartColor((r.color ?? 'blue') as ColorName) } })),
      }],
    };
  }, [s, levels]);

  const reload = () => { summary.reload(); lists.reload(); };
  const header = (
    <>
      <PageHeader title="Business continuity" subtitle="What the organization's work depends on, how long each process can be down, the plans to recover it, and emergencies under way."
        actions={<>
          <Button icon="refresh" loading={(summary.loading || lists.loading) && !!s} onClick={reload}>Refresh</Button>
          {can('continuity.create') && <Link className="btn btn-primary" to="/continuity/activations?new=1">Activate a plan</Link>}
        </>} />
      <ContinuityTabs active="dashboard" />
    </>
  );
  const error = summary.error ?? lists.error;
  if (error && !s) return <div className="stack">{header}<ErrorState title="The overview could not be loaded" error={error} onRetry={reload} /></div>;
  if (!s || !l) return <div className="stack">{header}<Loading lines={10} label="Loading the continuity overview" /></div>;

  return (
    <div className="stack">
      {header}
      <div className="grid-stats">
        <Stat label="Active processes" value={s.processes} icon="shield" to="/continuity/processes?f.status=active" />
        <Stat label="Recovery gaps" value={s.with_gap} icon="alert" color={s.with_gap ? 'red' : 'green'} to="/continuity/gaps"
          hint={s.with_gap ? 'Downtime tolerated is shorter than a system\'s recovery time' : s.with_unknown ? `${s.with_unknown} with a recovery time not known` : 'None found'} />
        <Stat label="Plans overdue for review" value={s.plans.review_overdue} icon="calendar" color={s.plans.review_overdue ? 'amber' : undefined}
          hint={`${s.plans.total} plans, ${s.plans.unapproved} not approved`} to="/continuity/plans" />
        <Stat label="Active emergencies" value={s.activations.active} icon="alert" color={s.activations.active ? 'red' : undefined} to="/continuity/activations?f.status=active" />
      </div>

      <div className="bc-grid">
        <Card title="Active processes by criticality">
          <Chart label="Active business processes by criticality" option={byCriticality} height={240} empty={s.processes === 0} emptyMessage="No active business processes yet"
            onSegmentClick={(seg) => navigate(`/continuity/processes?f.status=active&f.criticality=${(seg.data as { key: string }).key}`)} />
        </Card>
        <Card title="Emergencies not yet closed" actions={<Link className="btn btn-ghost btn-sm" to="/continuity/activations">All activations</Link>}>
          {l.activations.length === 0 ? <EmptyState icon="check" title="No emergency under way" message="Activate a plan when an emergency is declared." /> : (
            <ul className="bc-list">
              {l.activations.map((a) => (
                <li key={a.id}>
                  <Link className="row-title" to={`/continuity/activations/${a.id}`}><span className="ref">{a.ref}</span> {a.title}</Link>
                  <span className="bc-list-meta">
                    <LookupChip list="activation_status" value={a.status} /> <LookupChip list="activation_level" value={a.level} />
                    <span className="muted"> declared {formatDateTime(a.declared_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="bc-grid">
        <Card title="Plan reviews due" actions={<Link className="btn btn-ghost btn-sm" to="/continuity/plans">All plans</Link>}>
          <AgendaList label="Plan reviews due within 60 days" empty="No plan review due in the next 60 days."
            items={l.plans_due.map((p) => ({
              key: p.id, date: p.next_review_on, title: p.title, reference: p.ref, to: `/continuity/plans/${p.id}`,
              color: (p.next_review_on < l.today ? 'red' : 'amber') as ColorName,
            }))} />
        </Card>
        <Card title="Impact analyses due" actions={<Link className="btn btn-ghost btn-sm" to="/continuity/processes">All processes</Link>}>
          <AgendaList label="Impact analyses due within 60 days" empty="No impact analysis due in the next 60 days."
            items={l.bia_due.map((p) => ({
              key: p.id, date: p.next_bia_due, title: p.name, reference: p.ref, to: `/continuity/processes/${p.id}?tab=bia`,
              color: (p.next_bia_due < l.today ? 'red' : 'amber') as ColorName,
            }))} />
        </Card>
      </div>
    </div>
  );
}
