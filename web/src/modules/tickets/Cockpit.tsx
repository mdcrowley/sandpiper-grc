// The strip under the ticket header: where the ticket stands, both service-level clocks, who
// has it and what to do next. Everything an agent needs before scrolling.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Countdown, errorMessage, ErrorState, formatDateTime, Icon, Loading, LookupChip, lookupLabel, Modal, ProgressBar, TextArea,
  useAuth, useFetch, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { fieldErrors, nextStep, useStatuses, workingText, type ClockView, type SlaState } from './util';

/** Two initials from a name, ignoring brackets and other marks: "[Sample] Devon Hartley" gives "DH". */
function initials(name: unknown): string {
  const words = String(name ?? '').replace(/\[[^\]]*\]/g, ' ').match(/\p{L}[\p{L}'-]*/gu) ?? [];
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picked.map((w) => (w ?? '').charAt(0)).join('').toUpperCase() || '?';
}

function Clock({ label, clock, total, start, paused }: { label: string; clock: ClockView; total: number; start: string; paused: boolean }) {
  if (clock.state === 'none') {
    return <div className="sd-cell"><span className="sd-cell-label">{label}</span><span className="muted">No target for this priority</span></div>;
  }
  const waiting = paused && !clock.met_at;
  const left = clock.remaining_minutes;
  const used = left === null ? null : Math.min(100, Math.max(0, ((total - left) / total) * 100));
  return (
    <div className="sd-cell">
      <span className="sd-cell-label">{label}</span>
      <Countdown deadline={waiting ? clock.projected_due_at ?? clock.due_at : clock.due_at} start={start} completedAt={clock.met_at} paused={waiting} />
      {used !== null && !clock.met_at && (
        <ProgressBar hideLabel label={`${label} time used`} value={used} valueText={`${Math.round(used)}% of the time used`}
          color={clock.breached ? 'red' : used >= 75 ? 'amber' : 'green'} />
      )}
      <span className="sd-cell-detail">
        {clock.met_at
          ? `Done ${formatDateTime(clock.met_at)}${clock.breached ? ` · target was ${formatDateTime(clock.due_at)}` : ''}`
          : waiting
            ? (left ?? 0) >= 0 ? `${workingText(left)} of working time left when work resumes` : `Already ${workingText(left)} of working time over`
            : `Due ${formatDateTime(clock.due_at)}`}
      </span>
    </div>
  );
}

function Approval({ rec }: { rec: RecordContext }) {
  const { row, reload } = rec;
  const { can } = useAuth();
  const toast = useToast();
  const [decision, setDecision] = useState<null | 'approved' | 'rejected'>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!row.approval_status) return null;

  async function decide() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/tickets/${row.id}/approval`, { decision, note });
      toast.success(decision === 'approved' ? 'Request approved.' : 'Request rejected.');
      setDecision(null);
      reload();
    } catch (err) {
      setError(fieldErrors(err).note ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const who = row.approval_at ? ` by ${row._display?.approval_by ?? 'an approver'} on ${formatDateTime(row.approval_at)}` : '';
  return (
    <>
      {row.approval_status === 'pending' ? (
        <div className="notice notice-pilot sd-cockpit-note">
          <Icon name="lock" size={16} />
          <span className="sd-grow"><strong>Waiting for approval.</strong> Work can start once this request is approved. It can be assigned, paused or cancelled meanwhile.</span>
          {can('tickets.approve') && (
            <span className="row">
              <Button size="sm" variant="primary" icon="check" onClick={() => { setNote(''); setError(''); setDecision('approved'); }}>Approve</Button>
              <Button size="sm" icon="x" onClick={() => { setNote(''); setError(''); setDecision('rejected'); }}>Reject</Button>
            </span>
          )}
        </div>
      ) : (
        <div className={`notice ${row.approval_status === 'rejected' ? 'notice-warn' : 'notice-success'} sd-cockpit-note`}>
          <Icon name={row.approval_status === 'rejected' ? 'x' : 'check-circle'} size={16} />
          <span className="sd-grow">
            <strong>{lookupLabel('ticket_approval', row.approval_status)}</strong>{who}.{row.approval_note ? ` “${row.approval_note}”` : ''}
            {row.approval_status === 'rejected' ? ' Cancel the ticket, or ask for the decision to be changed.' : ''}
          </span>
          {row.approval_status === 'rejected' && can('tickets.approve') && (
            <Button size="sm" onClick={() => { setNote(''); setError(''); setDecision('approved'); }}>Approve after all</Button>
          )}
        </div>
      )}
      <Modal open={decision !== null} size="sm" title={decision === 'approved' ? 'Approve this request' : 'Reject this request'} onClose={() => setDecision(null)}
        footer={<><Button onClick={() => setDecision(null)}>Cancel</Button><Button variant={decision === 'rejected' ? 'danger' : 'primary'} loading={busy} onClick={decide}>{decision === 'approved' ? 'Approve' : 'Reject'}</Button></>}>
        <TextArea label={decision === 'rejected' ? 'Reason' : 'Note (optional)'} required={decision === 'rejected'} rows={3} value={note} onChange={setNote} error={error || undefined}
          hint="Shown on the ticket and in its history." />
      </Modal>
    </>
  );
}

export function Cockpit({ rec }: { rec: RecordContext }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  const { category } = useStatuses();
  const { data, error, reload } = useFetch<SlaState>(`/api/tickets/${row.id}/sla`);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // Refresh when the ticket changes and once a minute, so a breach shows without a page reload.
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [row.updated_at]);
  useEffect(() => {
    const timer = window.setInterval(reload, 60_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const cat = category(row.status);
  const done = cat === 'resolved' || cat === 'closed';
  const breached = Boolean(data && (data.response.breached || data.resolve.breached));

  async function patch(body: Record<string, unknown>, message: string) {
    setBusy(true);
    try {
      await save(body);
      setAsking(false);
      toast.success(message);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card sd-cockpit" aria-label="Where this ticket stands">
      <div className="sd-cockpit-grid">
        <div className="sd-cell">
          <span className="sd-cell-label">Status</span>
          <span className="row"><LookupChip list="ticket_status" value={row.status} /></span>
          <span className="sd-cell-detail">{nextStep(row, cat)}</span>
        </div>
        {error ? <div className="sd-cell sd-cell-wide"><ErrorState title="The clocks could not be loaded" error={error} onRetry={reload} /></div>
          : !data ? <div className="sd-cell sd-cell-wide"><Loading lines={2} label="Loading the clocks" /></div>
          : !data.policy ? (
            <div className="sd-cell sd-cell-wide">
              <span className="sd-cell-label">Service-level targets</span>
              <span className="muted">No service-level policy covers this priority, so no clock is running.</span>
            </div>
          ) : (
            <>
              <Clock label="Respond" clock={data.response} total={data.policy.respond_minutes} start={row.opened_at} paused={data.paused} />
              <Clock label="Resolve" clock={data.resolve} total={data.policy.resolve_minutes + data.paused_minutes} start={row.opened_at} paused={data.paused} />
            </>
          )}
        <div className="sd-cell">
          <span className="sd-cell-label">Assignee</span>
          <span className="sd-person">
            <span className={`sd-avatar${row.assignee_id ? '' : ' is-empty'}`} aria-hidden="true">
              {row.assignee_id ? initials(row._display?.assignee_id) : <Icon name="user" size={16} />}
            </span>
            <strong>{row.assignee_id ? row._display?.assignee_id : 'Unassigned'}</strong>
          </span>
          <span className="sd-cell-detail">
            {row.assignment_group ? lookupLabel('assignment_group', row.assignment_group) : 'No assignment group'}
          </span>
        </div>
      </div>

      <Approval rec={rec} />
      {row.parent_ticket_id && (
        <p className="sd-cockpit-line"><Icon name="link" size={15} /> Part of major incident <Link to={`/tickets/${row.parent_ticket_id}?tab=major`}>{row._display?.parent_ticket_id ?? 'parent ticket'}</Link>.</p>
      )}
      {row.escalated_at && !done && (
        <p className="sd-cockpit-line"><Icon name="arrow-up" size={15} /> Escalated by rule on {formatDateTime(row.escalated_at)}. The History tab says to whom.</p>
      )}
      {data?.policy && (
        <p className="sd-cockpit-line muted">
          <Icon name="clock" size={15} />
          <span className="sd-grow">
            {data.paused
              ? `Clock paused since ${formatDateTime(data.paused_at)} while the ticket waits. `
              : data.paused_minutes > 0 ? `Paused earlier for ${workingText(data.paused_minutes)} of working time. ` : ''}
            Counted on the calendar “{data.policy.calendar.name}”.
          </span>
          {breached && canEdit && (
            <Button size="sm" onClick={() => { setReason(row.breach_reason ?? ''); setAsking(true); }}>
              {row.breach_reason ? 'Edit breach reason' : 'Record breach reason'}
            </Button>
          )}
        </p>
      )}
      {row.breach_reason && <p className="notice notice-warn sd-cockpit-note"><span><strong>Breach reason:</strong> {row.breach_reason}</span></p>}

      <Modal open={asking} title="Why was the target missed?" onClose={() => setAsking(false)} size="sm"
        footer={<><Button onClick={() => setAsking(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => patch({ breach_reason: reason.trim() || null }, 'Breach reason recorded.')}>Save</Button></>}>
        <TextArea label="Breach reason" value={reason} onChange={setReason} rows={4} hint="A sentence is enough. It appears in service desk reports." />
      </Modal>
    </section>
  );
}
