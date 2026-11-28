// The dashboard widget for one strategic measure (E46-60): the latest actual against the target of that
// period, how it compares, and targets and actuals over the last periods. The reports module's
// dashboards show it (reports/Widget.tsx, kind `measure`) and set it up with MeasureWidgetSettings
// (reports/WidgetEditor.tsx). The server works it out as the viewer (strategy/widget.ts): someone who
// may not view the strategy area sees "Your role does not include this information", and while the
// area is switched off the widget is left out of the dashboard (config.recordType).
import { Link } from 'react-router-dom';
import { Chart, chartColor, formatNumber, LookupChip, Select, useFetch, type ListResult, type Row } from '../../core';
import './strategy.css';

export interface MeasureWidgetMeasure {
  id: string; ref: string | null; title: string; unit: string | null; direction: string | null; frequency: string | null; source: string | null;
  objective: string | null; latest_period: string | null; latest_label: string | null; latest_value: number | null; latest_target: number | null;
  latest_state: string | null; latest_state_label: string | null; route: string;
}
interface MeasureResult { rows: { v: { g0: string; a0: number | null; a1: number | null }; d: { g0: string } }[] }

const value = (n: number | null, unit: string | null) => (n === null ? '—' : `${formatNumber(n)}${unit ? ` ${unit}` : ''}`);

export function MeasureWidgetBody({ measure, result, height }: { measure: MeasureWidgetMeasure; result?: MeasureResult | null; height: number }) {
  const rows = result?.rows ?? [];
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Target', 'Actual'], bottom: 0 },
    grid: { left: 56, right: 12, top: 12, bottom: 44 },
    xAxis: { type: 'category', data: rows.map((r) => r.d.g0) },
    yAxis: { type: 'value', scale: true },
    series: [
      { name: 'Target', type: 'line', data: rows.map((r) => r.v.a0), lineStyle: { type: 'dashed' }, color: chartColor('gray') },
      { name: 'Actual', type: 'line', data: rows.map((r) => r.v.a1), color: chartColor('blue'), connectNulls: false },
    ],
  };
  return (
    <div className="stg-widget">
      <div className="stg-widget-head">
        <Link to={measure.route} className="stg-widget-value" title={`Open ${measure.title}`}>{value(measure.latest_value, measure.unit)}</Link>
        <div className="stg-widget-meta">
          {measure.latest_value === null
            ? <span className="muted">No actual yet</span>
            : (
              <>
                <span className="muted">{measure.latest_label}{measure.latest_target !== null ? `, target ${value(measure.latest_target, measure.unit)}` : ', no target'}</span>
                {measure.latest_state && <LookupChip list="measure_state" value={measure.latest_state} />}
              </>
            )}
        </div>
      </div>
      <Chart label={`Target and actual of ${measure.title} by period`} option={option} height={Math.max(120, height - 64)}
        empty={rows.length === 0} emptyMessage="No targets or actuals yet" />
    </div>
  );
}

/** The widget's settings: which measure, and how many periods the trend shows. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Config = Record<string, any>;

export function MeasureWidgetSettings({ config, title, onChange }: { config: Config; title: string; onChange: (config: Config, title?: string) => void }) {
  const list = useFetch<ListResult<Row>>('/api/strategy/measures?pageSize=200&sort=ref&dir=asc');
  const rows = list.data?.rows ?? [];
  return (
    <>
      <Select label="Measure" required searchable value={String(config.measureId ?? '')} placeholder="Choose a measure…"
        options={rows.map((m) => ({ value: String(m.id), label: `${m.ref ? `${m.ref} ` : ''}${m.title}` }))}
        onChange={(measureId) => {
          const m = rows.find((x) => x.id === measureId);
          onChange({ ...config, measureId, recordType: 'strategic_measure' }, title || (m ? String(m.title) : undefined));
        }}
        error={list.error ? 'Strategic measures are not available to your role.' : undefined}
        hint={list.data && !rows.length ? 'No measures yet. Add them to the objectives of a strategic plan under Strategy.' : 'Shows its latest actual against the target of that period, and its trend.'} />
      <Select label="Periods to show" value={String(config.periods ?? 8)} onChange={(p) => onChange({ ...config, periods: Number(p) })}
        options={[4, 6, 8, 12].map((n) => ({ value: String(n), label: `Last ${n} periods` }))} />
    </>
  );
}
