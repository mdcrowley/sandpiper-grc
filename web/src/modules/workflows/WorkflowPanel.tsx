// The approval panel on a record page (E14-06). RecordPage finds this file at build time and shows
// it under the header; it renders nothing unless a workflow has run on the record or one may be
// started by the person looking. Approvers (and their stand-ins, E14-32) decide here; the requester
// (or an administrator) cancels; an administrator hands a waiting step to someone else. Module pages
// that have their own approval card (a change, a risk, a project gate) show this panel inside it.
import { useEffect, useRef, useState } from 'react';
import {
  api, ApiError, Button, ConfirmDialog, Countdown, errorMessage, formatDateTime, Icon, Menu, Modal, relativeTime,
  Select, StatusChip, Stepper, TextArea, useFetch, UserPicker, useToast, type Step,
} from '../../core';
import { DecisionDialog, type DecisionTarget } from './DecisionDialog';
import { plural, STATUS_LOOK, type Instance, type InstanceStep, type RecordWorkflows } from './data';
import './workflows.css';

export interface WorkflowPanelProps {
  recordType: string;
  recordId: string;
  /** Changes when the record changes (its updated time): a change may have started a workflow. */
  version?: string;
  /** Told after a decision, start or cancel, so the page can reload the record (an outcome may change it). */
  onChange?: () => void;
}

/** A step as the shared Stepper shows it. */
export function stepperStep(s: InstanceStep): Step {
  const approvals = s.decisions.filter((d) => d.decision === 'approved').length;
  switch (s.status) {
    case 'approved': return { key: String(s.position), label: s.name, state: 'done', hint: 'Approved' };
    case 'rejected': return { key: String(s.position), label: s.name, state: 'blocked', hint: 'Rejected' };
    case 'pending': return { key: String(s.position), label: s.name, state: 'current', hint: s.required ? `${approvals} of ${s.required} approved` : 'Waiting' };
    case 'skipped': return { key: String(s.position), label: s.name, state: 'todo', hint: 'Skipped: did not apply' };
    case 'canceled': return { key: String(s.position), label: s.name, state: 'todo', hint: 'Stopped' };
    default: return { key: String(s.position), label: s.name, state: 'todo', hint: s.has_conditions ? 'Only if its conditions hold' : 'Not reached yet' };
  }
}

function Decisions({ instance }: { instance: Instance }) {
  const all = instance.steps.flatMap((s) => s.decisions.map((d) => ({ ...d, step: s.name })));
  if (!all.length) return null;
  return (
    <ul className="wf-decisions" aria-label="Decisions">
      {all.map((d) => (
        <li key={`${d.user_id}-${d.at}`} className={d.decision === 'approved' ? 'is-approved' : 'is-rejected'}>
          <Icon name={d.decision === 'approved' ? 'check-circle' : 'alert-circle'} size={16} />
          <span>
            <strong>{d.name}</strong>{d.on_behalf_of_name && <> on behalf of <strong>{d.on_behalf_of_name}</strong></>} {d.decision === 'approved' ? 'approved' : 'rejected'} <em>{d.step}</em>
            {d.adopted && <span className="muted"> (recorded before approvals moved to workflows)</span>}
            <span className="muted" title={formatDateTime(d.at)}> {relativeTime(d.at)}</span>
            {d.comment && <span className="wf-decision-comment">“{d.comment}”</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Running({ instance, onDecide, onCancel, onReassign }: {
  instance: Instance; onDecide: (step: InstanceStep, decision: 'approved' | 'rejected') => void; onCancel: () => void; onReassign: (step: InstanceStep) => void;
}) {
  const current = instance.steps.find((s) => s.status === 'pending');
  // An approver counts as decided when they, or a stand-in for them, decided.
  const decided = new Set(current?.decisions.flatMap((d) => [d.user_id, ...(d.on_behalf_of_name ? current.approvers.filter((a) => a.name === d.on_behalf_of_name).map((a) => a.id) : [])]) ?? []);
  return (
    <div className="wf-instance">
      <div className="wf-instance-head">
        <div className="wf-instance-title">
          <Icon name="check-square" size={18} />
          <span>{instance.workflow}</span>
          <StatusChip color="blue" label={STATUS_LOOK.running.label} size="sm" />
        </div>
        <span className="wf-your-turn-buttons">
          {instance.can_reassign && current && current.approvers.length > 0 && <Button size="sm" variant="ghost" onClick={() => onReassign(current)}>Reassign</Button>}
          {instance.can_cancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel request</Button>}
        </span>
      </div>
      <p className="muted wf-meta">
        Asked {instance.requested_by_name ? `by ${instance.requested_by_name} ` : ''}<span title={formatDateTime(instance.started_at)}>{relativeTime(instance.started_at)}</span>
        {instance.note && <> · “{instance.note}”</>}
      </p>
      <Stepper size="sm" label={`Steps of ${instance.workflow}`} steps={instance.steps.map(stepperStep)} />
      {current && (
        <div className="wf-current">
          <div className="wf-current-who">
            <span className="wf-label">Waiting for</span>
            {current.approvers.length
              ? current.approvers.map((a) => (
                <span key={a.id} className={`wf-person${decided.has(a.id) ? ' is-done' : ''}`}>
                  {decided.has(a.id) && <Icon name="check" size={14} label="Approved" />}{a.name}
                </span>
              ))
              : <span className="muted">nobody yet</span>}
            {current.required && current.approvers.length > 1 && <span className="muted">({current.required === current.approvers.length ? 'everyone' : current.required === 1 ? 'any one' : `${current.required} of them`})</span>}
          </div>
          {current.standins?.length > 0 && (
            <div className="wf-current-who">
              <span className="wf-label">Stand-ins</span>
              {current.standins.map((s) => (
                <span key={s.id} className="wf-person is-standin">{s.name} <span className="muted">for {s.for.map((f) => f.name).join(', ')}</span></span>
              ))}
            </div>
          )}
          {current.due_at && <Countdown label="Due" deadline={current.due_at} start={instance.started_at} />}
          {current.escalated_at && <StatusChip color="amber" label="Escalated" size="sm" />}
        </div>
      )}
      {current?.note && <p className="notice notice-warn wf-note">{current.note}</p>}
      {current?.can_decide && (
        <div className="wf-your-turn" role="group" aria-label="Your decision">
          <span><Icon name="bell" size={16} /> Your decision is needed on <strong>{current.name}</strong>{current.on_behalf_of_name && <> (standing in for {current.on_behalf_of_name})</>}</span>
          <span className="wf-your-turn-buttons">
            <Button size="sm" variant="primary" icon="check" onClick={() => onDecide(current, 'approved')}>Approve</Button>
            <Button size="sm" variant="danger" icon="x" onClick={() => onDecide(current, 'rejected')}>Reject</Button>
          </span>
        </div>
      )}
      <Decisions instance={instance} />
    </div>
  );
}

function Earlier({ instances }: { instances: Instance[] }) {
  if (!instances.length) return null;
  return (
    <details className="wf-earlier">
      <summary>{plural(instances.length, 'earlier approval')}</summary>
      <ul>
        {instances.map((i) => (
          <li key={i.id}>
            <div className="wf-earlier-head">
              <StatusChip color={STATUS_LOOK[i.status].color} label={STATUS_LOOK[i.status].label} size="sm" />
              <strong>{i.workflow}</strong>
              <span className="muted" title={formatDateTime(i.finished_at ?? i.started_at)}>{relativeTime(i.finished_at ?? i.started_at)}</span>
            </div>
            {i.outcome_note && <p className="muted wf-meta">{i.outcome_note}</p>}
            {i.outcome_error && <p className="notice notice-warn wf-note">The fields this workflow sets could not be set: {i.outcome_error}</p>}
            <Decisions instance={i} />
          </li>
        ))}
      </ul>
    </details>
  );
}

export function WorkflowPanel({ recordType, recordId, version, onChange }: WorkflowPanelProps) {
  const toast = useToast();
  const { data, error, reload } = useFetch<RecordWorkflows>(`/api/workflows/records/${encodeURIComponent(recordType)}/${encodeURIComponent(recordId)}`);
  const [deciding, setDeciding] = useState<DecisionTarget | null>(null);
  const [starting, setStarting] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState('');
  const [canceling, setCanceling] = useState<Instance | null>(null);
  const [reassigning, setReassigning] = useState<InstanceStep | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef(version);
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    reload();
  }, [version, reload]);

  // No workflows module on the server, a record the person cannot see, or nothing to show: no panel.
  if (error || !data) return null;
  const running = data.instances.filter((i) => i.status === 'running');
  const finished = data.instances.filter((i) => i.status !== 'running');
  if (!running.length && !finished.length && !data.startable.length) return null;

  const changed = () => { reload(); onChange?.(); };

  async function start() {
    if (!starting) return;
    setBusy(true);
    try {
      await api.post(`/api/workflows/records/${encodeURIComponent(recordType)}/${encodeURIComponent(recordId)}/start`, { workflow_id: starting.id, note: note.trim() || null });
      toast.success(`Approval requested: ${starting.name}.`);
      setStarting(null);
      setNote('');
      changed();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!canceling) return;
    setBusy(true);
    try {
      await api.post(`/api/workflows/instances/${canceling.id}/cancel`, { reason: null });
      toast.success('The approval request was canceled.');
      setCanceling(null);
      changed();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reassign() {
    if (!reassigning || !from || !to) return;
    setBusy(true);
    try {
      await api.post(`/api/workflows/steps/${reassigning.id}/reassign`, { from_user_id: from, to_user_id: to });
      toast.success('The step was reassigned. The new approver has been told.');
      setReassigning(null);
      changed();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const askButton = data.startable.length > 0 && (
    data.startable.length === 1
      ? <Button size="sm" icon="check-square" onClick={() => setStarting(data.startable[0])}>Request approval: {data.startable[0].name}</Button>
      : <Menu label="Request approval" icon="check-square" size="sm" items={data.startable.map((w) => ({ label: w.name, onSelect: () => setStarting(w) }))} />
  );

  return (
    <section className="wf-panel" aria-label="Approvals">
      {running.map((i) => (
        <Running
          key={i.id}
          instance={i}
          onCancel={() => setCanceling(i)}
          onReassign={(step) => { setReassigning(step); setFrom(step.approvers[0]?.id ?? ''); setTo(null); }}
          onDecide={(step, decision) => setDeciding({ stepId: step.id!, decision, step: step.name, what: i.workflow })}
        />
      ))}
      {(askButton || finished.length > 0) && (
        <div className="wf-panel-foot">
          <Earlier instances={finished} />
          {askButton && <div className="wf-ask">{askButton}</div>}
        </div>
      )}
      <DecisionDialog target={deciding} onClose={() => setDeciding(null)} onDone={changed} />
      <Modal
        open={Boolean(starting)}
        size="sm"
        title={`Request approval: ${starting?.name ?? ''}`}
        onClose={() => setStarting(null)}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setStarting(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => void start()}>Send for approval</Button>
          </>
        )}
      >
        {data.startable.find((w) => w.id === starting?.id)?.description && <p className="muted">{data.startable.find((w) => w.id === starting?.id)?.description}</p>}
        <TextArea label="Note for the approvers (optional)" value={note} onChange={setNote} rows={3} />
      </Modal>
      <Modal
        open={Boolean(reassigning)}
        size="sm"
        title={`Reassign: ${reassigning?.name ?? ''}`}
        onClose={() => setReassigning(null)}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setReassigning(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!from || !to} onClick={() => void reassign()}>Reassign</Button>
          </>
        )}
      >
        <p className="muted">The step goes to the new person instead. It is recorded in the record's history, and they are told.</p>
        <Select label="Instead of" value={from} onChange={setFrom} options={(reassigning?.approvers ?? []).map((a) => ({ value: a.id, label: a.name }))} />
        <UserPicker label="Hand it to" value={to} onChange={(id) => setTo(id)} placeholder="Search people" />
      </Modal>
      <ConfirmDialog
        open={Boolean(canceling)}
        title="Cancel this approval request?"
        message={`"${canceling?.workflow ?? ''}" stops here. Decisions already made are kept on the record.`}
        confirmLabel="Cancel request"
        danger
        busy={busy}
        onConfirm={() => void cancel()}
        onCancel={() => setCanceling(null)}
      />
    </section>
  );
}
