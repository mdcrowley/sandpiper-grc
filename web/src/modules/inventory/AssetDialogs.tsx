// Asset lifecycle dialogs: check out, check in and dispose.
import { useState } from 'react';
import {
  api, ApiError, Button, DateField, errorMessage, Modal, Select, TextArea, TextField, UserPicker, useToast,
} from '../../core';
import type { Row } from '../../core';

interface DialogProps { asset: Row; onClose: (changed: boolean) => void }
const fieldErrors = (err: unknown): Record<string, string> =>
  err instanceof ApiError && err.fields && Object.keys(err.fields).length ? { ...err.fields, _form: err.message } : { _form: errorMessage(err) };
const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function CheckOutDialog({ asset, onClose }: DialogProps) {
  const toast = useToast();
  const [who, setWho] = useState<'name' | 'user'>('name');
  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [department, setDepartment] = useState<string>(asset.department ?? '');
  const [location, setLocation] = useState<string>(asset.location ?? '');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (who === 'user' ? !userId : !name.trim()) {
      setErrors(who === 'user' ? { user_id: 'Choose a user.' } : { assignee_name: 'Enter the name of the person receiving the asset.' });
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/assets/${asset.id}/check-out`, {
        user_id: who === 'user' ? userId : null, assignee_name: who === 'name' ? name : null,
        department, location, due_back_on: due || null, notes,
      });
      toast.success('Asset checked out.');
      onClose(true);
    } catch (err) {
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Check out ${asset.tag ?? asset.name}`} onClose={() => onClose(false)}
      footer={<><Button onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Check out</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {errors._form && <p className="form-error" role="alert">{errors._form}</p>}
        <Select label="Assign to" value={who} onChange={(v) => { setWho(v === 'user' ? 'user' : 'name'); setErrors({}); }}
          options={[{ value: 'name', label: 'A member of staff (by name)' }, { value: 'user', label: 'A user of this application' }]}
          hint="Most staff do not have an account here yet, so a name is enough." />
        {who === 'user'
          ? <UserPicker label="User" value={userId} onChange={(id) => setUserId(id)} error={errors.user_id} required />
          : <TextField label="Name" value={name} onChange={setName} error={errors.assignee_name} required autoFocus />}
        <div className="form-grid">
          <TextField label="Department" value={department} onChange={setDepartment} />
          <TextField label="Location" value={location} onChange={setLocation} />
          <DateField label="Due back" value={due} onChange={setDue} min={today()} error={errors.due_back_on} hint="Leave empty for a permanent assignment." />
        </div>
        <TextArea label="Notes" value={notes} onChange={setNotes} rows={3} />
      </form>
    </Modal>
  );
}

export function CheckInDialog({ asset, onClose }: DialogProps) {
  const toast = useToast();
  const [status, setStatus] = useState('in_stock');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/assets/${asset.id}/check-in`, { status, notes });
      toast.success('Asset checked in.');
      onClose(true);
    } catch (err) {
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={`Check in ${asset.tag ?? asset.name}`} onClose={() => onClose(false)} size="sm"
      footer={<><Button onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Check in</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {errors._form && <p className="form-error" role="alert">{errors._form}</p>}
        <p>Currently with <strong>{asset._display?.user_id ?? asset.assigned_to_name ?? 'someone'}</strong>.</p>
        <Select label="Status after check-in" value={status} onChange={(v) => setStatus(v || 'in_stock')} error={errors.status}
          options={[{ value: 'in_stock', label: 'In stock' }, { value: 'in_repair', label: 'In repair' }, { value: 'retired', label: 'Retired' }]} />
        <TextArea label="Condition and notes" value={notes} onChange={setNotes} rows={3} />
      </form>
    </Modal>
  );
}

/**
 * Disposal needs a recorded approval. Equipment in which an outside funder keeps an interest is blocked until
 * the reference of the approval to dispose of it is entered; the dialog says so up front.
 */
export function DisposeDialog({ asset, onClose }: DialogProps) {
  const toast = useToast();
  const funder = !!asset.funder_interest;
  const [by, setBy] = useState<string>(asset.disposal_approved_by ?? '');
  const [on, setOn] = useState<string>(asset.disposal_approved_on ?? '');
  const [ref, setRef] = useState<string>(asset.disposal_approval_ref ?? '');
  const [method, setMethod] = useState<string>(asset.disposal_method ?? '');
  const [disposedOn, setDisposedOn] = useState(today());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const blocked = funder && !ref.trim();

  async function submit() {
    const missing: Record<string, string> = {};
    if (!by.trim()) missing.disposal_approved_by = 'Enter the name of the person who approved the disposal.';
    if (!on) missing.disposal_approved_on = 'Enter the date the disposal was approved.';
    if (blocked) missing.disposal_approval_ref = 'Enter the reference of the funder\'s approval to dispose of this equipment.';
    if (Object.keys(missing).length) { setErrors(missing); return; }
    setBusy(true);
    try {
      await api.post(`/api/assets/${asset.id}/dispose`, {
        disposal_approved_by: by, disposal_approved_on: on, disposal_approval_ref: ref || null,
        disposal_method: method || null, disposed_on: disposedOn || null,
      });
      toast.success('Asset marked as disposed.');
      onClose(true);
    } catch (err) {
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Dispose of ${asset.tag ?? asset.name}`} onClose={() => onClose(false)}
      footer={(
        <>
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={blocked} onClick={submit}>Mark as disposed</Button>
        </>
      )}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {funder ? (
          <div className={`inv-callout ${blocked ? 'inv-callout-block' : 'inv-callout-ok'}`} role="status">
            <strong>{blocked ? 'Blocked: an outside funder keeps an interest in this asset' : 'Funder interest: approval reference entered'}</strong>
            <span>
              {asset.funder_interest_pct != null ? `${asset.funder_interest_pct}% of this asset was paid for by an outside funder, such as a grant body. ` : 'This asset was paid for in part by an outside funder, such as a grant body. '}
              The funder's approval is needed before it is disposed of. Enter the reference of that
              approval (for example the letter or email reference) below; until then the disposal cannot be completed.
            </span>
          </div>
        ) : (
          <div className="inv-callout">
            <strong>No funder interest is recorded for this asset</strong>
            <span>A disposal still needs a recorded approval: who approved it and when.</span>
          </div>
        )}
        {errors._form && <p className="form-error" role="alert">{errors._form}</p>}
        <div className="form-grid">
          <TextField label="Approved by" value={by} onChange={setBy} error={errors.disposal_approved_by} required hint="Name of the approver." />
          <DateField label="Approved on" value={on} onChange={setOn} max={today()} error={errors.disposal_approved_on} required />
          <div className="form-cell-wide">
            <TextField label="Disposal approval reference" value={ref} onChange={(v) => { setRef(v); setErrors({}); }}
              error={errors.disposal_approval_ref} required={funder}
              hint={funder ? 'Required because of the funder interest.' : 'Optional.'} />
          </div>
          <TextField label="Disposal method" value={method} onChange={setMethod} hint="For example recycled, sold, returned to vendor." />
          <DateField label="Disposed on" value={disposedOn} onChange={setDisposedOn} max={today()} error={errors.disposed_on} />
        </div>
        <p className="muted">The asset is checked in if it is out, and the approval is kept in its history.</p>
      </form>
    </Modal>
  );
}
