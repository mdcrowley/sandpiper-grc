// Dashboard panels for changes, policies, training and vulnerabilities.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Card, EmptyState, ErrorState, Loading, LookupChip, ProgressBar, StatusChip,
  formatDateTime, listQuery, toColorName, useFetch, useLookup,
} from '../../core';
import type { ColorName, ListResult, StatsResult } from '../../core';
import { GroupBars } from './charts';
import { MoreLink, Panel } from './parts';
import { thisWeek, useSource } from './sources';
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

function ChangesThisWeek() {
  const overview = useSource('changes');
  const week = useMemo(() => thisWeek(), []);
  const statuses = useLookup('change_status');
  // Planned to start this week, leaving out changes that will not happen.
  const live = statuses.map((s) => s.value).filter((v) => !['cancelled', 'rejected'].includes(v));
  const list = useFetch<ListResult>(`/api/changes${listQuery({
    sort: 'planned_start', dir: 'asc', pageSize: 6,
    filters: { 'planned_start.gte': week.from, 'planned_start.lt': week.to, status: live.length ? live : undefined },
  })}`);
  const error = overview.error ?? list.error;
  const o = overview.data;
  const rows = list.data?.rows;
  return (
    <Card title="Changes this week" className="home-panel" actions={<MoreLink to="/changes?view=week">This week's changes</MoreLink>}>
      {error ? <ErrorState error={error} onRetry={() => { overview.reload(); list.reload(); }} />
        : !o || !rows ? <Loading lines={4} />
        : (
          <div className="stack">
            <div className="home-figures">
              <Figure value={o.this_week} label="Planned this week" to="/changes?view=week" />
              <Figure value={o.awaiting_approval} label="Awaiting approval" to="/changes?view=awaiting" tone={o.awaiting_approval ? 'blue' : undefined} />
              <Figure value={o.in_progress} label="In progress" to="/changes?f.status=in_progress" />
              <Figure value={o.review_due} label="Review due" to="/changes?f.status=completed&f.pir_required=true" tone={o.review_due ? 'red' : undefined} />
            </div>
            {rows.length === 0 ? (
              <EmptyState icon="calendar" title="No changes are planned for this week"
                message={o.awaiting_approval ? `${o.awaiting_approval} ${o.awaiting_approval === 1 ? 'change is' : 'changes are'} waiting for approval.` : undefined} />
            ) : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Change</th><th>Planned start</th><th>Status</th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td><Link to={`/changes/${c.id}`}><span className="ref">{c.ref}</span> {c.title}</Link></td>
                      <td>{formatDateTime(c.planned_start)}</td>
                      <td><LookupChip list="change_status" value={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            {list.data && list.data.total > rows.length && (
              <p className="muted"><Link to="/changes?view=week">and {list.data.total - rows.length} more this week</Link></p>
            )}
          </div>
        )}
    </Card>
  );
}

function PoliciesByStatus() {
  const navigate = useNavigate();
  const { data, error, reload } = useFetch<StatsResult>('/api/policies/stats?group=status');
  return (
    <Card title="Policies by status" className="home-panel" actions={<MoreLink to="/policies">Policy library</MoreLink>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} />
        : data.total === 0 ? <EmptyState icon="file-text" title="No policies yet" message="Policies appear here once they are written." />
        : (
          <GroupBars label="Policies by status" description="Select a bar to open the policies with that status." groups={data.groups}
            onPick={(key) => navigate(`/policies${listQuery({ filters: key ? { status: key } : { 'status.null': true } })}`)} />
        )}
    </Card>
  );
}

function TrainingCompletion() {
  const training = useSource('training');
  return (
    <Panel title="Training completion" state={training} to="/training" linkLabel="Training overview"
      empty={(d) => d.totals.total === 0} emptyIcon="graduation" emptyTitle="No training assigned yet"
      emptyMessage="Completion appears here once courses are assigned to people.">
      {(d) => {
        const t = d.totals;
        const rate = t.rate ?? 0;
        return (
          <div className="stack">
            <div className="home-score">
              <span className="home-score-value">{rate}%</span>
              <span className="muted">complete · {t.people} {t.people === 1 ? 'person' : 'people'}, {t.courses} active {t.courses === 1 ? 'course' : 'courses'}</span>
            </div>
            <ProgressBar value={t.complete} max={t.total} hideLabel label={`${t.complete} of ${t.total} assignments complete`}
              color={t.overdue ? 'amber' : 'green'} />
            <div className="row">
              <StatusChip color="green" label={`Complete: ${t.complete}`} />
              <StatusChip color="blue" label={`Due: ${t.due}`} />
              <StatusChip color={t.overdue ? 'red' : 'gray'} label={`Overdue: ${t.overdue}`} />
            </div>
          </div>
        );
      }}
    </Panel>
  );
}

function VulnerabilitiesBySeverity() {
  const navigate = useNavigate();
  const summary = useSource('vulnerabilities');
  const data = summary.data;
  const groups = useMemo((): StatsResult['groups'] => (data?.severities ?? []).map((s) => ({
    value: s.value, label: s.label, color: s.color,
    count: data?.openBySeverity.find((x) => x.severity === s.value)?.count ?? 0,
  })), [data]);
  const open = { closed: 'false' };
  return (
    <Panel title="Open vulnerabilities by severity" state={summary} to="/vulnerabilities/dashboard" linkLabel="Vulnerability dashboard"
      empty={(d) => d.totals.open === 0} emptyTitle="No open vulnerabilities" emptyMessage="Findings that still need fixing appear here.">
      {(d) => {
        const late = d.overdueBySeverity.filter((x) => x.count > 0);
        const sev = (value: string) => d.severities.find((s) => s.value === value);
        return (
          <div className="stack">
            <div className="home-figures">
              <Figure value={d.totals.open} label="Open" to={`/vulnerabilities${listQuery({ filters: open })}`} />
              <Figure value={d.totals.overdue} label="Past the fix-by date" tone={d.totals.overdue ? 'red' : undefined}
                to={`/vulnerabilities${listQuery({ filters: { ...open, overdue: 'true' } })}`} />
              <Figure value={d.totals.knownExploitedOpen} label="Known to be exploited" tone={d.totals.knownExploitedOpen ? 'orange' : undefined}
                to={`/vulnerabilities${listQuery({ filters: { ...open, known_exploited: 'true' } })}`} />
            </div>
            <GroupBars label="Open vulnerabilities by severity" description="Select a bar to open the findings of that severity." groups={groups}
              onPick={(key) => key && navigate(`/vulnerabilities${listQuery({ filters: { ...open, severity: key } })}`)} />
            {late.length > 0 && (
              <div className="row" aria-label="Overdue by severity">
                <span className="muted">Overdue:</span>
                {late.map((x) => (
                  <Link key={x.severity} className="home-chip-link"
                    to={`/vulnerabilities${listQuery({ filters: { ...open, overdue: 'true', severity: x.severity } })}`}>
                    <StatusChip color={toColorName(sev(x.severity)?.color)} label={`${sev(x.severity)?.label ?? x.severity}: ${x.count}`} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      }}
    </Panel>
  );
}

export const NEWER_WIDGETS: WidgetDef[] = [
  {
    id: 'changes-week', title: 'Changes this week', group: 'dashboard', sources: ['changes'],
    description: 'Changes planned to start this week, and how many are awaiting approval.',
    visible: (ctx) => ctx.sees('change'), render: () => <ChangesThisWeek />,
  },
  {
    id: 'vulnerabilities-severity', title: 'Open vulnerabilities by severity', group: 'dashboard', sources: ['vulnerabilities'],
    description: 'Open findings by severity, with those past their fix-by date.',
    visible: (ctx) => ctx.sees('vulnerability'), render: () => <VulnerabilitiesBySeverity />,
  },
  {
    id: 'training-completion', title: 'Training completion', group: 'dashboard', sources: ['training'],
    description: 'How much assigned training is complete, due and overdue.',
    visible: (ctx) => ctx.sees('course'), render: () => <TrainingCompletion />,
  },
  {
    id: 'policies-status', title: 'Policies by status', group: 'dashboard',
    description: 'A chart of policies by status; select a bar to open that list.',
    visible: (ctx) => ctx.sees('policy'), render: () => <PoliciesByStatus />,
  },
];
