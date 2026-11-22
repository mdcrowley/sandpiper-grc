// The status actions on a finding: assign, mark fixed, accept the risk, false positive.
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ApiError, Button, DateField, errorMessage, Modal, RecordPicker, TextArea, todayInZone, useResource, UserPicker, useToast,
} from '../../core';
import type { Row } from '../../core';

interface DialogProps {
  row: Row;
  save: (patch: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
}

/** Shared frame: runs the save, shows the server's field messages, closes on success. */
function ActionDialog({ title, submitLabel, done, patch, valid = true, dirty = false, onClose, save, children }: {
  title: string; submitLabel: string; done: string; patch: () => Record<string, unknown>; valid?: boolean;
  /** True while the fields differ from what the dialog opened with: closing asks first. */
  dirty?: boolean;
  onClose: () => void; save: DialogProps['save']; children: (errors: Record<string, string>) => ReactNode;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const submit = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await save(patch());
      toast.success(done);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={title} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {error && <p className="form-error" role="alert">{error}</p>}
        {children(fields)}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!valid}>{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function AssignDialog({ row, save, onClose }: DialogProps) {
  const [owner, setOwner] = useState<string | null>(row.owner_id ?? null);
  return (
    <ActionDialog title="Assign finding" submitLabel="Assign" done="Owner saved." save={save} onClose={onClose} patch={() => ({ owner_id: owner })}
      dirty={owner !== (row.owner_id ?? null)}>
      {(errors) => (
        <UserPicker label="Owner" value={owner} display={row._display?.owner_id} onChange={(id) => setOwner(id)} error={errors.owner_id}
          hint="The person responsible for getting this fixed. Leave empty to unassign." />
      )}
    </ActionDialog>
  );
}

export function FixedDialog({ row, save, onClose }: DialogProps) {
  const [startFixedOn] = useState(todayInZone);
  const [fixedOn, setFixedOn] = useState(startFixedOn);
  const [notes, setNotes] = useState<string>(row.remediation_notes ?? '');
  return (
    <ActionDialog title="Mark as fixed" submitLabel="Mark fixed" done="Finding marked fixed." save={save} onClose={onClose} valid={!!fixedOn}
      patch={() => ({ status: 'fixed', fixed_on: fixedOn, remediation_notes: notes })}
      dirty={fixedOn !== startFixedOn || notes !== (row.remediation_notes ?? '')}>
      {(errors) => (
        <>
          <DateField label="Fixed on" required value={fixedOn} onChange={setFixedOn} min={row.first_seen ?? undefined} max={todayInZone()} error={errors.fixed_on} />
          <TextArea label="Remediation notes" value={notes} onChange={setNotes} rows={4} error={errors.remediation_notes}
            hint="What was done, and how the fix was confirmed. If a later import reports the finding again, it is reopened." />
        </>
      )}
    </ActionDialog>
  );
}

export function AcceptRiskDialog({ row, save, onClose }: DialogProps) {
  const hasExceptions = !!useResource('policy_exception');
  const [exception, setException] = useState<string | null>(row.exception_id ?? null);
  const [why, setWhy] = useState<string>(row.acceptance_justification ?? '');
  const [approver, setApprover] = useState<string | null>(row.acceptance_approver_id ?? null);
  const valid = !!exception || (why.trim() !== '' && !!approver);
  return (
    <ActionDialog title="Accept the risk" submitLabel="Accept risk" done="Risk acceptance recorded." save={save} onClose={onClose} valid={valid}
      patch={() => ({ status: 'risk_accepted', exception_id: exception, acceptance_justification: why, acceptance_approver_id: approver })}
      dirty={exception !== (row.exception_id ?? null) || why !== (row.acceptance_justification ?? '') || approver !== (row.acceptance_approver_id ?? null)}>
      {(errors) => (
        <>
          <p className="muted">
            {hasExceptions
              ? 'Link the approved exception that covers this finding, or record the justification and who approved it.'
              : 'Record why the risk is accepted and who approved it. The finding stops counting as open and overdue.'}
          </p>
          {hasExceptions && (
            <RecordPicker label="Exception" type="policy_exception" value={exception} display={row._display?.exception_id}
              onChange={(id) => setException(id)} error={errors.exception_id}
              hint="Only an approved exception that has not expired can cover the finding." />
          )}
          <TextArea label="Justification" required={!exception} value={why} onChange={setWhy} rows={4} error={exception ? undefined : errors.acceptance_justification}
            hint="For example the compensating measures in place and when the decision will be looked at again." />
          <UserPicker label="Approved by" required={!exception} value={approver} display={row._display?.acceptance_approver_id}
            onChange={(id) => setApprover(id)} error={exception ? undefined : errors.acceptance_approver_id}
            hint="The person who agreed to the risk. It cannot be you." />
        </>
      )}
    </ActionDialog>
  );
}

export function FalsePositiveDialog({ row, save, onClose }: DialogProps) {
  const [reason, setReason] = useState<string>(row.false_positive_reason ?? '');
  return (
    <ActionDialog title="Mark as a false positive" submitLabel="Mark false positive" done="Finding marked as a false positive." save={save} onClose={onClose}
      valid={reason.trim() !== ''} patch={() => ({ status: 'false_positive', false_positive_reason: reason })}
      dirty={reason !== (row.false_positive_reason ?? '')}>
      {(errors) => (
        <TextArea label="Reason" required value={reason} onChange={setReason} rows={4} error={errors.false_positive_reason}
          hint="Say how you know the finding does not apply, so the next person does not have to check again." />
      )}
    </ActionDialog>
  );
}
