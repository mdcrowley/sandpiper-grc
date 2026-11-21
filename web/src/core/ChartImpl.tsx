// The ECharts part of Chart, loaded on demand. Only the chart types we use are registered.
import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, GraphChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ChartProps, ChartSegment } from './Chart';
import { cssVar } from './theme';

echarts.use([
  BarChart, LineChart, PieChart, HeatmapChart, GraphChart,
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, AriaComponent, CanvasRenderer,
]);

// Tighter than the ECharts default; an option's own `grid` replaces it.
const DEFAULT_GRID = { top: 24, right: 16, bottom: 32, left: 48 };
const LABEL_SIZE = 12;

/**
 * What a screen reader is told in place of the picture (BW-07). Written here from the series data
 * rather than by ECharts' aria templates: their `{value}` gives every internal dimension of a
 * stacked series ("6; 0; 6; NaN"), so the real figure was lost. One phrase per data point: its
 * category and its own value, up to 12 points of up to 8 series.
 */
export function ariaDescription(option: Loose): string {
  const axisData = (axis: unknown): unknown[] | null => {
    const ax = (Array.isArray(axis) ? axis[0] : axis) as Loose | undefined;
    return ax && ax.type === 'category' && Array.isArray(ax.data) ? (ax.data as unknown[]) : null;
  };
  const nameOf = (c: unknown) => (c && typeof c === 'object' ? (c as Loose).value : c);
  const xCats = axisData(option.xAxis);
  const yCats = axisData(option.yAxis);
  const cats = xCats ?? yCats;
  const series = (Array.isArray(option.series) ? option.series : option.series ? [option.series] : []) as Loose[];
  const shownSeries = series.filter((sr) => sr.type !== 'graph' && Array.isArray(sr.data));
  const parts = ['Chart.'];
  if (shownSeries.length > 1) parts.push(`${shownSeries.length} series.`);
  for (const sr of shownSeries.slice(0, 8)) {
    const points: string[] = [];
    (sr.data as unknown[]).forEach((item, i) => {
      const obj = item && typeof item === 'object' && !Array.isArray(item) ? (item as Loose) : null;
      let value: unknown = obj && 'value' in obj ? obj.value : item;
      let name: unknown = obj?.name;
      if (Array.isArray(value)) {
        if (sr.type === 'heatmap' && value.length >= 3) {
          name = [nameOf(yCats?.[Number(value[1])]), nameOf(xCats?.[Number(value[0])])].filter((x) => x !== undefined && x !== null).join(', ');
          value = value[2];
        } else {
          name ??= value.length > 1 ? value[0] : undefined;
          value = value[value.length - 1];
        }
      }
      if (value === null || value === undefined || value === '-' || (typeof value === 'number' && Number.isNaN(value))) return;
      name ??= nameOf(cats?.[i]);
      const text = typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
      points.push(name !== undefined && name !== null && name !== '' ? `${String(name)} ${text}` : text);
    });
    if (!points.length) continue;
    const head = sr.name !== undefined && sr.name !== null && sr.name !== '' ? `${String(sr.name)}: ` : '';
    const some = points.length > 12 ? `the first 12 of ${points.length} values: ` : '';
    parts.push(`${head}${some}${points.slice(0, 12).join('; ')}.`);
  }
  if (series.length > 8) parts.push(`And ${series.length - 8} more series.`);
  return parts.join(' ');
}
const TOKEN = /^var\((--[\w-]+)\)$/;

/**
 * Paper is white whatever the screen theme (kept in step with the light values in tokens.css and
 * the print block of shell.css), so a dark-theme chart still prints dark on light.
 */
const PRINT_TOKENS: Record<string, string> = {
  '--text': '#000000', '--text-muted': '#3d4c53', '--surface': '#ffffff', '--surface-2': '#f1f4f5', '--bg': '#ffffff',
  '--border': '#c9d3d6', '--border-strong': '#6d7c82', '--chart-grid': '#e3e9eb', '--chart-axis': '#b9c5c9',
  '--brand': '#17656f', '--brand-contrast': '#ffffff', '--link': '#0f525b',
  '--series-1': '#2a78d6', '--series-2': '#eb6834', '--series-3': '#1aa976', '--series-4': '#c88800',
  '--series-5': '#e56c9a', '--series-6': '#008300', '--series-7': '#6250d6', '--series-8': '#e34948',
  '--c-gray-solid': '#6a7a81', '--c-blue-solid': '#2a78d6', '--c-teal-solid': '#14908a', '--c-green-solid': '#2a9143',
  '--c-amber-solid': '#c98500', '--c-orange-solid': '#dd6420', '--c-red-solid': '#d03b3b', '--c-purple-solid': '#6f52d0',
};
type Read = (name: string) => string;
const screenVar: Read = cssVar;
const printVar: Read = (name) => PRINT_TOKENS[name] ?? cssVar(name);

function resolveTokens<T>(value: T, read: Read = screenVar): T {
  if (typeof value === 'string') {
    const m = TOKEN.exec(value);
    return (m ? read(m[1]) : value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveTokens(v, read)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTokens(v, read)])) as T;
  }
  return value;
}

/** First of the given custom properties that has a value: the app's tokens, then the Mantine theme. */
function token(read: Read, ...names: string[]): string {
  for (const name of names) {
    const value = read(name);
    if (value) return value;
  }
  return '';
}

function themeFromTokens(read: Read = screenVar) {
  const text = token(read, '--text', '--mantine-color-text');
  const muted = token(read, '--text-muted', '--mantine-color-dimmed');
  const surface = token(read, '--surface', '--mantine-color-body');
  const border = token(read, '--border', '--mantine-color-default-border');
  const grid = token(read, '--chart-grid', '--mantine-color-default-border');
  const axisLine = token(read, '--chart-axis', '--mantine-color-default-border');
  const fontFamily = token(screenVar, '--mantine-font-family', '--font') || 'system-ui, sans-serif';
  const label = { color: muted, fontSize: LABEL_SIZE, fontFamily };
  return {
    color: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => read(`--series-${n}`)).filter(Boolean),
    backgroundColor: 'transparent',
    textStyle: { color: text, fontFamily, fontSize: 12 },
    categoryAxis: {
      axisLine: { lineStyle: { color: axisLine } },
      axisTick: { show: false },
      axisLabel: { ...label, hideOverlap: true },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: label,
      splitLine: { lineStyle: { color: grid, width: 1, type: 'solid' } },
    },
    legend: {
      textStyle: { color: muted, fontSize: 12, fontFamily },
      icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 16,
      pageTextStyle: { color: muted }, pageIconColor: muted, pageIconInactiveColor: grid,
    },
    tooltip: {
      backgroundColor: surface,
      borderColor: border,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: text, fontSize: 13, fontFamily },
      axisPointer: { lineStyle: { color: axisLine }, crossStyle: { color: axisLine }, shadowStyle: { color: grid, opacity: 0.35 } },
      extraCssText: 'border-radius: 8px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);',
    },
    visualMap: { textStyle: { color: muted, fontFamily } },
    // Mark specs: thin bars with a rounded data end, 2px lines, 8px markers ringed in the surface color,
    // and a 2px surface gap between touching fills.
    bar: { barMaxWidth: 24, barGap: '15%', itemStyle: { borderRadius: [4, 4, 0, 0] } },
    line: { lineStyle: { width: 2, cap: 'round', join: 'round' }, symbol: 'circle', symbolSize: 8, itemStyle: { borderColor: surface, borderWidth: 2 } },
    pie: { itemStyle: { borderColor: surface, borderWidth: 2 }, label: { color: text, fontFamily }, labelLine: { lineStyle: { color: axisLine } } },
    heatmap: { itemStyle: { borderColor: surface, borderWidth: 2 }, label: { color: text, fontFamily }, lineStyle: { color: axisLine } },
    graph: { label: { color: text, fontFamily }, lineStyle: { color: token(read, '--border-strong', '--mantine-color-dimmed') } },
  };
}

/* ---------- category labels that never touch (E18-36) ---------- */

type Loose = Record<string, unknown>;
const asList = (v: unknown): Loose[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []) as Loose[];
let measureCtx: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string): number {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 6.5;
  measureCtx.font = `${LABEL_SIZE}px ${token(screenVar, '--mantine-font-family', '--font') || 'system-ui, sans-serif'}`;
  return measureCtx.measureText(text).width;
}
const px = (v: unknown, whole: number, fallback: number) => (typeof v === 'number' ? v
  : typeof v === 'string' && v.endsWith('%') ? (parseFloat(v) / 100) * whole : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : fallback);

/**
 * Category labels along the bottom of a chart are fitted to the room each category has: kept on
 * one line when they fit, wrapped onto two lines when there is room for a short word per line,
 * and otherwise tilted and shortened, with the ones that would still overlap left out. An axis
 * whose labels the option already tilts is left alone. Returns the axis and grid changes.
 */
export function fitCategoryLabels(option: Loose, chartWidth: number, measure: (s: string) => number = textWidth): { xAxis?: Loose[]; grid?: Loose } {
  const axes = asList(option.xAxis);
  if (!axes.length || chartWidth <= 0) return {};
  const grid = { ...DEFAULT_GRID, ...(asList(option.grid)[0] ?? {}) } as Loose;
  const plot = chartWidth - px(grid.left, chartWidth, DEFAULT_GRID.left) - px(grid.right, chartWidth, DEFAULT_GRID.right);
  let extraBottom = 0;
  let changed = false;
  const fitted = axes.map((axis) => {
    const label = (axis.axisLabel ?? {}) as Loose;
    const data = Array.isArray(axis.data) ? axis.data : null;
    if (axis.type !== 'category' || !data?.length || label.rotate || label.show === false || axis.position === 'top') return axis;
    const names = data.map((d) => String((d as Loose)?.value ?? d ?? ''));
    const slot = plot / names.length;
    const widest = Math.max(...names.map(measure));
    changed = true;
    if (widest <= slot - 10) return { ...axis, axisLabel: { ...label, interval: 0, width: undefined, overflow: 'none' } };
    // Room for a short word on each line: wrap onto at most two lines.
    const longestWord = Math.max(...names.flatMap((n) => n.split(/\s+/)).map(measure));
    if (slot >= 44 && longestWord <= slot - 10) {
      extraBottom = Math.max(extraBottom, LABEL_SIZE + 4);
      return { ...axis, axisLabel: { ...label, interval: 0, width: Math.floor(slot - 10), overflow: 'break', lineOverflow: 'truncate', hideOverlap: false, height: (LABEL_SIZE + 3) * 2, lineHeight: LABEL_SIZE + 3 } };
    }
    // Too narrow: tilt and shorten, and leave out labels that would still overlap.
    const width = Math.min(110, Math.max(48, Math.ceil(widest) + 8));
    extraBottom = Math.max(extraBottom, Math.round(width * Math.sin(Math.PI / 5)) - 6);
    return { ...axis, axisLabel: { ...label, interval: 'auto', rotate: 36, width, overflow: 'truncate', hideOverlap: true } };
  });
  if (!changed) return {};
  return {
    xAxis: fitted,
    grid: extraBottom ? { ...grid, bottom: px(grid.bottom, 0, DEFAULT_GRID.bottom) + extraBottom } : undefined,
  };
}

/** Changes whenever the color scheme changes, whichever attribute carries it. */
function useSchemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mantine-color-scheme'] });
    return () => observer.disconnect();
  }, []);
  return version;
}

/** The full option drawn: defaults, the given option with its tokens resolved, legend room and fitted labels. */
function fullOption(option: ChartProps['option'], width: number, opts: { read?: Read; print?: boolean } = {}) {
  const calm = opts.print || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const read = opts.read ?? screenVar;
  // A legend sits above the plot unless the option places it; the default plot margins make room for it.
  const given = (option as { legend?: unknown }).legend;
  const legend = given && typeof given === 'object' && !Array.isArray(given) ? (given as Loose) : null;
  const placed = legend !== null && (legend.top !== undefined || legend.bottom !== undefined);
  const legendFix = legend && !placed ? { legend: { top: 0, type: 'scroll', ...resolveTokens(legend, read) } } : {};
  const grid = !legend ? DEFAULT_GRID
    : legend.bottom !== undefined ? { ...DEFAULT_GRID, bottom: 64 }
      : { ...DEFAULT_GRID, top: 44 };
  const base = {
    grid,
    tooltip: { trigger: 'item', confine: true },
    animation: !calm,
    animationDuration: 450,
    animationDurationUpdate: 250,
    animationEasing: 'cubicOut',
    ...resolveTokens(option, read),
    ...legendFix,
  } as Loose;
  base.aria = { enabled: true, label: { description: ariaDescription(base) }, ...(opts.print ? { decal: { show: true } } : {}) };
  return { ...base, ...fitCategoryLabels(base, width) };
}

/**
 * The segments a click can open, for people who do not use a pointer (E18-42): one per data point of
 * every series, named after its series, category and value. Graph (map) series are left out.
 */
export function segmentsOf(option: Loose): { label: string; segment: ChartSegment }[] {
  const out: { label: string; segment: ChartSegment }[] = [];
  const axisData = (axis: unknown): unknown[] | null => {
    const a = (Array.isArray(axis) ? axis[0] : axis) as Loose | undefined;
    return a && a.type === 'category' && Array.isArray(a.data) ? (a.data as unknown[]) : null;
  };
  const categories = axisData(option.xAxis) ?? axisData(option.yAxis);
  const series = (Array.isArray(option.series) ? option.series : option.series ? [option.series] : []) as Loose[];
  const many = series.length > 1;
  for (const sr of series) {
    if (sr.type === 'graph' || !Array.isArray(sr.data)) continue;
    const seriesName = sr.name === undefined ? undefined : String(sr.name);
    (sr.data as unknown[]).forEach((item, dataIndex) => {
      const obj = item && typeof item === 'object' && !Array.isArray(item) ? (item as Loose) : null;
      const value = obj && 'value' in obj ? obj.value : item;
      if (value === null || value === undefined || value === '-') return;
      const catItem = categories?.[dataIndex];
      const cat = catItem && typeof catItem === 'object' ? (catItem as Loose).value : catItem;
      const name = String(obj?.name ?? cat ?? '');
      const shown = Array.isArray(value) ? value[value.length - 1] : value;
      const label = [many && seriesName ? seriesName : null, name || null, String(shown)].filter(Boolean).join(': ');
      out.push({ label: `Open ${label}`, segment: { name, value, seriesName, dataIndex, data: item } });
    });
  }
  return out.slice(0, 200);
}

export default function ChartImpl({ option, label, height = 280, onSegmentClick, describedBy }: ChartProps & { describedBy?: string }) {
  const elRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLImageElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onSegmentClick);
  clickRef.current = onSegmentClick;
  const optionRef = useRef(option);
  optionRef.current = option;
  /** How the category labels were last fitted, so that a resize draws again only when that changes. */
  const fitRef = useRef('');
  const scheme = useSchemeVersion();
  const clickable = Boolean(onSegmentClick);

  // (Re)create the chart when the color scheme changes, so every color follows it.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const chart = echarts.init(el, themeFromTokens());
    chartRef.current = chart;
    chart.on('click', (p) => {
      clickRef.current?.({
        name: String(p.name ?? ''),
        value: p.value,
        seriesName: p.seriesName,
        dataIndex: p.dataIndex,
        data: p.data,
      });
    });
    // A change of width can change how the category labels fit; draw again only when it does.
    const observer = new ResizeObserver(() => {
      chart.resize();
      const next = fullOption(optionRef.current, chart.getWidth());
      const fit = JSON.stringify([next.xAxis, next.grid]);
      if (fit !== fitRef.current) { fitRef.current = fit; chart.setOption(next, true); }
    });
    observer.observe(el);

    // Printing: the chart is drawn again on white with patterns as well as colors (so the series can
    // be told apart in black and white), as a sharp picture that scales to the page.
    const beforePrint = () => {
      const img = printRef.current;
      if (!img || !el.isConnected) return;
      const paper = echarts.init(document.createElement('div'), themeFromTokens(printVar), { width: chart.getWidth() || 600, height: chart.getHeight() || height, renderer: 'canvas' });
      try {
        paper.setOption(fullOption(optionRef.current, chart.getWidth(), { read: printVar, print: true }));
        img.src = paper.getDataURL({ type: 'png', pixelRatio: 3, backgroundColor: '#ffffff' });
        // Its own size, never stretched: a chart drawn for a narrow widget stays legible and in proportion.
        img.style.width = `${chart.getWidth() || 600}px`;
        img.style.display = 'block';
        el.style.display = 'none';
      } finally {
        paper.dispose();
      }
    };
    const afterPrint = () => {
      if (printRef.current) { printRef.current.style.display = 'none'; printRef.current.removeAttribute('src'); }
      el.style.display = '';
    };
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    return () => {
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [scheme, height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const next = fullOption(option, chart.getWidth());
    fitRef.current = JSON.stringify([next.xAxis, next.grid]);
    chart.setOption(next, true);
  }, [option, scheme]);

  return (
    <>
      <div
        ref={elRef}
        className="rc-chart"
        role="img"
        aria-label={label}
        aria-describedby={describedBy}
        data-clickable={clickable || undefined}
        style={{ height }}
      />
      {clickable && (
        // Hidden until focused: the same drill-down as clicking the chart, reachable with Tab.
        <ul className="rc-chart-keys" aria-label={`${label}: open the records behind a part of the chart`}>
          {segmentsOf(option as Loose).map(({ label: text, segment }, i) => (
            <li key={i}><button type="button" onClick={() => clickRef.current?.(segment)}>{text}</button></li>
          ))}
        </ul>
      )}
      <img ref={printRef} alt={label} className="rc-chart-print" style={{ display: 'none', maxWidth: '100%', height: 'auto', margin: '0 auto', breakInside: 'avoid' }} />
    </>
  );
}
