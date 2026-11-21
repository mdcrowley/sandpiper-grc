// Quick actions in the ticket header. The next sensible step is always one click: assign to
// me, start work, pause, resume, resolve, close, reopen. Everything else is under two menus.
import { useState } from 'react';
import {
  Button, Checkbox, DateTimeField, errorMessage, LookupSelect, Menu, Modal, RecordPicker, TextArea, TextField,
  useAuth, useResource, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { canMoveTo, editableLifecycle } from '../../core/lifecycleMenus';
import { fieldErrors, useStatuses } from './util';

type Dialog = null | 'resolve' | 'vendor' | 'close';

const SCORE_WORDS = ['Very poor', 'Poor', 'Acceptable', 'Good', 'Very good'];

export function ScorePicker({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  return (
    <fieldset className="sd-score">
      <legend>How satisfied was the requester? (optional)</legend>
      <div className="row">
        {SCORE_WORDS.map((w, i) => (
          <label key={w} className={value === i + 1 ? 'sd-pick is-on' : 'sd-pick'}>
            <input type="radio" className="sr-only" name="sd-score" checked={value === i + 1} onChange={() => onChange(i + 1)} />
            <strong>{i + 1}</strong>
            <span>{w}</span>
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
  const held = row.approval_status === 'pending' || row.approval_status === 'rejected';
  const first = (c: string, prefer: string) => statuses.find((s) => s.value === prefer)?.value ?? statuses.find((s) => category(s.value) === c)?.value;
  const working = first('open', 'in_progress');
  // Every status action follows the lifecycle rules (E14-31): a move they do not allow is not offered.
  const rules = editableLifecycle(rec.resource.lifecycle, 'status');
  const may = (to: string | undefined) => !to || canMoveTo(rules, row.status, to, statuses.map((s) => s.value));
  const paused = statuses.filter((s) => category(s.value) === 'paused' && may(s.value));
  const resolveTo = first('resolved', 'resolved');
  const closeTo = first('closed', 'closed');
  const vendorPause = first('paused', 'waiting_vendor');

  async function apply(patch: Record<string, unknown>, message: string) {
    setBusy(true);
    setErrors({});
    try {
      await save(patch);
      setDialog(null);
      toast.success(message);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(fieldErrors(err).status ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const openDialog = (d: Dialog, start: Record<string, unknown>) => { setF(start); setErrors({}); setDialog(d); };

  function chooseStatus(value: string | undefined) {
    if (!value) return undefined;
    const c = category(value);
    if (c === 'resolved') return openDialog('resolve', { status: value, resolution_code: row.resolution_code ?? '', resolution_notes: row.resolution_notes ?? '' });
    if (c === 'closed' && value !== 'cancelled') return openDialog('close', { status: value, resolution_code: row.resolution_code ?? '', score: row.satisfaction_score ?? null, comment: row.satisfaction_comment ?? '' });
    const label = statuses.find((s) => s.value === value)?.label ?? value;
    return apply({ status: value }, c === 'paused' ? `${label}: the clock is paused.` : `Status changed to ${label}.`);
  }

  const assignedToMe = !!user && row.assignee_id === user.id;
  const openTasks = ((row.fulfilment_tasks ?? []) as { done: boolean }[]).filter((t) => !t.done).length;
  const tasksNote = openTasks > 0 && (
    <p className="notice notice-pilot">
      {openTasks === 1 ? 'One fulfillment task is' : `${openTasks} fulfillment tasks are`} not ticked yet. You can still go ahead.
    </p>
  );
  const footer = (onSave: () => void, label: string) => (
    <><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={onSave}>{label}</Button></>
  );
  const idle = dialog === null;

  return (
    <>
      {!done && !assignedToMe && user && (
        <Button icon="user" disabled={busy}
          onClick={() => apply({ assignee_id: user.id, ...(row.status === 'new' && first('open', 'assigned') && may(first('open', 'assigned')) ? { status: first('open', 'assigned') } : {}) }, 'Assigned to you.')}
        >Assign to me</Button>
      )}
      {cat === 'open' && !held && working && row.status !== working && may(working) && (
        <Button icon="arrow-right" disabled={busy} onClick={() => chooseStatus(working)}>Start work</Button>
      )}
      {cat === 'paused' && working && may(working) && (
        <Button variant="primary" icon="arrow-right" loading={busy && idle} onClick={() => apply({ status: working }, 'Work resumed: the clock is running again.')}>Resume</Button>
      )}
      {cat === 'open' && paused.length > 0 && (
        <Menu label="Pause" icon="clock" items={paused.map((s) => ({ label: s.label, onSelect: () => chooseStatus(s.value) }))} />
      )}
      {!done && !held && may(resolveTo) && (
        <Button variant={cat === 'paused' ? 'secondary' : 'primary'} icon="check" disabled={busy} onClick={() => chooseStatus(resolveTo)}>Resolve</Button>
      )}
      {cat === 'resolved' && may(closeTo) && (
        <Button variant="primary" icon="check" disabled={busy} onClick={() => chooseStatus(closeTo)}>Close ticket</Button>
      )}
      {done && working && may(working) && (
        <Button icon="refresh" disabled={busy} onClick={() => apply({ status: working }, 'Ticket reopened.')}>Reopen</Button>
      )}
      <Menu
        label="More actions"
        icon="more"
        iconOnly
        align="end"
        items={[
          ...statuses.filter((s) => s.value !== row.status && may(s.value)).map((s) => ({ label: `Set status: ${s.label}`, onSelect: () => chooseStatus(s.value) })),
          row.with_vendor
            ? { label: 'Update vendor details', separated: true, onSelect: () => openVendor() }
            : { label: 'Mark as with vendor', separated: true, onSelect: () => openVendor() },
          ...(row.with_vendor && !row.vendor_responded_at
            ? [{ label: 'Record vendor response now', onSelect: () => apply({ vendor_responded_at: new Date().toISOString() }, 'Vendor response recorded.') }] : []),
          ...(row.with_vendor
            ? [{ label: 'Back from vendor', onSelect: () => apply({ with_vendor: false, ...(row.status === 'waiting_vendor' && may(working) ? { status: working } : {}) }, 'No longer with the vendor.') }] : []),
          row.major_incident
            ? { label: 'Remove major incident flag', separated: true, onSelect: () => apply({ major_incident: false }, 'Major incident flag removed.') }
            : { label: 'Declare a major incident', separated: true, onSelect: () => apply({ major_incident: true }, 'Major incident declared. See the Major incident tab.') },
        ]}
      />

      <Modal open={dialog === 'resolve'} title="Resolve ticket" onClose={() => setDialog(null)}
        footer={footer(() => apply({ status: f.status, resolution_code: f.resolution_code || null, resolution_notes: f.resolution_notes || null }, 'Ticket resolved.'), 'Resolve')}>
        <div className="stack">
          {tasksNote}
          <LookupSelect label="Resolution code" list="resolution_code" required value={f.resolution_code ?? ''} onChange={set('resolution_code')} error={errors.resolution_code} />
          <TextArea label="Resolution notes" rows={4} value={f.resolution_notes ?? ''} onChange={set('resolution_notes')} error={errors.resolution_notes}
            hint="What fixed it, or what was provided. This helps the next person with the same problem." />
        </div>
      </Modal>

      <Modal open={dialog === 'close'} title="Close ticket" onClose={() => setDialog(null)}
        footer={footer(() => apply({ status: f.status, resolution_code: f.resolution_code || null, satisfaction_score: f.score ?? null, satisfaction_comment: f.comment || null }, 'Ticket closed.'), 'Close ticket')}>
        <div className="stack">
          {tasksNote}
          <LookupSelect label="Resolution code" list="resolution_code" required value={f.resolution_code ?? ''} onChange={set('resolution_code')} error={errors.resolution_code} />
          <p className="muted">Ask the requester how satisfied they are and record their answer here.</p>
          <ScorePicker value={f.score ?? null} onChange={set('score')} />
          {errors.satisfaction_score && <p className="form-error" role="alert">{errors.satisfaction_score}</p>}
          <TextArea label="Comment" rows={3} value={f.comment ?? ''} onChange={set('comment')} />
        </div>
      </Modal>

      <Modal open={dialog === 'vendor'} title="With vendor" onClose={() => setDialog(null)}
        footer={footer(() => apply({
          with_vendor: true, vendor_id: f.vendor_id || null, vendor_ref: f.vendor_ref || null,
          vendor_raised_at: f.vendor_raised_at || null, vendor_responded_at: f.vendor_responded_at || null,
          ...(f.pause && vendorPause && may(vendorPause) ? { status: vendorPause } : {}),
        }, 'Vendor details saved.'), 'Save')}>
        <div className="stack">
          {hasVendors
            ? <RecordPicker label="Vendor" type="vendor" value={f.vendor_id ?? null} display={row._display?.vendor_id} onChange={(id) => set('vendor_id')(id)} error={errors.vendor_id} />
            : <p className="muted">The vendor register is not available here, so record the vendor’s name in the reference.</p>}
          <TextField label="Vendor reference" value={f.vendor_ref ?? ''} onChange={set('vendor_ref')} error={errors.vendor_ref} hint="The vendor’s own case or ticket number." />
          <DateTimeField label="Raised with vendor" value={f.vendor_raised_at ?? ''} onChange={set('vendor_raised_at')} error={errors.vendor_raised_at} hint="Leave empty to use the time now." />
          <DateTimeField label="Vendor responded" value={f.vendor_responded_at ?? ''} onChange={set('vendor_responded_at')} error={errors.vendor_responded_at} />
          {!done && cat !== 'paused' && vendorPause && may(vendorPause) && (
            <Checkbox label="Set status to waiting on vendor (pauses the clock)" checked={!!f.pause} onChange={set('pause')} />
          )}
        </div>
      </Modal>
    </>
  );

  function openVendor() {
    openDialog('vendor', {
      vendor_id: row.vendor_id ?? null, vendor_ref: row.vendor_ref ?? '', vendor_raised_at: row.vendor_raised_at ?? '',
      vendor_responded_at: row.vendor_responded_at ?? '', pause: !row.with_vendor && !held,
    });
  }
}
