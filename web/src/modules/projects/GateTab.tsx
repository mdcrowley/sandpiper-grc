import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import {
  api, Button, Card, DefinitionList, EmptyState, errorMessage, ErrorState, Icon, Loading, lookupLabel, LookupChip, RecordPicker,
  Select, useAuth, useLookup, useToast,
} from '../../core';
import { GateChecklist } from './GateChecklist';
import { GateDecisionDialog } from './GateDecisionDialog';
import { GateDocuments } from './GateDocuments';
import { BlockerList, blockerAdvice, blockerSummary, ChangeLink, GateHistory } from './GateParts';
import { useGates } from './gatesContext';
import type { Gate } from './types';

/** The change record that carries a gate (for example the go-live change), when change records exist. */
function ChangeCard({ projectId, gate, editable, onChanged }: { projectId: string; gate: Gate; editable: boolean; onChanged: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [picking, setPicking] = useState(false);
  const set = async (id: string | null) => {
    try {
      await api.patch(`/api/projects/${projectId}/gates/${gate.id}`, { change_id: id });
      setPicking(false);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const mayPick = editable && can('changes.view');
  return (
    <Card title="Change record">
      {gate.change ? (
        <Group justify="space-between" gap="xs">
          <Text size="sm"><ChangeLink gate={gate} /></Text>
          {mayPick && <Button size="sm" variant="ghost" icon="x" onClick={() => set(null)}>Unlink</Button>}
        </Group>
      ) : picking ? (
        <RecordPicker label="Change record" type="change" value={null} onChange={(id) => { if (id) void set(id); }} placeholder="Search change records" />
      ) : (
        <Stack gap="xs" align="flex-start">
          <Text size="sm" c="dimmed">Link the change that carries this gate, so the approval and the change can be read together.</Text>
          {mayPick && <Button size="sm" icon="link" onClick={() => setPicking(true)}>Link a change record</Button>}
        </Stack>
      )}
    </Card>
  );
}

/** The Gate tab: what blocks approval, the checklist, documents, approvers and the decisions so far. */
export function GateTab({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const { data, error, reload } = useGates();
  const tiers = useLookup('project_tier');
  const [search, setSearch] = useSearchParams();
  const [deciding, setDeciding] = useState(false);
  const selected = search.get('gate');

  // "Move to the next stage" on the portfolio board lands here with the dialog open.
  useEffect(() => {
    if (search.get('decide') !== '1' || !data) return;
    const next = new URLSearchParams(search);
    next.delete('decide');
    setSearch(next, { replace: true });
    if (data.current_gate_id && can('projects.approve')) setDeciding(true);
  }, [data, search]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorState title="The gates could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  if (!data.gates.length) {
    return <EmptyState icon="check-square" title="No gates yet" message="A gate opens when the project reaches a stage that has one." />;
  }

  const gate = data.gates.find((g) => g.id === selected) ?? data.gates.find((g) => g.id === data.current_gate_id) ?? data.gates[data.gates.length - 1];
  const open = gate.status !== 'approved';
  const editable = open && can('projects.edit');
  const refresh = () => { reload(); onChanged(); };
  const stageLabel = (v: string) => lookupLabel('project_stage', v);
  const pickGate = (id: string) => {
    const next = new URLSearchParams(search);
    if (id && id !== data.current_gate_id) next.set('gate', id); else next.delete('gate');
    setSearch(next, { replace: true });
  };

  return (
    <div className="stack">
      <Group justify="space-between" align="flex-end" gap="sm">
        <div style={{ minWidth: 260, flex: '0 1 420px' }}>
          <Select
            label="Gate"
            required
            value={gate.id}
            onChange={pickGate}
            options={data.gates.map((g) => ({
              value: g.id,
              label: `${g.name} (${stageLabel(g.from_stage)} to ${stageLabel(g.to_stage)})${g.is_current ? ', current' : ''}`,
            }))}
          />
        </div>
        <Group gap="xs">
          <LookupChip list="project_gate_status" value={gate.status} />
          {gate.is_current && can('projects.approve') && (
            <Button variant="primary" icon="check-square" onClick={() => setDeciding(true)}>Record decision</Button>
          )}
        </Group>
      </Group>

      {gate.is_current && (gate.blockers.length > 0 ? (
        <Alert color="amber" variant="light" icon={<Icon name="lock" />} title={`Approval is blocked: ${blockerSummary(gate)}`}>
          {gate.blockers.length <= 3 && <BlockerList blockers={gate.blockers} />}
          <Text size="sm" mt={gate.blockers.length <= 3 ? 'xs' : 0}>{blockerAdvice(gate)} The project stays in {stageLabel(gate.from_stage)} until then.</Text>
        </Alert>
      ) : (
        <Alert color="green" variant="light" icon={<Icon name="check-circle" />} title="Ready for a decision">
          Every checklist item is ticked and the required documents are in place. Record the approval to move the project to {stageLabel(gate.to_stage)}.
        </Alert>
      ))}
      {!gate.is_current && open && (
        <Alert color="gray" variant="light" icon={<Icon name="info" />}>
          This gate is not the project's current gate. It comes into play when the project reaches {stageLabel(gate.from_stage)} again.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" className="prj-gate-grid">
        <Card title="Checklist">
          <GateChecklist projectId={projectId} gate={gate} editable={editable} onChanged={refresh} />
        </Card>
        <Stack gap="md">
          <Card title="Required documents">
            <GateDocuments projectId={projectId} gate={gate} editable={editable} onChanged={refresh} />
          </Card>
          {gate.change_available && <ChangeCard projectId={projectId} gate={gate} editable={editable} onChanged={refresh} />}
          <Card title={`Approvers${data.tier ? ` for ${lookupLabel('project_tier', data.tier)}` : ''}`}>
            {gate.approvers_for_tier.length
              ? <ul className="prj-plainlist">{gate.approvers_for_tier.map((a) => <li key={a}><Icon name="user" size={14} /> {a}</li>)}</ul>
              : <Text size="sm" c="dimmed">No approvers are set for this tier.</Text>}
            <details className="prj-details">
              <summary>Approvers for every tier</summary>
              <DefinitionList items={tiers.map((t) => ({ label: t.label, value: (gate.approvers[t.value] ?? []).join(', ') || '—' }))} />
            </details>
          </Card>
        </Stack>
      </SimpleGrid>

      <Card title="Decisions">
        <GateHistory decisions={gate.decisions} />
      </Card>

      <GateDecisionDialog open={deciding} projectId={projectId} gate={gate} onClose={() => setDeciding(false)} onDecided={refresh} />
    </div>
  );
}
