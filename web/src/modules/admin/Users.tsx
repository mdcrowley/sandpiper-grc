import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ApiError, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, formatDateTime, Icon, Loading, Modal,
  PageHeader, qs, relativeTime, Select, StatusChip, TextField, useDebounced, useFetch, useToast,
} from '../../core';
import type { ListResult } from '../../core';
import { absoluteLink, CopyBox, FilterPills, Initials, Notice, Pager, RoleChips, UserStatus } from './common';
import type { AdminUser, Department, FilterPill, IssuedLink, RolesResponse } from './common';
import { adminApi } from './reauth';

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Waiting for setup' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'locked', label: 'Locked' },
];

export function UsersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(q, 300);
  const roles = useFetch<RolesResponse>('/api/admin/roles');
  const { data, error, loading, reload } = useFetch<ListResult<AdminUser>>(
    `/api/admin/users${qs({ q: search, status, role, page, pageSize: PAGE_SIZE })}`, { keepPrevious: true },
  );
  const creating = params.get('new') === '1';
  const closeNew = () => setParams((p) => { p.delete('new'); return p; }, { replace: true });
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const clear = () => { setQ(''); setStatus(''); setRole(''); setPage(1); };

  const pills: FilterPill[] = [];
  if (q.trim()) pills.push({ key: 'q', label: 'Search', value: q.trim(), onRemove: () => { setQ(''); setPage(1); } });
  if (status) pills.push({ key: 'status', label: 'Status', value: STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status, onRemove: () => { setStatus(''); setPage(1); } });
  if (role) pills.push({ key: 'role', label: 'Role', value: roles.data?.roles.find((r) => r.key === role)?.name ?? role, onRemove: () => { setRole(''); setPage(1); } });
  const filtered = pills.length > 0;

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="People are added by an administrator. Nobody can register themself."
        actions={<Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New user</Button>}
      />
      <div className="adm-toolbar">
        <TextField
          className="adm-toolbar-grow" label="Search users" hideLabel type="search" placeholder="Search by name, username or email"
          leftSection={<Icon name="search" size={16} />} value={q} onChange={(v) => { setQ(v); setPage(1); }}
        />
        <Select label="Status" hideLabel placeholder="Any status" options={STATUS_OPTIONS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
        <Select
          label="Role" hideLabel placeholder="Any role" value={role} onChange={(v) => { setRole(v); setPage(1); }}
          options={(roles.data?.roles ?? []).map((r) => ({ value: r.key, label: r.name }))}
        />
      </div>
      <FilterPills pills={pills} onClear={clear} />
      <Card flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={6} label="Loading users" /></div>
          : data.rows.length === 0 ? (
            <EmptyState
              icon="users"
              title={filtered ? 'No users match these filters' : 'No users yet'}
              message={filtered ? 'Change or clear the filters to see more people.' : 'Add the first person with New user.'}
              action={filtered ? <Button onClick={clear}>Clear filters</Button> : <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New user</Button>}
            />
          ) : (
            <>
              <div className={`table-wrap adm-table-frame${loading ? ' table-loading' : ''}`} aria-busy={loading}>
                <table className="table adm-users">
                  <thead>
                    <tr>
                      <th scope="col">Name</th><th scope="col">Username</th><th scope="col">Status</th><th scope="col">Roles</th>
                      <th scope="col">Second factor</th><th scope="col">Department</th><th scope="col">Last sign-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((u) => (
                      <tr key={u.id} className="row-link" onClick={() => navigate(`/admin/users/${u.id}`)}>
                        <td>
                          <span className="adm-person">
                            <Initials name={u.display_name} />
                            <span className="adm-person-text">
                              <Link className="row-title" to={`/admin/users/${u.id}`} onClick={(e) => e.stopPropagation()}>{u.display_name}</Link>
                              <span className="muted truncate">{u.email}</span>
                            </span>
                          </span>
                        </td>
                        <td>{u.username}</td>
                        <td><UserStatus user={u} /></td>
                        <td className="adm-wrap"><RoleChips roles={u.roles} /></td>
                        <td>{u.totp_enabled ? <StatusChip color="green" label="On" /> : <span className="muted">Not set up</span>}</td>
                        <td>{u.department ?? <span className="muted">—</span>}</td>
                        <td title={u.last_login_at ? formatDateTime(u.last_login_at) : undefined}>
                          {u.last_login_at ? relativeTime(u.last_login_at) : <span className="muted">Never</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager summary={`${data.total} ${data.total === 1 ? 'user' : 'users'}`} page={page} pages={pages} onPage={setPage} />
            </>
          )}
      </Card>
      <NewUserDialog open={creating} roles={roles.data} rolesError={roles.error} onRetryRoles={roles.reload} onClose={closeNew} onCreated={reload} />
    </>
  );
}

/** Shown once after a link is issued: the server keeps only a hash, so it cannot be shown again. */
export function LinkIssued({ link, name }: { link: IssuedLink; name: string }) {
  return (
    <div className="stack">
      <Notice tone="caution" role="status">
        <strong>This link is shown once.</strong> Copy it now: when you close this window it cannot be shown again.
        Nothing is sent by email, so pass it to {name} yourself, in person, by phone or in a private message.
      </Notice>
      <CopyBox prominent label={`One-time link for ${name}`} copyLabel="Copy link" value={absoluteLink(link.link)} testId="one-time-link">
        <ul className="adm-facts">
          <li><Icon name="clock" size={16} /> Expires <strong>{formatDateTime(link.expiresAt)}</strong> ({relativeTime(link.expiresAt)}).</li>
          <li><Icon name="check-circle" size={16} /> Works once. Issuing another link cancels this one.</li>
          <li><Icon name="lock" size={16} /> Anyone holding it can set this account's password, so treat it like a password.</li>
        </ul>
      </CopyBox>
    </div>
  );
}

function NewUserDialog({ open, roles, rolesError, onRetryRoles, onClose, onCreated }: {
  open: boolean; roles: RolesResponse | null | undefined; rolesError: unknown; onRetryRoles: () => void; onClose: () => void; onCreated: () => void;
}) {
  const toast = useToast();
  const departments = useFetch<Department[]>(open ? '/api/admin/departments' : null);
  const empty = { displayName: '', username: '', email: '', departmentId: '' };
  const [form, setForm] = useState(empty);
  const [picked, setPicked] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ link: IssuedLink; user: AdminUser } | null>(null);
  const set = (key: keyof typeof empty) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const close = () => {
    setForm(empty); setPicked([]); setErrors({}); setFormError(''); setIssued(null);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!form.displayName.trim()) found.displayName = 'Enter a name.';
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(form.username.trim())) found.username = 'Use 3 to 64 letters, numbers, dots, dashes or underscores.';
    if (!/^[^@\s]+@[^@\s]+$/.test(form.email.trim())) found.email = 'Enter an email address.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const res = await adminApi.post<{ user: AdminUser; setupLink: string; expiresAt: string }>('/api/admin/users', {
        displayName: form.displayName.trim(), username: form.username.trim(), email: form.email.trim(),
        departmentId: form.departmentId || null, roles: picked,
      });
      setIssued({ user: res.user, link: { link: res.setupLink, expiresAt: res.expiresAt } });
      toast.success('User created.');
      onCreated();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <Modal open={open} title={`${issued.user.display_name} has been added`} onClose={close}
        footer={<><Link className="btn btn-secondary" to={`/admin/users/${issued.user.id}`} onClick={close}>Open user</Link><Button variant="primary" onClick={close}>Done</Button></>}>
        <LinkIssued link={issued.link} name={issued.user.display_name} />
      </Modal>
    );
  }

  return (
    <Modal open={open} title="New user" onClose={close}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-grid">
          <TextField label="Name" required autoFocus value={form.displayName} onChange={set('displayName')} error={errors.displayName} />
          <TextField label="Username" required value={form.username} onChange={set('username')} error={errors.username} hint="Used to sign in." />
          <TextField label="Email" required type="email" value={form.email} onChange={set('email')} error={errors.email} />
          <Select
            label="Department" placeholder="None" value={form.departmentId} onChange={set('departmentId')} error={errors.departmentId}
            options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
            hint={departments.error ? 'Departments could not be loaded.' : undefined}
          />
        </div>
        <fieldset className="adm-fieldset">
          <legend className="field-label">Roles</legend>
          <p className="field-hint">Pick only what this person needs. With no role they can sign in but see nothing.</p>
          {errors.roles && <p className="field-error" role="alert">{errors.roles}</p>}
          {rolesError ? <ErrorState error={rolesError} onRetry={onRetryRoles} />
            : !roles ? <Loading lines={3} label="Loading roles" />
            : (
              <div className="adm-role-picks">
                {roles.roles.map((r) => (
                  <Checkbox
                    key={r.key}
                    label={`${r.name}${r.enabled ? '' : ' (switched off)'}`}
                    hint={r.description ?? undefined}
                    checked={picked.includes(r.key)}
                    onChange={(on) => setPicked((p) => (on ? [...p, r.key] : p.filter((k) => k !== r.key)))}
                  />
                ))}
              </div>
            )}
        </fieldset>
        <Notice icon="link">No password is set here. When you create the user you get a one-time setup link, valid for 24 hours, to pass on.</Notice>
        <div className="form-actions">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Create user</Button>
        </div>
      </form>
    </Modal>
  );
}
