import { useState } from 'react';
import {
  api, ApiError, Button, Card, ConfirmDialog, DateField, EmptyState, errorMessage, ErrorState, formatDate, Loading, Modal,
  StatusChip, TextField, useAuth, useFetch, useToast,
} from '../../core';
import { todayIso, type Milestone } from './types';

function MilestoneDialog({ projectId, open, milestone, onClose, onSaved }: {
  projectId: string; open: boolean; milestone: Milestone | null; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [doneOn, setDoneOn] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<string | null | undefined>(undefined);

  // Reset the form each time the dialog opens for a different milestone.
  const key = open ? milestone?.id ?? null : undefined;
  if (key !== seen) {
    setSeen(key);
    if (open) {
      setName(milestone?.name ?? ''); setDueOn(milestone?.due_on ?? ''); setDoneOn(milestone?.done_on ?? '');
      setFields({}); setFormError('');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing: Record<string, string> = {};
    if (!name.trim()) missing.name = 'Name is required.';
    if (!dueOn) missing.due_on = 'Due date is required.';
    setFields(missing);
    setFormError('');
    if (Object.keys(missing).length) return;
    const body = { name, due_on: dueOn, done_on: doneOn || null };
    setBusy(true);
    try {
      if (milestone) await api.patch(`/api/projects/${projectId}/milestones/${milestone.id}`, body);
      else await api.post(`/api/projects/${projectId}/milestones`, body);
      toast.success(milestone ? 'Milestone saved.' : 'Milestone added.');
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={milestone ? 'Edit milestone' : 'Add milestone'} onClose={onClose} size="sm">
      <form className="form" onSubmit={submit} noValidate>
        <TextField label="Name" required value={name} onChange={setName} error={fields.name} autoFocus />
        <DateField label="Due date" required value={dueOn} onChange={setDueOn} error={fields.due_on} />
        <DateField label="Completed on" value={doneOn} onChange={setDoneOn} error={fields.done_on} hint="Leave empty until it is done" />
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>{milestone ? 'Save changes' : 'Add milestone'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Milestones for the timeline view: name, due date and completion date. */
export function MilestonesTab({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Milestone[]>(`/api/projects/${projectId}/milestones`);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removing, setRemoving] = useState<Milestone | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('projects.edit');
  const today = todayIso();
  const refresh = () => { reload(); onChanged(); };

  async function act(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  if (error) return <ErrorState title="Milestones could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const add = canEdit
    ? <Button variant="primary" icon="plus" onClick={() => { setEditing(null); setDialogOpen(true); }}>Add milestone</Button>
    : undefined;

  return (
    <div className="stack">
      <Card title="Milestones" actions={data.length ? add : undefined} flush>
        {data.length === 0 ? (
          <EmptyState icon="calendar" title="No milestones yet" message="Add the handful of dates that matter. They appear on the portfolio timeline." action={add} />
        ) : (
          <div className="table-wrap prj-scroll">
            <table className="table">
              <thead>
                <tr><th scope="col">Milestone</th><th scope="col">Due</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id}>
                    <td className="row-title">{m.name}</td>
                    <td>{formatDate(m.due_on)}</td>
                    <td>
                      {m.done_on
                        ? <StatusChip color={m.done_on > m.due_on ? 'amber' : 'green'} label={`Done ${formatDate(m.done_on)}${m.done_on > m.due_on ? ' (late)' : ''}`} />
                        : m.due_on < today ? <StatusChip color="red" label="Overdue" /> : <StatusChip color="blue" label="To do" />}
                    </td>
                    <td>
                      {canEdit && (
                        <span className="row" style={{ justifyContent: 'flex-end' }}>
                          {!m.done_on && (
                            <Button size="sm" icon="check" disabled={busy} onClick={() => act(() => api.patch(`/api/projects/${projectId}/milestones/${m.id}`, { done_on: today }), 'Milestone marked as done.')}>
                              Mark done
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" icon="edit" onClick={() => { setEditing(m); setDialogOpen(true); }}>Edit</Button>
                          <Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(m)}>Delete</Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <MilestoneDialog projectId={projectId} open={dialogOpen} milestone={editing} onClose={() => setDialogOpen(false)} onSaved={refresh} />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Delete this milestone?"
        message={`"${removing?.name ?? ''}" will be removed from the project and the timeline.`}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => act(() => api.del(`/api/projects/${projectId}/milestones/${removing!.id}`), 'Milestone deleted.')}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
