// Password confirmation for sensitive changes (the email settings). The server refuses them with
// 403 `reauth_required` unless the password was proved in this session in the last few minutes;
// `run` turns that refusal into a prompt, confirms the password, and tries again.
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, Button, errorMessage, Modal, TextField } from '../../core';

export function useReauth() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  const ask = () => new Promise<boolean>((resolve) => {
    pending.current = resolve;
    setPassword('');
    setError('');
    setOpen(true);
  });
  const finish = (ok: boolean) => {
    setOpen(false);
    pending.current?.(ok);
    pending.current = null;
  };

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'reauth_required') throw err;
      if (!(await ask())) throw new ApiError(403, 'reauth_cancelled', 'Nothing was changed: your password was not confirmed.');
      return action();
    }
  }, []);

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

  const dialog = (
    <Modal open={open} title="Confirm your password" size="sm" onClose={() => finish(false)}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted">Email settings decide where the application connects to, so we need to check it is really you. You will not be asked again for a few minutes.</p>
        <TextField label="Your password" type="password" autoComplete="current-password" autoFocus required value={password} onChange={setPassword} error={error || undefined} />
        <div className="form-actions">
          <Button onClick={() => finish(false)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Confirm and continue</Button>
        </div>
      </form>
    </Modal>
  );
  return { run, dialog };
}
