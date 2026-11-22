import { useEffect, useState } from 'react';
import { api, ApiError, Button, DateField, errorMessage, Modal, Select, TextArea, TextField, todayInZone, useAuth, useToast } from '../../core';
import { Banner } from './bits';
import type { Approvals } from './types';

interface Props {
  open: boolean;
  changeId: string;
  approvals: Approvals;
  /**
   * `approved` / `rejected`: the reader's own decision, made here and now.
   * `by_hand`: a decision the reader gave outside the application (a meeting, an email).
   */
  mode: 'approved' | 'rejected' | 'by_hand';
  onClose: () => void;
  onRecorded: () => void;
}

const DECISIONS = [
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/** Records one approval decision. The decision belongs to the person recording it. */
export function ApprovalDialog({ open, changeId, approvals, mode, onClose, onRecorded }: Props) {
  const toast = useToast();
  const { user } = useAuth();
  const byHand = mode === 'by_hand';
  const [decision, setDecision] = useState('approved');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [decidedOn, setDecidedOn] = useState(todayInZone());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  // What the dialog opened with, so closing it after a change asks first.
  const draft = JSON.stringify([decision, name, role, decidedOn, reference, notes]);
  const [start, setStart] = useState(draft);

  useEffect(() => {
    if (!open) return;
    const taken = approvals.decisions.filter((d) => d.current && d.decision === 'approved').map((d) => d.approver_role);
    const first = {
      decision: mode === 'rejected' ? 'rejected' : 'approved',
      name: user?.displayName ?? '',
      role: approvals.approver_roles.find((r) => !taken.includes(r)) ?? '',
      decidedOn: todayInZone(),
    };
    setDecision(first.decision);
    setName(first.name);
    setRole(first.role);
    setDecidedOn(first.decidedOn); setReference(''); setNotes(''); setFields({}); setFormError('');
    setStart(JSON.stringify([first.decision, first.name, first.role, first.decidedOn, '', '']));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing: Record<string, string> = {};
    if (byHand && !name.trim()) missing.approver_name = 'Approver name is required.';
    if (decision === 'rejected' && !byHand && !notes.trim()) missing.notes = 'Say why, so the requester can rework the change.';
    if (byHand && !decidedOn) missing.decided_on = 'Decision date is required.';
    else if (byHand && decidedOn > todayInZone()) missing.decided_on = 'The decision date cannot be in the future.';
    setFields(missing);
    setFormError('');
    if (Object.keys(missing).length) return;
    setBusy(true);
    try {
      await api.post(`/api/changes/${changeId}/approvals`, byHand
        ? { decision, by_hand: true, approver_name: name, approver_role: role, decided_on: decidedOn, reference, notes }
        : { decision, notes });
      toast.success(decision === 'approved' ? 'Approval recorded.' : 'Rejection recorded.');
      onRecorded();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const title = byHand ? 'Record a decision given outside the application' : decision === 'approved' ? 'Approve this change' : 'Reject this change';
  const count = `This change needs ${approvals.required} ${approvals.required === 1 ? 'approval' : 'approvals'} and has ${approvals.received}.`;
  return (
    <Modal open={open} title={title} onClose={onClose} size="md" dirty={open && draft !== start}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted">
          {byHand
            ? <>Use this when you gave your decision in a meeting or by email. It is recorded as yours; say where the evidence is filed. {count}</>
            : <>{count} Your decision is recorded under your name with today's date.</>}
        </p>
        {approvals.retrospective && (
          <Banner tone="warn">Work on this change has already started, so the approval will be flagged as given after the fact.</Banner>
        )}
        {byHand ? (
          <>
            <Select label="Decision" required value={decision} onChange={setDecision} options={DECISIONS} error={fields.decision} />
            <div className="form-grid">
              <TextField label="Approver name" required value={name} onChange={setName} error={fields.approver_name}
                hint="As it appears on the evidence" />
              <TextField label="Approver role" value={role} onChange={setRole} error={fields.approver_role}
                hint={approvals.approver_roles.length ? `The rule asks for: ${approvals.approver_roles.join(', ')}` : undefined} />
              <DateField label="Decision date" required value={decidedOn} onChange={setDecidedOn} max={todayInZone()} error={fields.decided_on} />
              <TextField label="Reference" value={reference} onChange={setReference} hint="For example where the approval email is filed" error={fields.reference} />
              <TextArea className="form-cell-wide" label="Notes" value={notes} onChange={setNotes} rows={3} error={fields.notes} />
            </div>
          </>
        ) : (
          <TextArea label={decision === 'rejected' ? 'Reason' : 'Notes'} required={decision === 'rejected'} value={notes} onChange={setNotes} rows={4}
            error={fields.notes}
            hint={decision === 'rejected' ? 'The requester is told, and can rework the change and submit it again.' : 'Optional. Conditions or comments for the implementer.'} />
        )}
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={decision === 'rejected' ? 'danger' : 'primary'} loading={busy}>
            {byHand ? 'Record decision' : decision === 'approved' ? 'Approve' : 'Reject'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
