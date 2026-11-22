import { useEffect, useState } from 'react';
import {
  ApiError, api, Badge, Button, DateTimeField, EmptyState, ErrorState, errorMessage, formatDateTime, Icon,
  Loading, Modal, TextArea, TextField, useFetch, useLookup, useResource, useToast,
} from '../../core';
import { editableLifecycle, moveBlockedReason } from '../../core/lifecycleMenus';
import { metText, remainingAmount, remainingText, sortClocks, STATE_ICON, STATE_WORD, stateAt, useNow } from './shared';
import type { Clock, ClocksResult } from './types';
import { deadlineText } from './types';

const HOW = ['Phone', 'Email', 'Web form', 'Letter', 'In person'];

/**
 * The notification task lifecycle (E14-31) for the task buttons: for a task, why a move to a status
 * is not allowed ('' when it is), so a button can be disabled with the reason.
 */
export function useTaskBlocked(): (clock: Clock) => (to: Clock['status']) => string {
  const lifecycle = editableLifecycle(useResource('notification_task')?.lifecycle, 'status');
  const statuses = useLookup('notification_task_status');
  return (clock) => (to) => moveBlockedReason(
    lifecycle, clock.status, to, statuses.find((s) => s.value === to)?.label ?? to, statuses.map((s) => s.value),
  );
}

/** Captures the completion record for one notification: who, how, when and the reference received. */
export function RecordNotificationDialog({ clock, onClose, onSaved }: { clock: Clock | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [who, setWho] = useState('');
  const [how, setHow] = useState('');
  const [when, setWhen] = useState('');
  const [reference, setReference] = useState('');
  const [start, setStart] = useState({ who: '', how: '', when: '', reference: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clock) return;
    const initial = { who: clock.notified_who ?? '', how: clock.notified_how ?? '', when: clock.notified_at ?? new Date().toISOString(), reference: clock.reference_received ?? '' };
    setWho(initial.who);
    setHow(initial.how);
    setWhen(initial.when);
    setReference(initial.reference);
    setStart(initial);
    setErrors({});
  }, [clock]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!clock) return;
    const found: Record<string, string> = {};
    if (!who.trim()) found.notified_who = 'Record who was notified.';
    if (!how.trim()) found.notified_how = 'Record how they were notified.';
    if (!when) found.notified_at = 'Record when they were notified.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await api.patch(`/api/notification-tasks/${clock.task_id}`, {
        status: 'done', notified_who: who, notified_how: how, notified_at: when, reference_received: reference,
      });
      toast.success(`Notification to ${clock.party} recorded.`);
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const correcting = clock?.status === 'done';
  const dirty = who !== start.who || how !== start.how || when !== start.when || reference !== start.reference;
  return (
    <Modal open={!!clock} title={clock ? `${correcting ? 'Correct record' : 'Record notification'}: ${clock.party}` : 'Record notification'} onClose={onClose} dirty={!!clock && dirty}>
      {clock && (
        <form className="form" onSubmit={submit} noValidate>
          <div className="si-dialog-facts">
            <Badge color={clock.required ? 'blue' : 'gray'}>{clock.required ? 'Required' : 'Recommended'}</Badge>
            <span>Due {formatDateTime(clock.due_at)}</span>
          </div>
          {clock.guidance && <p className="si-guidance">{clock.guidance}</p>}
          <div className="form-grid">
            <TextField label="Who was notified" required value={who} onChange={setWho} error={errors.notified_who}
              hint="Name and role of the person or desk that took the report" autoFocus className="form-cell-wide" />
            <div className="si-how">
              <TextField label="How" required value={how} onChange={setHow} error={errors.notified_how} />
              <div className="si-quick" aria-label="Common ways">
                {HOW.map((h) => (
                  <button key={h} type="button" className="si-quick-chip" aria-pressed={how === h} onClick={() => setHow(h)}>{h}</button>
                ))}
              </div>
            </div>
            <DateTimeField label="When" required value={when} onChange={setWhen} error={errors.notified_at} />
            <TextField label="Reference received" value={reference} onChange={setReference} error={errors.reference_received}
              hint="Report or case number, if one was given" className="form-cell-wide" />
          </div>
          <div className="form-actions">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" loading={busy}>{correcting ? 'Save correction' : 'Record notification'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function NotRequiredDialog({ clock, onClose, onSaved }: { clock: Clock | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); setError(''); }, [clock]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!clock) return;
    if (!reason.trim()) { setError('Say why this notification is not required; the reason goes in the incident log.'); return; }
    setBusy(true);
    try {
      await api.patch(`/api/notification-tasks/${clock.task_id}`, { status: 'not_required' });
      await api.post(`/api/security-incidents/${clock.incident_id}/log`, {
        kind: 'decision', entry: `Notification to ${clock.party} marked not required. Reason: ${reason.trim()}`,
      });
      toast.success('Marked as not required.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!clock} title={clock ? `Not required: ${clock.party}` : 'Not required'} onClose={onClose} size="sm" dirty={!!clock && !!reason}>
      <form className="form" onSubmit={submit} noValidate>
        <TextArea label="Reason" required value={reason} onChange={setReason} error={error} rows={3}
          hint="The reason is written to the incident log as a decision" />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy}>Mark not required</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Share of the window from discovery to the deadline that has gone, 0 to 100. */
function elapsedPercent(discoveredAt: string, dueAt: string | null, now: number): number {
  if (!dueAt) return 0;
  const start = new Date(discoveredAt).getTime();
  const end = new Date(dueAt).getTime();
  if (end <= start) return 100;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
}

function ClockCard({ clock, discoveredAt, now, canEdit, blocked, onRecord, onSkip, onReopen }: {
  clock: Clock; discoveredAt: string; now: number; canEdit: boolean;
  /** Why the lifecycle does not allow moving this task to a status ('' when it does, E14-31). */
  blocked: (to: Clock['status']) => string;
  onRecord: () => void; onSkip: () => void; onReopen: () => void;
}) {
  const state = stateAt(clock, now);
  return (
    <li className={`si-clock si-clock-${state}`}>
      <div className="si-clock-top">
        <span className="si-clock-party">{clock.party}</span>
        <Badge color={clock.required ? 'blue' : 'gray'}>{clock.required ? 'Required' : 'Recommended'}</Badge>
      </div>

      {clock.status === 'pending' && (
        <>
          <div className="si-clock-time">
            <Icon name={STATE_ICON[state]} size={18} />
            <span>{remainingText(clock.due_at, now)}</span>
            <span className="sr-only"> ({STATE_WORD[state]})</span>
          </div>
          <div className="si-clock-bar" aria-hidden="true"><span style={{ width: `${elapsedPercent(discoveredAt, clock.due_at, now)}%` }} /></div>
          <div className="si-clock-meta">
            Due <strong>{formatDateTime(clock.due_at)}</strong>
            <span className="si-clock-window"> · {deadlineText(clock.deadline_hours)}{Number(clock.deadline_hours) === 0 ? '' : ' from discovery'}</span>
          </div>
          {clock.guidance && (
            <details className="si-clock-guidance">
              <summary>Guidance</summary>
              <p>{clock.guidance}</p>
            </details>
          )}
          {canEdit && (
            <div className="si-clock-actions">
              <Button size="sm" variant="primary" icon="check" onClick={onRecord} disabled={Boolean(blocked('done'))} title={blocked('done') || undefined}>Record notification</Button>
              <Button size="sm" variant="ghost" onClick={onSkip} disabled={Boolean(blocked('not_required'))} title={blocked('not_required') || undefined}>Not required</Button>
            </div>
          )}
        </>
      )}

      {clock.status === 'done' && (
        <>
          <div className="si-clock-time">
            <Icon name={clock.late ? 'alert-circle' : 'check-circle'} size={18} />
            <span>{metText(clock)}</span>
          </div>
          <dl className="si-clock-record">
            <div><dt>Who</dt><dd>{clock.notified_who}</dd></div>
            <div><dt>How</dt><dd>{clock.notified_how}</dd></div>
            <div><dt>When</dt><dd>{formatDateTime(clock.notified_at)}</dd></div>
            {clock.reference_received && <div><dt>Reference</dt><dd>{clock.reference_received}</dd></div>}
          </dl>
          <div className="si-clock-meta">
            Recorded{clock.completed_by_name ? ` by ${clock.completed_by_name}` : ''}, {formatDateTime(clock.completed_at)}. Was due {formatDateTime(clock.due_at)}.
          </div>
          {canEdit && <div className="si-clock-actions"><Button size="sm" variant="ghost" icon="edit" onClick={onRecord}>Correct record</Button></div>}
        </>
      )}

      {clock.status === 'not_required' && (
        <>
          <div className="si-clock-meta">Not required for this incident. The reason is in the log.</div>
          {canEdit && <div className="si-clock-actions"><Button size="sm" variant="ghost" icon="refresh" onClick={onReopen} disabled={Boolean(blocked('pending'))} title={blocked('pending') || undefined}>Reopen</Button></div>}
        </>
      )}
    </li>
  );
}

/** The one line that matters most: the next deadline, or how late the latest one is. */
function Headline({ clocks, now }: { clocks: Clock[]; now: number }) {
  const open = clocks.filter((c) => c.status === 'pending');
  if (!open.length) {
    const done = clocks.filter((c) => c.status === 'done').length;
    return (
      <div className="si-next si-next-met" role="status">
        <span className="si-next-label">Notifications</span>
        <span className="si-next-value"><Icon name="check-circle" size={22} /> Nothing outstanding</span>
        <span className="si-next-detail">{done} recorded{clocks.length > done ? `, ${clocks.length - done} not required` : ''}.</span>
      </div>
    );
  }
  const first = open[0];
  const state = stateAt(first, now);
  const overdue = open.filter((c) => stateAt(c, now) === 'red').length;
  return (
    <div className={`si-next si-next-${state}`} role="status" aria-live="off">
      <span className="si-next-label">{state === 'red' ? (overdue > 1 ? `${overdue} notifications overdue` : 'Notification overdue') : 'Next deadline'}</span>
      <span className="si-next-value">
        <Icon name={STATE_ICON[state]} size={22} />
        {state === 'red' ? `${remainingAmount(first.due_at, now)} overdue` : `${remainingAmount(first.due_at, now)} left`}
      </span>
      <span className="si-next-detail">
        <strong>{first.party}</strong>{first.required ? '' : ' (recommended)'} · {state === 'red' ? 'was due' : 'by'} {formatDateTime(first.due_at)}
      </span>
      {open.length > 1 && <span className="si-next-more">{open.length} notifications still to make</span>}
    </div>
  );
}

/** The rail of notification clocks in the incident workspace: one headline, then a card per party, most urgent first. */
export function ClocksRail({ incidentId, declared, version, canEdit, onChanged }: {
  incidentId: string; declared: boolean; version: string; canEdit: boolean; onChanged: () => void;
}) {
  const toast = useToast();
  const { data, error, reload } = useFetch<ClocksResult>(`/api/security-incidents/${incidentId}/clocks`);
  const [recording, setRecording] = useState<Clock | null>(null);
  const [skipping, setSkipping] = useState<Clock | null>(null);
  const soon = data?.clocks.some((c) => c.status === 'pending' && c.due_at && Math.abs(new Date(c.due_at).getTime() - Date.now()) < 3_600_000);
  const now = useNow(soon ? 1000 : 20_000);
  const blockedFor = useTaskBlocked();

  // The incident changed (answers, discovery time, status): the tasks may have too.
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [version]);

  const changed = () => { reload(); onChanged(); };

  async function reopen(clock: Clock) {
    try {
      await api.patch(`/api/notification-tasks/${clock.task_id}`, { status: 'pending' });
      changed();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  let body;
  if (error) body = <ErrorState title="The clocks could not be loaded" error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={3} label="Loading clocks" />;
  else if (!data.clocks.length) {
    body = declared
      ? <EmptyState icon="clock" title="No notifications required" message="No active notification rule matches this incident. Check the answers on the Affected tab." />
      : <EmptyState icon="clock" title="Clocks start when the incident is declared" message="Deadlines are counted from the discovery time, not from the declaration." />;
  } else {
    const clocks = sortClocks(data.clocks, now);
    body = (
      <>
        <Headline clocks={clocks} now={now} />
        <ul className="si-clocks">
          {clocks.map((c) => (
            <ClockCard key={c.task_id} clock={c} discoveredAt={data.incident.discovered_at} now={now} canEdit={canEdit} blocked={blockedFor(c)}
              onRecord={() => setRecording(c)} onSkip={() => setSkipping(c)} onReopen={() => reopen(c)} />
          ))}
        </ul>
      </>
    );
  }

  return (
    <section className="si-rail-section" aria-label="Notification clocks">
      <header className="si-rail-head">
        <h2>Notification clocks</h2>
        {data && <span>Counted from discovery, {formatDateTime(data.incident.discovered_at)}</span>}
      </header>
      {body}
      <RecordNotificationDialog clock={recording} onClose={() => setRecording(null)} onSaved={changed} />
      <NotRequiredDialog clock={skipping} onClose={() => setSkipping(null)} onSaved={changed} />
    </section>
  );
}
