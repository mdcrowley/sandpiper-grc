import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, Button, DateField, formatDate, Modal, TextArea, useToast } from '../../core';
import type { Row } from '../../core';

// Asking for a later due date on an action (E23-05). The request goes through the "Action due date
// extension" approval workflow; once approved the action gets the new date and keeps its original one.

export function ExtensionDialog({ action, open, onClose, onSaved }: { action: Row; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ new_due_on: '', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setForm({ new_due_on: '', reason: '' }); setErrors({}); setMessage(''); } }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage('');
    try {
      const made = await api.post<Row>(`/api/actions/${action.id}/extension-request`, form);
      toast.success(made.status === 'approved' ? 'Due date extended.' : 'Extension asked for. You will be told the decision.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) { setErrors(err.fields); setMessage(err.message); } else setMessage(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="Ask for more time" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted" style={{ margin: 0 }}>
          {action.due_on ? `The action is due ${formatDate(action.due_on)}. ` : ''}
          The request goes to someone who may approve actions. If it is approved, the action gets the new due date and keeps its original one.
        </p>
        {message && <p role="alert" className="form-error">{message}</p>}
        <div className="form-grid">
          <DateField label="New due date" required value={form.new_due_on} error={errors.new_due_on} onChange={(v) => setForm((f) => ({ ...f, new_due_on: v }))} />
          <TextArea className="form-cell-wide" label="Why more time is needed" required value={form.reason} error={errors.reason} onChange={(v) => setForm((f) => ({ ...f, reason: v }))} />
        </div>
        <div className="form-actions">
          <Button variant="primary" type="submit" loading={saving}>Ask for the extension</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
