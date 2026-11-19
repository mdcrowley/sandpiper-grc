// The ECharts part of Chart, loaded on demand. Only the chart types we use are registered.
import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, GraphChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ChartProps } from './Chart';
import { cssVar } from './theme';

echarts.use([
  BarChart, LineChart, PieChart, HeatmapChart, GraphChart,
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, AriaComponent, CanvasRenderer,
]);

// Tighter than the ECharts default; an option's own `grid` replaces it.
const DEFAULT_GRID = { top: 24, right: 16, bottom: 32, left: 48 };

/**
 * Words ECharts writes for screen readers in place of the picture (its aria component). Its own
 * defaults number the series from 0 ("The 0 series is a Line chart"); these read as plain English.
 */
const ARIA_LABEL = {
  general: { withTitle: 'Chart: {title}.', withoutTitle: 'Chart.' },
  series: {
    maxCount: 8,
    single: { prefix: '', withName: ' A {seriesType} of {seriesName}.', withoutName: ' A {seriesType}.' },
    multiple: {
      prefix: ' {seriesCount} series.', withName: ' {seriesName}: a {seriesType}.', withoutName: ' A {seriesType}.',
      separator: { middle: '', end: '' },
    },
  },
  data: {
    maxCount: 12, allData: ' Values: ', partialData: ' The first {displayCnt} values: ',
    withName: '{name} {value}', withoutName: '{value}', separator: { middle: '; ', end: '.' },
  },
};
const TOKEN = /^var\((--[\w-]+)\)$/;

function resolveTokens<T>(value: T): T {
  if (typeof value === 'string') {
    const m = TOKEN.exec(value);
    return (m ? cssVar(m[1]) : value) as T;
  }
  if (Array.isArray(value)) return value.map(resolveTokens) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTokens(v)])) as T;
  }
  return value;
}

/** First of the given custom properties that has a value: the app's tokens, then the Mantine theme. */
function token(...names: string[]): string {
  for (const name of names) {
    const value = cssVar(name);
    if (value) return value;
  }
  return '';
}

function themeFromTokens() {
  const text = token('--text', '--mantine-color-text');
  const muted = token('--text-muted', '--mantine-color-dimmed');
  const surface = token('--surface', '--mantine-color-body');
  const border = token('--border', '--mantine-color-default-border');
  const grid = token('--chart-grid', '--mantine-color-default-border');
  const axisLine = token('--chart-axis', '--mantine-color-default-border');
  const fontFamily = token('--mantine-font-family', '--font') || 'system-ui, sans-serif';
  const label = { color: muted, fontSize: 12, fontFamily };
  return {
    color: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => cssVar(`--series-${n}`)).filter(Boolean),
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
    heatmap: { itemStyle: { borderColor: surface, borderWidth: 2 }, label: { color: text, fontFamily } },
    graph: { label: { color: text, fontFamily }, lineStyle: { color: token('--border-strong', '--mantine-color-dimmed') } },
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

export default function ChartImpl({ option, label, height = 280, onSegmentClick, describedBy }: ChartProps & { describedBy?: string }) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onSegmentClick);
  clickRef.current = onSegmentClick;
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
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [scheme]);

  useEffect(() => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // A legend sits above the plot unless the option places it; the default plot margins make room for it.
    const given = (option as { legend?: unknown }).legend;
    const legend = given && typeof given === 'object' && !Array.isArray(given) ? (given as Record<string, unknown>) : null;
    const placed = legend !== null && (legend.top !== undefined || legend.bottom !== undefined);
    const legendFix = legend && !placed ? { legend: { top: 0, type: 'scroll', ...resolveTokens(legend) } } : {};
    const grid = !legend ? DEFAULT_GRID
      : legend.bottom !== undefined ? { ...DEFAULT_GRID, bottom: 64 }
        : { ...DEFAULT_GRID, top: 44 };
    chartRef.current?.setOption({
      aria: { enabled: true, label: ARIA_LABEL },
      grid,
      tooltip: { trigger: 'item', confine: true },
      animation: !calm,
      animationDuration: 450,
      animationDurationUpdate: 250,
      animationEasing: 'cubicOut',
      ...resolveTokens(option),
      ...legendFix,
    }, true);
  }, [option, scheme]);

  return (
    <div
      ref={elRef}
      className="rc-chart"
      role="img"
      aria-label={label}
      aria-describedby={describedBy}
      data-clickable={clickable || undefined}
      style={{ height }}
    />
  );
}
