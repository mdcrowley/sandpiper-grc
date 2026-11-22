// Edit the description and evidence dates of one attached file, or the address and title of a link.
import { useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Checkbox, DateField, DefinitionList, errorMessage, formatDate, formatDateTime, Modal, TextArea, TextField, useToast,
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
  const link = attachment.is_link === true;
  const start = {
    description: attachment.description ?? '',
    isEvidence: attachment.kind === 'evidence',
    collectedOn: attachment.collected_on ?? today,
    expiresOn: attachment.expires_on ?? '',
    url: attachment.link_url ?? '',
    title: attachment.link_title ?? attachment.file_name,
  };
  const [description, setDescription] = useState(start.description);
  const [isEvidence, setIsEvidence] = useState(start.isEvidence);
  const [collectedOn, setCollectedOn] = useState(start.collectedOn);
  const [expiresOn, setExpiresOn] = useState(start.expiresOn);
  const [url, setUrl] = useState(start.url);
  const [title, setTitle] = useState(start.title);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = description !== start.description || isEvidence !== start.isEvidence || collectedOn !== start.collectedOn
    || expiresOn !== start.expiresOn || url !== start.url || title !== start.title;

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
        ...(link ? { url, title } : {}),
      });
      toast.success(link ? 'Link details saved.' : 'File details saved.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const added = { label: link ? 'Added' : 'Attached', value: `${formatDateTime(attachment.uploaded_at)}${attachment.uploaded_by_name ? ` by ${attachment.uploaded_by_name}` : ''}` };
  return (
    <Modal open title={`Edit ${attachment.file_name}`} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit}>
        {link && (
          <>
            <TextField label="Address" required type="url" value={url} onChange={setUrl} error={errors.url} hint="The full web address, starting with https://." />
            <TextField label="Title" required value={title} onChange={setTitle} error={errors.title} />
          </>
        )}
        <TextArea
          label="Description" rows={2} value={description} onChange={setDescription} error={errors.description}
          hint={link ? 'What the document is and why it is linked.' : 'What the file is and why it is attached.'}
        />
        <Checkbox
          label={link ? 'This link is evidence' : 'This file is evidence'} checked={isEvidence} onChange={setIsEvidence} error={errors.kind}
          hint="Evidence has a collection date and can have an expiry date, after which a newer copy is needed."
        />
        {isEvidence && (
          <div className="form-grid">
            <DateField label="Collected on" required value={collectedOn} max={today} onChange={setCollectedOn} error={errors.collected_on} />
            <DateField label="Expires on" value={expiresOn} min={collectedOn || undefined} onChange={setExpiresOn} error={errors.expires_on} hint="Leave empty if it does not expire." />
          </div>
        )}
        <DefinitionList
          items={link ? [
            added,
            { label: 'Last checked', value: attachment.last_checked_on ? `${formatDate(attachment.last_checked_on)}${attachment.checked_by_name ? ` by ${attachment.checked_by_name}` : ''}` : 'Never' },
          ] : [
            { label: 'Size', value: formatBytes(attachment.size_bytes) },
            added,
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
