import { useState } from 'react';
import {
  api, Button, Card, errorMessage, ErrorState, IconButton, Loading, lookupLabel, Modal, Select, Switch, TextArea, TextField, useFetch, useLookup, useToast,
} from '../../core';
import type { GateDefinition } from './types';

const toLines = (list: string[] | undefined) => (list ?? []).join('\n');
const fromLines = (text: string) => text.split('\n').map((s) => s.trim()).filter(Boolean);

/** E11-25: the approval workflows (kind "project gate decision") a gate template may name. */
interface GateWorkflow { id: string; name: string; description: string | null }

function GateEditor({ gate, workflows, onClose, onSaved }: { gate: GateDefinition; workflows: GateWorkflow[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [workflowId, setWorkflowId] = useState(gate.approval_workflow_id ?? '');
  const tiers = useLookup('project_tier');
  const [name, setName] = useState(gate.name);
  const [checklist, setChecklist] = useState(toLines(gate.checklist));
  const [documents, setDocuments] = useState(() => gate.required_documents.map((d) => ({ ...d })));
  const [wantsChange, setWantsChange] = useState(gate.wants_change);
  const setDoc = (i: number, patch: Partial<{ name: string; required: boolean }>) =>
    setDocuments((list) => list.map((d, n) => (n === i ? { ...d, ...patch } : d)));
  const [approvers, setApprovers] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(gate.approvers ?? {}).map(([tier, list]) => [tier, toLines(list)])),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/projects/gate-definitions/${gate.key}`, {
        name,
        checklist: fromLines(checklist),
        required_documents: documents.filter((d) => d.name.trim()),
        wants_change: wantsChange,
        approval_workflow_id: workflowId || null,
        approvers: Object.fromEntries(tiers.map((t) => [t.value, fromLines(approvers[t.value] ?? '')])),
      });
      toast.success('Gate template saved. Gates opened from now on use it.');
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Edit gate: ${gate.name}`} onClose={onClose} size="lg">
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted">
          Changes apply to gates opened from now on. Gates already open on a project keep the checklist they started with.
        </p>
        <TextField label="Gate name" required value={name} onChange={setName} />
        <TextArea label="Checklist" hint="One item per line. Every item must be ticked before the gate can be approved." rows={8} value={checklist} onChange={setChecklist} />
        <fieldset className="prj-fieldset">
          <legend>Documents</legend>
          <p className="muted">A required document blocks approval until it is received or an approver waives it. An optional one is only a reminder.</p>
          {documents.map((d, i) => (
            <div key={i} className="prj-docrow">
              <TextField label={`Document ${i + 1}`} hideLabel placeholder="Name of the document" value={d.name} onChange={(name) => setDoc(i, { name })} />
              <Switch label="Required" checked={d.required} onChange={(required) => setDoc(i, { required })} />
              <IconButton icon="trash" variant="ghost" label={`Remove ${d.name || 'document'}`} onClick={() => setDocuments((list) => list.filter((_, n) => n !== i))} />
            </div>
          ))}
          <div><Button size="sm" icon="plus" onClick={() => setDocuments((list) => [...list, { name: '', required: true }])}>Add document</Button></div>
        </fieldset>
        <Switch
          label="Ask for a change record at this gate"
          hint="Shows a place on the gate to link the change that carries it. Only where change records are in use."
          checked={wantsChange}
          onChange={setWantsChange}
        />
        <Select
          label="Approval workflow"
          hint="With a workflow, someone who may edit the project asks for approval once the checklist and required documents are complete, and the approval passes the gate. Decisions given elsewhere can always be recorded by hand. Workflows are set up under Administration > Approval workflows."
          value={workflowId}
          onChange={(v) => setWorkflowId(v ?? '')}
          options={[{ value: '', label: 'None: decisions are recorded by hand' }, ...workflows.map((w) => ({ value: w.id, label: w.name }))]}
        />
        <div className="form-grid">
          {tiers.map((t) => (
            <TextArea
              key={t.value}
              label={`Approvers for ${t.label}`}
              hint="One role per line"
              rows={3}
              value={approvers[t.value] ?? ''}
              onChange={(v) => setApprovers((a) => ({ ...a, [t.value]: v }))}
            />
          ))}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Save gate</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Gate templates: the checklist, required documents and approvers by tier for each gate. */
export function GateTemplates() {
  const { data, error, reload } = useFetch<GateDefinition[]>('/api/projects/gate-definitions');
  const workflows = useFetch<{ rows: GateWorkflow[] }>('/api/projects/gate-workflows').data?.rows ?? [];
  const workflowName = (id: string | null) => workflows.find((w) => w.id === id)?.name ?? null;
  const [editing, setEditing] = useState<GateDefinition | null>(null);

  return (
    <Card title="Gates" flush>
      {error ? <ErrorState title="The gate templates could not be loaded" error={error} onRetry={reload} /> : !data ? <Loading /> : (
        <div className="table-wrap prj-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Gate</th><th scope="col">Between</th><th scope="col">Checklist</th>
                <th scope="col">Documents</th><th scope="col">Approval</th><th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.map((g) => (
                <tr key={g.key}>
                  <td className="row-title">{g.name}</td>
                  <td>{lookupLabel('project_stage', g.from_stage)} and {lookupLabel('project_stage', g.to_stage)}</td>
                  <td>{g.checklist.length} {g.checklist.length === 1 ? 'item' : 'items'}</td>
                  <td>
                    {g.required_documents.length === 0 ? 'None' : `${g.required_documents.filter((d) => d.required).length} required`}
                    {g.required_documents.some((d) => !d.required) ? `, ${g.required_documents.filter((d) => !d.required).length} optional` : ''}
                  </td>
                  <td>{workflowName(g.approval_workflow_id) ?? 'Recorded by hand'}</td>
                  <td><Button size="sm" icon="edit" onClick={() => setEditing(g)}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <GateEditor key={editing.key} gate={editing} workflows={workflows} onClose={() => setEditing(null)} onSaved={reload} />}
    </Card>
  );
}
