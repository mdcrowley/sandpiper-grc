// The full list of a person's notifications, with an unread view and their preferences.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorState, errorMessage, Loading, PageHeader, Tabs, useFetch, useToast } from '../../core';
import { markAllRead, markRead, useUnreadCount, type Notification, type NotificationPage } from './data';
import { NotificationItem } from './NotificationItem';
import { NotificationPreferences } from './Preferences';
import './notifications.css';

const PAGE_SIZE = 20;

function NotificationList({ unreadOnly }: { unreadOnly: boolean }) {
  const navigate = useNavigate();
  const unread = useUnreadCount();
  const [page, setPage] = useState(1);
  const { data, error, reload } = useFetch<NotificationPage>(
    `/api/notifications?pageSize=${PAGE_SIZE}&page=${page}${unreadOnly ? '&unread=true' : ''}`,
  );
  // Refresh in place when the unread count changes: something arrived, or something was read.
  const seen = useRef(unread);
  useEffect(() => {
    if (seen.current === unread) return;
    seen.current = unread;
    reload();
  }, [unread, reload]);

  const open = (n: Notification) => {
    if (n.read_at === null) markRead(n.id).catch(() => undefined);
    if (n.route) navigate(n.route);
  };

  if (error) return <ErrorState title="Notifications could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} label="Loading notifications" />;
  if (data.total === 0) {
    return unreadOnly
      ? <EmptyState icon="check-circle" title="You are up to date" message="There is nothing unread." />
      : <EmptyState icon="message" title="No notifications yet" message="You will be told here when work is assigned to you, an approval is waiting, or a deadline is close." />;
  }
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const from = (data.page - 1) * data.pageSize + 1;
  return (
    <div className="stack">
      <Card flush>
        <ul className="ntf-list">
          {data.rows.map((n) => <NotificationItem key={n.id} notification={n} onOpen={open} />)}
        </ul>
      </Card>
      <div className="ntf-pager">
        <span className="muted">{from} to {from + data.rows.length - 1} of {data.total}</span>
        <Button size="sm" icon="chevron-left" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
        <Button size="sm" disabled={data.page >= pages} onClick={() => setPage((p) => p + 1)}>Older</Button>
      </div>
    </div>
  );
}

export function NotificationsPage() {
  const toast = useToast();
  const unread = useUnreadCount();
  const [search, setSearch] = useSearchParams();
  const [marking, setMarking] = useState(false);

  const readAll = async () => {
    setMarking(true);
    try {
      await markAllRead();
      toast.success('All notifications marked as read.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className="stack ntf-page">
      <PageHeader
        title="Notifications"
        subtitle="What needs your attention: work assigned to you, approvals waiting, and deadlines that are close."
        actions={<Button icon="check" loading={marking} disabled={unread === 0} onClick={() => void readAll()}>Mark all as read</Button>}
      />
      <Tabs
        label="Notification views"
        active={search.get('tab') ?? 'all'}
        onChange={(key) => setSearch((p) => { p.set('tab', key); return p; }, { replace: true })}
        tabs={[
          { key: 'all', label: 'All', content: <NotificationList key="all" unreadOnly={false} /> },
          { key: 'unread', label: 'Unread', count: unread, content: <NotificationList key="unread" unreadOnly /> },
          { key: 'preferences', label: 'Preferences', content: <NotificationPreferences /> },
        ]}
      />
    </div>
  );
}
