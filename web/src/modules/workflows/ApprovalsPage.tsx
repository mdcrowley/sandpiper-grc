// Approvals (/approvals): what waits for my decision (stand-ins included), what I decided, what I
// asked for, and my stand-ins (E14-32). Modules' own approvals (a change, a disposal, a risk
// acceptance, a gate) are here too: they run on the same workflows.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button, Countdown, EmptyState, ErrorState, formatDateTime, Loading, PageHeader, relativeTime, StatusChip, Tabs, useFetch,
} from '../../core';
import { DecisionDialog, type DecisionTarget } from './DecisionDialog';
import { Standins } from './Standins';
import { STATUS_LOOK, type Approval, type Request } from './data';
import { useApprovalInbox, type InboxItem } from './inbox';
import './workflows.css';

const recordText = (a: { record_type_label: string; record_ref: string | null; record_title: string }) =>
  `${a.record_type_label} ${a.record_ref ?? ''}`.trim();

function StepDots({ position, total, label }: { position: number | null; total: number; label: string }) {
  if (position === null || total < 2) return null;
  return (
    <span className="wf-dots" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => <span key={i} className={i < position ? 'is-done' : i === position ? 'is-current' : ''} />)}
    </span>
  );
}

function RecordLink({ a }: { a: { route: string; record_type_label: string; record_ref: string | null; record_title: string } }) {
  return (
    <Link to={a.route} className="wf-item-record">
      <span className="wf-item-type">{recordText(a)}</span>
      <span className="wf-item-title">{a.record_title || 'Untitled'}</span>
    </Link>
  );
}

function Waiting({ rows, onDecide }: { rows: Approval[]; onDecide: (t: DecisionTarget) => void }) {
  if (!rows.length) {
    return <EmptyState icon="check-circle" title="Nothing is waiting for you" message="When a record needs your approval it appears here, and you are notified." />;
  }
  return (
    <ul className="wf-items" aria-label="Waiting for your decision">
      {rows.map((a) => (
        <li key={a.step_id} className={`wf-item${a.overdue ? ' is-overdue' : ''}`}>
          <div className="wf-item-main">
            <RecordLink a={a} />
            <div className="wf-item-meta">
              <span><strong>{a.workflow}</strong> · step {a.position + 1} of {a.steps_total}: {a.step}</span>
              <StepDots position={a.position} total={a.steps_total} label={`Step ${a.position + 1} of ${a.steps_total}`} />
            </div>
            <div className="wf-item-meta muted">
              {a.on_behalf_of_name && <StatusChip color="purple" label={`Standing in for ${a.on_behalf_of_name}`} size="sm" />}
              {a.requested_by_name && <span>Asked by {a.requested_by_name}</span>}
              <span title={formatDateTime(a.started_at)}>Started {relativeTime(a.started_at)}</span>
              {a.required > 1 && <span>{a.approvals} of {a.required} approvals so far</span>}
              {a.escalated && <StatusChip color="amber" label="Escalated" size="sm" />}
            </div>
          </div>
          <div className="wf-item-side">
            {a.due_at && <Countdown label="Due" deadline={a.due_at} start={a.started_at} />}
            <div className="wf-item-buttons">
              <Button size="sm" variant="primary" icon="check" onClick={() => onDecide({ stepId: a.step_id, decision: 'approved', what: recordText(a), step: a.step })}>
                Approve<span className="sr-only"> {recordText(a)}</span>
              </Button>
              <Button size="sm" variant="secondary" icon="x" onClick={() => onDecide({ stepId: a.step_id, decision: 'rejected', what: recordText(a), step: a.step })}>
                Reject<span className="sr-only"> {recordText(a)}</span>
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Decided({ rows }: { rows: Approval[] }) {
  if (!rows.length) return <EmptyState icon="history" title="You have not decided anything yet" message="Your approvals and rejections are listed here." />;
  return (
    <ul className="wf-items" aria-label="Decided by you">
      {rows.map((a) => (
        <li key={a.step_id} className="wf-item">
          <div className="wf-item-main">
            <RecordLink a={a} />
            <div className="wf-item-meta"><span><strong>{a.workflow}</strong> · {a.step}</span></div>
            {a.on_behalf_of_name && <div className="wf-item-meta muted">On behalf of {a.on_behalf_of_name}</div>}
            {a.comment && <div className="wf-item-meta muted">“{a.comment}”</div>}
          </div>
          <div className="wf-item-side">
            <StatusChip color={a.decision === 'approved' ? 'green' : 'red'} label={a.decision === 'approved' ? 'You approved' : 'You rejected'} />
            <span className="muted wf-small" title={formatDateTime(a.decided_at)}>{relativeTime(a.decided_at)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Requested({ rows }: { rows: Request[] }) {
  if (!rows.length) return <EmptyState icon="clipboard" title="You have not asked for any approvals" message="Requests you send, or that start when you change a record, are listed here." />;
  return (
    <ul className="wf-items" aria-label="Requested by you">
      {rows.map((r) => (
        <li key={r.instance_id} className="wf-item">
          <div className="wf-item-main">
            <RecordLink a={r} />
            <div className="wf-item-meta">
              <span><strong>{r.workflow}</strong>{r.status === 'running' && r.step ? ` · now at ${r.step}` : ''}</span>
              <StepDots position={r.status === 'running' ? r.position : null} total={r.steps_total} label={`Step ${(r.position ?? 0) + 1} of ${r.steps_total}`} />
            </div>
            {r.outcome_note && r.status !== 'running' && <div className="wf-item-meta muted">“{r.outcome_note}”</div>}
          </div>
          <div className="wf-item-side">
            <StatusChip color={STATUS_LOOK[r.status].color} label={STATUS_LOOK[r.status].label} />
            {r.status === 'running' && r.due_at
              ? <Countdown label="Due" deadline={r.due_at} />
              : <span className="muted wf-small" title={formatDateTime(r.finished_at ?? r.started_at)}>{relativeTime(r.finished_at ?? r.started_at)}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Decisions that are not approval workflows (E44-05): exception requests and policies in review, for
 * people who may decide them. Listed here so this page and the Overview's "My approvals" agree.
 */
function OtherDecisions({ items }: { items: InboxItem[] }) {
  if (!items.length) return null;
  return (
    <section className="stack" aria-labelledby="wf-other">
      <h2 className="wf-section-title" id="wf-other">Also waiting for your decision</h2>
      <ul className="wf-items" aria-labelledby="wf-other">
        {items.map((i) => (
          <li key={i.key} className="wf-item">
            <div className="wf-item-main">
              <Link to={i.to} className="wf-item-record">
                <span className="wf-item-type">{`${i.kind} ${i.reference ?? ''}`.trim()}</span>
                <span className="wf-item-title">{i.title || 'Untitled'}</span>
              </Link>
            </div>
            <div className="wf-item-side"><StatusChip color={i.kind === 'Policy in review' ? 'amber' : 'purple'} label={i.kind} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ApprovalsPage() {
  const [search, setSearch] = useSearchParams();
  const view = (['waiting', 'decided', 'requested', 'standins'] as const).find((v) => v === search.get('view')) ?? 'waiting';
  const inbox = useApprovalInbox();
  const waiting = inbox.steps;
  const other = useFetch<{ rows: (Approval | Request)[] }>(view === 'waiting' || view === 'standins' ? null : `/api/workflows/approvals?view=${view}`);
  const [deciding, setDeciding] = useState<DecisionTarget | null>(null);
  const state = view === 'waiting' ? waiting : other;

  const body = view === 'standins' ? <Standins /> : state.error
    ? <ErrorState title="Approvals could not be loaded" error={state.error} onRetry={state.reload} />
    : !state.data
      ? <Loading label="Loading approvals" lines={5} />
      : view === 'waiting'
        ? (
          <div className="stack">
            {(state.data.rows.length > 0 || inbox.otherItems.length === 0) && <Waiting rows={state.data.rows as Approval[]} onDecide={setDeciding} />}
            <OtherDecisions items={inbox.otherItems} />
          </div>
        )
        : view === 'decided' ? <Decided rows={state.data.rows as Approval[]} /> : <Requested rows={state.data.rows as Request[]} />;

  return (
    <div className="wf-page">
      <PageHeader title="Approvals" subtitle="Decide what is waiting for you, and follow the approvals you asked for." />
      <Tabs
        label="Approvals"
        active={view}
        onChange={(key) => setSearch((p) => { p.set('view', key); return p; }, { replace: true })}
        tabs={[
          { key: 'waiting', label: 'Waiting for me', count: inbox.count || undefined, content: view === 'waiting' ? body : null },
          { key: 'decided', label: 'Decided by me', content: view === 'decided' ? body : null },
          { key: 'requested', label: 'My requests', content: view === 'requested' ? body : null },
          { key: 'standins', label: 'Stand-ins', content: view === 'standins' ? body : null },
        ]}
      />
      <DecisionDialog target={deciding} onClose={() => setDeciding(null)} onDone={() => { inbox.reload(); other.reload(); }} />
    </div>
  );
}
