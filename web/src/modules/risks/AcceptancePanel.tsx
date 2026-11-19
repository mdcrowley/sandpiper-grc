import { useState, type FormEvent } from 'react';
import {
  api, ApiError, Badge, Button, Card, DateField, DefinitionList, ErrorState, errorMessage, formatDate, Icon, Loading, Modal,
  ProgressBar, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { daysUntil } from './scales';

interface AcceptanceData {
  acceptances: Row[];
  rule: { rating: string | null; rating_label: string | null; threshold: string | null; threshold_label: string | null; executive_required: boolean };
}

const EMPTY = { approver_name: '', approver_title: '', approved_on: '', expires_on: '', reference: '', rationale: '' };
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

function StateBadge({ a }: { a: Row }) {
  if (a.state === 'revoked') return <Badge color="gray">Revoked {formatDate(a.revoked_on)}</Badge>;
  if (a.state === 'superseded') return <Badge color="gray">Replaced by a later acceptance</Badge>;
  if (a.expired) return <Badge color="red">Expired {formatDate(a.expires_on)}</Badge>;
  if (a.days_left <= 60) return <Badge color="amber">Expires in {days(a.days_left)}</Badge>;
  return <Badge color="green">Valid until {formatDate(a.expires_on)}</Badge>;
}

/** Acceptance decisions for a risk: who approved, until when, the executive-approval rule, and revoking. */
export function AcceptancePanel({ rec }: { rec: RecordContext }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<AcceptanceData>(`/api/risks/${rec.row.id}/acceptances`);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState<Row | null>(null);
  const [revoke, setRevoke] = useState({ reason: '', revoked_on: '' });
  const [showEarlier, setShowEarlier] = useState(false);

  if (error) return <Card title="Acceptance"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="Acceptance"><Loading lines={3} /></Card>;

  const { rule, acceptances } = data;
  const exec = rule.executive_required;
  const canApprove = can('risks.approve');
  const field = (k: keyof typeof EMPTY) => ({ value: form[k], error: errors[k], onChange: (v: string) => setForm((f) => ({ ...f, [k]: v })) });
  // The acceptance that counts: the newest one that has not been revoked.
  const standing = acceptances.find((a) => a.state === 'current' || a.state === 'expired');
  const earlier = acceptances.filter((a) => a !== standing);
  const after = () => { reload(); rec.reload(); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!form.expires_on) found.expires_on = 'Give the date the acceptance expires.';
    if (!form.rationale.trim()) found.rationale = 'Say why the risk is being accepted.';
    if (exec) {
      if (!form.approver_name.trim()) found.approver_name = 'Name the executive who approved the acceptance.';
      if (!form.approver_title.trim()) found.approver_title = "Give the approver's title.";
      if (!form.reference.trim()) found.reference = 'Give a reference for the approval.';
    }
    setErrors(found);
    setMessage('');
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await api.post(`/api/risks/${rec.row.id}/acceptances`, form);
      toast.success('Acceptance recorded.');
      setOpen(false);
      setForm(EMPTY);
      after();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const submitRevoke = async (e: FormEvent) => {
    e.preventDefault();
    if (!revoking) return;
    if (!revoke.reason.trim()) { setErrors({ reason: 'Say why the acceptance is being revoked.' }); return; }
    setSaving(true);
    setMessage('');
    try {
      await api.post(`/api/risks/${rec.row.id}/acceptances/${revoking.id}/revoke`, revoke);
      toast.success('Acceptance revoked.');
      setRevoking(null);
      after();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields); else setErrors({});
      setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const explain = !rule.rating
    ? 'Score the risk before recording an acceptance.'
    : !rule.threshold
      ? 'No executive-approval threshold is set for this scale, so anyone who may approve risks can accept this one.'
      : exec
        ? `This risk is rated ${rule.rating_label}, which is at or above the threshold (${rule.threshold_label}) for its scale. Accepting it needs a named executive approver: their name, title and a reference for the approval.`
        : `This risk is rated ${rule.rating_label}, below the executive-approval threshold (${rule.threshold_label}) for its scale. Risks at or above the threshold need a named executive approver.`;

  const details = (a: Row) => (
    <DefinitionList items={[
      { label: 'Approved by', value: [a.approver_name, a.approver_title].filter(Boolean).join(', ') },
      { label: 'Approved on', value: formatDate(a.approved_on) },
      { label: 'Expires on', value: formatDate(a.expires_on) },
      { label: 'Reference', value: a.reference || '—' },
      { label: 'Recorded by', value: a.recorded_by || 'System' },
      { label: 'Rationale', value: <span className="prose">{a.rationale}</span>, wide: true },
      ...(a.revoked_on ? [
        { label: 'Revoked', value: `${formatDate(a.revoked_on)}${a.revoked_by_name ? ` by ${a.revoked_by_name}` : ''}` },
        { label: 'Reason for revoking', value: <span className="prose">{a.revoked_reason}</span>, wide: true },
      ] : []),
    ]} />
  );

  const total = standing ? Math.max(1, (daysUntil(standing.expires_on) ?? 0) - (daysUntil(standing.approved_on) ?? 0)) : 1;
  const left = standing ? Math.max(0, standing.days_left) : 0;

  return (
    <Card
      title="Acceptance"
      actions={canApprove && rule.rating && (
        <Button size="sm" icon="check-square" onClick={() => { setErrors({}); setMessage(''); setOpen(true); }}>
          {standing ? 'Renew acceptance' : 'Record acceptance'}
        </Button>
      )}
    >
      <div className={`notice rk-rule${exec ? ' notice-pilot' : ''}`}>
        <Icon name={exec ? 'alert-circle' : 'info'} size={18} />
        <div>
          <strong>{exec ? 'Executive approval needed' : 'The executive-approval rule'}</strong>
          <p>{explain} Every acceptance has an expiry date, after which the risk must be looked at again.</p>
        </div>
      </div>

      {!standing ? (
        <p className="rk-acc-none">
          <Icon name="shield" size={18} />
          <span><strong>Not accepted.</strong> <span className="muted">{acceptances.length ? 'No acceptance stands for this risk now.' : 'No acceptance has been recorded for this risk.'}</span></span>
        </p>
      ) : (
        <div className={`rk-acc-current${standing.expired ? ' is-expired' : standing.days_left <= 60 ? ' is-soon' : ''}`}>
          <div className="rk-acc-count">
            <span className="rk-acc-days">{standing.expired ? days(-standing.days_left) : days(standing.days_left)}</span>
            <span className="rk-acc-word">{standing.expired ? 'since it expired' : 'until it expires'}</span>
            <ProgressBar
              hideLabel label="Time left on the acceptance" value={left} max={total}
              color={standing.expired ? 'red' : standing.days_left <= 60 ? 'amber' : 'green'}
              valueText={standing.expired ? 'Expired' : `${days(left)} of ${days(total)} left`}
            />
            <span className="muted">{formatDate(standing.approved_on)} to {formatDate(standing.expires_on)}</span>
          </div>
          <div className="rk-acc-detail">
            <div className="row">
              <strong>Current acceptance</strong>
              <StateBadge a={standing} />
              {standing.executive_required && <Badge color="purple">Executive approval</Badge>}
            </div>
            {details(standing)}
            {canApprove && (
              <div>
                <Button size="sm" variant="ghost" icon="x" onClick={() => { setErrors({}); setMessage(''); setRevoke({ reason: '', revoked_on: '' }); setRevoking(standing); }}>
                  Revoke acceptance
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {earlier.length > 0 && (
        <div className="rk-acc-earlier">
          <Button size="sm" variant="ghost" icon={showEarlier ? 'chevron-up' : 'chevron-down'} aria-expanded={showEarlier} onClick={() => setShowEarlier((v) => !v)}>
            {earlier.length === 1 ? '1 earlier acceptance' : `${earlier.length} earlier acceptances`}
          </Button>
          {showEarlier && earlier.map((a) => (
            <div key={a.id} className="rk-acc-old">
              <div className="row"><strong>Earlier acceptance</strong><StateBadge a={a} />{a.executive_required && <Badge color="purple">Executive approval</Badge>}</div>
              {details(a)}
            </div>
          ))}
        </div>
      )}

      <Modal open={open} title={standing ? 'Renew acceptance' : 'Record acceptance'} onClose={() => setOpen(false)}>
        <form className="form" onSubmit={submit} noValidate>
          <p className="muted" style={{ margin: 0 }}>{explain}</p>
          {message && <p role="alert" className="form-error">{message}</p>}
          <div className="form-grid">
            <TextField label="Approver name" required={exec} hint={exec ? undefined : 'Left empty, you are recorded as the approver.'} {...field('approver_name')} />
            <TextField label="Approver title" required={exec} {...field('approver_title')} />
            <DateField label="Approved on" hint="Left empty, today." {...field('approved_on')} />
            <DateField label="Expires on" required {...field('expires_on')} />
            <TextField className="form-cell-wide" label="Reference" required={exec} hint="For example a memo, email or resolution number." {...field('reference')} />
            <TextArea className="form-cell-wide" label="Rationale" required {...field('rationale')} />
          </div>
          <div className="form-actions">
            <Button variant="primary" type="submit" loading={saving}>Record acceptance</Button>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>

      <Modal open={revoking !== null} title="Revoke acceptance" size="sm" onClose={() => setRevoking(null)}>
        <form className="form" onSubmit={submitRevoke} noValidate>
          <p className="muted" style={{ margin: 0 }}>
            The acceptance stays on record, marked as revoked. The risk goes back to Open unless an earlier acceptance still stands.
          </p>
          {message && <p role="alert" className="form-error">{message}</p>}
          <TextArea label="Reason" required rows={3} value={revoke.reason} error={errors.reason} onChange={(v) => setRevoke((r) => ({ ...r, reason: v }))} />
          <DateField label="Revoked on" hint="Left empty, today." value={revoke.revoked_on} error={errors.revoked_on} onChange={(v) => setRevoke((r) => ({ ...r, revoked_on: v }))} />
          <div className="form-actions">
            <Button variant="danger" type="submit" loading={saving}>Revoke acceptance</Button>
            <Button onClick={() => setRevoking(null)}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
