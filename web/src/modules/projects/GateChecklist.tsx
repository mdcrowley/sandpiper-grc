import { useState } from 'react';
import { api, Button, Checkbox, errorMessage, formatDateTime, ProgressBar, TextField, useToast } from '../../core';
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
    <li className="prj-check">
      <div>
        <Checkbox label={item.label} checked={item.checked} disabled={!editable || busy} onChange={(checked) => save({ checked })} />
        {item.checked && (
          <p className="prj-check-meta">
            Ticked by {item.checked_by_name ?? 'unknown'}{item.checked_at ? ` on ${formatDateTime(item.checked_at)}` : ''}
          </p>
        )}
        {!editing && item.note && <p className="prj-check-note">{item.note}</p>}
        {!editing && item.evidence_ref && <p className="prj-check-meta">Evidence: {item.evidence_ref}</p>}
      </div>
      {editable && !editing && (
        <Button
          size="sm"
          variant="ghost"
          icon="edit"
          onClick={() => { setNote(item.note ?? ''); setEvidence(item.evidence_ref ?? ''); setEditing(true); }}
        >
          {item.note || item.evidence_ref ? 'Edit note' : 'Add note'}
        </Button>
      )}
      {editing && (
        <div className="prj-check-edit">
          <TextField label={`Note for: ${item.label}`} value={note} onChange={setNote} autoFocus />
          <TextField label="Evidence reference" value={evidence} onChange={setEvidence} placeholder="Document or ticket number" />
          <div className="row">
            <Button size="sm" variant="primary" loading={busy} onClick={() => save({ note, evidence_ref: evidence })}>Save</Button>
            <Button size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** The gate's checklist: tick items, and add a note and an evidence reference to each. */
export function GateChecklist(props: Props) {
  const { gate } = props;
  if (!gate.items.length) return <p className="muted">This gate has no checklist items.</p>;
  return (
    <div className="stack">
      <ProgressBar
        label="Checklist complete"
        value={gate.checked}
        max={gate.total}
        color={gate.checked === gate.total ? 'green' : 'blue'}
        valueText={`${gate.checked} of ${gate.total}`}
      />
      <ul className="prj-checklist">
        {gate.items.map((item) => <Row key={item.id} {...props} item={item} />)}
      </ul>
    </div>
  );
}
