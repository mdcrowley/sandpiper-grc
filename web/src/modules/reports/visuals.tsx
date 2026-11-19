// Small visual pieces the Chart component does not cover: a gauge, a month calendar and safely
// rendered text. All colors come from the design tokens, so both themes work.
import { Fragment, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, cx, formatNumber } from '../../core';

// ---------- gauge ----------

export function Gauge({ value, max, target, label, valueText, onClick }: {
  value: number; max: number; target?: number; label: string; valueText: string; onClick?: () => void;
}) {
  const top = Math.max(max, 0.0001);
  const share = Math.min(1, Math.max(0, value / top));
  const met = target === undefined ? null : value >= target;
  // A half circle, 180 degrees, drawn left to right.
  const r = 80;
  const point = (t: number) => `${100 - r * Math.cos(Math.PI * t)} ${100 - r * Math.sin(Math.PI * t)}`;
  const arc = (to: number) => `M ${point(0)} A ${r} ${r} 0 0 1 ${point(to)}`;
  const tone = met === null ? 'var(--series-1)' : met ? 'var(--c-green-solid)' : 'var(--c-amber-solid)';
  const body = (
    <>
      <svg viewBox="0 0 200 112" className="rp-gauge-svg" role="img" aria-label={`${label}: ${valueText}${target !== undefined ? `, target ${formatNumber(target)}` : ''}`}>
        <path d={arc(1)} fill="none" stroke="var(--surface-2)" strokeWidth="16" strokeLinecap="round" />
        {share > 0 && <path d={arc(share)} fill="none" stroke={tone} strokeWidth="16" strokeLinecap="round" />}
        {target !== undefined && target > 0 && target < top && (() => {
          const t = target / top;
          const [x1, y1] = [100 - (r - 14) * Math.cos(Math.PI * t), 100 - (r - 14) * Math.sin(Math.PI * t)];
          const [x2, y2] = [100 - (r + 14) * Math.cos(Math.PI * t), 100 - (r + 14) * Math.sin(Math.PI * t)];
          return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" />;
        })()}
      </svg>
      <span className="rp-gauge-value">{valueText}</span>
      {target !== undefined && (
        <span className="rp-gauge-target">
          <Icon name={met ? 'check-circle' : 'target'} size={14} />
          {met ? 'At or above' : 'Below'} the target of {formatNumber(target)}{max === 100 ? '%' : ''}
        </span>
      )}
    </>
  );
  return onClick
    ? <button type="button" className="rp-gauge rp-clickable" onClick={onClick} title="See the records behind this figure">{body}</button>
    : <div className="rp-gauge">{body}</div>;
}

// ---------- calendar ----------

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
export function shiftMonth(month: string, by: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** One month, Monday first. Days with records carry their count, shaded by how many, and open the list. */
export function CalendarGrid({ month, days, today, onMonth, onDay, noun }: {
  month: string;
  days: Record<string, { count: number; drill?: string }>;
  today?: string;
  onMonth?: (month: string) => void;
  onDay?: (drill: string) => void;
  noun: string;
}) {
  const cells = useMemo(() => {
    const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
    const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [...Array(first).fill(null), ...Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)] as (string | null)[];
  }, [month]);
  const max = Math.max(1, ...Object.values(days).map((d) => d.count));
  return (
    <div className="rp-cal">
      <div className="rp-cal-head">
        {onMonth && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month"><Icon name="chevron-left" size={16} /></button>}
        <strong aria-live="polite">{monthLabel(month)}</strong>
        {onMonth && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Next month"><Icon name="chevron-right" size={16} /></button>}
      </div>
      <div className="rp-cal-grid" role="grid" aria-label={`${noun} in ${monthLabel(month)}`}>
        {WEEKDAYS.map((d) => <span key={d} className="rp-cal-dow" role="columnheader">{d}</span>)}
        {cells.map((day, i) => {
          if (!day) return <span key={`b${i}`} />;
          const hit = days[day];
          const n = Number(day.slice(8));
          const level = hit ? Math.max(1, Math.ceil((hit.count / max) * 4)) : 0;
          const cls = cx('rp-cal-day', day === today && 'is-today', hit && `rp-cal-l${level}`);
          const label = hit ? `${n} ${monthLabel(month)}: ${hit.count} ${noun}` : `${n} ${monthLabel(month)}`;
          return hit && onDay && hit.drill !== undefined
            ? <button key={day} type="button" className={cls} onClick={() => onDay(hit.drill!)} aria-label={label} title={label}><span>{n}</span><b>{hit.count}</b></button>
            : <span key={day} className={cls} aria-label={label}><span>{n}</span>{hit && <b>{hit.count}</b>}</span>;
        })}
      </div>
    </div>
  );
}

// ---------- safe text ----------

/** Bold, italic and links inside one line. Text is never treated as HTML. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\((\/[^\s)]*|https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${m.index}`;
    if (m[1] !== undefined) out.push(<strong key={k}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<em key={k}>{m[2]}</em>);
    else if (m[4].startsWith('/')) out.push(<Link key={k} to={m[4]}>{m[3]}</Link>);
    else out.push(<a key={k} href={m[4]} target="_blank" rel="noreferrer noopener">{m[3]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * A small, safe subset of Markdown: headings (#, ##, ###), paragraphs, bullet and numbered lists,
 * **bold**, *italic* and [links](/path). Built as React elements, so nothing a person types can
 * become markup or script.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => {
    const out: ReactNode[] = [];
    let items: ReactNode[] = [];
    let ordered = false;
    const flush = () => {
      if (!items.length) return;
      out.push(ordered ? <ol key={`l${out.length}`}>{items}</ol> : <ul key={`l${out.length}`}>{items}</ul>);
      items = [];
    };
    String(source ?? '').slice(0, 20000).split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      const li = /^(?:[-*]|(\d+)[.)])\s+(.*)$/.exec(line);
      if (li) {
        if (items.length && ordered !== Boolean(li[1])) flush();
        ordered = Boolean(li[1]);
        items.push(<li key={i}>{inline(li[2], `i${i}`)}</li>);
        return;
      }
      flush();
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) out.push(h[1].length === 1 ? <h3 key={i}>{inline(h[2], `h${i}`)}</h3> : h[1].length === 2 ? <h4 key={i}>{inline(h[2], `h${i}`)}</h4> : <h5 key={i}>{inline(h[2], `h${i}`)}</h5>);
      else if (line) out.push(<p key={i}>{inline(line, `p${i}`)}</p>);
    });
    flush();
    return out;
  }, [source]);
  return <div className={cx('rp-md', className)}>{blocks.length ? blocks : <Fragment />}</div>;
}
