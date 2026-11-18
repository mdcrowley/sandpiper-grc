// Vulnerability dashboard: every number and chart segment opens the findings behind it.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Card, Chart, chartColor, EmptyState, ErrorState, formatDate, Loading, PageHeader, Stat, useFetch,
} from '../../core';
import type { ChartOption } from '../../core';
import { listLink, SectionTabs, SeverityChip, useVulnAccess } from './shared';
import type { Summary } from './shared';

const GAP = { borderColor: 'var(--surface)', borderWidth: 1 };

function useCharts(s: Summary | undefined) {
  return useMemo(() => {
    if (!s) return null;
    const sev = s.severities;
    const bySeverity = (rows: { severity: string; count: number }[]): ChartOption => ({
      tooltip: { trigger: 'item' },
      xAxis: { type: 'category', data: sev.map((x) => x.label), axisLabel: { interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{
        type: 'bar', barMaxWidth: 44,
        label: { show: true, position: 'top', color: 'var(--text-muted)' },
        data: sev.map((x) => ({ name: x.label, value: rows.find((r) => r.severity === x.value)?.count ?? 0, key: x.value, itemStyle: { color: chartColor(x.color) } })),
      }],
    });
    const age: ChartOption = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0 },
      grid: { top: 24, right: 16, bottom: 64, left: 48 },
      xAxis: { type: 'category', data: s.ageBuckets.map((b) => b.label), axisLabel: { interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: sev.map((x) => ({
        name: x.label, type: 'bar', stack: 'age', barMaxWidth: 44, color: chartColor(x.color),
        itemStyle: { ...GAP, borderRadius: 2 },
        data: s.ageBuckets.map((b) => b.bySeverity[x.value] ?? 0),
      })),
    };
    const trend: ChartOption = {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0 },
      grid: { top: 24, right: 16, bottom: 64, left: 48 },
      xAxis: { type: 'category', boundaryGap: false, data: s.trend.map((w) => formatDate(w.week_start).replace(/ \d{4}$/, '')) },
      yAxis: { type: 'value', minInterval: 1 },
      series: sev.map((x) => ({
        name: x.label, type: 'line', stack: 'open', color: chartColor(x.color),
        areaStyle: { opacity: 0.3 }, showSymbol: s.trend.length < 16,
        data: s.trend.map((w) => w.bySeverity[x.value] ?? 0),
      })),
    };
    return { open: bySeverity(s.openBySeverity), overdue: bySeverity(s.overdueBySeverity), age, trend };
  }, [s]);
}

export function VulnerabilityDashboard() {
  const navigate = useNavigate();
  const access = useVulnAccess();
  const { data, error, reload } = useFetch<Summary>('/api/vulnerabilities/summary');
  const charts = useCharts(data ?? undefined);

  const header = (
    <>
      <PageHeader title="Vulnerability dashboard" subtitle="Open findings by severity and age, what is overdue, and how the total is moving."
        breadcrumbs={[{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: 'Dashboard' }]} />
      <SectionTabs active="dashboard" />
    </>
  );
  if (error && !data) return <div className="stack">{header}<ErrorState title="The dashboard could not be loaded" error={error} onRetry={reload} /></div>;
  if (!data || !charts) return <div className="stack">{header}<Loading lines={8} label="Loading the dashboard" /></div>;

  const s = data;
  const everFixed = s.mttr.some((m) => m.fixed > 0);
  if (s.totals.open === 0 && !everFixed && s.trend.every((w) => w.total === 0)) {
    return (
      <div className="stack">
        {header}
        <EmptyState icon="bug" title="No findings yet"
          message="Import a scanner export or add a finding by hand, and the dashboard fills in."
          action={access.importFindings ? <Link className="btn btn-primary" to="/vulnerabilities/import">Import findings</Link> : undefined} />
      </div>
    );
  }

  const sevByLabel = (label?: string) => s.severities.find((x) => x.label === label)?.value;
  const openOf = (sev: string) => s.openBySeverity.find((r) => r.severity === sev)?.count ?? 0;
  const overdueOf = (sev: string) => s.overdueBySeverity.find((r) => r.severity === sev)?.count ?? 0;
  const last = s.trend[s.trend.length - 1];
  const prev = s.trend[s.trend.length - 2];
  const change = last && prev ? last.total - prev.total : null;

  return (
    <div className="stack">
      {header}
      <div className="grid-stats">
        <Stat label="Open findings" value={s.totals.open} to={listLink({ closed: 'false' })} icon="bug"
          trend={change === null ? undefined : {
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
            label: change === 0 ? 'Same as last week' : `${Math.abs(change)} ${change > 0 ? 'more' : 'fewer'} than last week`,
            tone: change > 0 ? 'bad' : change < 0 ? 'good' : 'neutral',
          }} />
        <Stat label="Overdue" value={s.totals.overdue} color={s.totals.overdue ? 'red' : undefined} to={listLink({ overdue: 'true' })} icon="clock" hint="Past the fix-by date" />
        <Stat label="Known exploited, open" value={s.totals.knownExploitedOpen} color={s.totals.knownExploitedOpen ? 'red' : undefined}
          to={listLink({ closed: 'false', known_exploited: 'true' })} icon="alert" hint="Fix these first" />
        <Stat label="Open without an owner" value={s.totals.unassignedOpen} to={listLink({ closed: 'false', 'owner_id.null': 'true' })} icon="user" hint="Nobody is assigned" />
        <Stat label="Fixed this month" value={s.totals.fixedThisMonth} color="green" to="/vulnerabilities?view=fixed_month" icon="check" />
      </div>

      <div className="vuln-grid">
        <Card title="Open by severity">
          <Chart label="Open findings by severity" option={charts.open} height={240}
            onSegmentClick={(seg) => navigate(listLink({ closed: 'false', severity: (seg.data as { key: string }).key }))} />
        </Card>
        <Card title="Overdue by severity">
          {s.totals.overdue === 0
            ? <EmptyState icon="check" title="Nothing is overdue" message="Every open finding is inside its fix-by date." />
            : <Chart label="Overdue findings by severity" option={charts.overdue} height={240}
                onSegmentClick={(seg) => navigate(listLink({ overdue: 'true', severity: (seg.data as { key: string }).key }))} />}
        </Card>
      </div>

      <div className="vuln-grid">
        <Card title="Open by age">
          <Chart label="Open findings by age in days, stacked by severity" option={charts.age} height={280}
            onSegmentClick={(seg) => {
              const b = s.ageBuckets[seg.dataIndex];
              if (b) navigate(listLink({ closed: 'false', 'age_days.gte': b.min, 'age_days.lte': b.max ?? undefined, severity: sevByLabel(seg.seriesName) }));
            }} />
          <p className="muted vuln-chart-note">Age is counted from the day a finding was first seen.</p>
        </Card>
        <Card title="Open findings by week">
          {s.trend.length < 2
            ? <EmptyState icon="chart" title="The trend starts here" message="Open findings are counted every day and kept by week. Come back next week to see the line." />
            : (
              <>
                <Chart label="Open findings at the end of each week, stacked by severity" option={charts.trend} height={280}
                  onSegmentClick={(seg) => navigate(listLink({ closed: 'false', severity: sevByLabel(seg.seriesName) }))} />
                <p className="muted vuln-chart-note">Counted from stored weekly snapshots. A point opens today's open findings of that severity.</p>
              </>
            )}
        </Card>
      </div>

      <div className="vuln-grid">
        <Card title="By severity" flush>
          <div className="table-wrap">
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
          </div>
        </Card>
        <Card title="Hosts with the most serious open findings" flush>
          {s.topHosts.length === 0 ? <EmptyState icon="server" title="No open findings on any host" /> : (
            <div className="table-wrap">
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
                      {s.severities.slice(0, 3).map((x) => <td key={x.value} className="num">{h.bySeverity[x.value] || '—'}</td>)}
                      <td className="num">{h.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {s.overdueByOwner.length > 0 && (
        <Card title="Overdue by owner" flush>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Overdue findings for each owner</caption>
              <thead><tr><th scope="col">Owner</th><th scope="col" className="num">Overdue findings</th></tr></thead>
              <tbody>
                {s.overdueByOwner.map((o) => (
                  <tr key={o.owner_id ?? 'none'}>
                    <td>{o.owner}</td>
                    <td className="num">
                      <Link to={listLink(o.owner_id ? { overdue: 'true', owner_id: o.owner_id } : { overdue: 'true', 'owner_id.null': 'true' })}>{o.count}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
