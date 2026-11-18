import { useEffect, useState } from 'react';
import { api, ApiError, Button, DateField, errorMessage, Icon, Modal, Select, TextArea, TextField, useToast } from '../../core';
import { todayIso, type Gate } from './types';

interface Props {
  open: boolean;
  projectId: string;
  gate: Gate;
  onClose: () => void;
  /** Called after a decision is saved. */
  onDecided: () => void;
}

const DECISIONS = [
  { value: 'approved', label: 'Approved: move to the next stage' },
  { value: 'deferred', label: 'Deferred: decide later' },
  { value: 'rejected', label: 'Rejected' },
];

/**
 * Records a gate decision received by email. Approval is blocked, with the reason shown,
 * while checklist items are outstanding.
 */
export function GateDecisionDialog({ open, projectId, gate, onClose, onDecided }: Props) {
  const toast = useToast();
  const blocked = gate.outstanding.length > 0;
  const [decision, setDecision] = useState(blocked ? 'deferred' : 'approved');
  const [approverName, setApproverName] = useState('');
  const [approverRole, setApproverRole] = useState('');
  const [decidedOn, setDecidedOn] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDecision(blocked ? 'deferred' : 'approved');
    setApproverName(''); setApproverRole(gate.approvers_for_tier[0] ?? ''); setDecidedOn(todayIso());
    setReference(''); setNotes(''); setFields({}); setFormError('');
  }, [open, gate.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const approvalBlocked = decision === 'approved' && blocked;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing: Record<string, string> = {};
    if (!approverName.trim()) missing.approver_name = 'Approver name is required.';
    if (!decidedOn) missing.decided_on = 'Decision date is required.';
    else if (decidedOn > todayIso()) missing.decided_on = 'The decision date cannot be in the future.';
    setFields(missing);
    setFormError('');
    if (Object.keys(missing).length || approvalBlocked) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${projectId}/gates/${gate.id}/decide`, {
        decision, approver_name: approverName, approver_role: approverRole, decided_on: decidedOn, reference, notes,
      });
      toast.success(decision === 'approved' ? `${gate.name} gate approved. The project has moved to the next stage.` : `Decision recorded: ${decision}.`);
      onDecided();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={`Record decision: ${gate.name} gate`} onClose={onClose} size="md">
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted">
          Approvals arrive by email in this version. Record who decided, when, and where the email is filed.
        </p>
        <Select label="Decision" required value={decision} onChange={setDecision} options={DECISIONS} error={fields.decision} />

        {approvalBlocked && (
          <div className="prj-banner" role="alert">
            <Icon name="lock" />
            <div>
              <p><strong>This gate cannot be approved yet.</strong></p>
              <p>
                {gate.outstanding.length} of {gate.total} checklist {gate.outstanding.length === 1 ? 'item is' : 'items are'} still
                to do. Tick {gate.outstanding.length === 1 ? 'it' : 'them'} on the checklist first, or record the decision as deferred.
              </p>
              <ul className="prj-plainlist">
                {gate.outstanding.map((label) => <li key={label}>{label}</li>)}
              </ul>
            </div>
          </div>
        )}

        <div className="form-grid">
          <TextField label="Approver name" required value={approverName} onChange={setApproverName} error={fields.approver_name} />
          <TextField
            label="Approver role"
            value={approverRole}
            onChange={setApproverRole}
            error={fields.approver_role}
            hint={gate.approvers_for_tier.length ? `Approvers for this tier: ${gate.approvers_for_tier.join(', ')}` : undefined}
          />
          <DateField label="Decision date" required value={decidedOn} onChange={setDecidedOn} max={todayIso()} error={fields.decided_on} />
          <TextField label="Reference" value={reference} onChange={setReference} hint="For example where the approval email is filed" error={fields.reference} />
          <TextArea className="form-cell-wide" label="Notes" value={notes} onChange={setNotes} rows={3} error={fields.notes} />
        </div>

        {formError && !approvalBlocked && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={approvalBlocked}>Record decision</Button>
        </div>
      </form>
    </Modal>
  );
}
