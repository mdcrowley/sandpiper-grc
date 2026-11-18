import { useState, type FormEvent } from 'react';
import {
  api, ApiError, Badge, Button, Card, DateField, DefinitionList, EmptyState, ErrorState, errorMessage, formatDate, Loading, Modal,
  TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';

interface AcceptanceData {
  acceptances: Row[];
  rule: { rating: string | null; rating_label: string | null; threshold: string | null; threshold_label: string | null; executive_required: boolean };
}

const EMPTY = { approver_name: '', approver_title: '', approved_on: '', expires_on: '', reference: '', rationale: '' };

/** Acceptance decisions for a risk: who approved, until when, and the executive-approval rule. */
export function AcceptancePanel({ rec }: { rec: RecordContext }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<AcceptanceData>(`/api/risks/${rec.row.id}/acceptances`);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  if (error) return <Card title="Acceptance"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="Acceptance"><Loading lines={3} /></Card>;

  const { rule, acceptances } = data;
  const exec = rule.executive_required;
  const field = (k: keyof typeof EMPTY) => ({ value: form[k], error: errors[k], onChange: (v: string) => setForm((f) => ({ ...f, [k]: v })) });

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
      reload();
      rec.reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const explain = !rule.rating
    ? 'Score the risk before recording an acceptance.'
    : !rule.threshold
      ? 'No executive-approval threshold is set for this scale.'
      : exec
        ? `This risk is rated ${rule.rating_label}, which is at or above the threshold (${rule.threshold_label}) for its scale. Accepting it needs a named executive approver: their name, title and a reference for the approval.`
        : `This risk is rated ${rule.rating_label}, below the executive-approval threshold (${rule.threshold_label}) for its scale. Risks at or above the threshold need a named executive approver.`;

  return (
    <Card
      title="Acceptance"
      actions={can('risks.approve') && rule.rating && <Button size="sm" onClick={() => { setErrors({}); setMessage(''); setOpen(true); }}>Record acceptance</Button>}
    >
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{explain} Every acceptance has an expiry date, after which the risk must be looked at again.</p>
        {acceptances.length === 0 ? (
          <EmptyState title="Not accepted" message="No acceptance has been recorded for this risk." icon="check-square" />
        ) : acceptances.map((a, index) => (
          <div key={a.id} className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--s-3)' }}>
            <div className="row">
              <strong>{index === 0 ? 'Current acceptance' : 'Earlier acceptance'}</strong>
              {a.expired ? <Badge color="red">Expired {formatDate(a.expires_on)}</Badge>
                : a.days_left <= 60 ? <Badge color="amber">Expires in {a.days_left} {a.days_left === 1 ? 'day' : 'days'}</Badge>
                : <Badge color="green">Valid until {formatDate(a.expires_on)}</Badge>}
              {a.executive_required && <Badge color="purple">Executive approval</Badge>}
            </div>
            <DefinitionList items={[
              { label: 'Approved by', value: [a.approver_name, a.approver_title].filter(Boolean).join(', ') },
              { label: 'Approved on', value: formatDate(a.approved_on) },
              { label: 'Expires on', value: formatDate(a.expires_on) },
              { label: 'Reference', value: a.reference || '—' },
              { label: 'Recorded by', value: a.recorded_by || 'System' },
              { label: 'Rationale', value: <span className="prose">{a.rationale}</span>, wide: true },
            ]} />
          </div>
        ))}
      </div>

      <Modal open={open} title="Record acceptance" onClose={() => setOpen(false)}>
        <form className="form" onSubmit={submit} noValidate>
          <p className="muted" style={{ margin: 0 }}>{explain}</p>
          {message && <p role="alert" className="is-overdue" style={{ margin: 0 }}>{message}</p>}
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
    </Card>
  );
}
