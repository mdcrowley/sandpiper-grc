import { Link } from 'react-router-dom';
import { cx, Icon, lookupColor, lookupLabel, todayInZone } from '../../core';
import type { Blackout, CalendarChange } from './types';
import { addDays, dayOf, startOfDay, timeLabel, WEEKDAYS } from './util';

export interface DayData { day: string; changes: CalendarChange[]; blackouts: Blackout[] }

/** Sorts changes and blackout periods onto the days they touch. */
export function byDay(days: string[], changes: CalendarChange[], blackouts: Blackout[]): DayData[] {
  return days.map((day) => {
    const from = new Date(startOfDay(day)).getTime();
    const to = new Date(startOfDay(addDays(day, 1))).getTime();
    const touches = (start: string, end: string) => new Date(start).getTime() < to && new Date(end).getTime() > from;
    return {
      day,
      changes: changes.filter((c) => touches(c.planned_start, c.planned_end)),
      blackouts: blackouts.filter((b) => touches(b.starts_at, b.ends_at)),
    };
  });
}

const DONE = ['completed', 'reviewed', 'closed'];

/** Words for screen readers and the tooltip. */
export function describe(c: CalendarChange): string {
  const parts = [
    `${c.ref} ${c.title}`, `${lookupLabel('change_type', c.change_type)} change`, lookupLabel('change_status', c.status),
    `${timeLabel(c.planned_start)} to ${timeLabel(c.planned_end)}`,
  ];
  if (c.unacknowledged) parts.push(`${c.unacknowledged} unresolved ${c.unacknowledged === 1 ? 'conflict' : 'conflicts'}`);
  else if (c.conflicts.length) parts.push('conflict acknowledged');
  return parts.join(', ');
}

export function eventClass(c: CalendarChange): string {
  return cx('chg-ev', `chg-ev-${lookupColor('change_type', c.change_type)}`, DONE.includes(c.status) && 'chg-ev-done',
    c.status === 'draft' && 'chg-ev-draft', c.unacknowledged > 0 && 'chg-ev-conflict');
}

export function ConflictMark({ c }: { c: CalendarChange }) {
  if (c.unacknowledged > 0) return <Icon name="alert" size={13} className="chg-ev-mark" />;
  if (c.conflicts.length > 0) return <Icon name="check" size={13} className="chg-ev-mark chg-ev-mark-ok" />;
  return null;
}

const MAX = 3;

/** Month grid: one cell per day, blackout days shaded, conflicts marked. */
export function CalendarMonth({ days, month, changes, blackouts, onOpenDay }: {
  days: string[]; month: string; changes: CalendarChange[]; blackouts: Blackout[]; onOpenDay: (day: string) => void;
}) {
  const today = todayInZone();
  const cells = byDay(days, changes, blackouts);
  // A table of weeks (rows) and weekdays (cells) for assistive technology; the rows use
  // `display: contents`, so the layout stays one CSS grid of days.
  const weeks: DayData[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <div className="chg-month" role="table" aria-label="Changes by day">
      <div className="chg-month-head" role="row">
        {WEEKDAYS.map((w) => <span key={w} role="columnheader"><abbr title={w}>{w.slice(0, 3)}</abbr></span>)}
      </div>
      <div className="chg-month-body" role="rowgroup">
        {weeks.map((week) => (
          <div key={week[0].day} className="chg-month-week" role="row">
            {week.map(({ day, changes: list, blackouts: shade }) => (
          <div
            key={day}
            role="cell"
            className={cx('chg-day', day.slice(0, 7) !== month.slice(0, 7) && 'chg-day-out', day === today && 'chg-day-today', shade.length > 0 && 'chg-day-blackout')}
          >
            {/* The visible day number starts the button's name, so speech users can say it. */}
            <button type="button" className="chg-day-num" onClick={() => onOpenDay(day)}>
              {Number(day.slice(8))}<span className="sr-only">, open the week of {day}</span>
            </button>
            {shade.map((b) => (
              <span key={b.id} className="chg-day-shade" title={b.reason ?? undefined}><Icon name="lock" size={12} /> <span>{b.name}</span></span>
            ))}
            {list.slice(0, MAX).map((c) => (
              <Link key={c.id} to={`/changes/${c.id}`} className={eventClass(c)} title={describe(c)}>
                <ConflictMark c={c} />
                {dayOf(c.planned_start) === day && <span className="chg-ev-time">{timeLabel(c.planned_start)}</span>}
                <span className="chg-ev-ref">{c.ref}</span>
                <span className="chg-ev-title">{c.title}</span>
              </Link>
            ))}
            {list.length > MAX && (
              <button type="button" className="chg-linkbtn chg-more" onClick={() => onOpenDay(day)}>{list.length - MAX} more</button>
            )}
          </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
