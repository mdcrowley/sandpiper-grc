import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, Button, Card, EmptyState, errorMessage, ErrorState, Loading, Modal, TextArea, useAuth, useToast, type Row } from '../../core';
import { Banner, ConflictList } from './bits';
import { dayOf, plural } from './util';
import { useWorkflow } from './workflowContext';

/** Blackout periods and other changes that clash with this one, and the override that lets it go ahead. */
export function ConflictsPanel({ row }: { row: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useWorkflow();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState title="The conflicts could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} label="Loading conflicts" />;

  const unacknowledged = data.conflicts.filter((c) => !c.acknowledged);

  async function acknowledge(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setReasonError('Give the reason for going ahead despite the conflict.'); return; }
    setBusy(true);
    setReasonError('');
    try {
      await api.post(`/api/changes/${row.id}/conflicts/acknowledge`, { reason });
      toast.success('Conflict acknowledged. The reason is in the history.');
      setOpen(false);
      reload();
    } catch (err) {
      setReasonError(err instanceof ApiError && err.fields?.reason ? err.fields.reason : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Conflicts"
      actions={(
        <>
          {row.planned_start && <Link className="btn btn-secondary btn-sm" to={`/changes/calendar?date=${dayOf(row.planned_start)}&view=week`}>Show on calendar</Link>}
          {unacknowledged.length > 0 && can('changes.approve') && (
            <Button size="sm" variant="primary" onClick={() => { setReason(''); setReasonError(''); setOpen(true); }}>Acknowledge and override</Button>
          )}
        </>
      )}
    >
      {!row.planned_start || !row.planned_end ? (
        <EmptyState icon="calendar" title="No planned window yet" message="Enter the planned start and end to check the change against blackout periods and other changes." />
      ) : data.conflicts.length === 0 ? (
        <EmptyState icon="check" title="No conflicts" message="The planned window is clear of blackout periods and of other changes to the same systems." />
      ) : (
        <div className="stack">
          {unacknowledged.length > 0 && (
            <Banner tone="warn">
              {plural(unacknowledged.length, 'conflict')} must be resolved before this change can be scheduled or started: move the change,
              or have someone with the Approve permission acknowledge the conflict with a reason.
            </Banner>
          )}
          <ConflictList conflicts={data.conflicts} currentChangeId={row.id} />
        </div>
      )}

      <Modal open={open} title="Acknowledge and override" onClose={() => setOpen(false)} size="md">
        <form className="form" onSubmit={acknowledge} noValidate>
          <p className="muted">
            You are recording that the {unacknowledged.length === 1 ? 'conflict below is' : 'conflicts below are'} known and that the change may go ahead anyway.
            Your name and the reason are kept in the history. If the change is moved, the override no longer applies.
          </p>
          <ConflictList conflicts={unacknowledged} currentChangeId={row.id} />
          <TextArea label="Reason" required value={reason} onChange={setReason} rows={3} error={reasonError} />
          <div className="form-actions">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>Acknowledge and override</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
