// /oauth/authorize for the mobile app (wave 13, E38-02): the app opens this page in the phone's browser
// sheet; signed in here as usual (password, second factor, passkey or single sign-on), the person
// confirms that the app on the named phone may sign in as them. The server checks the request
// (POST /api/mobile/oauth/authorize) and, on a decision, answers where the browser goes next: always
// the app's own address (com.sandpipergrc:/oauth) with a code or an error. The AI assistant consent
// page (modules/mcp/ConsentPage.tsx) hands requests from the app here.
import { useEffect, useMemo, useState } from 'react';
import { api, Button, Card, ErrorState, errorMessage, Loading, PageHeader, useAuth, withReauth } from '../../core';
import { MOBILE_REDIRECT_URI } from '../../../../shared/mobile-api.ts';

const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method',
  'installation_id', 'device_name', 'device_platform', 'app_version', 'prompt'];

interface Check {
  ok: true;
  device: { name: string; platform: 'ios' | 'android'; appVersion: string };
  promptLogin: boolean;
  signedInAlready: boolean;
  appName: string;
}

/** Leaves for the app; only ever its own address. */
function backToApp(url: string) {
  if (!url.startsWith(`${MOBILE_REDIRECT_URI}?`)) throw new Error('The server gave an address this page will not open.');
  window.location.assign(url);
}

const platformName = (p: string) => (p === 'ios' ? 'iPhone' : 'Android');

export function MobileSignInPage() {
  const { user } = useAuth();
  const params = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    return Object.fromEntries(PARAMS.filter((k) => q.has(k)).map((k) => [k, q.get(k) ?? '']));
  }, []);
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [actionError, setActionError] = useState('');
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let live = true;
    api.post<Check | { ok: false; redirect: string }>('/api/mobile/oauth/authorize', params)
      .then((res) => {
        if (!live) return;
        if (!res.ok) { setLeaving(true); backToApp(res.redirect); return; }
        setCheck(res);
      })
      .catch((err) => { if (live) setError(err); });
    return () => { live = false; };
  }, [params]);

  const decide = async (approve: boolean) => {
    setBusy(approve ? 'allow' : 'deny');
    setActionError('');
    try {
      const body = { ...params, approve };
      const res = approve
        ? await withReauth(() => api.post<{ redirect: string }>('/api/mobile/oauth/decision', body))
        : await api.post<{ redirect: string }>('/api/mobile/oauth/decision', body);
      setLeaving(true);
      backToApp(res.redirect);
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(null);
    }
  };

  const title = check?.promptLogin ? 'Confirm it is you' : 'Sign in to the app';
  return (
    <div className="mcp-page mcp-consent">
      <PageHeader title={title} subtitle="The Sandpiper GRC app on a phone is asking to sign in as you." />
      {error ? <ErrorState error={error} />
        : leaving ? <Loading lines={2} label="Returning to the app" />
        : !check ? <Loading lines={4} label="Checking the request" />
        : (
          <Card title={check.promptLogin
            ? `Confirm a sensitive action in the app on "${check.device.name}"?`
            : `Sign in to the ${check.appName} app on "${check.device.name}"?`}>
            <div className="stack">
              <ul className="mcp-list">
                <li>The app on <strong>{check.device.name}</strong> ({platformName(check.device.platform)}, app version {check.device.appVersion}) will act as <strong>{user?.displayName}</strong> and see only what you can see.</li>
                {check.promptLogin
                  ? <li>You are confirming who you are for something sensitive you started in the app, such as an approval that asks for your password. It counts for a few minutes only.</li>
                  : <li>{check.signedInAlready ? 'This phone is already signed in; it will be signed in again.' : 'The phone appears under Devices on your account, where you can sign it out at any time.'}</li>}
                <li>Continue only if you just started this from the app on your own phone.</li>
              </ul>
              {actionError && <p className="form-error" role="alert">{actionError}</p>}
              <div className="form-actions">
                <Button onClick={() => void decide(false)} loading={busy === 'deny'} disabled={busy !== null}>Cancel</Button>
                <Button variant="primary" onClick={() => void decide(true)} loading={busy === 'allow'} disabled={busy !== null}>
                  {check.promptLogin ? 'Confirm' : 'Sign in'}
                </Button>
              </div>
              <p className="muted">This asks for your password (and second factor) if you have not given it in the last few minutes.</p>
            </div>
          </Card>
        )}
    </div>
  );
}
