// Signing in with a passkey: on its own ("Sign in with a passkey"), or after the password in place of
// the 6-digit code. Embeddable in the sign-in page; also used by the page at /sign-in/passkey.
import { useState } from 'react';
import { api, ApiError, Button, errorMessage, Icon, useAuth } from '../../core';
import './account-keys.css';
import { browserKeyError, getAssertion, passkeysSupported } from './webauthn';

const SIGNIN_FAILED = 'Sign-in with the key failed. Try again, or sign in with your password.';

/** Plain message for a failed passkey sign-in: the server's own words where it explains, else generic. */
function signInError(err: unknown): string {
  const browser = browserKeyError(err);
  if (browser) return browser;
  if (err instanceof ApiError && (err.status === 0 || err.status === 429 || err.code === 'passkeys_unavailable'
    || err.code === 'passkey_sign_in_off' || err.code.startsWith('passkey_'))) return err.message;
  return SIGNIN_FAILED;
}

/**
 * The second step after a correct password: asks the browser for one of this person's keys and
 * finishes the sign-in. Resolves when signed in; throws with a plain message otherwise. With
 * `directory` (a directory provider's key), the password is that directory's (E02-29).
 */
export async function signInWithKeyAfterPassword(username: string, password: string, directory?: string): Promise<void> {
  const base = directory ? `/api/auth/sso/${encodeURIComponent(directory)}` : '';
  try {
    const options = await api.post(directory ? `${base}/passkey-options` : '/api/auth/webauthn/login/options', { username, password });
    const webauthn = await getAssertion(options);
    await api.post(directory ? `${base}/login` : '/api/auth/login', { username, password, webauthn });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'no_passkeys') throw new Error(err.message);
    throw new Error(signInError(err));
  }
}

/** "Sign in with a passkey": a passkey alone, no username or password. Shown under the password form. */
export function PasskeySignIn({ divider = true, primary = false }: { divider?: boolean; primary?: boolean }) {
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!passkeysSupported()) return null;

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const options = await api.post('/api/auth/webauthn/login/options', {});
      const credential = await getAssertion(options);
      await api.post('/api/auth/webauthn/login', { credential });
      await refresh();
    } catch (err) {
      setError(signInError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ak-signin">
      {divider && <p className="ak-or">or</p>}
      {error && <p className="form-error" role="alert"><Icon name="alert-circle" size={16} /><span>{error}</span></p>}
      <Button icon="key" variant={primary ? 'primary' : 'secondary'} loading={busy} onClick={() => void go()}>Sign in with a passkey</Button>
    </div>
  );
}

/** "Use a passkey or security key instead", for the 6-digit-code step of the sign-in page. */
export function PasskeySecondFactorButton({ username, password, directory, label = 'Use a passkey or security key instead' }: {
  username: string; password: string; directory?: string; label?: string;
}) {
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!passkeysSupported()) return null;
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await signInWithKeyAfterPassword(username, password, directory);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ak-signin">
      {error && <p className="form-error" role="alert"><Icon name="alert-circle" size={16} /><span>{error}</span></p>}
      <Button icon="key" variant="ghost" loading={busy} onClick={() => void go()}>{label}</Button>
    </div>
  );
}
