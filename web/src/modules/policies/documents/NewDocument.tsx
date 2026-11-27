// A new document (E43-01, E43-03): what it is, where it sits in the hierarchy, who owns it, and who
// can read it, all decided before it is saved, so a restricted document is never briefly open to all.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api, ApiError, Button, errorMessage, LookupSelect, Modal, Notice, RecordPicker, Select, TextArea, TextField, UserPicker, useAuth, useFetch, useToast,
} from '../../../core';
import type { Row } from '../../../core';
import { AccessFields, accessBody, EMPTY_ACCESS, readersPhrase, useReaderCount } from './AccessEditor';
import { recordPath, type AccessList } from './types';

interface Options { departments: { id: string; name: string }[] }

/**
 * Kept mounted by the lists and opened with `open`, so closing it returns the focus to the button that
 * opened it (Mantine notes the focused element when `opened` turns true and returns to it when it turns
 * false; mounting already open or unmounting skips that). The form starts empty each time it opens.
 */
export function NewDocumentDialog({ open = true, onClose, initialType }: { open?: boolean; onClose: () => void; initialType?: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const options = useFetch<Options>('/api/policies/audience-options');
  const [form, setForm] = useState({
    title: '', document_type: initialType ?? 'policy', owning_department_id: '', parent_id: null as string | null,
    owner_id: (user?.id ?? null) as string | null, summary: '',
  });
  const [ownerName, setOwnerName] = useState(user?.displayName ?? '');
  const [access, setAccess] = useState<AccessList>(EMPTY_ACCESS);
  const [names, setNames] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Each opening starts from an empty form (the dialog stays mounted between openings).
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setForm({ title: '', document_type: initialType ?? 'policy', owning_department_id: '', parent_id: null, owner_id: user?.id ?? null, summary: '' });
      setOwnerName(user?.displayName ?? '');
      setAccess(EMPTY_ACCESS);
      setNames({});
      setErrors({});
      setMessage('');
    }
    wasOpen.current = open;
  }, [open, initialType, user]);
  const live = useReaderCount(access.access === 'restricted' ? access : null, form.owner_id);
  const dirty = Boolean(form.title || form.summary || form.parent_id || access.access !== 'organization');

  const save = async () => {
    setErrors({});
    setMessage('');
    if (!form.title.trim()) { setErrors({ title: 'Give the document a title.' }); return; }
    setBusy(true);
    try {
      const row = await api.post<Row>('/api/policies', {
        ...form, title: form.title.trim(), owning_department_id: form.owning_department_id || null, summary: form.summary || null, ...accessBody(access),
      });
      toast.success(`${row.doc_number || row.ref || 'Document'} created. Write or upload its first version next.`);
      onClose();
      navigate(recordPath(row.id));
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields ?? {}).length) { setErrors(err.fields); setMessage(err.message); } else setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open} title="New document" onClose={onClose} size="lg" dirty={dirty}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Create document</Button></>}
    >
      <div className="stack">
        {message && <Notice tone="error">{message}</Notice>}
        <TextField label="Title" required value={form.title} error={errors.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} />
        <div className="grid-2">
          <LookupSelect label="Type" list="policy_document_type" value={form.document_type} error={errors.document_type}
            onChange={(v) => setForm((f) => ({ ...f, document_type: v || 'policy' }))} />
          <Select
            label="Owning department" value={form.owning_department_id} error={errors.owning_department_id} placeholder="None"
            hint="Gives the department part of the document number."
            options={[{ value: '', label: 'None' }, ...(options.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))]}
            onChange={(v) => setForm((f) => ({ ...f, owning_department_id: v }))}
          />
          <RecordPicker type="policy" label="Under (parent document)" value={form.parent_id} error={errors.parent_id}
            hint="For example the policy a procedure carries out." onChange={(id) => setForm((f) => ({ ...f, parent_id: id }))} />
          <UserPicker label="Owner" value={form.owner_id} display={ownerName} error={errors.owner_id}
            onChange={(id, o) => { setForm((f) => ({ ...f, owner_id: id })); setOwnerName(o?.label ?? ''); }} />
        </div>
        <TextArea label="Summary" rows={2} value={form.summary} error={errors.summary} onChange={(v) => setForm((f) => ({ ...f, summary: v }))} />
        <fieldset className="doc-fieldset">
          <legend>Who can read it</legend>
          <div className="stack">
            <AccessFields value={access} onChange={setAccess} names={names} setNames={(a) => setNames((n) => ({ ...n, ...a }))} />
            {access.access === 'restricted' && live.count !== undefined && <p aria-live="polite"><strong>{readersPhrase(live.count)}</strong></p>}
          </div>
        </fieldset>
        <p className="muted doc-small">The document number is given from the type and department when it is saved. Write or upload the text next.</p>
      </div>
    </Modal>
  );
}
