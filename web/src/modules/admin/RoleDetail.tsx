import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, humanize, Loading, NotFound, PageHeader,
  StatusChip, TextArea, TextField, useFetch, useToast,
} from '../../core';
import type { Role, RolesResponse } from './common';
import { AUDIENCE_ROLES } from './Roles';
import { Switch } from './Switch';

const MODULE_LABELS: Record<string, string> = {
  knowledge: 'Knowledge base', data: 'Data categories', changes: 'Change enablement', security: 'Security incidents and restricted records',
  frameworks: 'Frameworks and assessments', audit: 'Audit log', admin: 'Administration', portal: 'Self-service portal',
};
const moduleLabel = (key: string) => MODULE_LABELS[key] ?? humanize(key);

export function RoleDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const vocab = useFetch<RolesResponse>('/api/admin/roles');
  const { data: role, error, reload } = useFetch<Role>(`/api/admin/roles/${id}`);
  const [form, setForm] = useState({ name: '', description: '', requiresMfa: false, enabled: true });
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const reset = () => {
    if (!role) return;
    setForm({ name: role.name, description: role.description ?? '', requiresMfa: role.requires_mfa, enabled: role.enabled });
    setGrants(new Set(role.grants));
    setErrors({});
  };
  useEffect(reset, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const modules = vocab.data?.modules ?? [];
  const actions = vocab.data?.actions ?? [];
  const extras = useMemo(
    () => [...grants].filter((g) => g !== '*' && !(modules.includes(g.split('.')[0]) && (g.endsWith('.*') || actions.includes(g.split('.')[1])))),
    [grants, modules, actions],
  );

  if (error) return error instanceof ApiError && error.status === 404 ? <NotFound /> : <ErrorState error={error} onRetry={reload} />;
  if (vocab.error) return <ErrorState error={vocab.error} onRetry={vocab.reload} />;
  if (!role || !vocab.data) return <Loading lines={10} label="Loading role" />;

  const isAdmin = role.key === 'administrator';
  const everything = grants.has('*');
  const has = (m: string, a: string) => everything || grants.has(`${m}.*`) || grants.has(`${m}.${a}`);
  const dirty = form.name !== role.name || form.description !== (role.description ?? '') || form.requiresMfa !== role.requires_mfa
    || form.enabled !== role.enabled || [...grants].sort().join() !== [...role.grants].sort().join();

  const toggle = (m: string, a: string) => setGrants((old) => {
    const next = new Set(old);
    if (next.has(`${m}.*`)) {
      next.delete(`${m}.*`);
      for (const other of actions) if (other !== a) next.add(`${m}.${other}`);
    } else if (next.has(`${m}.${a}`)) next.delete(`${m}.${a}`);
    else next.add(`${m}.${a}`);
    return next;
  });
  const toggleAll = (m: string) => setGrants((old) => {
    const next = new Set(old);
    const on = next.has(`${m}.*`);
    for (const a of actions) next.delete(`${m}.${a}`);
    if (on) next.delete(`${m}.*`); else next.add(`${m}.*`);
    return next;
  });

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api.patch(`/api/admin/roles/${role.id}`, { ...form, name: form.name.trim(), grants: [...grants] });
      toast.success('Role saved. Changes apply at once.');
      reload();
      vocab.reload();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      toast.error(Object.values(fields)[0] ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={role.name}
        reference={role.key}
        status={<StatusChip color={role.enabled ? 'green' : 'gray'} label={role.enabled ? 'Switched on' : 'Switched off'} />}
        breadcrumbs={[{ label: 'Roles', to: '/admin/roles' }, { label: role.name }]}
        actions={<><Button disabled={!dirty} onClick={reset}>Undo changes</Button><Button variant="primary" disabled={!dirty} loading={busy} onClick={() => void save()}>Save role</Button></>}
      />
      {AUDIENCE_ROLES.includes(role.key) && (
        <p className="notice" role="note">
          This is one of the four wider-audience roles that start switched off. Switch it on when you are ready to
          open the application to this audience.
        </p>
      )}
      <div className="stack">
        <div className="grid-2">
          <Card title="About this role">
            <div className="form">
              <TextField label="Name" required maxLength={60} value={form.name} onChange={(v) => setForm({ ...form, name: v })} error={errors.name} />
              <TextArea label="Description" rows={3} value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
              <Switch label="Switched on" checked={form.enabled} disabled={isAdmin} onChange={(on) => setForm({ ...form, enabled: on })} />
              {errors.enabled && <p className="field-error" role="alert">{errors.enabled}</p>}
              <p className="field-hint">
                {isAdmin ? 'The Administrator role cannot be switched off.' : 'While off, members keep the role but get none of its permissions.'}
              </p>
              <Checkbox
                label="Members must use a second factor" checked={form.requiresMfa} onChange={(on) => setForm({ ...form, requiresMfa: on })}
                hint="Members without an authenticator app see a reminder until they set one up."
              />
            </div>
          </Card>
          <Card title={`Members (${role.members})`} flush>
            {!role.users?.length ? <EmptyState icon="users" title="Nobody holds this role" message="Give it to people from their user page." /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {role.users.map((u) => (
                      <tr key={u.id}><td><Link to={`/admin/users/${u.id}`}>{u.display_name}</Link></td><td>{u.username}</td><td>{humanize(u.status)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <Card title="Permissions" flush>
          <div className="card-body">
            {everything ? (
              <p><span className="chip chip-purple">*</span> This role holds <strong>every permission</strong>, including any added later. {isAdmin && 'That cannot be removed from the Administrator role.'}</p>
            ) : (
              <p className="muted">
                Tick what members may do in each area. <strong>All</strong> grants every action in that area, now and in future
                (stored as <code>area.*</code>). Restricted records need “View” on Security incidents and restricted records.
              </p>
            )}
            {errors.grants && <p className="field-error" role="alert">{errors.grants}</p>}
            {extras.length > 0 && (
              <p>Other grants kept as they are: {extras.map((g) => <span key={g} className="chip chip-gray">{g}</span>)}</p>
            )}
          </div>
          <div className="table-wrap">
            <table className="table adm-grid">
              <thead>
                <tr>
                  <th scope="col">Area</th>
                  <th scope="col" className="adm-grid-all">All</th>
                  {actions.map((a) => <th key={a} scope="col">{humanize(a)}</th>)}
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => (
                  <tr key={m}>
                    <th scope="row">{moduleLabel(m)} <span className="muted">({m})</span></th>
                    <td className="adm-grid-all">
                      <input type="checkbox" aria-label={`${moduleLabel(m)}: all actions`} disabled={everything}
                        checked={everything || grants.has(`${m}.*`)} onChange={() => toggleAll(m)} />
                    </td>
                    {actions.map((a) => (
                      <td key={a}>
                        <input type="checkbox" aria-label={`${moduleLabel(m)}: ${a}`} disabled={everything}
                          checked={has(m, a)} onChange={() => toggle(m, a)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
