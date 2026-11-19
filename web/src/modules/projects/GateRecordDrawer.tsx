import { Divider, Group, Stack, Text, Title } from '@mantine/core';
import { Badge, Button, DefinitionList, Drawer, formatDate, Icon, lookupLabel, LookupChip } from '../../core';
import { documentState } from './GateDocuments';
import { ChangeLink, GateHistory } from './GateParts';
import { describeGate } from './GateStepper';
import type { Gate } from './types';

/** The record of one gate, opened from the stepper: its decision, checklist, documents and history. */
export function GateRecordDrawer({ gate, onClose, onWork }: { gate: Gate | null; onClose: () => void; onWork: (gate: Gate) => void }) {
  return (
    <Drawer open={Boolean(gate)} title={gate ? gate.name : 'Gate'} onClose={onClose} side="right" size="md">
      {gate && (
        <Stack gap="md">
          <Group gap="xs">
            <LookupChip list="project_gate_status" value={gate.status} />
            <Text size="sm" c="dimmed">
              {lookupLabel('project_stage', gate.from_stage)} <Icon name="arrow-right" size={13} /> {lookupLabel('project_stage', gate.to_stage)}
            </Text>
          </Group>
          <Text size="sm">{describeGate(gate)}. {gate.checked} of {gate.total} checklist items done.</Text>
          {gate.status === 'approved' && (
            <DefinitionList
              items={[
                { label: 'Approved by', value: [gate.decided_by_name, gate.decisions[0]?.approver_role].filter(Boolean).join(', ') || '—' },
                { label: 'Decision date', value: formatDate(gate.decided_on) },
              ]}
            />
          )}
          {gate.is_current && <Button variant="primary" icon="arrow-right" onClick={() => onWork(gate)}>Work this gate</Button>}

          <Divider />
          <Title order={3} size="h5">Checklist</Title>
          <ul className="prj-record-list">
            {gate.items.map((i) => (
              <li key={i.id}>
                <Icon name={i.checked ? 'check-circle' : 'minus'} size={16} label={i.checked ? 'Done' : 'Not done'} />
                <div>
                  <Text size="sm">{i.label}</Text>
                  {i.checked && <Text size="xs" c="dimmed">{i.checked_by_name ?? 'Unknown'}{i.checked_at ? `, ${formatDate(i.checked_at)}` : ''}</Text>}
                  {i.note && <Text size="xs" className="prose">{i.note}</Text>}
                  {i.evidence_ref && <Text size="xs" c="dimmed">Evidence: {i.evidence_ref}</Text>}
                </div>
              </li>
            ))}
          </ul>

          {gate.documents.length > 0 && (
            <>
              <Title order={3} size="h5">Documents</Title>
              <ul className="prj-record-list">
                {gate.documents.map((d) => {
                  const state = documentState(d);
                  return (
                    <li key={d.name}>
                      <Icon name="file-text" size={16} />
                      <div>
                        <Group gap={6}><Text size="sm">{d.name}</Text><Badge color={state.color}>{state.label}</Badge></Group>
                        {d.reference && <Text size="xs" c="dimmed">Filed: {d.reference}</Text>}
                        {d.waived && <Text size="xs" c="dimmed">Waived by {d.waived_by_name ?? 'an approver'}: {d.waive_reason}</Text>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {gate.change && (
            <>
              <Title order={3} size="h5">Change record</Title>
              <Text size="sm"><ChangeLink gate={gate} /></Text>
            </>
          )}

          <Title order={3} size="h5">Decisions</Title>
          <GateHistory decisions={gate.decisions} />
        </Stack>
      )}
    </Drawer>
  );
}
