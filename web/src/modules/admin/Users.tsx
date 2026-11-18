import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, Modal,
  PageHeader, qs, relativeTime, Select, TextField, useDebounced, useFetch, useToast,
} from '../../core';
import type { ListResult } from '../../core';
import { absoluteLink, CopyBox, RoleChips, UserStatus } from './common';
import type { AdminUser, Department, IssuedLink, RolesResponse } from './common';
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
    `/api/admin/users${qs({ q: search, status, role, page, pageSize: PAGE_SIZE })}`,
  );
  const creating = params.get('new') === '1';
  const closeNew = () => setParams((p) => { p.delete('new'); return p; }, { replace: true });
  const filtered = Boolean(search || status || role);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="People are added by an administrator. Nobody can register themself."
        actions={<Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New user</Button>}
      />
      <div className="adm-toolbar">
        <TextField className="adm-toolbar-grow" label="Search" type="search" placeholder="Name, username or email" value={q} onChange={(v) => { setQ(v); setPage(1); }} />
        <Select label="Status" placeholder="Any status" options={STATUS_OPTIONS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
        <Select
          label="Role" placeholder="Any role" value={role} onChange={(v) => { setRole(v); setPage(1); }}
          options={(roles.data?.roles ?? []).map((r) => ({ value: r.key, label: r.name }))}
        />
        {filtered && <Button variant="ghost" onClick={() => { setQ(''); setStatus(''); setRole(''); setPage(1); }}>Clear filters</Button>}
      </div>
      <Card flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={6} label="Loading users" /></div>
          : data.rows.length === 0 ? (
            <EmptyState
              icon="users"
              title={filtered ? 'No users match these filters' : 'No users yet'}
              message={filtered ? 'Change or clear the filters to see more people.' : 'Add the first person with New user.'}
            />
          ) : (
            <>
              <div className="table-wrap" aria-busy={loading}>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th><th scope="col">Username</th><th scope="col">Status</th><th scope="col">Roles</th>
                      <th scope="col">Second factor</th><th scope="col">Department</th><th scope="col">Last sign-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((u) => (
                      <tr key={u.id} className="row-link" onClick={() => navigate(`/admin/users/${u.id}`)}>
                        <td className="row-title">
                          <Link to={`/admin/users/${u.id}`} onClick={(e) => e.stopPropagation()}>{u.display_name}</Link>
                          <div className="muted">{u.email}</div>
                        </td>
                        <td>{u.username}</td>
                        <td><UserStatus user={u} /></td>
                        <td><RoleChips roles={u.roles} /></td>
                        <td>{u.totp_enabled ? 'On' : <span className="muted">Not set up</span>}</td>
                        <td>{u.department ?? <span className="muted">—</span>}</td>
                        <td title={u.last_login_at ? formatDateTime(u.last_login_at) : undefined}>
                          {u.last_login_at ? relativeTime(u.last_login_at) : <span className="muted">Never</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="adm-foot">
                <span className="muted">{data.total} {data.total === 1 ? 'user' : 'users'}</span>
                {pages > 1 && (
                  <span className="row">
                    <Button size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                    <span>Page {page} of {pages}</span>
                    <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
                  </span>
                )}
              </div>
            </>
          )}
      </Card>
      <NewUserDialog open={creating} roles={roles.data} onClose={closeNew} onCreated={reload} />
    </>
  );
}

/** Shown once after a link is issued: the server keeps only a hash, so it cannot be shown again. */
export function LinkIssued({ link, name }: { link: IssuedLink; name: string }) {
  return (
    <div className="stack">
      <p className="notice notice-warn" role="status">
        This link is shown once. Copy it now and pass it to {name} yourself (in person, by phone or by Teams);
        this prototype does not send email.
      </p>
      <CopyBox label="One-time link" value={absoluteLink(link.link)}>
        <p className="field-hint">
          Works once, until {formatDateTime(link.expiresAt)} (24 hours). Issuing another link cancels this one.
        </p>
      </CopyBox>
    </div>
  );
}

function NewUserDialog({ open, roles, onClose, onCreated }: {
  open: boolean; roles: RolesResponse | null | undefined; onClose: () => void; onCreated: () => void;
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
      <Modal open={open} title={`Setup link for ${issued.user.display_name}`} onClose={close}
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
          />
        </div>
        <fieldset className="stack">
          <legend className="field-label">Roles</legend>
          <p className="field-hint">Pick only what this person needs. With no role they can sign in but see nothing.</p>
          {errors.roles && <p className="field-error" role="alert">{errors.roles}</p>}
          {!roles ? <Loading lines={3} /> : roles.roles.map((r) => (
            <Checkbox
              key={r.key}
              label={`${r.name}${r.enabled ? '' : ' (switched off)'}`}
              hint={r.description ?? undefined}
              checked={picked.includes(r.key)}
              onChange={(on) => setPicked((p) => (on ? [...p, r.key] : p.filter((k) => k !== r.key)))}
            />
          ))}
        </fieldset>
        <p className="muted">No password is set here. You will get a one-time setup link, valid for 24 hours, to pass on.</p>
        <div className="form-actions">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Create user</Button>
        </div>
      </form>
    </Modal>
  );
}
