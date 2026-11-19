import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, Checkbox, ConfirmDialog, DefinitionList, EmptyState, ErrorState, errorMessage,
  formatDateTime, Loading, Modal, NotFound, PageHeader, relativeTime, Select, StatusChip, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { ListResult } from '../../core';
import { Notice, RoleChips, UserStatus } from './common';
import type { AdminUser, AuditEvent, Department, IssuedLink, RolesResponse } from './common';
import { adminApi } from './reauth';
import { PasskeysCard } from '../account-keys/PasskeysCard';
import { UserSignInCard } from './UserSignIn';
import { LinkIssued } from './Users';

interface Pending { title: string; message: string; label: string; danger?: boolean; run: () => Promise<void> }

export function UserDetailPage() {
  const { id } = useParams();
  const auth = useAuth();
  const toast = useToast();
  const { data: user, error, reload } = useFetch<AdminUser>(`/api/admin/users/${id}`);
  const events = useFetch<ListResult<AuditEvent>>(auth.can('audit.view') ? `/api/audit?record_type=user&record_id=${id}&pageSize=20` : null);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<IssuedLink | null>(null);

  if (error) return error instanceof ApiError && error.status === 404 ? <NotFound /> : <ErrorState error={error} onRetry={reload} />;
  if (!user) return <Loading lines={8} label="Loading user" />;
  const isSelf = user.id === auth.user?.id;
  const refresh = () => { reload(); events.reload(); };

  const act = (url: string, done: string) => async () => {
    await adminApi.post(`/api/admin/users/${user.id}/${url}`);
    toast.success(done);
  };
  const issue = (url: string) => async () => setLink(await adminApi.post<IssuedLink>(`/api/admin/users/${user.id}/${url}`));
  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.run();
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const name = user.display_name;
  const needsFactor = user.roles.some((r) => r.enabled && r.requires_mfa);

  return (
    <>
      <PageHeader
        title={name}
        subtitle={`${user.username} · ${user.email}`}
        status={<UserStatus user={user} />}
        breadcrumbs={[{ label: 'Users', to: '/admin/users' }, { label: name }]}
      />
      <div className="grid-2">
        <div className="stack">
          <ProfileCard user={user} onSaved={refresh} />
          <RolesCard user={user} isSelf={isSelf} onSaved={refresh} />
        </div>
        <div className="stack">
          <Card title="Sign-in and security">
            {user.status === 'pending' && (
              <Notice tone="caution">
                {name} has not set a password yet. {user.link_pending ? 'A setup link is waiting to be used.' : 'There is no usable setup link: issue a new one.'}
              </Notice>
            )}
            <DefinitionList items={[
              { label: 'Password', value: user.has_password ? `Set ${formatDateTime(user.password_changed_at)}` : user.identities ? 'None: signs in through a provider' : 'Not set yet' },
              { label: 'Sign-in providers', value: user.identities ? `${user.identities} linked` : 'None linked' },
              { label: 'Second factor', value: user.totp_enabled ? <StatusChip color="green" label="Authenticator app" /> : <StatusChip color={needsFactor ? 'amber' : 'gray'} label={needsFactor ? 'Not set up, expected by a role' : 'Not set up'} /> },
              { label: 'Last sign-in', value: user.last_login_at ? formatDateTime(user.last_login_at) : 'Never' },
              { label: 'Active sessions', value: user.sessions },
              { label: 'Failed attempts', value: user.locked ? `${user.failed_attempts} (locked until ${formatDateTime(user.locked_until)})` : user.failed_attempts },
              { label: 'One-time link', value: user.link_pending ? 'One is waiting to be used' : 'None outstanding' },
            ]} />
            <div className="adm-actions">
              {user.status !== 'disabled' && (
                <Button icon="link" onClick={() => setConfirm({
                  title: user.has_password ? 'Issue a password-reset link?' : 'Issue a new setup link?',
                  message: `You will get a one-time link, valid for 24 hours, to pass to ${name}. Any earlier link stops working. Their password does not change until they use it.`,
                  label: 'Issue link', run: issue('reset-link'),
                })}>{user.has_password ? 'Password-reset link' : 'New setup link'}</Button>
              )}
              {(user.locked || user.failed_attempts > 0) && (
                <Button icon="lock" onClick={() => setConfirm({
                  title: 'Unlock this account?', message: `${name} will be able to try signing in again straight away.`,
                  label: 'Unlock', run: act('unlock', 'Account unlocked.'),
                })}>Unlock</Button>
              )}
              {user.totp_enabled && (
                <Button icon="shield" onClick={() => setConfirm({
                  title: 'Reset the second factor?', danger: true,
                  message: `${name}'s authenticator app and recovery codes will stop working, and they will sign in with a password only until they set it up again. Confirm who is asking before you do this.`,
                  label: 'Reset second factor', run: act('reset-mfa', 'Second factor reset.'),
                })}>Reset second factor</Button>
              )}
              {user.sessions > 0 && (
                <Button icon="logout" onClick={() => setConfirm({
                  title: 'End all sessions?',
                  message: isSelf ? 'Your other sessions will be signed out. This one stays.' : `${name} will be signed out everywhere and must sign in again.`,
                  label: 'End sessions', run: act('end-sessions', 'Sessions ended.'),
                })}>End sessions</Button>
              )}
              {user.status === 'disabled' ? (
                <Button onClick={() => setConfirm({
                  title: 'Enable this account?', message: `${name} will be able to sign in again.`,
                  label: 'Enable', run: act('enable', 'Account enabled.'),
                })}>Enable account</Button>
              ) : (
                <Button variant="danger" disabled={isSelf} title={isSelf ? 'You cannot disable your own account' : undefined} onClick={() => setConfirm({
                  title: 'Disable this account?', danger: true,
                  message: `${name} will be signed out and cannot sign in until the account is enabled again. Their records and history are kept.`,
                  label: 'Disable', run: act('disable', 'Account disabled.'),
                })}>Disable account</Button>
              )}
            </div>
          </Card>
          <PasskeysCard userId={user.id} />
          <UserSignInCard user={user} onChanged={refresh} />
          <Card title="Recent account events" flush>
            {!auth.can('audit.view') ? <EmptyState icon="history" title="You need audit access to see events" />
              : events.error ? <ErrorState error={events.error} onRetry={events.reload} />
              : !events.data ? <div className="card-body"><Loading lines={4} /></div>
              : events.data.rows.length === 0 ? <EmptyState icon="history" title="No events yet" message="Sign-ins and changes to this account will appear here." />
              : (
                <>
                  <ol className="adm-events">
                    {events.data.rows.map((e) => (
                      <li key={e.id}>
                        <span className="adm-event-what">{e.summary ?? e.action}</span>
                        <span className="muted">
                          <span title={formatDateTime(e.at)}>{relativeTime(e.at)}</span>
                          {' · '}{e.actor_name ?? (e.ip ? 'Not signed in' : 'System')}
                          {e.ip ? ` · from ${e.ip}` : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="card-body adm-card-foot">
                    <Link to={`/admin/audit?record_type=user&record_id=${user.id}`}>See all events for this account in the audit log</Link>
                  </p>
                </>
              )}
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(confirm)} title={confirm?.title ?? ''} message={confirm?.message ?? ''} confirmLabel={confirm?.label}
        danger={confirm?.danger} busy={busy} onConfirm={() => void run()} onCancel={() => setConfirm(null)}
      />
      <Modal open={Boolean(link)} title={`One-time link for ${name}`} onClose={() => setLink(null)}
        footer={<Button variant="primary" onClick={() => setLink(null)}>Done</Button>}>
        {link && <LinkIssued link={link} name={name} />}
      </Modal>
    </>
  );
}

function ProfileCard({ user, onSaved }: { user: AdminUser; onSaved: () => void }) {
  const toast = useToast();
  const departments = useFetch<Department[]>('/api/admin/departments');
  const start = { displayName: user.display_name, username: user.username, email: user.email, departmentId: user.department_id ?? '' };
  const [form, setForm] = useState(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(start); }, [user.display_name, user.username, user.email, user.department_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (key: keyof typeof start) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(start);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.patch(`/api/admin/users/${user.id}`, { ...form, departmentId: form.departmentId || null });
      toast.success('Details saved.');
      onSaved();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      if (Object.keys(fields).length === 0) toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Details">
      <form className="form" onSubmit={submit} noValidate>
        <TextField label="Name" required value={form.displayName} onChange={set('displayName')} error={errors.displayName} />
        <TextField label="Username" required value={form.username} onChange={set('username')} error={errors.username} />
        <TextField label="Email" required type="email" value={form.email} onChange={set('email')} error={errors.email} />
        <Select
          label="Department" placeholder="None" value={form.departmentId} onChange={set('departmentId')} error={errors.departmentId}
          options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          hint={departments.error ? 'Departments could not be loaded.' : undefined}
        />
        <div className="form-actions">
          <Button disabled={!dirty} onClick={() => setForm(start)}>Undo changes</Button>
          <Button type="submit" variant="primary" disabled={!dirty} loading={busy}>Save details</Button>
        </div>
      </form>
    </Card>
  );
}

function RolesCard({ user, isSelf, onSaved }: { user: AdminUser; isSelf: boolean; onSaved: () => void }) {
  const toast = useToast();
  const roles = useFetch<RolesResponse>('/api/admin/roles');
  const current = user.roles.map((r) => r.key).sort();
  const [picked, setPicked] = useState<string[]>(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPicked(current); }, [current.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = [...picked].sort().join(',') !== current.join(',');

  const save = async () => {
    setBusy(true);
    try {
      await adminApi.patch(`/api/admin/users/${user.id}`, { roles: picked });
      toast.success('Roles saved.');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Roles" actions={<RoleChips roles={user.roles} />}>
      {roles.error ? <ErrorState error={roles.error} onRetry={roles.reload} />
        : !roles.data ? <Loading lines={4} />
        : (
          <div className="stack">
            {isSelf && <p className="muted">This is your own account. You cannot remove your own administrator access.</p>}
            {roles.data.roles.map((r) => (
              <Checkbox
                key={r.key}
                label={`${r.name}${r.enabled ? '' : ' (switched off)'}${r.requires_mfa ? ' · needs a second factor' : ''}`}
                hint={r.description ?? undefined}
                checked={picked.includes(r.key)}
                onChange={(on) => setPicked((p) => (on ? [...p, r.key] : p.filter((k) => k !== r.key)))}
              />
            ))}
            <div className="form-actions">
              <Button disabled={!dirty} onClick={() => setPicked(current)}>Undo changes</Button>
              <Button variant="primary" disabled={!dirty} loading={busy} onClick={() => void save()}>Save roles</Button>
            </div>
          </div>
        )}
    </Card>
  );
}
