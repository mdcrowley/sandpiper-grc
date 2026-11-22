// Evidence forms whose contract picker offers only the chosen vendor's contracts (E18-18).
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, DateField, errorMessage, LookupSelect, Modal, RecordPicker, Select, TextArea, TextField,
  useAuth, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';
import { filesAvailable, FilesPanel } from './shared';

/** A select listing the contracts of one vendor. Empty until a vendor is chosen. */
export function VendorContractSelect({ vendorId, value, onChange, error, disabled }: {
  vendorId: string | null; value: string; onChange: (id: string) => void; error?: string; disabled?: boolean;
}) {
  const { can } = useAuth();
  const allowed = can('contracts.view');
  const { data } = useFetch<{ rows: Row[] }>(
    vendorId && allowed ? `/api/contracts?f.vendor_id=${encodeURIComponent(vendorId)}&sort=title&pageSize=500` : null,
  );
  const options = (data?.rows ?? []).map((c) => ({ value: c.id, label: [c.ref, c.title].filter(Boolean).join(' ') }));
  const hint = !allowed ? 'You cannot view contracts.'
    : !vendorId ? 'Choose a vendor first.'
    : data && !options.length ? 'This vendor has no contracts.' : 'Only this vendor\'s contracts are listed.';
  return (
    <Select
      label="Contract" placeholder="None" options={options} value={value} onChange={onChange}
      error={error} hint={hint} disabled={disabled || !vendorId || !allowed}
    />
  );
}

const BLANK = { title: '', vendor_id: '' as string, contract_id: '', type: 'other', received_on: '', expires_on: '', note: '' };

/**
 * "New evidence item" button and dialog. With `vendorId` the vendor is fixed (a vendor's
 * Evidence tab); without it the form asks for one. `watchNew` opens the dialog for `?new=1`.
 */
export function AddEvidence({ vendorId, contractId, watchNew, onCreated }: {
  vendorId?: string; contractId?: string; watchNew?: boolean; onCreated: (row: Row) => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ ...BLANK, vendor_id: vendorId ?? '', contract_id: contractId ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const allowed = can('vendors.create');

  const [created, setCreated] = useState<Row | null>(null);
  const start = () => {
    setV({ ...BLANK, vendor_id: vendorId ?? '', contract_id: contractId ?? '' });
    setErrors({}); setMessage(null); setCreated(null); setOpen(true);
  };
  const finish = () => {
    setOpen(false);
    if (created) onCreated(created);
  };

  useEffect(() => {
    if (!watchNew || !allowed || params.get('new') !== '1') return;
    start();
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchNew, allowed, params]);

  if (!allowed) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!v.title.trim()) found.title = 'Title is required.';
    if (!v.vendor_id) found.vendor_id = 'Vendor is required.';
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const row = await api.post<Row>('/api/evidence', {
        title: v.title.trim(), vendor_id: v.vendor_id, contract_id: v.contract_id || null, type: v.type || null,
        received_on: v.received_on || null, expires_on: v.expires_on || null, note: v.note.trim() || null,
      });
      toast.success('Evidence item added.');
      if (filesAvailable) setCreated(row); // second step: attach the document itself
      else { setOpen(false); onCreated(row); }
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="primary" icon="plus" onClick={start}>New evidence item</Button>
      <Modal
        open={open} size={created ? 'lg' : 'md'} title={created ? 'Attach the document' : 'New evidence item'} onClose={finish}
        dirty={!created && JSON.stringify(v) !== JSON.stringify({ ...BLANK, vendor_id: vendorId ?? '', contract_id: contractId ?? '' })}
        footer={created ? <Button variant="primary" onClick={finish}>Done</Button> : undefined}
      >
        {open && created && (
          <div className="stack">
            <p className="muted">
              <strong>{created.title}</strong> has been recorded. Add the document itself now, or select Done and attach it
              later from the evidence item's Files tab.
            </p>
            <FilesPanel recordType="evidence_item" recordId={created.id} evidence />
          </div>
        )}
        {open && !created && (
          <form className="form" onSubmit={submit} noValidate>
            {message && <div className="form-error" role="alert">{message}</div>}
            <div className="form-grid">
              <TextField label="Title" required autoFocus value={v.title} error={errors.title} onChange={(title) => setV({ ...v, title })} />
              <LookupSelect label="Type" list="evidence_type" value={v.type} error={errors.type} onChange={(type) => setV({ ...v, type })} />
              {!vendorId && (
                <RecordPicker
                  label="Vendor" type="vendor" required value={v.vendor_id || null} error={errors.vendor_id}
                  // A contract belongs to one vendor, so changing the vendor clears it.
                  onChange={(id) => setV({ ...v, vendor_id: id ?? '', contract_id: '' })}
                />
              )}
              <VendorContractSelect
                vendorId={v.vendor_id || null} value={v.contract_id} error={errors.contract_id} disabled={!!contractId}
                onChange={(contract_id) => setV({ ...v, contract_id })}
              />
              <DateField label="Received on" value={v.received_on} error={errors.received_on} onChange={(received_on) => setV({ ...v, received_on })} />
              <DateField label="Expires on" value={v.expires_on} error={errors.expires_on} onChange={(expires_on) => setV({ ...v, expires_on })} />
              <div className="form-cell-wide">
                <TextArea label="Note" rows={3} value={v.note} error={errors.note} onChange={(note) => setV({ ...v, note })} />
              </div>
            </div>
            <div className="form-actions">
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={saving}>{filesAvailable ? 'Save and attach the document' : 'Add evidence item'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

/** Card on the evidence record for changing its contract, limited to the vendor's contracts. */
export function EvidenceContractCard({ row, canEdit, save }: { row: Row; canEdit: boolean; save: (patch: Record<string, unknown>) => Promise<unknown> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!canEdit) {
    return <Card title="Contract this evidence belongs to"><p>{row.contract_id ? row._display?.contract_id ?? 'A contract' : 'None'}</p></Card>;
  }
  async function change(contract_id: string) {
    setBusy(true);
    try {
      await save({ contract_id: contract_id || null });
      toast.success('Contract changed.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Contract this evidence belongs to">
      <VendorContractSelect vendorId={row.vendor_id ?? null} value={row.contract_id ?? ''} onChange={(id) => void change(id)} disabled={busy} />
    </Card>
  );
}
