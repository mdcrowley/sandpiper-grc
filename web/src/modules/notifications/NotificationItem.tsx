// One notification row, used by the bell's list and by the full page.
import { cx, LookupChip, relativeTime, formatDateTime } from '../../core';
import type { Notification } from './data';

interface Props {
  notification: Notification;
  /** Called when the row is selected (open the record and mark it read). */
  onOpen: (n: Notification) => void;
  /** Tighter spacing for the bell's list. */
  compact?: boolean;
}

export function NotificationItem({ notification: n, onOpen, compact }: Props) {
  const unread = n.read_at === null;
  return (
    <li className={cx('ntf-item', unread && 'ntf-unread', compact && 'ntf-compact')}>
      <button type="button" className="ntf-button" onClick={() => onOpen(n)}>
        <span className="ntf-dot" aria-hidden="true" />
        <span className="ntf-text">
          <span className="ntf-title">
            {unread && <span className="sr-only">Unread: </span>}
            {n.title}
          </span>
          {n.body && <span className="ntf-body">{n.body}</span>}
          <span className="ntf-meta">
            {!n.unavailable && <LookupChip list="notification_kind" value={n.kind} />}
            <time dateTime={n.created_at} title={formatDateTime(n.created_at)}>{relativeTime(n.created_at)}</time>
          </span>
        </span>
      </button>
    </li>
  );
}
