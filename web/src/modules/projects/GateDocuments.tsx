import { useState } from 'react';
import { Anchor, FileButton, Group, Stack, Text } from '@mantine/core';
import {
  api, Badge, Button, Checkbox, errorMessage, formatDate, Icon, Modal, qs, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import { downloadAttachment, type Attachment, type FileConfig } from '../attachments/shared';
import { refusalFor, uploadFile } from '../attachments/upload';
import type { Gate, GateDocument } from './types';

interface Props {
  projectId: string;
  gate: Gate;
  /** False for viewers and once the gate is approved. */
  editable: boolean;
  onChanged: () => void;
}

export function documentState(doc: GateDocument): { color: 'green' | 'purple' | 'red' | 'gray'; label: string } {
  if (doc.received) return { color: 'green', label: 'Received' };
  if (doc.waived) return { color: 'purple', label: 'Waived' };
  return doc.required ? { color: 'red', label: 'Missing' } : { color: 'gray', label: 'Optional' };
}

function WaiveDialog({ doc, onClose, onSubmit }: { doc: GateDocument | null; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={Boolean(doc)} title={`Waive: ${doc?.name ?? ''}`} onClose={onClose} size="sm">
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!reason.trim()) { setError('Say why this document is not needed.'); return; }
          setBusy(true);
          try { await onSubmit(reason.trim()); setReason(''); setError(''); } finally { setBusy(false); }
        }}
      >
        <Text size="sm" c="dimmed">A waived document no longer blocks the gate. Your name, the date and the reason are kept on the gate and in the history.</Text>
        <TextArea label="Reason" required rows={3} value={reason} onChange={setReason} error={error} />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Waive document</Button>
        </div>
      </form>
    </Modal>
  );
}

/** The documents a gate expects: tick each as received, say where it is filed or attach the file, or waive it. */
export function GateDocuments({ projectId, gate, editable, onChanged }: Props) {
  const toast = useToast();
  const { can } = useAuth();
  const [busy, setBusy] = useState<number | null>(null);
  const [waiving, setWaiving] = useState<number | null>(null);
  // Files are kept on the project by the attachments module; when it is absent the list fails quietly.
  const files = useFetch<{ rows: Attachment[]; canEdit: boolean }>(`/api/attachments${qs({ record_type: 'project', record_id: projectId })}`);
  const config = useFetch<FileConfig>(files.data ? '/api/attachments/config' : null);
  const canAttach = editable && Boolean(files.data?.canEdit);
  const url = `/api/projects/${projectId}/gates/${gate.id}/documents`;

  async function run(index: number, action: () => Promise<unknown>) {
    setBusy(index);
    try {
      await action();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  const save = (index: number, patch: Partial<GateDocument>) => run(index, () => api.patch(`${url}/${index}`, patch));

  async function attach(index: number, file: File | null) {
    if (!file) return;
    const refusal = refusalFor(file, config.data ?? undefined);
    if (refusal) { toast.error(refusal); return; }
    await run(index, async () => {
      const saved = await uploadFile(
        file,
        { record_type: 'project', record_id: projectId, kind: 'file', description: `${gate.name} gate: ${gate.documents[index].name}` },
        () => undefined,
      );
      await api.patch(`${url}/${index}`, { attachment_id: saved.id, received: true });
      files.reload();
      toast.success(`"${file.name}" attached and the document marked as received.`);
    });
  }

  if (!gate.documents.length) return <Text size="sm" c="dimmed">No documents are expected at this gate.</Text>;

  return (
    <>
      <ul className="prj-doclist">
        {gate.documents.map((doc, i) => {
          const state = documentState(doc);
          const file = doc.attachment_id ? files.data?.rows.find((f) => f.id === doc.attachment_id) : undefined;
          return (
            <li key={doc.name} className="prj-doc">
              <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
                <Checkbox
                  label={doc.name}
                  hint={doc.required ? 'Required' : 'Optional'}
                  checked={doc.received}
                  disabled={!editable || busy === i}
                  onChange={(received) => save(i, { received })}
                />
                <Badge color={state.color}>{state.label}</Badge>
              </Group>
              <Stack gap={6} pl={28} mt={4}>
                {doc.waived && (
                  <Text size="xs" c="dimmed">
                    Waived by {doc.waived_by_name ?? 'an approver'}{doc.waived_on ? ` on ${formatDate(doc.waived_on)}` : ''}: {doc.waive_reason}
                  </Text>
                )}
                {doc.attachment_id && (
                  <Text size="sm">
                    <Icon name="file-text" size={14} />{' '}
                    {file
                      ? <Anchor component="button" type="button" size="sm" onClick={() => downloadAttachment(file).catch((err) => toast.error(errorMessage(err)))}>{file.file_name}</Anchor>
                      : <Text span c="dimmed" inherit>A file is attached (see the Attachments tab)</Text>}
                  </Text>
                )}
                {editable ? (
                  <Group gap="xs" align="flex-end" wrap="wrap">
                    <div style={{ flex: '1 1 160px' }}>
                      <DocReference key={doc.reference} doc={doc} onSave={(reference) => save(i, { reference })} />
                    </div>
                    {canAttach && (
                      <FileButton onChange={(f) => attach(i, f)}>
                        {(props) => <Button size="sm" icon="upload" loading={busy === i} {...props}>{doc.attachment_id ? 'Replace file' : 'Attach file'}</Button>}
                      </FileButton>
                    )}
                    {doc.required && !doc.received && can('projects.approve') && (
                      doc.waived
                        ? <Button size="sm" variant="ghost" onClick={() => run(i, () => api.post(`${url}/${i}/waive`, { waived: false }))}>Withdraw waiver</Button>
                        : <Button size="sm" variant="ghost" onClick={() => setWaiving(i)}>Waive</Button>
                    )}
                  </Group>
                ) : doc.reference && <Text size="xs" c="dimmed">Filed: {doc.reference}</Text>}
              </Stack>
            </li>
          );
        })}
      </ul>
      <WaiveDialog
        doc={waiving === null ? null : gate.documents[waiving]}
        onClose={() => setWaiving(null)}
        onSubmit={async (reason) => {
          const index = waiving!;
          setWaiving(null);
          await run(index, () => api.post(`${url}/${index}/waive`, { reason }));
        }}
      />
    </>
  );
}

function DocReference({ doc, onSave }: { doc: GateDocument; onSave: (reference: string) => void }) {
  const [value, setValue] = useState(doc.reference ?? '');
  return (
    <div onBlur={() => { if (value.trim() !== (doc.reference ?? '')) onSave(value.trim()); }}>
      <TextField label={`Where ${doc.name} is filed`} hideLabel size="xs" placeholder="Where it is filed" value={value} onChange={setValue} />
    </div>
  );
}
