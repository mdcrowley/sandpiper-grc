// First-run setup, sign-in (password, directory (LDAP) and single sign-on buttons) and change-password.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NativeSelect, PasswordInput, TextInput } from '@mantine/core';
import { api, ApiError, errorMessage } from './api';
import { useAuth } from './auth';
import { Icon } from './Icon';
import { Wordmark } from './Logo';
import { Modal, useToast } from './overlay';
import { Button, ProgressBar } from './ui';
// Passkeys (E02-08) live in the account-keys module; these pieces are embedded in the sign-in and setup pages.
import { PasskeySecondFactorButton, PasskeySignIn, signInWithKeyAfterPassword } from '../modules/account-keys/PasskeySignIn';
import { DEFAULT_SECOND_FACTOR, SecondFactorChoice, type SecondFactorSetting } from '../modules/account-keys/SecondFactorChoice';

const MIN_PASSWORD = 14;
const PASSWORD_HINT = `At least ${MIN_PASSWORD} characters. A phrase of several words works well.`;
const VISIBILITY = { 'aria-label': 'Show or hide the password' };
/** A button that reads as a link (the sign-in page loads before any module's styles). */
const LINK_BUTTON = { padding: 0, border: 0, background: 'none', color: 'var(--link)', font: 'inherit', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' } as const;

function AuthLayout({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  const { appName } = useAuth();
  return (
    <main className="auth-page" id="main">
      <div className="auth-card">
        <p className="auth-brand"><Wordmark name={appName} size={32} /></p>
        <p className="auth-tagline">Governance, risk and compliance for transit organizations</p>
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
  const [secondFactor, setSecondFactor] = useState<SecondFactorSetting>(DEFAULT_SECOND_FACTOR);
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
        secondFactor,
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
        <SecondFactorChoice value={secondFactor} onChange={setSecondFactor} />
        <Button type="submit" variant="primary" loading={busy}>Create administrator</Button>
      </form>
    </AuthLayout>
  );
}

// ---------- single sign-on on the sign-in page ----------

/** `style`: `redirect` providers are buttons; `credentials` providers (a directory, E02-26) are a choice on the password form. */
interface SignInOptions { providers: { key: string; name: string; isDefault: boolean; style?: 'redirect' | 'credentials' }[]; localSignIn: boolean }
interface PendingLink { pending: boolean; provider?: string; email?: string }

const SSO_MESSAGES: Record<string, string> = {
  failed: 'Single sign-on did not work. Try again, or ask an administrator if it keeps happening.',
  no_account: 'You signed in at your organization, but there is no account here for you. Ask an administrator to add you.',
};

/** Reads `?sso=` once (the result of a trip to an identity provider) and takes it out of the address. */
function useSsoResult(): string {
  const [result] = useState(() => new URLSearchParams(window.location.search).get('sso') ?? '');
  useEffect(() => {
    if (result) window.history.replaceState(null, '', window.location.pathname);
  }, [result]);
  return result;
}

/** Buttons for the enabled sign-in providers. Starting one sends the browser to the provider. */
function ProviderButtons({ options, onError }: { options: SignInOptions; onError: (message: string) => void }) {
  const buttons = options.providers.filter((p) => p.style !== 'credentials');
  const [starting, setStarting] = useState('');
  const start = async (key: string) => {
    setStarting(key);
    try {
      const { redirectUrl } = await api.post<{ redirectUrl: string }>(`/api/auth/sso/${encodeURIComponent(key)}/start`);
      window.location.assign(redirectUrl);
    } catch (err) {
      onError(errorMessage(err));
      setStarting('');
    }
  };
  return (
    <div className="stack" style={{ gap: 'var(--s-2)' }} role="group" aria-label="Sign in with your organization">
      {buttons.map((p, i) => (
        <Button
          key={p.key} variant={p.isDefault || (i === 0 && !buttons.some((x) => x.isDefault)) ? 'primary' : 'secondary'}
          icon="enter" loading={starting === p.key} disabled={Boolean(starting) && starting !== p.key} onClick={() => void start(p.key)}
        >
          Sign in with {p.name}
        </Button>
      ))}
    </div>
  );
}

function OrDivider({ children }: { children: ReactNode }) {
  const line = { flex: 1, height: 1, background: 'var(--border)' };
  return (
    <div role="separator" aria-label={String(children)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', margin: 'var(--s-4) 0', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
      <span style={line} /><span>{children}</span><span style={line} />
    </div>
  );
}

/**
 * Shown for the whole session when someone signs in with the break-glass account. Renders nothing
 * otherwise (or when single sign-on is not installed). The shell places it with its other notices.
 */
export function BreakGlassBanner() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    api.get<{ breakGlass: boolean }>('/api/auth/sso/session').then((s) => { if (live) setOn(Boolean(s?.breakGlass)); }, () => undefined);
    return () => { live = false; };
  }, []);
  if (!on) return null;
  return (
    <p className="notice notice-warn shell-notice" role="alert" data-testid="break-glass-banner">
      <Icon name="alert" size={16} />
      <span>
        <strong>You are signed in with the break-glass account.</strong> Every administrator has been alerted. Use it only to deal
        with the emergency, record what you did, and sign out as soon as you can.
      </span>
    </p>
  );
}

export function LoginPage() {
  const { refresh } = useAuth();
  const toast = useToast();
  const sso = useSsoResult();
  const [options, setOptions] = useState<SignInOptions | null>(null);
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  // The account's only second factor is a passkey; the code box then takes a recovery code (E02-21).
  const [keyOnly, setKeyOnly] = useState(false);
  // "Forgot your password?" is shown only where it can send a link (email on; E14-24).
  const [forgotAvailable, setForgotAvailable] = useState(false);
  const [missing, setMissing] = useState<Record<string, string>>({});
  const [error, setError] = useState(SSO_MESSAGES[sso] ?? '');
  const [busy, setBusy] = useState(false);
  // E02-26: '' signs in with this application's own password; a directory's key, with that directory's.
  const [method, setMethod] = useState<string | null>(null);

  useEffect(() => {
    // Without single sign-on installed (or reachable) the page is the plain password form.
    api.get<SignInOptions>('/api/auth/providers').then(setOptions, () => setOptions({ providers: [], localSignIn: true }));
    if (sso === 'link') api.get<PendingLink>('/api/auth/sso/pending').then(setPending, () => setPending(null));
    api.get<{ available: boolean }>('/api/auth/forgot-password').then((r) => setForgotAvailable(r?.available === true), () => setForgotAvailable(false));
  }, [sso]);

  const cancelLink = async () => {
    try { await api.post('/api/auth/sso/pending/cancel'); } catch { /* nothing to cancel */ }
    setPending(null);
  };

  /** After a password sign-in that confirms a waiting link: link it, then open the application. */
  const finishLink = async () => {
    try {
      const res = await api.post<{ provider: string }>('/api/auth/sso/pending/complete');
      toast.success(`Linked. Next time you can sign in with ${res.provider}.`);
    } catch (err) {
      toast.error(`Signed in, but not linked: ${errorMessage(err)}`);
    }
  };

  const directories = (options?.providers ?? []).filter((p) => p.style === 'credentials');
  // The form starts on the default directory, or on a directory when local passwords are off.
  const chosen = method ?? (pending?.pending ? '' : directories.find((d) => d.isDefault)?.key ?? (options && !options.localSignIn && directories[0] ? directories[0].key : ''));
  const directory = directories.find((d) => d.key === chosen) ?? null;

  /** Sign-in with a directory's user name and password (E02-26); the second factor still applies. */
  const directorySignIn = async (key: string) => {
    const res = await api.post<{ ok: boolean; link?: boolean }>(`/api/auth/sso/${encodeURIComponent(key)}/login`, {
      username: username.trim(), password, ...(needsCode ? (keyOnly ? { recoveryCode: totp.trim() } : { totp: totp.trim() }) : {}),
    });
    if (res.link) {
      // The directory matched an account here by email: sign in once with that account's password to link them.
      setPending(await api.get<PendingLink>('/api/auth/sso/pending'));
      setMethod('');
      setPassword('');
      setNeedsCode(false);
      return;
    }
    await refresh();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!username.trim()) found.username = 'Enter your username.';
    if (!password) found.password = 'Enter your password.';
    if (needsCode && !totp.trim()) found.totp = keyOnly ? 'Enter a recovery code, or use your passkey.' : 'Enter the 6-digit code.';
    setMissing(found);
    setError('');
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      if (directory) {
        await directorySignIn(directory.key);
        return;
      }
      await api.post('/api/auth/login', { username: username.trim(), password, ...(needsCode ? (keyOnly ? { recoveryCode: totp.trim() } : { totp: totp.trim() }) : {}) });
      if (pending?.pending) await finishLink();
      await refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (directory && code === 'mfa_required' && err instanceof ApiError && err.fields.passkey && !needsCode) {
        // After a directory password, the person's passkey is the second step (E02-29); a recovery code also works.
        try {
          await signInWithKeyAfterPassword(username.trim(), password, directory.key);
          await refresh();
        } catch (keyErr) {
          setKeyOnly(true);
          setNeedsCode(true);
          setError(`${keyErr instanceof Error ? keyErr.message : errorMessage(keyErr)} If you cannot use your key, enter one of your recovery codes.`);
        }
      } else if (directory && code === 'mfa_required' && err instanceof ApiError && (err.fields.recovery || err.fields.passkey)) {
        setKeyOnly(true);
        setNeedsCode(true);
        if (needsCode) { setError('Sign-in failed. Check your details and try again.'); setTotp(''); }
      } else if (directory && (code === 'no_account' || code === 'provider_unavailable')) {
        setError(errorMessage(err));
      } else if (code === 'mfa_required' && err instanceof ApiError && err.fields.passkey) {
        // The account's second factor is a passkey only: ask the browser for it straight away.
        try {
          await signInWithKeyAfterPassword(username.trim(), password);
          if (pending?.pending) await finishLink();
          await refresh();
        } catch (keyErr) {
          // The key did not answer (lost, or another device): a recovery code also works.
          setKeyOnly(true);
          setNeedsCode(true);
          setError(`${keyErr instanceof Error ? keyErr.message : errorMessage(keyErr)} If you cannot use your key, enter one of your recovery codes.`);
        }
      } else if (code === 'mfa_required' && !needsCode) {
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

  const providers = (options?.providers ?? []).filter((p) => p.style !== 'credentials');
  const linking = Boolean(pending?.pending);
  // With local passwords switched off the form stays folded away (only the break-glass account can use it), unless a directory signs in there.
  const passwordFolded = Boolean(options && !options.localSignIn && !linking && !showPassword && !needsCode && !directories.length);
  // The ways the password form can sign in: each directory, and this application's own password.
  const localOffered = Boolean(options?.localSignIn !== false || showPassword || linking);
  const ways = [...directories.map((d) => ({ value: d.key, label: d.name })), ...(localOffered ? [{ value: '', label: 'Password for this application' }] : [])];
  const intro = needsCode && keyOnly ? 'One more step: use your passkey or security key, or enter a recovery code.'
    : needsCode ? 'One more step: enter the code from your authenticator app.'
    : linking ? undefined
    : providers.length ? 'Use your organization account.' : undefined;

  return (
    <AuthLayout title={linking ? 'Link your sign-in' : 'Sign in'} intro={intro}>
      {linking && (
        <div className="notice" role="status" style={{ marginBottom: 'var(--s-4)' }}>
          <Icon name="link" size={16} />
          <span>
            You signed in with <strong>{pending!.provider}</strong> as {pending!.email}, which matches an account here.
            Sign in once with that account's password to link the two. After that, {pending!.provider} is enough.{' '}
            <button type="button" style={LINK_BUTTON} onClick={() => void cancelLink()}>Do not link</button>
          </span>
        </div>
      )}
      {!linking && providers.length > 0 && !needsCode && (
        <>
          {error && <FormError>{error}</FormError>}
          <ProviderButtons options={options!} onError={setError} />
          {(options!.localSignIn || directories.length > 0) && <OrDivider>or use a password</OrDivider>}
        </>
      )}
      {passwordFolded ? (
        <p className="auth-foot">
          <button type="button" style={LINK_BUTTON} onClick={() => setShowPassword(true)}>Emergency access with a password</button>
          <br />Password sign-in is switched off except for the break-glass account.
        </p>
      ) : (
      <form className="form" onSubmit={submit} noValidate style={!linking && providers.length > 0 && !options?.localSignIn && !needsCode ? { marginTop: 'var(--s-4)' } : undefined}>
        {error && (linking || providers.length === 0 || needsCode) && <FormError>{error}</FormError>}
        {ways.length > 1 && !needsCode && !linking && (
          <NativeSelect
            label="Sign in with" data={ways} value={chosen}
            onChange={(e) => { setMethod(e.currentTarget.value); setError(''); setKeyOnly(false); }}
            description={directory ? `Your user name and password at ${directory.name}.` : undefined}
          />
        )}
        <TextInput
          label={directory ? 'User name' : 'Username'} required autoFocus={!needsCode && (providers.length === 0 || linking || showPassword)} autoComplete="username" autoCapitalize="none" spellCheck={false}
          value={username} error={missing.username} onChange={(e) => setUsername(e.currentTarget.value)}
        />
        <PasswordInput
          label="Password" required autoComplete="current-password" visibilityToggleButtonProps={VISIBILITY}
          value={password} error={missing.password} onChange={(e) => setPassword(e.currentTarget.value)}
        />
        {needsCode && (
          keyOnly ? (
            <TextInput
              label="Recovery code" required autoFocus autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false}
              description="One of the codes you saved when you set up your passkey. Each works once."
              value={totp} error={missing.totp} onChange={(e) => setTotp(e.currentTarget.value)}
            />
          ) : (
            <TextInput
              label="6-digit code" required autoFocus autoComplete="one-time-code" inputMode="numeric"
              description="From your authenticator app. A recovery code also works here."
              value={totp} error={missing.totp} onChange={(e) => setTotp(e.currentTarget.value)}
            />
          )
        )}
        <Button type="submit" variant={providers.length && !linking && !needsCode ? 'secondary' : 'primary'} loading={busy}>
          {needsCode && keyOnly ? 'Sign in with the recovery code' : needsCode ? 'Verify and sign in' : linking ? 'Sign in and link' : directory ? `Sign in with ${directory.name}` : 'Sign in'}
        </Button>
        {needsCode && <PasskeySecondFactorButton username={username.trim()} password={password} directory={directory?.key} label={keyOnly ? 'Try your passkey or security key again' : undefined} />}
      </form>
      )}
      {/* A passkey alone, as another way in beside the password (not while linking or at the code step). */}
      {!passwordFolded && !linking && !needsCode && !directory && options?.localSignIn !== false && <PasskeySignIn />}
      {!passwordFolded && !needsCode && !directory && options?.localSignIn !== false && forgotAvailable && (
        <p className="auth-foot"><a href="/forgot-password">Forgot your password?</a></p>
      )}
      {/* Local passwords off, with a directory on the form: the break-glass account still needs a way in. */}
      {directories.length > 0 && options && !options.localSignIn && !showPassword && !linking && !needsCode && (
        <p className="auth-foot">
          <button type="button" style={LINK_BUTTON} onClick={() => { setShowPassword(true); setMethod(''); }}>Emergency access with a password</button>
        </p>
      )}
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
