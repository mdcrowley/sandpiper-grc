import { useEffect, useState } from 'react';
import { api, ApiError, Button, DateField, errorMessage, Modal, Select, TextArea, TextField, todayInZone, useToast } from '../../core';
import { Banner } from './bits';
import type { Approvals } from './types';

interface Props {
  open: boolean;
  changeId: string;
  approvals: Approvals;
  onClose: () => void;
  onRecorded: () => void;
}

const DECISIONS = [
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/** Records an approval decision: who decided, in what role, when, and where the evidence is filed. */
export function ApprovalDialog({ open, changeId, approvals, onClose, onRecorded }: Props) {
  const toast = useToast();
  const [decision, setDecision] = useState('approved');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [decidedOn, setDecidedOn] = useState(todayInZone());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const taken = approvals.decisions.filter((d) => d.current && d.decision === 'approved').map((d) => d.approver_role);
    setDecision('approved'); setName(''); setRole(approvals.approver_roles.find((r) => !taken.includes(r)) ?? '');
    setDecidedOn(todayInZone()); setReference(''); setNotes(''); setFields({}); setFormError('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing: Record<string, string> = {};
    if (!name.trim()) missing.approver_name = 'Approver name is required.';
    if (!decidedOn) missing.decided_on = 'Decision date is required.';
    else if (decidedOn > todayInZone()) missing.decided_on = 'The decision date cannot be in the future.';
    setFields(missing);
    setFormError('');
    if (Object.keys(missing).length) return;
    setBusy(true);
    try {
      await api.post(`/api/changes/${changeId}/approvals`, {
        decision, approver_name: name, approver_role: role, decided_on: decidedOn, reference, notes,
      });
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

  return (
    <Modal open={open} title="Record an approval decision" onClose={onClose} size="md">
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted">
          Record who decided, when, and where the evidence is filed (for example an email or meeting minute).
          This change needs {approvals.required} {approvals.required === 1 ? 'approval' : 'approvals'} and has {approvals.received}.
        </p>
        {approvals.retrospective && (
          <Banner tone="warn">Work on this change has already started, so the approval will be flagged as given after the fact.</Banner>
        )}
        <Select label="Decision" required value={decision} onChange={setDecision} options={DECISIONS} error={fields.decision} />
        <div className="form-grid">
          <TextField label="Approver name" required value={name} onChange={setName} error={fields.approver_name} />
          <TextField
            label="Approver role"
            value={role}
            onChange={setRole}
            error={fields.approver_role}
            hint={approvals.approver_roles.length ? `The rule asks for: ${approvals.approver_roles.join(', ')}` : undefined}
          />
          <DateField label="Decision date" required value={decidedOn} onChange={setDecidedOn} max={todayInZone()} error={fields.decided_on} />
          <TextField label="Reference" value={reference} onChange={setReference} hint="For example where the approval email is filed" error={fields.reference} />
          <TextArea className="form-cell-wide" label="Notes" value={notes} onChange={setNotes} rows={3} error={fields.notes} />
        </div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Record decision</Button>
        </div>
      </form>
    </Modal>
  );
}
