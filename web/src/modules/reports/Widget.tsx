// What a dashboard widget shows. Each widget asks the server for its own figures (worked out
// with the viewer's permissions) and has its own loading, empty, unavailable and error states,
// so one widget never takes the dashboard down.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Countdown, ErrorState, Icon, Loading, ProgressBar, StatusChip, formatNumber, toColorName, todayInZone } from '../../core';
import type { IconName } from '../../core';
import { cellText, compact, usePost } from './data';
import { ResultTable, ResultView, useDrill } from './ResultView';
import type { Globals, GlobalKind, ReportResult, Widget, WidgetData } from './types';
import { CalendarGrid, Gauge, Markdown } from './visuals';

const GLOBAL_WORDS: Record<GlobalKind, string> = { date: 'dates', department: 'department', site: 'site', system: 'system', owner: 'owner' };
export const activeGlobals = (g: Globals): GlobalKind[] => [
  ...(g.from || g.to ? ['date' as const] : []), ...(g.department ? ['department' as const] : []), ...(g.site ? ['site' as const] : []),
  ...(g.system ? ['system' as const] : []), ...(g.owner ? ['owner' as const] : []),
];

function Quiet({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return <div className="rp-quiet"><Icon name={icon} size={20} /><span>{children}</span></div>;
}

function NumberBody({ widget, data }: { widget: Widget; data: WidgetData }) {
  const drill = useDrill();
  const cfg = widget.config;
  const v = data.value ?? 0;
  const text = compact(v, cfg.format === 'currency');
  const t = data.trend;
  const diff = t ? t.current - t.previous : 0;
  const good = diff === 0 ? 'neutral' : (diff > 0) === Boolean(cfg.trend?.upIsGood) ? 'good' : 'bad';
  const noun = cfg.trend?.noun ?? 'added';
  const trend = t && (
    <p className={`rp-trend rp-trend-${good}`}>
      <Icon name={diff > 0 ? 'arrow-up' : diff < 0 ? 'arrow-down' : 'minus'} size={16} label={diff > 0 ? 'Up' : diff < 0 ? 'Down' : 'No change'} />
      <span><strong>{formatNumber(t.current)}</strong> {noun} in the last {t.days} days{diff === 0 ? ', the same as' : `, ${formatNumber(Math.abs(diff))} ${diff > 0 ? 'more' : 'fewer'} than`} the {t.days} days before</span>
    </p>
  );
  const open = () => data.result && drill(data.result, data.result.drill);
  if (cfg.sentence) {
    // {one|many} picks the words for a figure of exactly one, or of any other figure: "{project is|projects are}".
    const [before, after] = String(cfg.sentence).replace(/\{([^{}|]*)\|([^{}]*)\}/g, (_m, one: string, many: string) => (v === 1 ? one : many)).split('{value}');
    return (
      <div className="rp-sentence">
        <button type="button" className="rp-sentence-text rp-clickable" onClick={open} title="See the records behind this figure">
          {before}<strong className={`rp-sentence-value${cfg.tone === 'bad' && v > 0 ? ' is-bad' : ''}`}>{text}</strong>{after}
        </button>
        {trend}
      </div>
    );
  }
  return (
    <div className="rp-number">
      <button type="button" className="rp-number-value rp-clickable" onClick={open} title="See the records behind this figure">
        {cfg.icon && <span className={`rp-number-icon${cfg.tone === 'bad' && v > 0 ? ' is-bad' : cfg.tone === 'good' ? ' is-good' : ''}`}><Icon name={cfg.icon as IconName} size={20} /></span>}
        <span>{text}</span>
      </button>
      {trend}
    </div>
  );
}

function ShareBody({ widget, data }: { widget: Widget; data: WidgetData }) {
  const drill = useDrill();
  const cfg = widget.config;
  const v = data.value ?? 0;
  const money = cfg.format === 'currency';
  const whole = data.denominator ?? null;
  const pct = whole ? Math.round((v / whole) * 100) : null;
  const open = () => data.result && drill(data.result, data.result.drill);
  if (widget.kind === 'gauge') {
    return pct !== null
      ? <div className="rp-gauge-wrap"><Gauge value={pct} max={100} target={cfg.target} label={widget.title} valueText={`${pct}%`} onClick={open} /><p className="muted">{compact(v, money)} of {compact(whole!, money)}</p></div>
      : whole === 0 ? <Quiet icon="info">Nothing to measure yet.</Quiet>
      : <div className="rp-gauge-wrap"><Gauge value={v} max={cfg.max ?? Math.max(v, (cfg.target ?? 0) * 1.25, 1)} target={cfg.target} label={widget.title} valueText={compact(v, money)} onClick={open} /></div>;
  }
  const max = whole ?? cfg.target ?? null;
  if (max === null || max === 0) return <Quiet icon="info">{max === 0 ? 'Nothing to measure yet.' : 'Set a target for this widget to show progress.'}</Quiet>;
  const share = Math.round((v / max) * 100);
  return (
    <div className="rp-progress">
      <button type="button" className="rp-progress-head rp-clickable" onClick={open} title="See the records behind this figure">
        <strong>{share}%</strong><span className="muted">{compact(v, money)} of {compact(max, money)}</span>
      </button>
      <ProgressBar value={Math.min(v, max)} max={max} hideLabel label={`${widget.title}: ${share}%`} color={share >= 100 ? 'green' : 'teal'} />
    </div>
  );
}

function ListBody({ result }: { result: ReportResult }) {
  const [first, ...rest] = result.columns;
  if (!result.rows.length) return <Quiet icon="check-circle">Nothing to show.</Quiet>;
  return (
    <ul className="rp-list">
      {result.rows.map((row) => (
        <li key={row.id}>
          <Link to={`${result.route}/${row.id}`} className="rp-list-title truncate">
            {row.v[first.key] !== null && row.v[first.key] !== undefined && row.v[first.key] !== '' ? cellText(first, row) : 'Untitled'}
          </Link>
          <span className="rp-list-meta">
            {rest.map((c) => (row.v[c.key] === null || row.v[c.key] === undefined ? null
              : row.c?.[c.key] ? <StatusChip key={c.key} color={toColorName(row.c[c.key])} label={row.d[c.key]} />
              : <span key={c.key} className="truncate" title={c.label}>{cellText(c, row)}</span>))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CountdownBody({ widget, data }: { widget: Widget; data?: WidgetData }) {
  const cfg = widget.config;
  if (!cfg.spec) return cfg.deadline ? <div className="rp-countdown-one"><Countdown label={cfg.label || 'Time left'} deadline={cfg.deadline} /></div> : <Quiet icon="clock">Set a date for this countdown.</Quiet>;
  const r = data?.result;
  if (!r || !r.rows.length) return <Quiet icon="check-circle">Nothing coming up.</Quiet>;
  return (
    <ul className="rp-list">
      {r.rows.map((row) => (
        <li key={row.id}>
          <Link to={`${r.route}/${row.id}`} className="rp-list-title truncate">{cellText(r.columns[0], row)}</Link>
          <Countdown label="" deadline={String(row.v.c1)} warnMs={14 * 86400000} />
        </li>
      ))}
    </ul>
  );
}

export interface WidgetBodyProps { widget: Widget; dashboardId?: string; globals: Globals; tick: number; height: number }

export function WidgetBody({ widget, dashboardId, globals, tick, height }: WidgetBodyProps) {
  const drill = useDrill();
  const cfg = widget.config ?? {};
  const [month, setMonth] = useState(todayInZone().slice(0, 7));
  const needsData = widget.kind !== 'text' && !(widget.kind === 'countdown' && !cfg.spec);
  const body = useMemo(
    () => (needsData ? { widget: { kind: widget.kind, config: cfg }, dashboardId, globals, ...(widget.kind === 'calendar' ? { month } : {}) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needsData, widget.kind, JSON.stringify(cfg), dashboardId, JSON.stringify(globals), month],
  );
  const { data, error, reload } = usePost<WidgetData>('/api/dashboards/run-widget', body, tick);

  if (widget.kind === 'text') return cfg.markdown ? <Markdown source={String(cfg.markdown)} /> : <Quiet icon="edit">Write some text for this widget.</Quiet>;
  if (!needsData) return <CountdownBody widget={widget} />;
  if (error && !data) return <ErrorState title="This widget could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={widget.h > 2 ? 4 : 2} label={`Loading ${widget.title}`} />;
  if (data.status === 'unavailable') return <Quiet icon="info">{data.message}</Quiet>;
  if (data.status === 'forbidden') return <Quiet icon="lock">{data.message}</Quiet>;
  if (data.status === 'error') return <Quiet icon="alert-circle">{data.message}</Quiet>;

  const result = data.result;
  const note = notNarrowedBy(globals, result?.globalsApplied);
  return (
    <>
      {renderKind()}
      {note && <p className="rp-widget-note" title={note}><Icon name="filter" size={12} /> {note}</p>}
    </>
  );

  function renderKind() {
    switch (widget.kind) {
    case 'number': return <NumberBody widget={widget} data={data!} />;
    case 'gauge': case 'progress': return <ShareBody widget={widget} data={data!} />;
    case 'countdown': return <CountdownBody widget={widget} data={data} />;
    case 'list': return result ? <ListBody result={result} /> : null;
    case 'table': return result ? (result.rows.length ? <ResultTable result={result} maxRows={50} /> : <Quiet icon="check-circle">Nothing to show.</Quiet>) : null;
    case 'calendar': {
      if (!result) return null;
      const days = Object.fromEntries(result.rows.filter((r) => r.v.g0).map((r) => [String(r.v.g0), { count: Number(r.v.a0) || 0, drill: r.drill }]));
      return <CalendarGrid month={month} days={days} today={todayInZone()} onMonth={setMonth} onDay={(q) => drill(result, q)} noun={result.plural.toLowerCase()} />;
    }
    default:
      // Grouped by a multi-choice field: a one-line note under the chart says how records are counted.
      return result ? <ResultView result={result} chart={data!.chart ?? { kind: 'table' }} label={widget.title || 'Chart'} height={Math.max(140, height - (result.countingNote ? 28 : 0))} maxRows={50} shortNote /> : null;
    }
  }
}

/** Dashboard-wide filters that are switched on but do not apply to this widget's records. */
export function notNarrowedBy(globals: Globals, applied: string[] | undefined): string | null {
  if (!applied) return null;
  const missing = activeGlobals(globals).filter((k) => !applied.includes(k));
  return missing.length ? `Not narrowed by ${missing.map((k) => GLOBAL_WORDS[k]).join(', ')}: these records have no such field.` : null;
}
