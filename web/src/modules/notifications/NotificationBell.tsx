// The bell for the top bar: unread badge and a list of the latest notifications.
// Mount it once in the shell's top bar: <NotificationBell />. It needs a signed-in user.
import { useEffect, useState } from 'react';
import { ActionIcon, Indicator, Popover, Tooltip } from '@mantine/core';
import { IconBell } from '@tabler/icons-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, Button, EmptyState, ErrorState, errorMessage, Loading, useToast } from '../../core';
import { markAllRead, markRead, setUnread, useUnreadCount, type Notification, type NotificationPage } from './data';
import { NotificationItem } from './NotificationItem';
import './notifications.css';

const LATEST = 8;

export function NotificationBell({ defaultOpened = false }: { /** Start with the list showing. */ defaultOpened?: boolean }) {
  const unread = useUnreadCount();
  const navigate = useNavigate();
  const toast = useToast();
  const [opened, setOpened] = useState(defaultOpened);
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [marking, setMarking] = useState(false);

  const load = () => {
    setError(null);
    api.get<NotificationPage>(`/api/notifications?pageSize=${LATEST}`).then(
      (data) => { setPage(data); setUnread(data.unread); },
      (err: unknown) => setError(err),
    );
  };
  // Fresh every time it opens; and again if something new arrives while it is open.
  useEffect(() => { if (opened) load(); }, [opened, unread]);

  const open = (n: Notification) => {
    setOpened(false);
    if (n.read_at === null) markRead(n.id).catch(() => undefined);
    if (n.route) navigate(n.route);
  };

  const readAll = async () => {
    setMarking(true);
    try {
      await markAllRead();
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setMarking(false);
    }
  };

  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" offset={6} width={380} trapFocus returnFocus withRoles={false}>
      <Popover.Target>
        {/* The wrapper is the popover's anchor; the button inside it does the opening. */}
        <span className="ntf-bell">
          <Tooltip label="Notifications" disabled={opened}>
            <Indicator label={unread > 99 ? '99+' : unread} disabled={unread === 0} size={18} offset={6} color="red">
              <ActionIcon
                size={36} className="ui-btn-ghost" aria-label={label} aria-haspopup="dialog" aria-expanded={opened}
                onClick={() => setOpened((o) => !o)}
              >
                <IconBell size={20} stroke={1.75} aria-hidden="true" />
              </ActionIcon>
            </Indicator>
          </Tooltip>
        </span>
      </Popover.Target>
      <Popover.Dropdown className="ntf-popover" role="dialog" aria-label="Notifications">
        <div className="ntf-popover-head">
          <h2 className="ntf-popover-title">Notifications</h2>
          <Button size="sm" variant="ghost" icon="check" loading={marking} disabled={unread === 0} onClick={() => void readAll()}>
            Mark all as read
          </Button>
        </div>
        <div className="ntf-popover-body">
          {error ? (
            <ErrorState title="Notifications could not be loaded" error={error} onRetry={load} />
          ) : !page ? (
            <Loading lines={4} label="Loading notifications" />
          ) : page.rows.length === 0 ? (
            <EmptyState icon="check-circle" title="Nothing needs your attention" message="Assignments, approvals and approaching deadlines will appear here." />
          ) : (
            <ul className="ntf-list">
              {page.rows.map((n) => <NotificationItem key={n.id} notification={n} onOpen={open} compact />)}
            </ul>
          )}
        </div>
        <div className="ntf-popover-foot">
          <Link to="/notifications" onClick={() => setOpened(false)}>
            {page && page.total > page.rows.length ? `See all ${page.total} notifications` : 'See all notifications'}
          </Link>
          <Link to="/notifications?tab=preferences" onClick={() => setOpened(false)}>Preferences</Link>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
