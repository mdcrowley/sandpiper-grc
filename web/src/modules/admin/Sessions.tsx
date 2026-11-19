import { useState } from 'react';
import {
  api, Badge, Button, Card, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, relativeTime, useAuth, useFetch, useToast,
} from '../../core';

interface Session { id: string; created_at: string; last_seen_at: string; expires_at: string; ip: string | null; user_agent: string | null; current: boolean }

/** A short, plain description of a browser from its user-agent text. */
function browserName(ua: string | null): string {
  if (!ua) return 'Unknown browser';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function SessionsCard() {
  const toast = useToast();
  const auth = useAuth();
  const { data, error, reload } = useFetch<Session[]>('/api/auth/sessions');
  const [busy, setBusy] = useState('');

  const end = async (key: string, work: () => Promise<unknown>, done: string, self = false) => {
    setBusy(key);
    try {
      await work();
      toast.success(done);
      if (self) await auth.refresh(); else reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const others = data?.filter((s) => !s.current).length ?? 0;

  return (
    <Card
      title="Where you are signed in" flush
      actions={others > 0 && (
        <Button size="sm" loading={busy === 'others'} onClick={() => void end('others', () => api.post('/api/auth/sessions/end-others'), 'Other sessions ended.')}>
          End all other sessions
        </Button>
      )}
    >
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="card-body"><Loading lines={3} /></div>
        : data.length === 0 ? <EmptyState icon="lock" title="No active sessions" />
        : (
          // A list, not a table: it has to fit a half-width card and a phone without scrolling sideways.
          <ul className="adm-sessions" aria-label="Sessions">
            {data.map((s) => (
              <li key={s.id} className="adm-session">
                <div className="adm-session-main">
                  <span className="adm-session-name">
                    {browserName(s.user_agent)} {s.current && <Badge color="green">This session</Badge>}
                  </span>
                  <span className="muted adm-session-facts">
                    <span>{s.ip ?? 'Unknown address'}</span>
                    <span>Signed in {formatDateTime(s.created_at)}</span>
                    <span title={formatDateTime(s.last_seen_at)}>Active {relativeTime(s.last_seen_at)}</span>
                  </span>
                </div>
                <Button size="sm" variant={s.current ? 'ghost' : 'secondary'} loading={busy === s.id}
                  aria-label={s.current ? 'Sign out of this session' : `End the session from ${s.ip ?? 'an unknown address'}, ${browserName(s.user_agent)}`}
                  onClick={() => void end(s.id, () => api.del(`/api/auth/sessions/${s.id}`), s.current ? 'Signed out.' : 'Session ended.', s.current)}>
                  {s.current ? 'Sign out' : 'End'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      <p className="card-body adm-card-foot muted">Sessions end after 8 hours, or sooner when idle. If you do not recognize one, end it and change your password.</p>
    </Card>
  );
}
