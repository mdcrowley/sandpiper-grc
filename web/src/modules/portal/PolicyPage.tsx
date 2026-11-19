// Read a policy I have been asked to acknowledge, and acknowledge it.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, Button, errorMessage, ErrorState, formatDate, formatDateTime, Icon, Loading, useFetch, useToast } from '../../core';

interface Ack {
  id: string; policy_title: string; policy_ref: string; version: number; effective_on: string | null; due_on: string;
  acknowledged_at: string | null; state: string; change_summary: string | null; body_html: string;
}

export function PolicyPage() {
  const { ackId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: a, error, reload } = useFetch<Ack>(`/api/policies/acknowledgements/${ackId}`);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (a) document.title = a.policy_title; }, [a]);

  async function acknowledge() {
    setBusy(true);
    try {
      await api.post(`/api/policies/acknowledgements/${ackId}/acknowledge`);
      toast.success('Thank you. Your acknowledgement is recorded.');
      navigate('/portal');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return <div className="pt-empty-page"><h1>Nothing to acknowledge here</h1><p className="muted"><Link to="/portal">Back to the portal</Link></p></div>;
    }
    return <ErrorState error={error} onRetry={reload} />;
  }
  if (!a) return <Loading lines={8} label="Loading the policy" />;
  return (
    <div className="pt-page pt-article">
      <nav className="pt-back"><Link to="/portal"><Icon name="chevron-left" size={18} /> Home</Link></nav>
      <p className="pt-ref">{a.policy_ref} · Version {a.version}{a.effective_on ? ` · In force from ${formatDate(a.effective_on)}` : ''}</p>
      <h1>{a.policy_title}</h1>
      {a.change_summary && <p className="pt-callout"><Icon name="info" size={18} /> What changed: {a.change_summary}</p>}
      {/* The policies module renders the text to safe HTML on the server. */}
      <div className="pt-card pt-policy-body" dangerouslySetInnerHTML={{ __html: a.body_html }} />
      <div className="pt-card pt-ack">
        {a.acknowledged_at ? (
          <p className="pt-ack-done"><Icon name="check-circle" size={20} /> You acknowledged this on {formatDateTime(a.acknowledged_at)}.</p>
        ) : (
          <>
            <p><strong>Please confirm you have read and understood this policy</strong>{a.due_on ? ` by ${formatDate(a.due_on)}` : ''}.</p>
            <Button variant="primary" icon="check" loading={busy} className="pt-submit" onClick={() => void acknowledge()}>I have read and understood it</Button>
          </>
        )}
      </div>
    </div>
  );
}
