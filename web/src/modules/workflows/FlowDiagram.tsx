// The picture of a workflow: how it starts, each step in order (a dashed step applies only when its
// conditions hold), and the two ways it ends. Steps are buttons when `onSelect` is given.
import { Icon } from '../../core';
import type { Definition } from './data';
import { approverText, conditionsText, dueText, setsText, stepQuorumText, triggerText, type Labels } from './describe';

export interface FlowDiagramProps {
  def: Definition;
  labels: Labels;
  selected?: number | null;
  onSelect?: (index: number) => void;
  /** One line per step, for the list of workflows. */
  compact?: boolean;
}

export function FlowDiagram({ def, labels, selected, onSelect, compact }: FlowDiagramProps) {
  if (compact) {
    return (
      <ol className="wf-flow-compact" aria-label={`Steps of ${def.name || 'the workflow'}`}>
        {def.steps.map((s, i) => (
          <li key={i} className={s.conditions.length ? 'is-conditional' : undefined}>
            <span className="wf-flow-num" aria-hidden="true">{i + 1}</span>
            <span className="wf-flow-compact-text">
              <strong>{s.name || `Step ${i + 1}`}</strong>
              <span className="muted">{approverText(s.approvers, labels)}</span>
            </span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className="wf-flow" aria-label={`How ${def.name || 'the workflow'} runs`}>
      <li className="wf-flow-node wf-flow-start">
        <span className="wf-flow-icon" aria-hidden="true"><Icon name="arrow-right" size={16} /></span>
        <div>
          <div className="wf-flow-title">{triggerText(def, labels)}</div>
          {def.conditions.length > 0 && <div className="wf-flow-line">Only if {conditionsText(def.conditions, labels)}</div>}
        </div>
      </li>
      {def.steps.length === 0 && <li className="wf-flow-node wf-flow-empty"><span className="muted">Add a step to see it here.</span></li>}
      {def.steps.map((s, i) => {
        const due = dueText(s, labels);
        const inner = (
          <>
            <span className="wf-flow-num" aria-hidden="true">{i + 1}</span>
            <div className="wf-flow-body">
              <div className="wf-flow-title">{s.name || `Step ${i + 1}`}</div>
              <div className="wf-flow-line"><Icon name="users" size={14} /> {approverText(s.approvers, labels)}</div>
              <div className="wf-flow-line muted">{stepQuorumText(s)}</div>
              {s.conditions.length > 0 && <div className="wf-flow-line wf-flow-if">Only if {conditionsText(s.conditions, labels)}; otherwise skipped</div>}
              {due && <div className="wf-flow-line muted"><Icon name="clock" size={14} /> {due}</div>}
            </div>
          </>
        );
        const cls = `wf-flow-node wf-flow-step${s.conditions.length ? ' is-conditional' : ''}${selected === i ? ' is-selected' : ''}`;
        return (
          <li key={i} className={cls}>
            {onSelect
              ? <button type="button" className="wf-flow-button" onClick={() => onSelect(i)}><span className="sr-only">Edit step {i + 1}: </span>{inner}</button>
              : <div className="wf-flow-button">{inner}</div>}
          </li>
        );
      })}
      <li className="wf-flow-ends">
        <div className="wf-flow-end is-approved">
          <span className="wf-flow-icon" aria-hidden="true"><Icon name="check" size={16} /></span>
          <div>
            <div className="wf-flow-title">Approved</div>
            <div className="wf-flow-line">{def.on_approve.length ? `Sets ${setsText(def.on_approve, labels)}` : 'Changes nothing on the record'}</div>
          </div>
        </div>
        <div className="wf-flow-end is-rejected">
          <span className="wf-flow-icon" aria-hidden="true"><Icon name="x" size={16} /></span>
          <div>
            <div className="wf-flow-title">Rejected</div>
            <div className="wf-flow-line">Any rejection ends it. {def.on_reject.length ? `Sets ${setsText(def.on_reject, labels)}` : 'Changes nothing on the record'}</div>
          </div>
        </div>
      </li>
    </ol>
  );
}
