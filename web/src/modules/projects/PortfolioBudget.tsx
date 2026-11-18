import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Chart, EmptyState, formatCurrency, LookupChip } from '../../core';
import type { ChartOption } from '../../core';
import { BudgetBar, compactCurrency } from './bits';
import type { PortfolioRow } from './types';

const short = (s: string) => (s.length > 30 ? `${s.slice(0, 29)}…` : s);

/** Budget against actual spend, per project. */
export function PortfolioBudget({ rows }: { rows: PortfolioRow[] }) {
  const navigate = useNavigate();
  const shown = useMemo(
    () => rows.filter((p) => p.status !== 'cancelled' && ((p.budget ?? 0) > 0 || (p.spend_to_date ?? 0) > 0))
      .sort((a, b) => (b.budget ?? 0) - (a.budget ?? 0)),
    [rows],
  );

  const option = useMemo<ChartOption>(() => {
    const ordered = [...shown].reverse(); // the largest at the top of a horizontal chart
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: unknown) => formatCurrency(Number(v)) },
      legend: {},
      grid: { left: 8, right: 24, top: 36, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => compactCurrency(v) } },
      yAxis: { type: 'category', data: ordered.map((p) => short(p.name)) },
      series: [
        { name: 'Budget', type: 'bar', itemStyle: { borderRadius: [0, 4, 4, 0] }, data: ordered.map((p) => ({ value: p.budget ?? 0, key: p.id })) },
        { name: 'Spend to date', type: 'bar', itemStyle: { borderRadius: [0, 4, 4, 0] }, data: ordered.map((p) => ({ value: p.spend_to_date ?? 0, key: p.id })) },
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

  return (
    <div className="stack">
      <Card title="Budget versus actual">
        <Chart
          label={`Budget and spend to date for ${shown.length} projects. The table below has the figures.`}
          option={option}
          height={Math.max(220, shown.length * 54 + 60)}
          onSegmentClick={(seg) => {
            const key = (seg.data as { key?: string } | undefined)?.key;
            if (key) navigate(`/projects/${key}`);
          }}
        />
      </Card>
      <Card title="Figures" flush>
        <div className="table-wrap">
          <table className="table">
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
        </div>
      </Card>
    </div>
  );
}
