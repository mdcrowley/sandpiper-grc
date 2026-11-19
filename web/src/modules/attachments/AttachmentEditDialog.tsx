// Edit the description and evidence dates of one attached file.
import { useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Checkbox, DateField, DefinitionList, errorMessage, formatDateTime, Modal, TextArea, useToast,
} from '../../core';
import { formatBytes, type Attachment } from './shared';

interface Props {
  attachment: Attachment;
  /** The organization's date today (YYYY-MM-DD), from the server. */
  today: string;
  onClose: () => void;
  onSaved: () => void;
}

export function AttachmentEditDialog({ attachment, today, onClose, onSaved }: Props) {
  const toast = useToast();
  const [description, setDescription] = useState(attachment.description ?? '');
  const [isEvidence, setIsEvidence] = useState(attachment.kind === 'evidence');
  const [collectedOn, setCollectedOn] = useState(attachment.collected_on ?? today);
  const [expiresOn, setExpiresOn] = useState(attachment.expires_on ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await api.patch(`/api/attachments/${attachment.id}`, {
        description,
        kind: isEvidence ? 'evidence' : 'file',
        collected_on: isEvidence ? collectedOn || null : null,
        expires_on: isEvidence ? expiresOn || null : null,
      });
      toast.success('File details saved.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={`Edit ${attachment.file_name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <TextArea
          label="Description" rows={2} value={description} onChange={setDescription} error={errors.description}
          hint="What the file is and why it is attached."
        />
        <Checkbox
          label="This file is evidence" checked={isEvidence} onChange={setIsEvidence} error={errors.kind}
          hint="Evidence has a collection date and can have an expiry date, after which a newer copy is needed."
        />
        {isEvidence && (
          <div className="form-grid">
            <DateField label="Collected on" required value={collectedOn} max={today} onChange={setCollectedOn} error={errors.collected_on} />
            <DateField label="Expires on" value={expiresOn} min={collectedOn || undefined} onChange={setExpiresOn} error={errors.expires_on} hint="Leave empty if it does not expire." />
          </div>
        )}
        <DefinitionList
          items={[
            { label: 'Size', value: formatBytes(attachment.size_bytes) },
            { label: 'Attached', value: `${formatDateTime(attachment.uploaded_at)}${attachment.uploaded_by_name ? ` by ${attachment.uploaded_by_name}` : ''}` },
            {
              label: 'Malware scan',
              value: attachment.scan_status === 'clean' ? `Checked${attachment.scan_engine ? ` by ${attachment.scan_engine}` : ''}` : 'Not scanned',
            },
            { label: 'Checksum (SHA-256)', value: <code className="att-hash">{attachment.sha256}</code>, wide: true },
          ]}
        />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}
