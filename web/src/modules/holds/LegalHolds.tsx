// Legal holds (Administration > Legal holds): the list, and one hold with the records it covers, its
// saved queries and its release. Holds are always on: they never lapse when a part is switched off.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDate, formatDateTime, Loading, Modal, PageHeader,
  RecordPage, RecordPicker, ResourceList, Select, StatusChip, TableWrap, TextArea, TextField, useAuth, useFetch, useMeta, useToast,
} from '../../core';
import type { Row } from '../../core';
import './holds.css';

const CREATE = ['matter', 'description', 'custodian_id', 'counsel_name', 'starts_on', 'ends_on'];

export function HoldList() {
  return (
    <div className="stack">
      <PageHeader title="Legal holds" subtitle="Records kept for a matter: while a hold is active nothing under it can be deleted, anonymized or lose its files." />
      <ResourceList
        type="legal_hold"
        urlState
        columns={['ref', 'matter', 'status', 'custodian_id', 'starts_on', 'ends_on', 'released_on']}
        filters={['status', 'custodian_id', 'starts_on']}
        createFields={CREATE}
        bulkFields={[]}
      />
    </div>
  );
}

interface HeldRecord {
  id: string; record_type: string; typeLabel: string; record_id: string; label: string; ref: string | null; route: string | null;
  deleted: boolean; via: 'hand' | 'query'; added_at: string; added_by_name: string | null; released_at: string | null;
}
interface HeldPage { rows: HeldRecord[]; total: number; hidden: number; released: number }

/** Record types the reader may see, for the pickers (legal holds themselves are left out). */
function useTypes() {
  const meta = useMeta();
  return Object.values(meta.resources).filter((r) => r.type !== 'legal_hold')
    .sort((a, b) => a.plural.localeCompare(b.plural)).map((r) => ({ value: r.type, label: r.plural }));
}

function AddRecordDialog({ holdId, onClose, onAdded }: { holdId: string; onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const types = useTypes();
  const [type, setType] = useState('');
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!type || !id) return;
    setBusy(true);
    try {
      await api.post(`/api/legal-holds/${holdId}/records`, { records: [{ type, id }] });
      toast.success('Record placed under the hold.');
      onAdded();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Place a record under the hold" onClose={onClose} dirty={Boolean(type || id)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!type || !id} onClick={add}>Place under hold</Button></>}>
      <div className="form-grid">
        <Select label="Kind of record" required searchable value={type} onChange={(v) => { setType(v); setId(null); }} options={types} />
        {type && <RecordPicker key={type} label="Record" required type={type} value={id} onChange={(v) => setId(v)} />}
      </div>
      <p className="muted">Only records you can see can be chosen here. To cover every record that matches a search, including restricted ones, save a query instead.</p>
    </Modal>
  );
}

function Records({ hold }: { hold: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<HeldPage>(`/api/legal-holds/${hold.id}/records`);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<HeldRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const active = hold.status === 'active';
  const canEdit = can('legal.edit') && active;
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/legal-holds/${hold.id}/records?record_type=${encodeURIComponent(removing.record_type)}&record_id=${removing.record_id}`);
      toast.success('Record taken off the hold.');
      setRemoving(null);
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const current = data?.rows.filter((r) => !r.released_at) ?? [];
  const off = data?.rows.filter((r) => r.released_at) ?? [];
  return (
    <div className="stack">
      <Card title="Records under this hold" flush actions={canEdit && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add a record</Button>}>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="lh-pad"><Loading lines={3} /></div>
          : (
            <>
              <p className="lh-pad muted">
                {data.total} record{data.total === 1 ? '' : 's'} held{data.hidden ? `, of which ${data.hidden} you cannot see (restricted, or in a part switched off)` : ''}.
              </p>
              {current.length === 0 ? <EmptyState icon="lock" title="No records you can see" message="Add records by hand, or save a query on the Queries tab." /> : (
                <TableWrap label="Records under this hold">
                  <table className="table">
                    <caption className="sr-only">Records under this hold</caption>
                    <thead><tr><th scope="col">Record</th><th scope="col">Added</th><th scope="col">How</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {current.map((r) => (
                        <tr key={r.id}>
                          <td className="lh-wrap">
                            {r.route ? <Link to={r.route}><span className="muted">{r.typeLabel}</span> {r.ref && <span className="ref">{r.ref}</span>} {r.label}</Link>
                              : <span><span className="muted">{r.typeLabel}</span> {r.ref && <span className="ref">{r.ref}</span>} {r.label}</span>}
                            {r.deleted && <> <StatusChip size="sm" color="gray" label="Deleted from lists, kept" /></>}
                          </td>
                          <td>{formatDate(r.added_at)}<div className="muted">{r.added_by_name ?? ''}</div></td>
                          <td>{r.via === 'query' ? 'Saved query' : 'By hand'}</td>
                          <td className="lh-actions">{canEdit && <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>Take off</Button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </>
          )}
      </Card>
      {off.length > 0 && (
        <Card title={`Taken off the hold (${off.length})`} flush>
          <ul className="lh-list">
            {off.map((r) => <li key={r.id}><span className="muted">{r.typeLabel}</span> {r.ref && <span className="ref">{r.ref}</span>} {r.label} <span className="muted">· {formatDateTime(r.released_at)}</span></li>)}
          </ul>
        </Card>
      )}
      {adding && <AddRecordDialog holdId={hold.id} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); reload(); }} />}
      <ConfirmDialog open={!!removing} title="Take this record off the hold?" busy={busy} confirmLabel="Take off" onConfirm={remove} onCancel={() => setRemoving(null)}
        message={`${removing?.label ?? 'The record'} will follow its retention period again. The hold's history keeps it, and a saved query will not put it back.`} />
    </div>
  );
}

interface Query { id: string; record_type?: string; typeLabel: string; q?: string | null; filters?: Record<string, string>; last_run_at: string | null; matched: number; created_by_name?: string | null; hidden: boolean }
const OPS = [
  { value: '', label: 'is' }, { value: 'null', label: 'is empty (true or false)' },
  { value: 'gte', label: 'on or after / at least' }, { value: 'lte', label: 'on or before / at most' },
];

function QueryDialog({ holdId, onClose, onSaved }: { holdId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const meta = useMeta();
  const types = useTypes();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<{ field: string; op: string; value: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fields = type ? Object.entries(meta.resources[type]?.fields ?? {})
    .filter(([, f]) => !f.custom && !f.multiple && ['lookup', 'date', 'datetime', 'number', 'currency', 'boolean', 'text', 'user'].includes(f.type))
    .map(([name, f]) => ({ value: name, label: f.label })) : [];
  const save = async () => {
    setBusy(true); setErrors({});
    const body = { record_type: type, q: q.trim() || undefined, filters: Object.fromEntries(filters.filter((f) => f.field && f.value).map((f) => [`f.${f.field}${f.op ? `.${f.op}` : ''}`, f.value])) };
    try {
      const res = await api.post<{ matched: number; added: number }>(`/api/legal-holds/${holdId}/queries`, body);
      toast.success(`Query saved: ${res.matched} record${res.matched === 1 ? '' : 's'} match, ${res.added} added to the hold.`);
      onSaved();
    } catch (err) {
      setErrors((err as { fields?: Record<string, string> }).fields ?? {});
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open size="lg" title="Save a query" onClose={onClose} dirty={Boolean(type || q || filters.length)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!type} onClick={save}>Save and run</Button></>}>
      <div className="stack">
        <p className="muted">Every record of the kind that matches is held, restricted records included, and the query runs again every night to add new matches. It never takes records off.</p>
        <div className="form-grid">
          <Select label="Kind of record" required searchable value={type} error={errors.record_type} onChange={(v) => { setType(v); setFilters([]); }} options={types} />
          <TextField label="Search words" value={q} error={errors.q} hint="Matched in the title, reference and searchable text." onChange={setQ} />
        </div>
        {filters.map((f, i) => (
          <div key={i} className="form-grid lh-filter">
            <Select label="Field" value={f.field} options={fields} onChange={(v) => setFilters((all) => all.map((x, n) => (n === i ? { ...x, field: v } : x)))} />
            <Select label="Condition" value={f.op} options={OPS} onChange={(v) => setFilters((all) => all.map((x, n) => (n === i ? { ...x, op: v } : x)))} />
            <TextField label="Value" value={f.value} hint="A list value, a date (YYYY-MM-DD) or a number; several values separated by commas." onChange={(v) => setFilters((all) => all.map((x, n) => (n === i ? { ...x, value: v } : x)))} />
            <div><Button size="sm" variant="ghost" onClick={() => setFilters((all) => all.filter((_, n) => n !== i))}>Remove condition</Button></div>
          </div>
        ))}
        {errors.filters && <p className="notice notice-warn">{errors.filters}</p>}
        {type && <div><Button size="sm" icon="plus" onClick={() => setFilters((all) => [...all, { field: '', op: '', value: '' }])}>Add a condition</Button></div>}
      </div>
    </Modal>
  );
}

function Queries({ hold }: { hold: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Query[]>(`/api/legal-holds/${hold.id}/queries`);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Query | null>(null);
  const [busy, setBusy] = useState('');
  const canEdit = can('legal.edit') && hold.status === 'active';
  const run = async (query: Query) => {
    setBusy(query.id);
    try {
      const res = await api.post<{ matched: number; added: number }>(`/api/legal-holds/${hold.id}/queries/${query.id}/run`);
      toast.success(`${res.matched} match, ${res.added} added.`);
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(''); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(removing.id);
    try { await api.del(`/api/legal-holds/${hold.id}/queries/${removing.id}`); toast.success('Query removed; its records stay held.'); setRemoving(null); reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(''); }
  };
  return (
    <Card title="Saved queries" flush actions={canEdit && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Save a query</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="lh-pad"><Loading lines={3} /></div>
        : data.length === 0 ? <EmptyState icon="search" title="No saved queries" message="A query holds every record of a kind that matches a search and conditions, now and as new ones appear." />
        : (
          <TableWrap label="Saved queries">
            <table className="table">
              <caption className="sr-only">Saved queries</caption>
              <thead><tr><th scope="col">Records</th><th scope="col">Matches</th><th scope="col">Last run</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((query) => (
                  <tr key={query.id}>
                    <td className="lh-wrap">
                      {query.hidden ? <span className="muted">A query on records you cannot see</span> : (
                        <>
                          <strong>{query.typeLabel}</strong>
                          {query.q && <> matching “{query.q}”</>}
                          {Object.entries(query.filters ?? {}).map(([k, v]) => <div key={k} className="muted">{k.replace(/^f\./, '')}: {v}</div>)}
                        </>
                      )}
                    </td>
                    <td>{query.matched}</td>
                    <td>{query.last_run_at ? formatDateTime(query.last_run_at) : <span className="muted">Not yet</span>}</td>
                    <td className="lh-actions">
                      {canEdit && !query.hidden && <Button size="sm" variant="ghost" loading={busy === query.id} onClick={() => run(query)}>Run now</Button>}
                      {canEdit && !query.hidden && <Button size="sm" variant="ghost" onClick={() => setRemoving(query)}>Remove</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      {adding && <QueryDialog holdId={hold.id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      <ConfirmDialog open={!!removing} title="Remove this query?" busy={busy === removing?.id} confirmLabel="Remove" onConfirm={remove} onCancel={() => setRemoving(null)}
        message="The records it added stay under the hold; it stops adding new ones." />
    </Card>
  );
}

interface Release {
  status: string; released_on: string | null; released_by_name: string | null; release_reason: string | null; workflow_available: boolean;
  request: { id: string; workflow: string; status: string; started_at: string; finished_at: string | null; reason: string | null } | null;
}

function ReleaseTab({ hold, onChanged }: { hold: Row; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Release>(`/api/legal-holds/${hold.id}/release`);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  const waiting = data.request?.status === 'running';
  const submit = async () => {
    setBusy(true); setFieldError('');
    try {
      const res = await api.post<{ status: string }>(`/api/legal-holds/${hold.id}/release`, { reason });
      toast.success(res.status === 'released' ? 'The hold is released.' : 'Release asked for: it waits for approval.');
      setOpen(false); setReason(''); reload(); onChanged();
    } catch (err) {
      setFieldError((err as { fields?: Record<string, string> }).fields?.reason ?? '');
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Card title="Release">
      {data.status === 'released' ? (
        <p className="notice notice-success">Released on {formatDate(data.released_on)} by {data.released_by_name ?? 'an approver'}: {data.release_reason}</p>
      ) : (
        <div className="stack">
          <p>While the hold is active, nothing under it can be deleted, anonymized, removed for good or lose its files, whatever is switched off. Releasing it lets its records follow their retention periods again.</p>
          {waiting && <p className="notice">Release asked for on {formatDateTime(data.request!.started_at)} ({data.request!.workflow}); it waits for approval.</p>}
          {data.request && data.request.status === 'rejected' && <p className="notice notice-warn-soft">The last request to release it was rejected.</p>}
          {!data.workflow_available && <p className="muted">No release workflow is set up, so someone who may approve legal holds releases it directly.</p>}
          {can('legal.edit') && !waiting && <div><Button variant="danger" onClick={() => setOpen(true)}>Release the hold…</Button></div>}
        </div>
      )}
      {open && (
        <Modal open title="Release the hold" onClose={() => setOpen(false)} dirty={Boolean(reason)}
          footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>{data.workflow_available ? 'Ask for release' : 'Release'}</Button></>}>
          <TextArea label="Why can it be released?" required value={reason} error={fieldError} onChange={setReason} hint="For example: the claim is settled and counsel confirmed the records can follow their retention periods." />
        </Modal>
      )}
    </Card>
  );
}

export function HoldDetail() {
  return (
    <RecordPage
      type="legal_hold"
      summaryFields={['matter', 'description', 'custodian_id', 'counsel_name', 'starts_on', 'ends_on', 'released_on', 'released_by_name', 'release_reason']}
      tabs={[
        { key: 'records', label: 'Records', content: ({ row }) => <Records hold={row} /> },
        { key: 'queries', label: 'Queries', content: ({ row }) => <Queries hold={row} /> },
        { key: 'release', label: 'Release', content: ({ row, reload }) => <ReleaseTab hold={row} onChanged={reload} /> },
      ]}
    />
  );
}
