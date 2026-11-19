import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiError, Badge, Button, Card, EmptyState, ErrorState, errorMessage, Loading, Modal, PageHeader, StatusChip, TextArea,
  TextField, useFetch, useToast,
} from '../../core';
import { Notice } from './common';
import type { Role, RolesResponse } from './common';
import { adminApi } from './reauth';
import { Switch } from './Switch';

/** Wider-audience roles that ship switched off; an administrator switches each on when ready. */
export const AUDIENCE_ROLES = ['requester', 'approver', 'executive_viewer', 'auditor'];

export function summariseGrants(grants: string[]): string {
  if (grants.includes('*')) return 'Everything';
  if (grants.length === 0) return 'Nothing';
  const modules = new Set(grants.map((g) => g.split('.')[0]));
  return `${grants.length} permission${grants.length === 1 ? '' : 's'} in ${modules.size} area${modules.size === 1 ? '' : 's'}`;
}

export function RolesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useFetch<RolesResponse>('/api/admin/roles');
  const [saving, setSaving] = useState('');
  const [creating, setCreating] = useState(false);
  // Default permissions added by a newer version are applied only when an administrator asks (never silently).
  const defaults = useFetch<{ pending: number; roles: { key: string; name: string; missing: string[]; description: string | null }[] }>('/api/admin/roles/default-grants');
  const syncDefaults = async () => {
    setSaving('defaults');
    try {
      const res = await adminApi.post<{ added: number }>('/api/admin/roles/sync-default-grants');
      toast.success(`Default permissions synchronised: ${res.added} added.`);
      reload();
      defaults.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving('');
    }
  };

  const toggle = async (role: Role, on: boolean) => {
    setSaving(role.id);
    try {
      await adminApi.post(`/api/admin/roles/${role.id}/${on ? 'enable' : 'disable'}`);
      toast.success(`${role.name} switched ${on ? 'on' : 'off'}.`);
      reload();
    } catch (err) {
      toast.error(err instanceof ApiError && err.fields.enabled ? err.fields.enabled : errorMessage(err));
    } finally {
      setSaving('');
    }
  };

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="A role is a named set of permissions. People get access only through the roles they hold."
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New role</Button>}
      />
      <div className="stack adm-notices">
        <Notice>
          <strong>Start with a small team.</strong> The Requester, Approver, Executive viewer and Auditor roles are
          switched off until you open the application to those audiences. While a role is off its members keep the role but get none of its permissions;
          switching it on takes effect at once, with no restart. Every switch is recorded in the audit log.
        </Notice>
        {defaults.data && defaults.data.roles.length > 0 && (
          <Notice tone="caution" icon="refresh">
            <p>
              <strong>This version has newer defaults for some built-in roles.</strong> Nothing changes until you apply them.
              Applying only adds permissions (and replaces a description you have not edited); it never removes anything.
            </p>
            <ul className="adm-plain-list">
              {defaults.data.roles.map((r) => (
                <li key={r.key}>
                  <strong>{r.name}:</strong> {r.missing.length ? <>adds {r.missing.map((g) => <code key={g}>{g}</code>)}</> : 'no new permissions'}{r.description ? '; new description' : ''}
                </li>
              ))}
            </ul>
            <Button size="sm" loading={saving === 'defaults'} onClick={() => void syncDefaults()}>Apply default permissions</Button>
          </Notice>
        )}
      </div>
      <Card flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={8} label="Loading roles" /></div>
          : data.roles.length === 0 ? <EmptyState icon="users" title="No roles" message="Add a role to start granting access." action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New role</Button>} />
          : (
            <div className="table-wrap adm-table-frame">
              <table className="table">
                <thead>
                  <tr><th scope="col">Role</th><th scope="col">Access</th><th scope="col" className="num">Members</th><th scope="col">Second factor</th><th scope="col">Switched on</th></tr>
                </thead>
                <tbody>
                  {data.roles.map((r) => (
                    <tr key={r.id} className="row-link" onClick={() => navigate(`/admin/roles/${r.id}`)}>
                      <td className="adm-wrap adm-role-cell">
                        <Link className="row-title" to={`/admin/roles/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>{' '}
                        {AUDIENCE_ROLES.includes(r.key) && <Badge color="purple">Audience switch</Badge>}
                        {r.description && <div className="muted">{r.description}</div>}
                      </td>
                      <td>{summariseGrants(r.grants)}</td>
                      <td className="num">{r.members}</td>
                      <td>{r.requires_mfa ? <StatusChip color="blue" label="Required" /> : <span className="muted">Optional</span>}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Switch
                          hideLabel label={`${r.name} switched on`} checked={r.enabled}
                          disabled={saving === r.id || r.key === 'administrator'} onChange={(on) => void toggle(r, on)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
      <NewRoleDialog open={creating} onClose={() => setCreating(false)} onCreated={(r) => navigate(`/admin/roles/${r.id}`)} />
    </>
  );
}

function NewRoleDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (role: Role) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErrors({ name: 'Enter a name.' }); return; }
    setBusy(true);
    try {
      const role = await adminApi.post<Role>('/api/admin/roles', { name: name.trim(), description: description.trim(), grants: [] });
      toast.success('Role created. Now choose its permissions.');
      setName(''); setDescription(''); setErrors({});
      onClose();
      onCreated(role);
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      if (Object.keys(fields).length === 0) toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="New role" size="sm" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <TextField label="Name" required autoFocus maxLength={60} value={name} onChange={setName} error={errors.name} />
        <TextArea label="Description" rows={3} value={description} onChange={setDescription} hint="Who holds this role and what it is for." />
        <p className="muted">The role starts with no permissions. You choose them on the next screen.</p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Create role</Button>
        </div>
      </form>
    </Modal>
  );
}
