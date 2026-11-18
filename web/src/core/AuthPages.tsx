// First-run setup, sign-in and change-password.
import { useState, type FormEvent, type ReactNode } from 'react';
import { PasswordInput, TextInput } from '@mantine/core';
import { api, ApiError, errorMessage } from './api';
import { useAuth } from './auth';
import { Icon } from './Icon';
import { Wordmark } from './Logo';
import { Modal, useToast } from './overlay';
import { Button, ProgressBar } from './ui';

const MIN_PASSWORD = 14;
const PASSWORD_HINT = `At least ${MIN_PASSWORD} characters. A phrase of several words works well.`;
const VISIBILITY = { 'aria-label': 'Show or hide the password' };

function AuthLayout({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  const { appName } = useAuth();
  return (
    <main className="auth-page" id="main">
      <div className="auth-card">
        <p className="auth-brand"><Wordmark name={appName} size={32} /></p>
        <h1 className="auth-title">{title}</h1>
        {intro && <p className="muted">{intro}</p>}
        {children}
      </div>
    </main>
  );
}

function FormError({ children }: { children: ReactNode }) {
  return (
    <p className="form-error" role="alert">
      <Icon name="alert-circle" size={16} />
      <span>{children}</span>
    </p>
  );
}

function passwordProblems(password: string, confirm: string): Record<string, string> {
  const found: Record<string, string> = {};
  if (password.length < MIN_PASSWORD) {
    found.password = password
      ? `Use at least ${MIN_PASSWORD} characters: ${MIN_PASSWORD - password.length} more to go.`
      : `Choose a password of at least ${MIN_PASSWORD} characters.`;
  }
  if (confirm !== password) found.confirm = 'The two passwords do not match.';
  return found;
}

/** Shows how close a new password is to the minimum length. */
function LengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const enough = password.length >= MIN_PASSWORD;
  return (
    <ProgressBar
      label="Password length"
      hideLabel
      value={Math.min(password.length, MIN_PASSWORD)}
      max={MIN_PASSWORD}
      color={enough ? 'green' : 'amber'}
      valueText={enough ? 'Long enough' : `${password.length} of ${MIN_PASSWORD} characters`}
    />
  );
}

/** First-run wizard: creates the first administrator. */
export function SetupPage() {
  const { refresh } = useAuth();
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const bind = (key: keyof typeof form) => ({
    value: form[key],
    error: errors[key],
    onChange: (e: { currentTarget: { value: string } }) => {
      const value = e.currentTarget.value;
      setForm((f) => ({ ...f, [key]: value }));
      if (errors[key]) setErrors((all) => ({ ...all, [key]: '' }));
    },
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = passwordProblems(form.password, form.confirm);
    if (!form.displayName.trim()) found.displayName = 'Enter your name.';
    if (!form.username.trim()) found.username = 'Choose a username.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) found.email = 'Enter a valid email address, like name@example.org.';
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
    <AuthLayout
      title="Welcome. Let's create the first administrator"
      intro="This account can add other users and manage settings. There is no default account: you will sign in with the one you create here."
    >
      <form className="form" onSubmit={submit} noValidate>
        {formError && <FormError>{formError}</FormError>}
        <TextInput label="Your name" required autoFocus autoComplete="name" {...bind('displayName')} />
        <TextInput label="Username" required autoComplete="username" autoCapitalize="none" spellCheck={false} {...bind('username')} />
        <TextInput label="Email" required type="email" autoComplete="email" {...bind('email')} />
        <PasswordInput label="Password" required autoComplete="new-password" description={PASSWORD_HINT} visibilityToggleButtonProps={VISIBILITY} {...bind('password')} />
        <LengthMeter password={form.password} />
        <PasswordInput label="Repeat password" required autoComplete="new-password" visibilityToggleButtonProps={VISIBILITY} {...bind('confirm')} />
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
  const [missing, setMissing] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!username.trim()) found.username = 'Enter your username.';
    if (!password) found.password = 'Enter your password.';
    if (needsCode && !totp.trim()) found.totp = 'Enter the 6-digit code.';
    setMissing(found);
    setError('');
    if (Object.keys(found).length > 0) return;

    setBusy(true);
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
    <AuthLayout title="Sign in" intro={needsCode ? 'One more step: enter the code from your authenticator app.' : undefined}>
      <form className="form" onSubmit={submit} noValidate>
        {error && <FormError>{error}</FormError>}
        <TextInput
          label="Username" required autoFocus={!needsCode} autoComplete="username" autoCapitalize="none" spellCheck={false}
          value={username} error={missing.username} onChange={(e) => setUsername(e.currentTarget.value)}
        />
        <PasswordInput
          label="Password" required autoComplete="current-password" visibilityToggleButtonProps={VISIBILITY}
          value={password} error={missing.password} onChange={(e) => setPassword(e.currentTarget.value)}
        />
        {needsCode && (
          <TextInput
            label="6-digit code" required autoFocus autoComplete="one-time-code" inputMode="numeric"
            description="From your authenticator app. A recovery code also works here."
            value={totp} error={missing.totp} onChange={(e) => setTotp(e.currentTarget.value)}
          />
        )}
        <Button type="submit" variant="primary" loading={busy}>{needsCode ? 'Verify and sign in' : 'Sign in'}</Button>
      </form>
      <p className="auth-foot">Forgotten your password? An administrator can send you a reset link.</p>
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
      {formError && <FormError>{formError}</FormError>}
      <PasswordInput
        label="Current password" required autoComplete="current-password" visibilityToggleButtonProps={VISIBILITY}
        value={current} error={errors.currentPassword} onChange={(e) => setCurrent(e.currentTarget.value)}
      />
      <PasswordInput
        label="New password" required autoComplete="new-password" description={PASSWORD_HINT} visibilityToggleButtonProps={VISIBILITY}
        value={password} error={errors.password} onChange={(e) => setPassword(e.currentTarget.value)}
      />
      <LengthMeter password={password} />
      <PasswordInput
        label="Repeat new password" required autoComplete="new-password" visibilityToggleButtonProps={VISIBILITY}
        value={confirm} error={errors.confirm} onChange={(e) => setConfirm(e.currentTarget.value)}
      />
      <div className="form-actions">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>Change password</Button>
      </div>
    </form>
  );
}
