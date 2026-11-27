// Outbound webhooks (/admin/webhooks): tell another system when records change, or when one of the
// other events in the server's catalog happens (E13-19).
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, Checkbox, ChoicesField, ConfirmDialog, Drawer, EmptyState, ErrorState, errorMessage, formatDateTime, Icon,
  Loading, Menu, Modal, PageHeader, qs, relativeTime, Select, StatusChip, TableWrap, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { ColorName, Option } from '../../core';
import { CopyBox, Notice, Pager } from './common';
import { adminApi } from './reauth';
import { Switch } from './Switch';

interface Webhook {
  id: string;
  name: string;
  /** The address is kept encrypted (E22-45): only its scheme and host, and a fingerprint, are listed. */
  url_display: string;
  url_host: string | null;
  host_allowed: boolean;
  /** Body format (E36-04): plain_json, chat_text or chat_card. */
  preset: string;
  events: string[];
  active: boolean;
  include_restricted: boolean;
  created_at: string;
  updated_at: string;
  pending: number;
  failed_recently: number;
  last_delivered_at: string | null;
}
interface RecordTypeRef { type: string; label: string; restricted: boolean | 'flag' }
/** An event that is not a record change (only those of areas that are switched on). */
interface OtherEvent {
  event: string;
  label: string;
  description: string;
  restricted: 'always' | 'record' | 'never';
  recordType: string | null;
  data: Record<string, string>;
}
interface WebhooksResponse {
  webhooks: Webhook[];
  outboundEnabled: boolean;
  allowedHosts: string[];
  retryMinutes: number[];
  recordTypes: RecordTypeRef[];
  actions: string[];
  otherEvents?: OtherEvent[];
  presets?: string[];
}
interface Delivery {
  id: string;
  event: string;
  record_type: string | null;
  record_id: string | null;
  status: 'pending' | 'delivered' | 'failed' | 'blocked';
  attempts: number;
  response_status: number | null;
  last_error: string | null;
  created_at: string;
  last_attempt_at: string | null;
  delivered_at: string | null;
  next_attempt_at: string | null;
}

const ACTION_WORDS: Record<string, string> = { create: 'added', update: 'changed', delete: 'deleted', '*': 'any change', test: 'test' };
const DELIVERY_STATUS: Record<Delivery['status'], { color: ColorName; label: string }> = {
  pending: { color: 'blue', label: 'Waiting to retry' },
  delivered: { color: 'green', label: 'Delivered' },
  failed: { color: 'red', label: 'Failed' },
  blocked: { color: 'amber', label: 'Blocked' },
};

/** Whether a URL's host is on the allow-list (the same rule as the server). */
function hostAllowed(raw: string, allowList: string[]): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  const host = url.hostname.toLowerCase();
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return allowList.some((e) => {
    const entry = String(e).trim().toLowerCase();
    if (!entry) return false;
    if (entry.startsWith('*.')) return host.endsWith(entry.slice(1)) && host.length > entry.length - 1;
    const m = /^(.*):(\d+)$/.exec(entry);
    return m ? m[1] === host && m[2] === port : entry === host;
  });
}
const hostOf = (raw: string) => { try { return new URL(raw).host; } catch { return raw; } };
const PRESETS = [
  { value: 'plain_json', label: 'Full event as JSON (for systems you build)' },
  { value: 'chat_text', label: 'Chat message: one line of text' },
  { value: 'chat_card', label: 'Chat card: title, text, link and facts' },
];

function eventLabel(event: string, types: RecordTypeRef[], other: OtherEvent[] = []): string {
  if (event === '*') return 'Every change and every other event';
  const named = other.find((o) => o.event === event);
  if (named) return named.label;
  const [type, action] = event.split('.');
  const recordType = types.find((t) => t.type === type);
  // A whole family of other events, such as "notification_clock.*".
  if (!recordType && action === '*' && other.some((o) => o.event.startsWith(`${type}.`))) {
    const words = type.replace(/_/g, ' ');
    return `Every ${words} event`;
  }
  return `${recordType?.label ?? type}: ${ACTION_WORDS[action] ?? action}`;
}

function minutesText(m: number) {
  return m < 60 ? `${m} ${m === 1 ? 'minute' : 'minutes'}` : `${m / 60} ${m === 60 ? 'hour' : 'hours'}`;
}
function joinAnd(items: string[]) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function WebhooksPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch<WebhooksResponse>('/api/admin/webhooks');
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null);
  const [secret, setSecret] = useState<{ name: string; secret: string; created: boolean } | null>(null);
  const [rotating, setRotating] = useState<Webhook | null>(null);
  const [removing, setRemoving] = useState<Webhook | null>(null);
  const [log, setLog] = useState<Webhook | null>(null);
  const [busy, setBusy] = useState('');

  const act = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try { await work(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(''); }
  };

  const test = (w: Webhook) => act(`test-${w.id}`, async () => {
    const d = await api.post<Delivery>(`/api/admin/webhooks/${w.id}/test`);
    if (d.status === 'delivered') toast.success(`Test delivered to ${hostOf(w.url_host ?? '')}${d.response_status ? ` (the receiver answered ${d.response_status})` : ''}.`);
    else if (d.status === 'blocked') toast.error(`Test not sent: ${d.last_error ?? 'blocked'}`);
    else toast.error(`Test not delivered: ${d.last_error ?? 'no answer'} It will be retried; see Deliveries.`);
    reload();
  });

  const rotate = () => rotating && act('rotate', async () => {
    const res = await adminApi.post<{ secret: string }>(`/api/admin/webhooks/${rotating.id}/rotate-secret`);
    setSecret({ name: rotating.name, secret: res.secret, created: false });
    setRotating(null);
    toast.success('Secret replaced. The old one no longer signs deliveries.');
  });

  const remove = () => removing && act('remove', async () => {
    await adminApi.del(`/api/admin/webhooks/${removing.id}`);
    toast.success(`Webhook "${removing.name}" removed.`);
    setRemoving(null);
    reload();
  });

  const toggle = (w: Webhook, on: boolean) => act(`toggle-${w.id}`, async () => {
    await adminApi.patch(`/api/admin/webhooks/${w.id}`, { active: on });
    toast.success(on ? `"${w.name}" switched on.` : `"${w.name}" switched off. Nothing more is queued for it.`);
    reload();
  });

  return (
    <>
      <PageHeader
        title="Webhooks"
        subtitle="Tell another system, straight away, when records are added, changed or deleted, or when something else happens, such as a backup that failed."
        actions={<Button variant="primary" icon="plus" disabled={!data} onClick={() => setEditing('new')}>Add webhook</Button>}
      />
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={8} label="Loading webhooks" />
        : (
          <div className="stack">
            <OutboundNotice data={data} />
            <Card flush>
              {data.webhooks.length === 0 ? (
                <EmptyState
                  icon="link" title="No webhooks yet"
                  message="Add one to send the details of chosen record changes to an address you give."
                  action={<Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add webhook</Button>}
                />
              ) : (
                <TableWrap label="Webhooks" className="adm-table-frame">
                  <table className="table adm-webhooks">
                    <thead>
                      <tr>
                        <th scope="col">Webhook</th><th scope="col">Events</th><th scope="col">Deliveries</th><th scope="col">On</th>
                        <th scope="col"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.webhooks.map((w) => {
                        const allowed = w.host_allowed;
                        return (
                          <tr key={w.id}>
                            <td className="adm-wrap">
                              <button type="button" className="adm-link-button" onClick={() => setEditing(w)}>{w.name}</button>
                              <div className="muted adm-small adm-break">{w.url_display}</div>
                              <span className="row adm-chips adm-chip-line">
                                {!allowed && <StatusChip color="amber" label="Host not allowed" title={`${hostOf(w.url_host ?? '')} is not in the allowed hosts list, so nothing is sent.`} />}
                                {w.include_restricted && <StatusChip color="purple" label="Includes restricted records" />}
                                {w.preset !== 'plain_json' && <StatusChip color="blue" label={w.preset === 'chat_card' ? 'Chat card' : 'Chat text'} />}
                              </span>
                            </td>
                            <td className="adm-wrap">
                              <span className="adm-events-list">
                                {w.events.slice(0, 3).map((e) => <span key={e} className="adm-small">{eventLabel(e, data.recordTypes, data.otherEvents)}</span>)}
                                {w.events.length > 3 && <span className="muted adm-small">and {w.events.length - 3} more</span>}
                              </span>
                            </td>
                            <td className="adm-wrap adm-small">
                              <div>{w.last_delivered_at ? <span title={formatDateTime(w.last_delivered_at)}>Last delivered {relativeTime(w.last_delivered_at)}</span> : <span className="muted">Nothing delivered yet</span>}</div>
                              {w.pending > 0 && <div>{w.pending} waiting</div>}
                              {w.failed_recently > 0 && <div className="adm-text-danger">{w.failed_recently} failed or blocked in 7 days</div>}
                            </td>
                            <td><Switch label={`${w.name} switched on`} hideLabel checked={w.active} disabled={busy === `toggle-${w.id}`} onChange={(on) => void toggle(w, on)} /></td>
                            <td className="adm-row-actions">
                              <Menu
                                label={`Actions for ${w.name}`} icon="more" iconOnly size="sm" align="end"
                                items={[
                                  { label: 'Edit', icon: 'edit', onSelect: () => setEditing(w) },
                                  { label: 'Deliveries', icon: 'history', onSelect: () => setLog(w) },
                                  { label: busy === `test-${w.id}` ? 'Sending test…' : 'Send a test', icon: 'upload', disabled: busy !== '', onSelect: () => void test(w) },
                                  { label: 'Replace secret', icon: 'key', onSelect: () => setRotating(w) },
                                  { label: 'Remove', icon: 'trash', danger: true, separated: true, onSelect: () => setRemoving(w) },
                                ]}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>
            <HowItWorks retry={data.retryMinutes} />
          </div>
        )}

      {data && editing && (
        <WebhookDialog
          key={editing === 'new' ? 'new' : editing.id} hook={editing === 'new' ? null : editing} data={data}
          onClose={() => setEditing(null)}
          onSaved={(made) => { setEditing(null); reload(); if (made) setSecret(made); }}
        />
      )}
      <Modal
        open={secret !== null} title={secret?.created ? `Webhook "${secret.name}" added` : `New secret for "${secret?.name ?? ''}"`}
        onClose={() => setSecret(null)} footer={<Button variant="primary" onClick={() => setSecret(null)}>Done</Button>}
      >
        {secret && (
          <div className="stack">
            <Notice tone="caution" role="status">
              <strong>This secret is shown once.</strong> Give it to whoever runs the receiving system, so it can check that each delivery
              really came from here. When you close this window it cannot be shown again; you can only replace it.
            </Notice>
            <CopyBox prominent label="Signing secret" copyLabel="Copy secret" value={secret.secret} testId="webhook-secret">
              <p className="field-hint">The receiver works out HMAC-SHA256 of the <code>X-GRC-Timestamp</code> header, a full stop and the body, with this secret, and compares it with <code>X-GRC-Signature</code>.</p>
            </CopyBox>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={rotating !== null} busy={busy === 'rotate'} title="Replace the secret?" confirmLabel="Replace secret"
        message={<p>A new secret is made and shown once. From then on deliveries for <strong>{rotating?.name}</strong> are signed with it, so the receiving system must be given the new one, or it will reject them.</p>}
        onConfirm={() => void rotate()} onCancel={() => setRotating(null)}
      />
      <ConfirmDialog
        open={removing !== null} danger busy={busy === 'remove'} title="Remove this webhook?" confirmLabel="Remove webhook"
        message={<p>Nothing more is sent to <strong>{removing ? hostOf(removing.url_host ?? '') : ''}</strong> for <strong>{removing?.name}</strong>, and deliveries still waiting are canceled. Its delivery log is kept for the audit trail. To pause it instead, switch it off.</p>}
        onConfirm={() => void remove()} onCancel={() => setRemoving(null)}
      />
      {log && <DeliveriesDrawer hook={log} data={data} onClose={() => { setLog(null); reload(); }} />}
    </>
  );
}

function OutboundNotice({ data }: { data: WebhooksResponse }) {
  const hosts = data.allowedHosts;
  if (!data.outboundEnabled) {
    return (
      <Notice tone="caution" icon="lock">
        <p><strong>Nothing is sent yet: outbound connections are switched off.</strong> Webhooks can be set up, but every delivery is recorded as
          blocked until an administrator switches on <strong>Allow outbound connections</strong> in <Link to="/admin/settings#settings-integrations">Settings</Link> and
          adds each receiving host to <strong>Allowed hosts</strong>.</p>
      </Notice>
    );
  }
  return (
    <Notice tone={hosts.length ? 'info' : 'caution'} icon="link">
      <p>
        <strong>Outbound connections are on.</strong>{' '}
        {hosts.length
          ? <>Deliveries go only to these hosts: {hosts.map((h, i) => <span key={h}>{i > 0 && ', '}<code>{h}</code></span>)}. Anything else is blocked.</>
          : <>No hosts are allowed yet, so every delivery is blocked.</>}
        {' '}The list is under <strong>Allowed hosts</strong> in <Link to="/admin/settings#settings-integrations">Settings</Link>.
      </p>
    </Notice>
  );
}

function HowItWorks({ retry }: { retry: number[] }) {
  return (
    <Card title="How deliveries work">
      <ul className="adm-facts">
        <li><Icon name="upload" size={16} /> <span>Each event is sent as a JSON <code>POST</code> to the webhook's address: the record's type, reference, title and fields, and for a change the values before and after.</span></li>
        <li><Icon name="bell" size={16} /> <span>Other events (a backup that failed, and the rest of the list in the webhook form) carry the event's own details and, where there is one, the record it is about. Events of a part of the application that is switched off are not sent.</span></li>
        <li><Icon name="key" size={16} /> <span>Every delivery is signed with the webhook's secret: <code>X-GRC-Signature</code> holds <code>sha256=</code> and the HMAC-SHA256 of <code>X-GRC-Timestamp</code>, a full stop and the body. The receiver should check it and refuse old timestamps.</span></li>
        <li><Icon name="refresh" size={16} /> <span>A delivery that fails (no answer within 10 seconds, or an answer other than 2xx) is tried again after {joinAnd(retry.map(minutesText))}, then marked failed. Redirects are never followed. A failed or blocked delivery can be sent again from <strong>Deliveries</strong>.</span></li>
        <li><Icon name="message" size={16} /> <span>A webhook may send a chat format instead of the full event: one line of text, or a card with a title, link and facts. Chat formats carry a summary and the names of changed fields, never their values, and are signed the same way.</span></li>
        <li><Icon name="eye" size={16} /> <span>Addresses are kept encrypted, because many receivers put their own secret in them. The list shows the host and a fingerprint; <strong>Show current address</strong> in the form shows the whole address after your password.</span></li>
        <li><Icon name="lock" size={16} /> <span>Restricted records (of a restricted record type, or flagged restricted) are left out unless someone holding <code>security.view</code> switches on <strong>Include restricted records</strong>, and they stop again if that person loses it.</span></li>
      </ul>
    </Card>
  );
}

function WebhookDialog({ hook, data, onClose, onSaved }: {
  hook: Webhook | null; data: WebhooksResponse; onClose: () => void; onSaved: (made: { name: string; secret: string; created: boolean } | null) => void;
}) {
  const auth = useAuth();
  const mayRestrict = auth.can('security.view');
  const [name, setName] = useState(hook?.name ?? '');
  // The stored address is never sent to the browser (E22-45): empty in an edit means "keep it".
  const [url, setUrl] = useState(hook ? '' : 'https://');
  const [preset, setPreset] = useState(hook?.preset ?? 'plain_json');
  const [revealing, setRevealing] = useState(false);
  const [all, setAll] = useState(hook ? hook.events.includes('*') : false);
  const [events, setEvents] = useState<string[]>(hook ? hook.events.filter((e) => e !== '*') : []);
  const [active, setActive] = useState(hook?.active ?? true);
  const [restricted, setRestricted] = useState(hook?.include_restricted ?? false);
  const [secret, setSecret] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const other = data.otherEvents ?? [];
  const otherNames = new Set(other.map((o) => o.event));
  // Record changes go in the multi-select; other events have their own boxes below it.
  const recordEvents = events.filter((e) => !otherNames.has(e));
  const otherChosen = events.filter((e) => otherNames.has(e));
  const options = useMemo(() => {
    const list: Option[] = [];
    for (const t of data.recordTypes) {
      list.push({ value: `${t.type}.*`, label: `${t.label}: any change` });
      for (const a of data.actions) list.push({ value: `${t.type}.${a}`, label: `${t.label}: ${ACTION_WORDS[a] ?? a}` });
    }
    const named = new Set((data.otherEvents ?? []).map((o) => o.event));
    for (const e of events) {
      if (!named.has(e) && !list.some((o) => o.value === e)) list.push({ value: e, label: eventLabel(e, data.recordTypes, data.otherEvents) });
    }
    return list;
  }, [data, events]);
  const toggleOther = (event: string, on: boolean) => {
    setEvents((old) => (on ? [...old.filter((e) => e !== event), event] : old.filter((e) => e !== event)));
    clearError('events');
  };
  const allowed = /^https?:\/\/./.test(url) ? hostAllowed(url, data.allowedHosts) : true;
  const startEvents = hook ? hook.events.filter((e) => e !== '*') : [];
  const dirty = name !== (hook?.name ?? '') || url !== (hook ? '' : 'https://') || preset !== (hook?.preset ?? 'plain_json')
    || all !== (hook ? hook.events.includes('*') : false) || events.join() !== startEvents.join() || active !== (hook?.active ?? true)
    || restricted !== (hook?.include_restricted ?? false) || secret !== '';
  const reveal = async () => {
    if (!hook) return;
    setRevealing(true);
    try {
      const res = await adminApi.post<{ url: string }>(`/api/admin/webhooks/${hook.id}/reveal`);
      setUrl(res.url);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setRevealing(false);
    }
  };
  const clearError = (k: string) => setErrors(({ [k]: _gone, ...rest }) => rest);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = 'Enter a name.';
    if (!(hook && !url.trim()) && !/^https?:\/\/[^\s/]+/.test(url.trim())) found.url = 'Enter an http or https address.';
    if (!all && events.length === 0) found.events = 'Choose at least one event, or check every change.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    const body: Record<string, unknown> = { name: name.trim(), events: all ? ['*'] : events, active, includeRestricted: restricted, preset };
    if (url.trim()) body.url = url.trim();
    if (!hook && secret) body.secret = secret;
    setBusy(true);
    try {
      if (hook) {
        await adminApi.patch(`/api/admin/webhooks/${hook.id}`, body);
        onSaved(null);
      } else {
        const res = await adminApi.post<Webhook & { secret: string }>('/api/admin/webhooks', body);
        onSaved({ name: res.name, secret: res.secret, created: true });
      }
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={hook ? `Edit "${hook.name}"` : 'Add a webhook'} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <TextField label="Name" required maxLength={80} value={name} onChange={(v) => { setName(v); clearError('name'); }} error={errors.name} hint="For example the system it feeds." />
        <TextField
          label="Address" required type="url" maxLength={500} value={url} onChange={(v) => { setUrl(v); clearError('url'); }} error={errors.url}
          hint={hook
            ? `Kept encrypted and not shown (${hook.url_display}). Leave empty to keep it, or type a new address.`
            : 'The full https address the receiving system gave you. No user name or password in it. It is kept encrypted.'}
        />
        {hook && !url && (
          <div><Button size="sm" icon="eye" loading={revealing} onClick={() => void reveal()}>Show current address</Button></div>
        )}
        <Select
          label="Format" value={preset} onChange={setPreset} error={errors.preset}
          options={PRESETS.filter((p) => !data.presets || data.presets.includes(p.value))}
          hint="Chat formats suit a chat channel's incoming webhook; they carry a summary only."
        />
        {!allowed && !errors.url && (
          <Notice tone="caution">
            <code>{hostOf(url)}</code> is not in the allowed hosts list, so deliveries to it will be blocked. Add it under <strong>Allowed hosts</strong> in Settings.
          </Notice>
        )}
        <fieldset className="adm-fieldset">
          <legend className="field-label">Events</legend>
          <Checkbox label="Every change to every record type, and every other event" checked={all} onChange={(on) => { setAll(on); clearError('events'); }} hint="Includes record types and events added later." />
          {!all && (
            <ChoicesField
              label="Record changes" value={recordEvents} onChange={(v) => { setEvents([...v, ...otherChosen]); clearError('events'); }} options={options}
              placeholder="Choose record types and changes" error={errors.events}
            />
          )}
          {all && errors.events && <p className="field-error" role="alert">{errors.events}</p>}
        </fieldset>
        {!all && other.length > 0 && (
          <fieldset className="adm-fieldset">
            <legend className="field-label">Other events</legend>
            {other.map((o) => (
              <Checkbox
                key={o.event} label={o.label} checked={otherChosen.includes(o.event)} onChange={(on) => toggleOther(o.event, on)}
                hint={`${o.description}${o.restricted === 'always' ? ' Sent only when restricted records are included.'
                  : o.restricted === 'record' ? ' Left out for a restricted record unless restricted records are included.' : ''}`}
              />
            ))}
          </fieldset>
        )}
        <Checkbox
          label="Include restricted records" checked={restricted} disabled={!mayRestrict && !restricted}
          onChange={setRestricted} error={errors.includeRestricted}
          hint={mayRestrict
            ? 'Security incidents and records flagged restricted (cybersecurity risks by default) are sent too. They stop being sent if you lose security.view.'
            : 'Only someone holding security.view can switch this on.'}
        />
        {!hook && (
          <TextField
            label="Secret" type="password" autoComplete="new-password" value={secret} onChange={(v) => { setSecret(v); clearError('secret'); }} error={errors.secret}
            hint="Leave empty to have a strong one made for you (recommended). It is shown once after saving."
          />
        )}
        <Switch label="Switched on" checked={active} onChange={setActive} />
        <p className="field-hint">Changing the address, or including restricted records, asks for your password.</p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>{hook ? 'Save changes' : 'Add webhook'}</Button>
        </div>
      </form>
    </Modal>
  );
}

const DELIVERY_PAGE = 25;
const DELIVERY_FILTER = [
  { value: 'delivered', label: 'Delivered' },
  { value: 'pending', label: 'Waiting to retry' },
  { value: 'failed', label: 'Failed' },
  { value: 'blocked', label: 'Blocked' },
];

function DeliveriesDrawer({ hook, data, onClose }: { hook: Webhook; data: WebhooksResponse | null | undefined; onClose: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const { data: log, error, reload, loading } = useFetch<{ rows: Delivery[]; total: number }>(
    `/api/admin/webhooks/${hook.id}/deliveries${qs({ status, page, pageSize: DELIVERY_PAGE })}`, { keepPrevious: true },
  );
  const pages = log ? Math.max(1, Math.ceil(log.total / DELIVERY_PAGE)) : 1;

  const retry = async (d: Delivery) => {
    setBusy(d.id);
    try {
      const res = await api.post<Delivery>(`/api/admin/webhook-deliveries/${d.id}/retry`);
      if (res.status === 'delivered') toast.success('Delivered.');
      else toast.error(`Not delivered: ${res.last_error ?? DELIVERY_STATUS[res.status]?.label ?? res.status}`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <Drawer open size="lg" title={`Deliveries: ${hook.name}`} onClose={onClose}>
      <div className="stack">
        <p className="muted">Newest first. A delivery waiting to retry is tried again by itself; one that failed or was blocked can be sent again here.</p>
        <Select label="Status" placeholder="Any status" options={DELIVERY_FILTER} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
        {error ? <ErrorState error={error} onRetry={reload} />
          : !log ? <Loading lines={5} label="Loading deliveries" />
          : log.rows.length === 0 ? (
            <EmptyState icon="history" title={status ? 'No deliveries with this status' : 'Nothing has been sent yet'} message={status ? undefined : 'Deliveries appear here as soon as a matching record changes or a chosen event happens, or when you send a test.'} />
          ) : (
            <div className="adm-deliveries-frame">
              <ul className={`adm-deliveries${loading ? ' table-loading' : ''}`} aria-label="Deliveries" aria-busy={loading}>
                {log.rows.map((d) => {
                  const s = DELIVERY_STATUS[d.status] ?? { color: 'gray' as ColorName, label: d.status };
                  return (
                    <li key={d.id} className="adm-delivery">
                      <div className="adm-delivery-main">
                        <span className="adm-session-name">
                          <code>{d.event}</code> <StatusChip color={s.color} label={s.label} />
                          {d.response_status !== null && <span className="muted adm-small">Answer {d.response_status}</span>}
                        </span>
                        <span className="muted adm-session-facts">
                          <span title={formatDateTime(d.created_at)}>Queued {relativeTime(d.created_at)}</span>
                          <span>{d.attempts} {d.attempts === 1 ? 'attempt' : 'attempts'}</span>
                          {d.delivered_at && <span>Delivered {formatDateTime(d.delivered_at)}</span>}
                          {d.next_attempt_at && <span>Next try {relativeTime(d.next_attempt_at)}</span>}
                          {d.record_type && <span>{data?.recordTypes.find((t) => t.type === d.record_type)?.label ?? d.record_type}</span>}
                        </span>
                        {d.last_error && <span className="adm-small adm-text-danger adm-break">{d.last_error}</span>}
                      </div>
                      {(d.status === 'failed' || d.status === 'blocked') && (
                        <Button size="sm" icon="refresh" loading={busy === d.id} disabled={busy !== '' && busy !== d.id} onClick={() => void retry(d)}>Send again</Button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Pager summary={`${log.total} ${log.total === 1 ? 'delivery' : 'deliveries'}`} page={page} pages={pages} onPage={setPage} />
            </div>
          )}
      </div>
    </Drawer>
  );
}
