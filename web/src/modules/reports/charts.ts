// Turns a report result into a Chart option. Color rules (see the core README, section 6):
// one series = one color; several series take the fixed palette in order and never more than
// eight (the rest fold into "Other"); a lookup's own configured colors are used when they tell
// the groups apart, because those colors already mean something to the reader (red = critical).
import { chartColor, type ChartOption } from '../../core/Chart';
import { escapeHtml, formatCurrency, formatNumber } from '../../core/format';
import type { ChartKind, ReportResult, ResultColumn, ResultRow } from './types';

export interface BuiltChart {
  option: ChartOption;
  /** Address parameters behind a clicked segment, or null when there is nothing narrower to show. */
  drillFor: (seg: { name: string; seriesName?: string; dataIndex: number; data: unknown }) => string | null;
  description: string;
}

const MAX_SERIES = 8;
const OTHER = 'Other';

/** Which kinds can draw this result, and why not for the rest. */
export function chartFit(kind: ChartKind, result: Pick<ReportResult, 'mode' | 'columns'> | undefined): string | null {
  if (!result || kind === 'table') return null;
  const dims = result.columns.filter((c) => c.role === 'dim');
  if (kind === 'number' || kind === 'gauge') return result.mode === 'total' ? null : 'Needs a single total: remove the grouping.';
  if (result.mode !== 'groups') return 'Needs a summary: choose a field to group by.';
  if (kind === 'heatmap') return dims.length === 2 ? null : 'Needs two fields to group by.';
  if (kind === 'stacked') return dims.length === 2 ? null : 'Needs a second field to group by.';
  if (kind === 'pie' || kind === 'donut') return dims.length === 1 ? null : 'Works with one field to group by.';
  if (kind === 'calendar') return dims.length === 1 && dims[0].bucket === 'day' ? null : 'Needs one date field grouped by day.';
  return null;
}

const numberOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const distinctColors = (colors: (string | undefined)[]) => colors.every(Boolean) && new Set(colors).size === colors.length;

export function buildChart(kind: ChartKind, result: ReportResult, measureIndex = 0): BuiltChart | null {
  if (chartFit(kind, result) || result.mode !== 'groups') return null;
  const dims = result.columns.filter((c) => c.role === 'dim');
  const aggs = result.columns.filter((c) => c.role === 'agg');
  const measure: ResultColumn = aggs[Math.min(measureIndex, aggs.length - 1)] ?? aggs[0];
  if (!measure) return null;
  const fmt = (v: unknown) => (typeof v !== 'number' ? '' : measure.fn === 'pct' ? `${formatNumber(v)}%` : measure.type === 'currency' ? formatCurrency(v) : formatNumber(v));
  const valueAxis = { type: 'value', minInterval: measure.fn === 'count' ? 1 : undefined, axisLabel: { formatter: (v: number) => (Math.abs(v) >= 10000 ? new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v) : formatNumber(v)) } };
  const tip = { valueFormatter: fmt };
  const description = `${measure.label} by ${dims.map((d) => d.label.toLowerCase()).join(' and ')}.`;

  if (dims.length === 1) {
    let rows = result.rows;
    // A pie cannot be read past a handful of slices: keep the largest and fold the rest.
    if ((kind === 'pie' || kind === 'donut') && rows.length > MAX_SERIES) {
      const sorted = [...rows].sort((a, b) => numberOf(b.v[measure.key]) - numberOf(a.v[measure.key]));
      const rest = sorted.slice(MAX_SERIES - 1).reduce((n, r) => n + numberOf(r.v[measure.key]), 0);
      rows = [...sorted.slice(0, MAX_SERIES - 1), { v: { [measure.key]: rest }, d: { g0: OTHER } } as ResultRow];
    }
    const names = rows.map((r) => r.d.g0);
    // "None" (no value) and "Other" are gray, so a lookup's own colors still apply to the rest.
    const colors = rows.map((r) => r.c?.g0 ?? (r.v.g0 === null || r.v.g0 === undefined || r.d.g0 === OTHER ? 'gray' : undefined));
    const meaningful = distinctColors(colors) || (colors.every(Boolean) && new Set(colors).size > 1 && kind !== 'pie' && kind !== 'donut');
    const data = rows.map((r, i) => ({
      name: r.d.g0, value: numberOf(r.v[measure.key]),
      ...(meaningful ? { itemStyle: { color: chartColor(colors[i]!) } } : {}),
    }));
    const drillFor: BuiltChart['drillFor'] = (seg) => rows[seg.dataIndex]?.drill ?? null;

    if (kind === 'pie' || kind === 'donut') {
      const total = data.reduce((n, d) => n + d.value, 0);
      return {
        description, drillFor,
        option: {
          tooltip: { trigger: 'item', ...tip },
          // Names and shares sit in the legend beside the ring, so nothing is cut off in a small widget.
          legend: {
            type: 'scroll', orient: 'vertical', right: 0, top: 'middle', itemGap: 8,
            formatter: (name: string) => { const d = data.find((x) => x.name === name); return `${name}  ${d && total ? Math.round((d.value / total) * 100) : 0}%`; },
          },
          series: [{
            type: 'pie', name: measure.label, radius: kind === 'donut' ? ['50%', '78%'] : '78%', center: ['32%', '50%'], data,
            label: { show: false }, labelLine: { show: false },
          }],
        },
      };
    }
    if (kind === 'hbar') {
      const longest = Math.min(26, Math.max(...names.map((n) => n.length), 4));
      return {
        description, drillFor,
        option: {
          tooltip: { trigger: 'item', ...tip },
          grid: { top: 8, right: 56, bottom: 8, left: Math.round(longest * 6.4) + 16 },
          xAxis: { ...valueAxis, axisLabel: { show: false }, splitLine: { show: false } },
          yAxis: { type: 'category', inverse: true, data: names, axisLabel: { width: longest * 6.4, overflow: 'truncate' } },
          series: [{
            type: 'bar', name: measure.label, data, barMaxWidth: 20, itemStyle: { borderRadius: [0, 4, 4, 0] },
            label: { show: true, position: 'right', color: 'var(--text)', fontWeight: 600, textBorderWidth: 0, formatter: (p: { value: number }) => fmt(p.value) },
          }],
        },
      };
    }
    const line = kind === 'line' || kind === 'area';
    return {
      description, drillFor,
      option: {
        tooltip: { trigger: line ? 'axis' : 'item', ...tip },
        grid: { top: 16, right: 16, bottom: 32, left: 52 },
        // The chart fits the category labels to the room each one has (wrapped, or tilted and shortened).
        xAxis: { type: 'category', data: names, boundaryGap: !line },
        yAxis: valueAxis,
        series: [{
          type: line ? 'line' : 'bar', name: measure.label, data: line ? data.map((d) => d.value) : data,
          ...(line ? { showSymbol: names.length <= 31, ...(kind === 'area' ? { areaStyle: { opacity: 0.14 } } : {}) } : {}),
        }],
      },
    };
  }

  // ---------- two fields ----------
  // Series (and heat-map columns) follow the second field's natural order from the server (a list's
  // configured order, dates in time order), not the order the values happened to be met in.
  const rowKeys: string[] = [];
  const colKeys: { name: string; color?: string }[] = [];
  const cell = new Map<string, ResultRow>();
  if (result.pivot) {
    rowKeys.push(...result.pivot.rows.map((r) => r.label));
    colKeys.push(...result.pivot.cols.map((c) => ({ name: c.label, color: c.color })));
  }
  for (const r of result.rows) {
    if (!rowKeys.includes(r.d.g0)) rowKeys.push(r.d.g0);
    if (!colKeys.some((c) => c.name === r.d.g1)) colKeys.push({ name: r.d.g1, color: r.c?.g1 });
    cell.set(`${r.d.g0}\u0001${r.d.g1}`, r);
  }
  const natural = dims[1]?.values;
  if (natural?.length && !result.pivot) colKeys.sort((a, b) => natural.indexOf(a.name) - natural.indexOf(b.name));
  const at = (row: string, col: string) => cell.get(`${row}\u0001${col}`);
  const drillFor: BuiltChart['drillFor'] = (seg) => (seg.seriesName && seg.seriesName !== OTHER ? at(seg.name, seg.seriesName)?.drill ?? null : null);

  if (kind === 'heatmap') {
    const data: [number, number, number][] = [];
    // Every cell is drawn, empty ones in the lightest step, so the grid reads as a grid.
    rowKeys.forEach((rk, y) => colKeys.forEach((ck, x) => { const r = at(rk, ck.name); data.push([x, y, r ? numberOf(r.v[measure.key]) : 0]); }));
    const max = Math.max(1, ...data.map((d) => d[2]));
    const longest = Math.min(22, Math.max(...rowKeys.map((n) => n.length), 4));
    return {
      description,
      drillFor: (seg) => { const d = seg.data as [number, number, number]; return at(rowKeys[d[1]], colKeys[d[0]].name)?.drill ?? null; },
      option: {
        tooltip: { trigger: 'item', // Row and column names are record text: escaped, as ECharts places the string as HTML (SP-04).
        formatter: (p: { data: [number, number, number] }) => `${escapeHtml(rowKeys[p.data[1]])} · ${escapeHtml(colKeys[p.data[0]].name)}<br><strong>${escapeHtml(fmt(p.data[2]))}</strong>` },
        grid: { top: 8, right: 12, bottom: 44, left: Math.round(longest * 6.4) + 16 },
        xAxis: { type: 'category', data: colKeys.map((c) => c.name), position: 'bottom', splitArea: { show: false }, axisLine: { show: false } },
        yAxis: { type: 'category', inverse: true, data: rowKeys, axisLine: { show: false }, axisLabel: { width: longest * 6.4, overflow: 'truncate' } },
        // Sequential: one hue from the surface up, so "more" always reads darker (lighter in the dark theme).
        visualMap: { show: false, min: 0, max, inRange: { color: ['var(--surface-2)', 'var(--series-1)'] } },
        series: [{ type: 'heatmap', name: measure.label, data, label: { show: rowKeys.length * colKeys.length <= 80, formatter: (p: { data: [number, number, number] }) => (p.data[2] ? fmt(p.data[2]) : ''), fontWeight: 600 }, itemStyle: { borderRadius: 4 } }],
      },
    };
  }

  // Bars and lines by the first field, one series per value of the second.
  let series = colKeys.map((ck) => ({ name: ck.name, color: ck.color, values: rowKeys.map((rk) => { const r = at(rk, ck.name); return r ? numberOf(r.v[measure.key]) : 0; }) }));
  if (series.length > MAX_SERIES) {
    const ranked = [...series].sort((a, b) => b.values.reduce((n, v) => n + v, 0) - a.values.reduce((n, v) => n + v, 0));
    const keep = new Set(ranked.slice(0, MAX_SERIES - 1).map((s) => s.name));
    const rest = series.filter((s) => !keep.has(s.name));
    series = [...series.filter((s) => keep.has(s.name)), { name: OTHER, color: 'gray', values: rowKeys.map((_, i) => rest.reduce((n, s) => n + s.values[i], 0)) }];
  }
  const meaningful = distinctColors(series.map((s) => s.color));
  const line = kind === 'line' || kind === 'area';
  const stacked = kind === 'stacked' || kind === 'area';
  return {
    description, drillFor,
    option: {
      tooltip: { trigger: 'axis', axisPointer: { type: line ? 'line' : 'shadow' }, ...tip },
      legend: {},
      xAxis: { type: 'category', data: rowKeys, boundaryGap: !line },
      yAxis: valueAxis,
      series: series.map((s) => ({
        type: line ? 'line' : 'bar', name: s.name, data: s.values,
        ...(stacked ? { stack: 'total' } : {}),
        ...(kind === 'stacked' ? { itemStyle: { borderRadius: 0, borderColor: 'var(--surface)', borderWidth: 1, ...(meaningful ? { color: chartColor(s.color!) } : {}) } } : meaningful ? { itemStyle: { color: chartColor(s.color!) }, lineStyle: { color: chartColor(s.color!) } } : {}),
        ...(kind === 'area' ? { areaStyle: { opacity: 0.2 }, showSymbol: false } : {}),
        emphasis: { focus: 'series' },
      })),
    },
  };
}
