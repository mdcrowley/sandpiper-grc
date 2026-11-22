// Link a document kept elsewhere (the organization's document store) instead of uploading a copy
// (E36-05). The address is saved as typed; the application never opens it.
import { useState, type FormEvent } from 'react';
import { api, ApiError, Button, Checkbox, DateField, errorMessage, Modal, TextArea, TextField, useToast } from '../../core';

interface Props {
  recordType: string;
  recordId: string;
  /** Start with "this link is evidence" checked (the record's file tab is an evidence tab). */
  evidence: boolean;
  /** The organization's date today (YYYY-MM-DD), from the server. */
  today: string;
  onClose: () => void;
  onSaved: () => void;
}

export function LinkDialog({ recordType, recordId, evidence, today, onClose, onSaved }: Props) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isEvidence, setIsEvidence] = useState(evidence);
  const [collectedOn, setCollectedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = Boolean(url.trim() || title.trim() || description.trim() || collectedOn || expiresOn || isEvidence !== evidence);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await api.post('/api/attachments/link', {
        record_type: recordType, record_id: recordId, url, title: title || undefined, description: description || undefined,
        evidence: isEvidence,
        collected_on: isEvidence ? collectedOn || undefined : undefined,
        expires_on: isEvidence ? expiresOn || undefined : undefined,
      });
      toast.success('Link added.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title="Add a link" onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit}>
        <p className="muted">
          Link a document kept in your document store instead of uploading a copy. People open it there, with their own access;
          this application never opens the address. Use a link that does not expire.
        </p>
        <TextField
          label="Address" required type="url" value={url} onChange={setUrl} error={errors.url}
          placeholder="https://" hint="The full web address of the document, starting with https://."
        />
        <TextField
          label="Title" value={title} onChange={setTitle} error={errors.title}
          hint="What the document is. Left empty, the last part of the address is used."
        />
        <TextArea label="Description" rows={2} value={description} onChange={setDescription} error={errors.description} />
        <Checkbox
          label="This link is evidence" checked={isEvidence} onChange={setIsEvidence}
          hint="Evidence has a collection date and can have an expiry date, after which a newer document is needed."
        />
        {isEvidence && (
          <div className="form-grid">
            <DateField label="Collected on" value={collectedOn || today} max={today || undefined} onChange={setCollectedOn} error={errors.collected_on} />
            <DateField label="Expires on" value={expiresOn} min={collectedOn || today || undefined} onChange={setExpiresOn} error={errors.expires_on} hint="Optional" />
          </div>
        )}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Add link</Button>
        </div>
      </form>
    </Modal>
  );
}
