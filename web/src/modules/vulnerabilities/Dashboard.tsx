// Vulnerability dashboard: every number and chart segment opens the findings behind it.
import { useMemo, useState } from 'react';
import { SegmentedControl } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button, Card, Chart, chartColor, EmptyState, ErrorState, formatDate, Loading, PageHeader, Stat, TableWrap, useFetch,
} from '../../core';
import type { ChartOption } from '../../core';
import { ageFilters, fixedThisMonthLink, listLink, SectionTabs, SeverityChip, useVulnAccess } from './shared';
import type { OverdueGroup, OverdueReport, Summary } from './shared';

const GAP = { borderColor: 'var(--surface)', borderWidth: 1 };

function useCharts(s: Summary | undefined) {
  return useMemo(() => {
    const sev = s?.severities ?? [];
    const bySeverity = (rows: { severity: string; count: number }[]): ChartOption => ({
      tooltip: { trigger: 'item' },
      xAxis: { type: 'category', data: sev.map((x) => x.label), axisLabel: { interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{
        type: 'bar', barMaxWidth: 44,
        label: { show: true, position: 'top', color: 'var(--text-muted)' },
        data: s ? sev.map((x) => ({ name: x.label, value: rows.find((r) => r.severity === x.value)?.count ?? 0, key: x.value, itemStyle: { color: chartColor(x.color) } })) : [],
      }],
    });
    const age: ChartOption = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0 },
      grid: { top: 24, right: 16, bottom: 64, left: 48 },
      xAxis: { type: 'category', data: (s?.ageBuckets ?? []).map((b) => b.label), axisLabel: { interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: sev.map((x) => ({
        name: x.label, type: 'bar', stack: 'age', barMaxWidth: 44, color: chartColor(x.color),
        itemStyle: { ...GAP, borderRadius: 2 },
        data: (s?.ageBuckets ?? []).map((b) => b.bySeverity[x.value] ?? 0),
      })),
    };
    const weeks = s?.trend ?? [];
    const trend: ChartOption = {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0 },
      grid: { top: 24, right: 16, bottom: 64, left: 48 },
      xAxis: { type: 'category', boundaryGap: false, data: weeks.map((w) => formatDate(w.week_start).replace(/ \d{4}$/, '')) },
      yAxis: { type: 'value', minInterval: 1 },
      series: sev.map((x) => ({
        name: x.label, type: 'line', stack: 'open', color: chartColor(x.color),
        areaStyle: { opacity: 0.3 }, showSymbol: weeks.length < 16,
        data: weeks.map((w) => w.bySeverity[x.value] ?? 0),
      })),
    };
    return { open: bySeverity(s?.openBySeverity ?? []), overdue: bySeverity(s?.overdueBySeverity ?? []), age, trend };
  }, [s]);
}

/** Overdue findings for each owner, or for each system owner: who to ask about what is late. */
function OverdueCard({ summary }: { summary: Summary | undefined }) {
  const [group, setGroup] = useState<'owner' | 'system_owner'>('owner');
  const { data, error, reload } = useFetch<OverdueReport>(`/api/vulnerabilities/overdue-report?group=${group}`, { keepPrevious: true });
  const lead = (summary?.severities ?? []).slice(0, 2);
  const link = (g: OverdueGroup, severity?: string) => listLink({
    overdue: 'true', severity,
    ...(group === 'owner'
      ? (g.ownerId ? { owner_id: g.ownerId } : { 'owner_id.null': 'true' })
      : (g.kind === 'no_system' ? { 'system_id.null': 'true' } : { system_id: g.systemIds.join(',') })),
  });
  const count = (g: OverdueGroup, n: number, severity?: string) => (n ? <Link to={link(g, severity)}>{n}</Link> : <span className="muted">0</span>);
  const others = (g: OverdueGroup) => g.total - lead.reduce((n, x) => n + (g.bySeverity[x.value] ?? 0), 0);

  return (
    <Card title="Overdue findings" flush
      actions={summary?.systemOwnerReport ? (
        <SegmentedControl size="xs" aria-label="Group overdue findings by" value={group} onChange={(v) => setGroup(v as typeof group)}
          data={[{ value: 'owner', label: 'By owner' }, { value: 'system_owner', label: 'By system owner' }]} />
      ) : undefined}>
      {error && !data ? <div className="vuln-pad"><ErrorState title="The overdue report could not be loaded" error={error} onRetry={reload} /></div>
        : !data ? <div className="vuln-pad"><Loading lines={4} label="Loading the overdue report" /></div>
        : data.groups.length === 0 ? <EmptyState icon="check-circle" title="Nothing is overdue" message="Every open finding is inside its fix-by date." />
        : (
          <>
            <TableWrap label={`Overdue findings for each ${group === 'owner' ? 'owner' : 'system owner'}`} className="vuln-tw">
              <table className="table">
                <caption className="sr-only">Overdue findings for each {group === 'owner' ? 'owner' : 'system owner'}</caption>
                <thead>
                  <tr>
                    <th scope="col">{group === 'owner' ? 'Owner' : 'System owner'}</th>
                    {lead.map((x) => <th key={x.value} scope="col" className="num">{x.label}</th>)}
                    <th scope="col" className="num">Other</th>
                    <th scope="col" className="num">All overdue</th>
                    <th scope="col">Oldest fix-by date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((g) => (
                    <tr key={g.key}>
                      <th scope="row" className={g.kind === 'person' ? undefined : 'muted'}>{g.name}</th>
                      {lead.map((x) => <td key={x.value} className="num">{count(g, g.bySeverity[x.value] ?? 0, x.value)}</td>)}
                      <td className="num">{others(g) || <span className="muted">0</span>}</td>
                      <td className="num"><strong>{count(g, g.total)}</strong></td>
                      <td>{formatDate(g.oldestDue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="muted vuln-pad vuln-note">
              {group === 'owner'
                ? 'Grouped by the owner of each finding.'
                : 'Grouped by the owner of the system each finding is on: the technical owner, or the business owner when there is none.'}
            </p>
          </>
        )}
    </Card>
  );
}

export function VulnerabilityDashboard() {
  const navigate = useNavigate();
  const access = useVulnAccess();
  const { data, error, loading, reload } = useFetch<Summary>('/api/vulnerabilities/summary');
  const s = data ?? undefined;
  const charts = useCharts(s);

  const header = (
    <>
      <PageHeader title="Vulnerability dashboard"
        subtitle={s ? `Open findings by severity and age, what is overdue, and how the total is moving. As of ${formatDate(s.today)}.` : 'Open findings by severity and age, what is overdue, and how the total is moving.'}
        breadcrumbs={[{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: 'Dashboard' }]}
        actions={<Button icon="refresh" loading={loading && !!data} onClick={reload}>Refresh</Button>} />
      <SectionTabs active="dashboard" />
    </>
  );
  if (error && !data) return <div className="stack">{header}<ErrorState title="The dashboard could not be loaded" error={error} onRetry={reload} /></div>;

  if (s && s.totals.open === 0 && !s.mttr.some((m) => m.fixed > 0) && s.trend.every((w) => w.total === 0)) {
    return (
      <div className="stack">
        {header}
        <EmptyState icon="bug" title="No findings yet"
          message="Import a scanner export or add a finding by hand, and the dashboard fills in."
          action={access.importFindings ? <Link className="btn btn-primary" to="/vulnerabilities/import">Import findings</Link> : undefined} />
      </div>
    );
  }

  const sevByLabel = (label?: string) => s?.severities.find((x) => x.label === label)?.value;
  const openOf = (sev: string) => s?.openBySeverity.find((r) => r.severity === sev)?.count ?? 0;
  const overdueOf = (sev: string) => s?.overdueBySeverity.find((r) => r.severity === sev)?.count ?? 0;
  const last = s?.trend[s.trend.length - 1];
  const prev = s?.trend[s.trend.length - 2];
  const change = last && prev ? last.total - prev.total : null;
  const t = s?.totals;

  return (
    <div className="stack">
      {header}
      <div className="grid-stats">
        <Stat label="Open findings" value={t?.open ?? '–'} to={listLink({ closed: 'false' })} icon="bug"
          trend={change === null ? undefined : {
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
            label: change === 0 ? 'Same as last week' : `${Math.abs(change)} ${change > 0 ? 'more' : 'fewer'} than last week`,
            tone: change > 0 ? 'bad' : change < 0 ? 'good' : 'neutral',
          }} />
        <Stat label="Overdue" value={t?.overdue ?? '–'} color={t?.overdue ? 'red' : undefined} to={listLink({ overdue: 'true' })} icon="clock" hint="Past the fix-by date" />
        <Stat label="Known exploited, open" value={t?.knownExploitedOpen ?? '–'} color={t?.knownExploitedOpen ? 'red' : undefined}
          to={listLink({ closed: 'false', known_exploited: 'true' })} icon="alert" hint="Fix these first" />
        <Stat label="Open without an owner" value={t?.unassignedOpen ?? '–'} color={t?.unassignedOpen ? 'amber' : undefined}
          to={listLink({ closed: 'false', 'owner_id.null': 'true' })} icon="user" hint="Nobody is assigned" />
        <Stat label="Fixed this month" value={t?.fixedThisMonth ?? '–'} color="green" to={fixedThisMonthLink()} icon="check" hint="Closed as fixed" />
      </div>

      <div className="vuln-grid">
        <Card title="Open by severity">
          <Chart label="Open findings by severity" option={charts.open} height={240} loading={!s} emptyMessage="No open findings"
            empty={s ? s.totals.open === 0 : undefined}
            onSegmentClick={(seg) => navigate(listLink({ closed: 'false', severity: (seg.data as { key: string }).key }))} />
        </Card>
        <Card title="Overdue by severity">
          <Chart label="Overdue findings by severity" option={charts.overdue} height={240} loading={!s}
            empty={s ? s.totals.overdue === 0 : undefined} emptyMessage="Nothing is overdue: every open finding is inside its fix-by date"
            onSegmentClick={(seg) => navigate(listLink({ overdue: 'true', severity: (seg.data as { key: string }).key }))} />
        </Card>
      </div>

      <div className="vuln-grid">
        <Card title="Open by age">
          <Chart label="Open findings by age in days, stacked by severity" option={charts.age} height={280} loading={!s} emptyMessage="No open findings"
            empty={s ? s.totals.open === 0 : undefined}
            onSegmentClick={(seg) => {
              const b = s?.ageBuckets[seg.dataIndex];
              if (s && b) navigate(listLink({ closed: 'false', ...ageFilters(s.today, b.min, b.max), severity: sevByLabel(seg.seriesName) }));
            }} />
          <p className="muted vuln-note">Age is counted from the day a finding was first seen.</p>
        </Card>
        <Card title="Open findings by week">
          <Chart label="Open findings at the end of each week, stacked by severity" option={charts.trend} height={280} loading={!s}
            empty={s ? s.trend.length < 2 : undefined}
            emptyMessage="The trend starts here: open findings are counted every day and kept by week, so the line appears next week"
            onSegmentClick={(seg) => navigate(listLink({ closed: 'false', severity: sevByLabel(seg.seriesName) }))} />
          <p className="muted vuln-note">Counted from stored weekly snapshots. A point opens today's open findings of that severity.</p>
        </Card>
      </div>

      <OverdueCard summary={s} />

      <div className="vuln-grid">
        <Card title="By severity" flush>
          {!s ? <div className="vuln-pad"><Loading lines={5} label="Loading the figures" /></div> : (
            <TableWrap label="Open, overdue and time to fix for each severity" className="vuln-tw">
              <table className="table">
                <caption className="sr-only">Open, overdue and time to fix for each severity</caption>
                <thead>
                  <tr><th scope="col">Severity</th><th scope="col" className="num">Open</th><th scope="col" className="num">Overdue</th><th scope="col" className="num">Mean days to fix</th><th scope="col" className="num">Fixed</th></tr>
                </thead>
                <tbody>
                  {s.severities.map((x) => {
                    const m = s.mttr.find((r) => r.severity === x.value);
                    return (
                      <tr key={x.value}>
                        <td><SeverityChip value={x.value} /></td>
                        <td className="num"><Link to={listLink({ closed: 'false', severity: x.value })}>{openOf(x.value)}</Link></td>
                        <td className="num"><Link to={listLink({ overdue: 'true', severity: x.value })}>{overdueOf(x.value)}</Link></td>
                        <td className="num">{m?.days ?? '—'}</td>
                        <td className="num"><Link to={listLink({ status: 'fixed', severity: x.value })}>{m?.fixed ?? 0}</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        <Card title="Hosts with the most serious open findings" flush>
          {!s ? <div className="vuln-pad"><Loading lines={5} label="Loading the hosts" /></div>
            : s.topHosts.length === 0 ? <EmptyState icon="server" title="No open findings on any host" /> : (
              <TableWrap label="Ten hosts with the worst open findings" className="vuln-tw">
                <table className="table">
                  <caption className="sr-only">Ten hosts with the worst open findings</caption>
                  <thead>
                    <tr>
                      <th scope="col">Host</th>
                      {s.severities.slice(0, 3).map((x) => <th key={x.value} scope="col" className="num">{x.label}</th>)}
                      <th scope="col" className="num">All open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.topHosts.map((h) => (
                      <tr key={h.host_key}>
                        <td><Link className="row-title" to={listLink({ closed: 'false', host_key: h.host_key })}>{h.host}</Link></td>
                        {s.severities.slice(0, 3).map((x) => <td key={x.value} className="num">{h.bySeverity[x.value] || <span className="muted">0</span>}</td>)}
                        <td className="num"><strong>{h.total}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
        </Card>
      </div>
    </div>
  );
}
