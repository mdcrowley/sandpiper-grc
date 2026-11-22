import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SimpleGrid } from '@mantine/core';
import { Card, Chart, chartColor, EmptyState, escapeHtml, formatCurrency, LookupChip, Stat, TableWrap } from '../../core';
import type { ChartOption } from '../../core';
import { BudgetBar, compactCurrency } from './bits';
import type { PortfolioRow } from './types';

const short = (s: string) => (s.length > 28 ? `${s.slice(0, 27)}…` : s);

/**
 * Budget against actual spend, per project. Each row is one track (the budget) that the spend
 * fills; spend that passes the budget runs beyond the track in red.
 */
export function PortfolioBudget({ rows }: { rows: PortfolioRow[] }) {
  const navigate = useNavigate();
  const shown = useMemo(
    () => rows.filter((p) => p.status !== 'cancelled' && ((p.budget ?? 0) > 0 || (p.spend_to_date ?? 0) > 0))
      .sort((a, b) => (b.budget ?? 0) - (a.budget ?? 0)),
    [rows],
  );

  const option = useMemo<ChartOption>(() => {
    const ordered = [...shown].reverse(); // the largest at the top of a horizontal chart
    const bar = { type: 'bar', barWidth: 14, barGap: '-100%', itemStyle: { borderRadius: [0, 4, 4, 0] } };
    const within = (p: PortfolioRow) => !(p.budget && (p.spend_to_date ?? 0) > p.budget);
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (items: unknown) => {
          const p = ordered[(items as { dataIndex: number }[])[0]?.dataIndex ?? 0];
          if (!p) return '';
          const budget = p.budget ?? 0;
          const spend = p.spend_to_date ?? 0;
          const left = budget - spend;
          return [
            `<strong>${escapeHtml(p.name)}</strong>`,
            `Budget: ${formatCurrency(budget)}`,
            `Spend to date: ${formatCurrency(spend)}${budget ? ` (${Math.round((spend / budget) * 100)}%)` : ''}`,
            left < 0 ? `Over budget by ${formatCurrency(-left)}` : `Remaining: ${formatCurrency(left)}`,
          ].join('<br/>');
        },
      },
      legend: {},
      grid: { left: 8, right: 28, top: 36, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => compactCurrency(v) } },
      yAxis: { type: 'category', data: ordered.map((p) => short(p.name)), axisTick: { show: false } },
      series: [
        { ...bar, name: 'Budget', z: 1, itemStyle: { ...bar.itemStyle, color: chartColor('gray'), opacity: 0.3 }, data: ordered.map((p) => ({ value: p.budget ?? 0, key: p.id })) },
        { ...bar, name: 'Spend to date', z: 2, itemStyle: { ...bar.itemStyle, color: chartColor('blue') }, data: ordered.map((p) => ({ value: within(p) ? p.spend_to_date ?? 0 : null, key: p.id })) },
        { ...bar, name: 'Spend over budget', z: 2, itemStyle: { ...bar.itemStyle, color: chartColor('red') }, data: ordered.map((p) => ({ value: within(p) ? null : p.spend_to_date ?? 0, key: p.id })) },
      ],
    };
  }, [shown]);

  if (!shown.length) {
    return (
      <Card>
        <EmptyState icon="chart" title="No budgets yet" message="Add a budget or spend to a project to compare them here." />
      </Card>
    );
  }

  const totalBudget = shown.reduce((n, p) => n + (p.budget ?? 0), 0);
  const totalSpend = shown.reduce((n, p) => n + (p.spend_to_date ?? 0), 0);
  const over = shown.filter((p) => p.budget && (p.spend_to_date ?? 0) > p.budget);

  return (
    <div className="stack">
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
        <Stat label="Budget" value={compactCurrency(totalBudget)} hint={`${shown.length} ${shown.length === 1 ? 'project' : 'projects'}`} />
        <Stat label="Spend to date" value={compactCurrency(totalSpend)} hint={totalBudget ? `${Math.round((totalSpend / totalBudget) * 100)}% of budget` : undefined} />
        <Stat label="Remaining" value={compactCurrency(totalBudget - totalSpend)} color={totalBudget - totalSpend < 0 ? 'red' : 'green'} />
        <Stat label="Over budget" value={over.length} color={over.length ? 'red' : 'gray'} hint={over.length ? over.map((p) => p.ref).join(', ') : 'None'} />
      </SimpleGrid>
      <Card title="Budget versus actual">
        <Chart
          label={`Budget and spend to date for ${shown.length} projects, largest budget first`}
          description={`Total budget ${formatCurrency(totalBudget)}, spend to date ${formatCurrency(totalSpend)}. ${over.length} over budget. The table below has the figures.`}
          option={option}
          height={Math.max(200, shown.length * 40 + 70)}
          onSegmentClick={(seg) => {
            const key = (seg.data as { key?: string } | undefined)?.key;
            if (key) navigate(`/projects/${key}`);
          }}
        />
      </Card>
      <Card title="Figures" flush>
        <TableWrap label="Figures" className="prj-scroll">
          <table className="table prj-figures">
            <thead>
              <tr>
                <th scope="col">Project</th><th scope="col">Stage</th>
                <th scope="col" className="num">Budget</th><th scope="col" className="num">Spend to date</th>
                <th scope="col" className="num">Remaining</th><th scope="col">Spend against budget</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const remaining = (p.budget ?? 0) - (p.spend_to_date ?? 0);
                return (
                  <tr key={p.id}>
                    <td><Link to={`/projects/${p.id}`}><span className="ref">{p.ref}</span> {p.name}</Link></td>
                    <td><LookupChip list="project_stage" value={p.stage} /></td>
                    <td className="num">{formatCurrency(p.budget)}</td>
                    <td className="num">{formatCurrency(p.spend_to_date ?? 0)}</td>
                    <td className="num">{remaining < 0 ? <span className="prj-over">{formatCurrency(remaining)}</span> : formatCurrency(remaining)}</td>
                    <td><BudgetBar budget={p.budget} spend={p.spend_to_date} /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>Total</th>
                <td className="num">{formatCurrency(totalBudget)}</td>
                <td className="num">{formatCurrency(totalSpend)}</td>
                <td className="num">{formatCurrency(totalBudget - totalSpend)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
