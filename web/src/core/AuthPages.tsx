// First-run setup, sign-in and change-password.
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from './api';
import { useAuth } from './auth';
import { TextField } from './fields';
import { Modal, useToast } from './overlay';
import { Button } from './ui';

const MIN_PASSWORD = 14;
const PASSWORD_HINT = `At least ${MIN_PASSWORD} characters. A phrase of several words works well.`;

function AuthLayout({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  const { appName } = useAuth();
  return (
    <main className="auth-page" id="main">
      <div className="auth-card">
        <p className="auth-brand">{appName}</p>
        <h1 className="auth-title">{title}</h1>
        {intro && <p className="muted">{intro}</p>}
        {children}
      </div>
    </main>
  );
}

function passwordProblems(password: string, confirm: string): Record<string, string> {
  const found: Record<string, string> = {};
  if (password.length < MIN_PASSWORD) found.password = `Use at least ${MIN_PASSWORD} characters.`;
  if (confirm !== password) found.confirm = 'The two passwords do not match.';
  return found;
}

/** First-run wizard: creates the first administrator. */
export function SetupPage() {
  const { refresh } = useAuth();
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = passwordProblems(form.password, form.confirm);
    if (!form.displayName.trim()) found.displayName = 'Enter your name.';
    if (!form.username.trim()) found.username = 'Choose a username.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) found.email = 'Enter a valid email address.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      await api.post('/api/setup', {
        username: form.username.trim(),
        email: form.email.trim(),
        displayName: form.displayName.trim(),
        password: form.password,
      });
      await refresh();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Set up the first administrator" intro="This account can add other users and manage settings. You will sign in with it next.">
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <TextField label="Your name" required autoFocus autoComplete="name" value={form.displayName} onChange={set('displayName')} error={errors.displayName} />
        <TextField label="Username" required autoComplete="username" value={form.username} onChange={set('username')} error={errors.username} />
        <TextField label="Email" required type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
        <TextField label="Password" required type="password" autoComplete="new-password" hint={PASSWORD_HINT} value={form.password} onChange={set('password')} error={errors.password} />
        <TextField label="Repeat password" required type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
        <Button type="submit" variant="primary" loading={busy}>Create administrator</Button>
      </form>
    </AuthLayout>
  );
}

export function LoginPage() {
  const { refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || (needsCode && !totp.trim())) {
      setError(needsCode ? 'Enter your username, password and the 6-digit code.' : 'Enter your username and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/login', { username: username.trim(), password, ...(needsCode ? { totp: totp.trim() } : {}) });
      await refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'mfa_required' && !needsCode) {
        setNeedsCode(true);
      } else if (code === 'locked') {
        setError('This account is temporarily locked after too many attempts. Try again later or ask an administrator.');
      } else if (err instanceof ApiError && err.status === 0) {
        setError(err.message);
      } else {
        // Deliberately generic: do not reveal which part was wrong.
        setError('Sign-in failed. Check your details and try again.');
        setTotp('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in">
      <form className="form" onSubmit={submit} noValidate>
        {error && <p className="form-error" role="alert">{error}</p>}
        <TextField label="Username" required autoFocus autoComplete="username" value={username} onChange={setUsername} />
        <TextField label="Password" required type="password" autoComplete="current-password" value={password} onChange={setPassword} />
        {needsCode && (
          <TextField
            label="6-digit code"
            required
            autoFocus
            autoComplete="one-time-code"
            hint="From your authenticator app. A recovery code also works here."
            value={totp}
            onChange={setTotp}
          />
        )}
        <Button type="submit" variant="primary" loading={busy}>{needsCode ? 'Verify and sign in' : 'Sign in'}</Button>
      </form>
    </AuthLayout>
  );
}

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="Change password" size="sm" onClose={onClose}>
      <ChangePasswordForm onDone={onClose} />
    </Modal>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = passwordProblems(password, confirm);
    if (!current) found.currentPassword = 'Enter your current password.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword: current, newPassword: password });
      toast.success('Password changed.');
      onDone();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors({ ...fields, password: fields.newPassword });
      if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <TextField label="Current password" required autoFocus type="password" autoComplete="current-password" value={current} onChange={setCurrent} error={errors.currentPassword} />
      <TextField label="New password" required type="password" autoComplete="new-password" hint={PASSWORD_HINT} value={password} onChange={setPassword} error={errors.password} />
      <TextField label="Repeat new password" required type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={errors.confirm} />
      <div className="form-actions">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>Change password</Button>
      </div>
    </form>
  );
}
