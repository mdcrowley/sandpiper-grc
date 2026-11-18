// Public pages (no sign-in, no shell): set a password from a one-time link; sign in with a recovery code.
import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, Button, ErrorState, errorMessage, Loading, TextField, useAuth, useFetch } from '../../core';

function Page({ title, children }: { title: string; children: ReactNode }) {
  const { appName } = useAuth();
  return (
    <main className="auth-page" id="main">
      <div className="auth-card">
        <p className="auth-brand">{appName}</p>
        <h1 className="auth-title">{title}</h1>
        {children}
      </div>
    </main>
  );
}

interface LinkCheck { valid: boolean; username?: string; purpose?: 'setup' | 'reset'; minLength: number }

export function RedeemPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const auth = useAuth();
  const { data, error, reload } = useFetch<LinkCheck>(token ? `/api/auth/redeem?token=${encodeURIComponent(token)}` : null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [dead, setDead] = useState(false);

  if (done) {
    return (
      <Page title="Password set">
        <p role="status">Your password has been saved and any earlier sessions were signed out. You can now sign in{data?.username ? <> as <strong>{data.username}</strong></> : ''}.</p>
        <a className="btn btn-primary" href="/">Go to sign-in</a>
      </Page>
    );
  }
  if (!token || dead || (data && !data.valid)) {
    return (
      <Page title="This link cannot be used">
        <p>The link is not valid, has already been used, or is more than 24 hours old.</p>
        <p className="muted">Ask an administrator for a new one. Links work once only.</p>
        <a className="btn btn-secondary" href="/">Go to sign-in</a>
      </Page>
    );
  }
  if (error) return <Page title="Set your password"><ErrorState error={error} onRetry={reload} /></Page>;
  if (!data) return <Page title="Set your password"><Loading lines={4} label="Checking your link" /></Page>;

  const min = data.minLength;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (password.length < min) found.password = `Use at least ${min} characters.`;
    if (confirm !== password) found.confirm = 'The two passwords do not match.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await api.post('/api/auth/redeem', { token, password });
      setDone(true);
      await auth.refresh(); // any session in this browser has just been ended
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      if (err instanceof ApiError && err.code === 'invalid_link') setDead(true);
      else if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={data.purpose === 'reset' ? 'Choose a new password' : 'Set your password'}>
      <p className="muted">
        {data.purpose === 'reset' ? 'Resetting the password for' : 'Welcome. You are setting the password for'} <strong>{data.username}</strong>.
      </p>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        {/* Lets password managers save the right username. */}
        <input type="text" name="username" autoComplete="username" value={data.username ?? ''} readOnly hidden />
        <TextField label="New password" required autoFocus type="password" autoComplete="new-password" value={password} onChange={setPassword} error={errors.password} />
        <TextField label="Repeat new password" required type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={errors.confirm} />
        <ul className="muted">
          <li>At least {min} characters. A phrase of several words works well.</li>
          <li>No rules about capitals, numbers or symbols.</li>
          <li>Commonly used passwords are refused, as is one containing your username{data.purpose === 'reset' ? ' or one you used recently' : ''}.</li>
        </ul>
        <Button type="submit" variant="primary" loading={busy}>Save password</Button>
      </form>
    </Page>
  );
}

/** For someone whose authenticator app is unavailable: password plus one single-use recovery code. */
export function RecoverySignInPage() {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (auth.user) {
    return (
      <Page title="You are signed in">
        <p>Signed in as <strong>{auth.user.displayName}</strong>.</p>
        <a className="btn btn-primary" href="/account/security">Check your recovery codes</a>
      </Page>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || !code.trim()) { setError('Enter your username, password and a recovery code.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/login', { username: username.trim(), password, recoveryCode: code.trim() });
      await auth.refresh();
    } catch (err) {
      // Deliberately generic: do not reveal which part was wrong.
      setError(err instanceof ApiError && err.status === 0 ? err.message : 'Sign-in failed. Check your details, or wait a few minutes and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Sign in with a recovery code">
      <p className="muted">Use this when you cannot get a code from your authenticator app. Each recovery code works once.</p>
      <form className="form" onSubmit={submit} noValidate>
        {error && <p className="form-error" role="alert">{error}</p>}
        <TextField label="Username" required autoFocus autoComplete="username" value={username} onChange={setUsername} />
        <TextField label="Password" required type="password" autoComplete="current-password" value={password} onChange={setPassword} />
        <TextField label="Recovery code" required autoComplete="off" placeholder="XXXXX-XXXXX" value={code} onChange={setCode} />
        <Button type="submit" variant="primary" loading={busy}>Sign in</Button>
      </form>
      <p className="muted">No codes left? Ask an administrator to reset your second factor. <a href="/">Back to sign-in</a></p>
    </Page>
  );
}
