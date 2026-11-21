// The picture of a workflow: how it starts, each step in order (a dashed step applies only when its
// conditions hold), branches that run side by side drawn next to each other, the routes a step may
// take by condition, and the two ways it ends. Steps are buttons when `onSelect` is given.
import { Icon } from '../../core';
import { isGroup, type Definition, type StepDef } from './data';
import { approverText, conditionsText, dueText, routeText, setsText, stepQuorumText, triggerText, type Labels } from './describe';

export interface FlowDiagramProps {
  def: Definition;
  labels: Labels;
  selected?: number | null;
  onSelect?: (index: number) => void;
  /** One line per step, for the list of workflows. */
  compact?: boolean;
}

/** Who approves a step, in one line (a step side by side names its branches). */
const whoLine = (s: StepDef, labels: Labels) => (isGroup(s)
  ? `Side by side: ${s.branches!.map((b) => b.name || 'a branch').join(' and ')}`
  : approverText(s.approvers, labels));

function Routes({ step, def, labels }: { step: StepDef; def: Definition; labels: Labels }) {
  if (!step.routes?.length) return null;
  return (
    <ul className="wf-flow-routes" aria-label="Routes after this step">
      {step.routes.map((r, k) => (
        <li key={k} className="wf-flow-line wf-flow-route"><Icon name="arrow-right" size={14} /> {routeText(r, def.steps, labels)}</li>
      ))}
      <li className="wf-flow-line muted">Otherwise, the next step</li>
    </ul>
  );
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
              <span className="muted">{whoLine(s, labels)}{s.routes?.length ? ' · has routes' : ''}</span>
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
        const group = isGroup(s);
        const due = group ? null : dueText(s, labels);
        const inner = (
          <>
            <span className="wf-flow-num" aria-hidden="true">{i + 1}</span>
            <div className="wf-flow-body">
              <div className="wf-flow-title">{s.name || `Step ${i + 1}`}</div>
              {group ? (
                <>
                  <div className="wf-flow-line muted">These run side by side; all must approve, and any rejection rejects.</div>
                  <ul className="wf-flow-branches" aria-label={`Branches of ${s.name || `step ${i + 1}`}`}>
                    {s.branches!.map((b, j) => {
                      const bdue = dueText(b, labels);
                      return (
                        <li key={j} className={`wf-flow-branch${b.conditions.length ? ' is-conditional' : ''}`}>
                          <div className="wf-flow-title">{b.name || `Branch ${j + 1}`}</div>
                          <div className="wf-flow-line"><Icon name="users" size={14} /> {approverText(b.approvers, labels)}</div>
                          <div className="wf-flow-line muted">{stepQuorumText(b)}</div>
                          {b.conditions.length > 0 && <div className="wf-flow-line wf-flow-if">Only if {conditionsText(b.conditions, labels)}</div>}
                          {bdue && <div className="wf-flow-line muted"><Icon name="clock" size={14} /> {bdue}</div>}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <>
                  <div className="wf-flow-line"><Icon name="users" size={14} /> {approverText(s.approvers, labels)}</div>
                  <div className="wf-flow-line muted">{stepQuorumText(s)}</div>
                </>
              )}
              {s.conditions.length > 0 && <div className="wf-flow-line wf-flow-if">Only if {conditionsText(s.conditions, labels)}; otherwise skipped</div>}
              {due && <div className="wf-flow-line muted"><Icon name="clock" size={14} /> {due}</div>}
              <Routes step={s} def={def} labels={labels} />
            </div>
          </>
        );
        const cls = `wf-flow-node wf-flow-step${s.conditions.length ? ' is-conditional' : ''}${group ? ' is-group' : ''}${selected === i ? ' is-selected' : ''}`;
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
