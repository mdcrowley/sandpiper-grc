import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, Button, LookupSelect, Modal, TextArea, useToast } from '../../core';
import type { Row } from '../../core';

// Recording the verification of an action awaiting verification (E23-03): how it was checked and
// whether it worked. Effective (or partly effective) finishes the action; not effective reopens it,
// with the reason, and moves its corrective action plan back to in progress.

export function VerifyDialog({ action, open, onClose, onSaved }: { action: Row; open: boolean; onClose: () => void; onSaved: (row: Row) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ method: '', result: '', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setForm({ method: '', result: '', note: '' }); setErrors({}); setMessage(''); } }, [open]);
  // The server reopens on any result whose list value is marked "reopen"; the shipped one is not_effective.
  const reopens = form.result === 'not_effective';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage('');
    try {
      const saved = await api.post<Row>(`/api/actions/${action.id}/verify`, form);
      toast.success(reopens ? `${action.ref ?? 'Action'} reopened: it was not effective.` : `${action.ref ?? 'Action'} verified and done.`);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) { setErrors(err.fields); setMessage(err.message); } else setMessage(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="Record verification" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted" style={{ margin: 0 }}>
          Check that the action fixed the problem. An effective result finishes the action; a result that was not effective reopens it
          for its owner, with your note as the reason.
        </p>
        {message && <p role="alert" className="form-error">{message}</p>}
        <div className="form-grid">
          <LookupSelect label="Method" required list="verification_method" value={form.method} error={errors.method} onChange={(v) => setForm((f) => ({ ...f, method: v ?? '' }))} />
          <LookupSelect label="Result" required list="verification_result" value={form.result} error={errors.result} onChange={(v) => setForm((f) => ({ ...f, result: v ?? '' }))} />
          <TextArea
            className="form-cell-wide" label={reopens ? 'Why it was not effective' : 'Note'} required={reopens}
            hint={reopens ? 'The action is reopened with this reason.' : 'What you checked and what you found.'}
            value={form.note} error={errors.note} onChange={(v) => setForm((f) => ({ ...f, note: v }))}
          />
        </div>
        <div className="form-actions">
          <Button variant="primary" type="submit" loading={saving}>{reopens ? 'Reopen the action' : 'Record verification'}</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
