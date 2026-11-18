// Training overview: completion by course and by department, the overdue trend and the overdue list.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button, Card, Chart, chartColor, EmptyState, ErrorState, formatDate, Loading, PageHeader, Stat, useAuth, useFetch,
} from '../../core';
import type { ChartOption, ChartSegment } from '../../core';
import { daysPhrase, rateColor, recordsLink } from './shared';
import type { RecordStatus, Summary, Tally } from './shared';

const SERIES: { key: RecordStatus; name: string; color: 'green' | 'gray' | 'red' }[] = [
  { key: 'complete', name: 'Completed', color: 'green' },
  { key: 'due', name: 'To do', color: 'gray' },
  { key: 'overdue', name: 'Overdue', color: 'red' },
];

/** Horizontal stacked bars: one bar per row, split into completed, to do and overdue. */
function stackedOption(rows: (Tally & { name: string })[]): ChartOption {
  const shown = [...rows].reverse(); // ECharts draws the first category at the bottom
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { bottom: 0 },
    grid: { top: 8, right: 24, bottom: 56, left: 8, containLabel: true },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', data: shown.map((r) => r.name), axisLabel: { width: 190, overflow: 'truncate' } },
    series: SERIES.map((s) => ({
      type: 'bar', name: s.name, stack: 'people', barMaxWidth: 22,
      itemStyle: { color: chartColor(s.color), borderRadius: 0, borderColor: 'var(--surface)', borderWidth: 1 },
      data: shown.map((r) => r[s.key]),
    })),
  };
}

function Breakdown({ caption, first, rows }: {
  caption: string; first: string; rows: (Tally & { key: string; name: string; to: (status?: RecordStatus) => string; open?: string })[];
}) {
  return (
    <div className="table-wrap">
      <table className="table trn-breakdown">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{first}</th><th scope="col" className="num">People</th><th scope="col" className="num">Completed</th>
            <th scope="col" className="num">To do</th><th scope="col" className="num">Overdue</th><th scope="col" className="num">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td><Link className="row-title" to={r.open ?? r.to()}>{r.name}</Link></td>
              <td className="num"><Link to={r.to()}>{r.total}</Link></td>
              <td className="num"><Link to={r.to('complete')}>{r.complete}</Link></td>
              <td className="num"><Link to={r.to('due')}>{r.due}</Link></td>
              <td className="num">{r.overdue ? <Link className="trn-late" to={r.to('overdue')}>{r.overdue}</Link> : 0}</td>
              <td className="num">{r.rate === null ? '—' : `${r.rate}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrainingOverview() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, error, reload } = useFetch<Summary>('/api/training/summary');

  const courses = useMemo(() => (data?.by_course ?? []).map((c) => ({
    ...c, key: c.course_id, name: c.title, open: `/training/courses/${c.course_id}`,
    to: (status?: RecordStatus) => recordsLink({ course_id: c.course_id, status, active: 'true' }),
  })), [data]);
  const departments = useMemo(() => (data?.by_department ?? []).map((d) => ({
    ...d, key: d.department ?? 'none', name: d.label,
    to: (status?: RecordStatus) => recordsLink({ department: d.department ?? 'none', status, active: 'true' }),
  })), [data]);

  const courseOption = useMemo(() => stackedOption(courses), [courses]);
  const departmentOption = useMemo(() => stackedOption(departments), [departments]);
  const trendOption = useMemo<ChartOption>(() => ({
    tooltip: { trigger: 'axis' },
    grid: { top: 16, right: 16, bottom: 28, left: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: (data?.trend ?? []).map((p) => new Date(`${p.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })),
    },
    yAxis: { type: 'value', minInterval: 1 },
    series: [{
      type: 'line', name: 'Overdue', symbolSize: 8, lineStyle: { width: 2 }, itemStyle: { color: chartColor('red') },
      data: (data?.trend ?? []).map((p) => p.overdue),
    }],
  }), [data]);

  const drill = (rows: typeof courses | typeof departments) => (seg: ChartSegment) => {
    // Bars are drawn bottom-up, so the clicked category is looked up by name.
    const row = rows.find((r) => r.name === seg.name);
    const status = SERIES.find((s) => s.name === seg.seriesName)?.key;
    if (row) navigate(row.to(status));
  };

  const actions = (
    <>
      {can('training.create') && <Button icon="upload" onClick={() => navigate('/training/import')}>Import completions</Button>}
      <Button onClick={() => navigate('/training/courses')}>Courses</Button>
    </>
  );
  const header = (
    <PageHeader
      title="Training overview" actions={actions}
      subtitle="Each person counts once for each active course they have been given: completed, still to do, or overdue."
    />
  );
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={8} label="Loading the training overview" /></div>;
  if (!data.totals.total) {
    return (
      <div className="stack">
        {header}
        <EmptyState
          icon="graduation" title="No training recorded yet"
          message="Add a course, then assign it to people or record who has completed it. Completions can also be imported from a file."
          action={<Button variant="primary" onClick={() => navigate('/training/courses')}>Go to courses</Button>}
        />
      </div>
    );
  }

  const t = data.totals;
  const chartHeight = Math.max(220, 70 + Math.max(courses.length, departments.length) * 40);
  return (
    <div className="stack">
      {header}
      <div className="grid-stats">
        <Stat label="Completion rate" value={t.rate === null ? '—' : `${t.rate}%`} color={rateColor(t.rate)}
          trend={{ direction: 'flat', label: `${t.complete} of ${t.total} completed`, tone: 'neutral' }} to={recordsLink({ active: 'true' })} />
        <Stat label="Overdue" value={t.overdue} color={t.overdue ? 'red' : 'green'} to={recordsLink({ status: 'overdue', active: 'true' })} />
        <Stat label="To do" value={t.due} color="blue" to={recordsLink({ status: 'due', active: 'true' })} />
        <Stat label="People" value={t.people} to={recordsLink({ active: 'true' })} />
        <Stat label="Active courses" value={t.courses} to="/training/courses?f.status=active" />
      </div>

      <div className="grid-2 trn-charts">
        <Card title="Completion by course">
          <Chart label="People who have completed, still have to do, or are overdue for each course" option={courseOption}
            height={chartHeight} onSegmentClick={drill(courses)} />
        </Card>
        <Card title="Completion by department">
          <Chart label="People who have completed, still have to do, or are overdue in each department" option={departmentOption}
            height={chartHeight} onSegmentClick={drill(departments)} />
        </Card>
      </div>

      <Card title="Overdue training, last 12 months">
        <p className="muted">Records that were past their due date at the end of each month. Select a point to see them.</p>
        <Chart label="Number of overdue training records at the end of each month" option={trendOption} height={220}
          onSegmentClick={(seg) => {
            const p = data.trend[seg.dataIndex];
            if (p) navigate(recordsLink({ overdue_at: p.as_of, active: 'true' }));
          }} />
      </Card>

      <div className="grid-2 trn-charts">
        <Card title="By course" flush><Breakdown caption="Completion by course" first="Course" rows={courses} /></Card>
        <Card title="By department" flush><Breakdown caption="Completion by department" first="Department" rows={departments} /></Card>
      </div>

      <Card title={`Overdue now (${data.overdue.length})`} flush={data.overdue.length > 0}
        actions={data.overdue.length ? <Button size="sm" variant="ghost" onClick={() => navigate(recordsLink({ status: 'overdue', active: 'true' }))}>Open as a list</Button> : undefined}>
        {data.overdue.length === 0 ? (
          <EmptyState icon="check" title="Nothing is overdue" message="Everyone is up to date or still within their due date." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Overdue training, longest overdue first</caption>
              <thead><tr><th scope="col">Person</th><th scope="col">Department</th><th scope="col">Course</th><th scope="col">Due</th></tr></thead>
              <tbody>
                {data.overdue.slice(0, 15).map((r) => (
                  <tr key={r.id}>
                    <td><span className="row-title">{r.person}</span></td>
                    <td>{r.department ?? <span className="muted">—</span>}</td>
                    <td><Link to={`/training/courses/${r.course_id}?tab=people`}>{r.course_title}</Link></td>
                    <td>{formatDate(r.due_on)} <span className="trn-late">{r.due_on ? daysPhrase(data.today, r.due_on) : ''}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.overdue.length > 15 && <p className="muted trn-more">Showing the 15 longest overdue of {data.overdue.length}.</p>}
      </Card>
    </div>
  );
}
