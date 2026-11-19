import { useState } from 'react';
import {
  api, ApiError, Button, DateTimeField, errorMessage, LookupSelect, Menu, Modal, TextArea, useAuth, useToast,
  type RecordContext,
} from '../../core';
import { ApprovalDialog } from './ApprovalDialog';
import { Banner } from './bits';
import { useWorkflow } from './workflowContext';

const LABELS: Record<string, string> = {
  submitted: 'Submit for approval',
  scheduled: 'Schedule',
  in_progress: 'Start work',
  completed: 'Complete',
  closed: 'Close change',
  draft: 'Return to draft',
  approved: 'Take off the schedule',
  cancelled: 'Cancel change',
};
/** The first allowed move in this order is the main button; the rest go in the More menu. */
const ORDER = ['submitted', 'scheduled', 'in_progress', 'completed', 'closed', 'draft', 'approved', 'cancelled'];

interface Props extends RecordContext {
  onOpenTab: (tab: string) => void;
}

/** Header buttons of a change: the next step in the lifecycle, and the less common moves in a menu. */
export function ChangeActions({ row, reload, canEdit, onOpenTab }: Props) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload: reloadWorkflow } = useWorkflow();
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState<'' | 'complete' | 'cancel' | 'approve' | 'reject'>('');
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [actualEnd, setActualEnd] = useState('');
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');

  if (!data) return null;
  const refresh = () => { reload(); reloadWorkflow(); };

  async function move(to: string, body: Record<string, unknown> = {}, inDialog = false) {
    setBusy(to);
    setFields({});
    setFormError('');
    try {
      await api.post(`/api/changes/${row.id}/transition`, { to, ...body });
      toast.success({
        submitted: 'Change submitted.', scheduled: 'Change scheduled.', in_progress: 'Work started.', completed: 'Change completed.',
        closed: 'Change closed.', draft: 'Change returned to draft.', approved: 'Change taken off the schedule.', cancelled: 'Change canceled.',
      }[to] ?? 'Saved.');
      setDialog('');
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      if (inDialog) setFormError(errorMessage(err)); else toast.error(errorMessage(err));
      if (err instanceof ApiError && err.code === 'conflicts') onOpenTab('conflicts');
      if (err instanceof ApiError && err.code === 'review_missing') onOpenTab('review');
      if (err instanceof ApiError && err.code === 'approvals_missing') onOpenTab('approvals');
    } finally {
      setBusy('');
    }
  }

  const start = (to: string) => {
    if (to === 'completed') { setOutcome(''); setNotes(String(row.outcome_notes ?? '')); setActualEnd(new Date().toISOString()); setFields({}); setFormError(''); setDialog('complete'); }
    else if (to === 'cancelled') { setReason(''); setFormError(''); setDialog('cancel'); }
    else void move(to);
  };

  const { approvals, review } = data;
  const moves = canEdit
    ? ORDER.filter((s) => data.next.includes(s))
      // Starting unapproved work is offered only when the rule allows approval after the fact.
      .filter((s) => !(s === 'in_progress' && row.status === 'submitted' && !approvals.retrospective_allowed))
    : [];
  // Only the people the change is waiting for get the approval buttons; each decides for themselves.
  const canApprove = approvals.awaiting && can('changes.approve') && approvals.can_decide;
  const reviewFirst = row.status === 'completed' && review.required && !review.done;
  const [first, ...rest] = moves;
  const main = canApprove || reviewFirst ? undefined : first;
  const others = main ? rest : moves;

  return (
    <>
      {canApprove && <Button variant="primary" icon="check" onClick={() => setDialog('approve')}>Approve</Button>}
      {canApprove && <Button icon="x" onClick={() => setDialog('reject')}>Reject</Button>}
      {reviewFirst && canEdit && <Button variant="primary" icon="clipboard" onClick={() => onOpenTab('review')}>Record review</Button>}
      {main && <Button variant="primary" loading={busy === main} onClick={() => start(main)}>{LABELS[main] ?? main}</Button>}
      {others.length > 0 && (
        <Menu
          label="More"
          align="end"
          items={others.map((s) => ({ label: LABELS[s] ?? s, danger: s === 'cancelled', separated: s === 'cancelled' && others.length > 1, onSelect: () => start(s) }))}
        />
      )}

      <ApprovalDialog open={dialog === 'approve' || dialog === 'reject'} mode={dialog === 'reject' ? 'rejected' : 'approved'}
        changeId={row.id} approvals={approvals} onClose={() => setDialog('')} onRecorded={refresh} />

      <Modal open={dialog === 'complete'} title="Complete this change" onClose={() => setDialog('')} size="md">
        <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void move('completed', { outcome, outcome_notes: notes, actual_end: actualEnd || undefined }, true); }}>
          <LookupSelect label="Outcome" required list="change_outcome" value={outcome} onChange={setOutcome} error={fields.outcome} />
          {['failed', 'backed_out'].includes(outcome) && (
            <Banner tone="warn">A post-implementation review will be required before this change can be closed.</Banner>
          )}
          <DateTimeField label="Actual end" value={actualEnd} onChange={setActualEnd} error={fields.actual_end} />
          <TextArea label="Outcome notes" value={notes} onChange={setNotes} rows={3} error={fields.outcome_notes} />
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="form-actions">
            <Button onClick={() => setDialog('')}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy === 'completed'} disabled={!outcome || outcome === 'cancelled'}>Complete change</Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === 'cancel'} title="Cancel this change" onClose={() => setDialog('')} size="sm">
        <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void move('cancelled', { reason }, true); }}>
          <p className="muted">A canceled change stays in the register but can no longer be edited or reopened.</p>
          <TextArea label="Reason" value={reason} onChange={setReason} rows={3} />
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="form-actions">
            <Button onClick={() => setDialog('')}>Keep the change</Button>
            <Button type="submit" variant="danger" loading={busy === 'cancelled'}>Cancel change</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
