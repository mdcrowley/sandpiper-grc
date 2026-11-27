// Administration > Registers (E41-06): defining a new kind of record, changing it, choosing who may use
// it, and removing one that holds nothing. Fields are custom fields of the register's record type and
// its statuses a list, both changed on their own administration pages, which this one links to.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  adminApi, ApiError, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, Loading, Menu, Modal, Notice, PageHeader,
  Select, StatusChip, Switch, TableWrap, TextArea, TextField, useFetch, useMeta, useToast, useUnsavedChanges,
} from '../../core';
import { REGISTERS_CHANGED } from './NavExtras';

interface FieldSummary { key: string; label: string; type: string; required: boolean }
export interface AdminRegister {
  id: string; key: string; label: string; plural: string; description: string; prefix: string; nav_group: string; icon: string;
  title_label: string; evidence: boolean; type: string; area: string; statusList: string; state: 'ready' | 'waiting' | 'clash';
  route: string; records: number; storedRecords: number; fields: FieldSummary[]; permissions: string[];
}
interface AdminList { registers: AdminRegister[]; navGroups: string[]; icons: string[]; schemaChanges: boolean }

const ICON_LABELS: Record<string, string> = {
  folder: 'Folder', clipboard: 'Clipboard', book: 'Book', box: 'Box', tag: 'Tag', alert: 'Warning sign', shield: 'Shield', bus: 'Bus',
  building: 'Building', key: 'Key', calendar: 'Calendar', users: 'People', star: 'Star', flask: 'Flask',
};
const FIELD_TYPES: Record<string, string> = {
  text: 'Text', longtext: 'Long text', number: 'Number', currency: 'Amount', date: 'Date', boolean: 'Yes or no', select: 'Choice',
  multiselect: 'Several choices', user: 'Person', ref: 'Link to a record',
};
const STATE: Record<AdminRegister['state'], { label: string; color: string }> = {
  ready: { label: 'In use', color: 'green' },
  waiting: { label: 'Waiting for the database owner', color: 'amber' },
  clash: { label: 'Name taken by the application', color: 'red' },
};

type Draft = { key: string; label: string; plural: string; description: string; prefix: string; nav_group: string; icon: string; title_label: string; evidence: boolean };
const EMPTY: Draft = { key: '', label: '', plural: '', description: '', prefix: '', nav_group: 'Governance and records', icon: 'folder', title_label: 'Title', evidence: false };
const draftOf = (r: AdminRegister): Draft => ({
  key: r.key, label: r.label, plural: r.plural, description: r.description, prefix: r.prefix.replace(/-$/, ''), nav_group: r.nav_group,
  icon: r.icon, title_label: r.title_label, evidence: r.evidence,
});
const changed = () => window.dispatchEvent(new Event(REGISTERS_CHANGED));

/** The fields of a register's definition, for the New dialog and the Details card. */
function DefinitionFields({ draft, set, errors, groups, icons, isNew }: {
  draft: Draft; set: (d: Partial<Draft>) => void; errors: Record<string, string>; groups: string[]; icons: string[]; isNew: boolean;
}) {
  return (
    <>
      <TextField label="Register name" required value={draft.plural} onChange={(v) => set({ plural: v })} error={errors.plural} maxLength={60}
        hint='Shown in the menu and as the list title, for example "Lost property" or "Key log".' />
      <TextField label="One record is called" required value={draft.label} onChange={(v) => set({ label: v })} error={errors.label} maxLength={60}
        hint='For example "Lost property item" or "Key issued". Used in the Create menu and on record pages.' />
      {isNew && (
        <TextField label="Name in addresses and permissions" value={draft.key} onChange={(v) => set({ key: v })} error={errors.key} maxLength={30}
          hint="Lower-case letters, numbers and underscores; made from the register name when left empty. It cannot be changed later." />
      )}
      <TextField label="Reference prefix" required value={draft.prefix} onChange={(v) => set({ prefix: v.toUpperCase() })} error={errors.prefix} maxLength={9}
        hint={`Records are numbered ${(draft.prefix || 'LP').replace(/-$/, '')}-00001, ${(draft.prefix || 'LP').replace(/-$/, '')}-00002 and so on.`} />
      <TextField label="Name of the main field" value={draft.title_label} onChange={(v) => set({ title_label: v })} error={errors.title_label} maxLength={40}
        hint='The field every record must have, for example "Item" or "Key".' />
      <Select label="Menu group" value={draft.nav_group} onChange={(v) => set({ nav_group: v ?? 'Governance and records' })} error={errors.nav_group}
        options={groups.map((g) => ({ value: g, label: g }))} />
      <Select label="Icon" value={draft.icon} onChange={(v) => set({ icon: v ?? 'folder' })} error={errors.icon}
        options={icons.map((i) => ({ value: i, label: ICON_LABELS[i] ?? i }))} />
      <TextArea label="Description" value={draft.description} onChange={(v) => set({ description: v })} error={errors.description} rows={2}
        hint="What the register is for; shown on the Registers page and under Administration > Features." />
      <Switch label="Files on these records are evidence" checked={draft.evidence} onChange={(v) => set({ evidence: v })}
        hint="The Attachments tab records new files as evidence, with a collection date and an optional expiry date." />
    </>
  );
}

const body = (d: Draft, isNew: boolean) => ({
  ...(isNew ? { key: d.key.trim() || undefined } : {}),
  label: d.label, plural: d.plural, description: d.description, prefix: d.prefix, nav_group: d.nav_group, icon: d.icon, title_label: d.title_label, evidence: d.evidence,
});

export function AdminRegistersPage() {
  const { data, error, reload } = useFetch<AdminList>('/api/admin/registers');
  const meta = useMeta();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = open && JSON.stringify(draft) !== JSON.stringify(EMPTY);
  const unsaved = useUnsavedChanges(dirty);

  const create = async () => {
    setBusy(true);
    setErrors({});
    try {
      const made = await adminApi.post<AdminRegister>('/api/admin/registers', body(draft, true));
      unsaved.release();
      toast.success(`Register "${made.plural}" defined.`);
      meta.reload();
      changed();
      setOpen(false);
      navigate(`/admin/registers/${made.key}`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title="Registers"
        subtitle="New kinds of record for things your organization keeps track of that have no part of their own: lost property, keys issued, visitors, permits. Each gets a list, record pages, search, history, files, imports, exports, reports, permissions and a switch."
        actions={<Button variant="primary" icon="plus" onClick={() => { setDraft(EMPTY); setErrors({}); setOpen(true); }}>New register</Button>}
      />
      {data && !data.schemaChanges && (
        <Notice tone="warning" title="New registers wait for the database owner">
          This server&apos;s database account may not change the database, so a new register is listed as waiting until migrate runs as the
          owner account (see Operations in the documentation).
        </Notice>
      )}
      {error ? <Card><ErrorState error={error} onRetry={reload} /></Card>
        : !data ? <Card><Loading lines={4} label="Loading the registers" /></Card>
        : data.registers.length === 0 ? (
          <Card>
            <EmptyState icon="folder" title="No registers yet" message="Define one with New register. Registers that are switched off are listed only under Administration > Features." />
          </Card>
        ) : (
          <Card flush title="Defined registers">
            <TableWrap label="Defined registers" fit>
              <table className="table">
                <caption className="sr-only">Defined registers</caption>
                <thead>
                  <tr>
                    <th scope="col">Register</th>
                    <th scope="col">Records</th>
                    <th scope="col" data-priority="2">Fields</th>
                    <th scope="col" data-priority="2">Menu group</th>
                    <th scope="col" data-priority="3">Prefix</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {data.registers.map((r) => (
                    <tr key={r.key}>
                      <td><Link to={`/admin/registers/${r.key}`}>{r.plural}</Link></td>
                      <td>{r.records}</td>
                      <td data-priority="2">{r.fields.length}</td>
                      <td data-priority="2">{r.nav_group}</td>
                      <td data-priority="3"><span className="ref">{r.prefix}</span></td>
                      <td><StatusChip color={STATE[r.state].color as 'green'} label={STATE[r.state].label} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        )}
      <Modal open={open} title="New register" onClose={() => setOpen(false)} dirty={dirty} size="md">
        <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <DefinitionFields draft={draft} set={(d) => setDraft({ ...draft, ...d })} errors={errors} groups={data?.navGroups ?? []} icons={data?.icons ?? []} isNew />
          <div className="form-actions">
            <Button type="button" onClick={unsaved.guard(() => setOpen(false))}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>Define register</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

interface RoleRow { id: string; key: string; name: string; grants: string[]; enabled: boolean }
const ACTIONS = [['view', 'View'], ['create', 'Create'], ['edit', 'Edit'], ['delete', 'Delete'], ['export', 'Export']] as const;

/** Which roles may do what with the register: the role grants `<key>.<action>`, changed here or under Roles. */
function WhoMayUseIt({ reg }: { reg: AdminRegister }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<{ roles: RoleRow[] }>('/api/admin/roles');
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const roles = useMemo(() => (data?.roles ?? []).filter((r) => r.enabled || r.grants.some((g) => g.startsWith(`${reg.key}.`))), [data, reg.key]);
  const dirty = Object.keys(edits).length > 0;
  const unsaved = useUnsavedChanges(dirty);
  const all = (r: RoleRow) => r.grants.includes('*') || r.grants.includes(`${reg.key}.*`);
  const has = (r: RoleRow, a: string) => all(r) || (edits[r.id] ?? r.grants).includes(`${reg.key}.${a}`);
  const toggle = (r: RoleRow, a: string, on: boolean) => {
    const base = edits[r.id] ?? r.grants;
    const next = on ? [...base, `${reg.key}.${a}`] : base.filter((g) => g !== `${reg.key}.${a}`);
    const same = next.length === r.grants.length && next.every((g) => r.grants.includes(g));
    const { [r.id]: _drop, ...rest } = edits;
    setEdits(same ? rest : { ...rest, [r.id]: next });
  };
  const save = async () => {
    setBusy(true);
    try {
      for (const [id, grants] of Object.entries(edits)) await adminApi.patch(`/api/admin/roles/${id}`, { grants: [...new Set(grants)] });
      unsaved.release();
      setEdits({});
      toast.success('Permissions saved.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (error) return <Card title="Who may use it"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="Who may use it"><Loading lines={3} label="Loading the roles" /></Card>;
  return (
    <Card
      title="Who may use it"
      flush
      actions={<Button variant="primary" size="sm" disabled={!dirty} loading={busy} onClick={() => void save()}>Save permissions</Button>}
    >
      <p className="reg-card-text muted">
        The register&apos;s permissions are {reg.permissions.map((p, i) => <span key={p}>{i ? ', ' : ''}<code>{p}</code></span>)}. Roles
        grant them here or under <Link to="/admin/roles">Roles</Link>, where they can also be limited to people&apos;s own departments or sites.
        Saving asks for your password again.
      </p>
      <TableWrap label="Roles and what they may do in this register" fit>
        <table className="table">
          <caption className="sr-only">Roles and what they may do in this register</caption>
          <thead><tr><th scope="col">Role</th>{ACTIONS.map(([a, l]) => <th key={a} scope="col">{l}</th>)}</tr></thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.name}</strong>{!r.enabled && <span className="muted"> (switched off)</span>}</td>
                {ACTIONS.map(([a, l]) => (
                  <td key={a}>
                    <Checkbox label={`${l}: ${r.name}`} className="reg-check" checked={has(r, a)} disabled={all(r)} onChange={(v) => toggle(r, a, v)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

export function AdminRegisterPage() {
  const { key = '' } = useParams();
  const toast = useToast();
  const meta = useMeta();
  const navigate = useNavigate();
  const { data: reg, error, reload } = useFetch<AdminRegister>(`/api/admin/registers/${encodeURIComponent(key)}`);
  const lists = useFetch<AdminList>('/api/admin/registers');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const current = draft ?? (reg ? draftOf(reg) : null);
  const dirty = Boolean(reg && draft && JSON.stringify(draft) !== JSON.stringify(draftOf(reg)));
  const unsaved = useUnsavedChanges(dirty);

  if (error) {
    return error instanceof ApiError && error.status === 404
      ? <EmptyState icon="folder" title="Register not found" message="It may have been removed or switched off (Administration > Features)." action={<Button onClick={() => navigate('/admin/registers')}>Back to registers</Button>} />
      : <Card><ErrorState error={error} onRetry={reload} /></Card>;
  }
  if (!reg || !current) return <Loading lines={6} label="Loading the register" />;

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await adminApi.patch(`/api/admin/registers/${reg.key}`, body(current, false));
      unsaved.release();
      setDraft(null);
      toast.success('Register saved.');
      meta.reload();
      changed();
      reload();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await adminApi.del(`/api/admin/registers/${reg.key}`);
      toast.success(`Register "${reg.plural}" removed.`);
      meta.reload();
      changed();
      navigate('/admin/registers');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setRemoving(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title={reg.plural}
        subtitle={`${reg.records} record${reg.records === 1 ? '' : 's'} · numbered ${reg.prefix}00001 · in the ${reg.nav_group} menu`}
        status={<StatusChip color={STATE[reg.state].color as 'green'} label={STATE[reg.state].label} />}
        breadcrumbs={[{ label: 'Registers', to: '/admin/registers' }, { label: reg.plural }]}
        actions={(
          <>
            {reg.state === 'ready' && <Button variant="primary" icon="external" onClick={() => navigate(reg.route)}>Open register</Button>}
            <Menu label="More actions" iconOnly icon="more" items={[{ label: 'Remove register', icon: 'trash', danger: true, onSelect: () => setRemoving(true) }]} />
          </>
        )}
      />
      {reg.state === 'waiting' && (
        <Notice tone="warning" title="Waiting for the database owner">
          The register is saved, but its records need a database change that this server&apos;s account may not make. It comes into use when
          migrate runs as the owner account.
        </Notice>
      )}
      <div className="reg-grid">
        <Card title="Details">
          <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <DefinitionFields draft={current} set={(d) => setDraft({ ...current, ...d })} errors={errors} groups={lists.data?.navGroups ?? [reg.nav_group]} icons={lists.data?.icons ?? [reg.icon]} isNew={false} />
            <p className="muted">
              Name in addresses and permissions: <code>{reg.key}</code>. A new prefix numbers new records only.
            </p>
            <div className="form-actions">
              <Button type="button" disabled={!dirty} onClick={() => { setDraft(null); setErrors({}); }}>Undo changes</Button>
              <Button type="submit" variant="primary" disabled={!dirty} loading={busy}>Save</Button>
            </div>
          </form>
        </Card>
        <div className="stack">
          <Card title="Fields" actions={<Button size="sm" icon="edit" onClick={() => navigate(`/admin/custom-fields?type=${reg.type}`)}>Add or change fields</Button>}>
            <p className="muted">
              Every record has a reference, {reg.title_label.toLowerCase() === 'title' ? 'a title' : `“${reg.title_label}”`}, a status, an owner, a
              department, a site and a description. Add the register&apos;s own fields under Custom fields.
            </p>
            {reg.fields.length === 0 ? <p>No fields of its own yet.</p> : (
              <ul className="reg-fields">
                {reg.fields.map((f) => (
                  <li key={f.key}><strong>{f.label}</strong> <span className="muted">{FIELD_TYPES[f.type] ?? f.type}{f.required ? ', required' : ''}</span></li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Statuses and lifecycle">
            <p className="muted">
              New records take the first status in the list. Change the statuses under{' '}
              <Link to={`/admin/lists?list=${encodeURIComponent(reg.statusList)}`}>Lists</Link>, and which moves between them are allowed under{' '}
              <Link to="/admin/lifecycles">Lifecycles</Link>. The register can be switched off under <Link to="/admin/features">Features</Link>; its
              records are kept.
            </p>
          </Card>
        </div>
      </div>
      {reg.state === 'ready' && <WhoMayUseIt reg={reg} />}
      <Modal open={removing} size="sm" title={`Remove “${reg.plural}”?`} onClose={() => setRemoving(false)}>
        <p>
          {reg.storedRecords > 0
            ? 'This register still holds records, so it cannot be removed. Delete its records first, or switch it off under Administration > Features to keep them.'
            : 'The register, its fields and the roles’ permissions for it are removed. This cannot be undone.'}
        </p>
        <div className="form-actions">
          <Button onClick={() => setRemoving(false)}>Cancel</Button>
          {reg.storedRecords === 0 && <Button variant="danger" loading={busy} onClick={() => void remove()}>Remove register</Button>}
        </div>
      </Modal>
    </div>
  );
}
