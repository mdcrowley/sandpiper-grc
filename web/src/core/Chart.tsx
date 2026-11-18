// Chart: a thin ECharts wrapper. The charting code is loaded on first use, so pages without charts stay light.
import { lazy, Suspense } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import type { StatsResult } from './api';
import { toColorName, type ColorName } from './meta';
import { Loading } from './ui';

export type ChartOption = EChartsCoreOption;

export interface ChartSegment {
  /** Category or slice name. */
  name: string;
  value: unknown;
  seriesName?: string;
  dataIndex: number;
  /** The raw data item, e.g. one entry from `statsToData` (its `key` is the lookup value). */
  data: unknown;
}

export interface ChartProps {
  /** A normal ECharts option. Colours may be given as `var(--token)`; they are resolved for the current theme. */
  option: ChartOption;
  /** Describes the chart for screen-reader users. */
  label: string;
  /** Pixels (default 280). */
  height?: number;
  /** Called when a bar, slice, point, cell or node is clicked (drill-down). */
  onSegmentClick?: (segment: ChartSegment) => void;
}

/** Chart colour for a named colour, as a token reference the Chart resolves per theme. */
export function chartColor(name: ColorName | string): string {
  return `var(--c-${toColorName(name)}-solid)`;
}

/** Turn a stats response into series data coloured by each group's configured colour. */
export function statsToData(groups: StatsResult['groups']) {
  return groups.map((g) => ({ name: g.label, value: g.count, key: g.value, itemStyle: { color: chartColor(g.color) } }));
}

const ChartImpl = lazy(() => import('./ChartImpl'));

export function Chart(props: ChartProps) {
  return (
    <Suspense fallback={<div className="chart" style={{ height: props.height ?? 280 }}><Loading label="Loading chart" lines={3} /></div>}>
      <ChartImpl {...props} />
    </Suspense>
  );
}
