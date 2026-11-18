import { useState } from 'react';
import {
  api, ApiError, Badge, Button, Card, ConfirmDialog, DateTimeField, EmptyState, errorMessage, ErrorState, formatDateTime, IconButton,
  Loading, Modal, TextArea, TextField, useFetch, useToast,
} from '../../core';
import type { Blackout } from './types';

interface Form { id?: string; name: string; starts_at: string; ends_at: string; reason: string }

/** Blackout periods: times when changes should not be made. */
export function BlackoutsAdmin() {
  const toast = useToast();
  const { data, error, reload } = useFetch<Blackout[]>('/api/changes/blackouts');
  const [form, setForm] = useState<Form | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Blackout | null>(null);
  const now = Date.now();

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const begin = (b?: Blackout) => {
    setForm(b ? { id: b.id, name: b.name, starts_at: b.starts_at, ends_at: b.ends_at, reason: b.reason ?? '' } : { name: '', starts_at: '', ends_at: '', reason: '' });
    setFields({}); setFormError('');
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const missing: Record<string, string> = {};
    if (!form.name.trim()) missing.name = 'Name is required.';
    if (!form.starts_at) missing.starts_at = 'Start is required.';
    if (!form.ends_at) missing.ends_at = 'End is required.';
    else if (form.starts_at && new Date(form.ends_at) <= new Date(form.starts_at)) missing.ends_at = 'The end must be after the start.';
    setFields(missing);
    setFormError('');
    if (Object.keys(missing).length) return;
    setBusy(true);
    const { id, ...body } = form;
    try {
      if (id) await api.patch(`/api/changes/blackouts/${id}`, body); else await api.post('/api/changes/blackouts', body);
      toast.success(id ? 'Blackout period saved.' : 'Blackout period added.');
      setForm(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/changes/blackouts/${removing.id}`);
      toast.success('Blackout period deleted.');
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Blackout periods" flush actions={<Button size="sm" variant="primary" icon="plus" onClick={() => begin()}>Add blackout period</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={4} />
        : data.length === 0 ? (
          <EmptyState icon="calendar" title="No blackout periods" message="Add the times when changes should not be made, such as a year-end close or a major event. A change planned in one is flagged as a conflict." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Start</th><th>End</th><th>Reason</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <span className="row">
                        <strong>{b.name}</strong>
                        {new Date(b.ends_at).getTime() < now ? <Badge>Past</Badge> : new Date(b.starts_at).getTime() <= now ? <Badge color="amber">In force now</Badge> : null}
                      </span>
                    </td>
                    <td>{formatDateTime(b.starts_at)}</td>
                    <td>{formatDateTime(b.ends_at)}</td>
                    <td>{b.reason ?? '—'}</td>
                    <td className="num">
                      <span className="chg-rowactions">
                        <IconButton icon="edit" variant="ghost" label={`Edit ${b.name}`} onClick={() => begin(b)} />
                        <IconButton icon="trash" variant="ghost" label={`Delete ${b.name}`} onClick={() => setRemoving(b)} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <Modal open={form !== null} title={form?.id ? 'Edit blackout period' : 'Add blackout period'} onClose={() => setForm(null)} size="md">
        {form && (
          <form className="form" onSubmit={save} noValidate>
            <TextField label="Name" required value={form.name} onChange={(name) => set({ name })} error={fields.name} />
            <div className="form-grid">
              <DateTimeField label="Start" required value={form.starts_at} onChange={(starts_at) => set({ starts_at })} error={fields.starts_at} />
              <DateTimeField label="End" required value={form.ends_at} onChange={(ends_at) => set({ ends_at })} error={fields.ends_at} />
            </div>
            <TextArea label="Reason" value={form.reason} onChange={(reason) => set({ reason })} rows={2} hint="Shown wherever a change is flagged against this period." />
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <div className="form-actions">
              <Button onClick={() => setForm(null)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={busy}>Save blackout period</Button>
            </div>
          </form>
        )}
      </Modal>
      <ConfirmDialog
        open={removing !== null}
        title="Delete blackout period"
        message={`Delete "${removing?.name}"? Changes planned in it will no longer be flagged.`}
        confirmLabel="Delete blackout period"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
