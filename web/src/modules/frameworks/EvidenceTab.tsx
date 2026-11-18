import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  ApiError, Button, ConfirmDialog, DateField, EmptyState, ErrorState, IconButton, Loading, Modal, StatusChip,
  TextArea, TextField, api, errorMessage, formatDate, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';
import type { Evidence } from './types';

function ExpiryChip({ item }: { item: Evidence }) {
  if (!item.expires_on) return <StatusChip color="gray" label="No expiry" />;
  if (item.state === 'expired') return <StatusChip color="red" label={`Expired ${formatDate(item.expires_on)}`} />;
  if (item.state === 'expiring') return <StatusChip color="amber" label={`Expires ${formatDate(item.expires_on)}`} />;
  return <StatusChip color="green" label={`Valid to ${formatDate(item.expires_on)}`} />;
}

const BLANK = { title: '', description: '', location: '', collected_on: '', expires_on: '' };

function AddEvidence({ outcomeId, onDone, onCancel }: { outcomeId: string; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof BLANK) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!form.title.trim()) found.title = 'Title is required.';
    if (form.collected_on && form.expires_on && form.expires_on < form.collected_on) found.expires_on = 'Expiry cannot be before the date collected.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await api.post(`/api/framework-outcomes/${outcomeId}/evidence`, form);
      toast.success('Evidence added.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <TextField label="Title" required autoFocus value={form.title} onChange={set('title')} error={errors.title}
        placeholder="For example: Signed minutes adopting the policy" />
      <TextArea label="What it shows" rows={3} value={form.description} onChange={set('description')} error={errors.description} />
      <TextField label="Where it is kept" value={form.location} onChange={set('location')} error={errors.location}
        hint="A folder path, document reference or web address." />
      <div className="form-grid">
        <DateField label="Collected on" value={form.collected_on} onChange={set('collected_on')} error={errors.collected_on} />
        <DateField label="Expires on" value={form.expires_on} onChange={set('expires_on')} error={errors.expires_on}
          min={form.collected_on || undefined} hint="Leave empty if it does not go out of date." />
      </div>
      <div className="form-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>Add evidence</Button>
      </div>
    </form>
  );
}

export function EvidenceTab({ outcome, canEdit }: { outcome: Row; canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Evidence[]>(`/api/framework-outcomes/${outcome.id}/evidence`);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/framework-outcomes/${outcome.id}/evidence/${removing.id}`);
      toast.success('Evidence removed.');
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const addButton = canEdit && <Button icon="plus" size="sm" onClick={() => setAdding(true)}>Add evidence</Button>;

  return (
    <div className="stack">
      {outcome.evidence_summary && (
        <div>
          <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Evidence summary</div>
          <div className="prose">{outcome.evidence_summary}</div>
        </div>
      )}
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} label="Loading evidence" />
        : data.length === 0 ? (
          <EmptyState
            icon="file-text"
            title="No evidence items yet"
            message="Add each document, record or screenshot that shows this outcome is met, with where it is kept and when it goes out of date."
            action={addButton || undefined}
          />
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">{data.length} item{data.length === 1 ? '' : 's'}
                {data.some((e) => e.state === 'expired') ? ` · ${data.filter((e) => e.state === 'expired').length} expired` : ''}</span>
              {addButton}
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Evidence</th><th>Where it is kept</th><th>Collected</th><th>Expiry</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {data.map((e) => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'normal' }}>
                        <div className="row-title">{e.title}</div>
                        {e.description && <div className="muted prose">{e.description}</div>}
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>{e.location || '—'}</td>
                      <td>{formatDate(e.collected_on)}</td>
                      <td><ExpiryChip item={e} /></td>
                      <td className="num">
                        {canEdit && <IconButton icon="trash" label={`Remove ${e.title}`} variant="ghost" size="sm" onClick={() => setRemoving(e)} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

      <Modal open={adding} title={`Add evidence for ${outcome.code}`} onClose={() => setAdding(false)}>
        <AddEvidence outcomeId={outcome.id} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
      </Modal>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this evidence item?"
        message={`"${removing?.title ?? ''}" will be removed from ${outcome.code}. The removal is recorded in the history.`}
        confirmLabel="Remove" danger busy={busy}
        onConfirm={remove} onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
