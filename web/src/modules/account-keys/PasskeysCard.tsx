// Passkeys and security keys of one person: add with a friendly name, list, rename, remove.
// Embeddable: <PasskeysCard /> for the signed-in person (Account security), or
// <PasskeysCard userId={id} /> on an administrator's user page (list and remove only).
import { useState, type FormEvent } from 'react';
import {
  api, ApiError, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, Icon,
  Loading, Modal, relativeTime, StatusChip, TextField, useFetch, useToast,
} from '../../core';
import './account-keys.css';
import { useConfirmPassword } from './ConfirmPassword';
import { browserKeyError, createPasskey, passkeysSupported } from './webauthn';

export interface Passkey {
  id: string; name: string; createdAt: string; lastUsedAt: string | null; lastUsedIp: string | null;
  synced: boolean; userVerified: boolean; transports: string[]; algorithm: string; rpId: string;
}
interface Mine { credentials: Passkey[]; rpId: string; problem: string | null; userVerification: string; passwordless: boolean; max: number }

/** What kind of key this looks like, from what the browser told us when it was added. */
function kind(k: Passkey): string {
  if (k.synced) return 'Synced passkey';
  if (k.transports.includes('internal')) return 'Passkey on this device';
  if (k.transports.some((t) => ['usb', 'nfc', 'ble', 'smart-card'].includes(t))) return 'Security key';
  return 'Passkey';
}

export function PasskeysCard({ userId, onChange }: { userId?: string; onChange?: () => void }) {
  const admin = Boolean(userId);
  const toast = useToast();
  const mine = useFetch<Mine>(admin ? null : '/api/auth/webauthn/credentials');
  const theirs = useFetch<{ credentials: Passkey[] }>(admin ? `/api/admin/users/${userId}/passkeys` : null);
  const state = admin ? theirs : mine;
  const keys = state.data?.credentials;
  const { dialog: confirmDialog, withConfirm } = useConfirmPassword();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = () => { state.reload(); onChange?.(); };

  const problem = !admin ? mine.data?.problem ?? (passkeysSupported() ? null : 'This browser cannot use passkeys or security keys.') : null;
  const full = !admin && mine.data ? mine.data.credentials.length >= mine.data.max : false;

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await withConfirm(() => api.del(admin ? `/api/admin/users/${userId}/passkeys/${removing.id}` : `/api/auth/webauthn/credentials/${removing.id}`));
      toast.success(`"${removing.name}" removed.`);
      setRemoving(null);
      changed();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const count = keys?.length ?? 0;
  return (
    <Card
      title="Passkeys and security keys" flush className="ak-card"
      actions={keys && <StatusChip color={count ? 'green' : 'gray'} label={count ? `${count} ${count === 1 ? 'key' : 'keys'}` : admin ? 'None' : 'None yet'} />}
    >
      {state.error ? <ErrorState error={state.error} onRetry={state.reload} />
        : !keys ? <div className="card-body"><Loading lines={3} label="Loading passkeys" /></div>
        : (
          <>
            {!admin && (
              <div className="card-body ak-intro">
                <p>
                  A passkey signs you in with your fingerprint, face or device PIN; a security key with a touch of a small
                  hardware key. Either one can stand in for the 6-digit code, and a passkey can sign you in on its own.
                  They cannot be phished: they only work on this site.
                </p>
                {problem && (
                  <div className="notice notice-pilot" role="status">
                    <Icon name="info" size={16} />
                    <div>{problem}</div>
                  </div>
                )}
              </div>
            )}
            {count === 0 ? (
              <EmptyState
                icon="key"
                title={admin ? 'No passkeys or security keys' : 'No passkeys or security keys yet'}
                message={admin ? 'This person has not added any.' : 'Add one to sign in without typing a code.'}
              />
            ) : (
              <ul className="ak-list" aria-label="Passkeys and security keys">
                {keys.map((k) => (
                  <li key={k.id} className="ak-item">
                    <span className="ak-item-icon" aria-hidden="true"><Icon name="key" size={18} /></span>
                    <div className="ak-item-main">
                      <span className="ak-item-name">{k.name} <Badge color={k.synced ? 'blue' : 'gray'}>{kind(k)}</Badge></span>
                      <span className="muted ak-item-facts">
                        <span>Added {formatDate(k.createdAt)}</span>
                        <span title={k.lastUsedAt ? formatDateTime(k.lastUsedAt) : undefined}>
                          {k.lastUsedAt ? `Last used ${relativeTime(k.lastUsedAt)}${k.lastUsedIp ? ` from ${k.lastUsedIp}` : ''}` : 'Not used yet'}
                        </span>
                      </span>
                    </div>
                    <div className="ak-item-actions">
                      {!admin && <Button size="sm" variant="ghost" aria-label={`Rename ${k.name}`} onClick={() => setRenaming(k)}>Rename</Button>}
                      <Button size="sm" variant="ghost" className="ak-remove" aria-label={`Remove ${k.name}`} onClick={() => setRemoving(k)}>Remove</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {!admin && (
              <div className="card-body ak-foot">
                <Button variant={count ? 'secondary' : 'primary'} icon="plus" disabled={Boolean(problem) || full} onClick={() => setAdding(true)}>
                  {count ? 'Add another key' : 'Add a passkey or security key'}
                </Button>
                <p className="muted">
                  {full ? 'You have the most keys an account can have. Remove one to add another.'
                    : 'Add two, or keep the authenticator app as well, so that losing one key does not lock you out.'}
                </p>
              </div>
            )}
          </>
        )}
      {adding && <AddKeyDialog withConfirm={withConfirm} onClose={() => setAdding(false)} onAdded={(name) => { setAdding(false); toast.success(`"${name}" added. You can use it the next time you sign in.`); changed(); }} />}
      {renaming && <RenameDialog passkey={renaming} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); changed(); }} />}
      <ConfirmDialog
        open={removing !== null} danger busy={busy} title="Remove this key?" confirmLabel="Remove key"
        message={removing && (admin
          ? <>“{removing.name}” will stop working for this person at once. Removing it is recorded in the audit log.</>
          : <>“{removing.name}” will stop working for your account at once. If it is your only second factor, you may be asked to set one up again.</>)}
        onConfirm={() => void remove()} onCancel={() => setRemoving(null)}
      />
      {confirmDialog}
    </Card>
  );
}

function AddKeyDialog({ withConfirm, onClose, onAdded }: {
  withConfirm: <T>(action: () => Promise<T>) => Promise<T>; onClose: () => void; onAdded: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) { setError('Give the key a name, so you can tell your keys apart.'); return; }
    setBusy(true);
    setFormError('');
    try {
      const options = await withConfirm(() => api.post('/api/auth/webauthn/register/options'));
      const credential = await createPasskey(options);
      await api.post('/api/auth/webauthn/register', { name: clean, credential });
      onAdded(clean);
    } catch (err) {
      if (err instanceof ApiError && err.fields.name) setError(err.fields.name);
      else setFormError(browserKeyError(err) ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open size="sm" title="Add a passkey or security key" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert"><Icon name="alert-circle" size={16} /><span>{formError}</span></p>}
        <TextField
          label="Name" required autoFocus maxLength={60} value={name} error={error || undefined}
          onChange={(v) => { setName(v); setError(''); }}
          hint="Something to tell your keys apart, such as “Work laptop” or “Blue security key”."
        />
        <p className="muted">
          When you continue, your browser asks you to choose where to keep the passkey (this device, your phone or a
          password manager) or to touch your security key.
        </p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon="key" loading={busy}>Continue</Button>
        </div>
      </form>
    </Modal>
  );
}

function RenameDialog({ passkey, onClose, onDone }: { passkey: Passkey; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(passkey.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Enter a name.'); return; }
    setBusy(true);
    try {
      await api.patch(`/api/auth/webauthn/credentials/${passkey.id}`, { name: name.trim() });
      toast.success('Key renamed.');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.fields.name ? err.fields.name : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open size="sm" title="Rename key" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <TextField label="Name" required autoFocus maxLength={60} value={name} error={error || undefined} onChange={(v) => { setName(v); setError(''); }} />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
