import { useEffect, useState } from 'react';
import {
  api, Button, Card, Checkbox, DefinitionList, EmptyState, errorMessage, ErrorState, formatDate, Icon, Loading, lookupLabel,
  LookupChip, Select, useAuth, useLookup, useToast,
} from '../../core';
import { GateChecklist } from './GateChecklist';
import { GateDecisionDialog } from './GateDecisionDialog';
import { useGates } from './gatesContext';
import type { Gate, GateDocument } from './types';

function Documents({ projectId, gate, editable, onChanged }: { projectId: string; gate: Gate; editable: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const save = async (index: number, patch: Partial<GateDocument>) => {
    setBusy(true);
    try {
      await api.patch(`/api/projects/${projectId}/gates/${gate.id}/documents/${index}`, patch);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (!gate.documents.length) return <p className="muted">No documents are required at this gate.</p>;
  return (
    <ul className="prj-doclist">
      {gate.documents.map((doc, i) => (
        <li key={doc.name} className="prj-doc">
          <Checkbox
            label={doc.name}
            hint={doc.reference ? `Reference: ${doc.reference}` : undefined}
            checked={doc.received}
            disabled={!editable || busy}
            onChange={(received) => save(i, { received })}
          />
          {editable && (
            <input
              className="input"
              aria-label={`Reference for ${doc.name}`}
              placeholder="Where it is filed"
              defaultValue={doc.reference}
              onBlur={(e) => { if (e.target.value.trim() !== doc.reference) void save(i, { reference: e.target.value.trim() }); }}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** The Gate tab: checklist, required documents, approvers by tier, decisions and "Record decision". */
export function GateTab({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const { data, error, reload } = useGates();
  const tiers = useLookup('project_tier');
  const [selected, setSelected] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  // Follow the current gate when the project moves on.
  useEffect(() => { setSelected(null); }, [data?.current_gate_id]);

  if (error) return <ErrorState title="The gates could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  if (!data.gates.length) {
    return <EmptyState icon="check-square" title="No gates yet" message="A gate opens when the project reaches a stage that has one." />;
  }

  const gate = data.gates.find((g) => g.id === (selected ?? data.current_gate_id)) ?? data.gates[data.gates.length - 1];
  const open = gate.status !== 'approved';
  const editable = open && can('projects.edit');
  const refresh = () => { reload(); onChanged(); };
  const stageLabel = (v: string) => lookupLabel('project_stage', v);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ minWidth: 260 }}>
          <Select
            label="Gate"
            value={gate.id}
            onChange={(id) => setSelected(id || null)}
            options={data.gates.map((g) => ({
              value: g.id,
              label: `${g.name} (${stageLabel(g.from_stage)} to ${stageLabel(g.to_stage)})${g.is_current ? ', current' : ''}`,
            }))}
          />
        </div>
        <div className="row">
          <LookupChip list="project_gate_status" value={gate.status} />
          {gate.is_current && can('projects.approve') && (
            <Button variant="primary" icon="check-square" onClick={() => setDeciding(true)}>Record decision</Button>
          )}
        </div>
      </div>

      {gate.is_current && data.status !== 'active' && (
        <div className="prj-banner" role="status">
          <Icon name="info" />
          <p>This project is {lookupLabel('project_status', data.status).toLowerCase()}. Make it active again before recording a gate decision.</p>
        </div>
      )}
      {gate.is_current && data.status === 'active' && (gate.outstanding.length > 0 ? (
        <div className="prj-banner" role="status">
          <Icon name="lock" />
          <p>
            <strong>Approval is blocked.</strong> {gate.outstanding.length} checklist {gate.outstanding.length === 1 ? 'item is' : 'items are'} still
            to do. The project stays in {stageLabel(gate.from_stage)} until every item is ticked and the gate is approved.
          </p>
        </div>
      ) : (
        <div className="prj-banner prj-banner-blue" role="status">
          <Icon name="check-square" />
          <p><strong>Ready for a decision.</strong> Every checklist item is ticked. Record the approval to move the project to {stageLabel(gate.to_stage)}.</p>
        </div>
      ))}

      <Card title="Checklist">
        <GateChecklist projectId={projectId} gate={gate} editable={editable} onChanged={refresh} />
      </Card>

      <div className="grid-2">
        <Card title="Required documents">
          <Documents projectId={projectId} gate={gate} editable={editable} onChanged={refresh} />
        </Card>
        <Card title={`Approvers${data.tier ? ` for ${lookupLabel('project_tier', data.tier)}` : ''}`}>
          {gate.approvers_for_tier.length
            ? <ul className="prj-plainlist">{gate.approvers_for_tier.map((a) => <li key={a}>{a}</li>)}</ul>
            : <p className="muted">No approvers are set for this tier.</p>}
          <details style={{ marginTop: 'var(--s-3)' }}>
            <summary>Approvers for every tier</summary>
            <DefinitionList items={tiers.map((t) => ({ label: t.label, value: (gate.approvers[t.value] ?? []).join(', ') || '—' }))} />
          </details>
        </Card>
      </div>

      <Card title="Decisions" flush>
        {gate.decisions.length === 0 ? (
          <EmptyState icon="clipboard" title="No decision recorded yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Date</th><th scope="col">Decision</th><th scope="col">Approver</th>
                  <th scope="col">Reference</th><th scope="col">Notes</th><th scope="col">Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {gate.decisions.map((d) => (
                  <tr key={d.id}>
                    <td>{formatDate(d.decided_on)}</td>
                    <td><LookupChip list="project_gate_status" value={d.decision} /></td>
                    <td>{d.approver_name}{d.approver_role ? `, ${d.approver_role}` : ''}</td>
                    <td>{d.reference || '—'}</td>
                    <td className="prose">{d.notes || '—'}</td>
                    <td>{d.recorded_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <GateDecisionDialog open={deciding} projectId={projectId} gate={gate} onClose={() => setDeciding(false)} onDecided={refresh} />
    </div>
  );
}
