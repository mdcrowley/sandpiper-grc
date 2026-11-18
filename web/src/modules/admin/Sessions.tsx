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
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Browser</th><th scope="col">Address</th><th scope="col">Signed in</th><th scope="col">Last active</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id}>
                    <td>{browserName(s.user_agent)} {s.current && <Badge color="green">This session</Badge>}</td>
                    <td>{s.ip ?? '—'}</td>
                    <td>{formatDateTime(s.created_at)}</td>
                    <td>{relativeTime(s.last_seen_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Button size="sm" variant="ghost" loading={busy === s.id}
                        onClick={() => void end(s.id, () => api.del(`/api/auth/sessions/${s.id}`), s.current ? 'Signed out.' : 'Session ended.', s.current)}>
                        {s.current ? 'Sign out' : 'End'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <p className="card-body muted">Sessions end after 8 hours, or sooner when idle. If you do not recognise one, end it and change your password.</p>
    </Card>
  );
}
