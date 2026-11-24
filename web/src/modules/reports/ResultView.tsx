// Draws a report result in the chosen form: table, pivot table, number, gauge, chart or calendar.
// Every figure and chart segment opens the list of records behind it (the record type's own list
// page, with the filters in the address).
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Chart, EmptyState, Icon, StatusChip, TableWrap, toColorName, todayInZone } from '../../core';
import { buildChart, chartFit } from './charts';
import { cellText, compact, formatValue } from './data';
import type { ChartSpec, ReportResult, ResultColumn, ResultRow } from './types';
import { CalendarGrid, Gauge } from './visuals';

export function useDrill() {
  const navigate = useNavigate();
  return (result: Pick<ReportResult, 'route'>, query: string | null | undefined) => navigate(`${result.route}${query ? `?${query}` : ''}`);
}

const isNumeric = (c: ResultColumn) => c.role === 'agg' || c.type === 'number' || c.type === 'currency';

function Cell({ col, row }: { col: ResultColumn; row: ResultRow }) {
  const v = row.v[col.key];
  if (v === null || v === undefined || v === '') return <span className="muted">{col.role === 'dim' ? 'None' : '—'}</span>;
  if (row.c?.[col.key]) return <StatusChip color={toColorName(row.c[col.key])} label={row.d[col.key]} />;
  const text = cellText(col, row);
  return <>{text.length > 140 ? `${text.slice(0, 140)}…` : text}</>;
}

export function ResultTable({ result, maxRows = 200, sticky, label }: { result: ReportResult; maxRows?: number; sticky?: boolean; label?: string }) {
  const name = label ? `${label}: results` : 'Report results';
  const drill = useDrill();
  if (result.pivot) {
    const p = result.pivot;
    return (
      <TableWrap label={name} className={`rp-table${sticky ? ' rp-table-sticky' : ''}`}>
        <table className="table">
          <thead><tr>
            <th scope="col">{result.columns[0].label}</th>
            {p.cols.map((c, i) => <th key={i} scope="col" className="num">{c.color ? <StatusChip color={toColorName(c.color)} label={c.label} /> : c.label}</th>)}
            <th scope="col" className="num">Total</th>
          </tr></thead>
          <tbody>
            {p.rows.map((row, i) => (
              <tr key={i}>
                <th scope="row">{row.label}</th>
                {p.cells[i].map((cell, j) => (
                  <td key={j} className="num">{cell ? <button type="button" className="rp-link-num" onClick={() => drill(result, cell.drill)}>{formatValue(cell.v)}</button> : <span className="muted">·</span>}</td>
                ))}
                <td className="num rp-total">{p.rowTotals[i] === null ? '' : <button type="button" className="rp-link-num" onClick={() => drill(result, row.drill)}>{formatValue(p.rowTotals[i])}</button>}</td>
              </tr>
            ))}
          </tbody>
          {p.colTotals.some((v) => v !== null) && <tfoot><tr>
            <th scope="row">Total</th>
            {p.colTotals.map((v, j) => <td key={j} className="num rp-total">{v === null ? '' : <button type="button" className="rp-link-num" onClick={() => drill(result, p.cols[j].drill)}>{formatValue(v)}</button>}</td>)}
            <td className="num rp-total">{p.grand === null ? '' : formatValue(p.grand)}</td>
          </tr></tfoot>}
        </table>
      </TableWrap>
    );
  }
  const rows = result.rows.slice(0, maxRows);
  const firstAgg = result.columns.find((c) => c.role === 'agg')?.key;
  return (
    <TableWrap label={name} className={`rp-table${sticky ? ' rp-table-sticky' : ''}`}>
      <table className="table">
        <thead><tr>{result.columns.map((c) => <th key={c.key} scope="col" className={isNumeric(c) ? 'num' : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i}>
              {result.columns.map((c, j) => (
                <td key={c.key} className={isNumeric(c) ? 'num' : undefined}>
                  {result.mode === 'rows' && j === 0 && row.id
                    ? <Link to={`${result.route}/${row.id}`}><Cell col={c} row={row} /></Link>
                    : c.key === firstAgg && row.drill !== undefined
                      ? <button type="button" className="rp-link-num" title="See these records" onClick={() => drill(result, row.drill)}>{cellText(c, row)}</button>
                      : <Cell col={c} row={row} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(result.rows.length > rows.length || result.truncated) && (
        <p className="rp-table-note muted">Showing the first {rows.length} of {result.mode === 'rows' ? result.total : 'many'} rows. Export the report to get every row.</p>
      )}
    </TableWrap>
  );
}

function Figures({ result, big }: { result: ReportResult; big?: boolean }) {
  const drill = useDrill();
  const row = result.rows[0] ?? { v: {}, d: {} };
  return (
    <div className={`rp-figures${big ? ' rp-figures-big' : ''}`}>
      {result.columns.map((c) => (
        <button key={c.key} type="button" className="rp-figure rp-clickable" onClick={() => drill(result, result.drill)} title="See the records behind this figure">
          <span className="rp-figure-value">{typeof row.v[c.key] === 'number' ? compact(row.v[c.key] as number, c.type === 'currency' && c.fn !== 'count') : cellText(c, row)}</span>
          <span className="rp-figure-label">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

function DayCalendar({ result }: { result: ReportResult }) {
  const drill = useDrill();
  const agg = result.columns.find((c) => c.role === 'agg')!;
  const days = useMemo(() => Object.fromEntries(result.rows.filter((r) => r.v.g0).map((r) => [String(r.v.g0), { count: Number(r.v[agg.key]) || 0, drill: r.drill }])), [result, agg.key]);
  const last = result.rows.map((r) => String(r.v.g0 ?? '')).filter(Boolean).sort().pop();
  const [month, setMonth] = useState((last ?? todayInZone()).slice(0, 7));
  return <CalendarGrid month={month} days={days} today={todayInZone()} onMonth={setMonth} onDay={(q) => drill(result, q)} noun={result.plural.toLowerCase()} />;
}

export interface ResultViewProps {
  result: ReportResult;
  chart?: ChartSpec | null;
  /** Pixel height of the chart area. */
  height?: number;
  /** Also show the numbers as a table under a chart. */
  withTable?: boolean;
  maxRows?: number;
  label: string;
  /** A dashboard widget: the note on multi-choice groupings in one short line (the full sentence on hover and for screen readers). */
  shortNote?: boolean;
}

export function ResultView({ result, chart, height = 300, withTable, maxRows, label, shortNote }: ResultViewProps) {
  const drill = useDrill();
  const kind = chart?.kind ?? 'table';
  const misfit = chartFit(kind, result);
  const built = useMemo(() => (misfit ? null : buildChart(kind, result, chart?.measure ?? 0)), [kind, result, chart?.measure, misfit]);

  if (result.mode !== 'total' && result.rows.length === 0) {
    return <EmptyState icon="search" title="No records match" message="Nothing fits the filters at the moment. Loosen a filter to see more." />;
  }
  // Grouped by a multi-choice field: say how records are counted, under the table or chart.
  const counting = !result.countingNote ? null : shortNote
    ? <p className="rp-table-note rp-counting-short muted" title={result.countingNote}><Icon name="info" size={14} /> <span aria-hidden="true">Records with several values count under each.</span><span className="sr-only">{result.countingNote}</span></p>
    : <p className="rp-table-note muted"><Icon name="info" size={14} /> {result.countingNote}</p>;
  const table = <ResultTable result={result} maxRows={maxRows} label={label} />;
  if (kind === 'table') return result.mode === 'total' ? <Figures result={result} /> : counting ? <div className="rp-result">{table}{counting}</div> : table;

  let visual: React.ReactNode = null;
  if (!misfit && (kind === 'number' || result.mode === 'total') && kind !== 'gauge') visual = <Figures result={result} big />;
  else if (!misfit && kind === 'gauge') {
    const col = result.columns[Math.min(chart?.measure ?? 0, result.columns.length - 1)];
    const v = Number(result.rows[0]?.v[col.key]) || 0;
    const max = chart?.max ?? (chart?.target ? Math.max(chart.target * 1.25, v) : Math.max(v, 1));
    visual = <Gauge value={v} max={max} target={chart?.target} label={col.label} valueText={formatValue(v, col)} onClick={() => drill(result, result.drill)} />;
  } else if (!misfit && kind === 'calendar') visual = <DayCalendar result={result} />;
  else if (built) {
    visual = (
      <Chart label={label} description={built.description} option={built.option} height={height}
        onSegmentClick={(seg) => { const q = built.drillFor(seg); drill(result, q ?? result.drill); }} />
    );
  }
  return (
    <div className="rp-result">
      {misfit && <p className="notice rp-misfit"><Icon name="info" size={16} /> This chart cannot be drawn yet. {misfit} The table shows the same figures.</p>}
      {visual}
      {(withTable || misfit) && result.mode !== 'total' && table}
      {counting}
    </div>
  );
}
