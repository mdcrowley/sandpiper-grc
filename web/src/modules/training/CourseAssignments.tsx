// Assignment rules: who must take a course.
import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  api, ApiError, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, IconButton, Loading, Modal,
  Select, UserPicker, useAuth, useFetch, useToast,
} from '../../core';
import type { Audiences } from './shared';

interface Rule {
  id: string; audience_type: 'everyone' | 'role' | 'department' | 'user'; audience_label: string; people: number; created_at: string;
}

const KIND: Record<Rule['audience_type'], string> = { everyone: 'Everyone', role: 'Role', department: 'Department', user: 'Person' };

function RuleForm({ courseId, onDone, onCancel }: { courseId: string; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const audiences = useFetch<Audiences>('/api/training/audiences');
  const [type, setType] = useState<Rule['audience_type']>('everyone');
  const [target, setTarget] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    setSaving(true);
    try {
      const res = await api.post<{ records_created: number }>(`/api/courses/${courseId}/assignments`, {
        audience_type: type,
        ...(type === 'role' ? { role_id: target } : type === 'department' ? { department_id: target } : type === 'user' ? { user_id: userId } : {}),
      });
      toast.success(`Rule added. ${res.records_created} ${res.records_created === 1 ? 'person was' : 'people were'} given the course.`);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const departments = audiences.data?.departments ?? [];
  return (
    <form className="form" onSubmit={submit} noValidate>
      {message && <div className="form-error" role="alert">{message}</div>}
      <Select
        label="Assign to" required value={type} error={errors.audience_type}
        onChange={(v) => { setType((v || 'everyone') as Rule['audience_type']); setTarget(''); setUserId(null); }}
        options={[
          { value: 'everyone', label: 'Everyone with an account' }, { value: 'role', label: 'Everyone holding a role' },
          { value: 'department', label: 'Everyone in a department' }, { value: 'user', label: 'One person' },
        ]}
      />
      {type === 'role' && (
        <Select label="Role" required value={target} error={errors.role_id} placeholder="Choose a role" onChange={setTarget}
          options={(audiences.data?.roles ?? []).map((r) => ({ value: r.id, label: r.name }))} />
      )}
      {type === 'department' && (
        <Select label="Department" required value={target} error={errors.department_id} placeholder="Choose a department" onChange={setTarget}
          options={departments.map((d) => ({ value: d.id, label: d.name }))}
          hint={audiences.data && !departments.length ? 'No departments are set up yet. An administrator adds them under Administration.' : undefined} />
      )}
      {type === 'user' && <UserPicker label="Person" required value={userId} error={errors.user_id} onChange={(id) => setUserId(id)} />}
      <p className="muted">
        The rule gives the course to every active user it matches, now and whenever someone new matches it. Rules are checked when a rule
        is added and once a day. People without an account are not covered by rules: record or import their training instead.
      </p>
      <div className="form-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>Add rule</Button>
      </div>
    </form>
  );
}

export function CourseAssignments({ courseId, onChanged }: { courseId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('training.edit');
  const { data, error, reload } = useFetch<Rule[]>(`/api/courses/${courseId}/assignments`);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Rule | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/courses/${courseId}/assignments/${removing.id}`);
      toast.success('Rule removed. Records already raised are kept.');
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const add = editable ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add rule</Button> : undefined;
  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={3} label="Loading assignment rules" />;
  else if (!data.length) {
    body = (
      <EmptyState
        icon="users" title="No assignment rules"
        message="Without a rule nobody is given this course automatically. Add a rule for everyone, a role, a department or one person."
        action={add}
      />
    );
  } else {
    body = (
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Assignment rules for this course</caption>
          <thead>
            <tr>
              <th scope="col">Assigned to</th><th scope="col">Kind</th><th scope="col" className="num">Active users matched</th><th scope="col">Added</th>
              {editable && <th scope="col"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id}>
                <td><span className="row-title">{r.audience_label}</span></td>
                <td><Badge color="gray">{KIND[r.audience_type]}</Badge></td>
                <td className="num">{r.people}</td>
                <td>{formatDate(r.created_at)}</td>
                {editable && (
                  <td className="num">
                    <IconButton icon="trash" label={`Remove the rule for ${r.audience_label}`} variant="ghost" size="sm" onClick={() => setRemoving(r)} />
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
    <Card title="Assignment rules" actions={data?.length ? add : undefined} flush={!!data?.length}>
      {body}
      <Modal open={adding} title="Add assignment rule" onClose={() => setAdding(false)}>
        {adding && <RuleForm courseId={courseId} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); reload(); onChanged(); }} />}
      </Modal>
      <ConfirmDialog
        open={removing !== null} danger busy={busy} title="Remove assignment rule"
        message={`Stop assigning this course to ${removing?.audience_label ?? 'this audience'}? Records already raised stay as they are.`}
        confirmLabel="Remove" onConfirm={remove} onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
