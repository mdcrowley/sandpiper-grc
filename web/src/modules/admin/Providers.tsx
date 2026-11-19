// Administration > Sign-in providers (/admin/sign-in-providers): single sign-on with the
// organization's identity provider, the password switch and the break-glass account.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, Icon, Loading, Menu, PageHeader, StatusChip, TextField,
  useFetch, useToast,
} from '../../core';
import { Notice } from './common';
import { ProviderEditor } from './ProviderEditor';
import { adminApi } from './reauth';
import { Switch } from './Switch';

export interface ProviderConfig {
  issuer: string; clientId: string; scopes: string; tokenAuth: 'client_secret_basic' | 'client_secret_post' | 'none';
  emailClaim: string; nameClaim: string; groupsClaim: string; algorithms: string[]; extraParams: Record<string, string>;
  mappingEnabled: boolean; mappings: { value: string; role: string }[]; jitEnabled: boolean; jitDomains: string[]; trustEmail: boolean;
}
export interface Provider {
  id: string; key: string; type: string; typeLabel: string; name: string; enabled: boolean; isDefault: boolean; sort: number;
  config: ProviderConfig; hasSecret: boolean; linked: number;
}
export interface ProvidersResponse {
  providers: Provider[];
  kinds: { type: string; label: string }[];
  callbackBase: string;
  callbackPathTemplate: string;
  publicUrl: string;
  localSignIn: boolean;
  localOffBlockers: { id: string; username: string; display_name: string }[];
  breakGlass: { id: string; username: string; display_name: string; totp_enabled: boolean; password_changed_at: string | null } | null;
  roles: { key: string; name: string; enabled: boolean }[];
}
export interface TestResult { ok: boolean; message: string; details?: Record<string, unknown> }

export const redirectAddress = (data: Pick<ProvidersResponse, 'callbackBase' | 'callbackPathTemplate'>, key: string) =>
  `${data.callbackBase}${data.callbackPathTemplate.replace('%7Bkey%7D', key || '<short name>').replace('{key}', key || '<short name>')}`;

export function ProvidersPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch<ProvidersResponse>('/api/admin/identity-providers');
  const [editing, setEditing] = useState<Provider | 'new' | null>(null);
  const [removing, setRemoving] = useState<Provider | null>(null);
  const [busy, setBusy] = useState('');

  const act = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try { await work(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(''); }
  };
  const toggle = (p: Provider, on: boolean) => act(`toggle-${p.id}`, async () => {
    await adminApi.patch(`/api/admin/identity-providers/${p.id}`, { enabled: on });
    toast.success(on ? `${p.name} switched on. Its button now shows on the sign-in page.` : `${p.name} switched off. Nothing more is fetched from it.`);
    reload();
  });
  const makeDefault = (p: Provider) => act(`default-${p.id}`, async () => {
    await adminApi.patch(`/api/admin/identity-providers/${p.id}`, { isDefault: true });
    toast.success(`${p.name} is now the default: its button comes first.`);
    reload();
  });
  const test = (p: Provider) => act(`test-${p.id}`, async () => {
    const r = await api.post<TestResult>(`/api/admin/identity-providers/${p.id}/test`);
    if (r.ok) toast.success(r.message); else toast.error(r.message);
  });
  const remove = () => removing && act('remove', async () => {
    await adminApi.del(`/api/admin/identity-providers/${removing.id}`);
    toast.success(`${removing.name} removed.`);
    setRemoving(null);
    reload();
  });

  return (
    <>
      <PageHeader
        title="Sign-in providers"
        subtitle="Let people sign in with their organization account. Nothing is contacted until a provider is switched on."
        actions={<Button variant="primary" icon="plus" disabled={!data} onClick={() => setEditing('new')}>Add provider</Button>}
      />
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={8} label="Loading sign-in providers" />
        : (
          <div className="stack">
            <Card flush>
              {data.providers.length === 0 ? (
                <EmptyState
                  icon="lock" title="No sign-in providers yet"
                  message="Everyone signs in with a password. Add your organization's OpenID Connect provider to offer single sign-on."
                  action={<Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add provider</Button>}
                />
              ) : (
                <div className="table-wrap adm-table-frame">
                  <table className="table adm-providers">
                    <thead>
                      <tr>
                        <th scope="col">Provider</th><th scope="col">Kind</th><th scope="col">Linked people</th><th scope="col">Options</th>
                        <th scope="col">On</th><th scope="col"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.providers.map((p) => (
                        <tr key={p.id}>
                          <td className="adm-wrap">
                            <button type="button" className="adm-link-button" onClick={() => setEditing(p)}>{p.name}</button>
                            {p.isDefault && <> <StatusChip color="blue" label="Default" size="sm" /></>}
                            <div className="muted adm-small adm-break">{p.config.issuer}</div>
                          </td>
                          <td className="adm-small">{p.typeLabel}</td>
                          <td>{p.linked}</td>
                          <td className="adm-wrap">
                            <span className="row adm-chips">
                              {p.config.mappingEnabled && <StatusChip color="purple" label="Role mapping" size="sm" />}
                              {p.config.jitEnabled && <StatusChip color="amber" label="Creates accounts" size="sm" />}
                              {!p.hasSecret && p.config.tokenAuth !== 'none' && <StatusChip color="red" label="No client secret" size="sm" />}
                              {!p.config.mappingEnabled && !p.config.jitEnabled && (p.hasSecret || p.config.tokenAuth === 'none') && <span className="muted adm-small">None</span>}
                            </span>
                          </td>
                          <td><Switch label={`${p.name} switched on`} hideLabel checked={p.enabled} disabled={busy === `toggle-${p.id}`} onChange={(on) => void toggle(p, on)} /></td>
                          <td className="adm-row-actions">
                            <Menu
                              label={`Actions for ${p.name}`} icon="more" iconOnly size="sm" align="end"
                              items={[
                                { label: 'Edit', icon: 'edit', onSelect: () => setEditing(p) },
                                { label: busy === `test-${p.id}` ? 'Testing…' : 'Test connection', icon: 'refresh', disabled: busy !== '', onSelect: () => void test(p) },
                                ...(!p.isDefault && p.enabled ? [{ label: 'Make default', icon: 'star' as const, onSelect: () => void makeDefault(p) }] : []),
                                { label: 'Remove', icon: 'trash', danger: true, separated: true, disabled: p.enabled, onSelect: () => setRemoving(p) },
                              ]}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <div className="grid-2 adm-sso-grid">
              <PasswordCard data={data} onChanged={reload} />
              <AddressCard data={data} onChanged={reload} />
            </div>
          </div>
        )}
      {data && editing && (
        <ProviderEditor
          key={editing === 'new' ? 'new' : editing.id} provider={editing === 'new' ? null : editing} data={data}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      <ConfirmDialog
        open={removing !== null} danger busy={busy === 'remove'} title="Remove this provider?" confirmLabel="Remove provider"
        message={<p><strong>{removing?.name}</strong> disappears from the sign-in page for good, and its {removing?.linked ?? 0} linked identities stop working. The audit log keeps its history. To pause it instead, switch it off.</p>}
        onConfirm={() => void remove()} onCancel={() => setRemoving(null)}
      />
    </>
  );
}

/** Password sign-in on or off, and the break-glass account that always keeps it. */
function PasswordCard({ data, onChanged }: { data: ProvidersResponse; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const bg = data.breakGlass;
  const set = async (on: boolean) => {
    setBusy(true);
    setProblem('');
    try {
      await adminApi.patch('/api/admin/settings', { 'auth.local_signin': on });
      toast.success(on ? 'Passwords work again for everyone.' : 'Passwords switched off. Only the break-glass account can still use one.');
      onChanged();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields ?? {};
      setProblem(fields['auth.local_signin'] ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const blockers = data.localOffBlockers;
  return (
    <Card title="Passwords" actions={<StatusChip color={data.localSignIn ? 'green' : 'amber'} label={data.localSignIn ? 'On for everyone' : 'Break-glass only'} />}>
      <div className="stack">
        <Switch label="Allow sign-in with a password" checked={data.localSignIn} disabled={busy} onChange={(on) => void set(on)} />
        <p className="muted adm-small">
          Switch this off once everybody signs in through a provider. The break-glass account keeps its password whatever this says.
          It can be switched off only when there is a break-glass account and every other active person has a linked provider.
        </p>
        {problem && <Notice tone="danger" role="alert">{problem}</Notice>}
        {data.localSignIn && blockers.length > 0 && (
          <details className="adm-fold">
            <summary><span className="adm-fold-more">{blockers.length} active {blockers.length === 1 ? 'person has' : 'people have'} no linked provider yet</span></summary>
            <ul className="adm-plain-list">
              {blockers.map((b) => <li key={b.id}><Link to={`/admin/users/${b.id}`}>{b.display_name}</Link> <span className="muted">({b.username})</span></li>)}
            </ul>
          </details>
        )}
        <div className="adm-bg-box">
          <h3 className="adm-step-title"><Icon name="alert" size={16} /> Break-glass account</h3>
          {bg ? (
            <p>
              <Link to={`/admin/users/${bg.id}`}>{bg.display_name}</Link> <span className="muted">({bg.username})</span>{' '}
              {bg.totp_enabled ? <StatusChip color="green" label="Second factor on" size="sm" /> : <StatusChip color="red" label="No second factor" size="sm" />}
            </p>
          ) : (
            <p>None yet. Choose one on a user's page, under <strong>Single sign-on</strong>.</p>
          )}
          <p className="muted adm-small">
            One local administrator for when single sign-on is unavailable. Give it a long random password (30 characters or more)
            kept sealed, and a second factor on a hardware key stored separately. Every sign-in alerts every administrator.
          </p>
        </div>
      </div>
    </Card>
  );
}

/** The application address, from which the redirect address given to each provider is made. */
function AddressCard({ data, onChanged }: { data: ProvidersResponse; onChanged: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(data.publicUrl);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await adminApi.patch('/api/admin/settings', { 'auth.public_url': value.trim() });
      toast.success('Application address saved.');
      onChanged();
    } catch (err) {
      setError((err as { fields?: Record<string, string> }).fields?.['auth.public_url'] ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Redirect address">
      <div className="stack">
        <p>Each provider needs to know where to send people back. Register this address with the provider, replacing the short name:</p>
        <code className="adm-code-block adm-break">{redirectAddress(data, '')}</code>
        <TextField
          label="Application address" placeholder="https://grc.example.org" value={value} onChange={(v) => { setValue(v); setError(''); }} error={error || undefined}
          hint="The https address people type to open the application. Leave empty to use the address of the current request."
        />
        <div className="form-actions">
          <Button disabled={value === data.publicUrl} onClick={() => setValue(data.publicUrl)}>Undo</Button>
          <Button variant="primary" disabled={value === data.publicUrl} loading={busy} onClick={() => void save()}>Save address</Button>
        </div>
      </div>
    </Card>
  );
}
