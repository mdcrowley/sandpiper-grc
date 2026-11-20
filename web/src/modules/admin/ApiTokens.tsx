// Personal API tokens: the "API tokens" card on Account security (each person's own) and the
// administrators' page listing everyone's (/admin/tokens). A token is shown once, when it is made.
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError, Badge, Button, Card, ChoicesField, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, humanize,
  Icon, Loading, Modal, PageHeader, relativeTime, Select, StatusChip, TextArea, TextField, useAuth, useFetch, useMeta, useToast,
} from '../../core';
import type { ColorName, Option } from '../../core';
import { CopyBox, FilterPills, Initials, Notice, Pager, type FilterPill } from './common';
import { adminApi } from './reauth';

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expires_at: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;
  revoked_at: string | null;
  active: boolean;
  /** Addresses and ranges the token may be used from; empty = anywhere (E02-18). */
  allowed_sources?: string[];
  userId?: string;
  userName?: string;
  username?: string;
}

interface MyTokens { tokens: ApiToken[]; maxDays: number; grants: string[]; scopeFamilies?: { scope: string; description: string }[]; yourAddress?: string }
interface Created { id: string; name: string; prefix: string; scopes: string[]; expires_at: string; token: string }

// ---------- permissions a token may carry ----------

/** The permission areas, as named in role grants. */
const AREAS = [
  'tickets', 'knowledge', 'assets', 'systems', 'sites', 'data', 'changes', 'vendors', 'contracts', 'frameworks', 'risks', 'security',
  'vulnerabilities', 'policies', 'training', 'exceptions', 'obligations', 'exercises', 'actions', 'projects', 'dashboards', 'reports', 'audit', 'admin',
];
const AREA_NAMES: Record<string, string> = {
  admin: 'Administration', audit: 'Audit log', data: 'Data categories', security: 'Security incidents and restricted records',
  dashboards: 'Dashboards and overview', exceptions: 'Policy exceptions',
};
const areaName = (m: string) => AREA_NAMES[m] ?? humanize(m);

/** What two grant patterns have in common (the same rule as the server). */
function overlap(a: string, b: string): string | null {
  if (a === '*') return b;
  if (b === '*') return a;
  if (a === b) return a;
  const [am, aa] = a.split('.');
  const [bm, ba] = b.split('.');
  if (am !== bm) return null;
  if (aa === '*') return b;
  if (ba === '*') return a;
  return null;
}
const covered = (scope: string, grants: string[]) => grants.some((g) => overlap(scope, g) === scope);

/** A permission in words: "Tickets: view only". */
export function scopeLabel(scope: string): string {
  if (scope === '*') return 'Everything you can do';
  if (scope === 'mcp.use') return 'Use with an AI assistant (MCP)';
  const [m, a] = scope.split('.');
  if (a === '*') return `${areaName(m)}: everything`;
  if (a === 'view') return `${areaName(m)}: view only`;
  return `${areaName(m)}: ${a}`;
}

function scopeOptions(grants: string[], extraAreas: string[], off: (perm: string) => boolean = () => false): Option[] {
  // Areas of a switched-off part (Administration > Features) are not offered: nobody holds them (E14-34).
  const areas = [...new Set([...AREAS, ...extraAreas, ...grants.filter((g) => g !== '*').map((g) => g.split('.')[0])])]
    .filter((m) => !off(`${m}.view`)).sort((a, b) => areaName(a).localeCompare(areaName(b)));
  const wanted = ['*', ...areas.flatMap((m) => [`${m}.view`, `${m}.*`]), ...grants.filter((g) => !off(g))];
  return [...new Set(wanted)].filter((s) => covered(s, grants)).map((s) => ({ value: s, label: scopeLabel(s) }));
}

/** The scopes of a token as small code chips, the first few only. */
export function ScopeChips({ scopes, max = 4 }: { scopes: string[]; max?: number }) {
  const shown = scopes.slice(0, max);
  return (
    <span className="row adm-chips" title={scopes.map(scopeLabel).join('\n')}>
      {shown.map((s) => <code key={s} className="adm-code-chip">{s}</code>)}
      {scopes.length > max && <span className="muted">and {scopes.length - max} more</span>}
    </span>
  );
}

function tokenState(t: ApiToken): { color: ColorName; label: string } {
  if (t.revoked_at) return { color: 'gray', label: 'Revoked' };
  if (!t.active || new Date(t.expires_at).getTime() <= Date.now()) return { color: 'gray', label: 'Expired' };
  if (new Date(t.expires_at).getTime() - Date.now() < 14 * 86_400_000) return { color: 'amber', label: 'Expires soon' };
  return { color: 'green', label: 'Active' };
}
const isLive = (t: ApiToken) => !t.revoked_at && t.active;

/** "Only from 10.0.0.0/8 and 2 more", or null for a token usable anywhere. */
export function sourcesText(sources: string[] | undefined): string | null {
  if (!sources?.length) return null;
  return `Only from ${sources.slice(0, 2).join(', ')}${sources.length > 2 ? ` and ${sources.length - 2} more` : ''}`;
}

/** Lines or commas into a list of addresses. */
export const sourcesFrom = (text: string) => text.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

function lastUse(t: ApiToken): string {
  if (!t.last_used_at) return 'Never used';
  return `Last used ${relativeTime(t.last_used_at)}${t.last_used_ip ? ` from ${t.last_used_ip}` : ''}`;
}

// ---------- my tokens (Account security) ----------

export function MyTokensCard() {
  const toast = useToast();
  const { data, error, reload } = useFetch<MyTokens>('/api/me/tokens');
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const [busy, setBusy] = useState(false);
  const live = data?.tokens.filter(isLive) ?? [];
  const old = data?.tokens.filter((t) => !isLive(t)) ?? [];

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await adminApi.del(`/api/me/tokens/${revoking.id}`);
      toast.success(`Token "${revoking.name}" revoked. It stops working at once.`);
      setRevoking(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const row = (t: ApiToken) => {
    const s = tokenState(t);
    return (
      <li key={t.id} className="adm-session adm-token">
        <div className="adm-session-main">
          <span className="adm-session-name">{t.name} <StatusChip color={s.color} label={s.label} /></span>
          <span className="muted adm-session-facts">
            <span><code>{t.prefix}…</code></span>
            <span>{t.revoked_at ? `Revoked ${formatDate(t.revoked_at)}` : `${isLive(t) ? 'Expires' : 'Expired'} ${formatDate(t.expires_at)}`}</span>
            <span title={t.last_used_at ? formatDateTime(t.last_used_at) : undefined}>{lastUse(t)}</span>
            {sourcesText(t.allowed_sources) && <span title={t.allowed_sources!.join(', ')}>{sourcesText(t.allowed_sources)}</span>}
          </span>
          <ScopeChips scopes={t.scopes} />
        </div>
        {isLive(t) && (
          <Button size="sm" aria-label={`Revoke the token ${t.name}`} onClick={() => setRevoking(t)}>Revoke</Button>
        )}
      </li>
    );
  };

  return (
    <Card
      title="API tokens" flush
      actions={data && <Button size="sm" icon="plus" onClick={() => setCreating(true)}>New token</Button>}
    >
      <div className="card-body adm-card-lead">
        <p className="muted">
          A token lets a script or another system use the application's API as you, limited to the permissions you choose.
          See the <Link to="/help/api">API reference</Link> for what it can call.
        </p>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="card-body"><Loading lines={3} label="Loading your API tokens" /></div>
        : (
          <>
            {live.length === 0
              ? <EmptyState icon="key" title="No active tokens" message="Make one only when a script or another system needs it, and revoke it when it does not." />
              : <ul className="adm-sessions" aria-label="Active API tokens">{live.map(row)}</ul>}
            {old.length > 0 && (
              <details className="adm-fold adm-token-old">
                <summary><span className="adm-fold-more">Expired and revoked tokens ({old.length})</span></summary>
                <ul className="adm-sessions" aria-label="Expired and revoked API tokens">{old.map(row)}</ul>
              </details>
            )}
          </>
        )}
      <p className="card-body adm-card-foot muted">
        A token is shown once, when it is made. It can never do more than you can, and stops working when it expires or is revoked.
        Treat it like a password.
      </p>
      {data && <NewTokenDialog open={creating} data={data} onClose={() => setCreating(false)} onCreated={reload} />}
      <ConfirmDialog
        open={revoking !== null} danger busy={busy} title="Revoke this token?" confirmLabel="Revoke token"
        message={<p>Anything still using <strong>{revoking?.name}</strong> will be refused from now on. This cannot be undone; make a new token if you need one again.</p>}
        onConfirm={() => void revoke()} onCancel={() => setRevoking(null)}
      />
    </Card>
  );
}

const DAY_CHOICES = [7, 30, 90, 180, 365];

function NewTokenDialog({ open, data, onClose, onCreated }: { open: boolean; data: MyTokens; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const { resources } = useMeta();
  const { switchedOff } = useAuth();
  const options = useMemo(
    () => [
      ...scopeOptions(data.grants, Object.values(resources ?? {}).map((r) => r.module), (p) => p !== '*' && switchedOff(p)),
      // Extra abilities that are not permissions, such as using the token with an AI assistant (MCP).
      ...(data.scopeFamilies ?? []).map((f) => ({ value: f.scope, label: f.description })),
    ],
    [data.grants, data.scopeFamilies, resources, switchedOff],
  );
  const dayOptions = useMemo(() => {
    const days = [...new Set([...DAY_CHOICES.filter((d) => d <= data.maxDays), data.maxDays])].sort((a, b) => a - b);
    return days.map((d) => ({ value: String(d), label: d === 365 ? '1 year (365 days)' : `${d} days` }));
  }, [data.maxDays]);
  const firstDays = String(Math.min(90, data.maxDays));
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [days, setDays] = useState(firstDays);
  const [sources, setSources] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Created | null>(null);
  const viewOnly = options.filter((o) => o.value.endsWith('.view')).map((o) => o.value);

  const close = () => {
    // The token is dropped from memory here: it cannot be shown again.
    setMade(null); setName(''); setScopes([]); setDays(firstDays); setSources(''); setErrors({}); setFormError('');
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = 'Give the token a name, for example what will use it.';
    if (scopes.length === 0) found.scopes = 'Choose at least one permission.';
    if (!days) found.expiresInDays = 'Choose when the token expires.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const res = await adminApi.post<Created>('/api/me/tokens', { name: name.trim(), scopes, expiresInDays: Number(days), allowedSources: sourcesFrom(sources) });
      setMade(res);
      toast.success('Token made.');
      onCreated();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (made) {
    return (
      <Modal open={open} title={`Token "${made.name}" is ready`} onClose={close} footer={<Button variant="primary" onClick={close}>Done</Button>}>
        <div className="stack">
          <Notice tone="caution" role="status">
            <strong>This token is shown once.</strong> Copy it now and keep it somewhere safe, such as a password manager or the other
            system's secret store. When you close this window it cannot be shown again.
          </Notice>
          <CopyBox prominent label="Your new API token" copyLabel="Copy token" value={made.token} testId="api-token">
            <ul className="adm-facts">
              <li><Icon name="clock" size={16} /> <span>Expires <strong>{formatDate(made.expires_at)}</strong>.</span></li>
              <li><Icon name="key" size={16} /> <span>Send it in the header <code>Authorization: Bearer &lt;token&gt;</code>.</span></li>
              <li><Icon name="lock" size={16} /> <span>Anyone holding it can act as you within its permissions. If it leaks, revoke it.</span></li>
            </ul>
          </CopyBox>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} title="New API token" onClose={close}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <TextField
          label="Name" required maxLength={80} value={name} onChange={(v) => { setName(v); setErrors(({ name: _n, ...r }) => r); }}
          error={errors.name} hint="What will use it, for example “Nightly asset import”."
        />
        <div className="stack adm-gap-sm">
          <ChoicesField
            label="Permissions" required value={scopes} onChange={(v) => { setScopes(v); setErrors(({ scopes: _s, ...r }) => r); }}
            options={options} error={errors.scopes} placeholder="Choose what the token may do"
            hint="Only permissions you hold yourself are offered. If your own access is reduced later, the token's is too."
          />
          {viewOnly.length > 0 && (
            <div><Button size="sm" variant="ghost" icon="eye" onClick={() => setScopes(viewOnly)}>View only, everywhere I can see</Button></div>
          )}
        </div>
        <Select
          label="Expires after" required value={days} onChange={setDays} options={dayOptions} error={errors.expiresInDays}
          hint={`Tokens may last at most ${data.maxDays} days. Choose the shortest time that will do.`}
        />
        <TextArea
          label="Allowed source addresses" rows={2} value={sources} onChange={(v) => { setSources(v); setErrors(({ allowedSources: _a, ...r }) => r); }}
          error={errors.allowedSources} placeholder="203.0.113.7 or 10.20.0.0/16"
          hint={`Optional. The token works only from these addresses or ranges, one per line; leave empty to allow any address.${data.yourAddress ? ` This request came from ${data.yourAddress}.` : ''}`}
        />
        <Notice icon="lock">Making a token asks for your password if you have not given it in the last few minutes.</Notice>
        <div className="form-actions">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Make token</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- everyone's tokens (administrators) ----------

const PAGE_SIZE = 50;
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'revoked', label: 'Revoked' },
];

export function AdminTokensPage() {
  const toast = useToast();
  const auth = useAuth();
  const { data, error, reload } = useFetch<{ tokens: ApiToken[] }>('/api/admin/tokens');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [owner, setOwner] = useState('');
  const [page, setPage] = useState(1);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const [busy, setBusy] = useState(false);

  const owners = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of data?.tokens ?? []) if (t.userId) seen.set(t.userId, `${t.userName ?? t.username} (${t.username})`);
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  const needle = q.trim().toLowerCase();
  const rows = (data?.tokens ?? []).filter((t) => {
    if (owner && t.userId !== owner) return false;
    const s = t.revoked_at ? 'revoked' : isLive(t) ? 'active' : 'expired';
    if (status && s !== status) return false;
    return !needle || [t.name, t.prefix, t.userName, t.username, ...t.scopes].some((v) => String(v ?? '').toLowerCase().includes(needle));
  });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE);

  const pills: FilterPill[] = [];
  if (needle) pills.push({ key: 'q', label: 'Search', value: q.trim(), onRemove: () => { setQ(''); setPage(1); } });
  if (status) pills.push({ key: 'status', label: 'Status', value: STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status, onRemove: () => { setStatus(''); setPage(1); } });
  if (owner) pills.push({ key: 'owner', label: 'Owner', value: owners.find((o) => o.value === owner)?.label ?? 'Someone', onRemove: () => { setOwner(''); setPage(1); } });
  const clear = () => { setQ(''); setStatus(''); setOwner(''); setPage(1); };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await adminApi.del(`/api/admin/tokens/${revoking.id}`);
      toast.success(`Token "${revoking.name}" revoked.`);
      setRevoking(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="API tokens"
        subtitle="Every person's personal API tokens. People make their own on the Account security page; here you can see them all and revoke any."
        actions={<Link className="btn btn-secondary" to="/account/security">My tokens</Link>}
      />
      <Notice>
        A token acts as its owner, limited to the permissions chosen for it, and never more than the owner holds at the time. Every change made
        with a token is recorded in the audit log with the token's name. The longest life and the request limit for tokens are under{' '}
        <Link to="/admin/settings#settings-tokens">Settings</Link>.
      </Notice>
      <div className="adm-toolbar adm-toolbar-top">
        <TextField
          className="adm-toolbar-grow" label="Search tokens" hideLabel type="search" placeholder="Search by name, owner or permission"
          leftSection={<Icon name="search" size={16} />} value={q} onChange={(v) => { setQ(v); setPage(1); }}
        />
        <Select label="Status" hideLabel placeholder="Any status" options={STATUS_OPTIONS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
        <Select label="Owner" hideLabel placeholder="Anyone" options={owners} value={owner} onChange={(v) => { setOwner(v); setPage(1); }} />
      </div>
      <FilterPills pills={pills} onClear={clear} />
      <Card flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={6} label="Loading API tokens" /></div>
          : rows.length === 0 ? (
            <EmptyState
              icon="key"
              title={data.tokens.length === 0 ? 'Nobody has an API token' : 'No tokens match these filters'}
              message={data.tokens.length === 0 ? 'People make their own tokens on the Account security page.' : 'Change or clear the filters to see more.'}
              action={data.tokens.length > 0 && pills.length > 0 ? <Button onClick={clear}>Clear filters</Button> : undefined}
            />
          ) : (
            <>
              <div className="table-wrap adm-table-frame">
                <table className="table adm-tokens">
                  <thead>
                    <tr>
                      <th scope="col">Owner</th><th scope="col">Token</th><th scope="col">Permissions</th>
                      <th scope="col">Expires</th><th scope="col">Last used</th><th scope="col">Status</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((t) => {
                      const s = tokenState(t);
                      return (
                        <tr key={t.id}>
                          <td>
                            <span className="adm-person">
                              <Initials name={t.userName ?? t.username ?? '?'} />
                              <span className="adm-person-text">
                                <Link to={`/admin/users/${t.userId}`}>{t.userName ?? t.username}</Link>
                                <span className="muted truncate">{t.username}{t.userId === auth.user?.id ? ' (you)' : ''}</span>
                              </span>
                            </span>
                          </td>
                          <td className="adm-wrap">
                            <strong>{t.name}</strong>
                            <div className="muted adm-small"><code>{t.prefix}…</code> made {formatDate(t.created_at)}</div>
                            {sourcesText(t.allowed_sources) && <div className="muted adm-small" title={t.allowed_sources!.join(', ')}>{sourcesText(t.allowed_sources)}</div>}
                          </td>
                          <td className="adm-wrap"><ScopeChips scopes={t.scopes} max={3} /></td>
                          <td title={formatDateTime(t.expires_at)}>{formatDate(t.expires_at)}</td>
                          <td className="adm-wrap" title={t.last_used_at ? formatDateTime(t.last_used_at) : undefined}>
                            {t.last_used_at ? <>{relativeTime(t.last_used_at)}{t.last_used_ip && <div className="muted adm-small">{t.last_used_ip}</div>}</> : <span className="muted">Never</span>}
                          </td>
                          <td><StatusChip color={s.color} label={s.label} /></td>
                          <td className="adm-row-actions">
                            {isLive(t) && <Button size="sm" aria-label={`Revoke ${t.name}, owned by ${t.userName ?? t.username}`} onClick={() => setRevoking(t)}>Revoke</Button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager summary={`${rows.length} ${rows.length === 1 ? 'token' : 'tokens'}`} page={Math.min(page, pages)} pages={pages} onPage={setPage} />
            </>
          )}
      </Card>
      <ConfirmDialog
        open={revoking !== null} danger busy={busy} title="Revoke this token?" confirmLabel="Revoke token"
        message={(
          <p>
            <strong>{revoking?.name}</strong>, owned by {revoking?.userName ?? revoking?.username}, will stop working at once.
            Tell the owner: anything that uses it will be refused. {revoking && <Badge color="gray">{revoking.prefix}…</Badge>}
          </p>
        )}
        onConfirm={() => void revoke()} onCancel={() => setRevoking(null)}
      />
    </>
  );
}
