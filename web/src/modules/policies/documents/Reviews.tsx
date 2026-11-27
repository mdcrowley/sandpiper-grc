// Periodic reviews (E43-05): the documents whose review is overdue or due soon, and the dialog that
// records a review. A review ends in No change (the next review date moves on, no new version),
// Revise (a draft is opened) or Make obsolete (needs approval rights and a reason).
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, Modal, Notice, PageHeader, RecordPicker, Select,
  StatusChip, TableWrap, TextArea, TextField, qs, useAuth, useFetch, useLookup, useToast,
} from '../../../core';
import { daysPhrase, isoDay } from '../shared';
import { DocumentsTabs } from './DocumentsTabs';
import { docNumber, recordPath, type DocumentReview, type ReviewDue } from './types';

type Result = 'no_change' | 'revise' | 'retire';

const RESULT_HINT: Record<Result, string> = {
  no_change: 'The text stays as it is. The review is recorded on the version in force and the next review date moves on by the review cycle.',
  revise: 'A draft of the next version is opened from the text in force, to be written, approved and published as usual.',
  retire: 'The document is made obsolete: its version in force is withdrawn and open acknowledgment requests are closed.',
};

/** Records a periodic review of one document. */
export function ReviewDialog({ doc, onClose, onDone }: {
  doc: { id: string; title: string; doc_number?: string | null; ref?: string | null }; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();
  const results = useLookup('document_review_result');
  const [form, setForm] = useState({ result: 'no_change' as Result, reviewed_on: isoDay(), note: '', reviewed_by_name: '', reason: '', replaced_by_id: null as string | null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const options = (results.length ? results : [
    { value: 'no_change', label: 'No change' }, { value: 'revise', label: 'Revise' }, { value: 'retire', label: 'Make obsolete' },
  ]).filter((o) => o.value !== 'retire' || can('policies.approve'));

  const save = async () => {
    setErrors({});
    setMessage('');
    if (form.result === 'retire' && !form.reason.trim()) { setErrors({ reason: 'Say why the document is no longer needed.' }); return; }
    setBusy(true);
    try {
      const out = await api.post<{ next_review_on?: string | null; retired?: boolean; version?: { id: string; version: number } }>(
        `/api/policies/${doc.id}/reviews`,
        {
          result: form.result, reviewed_on: form.reviewed_on || undefined, note: form.note || undefined,
          reviewed_by_name: form.reviewed_by_name || undefined,
          ...(form.result === 'retire' ? { reason: form.reason.trim(), replaced_by_id: form.replaced_by_id || undefined } : {}),
        },
      );
      if (form.result === 'revise') {
        toast.success(`Review recorded. Draft version ${out.version?.version ?? ''} is open for writing.`);
        onClose();
        navigate(`${recordPath(doc.id)}/edit`);
        return;
      }
      toast.success(out.retired ? 'Review recorded. The document is now obsolete.'
        : `Review recorded.${out.next_review_on ? ` Next review ${formatDate(out.next_review_on)}.` : ''}`);
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields ?? {}).length) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open title={`Record a review: ${docNumber(doc) || doc.title}`} onClose={onClose} size="md" dirty={Boolean(form.note || form.reason)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={form.result === 'retire' ? 'danger' : 'primary'} loading={busy} onClick={() => void save()}>Record review</Button></>}
    >
      <div className="stack">
        {message && <Notice tone="error">{message}</Notice>}
        <p className="muted">{doc.title}</p>
        <Select label="Result" value={form.result} error={errors.result} options={options} onChange={(v) => setForm((f) => ({ ...f, result: (v || 'no_change') as Result }))} />
        <p className="muted doc-small">{RESULT_HINT[form.result]}</p>
        <DateField label="Reviewed on" value={form.reviewed_on} error={errors.reviewed_on} onChange={(v) => setForm((f) => ({ ...f, reviewed_on: v }))} />
        <TextField label="Reviewed by" value={form.reviewed_by_name} error={errors.reviewed_by_name} hint="Leave empty to record your own name."
          onChange={(v) => setForm((f) => ({ ...f, reviewed_by_name: v }))} />
        {form.result === 'retire' && (
          <>
            <TextArea label="Why it is no longer needed" required rows={2} value={form.reason} error={errors.reason} onChange={(v) => setForm((f) => ({ ...f, reason: v }))} />
            <RecordPicker type="policy" label="Replaced by (optional)" value={form.replaced_by_id} error={errors.replaced_by_id}
              onChange={(id) => setForm((f) => ({ ...f, replaced_by_id: id }))} />
          </>
        )}
        <TextArea label="Notes" rows={3} value={form.note} error={errors.note} onChange={(v) => setForm((f) => ({ ...f, note: v }))} />
      </div>
    </Modal>
  );
}

const STATES = [
  { value: 'all', label: 'Overdue and due' },
  { value: 'overdue', label: 'Overdue only' },
  { value: 'due', label: 'Due, not yet overdue' },
];
const WINDOWS = [30, 60, 90, 180, 365].map((d) => ({ value: String(d), label: `Next ${d} days` }));

export function ReviewsDue() {
  const [params, setParams] = useSearchParams();
  const state = params.get('state') ?? 'all';
  const days = params.get('days') ?? '90';
  const { data, error, reload } = useFetch<{ today: string; rows: ReviewDue[] }>(`/api/documents/reviews${qs({ state, days })}`, { keepPrevious: true });
  const [reviewing, setReviewing] = useState<ReviewDue | null>(null);
  const set = (k: string, v: string) => { const next = new URLSearchParams(params); next.set(k, v); setParams(next, { replace: true }); };

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={6} label="Loading reviews due" />;
  else if (!data.rows.length) body = <EmptyState icon="check-square" title="No reviews due" message={`No document you look after is overdue for review or due in the next ${days} days.`} />;
  else {
    body = (
      <TableWrap label="Documents due for review" fit>
        <table className="table">
          <caption className="sr-only">Documents due for review</caption>
          <thead><tr>
            <th scope="col" data-priority="1">Document</th><th scope="col" data-priority="2">Owner</th>
            <th scope="col" data-priority="1">Review</th><th scope="col" data-priority="3">Last reviewed</th>
            <th scope="col" data-priority="1"><span className="sr-only">Record</span></th>
          </tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="pol-wrap"><Link to={recordPath(r.id)}>{docNumber(r) && <span className="doc-number">{docNumber(r)}</span>} {r.title}</Link></td>
                <td>{r.owner_name ?? <span className="muted">No owner</span>}</td>
                <td>
                  {r.state === 'overdue'
                    ? <StatusChip color="red" label={`Overdue, due ${daysPhrase(r.days_left)}`} />
                    : <StatusChip color="amber" label={`Due ${daysPhrase(r.days_left)}`} />}
                </td>
                <td>{r.last_reviewed_on ? formatDate(r.last_reviewed_on) : <span className="muted">Never</span>}</td>
                <td><Button size="sm" onClick={() => setReviewing(r)}>Record review<span className="sr-only"> of {r.title}</span></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    );
  }

  const overdue = data?.rows.filter((r) => r.state === 'overdue').length ?? 0;
  return (
    <div className="stack">
      <PageHeader title="Reviews due" subtitle="Documents to review for adequacy: overdue first. Reference documents are not reviewed." />
      <DocumentsTabs active="reviews" />
      <Card flush title={data ? `${data.rows.length} ${data.rows.length === 1 ? 'document' : 'documents'}${overdue ? `, ${overdue} overdue` : ''}` : undefined}
        actions={(
          <span className="row doc-filters">
            <Select label="Show" hideLabel size="xs" value={state} options={STATES} onChange={(v) => set('state', v || 'all')} />
            <Select label="Window" hideLabel size="xs" value={days} options={WINDOWS} onChange={(v) => set('days', v || '90')} />
          </span>
        )}>
        {body}
      </Card>
      {reviewing && <ReviewDialog doc={reviewing} onClose={() => setReviewing(null)} onDone={reload} />}
    </div>
  );
}

const RESULT_CHIP: Record<string, { label: string; color: 'green' | 'blue' | 'purple' | 'gray' }> = {
  no_change: { label: 'No change', color: 'green' }, revise: { label: 'Revise', color: 'blue' }, retire: { label: 'Made obsolete', color: 'purple' },
};

/** The reviews of one document, newest first, with the button to record one. */
export function ReviewsPanel({ doc, onChanged }: { doc: { id: string; title: string; doc_number?: string | null; ref?: string | null; status?: string }; onChanged: () => void }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<DocumentReview[]>(`/api/policies/${doc.id}/reviews`);
  const [open, setOpen] = useState(false);
  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={4} />;
  else if (!data.length) body = <EmptyState icon="clock" title="No reviews yet" message="Each periodic review is recorded here with its result." />;
  else {
    body = (
      <TableWrap label="Reviews of this document" fit>
        <table className="table">
          <caption className="sr-only">Reviews of this document</caption>
          <thead><tr>
            <th scope="col" data-priority="1">Reviewed</th><th scope="col" data-priority="1">Kind</th><th scope="col" data-priority="1">Result</th>
            <th scope="col" data-priority="2">By</th><th scope="col" data-priority="2">Version</th><th scope="col" data-priority="3">Notes</th>
          </tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id}>
                <td>{r.reviewed_on ? formatDate(r.reviewed_on) : r.started_on ? `Started ${formatDate(r.started_on)}` : '—'}</td>
                <td>{r.kind === 'plan_annual' ? `Annual plan review${r.review_year ? ` ${r.review_year}` : ''}` : 'Periodic review'}</td>
                <td>{r.result ? <StatusChip color={RESULT_CHIP[r.result]?.color ?? 'gray'} label={RESULT_CHIP[r.result]?.label ?? r.result} /> : <span className="muted">{r.outcome ?? 'Running'}</span>}</td>
                <td>{r.reviewed_by_name ?? '—'}</td>
                <td>{r.version ?? '—'}</td>
                <td className="pol-wrap">{r.note ?? <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    );
  }
  return (
    <Card title="Reviews" flush actions={can('policies.edit') && doc.status !== 'retired' ? <Button size="sm" onClick={() => setOpen(true)}>Record review</Button> : undefined}>
      {body}
      {open && <ReviewDialog doc={doc} onClose={() => setOpen(false)} onDone={() => { reload(); onChanged(); }} />}
    </Card>
  );
}
