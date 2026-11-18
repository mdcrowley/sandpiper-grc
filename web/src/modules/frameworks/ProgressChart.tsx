import { useMemo } from 'react';
import { Chart, formatDate } from '../../core';
import type { ChartOption } from '../../core';
import type { Progress } from './types';

/**
 * Weighted score (0 to 100) at each snapshot and now, for priority outcomes and for all
 * outcomes, against the target line. One axis; the table under the chart carries the numbers.
 */
export function ProgressChart({ progress }: { progress: Progress }) {
  const targetLabel = progress.statuses.find((s) => s.value === progress.target.status)?.label ?? progress.target.status;
  const option = useMemo<ChartOption>(() => {
    const points = progress.series;
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { top: 40, right: 24, bottom: 48, left: 48 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: points.map((p) => `${p.name}\n${formatDate(p.date)}`),
      },
      yAxis: { type: 'value', min: 0, max: 100, name: 'Score', axisLabel: { formatter: '{value}' } },
      series: [
        {
          name: 'Priority outcomes', type: 'line', symbol: 'circle', symbolSize: 8, lineStyle: { width: 2 },
          data: points.map((p) => p.priority.score),
        },
        {
          name: 'All outcomes', type: 'line', symbol: 'circle', symbolSize: 8, lineStyle: { width: 2 },
          data: points.map((p) => p.all.score),
        },
        {
          name: `Target (every outcome "${targetLabel}")`, type: 'line', symbol: 'none', silent: true,
          lineStyle: { width: 1.5, type: 'dashed', color: 'var(--border-strong)' },
          itemStyle: { color: 'var(--border-strong)' },
          data: points.map(() => progress.target.score),
        },
      ],
    };
  }, [progress, targetLabel]);

  return (
    <Chart
      label={`Weighted score over time for priority outcomes and all outcomes, against a target of ${progress.target.score}`}
      option={option}
      height={300}
    />
  );
}
