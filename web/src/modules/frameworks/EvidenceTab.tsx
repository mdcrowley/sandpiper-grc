import { Suspense, lazy, useState } from 'react';
import type { ComponentType, FormEvent } from 'react';
import {
  ApiError, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, IconButton, Loading, Modal, StatusChip,
  TableWrap, TextArea, TextField, api, errorMessage, formatDate, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { Row } from '../../core';
import type { Evidence } from './types';

// The attachments module supplies the file panel. It is found at build time and loaded on
// first use, so this page still builds and works when that module is absent.
const loaders = import.meta.glob<{ AttachmentsPanel: ComponentType<{ recordType: string; recordId: string; evidence?: boolean }> }>(
  '../attachments/AttachmentsPanel.tsx',
);
const load = Object.values(loaders)[0];
const AttachmentsPanel = load ? lazy(() => load().then((m) => ({ default: m.AttachmentsPanel }))) : null;

function ExpiryChip({ item }: { item: Evidence }) {
  if (!item.expires_on) return <StatusChip color="gray" label="No expiry" />;
  if (item.state === 'expired') return <StatusChip color="red" label={`Expired ${formatDate(item.expires_on)}`} />;
  if (item.state === 'expiring') return <StatusChip color="amber" label={`Expires ${formatDate(item.expires_on)}`} />;
  return <StatusChip color="green" label={`Valid to ${formatDate(item.expires_on)}`} />;
}

const BLANK = { title: '', description: '', location: '', collected_on: '', expires_on: '' };

/** Add a written evidence entry, or change one (`item` given). */
function EvidenceForm({ outcomeId, item, onDone, onCancel }: { outcomeId: string; item?: Evidence; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState(item ? {
    title: item.title, description: item.description ?? '', location: item.location ?? '',
    collected_on: item.collected_on ?? '', expires_on: item.expires_on ?? '',
  } : BLANK);
  const [start] = useState(form);
  // Tells the enclosing dialog, so closing it after a change asks first.
  useUnsavedChanges(JSON.stringify(form) !== JSON.stringify(start));
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
      if (item) await api.patch(`/api/framework-outcomes/${outcomeId}/evidence/${item.id}`, form);
      else await api.post(`/api/framework-outcomes/${outcomeId}/evidence`, form);
      toast.success(item ? 'Evidence changed.' : 'Evidence added.');
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
        <Button type="submit" variant="primary" loading={busy}>{item ? 'Save changes' : 'Add evidence'}</Button>
      </div>
    </form>
  );
}

export function EvidenceTab({ outcome, canEdit }: { outcome: Row; canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Evidence[]>(`/api/framework-outcomes/${outcome.id}/evidence`);
  // The file panel is offered only when the attachments service answers.
  const files = useFetch<unknown>(AttachmentsPanel ? '/api/attachments/config' : null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Evidence | null>(null);
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

  const addButton = canEdit && <Button icon="plus" size="sm" onClick={() => setAdding(true)}>Add evidence note</Button>;
  const expired = (data ?? []).filter((e) => e.state === 'expired').length;

  return (
    <div className="stack">
      {outcome.evidence_summary && (
        <div className="fw-evidence-summary">
          <div className="fw-eyebrow">Evidence summary</div>
          <div className="prose">{outcome.evidence_summary}</div>
        </div>
      )}

      {AttachmentsPanel && files.data !== undefined && (
        <Card title="Evidence files">
          <Suspense fallback={<Loading lines={3} label="Loading evidence files" />}>
            <AttachmentsPanel recordType="framework_outcome" recordId={outcome.id} evidence />
          </Suspense>
        </Card>
      )}

      <Card
        title="Evidence notes"
        actions={data && data.length > 0 ? addButton : undefined}
        flush={Boolean(data && data.length > 0)}
      >
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <Loading lines={3} label="Loading evidence" />
          : data.length === 0 ? (
            <EmptyState
              icon="file-text"
              title="No evidence notes yet"
              message="Describe evidence that is kept somewhere else: what it shows, where it is kept and when it goes out of date."
              action={addButton || undefined}
            />
          ) : (
            <TableWrap label={`${data.length} evidence note${data.length === 1 ? '' : 's'}${expired ? `, ${expired} expired` : ''}`}>
              <table className="table">
                <caption className="sr-only">{data.length} evidence note{data.length === 1 ? '' : 's'}{expired ? `, ${expired} expired` : ''}</caption>
                <thead>
                  <tr><th scope="col">Evidence</th><th scope="col">Where it is kept</th><th scope="col">Collected</th><th scope="col">Expiry</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
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
                      <td className="num fw-row-actions">
                        {canEdit && (
                          <>
                            <IconButton icon="edit" label={`Edit ${e.title}`} variant="ghost" size="sm" onClick={() => setEditing(e)} />
                            <IconButton icon="trash" label={`Remove ${e.title}`} variant="ghost" size="sm" onClick={() => setRemoving(e)} />
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>

      <Modal open={adding} title={`Add evidence note for ${outcome.code}`} onClose={() => setAdding(false)}>
        <EvidenceForm outcomeId={outcome.id} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
      </Modal>
      <Modal open={editing !== null} title={`Edit evidence note for ${outcome.code}`} onClose={() => setEditing(null)}>
        {editing && (
          <EvidenceForm outcomeId={outcome.id} item={editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />
        )}
      </Modal>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this evidence note?"
        message={`"${removing?.title ?? ''}" will be removed from ${outcome.code}. The removal is recorded in the history.`}
        confirmLabel="Remove" danger busy={busy}
        onConfirm={remove} onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
