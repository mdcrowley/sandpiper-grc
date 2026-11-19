// Chart: a thin ECharts wrapper. The charting code is loaded on first use, so pages without charts stay light.
import { lazy, Suspense, useId, useMemo } from 'react';
import { Skeleton, Text } from '@mantine/core';
import { IconChartBar } from '@tabler/icons-react';
import type { EChartsCoreOption } from 'echarts/core';
import type { StatsResult } from './api';
import { toColorName, type ColorName } from './meta';
import './records.css';

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
  /** Names the chart for screen-reader users. */
  label: string;
  /** Pixels (default 280). */
  height?: number;
  /** Called when a bar, slice, point, cell or node is clicked (drill-down). */
  onSegmentClick?: (segment: ChartSegment) => void;
  /** Show the skeleton instead of the chart (the data is still loading). */
  loading?: boolean;
  /** Text of the empty state, shown when no series has any data. Default "No data to show yet". */
  emptyMessage?: string;
  /** Force the empty state on or off instead of working it out from the option. */
  empty?: boolean;
  /** A longer description read out after the label (what the chart shows, the main finding). */
  description?: string;
}

/** Chart colour for a named colour, as a token reference the Chart resolves per theme. */
export function chartColor(name: ColorName | string): string {
  return `var(--c-${toColorName(name)}-solid)`;
}

/** Turn a stats response into series data coloured by each group's configured colour. */
export function statsToData(groups: StatsResult['groups']) {
  return groups.map((g) => ({ name: g.label, value: g.count, key: g.value, itemStyle: { color: chartColor(g.color) } }));
}

/* ---------- Reading the option: empty check and a text alternative ---------- */

type Loose = Record<string, unknown>;
const list = (v: unknown): Loose[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []) as Loose[];
const numberOf = (item: unknown): number | null => {
  const raw = item && typeof item === 'object' && !Array.isArray(item) ? (item as Loose).value : item;
  const v = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

function isEmptyOption(option: ChartOption): boolean {
  const series = list((option as Loose).series);
  if (series.length === 0) return false; // nothing to judge by (a dataset, or a custom option)
  return series.every((s) => {
    const data = Array.isArray(s.data) ? s.data : Array.isArray(s.nodes) ? s.nodes : null;
    if (data === null) return false;
    if (data.length === 0) return true;
    // A pie of zeros draws nothing either.
    return s.type === 'pie' && data.every((d) => (numberOf(d) ?? 0) === 0);
  });
}

interface TextTable {
  head: string[];
  rows: string[][];
}

/** The numbers behind simple charts, for a visually hidden table. */
function textTable(option: ChartOption): TextTable | null {
  const o = option as Loose;
  const series = list(o.series).filter((s) => Array.isArray(s.data) && ['bar', 'line', 'pie'].includes(String(s.type)));
  if (series.length === 0) return null;
  const axis = [...list(o.xAxis), ...list(o.yAxis)].find((a) => a.type === 'category' && Array.isArray(a.data));
  const categories = (axis?.data as unknown[] | undefined)?.map((c) => String((c as Loose)?.value ?? c));
  const names = categories ?? (series[0].data as unknown[]).map((d, i) => String((d as Loose)?.name ?? i + 1));
  if (names.length === 0 || names.length > 60) return null;
  return {
    head: ['', ...series.map((s, i) => String(s.name ?? (series.length > 1 ? `Series ${i + 1}` : 'Value')))],
    rows: names.map((name, i) => [name, ...series.map((s) => {
      const n = numberOf((s.data as unknown[])[i]);
      return n === null ? '' : String(n);
    })]),
  };
}

const ChartImpl = lazy(() => import('./ChartImpl'));

function ChartSkeleton({ height, label }: { height: number; label: string }) {
  return (
    <div className="rc-chart rc-chart-skeleton" style={{ height }} role="status" aria-live="polite">
      <span className="rc-sr-only">Loading chart: {label}…</span>
      {[52, 78, 40, 90, 64, 30, 72].map((h, i) => <Skeleton key={i} height={`${h}%`} radius="sm" />)}
    </div>
  );
}

export function Chart(props: ChartProps) {
  const { option, label, height = 280, loading, empty, emptyMessage = 'No data to show yet', description } = props;
  const descId = useId();
  const isEmpty = useMemo(() => empty ?? isEmptyOption(option), [empty, option]);
  const table = useMemo(() => (isEmpty ? null : textTable(option)), [isEmpty, option]);

  if (loading) return <ChartSkeleton height={height} label={label} />;
  if (isEmpty) {
    return (
      <div className="rc-chart rc-chart-empty" style={{ height }} role="img" aria-label={`${label}: ${emptyMessage}`}>
        <IconChartBar size={28} stroke={1.5} aria-hidden="true" />
        <Text size="sm" c="dimmed">{emptyMessage}</Text>
      </div>
    );
  }
  return (
    <figure className="rc-chart-figure" aria-label={label}>
      <Suspense fallback={<ChartSkeleton height={height} label={label} />}>
        <ChartImpl {...props} height={height} describedBy={description || table ? descId : undefined} />
      </Suspense>
      <div id={descId} className="rc-sr-only">
        {description && <p>{description}</p>}
        {table && (
          <table>
            <caption>{label}</caption>
            <thead><tr>{table.head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>{r.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}</tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </figure>
  );
}
