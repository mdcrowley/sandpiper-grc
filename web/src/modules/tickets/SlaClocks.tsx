// Live service-level clocks for one ticket: respond and resolve, with paused state and breach reason.
import { useEffect, useState } from 'react';
import {
  Badge, Button, Card, Countdown, ErrorState, errorMessage, formatDateTime, Loading, Modal, TextArea, useFetch, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { workingText, type ClockView, type SlaState } from './util';

function Clock({ label, clock, start, paused }: { label: string; clock: ClockView; start: string; paused: boolean }) {
  if (clock.state === 'none') {
    return <div className="sd-clock"><span className="sd-clock-label">{label}</span><span className="muted">No target for this priority</span></div>;
  }
  const waiting = paused && !clock.met_at;
  return (
    <div className="sd-clock">
      <Countdown
        label={label}
        deadline={waiting ? clock.projected_due_at ?? clock.due_at : clock.due_at}
        start={start}
        completedAt={clock.met_at}
        paused={waiting}
      />
      <span className="muted sd-clock-detail">
        {clock.met_at
          ? `Done ${formatDateTime(clock.met_at)} · target ${formatDateTime(clock.due_at)}`
          : waiting
            ? (clock.remaining_minutes ?? 0) >= 0
              ? `${workingText(clock.remaining_minutes)} of working time left when work resumes`
              : `Already ${workingText(clock.remaining_minutes)} of working time over`
            : `Due ${formatDateTime(clock.due_at)}`}
      </span>
      {clock.breached && <Badge color="red">Target missed</Badge>}
    </div>
  );
}

export function SlaClocks({ rec }: { rec: RecordContext }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
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

  if (error) return <Card title="Service-level targets"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="Service-level targets"><Loading lines={2} label="Loading the clocks" /></Card>;

  const breached = data.response.breached || data.resolve.breached;

  async function saveReason() {
    setBusy(true);
    try {
      await save({ breach_reason: reason.trim() || null });
      setAsking(false);
      toast.success('Breach reason recorded.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Service-level targets"
      actions={breached && canEdit ? (
        <Button size="sm" onClick={() => { setReason(row.breach_reason ?? ''); setAsking(true); }}>
          {row.breach_reason ? 'Edit breach reason' : 'Record breach reason'}
        </Button>
      ) : undefined}
    >
      {!data.policy ? (
        <p className="muted">No service-level policy covers this priority, so no clock is running.</p>
      ) : (
        <>
          <div className="sd-clocks">
            <Clock label="Respond" clock={data.response} start={row.opened_at} paused={data.paused} />
            <Clock label="Resolve" clock={data.resolve} start={row.opened_at} paused={data.paused} />
          </div>
          <p className="muted sd-clock-note">
            {data.paused
              ? `Clock paused since ${formatDateTime(data.paused_at)} while the ticket waits. `
              : data.paused_minutes > 0 ? `Paused earlier for ${workingText(data.paused_minutes)} of working time. ` : ''}
            Counted on the calendar “{data.policy.calendar.name}”.
          </p>
        </>
      )}
      {row.breach_reason && <p className="sd-breach-reason"><strong>Breach reason:</strong> {row.breach_reason}</p>}
      <Modal
        open={asking}
        title="Why was the target missed?"
        onClose={() => setAsking(false)}
        size="sm"
        footer={<><Button onClick={() => setAsking(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={saveReason}>Save</Button></>}
      >
        <TextArea label="Breach reason" value={reason} onChange={setReason} rows={4} hint="A sentence is enough. It appears in service desk reports." />
      </Modal>
    </Card>
  );
}
