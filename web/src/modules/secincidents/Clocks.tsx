import { useEffect, useState } from 'react';
import {
  ApiError, api, Badge, Button, Countdown, DateTimeField, EmptyState, ErrorState, errorMessage, formatDateTime,
  Loading, Modal, TextArea, TextField, useFetch, useToast,
} from '../../core';
import type { Clock, ClocksResult } from './types';
import { deadlineText } from './types';

/** Captures the completion record for one notification: who, how, when and the reference received. */
function RecordNotificationDialog({ clock, onClose, onSaved }: { clock: Clock | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [who, setWho] = useState('');
  const [how, setHow] = useState('');
  const [when, setWhen] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clock) return;
    setWho(clock.notified_who ?? '');
    setHow(clock.notified_how ?? '');
    setWhen(clock.notified_at ?? new Date().toISOString());
    setReference(clock.reference_received ?? '');
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

  return (
    <Modal open={!!clock} title={clock ? `Record notification: ${clock.party}` : 'Record notification'} onClose={onClose}>
      {clock && (
        <form className="form" onSubmit={submit} noValidate>
          <p className="muted">
            {clock.required ? 'Required' : 'Recommended'}, due {formatDateTime(clock.due_at)}.
            {clock.guidance ? ` ${clock.guidance}` : ''}
          </p>
          <div className="form-grid">
            <TextField label="Who was notified" required value={who} onChange={setWho} error={errors.notified_who}
              hint="Name and role of the person or desk that took the report" autoFocus />
            <TextField label="How" required value={how} onChange={setHow} error={errors.notified_how}
              hint="Phone, email, web form, letter..." />
            <DateTimeField label="When" required value={when} onChange={setWhen} error={errors.notified_at} />
            <TextField label="Reference received" value={reference} onChange={setReference} error={errors.reference_received}
              hint="Report or case number, if one was given" />
          </div>
          <div className="form-actions">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" loading={busy}>Record notification</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function NotRequiredDialog({ clock, onClose, onSaved }: { clock: Clock | null; onClose: () => void; onSaved: () => void }) {
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
    <Modal open={!!clock} title={clock ? `Not required: ${clock.party}` : 'Not required'} onClose={onClose} size="sm">
      <form className="form" onSubmit={submit} noValidate>
        <TextArea label="Reason" required value={reason} onChange={setReason} error={error} rows={3} />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy}>Mark not required</Button>
        </div>
      </form>
    </Modal>
  );
}

function ClockCard({ clock, discoveredAt, canEdit, onRecord, onSkip, onReopen }: {
  clock: Clock; discoveredAt: string; canEdit: boolean; onRecord: () => void; onSkip: () => void; onReopen: () => void;
}) {
  return (
    <li className={`si-clock si-clock-${clock.state}`}>
      <div className="row">
        <span className="si-clock-party">{clock.party}</span>
        <Badge color={clock.required ? 'blue' : 'gray'}>{clock.required ? 'Required' : 'Recommended'}</Badge>
      </div>
      {clock.status === 'not_required' ? (
        <span className="si-clock-meta">Not required for this incident</span>
      ) : (
        <Countdown
          label={clock.status === 'done' ? 'Notified' : 'Time left'}
          deadline={clock.due_at}
          start={discoveredAt}
          completedAt={clock.status === 'done' ? clock.notified_at : null}
        />
      )}
      <span className="si-clock-meta">
        Deadline: {deadlineText(clock.deadline_hours)}{clock.due_at ? `, by ${formatDateTime(clock.due_at)}` : ''}
      </span>
      {clock.status === 'done' && (
        <span className="si-clock-meta">
          {clock.notified_who} by {clock.notified_how}, {formatDateTime(clock.notified_at)}
          {clock.reference_received ? `. Reference ${clock.reference_received}` : ''}
        </span>
      )}
      {canEdit && (
        <div className="row">
          {clock.status === 'pending' && <Button size="sm" variant="primary" onClick={onRecord}>Record notification</Button>}
          {clock.status === 'pending' && <Button size="sm" variant="ghost" onClick={onSkip}>Not required</Button>}
          {clock.status === 'done' && <Button size="sm" variant="ghost" onClick={onRecord}>Correct record</Button>}
          {clock.status === 'not_required' && <Button size="sm" variant="ghost" onClick={onReopen}>Reopen</Button>}
        </div>
      )}
    </li>
  );
}

/** The strip of regulatory clocks at the top of the incident workspace. */
export function ClocksStrip({ incidentId, declared, version, canEdit, onChanged }: {
  incidentId: string; declared: boolean; version: string; canEdit: boolean; onChanged: () => void;
}) {
  const toast = useToast();
  const { data, error, reload } = useFetch<ClocksResult>(`/api/security-incidents/${incidentId}/clocks`);
  const [recording, setRecording] = useState<Clock | null>(null);
  const [skipping, setSkipping] = useState<Clock | null>(null);

  // The incident changed (flags, discovery time, status): the tasks may have too.
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
  else if (!data) body = <Loading lines={2} label="Loading clocks" />;
  else if (!data.clocks.length) {
    body = declared
      ? <EmptyState icon="clock" title="No notifications required" message="No active notification rule matches this incident. Check the answers on the Affected tab." />
      : <EmptyState icon="clock" title="Clocks start when the incident is declared" message="Deadlines are counted from the discovery time, not from the declaration." />;
  } else {
    body = (
      <ul className="si-clocks">
        {data.clocks.map((c) => (
          <ClockCard key={c.task_id} clock={c} discoveredAt={data.incident.discovered_at} canEdit={canEdit}
            onRecord={() => setRecording(c)} onSkip={() => setSkipping(c)} onReopen={() => reopen(c)} />
        ))}
      </ul>
    );
  }

  return (
    <section className="stack" aria-label="Regulatory clocks">
      <h2 className="si-section-title">Regulatory clocks{data ? `, counted from discovery at ${formatDateTime(data.incident.discovered_at)}` : ''}</h2>
      {body}
      <RecordNotificationDialog clock={recording} onClose={() => setRecording(null)} onSaved={changed} />
      <NotRequiredDialog clock={skipping} onClose={() => setSkipping(null)} onSaved={changed} />
    </section>
  );
}
