// Approve or reject one step: a short dialog with a comment (needed for a rejection).
import { useEffect, useState } from 'react';
import { api, ApiError, Button, errorMessage, Modal, TextArea, useToast } from '../../core';

export interface DecisionTarget {
  stepId: string;
  decision: 'approved' | 'rejected';
  /** What is decided, for the title: "Purchase request PRQ-00012". */
  what: string;
  step: string;
}

export function DecisionDialog({ target, onClose, onDone }: { target: DecisionTarget | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { setComment(''); setError(undefined); }, [target?.stepId, target?.decision]);
  if (!target) return null;
  const approving = target.decision === 'approved';

  async function submit() {
    if (!target) return;
    if (!approving && !comment.trim()) { setError('Say why you reject it.'); return; }
    setBusy(true);
    try {
      const res = await api.post<{ stepOutcome: string; instance: { status: string } }>(`/api/workflows/steps/${target.stepId}/decision`, { decision: target.decision, comment: comment.trim() || null });
      toast.success(
        approving
          ? res.stepOutcome === 'pending' ? 'Your approval is recorded. The step needs more approvals.' : res.instance?.status === 'approved' ? 'Approved. The workflow is complete.' : 'Approved. It has moved to the next step.'
          : 'Rejected. The person who asked has been told.',
      );
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields?.comment) setError(err.fields.comment);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="sm"
      title={approving ? `Approve: ${target.what}` : `Reject: ${target.what}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={approving ? 'primary' : 'danger'} loading={busy} onClick={() => void submit()}>{approving ? 'Approve' : 'Reject'}</Button>
        </>
      )}
    >
      <p className="muted wf-dialog-step">Step: {target.step}</p>
      <TextArea
        label={approving ? 'Comment (optional)' : 'Why are you rejecting it?'}
        required={!approving}
        value={comment}
        onChange={(v) => { setComment(v); setError(undefined); }}
        error={error}
        rows={3}
        hint={approving ? 'Shown on the record with your decision.' : 'The person who asked sees this, and it is kept on the record.'}
      />
    </Modal>
  );
}
