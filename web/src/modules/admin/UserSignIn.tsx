// The "Single sign-on" card on a user's page: linked identities, which ways the person may sign in,
// permission to link at the next sign-in, and the break-glass designation.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button, Card, Checkbox, ConfirmDialog, ErrorState, errorMessage, formatDateTime, Loading, Select, StatusChip, useFetch, useToast,
} from '../../core';
import type { AdminUser } from './common';
import { Notice } from './common';
import { adminApi } from './reauth';

interface Identity {
  id: string; email: string | null; linked_at: string; last_used_at: string | null; link_method: string;
  provider_key: string; provider_name: string; enabled: boolean;
}
interface SignIn {
  identities: Identity[];
  allowedMethods: string[] | null;
  breakGlass: boolean;
  permit: { providerId: string; providerName: string; expiresAt: string } | null;
  providers: { id: string; key: string; name: string; enabled: boolean }[];
  localSignIn: boolean;
  hasPassword: boolean;
  breakGlassUser: { id: string; username: string; display_name: string } | null;
}

export const LINK_METHOD: Record<string, string> = {
  self: 'Linked by the person',
  sign_in_confirmed: 'Linked at sign-in, confirmed with the password',
  permit: 'Linked at sign-in, allowed by an administrator',
  jit: 'Account created at first sign-in',
};

interface Pending { title: string; message: string; label: string; danger?: boolean; run: () => Promise<void> }

export function UserSignInCard({ user, onChanged }: { user: AdminUser; onChanged: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<SignIn>(`/api/admin/users/${user.id}/sign-in`);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [permitFor, setPermitFor] = useState('');
  const [restricted, setRestricted] = useState(false);
  const [methods, setMethods] = useState<string[]>([]);
  useEffect(() => {
    setRestricted(Boolean(data?.allowedMethods));
    setMethods(data?.allowedMethods ?? []);
  }, [data?.allowedMethods?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = user.display_name;
  const done = () => { reload(); onChanged(); };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); done(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); setConfirm(null); }
  };

  if (error) return <Card title="Single sign-on"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="Single sign-on"><Loading lines={4} label="Loading sign-in settings" /></Card>;

  const enabledProviders = data.providers.filter((p) => p.enabled);
  const linkable = enabledProviders.filter((p) => !data.identities.some((i) => i.provider_key === p.key));
  const saved = data.allowedMethods ?? [];
  const dirty = restricted !== Boolean(data.allowedMethods) || (restricted && [...methods].sort().join(',') !== [...saved].sort().join(','));
  const otherBreakGlass = data.breakGlassUser && data.breakGlassUser.id !== user.id ? data.breakGlassUser : null;

  return (
    <Card title="Single sign-on" actions={data.breakGlass ? <StatusChip color="red" label="Break-glass account" /> : undefined}>
      <div className="stack">
        {data.breakGlass && (
          <Notice tone="danger" icon="alert">
            <strong>This is the break-glass account.</strong> It always signs in with its password, never through a provider, and every
            sign-in alerts every administrator. Keep its password long and random, and its second factor on a hardware key stored apart.
          </Notice>
        )}

        <div>
          <h3 className="adm-step-title">Linked identities</h3>
          {data.identities.length === 0 ? (
            <p className="muted">None. {name} signs in with a password{enabledProviders.length ? ' only' : ''}.</p>
          ) : (
            <ul className="adm-identities">
              {data.identities.map((i) => (
                <li key={i.id}>
                  <div>
                    <strong>{i.provider_name}</strong>{!i.enabled && <> <StatusChip color="gray" label="Provider off" size="sm" /></>}
                    <div className="muted adm-small">{i.email ?? 'No email'} · {LINK_METHOD[i.link_method] ?? i.link_method} {formatDateTime(i.linked_at)}</div>
                    <div className="muted adm-small">{i.last_used_at ? `Last used ${formatDateTime(i.last_used_at)}` : 'Not used to sign in yet'}</div>
                  </div>
                  <Button size="sm" variant="danger" onClick={() => setConfirm({
                    title: `Unlink ${i.provider_name}?`, danger: true, label: 'Unlink',
                    message: `${name} will no longer be able to sign in with ${i.provider_name}, and sessions made through it end. Their account, roles and history are kept. They can link it again later.`,
                    run: async () => { await adminApi.del(`/api/admin/users/${user.id}/identities/${i.id}`); toast.success('Unlinked.'); },
                  })}>Unlink</Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!data.breakGlass && linkable.length > 0 && (
          <div>
            <h3 className="adm-step-title">Link at next sign-in</h3>
            {data.permit ? (
              <div className="row">
                <span>{name} may link a <strong>{data.permit.providerName}</strong> identity with the email {user.email} until {formatDateTime(data.permit.expiresAt)}.</span>
                <Button size="sm" onClick={() => void run(async () => { await adminApi.del(`/api/admin/users/${user.id}/link-permit`); toast.success('Withdrawn.'); })}>Withdraw</Button>
              </div>
            ) : (
              <div className="adm-inline-form">
                <Select label="Provider" value={permitFor} onChange={setPermitFor} options={linkable.map((p) => ({ value: p.id, label: p.name }))} placeholder="Choose a provider" />
                <Button disabled={!permitFor || busy} onClick={() => void run(async () => {
                  const r = await adminApi.post<{ providerName: string }>(`/api/admin/users/${user.id}/link-permit`, { providerId: permitFor });
                  toast.success(`${name} can now link ${r.providerName} at their next sign-in.`);
                  setPermitFor('');
                })}>Allow</Button>
              </div>
            )}
            <p className="muted adm-small">For someone who cannot link it themselves (for example with passwords switched off). Their first sign-in with that provider, with the verified email {user.email}, links it. Valid for 7 days.</p>
          </div>
        )}

        {!data.breakGlass && (
          <div>
            <h3 className="adm-step-title">Ways to sign in</h3>
            <Checkbox label="Allow only the ways checked below" checked={restricted} onChange={(on) => { setRestricted(on); if (on && !methods.length) setMethods(['local', ...enabledProviders.map((p) => p.key)]); }} />
            {restricted && (
              <div className="adm-check-list">
                <Checkbox label="Password" checked={methods.includes('local')} onChange={(on) => setMethods((m) => (on ? [...m, 'local'] : m.filter((x) => x !== 'local')))}
                  hint={data.localSignIn ? undefined : 'Passwords are switched off for everyone at the moment.'} />
                {data.providers.map((p) => (
                  <Checkbox key={p.key} label={`${p.name}${p.enabled ? '' : ' (switched off)'}`} checked={methods.includes(p.key)}
                    onChange={(on) => setMethods((m) => (on ? [...m, p.key] : m.filter((x) => x !== p.key)))} />
                ))}
              </div>
            )}
            <div className="form-actions">
              <Button size="sm" disabled={!dirty} onClick={() => { setRestricted(Boolean(data.allowedMethods)); setMethods(saved); }}>Undo</Button>
              <Button size="sm" variant="primary" disabled={!dirty || (restricted && !methods.length)} loading={busy} onClick={() => void run(async () => {
                await adminApi.patch(`/api/admin/users/${user.id}/sign-in`, { allowedMethods: restricted ? methods : null });
                toast.success('Ways to sign in saved.');
              })}>Save</Button>
            </div>
          </div>
        )}

        {data.breakGlass ? (
          <div>
            <Button size="sm" disabled={busy} onClick={() => setConfirm({
              title: 'Remove the break-glass designation?', label: 'Remove designation',
              message: `${name} becomes an ordinary account. Choose another break-glass account straight away: it is the way back in when single sign-on fails.`,
              run: async () => { await adminApi.post(`/api/admin/users/${user.id}/break-glass`, { breakGlass: false }); toast.success('Designation removed.'); },
            })}>Remove break-glass designation</Button>
          </div>
        ) : (
        <div className="adm-bg-box">
          <h3 className="adm-step-title">Break-glass account</h3>
          {otherBreakGlass ? (
            <p className="muted adm-small">The break-glass account is <Link to={`/admin/users/${otherBreakGlass.id}`}>{otherBreakGlass.display_name}</Link>. There can be only one.</p>
          ) : (
            <>
              <p className="muted adm-small">One local administrator that always keeps its password, for when single sign-on is unavailable. It must be active, hold the Administrator role, have a password and no linked provider.</p>
              <Button size="sm" disabled={busy || user.status !== 'active' || !data.hasPassword} onClick={() => setConfirm({
                title: `Make ${name} the break-glass account?`, label: 'Make break-glass account', danger: true,
                message: `${name} will always sign in with a password and never through a provider, and every sign-in will alert every administrator. Give it a long random password kept sealed, and a second factor on a hardware key stored separately.`,
                run: async () => { await adminApi.post(`/api/admin/users/${user.id}/break-glass`, { breakGlass: true }); toast.success(`${name} is now the break-glass account.`); },
              })}>Make break-glass account</Button>
            </>
          )}
        </div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(confirm)} title={confirm?.title ?? ''} message={confirm?.message ?? ''} confirmLabel={confirm?.label}
        danger={confirm?.danger} busy={busy} onConfirm={() => confirm && void run(confirm.run)} onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}
