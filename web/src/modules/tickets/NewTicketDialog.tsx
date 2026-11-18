// New ticket dialog: IT staff log a ticket on a colleague's behalf. Choosing impact and
// urgency shows the priority the matrix gives before anything is saved.
import { useEffect, useState, type FormEvent } from 'react';
import {
  api, Button, Checkbox, errorMessage, LookupChip, LookupSelect, Modal, RecordPicker, TextArea, TextField,
  useFetch, useResource, UserPicker, useToast,
} from '../../core';
import type { Row } from '../../core';
import { fieldErrors, priorityFor, type PriorityMatrix } from './util';

export interface NewTicketDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (row: Row) => void;
  /** Starting values, for example from a catalogue item or a parent ticket. */
  initial?: Record<string, unknown>;
  title?: string;
}

const START: Record<string, unknown> = { type: 'incident', impact: 'individual', urgency: 'medium', channel: 'agent' };

export function NewTicketDialog({ open, onClose, onCreated, initial, title = 'New ticket' }: NewTicketDialogProps) {
  const toast = useToast();
  const matrix = useFetch<PriorityMatrix>(open ? '/api/tickets/priority-matrix' : null);
  const hasSystems = !!useResource('system');
  const hasAssets = !!useResource('asset');
  const [v, setV] = useState<Record<string, any>>({ ...START });
  const [override, setOverride] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setV({ ...START, ...(initial ?? {}) });
    setOverride(false);
    setErrors({});
    setFormError('');
  }, [open, initial]);

  const set = (key: string) => (value: unknown) => setV((old) => ({ ...old, [key]: value }));
  const computed = priorityFor(matrix.data, String(v.impact ?? ''), String(v.urgency ?? ''));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!String(v.title ?? '').trim()) found.title = 'Title is required.';
    if (!v.type) found.type = 'Type is required.';
    if (v.requester_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v.requester_email))) found.requester_email = 'Enter a full email address.';
    if (override && !v.priority) found.priority = 'Choose a priority, or untick the box.';
    setErrors(found);
    if (Object.keys(found).length) return;

    const body: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (val !== '' && val !== null && val !== undefined) body[k] = val;
    if (!override) delete body.priority;
    setBusy(true);
    setFormError('');
    try {
      const row = await api.post<Row>('/api/tickets', body);
      toast.success(`Ticket ${row.ref} logged.`);
      onCreated(row);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={title} onClose={onClose} size="lg">
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="sd-form-error" role="alert">{formError}</p>}
        <div className="form-grid">
          <LookupSelect label="Type" list="ticket_type" required value={v.type ?? ''} onChange={set('type')} error={errors.type} />
          <LookupSelect label="Category" list="ticket_category" value={v.category ?? ''} onChange={set('category')} error={errors.category} />
          <TextField className="form-cell-wide" label="Title" required autoFocus value={v.title ?? ''} onChange={set('title')} error={errors.title}
            hint="A short description of what is wrong or what is needed." />
          <TextArea className="form-cell-wide" label="Description" rows={5} value={v.description ?? ''} onChange={set('description')} error={errors.description} />

          <TextField label="Requester" value={v.requester_name ?? ''} onChange={set('requester_name')} error={errors.requester_name}
            hint="The colleague you are logging this for." />
          <TextField label="Requester department" value={v.requester_department ?? ''} onChange={set('requester_department')} error={errors.requester_department} />
          <TextField label="Requester email" type="email" value={v.requester_email ?? ''} onChange={set('requester_email')} error={errors.requester_email} />
          <TextField label="Affected person" value={v.affected_user ?? ''} onChange={set('affected_user')} error={errors.affected_user}
            hint="If different from the requester." />

          <LookupSelect label="Impact" list="ticket_impact" value={v.impact ?? ''} onChange={set('impact')} error={errors.impact} />
          <LookupSelect label="Urgency" list="ticket_urgency" value={v.urgency ?? ''} onChange={set('urgency')} error={errors.urgency} />
          <div className="form-cell-wide sd-priority-preview" aria-live="polite">
            <span className="muted">Priority from impact and urgency:</span>
            {matrix.error ? <span className="muted">could not load the matrix; the server will work it out.</span>
              : computed ? <LookupChip list="ticket_priority" value={computed} /> : <span className="muted">working it out…</span>}
            <Checkbox label="Set the priority by hand" checked={override} onChange={setOverride} />
          </div>
          {override && (
            <LookupSelect className="form-cell-wide" label="Priority" list="ticket_priority" required value={v.priority ?? ''} onChange={set('priority')} error={errors.priority} />
          )}

          <LookupSelect label="Assignment group" list="assignment_group" value={v.assignment_group ?? ''} onChange={set('assignment_group')} error={errors.assignment_group} />
          <UserPicker label="Assignee" value={v.assignee_id ?? null} onChange={(id) => set('assignee_id')(id)} error={errors.assignee_id} />
          {hasSystems && <RecordPicker label="Affected system" type="system" value={v.system_id ?? null} onChange={(id) => set('system_id')(id)} error={errors.system_id} />}
          {hasAssets && <RecordPicker label="Affected asset" type="asset" value={v.asset_id ?? null} onChange={(id) => set('asset_id')(id)} error={errors.asset_id} />}
          <LookupSelect label="How it arrived" list="ticket_channel" value={v.channel ?? ''} onChange={set('channel')} error={errors.channel} />
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Log ticket</Button>
        </div>
      </form>
    </Modal>
  );
}
