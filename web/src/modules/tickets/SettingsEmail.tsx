// Service desk settings, "Email to ticket" tab (E15-06): where mail comes from (a mailbox read
// over POP3 or through Microsoft Graph or the Gmail API (E14-25), or a mail relay that posts each message), what a new ticket gets, who may write,
// and the log of every message received. Administrators only: it holds a mailbox password.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Badge, Button, Card, errorMessage, ErrorState, formatDateTime, Icon, Loading, LookupSelect, NumberField, relativeTime, Select,
  Switch, TextField, useAuth, useFetch, useToast, type ColorName,
} from '../../core';
import { useReauth } from './reauth';

interface Intake {
  enabled: boolean; source: 'pop3' | 'graph' | 'gmail' | 'relay'; host: string; port: number; tls: 'tls' | 'starttls' | 'none'; username: string;
  password_set: boolean; poll_minutes: number; leave_on_server: boolean; address: string; unknown_senders: 'create' | 'ignore';
  allowed_domains: string[]; ticket_type: string; assignment_group: string | null; acknowledge: boolean; reply_by_email: boolean;
  max_per_hour: number; relay_key_set: boolean; relay_key_hint: string | null; last_poll_at: string | null; last_poll_error: string | null;
  mail_enabled: boolean; files: boolean; service_accounts?: { graph: boolean; gmail: boolean };
}
interface LogRow {
  id: string; received_at: string; source: string; from_address: string | null; from_name: string | null; subject: string | null;
  outcome: 'created' | 'commented' | 'ignored' | 'refused' | 'failed'; reason: string | null; ticket_id: string | null; ticket_ref: string | null; attachments: number;
}

const SOURCES = [
  { value: 'pop3', label: 'Read a mailbox (POP3)' },
  { value: 'graph', label: 'Read a Microsoft 365 mailbox (Microsoft Graph)' },
  { value: 'gmail', label: 'Read a Google Workspace mailbox (Gmail API)' },
  { value: 'relay', label: 'A mail relay hands each message over' },
];
const SERVICE_LABEL = { graph: 'Microsoft Graph', gmail: 'Gmail API' } as const;
const TLS = [
  { value: 'tls', label: 'TLS from the start (usually port 995)' },
  { value: 'starttls', label: 'STARTTLS (usually port 110)' },
  { value: 'none', label: 'None: password sent in clear text' },
];
const UNKNOWN = [
  { value: 'create', label: 'Create a ticket with them as an outside requester' },
  { value: 'ignore', label: 'Ignore the message (it is logged)' },
];
const OUTCOMES: Record<LogRow['outcome'], { label: string; color: ColorName }> = {
  created: { label: 'New ticket', color: 'green' },
  commented: { label: 'Reply added', color: 'blue' },
  ignored: { label: 'Ignored', color: 'gray' },
  refused: { label: 'Refused', color: 'amber' },
  failed: { label: 'Failed', color: 'red' },
};

function InboundLog({ refresh }: { refresh: number }) {
  const [outcome, setOutcome] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const { data, error, reload } = useFetch<{ rows: LogRow[]; total: number }>(`/api/tickets/email/log?pageSize=${pageSize}${outcome ? `&outcome=${outcome}` : ''}`);
  useEffect(() => { if (refresh) reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refresh]);
  return (
    <Card title="Messages received" actions={
      <Select label="Show" hideLabel value={outcome} placeholder="Every message" onChange={(v) => setOutcome(v ?? '')}
        options={[{ value: '', label: 'Every message' }, ...Object.entries(OUTCOMES).map(([value, o]) => ({ value, label: o.label }))]} />
    }>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={4} label="Loading the messages received" />
          : !data.rows.length ? <p className="muted">Nothing received yet{outcome ? ' with this outcome' : ''}.</p>
            : (
              <>
                <div className="table-wrap">
                  <table className="table sd-table sd-mail-log">
                    <thead><tr><th scope="col">Received</th><th scope="col">From</th><th scope="col">Subject</th><th scope="col">What happened</th></tr></thead>
                    <tbody>
                      {data.rows.map((r) => (
                        <tr key={r.id}>
                          <td><time dateTime={r.received_at} title={formatDateTime(r.received_at)}>{relativeTime(r.received_at)}</time></td>
                          <td className="sd-mail-from">{r.from_name ? <><span>{r.from_name}</span><span className="muted">{r.from_address}</span></> : r.from_address ?? '—'}</td>
                          <td className="sd-mail-subject">{r.subject || <span className="muted">(no subject)</span>}</td>
                          <td>
                            <Badge color={OUTCOMES[r.outcome].color}>{OUTCOMES[r.outcome].label}</Badge>
                            {r.ticket_id && r.ticket_ref && <> <Link to={`/tickets/${r.ticket_id}`}>{r.ticket_ref}</Link></>}
                            {r.attachments > 0 && <span className="muted"> · {r.attachments} file{r.attachments === 1 ? '' : 's'}</span>}
                            {r.reason && <div className="muted sd-mail-reason">{r.reason}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.total > data.rows.length && (
                  <div className="form-actions"><Button onClick={() => setPageSize((n) => Math.min(200, n + 50))}>Show more ({data.total - data.rows.length} older)</Button></div>
                )}
              </>
            )}
    </Card>
  );
}

export function EmailSettingsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const { run, dialog } = useReauth();
  const allowed = can('admin.administer');
  const { data, error, reload } = useFetch<Intake>(allowed ? '/api/tickets/email/settings' : null);
  const [f, setF] = useState<Intake | null>(null);
  const [password, setPassword] = useState('');
  const [domains, setDomains] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [logTick, setLogTick] = useState(0);
  useEffect(() => { if (data) { setF(data); setDomains(data.allowed_domains.join(', ')); } }, [data]);

  if (!allowed) {
    return <p className="notice">Only an administrator can set up email to ticket, because it signs in to a mailbox. Tickets that arrive by email show “Email” as how they arrived.</p>;
  }
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || !f) return <Loading lines={8} label="Loading the email-to-ticket settings" />;
  const set = (patch: Partial<Intake>) => setF({ ...f, ...patch });

  async function save(patch: Record<string, unknown>, done: string) {
    setBusy('save');
    setErrors({});
    try {
      await run(() => api.put('/api/tickets/email/settings', patch));
      toast.success(done);
      setPassword('');
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  }
  const pick = (x: Intake, d: string) => ({
    source: x.source, host: x.host, port: x.port, tls: x.tls, username: x.username, poll_minutes: x.poll_minutes, leave_on_server: x.leave_on_server,
    address: x.address, unknown_senders: x.unknown_senders, allowed_domains: d, ticket_type: x.ticket_type, assignment_group: x.assignment_group ?? '',
    acknowledge: x.acknowledge, reply_by_email: x.reply_by_email, max_per_hour: x.max_per_hour,
  });
  const form = () => ({ ...pick(f, domains), ...(password ? { password } : {}) });

  async function act(what: 'test' | 'check') {
    setBusy(what);
    try {
      const r = await api.post<{ ok: boolean; error?: string; messages?: number; fetched?: number; created?: number; commented?: number; ignored?: number }>(`/api/tickets/email/${what}`);
      if (!r.ok) toast.error(r.error ?? 'The mailbox could not be read.');
      else if (what === 'test') {
        toast.success(data?.source === 'pop3'
          ? `Signed in. The mailbox holds ${r.messages} message${r.messages === 1 ? '' : 's'}.`
          : `Signed in. The inbox has ${r.messages === 50 ? '50 or more' : r.messages} unread message${r.messages === 1 ? '' : 's'}.`);
      }
      else toast.success(`Read ${r.fetched} message${r.fetched === 1 ? '' : 's'}: ${r.created} new ticket${r.created === 1 ? '' : 's'}, ${r.commented} repl${r.commented === 1 ? 'y' : 'ies'}, ${r.ignored} ignored.`);
      reload();
      setLogTick((n) => n + 1);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function makeKey() {
    setBusy('key');
    try {
      const r = await run(() => api.post<{ key: string }>('/api/tickets/email/relay-key'));
      setNewKey(r.key);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  const dirty = Boolean(password) || JSON.stringify(pick(f, domains)) !== JSON.stringify(pick(data, data.allowed_domains.join(', ')));
  const endpoint = `${window.location.origin}/api/tickets/email/inbound`;

  return (
    <div className="stack">
      {dialog}
      <Card title="Email to ticket" actions={f.enabled ? <Badge color="green">On</Badge> : <Badge color="gray">Off</Badge>}>
        <p className="muted">
          Messages to the service desk address become tickets, with the sender as the requester and “Email” as how they arrived.
          A reply that keeps the ticket reference in its subject (for example [TKT-00042]) is added to that ticket as a public comment.
          Automatic replies, delivery reports, mailing lists and the application’s own messages are never turned into tickets.
        </p>
        <Switch label="Email to ticket switched on" checked={data.enabled} disabled={busy !== ''}
          hint={data.source === 'relay' ? 'Needs a relay key below.' : 'Needs the mailbox below.'} error={errors.source}
          onChange={(on) => void save({ enabled: on }, on ? 'Email to ticket is switched on.' : 'Email to ticket is switched off.')} />
        {!data.mail_enabled && (
          <p className="notice"><Icon name="info" size={16} /><span>Outgoing email is off, so no acknowledgments or replies are sent by email. Set it up under <Link to="/admin/email">Administration, Email</Link>.</span></p>
        )}
        {data.source !== 'relay' && data.last_poll_at && (
          <p className={data.last_poll_error ? 'notice notice-warn' : 'muted'} role={data.last_poll_error ? 'alert' : undefined}>
            Mailbox last read {relativeTime(data.last_poll_at)}{data.last_poll_error ? `: ${data.last_poll_error}` : ', without problems.'}
          </p>
        )}
        {data.enabled && data.source !== 'relay' && (
          <div className="form-actions"><Button icon="refresh" loading={busy === 'check'} disabled={busy !== '' && busy !== 'check'} onClick={() => void act('check')}>Read the mailbox now</Button></div>
        )}
      </Card>

      <Card title="Where mail comes from">
        <div className="form">
          <Select label="Source" required options={SOURCES} value={f.source} onChange={(v) => set({ source: (v || 'pop3') as Intake['source'] })} error={errors.source} />
          {f.source === 'pop3' ? (
            <>
              <div className="form-grid">
                <TextField label="Mail server" required value={f.host} onChange={(v) => set({ host: v })} error={errors.host} placeholder="mail.example.org" />
                <NumberField label="Port" required min={1} max={65535} step={1} value={f.port} onChange={(v) => set({ port: Number(v) || 0 })} error={errors.port} />
                <Select label="Security" required options={TLS} value={f.tls} onChange={(v) => set({ tls: (v || 'tls') as Intake['tls'] })} error={errors.tls}
                  hint={f.tls === 'none' ? 'Only for a mail server on this machine: anyone on the network could read the password.' : undefined} />
                <TextField label="User name" required value={f.username} onChange={(v) => set({ username: v })} error={errors.username} autoComplete="off" />
                <TextField label="Password" type="password" value={password} onChange={setPassword} error={errors.password} autoComplete="new-password"
                  placeholder={data.password_set ? 'Saved. Type to replace it' : ''} hint="Kept encrypted. It is never shown again." />
                <NumberField label="Read the mailbox every (minutes)" min={1} max={60} step={1} value={f.poll_minutes} onChange={(v) => set({ poll_minutes: Number(v) || 5 })} error={errors.poll_minutes} />
              </div>
              <Switch label="Leave messages in the mailbox after reading them" checked={f.leave_on_server} onChange={(v) => set({ leave_on_server: v })}
                hint="Off: each message is removed once it is a ticket or a reply. On: each is read once and left where it is." />
              <div className="form-actions">
                <Button icon="check" loading={busy === 'test'} disabled={busy !== '' || data.source !== 'pop3' || !data.host || !data.password_set} onClick={() => void act('test')}>Test the saved connection</Button>
              </div>
            </>
          ) : f.source === 'graph' || f.source === 'gmail' ? (
            <>
              {!data.service_accounts?.[f.source] && (
                <p className="notice">
                  <Icon name="info" size={16} />
                  <span>
                    No {SERVICE_LABEL[f.source]} sign-in is saved yet. Enter it under <Link to="/admin/email">Administration, Email</Link>;
                    email can still be sent over SMTP.
                  </span>
                </p>
              )}
              <p className="muted">
                Uses the {SERVICE_LABEL[f.source]} sign-in saved under Administration, Email.{' '}
                {f.source === 'graph'
                  ? 'The app registration needs the Mail.ReadWrite application permission, with administrator consent, for this mailbox.'
                  : 'Its domain-wide delegation needs the scope https://www.googleapis.com/auth/gmail.modify.'}
                {' '}Unread messages in the inbox are read.
              </p>
              <div className="form-grid">
                <TextField label="Mailbox address" type="email" required value={f.username} onChange={(v) => set({ username: v })} error={errors.username}
                  autoComplete="off" placeholder="servicedesk@example.org" hint="The mailbox people write to, or one their messages are forwarded to." />
                <NumberField label="Read the mailbox every (minutes)" min={1} max={60} step={1} value={f.poll_minutes} onChange={(v) => set({ poll_minutes: Number(v) || 5 })} error={errors.poll_minutes} />
              </div>
              <Switch label="Leave messages in the mailbox after reading them" checked={f.leave_on_server} onChange={(v) => set({ leave_on_server: v })}
                hint={`Off: each message is moved to ${f.source === 'graph' ? 'Deleted Items' : 'Trash'} once it is a ticket or a reply. On: each is marked read and left where it is.`} />
              <div className="form-actions">
                <Button icon="check" loading={busy === 'test'} disabled={busy !== '' || data.source !== f.source || !data.username} onClick={() => void act('test')}>Test the saved connection</Button>
              </div>
            </>
          ) : (
            <div className="sd-relay">
              <p className="muted">Your mail server posts each message it receives for the service desk address to:</p>
              <code className="sd-code">{endpoint}</code>
              <p className="muted">as the request body, with the content type <code>message/rfc822</code> and the headers <code>X-GRC-Relay-Key</code> (the key below) and <code>X-GRC-CSRF: 1</code>. The installation guide has an example.</p>
              {newKey && (
                <div className="notice notice-success" role="status">
                  <strong>The new relay key</strong> — copy it now; it is not shown again.
                  <code className="sd-code">{newKey}</code>
                  <Button size="sm" icon="clipboard" onClick={() => { void navigator.clipboard?.writeText(newKey); toast.success('Key copied.'); }}>Copy</Button>
                </div>
              )}
              <div className="form-actions">
                <Button icon="key" loading={busy === 'key'} onClick={() => void makeKey()}>{data.relay_key_set ? `Replace the relay key (ends …${data.relay_key_hint})` : 'Create a relay key'}</Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card title="New tickets and replies">
        <div className="form">
          <div className="form-grid">
            <TextField label="Service desk address" type="email" value={f.address} onChange={(v) => set({ address: v })} error={errors.address}
              placeholder="servicedesk@example.org" hint="People write to it; messages about these tickets ask for replies to it." />
            <LookupSelect label="Type of new tickets" list="ticket_type" required value={f.ticket_type} onChange={(v) => set({ ticket_type: v || 'incident' })} error={errors.ticket_type} />
            <LookupSelect label="Assignment group" list="assignment_group" value={f.assignment_group ?? ''} onChange={(v) => set({ assignment_group: v || null })} error={errors.assignment_group} />
            <Select label="Messages from people who are not users" required options={UNKNOWN} value={f.unknown_senders} onChange={(v) => set({ unknown_senders: (v || 'create') as Intake['unknown_senders'] })} error={errors.unknown_senders} />
            <TextField className="form-cell-wide" label="Accept outside senders only from these domains" value={domains} onChange={setDomains} error={errors.allowed_domains}
              placeholder="example.org, partner.example.net" hint="Empty: any domain. Users of the application are always accepted." />
            <NumberField label="Most messages from one sender in an hour" min={1} max={500} step={1} value={f.max_per_hour} onChange={(v) => set({ max_per_hour: Number(v) || 20 })} error={errors.max_per_hour}
              hint="Stops a mail loop with a system that keeps answering." />
          </div>
          <Switch label="Acknowledge each new ticket by email, with its reference" checked={f.acknowledge} onChange={(v) => set({ acknowledge: v })} />
          <Switch label="Email public comments to the requester" checked={f.reply_by_email} onChange={(v) => set({ reply_by_email: v })}
            hint="Internal notes are never sent." />
          {!data.files && <p className="muted">Files cannot be stored on this server, so attachments are left out (each one is noted in the log).</p>}
          <div className="form-actions">
            <Button disabled={!dirty || busy !== ''} onClick={() => { setF(data); setDomains(data.allowed_domains.join(', ')); setPassword(''); setErrors({}); }}>Undo changes</Button>
            <Button variant="primary" loading={busy === 'save'} disabled={!dirty || (busy !== '' && busy !== 'save')} onClick={() => void save(form(), 'Email-to-ticket settings saved.')}>Save</Button>
          </div>
        </div>
      </Card>

      <InboundLog refresh={logTick} />
    </div>
  );
}
