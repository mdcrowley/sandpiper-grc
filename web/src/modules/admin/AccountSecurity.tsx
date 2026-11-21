import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom';
import {
  api, ApiError, Button, Card, ChangePasswordDialog, ErrorState, errorMessage, formatDate, formatDateTime, Loading, Modal, PageHeader,
  StatusChip, TextField, useAuth, useFetch, useToast,
} from '../../core';
import { MyTokensCard } from './ApiTokens';
import { ConnectAssistantCard } from '../mcp/ConnectCard';
import { CopyBox, copyText, downloadText, Notice } from './common';
import { PasskeysCard } from '../account-keys/PasskeysCard';
import { LinkedIdentitiesCard } from './LinkedIdentities';
import { encodeQr, qrPath } from './qr';
import { withReauth } from './reauth';
import { SessionsCard } from './Sessions';
import { AlertContactCard } from './AlertContact';
import { StandinCard } from '../workflows/StandinCard';

interface Security {
  totpEnabled: boolean; recoveryCodesLeft: number; mfaEnrollmentRequired: boolean; mfaEnrollmentBlocked?: boolean;
  mfaGraceEndsAt?: string | null; passwordChangedAt: string | null; minLength: number;
  /** Passkeys and security keys held (E02-21), whether a password is set, and whether this session's provider proved a second factor (E02-22). */
  passkeys?: number; hasPassword?: boolean; secondFactorViaProvider?: boolean;
}

const HOME = '/account/security';

/** Base32 key in groups of four, easier to type into an authenticator app. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

/**
 * Recovery codes that have been issued but not yet acknowledged. Kept outside the component because turning
 * the second factor on changes what the rest of the application shows, which can rebuild this page; the
 * codes cannot be fetched again, so they must survive that. Memory only: never written to storage.
 */
let unsavedCodes: { userId: string; codes: string[] } | null = null;

/** Keeps the address on this page while recovery codes are on screen (the page can be shown at any address when access is blocked). */
function StayHere() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => { if (pathname !== HOME) navigate(HOME, { replace: true }); }, [pathname, navigate]);
  return null;
}

/**
 * A QR code drawn as SVG. Always black on white with a white margin, whatever the theme, because
 * phone cameras need the contrast and the quiet zone.
 */
export function QrImage({ text, label, size = 208 }: { text: string; label: string; size?: number }) {
  const code = useMemo(() => encodeQr(text), [text]);
  if (!code) return null;
  const quiet = 4;
  const side = code.size + quiet * 2;
  return (
    <svg
      className="adm-qr" role="img" aria-label={label} data-testid="totp-qr" data-qr-version={code.version}
      width={size} height={size} viewBox={`0 0 ${side} ${side}`} shapeRendering="crispEdges"
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={qrPath(code, quiet)} fill="#000000" />
    </svg>
  );
}

export function AccountSecurityPage() {
  const auth = useAuth();
  const inRouter = useInRouterContext();
  const { data, error, reload } = useFetch<Security>('/api/auth/security');
  const [changing, setChanging] = useState(false);
  const userId = auth.user?.id ?? '';
  // Only ever the signed-in person's own codes: a set left behind by someone else is dropped.
  const [codes, setCodesState] = useState<string[] | null>(() => {
    if (unsavedCodes && unsavedCodes.userId !== userId) unsavedCodes = null;
    return unsavedCodes?.codes ?? null;
  });
  const setCodes = (next: string[] | null) => { unsavedCodes = next && userId ? { userId, codes: next } : null; setCodesState(next); };
  useEffect(() => {
    if (codes && unsavedCodes?.userId !== userId) { unsavedCodes = null; setCodesState(null); }
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  // After anything that changes the second factor, the session's own state changes too (the reminder, a block).
  const changed = () => { reload(); void auth.refresh(); };
  const blocked = Boolean(data?.mfaEnrollmentBlocked && !data.totpEnabled);

  return (
    <div className="adm-account">
      <PageHeader
        title="Account security"
        subtitle={auth.user ? `Signed in as ${auth.user.displayName} (${auth.user.username})` : undefined}
        actions={blocked ? <Button icon="logout" onClick={() => void auth.logout()}>Sign out</Button> : undefined}
      />
      {codes && inRouter && <StayHere />}
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={8} label="Loading your security settings" /> : (
        <div className="stack">
          {blocked && (
            <Notice tone="danger" role="alert" icon="lock">
              <strong>Set up your second factor to continue.</strong> It is required for your account.
              Until it is set up, the rest of the application is not available to you. You can still change your password or sign out.
            </Notice>
          )}
          {data.secondFactorViaProvider && !data.totpEnabled && !data.passkeys && (
            <Notice tone="info" role="status" icon="shield">
              Your organization's sign-in provider confirmed a second factor when you signed in, so this session meets the
              requirement. Setting one up here as well lets you work when you sign in another way.
            </Notice>
          )}
          {!blocked && !data.totpEnabled && data.mfaEnrollmentRequired && data.mfaGraceEndsAt && (
            <Notice tone="caution" role="status" icon="clock">
              Set up your second factor by <strong>{formatDate(data.mfaGraceEndsAt)}</strong>. After that you will not be able to work until it is set up.
            </Notice>
          )}
          <div className="grid-2 adm-account-grid">
            <div className="stack">
              {codes
                ? <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
                : data.totpEnabled
                  ? <SecondFactorOn data={data} onCodes={(c) => { setCodes(c); changed(); }} onChanged={changed} />
                  : <SecondFactorSetup required={data.mfaEnrollmentRequired} onEnabled={(c) => { setCodes(c); changed(); }} />}
              {/* Single sign-on: linked providers and the break-glass notice (not while access is blocked). */}
              {/* Passkeys and security keys (account-keys module): count as a second factor, so shown even while blocked. */}
              {!codes && <PasskeysCard onChange={changed} />}
              {/* Recovery codes for people whose only second factor is a passkey (E02-21). */}
              {!codes && !data.totpEnabled && Boolean(data.passkeys) && (
                <PasskeyRecoveryCodes data={data} onCodes={(c) => { setCodes(c); changed(); }} />
              )}
              {!blocked && !codes && <LinkedIdentitiesCard />}
            </div>
            <div className={`stack${codes ? ' adm-no-print' : ''}`}>
              <Card title="Password" actions={<Button size="sm" icon="key" onClick={() => setChanging(true)}>Change password</Button>}>
                <p>{data.passwordChangedAt ? `Last changed ${formatDateTime(data.passwordChangedAt)}.` : 'No password has been set. You sign in through a linked provider.'}</p>
                <p className="muted">
                  At least {data.minLength} characters; a phrase of several words works well. No rules about symbols or capitals,
                  and no forced periodic change. Commonly used passwords are refused. Changing it signs you out everywhere else.
                </p>
              </Card>
              <SessionsCard />
              {!blocked && !codes && <AlertContactCard />}
              {/* Wave 8: name a stand-in for approvals (also under Approvals > Stand-ins). */}
              {!blocked && !codes && <StandinCard />}
            </div>
          </div>
          {/* Not while access is blocked for want of a second factor: tokens are for people who can already work. */}
          {!blocked && inRouter && !data.mfaEnrollmentBlocked && <div className={codes ? 'adm-no-print' : undefined}><MyTokensCard /><ConnectAssistantCard /></div>}
        </div>
      )}
      <ChangePasswordDialog open={changing} onClose={() => { setChanging(false); reload(); }} />
    </div>
  );
}

function SecondFactorSetup({ required, onEnabled }: { required: boolean; onEnabled: (codes: string[]) => void }) {
  const toast = useToast();
  const [pending, setPending] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [startError, setStartError] = useState('');
  const [busy, setBusy] = useState(false);
  const scannable = useMemo(() => (pending ? encodeQr(pending.uri) !== null : false), [pending]);

  const begin = async () => {
    setBusy(true);
    setStartError('');
    try {
      setPending(await api.post<{ secret: string; uri: string }>('/api/auth/totp/begin'));
    } catch (err) {
      setStartError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setCodeError('Enter the 6 digits shown in your app.'); return; }
    setBusy(true);
    try {
      const res = await api.post<{ recoveryCodes: string[] }>('/api/auth/totp/confirm', { code });
      toast.success('Second factor turned on.');
      onEnabled(res.recoveryCodes);
    } catch (err) {
      setCodeError(err instanceof ApiError && err.fields.code ? err.fields.code : errorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Second factor" actions={<StatusChip color={required ? 'amber' : 'gray'} label={required ? 'Needed for your account' : 'Not set up'} />}>
      {!pending ? (
        <div className="stack">
          <p>
            A second factor means that a stolen password is not enough to sign in as you. After setting it up you will be
            asked for a 6-digit code from an authenticator app on your phone each time you sign in.
          </p>
          <p className="muted">You need an authenticator app that supports time-based codes. Any standard one works. Setting up takes about a minute.</p>
          {startError && <p className="form-error" role="alert">{startError}</p>}
          <div><Button variant="primary" icon="shield" loading={busy} onClick={() => void begin()}>Set up an authenticator app</Button></div>
        </div>
      ) : (
        <ol className="adm-steps">
          <li>
            <h3 className="adm-step-title">Add this account to your authenticator app</h3>
            {scannable ? (
              <div className="adm-qr-row">
                <QrImage text={pending.uri} label="QR code to scan with your authenticator app" />
                <div className="stack">
                  <p>In the app choose to add an account, then <strong>scan this code</strong> with your phone's camera.</p>
                  <p className="muted">The code holds a private key. Do not photograph it or share your screen while it is showing.</p>
                </div>
              </div>
            ) : (
              <p>In the app choose to add an account and <strong>enter a setup key by hand</strong>.</p>
            )}
            <div className="adm-manual">
              <CopyBox
                prominent label={scannable ? 'Cannot scan? Type this key into the app instead' : 'Setup key'} copyLabel="Copy key"
                value={pending.secret} display={grouped(pending.secret)} testId="totp-key"
              >
                <p className="field-hint">The spaces do not matter. Type of key: time based, 6 digits, a new code every 30 seconds. The key is shown only during set-up.</p>
              </CopyBox>
              <details className="adm-fold">
                <summary><span className="adm-fold-more">Show the set-up address (for apps that accept one)</span></summary>
                <CopyBox label="Set-up address" value={pending.uri} testId="totp-uri" />
              </details>
            </div>
          </li>
          <li>
            <h3 className="adm-step-title">Enter the code the app now shows</h3>
            <form className="form adm-code-form" onSubmit={confirm} noValidate>
              <TextField
                className="adm-code-input" label="6-digit code" required autoComplete="one-time-code" inputMode="numeric" maxLength={6} placeholder="000000"
                value={code} onChange={(v) => { setCode(v.replace(/\D/g, '')); setCodeError(''); }} error={codeError || undefined}
                hint="This proves the app has the key. Nothing changes until you confirm."
              />
              <div className="form-actions adm-code-actions">
                <Button onClick={() => { setPending(null); setCode(''); setCodeError(''); }}>Cancel</Button>
                <Button type="submit" variant="primary" icon="check" loading={busy}>Confirm and turn on</Button>
              </div>
            </form>
          </li>
        </ol>
      )}
    </Card>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  const auth = useAuth();
  const [saved, setSaved] = useState(false);
  const asText = () => [
    `${auth.appName}: recovery codes${auth.user ? ` for ${auth.user.username}` : ''}`,
    `Made ${formatDateTime(new Date().toISOString())}. Each code works once. Keep this somewhere safe, away from your phone.`,
    '',
    ...codes,
    '',
  ].join('\r\n');
  return (
    <Card title="Your recovery codes" className="adm-codes-card" actions={<StatusChip color="green" label="Second factor on" />}>
      <div className="stack">
        <Notice tone="caution" role="alert">
          <strong>These codes are shown once.</strong> When you leave this page they cannot be shown again; only you have them.
          Copy, download or print them now and keep them somewhere safe and separate from your phone and your keys.
        </Notice>
        <p>Each code signs you in <strong>once</strong> in place of your second factor, for when your phone or key is lost or broken.</p>
        <ol className="adm-codes" aria-label="Recovery codes" data-testid="recovery-codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ol>
        <div className="row adm-no-print">
          <Button icon="clipboard" onClick={() => void copyText(codes.join('\n')).then((ok) => { if (ok) { setSaved(true); toast.success('Codes copied.'); } else toast.error('Copying was blocked. Download or write the codes down.'); })}>Copy codes</Button>
          <Button icon="download" onClick={() => { downloadText('recovery-codes.txt', asText()); setSaved(true); }}>Download as text</Button>
          <Button icon="file-text" onClick={() => { setSaved(true); window.print(); }}>Print</Button>
        </div>
        <div className="form-actions adm-no-print">
          {!saved && <span className="muted" id="adm-codes-first">Copy, download or print the codes first.</span>}
          <Button variant="primary" disabled={!saved} aria-describedby={saved ? undefined : 'adm-codes-first'} onClick={onDone}>I have saved them</Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Recovery codes when the only second factor is a passkey or security key (E02-21). Offered as soon as
 * the first key is added: without them, losing the key means asking an administrator.
 */
function PasskeyRecoveryCodes({ data, onCodes }: { data: Security; onCodes: (codes: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const none = data.recoveryCodesLeft === 0;
  const close = () => { setOpen(false); setPassword(''); setError(''); };
  const make = async (e?: FormEvent) => {
    e?.preventDefault();
    if (data.hasPassword !== false && !password) { setError('Enter your current password.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await withReauth(() => api.post<{ recoveryCodes: string[] }>('/api/auth/totp/recovery-codes', { password }));
      close();
      onCodes(res.recoveryCodes);
    } catch (err) {
      setError(err instanceof ApiError && err.fields.password ? err.fields.password : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Recovery codes" actions={<StatusChip color={none ? 'amber' : 'green'} label={none ? 'None yet' : `${data.recoveryCodesLeft} left`} />}>
      <div className="stack">
        {none ? (
          <Notice tone="caution" role="status">
            <strong>Make recovery codes now.</strong> Your passkeys are your only second factor. If you lose them, a recovery code
            gets you in once; without one you will need an administrator.
          </Notice>
        ) : (
          <p>Each of your {data.recoveryCodesLeft} codes signs you in once if you cannot use your passkey or security key.</p>
        )}
        <div className="row">
          <Button icon={none ? 'shield' : 'refresh'} variant={none ? 'primary' : 'secondary'} onClick={() => setOpen(true)}>
            {none ? 'Make recovery codes' : 'New recovery codes'}
          </Button>
        </div>
      </div>
      <Modal open={open} size="sm" title={none ? 'Make recovery codes' : 'Make new recovery codes'} onClose={close}>
        <form className="form" onSubmit={make} noValidate>
          <p className="muted">
            {none ? 'Ten codes will be shown once.' : 'Your existing recovery codes will stop working and ten new ones will be shown once.'}
          </p>
          {data.hasPassword !== false && (
            <TextField label="Current password" required autoFocus type="password" autoComplete="current-password" value={password} onChange={setPassword} error={error || undefined} />
          )}
          {data.hasPassword === false && error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>Make codes</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

function SecondFactorOn({ data, onCodes, onChanged }: { data: Security; onCodes: (codes: string[]) => void; onChanged: () => void }) {
  const toast = useToast();
  const [dialog, setDialog] = useState<'codes' | 'off' | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { setDialog(null); setPassword(''); setCode(''); setErrors({}); setFormError(''); };
  const low = data.recoveryCodesLeft <= 3;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!password) found.password = 'Enter your current password.';
    if (dialog === 'off' && !code.trim()) found.code = 'Enter a code from your app, or a recovery code.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      if (dialog === 'codes') {
        const res = await api.post<{ recoveryCodes: string[] }>('/api/auth/totp/recovery-codes', { password });
        close();
        onCodes(res.recoveryCodes);
      } else {
        await api.post('/api/auth/totp/disable', { password, code: code.trim() });
        toast.success('Second factor turned off.');
        close();
        onChanged();
      }
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Second factor" actions={<StatusChip color="green" label="On" />}>
      <div className="stack">
        <p>You sign in with your password and a 6-digit code from your authenticator app.</p>
        <div className={`adm-codes-left${low ? ' adm-codes-low' : ''}`}>
          <span className="adm-codes-left-n">{data.recoveryCodesLeft}</span>
          <span>
            <strong>of 10 recovery codes left.</strong>{' '}
            {low ? 'You are running low: make a new set.' : 'Each one signs you in once if you cannot use your app.'}
          </span>
        </div>
        <div className="row">
          <Button icon="refresh" onClick={() => setDialog('codes')}>New recovery codes</Button>
          <Button variant="danger" onClick={() => setDialog('off')}>Turn off</Button>
        </div>
        <p className="muted">Lost your phone and your codes? An administrator can reset your second factor.</p>
      </div>
      <Modal open={dialog !== null} size="sm" title={dialog === 'codes' ? 'Make new recovery codes' : 'Turn off the second factor'} onClose={close}>
        <form className="form" onSubmit={submit} noValidate>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <p className="muted">
            {dialog === 'codes'
              ? 'Your existing recovery codes will stop working and ten new ones will be shown once.'
              : 'Your account will be protected by your password alone, and your recovery codes will stop working.'}
          </p>
          <TextField label="Current password" required autoFocus type="password" autoComplete="current-password" value={password} onChange={setPassword} error={errors.password} />
          {dialog === 'off' && (
            <TextField label="6-digit code or recovery code" required autoComplete="one-time-code" value={code} onChange={setCode} error={errors.code} />
          )}
          <div className="form-actions">
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant={dialog === 'off' ? 'danger' : 'primary'} loading={busy}>{dialog === 'codes' ? 'Make new codes' : 'Turn off'}</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
