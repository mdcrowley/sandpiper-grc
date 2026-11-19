// The policy reader: one acknowledgment request, opened from My acknowledgments or from a
// notification. Comfortable reading width and type, what changed, the due date, and an
// acknowledge bar that stays in reach at the bottom. Anyone may open their own request.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api, Button, Checkbox, ErrorState, errorMessage, formatDate, formatDateTime, Icon, Loading, PageHeader, StatusChip, useFetch, useToast,
} from '../../core';
import { daysPhrase, PolicyBody, type MyAck } from './shared';

export function PolicyReader() {
  const { ackId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useFetch<MyAck>(ackId ? `/api/policies/acknowledgments/${ackId}` : null);
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const crumbs = [{ label: 'My acknowledgments', to: '/policies/acknowledgments' }, { label: data ? `${data.policy_ref ?? ''} version ${data.version}`.trim() : 'Policy' }];

  if (error) {
    return (
      <div className="stack">
        <PageHeader title="Policy" breadcrumbs={crumbs} />
        <ErrorState title="This policy could not be opened" error={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) {
    return <div className="stack"><PageHeader title="Policy" breadcrumbs={crumbs} /><Loading lines={10} label="Loading the policy" /></div>;
  }

  const done = data.state === 'acknowledged';
  const closed = data.state === 'superseded';
  const acknowledge = async () => {
    setBusy(true);
    try {
      await api.post(`/api/policies/acknowledgments/${data.id}/acknowledge`);
      toast.success('Thank you. Your acknowledgment has been recorded.');
      navigate('/policies/acknowledgments');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const status = done
    ? <StatusChip color="green" label="Acknowledged" />
    : closed ? <StatusChip color="gray" label="Replaced by a newer version" />
    : data.state === 'overdue' ? <StatusChip color="red" label={`Overdue: was due ${daysPhrase(data.days_left)}`} />
    : <StatusChip color={data.days_left <= 3 ? 'amber' : 'blue'} label={`Due ${formatDate(data.due_on)}`} />;

  return (
    <div className="stack pol-reader-page">
      <PageHeader
        title={data.policy_title}
        reference={data.policy_ref ?? undefined}
        status={status}
        breadcrumbs={crumbs}
        subtitle={`Version ${data.version}${data.effective_on ? `, effective ${formatDate(data.effective_on)}` : ''}. Asked ${formatDate(data.requested_at)}.`}
      />
      <article className="pol-reader" aria-label="Policy text">
        {data.policy_summary && <p className="pol-reader-lead">{data.policy_summary}</p>}
        {data.change_summary && (
          <div className="notice">
            <Icon name="info" size={16} />
            <span><strong>What changed in this version:</strong> {data.change_summary}</span>
          </div>
        )}
        <PolicyBody html={data.body_html} />
      </article>
      <div className="pol-reader-bar" role="region" aria-label="Acknowledgment">
        {done ? (
          <>
            <span className="row"><Icon name="check-circle" size={18} /> You acknowledged this version on {formatDateTime(data.acknowledged_at)}.</span>
            <Link className="btn btn-secondary" to="/policies/acknowledgments">Back to my acknowledgments</Link>
          </>
        ) : closed ? (
          <>
            <span>A newer version replaced this one. Open My acknowledgments to read the current version.</span>
            <Link className="btn btn-primary" to="/policies/acknowledgments">My acknowledgments</Link>
          </>
        ) : (
          <>
            <Checkbox label="I have read and understood this policy" checked={read} onChange={setRead} />
            <span className="row">
              <Link className="btn btn-secondary" to="/policies/acknowledgments">Not now</Link>
              <Button variant="primary" icon="check" disabled={!read} loading={busy} onClick={() => void acknowledge()}>Acknowledge</Button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
