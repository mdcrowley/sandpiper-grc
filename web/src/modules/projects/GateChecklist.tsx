import { useState } from 'react';
import { Group, Progress, Text } from '@mantine/core';
import { api, Button, Checkbox, errorMessage, formatDateTime, Icon, TextField, useToast } from '../../core';
import type { ChecklistItem, Gate } from './types';

interface Props {
  projectId: string;
  gate: Gate;
  /** False for viewers and once the gate is approved. */
  editable: boolean;
  onChanged: () => void;
}

function Row({ projectId, gate, item, editable, onChanged }: Props & { item: ChecklistItem }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(item.note ?? '');
  const [evidence, setEvidence] = useState(item.evidence_ref ?? '');

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    try {
      await api.patch(`/api/projects/${projectId}/gates/${gate.id}/items/${item.id}`, patch);
      setEditing(false);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`prj-check${item.checked ? ' prj-check-done' : ''}`}>
      <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          {editable
            ? <Checkbox label={item.label} checked={item.checked} disabled={busy} onChange={(checked) => save({ checked })} />
            : (
              <Text size="sm" className="prj-check-static">
                <Icon name={item.checked ? 'check-circle' : 'minus'} size={16} label={item.checked ? 'Done' : 'Not done'} /> {item.label}
              </Text>
            )}
          <div className="prj-check-more">
            {item.checked && (
              <Text size="xs" c="dimmed">
                Checked by {item.checked_by_name ?? 'unknown'}{item.checked_at ? ` on ${formatDateTime(item.checked_at)}` : ''}
              </Text>
            )}
            {!editing && item.note && <Text size="sm" className="prose">{item.note}</Text>}
            {!editing && item.evidence_ref && <Text size="xs" c="dimmed"><Icon name="link" size={12} /> Evidence: {item.evidence_ref}</Text>}
          </div>
        </div>
        {editable && !editing && (
          <span style={{ flex: 'none' }}><Button
            size="sm"
            variant="ghost"
            icon={item.note || item.evidence_ref ? 'edit' : 'message'}
            onClick={() => { setNote(item.note ?? ''); setEvidence(item.evidence_ref ?? ''); setEditing(true); }}
          >
            {item.note || item.evidence_ref ? 'Edit note' : 'Add note'}
          </Button></span>
        )}
      </Group>
      {editing && (
        <div className="prj-check-edit">
          <TextField label={`Note for: ${item.label}`} value={note} onChange={setNote} autoFocus />
          <TextField label="Evidence reference" value={evidence} onChange={setEvidence} placeholder="Document or ticket number" />
          <Group gap="xs">
            <Button size="sm" variant="primary" loading={busy} onClick={() => save({ note, evidence_ref: evidence })}>Save</Button>
            <Button size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </Group>
        </div>
      )}
    </li>
  );
}

/** The gate's checklist: a progress bar, then each item to check, with a note and an evidence reference. */
export function GateChecklist(props: Props) {
  const { gate } = props;
  if (!gate.items.length) return <Text size="sm" c="dimmed">This gate has no checklist items.</Text>;
  const done = gate.checked === gate.total;
  return (
    <div>
      <Group justify="space-between" mb={6}>
        <Text size="sm" fw={500}>{done ? 'Every item is done' : `${gate.total - gate.checked} still to do`}</Text>
        <Text size="sm" c="dimmed" className="num">{gate.checked} of {gate.total}</Text>
      </Group>
      <Progress value={(gate.checked / gate.total) * 100} color={done ? 'green' : 'blue'} size="md" radius="xl" aria-label={`Checklist: ${gate.checked} of ${gate.total} done`} />
      <ul className="prj-checklist">
        {gate.items.map((item) => <Row key={item.id} {...props} item={item} />)}
      </ul>
    </div>
  );
}
