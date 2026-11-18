// Overview: the landing page. A greeting, what needs attention, headline numbers, then one panel
// per area. Each part reads another module's summary endpoint and is hidden when the user lacks
// that module's permission.
import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Card, Chart, Countdown, EmptyState, ErrorState, Icon, Loading, ProgressBar, Stat, StatusChip,
  formatDate, statsToData, useAuth, useFetch,
} from '../../core';
import type { ColorName, FetchState, IconName, ModuleDef, StatsResult } from '../../core';
import './home.css';

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

const RAG_COLOR: Record<string, ColorName> = { red: 'red', amber: 'amber', green: 'green' };
const TREND: Record<string, { icon: IconName; label: string }> = {
  improving: { icon: 'arrow-up', label: 'Improving' },
  worsening: { icon: 'arrow-down', label: 'Worsening' },
  steady: { icon: 'minus', label: 'Steady' },
};

/** A card around one already-requested endpoint, with loading, error and empty states. */
function Panel<T>({ title, state, to, linkLabel, empty, emptyTitle, emptyMessage, emptyIcon, wide, children }: {
  title: string; state: FetchState<T>; to?: string; linkLabel?: string;
  empty?: (data: T) => boolean; emptyTitle?: string; emptyMessage?: string; emptyIcon?: IconName; wide?: boolean;
  children: (data: T) => ReactNode;
}) {
  const { data, error, reload } = state;
  return (
    <Card
      title={title}
      className={wide ? 'home-wide' : undefined}
      actions={to ? <Link className="home-more" to={to}>{linkLabel ?? 'Open'}<Icon name="arrow-right" size={14} /></Link> : undefined}
    >
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} />
        : empty?.(data) ? <EmptyState icon={emptyIcon ?? 'check-circle'} title={emptyTitle ?? 'Nothing to show yet'} message={emptyMessage} />
        : children(data)}
    </Card>
  );
}

interface Attention { key: string; count: number; label: string; detail: string; to: string; tone: 'red' | 'amber'; icon: IconName }

/** The strip under the greeting: only things that are late or at risk, each a link to the place to deal with it. */
function NeedsAttention({ items, settled }: { items: Attention[]; settled: boolean }) {
  if (!settled && items.length === 0) return <Loading lines={2} label="Checking what needs attention" />;
  if (items.length === 0) {
    return (
      <p className="home-clear">
        <Icon name="check-circle" size={20} />
        <span><strong>Nothing needs your attention.</strong> No overdue actions, breached tickets, late notifications or missed notice dates.</span>
      </p>
    );
  }
  return (
    <ul className="home-attention">
      {items.map((item) => (
        <li key={item.key}>
          <Link to={item.to} className={`attn attn-${item.tone}`}>
            <span className="attn-count">{item.count}</span>
            <span className="attn-text">
              <span className="attn-head">{item.label.charAt(0).toUpperCase() + item.label.slice(1)}</span>
              <span className="attn-detail">{item.detail}</span>
            </span>
            <Icon name="chevron-right" size={18} className="attn-go" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TicketsByPriority() {
  const navigate = useNavigate();
  const { data, error, reload } = useFetch<StatsResult>('/api/tickets/stats?group=priority&f.resolved_at.null=true');
  const option = useMemo(() => ({
    tooltip: { trigger: 'item' },
    grid: { top: 12, right: 24, bottom: 8, left: 8, containLabel: true },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', inverse: true, data: data?.groups.map((g) => g.label) ?? [] },
    series: [{
      type: 'bar', barMaxWidth: 22, itemStyle: { borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', color: 'var(--text)', textBorderWidth: 0, fontWeight: 600 },
      data: statsToData(data?.groups ?? []),
    }],
  }), [data]);
  return (
    <Card title="Open tickets by priority" actions={<Link className="home-more" to="/tickets">All tickets<Icon name="arrow-right" size={14} /></Link>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} />
        : data.total === 0 ? <EmptyState icon="check-circle" title="No open tickets" message="New requests and incidents will appear here." />
        : <Chart label="Open tickets by priority" option={option} height={Math.max(150, 44 * data.groups.length + 30)}
            onSegmentClick={(seg) => navigate(`/tickets?f.priority=${(seg.data as { key: string }).key}`)} />}
    </Card>
  );
}

function FrameworkProgress() {
  const fw = useFetch<{ rows: { id: string; name: string }[] }>('/api/frameworks?pageSize=1');
  const id = fw.data?.rows[0]?.id;
  const progress = useFetch<Progress>(id ? `/api/frameworks/${id}/progress` : null);
  const none = fw.data !== undefined && !id;
  return (
    <Panel<Progress> title="Framework progress (priority outcomes)" to="/frameworks" linkLabel="Outcomes board"
      state={none ? { ...progress, data: { statuses: [], target: { score: 0 }, series: [] } } : { ...progress, error: fw.error ?? progress.error }}
      empty={(p) => p.series.length === 0} emptyIcon="target" emptyTitle="No outcomes loaded" emptyMessage="Run the seed command to load the framework.">
      {(p) => {
        const now = p.series[p.series.length - 1];
        const first = p.series[0];
        const delta = now.priority.score - first.priority.score;
        return (
          <div className="stack">
            <div className="home-score">
              <span className="home-score-value">{now.priority.score}</span>
              <span className="muted">of 100 · target {p.target.score}</span>
            </div>
            <ProgressBar value={now.priority.score} max={100} hideLabel label={`Score ${now.priority.score} of 100 (target ${p.target.score})`}
              color={now.priority.score >= p.target.score ? 'green' : 'teal'} />
            <p className="muted">
              {delta === 0 ? 'No change' : `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)} points`} since {first.name} ({formatDate(first.date)}).{' '}
              {now.priority.atTargetPct}% of {now.priority.total} priority outcomes are at target.
            </p>
            <div className="row">
              {p.statuses.map((s) => (
                <StatusChip key={s.value} color={s.color as ColorName} label={`${s.label}: ${now.priority.counts[s.value] ?? 0}`} />
              ))}
            </div>
          </div>
        );
      }}
    </Panel>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function Home() {
  const { user, can } = useAuth();
  const seesRisks = can('risks.view') && can('security.view');
  const seesIncidents = can('security.view');
  const tickets = useFetch<TicketMetrics>(can('tickets.view') ? '/api/tickets/metrics' : null);
  const actions = useFetch<ActionSummary>(can('actions.view') ? '/api/actions/summary' : null);
  const clocks = useFetch<Clocks>(seesIncidents ? '/api/security-incidents/clocks' : null);
  const renewals = useFetch<Renewals>(can('contracts.view') ? '/api/contracts/renewals' : null);
  const risks = useFetch<RiskSummary>(seesRisks ? '/api/risks/summary' : null);
  const portfolio = useFetch<Portfolio>(can('projects.view') ? '/api/projects/portfolio' : null);

  useEffect(() => {
    const before = document.title;
    document.title = `Overview · ${before.split(' · ').pop()}`;
    return () => { document.title = before; };
  }, []);

  const attention: Attention[] = [];
  const lateClocks = clocks.data?.summary.red ?? 0;
  const runningClocks = clocks.data?.summary.open ?? clocks.data?.clocks.length ?? 0;
  if (lateClocks > 0) {
    attention.push({ key: 'clocks-late', count: lateClocks, label: lateClocks === 1 ? 'notification overdue' : 'notifications overdue', detail: 'Security incident notification deadlines have passed', to: '/security-incidents', tone: 'red', icon: 'alert' });
  } else if (runningClocks > 0) {
    attention.push({ key: 'clocks', count: runningClocks, label: runningClocks === 1 ? 'notification clock running' : 'notification clocks running', detail: `${clocks.data?.summary.amber ?? 0} close to the deadline`, to: '/security-incidents', tone: 'amber', icon: 'clock' });
  }
  const breaches = tickets.data?.sla.breaches ?? 0;
  if (breaches > 0) attention.push({ key: 'breaches', count: breaches, label: breaches === 1 ? 'ticket past its target' : 'tickets past their target', detail: 'Response or resolution time has been missed', to: '/tickets/dashboard', tone: 'red', icon: 'ticket' });
  const overdue = actions.data?.overdue ?? 0;
  if (overdue > 0) attention.push({ key: 'overdue', count: overdue, label: overdue === 1 ? 'action overdue' : 'actions overdue', detail: `${actions.data?.due_this_week ?? 0} more due this week`, to: '/actions', tone: 'red', icon: 'check-square' });
  const pastNotice = renewals.data?.contracts.filter((c) => c.days_to_notice < 0).length ?? 0;
  if (pastNotice > 0) attention.push({ key: 'notice', count: pastNotice, label: pastNotice === 1 ? 'contract past its notice date' : 'contracts past their notice date', detail: 'The chance to give notice before renewal has gone', to: '/contracts/renewals', tone: 'amber', icon: 'file-text' });
  const unowned = actions.data?.unassigned ?? 0;
  if (unowned > 0) attention.push({ key: 'unowned', count: unowned, label: unowned === 1 ? 'action with no owner' : 'actions with no owner', detail: 'Nobody is responsible for these yet', to: '/actions', tone: 'amber', icon: 'user' });
  const settled = [tickets, actions, clocks, renewals].every((s) => !s.loading);

  const sla = tickets.data?.sla.compliance_pct;
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const firstName = user?.displayName.trim().split(/\s+/)[0];

  return (
    <div className="home stack">
      <header className="home-hero">
        <div>
          <p className="home-date">{today}</p>
          <h1 className="page-title">{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
        </div>
        <p className="muted home-hero-note">
          {attention.length > 0 ? `${attention.length} ${attention.length === 1 ? 'thing needs' : 'things need'} attention today.` : 'Here is where things stand.'}
        </p>
      </header>

      <section aria-label="Needs attention">
        <NeedsAttention items={attention} settled={settled} />
      </section>

      <section aria-label="Headline numbers" className="grid-stats home-stats">
        {tickets.data && <Stat icon="ticket" label="Open tickets" value={tickets.data.open} to="/tickets" color="blue" />}
        {tickets.data && (
          <Stat icon="clock" label="Tickets within target" to="/tickets/dashboard"
            value={sla === null || sla === undefined ? 'n/a' : `${sla}%`}
            color={(sla ?? 100) >= 90 ? 'green' : 'amber'}
            hint={tickets.data.sla.breaches ? `${tickets.data.sla.breaches} missed` : 'None missed'} />
        )}
        {actions.data && <Stat icon="check-square" label="Open actions" value={actions.data.open} to="/actions" color="teal" hint={`${actions.data.due_this_week} due this week`} />}
        {risks.data && <Stat icon="alert" label="Risks on the register" value={risks.data.total} to="/risks" color="purple" />}
        {portfolio.data && <Stat icon="folder" label="Projects" value={portfolio.data.register.length} to="/projects" color="gray" />}
        {renewals.data && (
          <Stat icon="calendar" label="Notice dates in 120 days" to="/contracts/renewals" color="amber"
            value={renewals.data.contracts.filter((c) => c.days_to_notice >= 0 && c.days_to_notice <= 120).length} />
        )}
      </section>

      <div className="grid-2 home-panels">
        {seesIncidents && (clocks.error || (clocks.data && clocks.data.clocks.length > 0)) && (
          <Panel<Clocks> title="Incident notification clocks" state={clocks} to="/security-incidents" linkLabel="Security incidents" wide>
            {(d) => (
              <ul className="home-clocks">
                {d.clocks.slice(0, 8).map((c) => (
                  <li key={c.task_id}>
                    <Link to={`/security-incidents/${c.incident_id}`} className="home-clock">
                      <span className="home-clock-title">
                        {c.incident?.ref && <span className="ref">{c.incident.ref}</span>}
                        {c.incident?.title ?? 'Security incident'}
                      </span>
                      <Countdown label={c.party} deadline={c.due_at} start={c.incident?.discovered_at ?? null} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {can('tickets.view') && <TicketsByPriority />}
        {can('frameworks.view') && <FrameworkProgress />}

        {seesRisks && (
          <Panel<RiskSummary> title="Top risks" state={risks} to="/risks" linkLabel="Risk register"
            empty={(d) => d.total === 0} emptyIcon="shield" emptyTitle="No risks recorded" emptyMessage="Risks added to the register will be ranked here.">
            {(d) => (
              <div className="stack">
                <div className="row">
                  {d.levels.map((l) => <StatusChip key={l.value} color={l.color as ColorName} label={`${l.label}: ${l.count}`} />)}
                </div>
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>Risk</th><th>Residual rating</th><th>Owner</th></tr></thead>
                  <tbody>
                    {d.top.slice(0, 5).map((r) => (
                      <tr key={r.id}>
                        <td><Link to={`/risks/${r.id}`}><span className="ref">{r.ref}</span> {r.title}</Link></td>
                        <td><StatusChip color={r.color as ColorName} label={r.rating_label} /></td>
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
          <Panel<Renewals> title="Contracts approaching notice" state={renewals} to="/contracts/renewals" linkLabel="Renewal calendar">
            {(d) => {
              const soon = d.contracts.filter((c) => c.days_to_notice <= 120).slice(0, 6);
              return (
                <div className="stack">
                  {soon.length === 0 ? <EmptyState icon="calendar" title="No notice dates in the next 120 days" /> : (
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
          <Panel<Portfolio> title="Projects by status" state={portfolio} to="/projects" linkLabel="Portfolio"
            empty={(d) => d.register.length === 0} emptyIcon="folder" emptyTitle="No projects yet" emptyMessage="Projects appear here once they are proposed.">
            {(d) => (
              <div className="stack">
                {d.wipWarning && <p><StatusChip color="amber" label={String(d.wipWarning)} /></p>}
                <div className="row">
                  {d.funnel.map((f) => <StatusChip key={f.stage} color={f.color as ColorName} label={`${f.label}: ${f.count}`} />)}
                </div>
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>Project</th><th>Overall</th><th>Trend</th></tr></thead>
                  <tbody>
                    {d.register.slice(0, 7).map((p) => {
                      const trend = p.rag_trend ? TREND[p.rag_trend] : undefined;
                      return (
                        <tr key={p.id}>
                          <td><Link to={`/projects/${p.id}`}><span className="ref">{p.ref}</span> {p.name}</Link></td>
                          <td>{p.rag_overall
                            ? <StatusChip color={RAG_COLOR[p.rag_overall] ?? 'gray'} label={p.rag_overall.charAt(0).toUpperCase() + p.rag_overall.slice(1)} />
                            : <span className="muted">No report</span>}</td>
                          <td>{trend
                            ? <span className="home-trend"><Icon name={trend.icon} size={14} />{trend.label}</span>
                            : p.rag_trend ?? ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

const mod: ModuleDef = {
  key: 'home',
  nav: [{ group: 'Home', label: 'Overview', path: '/', icon: 'home', order: 0 }],
  routes: [{ path: '/', element: <Home /> }],
};
export default mod;
