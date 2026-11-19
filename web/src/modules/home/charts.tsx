import { useMemo } from 'react';
import { Chart, statsToData } from '../../core';
import type { StatsResult } from '../../core';

/**
 * Horizontal bars, one per group of a stats response, in each group's configured color and
 * with the count written at the end of the bar. `onPick` receives the group's value.
 */
export function GroupBars({ label, description, groups, onPick }: {
  label: string;
  description?: string;
  groups: StatsResult['groups'];
  onPick?: (value: string | null) => void;
}) {
  const option = useMemo(() => ({
    tooltip: { trigger: 'item' },
    grid: { top: 12, right: 32, bottom: 8, left: 8, containLabel: true },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', inverse: true, data: groups.map((g) => g.label) },
    series: [{
      type: 'bar', barMaxWidth: 22, itemStyle: { borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', color: 'var(--text)', textBorderWidth: 0, fontWeight: 600 },
      data: statsToData(groups),
    }],
  }), [groups]);
  return (
    <Chart
      label={label}
      description={description}
      option={option}
      height={Math.max(150, 44 * groups.length + 30)}
      onSegmentClick={onPick ? (seg) => onPick((seg.data as { key?: string | null } | undefined)?.key ?? null) : undefined}
    />
  );
}
