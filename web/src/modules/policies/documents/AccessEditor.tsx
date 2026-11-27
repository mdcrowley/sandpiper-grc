// Who can read a document (E43-03): everyone in the organization, or only the readers listed by
// department, role, distribution group and person. Shown to the people who edit the document; the
// owner and document controllers may change it. The count of readers is live while editing, and a
// warning says when the acknowledgment audience reaches people who could not read the document.
import { useEffect, useMemo, useState } from 'react';
import {
  api, ApiError, Badge, Button, Card, ChoicesField, errorMessage, IconButton, Modal, Notice, Select, UserPicker, useDebounced, useFetch, useToast,
} from '../../../core';
import type { Row } from '../../../core';
import type { AccessList, AccessView, DistributionGroup } from './types';

interface Options {
  roles: { key: string; name: string; enabled: boolean }[];
  departments: { id: string; name: string }[];
}

export const EMPTY_ACCESS: AccessList = { access: 'organization', access_departments: [], access_roles: [], access_groups: [], access_users: [] };

/** The body sent to save (or count) an access list: an organization-wide list carries no names. */
export const accessBody = (a: AccessList): AccessList => (a.access === 'organization' ? { ...EMPTY_ACCESS } : a);

/** "12 people can read it." */
export const readersPhrase = (n: number | undefined) => (n === undefined ? '' : `${n} ${n === 1 ? 'person can' : 'people can'} read it.`);

/** The access list of GET /access as ids. */
export function listOf(view: AccessView): AccessList {
  return {
    access: view.access,
    access_departments: view.departments.map((d) => d.id),
    access_roles: view.roles.map((r) => r.key),
    access_groups: view.groups.map((g) => g.id),
    access_users: view.users.map((u) => u.id),
  };
}

/** The live count of readers for an unsaved list (POST /api/documents/readers/count). */
export function useReaderCount(list: AccessList | null, ownerId?: string | null): { count?: number; failed: boolean } {
  const key = useDebounced(list ? JSON.stringify({ ...accessBody(list), owner_id: ownerId ?? undefined }) : '', 300);
  const [state, setState] = useState<{ count?: number; failed: boolean }>({ failed: false });
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    api.post<{ count: number }>('/api/documents/readers/count', JSON.parse(key))
      .then((r) => { if (live) setState({ count: r.count, failed: false }); })
      .catch(() => { if (live) setState((s) => ({ ...s, failed: true })); });
    return () => { live = false; };
  }, [key]);
  return state;
}

/** The people named on the list, with a picker to add one and a button to take one off. */
export function PeopleField({ label = 'People', value, names, onChange }: {
  label?: string; value: string[]; names: Record<string, string>; onChange: (v: string[], added?: { id: string; name: string }) => void;
}) {
  return (
    <div className="doc-people-field">
      <UserPicker
        label={label} value={null} placeholder="Type a name to add someone"
        onChange={(id, option) => { if (id && !value.includes(id)) onChange([...value, id], { id, name: option?.label ?? 'Person' }); }}
      />
      {value.length > 0 && (
        <ul className="doc-people" aria-label={`${label} on the list`}>
          {value.map((id) => (
            <li key={id}>
              <span>{names[id] ?? 'Person'}</span>
              <IconButton icon="x" variant="ghost" label={`Take ${names[id] ?? 'this person'} off the list`} size="sm" onClick={() => onChange(value.filter((x) => x !== id))} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The fields of an access list, shared by the access editor and the new-document form. */
export function AccessFields({ value, onChange, names, setNames }: {
  value: AccessList; onChange: (next: AccessList) => void; names: Record<string, string>; setNames: (add: Record<string, string>) => void;
}) {
  const options = useFetch<Options>('/api/policies/audience-options');
  const groups = useFetch<DistributionGroup[]>('/api/documents/groups');
  const groupList = groups.data ?? [];
  const set = (patch: Partial<AccessList>) => onChange({ ...value, ...patch });
  return (
    <>
      <Select
        label="Readers" value={value.access}
        onChange={(v) => set({ access: v === 'restricted' ? 'restricted' : 'organization' })}
        options={[
          { value: 'organization', label: 'Everyone in the organization' },
          { value: 'restricted', label: 'Only these readers' },
        ]}
      />
      {value.access === 'restricted' && (
        <>
          <ChoicesField
            label="Departments" hint="Includes every department below the ones chosen." value={value.access_departments}
            onChange={(v) => set({ access_departments: v })}
            options={(options.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
          />
          <ChoicesField
            label="Roles" value={value.access_roles} onChange={(v) => set({ access_roles: v })}
            options={(options.data?.roles ?? []).map((r) => ({ value: r.key, label: r.enabled ? r.name : `${r.name} (switched off)` }))}
          />
          <ChoicesField
            label="Distribution groups" value={value.access_groups} onChange={(v) => set({ access_groups: v })}
            options={groupList.map((g) => ({ value: g.id, label: g.name }))}
            hint={groups.data && !groupList.length ? 'No distribution groups yet. Document controllers set them up under Documents > Distribution groups.' : undefined}
          />
          <PeopleField
            value={value.access_users} names={names}
            onChange={(v, added) => { set({ access_users: v }); if (added) setNames({ [added.id]: added.name }); }}
          />
          <p className="muted doc-small">The owner, the authors of its versions and document controllers can always read it.</p>
        </>
      )}
    </>
  );
}

export function AccessCard({ row, onChanged }: { row: Row; onChanged?: () => void }) {
  const toast = useToast();
  const view = useFetch<AccessView>(`/api/policies/${row.id}/access`);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AccessList>(EMPTY_ACCESS);
  const [added, setAdded] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [start, setStart] = useState('');
  const live = useReaderCount(open ? form : null, row.owner_id);

  const names = useMemo(() => ({ ...Object.fromEntries((view.data?.users ?? []).map((u) => [u.id, u.name])), ...added }), [view.data, added]);
  const retired = row.status === 'retired';

  if (view.error) {
    // The access list is shown to the people who edit documents; others simply do not see this card.
    return (view.error as ApiError).status === 403 ? null : <Card title="Who can read it"><p className="muted">{errorMessage(view.error)}</p></Card>;
  }
  const data = view.data;

  const edit = () => {
    if (!data) return;
    const saved = listOf(data);
    setForm(saved);
    setStart(JSON.stringify(saved));
    setMessage('');
    setOpen(true);
  };
  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      const out = await api.put<AccessView>(`/api/policies/${row.id}/access`, accessBody(form));
      toast.success(out.closed ? `Distribution saved. ${out.closed} acknowledgment ${out.closed === 1 ? 'request was' : 'requests were'} closed.` : 'Distribution saved.');
      setOpen(false);
      view.reload();
      onChanged?.();
    } catch (err) {
      setMessage(err instanceof ApiError && Object.keys(err.fields ?? {}).length ? Object.values(err.fields).join(' ') : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const restricted = data?.access === 'restricted';
  const nothing = data && restricted && !data.departments.length && !data.roles.length && !data.groups.length && !data.users.length;

  return (
    <Card title="Who can read it" actions={data?.can_change && !retired && <Button size="sm" onClick={edit}>Change</Button>}>
      {!data ? <p className="muted">Loading…</p> : (
        <div className="stack">
          {!restricted ? (
            <p><Badge color="blue">Everyone in the organization</Badge> <span className="muted">Every signed-in person can read the published text.</span></p>
          ) : (
            <>
              <p><Badge color="amber">Restricted distribution</Badge></p>
              {nothing ? <p className="muted">Only the owner, its authors and document controllers can read it.</p> : (
                <div className="pol-chips">
                  {data.departments.map((d) => <Badge key={d.id} color="teal">Department: {d.name}</Badge>)}
                  {data.roles.map((r) => <Badge key={r.key} color="purple">Role: {r.name}</Badge>)}
                  {data.groups.map((g) => <Badge key={g.id} color="blue">Group: {g.name}</Badge>)}
                  {data.users.map((u) => <Badge key={u.id} color="gray">{u.name}</Badge>)}
                </div>
              )}
            </>
          )}
          <p className="muted">{readersPhrase(data.reader_count)}</p>
          {data.audience_outside.length > 0 && (
            <Notice tone="warning" title="Some people asked to acknowledge cannot read it">
              {data.audience_outside.join(' ')} Widen the distribution or narrow who must acknowledge.
            </Notice>
          )}
          {restricted && (
            <p className="muted doc-small">
              People outside the distribution see no title, number or text of this document anywhere. It still counts in figures, which are the same for everyone.
            </p>
          )}
        </div>
      )}

      <Modal
        open={open} title="Who can read this document" onClose={() => setOpen(false)} size="md" dirty={open && JSON.stringify(form) !== start}
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save distribution</Button></>}
      >
        <div className="stack">
          {message && <Notice tone="error">{message}</Notice>}
          <AccessFields value={form} onChange={setForm} names={names} setNames={(a) => setAdded((n) => ({ ...n, ...a }))} />
          <div aria-live="polite" className="doc-live">
            {live.count !== undefined ? <p><strong>{readersPhrase(live.count)}</strong></p>
              : live.failed ? <p className="muted">The number of readers could not be worked out. You can still save.</p> : null}
          </div>
          <p className="muted doc-small">
            Everyone asked to acknowledge must be able to read it. Narrowing the list closes the open acknowledgment requests of people who can no longer read it.
          </p>
        </div>
      </Modal>
    </Card>
  );
}
