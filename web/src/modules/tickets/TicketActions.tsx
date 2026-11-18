// Quick actions in the ticket header: assign to me, change status, resolve, vendor, close.
import { useState } from 'react';
import {
  Button, Checkbox, DateTimeField, errorMessage, LookupSelect, Menu, Modal, RecordPicker, TextArea, TextField,
  useAuth, useResource, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { fieldErrors, useStatuses } from './util';

type Dialog = null | 'resolve' | 'vendor' | 'close';

export function ScorePicker({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  const words = ['Very poor', 'Poor', 'Acceptable', 'Good', 'Very good'];
  return (
    <fieldset className="sd-score">
      <legend>How satisfied was the requester? (optional)</legend>
      <div className="row">
        {words.map((w, i) => (
          <label key={w} className={value === i + 1 ? 'sd-score-option is-on' : 'sd-score-option'}>
            <input type="radio" name="sd-score" checked={value === i + 1} onChange={() => onChange(i + 1)} />
            <span>{i + 1}</span>
            <span className="muted">{w}</span>
          </label>
        ))}
        {value !== null && <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Clear</Button>}
      </div>
    </fieldset>
  );
}

export function TicketActions({ rec }: { rec: RecordContext }) {
  const { row, save, canEdit } = rec;
  const { user } = useAuth();
  const toast = useToast();
  const { statuses, category } = useStatuses();
  const hasVendors = !!useResource('vendor');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [f, setF] = useState<Record<string, any>>({});
  const set = (key: string) => (value: unknown) => setF((old) => ({ ...old, [key]: value }));

  if (!canEdit) return null;
  const cat = category(row.status);
  const done = cat === 'resolved' || cat === 'closed';
  const first = (c: string, prefer: string) => statuses.find((s) => s.value === prefer)?.value ?? statuses.find((s) => category(s.value) === c)?.value;

  async function apply(patch: Record<string, unknown>, message: string) {
    setBusy(true);
    setErrors({});
    try {
      await save(patch);
      setDialog(null);
      toast.success(message);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const openDialog = (d: Dialog, start: Record<string, unknown>) => { setF(start); setErrors({}); setDialog(d); };

  function chooseStatus(value: string) {
    const c = category(value);
    if (c === 'resolved') return openDialog('resolve', { status: value, resolution_code: row.resolution_code ?? '', resolution_notes: row.resolution_notes ?? '' });
    if (c === 'closed' && value !== 'cancelled') return openDialog('close', { status: value, resolution_code: row.resolution_code ?? '', score: row.satisfaction_score ?? null, comment: row.satisfaction_comment ?? '' });
    return apply({ status: value }, 'Status changed.');
  }

  const assignedToMe = !!user && row.assignee_id === user.id;
  const footer = (onSave: () => void, label: string) => (
    <><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={onSave}>{label}</Button></>
  );

  return (
    <>
      {!done && !assignedToMe && user && (
        <Button
          icon="user"
          loading={busy && dialog === null}
          onClick={() => apply({ assignee_id: user.id, ...(row.status === 'new' && first('open', 'assigned') ? { status: first('open', 'assigned') } : {}) }, 'Assigned to you.')}
        >Assign to me</Button>
      )}
      <Menu
        label="Change status"
        items={statuses.filter((s) => s.value !== row.status).map((s) => ({ label: s.label, onSelect: () => chooseStatus(s.value) }))}
      />
      {!done && (
        <Button variant="primary" icon="check" onClick={() => chooseStatus(first('resolved', 'resolved') ?? 'resolved')}>Resolve</Button>
      )}
      <Menu
        label="More"
        icon="more"
        align="end"
        items={[
          row.with_vendor
            ? { label: 'Update vendor details', onSelect: () => openVendor() }
            : { label: 'Mark as with vendor', onSelect: () => openVendor() },
          ...(row.with_vendor && !row.vendor_responded_at
            ? [{ label: 'Record vendor response now', onSelect: () => apply({ vendor_responded_at: new Date().toISOString() }, 'Vendor response recorded.') }] : []),
          ...(row.with_vendor
            ? [{ label: 'Back from vendor', onSelect: () => apply({ with_vendor: false, ...(row.status === 'waiting_vendor' ? { status: first('open', 'in_progress') } : {}) }, 'No longer with the vendor.') }] : []),
          row.major_incident
            ? { label: 'Remove major incident flag', separated: true, onSelect: () => apply({ major_incident: false }, 'Major incident flag removed.') }
            : { label: 'Declare a major incident', separated: true, onSelect: () => apply({ major_incident: true }, 'Major incident declared. See the Major incident tab.') },
        ]}
      />

      <Modal open={dialog === 'resolve'} title="Resolve ticket" onClose={() => setDialog(null)}
        footer={footer(() => apply({ status: f.status, resolution_code: f.resolution_code || null, resolution_notes: f.resolution_notes || null }, 'Ticket resolved.'), 'Resolve')}>
        <div className="stack">
          <LookupSelect label="Resolution code" list="resolution_code" required value={f.resolution_code ?? ''} onChange={set('resolution_code')} error={errors.resolution_code} />
          <TextArea label="Resolution notes" rows={4} value={f.resolution_notes ?? ''} onChange={set('resolution_notes')} error={errors.resolution_notes}
            hint="What fixed it, or what was provided. This helps the next person with the same problem." />
        </div>
      </Modal>

      <Modal open={dialog === 'close'} title="Close ticket" onClose={() => setDialog(null)}
        footer={footer(() => apply({ status: f.status, resolution_code: f.resolution_code || null, satisfaction_score: f.score ?? null, satisfaction_comment: f.comment || null }, 'Ticket closed.'), 'Close ticket')}>
        <div className="stack">
          <LookupSelect label="Resolution code" list="resolution_code" required value={f.resolution_code ?? ''} onChange={set('resolution_code')} error={errors.resolution_code} />
          <p className="muted">Until the portal is switched on, ask the requester and record their answer here.</p>
          <ScorePicker value={f.score ?? null} onChange={set('score')} />
          {errors.satisfaction_score && <p className="sd-form-error" role="alert">{errors.satisfaction_score}</p>}
          <TextArea label="Comment" rows={3} value={f.comment ?? ''} onChange={set('comment')} />
        </div>
      </Modal>

      <Modal open={dialog === 'vendor'} title="With vendor" onClose={() => setDialog(null)}
        footer={footer(() => apply({
          with_vendor: true, vendor_id: f.vendor_id || null, vendor_ref: f.vendor_ref || null,
          vendor_raised_at: f.vendor_raised_at || null, vendor_responded_at: f.vendor_responded_at || null,
          ...(f.pause && first('paused', 'waiting_vendor') ? { status: first('paused', 'waiting_vendor') } : {}),
        }, 'Vendor details saved.'), 'Save')}>
        <div className="stack">
          {hasVendors
            ? <RecordPicker label="Vendor" type="vendor" value={f.vendor_id ?? null} display={row._display?.vendor_id} onChange={(id) => set('vendor_id')(id)} error={errors.vendor_id} />
            : <p className="muted">The vendor register is not available here, so record the vendor’s name in the reference.</p>}
          <TextField label="Vendor reference" value={f.vendor_ref ?? ''} onChange={set('vendor_ref')} error={errors.vendor_ref} hint="The vendor’s own case or ticket number." />
          <DateTimeField label="Raised with vendor" value={f.vendor_raised_at ?? ''} onChange={set('vendor_raised_at')} error={errors.vendor_raised_at} hint="Leave empty to use the time now." />
          <DateTimeField label="Vendor responded" value={f.vendor_responded_at ?? ''} onChange={set('vendor_responded_at')} error={errors.vendor_responded_at} />
          {!done && cat !== 'paused' && (
            <Checkbox label="Set status to waiting on vendor (pauses the clock)" checked={!!f.pause} onChange={set('pause')} />
          )}
        </div>
      </Modal>
    </>
  );

  function openVendor() {
    openDialog('vendor', {
      vendor_id: row.vendor_id ?? null, vendor_ref: row.vendor_ref ?? '', vendor_raised_at: row.vendor_raised_at ?? '',
      vendor_responded_at: row.vendor_responded_at ?? '', pause: !row.with_vendor,
    });
  }
}
