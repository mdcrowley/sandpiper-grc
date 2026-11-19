// Building blocks shared by the Overview widgets.
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, Icon, Loading, StatusChip, formatDate, todayInZone } from '../../core';
import type { FetchState, IconName } from '../../core';

/** The link at the top right of a card. `label` is the full name read to screen-reader users. */
export function MoreLink({ to, label, children }: { to: string; label?: string; children: ReactNode }) {
  return (
    <Link className="home-more" to={to} aria-label={label}>
      {children}<Icon name="arrow-right" size={14} />
    </Link>
  );
}

/** A card around one already-requested endpoint, with loading, error and empty states. */
export function Panel<T>({ title, state, to, linkLabel, empty, emptyTitle, emptyMessage, emptyIcon, children }: {
  title: string; state: FetchState<T>; to?: string; linkLabel?: string;
  empty?: (data: T) => boolean; emptyTitle?: string; emptyMessage?: string; emptyIcon?: IconName;
  children: (data: T) => ReactNode;
}) {
  const { data, error, reload } = state;
  return (
    <Card title={title} className="home-panel" actions={to ? <MoreLink to={to}>{linkLabel ?? 'Open'}</MoreLink> : undefined}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} />
        : empty?.(data) ? <EmptyState icon={emptyIcon ?? 'check-circle'} title={emptyTitle ?? 'Nothing to show yet'} message={emptyMessage} />
        : children(data)}
    </Card>
  );
}

/** Whole days from today (organization time zone) to a calendar date; negative when it has passed. */
export function daysUntil(date: string): number {
  const day = (v: string) => Date.parse(`${v.slice(0, 10)}T00:00:00Z`);
  return Math.round((day(date) - day(todayInZone())) / 86_400_000);
}

/** A due date as a chip: red once late, amber within a week, gray otherwise. */
export function DueChip({ date }: { date: string | null | undefined }) {
  if (!date) return <span className="muted">No due date</span>;
  const days = daysUntil(String(date));
  if (Number.isNaN(days)) return <span className="muted">No due date</span>;
  if (days < 0) return <StatusChip color="red" label={`Overdue by ${-days} ${days === -1 ? 'day' : 'days'}`} />;
  if (days === 0) return <StatusChip color="amber" label="Due today" />;
  if (days <= 7) return <StatusChip color="amber" label={`Due in ${days} ${days === 1 ? 'day' : 'days'}`} />;
  return <StatusChip color="gray" label={`Due ${formatDate(date)}`} />;
}

/* ---------- My work ---------- */

/** Lets each personal list tell the section how many items it holds (null while unknown). */
export const WorkTally = createContext<(id: string, count: number | null) => void>(() => {});

export interface WorkItem {
  key: string;
  to: string;
  title: string;
  reference?: string | null;
  /** Due date, countdown or status chip shown at the end of the row. */
  meta?: ReactNode;
  onOpen?: () => void;
}

/** A compact personal list: a count, up to a handful of rows and a link to the full list. */
export function WorkCard({ id, title, icon, to, items, count, error, reload, emptyText }: {
  id: string; title: string; icon: IconName;
  /** The full list; without it the card has no "View all" link. */
  to?: string;
  /** `undefined` while loading. */
  items: WorkItem[] | undefined;
  /** How many there are in all (may be more than the rows shown). */
  count: number | undefined;
  error?: unknown; reload: () => void; emptyText: string;
}) {
  const report = useContext(WorkTally);
  const known = error || count === undefined ? null : count;
  useEffect(() => {
    report(id, known);
    return () => report(id, null);
  }, [report, id, known]);

  const more = items && count !== undefined ? count - items.length : 0;
  return (
    <Card
      className="home-work"
      title={(
        <span className="home-work-title">
          <Icon name={icon} size={16} />
          {title}
          {known !== null && <span className="home-count"><span className="sr-only">: </span>{known}</span>}
        </span>
      )}
      actions={to ? <MoreLink to={to} label={`View all: ${title}`}>View all</MoreLink> : undefined}
    >
      {error ? <ErrorState error={error} onRetry={reload} />
        : !items ? <Loading lines={3} label={`Loading ${title}`} />
        : items.length === 0 ? (
          <p className="home-work-empty"><Icon name="check-circle" size={18} />{emptyText}</p>
        ) : (
          <>
            <ul className="home-work-list">
              {items.map((item) => (
                <li key={item.key}>
                  <Link to={item.to} className="home-work-item" onClick={item.onOpen}>
                    <span className="home-work-main">
                      <span className="home-work-name">{item.title}</span>
                      {item.reference && <span className="ref">{item.reference}</span>}
                    </span>
                    {item.meta && <span className="home-work-meta">{item.meta}</span>}
                  </Link>
                </li>
              ))}
            </ul>
            {more > 0 && <p className="home-work-rest">{to ? <Link to={to}>and {more} more</Link> : `and ${more} more`}</p>}
          </>
        )}
    </Card>
  );
}
