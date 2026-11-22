import { useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, Loading, Modal, TableWrap, TextField, useFetch, useToast,
} from '../../core';
import type { Department } from './common';

export function DepartmentsCard() {
  const toast = useToast();
  const { data, error, reload } = useFetch<Department[]>('/api/admin/departments');
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [removing, setRemoving] = useState<Department | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (d: Department | 'new') => { setEditing(d); setName(d === 'new' ? '' : d.name); setNameError(''); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setNameError('Enter a name.'); return; }
    setBusy(true);
    try {
      if (editing === 'new') await api.post('/api/admin/departments', { name: name.trim() });
      else if (editing) await api.patch(`/api/admin/departments/${editing.id}`, { name: name.trim() });
      toast.success('Department saved.');
      setEditing(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields.name) setNameError(err.fields.name);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/admin/departments/${removing.id}`);
      toast.success('Department removed.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  return (
    <Card title="Departments" flush actions={<Button size="sm" icon="plus" onClick={() => open('new')}>Add</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="card-body"><Loading lines={3} /></div>
        : data.length === 0 ? <EmptyState icon="building" title="No departments yet" message="Add departments so that people can be grouped." />
        : (
          <TableWrap label="Departments">
            <table className="table">
              <thead><tr><th scope="col">Name</th><th scope="col" className="num">People</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td className="num">{d.members}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => open(d)}>Rename</Button>
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(d)}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      <Modal open={editing !== null} title={editing === 'new' ? 'Add department' : 'Rename department'} size="sm" onClose={() => setEditing(null)} dirty={editing !== null && name !== (editing === 'new' ? '' : editing.name)}>
        <form className="form" onSubmit={submit} noValidate>
          <TextField label="Name" required autoFocus maxLength={80} value={name} onChange={setName} error={nameError || undefined} />
          <div className="form-actions">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>Save</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(removing)} danger busy={busy} title="Remove this department?" confirmLabel="Remove"
        message={removing ? `${removing.members} ${removing.members === 1 ? 'person' : 'people'} in “${removing.name}” will be left without a department. The removal is recorded in the audit log.` : ''}
        onConfirm={() => void remove()} onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
