// E45-41: send the outcomes that need work (below the target status) to their owners as actions, in
// one step, from the outcomes board or an assessment. The dialog counts first (a dry run), then
// creates the actions and says what happened, including the outcomes that have no owner.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Checkbox, DateField, Dialog, Notice, api, errorMessage, todayInZone, useToast } from '../../core';
import { addDays } from '../../../../shared/dates.ts';

interface Item { outcome_id: string; code: string; title?: string | null; id?: string; action_id?: string }
interface Result { needsWork: number; created: Item[]; alreadyOpen: Item[]; withoutOwner: Item[]; dryRun: boolean; target: { label: string } }

/** Days until the actions fall due, as first offered. */
const DEFAULT_DAYS = 30;

export function SendToOwnersDialog({ open, onClose, frameworkId, snapshotId, priorityDefault = false }: {
  open: boolean; onClose: () => void; frameworkId: string; snapshotId?: string; priorityDefault?: boolean;
}) {
  const toast = useToast();
  const [dueOn, setDueOn] = useState(() => addDays(todayInZone(), DEFAULT_DAYS));
  const [priorityOnly, setPriorityOnly] = useState(priorityDefault);
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/frameworks/${frameworkId}/send-to-owners`;

  useEffect(() => {
    if (!open) return;
    setDone(null);
    setError(null);
    let live = true;
    api.post<Result>(url, { dry_run: true, snapshot_id: snapshotId, priority_only: priorityOnly })
      .then((r) => { if (live) setPreview(r); })
      .catch((err) => { if (live) setError(errorMessage(err)); });
    return () => { live = false; };
  }, [open, url, snapshotId, priorityOnly]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<Result>(url, { due_on: dueOn, snapshot_id: snapshotId, priority_only: priorityOnly });
      setDone(r);
      toast.success(`${r.created.length} action${r.created.length === 1 ? '' : 's'} sent to outcome owners.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const shown = done ?? preview;
  const toSend = preview?.created.length ?? 0;
  const footer = done ? (
    <Button variant="primary" onClick={onClose}>Close</Button>
  ) : (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} disabled={!preview || toSend === 0 || !dueOn} onClick={send}>
        {toSend ? `Send ${toSend} action${toSend === 1 ? '' : 's'}` : 'Send actions'}
      </Button>
    </>
  );

  return (
    <Dialog open={open} onClose={onClose} title="Send outcomes that need work to their owners" footer={footer}>
      <div className="stack">
        <p className="muted">
          Every outcome below “{shown?.target.label ?? 'the target status'}”{snapshotId ? ' in this assessment' : ''} becomes an action
          for its owner. An outcome that already has an open action from an earlier send gets no second one.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        {!done && (
          <>
            <Checkbox label="Priority outcomes only" checked={priorityOnly} onChange={setPriorityOnly} />
            <DateField label="Due on" required value={dueOn} min={todayInZone()} onChange={setDueOn} />
          </>
        )}
        {shown && (
          <ul className="fw-send-summary">
            <li><strong>{shown.needsWork}</strong> outcome{shown.needsWork === 1 ? ' needs' : 's need'} work</li>
            <li><strong>{shown.created.length}</strong> {done ? 'sent as actions' : 'will be sent as actions'}</li>
            {shown.alreadyOpen.length > 0 && <li><strong>{shown.alreadyOpen.length}</strong> already have an open action</li>}
            {shown.withoutOwner.length > 0 && <li><strong>{shown.withoutOwner.length}</strong> have no owner and are not sent</li>}
          </ul>
        )}
        {shown && shown.withoutOwner.length > 0 && (
          <Notice tone="warning" title="Outcomes without an owner">
            Give these an owner, then send again: {shown.withoutOwner.slice(0, 12).map((o, i) => (
              <span key={o.outcome_id}>{i ? ', ' : ''}<Link to={`/frameworks/outcomes/${o.outcome_id}`}>{o.code}</Link></span>
            ))}{shown.withoutOwner.length > 12 ? ` and ${shown.withoutOwner.length - 12} more` : ''}.
          </Notice>
        )}
        {done && done.created.length > 0 && (
          <p><Link to="/actions?f.source=assessment">Open the actions</Link></p>
        )}
      </div>
    </Dialog>
  );
}
