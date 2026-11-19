import { useEffect, useState } from 'react';
import {
  api, ApiError, Button, DateField, errorMessage, LookupSelect, Modal, NumberField, TextArea, TextField, UserPicker, useToast,
} from '../../core';
import type { ProjectItem } from './types';

interface Props {
  projectId: string;
  open: boolean;
  /** The item to edit, or null to add one. */
  item: ProjectItem | null;
  defaultKind: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Add or edit a project risk, issue, decision or change request. */
export function ItemDialog({ projectId, open, item, defaultKind, onClose, onSaved }: Props) {
  const toast = useToast();
  const [kind, setKind] = useState(defaultKind);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string | undefined>();
  const [status, setStatus] = useState('open');
  const [dueOn, setDueOn] = useState('');
  const [likelihood, setLikelihood] = useState<number | null>(null);
  const [impact, setImpact] = useState<number | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(item?.kind ?? defaultKind);
    setTitle(item?.title ?? '');
    setDetail(item?.detail ?? '');
    setOwnerId(item?.owner_id ?? null);
    setOwnerName(item?.owner_name ?? undefined);
    setStatus(item?.status ?? 'open');
    setDueOn(item?.due_on ?? '');
    setLikelihood(item?.likelihood ?? null);
    setImpact(item?.impact ?? null);
    setFields({});
    setFormError('');
  }, [open, item, defaultKind]);

  const isRisk = kind === 'risk';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing: Record<string, string> = {};
    if (!kind) missing.kind = 'Kind is required.';
    if (!title.trim()) missing.title = 'Title is required.';
    for (const [name, v] of [['likelihood', likelihood], ['impact', impact]] as const) {
      if (isRisk && v !== null && (!Number.isInteger(v) || v < 1 || v > 5)) missing[name] = 'Enter a whole number from 1 to 5.';
    }
    setFields(missing);
    setFormError('');
    if (Object.keys(missing).length) return;
    const body = {
      kind, title, detail, owner_id: ownerId, status, due_on: dueOn || null,
      likelihood: isRisk ? likelihood : null, impact: isRisk ? impact : null,
    };
    setBusy(true);
    try {
      if (item) await api.patch(`/api/projects/${projectId}/items/${item.id}`, body);
      else await api.post(`/api/projects/${projectId}/items`, body);
      toast.success(item ? 'Saved.' : 'Added.');
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={item ? 'Edit item' : 'Add item'} onClose={onClose} size="md">
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <LookupSelect label="Kind" required list="project_item_kind" value={kind} onChange={setKind} error={fields.kind} />
          <LookupSelect label="Status" list="project_item_status" value={status} onChange={setStatus} error={fields.status} />
          <TextField className="form-cell-wide" label="Title" required value={title} onChange={setTitle} error={fields.title} />
          <TextArea className="form-cell-wide" label="Detail" value={detail} onChange={setDetail} rows={3} error={fields.detail} />
          <UserPicker label="Owner" value={ownerId} display={ownerName} onChange={(id, option) => { setOwnerId(id); setOwnerName(option?.label); }} error={fields.owner_id} />
          <DateField label="Due date" value={dueOn} onChange={setDueOn} error={fields.due_on} />
          {isRisk && (
            <>
              <NumberField label="Likelihood (1 to 5)" min={1} max={5} step={1} value={likelihood} onChange={setLikelihood} error={fields.likelihood} hint="1 is rare, 5 is almost certain" />
              <NumberField label="Impact (1 to 5)" min={1} max={5} step={1} value={impact} onChange={setImpact} error={fields.impact} hint="1 is minor, 5 is severe" />
            </>
          )}
        </div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>{item ? 'Save changes' : 'Add'}</Button>
        </div>
      </form>
    </Modal>
  );
}
