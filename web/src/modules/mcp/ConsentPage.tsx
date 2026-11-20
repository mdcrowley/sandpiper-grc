// /oauth/authorize: the consent screen for a remote connector signing in with OAuth (E21-16).
// The connector sends the person here; signed in, they see who is asking and choose what it may
// do. The server checks the request (POST /api/mcp/oauth/authorize) and, on a decision, answers
// where the browser goes next: the connector's registered address with a code or an error.
import { useEffect, useMemo, useState } from 'react';
import { api, Button, Card, ErrorState, errorMessage, formatDate, Loading, PageHeader, Select, useAuth } from '../../core';
import { Notice } from '../admin/common';
import { withReauth } from '../admin/reauth';
import './mcp.css';

interface Check {
  ok: true;
  client: {
    name: string; clientUri: string | null; redirectHost: string; redirectUri: string; registeredBy: 'dynamic' | 'administrator' | 'metadata'; registeredAt: string;
    /** A connector known by its metadata document (E21-21): the document's address and host. */
    clientId?: string; clientIdHost?: string;
    /** It returns to an address on this computer, which any program here could receive. */
    localRedirect?: boolean;
  };
  requestedWrite: boolean; canWrite: boolean; writeEnabled: boolean; mayConnect: boolean; maxDays: number;
}

const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state', 'resource'];
const DAYS = [1, 7, 30, 90, 180, 365];
const BLOCKED = ['javascript:', 'data:', 'vbscript:', 'file:', 'about:', 'blob:'];

/** Leaves for the connector's address; never for a scheme that would run code here. */
function leaveFor(url: string) {
  try {
    const u = new URL(url);
    if (BLOCKED.includes(u.protocol)) throw new Error('blocked');
    window.location.assign(u.href);
  } catch {
    throw new Error('The connector gave an address this page will not open.');
  }
}

export function ConsentPage() {
  const { user } = useAuth();
  const params = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    return Object.fromEntries(PARAMS.filter((k) => q.has(k)).map((k) => [k, q.get(k) ?? '']));
  }, []);
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [access, setAccess] = useState<'read' | 'write'>('read');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [actionError, setActionError] = useState('');
  const [leaving, setLeaving] = useState(false);

  // Opened by hand, with no request from a connector: nothing to check.
  const noRequest = !params.client_id && !params.response_type;

  useEffect(() => {
    if (noRequest) return;
    let live = true;
    api.post<Check | { ok: false; redirect: string }>('/api/mcp/oauth/authorize', params)
      .then((res) => {
        if (!live) return;
        if (!res.ok) { setLeaving(true); leaveFor(res.redirect); return; }
        setCheck(res);
        setDays(String(Math.min(30, res.maxDays)));
      })
      .catch((err) => { if (live) setError(err); });
    return () => { live = false; };
  }, [params, noRequest]);

  const decide = async (approve: boolean) => {
    setBusy(approve ? 'allow' : 'deny');
    setActionError('');
    try {
      const body = { ...params, approve, access, expiresInDays: Number(days) };
      const res = approve
        ? await withReauth(() => api.post<{ redirect: string }>('/api/mcp/oauth/decision', body))
        : await api.post<{ redirect: string }>('/api/mcp/oauth/decision', body);
      setLeaving(true);
      leaveFor(res.redirect);
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(null);
    }
  };

  const dayOptions = check ? [...new Set([...DAYS.filter((d) => d <= check.maxDays), check.maxDays])].sort((a, b) => a - b)
    .map((d) => ({ value: String(d), label: d === 1 ? '1 day' : `${d} days` })) : [];

  return (
    <div className="mcp-page mcp-consent">
      <PageHeader title="Connect an AI assistant" subtitle="A remote connector is asking to use Sandpiper GRC as you." />
      {noRequest ? (
        <Card>
          <p>There is nothing to approve here. This page opens when an AI assistant's remote connector asks to sign in as you; start the connection from the assistant.</p>
        </Card>
      ) : error ? <ErrorState error={error} />
        : leaving ? <Loading lines={2} label="Returning to the connector" />
        : !check ? <Loading lines={6} label="Checking the request" />
        : (
          <Card title={`Allow "${check.client.name}"${check.client.clientIdHost ? ` (from ${check.client.clientIdHost})` : ''} to use Sandpiper GRC as you?`}>
            <div className="stack">
              {!check.mayConnect && (
                <Notice tone="caution" icon="lock">Your role may not connect AI assistants here. You can only decline. Ask an administrator if you need this.</Notice>
              )}
              {check.client.registeredBy === 'metadata' && check.client.clientIdHost && (
                <div className="mcp-origin" data-testid="mcp-client-host">
                  <span className="muted">This connector is described by a document published at</span>
                  <span className="mcp-origin-host">{check.client.clientIdHost}</span>
                  <span className="muted mcp-break">{check.client.clientId}</span>
                  <span className="muted">The name &ldquo;{check.client.name}&rdquo; is what that document says about itself; anyone can publish any name. Allow only if you trust this host.</span>
                </div>
              )}
              {check.client.localRedirect && (
                <Notice tone="caution" icon="alert">
                  It returns to an address on your own computer ({check.client.redirectHost}). Any program running on this computer could receive the answer, so allow only if
                  you started this connection yourself, just now, from the assistant you expect.
                </Notice>
              )}
              <ul className="mcp-list">
                <li>It will act as <strong>{user?.displayName}</strong> and see only what you can see. Nothing can be deleted through it.</li>
                <li>After you decide, you return to <strong>{check.client.redirectHost}</strong>. Allow only if that is the assistant you just started connecting.</li>
                <li>
                  {check.client.registeredBy === 'administrator'
                    ? <>Added by an administrator on {formatDate(check.client.registeredAt)}.</>
                    : check.client.registeredBy === 'metadata'
                      ? <>First seen here on {formatDate(check.client.registeredAt)}.</>
                      : <>It registered itself on {formatDate(check.client.registeredAt)}; its name is the one it gave.</>}
                  {check.client.clientUri && <> It says it comes from <span className="mcp-break">{check.client.clientUri}</span>.</>}
                </li>
              </ul>
              {check.mayConnect && (
                <div className="mcp-consent-fields">
                  <Select
                    label="What it may do" value={access} onChange={(v) => setAccess(v === 'write' ? 'write' : 'read')}
                    options={[
                      { value: 'read', label: 'Read only: look things up and summarize' },
                      ...(check.requestedWrite && check.canWrite ? [{ value: 'write', label: 'Read and write: also create, update, comment and link' }] : []),
                    ]}
                    hint={access === 'write' && !check.writeEnabled ? 'Write access for AI assistants is off here, so it can only read until an administrator switches it on.' : 'Never more than you can do yourself.'}
                  />
                  <Select label="Allow for" value={days} onChange={setDays} options={dayOptions} hint="It must sign in again after this. You can disconnect it at any time on Account security." />
                </div>
              )}
              {actionError && <p className="form-error" role="alert">{actionError}</p>}
              <div className="form-actions">
                <Button onClick={() => void decide(false)} loading={busy === 'deny'} disabled={busy !== null}>Decline</Button>
                {check.mayConnect && <Button variant="primary" onClick={() => void decide(true)} loading={busy === 'allow'} disabled={busy !== null}>Allow</Button>}
              </div>
              <p className="muted">Allowing asks for your password if you have not given it in the last few minutes.</p>
            </div>
          </Card>
        )}
    </div>
  );
}
