// The ECharts part of Chart, loaded on demand. Only the chart types we use are registered.
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, GraphChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ChartProps } from './Chart';
import { cssVar, useTheme } from './theme';

echarts.use([
  BarChart, LineChart, PieChart, HeatmapChart, GraphChart,
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, AriaComponent, CanvasRenderer,
]);

// Tighter than the ECharts default; an option's own `grid` replaces it.
const DEFAULT_GRID = { top: 24, right: 16, bottom: 32, left: 48 };
const TOKEN =/^var\((--[\w-]+)\)$/;

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

function themeFromTokens() {
  const text = cssVar('--text');
  const muted = cssVar('--text-muted');
  const surface = cssVar('--surface');
  const axis = { lineStyle: { color: cssVar('--chart-axis') } };
  return {
    color: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => cssVar(`--series-${n}`)),
    backgroundColor: 'transparent',
    textStyle: { color: text, fontFamily: cssVar('--font') },
    categoryAxis: { axisLine: axis, axisTick: { show: false }, axisLabel: { color: muted }, splitLine: { show: false } },
    valueAxis: {
      axisLine: { show: false },
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: cssVar('--chart-grid') } },
    },
    legend: { textStyle: { color: muted } },
    tooltip: {
      backgroundColor: surface,
      borderColor: cssVar('--border'),
      textStyle: { color: text },
      extraCssText: 'box-shadow: var(--shadow-2);',
    },
    visualMap: { textStyle: { color: muted } },
    bar: { barMaxWidth: 28, itemStyle: { borderRadius: [4, 4, 0, 0] } },
    line: { lineStyle: { width: 2 }, symbolSize: 8 },
    pie: { itemStyle: { borderColor: surface, borderWidth: 2 }, label: { color: text } },
    heatmap: { itemStyle: { borderColor: surface, borderWidth: 2 }, label: { color: text } },
    graph: { label: { color: text }, lineStyle: { color: cssVar('--border-strong') } },
  };
}

export default function ChartImpl({ option, label, height = 280, onSegmentClick }: ChartProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onSegmentClick);
  clickRef.current = onSegmentClick;
  const { theme } = useTheme();

  // (Re)create the chart when the theme changes, so every colour follows it.
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
  }, [theme]);

  useEffect(() => {
    chartRef.current?.setOption({ aria: { enabled: true }, grid: DEFAULT_GRID, ...resolveTokens(option) }, true);
  }, [option, theme]);

  return <div ref={elRef} className="chart" role="img" aria-label={label} style={{ height }} />;
}
