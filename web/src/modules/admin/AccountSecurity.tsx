import { useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Card, ChangePasswordDialog, ErrorState, errorMessage, formatDateTime, Loading, Modal, PageHeader,
  StatusChip, TextField, useAuth, useFetch, useToast,
} from '../../core';
import { CopyBox, copyText } from './common';
import { SessionsCard } from './Sessions';

interface Security { totpEnabled: boolean; recoveryCodesLeft: number; mfaEnrollmentRequired: boolean; passwordChangedAt: string | null; minLength: number }

/** Base32 key in groups of four, easier to type into an authenticator app. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

export function AccountSecurityPage() {
  const auth = useAuth();
  const { data, error, reload } = useFetch<Security>('/api/auth/security');
  const [changing, setChanging] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const changed = () => { reload(); void auth.refresh(); };

  return (
    <>
      <PageHeader title="Account security" subtitle={auth.user ? `Signed in as ${auth.user.displayName} (${auth.user.username})` : undefined} />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={8} label="Loading your security settings" /> : (
        <div className="grid-2">
          <div className="stack">
            {codes
              ? <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
              : data.totpEnabled
                ? <SecondFactorOn data={data} onCodes={(c) => { setCodes(c); changed(); }} onChanged={changed} />
                : <SecondFactorSetup required={data.mfaEnrollmentRequired} onEnabled={(c) => { setCodes(c); changed(); }} />}
          </div>
          <div className="stack">
            <Card title="Password" actions={<Button size="sm" onClick={() => setChanging(true)}>Change password</Button>}>
              <p>{data.passwordChangedAt ? `Last changed ${formatDateTime(data.passwordChangedAt)}.` : 'No password has been set.'}</p>
              <p className="muted">
                At least {data.minLength} characters; a phrase of several words works well. No rules about symbols or capitals,
                and no forced periodic change. Commonly used passwords are refused. Changing it signs you out everywhere else.
              </p>
            </Card>
            <SessionsCard />
          </div>
        </div>
      )}
      <ChangePasswordDialog open={changing} onClose={() => { setChanging(false); reload(); }} />
    </>
  );
}

function SecondFactorSetup({ required, onEnabled }: { required: boolean; onEnabled: (codes: string[]) => void }) {
  const toast = useToast();
  const [pending, setPending] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    setBusy(true);
    try {
      setPending(await api.post<{ secret: string; uri: string }>('/api/auth/totp/begin'));
    } catch (err) {
      toast.error(errorMessage(err));
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
    <Card title="Second factor" actions={<StatusChip color={required ? 'amber' : 'gray'} label={required ? 'Needed for your role' : 'Not set up'} />}>
      {!pending ? (
        <div className="stack">
          <p>
            A second factor means that a stolen password is not enough to sign in as you. After setting it up you will be
            asked for a 6-digit code from an authenticator app on your phone each time you sign in.
          </p>
          {required && <p className="notice notice-warn" role="status">Your role is expected to use a second factor. Please set it up now.</p>}
          <p className="muted">You need an authenticator app that supports time-based codes. Any standard one works.</p>
          <div><Button variant="primary" icon="shield" loading={busy} onClick={() => void begin()}>Set up an authenticator app</Button></div>
        </div>
      ) : (
        <ol className="adm-steps">
          <li>
            <p>In your authenticator app choose to add an account and <strong>enter a setup key by hand</strong>. Type this key (the spaces do not matter):</p>
            <p className="adm-key" aria-label="Setup key">{grouped(pending.secret)}</p>
            <Button size="sm" icon="clipboard" onClick={() => void copyText(pending.secret).then((ok) => (ok ? toast.success('Key copied.') : toast.error('Copying was blocked. Type the key by hand.')))}>Copy key</Button>
            <p className="muted">Type of key: time based. Keep it private; it is shown only during set-up.</p>
          </li>
          <li>
            <p>Or, if your app accepts a setup address, paste this instead:</p>
            <CopyBox label="Setup address (otpauth)" value={pending.uri} />
          </li>
          <li>
            <form className="form" onSubmit={confirm} noValidate>
              <TextField
                label="Enter the 6-digit code your app now shows" required autoComplete="one-time-code" inputMode="numeric" maxLength={6}
                value={code} onChange={(v) => { setCode(v.replace(/\D/g, '')); setCodeError(''); }} error={codeError || undefined}
              />
              <div className="form-actions">
                <Button onClick={() => { setPending(null); setCode(''); setCodeError(''); }}>Cancel</Button>
                <Button type="submit" variant="primary" loading={busy}>Turn on</Button>
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
  const [saved, setSaved] = useState(false);
  return (
    <Card title="Your recovery codes">
      <div className="stack">
        <p className="notice notice-warn" role="alert">
          <strong>These codes are shown once.</strong> When you leave this page they cannot be shown again; only you have them.
          Copy or print them now and keep them somewhere safe and separate from your phone.
        </p>
        <p>Each code signs you in <strong>once</strong> in place of the 6-digit code, for when your phone is lost or broken.</p>
        <ul className="adm-codes" aria-label="Recovery codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="row adm-no-print">
          <Button icon="clipboard" onClick={() => void copyText(codes.join('\n')).then((ok) => { if (ok) { setSaved(true); toast.success('Codes copied.'); } else toast.error('Copying was blocked. Write the codes down.'); })}>Copy codes</Button>
          <Button icon="file-text" onClick={() => { setSaved(true); window.print(); }}>Print</Button>
          <Button variant="primary" disabled={!saved} title={saved ? undefined : 'Copy or print the codes first'} onClick={onDone}>I have saved them</Button>
        </div>
      </div>
    </Card>
  );
}

function SecondFactorOn({ data, onCodes, onChanged }: { data: Security; onCodes: (codes: string[]) => void; onChanged: () => void }) {
  const toast = useToast();
  const [dialog, setDialog] = useState<'codes' | 'off' | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const close = () => { setDialog(null); setPassword(''); setCode(''); setErrors({}); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!password) found.password = 'Enter your current password.';
    if (dialog === 'off' && !code.trim()) found.code = 'Enter a code from your app, or a recovery code.';
    setErrors(found);
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
      if (Object.keys(fields).length === 0) toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Second factor" actions={<StatusChip color="green" label="On" />}>
      <div className="stack">
        <p>You sign in with your password and a 6-digit code from your authenticator app.</p>
        <p>
          Recovery codes left: <strong>{data.recoveryCodesLeft}</strong> of 10.
          {data.recoveryCodesLeft <= 3 && ' You are running low; make a new set.'}
        </p>
        <div className="row">
          <Button onClick={() => setDialog('codes')}>New recovery codes</Button>
          <Button variant="danger" onClick={() => setDialog('off')}>Turn off</Button>
        </div>
        <p className="muted">Lost your phone and your codes? An administrator can reset your second factor.</p>
      </div>
      <Modal open={dialog !== null} size="sm" title={dialog === 'codes' ? 'Make new recovery codes' : 'Turn off the second factor'} onClose={close}>
        <form className="form" onSubmit={submit} noValidate>
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
