// Account security: the person's own linked sign-in providers (link, unlink, confirm through a
// provider) and the break-glass notice for the session. A directory (LDAP) is linked and confirmed
// with its user name and password here, not by a trip to it (E02-29).
import { useEffect, useState, type FormEvent } from 'react';
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, Button, Card, ConfirmDialog, errorMessage, formatDateTime, Modal, StatusChip, TextField, useFetch, useToast } from '../../core';
import { Notice } from './common';
import { confirmIdentity, withReauth } from './reauth';
import { LINK_METHOD } from './UserSignIn';

interface Mine {
  identities: { id: string; email: string | null; linked_at: string; last_used_at: string | null; link_method: string; provider_key: string; provider_name: string; provider_type?: string; enabled: boolean }[];
  available: { key: string; name: string; style?: 'redirect' | 'credentials' }[];
  hasPassword: boolean;
  localSignIn: boolean;
  breakGlass: boolean;
  session: { method: string; provider: string | null; breakGlass: boolean };
}

const LINK_FAILED: Record<string, string> = {
  email: 'The email address the provider gave is not the one on your account here, so nothing was linked. Ask an administrator to correct one of them.',
  taken: 'That identity is already linked to another account here.',
  unverified: 'The provider did not confirm an email address, so nothing was linked.',
  already_linked: 'Your account is already linked to that provider.',
  break_glass: 'The break-glass account cannot be linked.',
};

/** Links a directory to the account with the person's user name and password there (E02-29). */
function LinkDirectoryDialog({ provider, canPrompt, onClose, onLinked, onNeedConfirm }: {
  provider: { key: string; name: string } | null; canPrompt: boolean; onClose: () => void; onLinked: () => void; onNeedConfirm: () => void;
}) {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!provider) return;
    const found: Record<string, string> = {};
    if (!username.trim()) found.username = 'Enter your user name.';
    if (!password) found.password = 'Enter your password.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const run = () => api.post(`/api/auth/sso/${encodeURIComponent(provider.key)}/link-directory`, { username: username.trim(), password });
      if (canPrompt) await withReauth(run); else await run();
      toast.success(`Linked. You can now sign in with ${provider.name}.`);
      onLinked();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'reauth_required') { onNeedConfirm(); onClose(); return; }
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      if (!Object.keys(fields).length) setFormError(err instanceof ApiError && err.code === 'invalid_credentials' ? `${provider.name} did not accept that user name and password.` : errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={provider !== null} title={`Link ${provider?.name ?? ''}`} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <p className="muted">
          Enter your user name and password at {provider?.name}, as you would to sign in there. The directory must give the same email address as your account here.
          You may be asked to confirm it is you first.
        </p>
        <TextField label="User name" required autoFocus autoComplete="off" value={username} onChange={setUsername} error={errors.username} />
        <TextField label="Password" required type="password" autoComplete="off" value={password} onChange={setPassword} error={errors.password} />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Link {provider?.name}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Reads `?sso=` after a trip to a provider, says what happened, and tidies the address. */
function SsoResult({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { search, pathname } = useLocation();
  useEffect(() => {
    const q = new URLSearchParams(search);
    const result = q.get('sso');
    if (!result) return;
    if (result === 'linked') toast.success('Linked. You can now sign in with that provider.');
    else if (result === 'link_failed') toast.error(LINK_FAILED[q.get('why') ?? ''] ?? 'Linking did not work. Try again, or ask an administrator.');
    else if (result === 'confirmed') toast.success('Confirmed. For the next few minutes you can make changes that ask for a confirmation.');
    else toast.error('That did not work. Try again, or ask an administrator.');
    navigate(pathname, { replace: true });
    onDone();
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function LinkedIdentitiesCard() {
  const toast = useToast();
  const inRouter = useInRouterContext();
  const { data, reload } = useFetch<Mine>('/api/auth/identities');
  const [unlinking, setUnlinking] = useState<Mine['identities'][number] | null>(null);
  const [needConfirm, setNeedConfirm] = useState(false);
  const [busy, setBusy] = useState('');
  const [linkingDirectory, setLinkingDirectory] = useState<{ key: string; name: string } | null>(null);
  // The confirmation dialog can ask for a password here, or for a linked directory's (E02-29).
  const canPrompt = Boolean(data && (data.hasPassword || data.identities.some((i) => i.enabled && i.provider_type === 'ldap')));

  const confirmWithDirectory = async (key: string) => {
    if (await confirmIdentity(key)) {
      toast.success('Confirmed. For the next few minutes you can make changes that ask for a confirmation.');
      setNeedConfirm(false);
    }
  };

  const go = async (url: string, key: string) => {
    setBusy(key);
    try {
      const run = () => api.post<{ redirectUrl: string }>(url, { returnTo: '/account/security' });
      // With a password, a stale confirmation turns into the usual password prompt.
      const { redirectUrl } = canPrompt ? await withReauth(run) : await run();
      window.location.assign(redirectUrl);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'reauth_required') setNeedConfirm(true);
      else toast.error(errorMessage(err));
      setBusy('');
    }
  };

  const unlink = async () => {
    if (!unlinking) return;
    setBusy('unlink');
    try {
      const run = () => api.del(`/api/auth/identities/${unlinking.id}`);
      if (canPrompt) await withReauth(run); else await run();
      toast.success(`${unlinking.provider_name} unlinked.`);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'reauth_required') setNeedConfirm(true);
      else toast.error(errorMessage(err));
    } finally {
      setBusy('');
      setUnlinking(null);
    }
  };

  if (!data) return null;
  const nothing = !data.identities.length && !data.available.length;

  return (
    <>
      {inRouter && <SsoResult onDone={reload} />}
      {data.session.breakGlass && (
        <Notice tone="danger" role="alert" icon="alert">
          <strong>You are signed in with the break-glass account.</strong> Every administrator has been alerted. Use it only to deal with the emergency, then sign out.
        </Notice>
      )}
      {!nothing && (
        <Card title="Single sign-on" actions={data.identities.length ? <StatusChip color="green" label={`${data.identities.length} linked`} /> : <StatusChip color="gray" label="Not linked" />}>
          <div className="stack">
            {data.session.method !== 'local' && data.session.provider && <p className="muted adm-small">This session was started through {data.session.provider}.</p>}
            {data.identities.length > 0 && (
              <ul className="adm-identities">
                {data.identities.map((i) => (
                  <li key={i.id}>
                    <div>
                      <strong>{i.provider_name}</strong>{!i.enabled && <> <StatusChip color="gray" label="Switched off" size="sm" /></>}
                      <div className="muted adm-small">{i.email ?? 'No email'} · {LINK_METHOD[i.link_method] ?? 'Linked'} {formatDateTime(i.linked_at)}</div>
                    </div>
                    <Button size="sm" onClick={() => setUnlinking(i)}>Unlink</Button>
                  </li>
                ))}
              </ul>
            )}
            {data.available.length > 0 && (
              <>
                <p>{data.identities.length ? 'You can also link:' : 'Link your organization account to sign in with it instead of a password.'} You will be asked to sign in at the provider (for a directory, to enter its user name and password here); it must give the same email address as your account here.</p>
                <div className="row">
                  {data.available.map((p) => (
                    <Button
                      key={p.key} icon="link" loading={busy === p.key} disabled={Boolean(busy)}
                      onClick={() => (p.style === 'credentials' ? setLinkingDirectory(p) : void go(`/api/auth/sso/${encodeURIComponent(p.key)}/link`, p.key))}
                    >Link {p.name}</Button>
                  ))}
                </div>
              </>
            )}
            {needConfirm && !data.hasPassword && data.identities.some((i) => i.enabled) && (
              <Notice tone="caution" role="status">
                <p>Confirm it is you first. You have no password here, so confirm through your provider, then try again.</p>
                <div className="row">
                  {/* A directory (LDAP) confirms with its user name and password in the confirmation dialog (E02-29); others by a trip to the provider. */}
                  {data.identities.filter((i) => i.enabled).map((i) => (
                    <Button
                      key={i.id} size="sm" loading={busy === `re-${i.provider_key}`}
                      onClick={() => void (i.provider_type === 'ldap' ? confirmWithDirectory(i.provider_key) : go(`/api/auth/sso/${encodeURIComponent(i.provider_key)}/reauth`, `re-${i.provider_key}`))}
                    >Confirm with {i.provider_name}</Button>
                  ))}
                </div>
              </Notice>
            )}
            {!data.localSignIn && !data.breakGlass && (
              <p className="muted adm-small">
                {data.hasPassword ? 'Password sign-in is switched off for your account' : 'You have no password here'}, so a linked provider is how you sign in.
                The last one cannot be unlinked.
              </p>
            )}
          </div>
          <LinkDirectoryDialog
            key={linkingDirectory?.key ?? 'none'} provider={linkingDirectory} canPrompt={canPrompt}
            onClose={() => setLinkingDirectory(null)} onLinked={reload} onNeedConfirm={() => setNeedConfirm(true)}
          />
          <ConfirmDialog
            open={unlinking !== null} danger busy={busy === 'unlink'} title={`Unlink ${unlinking?.provider_name ?? ''}?`} confirmLabel="Unlink"
            message={`You will no longer be able to sign in with ${unlinking?.provider_name ?? 'it'}, and your other sessions made through it end. You may be asked to confirm it is you. The last way you can sign in cannot be unlinked.`}
            onConfirm={() => void unlink()} onCancel={() => setUnlinking(null)}
          />
        </Card>
      )}
    </>
  );
}
