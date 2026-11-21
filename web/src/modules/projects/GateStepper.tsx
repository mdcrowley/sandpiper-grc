import { Fragment } from 'react';
import { Tooltip, UnstyledButton } from '@mantine/core';
import { formatDate, Icon } from '../../core';
import type { IconName } from '../../core';
import type { Gate, ProjectGates } from './types';

export type GateState = 'todo' | 'approved' | 'blocked' | 'ready' | 'rejected';

export function gateState(gate: Gate | undefined): GateState {
  if (!gate) return 'todo';
  if (gate.status === 'approved') return 'approved';
  if (gate.status === 'rejected') return 'rejected';
  if (!gate.is_current) return 'todo';
  return gate.blockers.length ? 'blocked' : 'ready';
}

/** One line for the state of a gate, as shown under its name. */
export function describeGate(gate: Gate | undefined, state: GateState = gateState(gate)): string {
  if (!gate || state === 'todo') return gate ? 'Waiting for an earlier gate' : 'Not reached';
  if (state === 'approved') return `Approved${gate.decided_on ? ` ${formatDate(gate.decided_on)}` : ''}`;
  if (state === 'rejected') return 'Rejected';
  const deferred = gate.status === 'deferred' ? 'Deferred · ' : '';
  if (state === 'ready' && gate.approval?.running) return 'Waiting for approval';
  return state === 'ready' ? `${deferred}Ready for a decision` : `${deferred}Blocked: ${gate.blockers.length} to do`;
}

const GATE_ICON: Record<GateState, IconName> = { todo: 'minus', approved: 'check', blocked: 'lock', ready: 'check-square', rejected: 'x' };

/**
 * The stages of a project with the gates between them. Finished stages are checked, the current
 * stage and its gate are highlighted, and each gate says whether it is approved, blocked or ready.
 * Selecting a gate that has been opened shows its record.
 */
export function GateStepper({ data, onGateClick }: { data: ProjectGates; onGateClick?: (gate: Gate) => void }) {
  const currentIndex = data.stages.findIndex((s) => s.value === data.stage);
  return (
    <div className="prj-stepper-wrap">
      <ol className="prj-stepper" aria-label="Project stages and gates">
        {data.stages.map((stage, i) => {
          const stageState = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'todo';
          const def = data.definitions.find((d) => d.from_stage === stage.value);
          const gate = def && data.gates.find((g) => g.gate_key === def.key);
          const state = gateState(gate);
          const text = describeGate(gate, state);
          const body = def && (
            <>
              <span className="prj-gate-mark" aria-hidden="true"><Icon name={GATE_ICON[state]} size={13} /></span>
              <span className="prj-gate-name">{def.name}</span>
              <span className="sr-only"> gate: </span>
              <span className="prj-gate-state">{text}</span>
            </>
          );
          return (
            <Fragment key={stage.value}>
              <li className={`prj-stage prj-stage-${stageState}`} aria-current={stageState === 'current' ? 'step' : undefined}>
                <span className="prj-stage-dot" aria-hidden="true">{stageState === 'done' ? <Icon name="check" size={16} /> : i + 1}</span>
                <span className="prj-stage-label">{stage.label}</span>
                <span className="sr-only">{stageState === 'done' ? ' (complete)' : stageState === 'current' ? ' (current stage)' : ' (not started)'}</span>
              </li>
              {def && (
                <li className={`prj-gate prj-gate-${state}${gate?.is_current ? ' prj-gate-current' : ''}`}>
                  {gate && onGateClick ? (
                    <Tooltip label="Show this gate's record" openDelay={400}>
                      {/* Named by what it shows, so speech users can say it: "Intake approval gate: Approved ...". */}
                      <UnstyledButton className="prj-gate-btn" onClick={() => onGateClick(gate)}>
                        {body}
                        <span className="sr-only">. Show this gate's record.</span>
                      </UnstyledButton>
                    </Tooltip>
                  ) : <span className="prj-gate-btn">{body}</span>}
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
