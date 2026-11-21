import { Link } from 'react-router-dom';
import { List, Text, ThemeIcon, Timeline } from '@mantine/core';
import { EmptyState, formatDate, Icon, lookupLabel } from '../../core';
import type { ColorName, IconName } from '../../core';
import type { Blocker, Gate, GateDecision } from './types';

const DECISION: Record<string, { color: ColorName; icon: IconName; verb: string }> = {
  approved: { color: 'green', icon: 'check', verb: 'Approved by' },
  deferred: { color: 'amber', icon: 'clock', verb: 'Deferred by' },
  rejected: { color: 'red', icon: 'x', verb: 'Rejected by' },
  reopened: { color: 'purple', icon: 'refresh', verb: 'Reopened by' },
};

/** Every decision recorded on a gate, newest first, including a move back that reopened it. */
export function GateHistory({ decisions }: { decisions: GateDecision[] }) {
  if (!decisions.length) return <EmptyState icon="clipboard" title="No decision recorded yet" />;
  return (
    <Timeline bulletSize={26} lineWidth={2} active={-1}>
      {decisions.map((d) => {
        const meta = DECISION[d.decision] ?? { color: 'gray' as const, icon: 'info' as const, verb: `${lookupLabel('project_gate_status', d.decision)} by` };
        return (
          <Timeline.Item
            key={d.id}
            bullet={<ThemeIcon size={26} radius="xl" variant="light" color={meta.color}><Icon name={meta.icon} size={14} /></ThemeIcon>}
            title={<Text size="sm" fw={600}>{meta.verb} {d.approver_name}{d.approver_role ? `, ${d.approver_role}` : ''}</Text>}
          >
            <Text size="xs" c="dimmed">
              {formatDate(d.decided_on)}
              {d.reference ? ` · Reference: ${d.reference}` : ''}
              {d.recorded_by_name && d.recorded_by_name !== d.approver_name ? ` · Recorded by ${d.recorded_by_name}` : ''}
            </Text>
            {d.notes && <Text size="sm" className="prose" mt={4}>{d.notes}</Text>}
          </Timeline.Item>
        );
      })}
    </Timeline>
  );
}

const BLOCKER: Record<Blocker['kind'], { icon: IconName; lead: string }> = {
  status: { icon: 'alert-circle', lead: '' },
  checklist: { icon: 'check-square', lead: 'Checklist: ' },
  document: { icon: 'file-text', lead: 'Required document: ' },
};

/** Exactly what stands between a gate and its approval. */
export function BlockerList({ blockers }: { blockers: Blocker[] }) {
  return (
    <List spacing={4} size="sm" className="prj-blockers">
      {blockers.map((b) => (
        <List.Item key={`${b.kind}:${b.label}`} icon={<Icon name={BLOCKER[b.kind].icon} size={15} />}>
          <Text span c="dimmed" inherit>{BLOCKER[b.kind].lead}</Text>{b.label}
        </List.Item>
      ))}
    </List>
  );
}

/** The blockers counted by kind: "6 checklist items to do, 3 required documents missing". */
export function blockerSummary(gate: Gate): string {
  const count = (kind: Blocker['kind']) => gate.blockers.filter((b) => b.kind === kind).length;
  const items = count('checklist');
  const docs = count('document');
  return [
    count('status') ? 'the project is not active' : '',
    items ? `${items} checklist ${items === 1 ? 'item' : 'items'} to do` : '',
    docs ? `${docs} required ${docs === 1 ? 'document' : 'documents'} missing` : '',
  ].filter(Boolean).join(', ');
}

/** What to do about the blockers, in one sentence. */
export function blockerAdvice(gate: Gate): string {
  const kinds = new Set(gate.blockers.map((b) => b.kind));
  const steps: string[] = [];
  if (kinds.has('status')) steps.push('make the project active again');
  if (kinds.has('checklist')) steps.push('check the outstanding checklist items');
  if (kinds.has('document')) steps.push('mark each required document as received (or have an approver waive it)');
  return `To approve this gate, ${steps.join(', then ')}.`;
}

export function ChangeLink({ gate }: { gate: Gate }) {
  if (!gate.change) return null;
  const text = <>{gate.change.ref && <span className="ref">{gate.change.ref}</span>} {gate.change.label}</>;
  return gate.change.route ? <Link to={gate.change.route}>{text}</Link> : <span className="muted">{text}</span>;
}
