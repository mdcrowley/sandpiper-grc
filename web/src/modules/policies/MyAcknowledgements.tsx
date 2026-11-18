// "Policies awaiting my acknowledgement": every signed-in person's own list, whatever their role.
import { useState } from 'react';
import {
  api, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, Loading, Modal, PageHeader, StatusChip,
  useFetch, useToast,
} from '../../core';
import { PolicyBody, daysPhrase, type MyAck } from './shared';

interface Mine { today: string; awaiting: MyAck[]; acknowledged: MyAck[] }

function DueChip({ a }: { a: MyAck }) {
  if (a.state === 'overdue') return <StatusChip color="red" label={`Overdue (due ${daysPhrase(a.days_left)})`} />;
  if (a.days_left <= 3) return <StatusChip color="amber" label={`Due ${daysPhrase(a.days_left)}`} />;
  return <StatusChip color="blue" label={`Due ${formatDate(a.due_on)}`} />;
}

function ReadDialog({ ackId, onClose, onDone }: { ackId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<MyAck>(`/api/policies/acknowledgements/${ackId}`);
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = data?.state === 'acknowledged';

  const acknowledge = async () => {
    setBusy(true);
    try {
      await api.post(`/api/policies/acknowledgements/${ackId}/acknowledge`);
      toast.success('Thank you. Your acknowledgement has been recorded.');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open size="lg" onClose={onClose}
      title={data ? `${data.policy_title} (version ${data.version})` : 'Policy'}
      footer={(
        <>
          <Button onClick={onClose}>{done ? 'Close' : 'Not now'}</Button>
          {data && !done && <Button variant="primary" disabled={!read} loading={busy} onClick={acknowledge}>Acknowledge</Button>}
        </>
      )}
    >
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={8} label="Loading the policy" /> : (
        <div className="stack">
          {data.change_summary && <p className="muted">What changed in this version: {data.change_summary}</p>}
          <div className="pol-read" tabIndex={0} role="region" aria-label="Policy text"><PolicyBody html={data.body_html} /></div>
          {done
            ? <p><StatusChip color="green" label={`You acknowledged this on ${formatDateTime(data.acknowledged_at)}`} /></p>
            : <Checkbox label="I have read and understood this policy" checked={read} onChange={setRead} />}
        </div>
      )}
    </Modal>
  );
}

export function MyAcknowledgements() {
  const { data, error, reload } = useFetch<Mine>('/api/policies/acknowledgements/mine');
  const [reading, setReading] = useState<string | null>(null);

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={6} label="Loading your acknowledgements" />;
  else {
    body = (
      <>
        <Card title="Awaiting my acknowledgement" flush={data.awaiting.length > 0}>
          {data.awaiting.length === 0 ? (
            <EmptyState icon="check-square" title="Nothing is waiting for you" message="When a policy that applies to you is published, it appears here for you to read and acknowledge." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Policies you have been asked to acknowledge, most urgent first</caption>
                <thead>
                  <tr><th scope="col">Policy</th><th scope="col">Version</th><th scope="col">Asked</th><th scope="col">Due</th><th scope="col"><span className="sr-only">Action</span></th></tr>
                </thead>
                <tbody>
                  {data.awaiting.map((a) => (
                    <tr key={a.id}>
                      <td className="pol-wrap pol-rowhead">
                        <span className="ref">{a.policy_ref}</span> {a.policy_title}
                        {a.policy_summary && <span className="muted" style={{ display: 'block', fontWeight: 400 }}>{a.policy_summary}</span>}
                      </td>
                      <td>Version {a.version}</td>
                      <td>{formatDate(a.requested_at)}</td>
                      <td><DueChip a={a} /></td>
                      <td><Button variant="primary" size="sm" onClick={() => setReading(a.id)}>Read and acknowledge</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {data.acknowledged.length > 0 && (
          <Card title="Already acknowledged" flush>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Policies you have acknowledged, newest first</caption>
                <thead><tr><th scope="col">Policy</th><th scope="col">Version</th><th scope="col">Acknowledged</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
                <tbody>
                  {data.acknowledged.map((a) => (
                    <tr key={a.id}>
                      <td className="pol-wrap pol-rowhead"><span className="ref">{a.policy_ref}</span> {a.policy_title}</td>
                      <td>Version {a.version}</td>
                      <td>{formatDateTime(a.acknowledged_at)}</td>
                      <td><Button variant="ghost" size="sm" icon="eye" onClick={() => setReading(a.id)}>Read again</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </>
    );
  }

  return (
    <div className="stack">
      <PageHeader title="My acknowledgements" subtitle="Policies you have been asked to read and acknowledge." />
      {body}
      {reading && <ReadDialog key={reading} ackId={reading} onClose={() => setReading(null)} onDone={() => { setReading(null); reload(); }} />}
    </div>
  );
}
