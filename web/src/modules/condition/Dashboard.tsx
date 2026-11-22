// The state-of-good-repair dashboard (E32-04): for one year, the share of each asset class past
// its useful life against the year's target, poor condition and average age, with the trend over
// ten years. The figures count every record and are the same for everyone.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Chart, chartColor, EmptyState, ErrorState, Loading, PageHeader, Select, Stat, StatusChip, TableWrap, todayInZone, useAuth, useFetch } from '../../core';
import type { ChartOption } from '../../core';
import { ConditionTabs, pct, useTargetWords } from './shared';

interface ClassFigures {
  id: string; ref: string; name: string; applies_to: 'vehicle' | 'asset' | 'site';
  total: number; past_ulb: number; past_ulb_pct: number | null; target_pct: number | null; target_status: string | null; over_target: boolean;
  rated: number; poor: number; poor_pct: number | null; unrated: number; average_age: number | null; no_life: number;
  with_replacement: number; funded: number | null;
}
interface Dashboard {
  year: number; cutoff: string; today: string; projected: boolean; funding: boolean;
  totals: { classes: number; total: number; past_ulb: number; past_ulb_pct: number | null; rated: number; poor: number; poor_pct: number | null;
    over_target: number; without_class: Record<string, number>; with_replacement: number; funded: number | null };
  classes: ClassFigures[];
  trend: { year: number; projected: boolean; past_ulb_pct: number | null }[];
}

const RATES: Record<string, string> = { vehicle: 'Vehicles', asset: 'Assets', site: 'Sites' };

export function ConditionDashboard() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const words = useTargetWords();
  const thisYear = Number(todayInZone().slice(0, 4));
  const [year, setYear] = useState(String(thisYear));
  const { data: d, error, reload } = useFetch<Dashboard>(`/api/condition/dashboard?year=${year}`, { keepPrevious: true });

  const charts = useMemo(() => {
    const list = (d?.classes ?? []).filter((c) => c.total > 0);
    const byClass: ChartOption = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0 },
      grid: { top: 16, right: 16, bottom: 56, left: 48 },
      xAxis: { type: 'category', data: list.map((c) => c.name.replace(/ \(sample\)$/, '')), axisLabel: { interval: 0, overflow: 'truncate', width: 90 } },
      yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
      series: [
        {
          name: 'Past useful life', type: 'bar', barMaxWidth: 32,
          color: chartColor('blue'), data: list.map((c) => ({ value: c.past_ulb_pct ?? 0, key: c.id })),
        },
        { name: 'Target (most allowed)', type: 'line', symbol: 'diamond', symbolSize: 12, lineStyle: { opacity: 0 }, color: chartColor('orange'), data: list.map((c) => c.target_pct) },
      ],
    };
    const trend = d?.trend ?? [];
    const byYear: ChartOption = {
      tooltip: { trigger: 'axis' },
      grid: { top: 16, right: 16, bottom: 32, left: 48 },
      xAxis: { type: 'category', data: trend.map((t) => (t.projected ? `${t.year}*` : String(t.year))) },
      yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
      series: [{ name: 'Past useful life', type: 'line', data: trend.map((t) => t.past_ulb_pct), color: chartColor('blue') }],
    };
    return { byClass, byYear, shown: list.length };
  }, [d]);

  const years = Array.from({ length: 10 }, (_, i) => String(thisYear - 4 + i));
  const header = (
    <>
      <PageHeader title="Asset condition" subtitle="State of good repair: the share of each asset class past its useful life against the year's target, and how many are in poor condition."
        actions={<div className="cnd-fixed"><Select label="Year" value={year} onChange={setYear} options={years.map((y) => ({ value: y, label: Number(y) > thisYear ? `${y} (projected)` : y }))} /></div>} />
      <ConditionTabs active="dashboard" />
    </>
  );
  if (error && !d) return <div className="stack">{header}<ErrorState title="The dashboard could not be loaded" error={error} onRetry={reload} /></div>;
  if (!d) return <div className="stack">{header}<Loading lines={10} label="Loading the condition dashboard" /></div>;
  const t = d.totals;
  const unclassed = Object.values(t.without_class).reduce((s, n) => s + n, 0);

  return (
    <div className="stack">
      {header}
      {d.projected && <p className="muted cnd-hint">{d.year} is a projection: today's records, with their useful life as it stands, at the end of {d.year}.</p>}
      <div className="grid-stats">
        <Stat label="Past useful life" value={pct(t.past_ulb_pct)} icon="clock" color={t.past_ulb ? 'orange' : undefined}
          hint={`${t.past_ulb} of ${t.total} in ${t.classes} classes`} to="/condition/aging?within_years=0" />
        <Stat label="Over target" value={t.over_target} icon="target" color={t.over_target ? 'red' : undefined} hint="Classes past their yearly target" />
        <Stat label="Poor condition" value={pct(t.poor_pct)} icon="alert-circle" color={t.poor ? 'amber' : undefined} hint={`${t.poor} of ${t.rated} rated`} />
        <Stat label="With a replacement project" value={t.with_replacement} icon="refresh" hint={`of the ${t.past_ulb} past useful life${t.funded !== null ? `; ${t.funded} linked to funding` : ''}`} />
        <Stat label="No asset class" value={unclassed} icon="help" hint="In use, not counted yet" />
      </div>

      <div className="cnd-grid">
        <Card title={`Past useful life by class, ${d.year}`}>
          <Chart label={`Share of each asset class past its useful life in ${d.year}, with the target`} option={charts.byClass} height={300}
            empty={charts.shown === 0} emptyMessage="No asset class has any records yet"
            onSegmentClick={(seg) => { const key = (seg.data as { key?: string } | null)?.key; if (key) navigate(`/condition/classes/${key}?tab=members`); }} />
        </Card>
        <Card title="Trend">
          <Chart label="Share of all classed records past useful life by year; starred years are projections" option={charts.byYear} height={300}
            empty={t.total === 0} emptyMessage="No asset class has any records yet" />
          <p className="muted cnd-hint">Starred years are projections with today's records.</p>
        </Card>
      </div>

      <Card title="By class" flush actions={can('assets.create') ? <Link className="btn btn-ghost btn-sm" to="/condition/classes?new=1">New asset class</Link> : undefined}>
        {d.classes.length === 0 ? <EmptyState icon="chart" title="No asset classes yet" message={`Add an asset class with its useful life, then put ${words.plural} in it.`} /> : (
          <TableWrap label={`State of good repair by asset class in ${d.year}`}>
            <table className="table">
              <caption className="sr-only">State of good repair by asset class in {d.year}</caption>
              <thead>
                <tr>
                  <th scope="col">Class</th><th scope="col">Rates</th><th scope="col" className="num">In use</th>
                  <th scope="col" className="num">Past useful life</th><th scope="col" className="num">Target</th>
                  <th scope="col" className="num">Poor condition</th><th scope="col" className="num">Not rated</th>
                  <th scope="col" className="num">Average age</th><th scope="col" className="num">Replacement project</th>
                  {d.funding && <th scope="col" className="num">Funded</th>}
                </tr>
              </thead>
              <tbody>
                {d.classes.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/condition/classes/${c.id}`}>{c.name}</Link></td>
                    <td>{RATES[c.applies_to] ?? c.applies_to}</td>
                    <td className="num"><Link to={`/condition/classes/${c.id}?tab=members`}>{c.total}</Link></td>
                    <td className="num">{c.past_ulb} <span className={c.over_target ? 'cnd-over' : 'muted'}>({pct(c.past_ulb_pct)})</span></td>
                    <td className="num">{c.target_pct === null ? '—' : <>{pct(c.target_pct)} {c.target_status !== 'approved' && <StatusChip color="gray" size="sm" label={c.target_status === 'pending_approval' ? 'Waiting' : 'Draft'} />}</>}</td>
                    <td className="num">{c.poor} <span className="muted">({pct(c.poor_pct)})</span></td>
                    <td className="num">{c.unrated}</td>
                    <td className="num">{c.average_age === null ? '—' : `${c.average_age} years`}</td>
                    <td className="num">{c.with_replacement}</td>
                    {d.funding && <td className="num">{c.funded ?? 0}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
