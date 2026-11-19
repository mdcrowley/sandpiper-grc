// Account security: the person's own linked sign-in providers (link, unlink, confirm through a
// provider) and the break-glass notice for the session.
import { useEffect, useState } from 'react';
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, Button, Card, ConfirmDialog, errorMessage, formatDateTime, StatusChip, useFetch, useToast } from '../../core';
import { Notice } from './common';
import { withReauth } from './reauth';
import { LINK_METHOD } from './UserSignIn';

interface Mine {
  identities: { id: string; email: string | null; linked_at: string; last_used_at: string | null; link_method: string; provider_key: string; provider_name: string; enabled: boolean }[];
  available: { key: string; name: string }[];
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

  const go = async (url: string, key: string) => {
    setBusy(key);
    try {
      const run = () => api.post<{ redirectUrl: string }>(url, { returnTo: '/account/security' });
      // With a password, a stale confirmation turns into the usual password prompt.
      const { redirectUrl } = data?.hasPassword ? await withReauth(run) : await run();
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
      if (data?.hasPassword) await withReauth(run); else await run();
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
                <p>{data.identities.length ? 'You can also link:' : 'Link your organization account to sign in with it instead of a password.'} You will be asked to sign in at the provider; it must give the same email address as your account here.</p>
                <div className="row">
                  {data.available.map((p) => (
                    <Button key={p.key} icon="link" loading={busy === p.key} disabled={Boolean(busy)} onClick={() => void go(`/api/auth/sso/${encodeURIComponent(p.key)}/link`, p.key)}>Link {p.name}</Button>
                  ))}
                </div>
              </>
            )}
            {needConfirm && !data.hasPassword && data.identities.some((i) => i.enabled) && (
              <Notice tone="caution" role="status">
                <p>Confirm it is you first. You have no password here, so confirm through your provider, then try again.</p>
                <div className="row">
                  {data.identities.filter((i) => i.enabled).map((i) => (
                    <Button key={i.id} size="sm" loading={busy === `re-${i.provider_key}`} onClick={() => void go(`/api/auth/sso/${encodeURIComponent(i.provider_key)}/reauth`, `re-${i.provider_key}`)}>Confirm with {i.provider_name}</Button>
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
