// Records requests: the list with the clocks, the settings, and one request with its clock, its
// responsive records (with an exemption each) and its response.
import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, DateField, EditableSummary, EmptyState, errorMessage, ErrorState, formatDate, KeyValue, Loading,
  LookupChip, LookupSelect, Modal, NumberField, PageHeader, RecordPage, RecordPicker, ResourceList, Select, StatusChip, Switch, TextArea,
  TextField, useAuth, useFetch, useLookup, useMeta, useToast,
} from '../../core';
import type { Row } from '../../core';
import { RecordsTabs } from './shared';
import './records.css';

const CREATE = ['subject', 'kind', 'received_on', 'requester_name', 'requester_contact', 'requester_address', 'identity_verified', 'description', 'owner_id'];

export interface Clock {
  request_id: string; ref: string; subject: string; kind: string; status: string; received_on: string | null; due_on: string | null;
  extended: boolean; state: 'green' | 'amber' | 'red' | 'met' | 'not_required'; late?: boolean; days_left: number | null; amber_on: string | null;
}

const STATE: Record<string, { color: 'green' | 'amber' | 'red' | 'gray'; label: string }> = {
  green: { color: 'green', label: 'On time' }, amber: { color: 'amber', label: 'Due soon' }, red: { color: 'red', label: 'Overdue' },
  met: { color: 'gray', label: 'Answered' }, not_required: { color: 'gray', label: 'Stopped' },
};

export function ClockChip({ clock }: { clock: Pick<Clock, 'state' | 'days_left' | 'late'> }) {
  const s = STATE[clock.state] ?? STATE.green;
  const days = clock.days_left;
  const label = clock.state === 'met' ? (clock.late ? 'Answered late' : 'Answered on time')
    : days === null ? s.label : days < 0 ? `${s.label}: ${-days} day${days === -1 ? '' : 's'}` : `${s.label}: ${days} day${days === 1 ? '' : 's'} left`;
  return <StatusChip size="sm" color={clock.state === 'met' && clock.late ? 'amber' : s.color} label={label} />;
}

interface Settings { dueDays: Record<string, number>; businessDays: boolean; amberFraction: number; reviewReminderDays: number }

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const kinds = useLookup('records_request_kind');
  const { data, error, reload } = useFetch<Settings>('/api/records/settings');
  const [form, setForm] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const current = form ?? data;
  const set = (patch: Partial<Settings>) => setForm({ ...(current as Settings), ...patch });
  const save = async () => {
    if (!current) return;
    setBusy(true); setErrors({});
    try { await api.put('/api/records/settings', current); toast.success('Settings saved. New requests use them; existing due dates stay.'); onClose(); }
    catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const days = (k: string) => current?.dueDays[k];
  return (
    <Modal open size="lg" title="Request deadlines and clocks" onClose={onClose} dirty={form !== null}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!current} onClick={save}>Save</Button></>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !current ? <Loading lines={4} /> : (
        <div className="stack">
          <p className="muted">Set your own deadlines: no jurisdiction's deadline is built in. Every kind left empty uses the default.</p>
          <div className="form-grid">
            <NumberField label="Default days to answer" required min={1} max={365} value={days('*') ?? 20} error={errors.dueDays}
              onChange={(v) => set({ dueDays: { ...current.dueDays, '*': Number(v) || 20 } })} />
            {kinds.map((k) => (
              <NumberField key={k.value} label={`${k.label}: days`} min={1} max={365} value={days(k.value) ?? null} placeholder="Default"
                onChange={(v) => {
                  const next = { ...current.dueDays };
                  if (v === null || v === undefined || String(v) === '') delete next[k.value]; else next[k.value] = Number(v);
                  set({ dueDays: next });
                }} />
            ))}
          </div>
          <Switch label="Count working days only (Monday to Friday; holidays are not known)" checked={current.businessDays} onChange={(v) => set({ businessDays: v })} />
          <div className="form-grid">
            <NumberField label="Due soon when this share of the time is left" min={0.01} max={0.99} step={0.05} value={current.amberFraction} error={errors.amberFraction}
              onChange={(v) => set({ amberFraction: Number(v) })} hint="0.25 means the last quarter of the time to answer." />
            <NumberField label="Remind of privacy reviews (days before)" min={0} max={365} value={current.reviewReminderDays} error={errors.reviewReminderDays}
              onChange={(v) => set({ reviewReminderDays: Number(v) })} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function ClockSummary() {
  const { data } = useFetch<{ requests: { open: number; due_soon: number; overdue: number } }>('/api/records/summary');
  if (!data) return null;
  const r = data.requests;
  return (
    <p className="muted rr-figures">
      {r.open} open · <span className={r.due_soon ? 'rr-amber' : ''}>{r.due_soon} due soon</span> · <span className={r.overdue ? 'rr-red' : ''}>{r.overdue} overdue</span>
    </p>
  );
}

export function RequestList() {
  const { can } = useAuth();
  const [settings, setSettings] = useState(false);
  return (
    <div className="stack">
      <PageHeader title="Records requests" subtitle="Requests for records and for people's own personal data, each with its deadline."
        actions={can('records.administer') && <Button icon="settings" onClick={() => setSettings(true)}>Deadlines</Button>} />
      <RecordsTabs active="requests" />
      <ClockSummary />
      <ResourceList
        type="records_request"
        urlState
        columns={['ref', 'subject', 'kind', 'status', 'received_on', 'due_on', 'extended_due_on', 'owner_id']}
        filters={['kind', 'status', 'owner_id', 'received_on', 'due_on']}
        createFields={CREATE}
      />
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </div>
  );
}

function ClockTab({ request, onChanged }: { request: Row; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Clock & { extension_reason: string | null; original_due_on: string | null }>(`/api/records-requests/${request.id}/clock`);
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  const extend = async () => {
    setBusy(true); setErrors({});
    try {
      await api.post(`/api/records-requests/${request.id}/extend`, { until, reason });
      toast.success('Deadline extended.');
      setOpen(false); setUntil(''); setReason(''); reload(); onChanged();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const stopped = data.state === 'met' || data.state === 'not_required';
  return (
    <Card title="Clock" actions={can('records.edit') && !stopped && <Button size="sm" onClick={() => setOpen(true)}>Extend…</Button>}>
      <div className="stack">
        <div><ClockChip clock={data} /></div>
        <KeyValue items={[
          { label: 'Received', value: formatDate(data.received_on) },
          { label: data.extended ? 'Due (extended)' : 'Due', value: formatDate(data.due_on) },
          ...(data.extended ? [{ label: 'First due', value: formatDate(data.original_due_on) }, { label: 'Reason for extension', value: data.extension_reason ?? '' }] : []),
          ...(!stopped && data.amber_on ? [{ label: 'Due soon from', value: formatDate(data.amber_on) }] : []),
        ]} />
        <p className="muted">The deadline is counted from the day received by the days set for this kind of request (Records requests, Deadlines).</p>
      </div>
      {open && (
        <Modal open title="Extend the deadline" onClose={() => setOpen(false)} dirty={Boolean(until || reason)}
          footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={extend}>Extend</Button></>}>
          <div className="form-grid">
            <DateField label="New due date" required value={until} error={errors.until} onChange={setUntil} />
            <TextArea label="Reason" required value={reason} error={errors.reason} onChange={setReason} hint="Recorded in the request's history." />
          </div>
        </Modal>
      )}
    </Card>
  );
}

interface Item { id: string; record_type: string; typeLabel: string; record_id: string; label: string; ref: string | null; route: string; exemption: string | null; disclosed: string | null; note: string | null }

function ItemDialog({ request, item, onClose, onSaved }: { request: Row; item: Item | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const meta = useMeta();
  const types = Object.values(meta.resources).filter((r) => !['records_request', 'legal_hold'].includes(r.type))
    .sort((a, b) => a.plural.localeCompare(b.plural)).map((r) => ({ value: r.type, label: r.plural }));
  const [form, setForm] = useState({ record_type: item?.record_type ?? '', record_id: item?.record_id ?? null as string | null, exemption: item?.exemption ?? '', disclosed: item?.disclosed ?? '', note: item?.note ?? '' });
  const [start] = useState(form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErrors({});
    const body = { exemption: form.exemption || null, disclosed: form.disclosed || null, note: form.note };
    try {
      if (item) await api.patch(`/api/records-requests/${request.id}/items/${item.id}`, body);
      else await api.post(`/api/records-requests/${request.id}/items`, { ...body, record_type: form.record_type, record_id: form.record_id });
      toast.success(item ? 'Responsive record updated.' : 'Responsive record added.');
      onSaved();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title={item ? 'Change a responsive record' : 'Add a responsive record'} onClose={onClose} dirty={JSON.stringify(form) !== JSON.stringify(start)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!item && !form.record_id} onClick={save}>{item ? 'Save' : 'Add'}</Button></>}>
      <div className="form-grid">
        {!item && <Select label="Kind of record" required searchable value={form.record_type} options={types} onChange={(v) => setForm((f) => ({ ...f, record_type: v, record_id: null }))} />}
        {!item && form.record_type && <RecordPicker key={form.record_type} label="Record" required type={form.record_type} value={form.record_id} error={errors.record_id} onChange={(v) => setForm((f) => ({ ...f, record_id: v }))} />}
        <LookupSelect label="Disclosed" list="records_disclosure" value={form.disclosed} error={errors.disclosed} onChange={(v) => setForm((f) => ({ ...f, disclosed: v }))} />
        <LookupSelect label="Exemption" list="records_exemption" value={form.exemption} error={errors.exemption} onChange={(v) => setForm((f) => ({ ...f, exemption: v }))}
          hint="Your own list (Administration > Lists): no jurisdiction's exemptions are built in." />
        <TextArea label="Note" value={form.note} onChange={(v) => setForm((f) => ({ ...f, note: v }))} />
      </div>
    </Modal>
  );
}

function PreserveDialog({ request, onClose, onDone }: { request: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [holdId, setHoldId] = useState<string | null>(null);
  const [matter, setMatter] = useState(`Preservation for records request ${request.ref}`);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ref: string; added: number }>(`/api/records-requests/${request.id}/preserve`, holdId ? { hold_id: holdId } : { matter });
      toast.success(`${res.added} record${res.added === 1 ? '' : 's'} placed under legal hold ${res.ref}.`);
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Preserve the responsive records" onClose={onClose} dirty={holdId !== null}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Preserve</Button></>}>
      <div className="stack">
        <p className="muted">The responsive records you can see are placed under a legal hold: nothing under it can be deleted, anonymized or lose its files until the hold is released.</p>
        <RecordPicker label="An existing hold" type="legal_hold" value={holdId} onChange={setHoldId} hint="Leave empty to open a new hold." />
        {!holdId && <TextField label="Matter for a new hold" required value={matter} onChange={setMatter} />}
      </div>
    </Modal>
  );
}

function ResponsiveTab({ request }: { request: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<{ rows: Item[]; total: number; hidden: number }>(`/api/records-requests/${request.id}/items`);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [removing, setRemoving] = useState<Item | null>(null);
  const [preserving, setPreserving] = useState(false);
  const [busy, setBusy] = useState(false);
  const canEdit = can('records.edit');
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try { await api.del(`/api/records-requests/${request.id}/items/${removing.id}`); toast.success('Responsive record removed.'); setRemoving(null); reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Responsive records" flush actions={(
      <span className="rr-actions">
        {canEdit && can('legal.edit') && (data?.rows.length ?? 0) > 0 && <Button size="sm" icon="lock" onClick={() => setPreserving(true)}>Preserve…</Button>}
        {canEdit && <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add a record</Button>}
      </span>
    )}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="rr-pad"><Loading lines={3} /></div>
        : data.rows.length === 0 ? <EmptyState icon="file-text" title="No responsive records yet" message="Add the records that answer the request, with how much of each was disclosed and any exemption." />
        : (
          <>
            {data.hidden > 0 && <p className="rr-pad muted">{data.total} records in all; {data.hidden} you cannot see.</p>}
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Responsive records</caption>
                <thead><tr><th scope="col">Record</th><th scope="col">Disclosed</th><th scope="col">Exemption</th><th scope="col">Note</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="rr-wrap"><Link to={r.route}><span className="muted">{r.typeLabel}</span> {r.ref && <span className="ref">{r.ref}</span>} {r.label}</Link></td>
                      <td>{r.disclosed ? <LookupChip list="records_disclosure" value={r.disclosed} /> : <span className="muted">Not decided</span>}</td>
                      <td>{r.exemption ? <LookupChip list="records_exemption" value={r.exemption} /> : <span className="muted">None</span>}</td>
                      <td className="rr-wrap">{r.note ?? ''}</td>
                      <td className="rr-actions">
                        {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Change</Button>}
                        {canEdit && <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>Remove</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      {editing && <ItemDialog request={request} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {preserving && <PreserveDialog request={request} onClose={() => setPreserving(false)} onDone={() => setPreserving(false)} />}
      <ConfirmDialog open={!!removing} title="Remove this responsive record?" busy={busy} confirmLabel="Remove" onConfirm={remove} onCancel={() => setRemoving(null)}
        message={`${removing?.label ?? 'The record'} will no longer be listed as answering this request.`} />
    </Card>
  );
}

const FINAL = ['responded', 'closed', 'withdrawn', 'refused'];

function ResponseTab({ request, onChanged }: { request: Row; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('closed');
  const [summary, setSummary] = useState(String(request.response_summary ?? ''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = async () => {
    setBusy(true); setError('');
    try { await api.post(`/api/records-requests/${request.id}/close`, { status, response_summary: summary }); toast.success('Request closed.'); setOpen(false); onChanged(); }
    catch (err) { setError((err as { fields?: Record<string, string> }).fields?.response_summary ?? ''); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const closed = FINAL.includes(String(request.status));
  return (
    <div className="stack">
      <EditableSummary type="records_request" row={request} onSaved={onChanged} title="Response" fields={['responded_on', 'response_summary', 'fee', 'closed_on']} />
      {!closed && can('records.edit') && <div><Button variant="primary" onClick={() => setOpen(true)}>Close the request…</Button></div>}
      {open && (
        <Modal open title="Close the request" onClose={() => setOpen(false)} dirty={summary !== String(request.response_summary ?? '')}
          footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={close}>Close request</Button></>}>
          <div className="form-grid">
            <Select label="Outcome" required value={status} onChange={setStatus} options={[
              { value: 'closed', label: 'Closed' }, { value: 'responded', label: 'Responded' }, { value: 'withdrawn', label: 'Withdrawn' }, { value: 'refused', label: 'Refused' },
            ]} />
            <TextArea label="Response summary" required value={summary} error={error} onChange={setSummary} hint="What was released, withheld and why." />
          </div>
        </Modal>
      )}
    </div>
  );
}

// The action tracker lives in the risks module; its panel is loaded only when that module is in the build.
const actionLoaders = import.meta.glob<{ ActionsPanel: ComponentType<{ sourceType: string; sourceId: string; source?: string }> }>('../risks/ActionsPanel.tsx');
const loadActions = Object.values(actionLoaders)[0];
export const LazyActions = loadActions ? lazy(() => loadActions().then((m) => ({ default: m.ActionsPanel }))) : null;

export function RequestDetail() {
  const { can } = useAuth();
  return (
    <RecordPage
      type="records_request"
      summary={({ row, reload }) => (
        <div className="rr-summary">
          <EditableSummary type="records_request" row={row} onSaved={reload} title="Request"
            fields={['subject', 'kind', 'status', 'received_on', 'due_on', 'extended_due_on', 'owner_id', 'description']} />
          <EditableSummary type="records_request" row={row} onSaved={reload} title="Requester"
            fields={['requester_name', 'requester_contact', 'requester_address', 'identity_verified']} />
        </div>
      )}
      tabs={[
        { key: 'clock', label: 'Clock', content: ({ row, reload }) => <ClockTab request={row} onChanged={reload} /> },
        { key: 'responsive', label: 'Responsive records', content: ({ row }) => <ResponsiveTab request={row} /> },
        { key: 'response', label: 'Response', content: ({ row, reload }) => <ResponseTab request={row} onChanged={reload} /> },
        ...(LazyActions && can('actions.view') ? [{
          key: 'actions', label: 'Actions',
          content: ({ row }: { row: Row }) => <Suspense fallback={<Loading lines={3} />}><LazyActions sourceType="records_request" sourceId={row.id} source="records" /></Suspense>,
        }] : []),
      ]}
    />
  );
}
