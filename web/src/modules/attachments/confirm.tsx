// Password confirmation for sensitive settings on the File settings and Backups pages.
// The server refuses those changes with 403 `reauth_required` unless the password was proved
// in this session a few minutes ago; `run` turns that refusal into a prompt and tries again.
import { useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, Button, errorMessage, Modal, TextField } from '../../core';

export function usePasswordConfirm(): { run: <T>(action: () => Promise<T>) => Promise<T>; dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  const ask = () => new Promise<boolean>((resolve) => {
    pending.current = resolve;
    setPassword('');
    setError(undefined);
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
    <Modal
      open={open} size="sm" title="Confirm your password" onClose={() => finish(false)}
      footer={(
        <div className="form-actions">
          <Button onClick={() => finish(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form="att-confirm-form" loading={busy}>Confirm and continue</Button>
        </div>
      )}
    >
      <form id="att-confirm-form" className="form" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>
          This setting decides where files and backups go, or whether they are checked or deleted, so we need to check it is really you.
          You will not be asked again for a few minutes.
        </p>
        <TextField label="Your password" type="password" autoComplete="current-password" value={password} onChange={setPassword} error={error} autoFocus />
      </form>
    </Modal>
  );
  return { run, dialog };
}
