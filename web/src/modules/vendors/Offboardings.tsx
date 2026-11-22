// Offboarding a vendor (E35-04): the list, and one offboarding with its checklist and sign-off.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api, ApiError, Button, Card, EmptyState, ErrorState, errorMessage, formatDate, Loading, Modal, ProgressBar, RecordPage,
  ResourceList, Select, StatusChip, TextArea, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { ColorName, RecordContext, Row } from '../../core';

interface Item {
  id: string;
  kind: string;
  item: string;
  status: 'to_do' | 'done' | 'not_applicable';
  done_by_name: string | null;
  done_on: string | null;
  evidence_note: string | null;
  record: { type: string; id: string | null; label: string; route: string | null } | null;
}

interface Checklist {
  items: Item[];
  counts: { total: number; done: number; not_applicable: number; to_do: number };
  approval: { workflow: boolean; running: { id: string; name: string } | null; last: { name: string; status: string; finished_at: string | null } | null };
  can_edit: boolean;
  can_sign_off: boolean;
}

const KIND_LABEL: Record<string, string> = {
  account_access: 'Accounts and access', remote_access: 'Remote access', data_return: 'Data returned or destroyed',
  data_destruction: 'Data destruction', asset_return: 'Assets returned', other: 'Other',
};
const KIND_ORDER = ['remote_access', 'account_access', 'data_return', 'data_destruction', 'asset_return', 'other'];
const STATUS: Record<Item['status'], { label: string; color: ColorName }> = {
  to_do: { label: 'To do', color: 'amber' }, done: { label: 'Done', color: 'green' }, not_applicable: { label: 'Not applicable', color: 'gray' },
};

export function OffboardingList() {
  return (
    <ResourceList
      type="vendor_offboarding"
      title="Vendor offboarding"
      urlState
      columns={['ref', 'vendor_id', 'contract_id', 'trigger', 'status', 'owner_id', 'due_on', { field: 'signed_off_on', hidden: true }]}
      filters={['status', 'trigger', 'vendor_id', 'owner_id', 'due_on']}
      bulkFields={['owner_id', 'due_on']}
      createFields={['vendor_id', 'contract_id', 'trigger', 'owner_id', 'due_on', 'notes']}
      createInitial={{ trigger: 'manual' }}
    />
  );
}

function ItemDialog({ offboardingId, item, onDone, onCancel }: { offboardingId: string; item: Item; onDone: (c: Checklist) => void; onCancel: () => void }) {
  const toast = useToast();
  const start: { status: string; evidence_note: string } = { status: item.status === 'to_do' ? 'done' : item.status, evidence_note: item.evidence_note ?? '' };
  const [v, setV] = useState(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = v.status !== start.status || v.evidence_note !== start.evidence_note;
  const unsaved = useUnsavedChanges(dirty);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (v.status === 'not_applicable' && !v.evidence_note.trim()) { setErrors({ evidence_note: 'Say why this item does not apply.' }); return; }
    setSaving(true);
    try {
      const res = await api.post<Checklist>(`/api/vendor-offboardings/${offboardingId}/items/${item.id}`, v);
      unsaved.release();
      toast.success('Checklist item saved.');
      onDone(res);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally { setSaving(false); }
  }
  return (
    <Modal open title="Update a checklist item" onClose={onCancel} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        <p><strong>{item.item}</strong></p>
        <Select
          label="Status" required value={v.status} error={errors.status}
          options={[{ value: 'to_do', label: 'To do' }, { value: 'done', label: 'Done' }, { value: 'not_applicable', label: 'Not applicable' }]}
          onChange={(status) => setV({ ...v, status })}
        />
        <TextArea
          label="Evidence or note" required={v.status === 'not_applicable'} rows={3} value={v.evidence_note} error={errors.evidence_note}
          hint="What was done and where the proof is (a ticket number, a certificate of destruction, a returned-equipment receipt)."
          onChange={(evidence_note) => setV({ ...v, evidence_note })}
        />
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={unsaved.guard(onCancel)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function ChecklistTab({ row, reload }: { row: Row; reload: () => void }) {
  const toast = useToast();
  const { data, error, reload: again } = useFetch<Checklist>(`/api/vendor-offboardings/${row.id}/items`);
  const [list, setList] = useState<Checklist | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const current = list ?? data;
  if (error) return <ErrorState error={error} onRetry={again} />;
  if (!current) return <Loading lines={6} label="Loading the checklist" />;

  const refresh = async () => {
    setBusy('refresh');
    try {
      const res = await api.post<Checklist & { added: number }>(`/api/vendor-offboardings/${row.id}/refresh-items`);
      setList(res);
      toast.success(res.added ? `${res.added} item${res.added === 1 ? '' : 's'} added.` : 'Nothing new to add.');
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  const signOff = async () => {
    setBusy('sign');
    try {
      const res = await api.post<Checklist & { workflow: string | null }>(`/api/vendor-offboardings/${row.id}/sign-off`);
      setList(res);
      toast.success(res.workflow ? `Sign-off asked for through "${res.workflow}".` : 'Offboarding signed off.');
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };

  const c = current.counts;
  const finished = c.done + c.not_applicable;
  const groups = KIND_ORDER.map((k) => ({ kind: k, items: current.items.filter((i) => i.kind === k) })).filter((g) => g.items.length);
  return (
    <div className="stack">
      <Card
        title="Progress"
        actions={current.can_edit ? <Button size="sm" variant="secondary" icon="refresh" loading={busy === 'refresh'} onClick={refresh}>Add new items from the inventory</Button> : undefined}
      >
        <ProgressBar value={finished} max={Math.max(1, c.total)} label="Checklist items finished" valueText={`${finished} of ${c.total} finished`} color={c.to_do ? 'amber' : 'green'} />
        <p className="muted">
          {c.done} done, {c.not_applicable} not applicable, {c.to_do} to do.
          {current.approval.workflow ? ' Sign-off goes through an approval workflow.' : ' Someone who may approve vendor records signs it off.'}
        </p>
        {current.approval.running && <p><StatusChip color="amber" label={`Waiting for approval: ${current.approval.running.name}`} /></p>}
        {current.approval.last?.status === 'rejected' && <p><StatusChip color="red" label="The last sign-off request was rejected (see History)" /></p>}
        {row.status === 'signed_off' && <p><StatusChip color="green" label={`Signed off ${formatDate(row.signed_off_on)} by ${row.signed_off_by_name ?? 'an approver'}`} /></p>}
        {current.can_sign_off && !current.approval.running && (
          <div className="row">
            <Button variant="primary" disabled={c.to_do > 0} loading={busy === 'sign'} onClick={signOff}>
              {current.approval.workflow ? 'Ask for sign-off' : 'Sign off'}
            </Button>
          </div>
        )}
        {current.can_sign_off && c.to_do > 0 && <p className="muted">Mark every item done or not applicable before signing off.</p>}
      </Card>
      {groups.length === 0 ? (
        <EmptyState icon="check-square" title="No checklist items" message="Nothing in the inventory is tied to this vendor or contract, and the item template is empty." />
      ) : groups.map((g) => (
        <Card key={g.kind} title={KIND_LABEL[g.kind] ?? g.kind} flush>
          <ul className="vnd-ob-items">
            {g.items.map((i) => (
              <li key={i.id} className="vnd-ob-item">
                <div className="vnd-ob-text">
                  <span>{i.item}</span>
                  {i.record?.route && <Link to={i.record.route} className="muted"> {i.record.label}</Link>}
                  {i.evidence_note && <span className="muted vnd-ob-note">{i.evidence_note}</span>}
                  {i.done_by_name && <span className="muted vnd-ob-note">{STATUS[i.status].label} by {i.done_by_name}{i.done_on ? `, ${formatDate(i.done_on)}` : ''}</span>}
                </div>
                <StatusChip color={STATUS[i.status].color} label={STATUS[i.status].label} />
                {current.can_edit && <Button size="sm" variant="ghost" onClick={() => setEditing(i)} aria-label={`Update: ${i.item}`}>Update</Button>}
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {editing && (
        <ItemDialog
          offboardingId={row.id} item={editing} onCancel={() => setEditing(null)}
          onDone={(res) => { setEditing(null); setList(res); if (row.status === 'open') reload(); }}
        />
      )}
    </div>
  );
}

export function OffboardingDetail() {
  return (
    <RecordPage
      type="vendor_offboarding"
      breadcrumbs={[{ label: 'Vendors', to: '/vendors' }, { label: 'Offboarding', to: '/vendors/offboardings' }]}
      title={(row) => `Offboarding ${row._display?.vendor_id ?? ''}`.trim()}
      subtitle={(row) => (
        <>
          {row.vendor_id && <>Vendor: <Link to={`/vendors/${row.vendor_id}?tab=lifecycle`}>{row._display?.vendor_id ?? 'Open vendor'}</Link></>}
          {row.contract_id && <> · Contract: <Link to={`/contracts/${row.contract_id}`}>{row._display?.contract_id ?? 'Open contract'}</Link></>}
        </>
      )}
      summaryFields={['vendor_id', 'contract_id', 'trigger', 'status', 'owner_id', 'due_on', 'signed_off_on', 'signed_off_by_name', 'notes']}
      tabs={[{ key: 'checklist', label: 'Checklist', content: ({ row, reload }: RecordContext) => <ChecklistTab row={row} reload={reload} /> }]}
    />
  );
}

/** "Start offboarding" on a contract page (E35-04): opens the existing one, or starts one by hand. */
export function StartOffboarding({ contract }: { contract: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const existing = useFetch<{ rows: Row[] }>(can('vendors.view') ? `/api/vendor-offboardings?f.contract_id=${contract.id}&pageSize=5` : null);
  const [busy, setBusy] = useState(false);
  if (!existing.data) return null;
  const open = existing.data.rows.find((r) => r.status !== 'canceled');
  if (open) return <Link className="btn btn-secondary" to={`/vendors/offboardings/${open.id}`}>Open offboarding {open.ref}</Link>;
  if (!can('vendors.create')) return null;
  const start = async () => {
    setBusy(true);
    try {
      const row = await api.post<Row>('/api/vendor-offboardings', {
        vendor_id: contract.vendor_id, contract_id: contract.id, trigger: 'manual', owner_id: contract.owner_id ?? null,
      });
      toast.success('Offboarding started. Work through its checklist.');
      navigate(`/vendors/offboardings/${row.id}`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return <Button variant="secondary" loading={busy} onClick={start}>Start offboarding</Button>;
}
