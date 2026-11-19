import { useState } from 'react';
import { Text } from '@mantine/core';
import { api, Button, errorMessage, lookupLabel, Modal, TextArea, useToast } from '../../core';
import type { ProjectGates } from './types';

interface Props {
  open: boolean;
  projectId: string;
  data: ProjectGates;
  onClose: () => void;
  onDone: () => void;
}

/** Sends a project back to the stage before its last approved gate, with a recorded reason. */
export function RollbackDialog({ open, projectId, data, onClose, onDone }: Props) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const target = data.rollback;
  if (!target) return null;
  const from = lookupLabel('project_stage', data.stage);
  const to = lookupLabel('project_stage', target.to_stage);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setError('Say why the project is moving back.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/projects/${projectId}/rollback`, { reason });
      toast.success(`Moved back to ${to}. The ${target!.gate_name} gate is open again.`);
      setReason('');
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={`Move back to ${to}`} onClose={onClose} size="sm">
      <form className="form" onSubmit={submit} noValidate>
        <Text size="sm">
          The project returns from <strong>{from}</strong> to <strong>{to}</strong> and the <strong>{target.gate_name}</strong> gate
          is reopened with its checklist and documents as they were. It will need a new decision before the project can move forward again.
        </Text>
        <Text size="sm" c="dimmed">The move and your reason are recorded on the gate and in the project's history.</Text>
        <TextArea label="Reason" required rows={3} value={reason} onChange={setReason} error={error} />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={busy}>Move back a stage</Button>
        </div>
      </form>
    </Modal>
  );
}
