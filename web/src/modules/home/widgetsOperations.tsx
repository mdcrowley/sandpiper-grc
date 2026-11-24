// Dashboard panels for the service desk, frameworks, risks, security incidents, contracts and projects.
import { Link, useNavigate } from 'react-router-dom';
import {
  Card, Countdown, EmptyState, ErrorState, Icon, Loading, ProgressBar, StatusChip,
  formatDate, listQuery, TableWrap, toColorName, useFetch,
} from '../../core';
import type { ColorName, IconName, StatsResult } from '../../core';
import { GroupBars } from './charts';
import { MoreLink, Panel } from './parts';
import { useSource } from './sources';
import type { WidgetDef } from './types';

interface Tally { total: number; counts: Record<string, number>; score: number; atTargetPct: number }
interface Progress {
  statuses: { value: string; label: string; color: string }[];
  target: { score: number };
  series: { name: string; date: string; current: boolean; all: Tally; priority: Tally }[];
}

const RAG_COLOR: Record<string, ColorName> = { red: 'red', amber: 'amber', green: 'green' };
const TREND: Record<string, { icon: IconName; label: string }> = {
  improving: { icon: 'arrow-up', label: 'Improving' },
  worsening: { icon: 'arrow-down', label: 'Worsening' },
  steady: { icon: 'minus', label: 'Steady' },
};

function IncidentClocks() {
  const clocks = useSource('clocks');
  return (
    <Panel title="Incident notification clocks" state={clocks} to="/security-incidents" linkLabel="Security incidents"
      empty={(d) => d.clocks.length === 0} emptyTitle="No notification clocks are running"
      emptyMessage="Deadlines to notify people outside the organization appear here when a security incident is declared.">
      {(d) => (
        <ul className="home-clocks">
          {d.clocks.slice(0, 8).map((c) => (
            <li key={c.task_id}>
              <Link to={`/security-incidents/${c.incident_id}`} className="home-clock">
                <span className="home-clock-title">
                  {c.incident?.ref && <span className="ref">{c.incident.ref}</span>}{' '}
                  {c.incident?.title ?? 'Security incident'}
                </span>
                <Countdown label={c.party} deadline={c.due_at} start={c.incident?.discovered_at ?? null} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TicketsByPriority() {
  const navigate = useNavigate();
  const open = { 'resolved_at.null': true };
  const { data, error, reload } = useFetch<StatsResult>(`/api/tickets/stats${listQuery({ filters: open }, { group: 'priority' })}`);
  return (
    <Card title="Open tickets by priority" className="home-panel"
      actions={<MoreLink to={`/tickets${listQuery({ filters: open })}`}>Open tickets</MoreLink>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} />
        : data.total === 0 ? <EmptyState icon="check-circle" title="No open tickets" message="New requests and incidents will appear here." />
        : (
          <GroupBars label="Open tickets by priority" description="Select a bar to open the tickets of that priority." groups={data.groups}
            onPick={(key) => navigate(`/tickets${listQuery({ filters: key ? { ...open, priority: key } : { ...open, 'priority.null': true } })}`)} />
        )}
    </Card>
  );
}

function FrameworkProgress() {
  const fw = useFetch<{ rows: { id: string; name: string }[] }>('/api/frameworks?pageSize=1');
  const id = fw.data?.rows[0]?.id;
  const progress = useFetch<Progress>(id ? `/api/frameworks/${id}/progress` : null);
  const none = fw.data !== undefined && !id;
  const state = none
    ? { ...progress, data: { statuses: [], target: { score: 0 }, series: [] } as Progress }
    : { ...progress, error: fw.error ?? progress.error, reload: () => { fw.reload(); progress.reload(); } };
  return (
    <Panel<Progress> title="Framework progress (priority outcomes)" to="/frameworks" linkLabel="Outcomes board" state={state}
      empty={(p) => p.series.length === 0} emptyIcon="target" emptyTitle="No outcomes loaded"
      emptyMessage="Progress appears here once a framework and its outcomes have been loaded.">
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
                <StatusChip key={s.value} color={toColorName(s.color)} label={`${s.label}: ${now.priority.counts[s.value] ?? 0}`} />
              ))}
            </div>
          </div>
        );
      }}
    </Panel>
  );
}

function TopRisks() {
  const risks = useSource('risks');
  return (
    <Panel title="Top risks" state={risks} to="/risks" linkLabel="Risk register"
      empty={(d) => d.total === 0} emptyIcon="shield" emptyTitle="No risks recorded" emptyMessage="Risks added to the register will be ranked here.">
      {(d) => (
        <div className="stack">
          <div className="row">
            {d.levels.map((l) => <StatusChip key={l.value} color={toColorName(l.color)} label={`${l.label}: ${l.count}`} />)}
          </div>
          <TableWrap fit label="Top risks"><table className="table">
            <thead><tr><th>Risk</th><th data-priority={1}>Residual rating</th><th>Owner</th></tr></thead>
            <tbody>
              {d.top.slice(0, 5).map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/risks/${r.id}`}><span className="ref">{r.ref}</span> {r.title}</Link></td>
                  <td><StatusChip color={toColorName(r.color)} label={r.rating_label} /></td>
                  <td>{r.owner_name ?? <span className="muted">No owner</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></TableWrap>
        </div>
      )}
    </Panel>
  );
}

function ContractNotice() {
  const renewals = useSource('renewals');
  return (
    <Panel title="Contracts approaching notice" state={renewals} to="/contracts/renewals" linkLabel="Renewal calendar">
      {(d) => {
        const soon = d.contracts.filter((c) => c.days_to_notice <= 120).slice(0, 6);
        return (
          <div className="stack">
            {soon.length === 0 ? <EmptyState icon="calendar" title="No notice dates in the next 120 days" /> : (
              <TableWrap fit label="Contracts approaching notice"><table className="table">
                <thead><tr><th>Contract</th><th>Notice date</th><th className="num" data-priority={1}>Days</th></tr></thead>
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
              </table></TableWrap>
            )}
            {d.undated.length > 0 && (
              <p className="muted">{d.undated.length} {d.undated.length === 1 ? 'contract has' : 'contracts have'} no notice date recorded yet.</p>
            )}
          </div>
        );
      }}
    </Panel>
  );
}

function ProjectsByStatus() {
  const portfolio = useSource('portfolio');
  return (
    <Panel title="Projects by status" state={portfolio} to="/projects" linkLabel="Portfolio"
      empty={(d) => d.register.length === 0} emptyIcon="folder" emptyTitle="No projects yet" emptyMessage="Projects appear here once they are proposed.">
      {(d) => (
        <div className="stack">
          {d.wipWarning && <p><StatusChip color="amber" label={String(d.wipWarning)} /></p>}
          <div className="row">
            {d.funnel.map((f) => <StatusChip key={f.stage} color={toColorName(f.color)} label={`${f.label}: ${f.count}`} />)}
          </div>
          <TableWrap fit label="Projects by status"><table className="table">
            <thead><tr><th>Project</th><th data-priority={1}>Overall</th><th>Trend</th></tr></thead>
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
          </table></TableWrap>
        </div>
      )}
    </Panel>
  );
}

export const OPERATIONS_WIDGETS: WidgetDef[] = [
  {
    id: 'incident-clocks', title: 'Incident notification clocks', group: 'dashboard', wide: true, sources: ['clocks'],
    description: 'Deadlines to notify outside parties about a security incident.',
    visible: (ctx) => ctx.sees('security_incident'), render: () => <IncidentClocks />,
  },
  {
    id: 'tickets-priority', title: 'Open tickets by priority', group: 'dashboard',
    description: 'A chart of open tickets; select a bar to open that list.',
    visible: (ctx) => ctx.sees('ticket'), render: () => <TicketsByPriority />,
  },
  {
    id: 'framework-progress', title: 'Framework progress', group: 'dashboard',
    description: 'The score for priority outcomes against the target.',
    visible: (ctx) => ctx.sees('framework'), render: () => <FrameworkProgress />,
  },
  {
    id: 'top-risks', title: 'Top risks', group: 'dashboard', sources: ['risks'],
    description: 'The highest-rated risks on the register.',
    visible: (ctx) => ctx.sees('risk'), render: () => <TopRisks />,
  },
  {
    id: 'contract-notice', title: 'Contracts approaching notice', group: 'dashboard', sources: ['renewals'],
    description: 'Contracts whose notice date falls in the next 120 days.',
    visible: (ctx) => ctx.sees('contract'), render: () => <ContractNotice />,
  },
  {
    id: 'projects-status', title: 'Projects by status', group: 'dashboard', sources: ['portfolio'],
    description: 'Projects by stage, with their latest overall status.',
    visible: (ctx) => ctx.sees('project'), render: () => <ProjectsByStatus />,
  },
];
