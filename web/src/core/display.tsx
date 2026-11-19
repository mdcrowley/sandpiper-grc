// Read-only display components: Timeline (events in order), KeyValue (a fact sheet) and
// AgendaList (dated items grouped by day). Presentational; they render documented classes
// (`ui-timeline`, `facts`, `agenda`) styled from the design tokens.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, formatDateTime, relativeTime } from './format';
import { Icon, type IconName } from './Icon';
import type { ColorName } from './meta';
import { cx } from './ui';

/* ---------- Timeline ---------- */

export interface TimelineItem {
  key: string;
  /** One line saying what happened. */
  title: ReactNode;
  /** When it happened (ISO string or Date). Shown as relative time with the exact time on hover. */
  time?: string | Date | null;
  /** Replaces the formatted time, e.g. "Planned for 3 Dec". */
  timeText?: string;
  /** Who did it, or any short note shown beside the time. */
  meta?: ReactNode;
  /** Icon inside the marker; a plain dot when left out. */
  icon?: IconName;
  /** Marker colour (default grey). */
  color?: ColorName;
  /** Longer content under the title: a comment, a list of changes. */
  body?: ReactNode;
}

export interface TimelineProps {
  items: TimelineItem[];
  /** Accessible name of the list. */
  label?: string;
  /** Tighter spacing, for cards and side panels. */
  compact?: boolean;
  /** Shown when there are no items. */
  empty?: ReactNode;
}

/** Events in order down a line, each with a coloured marker. Pass the items already sorted. */
export function Timeline({ items, label = 'Timeline', compact, empty }: TimelineProps) {
  if (items.length === 0) return empty ? <p className="muted">{empty}</p> : null;
  return (
    <ol className={cx('ui-timeline', compact && 'ui-timeline-compact')} aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className={cx('ui-timeline-item', `ui-timeline-${item.color ?? 'gray'}`)}>
          <span className={cx('ui-timeline-marker', !item.icon && 'ui-timeline-dot')} aria-hidden="true">
            {item.icon && <Icon name={item.icon} size={compact ? 12 : 14} />}
          </span>
          <div className="ui-timeline-content">
            <div className="ui-timeline-head">
              <span className="ui-timeline-title">{item.title}</span>
              {(item.time || item.timeText || item.meta) && (
                <span className="ui-timeline-meta">
                  {item.meta}
                  {item.meta && (item.time || item.timeText) ? ' · ' : null}
                  {item.timeText ?? (item.time ? <time dateTime={new Date(item.time).toISOString()} title={formatDateTime(item.time)}>{relativeTime(item.time)}</time> : null)}
                </span>
              )}
            </div>
            {item.body && <div className="ui-timeline-body">{item.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------- KeyValue (fact sheet) ---------- */

export interface KeyValueItem {
  label: string;
  value: ReactNode;
  /** Small icon before the label. */
  icon?: IconName;
  /** A short explanation under the value. */
  hint?: ReactNode;
  /** Span the full width (`columns` layout only). */
  wide?: boolean;
}

export interface KeyValueProps {
  items: KeyValueItem[];
  /**
   * `rows` (default): one fact per line, label at the left, with a rule between lines; best in a
   * card or side panel. `columns`: a responsive grid with the label above the value.
   */
  layout?: 'rows' | 'columns';
  /** Smaller text and tighter lines. */
  compact?: boolean;
  /** Optional heading above the facts. */
  title?: string;
}

const isEmpty = (v: ReactNode) => v === null || v === undefined || v === '' || v === false;

/** Facts about one thing as label and value pairs. Empty values show a dash. */
export function KeyValue({ items, layout = 'rows', compact, title }: KeyValueProps) {
  return (
    <div className="facts-wrap">
      {title && <h3 className="facts-title">{title}</h3>}
      <dl className={cx('facts', `facts-${layout}`, compact && 'facts-compact')}>
        {items.map((item) => (
          <div key={item.label} className={cx('facts-item', item.wide && 'facts-wide')}>
            <dt>
              {item.icon && <Icon name={item.icon} size={14} />}
              {item.label}
            </dt>
            <dd>
              {isEmpty(item.value) ? <span className="muted">—</span> : item.value}
              {item.hint && <span className="facts-hint">{item.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The same component under the other name people look for. */
export const FactSheet = KeyValue;

/* ---------- AgendaList ---------- */

export interface AgendaItem {
  key: string;
  /** The day (and time, if any) the item belongs to: ISO date, ISO instant or Date. */
  date: string | Date;
  title: ReactNode;
  /** Makes the title a link. */
  to?: string;
  /** Record reference shown before the title. */
  reference?: string;
  /** Time of day or a span, e.g. "09:00 to 11:30". */
  timeText?: string;
  /** A chip or short note at the right: status, owner. */
  meta?: ReactNode;
  /** Colour of the bar at the left of the item. */
  color?: ColorName;
}

export interface AgendaListProps {
  items: AgendaItem[];
  /** Accessible name of the list. */
  label?: string;
  /** Shown when there are no items. */
  empty?: ReactNode;
  /** Show at most this many items, then "and N more". */
  limit?: number;
  /** Where "and N more" goes, when given. */
  moreTo?: string;
}

/** `YYYY-MM-DD` values are calendar days and must not shift with the time zone. */
const dayKey = (d: string | Date) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : formatDate(d));

/** Dated items grouped under a heading per day, in the order given (sort them by date first). */
export function AgendaList({ items, label = 'Agenda', empty, limit, moreTo }: AgendaListProps) {
  if (items.length === 0) return empty ? <p className="muted">{empty}</p> : null;
  const shown = limit ? items.slice(0, limit) : items;
  const hiddenCount = items.length - shown.length;
  const days: { day: string; heading: string; items: AgendaItem[] }[] = [];
  for (const item of shown) {
    const day = dayKey(item.date);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(item);
    else days.push({ day, heading: formatDate(item.date), items: [item] });
  }
  return (
    <div className="agenda" role="list" aria-label={label}>
      {days.map((group) => (
        <section key={group.day} className="agenda-day" role="listitem">
          <h3 className="agenda-date">{group.heading}</h3>
          <ul className="agenda-items">
            {group.items.map((item) => (
              <li key={item.key} className={cx('agenda-item', `agenda-${item.color ?? 'gray'}`)}>
                <div className="agenda-main">
                  {item.timeText && <span className="agenda-time">{item.timeText}</span>}
                  <span className="agenda-title">
                    {item.reference && <span className="ref">{item.reference}</span>}
                    {item.to ? <Link to={item.to}>{item.title}</Link> : item.title}
                  </span>
                </div>
                {item.meta && <div className="agenda-meta">{item.meta}</div>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {hiddenCount > 0 && (
        <p className="agenda-more muted">
          {moreTo ? <Link to={moreTo}>and {hiddenCount} more</Link> : `and ${hiddenCount} more`}
        </p>
      )}
    </div>
  );
}
