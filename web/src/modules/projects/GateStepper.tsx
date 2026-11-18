import { Fragment } from 'react';
import { formatDate, Icon } from '../../core';
import type { IconName } from '../../core';
import type { Gate, ProjectGates } from './types';

type GateState = 'todo' | 'approved' | 'blocked' | 'ready' | 'rejected';

export function gateState(gate: Gate | undefined): GateState {
  if (!gate) return 'todo';
  if (gate.status === 'approved') return 'approved';
  if (gate.status === 'rejected') return 'rejected';
  return gate.outstanding.length ? 'blocked' : 'ready';
}

function describe(gate: Gate | undefined, state: GateState): string {
  if (!gate || state === 'todo') return 'Not reached';
  if (state === 'approved') return `Approved${gate.decided_on ? ` ${formatDate(gate.decided_on)}` : ''}`;
  if (state === 'rejected') return 'Rejected';
  const deferred = gate.status === 'deferred' ? 'Deferred; ' : '';
  return state === 'ready' ? `${deferred}ready for a decision` : `${deferred}blocked: ${gate.outstanding.length} of ${gate.total} to do`;
}

const GATE_ICON: Record<GateState, IconName | null> = { todo: null, approved: 'check', blocked: 'lock', ready: 'check-square', rejected: 'x' };

/**
 * Stages with the gates between them. The current stage and its gate are highlighted; a gate
 * shows as blocked while checklist items are outstanding.
 */
export function GateStepper({ data, onGateClick }: { data: ProjectGates; onGateClick?: (gate: Gate) => void }) {
  const currentIndex = data.stages.findIndex((s) => s.value === data.stage);
  return (
    <ol className="prj-stepper" aria-label="Project stages and gates">
      {data.stages.map((stage, i) => {
        const stageState = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'todo';
        const def = data.definitions.find((d) => d.from_stage === stage.value);
        const gate = def && data.gates.find((g) => g.gate_key === def.key);
        const state = gateState(gate);
        const icon = GATE_ICON[state];
        const inner = def && (
          <>
            <span className="prj-gate-mark" aria-hidden="true">{icon && <Icon name={icon} size={12} />}</span>
            <span className="prj-gate-name">{def.name} gate</span>
            <span className="prj-gate-state">{describe(gate, state)}</span>
          </>
        );
        return (
          <Fragment key={stage.value}>
            <li
              className={`prj-stage prj-stage-${stageState}${i <= currentIndex ? ' prj-passed' : ''}`}
              aria-current={stageState === 'current' ? 'step' : undefined}
            >
              <span className="prj-stage-dot" aria-hidden="true">{stageState === 'done' ? <Icon name="check" size={16} /> : i + 1}</span>
              <span className="prj-stage-label">{stage.label}</span>
              <span className="sr-only">{stageState === 'done' ? ' (complete)' : stageState === 'current' ? ' (current stage)' : ' (not started)'}</span>
            </li>
            {def && (
              <li className={`prj-gate prj-gate-${state}${state === 'approved' ? ' prj-passed' : ''}`}>
                {gate && onGateClick
                  ? <button type="button" onClick={() => onGateClick(gate)}>{inner}</button>
                  : inner}
              </li>
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
