// "Forgot your password?" (/forgot-password, public): ask for a reset link by email.
// The answer is the same whether or not the account exists, so the page never says which.
import { useState, type FormEvent } from 'react';
import { api, ApiError, Button, errorMessage, Loading, TextField, useAuth, useFetch } from '../../core';

export function ForgotPasswordPage() {
  const { appName } = useAuth();
  const { data } = useFetch<{ available: boolean }>('/api/auth/forgot-password');
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) { setError('Enter your username or email address.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ message: string }>('/api/auth/forgot-password', { identifier: identifier.trim() });
      setSent(res.message);
    } catch (err) {
      setError(err instanceof ApiError && err.fields.identifier ? err.fields.identifier : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  let content;
  if (!data) content = <Loading lines={3} label="Loading" />;
  else if (!data.available) {
    content = (
      <>
        <p>This installation does not send email, so a reset link cannot be sent to you.</p>
        <p className="muted">Ask an administrator for a password reset link. They can give you one that works once and expires after 24 hours.</p>
        <a className="btn btn-secondary" href="/">Back to sign-in</a>
      </>
    );
  } else if (sent) {
    content = (
      <>
        <p role="status">{sent}</p>
        <p className="muted">Nothing arrived after a few minutes? Check the address on your account with an administrator, or try again later.</p>
        <a className="btn btn-secondary" href="/">Back to sign-in</a>
      </>
    );
  } else {
    content = (
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted">Enter your username or the email address on your account. If it matches, we will email you a link to choose a new password.</p>
        <TextField label="Username or email address" required autoFocus autoComplete="username" value={identifier} onChange={setIdentifier} error={error || undefined} />
        <Button type="submit" variant="primary" loading={busy}>Email me a link</Button>
        <p className="muted"><a href="/">Back to sign-in</a></p>
      </form>
    );
  }

  return (
    <main className="auth-page" id="main">
      <div className="auth-card">
        <p className="auth-brand">{appName}</p>
        <h1 className="auth-title">Forgot your password?</h1>
        {content}
      </div>
    </main>
  );
}
