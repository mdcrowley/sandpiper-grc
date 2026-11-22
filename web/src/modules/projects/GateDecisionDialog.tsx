import { useEffect, useState } from 'react';
import { Alert, Radio, Stack, Text } from '@mantine/core';
import { api, ApiError, Button, DateField, errorMessage, Icon, lookupLabel, Modal, TextArea, TextField, useToast } from '../../core';
import { BlockerList, blockerAdvice } from './GateParts';
import { todayIso, type Gate } from './types';

interface Props {
  open: boolean;
  projectId: string;
  gate: Gate;
  onClose: () => void;
  /** Called after a decision is saved. */
  onDecided: () => void;
}

/**
 * Records a gate decision that was given outside the application. Approval is refused, and the
 * dialog lists exactly what is in the way, while anything blocks the gate.
 */
export function GateDecisionDialog({ open, projectId, gate, onClose, onDecided }: Props) {
  const toast = useToast();
  const blocked = gate.blockers.length > 0;
  const next = lookupLabel('project_stage', gate.to_stage);
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

  const dirty = open && (
    decision !== (blocked ? 'deferred' : 'approved') || Boolean(approverName.trim()) || approverRole !== (gate.approvers_for_tier[0] ?? '')
    || decidedOn !== todayIso() || Boolean(reference.trim()) || Boolean(notes.trim())
  );
  const approvalBlocked = decision === 'approved' && blocked;
  const statusBlocked = gate.blockers.some((b) => b.kind === 'status');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing: Record<string, string> = {};
    if (!approverName.trim()) missing.approver_name = 'Approver name is required.';
    if (!decidedOn) missing.decided_on = 'Decision date is required.';
    else if (decidedOn > todayIso()) missing.decided_on = 'The decision date cannot be in the future.';
    setFields(missing);
    setFormError('');
    if (Object.keys(missing).length || approvalBlocked || statusBlocked) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${projectId}/gates/${gate.id}/decide`, {
        decision, approver_name: approverName, approver_role: approverRole, decided_on: decidedOn, reference, notes,
      });
      toast.success(decision === 'approved' ? `${gate.name} approved. The project has moved to ${next}.` : `Decision recorded: ${decision}.`);
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
    <Modal open={open} title={`Record decision: ${gate.name}`} onClose={onClose} size="md" dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        <Text size="sm" c="dimmed">
          Approvals are given outside the application. Record who decided, when, and where the approval is filed.
        </Text>

        <Radio.Group label="Decision" value={decision} onChange={setDecision} required>
          <Stack gap={8} mt={6}>
            <Radio value="approved" label={`Approved: move to ${next}`} description={blocked ? 'Not possible yet: see below' : 'Closes this gate and opens the next one'} />
            <Radio value="deferred" label="Deferred: decide later" description="The gate stays open and shows as a decision due" />
            <Radio value="rejected" label="Rejected" description="The project stays in its stage" />
          </Stack>
        </Radio.Group>

        {(approvalBlocked || statusBlocked) && (
          <Alert color="red" variant="light" icon={<Icon name="lock" />} title={statusBlocked ? 'No decision can be recorded yet' : 'This gate cannot be approved yet'} role="alert">
            <BlockerList blockers={statusBlocked ? gate.blockers.filter((b) => b.kind === 'status') : gate.blockers} />
            <Text size="sm" mt="xs">
              {statusBlocked
                ? 'Gate decisions can be recorded only while the project is active. Change its status on the Project card first.'
                : `${blockerAdvice(gate)} Or record the decision as deferred.`}
            </Text>
          </Alert>
        )}

        <div className="form-grid">
          <TextField label="Approver name" required value={approverName} onChange={setApproverName} error={fields.approver_name} />
          <TextField
            label="Approver role"
            value={approverRole}
            onChange={setApproverRole}
            error={fields.approver_role}
            hint={gate.approvers_for_tier.length ? `Expected for this tier: ${gate.approvers_for_tier.join(', ')}` : undefined}
          />
          <DateField label="Decision date" required value={decidedOn} onChange={setDecidedOn} max={todayIso()} error={fields.decided_on} />
          <TextField label="Reference" value={reference} onChange={setReference} hint="For example where the approval email is filed" error={fields.reference} />
          <TextArea className="form-cell-wide" label="Notes" value={notes} onChange={setNotes} rows={3} error={fields.notes} />
        </div>

        {formError && !approvalBlocked && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={approvalBlocked || statusBlocked}>Record decision</Button>
        </div>
      </form>
    </Modal>
  );
}
