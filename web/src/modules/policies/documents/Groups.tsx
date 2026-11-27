// Distribution groups (E43-03): named lists of readers ("Network operations on-call", "Maintenance
// supervisors") reused across many documents. A group holds people, and may also take in everyone
// with chosen roles or in chosen departments. Managed by document controllers (policies.administer).
import { useEffect, useState } from 'react';
import {
  api, ApiError, Button, Card, ChoicesField, ConfirmDialog, EmptyState, ErrorState, errorMessage, Loading, Modal, Notice, PageHeader, TableWrap,
  TextArea, TextField, UserPicker, useFetch, useToast,
} from '../../../core';
import { PeopleField } from './AccessEditor';
import { DocumentsTabs } from './DocumentsTabs';
import type { DistributionGroup } from './types';

interface Options { roles: { key: string; name: string; enabled: boolean }[]; departments: { id: string; name: string }[] }

interface Draft { name: string; description: string; owner_id: string | null; roles: string[]; departments: string[]; members: string[] }

function GroupDialog({ group, options, onClose, onSaved }: { group: DistributionGroup | null; options: Options | undefined; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const full = useFetch<DistributionGroup>(group ? `/api/documents/groups/${group.id}` : null);
  const [draft, setDraft] = useState<Draft | null>(group ? null : { name: '', description: '', owner_id: null, roles: [], departments: [], members: [] });
  const [names, setNames] = useState<Record<string, string>>({});
  const [start, setStart] = useState(group ? '' : JSON.stringify(draft));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Editing: start from the group as saved, with its members.
  useEffect(() => {
    if (!group || draft || !full.data) return;
    const d: Draft = {
      name: full.data.name, description: full.data.description ?? '', owner_id: full.data.owner_id, roles: full.data.roles ?? [],
      departments: full.data.departments ?? [], members: (full.data.members ?? []).map((m) => m.user_id),
    };
    setDraft(d);
    setStart(JSON.stringify(d));
    setNames(Object.fromEntries((full.data.members ?? []).map((m) => [m.user_id, m.name])));
  }, [group, draft, full.data]);

  const save = async () => {
    if (!draft) return;
    setErrors({});
    setMessage('');
    if (!draft.name.trim()) { setErrors({ name: 'Give the group a name.' }); return; }
    setBusy(true);
    const body = { name: draft.name.trim(), description: draft.description || null, owner_id: draft.owner_id, roles: draft.roles, departments: draft.departments };
    try {
      if (group) {
        await api.patch(`/api/documents/groups/${group.id}`, body);
        await api.put(`/api/documents/groups/${group.id}/members`, { user_ids: draft.members });
      } else {
        await api.post('/api/documents/groups', { ...body, members: draft.members });
      }
      toast.success(group ? 'Group saved.' : 'Group created.');
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields ?? {}).length) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  return (
    <Modal
      open title={group ? `Edit ${group.name}` : 'New distribution group'} onClose={onClose} size="md"
      dirty={Boolean(draft) && JSON.stringify(draft) !== start}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!draft} onClick={() => void save()}>{group ? 'Save group' : 'Create group'}</Button></>}
    >
      {full.error ? <ErrorState error={full.error} onRetry={full.reload} /> : !draft ? <Loading lines={5} /> : (
        <div className="stack">
          {message && <Notice tone="error">{message}</Notice>}
          <TextField label="Name" required value={draft.name} error={errors.name} onChange={(v) => set({ name: v })} placeholder="For example: Maintenance supervisors" />
          <TextArea label="Description" rows={2} value={draft.description} error={errors.description} onChange={(v) => set({ description: v })} />
          <UserPicker label="Owner" value={draft.owner_id} display={group?.owner_name ?? undefined} error={errors.owner_id} hint="Who keeps the list up to date."
            onChange={(id) => set({ owner_id: id })} />
          <PeopleField label="Members" value={draft.members} names={names}
            onChange={(v, added) => { set({ members: v }); if (added) setNames((n) => ({ ...n, [added.id]: added.name })); }} />
          <ChoicesField label="Everyone with these roles" value={draft.roles} error={errors.roles} onChange={(v) => set({ roles: v })}
            options={(options?.roles ?? []).map((r) => ({ value: r.key, label: r.enabled ? r.name : `${r.name} (switched off)` }))} />
          <ChoicesField label="Everyone in these departments" value={draft.departments} error={errors.departments} hint="Includes the departments below them."
            onChange={(v) => set({ departments: v })} options={(options?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} />
        </div>
      )}
    </Modal>
  );
}

export function DistributionGroups() {
  const toast = useToast();
  const { data, error, reload } = useFetch<DistributionGroup[]>('/api/documents/groups');
  const options = useFetch<Options>('/api/policies/audience-options');
  const [editing, setEditing] = useState<DistributionGroup | 'new' | null>(null);
  const [removing, setRemoving] = useState<DistributionGroup | null>(null);
  const [busy, setBusy] = useState(false);

  const roleName = (k: string) => options.data?.roles.find((r) => r.key === k)?.name ?? k;
  const deptName = (id: string) => options.data?.departments.find((d) => d.id === id)?.name ?? 'Department no longer exists';

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/documents/groups/${removing.id}`);
      toast.success(`${removing.name} deleted.`);
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(err instanceof ApiError && err.code === 'in_use'
        ? `${removing.name} is still used by ${removing.document_count === 1 ? 'a document' : `${removing.document_count} documents`}. Take it off their distribution first.`
        : errorMessage(err));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={5} label="Loading distribution groups" />;
  else if (!data.length) {
    body = (
      <EmptyState icon="users" title="No distribution groups yet"
        message="A group is a named list of readers, such as an on-call team, that many restricted documents can share."
        action={<Button variant="primary" onClick={() => setEditing('new')}>New group</Button>} />
    );
  } else {
    body = (
      <TableWrap label="Distribution groups" fit>
        <table className="table">
          <caption className="sr-only">Distribution groups</caption>
          <thead><tr>
            <th scope="col" data-priority="1">Group</th><th scope="col" data-priority="1">Members</th><th scope="col" data-priority="2">Also includes</th>
            <th scope="col" data-priority="2">Documents</th><th scope="col" data-priority="3">Owner</th><th scope="col" data-priority="1"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {data.map((g) => (
              <tr key={g.id}>
                <td className="pol-wrap"><strong>{g.name}</strong>{g.description && <><br /><span className="muted doc-small">{g.description}</span></>}</td>
                <td>{g.member_count}</td>
                <td className="pol-wrap">
                  {[...g.roles.map((r) => `Role: ${roleName(r)}`), ...g.departments.map((d) => `Department: ${deptName(d)}`)].join(', ') || <span className="muted">—</span>}
                </td>
                <td>{g.document_count}</td>
                <td>{g.owner_name ?? <span className="muted">—</span>}</td>
                <td>
                  <span className="row doc-row-actions">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>Edit<span className="sr-only"> {g.name}</span></Button>
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(g)}>Delete<span className="sr-only"> {g.name}</span></Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Distribution groups"
        subtitle="Named lists of readers for restricted documents. Changing a group changes who can read every document that uses it."
        actions={<Button variant="primary" icon="plus" onClick={() => setEditing('new')}>New group</Button>}
      />
      <DocumentsTabs active="groups" />
      <Card flush>{body}</Card>
      {editing && <GroupDialog group={editing === 'new' ? null : editing} options={options.data} onClose={() => setEditing(null)} onSaved={reload} />}
      <ConfirmDialog
        open={Boolean(removing)} busy={busy} danger title={`Delete ${removing?.name ?? 'group'}?`}
        message="The group is removed. A group still used by a document cannot be deleted."
        confirmLabel="Delete group" onCancel={() => setRemoving(null)} onConfirm={() => void remove()}
      />
    </div>
  );
}
