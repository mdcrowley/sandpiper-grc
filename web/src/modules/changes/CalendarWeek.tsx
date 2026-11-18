import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { cx, todayInZone } from '../../core';
import { byDay, ConflictMark, describe, eventClass } from './CalendarMonth';
import type { Blackout, CalendarChange } from './types';
import { addDays, dayLabel, startOfDay, timeLabel } from './util';

const HOUR = 44; // pixels per hour
const HOURS = Array.from({ length: 24 }, (_, h) => h);

interface Block { top: number; height: number }

/** Where a period sits in one day's column. */
function block(day: string, start: string, end: string): Block {
  const from = new Date(startOfDay(day)).getTime();
  const to = new Date(startOfDay(addDays(day, 1))).getTime();
  const a = Math.max(new Date(start).getTime(), from);
  const b = Math.min(new Date(end).getTime(), to);
  const top = ((a - from) / 3600000) * HOUR;
  return { top, height: Math.max(((b - a) / 3600000) * HOUR, 22) };
}

/** Side-by-side lanes for changes that overlap in a day. */
function lanes(day: string, list: CalendarChange[]): { c: CalendarChange; lane: number; of: number; at: Block }[] {
  const sorted = [...list].sort((x, y) => x.planned_start.localeCompare(y.planned_start));
  const ends: number[] = [];
  const placed = sorted.map((c) => {
    const at = block(day, c.planned_start, c.planned_end);
    let lane = ends.findIndex((e) => e <= at.top);
    if (lane < 0) lane = ends.length;
    ends[lane] = at.top + at.height;
    return { c, lane, at };
  });
  return placed.map((p) => ({ ...p, of: ends.length }));
}

/** Week view: a column per day and a row per hour, blackout periods shaded behind the changes. */
export function CalendarWeek({ days, changes, blackouts }: { days: string[]; changes: CalendarChange[]; blackouts: Blackout[] }) {
  const today = todayInZone();
  const scroller = useRef<HTMLDivElement>(null);
  const cols = byDay(days, changes, blackouts);
  // Start the view at the working day rather than midnight, or earlier when a change starts earlier.
  const earliest = Math.min(7 * HOUR, ...cols.flatMap((col) => col.changes.map((c) => block(col.day, c.planned_start, c.planned_end).top).filter((top) => top > 0)));
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = Math.max(0, earliest - 6); }, [days[0], earliest]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="chg-week" ref={scroller} tabIndex={0} role="group" aria-label="Changes by day and hour">
      <div className="chg-week-inner">
        <div className="chg-week-head">
          <span />
          {days.map((d) => <span key={d} className={cx(d === today && 'chg-week-today')}>{dayLabel(d)}</span>)}
        </div>
        <div className="chg-week-grid" style={{ height: 24 * HOUR }}>
          <div className="chg-week-hours" aria-hidden="true">
            {HOURS.map((h) => <span key={h} style={{ top: h * HOUR }}>{String(h).padStart(2, '0')}:00</span>)}
          </div>
          {cols.map(({ day, changes: list, blackouts: shade }) => (
            <div key={day} className={cx('chg-week-col', day === today && 'chg-week-col-today')} style={{ backgroundSize: `100% ${HOUR}px` }}>
              {shade.map((b) => {
                const at = block(day, b.starts_at, b.ends_at);
                return (
                  <div key={b.id} className="chg-week-shade" style={{ top: at.top, height: at.height }} title={b.reason ?? undefined}>
                    <span>{b.name}</span>
                  </div>
                );
              })}
              {lanes(day, list).map(({ c, lane, of, at }) => (
                <Link
                  key={c.id}
                  to={`/changes/${c.id}`}
                  className={cx(eventClass(c), 'chg-week-ev')}
                  style={{ top: at.top, height: at.height, left: `calc(${(lane / of) * 100}% + 2px)`, width: `calc(${100 / of}% - 4px)` }}
                  title={describe(c)}
                >
                  <span className="chg-ev-line"><ConflictMark c={c} /><span className="chg-ev-ref">{c.ref}</span> <span className="chg-ev-time">{timeLabel(c.planned_start)}</span></span>
                  <span className="chg-ev-title">{c.title}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
