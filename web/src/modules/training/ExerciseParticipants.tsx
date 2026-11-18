// Who took part in an exercise.
import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  api, ApiError, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, errorMessage, IconButton, Loading, Modal,
  StatusChip, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';

interface Participant { id: string; name: string; role: string | null; attended: boolean }

function AddForm({ exerciseId, onDone, onCancel }: { exerciseId: string; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [names, setNames] = useState('');
  const [role, setRole] = useState('');
  const [attended, setAttended] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!names.trim()) { setError('Enter at least one name.'); return; }
    setSaving(true);
    try {
      await api.post(`/api/exercises/${exerciseId}/participants`, { names, role: role || undefined, attended });
      toast.success('Participants added.');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.fields ? Object.values(err.fields)[0] : errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <TextArea label="Names" required rows={5} value={names} error={error} onChange={setNames} hint="One person per line." />
      <TextField label="Role in the exercise" value={role} onChange={setRole} hint="Applied to everyone added now. You can add people in several goes." />
      <Checkbox label="Attended" checked={attended} onChange={setAttended} />
      <div className="form-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>Add participants</Button>
      </div>
    </form>
  );
}

export function ExerciseParticipants({ exerciseId }: { exerciseId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('exercises.edit');
  const { data, error, reload } = useFetch<Participant[]>(`/api/exercises/${exerciseId}/participants`);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Participant | null>(null);
  const [busy, setBusy] = useState(false);

  async function setAttended(p: Participant, attended: boolean) {
    try {
      await api.patch(`/api/exercises/${exerciseId}/participants/${p.id}`, { attended });
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/exercises/${exerciseId}/participants/${removing.id}`);
      toast.success('Participant removed.');
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const add = editable ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add participants</Button> : undefined;
  const present = data?.filter((p) => p.attended).length ?? 0;
  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={3} label="Loading participants" />;
  else if (!data.length) {
    body = <EmptyState icon="users" title="No participants yet" message="List who was invited, and mark who attended." action={add} />;
  } else {
    body = (
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Exercise participants</caption>
          <thead>
            <tr>
              <th scope="col">Name</th><th scope="col">Role</th><th scope="col">Attended</th>
              {editable && <th scope="col"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <td><span className="row-title">{p.name}</span></td>
                <td>{p.role || <span className="muted">—</span>}</td>
                <td>
                  {editable
                    ? <Checkbox label={p.attended ? 'Attended' : 'Did not attend'} checked={p.attended} onChange={(v) => void setAttended(p, v)} />
                    : <StatusChip color={p.attended ? 'green' : 'gray'} label={p.attended ? 'Attended' : 'Did not attend'} />}
                </td>
                {editable && (
                  <td className="num">
                    <IconButton icon="trash" label={`Remove ${p.name}`} variant="ghost" size="sm" onClick={() => setRemoving(p)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Card title={data?.length ? `Participants (${present} of ${data.length} attended)` : 'Participants'} actions={data?.length ? add : undefined} flush={!!data?.length}>
      {body}
      <Modal open={adding} title="Add participants" onClose={() => setAdding(false)}>
        {adding && <AddForm exerciseId={exerciseId} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      </Modal>
      <ConfirmDialog
        open={removing !== null} danger busy={busy} title="Remove participant"
        message={`Remove ${removing?.name ?? 'this person'} from the exercise? The change is kept in the exercise's history.`}
        confirmLabel="Remove" onConfirm={remove} onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
