// Administration > Calendar and work trackers: the calendar feeds switch and everyone's feeds (E36-03),
// and the connections of the work-tracker bridge (E36-06). Switching feeds on, adding a connection,
// giving it a new address, sending restricted records or replacing its secrets asks for the password
// again. The kinds of record a connection can send come from the server, without those of a
// switched-off area; a kind a connection already holds is kept when it is saved, and not shown.
import { useState, type FormEvent } from 'react';
import {
  adminApi, api, ApiError, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, Loading, Modal,
  PageHeader, relativeTime, StatusChip, Switch, TextArea, TextField, useAuth, useFetch, useToast, withReauth,
} from '../../core';
import { CopyBox } from '../admin/common';
import './feeds.css';

interface AdminFeed { id: string; name: string; detail: string; sources: string[]; created_at: string; last_used_at: string | null; user_name: string; username: string; user_active: boolean }
interface Connector {
  id: string; name: string; url_host: string; active: boolean; record_types: string[]; push_on_create: boolean; include_restricted: boolean;
  status_map: Record<string, Record<string, string>>; last_inbound_at: string | null; links: number; failing: number;
}
interface Kind { type: string; label: string }
interface Connectors { outboundEnabled: boolean; allowedHosts: string[]; kinds: Kind[]; connectors: Connector[] }
interface Secrets { name?: string; secret: string; inboundSecret: string; inboundAddress: string }

/** "Actions", "Actions and Findings", "Actions, Findings and Plans". */
const joinLabels = (labels: string[]) => (labels.length < 2 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`);

export function FeedsAdminPage() {
  return (
    <div className="feeds-page">
      <PageHeader title="Calendar and work trackers" subtitle="Personal calendar feeds, and the connections to an outside work-tracking tool" />
      <CalendarCard />
      <TrackerCard />
    </div>
  );
}

function CalendarCard() {
  const toast = useToast();
  const feeds = useFetch<{ enabled: boolean; feeds: AdminFeed[] }>('/api/admin/calendar-feeds');
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState<AdminFeed | null>(null);

  const setEnabled = async (on: boolean) => {
    setSaving(true);
    try {
      await withReauth(() => api.put('/api/admin/feeds/settings', { calendarEnabled: on }));
      toast.success(on ? 'Calendar feeds switched on.' : 'Calendar feeds switched off. Every feed address now answers "not found".');
      feeds.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    try {
      await adminApi.del(`/api/admin/calendar-feeds/${revoking.id}`);
      toast.success('Feed revoked.');
      feeds.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Card title="Calendar feeds">
      {feeds.error ? <ErrorState title="Calendar feeds could not be loaded" error={feeds.error} onRetry={feeds.reload} />
        : !feeds.data ? <Loading label="Loading calendar feeds" lines={2} /> : (
          <div className="feeds-page">
            <Switch
              label="People may make calendar feeds" checked={feeds.data.enabled} disabled={saving} onChange={(on) => void setEnabled(on)}
              hint="A feed is a secret address a calendar program reads without signing in. It shows only what its person may see. Switched off, every address stops answering until it is switched on again."
            />
            {feeds.data.feeds.length === 0 ? (
              <EmptyState icon="calendar" title="Nobody has a calendar feed" message="People make their own under Calendar feeds, in the menu under their name." />
            ) : (
              <div className="feeds-table-wrap">
                <table className="feeds-table">
                  <thead><tr><th scope="col">Person</th><th scope="col">Feed</th><th scope="col">Shows</th><th scope="col">Last read</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {feeds.data.feeds.map((f) => (
                      <tr key={f.id}>
                        <td>{f.user_name}{!f.user_active && <> <StatusChip color="gray" label="Account disabled" /></>}</td>
                        <td>{f.name}<br /><span className="muted">Made {formatDate(f.created_at)}</span></td>
                        <td>{f.detail === 'titles' ? 'Titles' : 'Busy only'}</td>
                        <td>{f.last_used_at ? relativeTime(f.last_used_at) : 'Not read yet'}</td>
                        <td><Button size="sm" variant="danger" onClick={() => setRevoking(f)}>Revoke</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      <ConfirmDialog
        open={revoking !== null} danger title="Revoke this feed?" confirmLabel="Revoke feed"
        message={`"${revoking?.name}" of ${revoking?.user_name} stops working at once. They can make a new one while feeds are on.`}
        onConfirm={() => void revoke()} onCancel={() => setRevoking(null)}
      />
    </Card>
  );
}

function TrackerCard() {
  const toast = useToast();
  const list = useFetch<Connectors>('/api/admin/tracker-connectors');
  const [editing, setEditing] = useState<Connector | 'new' | null>(null);
  const [secrets, setSecrets] = useState<Secrets | null>(null);
  const [renewing, setRenewing] = useState<Connector | null>(null);
  const [removing, setRemoving] = useState<Connector | null>(null);

  const renew = async () => {
    if (!renewing) return;
    try {
      setSecrets({ ...(await adminApi.post<Secrets>(`/api/admin/tracker-connectors/${renewing.id}/secrets`)), name: renewing.name });
      toast.success('New secrets made. Give them to the work tracker; the old ones have stopped working.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRenewing(null);
    }
  };

  const remove = async () => {
    if (!removing) return;
    try {
      await adminApi.del(`/api/admin/tracker-connectors/${removing.id}`);
      toast.success('Connection removed.');
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRemoving(null);
    }
  };

  const data = list.data;
  const labelOf = (t: string) => data?.kinds.find((k) => k.type === t)?.label;
  const kindsText = data ? joinLabels(data.kinds.map((k) => k.label)).toLowerCase() : '';
  return (
    <Card title="Work-tracker connections" actions={<Button icon="plus" onClick={() => setEditing('new')} disabled={!data?.kinds.length}>Add connection</Button>}>
      {list.error ? <ErrorState title="Work-tracker connections could not be loaded" error={list.error} onRetry={list.reload} />
        : !data ? <Loading label="Loading work-tracker connections" lines={2} /> : (
          <div className="feeds-page">
            <p className="muted">
              Records ({kindsText}) can be sent to an outside work-tracking tool as signed JSON, and the tool can send their status back.
              Sending needs outbound connections switched on and the tool's host on the allowed hosts (Administration &gt; Settings).
            </p>
            {!data.outboundEnabled && <p><StatusChip color="amber" label="Outbound connections are switched off: nothing is sent" /></p>}
            {secrets && (
              <div className="feeds-secrets">
                <CopyBox prominent label={`Signing secret of ${secrets.name ?? 'the connection'} (what is sent is signed with it)`} copyLabel="Copy secret" value={secrets.secret} testId="tracker-secret" />
                <CopyBox prominent label="Secret for status updates sent back" copyLabel="Copy secret" value={secrets.inboundSecret} testId="tracker-inbound-secret" />
                <CopyBox label="Address the tool sends status updates to" value={secrets.inboundAddress} />
                <p className="muted">Copy the secrets now: they are shown only this once.</p>
                <div className="form-actions"><Button onClick={() => setSecrets(null)}>Done</Button></div>
              </div>
            )}
            {data.connectors.length === 0 ? (
              <EmptyState icon="link" title="No work-tracker connections" message={`Add one to send ${kindsText} to an outside work-tracking tool.`} />
            ) : (
              <ul className="feeds-list" aria-label="Work-tracker connections">
                {data.connectors.map((c) => (
                  <li key={c.id} className="feeds-item">
                    <div className="feeds-main">
                      <strong>{c.name}</strong>
                      <span className="feeds-kinds">{[c.url_host, joinLabels(c.record_types.flatMap((t) => labelOf(t) ?? []))].filter(Boolean).join(' · ')}</span>
                      <span className="muted">
                        {c.links} sent{c.failing ? `, ${c.failing} waiting after a failure` : ''} · {c.last_inbound_at ? `last status update ${relativeTime(c.last_inbound_at)}` : 'no status update yet'}
                        {c.push_on_create ? ' · sends new records by itself' : ''}{c.include_restricted ? ' · includes restricted records' : ''}
                      </span>
                    </div>
                    <Badge color={c.active ? 'green' : 'gray'}>{c.active ? 'On' : 'Off'}</Badge>
                    <div className="feeds-actions">
                      <Button size="sm" onClick={() => setEditing(c)}>Edit</Button>
                      <Button size="sm" onClick={() => setRenewing(c)}>New secrets</Button>
                      <Button size="sm" variant="danger" onClick={() => setRemoving(c)}>Remove</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      {editing && (
        <ConnectorDialog
          connector={editing === 'new' ? null : editing} kinds={data?.kinds ?? []} onClose={() => setEditing(null)}
          onSaved={(made) => { setEditing(null); if (made) setSecrets(made); list.reload(); }}
        />
      )}
      <ConfirmDialog
        open={renewing !== null} title="Make new secrets?" confirmLabel="Make new secrets"
        message={`The secrets of "${renewing?.name}" stop working at once. Give the new ones to the work tracker.`}
        onConfirm={() => void renew()} onCancel={() => setRenewing(null)}
      />
      <ConfirmDialog
        open={removing !== null} danger title="Remove this connection?" confirmLabel="Remove connection"
        message={`Nothing more is sent through "${removing?.name}" and its status updates are refused. The items already made stay listed on their records.`}
        onConfirm={() => void remove()} onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}

function ConnectorDialog({ connector, kinds, onClose, onSaved }: { connector: Connector | null; kinds: Kind[]; onClose: () => void; onSaved: (made: Secrets | null) => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const shown = (t: string) => kinds.some((k) => k.type === t);
  // Kinds of a switched-off area that the connection holds: not shown, and sent back unchanged.
  const hiddenTypes = (connector?.record_types ?? []).filter((t) => !shown(t));
  const hiddenMap = Object.fromEntries(Object.entries(connector?.status_map ?? {}).filter(([t]) => !shown(t)));
  const shownMap = Object.fromEntries(Object.entries(connector?.status_map ?? {}).filter(([t]) => shown(t)));
  const first = kinds[0]?.type ?? 'action';
  const start = {
    name: connector?.name ?? '', url: '', types: connector ? connector.record_types.filter(shown) : [first], active: connector?.active ?? false,
    push: connector?.push_on_create ?? false, restricted: connector?.include_restricted ?? false,
    map: connector ? JSON.stringify(shownMap, null, 2) : `{\n  "${first}": { "Resolved": "done", "In progress": "in_progress" }\n}`,
  };
  const [name, setName] = useState(start.name);
  const [url, setUrl] = useState(start.url);
  const [types, setTypes] = useState<string[]>(start.types);
  const [active, setActive] = useState(start.active);
  const [push, setPush] = useState(start.push);
  const [restricted, setRestricted] = useState(start.restricted);
  const [map, setMap] = useState(start.map);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = name !== start.name || url !== start.url || types.join() !== start.types.join() || active !== start.active
    || push !== start.push || restricted !== start.restricted || map !== start.map;
  const toggle = (t: string, on: boolean) => setTypes((c) => (on ? [...c, t] : c.filter((x) => x !== t)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let statusMap: unknown;
    try { statusMap = map.trim() ? JSON.parse(map) : {}; } catch { setErrors({ status_map: 'This is not valid JSON.' }); return; }
    if (statusMap && typeof statusMap === 'object' && !Array.isArray(statusMap)) statusMap = { ...hiddenMap, ...(statusMap as object) };
    setSaving(true);
    setErrors({});
    try {
      const body = {
        name, record_types: [...types, ...hiddenTypes], active, push_on_create: push, include_restricted: restricted, status_map: statusMap,
        ...(url.trim() || !connector ? { url } : {}),
      };
      if (connector) {
        await adminApi.patch(`/api/admin/tracker-connectors/${connector.id}`, body);
        toast.success('Connection saved.');
        onSaved(null);
      } else {
        const made = await adminApi.post<Secrets & { name: string }>('/api/admin/tracker-connectors', body);
        toast.success('Connection added.');
        onSaved(made);
      }
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open size="lg" title={connector ? `Edit "${connector.name}"` : 'Add a work-tracker connection'} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit}>
        <TextField label="Name" required maxLength={100} value={name} onChange={setName} error={errors.name} />
        <TextField
          label="Address" required={!connector} type="url" value={url} onChange={setUrl} error={errors.url}
          placeholder="https://" hint={connector ? `Now ${connector.url_host}. Leave empty to keep it.` : 'Where the work tracker receives new items. Its host must be on the allowed hosts.'}
        />
        <fieldset className="feeds-kinds-field">
          <legend className="field-label">Sends</legend>
          {kinds.map((k) => (
            <Checkbox key={k.type} label={k.label} checked={types.includes(k.type)} onChange={(on) => toggle(k.type, on)} />
          ))}
          {errors.record_types && <p className="field-error" role="alert">{errors.record_types}</p>}
        </fieldset>
        <Switch label="On" checked={active} onChange={setActive} hint="Off: nothing is sent and status updates are refused." />
        <Switch label="Send new records by themselves" checked={push} onChange={setPush} hint="Every new record of the kinds above is sent when it is created." />
        <Switch
          label="Include restricted records" checked={restricted} onChange={setRestricted} error={errors.include_restricted}
          disabled={!can('security.view') && !restricted}
          hint="Off: a restricted record is never sent. Only someone who may see restricted records can switch this on."
        />
        <TextArea
          label="Status map" rows={5} value={map} onChange={setMap} error={errors.status_map}
          hint='Which of our statuses each outside status moves a record to, per kind: { "action": { "Resolved": "done" } }. An outside status not listed is only shown.'
        />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>{connector ? 'Save changes' : 'Add connection'}</Button>
        </div>
      </form>
    </Modal>
  );
}
