import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ApiError, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, humanize, Icon, Loading, NotFound, PageHeader,
  StatusChip, TextArea, TextField, useFetch, useMeta, useToast,
} from '../../core';
import { Notice } from './common';
import type { Role, RolesResponse } from './common';
import { AUDIENCE_ROLES } from './Roles';
import { adminApi } from './reauth';
import { Switch } from './Switch';

const MODULE_LABELS: Record<string, string> = {
  knowledge: 'Knowledge base', data: 'Data categories', changes: 'Change enablement', security: 'Security incidents and restricted records',
  frameworks: 'Frameworks and assessments', audit: 'Audit log', admin: 'Administration', portal: 'Self-service portal',
  dashboards: 'Dashboards and overview', exceptions: 'Policy exceptions',
};
const moduleLabel = (key: string) => MODULE_LABELS[key] ?? humanize(key);

/**
 * Permission areas that may have nothing checking them: the portal is not built, and reports are checked
 * only when the reports part of the server is installed. An area here carries the "not yet used" hint
 * unless a record type that belongs to it is loaded (see `unusedAreas`). The list of areas itself always
 * comes from the server; this only decides which rows carry the hint.
 */
const MAYBE_UNUSED = ['reports', 'portal'];

export function RoleDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const vocab = useFetch<RolesResponse>('/api/admin/roles');
  const { data: role, error, reload } = useFetch<Role>(`/api/admin/roles/${id}`);
  const [form, setForm] = useState({ name: '', description: '', requiresMfa: false, enabled: true });
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [find, setFind] = useState('');
  const [onlyGranted, setOnlyGranted] = useState(false);
  const { resources } = useMeta();
  const unusedAreas = useMemo(() => {
    const inUse = new Set(Object.values(resources ?? {}).map((r) => r.module));
    return new Set(MAYBE_UNUSED.filter((m) => !inUse.has(m)));
  }, [resources]);

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
  const countFor = (m: string) => actions.filter((a) => has(m, a)).length;
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
      await adminApi.patch(`/api/admin/roles/${role.id}`, { ...form, name: form.name.trim(), grants: [...grants] });
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

  const needle = find.trim().toLowerCase();
  const shown = modules.filter((m) =>
    (!needle || m.includes(needle) || moduleLabel(m).toLowerCase().includes(needle)) && (!onlyGranted || countFor(m) > 0));
  const areasGranted = modules.filter((m) => countFor(m) > 0).length;

  return (
    <>
      <PageHeader
        title={role.name}
        reference={role.key}
        status={<StatusChip color={role.enabled ? 'green' : 'gray'} label={role.enabled ? 'Switched on' : 'Switched off'} />}
        breadcrumbs={[{ label: 'Roles', to: '/admin/roles' }, { label: role.name }]}
        actions={<>
          {dirty && <span className="adm-unsaved" role="status">Unsaved changes</span>}
          <Button disabled={!dirty} onClick={reset}>Undo changes</Button>
          <Button variant="primary" disabled={!dirty} loading={busy} onClick={() => void save()}>Save role</Button>
        </>}
      />
      <div className="stack">
        {AUDIENCE_ROLES.includes(role.key) && (
          <Notice>
            This is one of the four wider-audience roles that start switched off. Switch it on when you are ready to
            open the application to this audience.
          </Notice>
        )}
        <div className="grid-2">
          <Card title="About this role">
            <div className="form">
              <TextField label="Name" required maxLength={60} value={form.name} onChange={(v) => setForm({ ...form, name: v })} error={errors.name} />
              <TextArea label="Description" rows={3} value={form.description} onChange={(v) => setForm({ ...form, description: v })} hint="Who holds this role and what it is for." />
              <div>
                <Switch label="Switched on" checked={form.enabled} disabled={isAdmin} onChange={(on) => setForm({ ...form, enabled: on })} />
                {errors.enabled && <p className="field-error" role="alert">{errors.enabled}</p>}
                <p className="field-hint">
                  {isAdmin ? 'The Administrator role cannot be switched off.' : 'While off, members keep the role but get none of its permissions.'}
                </p>
              </div>
              <Checkbox
                label="Members must use a second factor" checked={form.requiresMfa} onChange={(on) => setForm({ ...form, requiresMfa: on })}
                hint="What happens to members without an authenticator app (a reminder, or nothing else working until they set one up) is chosen under Settings."
                error={errors.requiresMfa}
              />
            </div>
          </Card>
          <Card title={`Members (${role.members})`} flush>
            {!role.users?.length ? <EmptyState icon="users" title="Nobody holds this role" message="Give it to people from their user page." /> : (
              <div className="table-wrap adm-table-frame adm-members">
                <table className="table">
                  <thead><tr><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {role.users.map((u) => (
                      <tr key={u.id}><td><Link to={`/admin/users/${u.id}`}>{u.display_name}</Link></td><td>{u.username}</td><td>{u.status === 'pending' ? 'Waiting for setup' : humanize(u.status)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <Card title="Permissions" flush actions={<span className="muted">{everything ? 'Everything' : `${areasGranted} of ${modules.length} areas`}</span>}>
          <div className="card-body stack">
            {everything ? (
              <Notice icon="star">
                This role holds <strong>every permission</strong> (stored as <code>*</code>), including any added later.
                {isAdmin && ' That cannot be removed from the Administrator role.'}
              </Notice>
            ) : (
              <p className="muted">
                Tick what members may do in each area. <strong>All</strong> grants every action in that area, now and in future
                (stored as <code>area.*</code>). Restricted records also need View on Security incidents and restricted records.
              </p>
            )}
            {errors.grants && <p className="form-error" role="alert">{errors.grants}</p>}
            {extras.length > 0 && (
              <p>Other grants kept as they are: <span className="row adm-chips">{extras.map((g) => <span key={g} className="chip chip-gray">{g}</span>)}</span></p>
            )}
            <div className="adm-toolbar adm-toolbar-tight">
              <TextField
                className="adm-toolbar-grow" label="Find an area" hideLabel type="search" placeholder="Find an area, for example risks"
                leftSection={<Icon name="search" size={16} />} value={find} onChange={setFind}
              />
              <Checkbox label="Only areas this role can use" checked={onlyGranted} onChange={setOnlyGranted} />
            </div>
            <p className="sr-only" role="status">{shown.length} of {modules.length} areas shown</p>
          </div>
          {shown.length === 0 ? (
            <EmptyState
              icon="search" title="No area matches" message={needle ? `Nothing matches “${find.trim()}”.` : 'This role has no permissions yet.'}
              action={<Button onClick={() => { setFind(''); setOnlyGranted(false); }}>Show every area</Button>}
            />
          ) : (
            <div className="adm-matrix-frame" role="region" aria-label="Permission matrix" tabIndex={0}>
              <table className="adm-matrix">
                <thead>
                  <tr>
                    <th scope="col" className="adm-matrix-area">Area</th>
                    <th scope="col" className="adm-matrix-all">All</th>
                    {actions.map((a) => <th key={a} scope="col">{humanize(a)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => {
                    const unused = unusedAreas.has(m);
                    return (
                      <tr key={m} className={unused ? 'adm-matrix-unused' : undefined}>
                        <th scope="row" className="adm-matrix-area">
                          <span className="adm-matrix-name">{moduleLabel(m)}</span>
                          <span className="adm-matrix-key">
                            <code>{m}</code>
                            {unused && <span className="adm-matrix-hint" title="Nothing in this version checks these permissions yet. Ticking them has no effect today.">not yet used</span>}
                          </span>
                        </th>
                        <td className="adm-matrix-all">
                          <label className="adm-matrix-cell">
                            <input type="checkbox" aria-label={`${moduleLabel(m)}: all actions`} disabled={everything}
                              checked={everything || grants.has(`${m}.*`)} onChange={() => toggleAll(m)} />
                          </label>
                        </td>
                        {actions.map((a) => (
                          <td key={a}>
                            <label className="adm-matrix-cell">
                              <input type="checkbox" aria-label={`${moduleLabel(m)}: ${humanize(a)}`} disabled={everything}
                                checked={has(m, a)} onChange={() => toggle(m, a)} />
                            </label>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {unusedAreas.size > 0 && (
            <p className="card-body adm-card-foot muted">
              Areas marked <span className="adm-matrix-hint">not yet used</span> can be ticked, but nothing in this installation checks them yet.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
