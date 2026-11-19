import { useMemo } from 'react';
import { Chart, formatDate } from '../../core';
import type { ChartOption } from '../../core';
import type { Progress } from './types';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Weighted score (0 to 100) at each snapshot and now, for priority outcomes and for all
 * outcomes, against the target line. Dates sit on a true time axis, so the slope is honest
 * when snapshots are unevenly spaced. One axis; the table under the chart carries the numbers.
 */
export function ProgressChart({ progress, height = 320 }: { progress: Progress; height?: number }) {
  const targetLabel = progress.statuses.find((s) => s.value === progress.target.status)?.label ?? progress.target.status;
  const option = useMemo<ChartOption>(() => {
    const points = progress.series;
    const last = points.length - 1;
    const hasPriority = points.some((p) => p.priority.total > 0);
    // The two end labels sit above and below their points so close values do not collide.
    const priorityOnTop = points[last].priority.score >= points[last].all.score;
    const line = (name: string, pick: (i: number) => number, top = true) => ({
      name, type: 'line', symbol: 'circle', symbolSize: 9, lineStyle: { width: 2 }, emphasis: { focus: 'series' },
      data: points.map((p, i) => ({
        value: [p.date, pick(i), p.name],
        // The last point is today's position, not a saved snapshot: drawn hollow, and labeled with its value.
        ...(i === last ? { symbol: 'emptyCircle', symbolSize: 11, label: { show: true, position: top ? 'top' : 'bottom', distance: 8, fontWeight: 700, fontSize: 13, color: 'var(--text)', textBorderWidth: 0, formatter: `${pick(i)}` } } : {}),
      })),
    });
    const span = points.length > 1 ? [points[0].date, points[last].date] : [points[0].date, points[0].date];
    return {
      legend: { top: 0, left: 0, itemGap: 20 },
      grid: { top: 48, right: 84, bottom: 36, left: 40 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: { marker: string; seriesName: string; value: [string, number, string?] }[]) => {
          const first = params.find((p) => p.value[2]);
          const head = first ? `<strong>${escape(String(first.value[2]))}</strong> · ${formatDate(first.value[0])}` : formatDate(params[0].value[0]);
          return [head, ...params.map((p) => `${p.marker} ${escape(p.seriesName)}: <strong>${p.value[1]}</strong>`)].join('<br/>');
        },
      },
      xAxis: { type: 'time', axisLabel: { formatter: (v: number) => formatDate(new Date(v).toISOString().slice(0, 10)), hideOverlap: true }, splitLine: { show: false } },
      yAxis: { type: 'value', min: 0, max: 100, interval: 25 },
      series: [
        ...(hasPriority ? [line('Priority outcomes', (i) => points[i].priority.score, priorityOnTop)] : []),
        line('All outcomes', (i) => points[i].all.score, !hasPriority || !priorityOnTop),
        {
          name: `Target: every outcome “${targetLabel}” (${progress.target.score})`, type: 'line', symbol: 'none', silent: true,
          lineStyle: { width: 1.5, type: [6, 4], color: 'var(--text-muted)' }, itemStyle: { color: 'var(--text-muted)' },
          data: span.map((d) => [d, progress.target.score]),
          endLabel: { show: true, formatter: `Target ${progress.target.score}`, color: 'var(--text-muted)', textBorderWidth: 0, distance: 6 },
        },
      ],
    };
  }, [progress, targetLabel]);

  const now = progress.series[progress.series.length - 1];
  const first = progress.series[0];
  return (
    <Chart
      label="Score over time against the target"
      description={`Weighted score from ${first.name} (${first.all.score}) to now (${now.all.score}) for all outcomes, against a target of ${progress.target.score}.`}
      option={option}
      height={height}
    />
  );
}
