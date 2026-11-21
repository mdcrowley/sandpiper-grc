// The controls dashboard: how the library rates, which tests are due, recent results and coverage.
// The figures count every record and are the same for everyone.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button, Card, Chart, chartColor, EmptyState, ErrorState, formatDate, Loading, PageHeader, Stat, useAuth, useFetch,
} from '../../core';
import type { ChartOption, ColorName } from '../../core';
import { ControlsTabs, STATE_INFO } from './shared';

interface Group { value: string; label: string; color: string; count: number }
interface Summary {
  today: string;
  totals: {
    controls: number; active: number; key: number; retired: number;
    ineffective: number; overdue: number; untested: number; partly_effective: number; effective: number;
    due_soon: number; tests_open: number; awaiting_review: number; reviewed_12m: number; failed_12m: number;
  };
  by_rating: Group[];
  by_domain: Group[];
  by_month: ({ period: string } & Record<string, number | string>)[];
  results: { value: string; label: string; color: string }[];
  coverage: { type: string; label: string; plural: string; covered: number; relying_on_failed: number; flagged: boolean }[];
  due: { id: string; ref: string; title: string; next_test_due: string; overdue: boolean }[];
}

const monthLabel = (p: string) => new Date(`${p}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

export function ControlsDashboard() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: s, error, loading, reload } = useFetch<Summary>('/api/controls/summary');

  const charts = useMemo(() => {
    const ratings = s?.by_rating ?? [];
    const byRating: ChartOption = {
      tooltip: { trigger: 'item' },
      xAxis: { type: 'category', data: ratings.map((r) => r.label), axisLabel: { interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{
        name: 'Controls', type: 'bar', barMaxWidth: 40, label: { show: true, position: 'top', color: 'var(--text-muted)' },
        data: ratings.map((r) => ({ value: r.count, key: r.value, name: r.label, itemStyle: { color: chartColor(r.color as ColorName) } })),
      }],
    };
    const months = s?.by_month ?? [];
    const byMonth: ChartOption = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0 },
      grid: { top: 16, right: 16, bottom: 48, left: 40 },
      xAxis: { type: 'category', data: months.map((m) => monthLabel(m.period)), axisLabel: { interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: (s?.results ?? []).map((r) => ({
        name: r.label, type: 'bar', stack: 'tests', barMaxWidth: 28, color: chartColor(r.color as ColorName),
        data: months.map((m) => Number(m[r.value] ?? 0)),
      })),
    };
    return { byRating, byMonth };
  }, [s]);

  const header = (
    <>
      <PageHeader title="Controls" subtitle="How the control library rates, which tests are due, recent results and what relies on failing controls."
        actions={<>
          <Button icon="refresh" loading={loading && !!s} onClick={reload}>Refresh</Button>
          {can('controls.create') && <Link className="btn btn-primary" to="/controls?new=1">New control</Link>}
        </>} />
      <ControlsTabs active="dashboard" />
    </>
  );
  if (error && !s) return <div className="stack">{header}<ErrorState title="The dashboard could not be loaded" error={error} onRetry={reload} /></div>;
  if (!s) return <div className="stack">{header}<Loading lines={10} label="Loading the controls dashboard" /></div>;
  const t = s.totals;
  const tested = s.by_month.reduce((n, m) => n + s.results.reduce((k, r) => k + Number(m[r.value] ?? 0), 0), 0);

  return (
    <div className="stack">
      {header}
      <div className="grid-stats">
        <Stat label="Controls in use" value={t.controls} icon="shield" hint={`${t.key} key control${t.key === 1 ? '' : 's'}`} to="/controls?f.status=active,draft" />
        <Stat label="Ineffective" value={t.ineffective} icon="alert-circle" color={t.ineffective ? 'red' : undefined} hint={STATE_INFO.ineffective.hint}
          to="/controls?f.operating_rating=ineffective" />
        <Stat label="Tests overdue" value={t.overdue} icon="clock" color={t.overdue ? 'orange' : undefined}
          hint={`${t.due_soon} more due in 30 days`} to={`/controls?f.next_test_due.lt=${s.today}`} />
        <Stat label="Not tested yet" value={t.untested} icon="help" hint="No reviewed test of their operation" to="/controls?f.operating_rating.null=true" />
        <Stat label="Awaiting review" value={t.awaiting_review} icon="check-circle" color={t.awaiting_review ? 'amber' : undefined}
          hint={`${t.tests_open} planned or in progress`} to="/controls/tests?f.status=complete" />
      </div>

      <div className="ctl-grid">
        <Card title="Operating ratings">
          <Chart label="Controls in use by the rating of their newest reviewed operating test" option={charts.byRating} height={250} empty={t.controls === 0}
            emptyMessage="No controls yet"
            onSegmentClick={(seg) => { const v = (seg.data as { key: string }).key; navigate(v ? `/controls?f.operating_rating=${v}` : '/controls?f.operating_rating.null=true'); }} />
        </Card>
        <Card title="Tests reviewed by month">
          <Chart label="Control tests reviewed in each of the last twelve months, by result" option={charts.byMonth} height={250} empty={tested === 0}
            emptyMessage="No tests reviewed in the last twelve months" />
        </Card>
      </div>

      <div className="ctl-grid">
        <Card title="Tests due" actions={<Link className="btn btn-ghost btn-sm" to="/controls?sort=next_test_due&dir=asc">All controls</Link>} flush>
          {s.due.length === 0 ? <EmptyState icon="calendar" title="Nothing due in the next 30 days" message="Each control's next test is due a set number of months after its last one." /> : (
            <ul className="ctl-due">
              {s.due.map((d) => (
                <li key={d.id}>
                  <Link to={`/controls/${d.id}`}><span className="ref">{d.ref}</span> {d.title}</Link>
                  <span className={d.overdue ? 'chip chip-orange' : 'muted'}>{d.overdue ? `Overdue since ${formatDate(d.next_test_due)}` : `Due ${formatDate(d.next_test_due)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="What the controls cover" actions={<Link className="btn btn-ghost btn-sm" to="/controls/coverage">Coverage view</Link>} flush>
          {s.coverage.length === 0 ? <EmptyState icon="shield" title="Nothing to show" message="None of the kinds of record a control can cover are open to you." /> : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Records covered by controls, by kind</caption>
                <thead><tr><th scope="col">Kind</th><th scope="col" className="num">Covered</th><th scope="col" className="num">Relying on an ineffective control</th></tr></thead>
                <tbody>
                  {s.coverage.map((c) => (
                    <tr key={c.type}>
                      <td>{c.plural}</td>
                      <td className="num">{c.covered}</td>
                      <td className="num">{c.relying_on_failed ? <span className="chip chip-red">{c.relying_on_failed}</span> : 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
