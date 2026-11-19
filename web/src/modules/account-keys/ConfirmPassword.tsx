// Asks for the password again when the server answers 403 `reauth_required` (adding or removing a
// key needs a recent password confirmation), then lets the caller try once more.
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, Button, errorMessage, Modal, TextField } from '../../core';

export function useConfirmPassword(): { dialog: ReactNode; withConfirm: <T>(action: () => Promise<T>) => Promise<T> } {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const settle = useRef<((ok: boolean) => void) | null>(null);

  const finish = (ok: boolean) => {
    setOpen(false);
    setPassword('');
    setError('');
    settle.current?.(ok);
    settle.current = null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) { setError('Enter your password.'); return; }
    setBusy(true);
    try {
      await api.post('/api/auth/confirm', { password });
      finish(true);
    } catch (err) {
      setError(err instanceof ApiError && err.fields.password ? err.fields.password : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const withConfirm = async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'reauth_required') throw err;
      const ok = await new Promise<boolean>((resolve) => { settle.current = resolve; setOpen(true); });
      if (!ok) throw new ApiError(403, 'reauth_cancelled', 'Nothing was changed: your password was not confirmed.');
      return action();
    }
  };

  const dialog = (
    <Modal open={open} size="sm" title="Confirm your password" onClose={() => finish(false)}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted">Adding or removing a key changes how you sign in, so we need to check it is really you.</p>
        <TextField label="Your password" type="password" required autoFocus autoComplete="current-password" value={password} onChange={(v) => { setPassword(v); setError(''); }} error={error || undefined} />
        <div className="form-actions">
          <Button onClick={() => finish(false)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Confirm and continue</Button>
        </div>
      </form>
    </Modal>
  );
  return { dialog, withConfirm };
}
