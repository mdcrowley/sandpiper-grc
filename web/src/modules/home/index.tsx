// Overview: the home dashboard. Each panel reads another
// module's summary endpoint and is hidden when the user lacks that module's permission.
import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Card, Chart, Countdown, EmptyState, ErrorState, Loading, PageHeader, ProgressBar, Stat, StatusChip,
  formatDate, statsToData, useAuth, useFetch,
} from '../../core';
import type { ModuleDef, StatsResult } from '../../core';

/** A card that loads one endpoint and shows loading, error and empty states. */
function Panel<T>({ title, url, to, linkLabel, empty, children }: {
  title: string; url: string | null; to?: string; linkLabel?: string;
  empty?: (data: T) => boolean; children: (data: T) => ReactNode;
}) {
  const { data, error, reload } = useFetch<T>(url);
  return (
    <Card title={title} actions={to ? <Link to={to}>{linkLabel ?? 'Open'}</Link> : undefined}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} />
        : empty?.(data) ? <EmptyState title="Nothing to show yet" />
        : children(data)}
    </Card>
  );
}

interface TicketMetrics { open: number; sla: { compliance_pct: number | null; breaches: number } }
interface ActionSummary { open: number; overdue: number; due_this_week: number; unassigned: number }
interface RiskSummary {
  total: number;
  levels: { value: string; label: string; color: string; count: number }[];
  top: { id: string; ref: string; title: string; rating_label: string; color: string; owner_name: string | null }[];
}
interface Tally { total: number; counts: Record<string, number>; score: number; atTargetPct: number }
interface Progress {
  statuses: { value: string; label: string; color: string }[];
  target: { score: number };
  series: { name: string; date: string; current: boolean; all: Tally; priority: Tally }[];
}
interface Renewals {
  contracts: { id: string; ref: string; title: string; vendor_name: string; notice_date: string; days_to_notice: number; window: string }[];
  undated: unknown[];
}
interface Portfolio {
  register: { id: string; ref: string; name: string; rag_overall: string | null; rag_trend: string | null; stage: string }[];
  funnel: { stage: string; label: string; color: string; count: number }[];
  wipWarning?: string | null;
}
interface Clocks {
  summary: { red: number; amber: number; green: number; open: number };
  clocks: { task_id: string; party: string; due_at: string | null; incident_id: string; state: string; incident?: { ref?: string; title?: string; discovered_at?: string } }[];
}

const RAG_COLOR: Record<string, string> = { red: 'red', amber: 'amber', green: 'green' };
const TREND_ARROW: Record<string, string> = { improving: '↑ improving', worsening: '↓ worsening', steady: '→ steady' };

function TicketsByPriority() {
  const navigate = useNavigate();
  const { data, error, reload } = useFetch<StatsResult>('/api/tickets/stats?group=priority&f.resolved_at.null=true');
  const option = useMemo(() => ({
    tooltip: { trigger: 'item' },
    xAxis: { type: 'category', data: data?.groups.map((g) => g.label) ?? [] },
    yAxis: { type: 'value', minInterval: 1 },
    series: [{ type: 'bar', data: statsToData(data?.groups ?? []) }],
  }), [data]);
  return (
    <Card title="Open tickets by priority" actions={<Link to="/tickets">All tickets</Link>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} />
        : data.total === 0 ? <EmptyState title="No open tickets" />
        : <Chart label="Open tickets by priority" option={option} height={220}
            onSegmentClick={(seg) => navigate(`/tickets?f.priority=${(seg.data as { key: string }).key}`)} />}
    </Card>
  );
}

function FrameworkProgress() {
  const fw = useFetch<{ rows: { id: string; name: string }[] }>('/api/frameworks?pageSize=1');
  const id = fw.data?.rows[0]?.id;
  return (
    <Panel<Progress> title="Framework progress (priority outcomes)" url={id ? `/api/frameworks/${id}/progress` : null}
      to="/frameworks" linkLabel="Outcomes board">
      {(p) => {
        const now = p.series[p.series.length - 1];
        const first = p.series[0];
        if (!now) return <EmptyState title="No outcomes loaded" message="Run the seed command to load the framework." />;
        const delta = now.priority.score - first.priority.score;
        return (
          <div className="stack">
            <ProgressBar value={now.priority.score} max={100} label={`Score ${now.priority.score} of 100 (target ${p.target.score})`} />
            <p className="muted">
              {delta === 0 ? 'No change' : `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)} points`} since {first.name} ({formatDate(first.date)}).{' '}
              {now.priority.atTargetPct}% of {now.priority.total} priority outcomes are at target.
            </p>
            <div className="row">
              {p.statuses.map((s) => (
                <StatusChip key={s.value} color={s.color as never} label={`${s.label}: ${now.priority.counts[s.value] ?? 0}`} />
              ))}
            </div>
          </div>
        );
      }}
    </Panel>
  );
}

function Home() {
  const { user, can } = useAuth();
  const tickets = useFetch<TicketMetrics>(can('tickets.view') ? '/api/tickets/metrics' : null);
  const actions = useFetch<ActionSummary>(can('actions.view') ? '/api/actions/summary' : null);
  const seesRisks = can('risks.view') && can('security.view');
  const seesIncidents = can('security.view');

  return (
    <>
      <PageHeader title="Overview" subtitle={user ? `Signed in as ${user.displayName}` : undefined} />
      <div className="stack">
        <div className="grid-stats">
          {tickets.data && <Stat label="Open tickets" value={tickets.data.open} to="/tickets" />}
          {tickets.data && (
            <Stat label="SLA compliance" to="/tickets/dashboard"
              value={tickets.data.sla.compliance_pct === null ? 'n/a' : `${tickets.data.sla.compliance_pct}%`}
              color={(tickets.data.sla.compliance_pct ?? 100) >= 90 ? 'green' : 'amber'} />
          )}
          {actions.data && <Stat label="Open actions" value={actions.data.open} to="/actions" />}
          {actions.data && (
            <Stat label="Overdue actions" value={actions.data.overdue} to="/actions" color={actions.data.overdue ? 'red' : 'green'} />
          )}
          {actions.data && <Stat label="Actions with no owner" value={actions.data.unassigned} to="/actions" color={actions.data.unassigned ? 'amber' : 'green'} />}
        </div>

        {seesIncidents && (
          <Panel<Clocks> title="Incident notification clocks" url="/api/security-incidents/clocks" to="/security-incidents"
            linkLabel="Security incidents" empty={(d) => d.clocks.length === 0}>
            {(d) => (
              <div className="row">
                {d.clocks.slice(0, 8).map((c) => (
                  <Link key={c.task_id} to={`/security-incidents/${c.incident_id}`}>
                    <Countdown label={c.party} deadline={c.due_at} start={c.incident?.discovered_at ?? null} />
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        )}

        <div className="grid-2">
          {can('tickets.view') && <TicketsByPriority />}
          {can('frameworks.view') && <FrameworkProgress />}

          {seesRisks && (
            <Panel<RiskSummary> title="Top risks" url="/api/risks/summary" to="/risks" linkLabel="Risk register" empty={(d) => d.total === 0}>
              {(d) => (
                <div className="stack">
                  <div className="row">
                    {d.levels.map((l) => <StatusChip key={l.value} color={l.color as never} label={`${l.label}: ${l.count}`} />)}
                  </div>
                  <div className="table-wrap"><table className="table">
                    <thead><tr><th>Risk</th><th>Residual rating</th><th>Owner</th></tr></thead>
                    <tbody>
                      {d.top.slice(0, 5).map((r) => (
                        <tr key={r.id}>
                          <td><Link to={`/risks/${r.id}`}><span className="ref">{r.ref}</span> {r.title}</Link></td>
                          <td><StatusChip color={r.color as never} label={r.rating_label} /></td>
                          <td>{r.owner_name ?? <span className="muted">No owner</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                </div>
              )}
            </Panel>
          )}

          {can('contracts.view') && (
            <Panel<Renewals> title="Contracts approaching notice" url="/api/contracts/renewals" to="/contracts/renewals" linkLabel="Renewal calendar">
              {(d) => {
                const soon = d.contracts.filter((c) => c.days_to_notice <= 120).slice(0, 6);
                return (
                  <div className="stack">
                    {soon.length === 0 ? <p className="muted">No notice dates in the next 120 days.</p> : (
                      <div className="table-wrap"><table className="table">
                        <thead><tr><th>Contract</th><th>Notice date</th><th className="num">Days</th></tr></thead>
                        <tbody>
                          {soon.map((c) => (
                            <tr key={c.id}>
                              <td><Link to={`/contracts/${c.id}`}>{c.vendor_name}</Link></td>
                              <td>{formatDate(c.notice_date)}</td>
                              <td className="num">
                                <StatusChip color={c.days_to_notice < 0 ? 'red' : c.days_to_notice <= 30 ? 'amber' : 'blue'}
                                  label={c.days_to_notice < 0 ? `${-c.days_to_notice} past` : String(c.days_to_notice)} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                    )}
                    {d.undated.length > 0 && (
                      <p className="muted">{d.undated.length} contracts have no notice date recorded yet.</p>
                    )}
                  </div>
                );
              }}
            </Panel>
          )}

          {can('projects.view') && (
            <Panel<Portfolio> title="Projects by status" url="/api/projects/portfolio" to="/projects" linkLabel="Portfolio" empty={(d) => d.register.length === 0}>
              {(d) => (
                <div className="stack">
                  {d.wipWarning && <p><StatusChip color="amber" label={String(d.wipWarning)} /></p>}
                  <div className="row">
                    {d.funnel.map((f) => <StatusChip key={f.stage} color={f.color as never} label={`${f.label}: ${f.count}`} />)}
                  </div>
                  <div className="table-wrap"><table className="table">
                    <thead><tr><th>Project</th><th>Overall</th><th>Trend</th></tr></thead>
                    <tbody>
                      {d.register.slice(0, 7).map((p) => (
                        <tr key={p.id}>
                          <td><Link to={`/projects/${p.id}`}><span className="ref">{p.ref}</span> {p.name}</Link></td>
                          <td>{p.rag_overall
                            ? <StatusChip color={(RAG_COLOR[p.rag_overall] ?? 'gray') as never} label={p.rag_overall} />
                            : <span className="muted">No report</span>}</td>
                          <td>{p.rag_trend ? TREND_ARROW[p.rag_trend] ?? p.rag_trend : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

const mod: ModuleDef = {
  key: 'home',
  nav: [{ group: 'Home', label: 'Overview', path: '/', icon: 'home', order: 0 }],
  routes: [{ path: '/', element: <Home /> }],
};
export default mod;
