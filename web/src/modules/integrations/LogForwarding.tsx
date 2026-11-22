// Administration > Log forwarding (E36-02): send every audit event to a security monitoring system, as
// syslog (over TLS, or plain TCP inside a trusted network) or JSON lines over HTTPS. New forwarders are
// off; nothing is sent until outbound connections are on and the collector's host is allowed.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, errorMessage, formatDateTime, Icon, Loading, Menu, Modal, NumberField,
  PageHeader, qs, relativeTime, Select, StatusChip, Switch, TextArea, TextField, useFetch, useToast,
} from '../../core';
import type { ColorName } from '../../core';
import '../admin/admin.css';
import { Notice, Pager } from '../admin/common';
import { adminApi } from '../admin/reauth';
import { Switch as RowSwitch } from '../admin/Switch';
import './integrations.css';

type Kind = 'syslog_tls' | 'syslog_tcp' | 'https_json';
interface Forwarder {
  id: string; name: string; kind: Kind; host: string; port: number | null; format: 'rfc5424' | 'json_lines'; include_actions: string[];
  active: boolean; cursor_id: string; waiting: number; failures: number; retry_at: string | null; last_success_at: string | null;
  last_error: string | null; has_url: boolean; has_secret: boolean; has_ca: boolean; created_at: string;
}
interface ForwardersResponse { forwarders: Forwarder[]; outboundEnabled: boolean; allowedHosts: string[]; logDays: number }
interface LogRow { id: string; from_id: string | null; to_id: string | null; count: number; status: 'sent' | 'failed' | 'test'; error: string | null; attempted_at: string }

const KIND_LABEL: Record<Kind, string> = { syslog_tls: 'Syslog over TLS', syslog_tcp: 'Syslog over TCP (unencrypted)', https_json: 'JSON over HTTPS' };
const KINDS = (Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));
const destination = (f: Forwarder) => (f.kind === 'https_json' ? `https://${f.host}/…` : `${f.host}:${f.port ?? ''}`);

export function LogForwardingPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch<ForwardersResponse>('/api/admin/audit-forwarders');
  const [editing, setEditing] = useState<Forwarder | 'new' | null>(null);
  const [removing, setRemoving] = useState<Forwarder | null>(null);
  const [log, setLog] = useState<Forwarder | null>(null);
  const [busy, setBusy] = useState('');

  const act = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try { await work(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(''); }
  };
  const test = (f: Forwarder) => act(`test-${f.id}`, async () => {
    const res = await adminApi.post<{ ok: boolean; error?: string }>(`/api/admin/audit-forwarders/${f.id}/test`);
    if (res.ok) toast.success(`Test event sent to ${destination(f)}.`); else toast.error(`Test not sent: ${res.error ?? 'failed'}`);
    reload();
  });
  const toggle = (f: Forwarder, on: boolean) => act(`toggle-${f.id}`, async () => {
    await adminApi.patch(`/api/admin/audit-forwarders/${f.id}`, { active: on });
    toast.success(on ? `"${f.name}" switched on.` : `"${f.name}" switched off. Events wait for it and are sent when it is on again.`);
    reload();
  });
  const remove = () => removing && act('remove', async () => {
    await adminApi.del(`/api/admin/audit-forwarders/${removing.id}`);
    toast.success(`Forwarder "${removing.name}" removed.`);
    setRemoving(null);
    reload();
  });

  return (
    <>
      <PageHeader
        title="Log forwarding"
        subtitle="Send every audit event, as it happens, to your security monitoring system: syslog over TLS, or JSON over HTTPS."
        actions={<Button variant="primary" icon="plus" disabled={!data} onClick={() => setEditing('new')}>Add forwarder</Button>}
      />
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={6} label="Loading forwarders" />
        : (
          <div className="stack">
            <OutboundNotice data={data} />
            <Card flush>
              {data.forwarders.length === 0 ? (
                <EmptyState
                  icon="upload" title="No forwarders yet"
                  message="Add one to send the audit log to a collector. It starts switched off."
                  action={<Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add forwarder</Button>}
                />
              ) : (
                <div className="table-wrap adm-table-frame">
                  <table className="table">
                    <thead><tr><th scope="col">Forwarder</th><th scope="col">Sending</th><th scope="col">On</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {data.forwarders.map((f) => (
                        <tr key={f.id}>
                          <td className="adm-wrap">
                            <button type="button" className="adm-link-button" onClick={() => setEditing(f)}>{f.name}</button>
                            <div className="muted adm-small">{KIND_LABEL[f.kind]} to <span className="int-dest">{destination(f)}</span></div>
                            <span className="row adm-chips adm-chip-line">
                              {f.kind === 'syslog_tcp' && <StatusChip color="amber" label="Unencrypted" title="Plain TCP: use it only inside a network you trust." />}
                              {f.include_actions.length > 0 && <StatusChip color="blue" label={`${f.include_actions.length} action filter(s)`} />}
                            </span>
                          </td>
                          <td className="adm-wrap adm-small">
                            <div>{f.last_success_at ? <span title={formatDateTime(f.last_success_at)}>Last sent {relativeTime(f.last_success_at)}</span> : <span className="muted">Nothing sent yet</span>}</div>
                            {f.waiting > 0 && <div>{f.waiting} event(s) waiting</div>}
                            {f.last_error && <div className="adm-text-danger adm-break">{f.last_error}</div>}
                            {f.retry_at && <div className="muted">Next try {relativeTime(f.retry_at)}</div>}
                          </td>
                          <td><RowSwitch label={`${f.name} switched on`} hideLabel checked={f.active} disabled={busy === `toggle-${f.id}`} onChange={(on) => void toggle(f, on)} /></td>
                          <td className="adm-row-actions">
                            <Menu
                              label={`Actions for ${f.name}`} icon="more" iconOnly size="sm" align="end"
                              items={[
                                { label: 'Edit', icon: 'edit', onSelect: () => setEditing(f) },
                                { label: 'Delivery log', icon: 'history', onSelect: () => setLog(f) },
                                { label: busy === `test-${f.id}` ? 'Sending test…' : 'Send a test event', icon: 'upload', disabled: busy !== '', onSelect: () => void test(f) },
                                { label: 'Remove', icon: 'trash', danger: true, separated: true, onSelect: () => setRemoving(f) },
                              ]}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <RetentionCard days={data.logDays} onSaved={reload} />
            <HowItWorks />
          </div>
        )}
      {editing && (
        <ForwarderDialog
          key={editing === 'new' ? 'new' : editing.id} forwarder={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      <ConfirmDialog
        open={removing !== null} danger busy={busy === 'remove'} title="Remove this forwarder?" confirmLabel="Remove forwarder"
        message={<p>Nothing more is sent to <strong>{removing ? destination(removing) : ''}</strong>, and its address and secret are erased. Events already sent stay in the collector. To pause it instead, switch it off.</p>}
        onConfirm={() => void remove()} onCancel={() => setRemoving(null)}
      />
      {log && <LogDrawer forwarder={log} onClose={() => setLog(null)} />}
    </>
  );
}

function OutboundNotice({ data }: { data: ForwardersResponse }) {
  if (!data.outboundEnabled) {
    return (
      <Notice tone="caution" icon="lock">
        <p><strong>Nothing is sent yet: outbound connections are switched off.</strong> Forwarders can be set up, but they wait until an administrator switches on
          <strong> Outbound connections</strong> in <Link to="/admin/settings#settings-integrations">Settings</Link> and adds each collector's host (with its port) to <strong>Allowed hosts</strong>.</p>
      </Notice>
    );
  }
  return (
    <Notice tone="info" icon="link">
      <p><strong>Outbound connections are on.</strong> Events go only to collectors whose host is under <strong>Allowed hosts</strong> in <Link to="/admin/settings#settings-integrations">Settings</Link>
        {data.allowedHosts.length ? <>: {data.allowedHosts.map((h, i) => <span key={h}>{i > 0 && ', '}<code>{h}</code></span>)}.</> : <>, and none is allowed yet.</>}</p>
    </Notice>
  );
}

function RetentionCard({ days, onSaved }: { days: number; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState<number | null>(days);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminApi.patch('/api/admin/settings', { 'retention.audit_forward_log_days': value });
      toast.success('Saved.');
      setError('');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError && err.fields['retention.audit_forward_log_days'] ? err.fields['retention.audit_forward_log_days'] : errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Card title="Delivery log">
      <form className="int-retention" onSubmit={save} noValidate>
        <NumberField label="Keep the delivery log for (days)" value={value} onChange={setValue} min={1} max={3650} step={1} error={error} />
        <Button type="submit" loading={busy} disabled={value === days}>Save</Button>
      </form>
      <p className="muted adm-small">Older rows of the delivery log are removed each day. The events already forwarded are in your collector, and are not recalled from it at the end of any retention period here.</p>
    </Card>
  );
}

function ForwarderDialog({ forwarder: f, onClose, onSaved }: { forwarder: Forwarder | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(f?.name ?? '');
  const [kind, setKind] = useState<Kind>(f?.kind ?? 'syslog_tls');
  const [host, setHost] = useState(f && f.kind !== 'https_json' ? f.host : '');
  const [port, setPort] = useState<number | null>(f?.port ?? null);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [removeSecret, setRemoveSecret] = useState(false);
  const [ca, setCa] = useState('');
  const [format, setFormat] = useState<string>(f?.format ?? 'rfc5424');
  const [actions, setActions] = useState((f?.include_actions ?? []).join('\n'));
  const [start, setStart] = useState('now');
  const [active, setActive] = useState(f?.active ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const syslog = kind !== 'https_json';
  const dirty = name !== (f?.name ?? '') || kind !== (f?.kind ?? 'syslog_tls') || host !== (f && f.kind !== 'https_json' ? f.host : '') || port !== (f?.port ?? null)
    || url !== '' || secret !== '' || removeSecret || ca !== '' || format !== (f?.format ?? 'rfc5424') || actions !== (f?.include_actions ?? []).join('\n')
    || active !== (f?.active ?? false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = 'Enter a name.';
    if (syslog && !host.trim()) found.host = 'Enter the collector\'s host name or address.';
    if (!syslog && !url.trim() && !(f?.kind === 'https_json' && f.has_url)) found.url = 'Enter the collector\'s https address.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    const body: Record<string, unknown> = {
      name: name.trim(), kind, active,
      includeActions: actions.split(/[\s,]+/).map((a) => a.trim()).filter(Boolean),
      ...(syslog ? { host: host.trim(), port, format } : { url: url.trim() }),
    };
    if (secret) body.secret = secret; else if (removeSecret) body.secret = null;
    if (ca.trim()) body.caCert = ca.trim();
    if (!f) body.startFrom = start;
    setBusy(true);
    try {
      if (f) await adminApi.patch(`/api/admin/audit-forwarders/${f.id}`, body);
      else await adminApi.post('/api/admin/audit-forwarders', body);
      toast.success(f ? 'Forwarder saved.' : `Forwarder "${name.trim()}" added${active ? '' : ', switched off'}.`);
      onSaved();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
    } finally { setBusy(false); }
  };

  return (
    <Modal open size="lg" title={f ? `Edit "${f.name}"` : 'Add a forwarder'} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <TextField label="Name" required maxLength={80} value={name} onChange={setName} error={errors.name} hint="For example the monitoring system it feeds." />
        <Select label="How to send" value={kind} onChange={(v) => setKind(v as Kind)} options={KINDS} error={errors.kind} />
        {kind === 'syslog_tcp' && <Notice tone="caution">Plain TCP is not encrypted: the audit log names people and records. Use it only inside a network you trust; prefer syslog over TLS.</Notice>}
        {syslog ? (
          <div className="int-grid">
            <TextField label="Host" required value={host} onChange={setHost} error={errors.host} hint="The collector's host name or address." />
            <NumberField label="Port" value={port} onChange={setPort} min={1} max={65535} step={1} error={errors.port} placeholder={kind === 'syslog_tls' ? '6514' : '514'} />
            <Select
              label="Format" value={format} onChange={setFormat} error={errors.format}
              options={[{ value: 'rfc5424', label: 'Syslog (RFC 5424), framed by length' }, { value: 'json_lines', label: 'JSON, one event a line' }]}
            />
          </div>
        ) : (
          <TextField
            label="Address" type="url" maxLength={500} value={url} onChange={setUrl} error={errors.url}
            hint={f?.kind === 'https_json' && f.has_url ? `Kept encrypted and not shown (${destination(f)}). Leave empty to keep it.` : 'The collector\'s https address. Kept encrypted.'}
          />
        )}
        {!syslog && (
          <>
            <TextField
              label="Secret" type="password" autoComplete="new-password" value={secret} onChange={(v) => { setSecret(v); setRemoveSecret(false); }} error={errors.secret}
              hint={f?.has_secret ? 'A secret is set and kept encrypted. Type a new one to replace it.' : 'Optional. Sent as a bearer token, and used to sign each batch (X-GRC-Signature).'}
            />
            {f?.has_secret && !secret && <Switch label="Remove the secret" checked={removeSecret} onChange={setRemoveSecret} />}
          </>
        )}
        {kind !== 'syslog_tcp' && (
          <TextArea
            label="Certificate authority" value={ca} onChange={setCa} rows={3} error={errors.caCert}
            hint={f?.has_ca ? 'One is set. Paste another to replace it.' : 'Optional: for a collector whose certificate comes from your own authority. Paste its certificate (PEM). Certificates are always checked.'}
          />
        )}
        <TextArea
          label="Only these actions" value={actions} onChange={setActions} rows={3} error={errors.includeActions}
          hint={'Optional. One a line: an action such as signin.failure, or a family such as user. or webhook.*. Empty: every event.'}
        />
        {!f && (
          <Select
            label="Start with" value={start} onChange={setStart} error={errors.startFrom}
            options={[{ value: 'now', label: 'Events from now on' }, { value: 'beginning', label: 'The whole audit log, from the beginning' }]}
          />
        )}
        <Switch label="Switched on" checked={active} onChange={setActive} />
        <p className="field-hint">Saving where it sends, or switching it on, asks for your password.</p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>{f ? 'Save changes' : 'Add forwarder'}</Button>
        </div>
      </form>
    </Modal>
  );
}

const LOG_STATUS: Record<LogRow['status'], { color: ColorName; label: string }> = {
  sent: { color: 'green', label: 'Sent' }, failed: { color: 'red', label: 'Failed' }, test: { color: 'blue', label: 'Test' },
};
const PAGE = 25;

function LogDrawer({ forwarder, onClose }: { forwarder: Forwarder; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, error, reload, loading } = useFetch<{ rows: LogRow[]; total: number }>(
    `/api/admin/audit-forwarders/${forwarder.id}/log${qs({ page, pageSize: PAGE })}`, { keepPrevious: true });
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  return (
    <Drawer open size="lg" title={`Delivery log: ${forwarder.name}`} onClose={onClose}>
      <div className="stack">
        <p className="muted">Newest first. Each row is a batch of events (by audit event number), a test, or a failure; a failure is tried again by itself.</p>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <Loading lines={5} label="Loading the delivery log" />
          : data.rows.length === 0 ? <EmptyState icon="history" title="Nothing sent yet" message="Batches appear here once the forwarder is on and events are sent, or when you send a test." />
          : (
            <>
              <ul className={`int-log${loading ? ' table-loading' : ''}`} aria-label="Delivery log" aria-busy={loading}>
                {data.rows.map((r) => {
                  const s = LOG_STATUS[r.status] ?? { color: 'gray' as ColorName, label: r.status };
                  return (
                    <li key={r.id}>
                      <StatusChip color={s.color} label={s.label} />
                      <span title={formatDateTime(r.attempted_at)}>{relativeTime(r.attempted_at)}</span>
                      {r.status === 'sent' && <span className="muted">{r.count} event(s), numbers {r.from_id} to {r.to_id}</span>}
                      {r.error && <span className="adm-text-danger adm-break">{r.error}</span>}
                    </li>
                  );
                })}
              </ul>
              <Pager summary={`${data.total} ${data.total === 1 ? 'row' : 'rows'}`} page={page} pages={pages} onPage={setPage} />
            </>
          )}
      </div>
    </Drawer>
  );
}

function HowItWorks() {
  return (
    <Card title="How forwarding works">
      <ul className="adm-facts">
        <li><Icon name="upload" size={16} /> <span>Every audit event is sent in order, about once a minute, in batches of up to 500. Syslog messages carry the event as JSON; HTTPS posts JSON lines.</span></li>
        <li><Icon name="lock" size={16} /> <span>Certificates are always checked. Addresses and secrets are kept encrypted. Values that look like secrets (passwords, tokens, keys) are removed from what is sent, and webhook addresses are shown by host only.</span></li>
        <li><Icon name="refresh" size={16} /> <span>When the collector cannot be reached, nothing is lost: the forwarder waits (one minute, doubling up to an hour) and sends from where it stopped.</span></li>
        <li><Icon name="alert" size={16} /> <span>The audit log names people and records. Once sent, events are kept by the collector under its own rules: they are not recalled when anything here reaches the end of its retention period.</span></li>
      </ul>
    </Card>
  );
}
